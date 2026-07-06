# Roadmap Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first roadmap screen where a student can scan this semester's timetable, tap a course, and read recommended course order, prerequisite knowledge, and study methods.

**Architecture:** Keep the first slice deterministic and low-risk: static typed roadmap data plus a client explorer component. The page remains server-rendered and passes data into the interactive client component, so later Supabase/AI-generated roadmap results can replace the seed data without changing the UI contract.

**Tech Stack:** Next.js App Router, React 19, TypeScript, existing CSS component system, lucide-react icons.

---

### Task 1: Typed Roadmap Data

**Files:**
- Create: `src/data/roadmap-explorer.ts`

- [ ] **Step 1: Add typed course roadmap data**

Create `src/data/roadmap-explorer.ts` exporting `RoadmapCourse`, `roadmapSemester`, and `roadmapCourses`. Include the sample syllabus course plus three companion law courses so the timetable can behave like a real semester.

- [ ] **Step 2: Run typecheck**

Run: `node .\node_modules\typescript\bin\tsc --noEmit`
Expected: PASS with no TypeScript errors.

### Task 2: Interactive Explorer Component

**Files:**
- Create: `src/components/roadmap/roadmap-explorer.tsx`

- [ ] **Step 1: Build client component state**

Create a `"use client"` component that receives `semesterLabel` and `courses`, stores `selectedCourseId` in `useState`, and derives `selectedCourse`.

- [ ] **Step 2: Build mobile-first timetable list**

Render course buttons with day/time/location/professor. Each button updates the selected course and exposes `data-testid="roadmap-course-{id}"`.

- [ ] **Step 3: Build course detail panel**

Render recommendation order, prerequisite knowledge, general study method, course-specific study method, and weekly focus items for the selected course.

### Task 3: Roadmap Page Integration And Styling

**Files:**
- Modify: `src/app/roadmap/page.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace placeholder roadmap page**

Use `AppShell`, page hero copy, and `RoadmapExplorer`.

- [ ] **Step 2: Add responsive styles**

Add `.roadmap-*` CSS classes for timetable list, selected states, detail panel, phase list, knowledge tags, and mobile one-column layout.

### Task 4: Verification

**Files:**
- No source changes unless verification finds defects.

- [ ] **Step 1: Typecheck**

Run: `node .\node_modules\typescript\bin\tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Production build**

Stop the dev server first, then run: `node .\node_modules\next\dist\bin\next build`
Expected: PASS.

- [ ] **Step 3: Browser workflow**

Open `/roadmap`, verify no console errors, click at least two course cards, confirm the detail panel changes, and test a mobile viewport for horizontal overflow.
