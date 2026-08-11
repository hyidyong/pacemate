# Current Project State

## Current Stage

Stage 3 / 10
Loading Performance / Critical Path Optimization
Status: IN PROGRESS

Branch: `upgrade/stage-3` (from `main` @ cfa540f, the Stage 2 merge — PR #36).
Stage docs: docs/upgrade/stage-03/.

## Primary Objective

Improve real user-perceived loading and interaction performance using measured
evidence while preserving Stage 1 behavior and Stage 2 availability correctness.

## Non-goals

Do not begin:

- Stage 4 role/mobile/web UIUX redesign
- Stage 5 full reservation concurrency redesign
- Stage 6 multi-tenancy
- Stage 7 university SSO
- Stage 8 large-scale reliability infrastructure
- Stage 9 broad security architecture
- Stage 10 CI/CD production rollout work

Stage 3 is performance optimization, not product redesign.

## Stage 3 inputs (from Stage 2 handoff)

- Stage 1 PERFORMANCE_BASELINE.md targets: query waterfalls, force-dynamic
  everywhere, no loading states, AppShell profile refetch.
- KI-013 (professor workspace lazy-load hydration flake) — intersects Stage 3
  bundle/loading work.
- Professor page's extra `getCalendarRequests` query — fold into query
  consolidation.
