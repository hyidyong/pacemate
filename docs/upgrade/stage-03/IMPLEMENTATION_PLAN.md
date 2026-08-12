# Stage 3 — Implementation Plan

Ordered by verified impact ÷ risk (AUDIT §9). One commit per task. Every task:
problem → evidence → files → baseline → correctness test → implementation →
post-change measurement → regression verification → commit.

Per-task regression floor (all tasks): `node --test "src/**/*.test.mjs"` reported
as pass/fail-with-names (expect the KI-002 trio only); `npm run typecheck`.
Scheduling-data tasks additionally re-run the Stage 2 invariant suites explicitly.

## Task 1 — Fix KI-013: remove the Server-Component dynamic() seam on /professor

- Problem: workspace stuck in lazy fallback on 4/4 direct GETs (AUDIT §2.4).
- Evidence: professor/page.tsx:16-28 next/dynamic in RSC; chunk eager in
  app-build-manifest → zero deferral benefit; orphaned SSR DOM + nested main.
- Files: src/app/professor/page.tsx; src/components/professor/professor-workspace.tsx
  (nested `<main>` → div, classes preserved; remove inline dynamic import :350).
- Baseline: 4/4 stuck; /professor First Load 339 kB; TTFB 458–597 ms.
- Correctness test (deterministic proxy, repo's precedented source-test style):
  new src/app/professor/professor-page-hydration.test.mjs asserting the page
  statically imports ProfessorWorkspace (no next/dynamic) and that
  professor-workspace renders no nested `<main>` — RED first against current
  source, then GREEN.
- Post-change measurement: production build → 5/5 direct GETs render usable
  workspace (desktop + mobile); bundle table diff (First Load must not grow).
- Commit: `fix: statically import professor workspace to remove stuck hydration seam (KI-013)`.

## Task 2 — Request-scoped memoization: getDemoProfile + notification getters

- Problem: ~20 routes resolve profile twice + fetch notifications at the tail
  (AUDIT §3 facts, rank 2).
- Files: src/services/session.service.ts, src/services/notifications.service.ts
  (wrap in React.cache; signatures unchanged); no AppShell change.
- Correctness test: source test asserting cache() wrapping
  (+ existing session-performance.test.mjs stays green); behavior suites green.
- Post-change: warm prod TTFB samples for /counseling, /mypage.
- Commit: `perf: request-scope session profile and notification reads with React.cache`.

## Task 3 — /mypage: execute the getPosts triple once

- Problem: identical 3-query set ×4 per render (12 → 3), AUDIT §3.2.
- Files: src/services/student-community.service.ts (getMyPageData +
  helpers accept the shared posts result; derivation logic unchanged).
  Also drop the dead `student_profiles` select("*") ONLY if verified unused by
  MyPagePlanner (verify prop threading first; else keep).
- Correctness test: NEW deterministic query-count test
  (src/services/student-community.query-count.test.mjs, transpile-loader +
  counting fake client): RED = posts selected 4× today → GREEN = 1×. Assert
  view outputs (my/scraped/liked/commented) identical for a fixture.
- Post-change: warm prod TTFB /mypage; query count 25 → ~13.
- Commit: `perf: fetch community posts once per mypage render`.

## Task 4 — /counseling + /courses: merge independent batches

- Problem: false sequential stages (AUDIT §3.3, §3.5).
- Files: src/services/counseling.service.ts (one Promise.all; internal
  student_courses → course_professors chain stays sequential inside its branch);
  src/app/courses/page.tsx (Promise.all summaries + favorites).
- Correctness test: NEW query-count/stage test for getCounselingPageData
  (B2: ≤7 queries, ≤2 stages — counting client records await-batch boundaries);
  availability suites re-run (scheduling data touched).
- Post-change: warm prod TTFB /counseling, /courses.
- Commit: `perf: parallelize independent counseling and courses page queries`.

## Task 5 — /dashboard: shared identity resolution + stage flattening

- Problem: 3× auth.getUser + 6× student_courses + ~11 serial stages (AUDIT §3.1).
- Files: new src/services/request-identity.server.ts (cache()-wrapped
  auth.getUser + profiles resolution); company-law-offering.server.ts,
  course-term-completion-eligibility.server.ts,
  student-learning-recommendations.server.ts consume it; dashboard/page.tsx
  starts card chains as early as their true inputs allow.
- Correctness: existing offering-ownership-gate + roadmap-workspace suites green
  (they freeze the ownership idioms); card outputs verified identical at runtime
  (student1 dashboard before/after screenshot-of-record).
- Post-change: warm prod TTFB /dashboard (target ≤400 ms, R1); auth round-trips
  3 → 1.
- Commit: `perf: share request-scoped identity across dashboard card services`.

## Task 6 — /professor: dedupe queries + real lazy boundary for recharts

- Problem: duplicate counseling_requests (list ⊂ calendar) + duplicate
  course_offerings scan; recharts eager for a non-default tab (AUDIT §3.4, §6-7).
- Files: src/services/professor.service.ts (derive limit-12 list from calendar
  superset in JS — same columns/order/limit semantics); progress-report +
  aggregate services share one offerings fetch; professor-workspace.tsx wraps
  ProfessorCourseProgressReportView in dynamic(ssr:false) (client component —
  legal). Aggregate plans/progress parallelized.
- Correctness test: unit test for the list-derivation (fixture: >12 rows, mixed
  statuses → identical output to the old query semantics); Stage 2 suites re-run
  (professor calendar consumes this data); runtime QA of calendar + list + report
  tab (report tab shows its loading state once, then renders — verify data
  identical).
- Post-change: fresh build bundle table (/professor First Load target ≤250 kB,
  B6); warm prod TTFB /professor; query count diff.
- Commit boundary: two commits (query dedupe; bundle boundary) for independent
  revertability.

## Task 7 — Regression protection + final measurement

- Bundle guard: scripts/check-bundle-budgets.mjs (manifest-based, no new deps,
  documented usage; not in default test glob).
- Full validation: suite + typecheck + lint + fresh build; Stage 2 invariant
  suites; production runtime re-measurement of every table in AUDIT §2.1
  (desktop + mobile) including 5/5 professor direct-GET check and the booking →
  refresh → cancel availability QA loop (Stage 2 script, cleaned up after).
- Docs: AUDIT before/after tables; DECISIONS (cache policy, no-schema-change
  policy, bundle budgets); KNOWN_ISSUES updates (KI-013 resolution note,
  deferred items); HANDOFF; CURRENT_STAGE.
- Commits: docs + guard script; then PR.

## Kill criteria

Any optimization that does not materially improve its measured target, or that
turns any invariant suite red without an obvious one-line cause, is reverted
rather than patched forward (§25 rule).
