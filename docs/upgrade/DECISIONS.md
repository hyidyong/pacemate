# Architectural Decisions

## D-027 — A test harness that mutates a live project owns a cleanup ledger, and cannot pass without proving it cleaned up

Status: Accepted (Stage 9, Codex review round, 2026-08-14)

Context: the Stage 9 probe built its fixture list locally and only handed it to
the caller on success, so any mid-provision failure orphaned everything already
created — including Auth users. Measured with fault injection: 6 of 6 injected
failures leaked. Cleanup errors were swallowed, residue was printed but never
affected the exit code, and no network call had a timeout.

Decision: the ledger belongs to the CALLER, not the provisioner. Every resource
is recorded the instant it exists and before the next operation that can fail;
the runner's top-level `try` encloses provisioning itself; cleanup is strict LIFO
(dependency-safe by construction, because children are created after parents);
nothing is swallowed; and the run exits non-zero on any cleanup failure, any
residue, or any residue check that could not be PERFORMED. All network calls are
bounded.

Reason: "we clean up in a finally" is not a safety property when the finally
cannot see what was created. A probe that cannot prove it cleaned up is not safe
to point at a live project, whatever its security checks said.

Consequences: fault injection at every provisioning boundary is part of the
suite (27 tests, offline). NO CRASH SAFETY IS CLAIMED — `finally` does not run on
SIGKILL; the independent recovery mechanism is the operator-run
`rls-probe.mjs --sweep`. Any new table the probe can write to must also be added
to the residue list, which a live leak (4 posts, 2 course_reviews) proved is not
optional.

**Amended in review round 3 (F1).** This decision claimed "all network calls are
bounded". That was **not true as written**: the timeout covered the response
headers only, so a server that sent headers and then stalled mid-body held the
probe open indefinitely — with the ledger un-run. Three further gaps were found
at the same time: SIGINT/SIGTERM abandoned the ledger entirely; the GoTrue admin
listing read only its first page, so residue beyond it reported clean; and the
host guard accepted any hostname ending in `.supabase.co`, including a lookalike
such as `<ref>.supabase.co.attacker.example`, which would have sent a
service-role key to an attacker-controlled host.

The decision now reads: **bounded means the deadline covers the body read**
(`lib/probe-http.mjs` is the single transport), **cleanup is signal-aware and
runs exactly once** (`lib/probe-lifecycle.mjs`, latched on a promise, exiting
130/143), **enumeration pages to exhaustion or throws**, and **the destination
host is validated exactly**, not by suffix. Crash safety is still not claimed.

## D-030 — Provenance is enforced by column privilege, not by policy predicate

Status: Accepted (Stage 9, Codex review round 3, 2026-08-14)

Context: `course_reviews` and `posts` had UPDATE policies that established
ownership — "you may update the row you authored". Ownership is a property of
the *caller*; it says nothing about which row the caller is now claiming to have
authored. A legitimate owner could rewrite `course_id`, `author_id`,
`school_id`, `community_type` and `board_key`: the columns that decide where the
row lives, who wrote it, and how much the reader should trust it. The concrete
attack is content integrity rather than data theft — a student-authored post
promoting itself into `course_notice`, which renders to students as official
course communication.

The obvious fix is a policy predicate comparing new to old. It was rejected.

Decision: revoke table-wide UPDATE from the client roles and grant UPDATE on
exactly the mutable columns.

```sql
revoke update on public.course_reviews from authenticated, anon;
grant update (difficulty, workload, grading_style, team_project, content,
              updated_at)
  on public.course_reviews to authenticated;
```

Reason: three things, in order of importance.

1. **It cannot be reasoned about wrongly.** A predicate expresses "this column
   must not change" as a comparison that has to be correct for every path —
   including paths that do not name the column. A privilege expresses it as
   absence. There is no expression to audit.
2. **It survives a new policy.** Someone adding a policy later cannot
   accidentally widen what a role may write, because the grant is the ceiling.
3. **It is visible in the snapshot.** Column privileges are now dumped and
   asserted, so re-granting `UPDATE` table-wide fails a test.

The finding that produced this decision is also the reason to distrust the
alternative. The reported F2 exploit returned 403 and looked blocked. It was
not: PostgREST was re-checking the post-update row against the SELECT policy and
rejecting it there. A same-tenant control fixture made the same move succeed
with 204. **A denial produced by a visibility side effect is not an
authorization control** — and a policy-predicate fix would have been validated
against exactly that kind of misleading signal.

Consequences: adding a legitimately mutable column to either table now requires
a migration to grant it, which will look like friction the first time it
happens. That is the intended cost. `supabase/security-snapshot.test.mjs`
asserts the provenance columns are ungranted, so the invariant fails a test
rather than a review.

## D-031 — An operation that cannot prove it won must not have effects

Status: Accepted (Stage 9, Codex review round 3, 2026-08-14)

Context: two independent lost-update races, found as F5 and F6.
`updateRoadmapRevisionStatus` matched on id and tenant with no expected prior
state, so two admins deciding simultaneously **both** succeeded — last write
wins in the table, but both had already fanned out a student-facing
notification, and a terminal `approved` could be walked back to
`assistant_reviewed`. `submitProgressFeedback` advanced a student's week without
checking the week it read was still current, so a racing submission paid for a
second AI generation and produced a duplicate guide.

Both would ordinarily be filed as concurrency defects. They are recorded as
security decisions because in each case **the loser still acted**.

Decision: any state transition whose success has an external effect —
a notification, an AI call, a publication — is a compare-and-set that names its
expected prior state, and the effect is conditional on the matched-row evidence:

```ts
const { data: updated } = await client.from("roadmap_revision_requests")
  .update(patch)
  .eq("id", requestId).eq("school_id", profile.school_id)
  .in("status", legalSources)
  .select("id, title, course_id, course_code");

if (!updated || updated.length !== 1) redirect(`/admin?result=stale&...`);
```

Zero matched rows means **stale**, never success. The user is told
("이미 처리된 요청입니다"), the notification is not sent, and the AI call is not
made.

Reason: "the update returned no error" is not evidence that the update happened.
PostgREST reports a zero-row UPDATE as a successful request, so an action that
ignores the row count cannot distinguish winning from losing — and will
cheerfully notify students about a decision it did not make. Requiring the
matched row makes the difference impossible to ignore.

Consequences: legal transitions are now data
(`src/services/roadmap-transitions.ts`), which makes them reviewable and
testable in isolation. The fakes in the tests model the CAS honestly — they
return an empty array for a loser, so the tests can fail. A user who loses a
race sees a new message rather than a silent no-op, which is a deliberate,
finding-driven UX change.

## D-032 — Every export of a `"use server"` module is a public endpoint, so pure helpers live elsewhere

Status: Accepted (Stage 9, Codex review round 3, 2026-08-14)

Context: the D-031 fix put the transition matrix and a synchronous
`legalSourcesFor` helper in `admin-approval.actions.ts`, which carries
`"use server"`. `next build` failed: *"Server Actions must be async functions."*
Neither `tsc --noEmit` nor `next lint` caught it — only the production build
did.

Decision: a `"use server"` module exports **only** async server actions. Any
pure helper it needs lives in a plain module it imports.

Reason: this is not a style rule dressed up as a build constraint. Next.js
compiles every export of a `"use server"` module into a remotely invocable
endpoint with a generated action id that ships in the client bundle. Exporting
an internal authorization table there asks the framework to publish it as a
callable surface; the framework refuses to build rather than emit something
half-callable. Given that Stage 9's central finding was *server actions are
reachable before any page guard runs*, treating this as a build annoyance rather
than as a boundary would be exactly the wrong lesson.

Consequences: `src/services/server-action-contract.test.mjs` scans every
`"use server"` module under `src` and fails on any export that is not an async
function, allowing `export type`/`interface` (erased) and
`export const f = async () =>`. It was written RED first and reproduced exactly
the one offender the build named. The class of defect now fails in the unit
suite in under a second instead of at the end of a production build.

## D-028 — Ownership is not authorization for a row that references a tenant resource

Status: Accepted (Stage 9, Codex review round, 2026-08-14)

Context: Stage 9 scoped reads by tenant and writes by ownership. "Is this row
mine?" is perfectly true of an enrolment in another university's course, and
every feature that authorizes on "is enrolled" then treats that row as
permission to read the other tenant's material. Five tables were live-exploitable
over direct PostgREST: student_courses, student_mission_progress, study_roadmaps,
study_tasks and posts.

Decision: any caller-owned row that references a tenant resource must carry a
tenant term in WITH CHECK — `app_private.course_in_current_tenant()` /
`offering_in_current_tenant()`, SECURITY DEFINER with `search_path = ''`. The
same rule applies to parent references (a study task must hang off a roadmap the
caller owns). Server-side validation is an additional layer, never the only one,
because PostgREST bypasses it.

Reason: the app-layer gate added in the same stage was bypassed by a single curl.

Consequences: `supabase/security-snapshot.test.mjs` fails the build if an owning
policy loses its tenant term. Probes must post WITHOUT
`Prefer: return=representation` — asking for a representation makes PostgREST
re-check the row against the SELECT policy and roll back, which manufactures
403s that vanish when a real attacker omits the header.

## D-029 — Mutations with a workflow are server-only; audit records reference nothing that can damage them

Status: Accepted (Stage 9, Codex review round, 2026-08-14)

Context (a): Stage 5 built a transition matrix, a compare-and-set and a
notification fan-out for counseling. Stage 9 then authorized the professor
UPDATE policy by ownership alone, so a professor could PATCH status, times and
even reassign the request to another tenant's student — bypassing all of it.

Decision (a): revoke, do not reimplement. Every counseling UPDATE already runs
through the service role after a server-side check, so no client role needs it.
Restating the Stage 5 matrix as a column-and-state RLS policy would create two
implementations of one rule that can drift apart.

Context (b): `security_events` used nullable FKs with ON DELETE SET NULL, so
deleting a profile erased the attribution of every historical event about it.

Decision (b): attribution is an immutable snapshot (`actor_ref`, `school_ref`,
`actor_role_ref`) written by a BEFORE INSERT trigger, and the FK CONSTRAINTS are
dropped. Append-only is enforced by a BEFORE UPDATE trigger. Privileged ACLs are
granted explicitly rather than inherited from platform defaults, and verified in
both directions.

Reason (b): a nullable FK is a convenience pointer, not a historical record. The
first attempt kept the FKs and added the append-only trigger, which made a SET
NULL cascade fail and turned the audit trail into a LOCK ON USER DELETION —
worse than the original defect, and directly in the way of the erasure path this
project still owes.

Consequences: audit history begins 2026-08-14. The SSO audit write is now
awaited rather than fire-and-forget. DELETE remains available to service_role for
retention pruning, so a compromised service-role key can still remove history —
stated, not implied. No tamper-proofing is claimed.

## D-024 — Identity is `profiles.auth_user_id`, resolved by private SECURITY DEFINER helpers; the anon role is an explicit one-table allowlist

Status: Accepted (Stage 9, 2026-08-14)

Context: every authenticated RLS policy written before this stage compared
`auth.uid()` (the GoTrue user id) to a column holding `profiles.id`. Measured
live: 27 profiles, 4 with `id = auth_user_id`, 19 with no auth user; 0 of 3
professors where `profiles.auth_user_id = professors.profile_id`. Those
predicates matched almost nobody. The application worked only because the same
tables also carried `demo anon ... for all` policies, so the browser fell
through to the `anon` role. The probe proved it: before the fix a signed-in
student could not read their own `student_profiles` row.

Decision: one definition of "who is calling", in a schema PostgREST does not
expose. `app_private.current_profile_id()`, `current_school_id()`,
`current_user_role()`, `current_professor_id()` — all SECURITY DEFINER with
`set search_path = ''`, EXECUTE granted to `authenticated` only, resolving
through `profiles.auth_user_id`. Every repaired policy goes through them.
`is_professor_of_offering` / `is_student_of_offering` moved into the same schema
(closing KI-011). The `anon` role then keeps exactly one privilege in `public`:
SELECT on `schools`, the tenant registry a caller needs before it has an
identity. The migration asserts that as a postcondition rather than trusting the
statements above it.

Reason: the ordering is forced. Dropping the anon policies first would have left
a platform where nobody could read their own data, because the authenticated
layer had never worked. Repairing identity first makes the authenticated layer
real, and only then is the anon surface removable.

Consequences: any future policy that writes `auth.uid() = <some profile id
column>` is a bug; `supabase/migrations/stage9_rls.test.mjs` fails the build if
that shape returns. Server-side code may no longer use the anon browser client —
reads go through the session client, and writes that legitimately need a bypass
go through the service role after an explicit check. A session holding only the
app cookie without a live GoTrue session now resolves to no profile and is
redirected to login; that is fail-closed and intended.

## D-025 — Security audit records are a separate, append-oriented table written through the existing logging chokepoints; not tamper-proof, and honestly scoped

Status: Accepted (Stage 9, 2026-08-14)

Context: Stage 8 (D-023) gave the platform structured operational logging to
stdout. That answers "is the system healthy"; it does not answer "who bound this
external identity to this profile, and when", which is asked months later. Some
privileged actions — tenant-wide admin broadcasts, curriculum approvals, hard
deletes — emitted no record at all.

Decision: `public.security_events`, written only through the two functions that
already exist as chokepoints (`emitSsoAuditEvent`, and `recordSecurityEvent`
wrapping `logEvent`), so no call site changes shape. Scope is deliberately
narrow: events that change identity, privilege, tenant configuration or
correctness-critical state — never page requests, never per-denial rows. No
client role holds INSERT, UPDATE or DELETE, and no non-SELECT policy exists;
reads are limited to a tenant admin's own tenant. `detail` is a short
classification string bounded to 200 characters so the column cannot become an
accidental PII sink. The write is best-effort: the operational line is emitted
first and unconditionally, and a failed insert degrades to `audit.write_failed`
rather than breaking the audited action.

Reason: option A (platform logs only) was rejected because retention is outside
our control, events cannot be queried by tenant, and it does nothing for actions
that emit nothing. Option B costs one table and no call-site churn.

Consequences: the trail is best-effort, not guaranteed, and **is not claimed to
be tamper-proof** — there is no hash chain and no signature. A compromised
service-role key can write false rows; it cannot quietly edit or delete true
ones through anything the browser reaches. History begins 2026-08-14.

## D-026 — Hand-applied schema is repaired at its first point of use, even when that means amending an already-applied migration

Status: Accepted (Stage 9, 2026-08-14)

Context: ten columns existed in the live database and in `supabase/schema.sql`
but were created by no migration — `posts.school_id`, `board_key`,
`display_mode`, `anonymous_alias`, `view_count`, `is_resolved`,
`resolved_by_post_id`, and `counseling_requests.suggested_start`,
`suggested_end`, `location`. Seven are load-bearing in `src/`, and
`posts.school_id` is the tenant column that `20260812070000` asserts on and
`20260813010000` indexes. A database built from the chain therefore aborted at
migration 41 of 55, which is why no staging environment and no restore rehearsal
were ever possible.

Decision: the nine columns nothing depends on are added by a new idempotent
migration (`20260814020000`). `posts.school_id` is added by an
`add column if not exists` inserted into `20260812070000` itself — the first
migration that depends on it — because a column created later cannot help a
fresh rebuild. That edit is a strict no-op on any database where the migration
has already run, and it does not change what the migration does.

Reason: the alternative (accepting the break) leaves the project with no
disaster-recovery path and no way to create a non-production database, which is
the precondition for almost every other deferred item.

Consequences: an already-applied migration file was amended, which is normally
avoided; the reason is written at the top of that file and guarded by
`stage9_rls.test.mjs`, which asserts the column is added before it is asserted
on. **The rebuild itself is UNVERIFIED** — Docker is unavailable, there is no
`supabase/config.toml`, and the only project is live production. The repair is
reasoned and unit-guarded, not proven by execution.

## D-022 — Scalability is bounded queries, bounded requests, and evidence-justified indexes; no new infrastructure

Status: Accepted (Stage 8, 2026-08-13)

Context: Stage 8 had to prepare for multiple universities and tens of thousands
of registered users. The measured evidence (SCALE_AUDIT §2) showed 0% errors at
every tier run and latency that is Supabase round-trip-bound, not CPU-bound —
`/login`, the only route touching no database, sustained ~9× the throughput of
the heaviest page. The bottlenecks found were query SHAPE and unbounded growth,
not request volume.

Decision: no Redis, queue, message bus, microservice, Kubernetes, distributed
cache, second database, or APM vendor. No new connection pooler either — the
app has no app-side pool to pool (all access is stateless PostgREST HTTPS; there
is no `pg` driver), so the platform already owns that layer. What Stage 8 ships
instead: bound the one unbounded hot query (busy feed → the 14-day slot
horizon, derived from the domain constant so the two cannot drift), bound every
Supabase request with a fetch timeout (supabase-js has no default, so a hung
call previously pinned a serverless invocation until the platform killed it),
and add four indexes each justified by a named query. Zero new runtime
dependencies; shared JS unchanged at 102 kB.

Consequences: correctness-critical reads stay uncached — D-007 is untouched,
because the measured problem was query shape, not repetition, and the busy feed
is booking-authoritative (D-011). No retry was added anywhere: retrying a
booking mutation is guaranteed to fail again (D-013) and would convert overload
into a retry storm, so the timeout produces bounded FAILURE, not bounded
retrying. Capacity claims are limited to what was tested (10 concurrent VUs on
reads, 20 concurrent bookings); larger tiers are implemented in the harness but
recorded NOT RUN because the only Supabase project is live production.

## D-023 — Observability is log-based with an enforced field allowlist and an explicit conflict-vs-fault taxonomy

Status: Accepted (Stage 8, 2026-08-13)

Context: the app had 70 free-form `console.*` calls, ~40 silent `catch {}`, no
request id, no metrics, and no `instrumentation.ts`. The decisive example: the
booking path caught a slot-fetch failure, logged NOTHING, and returned the
business-conflict message — so a Supabase outage was invisible to operators and
misreported to students as "that slot is taken".

Decision: structured JSON lines to stdout (Vercel captures it; a drain can be
attached later) instead of an APM vendor or metrics backend. Fields are
ALLOWLISTED in code, generalizing the discipline `sso-audit.ts` already proved,
so a future caller cannot widen the log surface and leak PII — notably
`profiles.identifier`, which IS the user's email and must never be logged; the
profile uuid is the safe pseudonymous identifier. Errors carry an explicit
taxonomy (`ok` / `conflict` / `denied` / `user_error` / `fault`) and
`classifyPostgresError` maps 23P01/23505/PGRST116 to `conflict`, never `fault`,
so a legitimately contended slot cannot pollute the fault rate an operator
pages on. A correlation id is minted in middleware, preferring the platform's
own id when present. Tracing was deliberately NOT added: the request path is
short and single-process, so logs plus a correlation id reconstruct it.

Consequences: alert thresholds are NOT fabricated — only directional statements
are recorded, because the sole baseline is a single-instance local run at demo
data volume. The sso-audit emitter now rides the shared logger, so the durable
sink KI-020 asks for becomes a sink swap rather than a rewrite; the table itself
is not created while no real IdP exists to generate non-synthetic events.
Rewriting all 70 legacy `console.*` sites was left out of scope as unrelated
churn; the helper plus the highest-value call sites establish the pattern.

## D-019 — SSO uses Supabase Auth as the protocol engine, wrapped in a thin app-owned identity boundary

Status: Accepted (Stage 7, 2026-08-13)

Context: Stage 7 required an SSO architecture for university IdPs (OIDC and
SAML — the Korean academic federation KAFE is SAML 2.0). The discovery audit
established that login already runs through real Supabase Auth
(signInWithPassword → auth.users → profiles.auth_user_id), that GoTrue
sessions are load-bearing for the seven `resolveAuthenticatedProfile`
services, and that the installed `@supabase/auth-js` 2.110.1 already ships
`signInWithSSO` (SAML) and `custom:<slug>` OIDC providers.

Decision: Approach C+ (SSO_DESIGN §2/§3). GoTrue performs the protocol
cryptography (state/PKCE/nonce/JWKS/issuer/audience, SAML) vendor-side; the
app owns exactly what no vendor can: the tenant↔provider registry
(`src/lib/sso/provider-registry.ts`, env-supplied PUBLIC metadata only,
secrets structurally rejected), the pure login/link decision
(`src/lib/sso/sso-login-policy.ts`), the callback boundary
(`src/services/sso-callback.service.ts` + `/auth/callback`), initiation by
school slug (`/login/sso/[slug]`), and app-session issuance (the existing
HMAC bridge cookie, minted only after the full decision). Alternatives A
(openid-client) and B (Auth.js/node-saml dual stack) were rejected: both
orphan the GoTrue-session-dependent services for SSO users and add
dependencies; zero new packages were added. Stable identity key =
(provider, issuer, subject) via auth.identities → auth_user_id →
profiles.id; tenant NEVER derives from a request value (frozen by
sso-wiring.test.mjs). Trade-offs accepted: vendor lock-in (SAML config in
Supabase, Pro-plan gate, no SLO) and no end-to-end protocol exercise without
a real IdP (BLOCKED, honest in TEST_MATRIX).

## D-020 — Membership is pre-provisioned; JIT is per-tenant opt-in with a hard student-only ceiling; linking trusts institutional email exactly once

Status: Accepted (Stage 7, 2026-08-13)

Context: no signup flow exists (deny-unmapped is the status quo) and the
institutional rules JIT needs (membership definition, reliable affiliation
claims, faculty identification) are exactly the BLOCKED external inputs.

Decision: the shipped default is the invite/pre-provisioned model — an SSO
identity with no membership denies `not_provisioned`. A per-tenant JIT
policy exists (`policy.jit`) but is default-off, and THREE independent
layers cap what it can ever create: the affiliation→role map yields
`student` or nothing; the policy evaluation hard-compares the mapped role to
"student"; the registry parser rejects any config whose allowedRoles contain
a privileged role. professor/assistant/admin are always human-provisioned.
Existing members' roles are never changed by IdP claims (no silent
escalation or demotion). First-login account linking writes
`profiles.auth_user_id` once, via CAS (`is auth_user_id null` in the UPDATE),
only under four conditions: registered provider of the tenant, unlinked
candidate, exact case-insensitive identifier match, `email_verified = true`;
after linking, email is never consulted again. A cross-tenant identifier
collision on the globally-unique `profiles.identifier` denies
(`identity_conflict`) — it never merges identities; the identifier-namespace
decision (global vs `unique(school_id, identifier)`) remains a documented
Stage 7+ external decision (KI-020).

## D-021 — The mock IdP is test-only and in-process; suspension is enforced at the SSO boundary through the widened tenant chokepoint

Status: Accepted (Stage 7, 2026-08-13)

Context: spec §18 requires a deterministic dev/test IdP without weakening
production; the harness has no HTTP mocking and substitutes modules at
compile time (tenant-isolation convention). schools.status existed but was
enforced nowhere (KI-019).

Decision: `src/lib/sso/mock-idp.ts` mints real RS256 tokens (node:crypto
keypairs, JWKS export, evil-twin signer, injectable clock) but is imported
ONLY by tests — a structural source-guard (sso-wiring.test.mjs) fails the
suite if any app module imports it, and no route, env flag, or registry
entry type can activate it; dev/prod separation is structural, not
configurational. Suspension: `resolveTenantContext` gained an OPTIONAL
`school_status` field that fails closed on "suspended" — Stage 6 call sites
omit the field and stay byte-compatible; the SSO callback always carries it
(and the policy denies `school_suspended` independently). Request-time
suspension enforcement for non-SSO sessions still requires the profile
queries to join schools.status — deferred with the seam in place (KI-020).

## D-015 — The tenant is the existing `schools` row; membership is `profiles.school_id` (single-tenant), resolved through one chokepoint

Status: Accepted (Stage 6, 2026-08-12)

Context: the schema already had a `schools` table (one live row, 계명대학교)
and six `school_id` columns of varying nullability, plus single-tenant
assumptions in code (auto-assign the first school, client-supplied post
school_id, first-row professor fallback). No parallel tenant entity was
justified.

Decision: tenant_id ≡ `schools.id` (immutable uuid — never the display name,
never a client value). Membership is Design 1: one profile belongs to one
tenant via `profiles.school_id` (backfilled + NOT NULL). Design 2 (a
`tenant_memberships` join for multi-affiliation) was evaluated and deferred to
Stage 7. The single guard against a costly future migration is
`resolveTenantContext(profile)` (src/lib/tenant.ts) — the one authoritative
chokepoint every tenant-scoped read derives its filter from, so Design 1→2
becomes a resolver change, not a call-site sweep. `schools.status` (+ a
reserved `slug`) were added as the only new tenant fields. Consequence:
`profiles.identifier` stays GLOBALLY unique for Stage 6 (login resolves by
identifier with no tenant predicate); tenant-qualified identifiers are the
documented Stage 7 breaking point.

## D-016 — Tenant isolation is enforced primarily at the trusted server boundary, with a DB backstop where it does not fight the demo-era anon policies

Status: Accepted (Stage 6, 2026-08-12)

Context: the public publishable key plus wide-open `anon` demo RLS policies
(profiles/student_*/counseling read/user_notifications/mission_progress) are
load-bearing for the app's own read/write paths and are owned by the Stage 9
RLS overhaul (KI-007/011/014). A full DB-level tenant lockdown in Stage 6
would either break those paths or duplicate Stage 9.

Decision: the authoritative Stage 6 boundary is the trusted server layer —
every tenant-scoped read/write derives its filter from
`resolveTenantContext`, and the counseling status/details writes carry an
ownership+tenant predicate in the same CAS statement. Two DB backstops were
added where they do NOT touch the known-wrong anon family: a tenant WITH CHECK
on the counseling INSERT policy (authenticated, D-011 era — live-verified to
REJECT a crafted authenticated cross-tenant insert) and a tenant predicate in
the `answer_professor_questions` RPC (assistant branch). The dead
hardcoded-email anon UPDATE policy on counseling_requests was dropped. Per the
D-014 discipline, Stage 6 does NOT patch the anon/pre-mapping policy family
twice — the residual direct-PostgREST anon vectors are documented (KI-019) for
Stage 9, never falsely asserted closed.

## D-017 — The Stage 5 overbooking constraint stays byte-identical; tenancy is derived, not denormalized onto counseling_requests

Status: Accepted (Stage 6, 2026-08-12)

Context: Stage 6 §12 required re-evaluating every Stage 5 constraint for
tenant semantics.

Decision: `counseling_requests_no_active_overlap` (EXCLUDE USING gist,
professor_id WITH =) is UNCHANGED. professor_id is a globally-unique uuid PK,
so the constraint is inherently tenant-local — a University A booking can
never conflict with a University B slot. Adding a tenant column to the
exclusion key would WEAKEN it (a NULL/differing tenant exempts the row pair →
overbooking), so counseling_requests gets NO denormalized tenant column;
tenancy is derived through professor_id → professors.school_id. Verified
live: the constraint definition is byte-identical post-migration, and the
authenticated cross-tenant/same-tenant probe behaved correctly with the
constraint intact.

## D-018 — Notification tenancy is a nullable column stamped best-effort; the concrete broadcast leak is closed in app code

Status: Accepted (Stage 6, 2026-08-12)

Context: `user_notifications` broadcast rows (recipient_id NULL) have no
parent to derive tenancy from, so the table needs its own school_id. A hard
NOT NULL was tried and reverted (migration M7): several notification writers
are ungated actions that can run with a null acting profile (support,
roadmap-feedback, admin-approval — Stage 9 territory), so NOT NULL would
silently break their gracefully-degraded notifications.

Decision: `user_notifications.school_id` is NULLABLE + backfilled + indexed.
The notification service stamps it best-effort — an explicit tenant wins, else
it is resolved from the recipient's profile; a legacy/ungated broadcast may
leave it NULL (Stage 9). The CONCRETE cross-tenant leak — the admin broadcast
fanning recipients to every university — is closed directly in
`sendAdminBroadcastNotification` (recipient query scoped to the admin's
tenant + school_id stamped). Full write-side tenant coverage + NOT NULL +
tenant-scoped notification-read RLS is folded into the Stage 9 notification
overhaul (the anon SELECT policy means read isolation is not DB-enforceable
until then regardless).

## D-011 — The busy feed reads with service-role authority; the GiST constraint stays the sole overbooking enforcer

Status: Accepted (Stage 5, 2026-08-12)

Context: `getBusyRequests` ran on the student session client, and the RLS
SELECT policy (20260713090000) admits only the caller's own rows — so the
canonical busy set (ALL pending+approved rows, D-005) was silently truncated
cross-student. Displayed availability counted slots other students already
held, and the booking path's server-side revalidation was structurally blind:
every cross-student collision reached the DB and surfaced as a generic
retry-invitation. This broke the Stage 2 displayed==canonical invariant.

Decision: the busy read uses the admin client (minimal columns — professor_id
and the requested range only, no student identifiers), following the
professor data path's documented precedent. Server-side revalidation is now
authoritative for stale/blind submissions (controlled SLOT_NOT_AVAILABLE +
revalidatePath), while the live-verified GiST exclusion constraint
`counseling_requests_no_active_overlap` (23P01 probe, 2026-08-12) remains the
only serialization authority for the TOCTOU window — the check+insert pair
deliberately stays two statements, because even a wrapping transaction could
not close that race at read-committed. Constraint conflicts (23P01/23505) map
to the same slot-conflict vocabulary; unknown errors keep the generic
retryable message. A SECURITY DEFINER booking RPC was evaluated and rejected:
it would need the canonical availability rules reimplemented in SQL,
resurrecting the dual-engine divergence D-004 eliminated. Consequence: the
/counseling page now requires SUPABASE_SERVICE_ROLE_KEY at runtime (already
required by professor pages and demo auth).

## D-012 — Counseling status transitions are compare-and-set against a legal matrix

Status: Accepted (Stage 5, 2026-08-12)

Context: `updateCounselingStatus` was a blind UPDATE-by-id with a whitelist
that accepted `pending` as a target — competing transitions were
last-writer-wins with contradictory notifications, and terminal rows could be
resurrected (cancelled→approved), guarded only by the DB constraint when the
slot happened to be re-taken.

Decision: every transition carries a from-state predicate in the same single
UPDATE statement (approved⇐pending, rejected⇐pending,
cancelled⇐pending|approved; rejected/cancelled terminal; `pending` removed
from targets — no UI ever sent it). Zero matched rows (PGRST116) is a
controlled "already processed" conflict that also revalidates both consumers.
No version column or updated_at token is needed: the from-state IS the
optimistic-concurrency guard for this domain's rule. The cancel notification
copy was fixed in the same function (KI-015): cancellations no longer
masquerade as time adjustments promising a suggested time the statement just
nulled.

## D-013 — Booking idempotency by post-conflict self-match, not idempotency keys

Status: Accepted (Stage 5, 2026-08-12)

Context: duplicate submissions (double click, network retry, retry after a
lost response) were UI-guarded only; the duplicate hit the DB constraint and
was reported as a failure although the caller's booking had committed.

Decision: a duplicate of the caller's OWN active booking is detected by
matching the submitted normalized slot id against the caller's own
pending/approved rows (session-visible under RLS) — checked both at
revalidation (the common retry-after-commit path, no insert attempted) and in
the constraint-conflict branch (the in-flight double-click race) — and
acknowledged with ok:true "이미 신청된 상담 시간입니다". No key store, no new
column, no migration: the active row itself is the idempotency record, so the
duplicate window equals the reservation's active lifetime. A client-generated
idempotency-key mechanism was rejected as strictly more machinery for the
same observable outcomes.

## D-014 — Student self-cancel is a CAS on the admin client with an app-level ownership predicate

Status: Accepted (Stage 5, 2026-08-12)

Context: no student cancel existed (KI-017); stale pending requests lingered
forever. Students have no UPDATE policy on counseling_requests, and the
authenticated policy family is known-broken post-auth-mapping (KI-007) and
owned by Stage 9.

Decision: `cancelMyCounselingRequest` mirrors the professor transition
pattern — a single conditional UPDATE (id + student_id = caller + status IN
pending|approved → cancelled) on the admin client, controlled refusal
("취소할 수 없는 상담 신청입니다") for foreign rows, terminal rows, or lost
races; best-effort professor notification; revalidatePath ×2. A student
self-cancel RLS policy was deliberately NOT added now: patching one policy
into a known-wrong family would churn the live, hand-migrated DB twice —
Stage 9 owns that overhaul (this action is on its migration list). UI is one
confirm()-guarded button on the student's own active requests.

## D-009 — Counseling display cap is per professor

Status: Accepted (Stage 4, 2026-08-12)

Context: `buildAvailableCounselingSlots` applied `.slice(0, 48)` to the merged
chronological multi-professor list; the workspace then filtered per professor.
One professor's dense early availability could crowd another professor's real
slots out entirely — the student saw "no slots" for genuinely bookable time
(audit A-2, RED-tested).

Decision: the cap bounds each professor's list at 48 (earliest first). The
canonical per-date primitive `buildBookableSlotsForLocalDate` (D-004) is
untouched; slot membership per professor is unchanged; only merged list
length semantics changed. Characterization test updated deliberately
(96 = 48×2 for two dense professors); cross-consumer identity test unchanged
and green.

Consequences: displayed availability now matches the canonical per-professor
bookable set for every professor. Any future global bound must not reintroduce
cross-professor starvation.

## D-010 — No route-level Suspense seams (loading.tsx) on this app

Status: Accepted (Stage 4, 2026-08-12)

Context: Stage 4 added loading.tsx skeletons to 12 routes (KI-016 loading
backlog). Rendered QA on the production build found direct GETs of those
routes hydrate the route Suspense boundary into the skeleton fallback and
NEVER resolve — orphaned SSR DOM plus a completely dead page (zero
interactivity, zero console errors). This is byte-for-byte the KI-013
pathology Stage 3 fixed by deleting a page-level `dynamic()` seam.

Decision: reverted (commit 99bf213). The KI-013 lesson generalizes: on this
app's force-dynamic pages under Next 15.5, NO route-level Suspense boundary
of any kind — no loading.tsx, no page-level dynamic()/lazy. Client-side
lazy INSIDE an already-hydrated client component (the recharts pattern,
fca8ddc) remains safe.

Consequences: perceived-loading work stays in KI-016 with this evidence.
Candidate future mechanisms: a client navigation progress indicator (no
Suspense), or a Next upgrade explicitly re-validated against the KI-013
reproduction (8× direct-GET hydration check on /professor AND /counseling).

## D-001 — Repository as persistent project memory

Status: Accepted

Future Claude sessions must reconstruct project state from:

- Git
- source code
- tests
- `CLAUDE.md`
- `docs/upgrade/*`

Conversational memory is not authoritative.

## D-002 — Incremental upgrade

Status: Accepted

The existing system will be improved incrementally.
Existing functionality and UI/UX must remain intact unless a stage explicitly authorizes change or a confirmed bug requires it.

## D-003 — Evidence-based completion

Status: Accepted

No bug fix, performance improvement, or QA claim may be considered complete without current verification evidence.

## D-004 — Canonical availability domain boundary

Status: Accepted (Stage 2, 2026-08-12)

Context: two independent availability engines (student `buildAvailableCounselingSlots`
vs professor-calendar `calculateRecommendedAvailability`) produced the reproduced
0-vs-85 mismatch (KI-001).

Decision: `src/lib/counseling-slots.ts` is the single availability domain module. Its
per-date primitive `buildBookableSlotsForLocalDate` is the only source of the claim
"students can book this time". `src/lib/calendar-utils.ts` is a thin adapter
(`buildProfessorWeekAvailability`) that classifies the professor 09–18 week grid into
`bookable` (derived exclusively from the primitive) / `blocked` (inactive rows) /
`free` (undeclared — NOT student-bookable). The legacy engine was deleted.

Reason: smallest architecture giving a real single source of truth; preserves public
signatures and UI interactions; pure/isomorphic module suits Stage 5 (concurrency) and
Stage 6 (tenancy) later.

Consequences: cross-consumer identity regression test
(src/lib/availability-consistency.test.mjs) enforces slot-set equality; the professor
grid needed a third visual state (상담 미개방) — the authorized KI-001 correctness delta.

## D-005 — Reservation statuses that consume availability

Status: Accepted (Stage 2, 2026-08-12)

The DB enum `counseling_status` has exactly `pending | approved | rejected | cancelled`.
`pending` and `approved` consume a slot (busy filter + GiST exclusion constraint);
`rejected` and `cancelled` free it. Busy time is `requested_start/end` ONLY —
`suggested_start/end` is advisory (written only by the reject flow, not covered by any
constraint) and must never block availability. Capacity is structurally 1 per
(professor, time range); no numeric capacity model exists or was introduced. Phantom
status values (`answered`, `ANSWERED`, `PENDING` in types, `scheduled` in a dashboard
filter) were removed as dead vocabulary.

## D-006 — Time normalization boundary

Status: Accepted (Stage 2, 2026-08-12)

All scheduling semantics are Asia/Seoul (`PACEMATE_TIME_ZONE`). Wall-clock↔instant
conversion happens only in the domain module (Intl two-pass helpers; exported:
`getLocalDate`, `localDateTimeToInstant`, `instantToLocalParts`, `dateKeyToLocalDate`,
`parsePacemateWallClock`, weekday/date-key helpers). Consumers exchange ISO instants or
KST wall-clock parts from these helpers; browser/server-local `Date` component reads
were removed from scheduling paths (professor calendar, suggested-time input,
today-timetable widget, availability-write validation). `scheduling-policy.ts` was
deleted (4 of 7 exports dead; survivors moved into the domain). Intervals are half-open
`[start, end)` at every layer, matching the DB `tstzrange(...,'[)')` constraint.

## D-007 — Request-scoped memoization only; no cross-request caching of scheduling data

Status: Accepted (Stage 3, 2026-08-12)

Context: every page paid duplicate identity/notification queries (AppShell
refetch on ~20 routes; 3× auth.getUser identity chains on /dashboard and
/professor), but availability data is correctness-critical and must never be
stale (Stage 2 invariants).

Decision: React `cache()` request-scoped memoization is the ONLY caching layer
introduced: `getDemoProfile`, `getNotificationsForProfile`,
`getUnreadNotificationCount`, and `resolveAuthenticatedProfile`
(src/services/request-identity.server.ts) — six services consume the shared
identity resolver, each keeping its own frozen error vocabulary. No
`unstable_cache`, no ISR/revalidate windows, no client query cache, and no
caching of any availability/booking read was added. The coarse
`revalidatePath` vocabulary is unchanged (harmless while nothing outlives a
request).

Reason: the memo dies with the response, so booking/cancellation freshness is
byte-identical to before; within one request it yields a single consistent
identity snapshot. Fixes the duplicate-fetch root cause instead of masking it.

Consequences: source-level guards (request-memoization.test.mjs,
request-identity.test.mjs) freeze the wiring; any future cross-request cache
must answer the stage-03 DESIGN.md §5.1 safety questionnaire and use precise
invalidation (tags), not path shotguns.

## D-008 — Stage 3 performance budgets and deterministic guards

Status: Accepted (Stage 3, 2026-08-12)

Context: wall-clock timings against live Supabase are too noisy to assert in
tests (spikes of 2–4× observed within one measurement session).

Decision: performance regressions are guarded deterministically — query-count
and batching tests via the repo's transpile-loader + counting fake client
(student-community.query-count.test.mjs, counseling.query-count.test.mjs), a
hydration-seam source guard (professor-page-hydration.test.mjs), and a
bundle-size script (scripts/check-bundle-budgets.mjs: shared ≤550 kB raw,
/professor ≤900 kB raw, any route ≤850 kB raw; run after a fresh build, not in
the src test glob). Wall-clock numbers are report-only in
stage-03/PERFORMANCE_AUDIT.md.

Reason: deterministic proxies catch the mechanisms that caused the measured
slowness (extra round trips, false await stages, eager heavy chunks) without
flaky CI.

Consequences: `npm run build && node scripts/check-bundle-budgets.mjs` is the
bundle gate; budgets must be revised deliberately in the same commit as an
intentional size change.
