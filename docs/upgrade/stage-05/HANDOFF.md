# Stage 5 Handoff

## Status

COMPLETE — 2026-08-12. Discovery, design, Red→Green implementation,
regression, and rendered/live QA done on `upgrade/stage-5` (from `main` @
279f715, the Stage 4 merge, PR #38). Ready for PR review. Not merged (per
workflow). Stage 6 NOT started.

## Goal

Reservation transaction reliability: booking creation and cancellation stay
correct under concurrent usage, duplicated/retried requests, stale client
state, overlapping booking+cancellation, and partial failure. Core invariant:
a slot that is no longer legally bookable never becomes overbooked because
requests were processed concurrently; UI availability is never authoritative.

## Discovery (four read-only agents, reconciled)

Booking write path, cancellation/status path, DB invariants, and test-harness
seams — full evidence in DESIGN.md §1–2 and CONCURRENCY_TEST_MATRIX.md
(M1–M10). Headline findings: (1) the busy feed was RLS-truncated to the
caller's own rows, making displayed availability AND server revalidation
structurally blind cross-student; (2) 23P01/23505 conflicts were unmapped
(generic retry invitation); (3) no idempotency — a retry of a committed
booking reported failure; (4) status updates were blind UPDATE-by-id with
`pending` accepted as a target (terminal-row resurrection, last-writer-wins,
contradictory notifications, dishonest cancel copy); (5) no student cancel
(KI-017).

## What was implemented (Red → Green, one concern per commit)

- b0e4606 docs: discovery/design/matrix/plan.
- 9aacb0d booking concurrency honesty [D-011, D-013]: busy feed reads via the
  admin client (minimal columns) restoring displayed==canonical and making
  revalidation authoritative; 23P01/23505 → slot-conflict vocabulary +
  revalidatePath on conflict; duplicates of the caller's own committed
  booking acknowledged ok:true by normalized-slot-id self-match (both at
  revalidation and in the constraint branch). RED evidence: insert reached
  for an occupied slot (1≠0), slot list counted a taken slot (4≠3), 23P01 →
  generic message, duplicate/interleaved retry → failure. All flipped GREEN.
- 45d251c transition CAS [D-012]: legal matrix (approved/rejected⇐pending,
  cancelled⇐pending|approved; `pending` no longer a target) as a from-state
  predicate in the single UPDATE; PGRST116/23P01 → controlled "이미 처리된"
  conflict + revalidation; honest cancelled notification copy (KI-015). RED:
  cancelled→approved committed ok:true, double-approve both ok with 2
  notifications, reject overwrote approved, pending target accepted, cancel
  sent reject copy — captured via git stash on the pre-change code, 5/5.
- d485ac5 student cancel [D-014, KI-017]: cancelMyCounselingRequest — CAS
  (id + owning student + active status → cancelled) on the admin client,
  controlled refusals, best-effort professor notification, revalidatePath ×2;
  minimal confirm()-guarded UI button on own active requests + source guard.
  RED first (action absent), 5 behavior tests.
- 34befa0 stale-slot pre-insert rejection also revalidates (gap caught
  against DESIGN §7 during T8).

## Database changes

NONE — no schema change, no migration. The existing GiST exclusion constraint
`counseling_requests_no_active_overlap` remains the sole overbooking
authority; it was live-verified (T1 probe 2026-08-12: overlapping
service-role insert failed 23P01, both probe rows cleaned, 0 remaining).

## New/updated tests (+21; suite 201→222)

- src/services/counseling.actions.test.mjs (12): drives the REAL actions
  through the transpile-loader with dual session/admin fakes modeling RLS
  visibility; deterministic interleaving via manually-released insert
  thenables (no sleeps); covers M1/M2/M3/M9 + characterization + unknown-error
  path.
- src/services/professor.actions.counseling.test.mjs (7): filter-applying
  fake gives real PostgREST CAS semantics (PGRST116 on zero rows); M4/M5 +
  KI-015 copy + approve/reject characterizations.
- src/components/counseling/counseling-workspace-cancel.test.mjs (2): source
  guard for the cancel control wiring.
- counseling.query-count.test.mjs loader updated DELIBERATELY (admin stub,
  same counting fake; inventory unchanged: counseling_requests 2,
  professor_availability 1).

## Verification (2026-08-12, final build p0pcJmpW4nW0LjYEtKOgK)

- Full suite: 222 tests / 219 pass / 3 fail — the same pre-existing KI-002
  trio BY NAME (admin-notifications ×2, question-notice-workflow ×1).
  Baseline on the merge base was re-established first (201/198/3).
- Stage 2 invariant suites green inside the run (counseling-slots +
  characterization + availability-consistency + calendar-utils.week +
  counseling-request-security + both query-count guards).
- typecheck clean; lint: same single pre-existing no-img-element warning.
- npm run build PASS ×2; bundle budgets all met; shared chunk 102 kB
  unchanged (no new dependencies).
- Rendered/live QA (production build, live Supabase, demo student):
  1. Stale-submit race staged live: slot selected in the browser →
     service-role booked the SAME slot as another student → submit → the
     controlled "선택한 상담 시간을 예약할 수 없습니다" alert rendered AND the
     slot list healed in the same round trip (8/17 2개→1개, 09:30 slot gone,
     no manual reload) — D-011 + conflict revalidation live.
  2. Success path: booked 15:00 slot → "상담 신청을 보냈습니다. (ffa37337)",
     in-place refresh (2건, selection cleared) — Stage 4 flow preserved.
  3. Student cancel: new button → confirm → "상담 신청을 취소했습니다",
     status 취소됨, cancel button gone from the terminal row, freed slot
     returned to the calendar in the same round trip (1개 restored).
  4. Professor notifications for booking AND cancellation confirmed in
     user_notifications (honest cancel title).
  5. Cleanup via service role: race row + QA booking + 2 QA notifications
     deleted; restored state re-rendered (8/17 2개, 1건); zero console
     errors across the whole session.
- UNVERIFIED: screenshots (Browser pane not displayed — all rendered
  evidence is DOM text/tree measurements, as in Stage 4); professor-side
  conflict toast at runtime (CAS behavior unit-tested 7/7; the workspace
  runner is unchanged Stage 4 code); a true wire-level simultaneous
  double-submit (deterministically covered by the interleaving test + the
  live 23P01 probe).

## Decisions

D-011 (busy-feed authority + constraint as sole enforcer), D-012 (transition
CAS matrix), D-013 (post-conflict idempotency, no key store), D-014 (student
cancel semantics) — in DECISIONS.md.

## Known-issues reconciliation

KI-017 student-cancel item RESOLVED; KI-015 cancel-copy item RESOLVED (the
unconditional professor_note/suggested_* nulling remains, now in KI-018);
KI-014 updated (from-state hole closed, ownership hole remains Stage 9, +
cancel action on the Stage 9 policy list); KI-018 NEW (M10 unbounded
per-student pending, R6 suggested-time write-side validation, notification
outbox, note-wipe race, service-role-key ops note).

## Relevant commits (main..upgrade/stage-5)

b0e4606 docs · 9aacb0d booking honesty · 45d251c transition CAS ·
d485ac5 student cancel · 34befa0 stale-rejection revalidate · (+ final docs
commit). Also .claude/launch.json (QA preview config used for rendered
verification).

## Exact next action

1. Push `upgrade/stage-5`; open PR to `main`; external review; fix findings
   on the branch; human-approved merge (do NOT self-merge).
2. Stage 6 (multi-tenancy) starts only after merge, from CURRENT_STAGE.md +
   this handoff.

## Stage 6 inputs

- Tenancy note (DESIGN §13): the overbooking constraint keys on
  professor_id, globally unique under any tenant dimension — the GiST
  constraint needs NO tenant column; tenant work touches RLS/scoping, not
  this constraint.
- The Stage 9 RLS overhaul list grew: student self-cancel policy,
  updateCounselingStatus/Details ownership, anon UPDATE residue.
- KI-018 carries the deliberately deferred concurrency items with evidence.

## Exit gate checklist

- [x] Stage 4 merged and correct base verified (279f715; baseline 201/198/3)
- [x] upgrade/stage-5 used / [x] reservation lifecycle mapped
- [x] cancellation lifecycle mapped / [x] race windows analyzed (R1–R6)
- [x] database constraints analyzed (+ live 23P01 probe)
- [x] transaction boundary documented (DESIGN §4)
- [x] stale-client booking behavior verified (unit + live race)
- [x] duplicate-request behavior verified (unit incl. interleaving)
- [x] capacity semantics preserved (D-005; structurally 1; no numeric model)
- [x] concurrent booking tests exist / [x] confirmed races fixed Red → Green
- [x] overbooking prevented at authoritative layer (constraint live-verified;
      revalidation authoritative)
- [x] partial-write risk addressed (single-statement writes; side-effect gap
      documented + honestly messaged; outbox deferred KI-018)
- [x] idempotency implemented (D-013) — narrow, no key store
- [x] cancellation/status transitions verified (CAS matrix, 7/7 + live cancel)
- [x] post-mutation cache/state consistency verified (revalidate per branch
      unit-pinned + live same-round-trip healing; D-007 untouched)
- [x] Stage 2 availability regression tests pass (all suites green)
- [x] Stage 3 performance behavior preserved (budgets met, 102 kB shared
      unchanged, query inventory unchanged, no new deps)
- [x] Stage 4 critical UI flows still work (booking loop + workspace flows
      rendered; only authorized UI delta = cancel button + conflict messages)
- [x] typecheck/lint/tests/build recorded (above)
- [x] CURRENT_STAGE updated / [x] DECISIONS updated (D-011..D-014)
- [x] KNOWN_ISSUES updated (KI-014/015/017 reconciled; KI-018 new)
- [x] Stage 5 HANDOFF complete (this file)
- [x] branch pushed / [x] PR created — completed with the final docs commit
