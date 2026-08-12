# Current Project State

## Current Stage

Stage 6 / 10
University Multi-Tenancy
Status: COMPLETE on branch `upgrade/stage-6` (2026-08-12) — awaiting PR
review/merge.
Base: `main` @ 0b3b88e (Stage 5 merge, PR #39). See
docs/upgrade/stage-06/HANDOFF.md.

Next stage: Stage 7 (SSO) — NOT started. Stage 7 begins only after the Stage 6
PR merges, from the HANDOFF "Stage 7 SSO integration points" section.

## Primary Objective

One deployed platform serves multiple universities with strictly isolated
university data. Security invariant: a user acting within University A must
never be able to read, modify, infer, reserve, administer, or otherwise
access University B's tenant-scoped data unless an explicitly designed
platform-level role authorizes it. Isolation is enforced at authoritative
boundaries (server actions, database, RLS), not in the UI.

Stage 6 prepares — but does NOT implement — Stage 7 SSO. No SAML/OIDC/IdP
integration; the tenant model must merely make
identity → membership → tenant → role mapping possible later.

## Non-goals

- Stage 7 SSO (SAML/OIDC/JIT provisioning/institution credentials)
- Stage 8 reliability/scale (KI-018 outbox/bounds)
- Stage 9 security architecture overhaul (KI-011/KI-014 RLS family) beyond
  what tenant isolation itself requires
- Stage 10 CI/CD
- Subdomain routing / branding redesign / tenant switching UI / university CMS

## Completion rule

Stage 6 work completes on the branch only; merging requires external review
and human approval (see stage-06/HANDOFF.md when complete). Never merge
automatically. Never start Stage 7 automatically.
