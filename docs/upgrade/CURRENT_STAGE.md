# Current Project State

## Current Stage

Stage 4 / 10
Role-specific / Desktop / Mobile UIUX Enhancement
Status: IN PROGRESS on branch `upgrade/stage-4` (started 2026-08-12).
Base: `main` @ d8e9ae4 (Stage 3 merged via PR #37).
See docs/upgrade/stage-04/HANDOFF.md.

## Primary Objective

Make the existing application feel like a polished, professional service for
the real roles (student / professor / assistant / admin) on desktop AND mobile
— information architecture, interaction clarity, responsive behavior,
accessibility, consistency — while preserving verified functionality, Stage 2
availability semantics, and Stage 3 performance. Every UI/UX change must solve
an identified usability problem; no redesign for aesthetics.

## Workflow for this stage

1. UX audit of rendered app (desktop + mobile, all real roles) → stage-04/UX_AUDIT.md
2. Design decisions → stage-04/DESIGN.md
3. Prioritized task breakdown → stage-04/IMPLEMENTATION_PLAN.md
4. Implementation (blockers → navigation → timetable/counseling → mobile →
   forms/states → consistency/a11y → polish)
5. Verification: tests + typecheck + lint + build + bundle budgets + rendered QA
6. Handoff, PR. STOP — no self-merge, no Stage 5.

## Non-goals

- Stage 5 reservation concurrency/transaction redesign
- Stage 6 multi-tenancy
- Stage 7 university SSO
- Stage 8 reliability/scale infrastructure
- Stage 9 broad security architecture
- Stage 10 CI/CD
- Visual redesign without an identified usability problem
- New design systems / heavy UI dependencies

## Key inputs

- Stage 3 HANDOFF "Stage 4 inputs": KI-016 (loading states, shell weight,
  rerender hotspots, nested mains, dashboard student_courses reads),
  KI-009 (touch targets), KI-004 (counseling UX edges), KI-015 (paper cuts).
- Stage 1 USER_ROLE_ROUTE_MATRIX.md (roles, routes, mobile nav gaps).
- Stage 2 invariants: availability semantics must remain identical
  (36-test suite + availability-consistency identity test).
- Stage 3 guards: query-count tests, hydration-seam guard, bundle budgets.
