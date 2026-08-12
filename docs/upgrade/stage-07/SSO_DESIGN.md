# Stage 7 — SSO Design

Written 2026-08-13 on `upgrade/stage-7` (base `main` @ 19a1124), BEFORE
implementation, from the IDENTITY_AUDIT.md evidence. Real university
integration is BLOCKED (no institution IdP metadata/credentials exist) and
is never fabricated; this stage ships the SSO-ready architecture, the
provider contract, the mock/dev IdP test integration, and the security
tests.

## 1. Current authentication architecture (summary)

See IDENTITY_AUDIT.md. Deciding facts: login is already real Supabase Auth
(GoTrue) with `profiles.auth_user_id` as the identity attach point; the app
session is a dual system (GoTrue cookies + HMAC `pacemate_session` bridge,
both load-bearing); no callback/OAuth infrastructure exists; installed
`@supabase/auth-js` 2.110.1 already ships `signInWithSSO` (SAML) and
`custom:${slug}` OIDC providers; no signup flow exists (deny-unmapped is the
status quo); Stage 6 isolation resolves tenant exclusively from the
server-verified profile.

## 2. Selected SSO architecture

**Approach C+ — Supabase Auth as the protocol engine, wrapped in a thin
app-owned identity boundary.**

```text
University IdP (OIDC or SAML)
        ↓ protocol exchange (state/PKCE/nonce/JWKS/audience/issuer —
        ↓  performed and verified by GoTrue, vendor-maintained)
GoTrue session (auth.users + auth.identities: provider, issuer, sub)
        ↓
/auth/callback (app) → processSsoCallback()
        ↓ verified identity snapshot (provider, issuer, sub, email,
        ↓  email_verified — read server-side from the GoTrue user)
evaluateSsoLogin()  ←  provider registry (tenant ↔ provider binding)
  (pure decision)   ←  profile row (membership), school row (status)
        ↓ allow {profileId, tenantId, role} | deny {reason}
mint pacemate_session bridge cookie → role home
(deny ⇒ auth.signOut() + destroy cookie + /login?error=sso_*)
```

The app-owned boundary (new code this stage) is exactly the part no vendor
can supply: tenant↔provider binding, membership resolution, role mapping,
JIT policy, suspension, and app-session issuance. The protocol cryptography
is exactly the part we must not hand-roll (spec §15/§25). GoTrue sits between
them.

## 3. OIDC/SAML decision and alternatives compared

| Criterion | A: OIDC-first, openid-client, SAML adapter later | B: provider-neutral dual stack (Auth.js v5 / +node-saml) | **C+: Supabase Auth engine + app boundary (SELECTED)** |
|---|---|---|---|
| Security | Certified RP lib; app owns transaction store + session issuance | Largest surface; SAML XML-sig in volunteer-maintained code | Protocol verification vendor-side; app adds only the boundary checks |
| New dependencies | openid-client (~219 kB server-only) | Auth.js and/or node-saml + openid-client | **None** (auth-js 2.110.1 already installed) |
| Stack fit | SSO users get NO GoTrue session → breaks the 7 `resolveAuthenticatedProfile` services unless shadow auth users are provisioned | Same gap + a THIRD session system | **Produces real GoTrue sessions; middleware, `@supabase/ssr`, request-identity chain work unchanged** |
| SAML (Korean reality: KAFE federation is SAML 2.0) | Day-2 (adapter must actually be built) | Day-1 but highest-CVE component in-house | Day-1 (Supabase SAML SSO, Pro plan: 50 SSO MAU incl., $0.015/MAU after; CLI-registered per university) |
| Multi-tenant IdP routing | Fully app-controlled | Fully app-controlled | SAML: built-in `sso_domains`; custom OIDC: app maps school→provider slug (small, and we need the registry anyway) |
| Testability under `node --test` | Best (local IdP + jose) | Painful (SAML XML fixtures) | Protocol exchange terminates at hosted GoTrue — mitigated by keeping ALL new logic in pure/injectable modules and testing the boundary with an in-process mock IdP (§12) |
| Maintenance | Own flow code forever | Highest; Auth.js momentum doubts (maintainers point to Better Auth, 2026) | Vendor-maintained engine; lock-in accepted (config lives in Supabase; no SAML SLO) |

Verdict: A and B both silently orphan the GoTrue-session-dependent services
and add dependencies the smallest robust architecture doesn't need. C+ keeps
YAGNI (§7) and still preserves A's virtue: because every institution-facing
assumption lives behind the app-side provider registry + decision module,
swapping the engine later (e.g. to openid-client) changes the callback
internals, not the authorization model. Both protocols are supported at the
contract level; deep protocol work is deferred to the vendor.

## 4. Provider contract

Normative version in PROVIDER_CONTRACT.md. Summary: a tenant's provider
descriptor binds `schoolId` (authorization key) to `providerSlug`/
`providerId` + `issuer` + `protocol` + optional `emailDomains` + `enabled`.
Trusted claims: (provider, issuer, sub) and `email_verified`; email is
trusted for one purpose only — first-login account linking against a
pre-provisioned profile under the SAME tenant's provider; name/department
are display-only. Client-submitted anything is never an identity claim.

## 5. External identity key and account linking

Stable key: **(provider, issuer, subject)** — natively persisted by GoTrue in
`auth.identities`; platform identity remains `auth.users.id →
profiles.auth_user_id (partial unique) → profiles.id`. The app never keys on
display name, department text, or raw email.

Account linking policy (first SSO login of a pre-provisioned profile):
link `profiles.auth_user_id := authUser.id` ONLY when ALL hold:
1. the asserting provider is the registered provider of a tenant
   (issuer↔tenant binding verified);
2. the profile row matched by institutional email (`profiles.identifier`,
   case-insensitive exact) has `auth_user_id IS NULL`;
3. `profile.school_id === provider.schoolId` (cross-tenant linking denied);
4. the IdP asserted `email_verified = true`.
Once linked, subsequent logins resolve purely by `auth_user_id` (email never
consulted again — email mutation at the IdP cannot re-bind the account, and
the partial-unique index makes double-linking impossible). Implication
documented: linking trusts the institutional email exactly once, against a
row the tenant itself pre-provisioned with that email as identifier — an
attacker at university B's IdP asserting the same email fails condition 3;
an unverified email fails condition 4. GoTrue-level automatic identity
linking must be left OFF for SSO providers (production config requirement,
§13).

## 6. Tenant mapping

`schools.id` remains the only authorization key. The provider registry maps
BOTH directions server-side: school → provider (login routing) and
issuer/provider → school (callback verification). The callback derives the
asserting provider from the verified GoTrue identity (`auth.identities`
provider + issuer / SAML `sso_provider_id`), NEVER from `?tenant=`,
`?school=`, request body, or cookies — frozen by a source-guard test.
University A's IdP cannot mint a session in University B: the decision
module denies when `profile.school_id !== provider.schoolId` (M-SSO-2) and
unknown issuers are denied outright (M-SSO-3). `schools.slug` stays a
routing/display key only.

## 7. Membership model / JIT policy

Stage 6 Design 1 is kept (one profile → one tenant via `profiles.school_id`;
`tenant_memberships` remains deferred — nothing in Stage 7 needs
multi-affiliation, and the audit's inline `profile.school_id` read caveat
makes Design 2 a deliberate sweep, not a resolver swap; recorded in
KNOWN_ISSUES).

**JIT provisioning: OFF by default — pre-provisioned (invite) model.**
Rationale: the institutional rules JIT needs (who counts as a member, which
affiliation claims are reliable, who may be a professor) are exactly the
BLOCKED external inputs; the platform already operates deny-unmapped; and
auto-creating members without rules would grant access to anyone the IdP
still recognizes (alumni, staff of other units). The policy object supports
a per-tenant opt-in (`jit: { enabled: true, allowedRoles: ["student"],
requireEmailVerified: true, requireDomains: [...] }`) evaluated by the pure
decision module and covered by tests, but the shipped default is
`enabled: false`, and `allowedRoles` may never contain privileged roles
(enforced in code, not just config). Unknown user + JIT off ⇒ controlled
deny `not_provisioned`. Duplicate identity (assertion matching a profile
already linked to a DIFFERENT auth user) ⇒ deny `identity_conflict`, no
writes. All provisioning/linking decisions are auditable events (§14).

## 8. Role mapping

Roles remain `student|professor|assistant|admin`, tenant-level, stored in
`profiles.role` (DB authoritative). Mapping rules:
- Existing member: role comes from the pre-provisioned `profiles.role`. IdP
  affiliation claims NEVER change an existing role (no silent escalation,
  no silent demotion — drift is surfaced as an audit event only).
- JIT (when a tenant enables it): affiliation claim → role via an explicit
  allowlist that can only yield `student` (professor/assistant/admin are
  pre-provisioned by a human). `department = law` maps to nothing.
- Assistant/admin: never derivable from any claim; no mapping rule exists
  even optionally.
Faculty linkage: an SSO professor resolves to a `professors` row strictly
via `professors.profile_id` (the Stage 6 write-path rule). The read-path
first-row fallback (KI-017 B-24) is unchanged this stage (out of scope) but
re-flagged as a pre-tenant-#2 blocker in KNOWN_ISSUES.

## 9. Existing-login compatibility

Password login (`createDemoSession`) is untouched and remains available to
all roles during the transition — with a single live demo tenant and no real
IdP, it is the only working production path. SSO and password can coexist on
one identity (same `auth.users` row, multiple identities). A per-tenant
`enforceSsoOnly` policy flag is defined in the policy model (default false)
so a university can later disable password login without code changes; it is
evaluated in the decision module but no UI exposes it this stage. No second
unrelated identity is ever created for a linked person: the linking rules
(§5) resolve to the one pre-provisioned profile or deny.

## 10. Login routing

Chosen pattern: **institution-specific entry via `schools.slug`**
(`/login/sso/[slug]` initiation route → provider registry → GoTrue
`signInWithOAuth({provider: "custom:<slug>"})` or
`signInWithSSO({providerId})`), because it needs no discovery UI, matches
the reserved slug key, and leaves email-domain discovery
(`signInWithSSO({domain})` for SAML) available later without UX change. The
existing login page gets NO redesign (Stage 4 UX preserved); until a real
provider is configured the route answers with a controlled
`sso_not_configured` denial. Routing input (slug) selects only WHICH
provider to try — authorization never derives from it (§6).

## 11. Logout / session lifecycle

- Local logout: existing `clearDemoSession` (GoTrue signOut + HMAC cookie
  destruction) — unchanged, covers SSO sessions too.
- Provider logout: **NOT claimed.** Supabase SAML SSO has no SLO; OIDC
  RP-initiated logout is not implemented. Documented honestly for
  institutions.
- Disabled tenant: `schools.status = 'suspended'` denies at the SSO decision
  (M-SSO-10) and — via this stage's widening of `resolveTenantContext` to
  fail closed when the resolvable carries `school_status: "suspended"` — the
  seam exists for request-time enforcement once profile reads join the
  school row (Stage 9 wiring; Stage 6 call sites are byte-compatible because
  the field is optional).
- Disabled/revoked membership: unmapped or unlinked users deny at next
  login; mid-session revocation is bounded by the 8h HMAC TTL + GoTrue
  session lifetime (no server-side session store exists — pre-existing
  property, recorded as a residual risk, not silently fixed here).

## 12. Mock / development IdP strategy

**Test-only, in-process, deterministic — no production-reachable dev login
route.** Adding an HTTP dev-IdP endpoint would be a standing backdoor risk
for zero test value: the harness (IDENTITY_AUDIT §8) has no HTTP mocking and
substitutes modules at compile time. Therefore:
- `src/lib/sso/mock-idp.ts` (shipped under src for type-checking, imported
  ONLY by tests — a source-guard asserts no app module imports it): mints
  real RS256 identity assertions with `node:crypto` keypairs, exports JWKS,
  an "evil twin" wrong-key signer, a second issuer, and an injectable clock
  (the `createDemoSessionToken(claims, now)` precedent).
- The callback core `processSsoCallback` and the pure `evaluateSsoLogin`
  accept injected dependencies (supabase clients / identity snapshot /
  registry / clock), so every TEST_MATRIX scenario runs under `node --test`
  with two-tenant fixtures in the `tenant-isolation.test.mjs` style,
  asserting the denial AND zero side effects.
- Production configuration cannot enable any mock: there is no env flag, no
  route, no registry entry type for it. Dev-vs-prod separation is structural
  (test-only import), not configurational.

## 13. Production configuration requirements (real university onboarding)

BLOCKED until an institution provides them (never fabricated):
- OIDC: issuer/discovery URL, client ID (+ secret where applicable),
  registered redirect URI (`https://<app-host>/auth/callback` via the
  Supabase project callback), claim mappings, test account. Configured in
  Supabase Auth (dashboard/admin API) — secrets live in the vendor config,
  never in repo/DB/client. Nonce checking ON, `acceptable_client_ids`
  restricted, automatic identity linking OFF.
- SAML: IdP metadata (entityID, SSO URL, signing cert), ACS registration,
  attribute mappings, test account; registered via `supabase sso add`
  (+ optional `sso_domains`). Requires Supabase Pro plan (50 SSO MAU
  included, then $0.015/MAU). No SLO.
- Platform side per tenant: a provider registry entry (schoolId, slug,
  issuer, protocol, emailDomains), pre-provisioned member profiles (or an
  explicit signed-off JIT policy), a per-university admin owning
  suspension, and the email-domain→tenant mapping decision.
- Housekeeping before any real IdP connects: remove/build-gate the
  plaintext demo credentials in the client bundle (KNOWN_ISSUES this
  stage); decide the `profiles.identifier` namespace (keep global uniqueness
  with institution-domain emails vs `unique(school_id, identifier)`).

## 14. Audit logging

No audit-log table exists today (only `console`-level logs). Stage 7 adds a
structured server-side audit emitter for identity events (`sso_login_ok`,
`sso_login_denied{reason}`, `account_linked`, `role_drift_observed`,
`jit_provisioned`) that logs ONLY: event, reason code, profileId/schoolId
(uuids), provider slug, and truncated subject hash — never tokens, codes,
raw claims, or emails. A durable audit table is Stage 8/9 scope (outbox
family); the emitter is the seam.

## 15. Risks

- Protocol exchange is not exercisable end-to-end without a real/hosted IdP
  (Supabase-side) — mitigated by pure-boundary tests + honest BLOCKED
  labeling; the callback wiring is source-guarded.
- Supabase lock-in (SAML config, no SLO) — accepted; boundary keeps an
  engine swap contained.
- Email-once linking (§5) trusts institutional email at first login —
  narrowed by the four conditions; residual risk documented in the
  contract.
- Dual-session bridge persists (HMAC irrevocable ≤8h) — pre-existing,
  unchanged, recorded.
- Plan-tier dependency for SAML (Pro) — an ops/procurement fact, flagged.

## 16. Explicitly blocked real-university work

Connecting any real IdP; registering SAML metadata; issuing/receiving client
secrets; per-institution claim mappings; JIT rule sign-off; per-university
admin appointment; storage tenant-prefixing rollout. All marked BLOCKED —
requires institution IdP configuration / credentials.
