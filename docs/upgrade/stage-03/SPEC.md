# Stage 3 — Loading Performance / Critical Path Optimization — SPEC

Date started: 2026-08-12. Branch: `upgrade/stage-3` (from `main` @ cfa540f).

## Objective

Improve real user-perceived loading and interaction performance using measured
evidence, while preserving:

- Stage 1 frozen functionality and UI/UX,
- Stage 2 canonical availability semantics (D-004/D-005/D-006),
- booking/cancellation refresh correctness.

## Method (mandated order)

```text
Measure → identify bottleneck → rank by impact → add regression protection
→ optimize smallest high-impact bottleneck → measure again → verify correctness
```

No intuition-driven optimization. No UI redesign (Stage 4). No transaction
architecture (Stage 5). No new infrastructure (Redis/queues/CDN — Stage 8).

## Critical user journeys (from Stage 1 baseline + route map)

- Initial dashboard load (student)
- Timetable initial load (student /mypage 시간표)
- Counseling application initial load (/counseling)
- Timetable ↔ counseling navigation
- Date/week change (professor calendar; counseling month calendar)
- Counselor/resource change (교수별 검색 / 과목별 예약)
- Reservation submission + post-reservation refresh
- Cancellation followed by availability refresh
- Professor workspace load (/professor) — includes KI-013 flake

Desktop and mobile (375px) both in scope.

## Correctness invariants that must survive every optimization

Same scheduling context ⇒
Timetable semantic availability == Counseling semantic availability ==
Authoritative booking eligibility (slot IDENTITY, not counts) —
enforced by src/lib/availability-consistency.test.mjs and the counseling-slots
suites. Never trade fresh scheduling correctness for faster stale UI.

## Deliverables

- PERFORMANCE_AUDIT.md — measurements, waterfalls, bottleneck ranking, budgets
- DESIGN.md — optimization design incl. cache/invalidation safety analysis
- IMPLEMENTATION_PLAN.md — ranked tasks with per-task measure/verify loop
- Implemented high-impact optimizations with before/after evidence
- Regression protection (deterministic proxies preferred over wall-clock)
- HANDOFF.md — full Stage 3 handoff
- PR from `upgrade/stage-3` (not self-merged)

## Exit gate

The 28-item Stage 3 exit gate in the stage prompt; anything unverified is
marked UNVERIFIED.
