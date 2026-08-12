# Architectural Decisions

## D-009 — Counseling display cap is per professor

Status: Accepted (Stage 4, 2026-08-12)

Context: `buildAvailableCounselingSlots` applied `.slice(0, 48)` to the merged
chronological multi-professor list; the workspace then filtered per professor.
One professor's dense early availability could crowd another professor's real
slots out entirely — the student saw "no slots" for genuinely bookable time
(audit A-2, RED-tested).

Decision: the cap bounds each professor's list at 48 (earliest first). The
canonical per-date primitive `buildBookableSlotsForLocalDate` (D-004) is
untouched; slot membership per professor is unchanged; only merged list
length semantics changed. Characterization test updated deliberately
(96 = 48×2 for two dense professors); cross-consumer identity test unchanged
and green.

Consequences: displayed availability now matches the canonical per-professor
bookable set for every professor. Any future global bound must not reintroduce
cross-professor starvation.

## D-010 — No route-level Suspense seams (loading.tsx) on this app

Status: Accepted (Stage 4, 2026-08-12)

Context: Stage 4 added loading.tsx skeletons to 12 routes (KI-016 loading
backlog). Rendered QA on the production build found direct GETs of those
routes hydrate the route Suspense boundary into the skeleton fallback and
NEVER resolve — orphaned SSR DOM plus a completely dead page (zero
interactivity, zero console errors). This is byte-for-byte the KI-013
pathology Stage 3 fixed by deleting a page-level `dynamic()` seam.

Decision: reverted (commit 99bf213). The KI-013 lesson generalizes: on this
app's force-dynamic pages under Next 15.5, NO route-level Suspense boundary
of any kind — no loading.tsx, no page-level dynamic()/lazy. Client-side
lazy INSIDE an already-hydrated client component (the recharts pattern,
fca8ddc) remains safe.

Consequences: perceived-loading work stays in KI-016 with this evidence.
Candidate future mechanisms: a client navigation progress indicator (no
Suspense), or a Next upgrade explicitly re-validated against the KI-013
reproduction (8× direct-GET hydration check on /professor AND /counseling).

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

## D-007 — Request-scoped memoization only; no cross-request caching of scheduling data

Status: Accepted (Stage 3, 2026-08-12)

Context: every page paid duplicate identity/notification queries (AppShell
refetch on ~20 routes; 3× auth.getUser identity chains on /dashboard and
/professor), but availability data is correctness-critical and must never be
stale (Stage 2 invariants).

Decision: React `cache()` request-scoped memoization is the ONLY caching layer
introduced: `getDemoProfile`, `getNotificationsForProfile`,
`getUnreadNotificationCount`, and `resolveAuthenticatedProfile`
(src/services/request-identity.server.ts) — six services consume the shared
identity resolver, each keeping its own frozen error vocabulary. No
`unstable_cache`, no ISR/revalidate windows, no client query cache, and no
caching of any availability/booking read was added. The coarse
`revalidatePath` vocabulary is unchanged (harmless while nothing outlives a
request).

Reason: the memo dies with the response, so booking/cancellation freshness is
byte-identical to before; within one request it yields a single consistent
identity snapshot. Fixes the duplicate-fetch root cause instead of masking it.

Consequences: source-level guards (request-memoization.test.mjs,
request-identity.test.mjs) freeze the wiring; any future cross-request cache
must answer the stage-03 DESIGN.md §5.1 safety questionnaire and use precise
invalidation (tags), not path shotguns.

## D-008 — Stage 3 performance budgets and deterministic guards

Status: Accepted (Stage 3, 2026-08-12)

Context: wall-clock timings against live Supabase are too noisy to assert in
tests (spikes of 2–4× observed within one measurement session).

Decision: performance regressions are guarded deterministically — query-count
and batching tests via the repo's transpile-loader + counting fake client
(student-community.query-count.test.mjs, counseling.query-count.test.mjs), a
hydration-seam source guard (professor-page-hydration.test.mjs), and a
bundle-size script (scripts/check-bundle-budgets.mjs: shared ≤550 kB raw,
/professor ≤900 kB raw, any route ≤850 kB raw; run after a fresh build, not in
the src test glob). Wall-clock numbers are report-only in
stage-03/PERFORMANCE_AUDIT.md.

Reason: deterministic proxies catch the mechanisms that caused the measured
slowness (extra round trips, false await stages, eager heavy chunks) without
flaky CI.

Consequences: `npm run build && node scripts/check-bundle-budgets.mjs` is the
bundle gate; budgets must be revised deliberately in the same commit as an
intentional size change.
