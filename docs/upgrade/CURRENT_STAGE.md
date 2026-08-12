# Current Project State

## Current Stage

Stage 3 / 10
Loading Performance / Critical Path Optimization
Status: COMPLETE on branch `upgrade/stage-3` (2026-08-12) — awaiting PR review/merge.
See docs/upgrade/stage-03/HANDOFF.md.

Next stage: Stage 4 (Role-specific / Desktop / Mobile UIUX) — NOT started.
Stage 4 must begin from the Stage 3 HANDOFF's "Stage 4 inputs" section after
the PR merges.

## Primary Objective (achieved)

Measured-evidence performance work: KI-013 fixed (professor workspace usable
8/8 direct GETs, was 0/4), /professor First Load JS −33% (339→225 kB),
request-scoped memoization (D-007) removed duplicate identity/notification
queries on ~20 routes and cut auth.getUser 3→1 on dashboard/professor, mypage
posts feed 12→3 queries, false await stages removed (counseling/courses/
aggregate) — all with Stage 2 availability invariants verified (36/36 suites +
rendered booking loop) and zero cross-request caching of scheduling data.
Deterministic guards added (query-count tests, hydration-seam guard, bundle
budget script — D-008).

## Non-goals

Do not begin:

- Stage 4 role/mobile/web UIUX redesign
- Stage 5 full reservation concurrency redesign
- Stage 6 multi-tenancy
- Stage 7 university SSO
- Stage 8 large-scale reliability infrastructure
- Stage 9 broad security architecture
- Stage 10 CI/CD production rollout work

Out-of-scope findings discovered during Stage 3 are recorded as KI-016 in
KNOWN_ISSUES.md instead of being fixed.

## Completion rule

Stage 3 work is complete on the branch only; merging requires external review
and human approval (see HANDOFF "Exact next action").
