# Stage 7 — Provider Contract

The minimum trusted information the platform requires from an institution's
identity provider, and how each datum is classified. Normative for the
provider registry (`src/lib/sso/provider-registry.ts`) and the login
decision (`src/lib/sso/sso-login-policy.ts`). Written 2026-08-13.

## 1. Provider descriptor (per tenant, server-side registry)

| Field | Meaning | Classification |
|---|---|---|
| `schoolId` | The tenant this provider asserts for — `schools.id` uuid | REQUIRED. The ONLY authorization key. Never client-supplied. |
| `slug` | Routing handle (matches `schools.slug`) for `/login/sso/[slug]` | REQUIRED. Routing/display only — selects which provider to TRY; grants nothing. |
| `protocol` | `oidc` \| `saml` | REQUIRED. |
| `providerRef` | GoTrue reference: `custom:<slug>` (OIDC) or SSO provider uuid (SAML) | REQUIRED. Server-side only. |
| `issuer` | OIDC issuer URL / SAML entityID expected on assertions | REQUIRED. Verified by GoTrue at exchange; re-checked at the boundary for tenant binding. |
| `emailDomains` | Institutional mail domains (e.g. for future domain discovery + linking sanity) | OPTIONAL. Routing hint only. |
| `enabled` | Provider on/off without deleting config | REQUIRED (default false). |
| `policy` | `{ jit: {enabled, allowedRoles, requireEmailVerified, requireDomains}, enforceSsoOnly }` | REQUIRED (safe defaults: JIT off, enforceSsoOnly false). `allowedRoles` may never contain professor/assistant/admin — enforced in code. |

Secrets (OIDC client secret, SAML certs/keys) are NOT part of the platform
registry: they live exclusively in Supabase Auth's server-side provider
configuration. Nothing in the registry may reach the client bundle; the
registry module is `server-only`.

## 2. Identity assertion (per login, read from the verified GoTrue user)

| Claim | Classification | Use |
|---|---|---|
| `provider` + `issuer` + `sub` | REQUIRED, TRUSTED | The stable external identity key. `sub` must be the IdP's permanent subject identifier, never a display value. Maps to `auth.identities`; platform identity = `auth.users.id → profiles.auth_user_id → profiles.id`. |
| `email` | OPTIONAL, CONDITIONALLY TRUSTED | Trusted for exactly one operation: first-login linking against a pre-provisioned profile of the SAME tenant (`identifier` case-insensitive match), and only with `email_verified = true`. Never consulted again after linking; never a login key by itself. |
| `email_verified` | REQUIRED for linking/JIT | Gate for any email use. Absent/false ⇒ linking and JIT deny. |
| `name` / display identity | OPTIONAL, UNTRUSTED (display-only) | Never keys anything; may populate UI/profile display on provisioning. |
| Affiliation (student/faculty/staff), department | OPTIONAL, UNTRUSTED by default | Used ONLY through the explicit allowlisted JIT role map (max yield: `student`) when a tenant enables JIT. Never mutates an existing member's role. `department = law` ⇒ no role. |
| Anything client-submitted (query params, body, hidden fields, localStorage) | UNTRUSTED, NEVER identity | Frozen by source-guard tests. |

## 3. Failure semantics (controlled, enumerated)

`sso_not_configured`, `provider_disabled`, `unknown_issuer`,
`tenant_mismatch`, `not_provisioned`, `identity_conflict`,
`missing_required_claim`, `email_unverified`, `school_suspended`,
`role_not_allowed`. Every deny: no DB writes, GoTrue session discarded,
audit event with reason code, generic user-facing message (no oracle for
account existence).

## 4. Institution onboarding checklist (what a university IT team provides)

BLOCKED until supplied — never fabricated:

**OIDC:** issuer/discovery URL · client ID (+ secret if confidential) ·
redirect URI registration (Supabase project callback) · claim mapping
(sub/email/email_verified/affiliation) · test account.

**SAML:** IdP metadata XML or URL (entityID, SSO URL, signing certificate) ·
ACS registration (Supabase ACS URL) · attribute mapping · test account.
(Platform prerequisite: Supabase Pro plan for SAML SSO.)

**Both:** which mail domains are institutional · membership source of truth
(pre-provisioned roster vs signed-off JIT rules) · who the per-university
admin is · agreement that no single-logout is provided.
