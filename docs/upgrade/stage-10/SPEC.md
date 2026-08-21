# Stage 10 — Production QA / CI/CD / Release Readiness

Status: REPOSITORY-LOCAL IMPLEMENTATION AND FINAL GATE PASS on
`upgrade/stage-10`. Live scratch-project items remain explicitly BLOCKED as
recorded in the handoff; they are not completion claims.

Base: `main` at `8e178a676c89106497747eda54ac17d0f479af7f`, the merge
commit for PR #43. Its Stage 9 parent is
`cbafe108859567c103cd28a710e1ba0000e78ef5`.

## 1. Goal

Finish the staged upgrade with reproducible release gates, a narrowly scoped
Next.js security patch, safe non-production database validation support, real
notification Realtime evidence where an approved environment permits it,
rendered security-sensitive QA, and an honest operational handoff.

Stage 10 does not make production ready by assertion. A capability is `PASS`
only when it was executed and observed. Repository support without an executed
environment is `UNVERIFIED`; unavailable external capability is `BLOCKED` with
its exact dependency.

## 2. Verified starting point

- GitHub PR #43 is merged at `8e178a6`; local and remote `main` matched before
  `upgrade/stage-10` was created.
- The only pre-existing working-tree residue is the untracked `.superpowers/`
  directory. It is unrelated, must remain untouched, and must never be staged.
- Installed framework versions are Next.js `15.5.20`,
  `eslint-config-next` `15.5.20`, React `19.2.7`, and React DOM `19.2.7`.
- The repository has no `test` package script and no `.github` CI directory.
- Fresh offline baseline on Node `v24.18.0`:
  - 628 tests
  - 622 pass
  - 3 fail: the established KI-002 source-regex trio
  - 3 skip: Windows POSIX signal-delivery tests
- The two KI-002 files are
  `src/services/admin-notifications.test.mjs` and
  `src/services/question-notice-workflow.test.mjs`. Their three failures were
  reproduced by exact name before Stage 10 changes.
- The checkout is linked to production Supabase project
  `szztsqdnvenfbgxtylkl`. Docker's engine is unavailable, no Supabase CLI is
  installed, and `supabase/config.toml` is absent.

The historical Stage 9 documents that still say PR #43 is unmerged remain
historical evidence. Stage 10 updates current-state documents without rewriting
the historical review record into a false chronology.

## 3. Non-negotiable invariants

1. Never reset, rebuild, restore, load-test, or run destructive validation
   against production project `szztsqdnvenfbgxtylkl`.
2. Every mutating live probe must retain the Stage 9 explicit opt-in, exact
   project-ref match, production denylist, scoped ownership, fatal cleanup, and
   zero-residue verification. Project identity is security-sensitive structured
   input: a configured ref is parsed and shape-validated before any denylist,
   host, or equality decision, production is recognised on its canonical
   (trimmed, lower-cased) form, and malformed refs fail closed.
3. RLS remains the Realtime authorization boundary. Client filtering is only
   defence in depth.
4. No test, RLS policy, privilege guard, migration postcondition, or CI gate is
   weakened to make a run green.
5. Existing Stage 5–9 scheduling, tenancy, authorization, audit, recovery, and
   observability invariants remain in force.
6. No real credential, token, password, project secret, or populated environment
   file is committed.
7. `.superpowers/` is not read, modified, staged, or documented as Stage 10
   output.
8. No commit, push, pull request, merge, or unrelated feature work is part of
   this stage execution session.

## 4. Checkpoint protocol

Each major workstream is an independent checkpoint. Before moving to the next
checkpoint, the handoff must record:

1. the exact tracked files changed in that checkpoint;
2. the exact focused commands executed and their pass/fail/skip counts;
3. comparison with the `628 / 622 / 3 / 3` offline baseline;
4. every new failure by exact test name;
5. its root cause and disposition; and
6. a clean `git diff --check` for the checkpoint.

An unexplained failure stops progression. A known baseline failure can be
carried only after its name and unchanged cause are independently confirmed.
Once KI-002 is replaced with behavior-level coverage, later checkpoints compare
against the new green baseline and may not reintroduce those failures.

## 5. Checkpoint 1 — Next.js 15.5.21

Upgrade only `next` and the compatible `eslint-config-next` patch level needed
for framework alignment. React and React DOM stay at the already resolved
`19.2.7` unless official compatibility evidence requires otherwise.

Before modifying dependencies:

- inspect official Next.js 15.5 patch/release and migration material;
- inspect Server Actions, middleware, App Router, caching/revalidation, build
  configuration, and security implications relevant to this repository;
- capture exact resolved versions from both lockfiles.

After the dependency change, independently run:

- framework-sensitive source/contract suites;
- Stage 3 hydration and bundle-budget guards;
- Stage 7 session/middleware/SSO guards;
- Stage 9 Server Action and authorization guards;
- the full offline repository suite;
- typecheck;
- lint;
- production build;
- bundle budgets; and
- `git diff --check`.

No CI, Supabase configuration, migration, or Realtime change may be combined
into this checkpoint. Its evidence must show whether the framework patch alone
introduced a regression.

## 6. Checkpoint 2 — offline test entrypoint and CI

Create one reproducible top-level offline test entrypoint covering every
committed `*.test.mjs` under `src`, `scripts`, and `supabase`.

The existing KI-002 trio must first be classified from current behavior. If the
regexes are stale while stronger behavior/security coverage already exists,
replace them with focused behavior or structural assertions that can fail for
the intended property. Do not merely edit expected strings to mirror the
implementation.

Offline CI is mandatory and contains no secrets. Its gates are:

- frozen dependency installation;
- the complete offline test entrypoint;
- typecheck;
- lint;
- production build;
- bundle budgets;
- migration/security snapshot guards included by the test entrypoint; and
- `git diff --check`.

Credentialed integration/security verification is a separate workflow or
explicit command. It must never silently skip for missing credentials: an
invoked credentialed job fails with an actionable missing-environment message.
It must never default to production.

Both `package-lock.json` and `pnpm-lock.yaml` remain synchronized while both are
present. Removing a package manager is outside Stage 10 unless a concrete CI
failure proves it necessary.

## 7. Checkpoint 3 — Supabase configuration and rebuild support

Add `supabase/config.toml` based on the actual migration and seed layout. Pin
the local project id and local service ports without copying production secrets.
Seed configuration must reference only repository-owned seed files deliberately
selected for a disposable environment.

Provide standing commands for:

- starting/stopping the local stack;
- resetting a local database from the full migration chain;
- checking migration/security snapshot guards offline; and
- running credentialed probes only against an explicitly declared scratch
  project.

The safety boundary must reject production even if an operator labels it
non-production. Local loopback and an independently verified scratch project are
the only acceptable destructive targets.

Execution outcomes are distinct:

- `PASS`: a clean database was actually constructed and verified;
- `UNVERIFIED`: support exists but local Docker/tooling could not execute it;
- `BLOCKED`: no safe scratch environment or required account permission exists.

Repository-local configuration work continues when cloud provisioning is
blocked.

## 8. Checkpoint 4 — credentialed security and Realtime

Add a real Realtime verification path using disposable principals and rows. It
must exercise the real Supabase Realtime socket and real database INSERTs for:

1. direct notification delivery to the intended authenticated recipient;
2. broadcast fan-out delivery to the intended same-tenant recipients;
3. no direct delivery to the wrong user; and
4. no tenant-scoped delivery to the wrong tenant.

Each denial begins with positive evidence that the intended recipient can
receive the controlled row. The probe must reuse the Stage 9 lifecycle,
credential, ownership, deadline, and recovery primitives rather than creating a
weaker parallel harness.

On an approved disposable environment, execute in order:

- clean rebuild / migration chain;
- migration fail-closed guards;
- security snapshot generation and deterministic checking;
- direct RLS probe;
- notification RLS probe;
- Realtime probe; and
- exact residue verification.

If no approved environment exists, implemented probe support is `UNVERIFIED`
and cloud execution is `BLOCKED`; mocked delivery is not reported as E2E proof.

## 9. Checkpoint 5 — rendered QA and recovery evidence

Run the production application build and inspect:

- `/support`: sessionless refusal and legitimate signed-in submission;
- `/admin`: stale-decision/CAS banner;
- `/professor`: assistant workspace and ordinary professor workspace;
- notification bell/menu: mark-read and, when the scratch environment permits,
  visible Realtime delivery;
- roadmap feedback and professor course settings, the two remaining Stage 9
  unrendered paths; and
- a compact smoke pass over Stage 5–9 core journeys.

Record page behavior, authorization outcomes, browser-console errors, server
errors, and any residue created for QA. A source test or mock cannot substitute
for a rendered claim.

Recovery evidence is limited to what is executed safely. Inspect available
backup/PITR metadata read-only. Never invent an RPO or RTO. Restore drills require
an approved disposable environment and an actual recovery point. Otherwise they
remain `BLOCKED` with the exact plan/account dependency.

## 10. Checkpoint 6 — documentation and final gate

Update:

- `docs/upgrade/CURRENT_STAGE.md`;
- `docs/upgrade/DECISIONS.md` for any new durable architecture choice;
- `docs/upgrade/KNOWN_ISSUES.md` for resolved, remaining, or newly discovered
  evidence;
- `docs/upgrade/stage-09/HANDOFF.md` only where a clearly marked post-merge
  addendum is required; never rewrite historical review evidence;
- `docs/upgrade/stage-10/HANDOFF.md`; and
- this Stage 10 plan/specification when execution changes the supported path.

The final gate reruns the full offline suite, Stage 5, 6, 7, 8, and 9 groups,
typecheck, lint, production build, bundle budgets, and `git diff --check`.
Credentialed checks are reported separately with exact PASS/BLOCKED/UNVERIFIED
status.

Completion output must include every changed file, exact test counts, named
failures/skips, clean-rebuild evidence or blocker, Realtime evidence or blocker,
rendered QA evidence, recovery limits, remaining risks, `git status`, secret and
unrelated-file checks, and confirmation that no commit/push/PR/merge occurred.

## 11. Out of scope unless required by evidence

- roadmap, course-add, and one-click demo-login UX restoration;
- broad UI redesign;
- unrelated application refactoring;
- SSO integration without institution configuration;
- composite tenant foreign keys, erasure/export product work, rate limiting,
  pagination, or service-role cleanup listed in KI-022;
- a claimed backup guarantee without a real backup and restore drill; and
- production data mutation for testing convenience.
