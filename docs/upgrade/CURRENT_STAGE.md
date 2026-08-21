# Current Project State

## Current stage

Stage 10 — Production QA / CI/CD / Release Readiness

Status: REPOSITORY-LOCAL IMPLEMENTATION AND FINAL GATE PASS on `upgrade/stage-10`

Base: `main` at `8e178a676c89106497747eda54ac17d0f479af7f`

Stage 9 PR #43 is merged. Its verified head
`cbafe108859567c103cd28a710e1ba0000e78ef5` is the second parent of the merge.
The Stage 9 handoff remains historical evidence; its old "not merged" wording
is not the current project state.

The only pre-existing unrelated working-tree path is `.superpowers/`. Stage 10
did not read, change, or include it.

## Stage 10 checkpoint results

1. **Next.js patch — PASS.** `next` and `eslint-config-next` are pinned at
   `15.5.21`; React/React DOM remain resolved at `19.2.7`. The isolated
   framework checkpoint matched the starting suite exactly:
   `628 total / 622 pass / 3 named KI-002 fail / 3 Windows skips`. Typecheck,
   lint, production build, and bundle budgets passed before CI or Supabase work
   began.
2. **KI-002 — RESOLVED.** The three stale source-shape assertions were replaced
   by executable action/helper coverage and mutation-checked. New independent
   baseline: `628 / 625 / 0 / 3`.
3. **Production-target safety — PASS.** Security and load harnesses share a
   compiled production denylist; every opt-in still refuses the known
   production ref.
4. **CI separation — PASS.** Offline CI has no secrets and runs the complete
   repository-local release gate. Credentialed security verification is a
   manual protected-scratch workflow and fails closed when invoked without its
   required environment.
5. **Supabase local support — PASS; clean rebuild BLOCKED / UNVERIFIED.** CLI
   `2.115.0`, a PostgreSQL 17 local config, and a loopback-only reset wrapper
   are committed in the working tree. Docker image pulls failed before DB
   creation with repeated EOF / Docker API 500 responses; production was not
   used as a fallback.
6. **Realtime probe implementation — PASS; live socket E2E BLOCKED /
   UNVERIFIED.** The live notification probe now opens authenticated sockets
   for two intended users and a foreign tenant, inserts direct and per-recipient
   broadcast rows, proves intended delivery plus peer/cross-tenant non-delivery,
   and uses Stage 9 lifecycle/recovery cleanup. No approved scratch credentials
   were available, so the runner refused before spawning a live probe.
7. **Rendered QA — PASS for non-mutating routes and controls.** Sessionless
   support refusal; professor and assistant workspaces; stale admin outcome;
   authenticated support form; professor course settings; student roadmap
   feedback; notifications; and a 390x844 mobile pass rendered on the production
   build without browser console errors. No production form or database
   mutation was submitted. A real assistant-onboarding role defect was fixed
   with RED/GREEN action tests and a clean rendered rerun.
8. **Recovery — BLOCKED.** Read-only production metadata reports WAL-G enabled,
   PITR disabled, and zero listed backups. There is no verified restore point,
   disposable restore target, measured restore drill, RPO, or RTO.

## Release evidence location

- Specification: `docs/upgrade/stage-10/SPEC.md`
- Implementation plan: `docs/upgrade/stage-10/IMPLEMENTATION_PLAN.md`
- Checkpoint and final gate evidence: `docs/upgrade/stage-10/HANDOFF.md`
- Recovery/rebuild evidence: `docs/upgrade/stage-10/RECOVERY_EVIDENCE.md`

## Remaining external dependencies

- Approved non-production Supabase project and credentials for the real RLS,
  authenticated Realtime, snapshot, migration rehearsal, and safe load tiers.
- A functioning local container pull path or approved disposable cloud DB for
  an executed empty-database migration-chain rebuild.
- An actual recovery point and disposable target for a restore drill. RPO/RTO
  remain unclaimed until measured.
- Real institution IdP configuration/credentials for the Stage 7 SSO E2E item.

## Completion boundary

Stage 10 repository-local execution ended on the branch after the final release
gate and evidence package. Do not commit, push, create a PR, or merge
automatically. Blocked live evidence stays blocked; a green offline gate does
not convert it into a pass.
