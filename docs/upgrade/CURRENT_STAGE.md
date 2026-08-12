# Current Project State

## Current Stage

Stage 8 / 10
Scale / Reliability / Observability
Status: IN PROGRESS on branch `upgrade/stage-8` (started 2026-08-13).
Base: `main` @ 9eeaf78 (Stage 7 PR #41 merged 2026-08-13).
Stage docs: docs/upgrade/stage-08/ (SCALE_AUDIT, LOAD_TEST_PLAN,
OBSERVABILITY_DESIGN, IMPLEMENTATION_PLAN, HANDOFF).

## Primary Objective

Prepare the platform for production-scale usage across multiple universities
— evidence-based scalability and operational reliability, NOT pretend
millions-of-users claims. Target: multiple universities, tens of thousands of
REGISTERED users, with realistic CONCURRENT timetable/counseling/booking/
admin/SSO traffic. Themes: load testing, capacity analysis, database
scalability, connection management, caching, rate limiting, reliability,
observability (logs/metrics/tracing), failure behavior.

Discovery before infrastructure: no Redis/Kafka/queues/microservices/APM
unless measurements justify them. Correctness > throughput — Stage 5
transaction guarantees and Stage 6 tenant isolation must not be weakened by
any scalability change. Distinguish REGISTERED USERS / CONCURRENT USERS /
REQUESTS PER SECOND; never claim untested capacity.

## Stage 8 inputs (from previous stages)

- KI-016: unbounded queries + index candidates; supabase-js in shared shell;
  dashboard student_courses 5× reads.
- KI-018: notification outbox/reliable delivery; note-wipe race.
- KI-019: academic_terms / course_equivalencies cleanup (deferred here).
- KI-020: durable audit-event sink for the sso-audit seam; session
  revocation store; schools.status join in profile reads (Stage 9-shaped
  items stay Stage 9).

## Non-goals

- Stage 9 RLS/privacy overhaul (KI-007/011/014 anon-policy family)
- Stage 10 CI/CD
- UI/UX changes (Stage 4 preserved)
- New heavy infrastructure without measured justification

## Completion rule

Stage 8 work completes on the branch only; merging requires external review
and human approval. Never merge automatically. Never start Stage 9
automatically. Repository state is the source of truth.
