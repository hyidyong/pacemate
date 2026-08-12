# Stage 6 Handoff — University Multi-Tenancy

## Status

COMPLETE — 2026-08-12. Discovery, design, migration, Red→Green
implementation, regression, and live verification done on `upgrade/stage-6`
(from `main` @ 0b3b88e, the Stage 5 merge, PR #39). Ready for PR review. Not
merged (per workflow). Stage 7 NOT started.

## Goal

One deployed platform serves multiple universities with strictly isolated
tenant data. Security invariant: a user in University A cannot read, modify,
infer, reserve, or administer University B's tenant-scoped data. Isolation is
enforced at authoritative boundaries (server actions, DB/RLS), not the UI.
Stage 6 prepares — but does not implement — Stage 7 SSO.

## Tenant model

The tenant IS the existing `public.schools` row; `tenant_id ≡ schools.id`
(immutable uuid, the only authorization key — never the display name, never a
client value). One live tenant: 계명대학교
(`862b661c-810a-4440-ba76-722b2fcf8d6a`). Added `schools.status`
(active|suspended) and a reserved `schools.slug`. No parallel tenant entity
(D-015).

## Membership model

Single-tenant: `profiles.school_id` (backfilled + NOT NULL) is the
authoritative membership; one profile → one tenant, one role. Design 2
(`tenant_memberships` join for multi-affiliation) evaluated and deferred to
Stage 7. `resolveTenantContext(profile)` (src/lib/tenant.ts) is the single
authoritative chokepoint every tenant-scoped filter derives from — the seam
Design 1→2 swaps into without call-site churn.

## Role scope

student / professor / assistant / admin — all TENANT-level, each acting only
within `profile.school_id`. No platform super-admin (no operational need,
spec §8). Client-submitted role/school_id never grants access; role comes from
the HMAC session cross-checked against the DB, tenant from the server-resolved
profile.

## Tenant-scoped resources (this stage)

Counseling: availability, teaching slots, admin tasks, professor directory,
course-mode list, booking creation, status/details transitions — all scoped to
the acting tenant. Community: post creation (school_id from session) and the
board read (getPosts). Notifications: admin broadcast recipients scoped to the
admin's tenant. Schema: professors + user_notifications gained school_id;
courses/profiles school_id made NOT NULL; posts backfilled.

## Global / user-global resources

Platform-global: none legitimately. User-global: profiles (identity),
student_profiles, student_custom_courses, legacy roadmap_requests/results.
Full classification in TENANT_DATA_AUDIT.md §2.

## Tenant resolution mechanism

`resolveTenantContext(profile) → { tenantId }` from the server-verified
`profile.school_id`, fail-closed (throws / non-throwing `tryResolve` variant
for read paths). Never trusts `?tenant_id`, request body, hidden field, or
localStorage. Unit-tested (src/lib/tenant.test.mjs).

## Authorization / RLS strategy

Primary boundary = the trusted server layer (every tenant-scoped read/write
derives its filter from resolveTenantContext; the counseling status/details
writes carry an ownership+tenant predicate in the same CAS statement). DB
backstops added where they don't fight the demo-era anon family: a tenant
WITH CHECK on the counseling INSERT policy (authenticated) and a tenant
predicate in the answer_professor_questions RPC (assistant branch); the dead
hardcoded-email anon UPDATE policy was dropped. The anon `using(true)`-class
demo policies + KI-007 pre-mapping family are the Stage 9 overhaul and are NOT
touched here (D-016, D-014 discipline). Residuals in KI-019.

## Database migrations (applied live via supabase db push)

- 20260812010000 schools status/slug
- 20260812020000 professors.school_id (backfill from department chain, NOT NULL)
- 20260812030000 profiles + courses backfill / NOT NULL
- 20260812040000 user_notifications.school_id backfill (later relaxed)
- 20260812050000 counseling INSERT tenant WITH CHECK; drop dead anon UPDATE
  policy + revoke anon UPDATE; answer_professor_questions assistant tenant scope
- 20260812060000 user_notifications.school_id → NULLABLE (D-018)
- 20260812070000 posts.school_id backfill

Remote migration history was repaired for `20260812000000` (applied via SQL
editor, was missing) before the first push. Validation: all tenant columns
0 NULL; NOT NULL where intended; GiST constraint byte-identical.

## Stage 5 constraint adaptations

NONE (D-017). `counseling_requests_no_active_overlap` is professor-keyed and
inherently tenant-local; adding a tenant column to the exclusion key would
weaken it. Verified byte-identical live. Tenancy is derived through
professor_id → professors.school_id; counseling_requests got no denormalized
tenant column.

## Cache / client isolation strategy

No server-side cross-request cache exists (D-007) → nothing to tenant-key
server-side. `generateStaticParams` removed from the personalized
/roadmap/[courseId] route (X15). Client localStorage/Zustand isolation (X13)
documented as a shared-device follow-up (KI-019) — not a tenant-isolation gap
because the app has no in-session tenant switching (spec §19).

## Cross-tenant test results

- Two-tenant isolation suite (src/services/tenant-isolation.test.mjs) — 5/5
  GREEN: M-2/M-3 professor directory scoped; M-4 same-tenant booking allowed;
  M-5/M-6 cross-tenant booking via crafted slotId denied with NO insert (IDOR);
  M-8 same-tenant status update allowed; M-9/M-10 cross-tenant status update
  denied, foreign request untouched (IDOR).
- Live authenticated RLS backstop probe (M-7): as a real `authenticated`
  student (JWT sub), a cross-tenant booking INSERT was REJECTED ("new row
  violates row-level security policy"), a same-tenant booking INSERTED; probe
  tenant/professor/counseling rows cleaned up, schools back to 1.
- resolveTenantContext unit tests 3/3 (fail-closed on tenant-less profile).
- Red basis: the audit (four discovery agents) established the leaks as real
  (student can book any professor; any professor/assistant can move any
  request; admin broadcast fans platform-wide) — the GREEN suite proves the
  fix; on pre-Stage-6 code the cross-tenant booking succeeds because the slot
  feed was unscoped.

## Previous-stage regression evidence

Full suite `node --test "src/**/*.test.mjs"`: 230 tests / 227 pass / 3 fail —
the SAME pre-existing KI-002 trio by name (admin-notifications ×2,
question-notice-workflow ×1) as the Stage 5 baseline (222/219/3). +8 Stage 6
tests, all green. Stage 2 invariant suites (counseling-slots, availability
consistency, characterization, query-count guards) green in the run. Stage 5
concurrency tests (counseling.actions M1/M2/M3/M9, professor CAS 7/7) green.
typecheck clean; lint at baseline (1 pre-existing no-img-element warning);
`npm run build` PASS; bundle budgets all met; shared JS 102 kB unchanged (no
new dependencies). Live tenant-scoped query counts correct (3 professors, 9
availability rows, 7 posts).

## Known risks / remaining non-tenant-aware areas

See KI-019 for the full list. Headline: the public anon key + demo
`using(true)` RLS still expose demo-era tables to direct PostgREST until the
Stage 9 RLS overhaul — the Stage 6 boundary is the trusted server layer +
the counseling INSERT DB backstop, honestly scoped. Notification read
isolation, catalog/reviews reads, professor-report reads, roadmap-revision
reads, and client-state isolation are documented follow-ups.

## Relevant commits (main..upgrade/stage-6)

72329c2 docs (audit/design/plan/matrix) · 7f7e6d8 tenant schema migrations +
DB backstop · 7857801 app-layer tenant scoping + isolation suite · (+ this
docs commit).

## Exact next action

1. Push `upgrade/stage-6`; open PR to `main`; external review; fix findings on
   the branch; human-approved merge (do NOT self-merge).
2. Stage 7 (SSO) starts only after merge, from CURRENT_STAGE.md + this handoff.

## Stage 7 SSO integration points and external requirements

The model maps to `authenticated identity → membership → tenant → role`:

- Identity seam: `profiles.auth_user_id` (already unique-per-auth-user). Real
  SSO replaces demo password auth with the university IdP; JIT provisioning
  creates/links a profile here.
- Membership → tenant chokepoint: `resolveTenantContext`. Multi-affiliation =
  introduce `tenant_memberships(profile_id, school_id, role)`, backfill one row
  per profile from `profiles.school_id`, switch the resolver to the active
  membership. No other call site changes.
- Host/IdP → tenant key: `schools.slug` (reserved this stage, unused for
  authorization).
- Tenant-qualified identity: `profiles.identifier` is GLOBALLY unique today;
  Stage 7 must decide whether two universities may issue the same handle and,
  if so, move to `unique(school_id, identifier)` + tenant-qualified login.

External information/credentials Stage 7 will still require (NOT available
now): each university's IdP metadata (SAML entityID/SSO URL/signing cert, or
OIDC issuer/client id/secret/discovery URL); the email-domain → tenant mapping
(or subdomain/slug routing) used to select the IdP; JIT provisioning rules
(which role a new SSO user gets, how a professor/assistant is distinguished);
and a real per-university admin to own suspension/status. Storage path
tenant-prefixing (`{school_id}/…`) also belongs to the SSO/storage hardening.

## Exit gate checklist

- [x] Stage 5 merged and base verified (0b3b88e; baseline 222/219/3)
- [x] upgrade/stage-6 used
- [x] tenant/global data classification complete (TENANT_DATA_AUDIT.md)
- [x] tenant model defined (D-015)
- [x] identity/membership relationship defined (Design 1; Design 2 deferred)
- [x] role scope defined
- [x] tenant resolution defined (resolveTenantContext, unit-tested)
- [x] existing data safely migrated/backfilled (0 NULL, validated live)
- [x] critical tenant-scoped data explicitly isolated (counseling domain)
- [x] RLS/authorization tenant-aware where safe (INSERT WITH CHECK, RPC; anon
      family deferred to Stage 9, documented)
- [x] booking/reservation RPCs tenant-aware (booking WITH CHECK; no booking RPC
      exists — PostgREST path scoped at server + DB)
- [x] Stage 5 DB constraints reviewed for tenant scope (D-017, unchanged,
      verified byte-identical)
- [x] cache/query isolation reviewed (D-007 confirmed; generateStaticParams
      removed; client-state documented KI-019)
- [x] cross-tenant read tests exist (M-2/M-3)
- [x] cross-tenant mutation tests exist (M-5/M-6, M-9/M-10)
- [x] direct-object/IDOR tests exist (crafted slotId, crafted requestId)
- [x] at least two tenant fixtures used (isolation suite + live probe)
- [x] same-tenant legitimate operations still work (M-4, M-8; live query counts)
- [x] previous-stage regression tests pass (230/227/3, KI-002 only)
- [x] typecheck/lint/tests/build recorded
- [x] migration validation documented
- [x] DECISIONS updated (D-015..D-018)
- [x] KNOWN_ISSUES updated (KI-019)
- [x] HANDOFF completed (this file)
- [x] CURRENT_STAGE synchronized
- [ ] branch pushed / [ ] PR created — pending (next action)
- UNVERIFIED: browser-rendered QA of /counseling was not performed this
  session (single live tenant → no visible rendered change; the scoped query
  shapes were verified to return the correct live counts, and isolation is
  proven by the two-tenant suite + live authenticated RLS probe). Demo login
  remains unreliable (KI-004).
