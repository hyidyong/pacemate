# Stage 7 — Identity Audit (how authentication works today)

Compiled 2026-08-13 from four read-only discovery agents (A: auth
architecture, B: tenant/membership integration, C: stack SSO capabilities,
D: test infrastructure) on `upgrade/stage-7` (base `main` @ 19a1124, the
Stage 6 merge of PR #40). All claims carry file evidence; anything not re-verified in this
stage is attributed to the agent reports.

## 1. How users authenticate today

Exactly one login surface exists and it is REAL Supabase Auth, not a custom
credential check:

- Page `src/app/login/page.tsx` posts `identifier` + `password` to the server
  action `createDemoSession` (`src/services/demo-auth.service.ts:36-127`).
  The page copy itself says "학교 SSO 연동 전 데모 로그인입니다" (:56).
- `createDemoSession` calls `supabase.auth.signInWithPassword({ email:
  identifier, password })` (:59) via the `@supabase/ssr` server client —
  credentials are verified against `auth.users` (GoTrue). The legacy
  `profiles.password_hash` column is dead (referenced nowhere in src).
- After Auth succeeds, the profile row is loaded by `auth_user_id =
  authUser.id` (:75-79); missing/mismatched profile or unknown role ⇒
  `rejectLogin` (:81-87). **A valid auth.users account with no mapped
  profiles row cannot log in** — there is no signup, registration, or
  approval flow anywhere in src; profiles come only from seed
  SQL/migrations.
- On success the action mints a SECOND session (the HMAC cookie, §2), applies
  pre-login onboarding cookies, and redirects to the role home.
- QA autofill: `src/components/login/demo-login-button.tsx` imports
  `src/config/demo-users.json` — 4 demo accounts WITH plaintext passwords in
  the client bundle (recorded this stage in KNOWN_ISSUES; must be
  removed/build-gated before any real IdP connects).

## 2. How a session identifies a user — a DUAL session model

Two parallel, both load-bearing session mechanisms:

**(a) Supabase Auth (GoTrue) session** — JWT access+refresh in `sb-*`
cookies, managed by `@supabase/ssr` (`src/lib/supabase/server.ts:18-42`).
`src/middleware.ts` only refreshes it (`src/lib/supabase/proxy.ts:45`
`auth.getClaims()`); middleware does NO auth gating.

**(b) Custom HMAC app session** — `src/lib/auth/demo-session.ts`: cookie
`pacemate_session` = `base64url(payload).base64url(HMAC-SHA256)` with payload
`{profileId, role, issuedAt, expiresAt}`, secret `PACEMATE_SESSION_SECRET`
(≥32 bytes enforced), 8h TTL, `timingSafeEqual` verify + expiry + 60s clock
skew (:37-48, :59-71, :73-109). httpOnly, SameSite=Lax, Secure in prod. No
server-side store ⇒ **no revocation before expiry**.

Read paths:

- `getDemoProfile()` (`src/services/session.service.ts:43-75`, React
  `cache()`): signed cookie first — profile by `id = session.profileId`,
  **cookie role must equal DB role** (:55) — then falls back to pure
  Supabase Auth (`auth.getUser()` → profile by `auth_user_id`, :59-70).
  Identity source for ~30 pages.
- `resolveAuthenticatedProfile()`
  (`src/services/request-identity.server.ts:30-64`, React `cache()`):
  pure GoTrue chain (`auth.getUser()` → `auth_user_id` → profile), used by
  the 7 security-hardened newer services (professor-questions, reports,
  eligibility, recommendations…). **SSO must produce a real GoTrue session
  or these services break for SSO users.**
- Direct HMAC-only readers: `onboarding.actions.ts:20`,
  `weekly-plan-approval.actions.ts:73` (`readDemoSession`/
  `requireDemoSession`) — no GoTrue fallback.
- After identity is decided, data access is predominantly the service-role
  admin client (83 occurrences / 38 files) — authorization is an
  application-layer concern (Stage 6 boundary; RLS overhaul is Stage 9).

## 3. Logout / lifecycle

`clearDemoSession` (`demo-auth.service.ts:129-143`): `auth.signOut()`
(try/catch), destroy HMAC cookie + legacy cookies, delete pending-onboarding
cookies, redirect `/login`. Wired as a form action on
dashboard/professor/mypage/admin pages. `pacemate_advising_professor_id`
(assistant lab cookie) is NOT cleared on logout. Expiry: HMAC 8h; GoTrue
refreshed by middleware. Split-brain (one session cleared, not the other) is
possible; partially self-healed by the role-match check.

## 4. Existing OAuth/OIDC/callback support

**None.** No `/auth/callback`, no `src/app/api`, zero hits for
`signInWithOAuth`, `exchangeCodeForSession`, PKCE, SAML in src. The only
`supabase.auth.*` calls are `signInWithPassword`, `signOut`, `getUser`,
`getClaims`. BUT the installed `@supabase/auth-js` 2.110.1 (via
`@supabase/supabase-js` ^2.110.0, `@supabase/ssr` ^0.12.0 — modern stack)
already ships the full SSO API surface: `signInWithSSO({domain|providerId})`
(SAML) and `Provider` union `custom:${string}` + `auth.admin.customProviders`
(custom OIDC). **No package change is needed for Supabase-brokered SSO.**
No OIDC/OAuth/JWT/SAML library exists anywhere in the lockfile.

## 5. User/profile model and identity keys

- `profiles.id` (uuid, NOT the auth uid) is the app-wide identity — every FK
  (student_courses, posts, counseling, notifications…) points at it.
- `profiles.auth_user_id` — nullable uuid, FK → `auth.users(id) ON DELETE SET
  NULL`, partial unique (`WHERE auth_user_id IS NOT NULL`)
  (migration 20260712183855:36-37,92-98,126-130). One auth user → at most one
  profile. **This is the SSO identity attach point.** Profiles without auth
  users are first-class (seeded); auth users without profiles are rejected at
  login.
- `profiles.identifier` — `text NOT NULL UNIQUE` **globally** (initial
  migration :43); doubles as the Supabase Auth email at login. Two
  universities issuing the same handle collide on this constraint AND on the
  auth.users email namespace; login/lookup paths have no tenant predicate.
  Documented Stage 7 breaking point (stage-06 HANDOFF).
- `profiles.role` — enum `student|professor|assistant|admin`, DB row is
  authoritative (cookie role never wins, session.service.ts:55).
- `schools.slug` — unique, reserved for host/IdP→tenant routing, explicitly
  NOT an authorization key. `schools.status` — active|suspended CHECK,
  **enforced nowhere today** (`resolveTenantContext` is pure and never sees
  it; the profile SELECTs fetch no school fields).

## 6. Stage 6 tenant membership resolution (what SSO must not bypass)

- Membership = `profiles.school_id` (NOT NULL, backfilled). Chokepoint =
  `resolveTenantContext(profile)` (`src/lib/tenant.ts:33-49`, pure,
  fail-closed, + `tryResolveTenantContext`); consumed by
  `counseling.service.ts:48` and `counseling.actions.ts:74`.
- CAVEAT the stage-06 handoff undercounts: several tenant-scoped sites read
  `profile.school_id` inline (professor.actions.ts:88-94,
  admin-notifications.actions.ts:28-31, student-community.actions.ts:586,
  student-community.service.ts:132,154, notifications.create.service.ts:
  136-144). A Design-2 (`tenant_memberships`) migration must sweep these too
  — or SSO must guarantee the surfaced profile row already carries the
  active-membership school_id. Stage 7 keeps Design 1 (see SSO_DESIGN §7).
- Roles are tenant-level; no platform super-admin. Guards:
  `role-guard.service.ts` + per-action inline checks.
- Professor linkage: `professors.profile_id` nullable, NO unique constraint.
  Write path resolves strictly by profile_id and fails closed
  (professor.actions.ts:66-114); **read path still falls back to the
  globally-first professors row** (professor.service.ts:189-196 — KI-017
  B-24) — must die before a second live tenant exists. Assistants map to
  every professor in their tenant (school_id), plus a non-authorizing lab
  cookie.
- Single-tenant fossils SSO must replace, not inherit:
  `ensureDefaultSchoolAndDepartment` (onboarding.actions.ts:189-222) looks up
  the school **hardcoded by name 계명대학교** and writes profiles.school_id —
  it would mis-assign tenant for any second university.

## 7. Environment / config surface (names only)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (client +
server), `SUPABASE_SERVICE_ROLE_KEY` (server-only, admin client),
`PACEMATE_SESSION_SECRET` (HMAC), `NODE_ENV`. `.env.local.example` documents
the four auth vars. No secret may reach the client bundle; the demo-users
JSON (§1) is the standing violation to retire.

## 8. Test infrastructure constraints (for the mock IdP)

- Harness: `node --test "src/**/*.test.mjs"`, Node 24, zero test deps. No
  loader file — a per-file convention: `typescript.transpileModule` +
  data-URL modules, `@/` aliases string-replaced with stubs reading
  `globalThis` slots (canonical: `src/services/tenant-isolation.test.mjs:
  14-92`). Session faking = replace `session.service` module entirely.
- No HTTP mocking exists anywhere; fetch-dependent code is only
  source-guarded. **The mock IdP must be an in-process object behind a
  module seam, not a fake HTTP server.**
- `node:crypto` already in prod use (HMAC session); Node 24 provides
  `generateKeyPairSync`/`createSign`/`createVerify`/JWK export for real
  RS256 JWKS + token minting in tests. `createDemoSessionToken(claims, now)`
  sets the injectable-clock precedent.
- Style to reuse: two-tenant fixture (`setupTwoTenants()`), allow-case +
  deny-case + zero-side-effect assertions, source-guard tests to freeze
  security wiring (ordering via `indexOf`, `doesNotMatch` for forbidden
  reads, no-token-logging regex).

## 9. Backward-compatibility constraints for SSO

1. SSO must land as: authenticate → resolve/create profiles row → set
   `auth_user_id` — profiles.id stays the app identity.
2. SSO must yield a REAL GoTrue session (or the 7
   `resolveAuthenticatedProfile` services break) AND mint `pacemate_session`
   (or the 2 HMAC-only actions break). The dual model is bridged, not
   replaced, this stage.
3. Role writes go to `profiles.role` (4-value enum); role never becomes a
   client input.
4. Cookie inventory preserved: `pacemate_session`, pending-onboarding
   cookies, assistant lab cookie.
5. Middleware stays refresh-only; guards remain per-page/per-action.
6. Existing password login keeps working during transition (§13 of the spec;
   see SSO_DESIGN §10).

## 10. Surprising findings recorded

- RLS is largely decorative today (authenticated policies compare
  `auth.uid()` to `profiles.id` — never match; anon demo policies + admin
  client carry the app) — Stage 9 scope, unchanged here.
- Plaintext demo credentials in the client bundle (§1) — KNOWN_ISSUES this
  stage.
- Latent (UNVERIFIED): `saveAssistantOnboarding` derives identity via a
  student-only `getProfileId` (onboarding.actions.ts:19-22,224-228), which
  appears to redirect a logged-in assistant to /login; the assistant login
  gate depends on the cookie this action sets. Recorded in KNOWN_ISSUES for
  verification.
- HMAC sessions are irrevocable until expiry (8h) — relevant to §17 session
  lifecycle; documented in SSO_DESIGN §11.
