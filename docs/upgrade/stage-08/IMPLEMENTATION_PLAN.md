# Stage 8 — Implementation Plan

Ordered by the stage brief's priority scheme. One concern per commit,
Red → Green for every correctness/security fix. Status is updated as work
lands; anything not completed is marked honestly rather than removed.

| # | Priority | Item | Status | Commit |
|---|---|---|---|---|
| 1 | P0 | `markAllNotificationsRead` cross-tenant write | **DONE** | 165dc94 |
| 2 | P0 | AI actions missing authorization | **DONE** | eaa05cd |
| 3 | P1 | busy feed unbounded / no time window | **DONE** | 5ef9371 |
| 4 | P1 | no Supabase request timeout | **DONE** | fdf9339 |
| 5 | P1 | evidence-justified indexes | **DONE** (applied live) | c151c89 |
| 6 | P2 | observability foundation | **DONE** | c009ad1 |
| 7 | — | verification, docs, PR | **DONE** | this commit |

Rate limiting (P1-4 in the audit) was **NOT implemented** — see §8 for the
reasoning, which is a deliberate decision rather than an omission.

---

## 1. P0 — `markAllNotificationsRead` writes across tenants

**Defect.** `src/services/notifications.actions.ts:96-100` (and
`:117-123`) issue `UPDATE user_notifications SET is_read=true WHERE
is_read=false AND (recipient_id=<me> OR recipient_role=<my role>)`. Role-
addressed rows carry `recipient_id IS NULL`, so the `OR` arm matches every
role-addressed row **platform-wide**, in every tenant.

**Red.** A test driving the real action against a filter-recording fake client
asserts the statement carries a tenant predicate. Fails on current code.

**Fix (minimal).** Add `school_id` scoping derived from the server-resolved
profile — never from request input — to the role-addressed arm. The
`recipient_id = me` arm is already correctly self-scoped.

**Preserves.** Stage 6 (`resolveTenantContext` remains the only tenant source),
Stage 4 UI (no visible change for a single-tenant deployment).

**Note on scope.** The notification *read* path has the same unscoped `OR`
shape (`notifications.service.ts:63-69`) but is explicitly KI-019/Stage 9,
because read isolation is not DB-enforceable until the anon SELECT policy
family is overhauled. Stage 8 fixes the **write**, which is a destructive
cross-tenant mutation and a lock-contention hazard; it does not pre-empt
Stage 9's read work. This split is recorded so it does not read as an
oversight.

---

## 2. P0 — `generateWeeklyGuide` / `submitProgressFeedback` have no authorization

**Defect (verified).** `src/services/ai-tutor.actions.ts:24,100` are exported
server actions taking `studentId` as a **caller-supplied parameter** with no
session check, writing via the anon client. Both have registered action ids in
the build manifest (bound on `app/dashboard/page`), and the only callers pass
`studentId` from client props (`weekly-missions.tsx:19,33`). Impact: write
another student's `student_mission_progress`, advance another student's
`student_courses.current_week`, and trigger unbounded paid OpenAI calls.

**Red.** Tests assert (a) a call whose `studentId` differs from the session
profile performs no write, and (b) an unauthenticated call performs no write.
Both fail on current code.

**Fix (minimal).** Resolve the acting profile server-side via `getDemoProfile()`
and derive `studentId` from it, ignoring the caller-supplied value; deny when
there is no student session. Signature is kept so call sites and UI are
untouched (the parameter becomes advisory and is ignored) — smallest change
that closes the hole without a UI refactor.

**Also.** Add a timeout to the OpenAI call (`:55`), matching the established
in-repo pattern (`ai-tutor-rag.actions.ts:134`).

---

## 3. P1 — counseling busy feed is unbounded and monotonic

**Defect.** `src/services/counseling.service.ts:305-318` filters only on
`status IN ('pending','approved')` — no professor, no tenant, **no time
window** — and runs on every `/counseling` render *and* inside every booking
action. `approved` rows never leave the status, so the set grows with
cumulative platform-wide bookings forever.

**Fix.** Add a lower bound on `requested_end` (the slot horizon's start) so the
query returns only bookings that can still affect availability. Per the index
analysis, this lets the existing partial index
`counseling_requests_confirmed_slot_idx` serve it as a bounded range scan —
**no new index needed**.

**Hard constraints.**
- Must preserve **cross-student** visibility (D-011): the feed is read with the
  admin client precisely so it sees other students' bookings. Scoping to the
  caller would resurrect the pre-D-011 overbooking-display bug.
- Must not change which slots are considered busy **within the horizon**. The
  slot builder only considers dates from today+1 to today+14
  (`counseling-slots.ts:107`), so bookings that ended before now cannot affect
  any bookable slot — the bound is provably behaviour-preserving, not a
  heuristic.

**Red.** A test asserting the busy query carries a time bound; plus the
existing Stage 2/5 suites (availability identity, slot correctness, booking
concurrency) must stay green to prove behaviour preservation.

---

## 4. P1 — no Supabase client bounds its requests

**Defect.** None of the four factories sets a fetch timeout or `AbortSignal`
(`server.ts:21`, `admin.ts:22`, `client.ts:16`, `proxy.ts:18`); supabase-js has
no default. A hung PostgREST/GoTrue call pins the invocation until the platform
timeout — the mechanism by which one slow dependency becomes an outage.

**Fix.** A shared `fetch` wrapper applying `AbortSignal.timeout(...)`, passed as
`global.fetch` to all four factories. Timeout chosen to sit **below** typical
platform function limits so the app fails in a controlled way first, and well
above the measured p99 (1196 ms at c=10) so legitimate slow requests are not
severed.

**Backpressure posture.** Bounded failure only — no retry is added. Retrying
booking mutations is explicitly forbidden by the stage brief and by D-013's
reasoning (a conflict retry is guaranteed to fail again). Timeout ⇒ the
existing controlled error path.

---

## 5. P1 — indexes justified by evidence

Only indexes with a named query behind them. Applied via a migration.

| Index | Serves | Evidence |
|---|---|---|
| `student_weekly_progress (offering_id, week_number)` | aggregate/eligibility/study-guide reads | no non-partial `offering_id` index exists; largest projected table (KI-016 candidate CONFIRMED) |
| `counseling_requests (student_id, created_at desc)` | student request lists | index-then-sort today (KI-016 candidate CONFIRMED) |
| `posts (school_id, community_type, status, created_at desc)` | community feed | best existing index omits `school_id` → cross-tenant scan to fill 80 rows |
| `escalations (professor_id, created_at desc)` | question inbox | no index serves filter+sort pair |

**Deliberately excluded:** the KI-016 `user_notifications` partial-unread
candidate. The read is an `OR` across two columns, which one partial index
cannot serve, and the `school_id`-leading variant only becomes usable once the
notification reads carry a tenant filter — Stage 9's charter. Adding an index
nothing will use is cost without benefit; the refined reasoning is recorded in
KNOWN_ISSUES instead.

**Migration safety.** `CREATE INDEX` (not `CONCURRENTLY`) is used because
Supabase applies migrations in a transaction; at current data volume (largest
table ~126 rows) the lock is negligible. Recorded so a future large-table
migration is written differently.

---

## 6. P2 — observability foundation

Per `OBSERVABILITY_DESIGN.md` §9: structured log helper with an enforced field
allowlist, request-id middleware, `instrumentation.ts` `onRequestError`,
classified logging on the booking fault path, login-denial events, and
`sso-audit` routed through the shared logger.

Not done, deliberately: metrics backend, tracing, rewriting all 70 `console.*`
sites.

---

## 7. Verification — results

Targeted regression per fix (Red → Green), then the full gate. All recorded in
`HANDOFF.md`; headlines:

| Check | Result |
|---|---|
| Full suite | 306 tests / 303 pass / 3 fail — the pre-existing KI-002 trio BY NAME (baseline was 289/286/3; +17 Stage 8 tests, all green) |
| Typecheck | clean |
| Lint | baseline (1 pre-existing `no-img-element` warning) |
| Build | PASS, all bundle budgets met, shared JS 102 kB unchanged (no new deps) |
| Stage 6 tenant isolation | 5/5 GREEN |
| Stage 2/5 invariant suites | 35/35 GREEN |
| Booking contention (20 students) | 10/10 invariant checks PASS, after the changes |
| Read load baseline + moderate | re-run, 0% errors |
| Live DB teardown | 0 leftover fixtures; 27 profiles / 3 counseling requests / 1 school |

### Red → Green evidence

| Fix | RED | GREEN |
|---|---|---|
| P0-1 | 2/2 failed — a foreign tenant's row flipped to `is_read=true` | 2/2 |
| P0-2 | 4/4 failed — foreign-student writes recorded, OpenAI credits spent with no session | 4/4 |
| P1-1 | 2/2 failed — no time bound on the busy query | 2/2 |
| P1-2 | failure injection: a hung upstream never resolved | 4/4 |
| P2 | — (new capability, not a bug fix) | 5/5 |

### Deliberate test updates (not silent breakage)

- Four fake clients gained `.gte()`/`.lt()`, modelling a client surface the real
  PostgREST client already has. Without it the Stage 5/6 suites threw
  `TypeError`, which was a fake-surface gap, not an app regression.
- Four transpile loaders gained an observability stub.
- `counseling-request-security.test.mjs` froze the old `console.error` shape; it
  now asserts the structured event **and the absence** of `details`/`hint`.

### Environment note

Midway through the stage `node_modules` was emptied outside this session, and a
plain `npm ci` reinstalled **without devDependencies**, producing thousands of
spurious type errors and `MODULE_NOT_FOUND` in tests. Fixed with
`npm ci --include=dev`. Recorded so the same symptom is not misdiagnosed as a
code regression next time.

## 8. Rate limiting — deliberately not implemented

The audit ranked this P1-4, and it is **not** done. The reasoning, so the
decision can be revisited rather than rediscovered:

1. The two concrete abuse vectors found were *authorization* holes, not rate
   problems: unauthenticated AI actions burning OpenAI credits (P0-2, now
   closed) and unbounded per-student booking volume (KI-018 M10, a product
   policy question — how many pending requests a student may hold — that nobody
   has answered).
2. On Vercel serverless with no new infrastructure, an in-memory limiter is
   per-instance and resets on cold start, so it would produce the *appearance*
   of protection without the substance. The honest options are Postgres-backed
   counters (an extra round trip on every hot request) or platform controls.
3. No measurement in this stage showed a request-rate bottleneck: 0% errors at
   every tier run.
4. Per-IP limiting — the easy default — is actively wrong here: campus NAT puts
   thousands of legitimate students behind one address, the exact failure the
   stage brief warns about.

Implementing a limiter now would mean choosing a scope and a threshold with no
baseline to justify either. Recorded in KNOWN_ISSUES with the evidence needed
to do it properly (production traffic baseline + the M10 product decision).
