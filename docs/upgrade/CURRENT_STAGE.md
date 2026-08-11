# Current Project State

## Current Stage

Stage 2 / 10
Availability Domain / Single Source of Truth
Status: COMPLETE on branch `upgrade/stage-2` (2026-08-12) — awaiting PR review/merge.
See docs/upgrade/stage-02/HANDOFF.md.

Next stage: Stage 3 (Loading Performance / Critical Path Optimization) — NOT started.
Stage 3 must begin from the Stage 2 HANDOFF's "Stage 3 inputs" section after the PR
merges.

## Primary Objective (achieved)

Canonical scheduling-availability semantics established in
`src/lib/counseling-slots.ts` (D-004); professor calendar, booking path, and related
consumers migrated; cross-consumer identity regression protection added; KI-001
resolved.

## Non-goals

Do not begin:

- Stage 3 broad performance optimization
- Stage 4 UI/UX redesign
- Stage 5 full concurrency/transaction architecture
- Stage 6 multi-tenancy
- Stage 7 SSO
- Stage 8 scaling infrastructure
- Stage 9 broad security redesign
- Stage 10 CI/CD redesign

Small changes required to safely implement Stage 2 were allowed; out-of-scope findings
are recorded in KNOWN_ISSUES.md (KI-013..KI-015) instead of being fixed.

## Completion rule

Stage 2 work is complete on the branch only; merging requires external review and
human approval (see HANDOFF "Exact next action").
