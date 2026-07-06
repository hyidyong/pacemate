# PaceMate Step 1 Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js app skeleton for PaceMate with all MVP top-level routes present and a passing build.

**Architecture:** Use Next.js App Router with a shared app shell, route metadata, and lightweight shadcn-style UI primitives. This step intentionally avoids Supabase, OpenAI, and real persistence so later steps can add them without debugging unrelated scaffold issues.

**Tech Stack:** Next.js, React, TypeScript, CSS variables, lucide-react, class-variance-authority, clsx, tailwind-merge.

---

### Task 1: Project Foundation

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `components.json`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/lib/utils.ts`

- [ ] Create project configuration with scripts: `dev`, `build`, `start`, `lint`, and `typecheck`.
- [ ] Add base layout metadata for PaceMate.
- [ ] Add shadcn-compatible `cn()` utility and component aliases.

### Task 2: Shared UI and Navigation

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/layout/app-shell.tsx`
- Create: `src/lib/navigation.ts`

- [ ] Add reusable button and card primitives.
- [ ] Add a responsive shell with desktop navigation and mobile-friendly wrapping.
- [ ] Define route metadata for all PRD top-level screens.

### Task 3: Route Placeholders

**Files:**
- Create: `src/app/page.tsx`
- Create one `page.tsx` for each route: `login`, `onboarding`, `dashboard`, `roadmap`, `courses`, `community`, `reviews`, `chatbot`, `counseling`, `admin`, `professor`.

- [ ] Make the home screen show the first-step product map.
- [ ] Make each route render a clear "ready for next step" screen with relevant MVP items.

### Task 4: Verify

- [ ] Run `pnpm install`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Start `pnpm dev` and confirm the local URL.
