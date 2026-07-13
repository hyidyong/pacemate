# PaceMate Final Product Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize PaceMate, add grounded professor answers, safe retrieval, PWA notification preferences, professor analytics, student recommendations, and least-privilege Auth/RLS hardening, then deploy the verified result to production.

**Architecture:** Preserve the existing Next.js App Router, request-scoped Supabase SSR client, profile-to-Auth mapping, and demo-cookie compatibility. Add focused server-only services and small UI extensions; create new fail-closed migrations only when persistent storage or privileges are necessary. Keep retrieval deterministic before considering embeddings, and keep all identity and ownership resolution on the server.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase Auth/Postgres/RLS, pnpm, Node test runner, Vercel.

## Global Constraints

- Never modify or stage `docs/architecture/curriculum-graduation-migration-review.md`.
- Never use or expose a Supabase service-role key; never insert into `auth.users`.
- Preserve the protected stash and demo-cookie compatibility.
- Resolve all identities and resource ownership server-side; never trust externally supplied identifiers.
- Do not infer credits, admission years, required-course status, graduation requirements, grades, or graduation eligibility.
- Use new migrations only, keep reference/demo seeds separate, and perform read-only preflight and postflight for every DB change.
- Use pnpm for all dependency and verification commands.
- Before every commit, run `git diff`, `git diff --check`, and `git status --short`, then stage only intended files.

---

### Task 1: Baseline and reproducible stabilization

**Files:**
- Modify only files implicated by reproducible failures under `src/app`, `src/components`, `src/services`, and `src/lib`.
- Test with focused `*.test.mjs` files beside pure helpers.

**Interfaces:**
- Consumes: current `main` at `f4da6ee`, existing Supabase SSR session helpers and server actions.
- Produces: stable role-scoped pages and server actions without raw database error leakage.

- [x] **Step 1:** Confirm clean `main`, matching `origin/main`, protected document untouched, and protected stash present.
- [x] **Step 2:** Create `feat/final-product-hardening` without discarding work.
- [x] **Step 3:** Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and enumerate existing tests.
- [ ] **Step 4:** Inspect role pages, mutations, navigation, null states, timezone handling, and server/client boundaries; record only reproducible defects.
- [ ] **Step 5:** For each defect, add a focused failing test where a pure boundary exists, implement the smallest ownership-safe fix, and rerun checks.
- [ ] **Step 6:** Commit intended files as `fix: stabilize core application flows`.

### Task 2: Grounded professor answer pipeline

**Files:**
- Modify: `src/services/professor-questions.server.ts`, `src/services/professor-question.actions.ts`, `src/components/professor/professor-question-inbox.tsx`.
- Reuse: existing FAQ, syllabus, weekly-plan, notice, and professor-answer records discovered during inspection.
- Test: add focused source-filtering and answer-policy tests beside the new pure retrieval helper.

**Interfaces:**
- Produces: a course/offering-authorized context bundle, grounded draft response, source labels, uncertainty state, and audited response mode.

- [ ] **Step 1:** Inventory current provider abstraction and authorized source tables; do not introduce a provider if none is required.
- [ ] **Step 2:** Write tests proving cross-course and unapproved sources are rejected and unsupported questions require professor review.
- [ ] **Step 3:** Implement deterministic source collection scoped by authenticated professor ownership.
- [ ] **Step 4:** Add an injection-resistant answer context that treats source text as untrusted facts only.
- [ ] **Step 5:** Preserve professor edit/approve/reject control and audit manual, deterministic-rule, and reviewed-AI outcomes.
- [ ] **Step 6:** Commit as `feat: improve grounded professor answers`.

### Task 3: FAQ and approved course-knowledge retrieval

**Files:**
- Create focused retrieval types/helpers/services under `src/types`, `src/lib`, and `src/services` after schema discovery.
- Modify professor and student question UI only to show concise source labels and safe empty states.
- Create a new migration with `supabase migration new` only if existing structured records cannot represent approved sources.

**Interfaces:**
- Produces: exact/category match, deterministic text match, optional normalized similarity, stable source identifiers, and authorization-safe results.

- [ ] **Step 1:** Inspect pgvector, chunks, uploads, syllabus text, FAQs, notices, weekly plans, and approved answers.
- [ ] **Step 2:** Prefer existing structured retrieval; justify vector infrastructure before adding it.
- [ ] **Step 3:** Test exact FAQ matching, cross-course rejection, unapproved exclusion, stable deduplication, and safe fallback.
- [ ] **Step 4:** Implement server-only retrieval and source display without exposing UUIDs.
- [ ] **Step 5:** If schema changes are required, complete read-only preflight, new migration, static review, apply, and postflight.
- [ ] **Step 6:** Commit as `feat: add grounded course knowledge retrieval`.

### Task 4: PWA and explicit browser notification preferences

**Files:**
- Inspect/modify: `src/app/layout.tsx`, Next configuration, existing notification types/services/components.
- Create: manifest, safe service worker/registration helper, preference UI, and tests as justified by current structure.
- Create a new migration only for verified-profile subscriptions/preferences when existing tables are insufficient.

**Interfaces:**
- Produces: installability, explicit permission request, category preferences, quiet hours, and verified-profile subscription lifecycle.

- [ ] **Step 1:** Audit current manifest, worker, notification tables, preferences, consent UI, and deployment HTTPS.
- [ ] **Step 2:** Add tests for permission-state mapping, preference validation, quiet hours, and worker registration.
- [ ] **Step 3:** Add a service worker that never caches private pages, Supabase Auth, or authenticated API responses.
- [ ] **Step 4:** Add user-triggered permission/preferences UI while preserving in-app notifications.
- [ ] **Step 5:** Add server-owned subscription operations; if VAPID credentials are absent, stop at the supported foundation and report exact required secret names.
- [ ] **Step 6:** Commit as `feat: add notification preferences and PWA support`.

### Task 5: Professor analytics extension

**Files:**
- Modify: existing professor report services/types/components.
- Test: pure aggregation and minimum-group suppression helpers.

**Interfaces:**
- Produces: enrollment/progress/review totals, weekly trends, difficulty/understanding averages, question/counseling/answer metrics, and neutral labels.

- [ ] **Step 1:** Map existing report queries and indexes and identify missing metrics without N+1 reads.
- [ ] **Step 2:** Test group-size suppression below five and exclusion of identifiers/private notes/guide JSON.
- [ ] **Step 3:** Extend server-only aggregation and responsive existing report UI with explicit empty/error states.
- [ ] **Step 4:** Add a reviewed index migration only when query evidence justifies it.
- [ ] **Step 5:** Commit as `feat: extend professor analytics dashboard`.

### Task 6: Evidence-based student recommendations

**Files:**
- Create recommendation types, deterministic helper tests, server-only service, and a small student dashboard/roadmap section.
- Reuse approved weekly plans, own progress, tasks, counseling, unresolved questions, and approved sources.

**Interfaces:**
- Produces: reasoned next-week, review, material, counseling/task, and unanswered-question recommendations scoped to the authenticated student.

- [ ] **Step 1:** Define deterministic input/output without grades, opaque scores, or graduation claims.
- [ ] **Step 2:** Test ownership, evidence reasons, ordering, and insufficient-data behavior.
- [ ] **Step 3:** Implement server-only identity resolution and minimal-column reads under RLS.
- [ ] **Step 4:** Add responsive UI with course/week/source explanation and safe errors.
- [ ] **Step 5:** Persist dismiss/snooze only if existing architecture supports it without unnecessary schema.
- [ ] **Step 6:** Commit as `feat: add student learning recommendations`.

### Task 7: Auth/RLS operational hardening

**Files:**
- Create read-only inventory notes outside the protected document.
- Create new fail-closed migrations with Supabase CLI only for confirmed privilege/policy gaps.
- Modify high-risk client mutations into request-scoped server actions where needed.

**Interfaces:**
- Produces: `profiles.auth_user_id` ownership, course/offering professor authorization, self-owned student access, and documented demo-only limitations.

- [ ] **Step 1:** Read-only inventory all profiles, grants, policies, permissive demo paths, and unmapped identities.
- [ ] **Step 2:** Flag broad privileges and identifier-trusting mutations; verify each replacement path before revoking access.
- [ ] **Step 3:** Add tests for auth mapping, cross-user denial, and demo-cookie compatibility.
- [ ] **Step 4:** Create, statically review, preflight, apply, and postflight only necessary new migrations.
- [ ] **Step 5:** Commit as `chore: harden production access policies`.

### Task 8: Full regression, integration, and deployment

**Files:**
- Modify only focused fixes discovered by regression.
- Never stage the protected document.

**Interfaces:**
- Produces: verified feature branch, merged `main`, pushed commits, and exact Vercel Ready deployment.

- [ ] **Step 1:** Run all tests plus `pnpm install --frozen-lockfile`, typecheck, lint, build, and diff checks.
- [ ] **Step 2:** Perform student/professor/admin browser checks with console, hydration, error, UUID, duplicate-submit, and authorization inspection.
- [ ] **Step 3:** Push `feat/final-product-hardening`, update `main`, merge with `--no-ff`, and rerun the complete suite.
- [ ] **Step 4:** Push `main`, verify GitHub checks, exact commit, and Vercel status; fix until Ready.
- [ ] **Step 5:** Perform non-destructive production smoke tests and confirm protected document/stash remain untouched.
