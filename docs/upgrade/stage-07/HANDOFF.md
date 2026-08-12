# Stage 7 Handoff — University SSO Readiness

## Status

COMPLETE (SSO-ready architecture) — 2026-08-13, on `upgrade/stage-7` from
`main` @ 19a1124 (the Stage 6 merge of PR #40; note 19a1124 includes
f99cb5f, which committed the two Stage 6 migrations that had been applied
live but left untracked). Real university integration is **BLOCKED —
requires institution IdP configuration / credentials** — and is neither
fabricated nor claimed. Not merged (per workflow). Stage 8 NOT started.

## Selected SSO strategy (D-019)

Approach C+: Supabase Auth (GoTrue) is the protocol engine — it already
ships `signInWithSSO` (SAML, Pro plan) and `custom:<slug>` OIDC providers in
the installed auth-js 2.110.1, performs state/PKCE/nonce/JWKS/issuer/
audience verification vendor-side, and produces the REAL GoTrue sessions the
seven `resolveAuthenticatedProfile` services depend on. The app owns a thin
identity boundary around it (everything a vendor cannot know): tenant↔
provider binding, membership resolution, account linking, JIT policy,
suspension, app-session issuance. Zero new dependencies. Alternatives
(openid-client OIDC-first; Auth.js/node-saml dual stack) compared and
rejected in SSO_DESIGN §3.

## Provider abstraction

- `src/lib/sso/provider-registry.ts` (pure): descriptor types +
  `parseSsoProviderRegistry` + slug/ref lookups. Env-supplied
  (`PACEMATE_SSO_PROVIDERS`, server-only, documented in .env.local.example)
  PUBLIC metadata only — secret-like keys are a parse error; a malformed
  registry fails closed to empty (SSO disabled). JIT allowedRoles beyond
  "student" are a parse error.
- Contract for institutions: docs/upgrade/stage-07/PROVIDER_CONTRACT.md
  (required/optional/trusted/untrusted claims, failure semantics, onboarding
  checklist OIDC + SAML).

## Tenant mapping

`schools.id` remains the only authorization key. Login routing:
`/login/sso/[slug]` (slug = `schools.slug`, routing-only) → GoTrue. Callback
verification: the asserting provider is derived from the VERIFIED GoTrue
identity (`auth.identities` provider ref, `sso:<uuid>` spelling handled) and
mapped through the registry to its one tenant; the decision denies when the
membership's school differs (`tenant_mismatch`). Tenant never comes from
query/body/cookie — frozen by sso-wiring.test.mjs. A drifted registry
(school row missing / ≠ provider tenant) fails closed.

## Identity key

(provider, issuer, subject) — persisted by GoTrue in auth.identities →
`auth.users.id` → `profiles.auth_user_id` (partial unique) → `profiles.id`
(the app-wide identity every FK points at). Never email/display-name keyed.

## Membership / JIT behavior (D-020)

Default: pre-provisioned (invite) model — unknown identity denies
`not_provisioned`. Per-tenant JIT opt-in exists with a hard student-only
ceiling enforced at three layers (affiliation allowlist map, policy
hard-compare, registry parse rejection); requires verified email and
optional domain allowlist; inserts deny on identifier conflict (never
merge). Account linking: first login links an UNLINKED profile by exact
case-insensitive identifier match under provider-tenant + email_verified
conditions, via CAS UPDATE; email is trusted exactly once, never consulted
after linking.

## Role mapping

Existing members: `profiles.role` (DB row) is reused verbatim — IdP claims
never change a role (tested: hostile `affiliation=admin` cannot escalate).
JIT: student only. assistant/admin: never claim-derivable. Unknown role
values in the DB fail closed.

## Legacy login behavior

`createDemoSession` (password) is untouched (guarded by sso-wiring test) and
remains available to all roles; SSO and password can coexist on one
auth.users row. `policy.enforceSsoOnly` is modeled for a later per-tenant
password shut-off; no UI consumes it yet (KI-020). The SSO callback mints
the same HMAC `pacemate_session` bridge cookie AFTER the full decision, so
both session halves keep working for SSO users.

## Mock IdP / testing

`src/lib/sso/mock-idp.ts` — in-process, deterministic (injectable clock),
real RS256 keypairs + JWKS + evil-twin signer. TEST-ONLY by structure: a
source guard fails the suite if any app module imports it; no route/env
flag/registry type can activate it (D-021). Test suites added (59 tests):

- src/lib/sso/provider-registry.test.mjs (8) — parse/fail-closed/secrets/
  privileged-JIT rejection/lookups.
- src/lib/sso/sso-login-policy.test.mjs (17) — decision + linking matrix.
- src/lib/sso/mock-idp.test.mjs (6) — signature/issuer/audience/expiry/kid
  forgeries rejected.
- src/services/sso-callback.test.mjs (16) — M-SSO-1..11 + registry/replay/
  collision cases against the REAL processSsoCallback (two-tenant fixture,
  zero-side-effect assertions).
- src/services/sso-wiring.test.mjs (8) — source guards: tenant never from
  request, decision precedes session mint, no token logging, mock IdP
  test-only, legacy login untouched.
- src/lib/tenant.test.mjs (+3) — suspension fail-closed (Red→Green:
  suspended case failed on the old resolver, passes on the widened one).

## Security tests / evidence (2026-08-13)

Full matrix + regression table: docs/upgrade/stage-07/TEST_MATRIX.md.
Headlines: Stage 6 two-tenant isolation suite 5/5 GREEN rerun on this
branch; FULL suite 289/286 pass/3 fail — the SAME pre-existing KI-002 trio
by name (Stage 6 baseline 230/227/3; +59 Stage 7 tests all green);
typecheck clean; lint at baseline (1 pre-existing warning); `npm run build`
PASS, bundle budgets met, shared JS 102 kB unchanged (no new deps);
/auth/callback + /login/sso/[slug] add ~142 B route stubs.

## Real provider integration status

BLOCKED — requires institution IdP configuration / credentials. Nothing
real is configured; `/login/sso/<slug>` answers `sso_not_configured` until a
registry entry + Supabase provider exist. The live GoTrue↔IdP protocol
exchange is UNVERIFIED end-to-end (vendor-verified behavior; the app
boundary around it is fully tested; the mock-idp suite demonstrates the
token checks locally).

## Required external university configuration (per institution)

OIDC: issuer/discovery URL, client ID (+ secret), redirect URI registration,
claim mappings, test account — configured in Supabase Auth (nonce ON,
acceptable_client_ids restricted, automatic identity linking OFF).
SAML: IdP metadata (entityID/SSO URL/signing cert), ACS registration,
attribute mappings, test account — via `supabase sso add` (Pro plan; no
SLO). Platform side: registry entry (PACEMATE_SSO_PROVIDERS), pre-
provisioned member profiles or signed-off JIT rules, per-university admin,
email-domain→tenant mapping decision. Full checklist:
PROVIDER_CONTRACT.md §4.

## Known blockers / residuals

KI-020: plaintext demo creds in the client bundle (retire before real IdP);
in-session revocation/suspension limits (HMAC 8h TTL; profile queries don't
join schools.status yet — seam exists); identifier namespace decision;
enforceSsoOnly unconsumed; professor first-row fallback (KI-017 B-24) is a
pre-tenant-#2 blocker; latent assistant-onboarding identity bug
(UNVERIFIED); 계명대 hardcoded onboarding school assignment must retire
before tenant #2.

## Relevant commits (main..upgrade/stage-7)

ac364ce docs: stage-7 base note reconciliation · 5b78153 docs: identity
audit + SSO design + provider contract · (implementation + tests + docs
commits follow this handoff).

## Exact next action

1. Push `upgrade/stage-7`; open PR to `main`; external review; fix findings
   on the branch; human-approved merge (do NOT self-merge).
2. Stage 8 starts only after merge.

## Stage 8 inputs

- KI-018 outbox/reliable notification delivery; unbounded-query bounds +
  index candidates (KI-016).
- KI-020 items that are Stage 8/9 shaped: durable audit-event sink for the
  sso-audit seam; session revocation store; schools.status join in profile
  reads; demo-credential retirement.
- academic_terms/course_equivalencies cleanup (KI-019, deferred to Stage 8).
- The sso-audit emitter is the seam a durable security log plugs into.

## Exit gate checklist

- [x] Stage 6 merged and verified (PR #40 merged → main @ 19a1124; isolation
      suite rerun 5/5 on this branch)
- [x] upgrade/stage-7 used (never main)
- [x] current auth architecture audited (IDENTITY_AUDIT.md, 4 agents)
- [x] SSO architecture selected (D-019; ≥2 alternatives compared)
- [x] provider contract documented (PROVIDER_CONTRACT.md)
- [x] stable external identity strategy defined (provider+issuer+subject →
      auth_user_id → profiles.id)
- [x] tenant/provider mapping implemented (registry + callback binding;
      tested M-SSO-2/3)
- [x] membership/JIT policy defined (D-020, default pre-provisioned)
- [x] role mapping protected (three-layer ceiling; escalation tests)
- [x] existing login compatibility addressed (untouched + guarded;
      dual-session bridge preserved)
- [x] callback/session protections verified (vendor checks documented;
      app-layer: fixed redirect origin, code-only input, fresh session after
      decision, replay denied — tested; state/PKCE live vendor-side,
      UNVERIFIED end-to-end, honest in TEST_MATRIX)
- [x] mock/dev IdP or equivalent test path works (in-process, deterministic)
- [x] cross-tenant SSO tests exist (M-SSO-2, collision, linking tenant
      checks)
- [x] privilege-escalation tests exist (M-SSO-8 + policy + registry layers)
- [x] Stage 6 tenant isolation regressions pass (5/5 rerun)
- [x] critical previous-stage regressions pass (289/286/3 — KI-002 trio
      only)
- [x] typecheck/lint/tests/build recorded (TEST_MATRIX.md)
- [x] real university requirements documented (PROVIDER_CONTRACT.md §4)
- [x] unavailable real integrations marked BLOCKED (never fabricated)
- [x] DECISIONS updated (D-019..D-021)
- [x] KNOWN_ISSUES updated (KI-020)
- [x] HANDOFF completed (this file)
- [x] CURRENT_STAGE synchronized
- [ ] branch pushed / [ ] PR created — pending (next action)
- UNVERIFIED: live GoTrue↔IdP protocol exchange (no real provider exists);
  browser-rendered QA of SSO routes (nothing to render without a provider).
