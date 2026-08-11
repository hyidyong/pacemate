# Stage 2 — Implementation Plan

Base: `upgrade/stage-2` from `main` @ d922b34. Suite baseline verified on this branch:
`node --test "src/**/*.test.mjs"` → 150 tests / 147 pass / 3 fail (the pre-existing KI-002
trio: admin-notifications ×2, question-notice-workflow ×1 — notifications/AI-tutor domain,
confirmed unrelated to availability). Every task below must keep 147+new passing and
exactly those 3 failing.

Test conventions (from the coverage sweep):

- Direct type-stripped import with explicit extension: `import { x } from "./mod.ts"`
  (relative path — the `@/` alias does not resolve from `.mjs` tests; tests sit beside the
  module).
- No Supabase mocking exists anywhere; the sanctioned pattern is pure-function extraction
  (I/O in service, logic in lib). Do not invent a mock harness.
- Command (quotes load-bearing on Windows): `node --test "src/**/*.test.mjs"`.

## Task 0 — Commit docs scaffold

Files: docs/upgrade/stage-02/{SPEC,DESIGN,IMPLEMENTATION_PLAN,HANDOFF}.md,
docs/upgrade/CURRENT_STAGE.md.
Commit: `docs: initialize stage 2 spec/design/plan`.

## Task 1 — Characterization tests for engine A (must pass unchanged)

File: `src/lib/counseling-slots.characterization.test.mjs` (new; existing test file
untouched).
Cases (all against current behavior; expected result: PASS with zero production changes):

1. Horizon: slot exists on now+1 and now+14; none on now+0 (today) or now+15.
2. Weekend exclusion: `dayOfWeek: 0` and `6` rows yield nothing; a `specificDate` falling
   on Saturday yields nothing.
3. `specificDate` row fires only on that date and ignores `dayOfWeek`.
4. De-conflated subtractions — four independent tests (teaching-only / admin-recurring-only /
   inactive-row-only / busy-request-only), each asserting the exact surviving slot set, and
   that recurring rules also bind the following week while a date-bound busy request does not.
5. `__BLACKOUT__YYYY-MM-DD` admin task: suppresses only that date; its `day_of_week` is
   ignored when the title carries a date; malformed titles (`__BLACKOUT__x`, `정기 회의`)
   fall back to recurring day matching.
6. Dedupe by count: duplicated availability row still yields exactly N slots.
7. Multi-professor isolation: professor A's teaching/admin/busy/blackout rows never remove
   professor B's slots.
8. Cap 48 + sort order (chronological, tie-break professorId).
9. `slotMinutes: 60` granularity (2-hour window → 2 slots; 90-min window → 1).
10. `getCounselingLocalDateKey`: instant on a different calendar day in UTC vs KST.

Verification: `node --test "src/lib/counseling-slots.characterization.test.mjs"` all pass;
full suite 3 known failures only.
Commit: `test: characterize canonical availability engine semantics`.

## Task 2 — Slot-id normalization (V6) — RED → GREEN

RED test (same new file or `counseling-slots.test.mjs` extension):
`getCounselingSlotId` must produce equal ids for `2026-07-14T02:00:00+00:00` and
`2026-07-14T02:00:00.000Z` (same instant, PostgREST vs toISOString forms). Expected RED
reason: current impl string-compares raw values. Plus characterization:
`resolveSelectedCounselingSlot` returns null for a valid id on a mismatched date.
GREEN: normalize start/end through `new Date(v).toISOString()` inside `getCounselingSlotId`
(fall back to the raw string when unparseable). This repairs `reserveSuggestedCounseling`'s
id reconstruction (counseling.actions.ts:109-116) with no caller changes.
Commit: `fix: normalize counseling slot ids across timestamp serializations`.

## Task 3 — Extract the per-date canonical primitive (pure refactor)

File: `src/lib/counseling-slots.ts`.
Export `buildBookableSlotsForLocalDate(date, input)` embodying the per-date computation the
loop already performs; `buildAvailableCounselingSlots` becomes horizon-iteration + dedupe +
sort + cap over it. Export the time helpers the consumers need
(`dateKeyToLocalDate`, `formatLocalDate`→date-key helpers, `localDateTimeToInstant`,
`instantToLocalParts`, `timeToMinutes`, `minutesToTime`, `parseAdminBlackoutDate`,
`STUDENT_BOOKING_END_HOUR`, `timeRangeEndsByStudentCutoff` moved in from
scheduling-policy).
Expected: NO test changes; Task 1 suite is the safety net (this is refactor, not RED/GREEN).
Commit: `refactor: extract per-date canonical availability primitive and time helpers`.

## Task 4 — Professor week adapter — RED → GREEN

File: `src/lib/calendar-utils.ts` (+ new `src/lib/calendar-utils.week.test.mjs` or extend
existing test file).
Step 1: implement `buildProfessorWeekAvailability(weekDateKeys, input)` as a port of the
LEGACY semantics (every free chunk classified bookable) — this is where the code stands
today, relocated behind the final signature.
Step 2 (RED): contract tests asserting canonical semantics:
- zero declared availability rows → zero `bookable` chunks; free time classifies as `free`
  (the 0-vs-85 defect becomes a failing assertion);
- declared active window → exactly its covered, unblocked chunks are `bookable`, and
  `bookableSlots` equals the canonical primitive's output for those dates;
- inactive row → `blocked` for every covered chunk (port of Stage 1 test);
- pending and approved requests both suppress chunks; busy time uses `requested_*` only
  (fixture sets a divergent `suggested_*` to pin V5);
- KST correctness: assertions are explicit UTC instants for KST wall times (TZ-independent).
Expected RED reason: legacy port classifies undeclared free time as bookable.
Step 3 (GREEN): implement on `buildBookableSlotsForLocalDate`; chunk classification derived
from canonical slots + declared rows + busy occupancy. Keep the `id` field resolution
(availability-row id / covering blackout id) for the toggle flow.
`calculateRecommendedAvailability` and its 2 tests remain untouched in this task (deleted in
Task 6 after the consumer migrates).
Commit: `feat: add canonical professor week availability adapter (red->green)`.

## Task 5 — Data adapter alignment (V3, V4)

File: `src/services/professor.service.ts` (+ type).
- `getAvailability` selects `specific_date`; `ProfessorAvailability` gains
  `specific_date: string | null`.
- New `getProfessorCalendarBusyRequests(professorId)`: pending+approved, no `limit(12)`,
  columns needed by the calendar; added to `ProfessorPageData` as `calendarRequests`
  (management-list query untouched).
Consumers: professor page → workspace → calendar prop threading.
Tests: none feasible at this layer without inventing mocks (convention); protected by
typecheck + Task 6 adapter tests + rendered QA.
Commit: `fix: feed professor calendar complete busy/specific-date availability data`.

## Task 6 — Migrate professor-calendar.tsx to the canonical adapter

Files: `src/components/professor/professor-calendar.tsx`,
`src/components/professor/professor-workspace.tsx` (prop), delete
`calculateRecommendedAvailability` + `src/lib/calendar-utils.test.mjs` legacy pair once the
new suite fully covers both Stage 1 semantics (pending-blocks, inactive-hour) — verified by
explicit equivalents in the Task 4 suite.
- Week dates derived from KST today (`getCounselingLocalDateKey(new Date())` →
  `dateKeyToLocalDate` → Monday of week) — pure date-key arithmetic, no local `Date` math.
- Blackout-date matching and approved-block times via `instantToLocalParts` (KST).
- Three-state rendering: `bookable` keeps title "상담 가능"/details unchanged; `free`
  becomes "상담 미개방" with neutral tint (gray family) and honest details; `blocked`
  unchanged ("상담 불가"). Geometry, dialogs, click behavior unchanged.
Verification: full suite; typecheck; rendered QA later.
Commit: `refactor: professor calendar consumes canonical availability domain`.

## Task 7 — Policy consolidation + remaining consumers

Files: `src/services/professor.actions.ts`, `src/components/professor/professor-workspace.tsx`
(suggested-time parse), `src/components/dashboard/today-timetable-widget.tsx`,
delete `src/lib/scheduling-policy.ts`; narrow phantom status unions
(`professor.service.ts:64`, label maps, dashboard dead `"scheduled"`).
- New domain helpers with tests first: weekday-of-date-key (replaces `isWeekday(new Date(...))`),
  `kstWallClockToInstant("YYYY-MM-DD HH:MM")` for the suggested-time input (V7),
  KST weekday index helper for the widget (V8).
- `professor.actions.ts` imports move to the domain module; dynamic import at :481 becomes
  static.
Verification: helper tests (explicit-instant assertions, TZ-independent); full suite;
typecheck.
Commit: `refactor: consolidate scheduling policy into availability domain (KST helpers)`.

## Task 8 — Cross-consumer semantic regression test

File: `src/lib/availability-consistency.test.mjs`.
One synthetic dataset (active/inactive/specific-date windows across 2 professors, teaching,
recurring admin + dated blackout, requests in all 4 statuses incl. divergent suggested_*).
Assertions per DESIGN §10: slot-id set equality between
`buildAvailableCounselingSlots` and `buildProfessorWeekAvailability().bookableSlots` for
in-horizon dates; chunk classification consistency (no `bookable` chunk outside slot cover,
none `free`/`blocked` inside); identity comparison, never count-only.
Commit: `test: add cross-consumer availability semantic regression coverage`.

## Task 9 — Validation, rendered QA, docs, PR

- `node --test "src/**/*.test.mjs"`, `npm run typecheck`, `npm run lint`, `npm run build` —
  record exact results.
- Rendered QA (dev server): desktop + 375px — /counseling (student), /professor calendar
  (김재두 zero-availability case must show 0 "상담 가능" and the new "상담 미개방" state;
  박성은 declared windows must show matching "상담 가능"), booking flow, cancellation,
  no console errors, no layout change beyond the authorized label/tint delta.
- Update DECISIONS.md (D-004 domain boundary, D-005 status semantics, D-006 time
  normalization), KNOWN_ISSUES.md (KI-001 close-out; new out-of-scope findings), HANDOFF.md,
  CURRENT_STAGE.md.
- Push branch, prepare PR body. Do NOT merge.
