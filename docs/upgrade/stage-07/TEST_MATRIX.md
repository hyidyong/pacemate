# Stage 7 — SSO Security Test Matrix

All scenarios run under `node --test` (no network, deterministic fixtures,
injectable clock) against the REAL modules through the repo's
transpile-loader convention. Executed 2026-08-13 on `upgrade/stage-7`.
Convention: every deny asserts the enumerated reason AND zero side effects
(no session issued, no rows written, GoTrue session discarded).

## Spec §19 scenarios → tests

| Scenario | Test (file :: name) | Result |
|---|---|---|
| Valid A university user → A | sso-callback.test.mjs :: M-SSO-1 (+ policy suite "valid University A member") | PASS — session for the A membership only |
| Valid A identity → B tenant | sso-callback.test.mjs :: M-SSO-2 (+ policy "cross-tenant deny") | PASS — deny `tenant_mismatch`, zero writes |
| Unknown provider | sso-callback.test.mjs :: M-SSO-3 (+ policy "unknown provider") | PASS — deny `unknown_provider` |
| Invalid callback/state | sso-callback.test.mjs :: M-SSO-4 (forged code; state/PKCE live vendor-side) | PASS — deny `failed`, no session |
| Missing required identity claim | sso-callback.test.mjs :: M-SSO-5 (+ policy "missing stable subject") | PASS — controlled `missing_required_claim` |
| Existing membership | sso-callback.test.mjs :: M-SSO-1/M-SSO-6 — reuse via auth_user_id / one-time CAS link | PASS — correct identity reused; role from DB row |
| New permitted user | sso-callback.test.mjs :: M-SSO-7a (JIT off → not_provisioned) / M-SSO-7b (JIT on → student provisioned in provider's tenant) | PASS — per policy, default deny |
| New privileged user claim | sso-callback.test.mjs :: M-SSO-8 + policy "privileged/unknown affiliation" + registry "JIT allowedRoles" | PASS — never escalates (three layers: mapping allowlist, policy ceiling, registry parse rejection) |
| Disabled membership | sso-callback.test.mjs :: M-SSO-9 (membership removed → deny-unmapped) | PASS — deny `not_provisioned` |
| Disabled tenant | sso-callback.test.mjs :: M-SSO-10 + tenant.test.mjs suspension cases | PASS — deny `school_suspended`; resolveTenantContext fails closed |
| Duplicate callback/replay | sso-callback.test.mjs :: M-SSO-11 (consumed code) + M-SSO-6b (linking CAS race) | PASS — one session total; lost race denies |

## Additional security coverage

| Concern | Test | Result |
|---|---|---|
| Provider disabled flag | policy suite "disabled provider" | PASS |
| Registry drift (school row ≠ provider tenant) | policy suite "school row absent or drifted" | PASS |
| Unknown role value in DB | policy suite "role outside the app vocabulary" | PASS |
| JIT email gates (unverified / missing / wrong domain) | policy suite "JIT requires a verified institutional email" | PASS |
| Account-link four conditions (unlinked, email match, tenant match, verified) | policy suite linking tests + M-SSO-6 | PASS |
| Global identifier collision across tenants | sso-callback "JIT identifier collision" | PASS — deny, never merges |
| Password-only user at the SSO callback | sso-callback "password-only auth user" | PASS — deny |
| Malformed registry | registry suite + sso-callback "malformed provider registry fails closed" | PASS — whole registry rejected, SSO disabled |
| Secrets in registry config | registry suite "secret-like fields structurally rejected" | PASS |
| Signature/issuer/audience/expiry forgeries | mock-idp.test.mjs (wrong key, tampered payload, wrong iss/aud, expired, future iat, foreign JWKS) | PASS — all rejected (demonstrates the checks GoTrue enforces vendor-side) |
| Wiring freeze (tenant never from request; decision before session; no token logging; mock IdP test-only; legacy login untouched) | sso-wiring.test.mjs (8 guards) | PASS |

## Regression reruns (2026-08-13, this branch)

| Suite | Result |
|---|---|
| Stage 6 two-tenant isolation (tenant-isolation.test.mjs) | 5/5 PASS |
| resolveTenantContext unit tests (with new suspension cases) | 6/6 PASS |
| FULL suite `node --test "src/**/*.test.mjs"` | 289 tests / 286 pass / 3 fail — the SAME pre-existing KI-002 trio by name (admin-notifications ×2, question-notice-workflow ×1); Stage 6 baseline was 230/227/3, Stage 7 adds +59 tests all green |
| typecheck (`tsc --noEmit`) | clean |
| lint | baseline (1 pre-existing no-img-element warning) |
| `npm run build` + bundle budgets | PASS — all budgets met, shared JS 102 kB unchanged; /auth/callback and /login/sso/[slug] add ~142 B route stubs |

## Honest limits (UNVERIFIED / BLOCKED)

- The live protocol exchange (GoTrue ↔ real IdP: state, PKCE, nonce, JWKS,
  SAML signatures) is NOT exercised end-to-end — no real university IdP or
  hosted SSO provider is configured. It is vendor-verified behavior;
  our tests prove the app boundary around it and the mock-idp suite
  demonstrates the token checks locally. Real-institution flows remain
  BLOCKED (requires institution IdP configuration / credentials).
- No browser-rendered QA of the SSO routes (no configured provider ⇒
  /login/sso/[slug] can only answer sso_not_configured; behavior covered by
  unit/wiring tests).
