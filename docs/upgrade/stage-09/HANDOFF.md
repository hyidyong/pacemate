# Stage 9 Handoff — Security / Privacy / Audit / Recovery

## Status

COMPLETE on `upgrade/stage-9`, REVISED after an external Codex security review
that returned **NOT SAFE TO MERGE**. Base `main` @ `fd44172` (Stage 8 PR #42
merged 2026-08-12, verified). Not merged — that is the human's call. Stage 10
not started. The next step is another independent Codex review.

## Codex review round (2026-08-14)

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
(D-024). `anon` holds exactly one privilege in `public`: SELECT on `schools`.

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

## Support anonymous-boundary decision

Anonymous support is **preserved**; the boundary is replaced. Before: an anon
INSERT into a general-purpose notification table with a caller-chosen recipient,
role, tenant and `target_href`. After: a validated server action writing under
the service role, where every routing field is a constant
(`recipientRole: admin`, `recipientId: null`, `category: system`,
`targetHref: /admin`) and the caller controls only a length-bounded title and
body. No client role holds INSERT any more. Verified end-to-end in the browser;
the stored row had exactly that shape.

Per-IP throttling deliberately not added — campus NAT makes an IP a building,
and an in-memory limiter on serverless is per-instance theatre (KI-021).

## Realtime notification result

**Not working, and not fixed — stated rather than glossed.**
`notification-menu.tsx` subscribes through a client that never reads the auth
cookie, so the socket is `anon`, which has had no SELECT policy since Stage 8.
Page loads and the bell are unaffected, so the failure is silent. Stage 9
refused to weaken RLS for it. The repair is client-side (`createBrowserClient`
+ `realtime.setAuth`), the channel is off by default, and it is recorded in
KI-022. **UNVERIFIED in a browser.**

## Demo credential decision

`demo-users.json` (four plaintext passwords incl. `admin1@pacemate.edu`) was
imported by a `"use client"` component and was **verifiably present in the built
client bundle**. Now behind `import "server-only"` plus a
`PACEMATE_ENABLE_DEMO_LOGIN` gate; the browser receives names/roles/identifiers
only and a server action looks the password up. Verified: `grep` over
`.next/static/**` finds nothing; the panel does not render without the flag.
QA usability is preserved. **The four passwords still require rotation** —
operator action, RECOVERY_RUNBOOK §3.4.

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

Live-verified 5/5: service role can append; anon cannot read, append, rewrite or
delete.

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
| Probe fixtures create/teardown deterministically | PASS, twice, baseline restored exactly |
| Audit trail resists client mutation | PASS 5/5 |

## What recovery remains UNVERIFIED / BLOCKED

- **Full-chain rebuild into an empty database — BLOCKED — NON-PRODUCTION
  DATABASE REQUIRED.** Docker is not running, there is no
  `supabase/config.toml`, and the only project is live production. The D-1
  repair is reasoned and unit-guarded, **not proven by execution**.
- **Restore from backup — BLOCKED — NO BACKUP EXISTS TO RESTORE FROM.**
- Per-tenant export/restore: no mechanism exists.
- Service-role activity after a key compromise: unknowable, no access log.

## Migrations applied

`20260814000000`, `20260814010000`, `20260814020000`, `20260814030000`,
`20260814040000`, plus the additive guard in `20260812070000`.

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

Production build against the live database: login, dashboard (full render —
notifications, timetable, counseling, calendar, completion evidence, all course
cards), counseling (tenant professor directory, availability calendar, existing
booking), notifications (12 rows, 5 unread), courses, support (end-to-end
submission with the correct constrained row shape; QA row deleted).
**0 browser console errors, 0 server errors.**

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
7. Realtime notifications silently non-delivering.
8. Per-user session revocation still impossible (8h HMAC, no store).

## Relevant commits

See `git log main..upgrade/stage-9`. The stage is organised as: probe harness →
RED evidence → identity repair → anon closure → application authorization →
audit trail → documentation.

## Stage 10 inputs

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
