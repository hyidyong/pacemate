# Stage 5 Concurrency Test Matrix

Status: DISCOVERY COMPLETE (2026-08-12). Every row is backed by source
evidence (file:line) from the four-agent read-only sweep; "Current behavior"
is what the repository does today, before Stage 5 changes. Rows M1–M5 and M8
are confirmed defects; M6/M7 are verified-safe-by-construction rows that get
regression tests; M9 is a chartered addition (KI-017 / Stage 4 handoff
"Stage 5 inputs"); M10 is documented and deferred.

Domain facts the matrix relies on:

- Capacity is structurally 1 per (professor, time range): GiST exclusion
  constraint `counseling_requests_no_active_overlap`
  (supabase/migrations/20260713040000_prevent_counseling_request_overlaps.sql:50-56,
  predicate `status in ('pending','approved')`, half-open tstzrange, NOT
  deferrable) plus exact-match partial unique index
  `counseling_requests_confirmed_slot_idx` (supabase/schema.sql:359-361).
- Statuses: pending|approved consume a slot; rejected|cancelled free it
  (D-005). Busy filter: counseling.service.ts:247-251.
- The one INSERT: counseling.actions.ts:44-55. The two status UPDATEs:
  professor.actions.ts:224-234 (status) and :277-283 (details).
- No app-level transactions exist (supabase-js); repo atomicity precedent is
  Postgres RPC (approve_course_weekly_plan, replace_student_*_slots).

| # | Scenario | Concurrent operations | Expected invariant | Current behavior | Protection (Stage 5) |
| --- | -------- | --------------------- | ------------------ | ---------------- | -------------------- |
| M1 | Concurrent booking, two students, same slot | 2× `createCounselingRequest` for one slot | At most 1 active (pending/approved) request covers the (professor, range); loser gets a controlled "slot no longer available" outcome | Both pass server revalidation — `getBusyRequests` (counseling.service.ts:247-251) runs on the student session client and the RLS SELECT policy (20260713090000:112-128) hides other students' rows, so the busy feed is structurally blind cross-student. The GiST constraint blocks the loser (23P01), but nothing maps 23P01 (no handler in src/), so the loser sees the generic "상담 신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." (counseling.actions.ts:57-67) which invites a doomed retry; failure path never refreshes the stale slot list (counseling-workspace.tsx:207-210) | (a) Complete busy feed: read pending/approved ranges via the service-role client (professor.service.ts:288-290 precedent) so revalidation is authoritative; (b) map 23P01/23505 to the existing SLOT_NOT_AVAILABLE vocabulary; (c) revalidatePath on conflict so the stale slot disappears. DB constraint remains the enforcement authority |
| M2 | Duplicate request, same student, same slot (double-click, network retry, retry after timeout whose first attempt committed) | 2× `createCounselingRequest`, same (student, slot) | One logical reservation; the duplicate attempt is acknowledged, not reported as failure | UI-only guards (useTransition disabled buttons, counseling-workspace.tsx:187,515). Second insert hits the partial unique index / GiST (23505/23P01) → generic failure message although the first row committed; user believes the booking failed (router.refresh only on ok) | Post-conflict self-match idempotency: on 23505/23P01, re-read the conflicting active row (service-role); if it is the caller's own row with the identical requested range → return ok with an honest "already reserved" message. No idempotency-key store (see DESIGN §6) |
| M3 | Stale slot: client loaded availability, another student booked, first client submits the old slot | 1 booking against a slot consumed earlier | Authoritative server rejects with a controlled conflict before/at write | Server revalidation cannot see the other student's row (same blind spot as M1) → attempt reaches the DB → constraint fires → generic message; slot list stays stale. Additionally the /counseling DISPLAY itself shows occupied slots as available (Stage 2 invariant "displayed == canonical bookable" silently broken by the RLS migration) | Same as M1(a): the complete busy feed restores both the display invariant and authoritative pre-insert rejection (SLOT_NOT_AVAILABLE_MESSAGE) + revalidatePath |
| M4 | Competing status transitions on one request (approve vs cancel, reject vs approve, double-approve) | 2× `updateCounselingStatus`, same id | Exactly one transition wins; the loser gets a controlled "already processed" outcome; no contradictory notifications | Blind `.update(...).eq("id", id)` with no from-state predicate (professor.actions.ts:224-234): last commit wins, both callers see ok:true, both notifications fire (student can get "승인" and "조정 필요" for one request), professor_note/suggested_* wiped by whichever landed last | Compare-and-set: conditional UPDATE with a legal from-state predicate (`.in("status", allowedFrom)`); 0-row result → controlled conflict message. Single-statement, atomic, no migration |
| M5 | Terminal-state resurrection (cancelled→approved, rejected→approved, approved→pending, cancelled→pending) | `updateCounselingStatus` targeting a terminal or backward state | rejected/cancelled are terminal; `pending` is not a legal target; a freed slot re-booked by someone else must never be double-consumed by a resurrect | Whitelist at professor.actions.ts:212 includes "pending"; blind update commits any transition. Only if the slot was re-booked does the GiST constraint fire on re-entering the active predicate — reported as the generic "요청을 처리하지 못했습니다..." (:236-238) | Legal transition matrix: approved⇐pending, rejected⇐pending, cancelled⇐pending|approved; `pending` removed from the target whitelist (no UI ever sends it — professor-workspace.tsx:1503-1552, :386-391). 23P01 on a legal transition maps to a controlled conflict |
| M6 | Cancel + competing booking on the same slot | professor cancel (approved→cancelled) ∥ student `createCounselingRequest` | Final capacity valid: booking succeeds only if the cancel committed first; never both active | SAFE by construction today: both are single statements; the GiST predicate serializes them (insert while row still approved → 23P01; after cancel commits → row leaves the predicate, insert succeeds). No incorrect intermediate state exists to observe | Regression-test the interleavings deterministically; conflict mapping (M1) fixes the loser's message. No structural change needed |
| M7 | Partial failure: reservation write commits, side effect fails (notification insert, revalidate) | booking or status change + crash/failure after the row write | The reservation state itself is atomic (row fully exists or not); side-effect failure is reported honestly, never as a rolled-back booking | Single-statement INSERT/UPDATE is atomic; notification is a separate best-effort round trip whose failure returns ok:true with the honest degraded message (counseling.actions.ts:81-83, professor.actions.ts:255-257). A crash between write and notification loses the notification silently (no outbox) | Documented transaction boundary (DESIGN §4): the invariant-bearing write is one statement; notifications stay best-effort outside it. Outbox/RPC-fused notification explicitly deferred (DESIGN §13). Characterization tests pin the degraded-path honesty |
| M8 | Reserve-suggested double consume (two clicks on 추천 시간으로 바로 예약; or suggestion consumed after availability changed) | 2× `reserveSuggestedCounseling` on one rejected request | At most one active booking for the suggested range; duplicate attempt acknowledged | Delegates to `createCounselingRequest` (counseling.actions.ts:118) → same blind revalidation; "already reserved" suppression is client-state only (counseling-workspace.tsx:190-194,560); server-side re-click fails at the DB with the generic message | Inherits M1–M3 protections through the delegate (authoritative busy feed + conflict mapping + idempotent self-match). No separate mechanism |
| M9 | Student cancels own request vs professor approves it | new student cancel ∥ `updateCounselingStatus`(approved) | Exactly one consistent outcome: cancel-first → approve gets "already processed"; approve-first → cancel of an approved request still succeeds (legal) | Student cancel does not exist (KI-017; stale pending rows linger as 승인 대기 forever). No code path | New `cancelMyCounselingRequest`: CAS update `status='cancelled'` guarded by `.eq(student_id, caller)` + `.in(status, ['pending','approved'])`, service-role client with app-level ownership predicate (professor.actions.ts:220-222 pattern; RLS student-UPDATE policy deliberately NOT added — Stage 9). Minimal UI: cancel control on own active requests, Stage 4 inline-feedback pattern |
| M10 | Same student, N pending requests across different slots | N× `createCounselingRequest`, different slots | No invariant defined today (per-slot capacity is the only rule) | Unbounded — no constraint includes student_id (schema.sql:359-361 is (professor, start, end) only) | None in Stage 5 (product-policy question, not a concurrency defect). Documented in KNOWN_ISSUES for a later stage |

## Deterministic test strategy (summary — full detail in DESIGN §12 / plan)

Tests drive the REAL actions through the repo's transpile-loader convention
(counseling.query-count.test.mjs:24-35) with data:-URL stub modules and
`globalThis`-handoff fake clients; interleavings are controlled by
manually-resolved thenables (the deferred pattern at
counseling.query-count.test.mjs:47-53), never by wall-clock sleeps. Fake
builders apply `.eq/.in` filters against fixture rows so CAS predicates are
tested behaviorally, and constraint outcomes are simulated as PostgREST error
objects (code 23P01/23505). The live GiST constraint itself is verified once
against the real database (service-role overlapping-insert probe + cleanup)
because migration history is manually applied (KI-006) and the whole design
leans on that constraint existing.
