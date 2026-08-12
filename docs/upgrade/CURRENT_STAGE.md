# Current Project State

## Current Stage

Stage 5 / 10
Reservation Transaction Reliability
Status: IN PROGRESS on branch `upgrade/stage-5` (started 2026-08-12).
Base: `main` @ 279f715 (Stage 4 merge, PR #38).

## Primary Objective

Make reservation creation and cancellation transactionally reliable under real
concurrent usage: concurrent bookings, duplicated/retried requests, stale
client slot state, overlapping booking+cancellation, and late responses must
never overbook a slot that is no longer legally bookable. UI availability is
never authoritative booking proof; the authoritative layer must enforce the
Stage 2 canonical semantics (D-004/D-005/D-006) atomically.

## Working documents

- docs/upgrade/stage-05/DESIGN.md
- docs/upgrade/stage-05/IMPLEMENTATION_PLAN.md
- docs/upgrade/stage-05/CONCURRENCY_TEST_MATRIX.md
- docs/upgrade/stage-05/HANDOFF.md

## Non-goals

Do not begin:

- Stage 6 multi-tenancy (tenants, tenant tables, school routing, SSO)
- Stage 7 SSO · Stage 8 reliability/scale
- Stage 9 security architecture (KI-011/KI-014 remain open)
- Stage 10 CI/CD

Stage 5 must preserve Stage 2 canonical availability semantics, Stage 3
performance budgets, and Stage 4 role/mobile/desktop UX. Minimal UI changes
only where needed to communicate transaction conflicts honestly.

## Completion rule

Stage 5 completes on the branch only; merging requires external review and
human approval. Never merge automatically. Never start Stage 6 automatically.
