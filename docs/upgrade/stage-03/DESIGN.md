# Stage 3 — Design

Written 2026-08-12 after the measurement phase (see PERFORMANCE_AUDIT.md — all
evidence citations live there).

## 1. Existing performance architecture

Next.js 15 App Router, React 19, all 23 pages `force-dynamic` RSC; server actions
only; Supabase over WAN (supabase-js builder; anon/session/admin client tiers +
signed demo HMAC cookie); no client query library — RSC props → useState; one
Zustand store (/chatbot only); coarse `revalidatePath` invalidation everywhere;
**zero caching at any layer** (no React.cache, no Router Cache retention, no
loading boundaries). Per-request cost = middleware getClaims + page query
waterfall + AppShell tail refetch, all serialized before the first byte.

## 2. Stage 1 baseline comparison

Stage 1 (dev, warm): dashboard TTFB 610–670 / mypage 868 / counseling 612 ms.
Stage 3 start (dev, same method): 875–1014 / 752 / 598 ms — dashboard regressed
via the post-Stage-1 card-service chains; others comparable. See AUDIT §2.2.

## 3. Current measured baseline (canonical for Stage 3)

Production, warm, desktop: dashboard TTFB 497–563, mypage 412–528, counseling
285–328, courses 284, professor 458–597 ms; client-nav RSC round trips 479–852 ms;
/professor workspace stuck (KI-013) 4/4 direct GETs; bundle: shared 102 kB,
/professor 339 kB First Load. See AUDIT §2.

## 4. Critical-path bottlenecks (ranked)

See AUDIT §9. Top: (1) KI-013 stuck professor workspace; (2) AppShell tail
duplicate profile+notifications on ~20 routes; (3) dashboard identity
re-derivation (~26 queries, ~11 serial stages); (4) mypage 4× getPosts;
(5) independent-but-serialized batches; (6) recharts eager on /professor;
(7) professor duplicate queries.

## 5. Optimization strategy per layer

### 5.1 Request/cache strategy — request-scoped memoization ONLY

Decision: introduce `React.cache()` request-scoped memoization for identity and
notification reads. **No cross-request caching of any scheduling data is
introduced anywhere in Stage 3.** Availability, slots, busy requests, bookings —
all remain freshly queried per request, exactly as today.

§18 cache-safety questionnaire, answered for React.cache():

- What is cached? `getDemoProfile()` result, notification list/count, and a
  shared auth-identity resolution (auth.getUser + profiles row); later possibly
  the per-request Supabase server client.
- Where? In-memory, per RSC render pass (React's request-scoped cache).
- Key? Function identity + serialized args within ONE server render.
- TTL? The lifetime of a single request render. Nothing survives the response.
- What invalidates it? End of request (automatic). `revalidatePath` semantics
  unchanged.
- After booking / cancellation / schedule modification? The next request
  re-executes every query — identical freshness to today.
- Could one user receive another's data? No — the cache never spans requests;
  concurrent requests have isolated cache stores (React per-request store).
- Could stale availability allow an invalid booking attempt? No — availability
  reads are not memoized across requests; within one request the data is a
  single consistent snapshot (an improvement over today's N reads racing writes).

### 5.2 Waterfall removal

Merge only awaits with no true data dependency (verified per call in the audit):
counseling batch 1 ∥ batch 2; courses summaries ∥ favorites; professor aggregate
plans ∥ progress; dashboard card chains after the shared identity resolves.
Dependencies that are real (mission progress ← course ids; course_professors ←
student course ids; offerings ← ownership) stay sequential.

### 5.3 Request deduplication (root cause, not masking)

- AppShell: keep the existing prop-passing contract, make the underlying getters
  `cache()`-wrapped so the page's own calls and AppShell's fallback calls collapse
  into one execution per request. Root cause (two callers, no request memo) fixed;
  no component API change.
- /mypage: `getPosts` triple executes once; my/scraped/liked/commented views
  derive from the single result (same filter logic, same output shapes).
- /dashboard: one identity resolution shared by the three card services.
- /professor: the limit-12 management list derives from the unbounded calendar
  superset (same columns; same ordering/limit applied in JS); the two report
  services share one course_offerings scan. Output-identical by construction —
  NO scoping change to report content in Stage 3 (see §9 deferred).

### 5.4 Database optimization strategy

No schema changes, no new indexes in Stage 3: at 3-professor/126-notification
demo volume, no query's row volume contributes measurable latency (AUDIT §5.0);
round-trip count is the lever, addressed above. Justified index candidates and
unbounded-query bounds are recorded for Stage 8 (AUDIT §5.2–5.3, KNOWN_ISSUES).

### 5.5 Client rendering strategy

- Fix KI-013 by deleting the pointless Server-Component `next/dynamic` seam
  (static import). The chunk is already eager — no bundle regression.
- Fix invalid nested `<main>` in professor-workspace (→ `<div>`/`<section>`,
  class names preserved so styling is unchanged) — removes the hydration-hostile
  invalid HTML that the stuck state orphans. (Other nested-main files are display
  pages without dynamic seams — recorded in KNOWN_ISSUES for Stage 4, not churned
  here.)
- Remove the pointless inline `import("@/services/professor.actions")` in a click
  handler (module already statically imported).
- No blanket memoization. Identified rerender hotspots (hover-glow mousemove,
  chat keystroke) are recorded; only fixed in Stage 3 if a measurement shows they
  affect a critical journey (they do not today — deferred).

### 5.6 Bundle strategy

- Real lazy boundary where it pays and is legal: `dynamic(..., { ssr: false })`
  around the recharts-heavy `ProfessorCourseProgressReportView` INSIDE the client
  workspace (report tab is non-default, 1 of 5). Loading fallback appears only on
  first open of that tab — not a critical interactive control (§22 compliant).
- Shared-shell supabase-js extraction (rank 8): deferred unless trivially safe —
  measured candidate documented (AUDIT §7); realtime path must keep working when
  enabled.
- Bundle guard: manifest-based size script (node, no new deps) comparing
  per-route first-load bytes from `.next/app-build-manifest.json` against budgets
  (B6) — run after fresh builds, not in the default test glob.

## 6. Correctness safeguards

- Stage 2 invariant suites must stay green after every task: counseling-slots
  (engine + characterization), calendar-utils.week, availability-consistency
  (identity-level), counseling-request-security, offering-ownership-gate,
  session-performance, student-timetable suites, demo-session.
- New deterministic query-count tests (transpile-loader + counting thenable fake
  client — Agent D recipe) for getCounselingPageData and getMyPageData written
  BEFORE their optimizations (Red → Green on the count where the count is the
  fix; characterization-GREEN for pure re-orderings).
- Full-suite reporting convention: "N tests / M pass / 3 fail (same KI-002 trio)"
  with failing test NAMES diffed before/after, never bare counts.
- Booking/cancellation freshness: no cross-request cache exists to go stale;
  runtime QA re-verifies booking → slot-count decrement → professor busy hole
  (Stage 2 QA script) after the optimization set lands.

## 7. Rollback risks

- Each task is one commit; revert = `git revert <commit>` with no data/schema
  coupling anywhere (no migrations in Stage 3).
- React.cache wrapping changes function identity (exported const vs function
  declarations) — the risk is a service calling a stale un-wrapped alias; guarded
  by source tests + typecheck.
- Static-importing ProfessorWorkspace removes the loading fallback during initial
  chunk load; since the chunk was already preloaded eagerly, no regression is
  expected — verified by runtime QA (B1) and bundle diff.
- Deriving the professor management list from the calendar superset could change
  list content if the two queries' predicates ever diverge — pinned by comparing
  both query shapes in the commit and a unit test on the derivation.

## 8. Explicitly deferred work

- loading.tsx / streaming / skeletons — Stage 4 (visual redesign authority);
  re-evaluated there with the post-Stage-3 TTFB numbers.
- Professor report scoping (currently university-global data visible to any
  professor — also a privacy concern) — recorded in KNOWN_ISSUES for Stage 6/9;
  changing it now would change displayed content (breaks behavior-preservation).
- Index additions (user_notifications unread, student_weekly_progress
  (offering, week), counseling_requests (student, created_at)) — Stage 8.
- Unbounded-query bounds (escalations, course notices, calendar requests, courses
  table) — Stage 8, with product decisions on limits.
- supabase-js shared-shell extraction — candidate only, measured, not committed.
- Rerender hotspots (hover-glow mousemove, chat keystroke rerender,
  carousel interval) — Stage 4 UX work or when measurements demand.
- KI-004 booking-refresh UX (`router.refresh()` after booking) — pre-existing,
  Stage 4/5.
- Other nested-`<main>` violations on non-flaky routes — Stage 4.
