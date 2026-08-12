# Stage 5 Implementation Plan

Status: COMPLETE (2026-08-12). All tasks executed in order; T1 probe PASSED
(23P01 live), T2–T7 shipped Red → Green (commits 9aacb0d, 45d251c, d485ac5,
34befa0), T8/T9 evidence recorded in HANDOFF.md. Matrix rows (M1–M10) and
design sections (§) referenced throughout. One concern per commit.

## T1 — Verify the live GiST constraint (evidence gate)

The entire design leans on `counseling_requests_no_active_overlap` existing
in the LIVE database, but migrations are applied by hand (KI-006). Probe via
service role: two overlapping inserts (existing professor id, far-future
range, QA-marked topic) → expect the second to fail with SQLSTATE 23P01 →
delete both rows. Record the exact error. If 23P01 does NOT occur: STOP,
document the conflict in KNOWN_ISSUES/HANDOFF, and hand the constraint
migration to the owner before any dependent code ships.

## T2 — Action test harness + characterization (GREEN infra)

New src/services/counseling.actions.test.mjs driving the REAL
createCounselingRequest through the transpile-loader convention
(counseling.query-count.test.mjs:24-35): stub next/cache (records
revalidatePath calls), @/lib/supabase/server + @/lib/supabase/admin
(globalThis-handoff fakes), @/services/session.service (configurable
profile), @/services/notifications.create.service (recording stub);
@/lib/counseling-slots and @/lib/uuid resolve to real absolute file URLs;
@/services/counseling.service is loaded for real through its own rewrite
(high fidelity — the revalidation logic under test is the genuine engine).
Fake client: self-returning builder whose .eq/.in filters actually apply to
fixture rows and whose thenables can be manually deferred (deterministic
interleaving; no sleeps). Characterize the happy path green (booking
succeeds, notification recorded, revalidatePath ×2) before any RED test.

## T3 — RED→GREEN: authoritative busy feed (M1/M3, I2) [D-011]

RED (harness): a slot occupied by ANOTHER student (present in the
admin-truth fixtures, absent from the session-client fixtures — the RLS
blind spot modeled exactly) is accepted by createCounselingRequest: the
INSERT is attempted. Also RED: getCounselingPageData's slot list includes
the occupied slot.
GREEN: getBusyRequests reads via the service-role client (minimal columns,
professor.service.ts:288-290 precedent + comment), threaded from both entry
points (counseling.service.ts:43, :68). The booking is rejected pre-insert
with SLOT_NOT_AVAILABLE_MESSAGE; the page's slot list excludes the slot.
Deliberate test updates: counseling.query-count.test.mjs loader gains the
admin stub (same fake object; inventory counts unchanged:
counseling_requests 2, professor_availability 1).

## T4 — RED→GREEN: conflict mapping + revalidate-on-conflict (M1, I5) [part of D-011]

RED: fake INSERT returns {code:"23P01"} → action returns the generic
save-failed message and does NOT revalidate.
GREEN: 23P01/23505 map to SLOT_NOT_AVAILABLE_MESSAGE; conflict branches call
revalidatePath("/counseling") + ("/professor"); genuinely unknown errors
keep the generic message. counseling-request-security.test.mjs source
assertions (insert-then-select, structured console.error) must stay green —
extend deliberately if the shape moves.

## T5 — RED→GREEN: idempotent duplicate response (M2/M8, I6) [D-013]

RED (interleaving showpiece): two in-flight createCounselingRequest calls
for the same (student, slot); first insert resolves success, second resolves
23P01; today the second reports failure although the row committed.
GREEN: on 23P01/23505, service-role re-read of the active conflicting row;
own row + identical range → {ok:true, "이미 신청된 상담 시간입니다…"}; foreign
row → T4 conflict. Assert exactly one INSERT succeeded, both responses
honest, reserveSuggestedCounseling inherits via its delegate.

## T6 — RED→GREEN: legal transition matrix CAS (M4/M5, I3) + honest cancel copy (KI-015) [D-012]

New src/services/professor.actions.counseling.test.mjs (same harness
pattern; fake update builder applies .eq/.in against fixture rows).
RED: (a) cancelled row + target approved → blind update commits, ok:true;
(b) approve∥cancel both ok:true (last-writer-wins); (c) target "pending"
accepted; (d) cancel notification carries the "조정 필요" copy.
GREEN: conditional UPDATE with from-state predicate (approved⇐pending,
rejected⇐pending, cancelled⇐pending|approved); 0-row → "이미 처리된 상담
신청입니다…" + revalidatePath; "pending" removed from the target whitelist;
23P01 defense mapped to the same conflict; cancelled notification gets
honest title/body. Approve/reject UI flows byte-identical for the
non-conflict path.

## T7 — Student cancel action + minimal UI (M9, KI-017) [D-014]

Test-first in the T2 harness file (or sibling): cancelMyCounselingRequest —
student role gate, CAS (id + student_id + status IN pending,approved →
cancelled), service-role client with app ownership predicate (§5 rationale),
professor notification best-effort, revalidatePath ×2, vocabulary per §9.
RED first (function absent / behaviors unmet), then GREEN. UI: cancel
control on own active requests in the existing requests panel (confirm() +
runAction context "requests", Stage 4 pattern); guard with a source test
consistent with repo convention.

## T8 — Post-mutation consistency verification (charter §15)

Evidence that booking/cancel/status conflicts and successes leave server +
client state consistent: harness assertions on revalidatePath per branch
(T4–T7) + rendered QA in T9. Confirm D-007 still holds (no cross-request
cache was introduced; request-memoization guard stays green).

## T9 — Regression gate + rendered/live QA + docs/PR

- Full suite (expect KI-002 trio only), typecheck, lint, build,
  bundle budgets (D-008 gate).
- Stage 2 invariant suites explicitly (counseling-slots ×2,
  availability-consistency, calendar-utils.week, counseling-request-security,
  query-count pair).
- Rendered QA on the production build against live Supabase: booking loop,
  conflict path (double-book attempt), student cancel loop, professor
  approve/cancel conflict toast — service-role cleanup after, zero console
  errors expected.
- DECISIONS.md (D-011 busy-feed authority, D-012 transition CAS matrix,
  D-013 post-conflict idempotency, D-014 student cancel semantics),
  KNOWN_ISSUES reconciliation (KI-015 partial close, KI-017 cancel close,
  new M10/R6 entries), HANDOFF, CURRENT_STAGE, push, PR. STOP — no merge,
  no Stage 6.

Order rationale: T1 validates the load-bearing assumption before any code;
T2 before all RED tests; T3 before T4/T5 (same function, layered diffs);
T6/T7 independent of T3–T5 but share vocabulary; T8/T9 last.
