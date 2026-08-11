# Stage 1 Handoff

## Status

COMPLETE — 2026-08-11. Exit gate satisfied (see checklist at bottom).

## Post-handoff addendum (2026-08-12, re-verified at HEAD 91851cd)

Three QA commits landed on upgrade/stage-1 after this handoff was written; the baseline
below is unchanged except as noted here:

- 1b5a3f2 — login /onboarding redirect fixed at app level (KI-007); dashboard-card RLS
  failures worked around at app level; addCourseToSchedule now links offering_id (+ tests).
  This resolves the "Demo login for student lands on /onboarding" risk listed below.
- f2f490d — all 6 external i.ibb.co images vendored into public/images/ (KI-008 RESOLVED);
  owner applied the KI-006 recursion-fix migration via the Supabase SQL editor, verified via
  PostgREST (no more 42P17) and the professor 과목 진행 현황 report confirmed rendering live.
  Note: applied via SQL editor, not `supabase db push` — CLI migration history may need
  reconciling before the next push.
- 91851cd — pnpm-lock.yaml resynced with package.json (KI-010; unblocks Vercel deploy).

Fresh verification at HEAD 91851cd (2026-08-12):

- `node --test "src/**/*.test.mjs"`: 148 tests / 145 pass / 3 fail — the same 3 pre-existing
  KI-002 stale source-regex tests as the baseline run (admin-notifications ×2,
  question-notice-workflow ×1); no new failures. (+4 tests vs baseline, added by QA commits.)
- `npm run typecheck`: PASS (clean).
- `npm run lint`: PASS with the same 1 pre-existing warning (no-img-element,
  student-hero-carousel.tsx:67).
- `npm run build`: PASS (First Load JS shared 102 kB — unchanged).

## Work completed

1. Repository state verified; branch `upgrade/stage-1` created from `codex/mobile-student-timetable-fix` @ bbd3aa3.
2. `CLAUDE.md` + `docs/upgrade/` document structure created (MASTER_PLAN, CURRENT_STAGE, DECISIONS, KNOWN_ISSUES, stage-01/*).
3. Architecture, roles, routes, data flows discovered and documented (4 parallel read-only agents + lead verification of all load-bearing claims against source).
4. Historical slot-mismatch bug investigated end-to-end with live runtime reproduction (see below).
5. Two correctness defects fixed via Red → Green in `src/lib/calendar-utils.ts`; regression tests added.
6. Performance and UI baselines recorded (desktop + 375px mobile).

## Architecture discovered

See docs/upgrade/stage-01/SYSTEM_BASELINE.md. Summary: Next.js 15 App Router + React 19, all 23
pages force-dynamic RSC; server actions only (no API routes); Supabase (supabase-js query builder,
RLS + service-role tiers, @supabase/ssr session + signed demo cookie); no react-query — RSC props →
useState; one Zustand store; Node 24 `node:test` suite (colocated `src/**/*.test.mjs`); npm; Vercel;
no CI, no monitoring. Supabase project szztsqdnvenfbgxtylkl is LIVE (was previously paused).

## Important files

- Canonical availability engine: `src/lib/counseling-slots.ts` (+ `counseling.service.ts`)
- Duplicate engine (professor calendar): `src/lib/calendar-utils.ts` (+ `professor-calendar.tsx`)
- Timetable rules: `src/services/student-timetable.rules.ts`, `src/lib/student-timetable.ts`
- Registration action shared by /courses and mypage: `student-community.actions.ts` `addCourseToSchedule`
- Booking guard: `counseling.actions.ts:31-41` + DB GiST exclusion constraint (migration 20260713040000)

## Historical slot bug verdict

- Student-facing mismatch (timetable vs counseling): **NOT reproducible** — counseling page matches
  hand-computed canonical values exactly (박성은: Mon 2개 / Tue 5개, dedupe + conflicts + blackouts
  all correct; desktop == mobile). Timetable duplication was unified in 72beab8/40bd63e. Historical/resolved.
- Professor-side mismatch: **REPRODUCED** — professor 김재두 (zero availability rows): student side
  0 bookable slots vs professor calendar ~85 "상담 가능" chunks. Root cause: duplicate engine.
  Full matrix + root-cause breakdown (R1–R4): docs/upgrade/stage-01/SLOT_BUG_REPRODUCTION.md.

## Red → Green evidence (2026-08-11)

- RED: created `src/lib/calendar-utils.test.mjs`; `node --test` → 2/2 FAIL on the intended
  assertions ("pending request must not be shown as 상담 가능"; "second half-hour of an inactive
  1-hour row must also be 상담 불가").
- Fix: `src/lib/calendar-utils.ts` — busy filter now `approved || pending`; blackout matching now
  overlap-based across all covered chunks (id falls back to the covering blackout row for toggling).
- GREEN: same tests → 2/2 PASS.
- Full suite after fix: 144 tests / 141 pass / 3 fail — the 3 failures are pre-existing stale
  source-regex tests present before any Stage 1 change (KI-002), unrelated to availability.

## Tests executed (actual results)

- `node --test "src/**/*.test.mjs"` BEFORE changes: 142/139 pass/3 fail (same 3 as after).
- AFTER changes: 144/141 pass/3 fail.
- `npm run typecheck`: PASS (clean).
- `npm run lint`: PASS with 1 pre-existing warning (no-img-element in student-hero-carousel.tsx:67).
- `npm run build`: PASS (First Load JS shared 102 kB).

## Performance findings

docs/upgrade/stage-01/PERFORMANCE_BASELINE.md. Headline: warm dev TTFB 610–870 ms across
dashboard/mypage/counseling (server query waterfall + force-dynamic everywhere + AppShell
re-fetching profile per page); no loading states anywhere. Stage 3 targets identified.

## Unresolved risks

- KI-001 remainder: professor calendar still labels undeclared free time "상담 가능" (0-vs-85
  driver) and uses browser-local tz — Stage 2 unification required; do NOT patch display counts.
- KI-002 stale tests (3) still red — decide rewrite-vs-update in a later stage.
- KI-003 error/empty conflation + RLS permission-denied noise.
- Local branch bases on codex/mobile-student-timetable-fix which is 8 ahead / 1 behind its origin
  (remote d8bd48a looks like a rebased duplicate of local d740217). Unresolved; harmless locally.
- Demo login for student lands on /onboarding (cause UNVERIFIED).

## Decisions made

D-001..D-003 pre-existing (see DECISIONS.md). No new architecture decisions taken in Stage 1;
Stage 2 input: adopt `buildAvailableCounselingSlots` as the single availability source and make the
professor calendar a consumer (see SLOT_DATAFLOW.md boundary table).

## Exact next action (Stage 2 start)

1. Read CLAUDE.md, CURRENT_STAGE.md, this HANDOFF, SLOT_DATAFLOW.md.
2. Design the canonical availability module boundary: professor calendar consumes the same engine
   (or a shared core) as the student flow; define "declared bookable" vs "recommendable free time"
   as distinct concepts; move timezone handling to Asia/Seoul helpers everywhere.
3. Keep `src/lib/calendar-utils.test.mjs` green; extend coverage as the engine unifies.

## Relevant commits

- Base: bbd3aa3 (branch point).
- Stage 1 commit(s): see `git log upgrade/stage-1` — docs + calendar-utils fix + tests.

## Exit gate checklist

- [x] Git/base state verified
- [x] architecture mapped
- [x] actual user roles identified (student/professor/assistant/admin from user_role enum)
- [x] critical routes mapped
- [x] timetable data flow mapped
- [x] counseling data flow mapped
- [x] desktop baseline inspected (runtime)
- [x] mobile baseline inspected (runtime, 375px)
- [x] performance baseline recorded (dev-mode caveat documented)
- [x] historical slot mismatch investigated
- [x] current mismatch reproduced (professor-side) AND student-facing variant verified not reproducible
- [x] root cause documented (R1–R4 in SLOT_BUG_REPRODUCTION.md)
- [x] regression protection exists (calendar-utils.test.mjs added; existing slot suites pass)
- [x] new bug fix followed Red → Green (evidence above)
- [x] relevant tests executed (results above)
- [x] typecheck/lint/build status recorded
- [x] no unintended UI/UX regression introduced (fix affects only incorrect availability display;
      professor page re-verified rendering after change)
- [x] HANDOFF updated
- [x] CURRENT_STAGE updated
- [x] remaining risks documented
- UNVERIFIED items are explicitly marked in PERFORMANCE_BASELINE.md and KNOWN_ISSUES.md
