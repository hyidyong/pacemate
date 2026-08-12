# Stage 8 Handoff — Scale / Reliability / Observability

## Status

COMPLETE — 2026-08-13, on `upgrade/stage-8` from `main` @ 9eeaf78 (the Stage 7
merge, PR #41). Discovery, measurement, Red→Green implementation, regression,
and before/after verification done. Not merged (per workflow). Stage 9 NOT
started.

## Goal

Evidence-based scalability and operational reliability appropriate for a
university platform — multiple universities, tens of thousands of REGISTERED
users, with realistic concurrent timetable/counseling/booking/admin traffic.
Explicitly not a claim to support millions.

## Tested workload and concurrency

Local production build (`next start`) against the LIVE Supabase project, closed
loop, virtual users authenticated through the app's real login action.

| Dimension | Tested |
|---|---|
| Read concurrency | 1 (baseline) and 10 (moderate) virtual users |
| Read scenarios | dashboard, counseling, mypage, courses, professor, admin, login — 7 journeys |
| Booking concurrency | 20 students; 4 contention scenarios |
| Requests issued | ~1,400 read + ~120 mutations per full pass, before and after |

## Observed throughput and latency (c=10, after changes)

| Route | p50 | p95 | p99 | req/s | errors |
|---|---|---|---|---|---|
| `/dashboard` | 542 ms | 821 ms | 1377 ms | 17.0 | 0% |
| `/counseling` | 438 ms | 581 ms | 631 ms | 22.1 | 0% |
| `/professor` | 558 ms | 1015 ms | 1368 ms | 16.0 | 0% |
| `/mypage` | 357 ms | 529 ms | 569 ms | 27.0 | 0% |
| `/courses` | 257 ms | 361 ms | 567 ms | 37.0 | 0% |
| `/admin` | 231 ms | 315 ms | 383 ms | 42.2 | 0% |
| `/login` (no DB) | 75 ms | 94 ms | 122 ms | 129.3 | 0% |

**Error rate: 0% at every tier, before and after.** Timeout rate: 0.

Before/after deltas are within live-database variance in both directions and
**no latency improvement is claimed** — D-008 already established wall-clock
here is too noisy to assert, and with 3 live counseling rows a query bound
cannot show a measurable win. Full table in SCALE_AUDIT §2.

## Database findings

- All access is stateless PostgREST HTTPS; **no `pg` driver and no app-side
  connection pool exist**, so app-side connections are not a scaling axis and
  no pooler was added (D-022). The real ceilings are the PostgREST db-pool, the
  API gateway, GoTrue, and Realtime — all platform-side, categories documented,
  numbers deliberately not fabricated.
- The busy feed was the highest-frequency unbounded read: `status IN
  (pending,approved)` with no time window, growing with cumulative
  platform-wide bookings forever, on every counseling render *and* inside every
  booking action. Now bounded to the 14-day slot horizon.
- Four indexes added, each with a named query behind it. The largest projected
  table (`student_weekly_progress`) had no non-partial index leading with
  `offering_id`.
- `markAllNotificationsRead` issued a platform-wide UPDATE — a correctness bug,
  a tenant-isolation violation, and a lock-contention hazard.

## Connection findings

No pooling to tune; the actionable gap was that **no Supabase client bounded its
requests**. supabase-js has no default timeout, so a hung PostgREST/GoTrue call
occupied the serverless invocation until the platform killed it. All four
factories now pass a bounded `global.fetch` (above the measured p99, below
typical function limits). Bounded failure, no retry.

## Booking contention findings

20 concurrent students, outcomes read back from the database, **10/10 invariant
checks PASS — before and after the Stage 8 changes**:

- capacity never exceeded (1 row, 1 distinct owner, for the contended slot)
- 5 duplicate submits ⇒ exactly 1 row (D-013 idempotency)
- cancellation frees the slot; a 20-way re-book race then produces exactly 1
- 12/12 distinct-slot bookings succeed — the protection serializes contenders
  without serializing unrelated traffic
- 0 storage failures, 0 HTTP 5xx throughout

Measured cost of the protection: p50 ~1.6–2.2 s for 20 students contending one
slot vs ~0.77 s for 12 students on distinct slots. `counseling_requests_no_active_overlap`
verified byte-identical after the migration (D-017 preserved).

## Cache and rate-limit strategy

- **Cache:** unchanged. D-007 (request-scoped `React.cache()` only) still holds;
  nothing is cached across requests. The measured problem was query shape, not
  repetition, and the busy feed is booking-authoritative so it must never be
  cached. Classification of what *would* be safe (catalog, professor directory —
  tenant-keyed, tag-invalidated) is recorded in SCALE_AUDIT §3 for a later
  stage that has a reason.
- **Rate limiting:** deliberately NOT implemented. Reasoning in
  IMPLEMENTATION_PLAN §8 and KI-021 — the concrete abuse vectors were
  authorization holes (closed this stage), no tier showed a rate bottleneck, an
  in-memory limiter on serverless is per-instance theatre, and per-IP scoping is
  wrong behind campus NAT.

## Observability architecture

Log-based, zero-dependency (D-023): structured JSON events with an enforced
field allowlist, an explicit `ok/conflict/denied/user_error/fault` taxonomy
(booking conflicts are never faults), a correlation id minted in middleware, and
Next's `onRequestError` hook. Runtime-verified: a denied login now emits
`{"event":"auth.login_denied","outcome":"denied","level":"warn"}` — it
previously left no server-side trace at all. Metrics are defined as aggregates
over these events; no metrics backend and no tracing were added. Alert
thresholds are directional only — a real baseline does not exist yet.

## Known bottlenecks (remaining)

Full list with evidence in KI-021. Headlines: unbounded professor report reads
(scoping is Stage 9), no pagination anywhere, admin broadcast does not chunk,
notification READ path still untenanted, the middleware auth cost is UNVERIFIED
(depends on a Supabase JWT-signing setting not visible in the repo), and
PostgREST `!inner` join-driver behaviour needs an `EXPLAIN` to confirm.

## Actual tested capacity

- **10 concurrent virtual users** across six authenticated routes, 0% errors,
  p99 ≤ 1377 ms, on a single local production instance.
- **20 concurrent booking mutations** with all Stage 5 invariants intact.
- Live data volume at test time: ~126 rows in the largest table; 27 profiles.

## Estimated / UNVERIFIED capacity

- Hundreds or thousands of concurrent users: **NOT TESTED**. The tiers exist in
  the harness; they were not run because the only Supabase project is live
  production.
- Vercel multi-instance serverless behaviour, cold starts, sustained soak,
  breaking point, recovery: **NOT TESTED**.
- Tens of thousands of REGISTERED users is the architecture's *intent*
  (per-request cost is round-trip-bound; the booking constraint partitions per
  professor) — an ESTIMATE, not a measurement. SCALE_AUDIT §3 ranks which
  queries would degrade first.
- CPU/memory, DB-side latency, connection counts, FCP/LCP/INP/CLS: not
  instrumented — UNVERIFIED, not guessed.

## Files / infrastructure changed

New: `src/lib/observability/{log.ts,request-id.ts}`, `src/instrumentation.ts`,
`src/lib/supabase/fetch-timeout.ts`, `scripts/loadtest/**` (harness),
`supabase/migrations/20260813010000_stage8_hot_query_indexes.sql`,
`docs/upgrade/stage-08/**`.
Modified: `notifications.actions.ts`, `ai-tutor.actions.ts`,
`counseling.service.ts`, `counseling.actions.ts`, `counseling-slots.ts`,
`demo-auth.service.ts`, `sso-audit.ts`, `middleware.ts`, the four Supabase
client factories, and six test files (fake-client surface + loader stubs).
Infrastructure: four indexes applied to the live database. **No new runtime
dependency**; shared JS unchanged at 102 kB.

## Tests / build results

| Check | Result |
|---|---|
| Full suite | 306 tests / 303 pass / **3 fail — the pre-existing KI-002 trio BY NAME** (baseline 289/286/3; +17 Stage 8 tests, all green) |
| Typecheck | clean |
| Lint | baseline (1 pre-existing `no-img-element` warning) |
| Build | PASS — BUILD_ID `4WrGcGd170DNx0xE_GHQf`, all bundle budgets met |
| Stage 6 tenant isolation | **5/5 GREEN** |
| Stage 2/5 invariants | 35/35 GREEN |
| Booking contention | 10/10 PASS (before and after) |
| Live DB teardown | 0 leftover fixtures; 27 profiles / 3 requests / 1 school |

Environment note: `node_modules` was emptied outside the session mid-stage and a
plain `npm ci` reinstalled without devDependencies, producing spurious type
errors and `MODULE_NOT_FOUND`. Fixed with `npm ci --include=dev`.

## Previous-stage regression evidence

Stage 2 availability semantics, Stage 3 performance (bundle budgets met, shared
102 kB unchanged, query inventory unchanged), Stage 4 UI/UX (no user-visible
copy or layout change — the booking failure message is deliberately unchanged),
Stage 5 transactional safety (10/10 invariants; exclusion constraint
byte-identical), Stage 6 tenant isolation (5/5, and one cross-tenant WRITE hole
closed), Stage 7 auth/SSO (sso-audit shape preserved behind the shared logger;
suites green).

## Relevant commits (main..upgrade/stage-8)

`f343f9d` stage kickoff · `a5b3c8f` load harness · `0bdf640` contention harness
· `d03b3c5` four stage documents · `165dc94` P0-1 notification tenant scope ·
`eaa05cd` P0-2 AI authorization · `5ef9371` P1-1 busy-feed bound · `fdf9339`
P1-2 request timeouts · `c151c89` P1-3 indexes · `c009ad1` P2 observability ·
(+ this docs commit).

## Exact next action

1. Push `upgrade/stage-8`; open PR to `main`; external review; fix findings on
   the branch; human-approved merge (do NOT self-merge).
2. Stage 9 starts only after merge.

## Stage 9 inputs

- **KI-021** is the full deferred list. Stage-9-shaped items: notification READ
  tenant scoping (with KI-019), professor report scoping (privacy + unbounded
  reads), `/support` requiring no session, and the anon-policy family that makes
  read isolation DB-enforceable.
- The **anon-role grant gap** found while building the harness: `anon` has no
  SELECT on `counseling_requests` / `professor_admin_tasks` /
  `student_custom_courses`. Real users are unaffected (they query as
  `authenticated`), but any path that loses the GoTrue session while keeping the
  app cookie renders the counseling page's error fallback with zero slots. That
  degradation is now at least logged; making it impossible belongs to the Stage
  9 RLS/grant overhaul.
- The **structured logger** is the seam for KI-020's durable audit sink: swap
  the console emitter for a table write and the sso-audit events carry over
  unchanged.
- The **load harness** (`scripts/loadtest/`) is reusable: point `--baseUrl` at a
  staging deployment and the high/stress/breaking-point tiers run as written.
- Verify the Supabase **JWT signing algorithm** before any auth-cost work.

## Exit gate checklist

- [x] Stage 7 merged and base verified (PR #41 → `main` @ 9eeaf78)
- [x] `upgrade/stage-8` used (never `main`)
- [x] current runtime/deployment architecture audited (SCALE_AUDIT §1, 4 agents)
- [x] realistic workload profiles defined (LOAD_TEST_PLAN §2)
- [x] baseline load tests executed
- [x] critical routes load tested (7 journeys)
- [x] booking concurrency tested under load (20 students, before + after)
- [x] database/query scalability audited
- [x] connection management audited (no app-side pool exists — documented)
- [x] lock/contention behaviour reviewed (per-professor GiST scope; no deadlock
      cycle possible — single-statement transactions)
- [x] cache isolation reviewed (D-007 unchanged; nothing cached cross-request)
- [x] rate limiting reviewed — **deliberately NOT implemented**, reasoning
      recorded (IMPLEMENTATION_PLAN §8, KI-021)
- [x] overload/backpressure behaviour reviewed (timeouts added; no retry by
      design)
- [x] structured observability established (D-023)
- [x] important metrics identified (log-derived; thresholds directional only)
- [x] logs avoid sensitive data (allowlist enforced in code + test)
- [x] failure behaviour tested where practical (hung-upstream injection;
      booking fault path)
- [x] tenant isolation preserved (5/5, plus a cross-tenant write hole closed)
- [x] Stage 5 transaction guarantees preserved (10/10; constraint
      byte-identical)
- [x] Stage 3 performance regressions reviewed (budgets met, 102 kB unchanged)
- [x] before/after evidence recorded (`results/*-after.json`)
- [x] typecheck/lint/tests/build recorded
- [x] DECISIONS updated (D-022, D-023)
- [x] KNOWN_ISSUES updated (KI-021)
- [x] HANDOFF complete (this file)
- [x] CURRENT_STAGE synchronized
- [ ] branch pushed / [ ] PR created — pending (next action)
- UNVERIFIED: capacity beyond 10 concurrent VUs / 20 concurrent bookings;
  Vercel multi-instance behaviour; CPU/memory/DB-side metrics; middleware auth
  cost (JWT alg unknown); PostgREST `!inner` join-driver behaviour; browser-
  rendered QA of the changed paths (no user-visible change was made).
