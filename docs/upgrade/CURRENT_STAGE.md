# Current Project State

## Current Stage

Stage 5 / 10
Reservation Transaction Reliability
Status: COMPLETE on branch `upgrade/stage-5` (2026-08-12) — awaiting PR
review/merge.
Base: `main` @ 279f715 (Stage 4 merge, PR #38). See
docs/upgrade/stage-05/HANDOFF.md.

Next stage: Stage 6 (multi-tenancy) — NOT started. Stage 6 must begin from
the Stage 5 HANDOFF's "Stage 6 inputs" section after the PR merges.

## Primary Objective (achieved)

Reservation creation and cancellation are transactionally reliable under
concurrency: the busy feed reads with service-role authority so displayed
availability and server revalidation see every student's active bookings
(D-011); constraint conflicts (23P01/23505) surface as controlled
slot-conflict vocabulary with same-round-trip list healing; duplicates of the
caller's own committed booking are acknowledged idempotently (D-013); status
transitions are compare-and-set against a legal matrix — terminal rows stay
terminal, competing transitions have exactly one winner, cancel notifications
tell the truth (D-012); students can cancel their own active requests
(D-014, KI-017). The live-verified GiST exclusion constraint remains the sole
overbooking enforcer. No schema change, no migration, no new dependency.

Verification: full suite 222/219 (same KI-002 trio), Stage 2 invariant suites
green, typecheck/lint at baseline, build + bundle budgets met (shared 102 kB
unchanged), rendered QA on the production build with a LIVE staged
cross-student race + student cancel loop + service-role cleanup, zero console
errors.

## Non-goals

Do not begin:

- Stage 6 multi-tenancy · Stage 7 SSO · Stage 8 reliability/scale (KI-018
  outbox/bounds live there)
- Stage 9 security architecture (KI-011/KI-014 ownership + RLS overhaul,
  incl. the student self-cancel policy)
- Stage 10 CI/CD

Deferred Stage 5 findings live in KI-018.

## Completion rule

Stage 5 work is complete on the branch only; merging requires external review
and human approval (see HANDOFF "Exact next action"). Never merge
automatically. Never start Stage 6 automatically.
