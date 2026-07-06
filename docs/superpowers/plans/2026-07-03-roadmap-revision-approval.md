# Roadmap Revision Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a professor-to-admin approval flow for roadmap edits, with approved changes reflected on student roadmap screens and notifications linking users to the relevant page.

**Architecture:** Store professor roadmap edit proposals in Supabase as revision requests. Professor pages create requests, admin pages approve or reject them, and student roadmap pages merge the latest approved revision into the existing roadmap course data. A lightweight notification table exposes question, counseling, and approval events as linkable alerts.

**Tech Stack:** Next.js App Router, React client components, Supabase Postgres/RLS via `@supabase/supabase-js`, existing CSS in `src/app/globals.css`.

---

### Task 1: Database Schema

**Files:**
- Modify: `supabase/schema.sql`
- Live DB: Supabase project `szztsqdnvenfbgxtylkl`

- [x] Create `roadmap_revision_requests` with `pending -> assistant_reviewed -> approved/rejected` status.
- [x] Create `user_notifications` with `target_href` for direct navigation.
- [x] Grant explicit Data API privileges because Supabase now requires explicit grants for newly exposed tables.
- [x] Enable RLS and add demo policies for anon MVP access.
- [x] Seed one pending professor roadmap request and one admin notification for the demo.
- [x] Run Supabase security advisors and fix warnings.

### Task 2: Roadmap Merge Service

**Files:**
- Create: `src/services/roadmap-revisions.service.ts`
- Modify: `src/app/roadmap/page.tsx`

- [x] Fetch approved roadmap revisions from Supabase.
- [x] Merge approved fields into `roadmapCourses` without changing the existing component contract.
- [x] Pass merged courses to `RoadmapExplorer`.

### Task 3: Professor Revision Requests

**Files:**
- Modify: `src/services/professor.service.ts`
- Modify: `src/services/professor.actions.ts`
- Modify: `src/components/professor/professor-workspace.tsx`
- Modify: `src/app/globals.css`

- [x] Load the professor's existing roadmap requests.
- [x] Add a professor form for course/department roadmap changes.
- [x] Insert requests as `pending` and create an admin notification.
- [x] Revalidate `/professor`, `/admin`, and `/roadmap`.

### Task 4: Admin Approval Screen

**Files:**
- Create: `src/services/admin-approval.service.ts`
- Create: `src/services/admin-approval.actions.ts`
- Replace: `src/app/admin/page.tsx`
- Modify: `src/app/globals.css`

- [x] List pending, assistant-reviewed, approved, and rejected roadmap requests.
- [x] Let assistant users mark `assistant_reviewed`.
- [x] Let admin users approve or reject.
- [x] Create professor/student notifications after status changes.

### Task 5: Notifications

**Files:**
- Create: `src/services/notifications.service.ts`
- Create: `src/components/notifications/notification-strip.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/professor/page.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/globals.css`

- [x] Display recent unread notifications as compact link chips.
- [x] Link each alert directly to `/community`, `/professor`, `/admin`, or `/roadmap`.

### Task 6: Verification

**Commands:**
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/next/dist/bin/next build`
- Browser QA at `/professor`, `/admin`, `/roadmap`, `/dashboard` on mobile and desktop widths.
- `npx vercel deploy --prod --yes`
- `npx vercel logs <deployment> --since 1h --level error`
