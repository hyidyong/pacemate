# Stage 9 — Security Test Matrix

## 1. How the live tests work

`scripts/security/rls-probe.mjs` ignores the application entirely and talks to
PostgREST as three principals:

- **anon** — the publishable key, no session
- **user A** — a signed-in student of probe tenant A
- **user B** — a signed-in student of probe tenant B

against **two disposable universities it provisions and removes itself**. Each
tenant gets a school, department, professor, course, availability window,
profile + real GoTrue user + student profile, enrolment, counseling request,
direct notification, role broadcast, and mission-progress row.

Every check states the property it asserts, so a FAIL is a security finding
rather than a broken test. Nine of the checks are **allow** cases — a fix that
denies everyone is not a fix.

### Running it

```bash
PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1 PACEMATE_SECURITY_PROBE_PROJECT_REF=<ref> node scripts/security/rls-probe.mjs
```

### Safety

`scripts/security/lib/probe-guard.mjs`, unit-tested in `probe-guard.test.mjs`
(9 tests, all green):

- writes are refused unless `PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1`;
- the operator must name the project ref, and it must match the configured URL;
- a tenant is disposable only when the **database row** carries the marker slug
  (`isProbeTenant`) — naming a UUID proves nothing, the Stage 8 lesson;
- every delete is marker-scoped or id-scoped (`assertScopedFilter` throws
  otherwise), so a cleanup bug cannot become a truncate;
- teardown re-reads the database and reports leftovers as an observation.

Teardown verified after both runs: schools 1, profiles 27, auth users 8,
notifications 131 — the exact pre-run baseline.

## 2. Results

| | Before | After |
|---|---|---|
| **Total** | 67 checks, **26 FAILED** | 67 checks, **0 FAILED** |

### Anonymous attacker — direct Data API

| Check | Before | After |
|---|---|---|
| anon reads `profiles` | **27 rows** | 0 (401) |
| anon reads `student_profiles` | **12 rows** | 0 (401) |
| anon reads `student_courses` | **12 rows** | 0 (401) |
| anon reads `syllabi` (incl. `raw_extracted_text`) | **5 rows** | 0 (401) |
| anon reads `professor_teaching_slots` | **22 rows** | 0 (401) |
| anon reads `professor_availability` | **9 rows** | 0 (401) |
| anon reads `roadmap_revision_requests` | **3 rows** | 0 (401) |
| anon reads `professors` / `courses` / `departments` / `course_professors` | rows | 0 (401) |
| anon reads `counseling_requests`, `user_notifications`, `posts`, `escalations`, … | already denied | still denied |
| **anon PATCHes a profile** | **name rewritten** | denied |
| **anon POSTs a profile with `role=admin`** | **HTTP 201, row created** | denied |
| **anon PATCHes `professor_availability.is_active`** | **flipped to false** | denied |
| **anon POSTs a fabricated availability window** | **HTTP 201** | denied |
| **anon POSTs a notification to a named recipient** | **HTTP 201, delivered** | denied |
| **anon PATCHes `student_mission_progress`** | **rewritten** | denied |
| **anon PATCHes `student_courses.current_week`** | **set to 30** | denied |
| anon PATCHes `student_profiles` | denied (400) | denied |

### Tenant A vs Tenant B (authenticated cross-tenant)

| Check | Before | After |
|---|---|---|
| B reads A's counseling request | denied | denied |
| B reads A's profile / student profile / enrolment | denied | denied |
| B reads A's direct notification / tenant broadcast | denied | denied |
| **B reads A's `student_mission_progress`** | **1 row** | 0 |
| **B reads `professor_admin_tasks`** | **5 rows** | 0 |
| **B reads `syllabi`** | **5 rows** | 0 |
| **B reads A's `courses`** | **1 row** | 0 |
| **B reads A's professor directory** | **1 row** | 0 |
| B marks A's notification read | denied | denied |
| B cancels A's counseling request | denied | denied |
| B disables A's availability | denied | denied |
| **B rewrites A's mission progress** | **succeeded** | denied |
| B edits A's profile | denied | denied |

### Legitimate paths — must stay GREEN

| Check | Before | After |
|---|---|---|
| A reads own direct notification | pass | pass |
| A reads own tenant role broadcast | pass | pass |
| A reads own counseling request | pass | pass |
| A reads own profile | pass | pass |
| **A reads own student profile** | **FAIL — 0 rows** | pass |
| A reads own enrolment | pass | pass |
| A reads own tenant's catalog / professors / availability | pass | pass |
| A marks own notification read | pass | pass |

The `student_profiles` row is the clearest evidence for §2 of the RLS audit: the
authenticated policy was dead before the identity repair, and the application
only worked because it fell through to `anon`.

## 3. Durable audit trail — live properties

`security_events`, verified against the live database:

| Property | Result |
|---|---|
| service role CAN append | PASS (201) |
| anon CANNOT read | PASS (401) |
| anon CANNOT append | PASS (401) |
| anon CANNOT rewrite history | PASS (401) |
| anon CANNOT delete history | PASS (401) |

Test row removed; table left at 0 rows.

## 4. Offline / deterministic tests

| Suite | Result |
|---|---|
| `scripts/security/lib/probe-guard.test.mjs` (new) | 9/9 |
| `supabase/migrations/stage9_rls.test.mjs` (new) | 10/10 |
| Full suite `node --test "src/**/*.test.mjs"` | 333 tests, 330 pass, **3 fail — the pre-existing KI-002 trio by name** |
| Stage 6 tenant isolation | green within the full suite |
| Stage 7 auth/SSO | green within the full suite |
| Stage 8 observability / request-id propagation | green (2 stubs updated for the new imports) |
| Stage 5 booking/concurrency (offline) | green within the full suite |
| Typecheck | clean |
| Lint | baseline (1 pre-existing `no-img-element` warning) |
| Build | PASS, `BUILD_ID -cqYGI5z8pJg6PnNtwlo8`, all bundle budgets met, shared JS 102 kB unchanged |

## 5. Credential exposure

| Check | Before | After |
|---|---|---|
| `grep -rl "password123\|pacemate.edu" .next/static/` | **hit** (`app/login/page-*.js`) | **no hits** |
| same strings in `.next/server/` | present | present (never shipped to a browser) |
| demo panel rendered without `PACEMATE_ENABLE_DEMO_LOGIN=1` | rendered | **absent** (verified in the browser) |

## 6. Rendered browser QA (production build, live database) — ROUND 1 ONLY

**This whole section is round-1 evidence and predates the round-3 UI changes.**
Round 3 could not run rendered QA: the browser preview tool was blocked by the
session's permission classifier. The four paths changed in round 3 — `/support`
sessionless refusal (F8), the `/admin` `result=stale` banner (F5), the
`/professor` assistant workspace (F9) and the notification bell's Realtime
channel (F11) — have **no rendered evidence** and are marked
**UNVERIFIED — no page was rendered this round**. Re-running QA over them is a
prerequisite for merge.

| Flow | Result |
|---|---|
| `/login` | renders; demo panel correctly absent; password login succeeds |
| `/dashboard` | full render — notifications, timetable, counseling card, academic calendar, completion-evidence card, all 8 course roadmap cards. No error fallback |
| `/counseling` | full render — course list, tenant professor directory, availability calendar (2개/5개 per date), existing request with cancel |
| `/notifications` | 12 notifications, 5 unread, all categories |
| `/courses` | full catalog |
| `/support` | **This row is HISTORICAL and no longer describes the product.** Round 3 (F8) made `/support` require a session; an anonymous-shaped submission is now refused. What it does still evidence is the routing shape: the stored row had `recipient_role=admin`, `recipient_id=NULL`, `target_href=/admin`, `category=system` — fixed, not caller-chosen. QA row deleted afterwards |
| Browser console errors | **0** |
| Server errors | **0** |

## 7. Not covered — stated, not implied

- **Realtime delivery** was not exercised. Round 3 (F11) fixed the two
  remaining client-side defects — the handshake raced the subscription, and a
  `recipient_id` filter structurally excluded every role broadcast — but proving
  delivery needs a real socket and a real INSERT, for both a direct notification
  and a role broadcast. The channel is off by default.
  **UNVERIFIED — no live socket was opened.** DEFERRED — Stage 10.
- **SSO end-to-end** against a real IdP remains BLOCKED (Stage 7, KI-020) —
  no institution configuration exists. The app-side boundary is covered by the
  43 offline SSO tests, which are green.
- **The durable audit emit paths** (`sso.*`, `admin.broadcast_sent`,
  `admin.revision_*`) are code-wired and typechecked, and the table's security
  properties are verified live, but no run in this session triggered an SSO
  event, a tenant broadcast, or a revision approval, so **the end-to-end write
  from those three call sites is UNVERIFIED at runtime**.
- **Privilege-escalation tests via server actions** were reasoned from source
  and closed in code; they were not driven as live HTTP POSTs with forged
  `Next-Action` headers. The database-level backstop for each is covered above.
- Load, stress and soak remain out of scope and unrun (KI-021).

---

## 8. Codex review round (2026-08-14) — added coverage and corrected results

### Probe correctness fixes that changed earlier numbers

Two defects in the harness meant some earlier "PASS" results were not evidence:

1. `rawFetch` did `{ ...init, headers }`, dropping per-call headers, so
   `Prefer: return=representation` never reached PostgREST. A successful INSERT
   returned 201 with an empty body and read as "denied". Write outcomes are now
   confirmed by a **service-role read-back**.
2. Requesting a representation makes PostgREST re-check the new row against the
   SELECT policy and roll back if invisible — producing 403s that looked like
   protection but disappear when an attacker omits the header. Write probes now
   post **without** it, the weakest attacker path.

Only the newly added write checks were affected. Every earlier check verified
outcomes by service-role read-back already, so the pre-existing evidence stands.

### Probe cleanup — fault injection (Codex F1)

`scripts/security/lib/probe-cleanup.test.mjs`, 27 tests, offline against
in-memory fakes.

| Property | Before | After |
|---|---|---|
| Failure at any of 11 provisioning boundaries leaves zero rows | **LEAKED 6/6 measured** | PASS |
| Failure creating the Auth user leaves zero rows | LEAKED | PASS |
| Failure during the probe itself still cleans up | n/a | PASS |
| Cleanup runs when the provisioner never returns | **impossible by design** | PASS |
| A DB deletion failure is reported, not swallowed | swallowed | PASS |
| An Auth deletion failure is reported, not swallowed | swallowed | PASS |
| Unverifiable residue fails the run | reported to stdout only | PASS |
| Every ledger delete is id-scoped | — | PASS |
| Cleanup is strict reverse creation order | hand-maintained | PASS |
| The orphan sweep recovers from a killed run | did not exist | PASS |

**NOT claimed:** survival of SIGKILL, OOM kill or power loss. `finally` does not
run in those cases. The recovery mechanism is the operator-run
`rls-probe.mjs --sweep`, which is tested and reports its own failures.

### Cross-tenant write primitives (Codex F2)

Signed in as a student of probe tenant A, writing tenant B's UUIDs directly:

| Target | Before | After |
|---|---|---|
| `student_courses` foreign course | **201, row created** | 403, 0 rows |
| `student_mission_progress` foreign course | **201, row created** | 403, 0 rows |
| `study_roadmaps` foreign course | **201, row created** | 403, 0 rows |
| `study_tasks` foreign course (own roadmap) | **201, row created** | 403, 0 rows |
| `posts` foreign tenant | **201, row created** | 403, 0 rows |
| `course_reviews` foreign course | 403 (already correct) | 403 |
| Same-tenant equivalents (4) | 201 | **201 — still allowed** |

### Counseling direct writes (Codex F3)

As a signed-in professor of tenant A, PATCHing their own row:

| Field | Before | After |
|---|---|---|
| `status` pending → approved | **204, applied** | 403, unchanged |
| `student_id` → tenant B's student | **204, applied** | 403, unchanged |
| `suggested_start` | **204, applied** | 403, unchanged |
| `requested_start` | 400 (a constraint, not a policy) | 403 |
| Professor reads own caseload | PASS | **PASS — preserved** |

### Roadmap tenant isolation (Codex F4)

| Check | Before | After |
|---|---|---|
| Tenant A staff reads tenant B's revision | (no tenant column existed) | 0 rows |
| Tenant A staff approves tenant B's revision with the exact UUID | (role-only check) | 403, status unchanged |
| Tenant A staff reads their own tenant's revision | — | **1 row — preserved** |

### Durable audit trail (Codex F7 + F8)

`scripts/security/audit-trail-probe.mjs`, 11 checks, all PASS: service_role can
append and read; anon cannot read, append, update or delete; an audit record
cannot be UPDATED even by service_role; the attribution snapshot populates
automatically; a profile carrying audit history **can still be deleted**; and its
attribution survives that deletion. Probe rows removed, residue proven clean.

### Support abuse boundary (Codex F6, revised by round-3 F8)

`src/services/support-boundary.test.mjs`, **13 tests**: an unauthenticated
submission is refused and persists nothing; a session without a tenant is
refused; a normal signed-in submission creates exactly one notification; the
submission is routed to the submitter's own tenant so an admin can actually read
it; all six allowlisted categories; unknown category rejected; oversized
category, body and title each rejected rather than coerced or truncated; the
caller controls no routing field; the tenant comes from the session and never
the form; the page and the action agree that a session is required; and the
central chokepoint bounds what is persisted.

### Schema drift (Codex F9)

`supabase/security-snapshot.json`, generated from the live database, with 11
offline drift-guard tests and a `--check` mode that fails on any difference.

### Totals after review round 2 (SUPERSEDED — see round 3 below)

| Suite | Result |
|---|---|
| Live direct Data API probe | 85 checks, 0 failed |
| Live durable audit probe | 11 checks, 0 failed |
| Probe cleanup fault injection | 27/27 |
| Probe guard | 9/9 |
| Migration guards | 27/27 |
| Security snapshot drift guards | 11/11 |
| Full app suite | 348 tests, 345 pass, 3 fail — the KI-002 trio |
| Typecheck / lint / build | clean / baseline / PASS |
| Credential scan of `.next/static/**` | 0 hits |


---

## Review round 3 — what makes a PASS trustworthy

Round 3's first and highest-priority finding (F1) was not a hole in the product.
It was that **the security results themselves could not be trusted**. Everything
in this document depends on that being fixed first, so it is recorded here as a
property of the harness rather than as one more test.

A PASS in this matrix must never be produced by any of the following, and the
harness now structurally prevents each:

| Failure mode | How it is prevented |
|---|---|
| A malformed request read as "denied" | Every probe asserts on persisted state, not on the response; a malformed request surfaces as a harness error, not a pass |
| A missing fixture read as "denied" | Positive fixtures are provisioned and asserted. `verify-notification-rls.mjs` provisions its own two schools, its own auth user and three notifications, and requires all `EXPECTED_CHECKS` to have run |
| A SELECT policy hiding a successful INSERT | Write outcomes are confirmed by a **service-role read-back** of the row, with the mutation posted **without** `Prefer: return=representation` — the weakest attacker path. This is exactly how F2's real severity was found |
| An empty representation read as failure | Same: a representation is never evidence |
| A generic HTTP error read as "denied" | Status alone is never sufficient for a deny verdict on a mutation |
| A cleanup failure read as success | Residue verification is **fatal**; a non-empty ledger or any surviving row fails the run |
| A skipped setup read as PASS/SKIPPED | Setup failure aborts the run; a skip must carry an explicit reason string |
| Regex string matching standing in for behaviour | Source-level guards cover only ordering and structural contracts, and anchor on **code**, never prose — three false failures earlier in this round came from matching text inside comments |
| A hung request never returning | One bounded transport (`lib/probe-http.mjs`) whose deadline covers the **body read**, not just the headers |
| Ctrl-C leaving fixtures behind | `lib/probe-lifecycle.mjs` runs cleanup once on SIGINT/SIGTERM (latched on a promise) and exits 130/143 |
| A single page of Auth users read as "no residue" | `listUsersByEmailPrefix` pages to exhaustion and **throws** if it does not terminate |
| A lookalike host accepting the probe's credentials | The host guard requires exactly `<ref>.supabase.co`/`.supabase.in`, HTTPS, no port, no embedded credentials. Verified refusals: `...supabase.co.attacker.example`, `http://...`, `...evil.test`, `...supabase.co:8443`, `other.<ref>.supabase.co` |

**Not claimed: crash safety.** SIGKILL, power loss or a host crash leave
ledgered fixtures behind. What catches that is the *next* run's residue
verification, not the probe itself. The subprocess signal tests **skip on
Windows** with an explicit reason — POSIX signals are not deliverable to a child
process there — and the same behaviour is covered platform-independently by
`lib/probe-lifecycle.test.mjs` with an injected process handle. A skip is never
reported as a pass.

**Not weakened: production append-only behaviour.** The audit probe cannot
delete its own `security_events` rows. Its test events remain in the table
permanently, and the probe reports them rather than cleaning them up.

### Round-3 totals (all freshly run this session)

| Suite | Result |
|---|---|
| Live direct Data API probe (`rls-probe.mjs`) | **PASS — 96 checks, 0 failed**; ledger cleanup complete, residue clean |
| Live durable audit probe (`audit-trail-probe.mjs`) | **PASS — 12 checks, 0 failed** |
| Live notification RLS (`verify-notification-rls.mjs`) | **PASS — 6 checks, 0 failed**, own fixtures, cleanup clean |
| Security snapshot vs live DB (`--check`) | **PASS — matches** |
| `scripts/**` harness suites | **PASS — 55 tests, 52 pass, 0 fail, 3 skipped** (Windows signals, explicit reason) |
| `supabase/**` migration + snapshot guards | **PASS — 57 tests, 57 pass, 0 fail** |
| Whole repository suite | **499 tests, 493 pass, 3 fail, 3 skipped** |
| The 3 failures | **the KI-002 trio, proven pre-existing** — the same three names fail on `origin/main` in a clean worktree, and both test files are untouched by this branch |
| `tsc --noEmit` | **PASS — exit 0** |
| `next lint` | **PASS — exit 0**, 1 pre-existing `no-img-element` warning |
| `next build` | **PASS — exit 0**, 26 routes, shared JS 102 kB unchanged |
| Credential scan of shipped output | **PASS — 202 files across `.next/static` + `.next/server`, 0 hits.** The one `password123` match under `.next` is in `.next/cache/webpack/*.pack`, mtime 2026-08-11, **before** the 2026-08-13 rotation commit `6a3037e`; `.next/` is gitignored and never served |
| `git diff --check` | **PASS — clean** |
| Rendered browser QA | **UNVERIFIED — the browser preview tool was blocked by this session's permission classifier; no page was rendered** |

### New round-3 offline suites

| Suite | Tests | Covers |
|---|---|---|
| `scripts/security/lib/probe-lifecycle.test.mjs` | 10 | signal-aware, once-only cleanup with an injected process handle |
| `scripts/security/probe-subprocess.test.mjs` | 7 (+3 skipped on Windows) | a real spawned runner: bounded transport, exit codes, residue fatality |
| `src/services/ai-tutor.cas.test.mjs` | 4 | only the CAS winner pays for generation (F6) |
| `src/services/roadmap-transition.test.mjs` | 7 | exactly one winner, terminal states, no double notification (F5) |
| `src/services/notification-tenant-scope.test.mjs` | 3 | the publication broadcast carries its tenant (F10) |
| `src/components/notifications/notification-realtime.test.mjs` | 5 | auth-before-subscribe, no role-broadcast exclusion, RLS not weakened (F11) |
| `src/services/server-action-contract.test.mjs` | 2 | every `"use server"` export is async — the defect that broke `next build` |
