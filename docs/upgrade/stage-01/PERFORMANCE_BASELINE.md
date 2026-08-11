# Stage 1 — Performance Baseline (2026-08-11)

Environment caveat: measured on `next dev` (development mode, unminified, no build optimizations),
localhost, live Supabase (ap-northeast/us latency applies), Windows 11, demo data volume.
Numbers are a relative baseline for Stage 3 comparison, NOT production-representative.
Method: browser Performance API (`navigation` entry) on warm (second+) full-page loads as demo student.

## Warm full-load timings (dev)

| Route | TTFB | load event | Notes |
|---|---|---|---|
| /dashboard | 610–670 ms | 1.17–1.36 s | transfer 37 KB doc; 15 resources; script transfer ~2.7 MB (dev, unminified) |
| /mypage | 868 ms | 1.41 s | heaviest TTFB of the three |
| /counseling | 612 ms | 1.25 s | |

TTFB dominates: rendering is server-side (all pages `force-dynamic`) and each request performs
its full Supabase query set before any byte is sent. No `loading.tsx` exists anywhere, so users
stare at the previous page during the whole TTFB on every navigation.

## Findings

| Issue | Evidence | User impact | Layer | Severity | Confidence | Later recommendation |
|---|---|---|---|---|---|---|
| Every page is `force-dynamic`; zero static/ISR caching | all 23 `page.tsx` files | full server render + DB round-trips on every navigation | Next.js | High | High | Stage 3: cache/revalidate strategy per route |
| Per-request query waterfall: session → page queries → AppShell re-fetches profile + notifications | `counseling/page.tsx:10-15` → `counseling.service.ts:44-54` (5-query then 2-query stages); `app-shell.tsx:33-43` fetches profile again | TTFB 600–870 ms even warm on localhost | server | High | High | Stage 3: share session/profile per request (React `cache()`), flatten stages |
| Profile/session resolved multiple times per request | page + AppShell both call `getDemoProfile()` | duplicate auth/profile queries every page | server | Medium | High | Stage 3: request-scoped memoization |
| Counseling queries load ALL professors' rows globally (no professor filter) | `getAvailabilityRows`/`getTeachingSlots`/`getBusyRequests`/`getAdminTasksRows` (counseling.service.ts:232-255 et al.) unfiltered | fine at demo scale; scales linearly with tenant size | DB | Medium (future) | High | Stage 3/8: filter by relevant professors, index review |
| No `loading.tsx`/skeletons anywhere; no Suspense streaming | repo-wide glob | perceived slowness = full TTFB blocking | UX/Next.js | High | High | Stage 3: streaming + skeletons (UI-neutral) |
| Script transfer ~2.7 MB in dev | Performance API resource sum | dev-only figure; prod bundle UNVERIFIED | build | UNVERIFIED | — | Stage 3: measure `next build` output + analyze |
| Realtime channel per header instance | notification-menu.tsx (desktop instance only subscribes) | acceptable; one channel/user | client | Low | Medium | — |
| RLS permission-denied errors swallowed into empty states (posts, student_custom_courses; one 500 observed) | dev-server console during role-switch browsing 2026-08-11 | data silently missing; wasted queries | server/RLS | Medium | Medium (exact repro path UNVERIFIED) | Stage 2/9: fix policies or stop querying as wrong role |

## Not measured (UNVERIFIED)

- Production bundle sizes (`next build` was run for compile validation only; size analysis deferred).
- LCP/CLS/INP field metrics (no RUM tooling exists).
- Database query timings server-side (no instrumentation; only TTFB proxy).
- Cold-start / first-compile timings (dev compile noise excluded deliberately).
