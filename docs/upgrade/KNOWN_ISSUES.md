# Known Issues

Issues must be added only when reproduced or supported by repository/runtime evidence.
Historical reports may be investigated but are not automatically considered currently reproducible bugs.

## KI-016 — Stage 3 performance audit findings deferred by design (Stage 4/6/8/9 inputs)

Status: OPEN (documented 2026-08-12; evidence in docs/upgrade/stage-03/PERFORMANCE_AUDIT.md).
- Professor report services read university-global data (ALL course_offerings +
  ALL student progress rows, unscoped to the signed-in professor) and serialize
  it into client props (professor-course-progress-report.server.ts:~195,
  professor-anonymous-weekly-aggregate.server.ts:~280). Also a privacy concern —
  any professor sees every student's progress. Scoping changes displayed
  content, so it was out of Stage 3's behavior-preservation charter.
  Recommended: Stage 6 (tenancy) / Stage 9 (authz), severity Medium.
- Unbounded result sets fine at demo scale: courses full table (course.service.ts,
  student-community.service.ts getCourses), course_professors fallback
  (counseling.service.ts:128-130), escalations inbox + student /ask full-table
  read (professor-questions.server.ts), getCalendarRequests, course notices
  (course-notices.server.ts:36-43), posts' reactions/comments for 80 posts.
  Recommended: Stage 8, severity Low today / Medium at scale.
- Justified-by-pattern index candidates, negligible at 126-row scale:
  user_notifications partial unread indexes; student_weekly_progress
  (offering_id, week_number) once professor scoping lands; counseling_requests
  (student_id, created_at desc). Recommended: Stage 8.
- No loading.tsx/streaming anywhere: every navigation blocks on full SSR with a
  frozen previous page (client-nav RSC 268–852 ms measured). Loading-state
  design belongs to Stage 4 (§23); revisit with post-Stage-3 numbers.
- supabase-js rides in the shared shell (~72 kB gz on every route) via
  NotificationMenu for a realtime channel that is off by default
  (notification-menu.tsx:73). Extraction candidate, Stage 4/8.
- Rerender hotspots (no measured journey impact yet): hover-glow-card mousemove
  setState (dashboard), ai-tutor-chat per-keystroke full re-render, hero
  carousel interval churn; nested <main> also in community-board.tsx:399,
  reviews-board.tsx:136, professor-lounge.tsx:93. Stage 4.
- /dashboard still reads student_courses 5× per render with different
  selects/filters (getMyCourses, course notices, page inline, offering
  resolution, ownership gates) — a true consolidation needs a shared
  student-courses snapshot type, deferred. Stage 4/8, severity Low.

## KI-013 — Professor workspace intermittently never leaves its lazy-load fallback

Status: RESOLVED in Stage 3 (2026-08-12, commit b4bfe9f). Root cause: the
"[Opt 4]" `next/dynamic()` wrapper in the Server Component page created a
Suspense/lazy hydration seam while deferring nothing — the workspace chunk was
eagerly preloaded for /professor in app-build-manifest.json, and direct GET
loads reproduced the stuck fallback 4/4 (≥29 s, orphaned SSR DOM, 2 nested
<main>, all chunks 200, no console errors) on the production build. Fix:
static import (seam deleted), workspace's nested <main> → div, redundant
inline dynamic import of professor.actions removed. After: 8/8 direct GETs
render the workspace (desktop + mobile + ?tab=report deep link) across two
production builds; /professor First Load JS unchanged then reduced 339→225 kB
by re-introducing lazy loading at the correct boundary (recharts report view
inside the client workspace, ssr:false — no RSC hydration seam). Guarded by
src/app/professor/professor-page-hydration.test.mjs. Historical text below
kept for context.

Previously: /professor rendered the SSR'd workspace, then hydration replaced it with the
"워크스페이스 불러오는 중..." fallback which never resolved; the SSR'd workspace HTML
remained orphaned in the DOM (nested `<main>`, width 0). All JS chunks returned 200; no
console/server errors. Flaky: loads arriving via the login POST redirect reliably
hydrated during QA; direct GET navigations frequently stuck. Reproduced identically on
`main` (d922b34) and `upgrade/stage-2` production builds, same machine/browser.
Note: Stage 2 QA also hit a SEPARATE, Stage-2-caused variant (relative .ts-extension
import broke webpack dev's client graph) — that one was fixed on the stage-2 branch
(calendar-utils imports via the @/ alias again; tests use a transpile loader).

## KI-014 — Availability writes lack ownership/role guards; counseling status updates lack ownership checks

Status: OPEN (security hardening — fold into the KI-006/KI-011 RLS migration family,
Stage 9). Evidence from the Stage 2 discovery sweep (2026-08-12):
- `addProfessorAvailability` / `toggleProfessorAvailability`
  (professor.actions.ts:118,528) have NO role or ownership check and write via the anon
  client under the permissive `demo anon manage professor availability` policy
  (schema.sql:501, `using (professor_id is not null)`) — any caller can open/block any
  professor's availability.
- `updateCounselingStatus` (professor.actions.ts:198) checks role only, not ownership,
  and has no from-state check: any professor/assistant can move any request to any
  status via the service-role client.
- anon retains an UPDATE grant on counseling_requests plus a hardcoded-demo-email anon
  UPDATE policy (schema.sql:507-523) never dropped by migration 20260713090000.

## KI-015 — Assorted counseling-domain paper cuts (documented during Stage 2, out of scope)

Status: OPEN.
- Cancel notification text bug: professor cancel sends title "상담 시간이 조정
  필요합니다" with an empty-note body implying a suggested time exists
  (professor.actions.ts:238-247); approve/cancel also null out professor_note and
  suggested_* unconditionally (:224-229).
- `suggested_start/end` are advisory only (not constrained, not busy) yet the reject
  flow hard-codes end = start + 30 min (professor-workspace.tsx:1468-1470) regardless
  of the professor's slot_minutes.
- Dead component `professor-admin-summary.tsx` (exported, imported nowhere).
- Professor stat tile "상담 슬롯" counts availability ROWS including inactive blackout
  rows (professor-workspace.tsx adminStats) — inflated number (Stage 4 label/logic).
- Schema drift: `suggested_start`/`suggested_end`/`location` exist only in schema.sql
  (no migration adds them); `offering_id` exists only in migration 20260712000000 (not
  in schema.sql's table body). Reconcile with the migration-history cleanup (KI-006
  note, Stage 10).
- Three test files under supabase/migrations/*.test.mjs are never run by the canonical
  `node --test "src/**/*.test.mjs"` glob; no `test` script exists in package.json
  (Stage 10 CI).

## KI-012 — Dashboard ownership gates errored on duplicate student_courses rows

Status: FIXED 2026-08-12 (Red → Green; latent — no live occurrence at fix time).
The KI-006 app-level ownership gates in course-term-completion-eligibility.server.ts and
student-learning-recommendations.server.ts used a bare `.maybeSingle()` on
`student_courses (student_id, offering_id)`. The table is unique on (student_id, course_id,
STATUS), so one student can own the same offering via several rows (e.g. an "interested"
registration next to a "completed" row linked by the roadmap repair flow,
personalized-weekly-roadmap.server.ts:175). supabase-js `maybeSingle()` errors on >1 row,
which would have broken the dashboard cards for exactly those students. Live check
2026-08-12: 0 duplicate (student, offering) pairs today (7 offering-linked rows, all
`interested`) — latent, one flow away, so no runtime repro was manufactured.
Fix: `.limit(1).maybeSingle()`, the same idiom the roadmap server's authorization check
already uses (frozen by student-roadmap-workspace.test.mjs). RED:
src/services/offering-ownership-gate.test.mjs 2/2 fail for the intended reason → GREEN 2/2
pass; full suite 150/147 pass/3 fail (same KI-002 trio); typecheck clean.
Found by external real-time review (P2); premise verified against schema and live data.

## KI-011 — SECURITY DEFINER RLS helpers live in the exposed public schema

Status: OPEN (hardening; fold into Stage 2 RLS work — flagged by external review 2026-08-12).
is_professor_of_offering / is_student_of_offering (migration 20260812000000) are SECURITY
DEFINER functions in `public`, so PostgREST exposes them as RPC endpoints to the
authenticated role. Mitigations already in the migration: EXECUTE revoked from public/anon
(authenticated only), both predicates answer only about the caller (auth.uid() is evaluated
inside — no cross-user disclosure), and search_path is pinned to `public` (not mutable).
Residual risk is low: an authenticated user can merely probe their own membership of
arbitrary offering ids. Supabase guidance still prefers a non-exposed schema (e.g.
`private`) and `set search_path = ''` with fully qualified names. Do that in the Stage 2
RLS unification (same migration family as KI-006/KI-007) instead of churning the live DB now.

## KI-010 — Vercel build failed: pnpm-lock.yaml out of sync (ERR_PNPM_OUTDATED_LOCKFILE)

Status: FIXED 2026-08-12.
The repo ships both `package-lock.json` (npm — what local dev/CI actually used, per
SYSTEM_BASELINE.md) and a committed `pnpm-lock.yaml` + `pnpm-workspace.yaml`. Vercel
auto-detects the package manager from whichever lockfile is present and picked pnpm; that
lockfile was stale (`tw-animate-css` was added to `package.json` without regenerating
`pnpm-lock.yaml`), so Vercel's `pnpm install --frozen-lockfile` failed with
`ERR_PNPM_OUTDATED_LOCKFILE`, blocking the deploy for PR #32.

Fix: ran `pnpm install --lockfile-only` to resync `pnpm-lock.yaml` with `package.json`, then
verified with `pnpm install --frozen-lockfile` (the exact mode Vercel/CI use) and a full
`npm run build`. `npm ci` was also re-verified to still succeed, so both lockfiles are
consistent with `package.json` again.

**How to apply / avoid recurrence:** whenever a dependency changes in `package.json`, run
`pnpm install --lockfile-only` (in addition to whatever `npm install` already updates) before
committing — two lockfiles means two things to keep in sync. A commit
(`6187549 fix: sync pnpm lockfile for vercel builds`) shows this has broken before. Consider
removing one lockfile/manager entirely in Stage 10 (CI/CD hardening) so this class of failure
becomes structurally impossible instead of process-dependent.

## KI-001 — Professor calendar availability engine diverges from canonical student engine

Status: RESOLVED in Stage 2 (2026-08-12). The duplicate engine was deleted; the
professor calendar consumes `buildProfessorWeekAvailability`, whose bookable claim
derives exclusively from the canonical per-date primitive. Undeclared free time now
renders as "상담 미개방" (not student-bookable); declared bookable time keeps
"상담 가능" and matches the student engine exactly (identity-level regression test in
src/lib/availability-consistency.test.mjs; live QA 2026-08-12: 김재두 zero-declaration
baseline 0 상담 가능 / 82 미개방 chunks; declared Mon 10:00-11:00 window → 2 상담 가능
chunks == student side 2개 on both horizon Mondays). Timezone handling is Asia/Seoul
throughout (D-006). Historical text below kept for context.

Previous status: PARTIALLY FIXED in Stage 1 (2026-08-11); remainder deferred to Stage 2.
Evidence: docs/upgrade/stage-01/SLOT_BUG_REPRODUCTION.md (0 vs ~85 slot mismatch reproduced live).

`calculateRecommendedAvailability` (src/lib/calendar-utils.ts) is a second availability
implementation, independent of the canonical `buildAvailableCounselingSlots` (src/lib/counseling-slots.ts).

Fixed in Stage 1 (Red → Green, tests in src/lib/calendar-utils.test.mjs):
- pending counseling requests now block calendar chunks (previously only approved);
- inactive availability rows now black out every chunk they cover (previously prefix-matched
  only the first 30-min chunk).

Remaining (Stage 2 scope — DO NOT patch display counts):
- base window is hard-coded Mon–Fri 09:00–18:00 / 30-min chunks and labels ALL free time
  "상담 가능/상담 예약이 가능한 시간입니다", although students can only book declared
  `professor_availability` windows. A professor with zero availability rows sees a full week of
  "상담 가능" while students see none. Honest fix = single-source-of-truth unification plus a UI
  distinction between "declared bookable" and "free/could be opened" (Stage 2 + Stage 4).
- browser-local timezone (`Date.getDay/getHours`) instead of Asia/Seoul (also
  src/lib/scheduling-policy.ts, today-timetable-widget.tsx). Correct only in KST browsers.

## KI-002 — 3 stale source-regex tests fail on the baseline

Status: OPEN (pre-existing on bbd3aa3; not behavior bugs).
`node --test "src/**/*.test.mjs"` → 144 tests, 141 pass, 3 fail:
- src/services/admin-notifications.test.mjs ×2 — assert exact source strings that changed when
  broadcast dedup / notification dedupe features were added later.
- src/services/question-notice-workflow.test.mjs ×1 — expects `from("chat_messages")` in a file
  refactored since.
These freeze implementation text, not behavior. Triage in a later stage: rewrite as behavior
assertions or update the regexes deliberately.

## KI-003 — Fetch failures render as empty states (indistinguishable from no data)

Status: OPEN. Evidence: page-level `.catch(() => defaults)` in counseling/page.tsx:12-15,
mypage/page.tsx:16-29, app-shell.tsx:35-42; runtime console showed RLS "permission denied"
(posts, student_custom_courses) and one 500 swallowed into empty UI on 2026-08-11.
Dashboard cards "과목 · 학기 완료 근거"/"다음 학습 추천" showed error fallbacks for the demo
student (cause UNVERIFIED — likely demo-data state). Related: role-mismatched queries still
executed (professor session querying student tables). Stage 2/9 candidate.

## KI-004 — Counseling UX correctness edges (documented baseline, Stage 2/4 candidates)

Status: OPEN.
- Counseling workspace month calendar derives its month from the first slot and cannot page
  months; slots in the following month invisible (counseling-workspace.tsx:88-119).
- After booking, the client does not refresh (`router.refresh()` absent) — slot list/requests
  panel stale until navigation (counseling-workspace.tsx:173-179).
- 과목별 예약 mode auto-selects `course.professors[0]`; no picker for a course's other
  professors (counseling-workspace.tsx:190) — second professor reachable only via 교수별 검색.
- Demo student login lands on /onboarding although onboarding data exists (cause UNVERIFIED).

## KI-006 — RLS policy recursion (42P17) on course_offerings

Status: DB FIX APPLIED 2026-08-12 — the owner ran
20260812000000_fix_offering_policy_recursion.sql in the SQL editor; verified via PostgREST
that student and professor authenticated reads of course_offerings / student_weekly_progress /
student_course_progress no longer return 42P17. App-level admin-client workarounds remain in
place (harmless; candidates to revert to session reads in Stage 2).
Root cause: mutually recursive authenticated policies — "students read own course offerings"
(20260712183907, subqueries student_weekly_progress) ⇄ "professors read own weekly aggregate
evidence" (20260713013521, subqueries course_offerings). Every authenticated SELECT on
course_offerings fails with 42P17. Reproduced live with a student JWT via PostgREST.

Consequences and current state (reconciled 2026-08-12 after the DB fix):
- Student dashboard 학기 완료 근거/다음 학습 추천 cards were dead → FIXED at app level
  (ownership gate via own student_courses row + server-only admin-client reads scoped to the
  verified ids) in course-term-completion-eligibility.server.ts,
  student-learning-recommendations.server.ts, company-law-offering.server.ts. With the DB
  fix applied these workarounds are redundant; revert to session reads in Stage 2.
- Professor 과목 진행 현황 report: was broken (error panel) while the recursion existed;
  confirmed rendering real data live after the DB fix (commit f2f490d). The 익명 주간 집계
  view is expected fixed by the same policy change but was not separately re-verified —
  UNVERIFIED. professor-anonymous-weekly-aggregate-security.test.mjs still (correctly)
  forbids service-role reads there.
- supabase/migrations/20260812000000_fix_offering_policy_recursion.sql was applied manually
  via the SQL editor, NOT `supabase db push` — the CLI migration history table may not list
  it as applied. Reconcile migration history before the next `db push` (Stage 2/10).

## KI-007 — student_profiles/student_courses authenticated policies use pre-mapping identity

Status: OPEN (app-level workaround in place for login).
Authenticated policies still compare `auth.uid()` to `profile_id`/`student_id` (= profiles.id),
which never matches after the auth_user_id mapping (20260712183855/183907 fixed only
`profiles`). Effect observed: login's is_onboarded read returned 0 rows → every student was
redirected to /onboarding despite is_onboarded=true. FIXED at app level in
demo-auth.service.ts (admin-client read of the just-verified profile id). DB-layer policy
update belongs with KI-006's migration family (Stage 2/9).

## KI-008 — External images on i.ibb.co are slow (5–12 s, 0.9–1.3 MB each)

Status: RESOLVED 2026-08-12 (owner-approved).
All 6 images (header logo, chatbot FAB, 4 hero banners) were downloaded, resized to display
dimensions, and vendored into public/images/ (~444 KB total vs ~6.6 MB originals). Sources
updated (app-header-professor-safe.tsx, app-shell.tsx, student-hero-carousel.tsx + its test);
i.ibb.co removed from next.config.mjs remotePatterns and CSP img-src. The carousel test now
guards against the external host returning (doesNotMatch i.ibb.co).

## KI-009 — Mobile touch-target sizes below guideline

Status: OPEN (Stage 4 candidate; no functional blocker found).
375px audit on 2026-08-12: carousel dots 10×10 px, 공지 닫기 24×24 px, "마이페이지에서 관리"
links ~17–20 px tall (guideline ≈44 px). elementFromPoint interception audit at scroll-top
found zero blocked targets on dashboard/mypage; the only interceptions occur when content
scrolls under the sticky header (normal behavior).

## KI-005 — supabase/schema.sql snapshot has a duplicate column line

Status: OPEN (latent). `professor_admin_tasks` in supabase/schema.sql (~:910-911) repeats
`day_of_week` — harmless unless the snapshot is re-applied verbatim; real migration
(20260714204100) is correct.
