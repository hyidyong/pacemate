# Curriculum Query Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a server-only, read-only curriculum query service for the two supported draft curriculum departments.

**Architecture:** Keep the existing Supabase client configuration and reuse the existing server-only client factory. Add focused domain types and pure department/DTO helpers, then query the draft version and its five child collections without assignment or graduation logic.

**Tech Stack:** Next.js, TypeScript, `@supabase/supabase-js`, Node built-in test runner.

## Global Constraints

- Support only law and electronic-engineering departments.
- Query draft versions only; preserve NULL admission years, `source_verified=false`, and unresolved fields.
- Never write to the database, create assignments, activate versions, or calculate graduation eligibility/progress.
- Do not add a new service-role client; use the existing server-only client factory.
- Do not modify UI or onboarding screens.

### Task 1: Domain types and pure helpers

**Files:** Create `src/types/curriculum.ts`; Test `src/types/curriculum.test.ts`.

- Write tests first for supported department parsing, unsupported departments, and preserving unresolved/null fields in DTO mapping.
- Run the direct Node test and confirm failure before implementation.
- Implement typed DTOs and pure helper functions.
- Run the direct Node test and confirm it passes.

### Task 2: Server-only query service

**Files:** Create `src/services/curriculum-query.server.ts`.

- Query `curriculum_versions` by fixed supported version key and `status='draft'`.
- Query courses, requirements, exceptions, tracks, and track courses by the returned version/track IDs.
- Map snake_case rows to typed camelCase DTOs and return preview metadata plus summary counts.
- Return an explicit unsupported result before any database query for other departments.
- Do not import or expose any write operation.

### Task 3: Verification

**Files:** None.

- Run the related direct Node test, `npm run typecheck`, `npm run lint`, read-only Supabase count verification, and `git diff --check`.
- Confirm no write methods or UI/onboarding changes were introduced.
