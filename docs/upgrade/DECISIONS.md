# Architectural Decisions

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
