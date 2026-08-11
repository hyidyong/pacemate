# Stage 3 — Performance Audit

Measured 2026-08-12 on `upgrade/stage-3` @ e4d18e9 (== Stage 2 merge cfa540f + docs
scaffold). Method: 4 read-only discovery agents (network, server/DB, frontend/bundle,
QA-tooling) + lead verification of load-bearing claims against source + live runtime
measurement. Every file:line below was read directly in this audit.

## 1. Measurement environment and method

- Windows 11, localhost, live Supabase project (ap-northeast/us WAN latency applies),
  demo data volume (row counts in §5.0).
- Production: `npm run build` + `npm start`; browser Performance API `navigation`
  entry on warm (second+) full-page loads, logged-in demo student
  (student1@pacemate.edu) and demo professor (prof1@pacemate.edu).
- Dev comparability runs: `next dev`, same warm-load method as Stage 1's baseline.
- Client-side navigation cost measured via the `?_rsc=` resource entry duration.
- FCP/LCP/INP/CLS: the embedded browser did not expose paint/LCP entries —
  **UNVERIFIED** (no numbers invented). TTFB / DCL / load are reliable.

## 2. Current baseline vs Stage 1

### 2.1 Production (Stage 3 canonical baseline; warm, desktop)

| Route | TTFB (ms, samples) | load event (ms) | doc size | Notes |
|---|---|---|---|---|
| /dashboard | 497–563 | 559–590 | 22.7 KB | 19 resources, all cached |
| /mypage | 412–528 | 474–567 | 20 KB | |
| /counseling | 285–328 | 307–351 | 14 KB | |
| /courses | 284 | 317 | 20 KB | |
| /professor | 458–597 | 520–633 | 25 KB | workspace STUCK (see §2.4) |

Mobile 375px (production, warm): /dashboard TTFB 496 / load 545; /counseling
TTFB 456 / load 478; /professor TTFB 534 — STUCK. No horizontal overflow. TTFB is
viewport-independent (server-bound), as expected.

Client-side navigations (production, warm): /mypage → /counseling RSC fetch
**852 ms**; /counseling → /mypage **479 ms**. Every navigation pays the full
force-dynamic SSR query set; there is no loading boundary, so the previous page
stays frozen for the whole round trip.

No client-side data fetches occur after load on /dashboard (verified via resource
entries) — the entire cost is server-side TTFB.

### 2.2 Dev-mode comparability run (same method as Stage 1)

| Route | Stage 1 (2026-08-11, dev) | Stage 3 start (2026-08-12, dev) |
|---|---|---|
| /dashboard | TTFB 610–670 / load 1.17–1.36 s | TTFB 875–1014 / load 1.43–1.59 s |
| /mypage | TTFB 868 / load 1.41 s | TTFB 752 / load 1.27 s |
| /counseling | TTFB 612 / load 1.25 s | TTFB 598 / load 1.06 s |

Dashboard regressed since Stage 1 — consistent with the eligibility/recommendation
card query chains added after the Stage 1 baseline (KI-006 era), which append ~7
sequential round trips (§4.1). Mypage/counseling comparable.

### 2.3 Production bundle (from `npm run build`, 2026-08-12)

| Route | Route JS | First Load JS |
|---|---|---|
| shared (all) | — | **102 kB** |
| /professor | **137 kB** | **339 kB** |
| /mypage | 10.6 kB | 213 kB |
| /dashboard | 8.31 kB | 204 kB |
| /courses | 141 B | 202 kB |
| /onboarding | 2.86 kB | 191 kB |
| /counseling | 5.26 kB | 185 kB |
| /chatbot | 48.4 kB | 159 kB |

### 2.4 KI-013 reproduced — /professor workspace unusable on direct loads

Production build, prof1 session: **4 of 4 direct GET navigations** (3 desktop,
1 mobile) left the page in the "워크스페이스 불러오는 중..." fallback ≥ 29 s after
load. DOM state: AppShell's `<main>` contains only the 98-char fallback; the SSR'd
workspace (2,102 chars, including its own nested `<main>` —
professor-workspace.tsx:608) remains orphaned at 0×0. All chunks HTTP 200, zero
console errors — matching KNOWN_ISSUES.md KI-013 exactly, but reproducing at 100%
here (worse than "intermittent"). The login-POST-redirect load did hydrate.

## 3. Network critical path per journey

Structural facts that shape every journey (verified in source):

- **No request-scoped memoization anywhere**: `React.cache()` / `unstable_cache`
  → 0 matches in src/ (grep re-verified by lead).
- **No `loading.tsx` anywhere**; the only Suspense wraps a nav bar
  (app-shell.tsx:76-78).
- **AppShell self-fetches when given no props** (app-shell.tsx:33-43):
  `getDemoProfile()` again + notifications + unread count. Only /dashboard passes
  props (dashboard/page.tsx:244-249); **~20 of 23 routes resolve profile twice and
  fetch the notification pair after all page awaits complete** (AppShell is a child,
  so its queries serialize at the tail).
- Middleware runs `supabase.auth.getClaims()` on every request
  (middleware.ts:4-6, lib/supabase/proxy.ts:45).
- No Link prefetch benefit: all 23 pages force-dynamic; Next 15 Router Cache keeps
  dynamic pages 0 s by default → every navigation is a full SSR round trip.

### 3.1 /dashboard (student) — ~26 queries + 3 auth round-trips, ~11 sequential stages

Stage chain (dashboard/page.tsx): profile (:90) → Promise.all notifications ×2
(:119-122) → Promise.all×4: getMyCourses / listStudentCourseNotices / inline
student_courses / inline counseling_requests (:142-164) → dependent
student_mission_progress (:173-178) → await offering resolution (:230; internally
auth.getUser → profiles → student_courses → admin course_offerings, 4 serial) →
Promise.all: eligibility (6 serial stages internally) + recommendations (5 serial
stages internally) (:233-236).

Duplicates per render: `profiles` ×4, `auth.getUser()` ×3, `student_courses` ×6
(student-community.service.ts:221, course-notices.server.ts:15, page:151,
company-law-offering.server.ts:76, course-term-completion-eligibility.server.ts:139,
student-learning-recommendations.server.ts:27), `course_offerings` ×3,
`course_weekly_plans` ×2, `student_weekly_progress` ×2. The three card services
each re-derive identity from scratch (auth.getUser → profiles → ownership).

### 3.2 /mypage — the 4× getPosts fan-out (verified by lead)

getMyPageData (student-community.service.ts:132-160): `await ensureProfileSchool`
serialized ahead of everything (:136) → Promise.all×3 (:137-141) → Promise.all×4
(:142-147) where **each** of getMyPosts/:464, getScrapedPosts/:457,
getCommentedPosts/:482, getLikedPosts/:473 internally calls `getPosts(profileId)` —
3 queries each (posts limit 80 :330-336 + all reactions :365-368 + all comments
:370-374). **The identical 3-query set executes 4× per render (12 queries where 3
suffice)**, then JS filters each copy down to a handful. Tail: `student_profiles`
`select("*")` (:151-155) whose result is passed nowhere (fetched then dropped).
Stage 4 (posts batch) is independent of stage 3 results but serialized after it.

### 3.3 /counseling — independent Promise.alls serialized (verified by lead)

counseling.service.ts:44-54: batch 1 (5 global queries) and batch 2 (courses +
professors, internally student_courses → course_professors) — batch 2 consumes
nothing from batch 1; the two awaits are a fixable waterfall. AppShell tail adds
profiles + notifications ×2. 4 of 5 availability inputs are university-global
(no professor scoping): professor_availability :103-107, professor_teaching_slots
:213-215, busy counseling_requests :246-248, professor_admin_tasks :233-235; plus
the all-professors directory :191-194.

### 3.4 /professor — ~27 queries + 3 auth round-trips, depth ≤5 chains

professor/page.tsx:48-62 Promise.all×6 of: getProfessorPageData (professor →
Promise.all×8 incl. **two overlapping counseling_requests queries** — limit-12
management list professor.service.ts:287-292 vs unbounded calendar :311-317, same
columns); notification counts ×2; course-progress report (auth → profiles →
**ALL course_offerings** :202-205 → student_course_progress for all :233-236);
anonymous weekly aggregate (auth → profiles → **ALL course_offerings again**
:285-288 → plans :313-316 → progress :334-337 — plans/progress independent but
serialized); question inbox (auth → profiles → professors → Promise.all escalations
unbounded + rules → course names). AppShell tail repeats profile + notifications.
Neither report service scopes to the signed-in professor — university-global reads
+ JS aggregation + full serialization into RSC props.

### 3.5 /courses

profile → `await getCourseSummaries()` (whole courses table, anon client) →
`await getFavoriteCourseIds(profile.id)` — favorites depends only on profile,
independent of the course list; fixable serialization (courses/page.tsx:34→57).

### 3.6 Mutation → refresh behavior

- Booking (createCounselingRequest, counseling.actions.ts:18) re-runs the whole
  global availability pipeline as a pre-check (:31-41 → getAvailableCounselingSlots)
  then `revalidatePath("/counseling", "/professor")` (:78-79). The GiST exclusion
  constraint remains the true guard (Stage 5 owns concurrency).
- Invalidation vocabulary is coarse path-based `revalidatePath` across ~30 actions;
  no `revalidateTag`. Harmless today (nothing cached) but any future caching layer
  must adopt precise keys.
- KI-004 (pre-existing): after booking, the client does not `router.refresh()` —
  slot list stale until navigation. Not a Stage 3 regression; noted.
- weekly-missions.tsx:26 does a full `window.location.reload()` after feedback.

## 4. Server/API critical path

Covered by §3 stage chains. Additional server-side facts:

- Auth overhead: demo-cookie path is cheap (HMAC verify + 1 profiles query;
  frozen by session-performance.test.mjs). The `auth.getUser()` sites (7
  implementations of the same identity chain across services) each cost a GoTrue
  network round trip: company-law-offering.server.ts:59,
  course-term-completion-eligibility.server.ts:105,
  student-learning-recommendations.server.ts:16, professor-questions.server.ts:370,
  professor-course-progress-report.server.ts:178,
  professor-anonymous-weekly-aggregate.server.ts:261, session.service.ts:56.
- Server-side domain recomputation: buildAvailableCounselingSlots runs over global
  inputs; each slot boundary conversion constructs multiple Intl.DateTimeFormat
  instances (counseling-slots.ts:256-298). At demo scale this is not the TTFB
  driver (round trips are); at tenant scale it grows linearly with professors.
- A module-level anon browser client is shared server-side by professor.service
  (:233, :267) and course.service (:14) — deliberate (comment professor.service:1-5).

## 5. Database analysis

### 5.0 Live demo DB row counts (service-role HEAD count, 2026-08-12)

profiles 27 · professors 3 · courses 9 · course_offerings 5 · student_courses 12 ·
student_custom_courses 0 · counseling_requests 3 · professor_availability 9 ·
professor_teaching_slots 22 · professor_admin_tasks 30 · posts 7 · post_reactions 4 ·
comments 0 · user_notifications 126 · student_weekly_progress 90 ·
student_course_progress 5 · course_weekly_plans 15 · escalations 3 ·
course_professors 7 · faqs 1.

**Consequence: at demo scale, TTFB is dominated by round-trip count (sequential
WAN hops to Supabase), not row volume.** Waterfall depth and query count are the
metrics that matter; unbounded queries are future-scale risks, not today's ms.

### 5.1 N+1

No per-row read loops on the audited routes (reads batch with `.in()`). Write-side
fan-out exists on /roadmap repair (personalized-weekly-roadmap.server.ts:135-182) —
out of the critical journeys, documented only.

### 5.2 Unbounded result sets (scale risks; fine at demo volume)

courses full table (course.service.ts:14-17, student-community.service.ts:195-200);
course_professors fallback when a student has no courses (counseling.service.ts:128-130);
escalations inbox no limit (professor-questions.server.ts:124-130) and the student
/ask full-table read (:499-507); getCalendarRequests no limit (professor.service.ts:311-317);
course notices no limit (course-notices.server.ts:36-43); posts' reactions/comments
unbounded for 80 posts; both professor report pipelines read every offering/progress
row university-wide.

### 5.3 Index review (against supabase/schema.sql + migrations)

Existing coverage is good: busy-request query fully served by the partial unique
index counseling_requests_confirmed_slot_idx (schema.sql:359-361); community feed,
reactions, comments, weekly plans, favorites all covered (schema.sql:363-407,
migrations 20260713100000, 20260712000000, 20260713010000). Justified-by-pattern
gaps — all negligible at current row counts, **documented, not applied** (§10 rule:
no blind indexes; live-DB churn not warranted by measured ms today):

1. user_notifications unread-count predicates (`is_read=false` + recipient OR role
   [+ category]) hit 2–4×/page (notifications.service.ts:87-94, 111-120); existing
   indexes cover neither is_read nor category.
2. student_weekly_progress (offering_id, week_number) — only meaningful after the
   professor aggregate is scoped to the professor's offerings.
3. counseling_requests (student_id, created_at desc) — avoids a sort on the
   student request lists.

### 5.4 Oversized RSC props (serialization)

MyPagePlanner receives the full courses table + 4 overlapping post arrays
(mypage/page.tsx:61-68); ProfessorWorkspace receives 17 props / six datasets incl.
university-wide reports (professor/page.tsx:94-115); CounselingWorkspace receives
all professors incl. bios duplicated across two arrays (counseling/page.tsx:27-32).
Flight-payload byte sizes UNVERIFIED (doc sizes in §2.1 bound them: 14–25 KB today).

## 6. Client rendering / hydration

- **KI-013 root structure**: professor/page.tsx:16-28 wraps ProfessorWorkspace in
  `next/dynamic` **inside a Server Component** (no `ssr:false` possible). The
  workspace chunk was verified **eagerly listed** for /professor/page in
  .next/app-build-manifest.json (production build) — the "[Opt 4] lazy load"
  defers nothing; its only effect is the Suspense/lazy hydration seam that
  produces the stuck fallback. It is the only next/dynamic in the codebase.
  Contributing defect: nested `<main>` (app-shell.tsx:64 wraps
  professor-workspace.tsx:608) — invalid HTML; same violation in
  community-board.tsx:399, reviews-board.tsx:136, professor-lounge.tsx:93.
- A second pointless dynamic import: professor-workspace.tsx:350 lazily imports
  professor.actions inside a click handler while the same module is statically
  imported at :22-32 — adds a runtime chunk fetch inside a user action.
- /professor client tree ~3,300 lines hydrates at once (workspace 1,648 + calendar
  648 + report 405 + inbox 393); recharts (chunk ~384 kB raw / ~114 kB gz) ships
  eagerly for a non-default tab (report is 1 of 5; default "schedule",
  professor-workspace.tsx:196). The correct lazy boundary is around
  ProfessorCourseProgressReportView inside the client workspace.
- Rerender hotspots (evidence-backed only): hover-glow-card.tsx:22-29 setState per
  mousemove on the dashboard; ai-tutor-chat.tsx:486-489 re-renders the whole
  525-line chat per keystroke (unmemoized message rows); student-hero-carousel
  interval recreated per tick (:32-38). counseling-workspace.tsx:135-148 filters in
  render body unmemoized (matters only at scale). No high context providers; no
  setState-in-loop effects. Existing memoization in the big list components is
  healthy — blanket memo() is not justified.
- Client components that need not be client: professor-admin-summary.tsx (dead —
  KI-015), shimmer-button.tsx (forwardRef + CSS only).

## 7. Bundle / delivery

- Route splitting is largely healthy: recharts → /professor only; framer-motion
  (43 kB gz) → /chatbot only; radix → 4 routes; zustand → /chatbot; pdf-parse
  correctly server-external (next.config.mjs:18). lucide imports are all named
  (tree-shaken).
- Structural leaks: (a) @supabase/supabase-js rides in the shared shell of every
  AppShell route via NotificationMenu (notification-menu.tsx:7) for a realtime
  channel that is **off by default** (enableRealtime=false, :73) — chunks ~72 kB gz
  on every page; (b) recharts eager on /professor (above).
- CSS: single global stylesheet 152 kB raw / 25.9 kB gz on every route; 96.6 kB is
  hand-written globals.css. tw-animate-css exists for two shadcn wrappers.
- Fonts optimal (next/font Inter, swap). Images: one raw `<img>` hero carousel
  (student-hero-carousel.tsx:67-73, 88–96 kB JPGs, manual fetchPriority) — LCP
  candidate on the dashboard (pre-existing lint warning; Stage 4 candidate).

## 8. Core Web Vitals

TTFB: measured (§2.1). FCP/LCP/INP/CLS: **UNVERIFIED** — the embedded browser
exposed no paint/LCP entries and no RUM tooling exists (Stage 1 had the same gap).
Proxy used instead: TTFB + load event + "workspace usable" (KI-013) as the
user-perceived readiness signal on /professor.

## 9. Bottleneck ranking

Ordering ≈ user impact × frequency × latency contribution ÷ implementation risk.

| Rank | Bottleneck | Evidence | User impact | Est. benefit | Risk | Proposed action |
|---|---|---|---|---|---|---|
| 1 | KI-013: /professor stuck in lazy fallback | §2.4 — 4/4 direct GETs stuck ≥29 s; chunk eager in manifest, so the dynamic() buys nothing | Professor page **unusable** on direct loads | Page becomes reliably usable; no bundle cost | Low — delete the seam (static import); chunk already eager | Static import of ProfessorWorkspace; keep bundle via real lazy boundary at the recharts view (rank 6) |
| 2 | AppShell duplicate profile + notification fetch on ~20 routes, serialized at the tail | app-shell.tsx:33-43; only /dashboard passes props | Every page view pays +1 profiles + 2 notification queries after page data | −3 tail queries/page; shorter TTFB on all routes | Low | `React.cache()` request-memo on getDemoProfile + notification getters (pattern change only) |
| 3 | /dashboard identity re-derivation: 3× auth.getUser + 6× student_courses + ~11 serial stages | §3.1; §2.2 shows dashboard regressed vs Stage 1 | Heaviest student landing page | Remove ~7 redundant round trips; flatten stages | Medium — 3 services share an identity chain | Request-scoped shared identity resolver (cache()); parallelize independent stages |
| 4 | /mypage 4× getPosts triple (12 queries for 3) | §3.2, verified source | 2nd-heaviest student page | −9 queries; −3 serialized stages | Low — pure dedupe, same derivations | Fetch once, derive 4 views; drop dead student_profiles fetch if truly unused |
| 5 | /counseling + /courses independent-but-serialized batches; /professor aggregate plans/progress serialized | §3.3, §3.5, §3.4 | Every counseling/courses view | −1 full WAN stage each | Low | Merge into one Promise.all each (true dependencies respected) |
| 6 | recharts eager on /professor (339 kB First Load) | §6, §7 | All professor visits pay ~114 kB gz for a non-default tab | /professor First Load −~30% | Low-Med — loading state appears on report tab first open | dynamic(ssr:false) around ProfessorCourseProgressReportView **inside** the client workspace |
| 7 | /professor duplicate counseling_requests + duplicate course_offerings scans; unscoped reports | §3.4 (Stage 2 handoff explicitly flags getCalendarRequests fold) | Professor page TTFB + payload | −2..3 queries; bounded payloads | Medium — must preserve list/calendar semantics | Derive limit-12 list from calendar superset; share offerings scan; scope reports to professor (correctness-neutral filter) |
| 8 | supabase-js in shared shell for default-off realtime | §7 | ~72 kB gz on every route's first load | Shared First Load −~30 kB gz (UNVERIFIED exact split) | Medium — lazy-loading a realtime path needs care | Candidate: dynamic-import supabase client only when realtime enabled; measure before/after |
| 9 | No loading.tsx / no streaming anywhere | §3 facts; §2.1 client-nav 479–852 ms frozen UI | Perceived slowness on every navigation | Perceived (not TTFB) improvement | Medium — visual change territory (Stage 4 owns loading UX) | DEFER to Stage 4 except where a confirmed blank/blocking defect appears (§23 rule); re-evaluate after ranks 2–5 land |
| 10 | Unbounded queries & index gaps | §5.2, §5.3 | None measurable at 126-row scale | Future-proofing | n/a | Document for Stage 8 (scale) / record in KNOWN_ISSUES; no live-DB churn in Stage 3 |

Explicitly not pursued (evidence says negligible or out of scope): blanket
memoization, Redis/CDN/queues (Stage 8), transaction redesign (Stage 5), skeleton
redesign (Stage 4), replacing libraries (recharts/framer stay), Intl-conversion
micro-optimization (not the TTFB driver at demo scale).

## 10. Stage 3 performance budgets

Deterministic (test-enforced where practical):

- B1: /professor direct GET renders a usable workspace — 5/5 attempts, desktop +
  mobile, production build (KI-013 gate).
- B2: getCounselingPageData issues ≤ 7 supabase queries in ≤ 2 sequential stages
  (today 7 queries / 3 stages incl. the false dependency) — query-count test.
- B3: getMyPageData executes the posts/reactions/comments triple exactly once
  (today 4×) — query-count test.
- B4: /dashboard student render ≤ 15 supabase queries + ≤ 1 auth.getUser round trip
  (today ~26 + 3) — query-count test at the service seams where feasible.
- B5: AppShell resolves the session profile 0 extra times when the page already
  resolved it (React.cache dedupe) — unit/source test.
- B6: /professor First Load JS ≤ 250 kB (today 339 kB); shared First Load JS
  102 kB ± 2 kB — manifest-based size script (fresh build required).
- B7: All availability/booking regression suites stay green: counseling-slots
  (engine + characterization), calendar-utils.week, availability-consistency,
  counseling-request-security, offering-ownership-gate, session-performance,
  student-timetable suites. Full run reported as "N pass / 3 fail (same KI-002
  trio: admin-notifications ×2, question-notice-workflow ×1)" with failure NAMES
  diffed, not counts.

Report-only (wall-clock, live-DB variance — never CI-asserted):

- R1: warm prod TTFB /dashboard from ~500–560 ms → target ≤ 400 ms.
- R2: warm prod TTFB /mypage from ~410–530 ms → target ≤ 350 ms.
- R3: client-nav RSC round trip mypage↔counseling from 479–852 ms → target ≤ 500 ms
  worst-case sample.
- R4: /professor warm prod TTFB from ~460–600 ms → no regression while fixing KI-013.
