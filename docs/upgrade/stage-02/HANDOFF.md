# Stage 2 Handoff

## Status

COMPLETE — 2026-08-12. Implementation, tests, validation, and rendered QA done on
`upgrade/stage-2`; branch ready for PR review. Not merged (per workflow).

## Goal

One canonical availability domain; timetable, counseling, professor calendar, and the
authoritative booking path interpret scheduling availability through the same rules.

## Architecture before

- Engine A (canonical, tested, KST): `buildAvailableCounselingSlots`
  (src/lib/counseling-slots.ts) → student /counseling + booking re-validation.
- Engine B (duplicate): `calculateRecommendedAvailability` (src/lib/calendar-utils.ts)
  → professor calendar; hard-coded 09–18 grid labeled ALL free time "상담 가능"
  (0-vs-85 KI-001 defect), browser-local Date methods, busy = suggested??requested,
  fed by a limit(12)-ascending unfiltered query missing `specific_date`.
- Policy fragments: scheduling-policy.ts (4/7 exports dead, browser-local),
  STUDENT_BOOKING_END_HOUR ×3, timeToMinutes ×3, __BLACKOUT__ parser ×3.

## Architecture after

- Domain module `src/lib/counseling-slots.ts` (D-004): per-date primitive
  `buildBookableSlotsForLocalDate` + `buildAvailableCounselingSlots` (unchanged public
  shape: horizon +1..+14, weekday-only, ≤18:00, dedupe, sort, cap 48) + exported KST
  time helpers + `parseAdminBlackoutDate` + `timeRangeEndsByStudentCutoff` +
  `parsePacemateWallClock` + normalized `getCounselingSlotId`.
- Adapter `src/lib/calendar-utils.ts`: `buildProfessorWeekAvailability` → per week
  {bookableSlots (canonical), chunks (30-min grid, kind: bookable|blocked|free)}.
  Legacy engine + its test file deleted.
- professor-calendar.tsx renders the three states (bookable "상담 가능" unchanged;
  NEW free "상담 미개방" neutral tint + legend entry; blocked "상담 불가" unchanged);
  KST week derivation, KST blackout-date matching, approved blocks at requested_* KST.
- professor.service.ts: `getAvailability` selects `specific_date`; new
  `getCalendarRequests` (ALL pending+approved) feeds the calendar; management-list
  query untouched. Workspace threads `calendarRequests` with the same optimistic map.
- professor.actions.ts / professor-workspace / today-timetable-widget migrated onto
  domain helpers; scheduling-policy.ts deleted; phantom statuses removed (D-005).

## Canonical availability contract

See DESIGN.md §7. Slot identity = (professorId, start, end) with instants normalized
via toISOString (fixes the PostgREST `+00:00` vs `.000Z` id mismatch that made
`reserveSuggestedCounseling` unable to match live slots — verified live: PostgREST
returns `2026-08-17T01:00:00+00:00` form). available == bookable (no separate
visibility concept); capacity structurally 1 (GiST exclusion constraint); busy =
requested_* of pending+approved only (D-005); time = Asia/Seoul at the domain boundary
(D-006), half-open intervals everywhere.

## Consumers migrated

1. Booking authority (createCounselingRequest / reserveSuggestedCounseling) — same
   engine A output; hardened by slot-id normalization.
2. Professor calendar — canonical adapter (the Stage 2 headline).
3. Professor data adapters — specific_date + complete busy feed.
4. Availability-write validation (weekday/cutoff) — domain helpers, TZ-free.
5. Suggested-time input — parsed as KST wall clock.
6. today-timetable-widget — KST weekday.
7. Student timetable (course conflicts) — separate domain, already single-sourced in
   Stage 1 (student-timetable.rules.ts); not a counseling-availability consumer. Its
   time handling for "today" display was aligned via the widget; the my-page planner's
   local date keys are display-only (documented, Stage 4).
8. Student dashboard TODO — dead "scheduled" status removed (display-only consumer).

## Red → Green evidence (all on 2026-08-12)

- Slot-id normalization: RED — "slot ids match across timestamp serializations" failed
  with `+00:00`-form id ≠ `.000Z`-form id → GREEN after normalizing in
  getCounselingSlotId (commit 937abb0).
- Week adapter: contract tests written against a straight port of the legacy semantics
  → RED 4/7 for the intended reasons (undeclared free time claimed bookable — the
  0-vs-85 defect; no canonical linkage; suggested_* treated as busy; specific_date
  recurring) with 3/7 ported Stage 1 semantics green → GREEN 9/9 on the canonical
  implementation (commit cde6301).
- Primitive extraction and consumer migrations were pure refactors protected by the
  14-test characterization suite (f1fc7aa) — no RED expected, none occurred.

## Cross-consumer regression

src/lib/availability-consistency.test.mjs: one shared fixture (2 professors, asymmetric
weeks, all 4 statuses, divergent suggested_*, dated blackout with wrong day_of_week,
specific-date + 60-min windows, zero-declaration professor) mapped into both consumers'
input shapes; asserts slot-IDENTITY set equality and chunk-classification/slot-cover
consistency (never count-only). 3/3 pass.

## Tests executed (actual results, branch HEAD 0c6e25e)

- `node --test "src/**/*.test.mjs"`: 176 tests / 173 pass / 3 fail — the same
  pre-existing KI-002 trio (admin-notifications ×2, question-notice-workflow ×1) as the
  d922b34 baseline (150/147/3). +26 tests added by Stage 2.
- `npm run typecheck`: PASS (clean).
- `npm run lint`: PASS with the same 1 pre-existing warning (no-img-element,
  student-hero-carousel.tsx:67).
- `npm run build`: PASS (First Load JS shared 102 kB — unchanged).

## Rendered regression QA (2026-08-12, production build, live demo DB)

- Desktop professor (김재두, zero declared rows): 0 "상담 가능" / 82 "상담 미개방"
  visible chunks (was ~85 false 상담 가능) — KI-001 fix live; legend shows the new
  state; chunk click → 일정 설정 dialog with correct KST date; grid/geometry unchanged.
- Write path: 시간 추가 (Mon 10:00–11:00/30) → row listed "월 10:00-11:00 · 30분" →
  calendar shows exactly 2 "상담 가능" chunks.
- Desktop student: 김재두 calendar enables exactly Mondays 8/17+8/24 "2개" each; slots
  10:00/10:30 KST. Booked 8/17 10:00 → "상담 신청을 보냈습니다. (366fb2f5)", panel
  shows 승인 대기 at correct KST; after reload 8/17 drops to "1개", 8/24 stays "2개".
- Professor next-week view: Mon 8/17 10:00 chunk is a busy hole; 10:30 stays 상담 가능;
  pending badge 1건.
- Mobile 375px: counseling identical counts, dashboard widget "수요일" (KST), no
  horizontal overflow, no console errors anywhere.
- Cleanup: QA request 366fb2f5 and the QA availability row deleted via service role
  (204, 204); professor availability back to zero rows.
- Professor approve→cancel flow: code path unchanged (updateCounselingStatus) —
  UNVERIFIED at runtime this session (KI-013 hydration flake made the second
  professor-session round impractical); pending-request creation, busy-hole rendering,
  and inbox badge were verified live.

## Known risks / discovered issues

- KI-013 (pre-existing, reproduced on main): professor workspace lazy-load
  intermittently never leaves its fallback — flaky hydration; login-redirect loads
  reliably hydrated during QA. Stage 3 candidate.
- KI-014: missing ownership guards on availability writes and counseling status
  updates; anon UPDATE grant residue (Stage 9).
- KI-015: cancel-notification wording, suggested-end hard-coded +30min, dead component,
  inflated 상담 슬롯 stat, schema drift, untested supabase/migrations tests.
- During Stage 2 a dev-only regression (relative .ts-extension import broke webpack
  dev's client lazy-chunk graph) was introduced and FIXED on the branch (0c6e25e);
  adapter tests now load calendar-utils via the project's transpileModule convention.

## Decisions

D-004 (domain boundary), D-005 (status/capacity semantics), D-006 (time normalization)
— recorded in DECISIONS.md.

## Relevant commits (main..upgrade/stage-2)

93d4066 docs scaffold · f1fc7aa characterization · 937abb0 slot-id fix ·
5078c18 primitive extraction · cde6301 week adapter red→green · 3a3b44c data adapters ·
e23f9e1 calendar migration · 1bee585 policy consolidation · e9718fe cross-consumer
regression · 0c6e25e dev-hydration fix + test loader (+ final docs commit).

## Exact next action

1. Open a PR from `upgrade/stage-2` to `main`; external/Codex review; fix findings on
   the branch; human-approved merge (do NOT self-merge).
2. Stage 3 starts from CURRENT_STAGE.md after merge.

## Stage 3 inputs

- PERFORMANCE_BASELINE.md targets (query waterfalls, force-dynamic, no loading states).
- KI-013 (lazy-load hydration flake) — likely intersects Stage 3's bundle/loading work.
- The professor page now issues one extra query (getCalendarRequests) — fold into
  Stage 3 query consolidation.
- Duplicated per-page data fetching (AppShell profile refetch) unchanged.

## Exit gate checklist

- [x] Stage 1 context reconstructed (docs + 4-agent discovery sweep + baseline test run)
- [x] clean Stage 2 branch established (upgrade/stage-2 from main d922b34)
- [x] all availability consumers mapped (DESIGN.md §13 matrix)
- [x] reservation statuses documented (DESIGN.md §4, D-005)
- [x] capacity semantics documented (DESIGN.md §5 — structural 1, no numeric model)
- [x] time semantics documented (DESIGN.md §6, D-006)
- [x] canonical availability contract defined (DESIGN.md §7)
- [x] design alternatives evaluated (DESIGN.md §8 — A chosen, B/C rejected)
- [x] migration plan documented (IMPLEMENTATION_PLAN.md)
- [x] characterization tests protect existing valid behavior (14 tests, f1fc7aa)
- [x] canonical domain tests exist (engine + adapter + helper suites)
- [x] authoritative booking path uses canonical semantics (same engine; id fix 937abb0)
- [x] timetable consumer uses canonical semantics (KST widget; course-conflict domain
      documented as already single-sourced)
- [x] counseling consumer uses canonical semantics (unchanged engine A; workspace ids)
- [x] other relevant consumers migrated or explicitly documented (professor calendar,
      data adapters, actions validation, suggested-time input; my-page local date keys
      documented for Stage 4)
- [x] duplicate availability logic removed where safe (engine B, scheduling-policy.ts)
- [x] cross-consumer semantic regression test exists (identity-level)
- [x] targeted tests pass (all new suites green)
- [x] relevant broader regression tests pass (176/173/3 — pre-existing trio only)
- [x] typecheck/lint/build results recorded (above)
- [x] desktop regression QA performed (evidence above)
- [x] mobile regression QA performed (375px, evidence above)
- [x] no unintended UI/UX redesign (only the authorized KI-001 label/tint delta +
      legend entry; geometry/dialogs/interactions unchanged)
- [x] DECISIONS.md updated (D-004..D-006)
- [x] KNOWN_ISSUES.md updated (KI-001 resolved; KI-013..015 added)
- [x] HANDOFF.md complete (this file)
- [x] CURRENT_STAGE.md synchronized
- [x] branch ready for PR/review
- UNVERIFIED: professor approve→cancel runtime round-trip (code path unchanged; see QA
  section); 익명 주간 집계 view re-verification remains outstanding from Stage 1 (KI-006).
