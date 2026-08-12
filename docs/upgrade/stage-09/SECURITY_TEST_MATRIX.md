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

## 6. Rendered browser QA (production build, live database)

| Flow | Result |
|---|---|
| `/login` | renders; demo panel correctly absent; password login succeeds |
| `/dashboard` | full render — notifications, timetable, counseling card, academic calendar, completion-evidence card, all 8 course roadmap cards. No error fallback |
| `/counseling` | full render — course list, tenant professor directory, availability calendar (2개/5개 per date), existing request with cancel |
| `/notifications` | 12 notifications, 5 unread, all categories |
| `/courses` | full catalog |
| `/support` | anonymous-shaped submission accepted end-to-end; the stored row had `recipient_role=admin`, `recipient_id=NULL`, `target_href=/admin`, `category=system`, tenant stamped — the fixed shape, not a caller-chosen one. QA row deleted afterwards |
| Browser console errors | **0** |
| Server errors | **0** |

## 7. Not covered — stated, not implied

- **Realtime delivery** was not exercised. The channel is off by default and,
  as documented in the RLS audit §9, has been non-delivering since Stage 8.
  Marked UNVERIFIED, with the fix recorded in KI-022.
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
