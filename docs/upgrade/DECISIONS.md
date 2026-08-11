# Architectural Decisions

## D-001 — Repository as persistent project memory

Status: Accepted

Future Claude sessions must reconstruct project state from:

- Git
- source code
- tests
- `CLAUDE.md`
- `docs/upgrade/*`

Conversational memory is not authoritative.

## D-002 — Incremental upgrade

Status: Accepted

The existing system will be improved incrementally.
Existing functionality and UI/UX must remain intact unless a stage explicitly authorizes change or a confirmed bug requires it.

## D-003 — Evidence-based completion

Status: Accepted

No bug fix, performance improvement, or QA claim may be considered complete without current verification evidence.

## D-004 — Canonical availability domain boundary

Status: Accepted (Stage 2, 2026-08-12)

Context: two independent availability engines (student `buildAvailableCounselingSlots`
vs professor-calendar `calculateRecommendedAvailability`) produced the reproduced
0-vs-85 mismatch (KI-001).

Decision: `src/lib/counseling-slots.ts` is the single availability domain module. Its
per-date primitive `buildBookableSlotsForLocalDate` is the only source of the claim
"students can book this time". `src/lib/calendar-utils.ts` is a thin adapter
(`buildProfessorWeekAvailability`) that classifies the professor 09–18 week grid into
`bookable` (derived exclusively from the primitive) / `blocked` (inactive rows) /
`free` (undeclared — NOT student-bookable). The legacy engine was deleted.

Reason: smallest architecture giving a real single source of truth; preserves public
signatures and UI interactions; pure/isomorphic module suits Stage 5 (concurrency) and
Stage 6 (tenancy) later.

Consequences: cross-consumer identity regression test
(src/lib/availability-consistency.test.mjs) enforces slot-set equality; the professor
grid needed a third visual state (상담 미개방) — the authorized KI-001 correctness delta.

## D-005 — Reservation statuses that consume availability

Status: Accepted (Stage 2, 2026-08-12)

The DB enum `counseling_status` has exactly `pending | approved | rejected | cancelled`.
`pending` and `approved` consume a slot (busy filter + GiST exclusion constraint);
`rejected` and `cancelled` free it. Busy time is `requested_start/end` ONLY —
`suggested_start/end` is advisory (written only by the reject flow, not covered by any
constraint) and must never block availability. Capacity is structurally 1 per
(professor, time range); no numeric capacity model exists or was introduced. Phantom
status values (`answered`, `ANSWERED`, `PENDING` in types, `scheduled` in a dashboard
filter) were removed as dead vocabulary.

## D-006 — Time normalization boundary

Status: Accepted (Stage 2, 2026-08-12)

All scheduling semantics are Asia/Seoul (`PACEMATE_TIME_ZONE`). Wall-clock↔instant
conversion happens only in the domain module (Intl two-pass helpers; exported:
`getLocalDate`, `localDateTimeToInstant`, `instantToLocalParts`, `dateKeyToLocalDate`,
`parsePacemateWallClock`, weekday/date-key helpers). Consumers exchange ISO instants or
KST wall-clock parts from these helpers; browser/server-local `Date` component reads
were removed from scheduling paths (professor calendar, suggested-time input,
today-timetable widget, availability-write validation). `scheduling-policy.ts` was
deleted (4 of 7 exports dead; survivors moved into the domain). Intervals are half-open
`[start, end)` at every layer, matching the DB `tstzrange(...,'[)')` constraint.
