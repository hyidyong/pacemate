# Master Plan — 10-Stage Upgrade Roadmap

## Stage 1 — Baseline / Contract Freeze / Correctness Investigation

* Inspect current architecture.
* Freeze existing functionality and UI/UX as baseline.
* Identify actual user roles.
* Measure current performance.
* Trace timetable and counseling availability data.
* Reproduce any slot-count or availability inconsistencies.
* Create regression tests using Red → Green methodology.
* Avoid major redesign or architecture changes.

## Stage 2 — Availability Domain / Single Source of Truth

* Establish one canonical availability model.
* Eliminate duplicated scheduling calculations.
* Normalize slot, reservation, cancellation, status, capacity, and time semantics.
* Make all consumers depend on the same domain rules.

## Stage 3 — Loading Performance / Critical Path Optimization

* Optimize API waterfalls.
* Optimize database queries.
* Remove duplicate requests.
* Improve caching and invalidation.
* Reduce unnecessary client rendering/hydration.
* Improve bundle delivery and route loading.
* Measure improvements against Stage 1 baseline.

## Stage 4 — Role-specific / Desktop / Mobile UIUX

* Audit UX by actual user role.
* Improve student flows.
* Improve counselor/professor flows.
* Improve administrator flows.
* Improve mobile-specific interaction.
* Improve desktop information architecture.
* Preserve functionality and validate regressions.

## Stage 5 — Reservation Transaction Reliability

* Prevent double booking.
* Handle concurrent requests.
* Handle stale slots.
* Make mutations idempotent where necessary.
* Stabilize reservation/cancellation transitions.
* Define transactional boundaries.

## Stage 6 — University Multi-Tenancy

* Treat each university as a tenant.
* Enforce tenant-level data isolation.
* Introduce tenant-aware authorization and configuration.
* Support university-specific branding/configuration where appropriate.
* Prevent cross-tenant leakage.

## Stage 7 — University SSO

* Support appropriate university SSO integration.
* Evaluate OIDC/SAML based on actual requirements.
* Map identity to tenant and role.
* Support provisioning/session/logout policies.
* Preserve existing authentication during migration where necessary.

## Stage 8 — Scale / Reliability / Observability

Target usage:

```text
tens of thousands of users or more
multiple universities
concurrent timetable and counseling access
```

Work includes:

* load testing
* database bottleneck analysis
* connection management
* caching
* queues where justified
* rate limiting
* structured logging
* metrics
* tracing
* alertability

## Stage 9 — Security / Privacy / Audit / Recovery

* authorization review
* tenant isolation testing
* privilege escalation review
* PII handling
* audit logs
* administrative action traceability
* backup/restore strategy
* recovery procedures

## Stage 10 — Production QA / CI/CD / Release Readiness

Establish:

```text
Unit
Integration
Contract
E2E
Visual regression
Performance
Load
Security
```

quality gates.

Also establish:

* CI/CD
* staging verification
* safe rollout strategy
* rollback strategy
* production runbook
* release checklist

Do not execute future stages before their turn.
