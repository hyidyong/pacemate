# Stage 1 — System Baseline (as of 2026-08-11, branch `upgrade/stage-1` @ bbd3aa3)

## Stack (verified from repo)

| Layer | Technology |
|---|---|
| Frontend framework | Next.js 15 (App Router, `src/app`), React 19 |
| Rendering model | All 23 pages are Server Components with `export const dynamic = "force-dynamic"` (zero static caching); interactivity in `"use client"` workspace components |
| Backend architecture | Next.js server actions + server-side service modules (`src/services/*.server.ts`, `*.actions.ts`); no API `route.ts` files |
| Database | Supabase (PostgreSQL), project `szztsqdnvenfbgxtylkl.supabase.co` — LIVE (verified 2026-08-11 via `/auth/v1/health`) |
| ORM/query layer | `@supabase/supabase-js` query builder directly; no ORM |
| Authentication | `@supabase/ssr` session in `src/middleware.ts` → `updateSupabaseSession` (`src/lib/supabase/proxy.ts`) + signed demo cookie (`src/services/session.service.ts`, `src/lib/auth/demo-session.ts`) |
| Authorization | Per-page role guards (`src/services/role-guard.service.ts`, e.g. `redirectNonStudent`); Supabase RLS policies in `supabase/migrations/` |
| State/query cache | No react-query/SWR. RSC fetch → props → local `useState`. One Zustand store (`src/store/app-store.ts`: mobile tab [vestigial] + AI-tutor chat cache). localStorage for student todos |
| Package manager | npm (`package-lock.json`); a stray `pnpm-lock.yaml`/`pnpm-workspace.yaml` exists — npm is what docs use |
| Testing stack | Node built-in `node:test` + `node:assert/strict`; 50 colocated `src/**/*.test.mjs` files importing `.ts` via Node 24 type-stripping. No test script in package.json; invoked as `node --test <file>` |
| E2E stack | None installed |
| Build system | `next build`; Tailwind CSS 4 via PostCSS |
| Deployment | Vercel (`.vercel/` present) |
| Monitoring | None |
| CI | None (no `.github/workflows`) |

Env (`.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (new-style key — no legacy anon key), `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `PACEMATE_SESSION_SECRET`.

## Route map

All pages server components, `force-dynamic`. No route groups, no per-route `loading.tsx`, single root `src/app/error.tsx`.

| Route | Main client component |
|---|---|
| `/` | landing (server only) |
| `/login` | `components/login/demo-login-button.tsx` |
| `/onboarding` | `student-onboarding-workspace.tsx`, `electronic-engineering-onboarding-workspace.tsx` |
| `/dashboard` | `student-dashboard-content.tsx` + widgets |
| `/mypage` | `my-page-planner.tsx` (timetable) |
| `/roadmap`, `/roadmap/[courseId]` | `student-roadmap-workspace.tsx` |
| `/courses`, `/courses/[id]` | `register-course-button/dialog.tsx`, `favorite-course-button.tsx` |
| `/counseling` | `counseling-workspace.tsx` |
| `/community`, `/reviews`, `/chatbot`, `/ask`, `/notices`, `/support` | respective boards/forms |
| `/notifications`, `/notifications/settings` | `notification-list.tsx`, `notification-preferences-panel.tsx` |
| `/professor` (+ `/lounge`, `/mypage`, `/weekly-plan-preview`) | `professor-workspace.tsx` (tab/sub via searchParams) |
| `/admin` | `admin-notification-console.tsx` |

## Navigation / responsive model

- Shell: `src/components/layout/app-shell.tsx` (async server component; fetches profile + notifications itself).
- Single responsive breakpoint: **md (768px)**. Two headers rendered simultaneously (desktop `hidden md:flex`, mobile sticky `flex md:hidden`) in `app-header-professor-safe.tsx`.
- Student mobile bottom nav (`mobile-bottom-nav.tsx`): only `/dashboard, /roadmap, /chatbot, /mypage` — counseling/courses/community reachable on mobile only via hamburger.
- Professor mobile bottom nav keyed to `/professor?tab=` query params.

## Data-flow pattern (canonical for this app)

```text
Supabase (RLS)
↓
service module (src/services/*.server.ts) or lib pure function (src/lib/*)
↓
page.tsx (RSC, force-dynamic) → props
↓
"use client" workspace component → useState seeded from props
↓
mutation = server action → revalidatePath + (sometimes) router.refresh()
```

Refetch inconsistency: mypage/roadmap actions call `router.refresh()` after success; **counseling workspace does not** — after booking, client state goes stale until navigation.

## Test suite baseline (executed 2026-08-11)

```text
node --test "src/**/*.test.mjs"
tests 142 / pass 139 / fail 3
```

Failures (all pre-existing on bbd3aa3; stale source-regex assertions, not behavior bugs):
1. `src/services/admin-notifications.test.mjs` — "admin broadcasts fan out…" expects `data.map((recipient) => ({…` but code now dedupes into `recipientsToInsert.map(…)` (broadcast dedup feature added later).
2. `src/services/admin-notifications.test.mjs` — "broadcast UI…" expects `newestFirst([next,` but code now wraps with `dedupeMenuNotifications([next, …])`.
3. `src/services/question-notice-workflow.test.mjs` — expects `from("chat_messages")` in a source file that no longer references it after refactor.

Slot/availability tests all pass: `src/lib/counseling-slots.test.mjs` (5/5), `src/services/student-timetable.rules.test.mjs`, `src/lib/student-timetable.test.mjs`.

## Fixtures / seed / demo

- `supabase/schema.sql` (snapshot), `supabase/migrations/` (33+ SQL migrations), `supabase/seed/` (9 seeds incl. demo student/professor links).
- `scripts/ensure-demo-operator-auth.mjs` creates demo auth users (assistant1@pacemate.edu / password123 etc.) via service-role key.

## Known baseline quirks (frontend, static analysis — candidates for later stages)

- Counseling month calendar derives its month from the first slot (`counseling-workspace.tsx:93`); slots in the following month are invisible; cannot page months.
- Counseling client never refreshes after booking (no `router.refresh()`).
- Page-level fetch failures are swallowed into empty defaults (`.catch` → `console.error`) — error states indistinguishable from empty states on dashboard/mypage/counseling.
- Zustand `activeTab` unused by real navigation (vestigial).
- No `loading.tsx` anywhere; full-page navigations have no skeletons.
- Dashboard cards "과목 · 학기 완료 근거" and "다음 학습 추천" rendered error fallbacks at runtime on 2026-08-11 (demo student) — cause UNVERIFIED (likely demo-data state, not code).
