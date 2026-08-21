# Stage 10 Evidence Handoff

Status: REPOSITORY-LOCAL COMPLETE; LIVE SCRATCH/RECOVERY ITEMS BLOCKED

Branch: `upgrade/stage-10`

Verified base: `8e178a676c89106497747eda54ac17d0f479af7f`

Date: 2026-08-21 (Asia/Seoul)

This is an evidence log, not a completion claim. Each checkpoint is closed
independently before a later workstream changes repository files.

## Baseline

- Stage 9 PR #43: `MERGED`
- Stage 9 merge commit on `main`:
  `8e178a676c89106497747eda54ac17d0f479af7f`
- Stage 9 verified head merged as the second parent:
  `cbafe108859567c103cd28a710e1ba0000e78ef5`
- Pre-existing unrelated path: untracked `.superpowers/`; untouched and
  excluded from every Stage 10 file list.
- Runtime: Node `v24.18.0`, npm `11.16.0`, pnpm `11.10.0`.
- Fresh full-suite baseline:
  `628 tests / 622 pass / 3 fail / 3 skip`.
- Baseline failure names:
  1. `admin broadcasts fan out only to student and professor recipients`
  2. `broadcast UI is in-app, recipient-scoped, and newest first`
  3. `AI escalation persists a user chat message and exposes its id to the handoff action`
- The three skips are the established Windows POSIX signal-delivery cases.

## Checkpoint 1 — Next.js 15.5.21

Status: **PASS with unchanged named baseline failures**

### Exact implementation files changed

- `package.json`
- `package-lock.json`
- `pnpm-lock.yaml`

### Documentation files present at checkpoint close

- `docs/upgrade/stage-10/SPEC.md`
- `docs/upgrade/stage-10/IMPLEMENTATION_PLAN.md`
- `docs/upgrade/stage-10/HANDOFF.md`

No application, test, CI, migration, Supabase, RLS, or security-guard file was
changed in this checkpoint.

### Official patch implications applied to this repository

- `next` and `eslint-config-next` are aligned and pinned exactly at `15.5.21`;
  React and React DOM remain `19.2.7`.
- This is a patch inside the repository's existing Next 15.5 line, so no
  version-15 async request API or React 19 migration was required.
- The existing Node.js middleware runtime remains supported in Next 15.5.
- The repository keeps its authenticated authorization checks inside Server
  Action boundaries; the framework patch does not replace those checks.
- `next lint` remains usable in 15.5 but emits the documented Next 16 removal
  warning. That warning is recorded, not suppressed.
- The existing custom webpack build path remains in place; the optional 15.5
  Turbopack build path was not introduced during this security patch.

References:

- <https://nextjs.org/docs/app/guides/upgrading/version-15>
- <https://nextjs.org/blog/next-15-5>
- <https://github.com/vercel/next.js/security/advisories/GHSA-955p-x3mx-jcvp>

### Dependency evidence

Before:

```text
next@15.5.20
eslint-config-next@15.5.20
react@19.2.7
react-dom@19.2.7
```

After `npm install --save-exact next@15.5.21`,
`npm install --save-dev --save-exact eslint-config-next@15.5.21`, and
`pnpm install --lockfile-only`:

```text
next@15.5.21
eslint-config-next@15.5.21
react@19.2.7
react-dom@19.2.7
```

`npm ci` passed. `pnpm install --frozen-lockfile --lockfile-only` passed and
reported that the lockfile passes supply-chain policies. The lockfile diff is
limited to the aligned Next packages and their platform-specific SWC packages.

`npm audit` reports `6 high / 0 critical` advisories. This is not a new patch
regression: the non-Next dependency versions are unchanged, and the reported
Next path is through the unchanged `postcss@8.4.31` and `sharp@0.34.5`
dependencies. It remains explicit residual dependency risk; no forced or major
upgrade was performed outside the approved 15.5.21 scope.

### Focused regressions

Command:

```powershell
node --test --test-reporter=tap `
  src/app/professor/professor-page-hydration.test.mjs `
  src/services/server-action-contract.test.mjs `
  src/services/support-boundary.test.mjs `
  src/services/roadmap-transition.test.mjs `
  src/components/notifications/notification-realtime.test.mjs `
  src/lib/auth/demo-session.test.mjs `
  "src/lib/sso/*.test.mjs" `
  "src/services/sso-*.test.mjs" `
  "src/lib/supabase/fetch-timeout*.test.mjs"
```

Result: `96 tests / 96 pass / 0 fail / 0 skip`.

### Full baseline comparison

Command:

```powershell
node --test --test-reporter=tap `
  "src/**/*.test.mjs" "scripts/**/*.test.mjs" "supabase/**/*.test.mjs"
```

Result: `628 tests / 622 pass / 3 fail / 3 skip` in `151229 ms`.

Comparison: exact match to the fresh Stage 10 pre-upgrade baseline. The isolated
KI-002 pair again produced `7 tests / 4 pass / 3 fail / 0 skip` with exactly the
same three names listed in the Baseline section. No new test failure was carried
forward.

### Static and production gates

- `npm run typecheck`: PASS.
- `npm run lint`: PASS with one existing `@next/next/no-img-element` warning at
  `src/components/dashboard/student-hero-carousel.tsx:87` and the expected
  Next 15.5 `next lint` deprecation notice.
- `npm run build`: PASS on Next.js `15.5.21`; 5/5 static pages generated and all
  routes completed.
- `node scripts/check-bundle-budgets.mjs`: PASS; all 30 reported route/shared
  budgets met. Shared raw first-load size was `498 kB / 537 kB`; the largest
  reported route was `/professor/page` at `782 kB / 879 kB`.
- `git diff --check`: PASS.

Checkpoint 1 is closed. The framework upgrade introduced no observed test,
type, lint, build, routing, or bundle-budget regression.

## Checkpoint 2 — KI-002 behavior coverage

Status: **PASS; KI-002 RESOLVED IN STAGE 10**

### Exact files changed

- `src/services/admin-notifications.test.mjs`
- `src/services/question-notice-workflow.test.mjs`
- `docs/upgrade/KNOWN_ISSUES.md`
- `docs/upgrade/stage-10/HANDOFF.md`

No production application file remained changed. Three production files were
temporarily and deliberately mutated one at a time for mutation testing, then
restored byte-for-byte to `HEAD`; `git diff --exit-code` confirmed no delta in
`admin-notifications.actions.ts`, `ask.actions.ts`, or
`notification-menu.tsx`.

### Root cause

All three failures reproduced consistently at `7 total / 4 pass / 3 fail`.
They were source-shape drift:

1. the admin assertion named the pre-dedup `data.map` expression while the real
   action now maps `recipientsToInsert`;
2. the menu assertion required a `recipient_id` channel filter that the current
   RLS design intentionally excludes, with an exact client recipient guard as
   defence in depth;
3. the old AI assertion inspected `ai-tutor.actions.ts`, but the rendered tutor
   submits the edited escalation through `submitQuestionToProfessor` with a
   UUID idempotency key.

### Corrected coverage and mutation evidence

- The real admin action now runs against a recording Supabase client and must
  insert exactly one unread, tenant-stamped row for each linked student and
  professor, excluding admins, other tenants, and unlinked profiles.
- The menu's real newest-first, system-broadcast deduplication, and safe-target
  helpers execute on controlled inputs. The existing dedicated Realtime suite
  still requires an unfiltered RLS-governed subscription and exact recipient
  match.
- The real question action executes with controlled normalization and records
  its call to the professor-question boundary, including exact question,
  submission key, `sourceMessageId: null`, `sourceKind: "direct"`, and anonymous
  flag.
- Deliberately replacing the admin tenant stamp made
  `admin broadcasts fan out only to student and professor recipients` fail.
- Deliberately changing `sourceKind` made
  `AI escalation persists the edited question through the professor workflow with an idempotency key`
  fail.
- Deliberately inverting the recipient guard made both
  `the client guard is an EXACT recipient match (Codex round 4, finding 1)` and
  `broadcast UI is in-app, recipient-scoped, and newest first` fail.

### Verification

- Corrected pair: `7 tests / 7 pass / 0 fail / 0 skip`.
- Related notification, authorization, and action group:
  `40 tests / 40 pass / 0 fail / 0 skip`.
- Full repository suite: `628 tests / 625 pass / 0 fail / 3 skip` in
  `151264 ms`.
- The three remaining skips are the same established Windows POSIX
  signal-delivery cases; there is no remaining named failure.
- `git diff --check`: PASS at checkpoint close.

Checkpoint 2 is closed. The previous failures are explained and replaced by
stronger coverage; no unexplained failure is carried into CI work.

## Checkpoint 3 — Compiled production-target refusal

Status: **PASS**

This safety checkpoint was deliberately completed before any credentialed CI
runner or live probe was added.

### Exact files changed

- `scripts/security/lib/production-targets.mjs` (new)
- `scripts/security/lib/probe-guard.mjs`
- `scripts/security/lib/probe-guard.test.mjs`
- `scripts/loadtest/lib/safety.mjs`
- `scripts/loadtest/lib/safety.test.mjs`
- `docs/upgrade/stage-10/HANDOFF.md`

### RED and root cause

Focused RED was `23 total / 21 pass / 2 fail` with the exact new failure names:

1. `the known production project is refused even with every write opt-in`
2. `even a genuinely marked test tenant cannot authorize load testing on production`

The probe guard previously accepted production when its write opt-in and exact
ref matched. The load-test guard also retained an older exception for a marked
tenant inside production. Both conflict with the Stage 10 rule that production
is never a destructive/security-fixture/load-test target.

### Implementation and focused GREEN

One dependency-free compiled set now owns the known production refs. Both guard
families import it. A known production ref is refused before any network client,
tenant verification, fixture provision, or cleanup is attempted; no environment
value can override that verdict.

`node --test scripts/security/lib/probe-guard.test.mjs scripts/loadtest/lib/safety.test.mjs`
result: `23 tests / 23 pass / 0 fail / 0 skip`.

The earlier Stage 9 subprocess harness was also exercised during the checkpoint;
all 21 runnable cases passed and its same three Windows POSIX signal-delivery
cases skipped. Its two approximately 43-second stalled-response cases remained
bounded and cleanup-complete.

### Full baseline comparison

The new guard adds one test to the inventory. Full result:
`629 tests / 626 pass / 0 fail / 3 skip` in `152026 ms`.

No failure was carried into the CI workstream. The production project
`szztsqdnvenfbgxtylkl` has not been contacted or mutated by Stage 10.

## Checkpoint 4 — Offline CI and credentialed integration separation

Status: **PASS for repository/CI implementation; live scratch execution BLOCKED**

### Exact files changed

- `package.json`
- `.github/workflows/ci.yml` (new)
- `.github/workflows/security-integration.yml` (new)
- `scripts/ci/workflows.test.mjs` (new)
- `scripts/security/run-integration-suite.mjs` (new)
- `scripts/security/run-integration-suite.test.mjs` (new)
- `docs/upgrade/stage-10/HANDOFF.md`

The package lockfiles did not need a CI-specific content change because scripts
are not stored in either dependency graph. Their existing Checkpoint 1 changes
remain synchronized.

### RED/GREEN implementation evidence

- The integration-runner test first failed with
  `ERR_MODULE_NOT_FOUND: scripts/security/run-integration-suite.mjs`.
- The workflow contract initially failed all three exact tests because both
  workflow files and the package scripts were absent.
- Runner/workflow focused GREEN:
  `7 tests / 7 pass / 0 fail / 0 skip`.

The runner validates URL, publishable key, service-role key, explicit write
opt-in, exact ref, exact trusted host, and the compiled production denylist
before its first child process. It runs commands in a fixed order and stops at
the first nonzero exit. At this checkpoint the independently verified live
commands are the RLS probe followed by the notification RLS probe; the snapshot
and Realtime commands are intentionally added only after their own safe-target
checkpoints.

### CI design

- `.github/workflows/ci.yml` runs automatically for pull requests and `main`
  updates with Node 24, `npm ci`, frozen pnpm-lock verification, `npm test`,
  typecheck, lint, production build, bundle budgets, and a base-aware
  `git diff --check`.
- Offline CI contains no `secrets.*` reference. Its Supabase values are
  non-secret loopback/build placeholders.
- `.github/workflows/security-integration.yml` is `workflow_dispatch` only,
  uses the protected `scratch` environment, and maps only `SCRATCH_*` secrets.
- The shared compiled denylist remains authoritative if workflow secrets are
  misconfigured.

### Fail-closed live command evidence

`npm run test:security:live` against the currently available local environment
exited `1` before spawning a probe and named these reasons:

- scratch write opt-in absent;
- scratch project ref absent;
- configured ref `szztsqdnvenfbgxtylkl` is KNOWN PRODUCTION.

This is a guard PASS and a live-integration **BLOCKED** result, not a skipped or
successful live test. No network probe was started.

### Offline release-gate evidence

- `npm ci`: PASS; `467` packages installed from the lockfile.
- `npx --yes pnpm@11.10.0 install --frozen-lockfile --lockfile-only`: PASS;
  supply-chain policy accepted.
- `npm test`: `636 tests / 633 pass / 0 fail / 3 skip` in `151271 ms`.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with the unchanged one `no-img-element` warning and
  Next 15.5 deprecation notice.
- `npm run build`: PASS, all routes and 5/5 static pages generated.
- `npm run check:bundle`: PASS, all budgets met.
- `npm run check:diff` and `git diff --check`: PASS.

Checkpoint 4 is closed without an unexplained failure. Offline and credentialed
verification are distinct by both command and workflow trigger.

## Checkpoint 5 — Supabase local configuration and rebuild boundary

Status: **PASS for repository-local safety/support; clean rebuild BLOCKED / UNVERIFIED**

### Exact implementation files changed

- `package.json`
- `package-lock.json`
- `pnpm-lock.yaml`
- `supabase/config.toml` (new)
- `scripts/supabase/run-local-reset.mjs` (new)
- `scripts/supabase/local-config.test.mjs` (new)
- `docs/upgrade/stage-10/HANDOFF.md`

### Implementation and focused regressions

The Supabase CLI is pinned exactly at `2.115.0` in both dependency lockfiles.
The local configuration pins PostgreSQL 17, enables migrations, disables seeds
for rebuild proof, and contains neither a cloud project ref nor credentials.
The reset wrapper first obtains `supabase status -o json`, parses its API URL
with the existing loopback primitive, and refuses any non-loopback target before
running `supabase db reset --local --no-seed`.

RED: the new local-configuration suite initially failed with
`ERR_MODULE_NOT_FOUND` for `scripts/supabase/run-local-reset.mjs`. GREEN:
`scripts/supabase/local-config.test.mjs` reported `4/4`.

Focused command:

```powershell
node --test "supabase/**/*.test.mjs" `
  "scripts/supabase/*.test.mjs" `
  scripts/security/lib/probe-guard.test.mjs
```

Result: `89 tests / 89 pass / 0 fail / 0 skip`.

### Executed rebuild attempt

- `npm ci`: PASS after CLI pin (`475` packages installed).
- frozen pnpm lock verification: PASS.
- `npx supabase --version`: `2.115.0`.
- Docker Desktop engine: available, server `29.1.3`.
- `npm run supabase:start`: **BLOCKED** before database creation. Public ECR
  pulls repeatedly returned EOF / Docker API 500.
- Direct pull of `public.ecr.aws/supabase/postgres-meta:v0.98.0`: reproduced
  Docker API 500.
- `npm run supabase:reset`: refused before reset because the local stack was
  unavailable.

This is a guard PASS and rebuild **BLOCKED / UNVERIFIED**, not a failed
migration and not a rebuild PASS. Read-only project inventory showed production
plus three unrelated/inactive projects; none was approved as scratch. No cloud
project was repurposed and no destructive production action occurred. Full
recovery details are in `RECOVERY_EVIDENCE.md`.

Checkpoint 5 is closed without carrying a test failure. Its unavailable
environment is explicit.

## Checkpoint 6 — authenticated Realtime delivery probe

Status: **PASS for implementation/offline regressions; live socket E2E BLOCKED / UNVERIFIED**

### Exact implementation files changed

- `scripts/security/lib/realtime-delivery.mjs` (new)
- `scripts/security/lib/realtime-delivery.test.mjs` (new)
- `scripts/security/lib/probe-guard.mjs`
- `scripts/security/lib/probe-guard.test.mjs`
- `scripts/security/lib/probe-cleanup.test.mjs`
- `scripts/security/rls-probe.mjs`
- `scripts/security/run-integration-suite.mjs`
- `scripts/verify-notification-rls.mjs`
- `docs/upgrade/stage-10/HANDOFF.md`

### Delivery properties and focused regressions

The helper creates real `@supabase/supabase-js` sockets, sets the user's access
token before subscribing, waits for `SUBSCRIBED`, records INSERT payloads, uses
bounded delivery/non-delivery waits, and always removes the channel and
disconnects. The notification probe now provisions a foreign-tenant auth
principal and opens sockets for recipient A, recipient B, and the foreign user.
Real service-role INSERTs must prove:

- direct A delivery to A;
- no direct-A delivery to B or foreign;
- per-recipient broadcast delivery to A and B;
- no broadcast delivery to foreign.

The existing Stage 9 run ownership, ledger, quiescence, exact-run sweep, late
settlement recovery, and residue verification remain the cleanup boundary.

Focused command result across the Realtime and security lifecycle suites:
`76 tests / 76 pass / 0 fail / 0 skip`.

The first full concurrent suite exposed one new exact failure:

`the documented --sweep --family command executes and preserves bystanders`

The sweep itself succeeded, then Windows exited `3221226505` on a libuv
`UV_HANDLE_CLOSING` assertion because the asynchronous sweep branch called
`process.exit()` while HTTP handles were closing. The narrow fix sets
`process.exitCode` and returns so handles drain; it changes no ownership,
authorization, or recovery semantics. The exact failing test then passed five
consecutive runs. Full repository comparison after the fix:
`645 tests / 642 pass / 0 fail / 3 skip` in `151688 ms`.

`npm run test:security:live` still exited `1` before spawning a command because
the write opt-in and scratch ref were absent and the configured ref was known
production. Therefore real socket/INSERT E2E remains **BLOCKED / UNVERIFIED**;
the offline fake does not substitute for that claim.

Checkpoint 6 is closed with the new failure explained, fixed, and rerun before
rendered QA.

## Checkpoint 7 — rendered security-sensitive QA

Status: **PASS for rendered non-destructive paths; one narrow defect resolved**

### Exact implementation files changed

- `src/services/assistant-onboarding.test.mjs` (new)
- `src/services/onboarding.actions.ts`
- `docs/upgrade/KNOWN_ISSUES.md`
- `docs/upgrade/stage-10/HANDOFF.md`

### Production-build browser evidence

The QA server used Next.js `15.5.21` on loopback. Browser console results were
zero errors for every finalized path.

| Route / role | Result |
|---|---|
| sessionless `/support` | redirected to `/login`; meaningful login UI rendered |
| professor `/professor` | ordinary professor workspace and notification bell rendered |
| assistant `/admin?result=stale` | stale compare-and-set banner and bell rendered |
| authenticated `/support` | form rendered; draft enabled send; draft cleared, not submitted |
| professor course settings | settings UI rendered; no action submitted |
| student `/roadmap` | offering and feedback controls rendered; draft cleared, not saved |
| notification menu | bell expanded for professor/student; mark-read mutation not executed |
| mobile student roadmap, 390x844 | mobile nav/menu usable; `scrollWidth 375 <= innerWidth 390` |

No production form submission, notification INSERT, mark-read, course-setting
write, feedback write, or other database mutation was performed. Login/logout
and the assistant's local HTTP-only workspace cookie were the only state
changes.

Two `refresh_token_not_found` server messages appeared during the initial rapid
multi-account login/logout sequence. They were traced to refresh-token
invalidation races during account switching; pages remained usable and browser
logs were empty. A clean final assistant run and logout produced zero server
messages, so this is recorded as an observed, non-reproduced QA trace rather
than concealed or promoted to a release failure.

### Assistant defect RED/GREEN

Initial assistant onboarding redirected to `/login`. The real action used a
shared helper that required `student`, so it rejected the intended assistant
and allowed a student to set the assistant workspace cookie. RED names:

1. `assistant onboarding accepts the signed assistant and stores only its workspace cookie`
2. `a student session cannot set the assistant workspace cookie`

The helper now accepts an explicit required role and
`saveAssistantOnboarding` requests `assistant`. Focused assistant/onboarding,
privileged-action, tenant, and Server Action group:
`23 tests / 23 pass / 0 fail / 0 skip`; typecheck and build passed. Clean
rendered rerun: assistant login -> onboarding save -> `/admin` -> `/professor`,
with the tenant-scoped assistant workspace visible and no console/server error.
The action wrote only the local cookie, not the database.

Screenshots are outside the repository under
`C:\Users\a\AppData\Local\Temp\pacemate-stage10-browser\`:
`01-sessionless-support.png`, `02-professor-workspace.png`,
`03-admin-stale-cas.png`, `04-mobile-notifications.png`, and
`05-assistant-workspace-fixed.png`.

Checkpoint 7 is closed. The exact new correctness failures were resolved and
verified before the final documentation workstream.

## Final documentation and release gate

Status: **PASS for the repository-local release gate; external live items remain BLOCKED**

Current-state, decisions, known issues, recovery evidence, historical Stage 9
status addendum, named Stage 5-9 regressions, fresh release commands, credential
scan, exact changed-file list, and Git state are recorded below when the final
gate completes. No commit, push, pull request, or merge is part of this work.

### Fresh named Stage 5-9 regression groups

The old Stage 9 summary recorded `48 / 10 / 62 / 36` but did not preserve the
exact commands for all four cohorts. Stage 10 therefore records the exact
re-runnable file cohorts below. Where a current file contains later guards, the
current count is reported instead of forcing the historical number with a test
name filter. No assertion is omitted or weakened to reproduce an old count.

**Stage 5 — `48 / 48 / 0 / 0`**

```powershell
node --test --test-reporter=tap `
  src/lib/counseling-slots.test.mjs `
  src/lib/availability-consistency.test.mjs `
  src/lib/calendar-utils.week.test.mjs `
  src/services/counseling-request-security.test.mjs `
  src/services/counseling.actions.test.mjs `
  src/services/professor.actions.counseling.test.mjs `
  src/components/counseling/counseling-workspace-cancel.test.mjs `
  src/services/counseling.query-count.test.mjs `
  src/services/student-community.query-count.test.mjs `
  src/services/counseling.busy-feed-bounds.test.mjs
```

This exactly matches the established Stage 9 aggregate `48/48`.

**Stage 6 — `11 / 11 / 0 / 0`**

```powershell
node --test --test-reporter=tap `
  src/lib/tenant.test.mjs `
  src/services/tenant-isolation.test.mjs
```

The current two-file cohort has six resolver guards plus five two-tenant action
guards. The historical `10/10` summary did not identify which current resolver
case it omitted; Stage 10 runs all 11 and carries no failure.

**Stage 7 — `62 / 62 / 0 / 0`**

```powershell
node --test --test-reporter=tap `
  src/lib/sso/provider-registry.test.mjs `
  src/lib/sso/sso-login-policy.test.mjs `
  src/lib/sso/mock-idp.test.mjs `
  src/services/sso-callback.test.mjs `
  src/services/sso-wiring.test.mjs `
  src/lib/tenant.test.mjs
```

This exactly matches the established Stage 9 aggregate `62/62`.

**Stage 8 — `40 / 40 / 0 / 0`**

```powershell
node --test --test-reporter=tap `
  scripts/loadtest/lib/safety.test.mjs `
  src/services/ai-tutor.actions.authz.test.mjs `
  src/services/notifications.tenant-scope.test.mjs `
  supabase/migrations/user_notifications_rls.test.mjs
```

The current cohort includes the new compiled-production refusal cases in the
same safety file, so its inventory is larger than the old `36/36` summary. All
authorization, per-recipient update, migration, and target-refusal assertions
run; no old assertion was filtered out.

**Stage 9 — `311 total / 308 pass / 0 fail / 3 skip`**

The command explicitly ran these 27 files:

```text
scripts/script-syntax.test.mjs
scripts/security/lib/probe-cleanup.test.mjs
scripts/security/lib/probe-credentials.test.mjs
scripts/security/lib/probe-guard.test.mjs
scripts/security/lib/probe-http.test.mjs
scripts/security/lib/probe-lifecycle.test.mjs
scripts/security/lib/probe-ownership.test.mjs
scripts/security/lib/probe-read-semantics.test.mjs
scripts/security/probe-subprocess.test.mjs
src/components/notifications/notification-realtime.test.mjs
src/config/demo-credentials.test.mjs
src/lib/observability/request-id-propagation.test.mjs
src/services/ai-tutor.actions.authz.test.mjs
src/services/ai-tutor.exact-enrollment.test.mjs
src/services/counseling.actions.test.mjs
src/services/notification-count-regression.test.mjs
src/services/notification-per-recipient.test.mjs
src/services/notifications.tenant-scope.test.mjs
src/services/notification-tenant-scope.test.mjs
src/services/privileged-action-authorization.test.mjs
src/services/review-role-authorization.test.mjs
src/services/roadmap-transition.test.mjs
src/services/server-action-contract.test.mjs
src/services/support-boundary.test.mjs
src/services/tenant-isolation.test.mjs
supabase/migrations/stage9_rls.test.mjs
supabase/security-snapshot.test.mjs
```

The three skips are exactly the established Windows child-process POSIX signal
delivery cases:

1. `SIGINT triggers cleanup exactly once and the process waits for it`
2. `SIGTERM triggers cleanup exactly once and the process waits for it`
3. `a repeated signal does not start a second destructive cleanup pass`

The handlers themselves remain exercised platform-independently by the
lifecycle and IPC-cancel tests. There is no new failure in any previous-stage
cohort.

### Fresh final release gate

Executed after all production-code and test changes:

| Command | Result |
|---|---|
| `npm test` | **647 total / 644 pass / 0 fail / 3 skip**, `151622 ms` |
| `npm run typecheck` | PASS, exit 0 |
| `npm run lint` | PASS, exit 0; one established `no-img-element` warning plus documented `next lint` deprecation |
| `npm run build` | PASS on Next.js `15.5.21`; compiled, typechecked, and generated 5/5 static pages |
| `npm run check:bundle` | PASS; all route/shared budgets met, build id `6QfWU2rDRzlg9I47pwlpn` |
| `npx --yes pnpm@11.10.0 install --frozen-lockfile --lockfile-only` | PASS; lockfile and supply-chain policy accepted |
| `npm audit --audit-level=critical` | exit 0; **0 critical / 6 high** residual advisories |
| `git diff --check` plus untracked-file trailing-whitespace scan | PASS; `0` whitespace hits |

The audit still reports high-severity paths through `brace-expansion`,
`js-yaml`, `nanoid`, `postcss`, and `sharp`. The offered complete remediation
forces Next.js `16.3.2`, outside the approved patch-only framework checkpoint.
No forced major upgrade or test/security weakening was used to hide this risk.

Baseline comparison:

- initial merged-main baseline: `628 / 622 / 3 / 3`;
- after KI-002 correction: `628 / 625 / 0 / 3`;
- final: `647 / 644 / 0 / 3`.

Stage 10 adds 19 tests and resolves the three stale baseline failures, producing
22 additional passes with the same three environment-specific skips. The final
gate has no failing test name. The only new failure encountered after a closed
checkpoint was
`the documented --sweep --family command executes and preserves bystanders`;
Checkpoint 6 records its exact Windows handle-drain root cause, fix, five-repeat
focused result, and later full-suite passes.

### Credential and scope scan

The exact 33-file change set contains:

- `0` changed `.env*` files;
- `0` JWT-shaped values;
- `0` vendor-secret-shaped values (`sb_secret_`, `sk-`, GitHub-token forms);
- `0` long service-role/publishable/API key assignments;
- `0` `.superpowers/` paths in the diff.

The unrelated untracked `.superpowers/` directory is still present and
untouched. Variable names and GitHub secret references in the protected live
workflow are not credential values.

### Exact final changed-file inventory

```text
.github/workflows/ci.yml
.github/workflows/security-integration.yml
docs/upgrade/CURRENT_STAGE.md
docs/upgrade/DECISIONS.md
docs/upgrade/KNOWN_ISSUES.md
docs/upgrade/stage-09/HANDOFF.md
docs/upgrade/stage-10/HANDOFF.md
docs/upgrade/stage-10/IMPLEMENTATION_PLAN.md
docs/upgrade/stage-10/RECOVERY_EVIDENCE.md
docs/upgrade/stage-10/SPEC.md
package.json
package-lock.json
pnpm-lock.yaml
scripts/ci/workflows.test.mjs
scripts/loadtest/lib/safety.mjs
scripts/loadtest/lib/safety.test.mjs
scripts/security/lib/probe-cleanup.test.mjs
scripts/security/lib/probe-guard.mjs
scripts/security/lib/probe-guard.test.mjs
scripts/security/lib/production-targets.mjs
scripts/security/lib/realtime-delivery.mjs
scripts/security/lib/realtime-delivery.test.mjs
scripts/security/rls-probe.mjs
scripts/security/run-integration-suite.mjs
scripts/security/run-integration-suite.test.mjs
scripts/supabase/local-config.test.mjs
scripts/supabase/run-local-reset.mjs
scripts/verify-notification-rls.mjs
src/services/admin-notifications.test.mjs
src/services/assistant-onboarding.test.mjs
src/services/onboarding.actions.ts
src/services/question-notice-workflow.test.mjs
supabase/config.toml
```

### Final capability classification

- Repository-local implementation, offline CI, compiled production refusal,
  focused regressions, full tests, static gates, production build, budgets,
  lockfiles, rendered non-destructive QA, and secret scan: **PASS**.
- Empty-database migration rebuild: **BLOCKED / UNVERIFIED** by Docker public
  ECR pull failures before database creation.
- Credentialed RLS and real Realtime socket/INSERT run: **BLOCKED /
  UNVERIFIED** because there is no approved scratch project/credential set;
  the runner refuses production before spawn.
- Restore drill and RPO/RTO: **BLOCKED / UNVERIFIED** because production
  metadata shows PITR off and zero listed backups, with no disposable target.
- Notification mark-read browser mutation: **UNVERIFIED in Stage 10** because
  production mutation was intentionally not used as UI evidence; action/RLS
  coverage remains green offline.

No production reset, rebuild, restore, recovery, fixture, load, notification,
course-setting, roadmap-feedback, or support mutation occurred. No commit,
push, pull request, or merge was created. Work stopped on
`upgrade/stage-10` with the change set unstaged for owner review.
