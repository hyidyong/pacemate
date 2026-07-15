# Mobile Dashboard Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce initial mobile dashboard transfer and server-render latency without changing dashboard behavior.

**Architecture:** `DashboardPage` becomes the request-level owner of profile and notification data, while `AppShell` accepts those already-resolved values. Student reads begin together and course progress rows are fetched in one batch. The carousel retains its controls and interval but only assigns network sources to slides needed for the current transition.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase SSR, Node's built-in test runner.

## Global Constraints

- Preserve all dashboard UI, authentication, Supabase schema, routing, and existing hero interaction behavior.
- Do not add packages or modify `next.config.mjs`.
- Keep all existing user changes, including the uncommitted hero carousel feature.

---

### Task 1: Guard Carousel Image Loading

**Files:**
- Modify: `src/components/dashboard/student-hero-carousel.tsx`
- Modify: `src/components/dashboard/student-hero-carousel.test.mjs`

**Interfaces:**
- Produces: `StudentHeroCarousel`, with the active slide and immediate next slide able to load image sources.

- [ ] **Step 1: Write a failing source-level test**

```js
assert.match(source, /const loadedSlideIndexes/);
assert.match(source, /src=\{loadedSlideIndexes\.has\(index\) \? slide\.src : undefined\}/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test src/components/dashboard/student-hero-carousel.test.mjs`

Expected: the new source assertions fail because every slide has a source on initial render.

- [ ] **Step 3: Implement the minimal source guard**

```tsx
const loadedSlideIndexes = new Set([
  currentIndex,
  (currentIndex + 1) % HERO_SLIDES.length,
]);

<img src={loadedSlideIndexes.has(index) ? slide.src : undefined} />
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test src/components/dashboard/student-hero-carousel.test.mjs`

Expected: PASS.

### Task 2: Share Request-Level Shell Data

**Files:**
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- `AppShell` accepts optional `profile`, `notifications`, and `unreadCount` props.
- `DashboardPage` passes those values for its authenticated response.

- [ ] **Step 1: Write a failing source-level test**

```js
assert.match(shellSource, /profile\?: DemoProfile \| null/);
assert.match(pageSource, /<AppShell[\s\S]*profile=\{profile\}/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test src/components/dashboard/student-hero-carousel.test.mjs`

Expected: the assertions fail because `AppShell` always queries its own data.

- [ ] **Step 3: Implement optional inputs with existing fetch fallback**

```tsx
const resolvedProfile = profile ?? await getDemoProfile();
const resolvedNotifications = notifications ?? await getNotificationsForProfile(resolvedProfile, 5);
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test src/components/dashboard/student-hero-carousel.test.mjs`

Expected: PASS.

### Task 3: Parallelize Student Reads and Batch Progress Rows

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/components/dashboard/student-hero-carousel.test.mjs`

**Interfaces:**
- Produces: the same `coursesData`, `todoItems`, `eligibilityResult`, and `recommendationResult` props with fewer request round trips.

- [ ] **Step 1: Write a failing source-level test**

```js
assert.match(pageSource, /const \[myCoursesResult, announcementsResult, studentCourseResult, counselingResult\] = await Promise\.all/);
assert.match(pageSource, /\.in\("course_id", courseIds\)/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test src/components/dashboard/student-hero-carousel.test.mjs`

Expected: assertions fail because student reads are sequential and progress is queried inside a loop.

- [ ] **Step 3: Start independent reads together and map one progress response**

```tsx
const [myCourses, announcements, studentCourses, counselingRows] = await Promise.all([...]);
const { data: progressRows } = await supabase
  .from("student_mission_progress")
  .select("course_id, week_number, calibrated_mission_json")
  .eq("student_id", profile.id)
  .in("course_id", courseIds);
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test src/components/dashboard/student-hero-carousel.test.mjs`

Expected: PASS.

### Task 4: Verify, Rebase, and Publish

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests and typecheck**

Run: `node --test src/components/dashboard/student-hero-carousel.test.mjs && npm run typecheck`

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: Next.js build exits successfully.

- [ ] **Step 3: Rebase and publish**

Run: `git fetch origin main && git rebase origin/main && git push -u origin feat/dashboard-hero-carousel`

Expected: branch is rebased on `origin/main` and available for a pull request.
