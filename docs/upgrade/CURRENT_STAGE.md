# Current Project State

## Current Stage

Stage 7 / 10
University SSO Readiness
Status: IN PROGRESS on branch `upgrade/stage-7` (started 2026-08-12)
Base: `main` @ 19a1124 (Stage 6 PR #40 merged 2026-08-12; `upgrade/stage-7`
fast-forwarded onto merged `main`, clean, no rebase needed).

## Primary Objective

Prepare the platform for university SSO without connecting a real university:

```text
University IdP → OIDC/SAML → platform auth boundary → verified institutional
identity → tenant membership resolution → role mapping → application session
```

Deliverables: SSO-ready architecture + provider adapter/interface +
tenant/provider configuration model + mock/dev IdP integration +
claim/membership mapping + security tests. Real institution integration is
BLOCKED (requires institution IdP configuration/credentials) and must never
be fabricated or claimed complete.

Stage 6 tenant isolation remains the authoritative security boundary. SSO
authentication must never bypass tenant authorization. Authentication (who
did the IdP verify) stays separate from authorization (what may this user do
in this tenant); IdP claims never auto-grant privileged roles without an
explicit trusted mapping rule.

## Non-goals

- Real university IdP integration (no institution metadata/credentials exist)
- Fabricated issuers/certs/secrets presented as production-ready
- Stage 8 reliability/scale, Stage 9 RLS overhaul (KI-011/KI-014 family),
  Stage 10 CI/CD
- Broad login-page redesign (Stage 4 UX preserved)

## Completion rule

Stage 7 work completes on the branch only; merging requires external review
and human approval. Never merge automatically. Never start Stage 8
automatically. Repository state is the source of truth.
