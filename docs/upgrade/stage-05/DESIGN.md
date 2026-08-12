# Stage 5 Design — Reservation Transaction Reliability

Status: COMPLETE (2026-08-12). Based on the four-agent read-only discovery
sweep (booking write path, cancellation/status path, DB invariants, test
harness); every claim carries file:line evidence. Companion:
CONCURRENCY_TEST_MATRIX.md (scenarios M1–M10), IMPLEMENTATION_PLAN.md.

Core invariant (stage charter): a slot that is no longer legally bookable
must never become successfully overbooked merely because two or more requests
were processed concurrently. UI availability is never authoritative booking
proof.

## 1. Current booking transaction architecture

One INSERT site, two entry points, zero transactions:

- `createCounselingRequest(formData)` — counseling.actions.ts:18. Student
  role gate (:23-25, via getDemoProfile). Revalidates by recomputing
  `getAvailableCounselingSlots()` (:33) and requiring the submitted slotId to
  exist in the result (:38-41), then INSERTs `status:'pending'` (:44-55) on
  the student SESSION client. Success → professor notification (:69-76,
  best-effort) → `revalidatePath("/counseling")` + `("/professor")` (:78-79).
- `reserveSuggestedCounseling(formData)` — counseling.actions.ts:88 — reads
  the rejected row's suggested_* (:97-102, scoped id+student, no status
  filter), rebuilds FormData, and delegates to `createCounselingRequest`
  (:118).
- Status transitions — professor.actions.ts:200 `updateCounselingStatus`
  (role gate professor|assistant :202, SERVICE-ROLE client :223, blind
  UPDATE by id :224-234 writing status + professor_note + suggested_*), and
  :262 `updateCounselingDetails` (note/location). Notification after the
  write (:240-250), revalidatePath ×2 (:252-253), degraded ok:true if the
  notification fails (:255-257).
- No student cancel exists (KI-017). No DELETE sites. No RPC touches
  counseling_requests; the repo's only atomic multi-statement primitives are
  Postgres functions elsewhere (approve_course_weekly_plan,
  replace_student_*_schedule_slots).

Everything is independent PostgREST round trips: availability read (4
parallel queries, counseling.service.ts:69-74), then INSERT, then
notification, then revalidate. The read→check→insert window is open and
un-serialized at the app layer.

## 2. Identified race windows (evidence-confirmed)

R1 — Blind revalidation (structural, not timing). `getBusyRequests`
(counseling.service.ts:247-251) runs on the student session client; the RLS
SELECT policy (20260713090000_fix_student_counseling_request_rls.sql:112-128)
admits only the caller's own rows. Other students' pending/approved rows
never enter the busy set, so the server-side re-check at
counseling.actions.ts:38 cannot reject a taken slot — and the /counseling
page renders occupied slots as available. This silently violates the Stage 2
canonical contract (displayed availability == canonical bookable set,
D-004/D-005): the canonical busy definition is ALL pending+approved rows,
which the DB constraint enforces but the app can no longer see. Every
cross-student collision therefore reaches the DB.

R2 — TOCTOU window. Even with a truthful busy feed, the availability read
(:33) and INSERT (:44) are separate statements; two concurrent bookings can
both pass the check. The GiST exclusion constraint
(20260713040000_prevent_counseling_request_overlaps.sql:50-56) is the only
serialization point — correct, but its 23P01 outcome is unmapped: every
insert error collapses into the generic retry message
(counseling.actions.ts:57-67), and the failure path never refreshes the
client (counseling-workspace.tsx:207-210).

R3 — Duplicate submission. No server-side idempotency. A retry after a
timeout whose first attempt committed hits the constraint and is reported as
failure while the reservation exists; the user is misled (M2).

R4 — Blind status transitions. `updateCounselingStatus` has no from-state
predicate and its whitelist includes `pending` (professor.actions.ts:212).
Approve∥cancel → last-writer-wins with contradictory notifications;
cancelled→approved / →pending resurrections are accepted (M4/M5); the only
backstop is the constraint firing if the slot was re-taken, surfaced as a
generic error (:236-238). professor_note/suggested_* are wiped
unconditionally (:228-230), racing updateCounselingDetails.

R5 — Partial failure shape. The reservation-bearing write is one statement
(atomic), but the follow-up notification is a separate round trip; failure
yields ok:true + honest degraded message (counseling.actions.ts:81-83,
professor.actions.ts:255-257); a crash in between loses the notification
silently. No partial reservation state is possible (nothing to roll back),
but the side-effect gap is real.

R6 — Suggested-slot staleness. suggested_* are written with no validation
against availability (professor.actions.ts:216, :229-230) and consumed later
through the full revalidation path; the failure is currently the unexplained
generic/SLOT_NOT_AVAILABLE message. Double consumption is prevented only at
the DB (M8).

Adjacent but explicitly OUT of Stage 5 (Stage 9 security charter, KI-014):
missing ownership guards (any professor/assistant can transition any
request), the anon UPDATE grant + hardcoded-demo-email policy residue
(schema.sql:471, :507-523), and the RLS policy overhaul.

## 3. Reservation invariants (what Stage 5 must make true)

- I1 (capacity): at most one active (pending|approved) request may cover any
  (professor, half-open time range). Enforced by the DB (existing GiST
  exclusion + partial unique index). Stage 5 does not weaken or duplicate it.
- I2 (authoritative revalidation): the booking path's server-side
  availability check must evaluate the canonical busy set — ALL students'
  pending+approved rows — not an RLS-truncated subset.
- I3 (legal transitions): status may move only pending→approved,
  pending→rejected, pending→cancelled, approved→cancelled. rejected and
  cancelled are terminal; `pending` is never a target. Competing transitions
  resolve to exactly one winner (compare-and-set), never last-writer-wins.
- I4 (atomic mutation): every invariant-bearing write is a single SQL
  statement (INSERT with constraint check; conditional UPDATE). No partial
  reservation state can exist.
- I5 (controlled conflicts): concurrency losers receive stable, honest,
  Korean-vocabulary outcomes ("slot no longer available", "already
  reserved", "already processed") — never raw DB errors, never a
  retry-invitation for a deterministic conflict.
- I6 (idempotent duplicates): a duplicate of the caller's own committed
  booking is acknowledged as success, not reported as failure.

## 4. Transaction boundary

Smallest boundaries that protect the invariants — deliberately NOT one big
transaction:

- Booking: [advisory revalidation (I2)] then [INSERT — atomic with the
  constraint check by definition]. The revalidation is UX-authoritative
  (rejects stale/blind submissions before a write); the constraint is
  correctness-authoritative (serializes the TOCTOU window R2). Wrapping both
  in a DB transaction would NOT remove the race (read-committed reads don't
  lock the range; only the constraint — or explicit range locking — can),
  so the check+insert pair stays two statements by design, with the insert
  error mapped (I5/I6).
- Status transition: one conditional UPDATE
  (`set status=... where id=... and status in (allowedFrom)` via PostgREST
  `.eq/.in`), returning the row or a 0-row conflict. Atomic CAS per
  statement; no lock, no version column needed (the from-state IS the
  guard). updated_at CAS was considered and rejected (§12C).
- Student cancel: same CAS shape + ownership predicate.
- Notifications and revalidatePath stay OUTSIDE the boundary: best-effort,
  ordered after the commit, honest degraded messaging (existing behavior,
  now pinned by tests). Fusing them into an RPC transaction is rejected in
  §12B; an outbox is deferred (§13).

## 5. Database protections

Existing (verified in-source; live verification is plan step T1):

- `counseling_requests_no_active_overlap` — GiST exclusion,
  `(professor_id WITH =, tstzrange(requested_start, requested_end,'[)') WITH
  &&) WHERE status IN ('pending','approved')`, NOT deferrable
  (20260713040000:50-56; btree_gist enabled :48). This is the overbooking
  authority for both INSERTs and any UPDATE that re-enters the active
  predicate.
- `counseling_requests_confirmed_slot_idx` — partial unique
  (professor_id, requested_start, requested_end) WHERE active
  (schema.sql:359-361) — exact-duplicate guard, subsumed by the GiST rule
  but harmless.
- `counseling_requests_time_order` CHECK, FKs, `updated_at` trigger
  (schema.sql:342-357, :431-432).

Stage 5 adds NO new database objects. Reasons: the invariant-bearing
constraint already exists; capacity is structurally 1 (D-005) so no numeric
capacity rule is needed; migration history is manually applied and known to
drift (KI-006), so a casual migration is risk without necessity. The one
candidate migration considered — a student self-UPDATE RLS policy for the
new cancel action — is rejected in favor of the repo's established
service-role + app-predicate pattern (professor.actions.ts:220-222), because
the whole RLS policy family is broken-by-mapping and owned by Stage 9
(KI-007/KI-014); adding one more policy to a known-wrong family now would
churn the live DB twice.

Documented drift (NOT fixed here, Stage 10): the GiST constraint and
btree_gist exist only in the migration, not schema.sql; suggested_*/location
exist only in schema.sql, no migration adds them; offering_id exists only in
a migration. A fresh `db reset` cannot reproduce the live schema from either
source alone.

Live verification (T1): because migrations were applied by hand (KI-006),
the design's authority — the GiST constraint — is verified against the live
database once, via a service-role overlapping-insert probe (two inserts,
same professor, same far-future range → expect the second to fail with
23P01) followed by cleanup of both rows. If the probe does NOT raise 23P01,
Stage 5 STOPS and documents the conflict: the constraint must be applied by
the owner before any code relying on it ships.

## 6. Idempotency decision

Needed: yes, narrowly — for the booking mutation only (M2/M8: double-click,
network/proxy retry, retry after timeout, reserve-suggested re-click).
Status transitions don't need one: CAS makes replays return the controlled
"already processed" conflict, which is an acceptable and honest duplicate
response for professor actions.

Mechanism: post-conflict self-match, derived from the constraint-protected
table itself — NO idempotency-key store.

- Scope: `createCounselingRequest` (and `reserveSuggestedCounseling` through
  its delegate).
- Behavior: when the INSERT fails with 23505/23P01, re-read (service-role)
  the active row covering (professor_id, requested range). If it belongs to
  the caller with the identical requested_start/end → the caller's own
  intent already committed → return ok:true with an honest "이미 신청된 상담
  시간입니다" message (duplicate response = success acknowledgment). Else →
  controlled conflict (I5).
- Key lifetime: none stored; the "key" is the active row itself, so the
  duplicate window lasts exactly as long as the reservation is active —
  which is the correct business lifetime.
- Storage: none. Conflict behavior: as above.
- Rejected alternative: a client-generated idempotency key + unique column.
  Requires a migration (§5 risks), a key column with lifetime/GC semantics,
  and client changes — strictly more machinery for the same observable
  outcomes in every scenario in the matrix. The stage charter says the
  narrow mechanism wins ("Do not introduce a complex generalized idempotency
  platform if one narrow booking-mutation mechanism is sufficient").
- Known limit (documented, accepted): if the user intends two DIFFERENT
  bookings of the SAME slot after a cancel in between, the self-match could
  in principle acknowledge the earlier row — but that row being active means
  the slot is legitimately theirs; the acknowledgment is still truthful.

## 7. Stale-state handling

- Display: the /counseling availability itself becomes truthful again
  (I2 fix) — occupied slots disappear for everyone, restoring the Stage 2
  displayed==canonical invariant that the RLS migration silently broke.
- Submission of a stale slot: rejected pre-insert by the authoritative
  revalidation with the existing SLOT_NOT_AVAILABLE vocabulary
  (counseling.actions.ts:11) — a controlled conflict, not a DB error.
- Convergence: conflict branches call `revalidatePath("/counseling")` (and
  "/professor" where relevant) even though the action failed — the data DID
  change (someone else changed it); Next returns the refreshed RSC payload
  with the action response, so the stale slot list heals without any client
  code change. The Stage 4 success-path pattern (router.refresh on ok)
  remains untouched.
- Professor workspace: conflict branches in updateCounselingStatus likewise
  revalidate, so the stale card resyncs through the existing props/useEffect
  path (professor-workspace.tsx:250-256); the loser's toast tells the truth
  ("already processed").

## 8. Cancellation semantics

- Legal matrix (I3): approved⇐pending; rejected⇐pending;
  cancelled⇐pending|approved; terminal: rejected, cancelled. `pending` is
  removed from the accepted targets (professor.actions.ts:212) — no UI ever
  sends it (professor-workspace.tsx:1503-1552 approve/reject from the
  pending queue; :386-391 cancel from the calendar which renders approved
  blocks only), so nothing user-reachable changes.
- Professor cancel keeps its UI; its notification copy is fixed (KI-015
  open item): cancelled gets an honest title/body (no phantom "추천 시간"
  promise built from a nulled note). Reject copy unchanged.
- NEW student cancel — `cancelMyCounselingRequest` (KI-017, chartered as a
  Stage 5 input by the Stage 4 handoff): CAS
  `status='cancelled' WHERE id=? AND student_id=caller AND status IN
  ('pending','approved')`, service-role client + app ownership predicate
  (§5), professor notified best-effort, revalidatePath ×2. Minimal UI: a
  cancel control on the student's own active requests in the existing
  requests panel, confirm() + the Stage 4 runAction inline-feedback pattern
  (context "requests"). No redesign.
- Freeing capacity is instantaneous and consistent: every busy consumer
  filters pending+approved (matrix preamble; agent-verified consumer table),
  and cancel/reject leave the GiST predicate atomically with the status
  write — there is no intermediate state (M6).

## 9. API conflict behavior (error semantics)

Return shape stays exactly `{ ok: boolean; message: string }` everywhere
(API compatibility; the client types assume it). Vocabulary — existing
strings reused where the meaning fits, new strings only where a new outcome
exists:

| Outcome | ok | Message | Where |
| --- | --- | --- | --- |
| Slot no longer available (stale submit, pre-insert) | false | existing `SLOT_NOT_AVAILABLE_MESSAGE` (counseling.actions.ts:11) | createCounselingRequest |
| Lost the insert race (23P01/23505, other student) | false | same SLOT_NOT_AVAILABLE_MESSAGE | createCounselingRequest |
| Duplicate of own committed booking | true | NEW "이미 신청된 상담 시간입니다. 신청 내역에서 확인해 주세요." | createCounselingRequest |
| Non-conflict insert failure (RLS, network, unknown) | false | existing generic save-failed (:66) — still correct for genuinely retryable failures | createCounselingRequest |
| Transition lost CAS / already processed | false | NEW "이미 처리된 상담 신청입니다. 최신 상태를 확인해 주세요." | updateCounselingStatus |
| Resurrected slot re-taken (23P01 on legal transition — unreachable once `pending` target is removed, kept as defense) | false | same "이미 처리된…" conflict | updateCounselingStatus |
| Student cancel succeeded | true | NEW "상담 신청을 취소했습니다." | cancelMyCounselingRequest |
| Student cancel: not owner / not found / already terminal | false | NEW "취소할 수 없는 상담 신청입니다. 최신 상태를 확인해 주세요." | cancelMyCounselingRequest |

Raw DB errors keep flowing only into the structured server-side
console.error (shape frozen by counseling-request-security.test.mjs:50-59);
nothing DB-shaped crosses to the user.

## 10. Cache invalidation implications

- Stage 3 (D-007) guarantees no cross-request caching of scheduling data —
  the only cache layer is request-scoped React cache(), which dies with the
  response. Nothing to invalidate server-side beyond revalidatePath.
- Change: conflict branches now ALSO revalidatePath (today only success
  does), because a conflict proves the underlying data changed. Success
  paths keep their existing revalidatePath ×2 + client router.refresh.
- Client: no changes to the Stage 4 refresh patterns; the student
  workspace's stale-selection edge (selected slot vanishes after refresh)
  already degrades safely (selectedSlot lookup fails → book button
  disabled, counseling-workspace.tsx:515).
- Query-count guard (counseling.query-count.test.mjs) is updated
  DELIBERATELY: same query inventory (counseling_requests: 2,
  professor_availability: 1), with the busy read now arriving through the
  admin-client stub — the await-topology assertion is preserved.

## 11. Migration risks

No migration ships in Stage 5 (§5). Risks therefore concentrate in one
place: the design's reliance on a constraint whose live presence is
asserted only by a manually-applied migration file — mitigated by the T1
live probe (23P01 expected; STOP + document if absent). Rollback story for
the code changes is plain git revert; no data shape changes, no backfill,
no destructive operation anywhere in the stage.

## 12. Alternatives evaluated

A — App-layer authoritative revalidation + existing DB constraint as the
serialization authority + CAS conditional updates + post-conflict
idempotency (CHOSEN). No migration, no new dependency, preserves API
shapes and the D-004 domain module as the single availability source;
protection lives exactly where each invariant is cheapest to enforce (I1 in
the DB — already there; I2/I5/I6 at the app boundary; I3/I4 as
single-statement CAS).

B — SECURITY DEFINER RPC (`create_counseling_request`,
`update_counseling_status`) wrapping validation + write + notification in
one DB transaction (repo precedent: approve_course_weekly_plan). Rejected:
(1) it would have to REIMPLEMENT the canonical availability rules in SQL —
`buildAvailableCounselingSlots` (KST wall-clock grids, blackout parsing,
teaching-slot conflicts, cutoffs) — recreating exactly the dual-engine
divergence Stage 2 deleted (D-004); (2) even inside the transaction the
TOCTOU race persists at read-committed — the constraint would STILL be the
real guard, so the transaction buys only notification atomicity; (3) it
requires a migration on a live, hand-migrated DB (KI-006) plus new RPC
grant surface (KI-011 family). Costs exceed the one benefit; the benefit
(notification atomicity) is deferred instead (§13).

C — Optimistic concurrency via the updated_at trigger as a CAS token
round-tripped through the professor UI. Rejected: requires threading tokens
through FormData/UI (Stage 4 UX churn), fails on any benign intermediate
write (details edit bumps updated_at → spurious conflicts), and the
business rule is really a from-state matrix — which the status predicate
expresses directly with zero client changes.

## 13. Explicitly deferred work

- Ownership guards on updateCounselingStatus/Details + anon UPDATE
  grant/policy residue + RLS policy family overhaul (incl. a student
  self-cancel policy) — Stage 9 (KI-014, KI-007, KI-011).
- Notification atomicity (outbox or RPC-fused notification) — the
  best-effort gap R5 stays, honestly messaged; revisit with Stage 8
  reliability work.
- Unbounded per-student pending requests across different slots (M10) —
  product policy, KNOWN_ISSUES.
- B-5 12-row professor queue window — Stage 8 (KI-017).
- schema.sql ↔ migrations reconciliation (constraint + suggested_* +
  offering_id drift) — Stage 10 (KI-015 note).
- Stage 6 tenancy note (charter §19): the overbooking invariant keys on
  professor_id, which remains globally unique under a tenant dimension —
  the GiST constraint needs NO tenant column; only future per-tenant
  policy scoping (Stage 6/9) will touch RLS, not this constraint. No
  tenant behavior is introduced now.
- Suggested-time write-side validation (professor suggesting an off-grid /
  unavailable time, R6 root cause) — needs product definition of "suggested
  time must be bookable"; consumption-side protection (this stage) already
  guarantees no invalid booking can result. KNOWN_ISSUES.
