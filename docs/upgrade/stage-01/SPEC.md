# Stage 1 — Baseline Audit / Contract Freeze / Correctness Investigation

## Objective

Understand the current system before structural optimization.

The project previously experienced inconsistencies involving timetable and counseling availability/remaining-slot information.

Do NOT assume that bug still exists after the recently completed bug fix.
Verify current behavior from scratch.

If the issue is already fixed:

* confirm that with evidence,
* identify the fix through Git/code inspection,
* verify regression protection,
* document it as historical/resolved behavior.

If related inconsistencies remain:

* reproduce them,
* identify the root cause,
* create a failing regression test,
* apply only the smallest safe fix.

## Historical bug to verify

There was previously a reported problem where:

```text
Timetable remaining/available slots
!=
Counseling application remaining/available slots
```

for what appeared to be the same scheduling context.

A bug-fix session has already been completed before this Stage 1 session.
DO NOT assume the bug still exists.

Possible historical causes to investigate only if supported by evidence:

```text
duplicated availability calculations
different APIs
different status filters
cancelled reservation handling
pending reservation handling
capacity semantics
stale cache
client state duplication
timezone conversion
UTC/local boundaries
date parsing
pagination
duplicate JOIN rows
COUNT semantics
reservation mutation race conditions
stale state after booking/cancellation
```

These are hypotheses, not conclusions.

## Red → Green rule

For ANY currently reproducible correctness bug:

1. Reproduce the issue.
2. Identify the actual cause.
3. Create the smallest automated regression test.
4. Run the test BEFORE changing the relevant production behavior.
5. Confirm it FAILS for the expected reason.
6. Make the smallest correct production change.
7. Run the same test again.
8. Confirm it PASSES.
9. Run relevant regression tests.

A Red test that fails due to syntax error, bad selector, broken fixture, test setup, network setup, or typing mistake does NOT count.

If a historical issue is already fixed, do not force Red-Green retroactively by intentionally breaking code. Instead: inspect the fix, verify current behavior, add or confirm regression coverage, document evidence.

## Do not patch display counts

Never solve availability inconsistency by manually adjusting displayed numbers (e.g. `displayCount = sourceCount - 1`). Correctness must come from domain/data semantics.

## Deliverables

```text
docs/upgrade/stage-01/SYSTEM_BASELINE.md
docs/upgrade/stage-01/USER_ROLE_ROUTE_MATRIX.md
docs/upgrade/stage-01/PERFORMANCE_BASELINE.md
docs/upgrade/stage-01/SLOT_DATAFLOW.md
docs/upgrade/stage-01/SLOT_BUG_REPRODUCTION.md
docs/upgrade/stage-01/HANDOFF.md
```

## Exit gate

```text
[ ] Git/base state verified
[ ] architecture mapped
[ ] actual user roles identified
[ ] critical routes mapped
[ ] timetable data flow mapped
[ ] counseling data flow mapped
[ ] desktop baseline inspected
[ ] mobile baseline inspected
[ ] performance baseline recorded
[ ] historical slot mismatch investigated
[ ] current mismatch reproduced OR verified as no longer reproducible
[ ] root cause documented if a current bug exists
[ ] regression protection exists where appropriate
[ ] any new bug fix followed Red → Green
[ ] relevant tests executed
[ ] typecheck/lint/build status recorded where applicable
[ ] no unintended UI/UX regression introduced
[ ] HANDOFF updated
[ ] CURRENT_STAGE updated
[ ] remaining risks documented
```

Anything not actually verified must be explicitly marked `UNVERIFIED`.

## Do not start Stage 2

Document findings that suggest Stage 2 work (canonical availability service, domain redesign, etc.) but do NOT implement them unless a tiny change is strictly required to fix a currently reproduced Stage 1 correctness defect.
