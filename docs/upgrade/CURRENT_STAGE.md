# Current Project State

## Current Stage

Stage 8 / 10
Scale / Reliability / Observability
Status: COMPLETE on branch `upgrade/stage-8` (2026-08-13) — awaiting PR
review/merge. Base: `main` @ 9eeaf78 (Stage 7 PR #41 merged 2026-08-13).
See docs/upgrade/stage-08/HANDOFF.md.

Next stage: Stage 9 — NOT started. Stage 9 begins only after the Stage 8 PR
merges, from the HANDOFF "Stage 9 inputs" section.

## What Stage 8 delivered

Evidence-based scalability and operational reliability, with no new
infrastructure (D-022) and log-based observability (D-023).

Fixed: a cross-tenant notification write (`markAllNotificationsRead` updated
role-addressed rows in every university); two AI server actions that took
`studentId` from the caller with no authorization and no OpenAI timeout; the
unbounded, monotonically growing counseling busy feed; the absence of any
request timeout on all four Supabase clients; four missing indexes on named hot
queries.

Added: a zero-dependency load harness (`scripts/loadtest/`) that drives real
sessions and server actions and validates BUSINESS STATE, not HTTP 200; and a
structured logging foundation with a field allowlist, a conflict-vs-fault
taxonomy, correlation ids, and Next's `onRequestError`.

## Tested capacity (precise)

10 concurrent virtual users across six authenticated routes, 0% errors, p99
≤ 1377 ms, single local production instance against live Supabase; 20
concurrent booking mutations with all ten Stage 5 invariant checks intact.

NOT TESTED (implemented in the harness, blocked on the absence of a
non-production database): hundreds/thousands of concurrent users, stress,
breaking point, recovery, sustained soak, Vercel multi-instance behaviour.
Nothing beyond the tested numbers is claimed.

## Non-goals (this stage)

- Redis / queues / microservices / Kubernetes / APM vendor / new pooler
- Stage 9 RLS + privacy overhaul (anon-policy family, notification read
  scoping, professor report scoping)
- Stage 10 CI/CD
- UI/UX changes (Stage 4 preserved — no user-visible copy or layout changed)
- Rate limiting (deliberately deferred with reasoning — KI-021)

## Completion rule

Stage 8 work completes on the branch only; merging requires external review
and human approval. Never merge automatically. Never start Stage 9
automatically. Repository state is the source of truth.
