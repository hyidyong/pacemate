# Stage 8 Handoff — Scale / Reliability / Observability

## Status

COMPLETE, revised after external review — 2026-08-13, on `upgrade/stage-8` from
`main` @ 9eeaf78 (the Stage 7 merge, PR #41). Discovery, measurement, Red→Green
implementation, regression, and before/after verification done; the six PR #42
review findings are verified and fixed (see "External review round"). Not
merged (per workflow). Stage 9 NOT started.

## External review round (PR #42)

Six findings were each verified against the branch and the installed SDKs
before any change. **All six were confirmed** — none needed push-back — but two
were materially different from their description:

- **Finding 1 was worse than reported.** The Stage 8 timeout did not merely
  fail to bound retries; it *caused* them. `AbortSignal.timeout()` rejects with
  `TimeoutError`, and postgrest-js 2.110.1 suppresses retries only for
  `AbortError`/`ABORT_ERR`, so a hung GET became **4 fetches over 8.3s against
  a 300ms budget**, amplifying load on a struggling database. Fixed by aborting
  with a real `AbortError` and sharing one deadline per endpoint burst.
- **Finding 3 was wider than reported.** Beyond the bulk path, the two
  *targeted* by-id writes still used the untenanted predicate, so a known or
  enumerated UUID from another tenant could be marked read — and
  `markNotificationReadAndGo` additionally followed that row's `target_href`.
  One predicate now serves all four writes and all three reads.

**Two claims made in the first round were invalidated and are corrected:**

1. "A fetch timeout bounds every Supabase request" — true only per attempt, and
   actively counterproductive under postgrest-js retry. Corrected in
   SCALE_AUDIT §3 (P1-2) and D-022.
2. "The AI actions are authorized" (P0-2) — identity was fixed, but `courseId`
   and `currentWeek` stayed caller-supplied, leaving cross-tenant syllabus
   exfiltration through the OpenAI prompt. Corrected in SCALE_AUDIT §3 (P0-2)
   and D-023's sibling note.

Review-round commits: `f44e08a` (F1), `064ce21` (F2), `33d1412` (F3),
`0f27ba0` (F4+F5), `e39529e` (F6).

## External review round 2 (PR #42)

Four findings remained after round 1. All four were verified and **all four were
confirmed**; two exposed problems larger than the finding described.

- **F2 — the week was still caller-supplied.** Bounding it to 1..30 rejected
  only absurd input; any in-range value let an enrolled student generate or
  overwrite progress at weeks they had not reached. Verifying this uncovered the
  real cause: `student_courses.current_week` — the intended authoritative source
  — exists in `supabase/schema.sql` (~:957) but **no migration ever created
  it**, so it was absent live (PostgREST 42703). Two further live consequences:
  the dashboard's weekly-missions query selected that column and failed with
  400, so the feature never rendered at all, and the "advance the enrollment"
  write could never succeed. Migration adds the column plus a CHECK matching the
  authorized range; the caller's week is now only an equality token against the
  stored value, and the advance is a compare-and-set on the week it authorized.
- **F3 — the app predicate was decoration.** Verified before the fix: with only
  the public publishable key and **no authentication at all**, a plain PostgREST
  GET returned all 131 notification rows including titles, and an authenticated
  student could read *and update* another tenant's role broadcast. The live
  policies were effectively `using (target_href <> '')`. A migration replaces
  SELECT/UPDATE with policies scoped to `authenticated` whose predicate mirrors
  `notifications.ownership.ts` exactly. INSERT is deliberately untouched because
  notifications are created through the session client, which runs as `anon` for
  the sessionless `/support` flow.
- **F4 — safety was self-asserted.** Both reported bypasses were reproduced:
  declaring the production project non-production, and naming the real tenant's
  UUID as "isolated". The production denylist is now compiled into the
  repository, `TARGET_KIND` is ignored on a listed project, and a claimed tenant
  must carry a test marker **read back from the database** before any write.
- **F6 — completed.** SSO audit events carry the server-minted id, and
  `instrumentation.ts` validates through the trusted helper instead of trusting
  the header's provenance.

**A completion claim from round 1 is corrected:** "the AI actions are
authorized" was still overstated after round 1 — course and tenant were
enforced, the week was not.

Round-2 commits: `7a74ed1` (F2), `6527cf2` (F3), `0467db0` (F4), `0ab0543` (F6).

### Live RLS verification (finding 3)

`scripts/verify-notification-rls.mjs` runs five checks with a real user JWT plus
one temporary probe tenant that is always removed:

| Check | Before | After |
|---|---|---|
| anon can read notifications | 5+ rows (131 total) | **0 rows** |
| student reads own direct notification | 1 row | 1 row |
| student reads same-tenant role broadcast | 1 row | 1 row |
| cross-tenant role broadcast readable | **1 row** | **0 rows** |
| cross-tenant role broadcast updatable | **yes, is_read flipped** | **no, 0 rows patched** |

Resulting live policies: `demo create notifications` (INSERT,
`{anon,authenticated}` — unchanged), `notifications readable by recipient or
same-tenant role` (SELECT, `{authenticated}`), `notifications updatable by
recipient or same-tenant role` (UPDATE, `{authenticated}`). App re-checked after
the change: login OK, `/notifications` and `/dashboard` render with no error
fallback.

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
`supabase/migrations/20260813020000_student_courses_current_week.sql`,
`supabase/migrations/20260813030000_user_notifications_rls.sql`,
`scripts/verify-notification-rls.mjs`,
`docs/upgrade/stage-08/**`.
Modified: `notifications.actions.ts`, `ai-tutor.actions.ts`,
`counseling.service.ts`, `counseling.actions.ts`, `counseling-slots.ts`,
`demo-auth.service.ts`, `sso-audit.ts`, `middleware.ts`, the four Supabase
client factories, and six test files (fake-client surface + loader stubs).
Infrastructure: four indexes, the current_week drift repair, and the
user_notifications RLS hardening applied to the live database. **No new runtime
dependency**; shared JS unchanged at 102 kB.

## Tests / build results

Post-review figures (the authoritative set):

| Check | Result |
|---|---|
| Full suite | 333 tests / 330 pass / **3 fail — the pre-existing KI-002 trio BY NAME** (Stage 8 baseline 289/286/3; +44 Stage 8 tests, all green) |
| Harness + migration guards | 26/26 GREEN (`scripts/loadtest/lib/safety.test.mjs`, `supabase/migrations/user_notifications_rls.test.mjs`) |
| Typecheck | clean |
| Lint | baseline (1 pre-existing `no-img-element` warning) |
| Build | PASS — BUILD_ID `X9_LDAP7cnQIumJPbpY3N`, all bundle budgets met |
| Stage 2 availability invariants | 11/11 GREEN |
| Stage 5 booking/concurrency (offline) | 26/26 GREEN |
| Stage 6 tenant isolation | 17/17 GREEN (incl. the notification cross-tenant suite) |
| Stage 8 targeted | 56/56 GREEN |
| Live notification RLS | 5/5 PASS (see round 2 above) |
| Stage 7 auth/SSO | 56/56 GREEN |
| `git diff --check` | clean |
| Booking contention (live, 20 students) | 10/10 PASS — last run BEFORE the review round; **not re-run this round**, see below |
| Live DB teardown | 0 leftover fixtures; 27 profiles / 3 requests / 1 school |

**Why the live contention harness was not re-run in the review round.** The
operating instruction for this round forbids destructive or high-volume tests
against the live Supabase project, and finding 4's own fix now makes that
harness refuse to run without an explicit destructive opt-in naming a
non-production project. Booking semantics were not touched by the review-round
changes: the fetch timeout only alters behaviour when an upstream is already
hung, the notification predicate governs read/mark-read (booking *creates*
notifications through a different service), and the request-id propagation adds
a value to log lines on error paths. The deterministic Stage 5 concurrency
suites (26/26, including the M1/M2/M3/M9 interleaving tests and the CAS matrix)
cover those paths and are green. This is recorded as a gap rather than papered
over: the last live 20-student contention evidence predates commits f44e08a..e39529e.

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
