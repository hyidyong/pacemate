# Stage 9 Handoff — Security / Privacy / Audit / Recovery

## Status

On `upgrade/stage-9` after **five** external Codex security review rounds, each
of which returned **NOT SAFE TO MERGE**. Base `main` @ `fd44172` (Stage 8 PR #42
merged 2026-08-12, verified). Not merged — that is the human's call. Stage 10
not started. **The next action is another independent Codex security review.**

Read the **round-5** section first (immediately below): it corrects claims made
in rounds 1–4, which are kept as the historical record rather than edited into
agreement.

**The `108/0` probe figure cited in the round-4 section is WITHDRAWN.** Round 5
found that four of those checks could only pass. The corrected figure is
115 checks, 0 failed.

Status markers used in this document mean exactly one of:
`PASS` (with evidence) · `UNVERIFIED — <exact missing evidence>` ·
`BLOCKED — <exact external dependency>` · `DEFERRED — <exact stage/reason>`.

---

## Codex review round 5 (2026-08-14)

Eleven findings. Every one was verified against the code, the migrations and
live metadata **before** any change, and **every one was confirmed**. Two were
wider than reported, and verifying three of them turned up defects nobody had
reported at all — including one in the previous round's own fix.

| # | Finding | Verdict | Status |
|---|---|---|---|
| F1 | Stage 5 booking invariants bypassable via direct INSERT | **CONFIRMED — 5 of 5 bypasses persisted** | CLOSED |
| F2 | Professor course settings trust a caller-supplied courseId | **CONFIRMED** | CLOSED |
| F3 | Roadmap feedback accepts any authenticated role | **CONFIRMED** | CLOSED |
| F4 | Recipients hold table-wide UPDATE on notifications | **CONFIRMED — 7 of 8 columns rewritable** | CLOSED |
| F5 | Cleanup can race a late commit | **CONFIRMED** | CLOSED |
| F6 | Sweep ownership is a shared marker, substring-matched | **CONFIRMED** | CLOSED |
| F7 | A sweep failure still exits 0 | **CONFIRMED** | CLOSED |
| F8 | The anon allow-path assertion cannot fail | **CONFIRMED — and it hid a second defect** | CLOSED |
| F9 | Future functions inherit PUBLIC EXECUTE | **CONFIRMED, and round 4's fix was ineffective** | CLOSED |
| F10 | Assistant `/professor` workspace is broken | **CONFIRMED** | CLOSED, rendered-QA verified |
| F11 | `ensure-demo-operator-auth.mjs` does not parse | **CONFIRMED — and a second defect beside it** | CLOSED |

### THE 108/0 FIGURE IS WITHDRAWN

F8 is the reason. The anon-read loop's ALLOW branch passed the literal `true` as
its verdict:

```js
check(`anon-read:${table}`, `anon MAY read ${table}`, true, …)
```

Four checks could only pass. `anon-read:course_reviews` was recorded PASS while
the response was **401**. Any total that included them was not evidence, so
every prior citation of `108/0` in these documents is retracted.

It concealed a second defect. Those four entries claimed `course_reviews`,
`faqs` and `notices` were PUBLIC-BY-DESIGN. Stage 9 deliberately closed the anon
surface to one table and the live grant set has said `schools` only since
`20260814010000`. The probe's own metadata contradicted the shipped design for
three tables, and nothing failed — because the branch reading that metadata
could not fail.

**Corrected figure, freshly run: 115 checks, 0 failed** — and all 115 can now
fail. The allow path requires HTTP 200 *and* a positive sentinel row this run
created; "200 with zero rows" is not proof for a table that might be empty.

### The two that were wider than reported

**F9 — round 4's fix did nothing.** `20260814190000` revoked anon's EXECUTE and
set `alter default privileges … revoke execute on functions from anon`. But a
new function's ACL read `{=X/postgres, …}` — the empty grantee is PUBLIC, and
anon's access came from there, so revoking from anon removed nothing. Worse,
default privileges are keyed on the CREATING role, and `pg_default_acl` holds
separate rows here for `postgres` and `supabase_admin`; the migration connection
is not a member of the latter. The invariant is now ENFORCED by an event trigger
on `ddl_command_end` rather than configured, because that does not care who
creates the function.

**F11 — a second defect beside the reported one.** The unparseable string was
real. Fixing it exposed that connection details were validated FIRST and by
`throw`, so the credential refusal below was unreachable without live
credentials — the fail-closed path could not be observed at all.

### Defects found while fixing, not reported by anyone

- **F1's own test.** The first draft reused one base time for all five booking
  attempts, and the EXCLUDE constraint rejected two of them because they
  collided with a row a PREVIOUS attempt had just created. Those two read
  400/"protected" while nothing had authorized anything. Disjoint days showed
  all five succeeding. Same trap as round 3's F2.
- **F6's rollout.** `assertScopedFilter` recognised only the legacy marker, so
  every run-scoped delete was refused as unscoped; and the `%` wildcard was
  interpolated raw into a query string, where it begins a percent-escape —
  PostgREST answered 500 on every residue read. F7's new fatal exit caught both
  by failing the run instead of passing it.
- **F9's verification.** An event trigger created in a transaction does not fire
  for DDL later in that transaction, and did not fire for DDL inside a
  `DO $$ … $$` body either. A first attempt also used `acl LIKE '%=X/%'`, which
  matches `postgres=X/postgres` — the owner's own grant — and failed a migration
  against a function that was already correct. A false alarm about a working
  control is the mirror image of a false pass.

### Round-5 migrations

`20260814200000` counseling write boundary · `20260814210000` notification
UPDATE(is_read) only · `20260814220000` future-function EXECUTE event trigger ·
`20260814230000` empirical proof of the above.

### Round-5 verification

| Check | Result |
|---|---|
| Live direct Data API probe | **PASS — 115 checks, 0 failed**, residue clean |
| Live durable audit probe | **PASS — 12 checks, 0 failed** |
| Live notification RLS | **PASS — 12 checks, 0 failed** (was 10; two are the new column checks) |
| Security snapshot vs live DB | **PASS — matches** |
| Whole repository suite | **594 tests, 588 pass, 3 fail (KI-002), 3 skipped** |
| Stage 5 / 6 / 7 / 8 regressions | 19/19 · 15/15 · 32/32 · 15/15 |
| `tsc` / `lint` / `build` | exit 0 / 0 errors / exit 0 |
| Credential scan | 202 shipped files; no secret VALUE, no client-bundle marker |
| `git diff --check` | clean |
| **Rendered browser QA** | **PASS for four flows — see below** |

### Rendered QA — no longer UNVERIFIED

Rounds 3 and 4 recorded this as UNVERIFIED because the preview tool was blocked.
It ran this round.

| Flow | Result |
|---|---|
| assistant `/professor` | **PASS** — 조교 워크스페이스 renders with 상담 신청 현황 (전체 3건 · 대기 1건) and 교육과정 수정 요청 (3건); no "교수 역할로 로그인" anywhere; 0 console errors |
| professor `/professor` | **PASS** — unchanged: profile, calendar, availability, teaching slots |
| student counseling booking | **PASS** — "상담 신청을 보냈습니다." after F1 revoked authenticated INSERT |
| notification mark-read | **PASS** — clicking an unread card took 김학생 from 5 unread to 4 in the database |

**QA residue:** the booking created one real row; the UI cancel did not take, so
it was removed by its exact id and verified — 0 rows remain from that window.

**Still not rendered, stated rather than implied:** roadmap feedback (student
allowed / staff refused) and professor course settings (own course allowed /
foreign refused). Both are covered by `privileged-action-authorization.test.mjs`
driving the REAL actions against fakes that record every write, but neither was
exercised in a browser.

### Claims from earlier rounds that round 5 invalidated

1. **`108/0` — withdrawn.** See above. Replaced by 115/0.
2. *"anon holds one table privilege and no function EXECUTE"* — true of
   functions that EXISTED. A function created afterwards was anon-executable in
   both schemas until `20260814220000`.
3. *"Counseling mutations are server-only"* (round 1, on UPDATE/DELETE) — true
   as written, but INSERT was never in scope and was wide open to the Data API.
4. *"Round 4 fixed the probe's cleanup guarantees"* — the wrapper's rejection was
   still being treated as the operation ending, and the sweep's failure was
   still being dropped from the exit code.
5. *"The 3 skips are POSIX signal delivery on Windows"* — unchanged and still
   accurate; the handler itself remains proven by the IPC-cancel test.

---

## Codex review round 4 (2026-08-14)

Nine substantive findings. Every one was verified against the code, the
migrations and live metadata **before** any change, and every one was
confirmed. Two turned out to be wider than reported, and verifying two others
uncovered defects nobody had reported at all.

| # | Finding | Verdict | Status |
|---|---|---|---|
| 1 | Role broadcasts share one mutable `is_read` | **CONFIRMED** — 14 shared rows live, 12 already flipped | CLOSED |
| 2 | Non-student staff can publish course reviews | **CONFIRMED** — all three roles got 201 | CLOSED |
| 3 | AI CAS: enrollment id discarded, broad predicate, feedback before winning | **CONFIRMED, all three** | CLOSED |
| 4 | Probe: signal races cleanup; body outlives deadline; ambiguous creates; skipped Windows signals | **CONFIRMED, and worse** — see below | CLOSED |
| 5 | Snapshot misses effective EXECUTE semantics | **CONFIRMED, and it found a live gap** | CLOSED |
| 6 | `course_notice` DELETE unverified at runtime | **CONFIRMED — and verifiable after all** | CLOSED, not deferred |
| 7 | Audit probe still on unbounded fetch / weak cleanup | **CONFIRMED** | CLOSED |
| 8 | Recovery documentation overclaims | **CONFIRMED** | CLOSED (this document) |
| 9 | Realtime live delivery | UNVERIFIED, non-blocking | Re-checked; subscription updated for finding 1 |

### What was wider than reported

**Finding 4 — round 3's own deadline fix was incomplete.** Writing the test for
it exposed that the timeout only fired if `fetch` honoured the abort signal. A
transport that ignores it, or a body stream that never settles, left the await
hanging forever with the timer already fired — the precise failure the deadline
exists to prevent. The deadline is now raced independently of the abort, so it
always fires. Proven with an injected fetch that ignores signals entirely.

**Finding 5 — the new guard immediately found a live gap.** Adding effective
`has_function_privilege` coverage turned up two functions `anon` could still
execute (`replace_student_course_schedule_slots`,
`replace_student_custom_course_schedule_slots`), each carrying an explicit
`anon=X` grant from the demo era. `20260814010000` closed the anon surface by
revoking TABLE privileges and asserted exactly that as its postcondition —
FUNCTION privileges were never in scope, so two RPC entry points survived a
migration whose whole purpose was removing them. Bounded (both are SECURITY
INVOKER, so RLS still applied with anon's empty privileges), but the property
rested on a second control rather than on the entry point being shut.

**Finding 6 — and TRUNCATE.** Reading the live privileges to confirm the notice
DELETE property showed `authenticated` effectively holding TRUNCATE on 31 of 54
public tables. TRUNCATE is not subject to RLS and fires no row triggers, so a
role holding it makes every DELETE policy in the schema decorative. Not
reachable through PostgREST, which has no TRUNCATE verb — recorded as least
privilege rather than as an exploit — but "the API happens not to expose the
verb" is a property of PostgREST's feature set, not a security control.

### Round-4 migrations

`20260814150000` notification per-recipient read state (backfill + NOT NULL +
identity-only policies) · `20260814160000` course reviews are student-only ·
`20260814170000` `advance_student_week` atomic transition ·
`20260814180000` revoke TRUNCATE/REFERENCES/TRIGGER from client roles ·
`20260814190000` revoke anon EXECUTE on every function.

All applied live and reconciled; `dump-security-snapshot.mjs --check` reports
the committed snapshot matches the database.

### Round-4 verification

| Check | Result |
|---|---|
| Live direct Data API probe (`rls-probe.mjs`) | **PASS — 108 checks, 0 failed**, residue clean |
| Live durable audit probe | **PASS — 12 checks, 0 failed** |
| Live notification RLS | **PASS — 10 checks, 0 failed** (was 6; four are new peer-isolation checks) |
| Security snapshot vs live DB | **PASS — matches** |
| Rendered browser QA | **UNVERIFIED — the browser preview tool is blocked by this session's permission classifier; no page was rendered** |

### Claims from earlier rounds that round 4 invalidated

1. *"Probe results are trustworthy by construction"* — **overstated.** Round 3's
   deadline depended on the transport honouring an abort signal, and its signal
   handler began destructive cleanup while requests were still in flight.
   Both are fixed; the wording is corrected throughout to describe the specific
   guarantees rather than a general property.
2. *"`anon` holds exactly one privilege in `public`"* — **true of TABLES, false
   overall.** anon held EXECUTE on two functions until `20260814190000`. The
   claim now says "no table privilege outside `schools`, and no function
   EXECUTE anywhere".
3. *"The audit trail is append-only and no role reachable through the API can
   alter or remove a record"* — the CLAIM held, but the audit probe verifying it
   was itself on an unbounded fetch with swallowed cleanup failures. Fixed.
4. *"Notifications: reads and writes share one predicate so a user is never
   shown a notification they cannot mark read"* — still true, but the predicate
   itself was wrong: it matched a shared row whose read state belonged to the
   whole cohort.
5. The round-3 counts (96 probe checks, 6 notification checks, 499 tests) are
   superseded by the round-4 numbers above.

### Still UNVERIFIED or BLOCKED after round 4

- **Rendered browser QA — UNVERIFIED — the preview tool was blocked by the
  session's permission classifier.** Round 4 changed user-visible behaviour in
  two places, both forced by a finding: `/reviews` now refuses a non-student
  ("수강 후기는 학생만 작성할 수 있습니다"), and notification read state is now
  per person so a peer's badge no longer clears. Neither has rendered evidence.
- **Realtime live delivery — UNVERIFIED — needs a real socket and a real
  INSERT.** Finding 1 changed what the subscription carries (every row is now
  recipient-addressed, so the client guard is an exact match); the source-level
  contract was re-checked and regression-tested, but delivery was not exercised.
- **POSIX signal DELIVERY on Windows — UNVERIFIED.** The handler is proven on
  every platform (injected emitter, plus an IPC-cancel test against the real
  runner in a real child process). What cannot be exercised on Windows is
  whether the OS routes Ctrl-C to it.
- **Probe crash safety — NOT CLAIMED.** SIGKILL, power loss and host crashes
  leave ledgered fixtures behind. Recovery is the next run's automatic marker
  sweep plus the operator-run `--sweep`.
- **Full-chain rebuild — BLOCKED — NON-PRODUCTION DATABASE REQUIRED.**
- **Restore from backup — BLOCKED — NO BACKUP EXISTS TO RESTORE FROM.**
- No RPO, no RTO, no PITR. Unchanged and still the most serious operational gap.

---

## Codex review round 3 (2026-08-14)

Twelve findings (F1–F12). Every one was verified against the branch, the
migrations, the installed dependencies and live metadata **before** any change.
**All twelve were confirmed.** Two were materially different from the report and
are recorded as such rather than accepted at face value. Verifying the fixes
exposed one further defect that this round had introduced itself.

| # | Finding | Verdict | Status |
|---|---|---|---|
| F1 | Security-probe results are not trustworthy | **CONFIRMED** — unbounded transport, no signal handling, Auth listing capped at one page, host guard defeatable | CLOSED |
| F2 | `course_reviews` cross-tenant UPDATE | **CONFIRMED, DIFFERENT** — see below | CLOSED |
| F3 | `posts` / `course_notice` provenance is mutable | **CONFIRMED** | CLOSED |
| F4 | Course-less FAQ leaks across tenants | **CONFIRMED** | CLOSED |
| F5 | Roadmap transition has no expected prior state | **CONFIRMED** | CLOSED |
| F6 | AI progress CAS loser still pays for generation | **CONFIRMED** | CLOSED |
| F7 | Audit append-only claim is not backed by an ACL | **CONFIRMED** | CLOSED |
| F8 | `/support` page and action disagree about sessions | **CONFIRMED** | CLOSED |
| F9 | Assistant professor workspace regressed | **CONFIRMED** | CLOSED |
| F10 | Roadmap publication notification has no tenant | **CONFIRMED** | CLOSED |
| F11 | Realtime role broadcasts structurally excluded | **CONFIRMED, WIDER** — the filter excluded them *and* the handshake raced | CLOSED (live delivery UNVERIFIED) |
| F12 | Security snapshot records names, not semantics | **CONFIRMED** | CLOSED |

### The two findings that were not what the report said

**F2 — the reported exploit was blocked, but only incidentally.** The report's
cross-tenant `course_id` move returned 403. That looked like a pass. It was not:
PostgREST was rejecting the row because the *SELECT* policy could not see the
post-update row, not because any rule constrained `course_id`. Adding a
same-tenant `courseAlt` fixture as a discriminator proved it — the same-tenant
move succeeded with 204, so `course_id` was **entirely unconstrained** and only
the tenant coincidence of the reporter's fixture produced the 403. The real
defect was wider than reported and is fixed by column-level UPDATE grants, which
constrain the column itself rather than a visibility side effect.

**F11 — the filter was one of two defects.** The reported `recipient_id` filter
does structurally exclude every role broadcast (those carry a NULL recipient).
But the auth handshake was also fire-and-forget, so the socket could open and
evaluate RLS as `anon` before `setAuth()` ran. Fixing only the filter would have
left a channel that authenticates by luck.

### A defect this round introduced, found by the production build

The F5 fix put the transition matrix and a synchronous `legalSourcesFor` helper
inside `admin-approval.actions.ts`, which carries `"use server"`. Every export
of such a module becomes a remotely invocable endpoint, so Next.js refuses to
build one that exports a non-async function. **`next build` failed.** Neither
`tsc --noEmit` nor `next lint` caught it.

Fixed by moving the matrix to `src/services/roadmap-transitions.ts`, a plain
module. A new guard — `src/services/server-action-contract.test.mjs` — scans
every `"use server"` module in `src` and fails on any non-async export, so this
class of defect now fails in the unit suite instead of at build time. It was
written RED first and reproduced exactly the one offender the build named.

### Round-3 changes

| Area | Change |
|---|---|
| Probe transport | `scripts/security/lib/probe-http.mjs` — one bounded request path; the deadline covers the **body read**, not just headers, so a mid-body stall cannot hang a probe |
| Probe lifecycle | `scripts/security/lib/probe-lifecycle.mjs` — SIGINT/SIGTERM run cleanup once (latched on a promise) and exit 130/143 |
| Probe host guard | rejects embedded credentials, non-HTTPS, any explicit port, and any host that is not exactly `<ref>.supabase.co` / `.supabase.in` |
| Probe pagination | `listUsersByEmailPrefix` pages to exhaustion and **throws** if it does not terminate, instead of silently reporting a clean first page |
| F2 | `20260814110000` — `revoke update on course_reviews`, then column-level grants excluding `author_id`/`course_id` |
| F3 | `20260814120000` — same shape for `posts`; INSERT policy additionally refuses a client-authored `course_notice` |
| F4 | `20260814130000` — FAQ tenant resolves via course **or** `professors.school_id`; the `course_id IS NULL` short-circuit is gone |
| F5 | `.in("status", legalSources)` CAS; zero matched rows redirects to `result=stale` and does **not** notify |
| F6 | the weekly advance is a CAS on `current_week`; only the winner calls `generateWeeklyGuide` |
| F7 | `20260814140000` — explicit `security_events` ACL; no client role holds more than SELECT |
| F8 | `/support` requires a session; the notification is stamped with the session tenant so an admin can actually read it |
| F9 | assistant workspace restored through **tenant scope**, not professor impersonation |
| F10 | roadmap publication broadcast carries `school_id` |
| F11 | `getSession()` → `setAuth()` → *then* subscribe; unfiltered INSERT subscription with RLS doing the filtering |
| F12 | snapshot records `definition_md5`, `tgenabled`, effective privileges (`has_table_privilege`), PUBLIC privileges and column privileges |

### Round-3 verification

Every number below was produced by a fresh run in this session.

| Check | Result |
|---|---|
| Live direct Data API probe (`rls-probe.mjs`) | **PASS — 96 checks, 0 failed**; ledger cleanup complete, residue verification clean |
| Live durable audit probe (`audit-trail-probe.mjs`) | **PASS — 12 checks, 0 failed** |
| Live notification RLS (`verify-notification-rls.mjs`) | **PASS — 6 checks, 0 failed**, own fixtures, cleanup verified clean |
| Security snapshot vs live DB (`--check`) | **PASS — matches** |
| `scripts/**` guard suites | **PASS — 55 tests, 52 pass, 0 fail, 3 skipped** (Windows cannot deliver POSIX signals to a child; covered platform-independently by `lib/probe-lifecycle.test.mjs`) |
| `supabase/**` migration + snapshot guards | **PASS — 57 tests, 57 pass, 0 fail** |
| Whole repository suite | **373 + 126 = 499 tests, 493 pass, 3 fail, 3 skipped** |
| The 3 failures | **the KI-002 trio, confirmed pre-existing** — the same three names fail on `origin/main` in a clean worktree; both test files are untouched by this branch |
| `tsc --noEmit` | **PASS — exit 0** |
| `next lint` | **PASS — exit 0**, 1 pre-existing `no-img-element` warning (baseline) |
| `next build` | **PASS — exit 0**, 26 routes, shared JS 102 kB (unchanged) |
| Credential scan of shipped output | **PASS — 202 files across `.next/static` + `.next/server`, 0 hits.** The only `password123` match anywhere under `.next` is in `.next/cache/webpack/*.pack`, mtime 2026-08-11, i.e. **before** the 2026-08-13 rotation commit `6a3037e`; `.next/` is gitignored and the cache is never served |
| `git diff --check` | **PASS — clean** |
| Rendered browser QA | **UNVERIFIED — the browser preview tool was blocked by this session's permission classifier, so no page was rendered this round.** The F8/F5/F9/F11 UI paths were verified only by build, typecheck and unit guards |

### Claims from earlier rounds that round 3 invalidated

1. *"Anonymous support is preserved"* — **false as of F8.** `/support` now
   requires a session. See the corrected section below.
2. *"Realtime … Not working, and not fixed"* — **superseded.** The client-side
   repair landed (F11). Live delivery is still UNVERIFIED.
3. *"The four passwords still require rotation"* — **stale.** They were rotated
   in round 2 (commit `6a3037e`); corrected below.
4. *"Probe fixtures create/teardown deterministically — PASS, twice"* — round 2
   already corrected this in AUDIT_RECOVERY_DESIGN §6, but the recovery table in
   this document still carried the old claim. Corrected below.
5. *"No client role can INSERT/UPDATE/DELETE [on `security_events`]"* — this was
   true of the **policies** but was not backed by an **ACL** until F7. The claim
   is now enforced by an explicit grant/revoke and asserted from the snapshot.
6. The round-2 result table's counts (85 probe checks, 11 audit checks, 348
   tests) are superseded by the round-3 table above.

---

## Codex review round 2 (2026-08-14)

Nine findings. **All nine were verified against the branch before any change and
all nine were confirmed** — none needed push-back. Four were materially worse
than reported, and verifying the fixes exposed two further defects that Stage 9
had introduced itself.

| # | Finding | Verdict | Status |
|---|---|---|---|
| F1 | Probe cleanup can leak fixtures and Auth users | **CONFIRMED** — 6/6 injected failures leaked; residue never affected the exit code; a live run had already left 4 posts + 2 course_reviews behind while reporting clean | CLOSED |
| F2 | Foreign-course enrolment is a cross-tenant read primitive | **CONFIRMED, WIDER** — five tables, not one | CLOSED |
| F3 | Direct UPDATE bypasses Stage 5 counseling protections | **CONFIRMED, WORSE** — a professor could also reassign the request to another tenant's student | CLOSED |
| F4 | Roadmap workflow is globally cross-tenant | **CONFIRMED** — no tenant column existed at all; the predicted professor regression was real | CLOSED |
| F5 | Historically exposed demo credentials unchanged | **CONFIRMED** | CLOSED — **rotated**, not BLOCKED |
| F6 | Support category/payload insufficiently bounded | **CONFIRMED** | CLOSED |
| F7 | service_role ACLs not guaranteed by migrations | **CONFIRMED** — privileges existed only as platform defaults | CLOSED |
| F8 | Audit attribution can disappear; SSO write fire-and-forget | **CONFIRMED** | CLOSED |
| F9 | schema.sql represents pre-Stage-9 state | **CONFIRMED** | CLOSED (regeneration BLOCKED — Docker) |

**Two defects Stage 9 itself introduced, found by verifying the fixes:**

1. Revoking authenticated INSERT on `roadmap_revision_requests` silently broke
   `updateOwnCourseRoadmap`, which still used the session client. Fixed by
   moving it to the service role after its existing ownership check — not by
   restoring the grant.
2. The append-only audit trigger rejected the `ON DELETE SET NULL` cascade, so
   deleting a profile with audit history failed outright. The audit trail had
   become a lock on user deletion. Fixed by dropping the FK constraints and
   relying on the immutable snapshots.

**Two probe defects had to be fixed before F2 could be measured honestly:**
`rawFetch` dropped per-call headers so a successful INSERT read as "denied", and
requesting a representation made PostgREST re-check the new row against the
SELECT policy — manufacturing 403s that vanish when an attacker omits the
header. Write outcomes are now confirmed by service-role read-back, posted
without the header.

**A Stage 9 claim this round invalidated:** "Probe fixtures create and tear down
deterministically — PASS, twice" was false. Corrected in AUDIT_RECOVERY_DESIGN §6.

### Review-round migrations

`20260814050000` tenant-correlated writes · `20260814060000` counseling write
boundary · `20260814070000` roadmap tenant scope · `20260814080000` audit
durability + explicit ACLs · `20260814090000` audit FK detach ·
`20260814100000` least privilege on `schools`.

### Review-round results

| Check | Result |
|---|---|
| Live direct Data API probe | **85 checks, 0 failed** (was 67/26 before Stage 9) |
| Live durable audit probe | **11 checks, 0 failed** |
| Probe cleanup fault injection | 27/27 |
| Probe guard | 9/9 |
| Migration guards | 27/27 |
| Security snapshot drift guards | 11/11 |
| Support abuse boundary | 9/9 |
| Demo credential regression guard | 6/6 |
| Full app suite | 348 tests, 345 pass, **3 fail — the pre-existing KI-002 trio by name** |
| Typecheck / lint / build | clean / baseline / PASS, budgets met, shared JS 102 kB |
| Credential scan of `.next/static/**` | 0 hits |
| Rendered QA | login (via the gated demo panel, rotated credential), dashboard, counseling, notifications — **0 console errors, 0 server errors** |
| Probe residue after every live run | clean, verified |

## Threat model summary

Two structural facts drive everything. **The browser holds a Supabase
publishable key**, so every table `anon` can reach is reachable by `curl` — the
Next server was never in front of the Data API. **A Next.js server action runs
before any page renders**, and its id is in `/_next/static/**`, so the
page-level `requireRoles` guards protected nothing. Together they meant the
platform's real authorization model was a set of `demo anon ... using (true)`
policies from July, with the application beside that path rather than in front
of it.

## Authorization model now implemented

```
trusted identity → tenant membership → role → server/domain validation
                 → database/RLS → auditable result
```

Identity is `profiles.auth_user_id`, resolved by SECURITY DEFINER helpers in
`app_private` (a schema PostgREST does not expose) with `search_path = ''`
(D-024). `anon` holds exactly one TABLE privilege in `public`: SELECT on
`schools` — and, since round 4's `20260814190000`, **no function EXECUTE
anywhere**. The earlier wording said "exactly one privilege", which was true of
tables and false overall: two demo-era RPCs kept an explicit `anon=X` grant that
the table-only closure never looked at.

## RLS changes

Five migrations, all applied live, each with preconditions and postconditions
that abort the transaction on violation:

- `20260814000000` identity helpers; relocates the two offering predicates out
  of `public` (closes KI-011)
- `20260814010000` drops the entire `demo anon` family, repairs the dead
  identity predicates, adds tenant-scoped catalog/workflow policies, closes
  notification INSERT to every client role, and ends with a blanket revoke so
  the anon surface is an explicit one-table allowlist
- `20260814020000` the ten hand-applied columns, idempotently
- `20260814030000` `public.security_events`
- `20260814040000` binds `approve_course_weekly_plan` to its caller

Plus an additive guard in `20260812070000` so `posts.school_id` exists at its
first point of use (D-026).

**The ordering was forced:** the anon policies were load-bearing *because* the
authenticated policies were dead. Dropping them first would have produced a
platform where nobody could read their own data.

## Direct Data API test results

`scripts/security/rls-probe.mjs` — two disposable tenants it provisions and
removes, attacked as anon, user A and user B over plain PostgREST.

| | Before | After |
|---|---|---|
| 67 checks | **26 FAILED** | **0 FAILED** |

Confirmed **live and unauthenticated** before the fix: read all 27 profiles, 12
student profiles, 12 enrolments, 5 syllabi (incl. extracted text), 22 teaching
slots, 9 availability rows, 3 revision requests; PATCH any profile; POST a
profile with `role=admin` (HTTP 201); POST and PATCH counseling availability;
POST a notification to a named recipient; PATCH another student's
`current_week` and mission progress. All denied after.

## Cross-tenant evidence

Signed in as a student of tenant B: reads of tenant A's mission progress,
professor admin tasks, syllabi, catalog and professor directory all returned
rows before, **0 rows after**. A cross-tenant write of A's mission progress
succeeded before, denied after.

Nine **allow** checks stayed green — a fix that denies everyone is not a fix.
One of them (`A reads own student profile`) was *failing before*, which is the
cleanest proof that the authenticated layer had never worked.

## IDOR findings and fixes

Availability rows (ids were anon-readable, `toggleProfessorAvailability` took an
id with no session), notifications (arbitrary `recipient_id`), profiles
(arbitrary id + `role`), enrolments, mission progress, syllabi via
`getCourseRoadmap(courseId)`, curriculum revisions via
`updateRoadmapRevisionStatus(requestId)`. Each is now closed at both layers:
the action re-derives ownership, and the database denies the direct path.

## Service-role / RPC findings

All nine app functions reviewed against **live** definitions. Eight need no
change. `approve_course_weekly_plan` took `p_professor_id` from the caller
without checking the caller *was* that professor — now bound, body otherwise
byte-identical (it upserts 15 plans and notifies every enrolled student).

**A discovery finding was wrong and no change was made:**
`answer_professor_questions` was reported as letting any assistant answer any
tenant's questions. That cited the superseded 2026-07-14 definition; the live
function is the Stage 6 rewrite, whose assistant branch already requires a
tenant match.

Four service-role sites that *substituted* for authorization were fixed
(professor fallback, enrolment tenant gate, syllabus read, AI tutor tenant
join). Five more with a single well-behaved caller are recorded in KI-022.

## Support boundary decision — CORRECTED IN ROUND 3

**Support requires a session (F8).** Round 1 preserved anonymous submission and
replaced the boundary; round 3 found that the *page* already gated itself with
`requireRoles` while the *action* still accepted sessionless submissions — and
that those submissions wrote a role broadcast with a **NULL tenant**, which
matches no reader under the notification policy. Every anonymous inquiry was
being accepted and then silently discarded into a row no administrator could
read. The page and the action disagreed, and the losing side was the user's.

Option A (require login) was chosen from repository evidence rather than
preference: the page already enforced it, and KI-021 records sessionless
submission as a defect rather than a feature.

The input boundary from round 1 is unchanged and still holds: the caller
controls only a length-bounded title, a bounded body and an allowlisted
category. Every routing field is a constant (`recipientRole: admin`,
`recipientId: null`, `category: system`, `targetHref: /admin`), and the tenant
now comes from the **session**, never the form. No client role holds INSERT.

Per-IP throttling deliberately not added — campus NAT makes an IP a building,
and an in-memory limiter on serverless is per-instance theatre (KI-021).

## Realtime notification result — CORRECTED IN ROUND 3

Round 1 recorded this as "not working, and not fixed". Round 2 gave the socket
the user JWT. Round 3 (F11) found **two** remaining defects and fixed both:

1. the handshake was fire-and-forget, so the socket could open and evaluate RLS
   as `anon` before `setAuth()` ran — it authenticated by luck;
2. the subscription filtered on `recipient_id`, which can never match a role
   broadcast, because those carry a NULL recipient. Tenant-wide announcements
   could not arrive whatever RLS permitted.

Now: `await getSession()` → `setAuth(token)` → *then* subscribe, with an
unfiltered INSERT subscription and RLS doing the filtering. The client-side
recipient check remains as defence in depth, not as the boundary. **RLS was not
weakened** — asserted by `notification-realtime.test.mjs`.

**Live delivery remains UNVERIFIED — it requires a real socket, a real INSERT
and a rendered browser session; the channel is off by default and the browser
preview was blocked this session.** DEFERRED — Stage 10.

## Demo credential decision

`demo-users.json` (four plaintext passwords incl. `admin1@pacemate.edu`) was
imported by a `"use client"` component and was **verifiably present in the built
client bundle**. Now behind `import "server-only"` plus a
`PACEMATE_ENABLE_DEMO_LOGIN` gate; the browser receives names/roles/identifiers
only and a server action looks the password up. Verified: a scan over
`.next/static/**` and `.next/server/**` finds nothing; the panel does not render
without the flag. QA usability is preserved.

**The four passwords WERE rotated** in round 2 (commit `6a3037e`) — this is not
outstanding operator action. The earlier "still require rotation" wording is
superseded. Round 2 also re-rotated all four a second time after I leaked the
first set into a session transcript by reading `.env.local`; that incident and
its lesson are recorded in RECOVERY_RUNBOOK §3.4.

## Privacy / PII summary

Full inventory in PRIVACY_DATA_MAP.md. The headline change: an unauthenticated
caller could previously read every profile, every student's career goals and
self-declared weaknesses, every enrolment, every syllabus's extracted text and
every professor's contact details. All now require a session and, mostly, the
same university.

Gaps recorded, not closed: **no erasure path, no retention, no export** for any
personal data (`deleteAiTutorSession` is the only user-invocable deletion in the
app); client storage bleeds across accounts on shared devices.

**No compliance claim is made.** This is an engineering audit.

## AI data-sharing findings

One processor (OpenAI, `gpt-4o-mini`, five call sites), no user identifier sent.
The one call with **no timeout** is now bounded (20 s) — Stage 8 fixed the other
three and missed it. Two prompts send more than they need (a whole onboarding
row including a free-text transcript; interests + career goal in a
syllabus-progress prompt). Not narrowed: it changes what students are shown.
The consent mechanism to extend already exists in the same file.

## Secret / logging findings

**No secret in git history; no rotation required by the sweep.** `.env.local`
was never committed; the only key-shaped literal in the repo is the Supabase
publishable key, which is a public identifier and correctly not treated as a
secret. The one real exposure was the demo credentials, above.

Logging: the allowlist is real but governs 6 of ~116 `console.*` sites, and
several raw `PostgrestError` logs sit around the most sensitive tables. One was
converted this stage as the pattern; the rest is recorded with file:line.

## Durable audit strategy

`public.security_events` (D-025), written through the two existing chokepoints
so no call site changed shape. Scope is narrow by design — identity, privilege,
tenant configuration, correctness-critical state; never page requests. No client
role can INSERT/UPDATE/DELETE and no non-SELECT policy exists (asserted as a
postcondition); reads are tenant-admin-scoped. **Not claimed tamper-proof** —
no hash chain, no signature. Best-effort by design: a failed insert degrades to
a log line rather than breaking the audited action.

**Round 3, F7 — the append-only claim now has an ACL behind it.** Until
`20260814140000`, "no client role can write the audit trail" rested on the
absence of a policy while the underlying table privileges were whatever the
platform defaults happened to be. A policy-only guarantee is not a guarantee.
The migration revokes everything on `security_events` from `public`, `anon`,
`authenticated` and `service_role`, then grants exactly `SELECT` to
`authenticated` and `INSERT, SELECT` to `service_role`. The snapshot now records
**effective** privileges via `has_table_privilege`, so a privilege arriving
through PUBLIC or role inheritance is drift, not an invisible hole.

Production append-only behaviour was **not weakened for testing convenience**.
The probe cannot delete its own audit rows, so its test events remain in
`security_events` permanently and the probe reports them rather than cleaning
them up.

Live-verified this round: **PASS — 12 checks, 0 failed.** Service role can
append; the record cannot be UPDATEd or DELETEd even by the service role; anon
cannot read, append, rewrite or delete; the attribution snapshot is written at
event time and survives deletion of the actor's profile.

## Backup / recovery capability

- **PITR: off.** `pitr_enabled: false`, verified via the CLI.
- **Physical backups: none listed.** `backups: []`.
- **No backup mechanism in the repo.** No dump script, cron or CI.
- **No down migrations.** Forward-fix is the only rollback.
- Migration history is fully reconciled — 55/55 local↔remote. This **closes the
  open half of KI-006**.
- **BLOCKED — confirm plan-tier daily logical backups and retention in the
  Supabase dashboard.**

**No RPO or RTO is claimed.** On this evidence there is no verified recovery
point of any kind. RECOVERY_RUNBOOK.md is written against what exists, and §6
lists plainly what is impossible today.

## What recovery was actually tested

| Exercise | Result |
|---|---|
| Migration chain applies forward with pre/postconditions | PASS |
| A postcondition genuinely fails closed | **PASS, demonstrated** — the first push aborted on my own over-strict assertion and applied nothing |
| Drift repair idempotent against the populated DB | PASS |
| Migration history reconciled | PASS 55/55 |
| ~~Probe fixtures create/teardown deterministically~~ | **RETRACTED — this claim was false.** Round 2 proved 6 of 6 injected provisioning failures leaked, and that a live run had already left 4 posts and 2 `course_reviews` behind while reporting clean. Teardown is now ledger-driven with fatal residue verification; round 3 additionally made it survive SIGINT/SIGTERM and a mid-body transport stall. Current status: **PASS — 96/12/6 live checks this round, residue verified clean after each.** No crash-safety or SIGKILL claim is made |
| Audit trail resists client mutation | **PASS — 12/12 this round**, and now backed by an explicit ACL (F7), not only by policy |

## What recovery remains UNVERIFIED / BLOCKED

- **Full-chain rebuild into an empty database — BLOCKED — NON-PRODUCTION
  DATABASE REQUIRED.** Docker is not running, there is no
  `supabase/config.toml`, and the only project is live production. The D-1
  repair is reasoned and unit-guarded, **not proven by execution**.
- **Restore from backup — BLOCKED — NO BACKUP EXISTS TO RESTORE FROM.**
- Per-tenant export/restore: no mechanism exists.
- Service-role activity after a key compromise: unknowable, no access log.

## Migrations applied

Round 1: `20260814000000`, `20260814010000`, `20260814020000`,
`20260814030000`, `20260814040000`, plus the additive guard in `20260812070000`.

Round 2: `20260814050000` tenant-correlated writes · `20260814060000` counseling
write boundary · `20260814070000` roadmap tenant scope · `20260814080000` audit
durability + explicit ACLs · `20260814090000` audit FK detach ·
`20260814100000` least privilege on `schools`.

Round 3: `20260814110000` review provenance immutable (F2) ·
`20260814120000` post / course-notice provenance (F3) · `20260814130000` FAQ
tenant scope (F4) · `20260814140000` audit append-only ACL (F7).

All are applied live and reconciled; `dump-security-snapshot.mjs --check`
reports the committed snapshot matches the live database.

## Security test results

| Check | Result |
|---|---|
| Live direct-Data-API probe | **67 checks, 26 FAILED → 0 FAILED** |
| Audit trail live properties | 5/5 |
| `probe-guard.test.mjs` (new) | 9/9 |
| `stage9_rls.test.mjs` (new) | 10/10 |
| Full suite | 333 tests, 330 pass, **3 fail — the pre-existing KI-002 trio by name** (Stage 8 baseline identical) |
| Typecheck | clean |
| Lint | baseline (1 pre-existing `no-img-element` warning) |
| Build | PASS, `BUILD_ID -cqYGI5z8pJg6PnNtwlo8`, budgets met, shared JS 102 kB unchanged |
| Credentials in `.next/static/**` | **0 hits** (was: present) |
| `git diff --check` | clean |

Two Stage 8 test harnesses were updated for changed imports
(`request-id-propagation`, `ai-tutor.actions.authz`) — stubs only, no assertion
weakened.

## Previous-stage regression evidence

Stage 2 availability semantics untouched. Stage 3 budgets met, shared JS
unchanged. Stage 4 UI/UX: no user-visible copy or layout changed; the only
visual difference is the QA demo panel not rendering without its flag. Stage 5
booking/concurrency suites green (the live 20-student contention harness was
**not** re-run — it refuses to run against a production project by its own
Stage 8 guard, and Stage 9 touched no booking path). Stage 6 tenant isolation
green and materially extended. Stage 7 SSO green (43 tests); the audit emitter
gained a durable sink behind its frozen output shape. Stage 8 observability
green; the timeout/retry work is untouched and the one OpenAI call it missed is
now bounded.

## Rendered QA

**Round 1 (historical record).** Production build against the live database:
login, dashboard (full render — notifications, timetable, counseling, calendar,
completion evidence, all course cards), counseling (tenant professor directory,
availability calendar, existing booking), notifications (12 rows, 5 unread),
courses, support (end-to-end submission with the correct constrained row shape;
QA row deleted). 0 browser console errors, 0 server errors.

**Round 3 — UNVERIFIED — the browser preview tool was blocked by this session's
permission classifier, so no page was rendered.** The round-1 evidence above
predates the F8, F9 and F11 changes and therefore does **not** cover them. The
following user-visible paths changed this round and have **no rendered
evidence**:

- `/support` now refuses a sessionless submission (F8)
- `/admin` shows a new `result=stale` banner when a decision loses the CAS (F5)
- `/professor` assistant workspace renders tenant counseling data with
  `professor: null` (F9)
- the notification bell's Realtime channel (F11)

They are covered by the production build, `tsc --noEmit`, and unit guards
(`support-boundary` 13, `roadmap-transition` 7, `notification-realtime` 5,
`notification-tenant-scope` 3) — which is not the same as having been looked at.
Re-running rendered QA over these four paths is a prerequisite for merge.

## Remaining risks (after the review round)

Ranked. Full detail in KI-022.

1. **No recovery point exists.** The most serious operational risk on the
   platform, and not fixable from the repository.
2. **`pdf-parse` runs a 2018 pdf.js on uploaded files** in a process holding the
   service-role key, with no page cap and no timeout.
3. **No erasure path** for any personal data.
4. **Tenant consistency has no composite foreign keys** — cross-tenant rows
   remain structurally creatable even though no reachable path creates them.
5. `next` one patch behind a Server-Function disclosure advisory.
6. Raw DB errors logged around sensitive tables; the allowlist governs 6 of ~116
   log sites.
7. ~~Realtime notifications silently non-delivering.~~ **Superseded by F11** —
   the two client-side defects are fixed; live delivery is UNVERIFIED, not
   known-broken.
8. Per-user session revocation still impossible (8h HMAC, no store).
9. **No rendered QA covers the round-3 UI changes** (F5, F8, F9, F11). See the
   Rendered QA section.
10. **Probe crash safety is not claimed.** SIGINT and SIGTERM run cleanup once
    and exit 130/143, verified by unit tests with an injected process handle.
    SIGKILL, a power loss or a host crash leave ledgered fixtures behind; the
    next run's residue verification is what catches that, not the probe itself.
    The subprocess signal tests **skip on Windows** with an explicit reason
    (POSIX signals are not deliverable to a child process there) — a skip, never
    a pass.

## Relevant commits

See `git log main..upgrade/stage-9`. The stage is organised as: probe harness →
RED evidence → identity repair → anon closure → application authorization →
audit trail → documentation.

## Stage 10 inputs

- **Rendered QA over the four round-3 UI paths** (`/support` sessionless
  refusal, `/admin` stale banner, `/professor` assistant workspace, the
  notification bell's Realtime channel). Required before merge, not after.
- **Prove Realtime delivery end to end** — a real socket, a real INSERT, both a
  direct notification and a role broadcast.
- **First action: `next` → 15.5.21.** Deferred here only to keep an RLS
  regression attributable.
- **Create a non-production Supabase project.** It unblocks the rebuild proof,
  the restore drill, migration rehearsal, per-tenant export, the erasure path,
  and the Stage 8 load tiers. Highest-leverage single item.
- **Add `supabase/config.toml`** so `supabase db reset` becomes the standing
  regression test against schema drift recurring.
- **Add a `test` script and CI.** Every gate today — the suite, bundle budgets,
  `rls-probe.mjs`, `verify-notification-rls.mjs` — is manual. `rls-probe.mjs` is
  designed to run in CI against a scratch project.
- **Backups**: confirm the dashboard tier, enable PITR if available, and add an
  external scheduled dump.
- Rotate the four demo passwords and consider deleting the `admin1@` account.
- `supabase/schema.sql` should be regenerated or deleted; it is stale, partly
  corrupt, and is cited as authoritative by 18 documents.
