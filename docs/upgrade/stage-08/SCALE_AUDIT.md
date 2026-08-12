# Stage 8 — Scale Audit

Date: 2026-08-13. Branch `upgrade/stage-8` from `main` @ 9eeaf78 (Stage 7 PR
#41 merged). Method: four parallel read-only discovery agents (A load model /
API, B database / connections, C cache / rate limiting / resilience, D
observability), reconciled by the lead against first-hand measurement.

Every claim below is either (a) cited to `file:line`, (b) MEASURED by the
Stage 8 harness, or (c) explicitly labelled PROJECTION / UNVERIFIED. Nothing
is asserted from conversational memory.

---

## 1. Current architecture

**Runtime.** Next.js 15.5 App Router, React 19, deployed on Vercel
(serverless). All 23 page routes are `force-dynamic` SSR — every navigation is
a full server render. Only two route handlers exist in the whole app
(`src/app/auth/callback/route.ts`, `src/app/login/sso/[slug]/route.ts`); every
mutation is a **server action** (25 `"use server"` modules under
`src/services/`).

**Data access.** 100% Supabase over PostgREST HTTPS. Verified: no `pg`,
`postgres`, `knex`, `prisma`, `drizzle`, `sequelize`, or `typeorm` in
`package.json` — there is **no direct Postgres driver and no app-side
connection pool**. Four client factories:

| Factory | file:line | Key | Lifetime |
|---|---|---|---|
| `createSupabaseServerClient()` | `src/lib/supabase/server.ts:18` | anon publishable | new per **call** (not per request) |
| `createSupabaseAdminClient()` | `src/lib/supabase/admin.ts:17` | service role | new per call |
| `updateSupabaseSession()` | `src/lib/supabase/proxy.ts:15` | anon publishable | new per middleware invocation |
| browser singleton | `src/lib/supabase/client.ts:3` | anon publishable | module singleton |

**Consequence for connection management:** app-side connection count is *not*
a scaling axis. PostgREST is stateless HTTPS; a Lambda fan-out creates HTTPS
clients, not Postgres backends. The real ceilings live server-side
(§7). **Stage 8 therefore does not add a pooler** — there is no pool to add
one to. This directly answers the stage brief's "do not introduce a new pooler
if the platform already provides one".

**Auth.** Dual session: a GoTrue session (real Supabase Auth) plus an
app-issued HMAC `pacemate_session` bridge cookie (8h,
`src/lib/auth/demo-session.ts`). Middleware runs `supabase.auth.getClaims()`
on **every** non-static request (`src/lib/supabase/proxy.ts:45`).

**Caching.** Per D-007, request-scoped `React.cache()` only — four wrappers,
no `unstable_cache`, no ISR, no fetch cache, no CDN `Cache-Control`, no
Redis. Confirmed still true. The app is uncached end-to-end.

**Background work / queues.** None. No cron, no workers, no message bus.
Notifications are written inline as a second round trip after the primary
write (KI-018).

---

## 2. What was measured (not modelled)

Local production build (`next build` + `next start`, BUILD_ID
`oMIutf6gpqF1nURDsomS9`), live Supabase, closed-loop virtual users with **real
login sessions**. Full method in `LOAD_TEST_PLAN.md`; raw output in
`results/*.json`.

### Read-path latency

| Route | c=1 p50 / p95 | c=10 p50 / p95 / p99 | c=10 throughput | errors |
|---|---|---|---|---|
| `/dashboard` | 446 / 513 ms | 524 / 710 / 1196 ms | 17.8 req/s | 0% |
| `/counseling` | 224 / 868 ms | 466 / 604 / 659 ms | 20.7 req/s | 0% |
| `/professor` | 344 / 492 ms | 526 / 887 / 1103 ms | 17.7 req/s | 0% |
| `/mypage` | 245 / 278 ms | 340 / 505 / 543 ms | 27.1 req/s | 0% |
| `/courses` | 195 / 230 ms | 237 / 319 / 530 ms | 38.6 req/s | 0% |
| `/admin` | 188 / 211 ms | 236 / 332 / 410 ms | 40.8 req/s | 0% |
| `/login` (no DB) | 15 / 19 ms | 59 / 67 / 69 ms | 167.9 req/s | 0% |

Reading: at 10 concurrent users every route stayed correct and sub-1.2 s at
p99, with zero errors. `/login` — the only route that touches no database —
is ~9× the throughput of the heaviest page, confirming that **latency here is
Supabase round-trip-bound, not CPU-bound**. This matches Stage 3's finding and
means the scaling lever is round-trip count and query cost, not app compute.

### Booking contention (Stage 5 invariants)

20 concurrent students, real sessions, real server actions, outcomes read back
from the database:

| Scenario | Result |
|---|---|
| S1 — 20 students, 1 slot | 1 winner, 1 row, 1 distinct owner; 0 storage failures; 0 5xx |
| S2 — 1 student, 5 duplicate submits | exactly 1 row for the slot |
| S3 — cancel then 20-way re-book race | cancel freed the slot; exactly 1 row after the race |
| S4 — 12 students, 12 distinct slots | 12/12 booked, 1 row per slot |

**All 10 invariant checks passed** — and passed again unchanged after every
Stage 8 fix was applied (`results/booking-contention-after.json`). Measured cost
of the protection: p50 1754 ms for 20 students contending one slot vs 726 ms for
12 students on distinct slots — the exclusion constraint serializes *contenders*
without serializing unrelated bookings, exactly as D-011/D-017 intended.

### After the Stage 8 changes

Same scenarios, same tiers, re-run on the post-change build
(`results/*-after.json`):

| Scenario | Before p50 / p95 | After p50 / p95 | Read |
|---|---|---|---|
| `/counseling` c=10 | 466 / 604 ms | 438 / 581 ms | within variance |
| `/dashboard` c=10 | 524 / 710 ms | 542 / 821 ms | within variance |
| `/professor` c=10 | 526 / 887 ms | 558 / 1015 ms | within variance |
| `/admin` c=10 | 236 / 332 ms | 231 / 315 ms | within variance |
| Booking S1 (20-way contention) | p50 1648 ms | p50 2179 ms | within variance (see below) |
| Booking S4 (12 distinct slots) | p50 770 ms | p50 766 ms | unchanged |

**No latency improvement is claimed, and none should be expected.** D-008
already established that wall-clock against the live database is too noisy to
assert (Stage 3 observed 2–4× spikes within one session), which is why
correctness is guarded by deterministic tests rather than timing assertions.
More fundamentally, the busy-feed bound (P1-1) targets *growth*: the live
database holds **3** counseling requests, so bounding a query that currently
returns 3 rows cannot produce a measurable win. Its value is that the row count
now tracks the 14-day booking horizon instead of cumulative platform-wide
bookings forever. The same applies to the four indexes on tables of ~126 rows.

Error rate was **0% at every tier, before and after**.

---

## 3. Bottlenecks and risks, ranked

Priority uses the stage brief's scheme (P0 correctness/reliability failure, P1
connection/database bottleneck or missing overload protection, P2
observability blind spot, P3 polish).

### P0-1 — `markAllNotificationsRead` writes across every tenant
`src/services/notifications.actions.ts:96-100`. The statement is
`UPDATE user_notifications SET is_read=true WHERE is_read=false AND
(recipient_id=<me> OR recipient_role=<my role>)`. There is **no id predicate
and no tenant predicate**. Role-addressed rows (`recipient_id IS NULL`,
`recipient_role='professor'`) are exactly how counseling notifications are
written (`counseling.actions.ts:142-150`), so one professor clicking "mark all
read" marks every professor-addressed notification **on the platform, in every
university**, as read. `markNotificationsReadByCategory` (`:117-123`) has the
same shape. This is simultaneously a correctness bug, a Stage 6 tenant-
isolation violation on the write path, and — at scale — a row-lock storm whose
cost grows with platform-wide unread volume.

> **Correction (external review, finding 2).** Deriving `studentId` from the
> session closed the identity hole but was NOT sufficient. `courseId` and
> `currentWeek` remained caller-supplied and unvalidated, and `courseId` fed a
> `courses` read whose syllabus text becomes OpenAI prompt content — so a
> student could name **another university's course** and have its syllabus
> exfiltrated through the prompt, plus progress rows written for a course they
> do not own. Authorization is now derived from the student's own
> `student_courses` enrollment joined to the course tenant, checked before the
> syllabus read and before any OpenAI call, with the week bounded to 1..30.

### P0-2 — two AI server actions have no authorization at all
`src/services/ai-tutor.actions.ts:24` (`generateWeeklyGuide`) and `:100`
(`submitProgressFeedback`) are exported server actions that accept
`studentId` **as a caller-supplied parameter**, never call `getDemoProfile()`,
and write with the anon client. Verified reachable: both carry registered
action ids in the build manifest (bound on `app/dashboard/page`) and the sole
callers pass `studentId` from client props
(`src/components/roadmap/weekly-missions.tsx:19,33`). Impact: any caller who
knows the action id can write another student's `student_mission_progress`,
advance another student's `student_courses.current_week`
(`ai-tutor.actions.ts:115-119`), and cause unbounded paid OpenAI calls that
have **no timeout** (`:55`). Cross-tenant as well as cross-user.

### P1-1 — the counseling busy feed is unbounded and monotonic
`src/services/counseling.service.ts:305-318`. The query filters on
`status IN ('pending','approved')` and nothing else — no professor, no tenant,
and critically **no time window**. Because an `approved` row for a consultation
that happened last year never leaves that status, the result set grows with
**cumulative platform-wide bookings forever**, not with currently-relevant
bookings. It runs on every `/counseling` render *and* inside every booking
action (`counseling.actions.ts:81`), making it the highest-frequency unbounded
read in the app and a direct tax on booking write latency.

Agent B's index analysis (independently reasoned): the existing partial index
`counseling_requests_confirmed_slot_idx` — `UNIQUE (professor_id,
requested_start, requested_end) WHERE status IN ('pending','approved')` at
`supabase/schema.sql:359-361` — already has a predicate identical to the query
filter and key columns identical to the projected columns. **Adding a time
window makes the existing index serve it as a bounded range scan; no new index
is required for this query.**

Constraint on any fix: the busy feed is read with the **admin** client
precisely so it sees *other* students' bookings (D-011). Any scoping change
must preserve cross-student visibility or displayed availability silently
regresses to the pre-D-011 bug.

### P1-2 — no Supabase client bounds its requests
None of the four factories configures a fetch timeout or `AbortSignal`
(`server.ts:21`, `admin.ts:22`, `client.ts:16`, `proxy.ts:18`). supabase-js
has no default timeout, so a hung PostgREST or GoTrue call occupies the
serverless invocation until the platform kills it. Under a slow dependency
this is the mechanism by which one slow query becomes a site-wide outage, and
it is the app's only missing piece of elementary overload protection.

> **Correction (external review, finding 1).** The first fix here was
> insufficient and is superseded. A per-call `AbortSignal.timeout` does NOT
> bound a request at SDK level, for two measured reasons:
> `AbortSignal.timeout()` rejects with `TimeoutError`, while postgrest-js
> 2.110.1 decides whether to retry with
> `err.name === "AbortError" || err.code === "ABORT_ERR"` — so the timeout was
> treated as a retryable network error (`retryEnabled` defaults true,
> `DEFAULT_MAX_RETRIES = 3`, backoff 1s/2s/4s on GET/HEAD/OPTIONS); and
> auth-js `_refreshAccessToken` retries under a 30s window with each attempt
> receiving a fresh full timeout. **Measured: one hung GET became 4 fetches
> over 8.3s against a 300ms budget** — the timeout was amplifying load rather
> than bounding it. The wrapper now aborts with a real `AbortError` and shares
> one deadline across consecutive attempts to the same endpoint. Any earlier
> statement in these documents that "a fetch timeout bounds every Supabase
> request" was true only per attempt and is corrected here. Three of
five OpenAI calls are likewise unbounded (`ai-tutor.actions.ts:55`,
`personalized-weekly-roadmap.server.ts:317`,
`professor-grounded-answer.server.ts:66`); two already have timeouts
(`ai-tutor-rag.actions.ts:134` 12 s, `student-course-study-guide.server.ts:134`
20 s), so the pattern is established in-repo.

### P1-3 — missing indexes on genuinely hot / projected-hot queries
Confirmed against `supabase/schema.sql` and all 50 migrations:

- `student_weekly_progress` has **no non-partial index leading with
  `offering_id`**. The only `offering_id` index
  (`20260714223924:40-42`) is partial on feedback columns and cannot serve the
  general reads at `professor-anonymous-weekly-aggregate.server.ts:303-305`,
  `course-term-completion-eligibility.server.ts:187`, or
  `student-course-study-guide.server.ts:239`. This is projected to be the
  largest table in the system and is read by a query that already fetches
  **all** `course_offerings` platform-wide (`:266-268`). Highest-value index in
  the audit. Confirms the KI-016 candidate.
- `counseling_requests` reads by `student_id` ordered by `created_at desc`
  (`counseling.service.ts:102-109` limit 12; `dashboard/page.tsx:164-169`
  limit 20) use `counseling_requests_student_id_idx` then **sort**. Confirms
  the KI-016 `(student_id, created_at desc)` candidate.
- `posts` community feed (`student-community.service.ts:323-329`) filters
  `school_id` + `community_type` + `status` ordered by `created_at desc`; the
  best existing index omits `school_id`, so the scan crosses all tenants to
  fill 80 rows. New candidate: `(school_id, community_type, status, created_at
  desc)`.
- `escalations` inbox (`professor-questions.server.ts:125-131`) filters
  `professor_id` and sorts `created_at desc` with no index serving that pair.

The KI-016 "user_notifications partial unread index" candidate is **refined,
not confirmed as written**: the read is an `OR` across two different columns
(`notifications.service.ts:63-69`), which a single partial index cannot serve;
and the `school_id`-leading variant is only usable once the notification reads
carry a tenant filter — which is Stage 9's charter (KI-019). Deferred with
that reasoning recorded rather than adding an index nothing will use.

### P1-4 — no rate limiting anywhere
Confirmed absent: no limiter dependency, no `vercel.json`, middleware does
only cookie refresh. Abuse-sensitive surfaces: password login (GoTrue applies
its own per-IP limits — this project's configured values are UNVERIFIED,
dashboard-side), booking (`counseling.actions.ts:56` — and KI-018 M10 records
that nothing bounds one student's pending requests across *different* slots),
the AI endpoints (P0-2), community posts, and `/support` which requires no
session at all (`support.actions.ts:27,47`).

Honest mechanism assessment for Vercel serverless with no new infrastructure:
in-memory token buckets are per-instance and reset on cold start, so they
blunt single-instance bursts only. The two real options are Postgres-backed
counters (one extra round trip) or platform-level controls. **Per-IP limiting
is the wrong primary scope for a university** — campus NAT puts thousands of
legitimate students behind one address, exactly the case the stage brief warns
about. Per-profile is the correct scope wherever a session exists.

### P2-1 — observability blind spots
70 `console.*` statements across 28 production files, no structured logging,
no metrics, no tracing, no `instrumentation.ts`, no request/correlation id.
~40 bare `catch {}` swallow failures silently. Detailed in
`OBSERVABILITY_DESIGN.md`. The single worst instance is on the booking path:
`counseling.actions.ts:82-84` catches a slot-fetch failure, logs **nothing**,
and returns the *business-conflict* message "선택한 상담 시간을 예약할 수
없습니다" — so a Supabase outage during booking is invisible to operators and
misreported to users as "slot taken".

### P2-2 — the sso-audit sink is ephemeral
`src/lib/sso/sso-audit.ts:55` emits identity events to `console.info`. The
event shape is already allowlisted and pseudonymous (`subjectHash`), which is
the right design; only the sink is missing. Named Stage 8 input from the
Stage 7 handoff.

### P3 — recorded, not actioned this stage
Unbounded professor report reads (`professor-anonymous-weekly-aggregate.server.ts:266`,
`professor-course-progress-report.server.ts:199`) fetch all offerings platform
wide — the *scoping* fix changes displayed content and is entangled with the
Stage 9 privacy work (KI-016/KI-019 both record it); Stage 8 adds the index
that makes the query survivable and leaves the scoping to Stage 9. No
pagination exists anywhere (`.range()` appears zero times); the `limit 80` /
`limit 40` feed caps are silent truncation that become correctness problems
before performance ones. Admin broadcast builds an `IN` list of every tenant
profile and inserts one row per recipient (`admin-notifications.actions.ts:66-73,92`)
— needs chunking before a full-size tenant exists.

---

## 4. Tenant-scaling review (stage brief §11)

Scaling mechanisms must not weaken Stage 6 isolation. Findings:

- **Cache keys:** nothing is cached across requests (D-007), so there is no
  cache key to leak through. Any future cross-request cache must carry the
  tenant in the key and derive it from `resolveTenantContext`, never from
  request input.
- **Rate limits:** must be scoped per profile/tenant, not per IP (§P1-4).
- **Logs/metrics:** must carry `tenantId` for filtering but never PII
  (`OBSERVABILITY_DESIGN.md` §4).
- **Queries:** the two tenant-crossing defects found are P0-1 (notification
  write) and the notification *read* path (`notifications.service.ts:63-69`,
  no `school_id`) — the latter is explicitly KI-019/Stage 9 and is left there,
  because read isolation is not DB-enforceable until the anon SELECT policy
  family is overhauled.
- **Background jobs / queues:** none exist; none introduced.

---

## 5. Capacity statement

Stated precisely, per the stage brief's §25 rule.

**Tested.** Local single-instance production build against live Supabase:
**10 concurrent virtual users** sustained across six authenticated routes with
**0% errors** and p99 ≤ 1196 ms (baseline c=1 and moderate c=10 tiers,
recorded in §2 and `results/read-load-*.json`), and **20 concurrent booking
mutations** with all ten Stage 5 invariant checks intact.

**Not tested.** Hundreds or thousands of concurrent users; Vercel's
multi-instance serverless behaviour; sustained soak; data volumes beyond the
current demo scale (largest table ~126 rows). The stage brief's "hundreds /
thousands of concurrent" tiers were **deliberately not run**: the only
Supabase project available is the live production one, and the operator
instruction for this stage forbids aggressive stress against it. Those tiers
are specified in `LOAD_TEST_PLAN.md` and marked NOT RUN — they are not
estimated, guessed, or inferred.

**Architectural intent (ESTIMATE, unverified).** The architecture is
*intended* to serve multiple universities with tens of thousands of registered
users, on the reasoning that per-request cost is round-trip-bound and the
booking constraint partitions per professor. That intent is an estimate, not a
measurement, and the projection in §3 says which queries would break first.

---

## 6. What Stage 8 changes (and deliberately does not)

Implemented (all landed; see `IMPLEMENTATION_PLAN.md` for commits): P0-1, P0-2,
P1-1, P1-2, P1-3, and the P2 observability foundation. **P1-4 rate limiting was
deliberately NOT implemented** — reasoning in `IMPLEMENTATION_PLAN.md` §8;
in short, the concrete abuse vectors turned out to be authorization holes (now
closed), no measurement showed a rate bottleneck, and the only mechanisms
available without new infrastructure would be either per-instance theatre or a
threshold invented without a baseline.

Deliberately NOT done, with reasons: no Redis / queue / microservice /
Kubernetes / APM vendor (no measurement justifies any of them, and the stage
brief forbids infrastructure-first); no new connection pooler (there is no
app-side pool — §1); no cross-request cache (D-007's safety questionnaire is
unanswered for booking-critical data and the measured bottleneck is query
shape, not repetition); no weakening of any Stage 5 constraint or Stage 6
filter; no Stage 9 RLS/anon-policy work; no pagination redesign (UX-affecting,
Stage 4 charter).
