# Stage 8 — Load Test Plan

Companion to `SCALE_AUDIT.md`. Defines the environment, workload models,
tiers, success criteria, business-state validation, and metrics. Records what
was RUN and what was deliberately NOT RUN.

---

## 1. Environment

| Property | Value |
|---|---|
| Application under test | local production build — `npm run build` && `npm run start`, port 3000 (`.claude/launch.json` → `pacemate-prod`) |
| BUILD_ID | `oMIutf6gpqF1nURDsomS9` (baseline runs) |
| Database | **LIVE Supabase project** — the only environment that exists |
| Harness | `scripts/loadtest/`, pure Node 24, **zero new dependencies** |
| Client | closed-loop virtual users, real login sessions |

### Why a hand-written harness instead of k6 / Artillery / Locust

None of the three is installed, and all would be a new dependency in a project
whose core invariants require justifying every package. The measurement this
stage needs — drive Next server actions, then assert the resulting **database
state** — is not what a generic HTTP load tool is good at; k6 in particular
would still need bespoke scripting for the server-action encoding and could
not express the Stage 5 invariant checks. Node 24 ships `fetch`, `FormData`,
`AbortSignal.timeout`, and `node:perf_hooks`, which is the whole requirement.
Trade-off accepted: no distributed load generation, so the harness cannot
model many thousands of users — which the live-database constraint forbids
anyway.

### Why closed-loop

`concurrency` workers each wait for their response before issuing the next
request. This models N students each waiting for a page before acting, and —
unlike open-loop arrival — it cannot build an unbounded queue against a live
production database.

### Authentication: real sessions, not minted cookies

The harness originally minted the HMAC `pacemate_session` cookie directly.
**That measurement would have been invalid.** The cookie satisfies
`getDemoProfile`, but it carries no GoTrue session, so every session-client
query runs as the Postgres `anon` role — which has no SELECT grant on
`counseling_requests`, `professor_admin_tasks`, or `student_custom_courses`.
The counseling page then renders its *error fallback* with zero slots. Verified
directly: `anon` → HTTP 401 `42501 permission denied`; `authenticated` → 200
with rows.

Virtual users therefore log in through the app's own login server action and
reuse the resulting cookie jar (`scripts/loadtest/lib/auth-session.mjs`).

### Server-action invocation

Actions are driven with the **progressive-enhancement encoding** — the action
id travels as a `$ACTION_ID_<id>` form field, read per build from
`.next/server/server-reference-manifest.json`. The `Next-Action` header
encoding returns HTTP 500 (digest `1795915146`) when driven from outside the
client runtime in this build, and for redirecting actions its Flight response
carries no `Set-Cookie` the harness can absorb.

Consequence: the response is a re-rendered page, not the action's
`{ ok, message }`. **Outcomes are therefore read back from the database**,
which is stronger evidence anyway — an HTTP 200 never proved a booking.

---

## 2. Workload models

Derived from real product flows, not synthetic endpoint noise.

| Model | Journey | Mapped to |
|---|---|---|
| **Normal browsing** | students check schedule and counseling availability | GET `/dashboard`, `/counseling`, `/mypage`, `/courses` |
| **Class-period spike** | many students hit timetable/dashboard at once | same routes at elevated concurrency |
| **Reservation opening** | many students read availability, then contend for the same slots | `/counseling` reads + `createCounselingRequest` on one slot |
| **Admin activity** | staff manage while students are active | GET `/admin`, `/professor` |
| **Authentication spike** | many sessions start together | login server action + GET `/login` |

Vocabulary, kept distinct throughout (stage brief §6):
**REGISTERED USERS** — rows in `profiles`. **CONCURRENT USERS** — virtual users
with an in-flight request. **REQUESTS/SEC** — measured throughput. They are
never used interchangeably.

---

## 3. Tiers

| Tier | Concurrency | Iterations | Status |
|---|---|---|---|
| smoke | 1 | 5 | RUN (harness validation) |
| baseline | 1 | 30 + 3 warmup | **RUN before + after** — `results/read-load-baseline{,-after}.json` |
| moderate | 10 | 200 + 5 warmup | **RUN before + after** — `results/read-load-moderate{,-after}.json` |
| high | 25 | 400 | **NOT RUN** — live-database safety |
| stress | 50 | 600 | **NOT RUN** — live-database safety |
| breaking point | escalate to failure | — | **NOT RUN** — would require deliberately degrading production |
| recovery | post-stress | — | **NOT RUN** — depends on stress |

The high/stress/breaking-point/recovery tiers are **defined and implemented**
in the harness (`TIERS` in `run-read-load.mjs`) so they can be run the moment
a staging Supabase project exists. They were not run because the only database
is live production and the operating instruction for this stage forbids
aggressive stress against it. Their results are recorded as **NOT RUN**, never
estimated.

### Booking contention tiers

| Tier | Students | Status |
|---|---|---|
| validation | 6 | RUN |
| bounded contention | 20 | **RUN before + after** — `results/booking-contention{,-after}.json`, 10/10 checks PASS both times |
| high contention | 100+ | **NOT RUN** — live-database safety |

---

## 4. Scenarios and success criteria

### Read scenarios (`run-read-load.mjs`)

Success criteria: HTTP status < 400 for every request; **0% error rate**; no
route regresses beyond its recorded baseline band after Stage 8 changes.

Metrics collected per scenario/tier: request count, ok/failed counts, error
rate %, throughput req/s, latency min/p50/p95/p99/max/mean, status-code
histogram, median response bytes, wall-clock.

Not collected, and why: CPU/memory (no instrumentation on the local Node
process — the same gap Stages 1/3 recorded); database-side latency and
connection counts (Supabase dashboard metrics are not exposed to the harness);
FCP/LCP/INP/CLS (no paint-timing tooling — unchanged since Stage 1). All
marked UNVERIFIED rather than guessed.

### Booking scenarios (`run-booking-contention.mjs`)

Business-state validation is the point. Every scenario ends by querying
`counseling_requests` through the service role and asserting Stage 5
invariants:

| ID | Invariant | Check |
|---|---|---|
| I1 | capacity never exceeded | ≤ 1 active (`pending`/`approved`) row per (professor, time range) |
| I1b | one owner | exactly 1 distinct `student_id` owns the contended slot |
| I2 | idempotency (D-013) | 5 duplicate submits ⇒ exactly 1 row |
| I4 | honest classification | 0 storage-failure responses, 0 HTTP 5xx |
| I5 | cancel frees the slot | cancelled row reaches `cancelled`, 0 active rows |
| I5b | freed slot re-books once | exactly 1 row after an N-way re-book race |
| — | protection is not a global lock | ≥90% of distinct-slot bookings succeed |

Scenarios: **S1** N students → 1 slot; **S2** 1 student → 5 duplicate submits;
**S3** cancel then N-way re-book race; **S4** N students → N distinct slots.

---

## 5. Live-database safety protocol

**Now enforced in code, not by convention (review findings 4 and 5).** The
booking harness refuses to provision or mutate anything unless three explicit
confirmations are present, and both harnesses default to a loopback application
target:

```text
PACEMATE_LOADTEST_ALLOW_MUTATIONS=1            deliberate destructive opt-in
PACEMATE_LOADTEST_EXPECTED_PROJECT_REF=<ref>   must equal the configured project
PACEMATE_LOADTEST_TARGET_KIND=non-production   or PACEMATE_LOADTEST_SCHOOL_ID=<uuid>
```

A non-loopback application target additionally requires
`PACEMATE_LOADTEST_ALLOW_REMOTE=1`, https, and a matching
`PACEMATE_LOADTEST_EXPECTED_HOST` before any credential is sent. When an
isolated tenant is named the harness uses exactly that school rather than "the
first school", which on a shared project is a real university.

Cleanup is explicitly NOT counted as protection: it does nothing if the process
is killed, if cleanup itself errors, or if the run was pointed at the wrong
project. The guards run first; cleanup remains as hygiene.

Mandatory, because production is the only environment:

1. **Bounded volume.** Read tiers capped at c=10 / 200 iterations; mutation
   tiers at 20 students. No sustained soak.
2. **Marker-tagged fixtures.** Every synthetic row carries
   `pacemate-loadtest` (`identifier`, notification `body`, request `topic`).
3. **Deterministic teardown** in a `finally` block: counseling requests →
   student profiles → notifications → profiles (**by primary key**) → auth
   users.
4. **Post-run verification.** Leftover-row query after every run.
5. **Read tests create nothing** — they reuse existing demo accounts.

Cleanup defect found and fixed during this stage: deleting profiles by
`identifier=like.*marker+runId*` silently matched nothing, because a raw `+`
in a PostgREST query string decodes to a space. 26 orphaned rows were left by
the first two runs; they were removed manually and the harness now deletes by
primary key. Verified after the final run: 0 leftover fixtures, live database
back to 27 profiles / 3 counseling requests.

---

## 6. Before/after protocol for Stage 8 changes

Stage 8 changes query shapes on the booking path, so the comparison is:

1. Record baseline (done — §3, pre-change build).
2. Apply one change at a time, Red → Green.
3. Re-run the **same** bounded scenarios (`baseline` + `moderate` on
   `/counseling` and `/dashboard`; booking contention at 20 students).
4. Compare against the recorded baseline; report deltas honestly, including
   any that are within noise.

Wall-clock numbers against a live database are noisy (Stage 3 measured 2–4×
spikes within one session — D-008). Latency deltas are therefore reported as
observations, and correctness is guarded by deterministic tests, never by
timing assertions.
