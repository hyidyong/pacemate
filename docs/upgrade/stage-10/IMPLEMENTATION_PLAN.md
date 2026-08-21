# Stage 10 Implementation Plan

Execution status (2026-08-21): Tasks 1-7 have been executed and independently
verified. Repository-local support and the final offline gate pass. The local
clean rebuild and credentialed Realtime run are BLOCKED by the exact external
conditions recorded in `HANDOFF.md`; they are not treated as passes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan checkpoint by
> checkpoint. Do not dispatch subagents for this execution. Commit steps are
> intentionally omitted because the owner explicitly prohibited commits,
> pushes, pull requests, and merges during Stage 10 execution.

**Goal:** Establish independently verified release-readiness checkpoints for
the Next.js patch, offline CI, disposable Supabase rebuild/security testing,
Realtime delivery, rendered QA, and operational handoff.

**Architecture:** Repository-local gates are deterministic and secret-free.
Credentialed integration is a separate, explicitly invoked path protected by a
compiled production denylist and exact target confirmation. Every checkpoint
closes with its own evidence record before another checkpoint may modify files.

**Tech Stack:** Next.js 15.5 App Router, React 19, TypeScript, Node test runner,
GitHub Actions, Supabase CLI/Postgres/Auth/Realtime, Supabase JavaScript client.

**Spec:** `docs/upgrade/stage-10/SPEC.md`

## Global Constraints

- Work only on `upgrade/stage-10` based at
  `8e178a676c89106497747eda54ac17d0f479af7f`.
- Never destructively test production Supabase project
  `szztsqdnvenfbgxtylkl`.
- Never touch or include `.superpowers/`.
- Never weaken RLS, security guards, migration postconditions, or tests.
- Keep offline CI separate from credentialed integration/security execution.
- Record exact files, commands, counts, and failure names at every checkpoint.
- Stop on an unexplained failure; do not carry it into the next checkpoint.
- Do not commit, push, create a pull request, or merge.

---

### Task 1: Next.js 15.5.21 checkpoint

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/upgrade/stage-10/HANDOFF.md`

**Interfaces:**

- Consumes: merged Stage 9 code and the `628 / 622 / 3 / 3` Node 24 baseline.
- Produces: Next.js and `eslint-config-next` resolved at exactly `15.5.21`,
  with React/React DOM still resolved at `19.2.7`, plus isolated checkpoint
  evidence.

- [ ] **Step 1: Inspect official patch implications**

  Read the official Next.js 15.5 release/migration/security material and compare
  it with `next.config.mjs`, `src/middleware.ts`, force-dynamic App Router pages,
  Server Action modules, and `revalidatePath` call sites. Record only
  implications that apply to this repository in the Stage 10 handoff.

- [ ] **Step 2: Capture the exact pre-upgrade dependency state**

  Run:

  ```powershell
  npm ls next react react-dom eslint-config-next --depth=0
  git status --short --branch
  ```

  Expected: Next and ESLint config `15.5.20`, React/React DOM `19.2.7`, only
  `.superpowers/` untracked besides the approved Stage 10 docs.

- [ ] **Step 3: Upgrade the aligned framework packages only**

  Run:

  ```powershell
  npm install --save-exact next@15.5.21
  npm install --save-dev --save-exact eslint-config-next@15.5.21
  pnpm install --lockfile-only
  ```

  The resulting `package.json` entries are:

  ```json
  {
    "dependencies": {
      "next": "15.5.21"
    },
    "devDependencies": {
      "eslint-config-next": "15.5.21"
    }
  }
  ```

  Do not change any other dependency intentionally.

- [ ] **Step 4: Verify package alignment and lockfile reproducibility**

  Run:

  ```powershell
  npm ls next react react-dom eslint-config-next --depth=0
  npm ci
  pnpm install --frozen-lockfile --lockfile-only
  ```

  Expected: exact framework patch versions, unchanged React versions, both
  lockfiles accepted without mutation.

- [ ] **Step 5: Run focused framework-sensitive regressions**

  Run:

  ```powershell
  node --test `
    src/app/professor/professor-page-hydration.test.mjs `
    src/services/server-action-contract.test.mjs `
    src/services/support-boundary.test.mjs `
    src/services/roadmap-transition.test.mjs `
    src/components/notifications/notification-realtime.test.mjs `
    src/lib/auth/demo-session.test.mjs `
    src/lib/sso/*.test.mjs `
    src/services/sso-*.test.mjs `
    src/lib/supabase/fetch-timeout*.test.mjs
  ```

  Every focused test must pass; any new exact failure name stops this task.

- [ ] **Step 6: Run the independent full framework checkpoint**

  Run:

  ```powershell
  node --test "src/**/*.test.mjs" "scripts/**/*.test.mjs" "supabase/**/*.test.mjs"
  npm run typecheck
  npm run lint
  npm run build
  node scripts/check-bundle-budgets.mjs
  git diff --check
  ```

  Compare with `628 / 622 / 3 / 3`. Only the three exact KI-002 names and three
  Windows POSIX-delivery skips may remain. Record routes, build status, lint
  warnings, and bundle-budget output.

- [ ] **Step 7: Record and close Checkpoint 1**

  Create `docs/upgrade/stage-10/HANDOFF.md` with a Checkpoint 1 section listing
  exactly `package.json`, `package-lock.json`, and `pnpm-lock.yaml` as the
  implementation files, plus the documentation files. Do not start Task 2
  until no unexplained failure remains.

---

### Task 2: Replace KI-002 with behavior-level coverage

**Files:**

- Modify: `src/services/admin-notifications.test.mjs`
- Modify: `src/services/question-notice-workflow.test.mjs`
- Modify: `docs/upgrade/KNOWN_ISSUES.md`
- Modify: `docs/upgrade/stage-10/HANDOFF.md`

**Interfaces:**

- Consumes: the three reproduced KI-002 failure names and the stronger Stage 9
  notification/RLS/action tests.
- Produces: focused assertions for current security behavior rather than stale
  implementation strings; the new offline baseline has zero failures.

- [ ] **Step 1: Reproduce the three failures alone**

  Run:

  ```powershell
  node --test src/services/admin-notifications.test.mjs src/services/question-notice-workflow.test.mjs
  ```

  Expected RED names:

  ```text
  admin broadcasts fan out only to student and professor recipients
  broadcast UI is in-app, recipient-scoped, and newest first
  AI escalation persists a user chat message and exposes its id to the handoff action
  ```

- [ ] **Step 2: Replace the stale fan-out assertion**

  Assert the current per-recipient invariant rather than the historical local
  variable name:

  ```js
  assert.match(action, /recipientsToInsert\.map\(\(recipient\) => \(\{[\s\S]*?recipient_id: recipient\.id/);
  assert.match(action, /recipient_role: recipient\.role/);
  assert.match(action, /school_id: tenantId/);
  ```

  Keep the role allowlist, target group, and unread assertions.

- [ ] **Step 3: Replace the obsolete client-filter assertion**

  The old assertion requires the exact filter that Stage 9 intentionally
  removed. Assert the stronger design:

  ```js
  assert.match(menu, /\{ event: "INSERT", schema: "public", table: "user_notifications" \}/);
  assert.doesNotMatch(menu, /filter:\s*`recipient_id=eq\./);
  assert.match(menu, /if \(recipientId !== profileId\) return;/);
  ```

  This keeps RLS as the boundary and freezes the exact recipient defence in
  depth.

- [ ] **Step 4: Replace the stale AI escalation source assertion**

  Confirm the current server action delegates persistence through the approved
  question-workflow boundary, and keep id handoff assertions:

  ```js
  assert.match(tutorSource, /createProfessorQuestionRecord/);
  assert.match(tutorSource, /sourceMessageId/);
  assert.match(questionSource, /sourceKind: "tutor"/);
  assert.match(questionSource, /sourceMessageId/);
  ```

  If `ai-tutor.actions.ts` no longer owns `sourceMessageId`, first trace the real
  current call path and assert the same property at the module that does. Do not
  assert a string merely because it exists in a comment.

- [ ] **Step 5: Run focused GREEN and related security suites**

  Run:

  ```powershell
  node --test `
    src/services/admin-notifications.test.mjs `
    src/services/question-notice-workflow.test.mjs `
    src/services/notification-per-recipient.test.mjs `
    src/services/notification-tenant-scope.test.mjs `
    src/components/notifications/notification-realtime.test.mjs `
    src/services/ai-tutor.actions.authz.test.mjs `
    src/services/server-action-contract.test.mjs
  ```

  Expected: all pass, with each edited assertion demonstrably able to fail when
  its protected behavior is removed.

- [ ] **Step 6: Establish the new full-suite baseline**

  Run the complete offline suite and `git diff --check`. Expected: the same
  total test inventory or higher, zero failures, and the same three explicit
  Windows skips. Update KI-002 to `RESOLVED IN STAGE 10` with the RED/GREEN
  names and counts.

---

### Task 3: Add the test entrypoint and secret-free offline CI

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `pnpm-lock.yaml`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/security-integration.yml`
- Create: `scripts/security/run-integration-suite.mjs`
- Create: `scripts/security/run-integration-suite.test.mjs`
- Modify: `docs/upgrade/stage-10/HANDOFF.md`

**Interfaces:**

- Consumes: a zero-failure offline suite and existing Stage 9 probes.
- Produces: `npm test` for all offline tests, `npm run test:security:live` for
  explicit credentialed checks, a required secret-free CI workflow, and a
  separate manual credentialed workflow.

- [ ] **Step 1: Write the failing integration-runner tests**

  Cover the exact command order and environment refusal:

  ```js
  test("credentialed integration fails before spawning when required env is absent", async () => {
    const result = validateIntegrationEnv({});
    assert.equal(result.ok, false);
    assert.match(result.message, /NEXT_PUBLIC_SUPABASE_URL/);
  });

  test("credentialed integration refuses the compiled production ref", async () => {
    const result = validateIntegrationEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://szztsqdnvenfbgxtylkl.supabase.co",
      PACEMATE_SECURITY_PROBE_PROJECT_REF: "szztsqdnvenfbgxtylkl",
      PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test",
      SUPABASE_SERVICE_ROLE_KEY: "test",
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /KNOWN PRODUCTION/);
  });
  ```

  Run the new test and verify RED because the runner does not exist.

- [ ] **Step 2: Implement the fail-closed runner**

  Export `validateIntegrationEnv(env)` and run these subprocesses sequentially,
  stopping at the first nonzero exit:

  ```js
  const commands = [
    ["node", ["scripts/security/dump-security-snapshot.mjs", "--check"]],
    ["node", ["scripts/security/rls-probe.mjs"]],
    ["node", ["scripts/verify-notification-rls.mjs"]],
    ["node", ["scripts/security/realtime-notification-probe.mjs"]],
  ];
  ```

  The validator requires URL, publishable key, service key, write opt-in, and
  exact project ref, and imports the same compiled production denylist used by
  the probes. Missing environment is failure, never skip.

- [ ] **Step 3: Add package scripts**

  Add:

  ```json
  {
    "scripts": {
      "test": "node --test \"src/**/*.test.mjs\" \"scripts/**/*.test.mjs\" \"supabase/**/*.test.mjs\"",
      "test:offline": "npm test",
      "test:security:live": "node scripts/security/run-integration-suite.mjs",
      "check:bundle": "node scripts/check-bundle-budgets.mjs",
      "check:release": "npm test && npm run typecheck && npm run lint && npm run build && npm run check:bundle"
    }
  }
  ```

- [ ] **Step 4: Add offline GitHub Actions CI**

  `.github/workflows/ci.yml` uses Node 24, `npm ci`, a frozen pnpm-lock check,
  then `npm test`, typecheck, lint, build, bundle budgets, and a base-aware
  whitespace diff. Build-only environment values are loopback placeholders,
  never production values or repository secrets.

  The workflow must not reference GitHub secrets.

- [ ] **Step 5: Add the separate credentialed workflow**

  `.github/workflows/security-integration.yml` is `workflow_dispatch` only,
  uses a protected `scratch` environment, and maps only scratch-scoped secrets
  into `npm run test:security:live`. It states in its name and comments that the
  target must be disposable. The compiled production denylist remains the final
  guard even if secrets are misconfigured.

- [ ] **Step 6: Verify Checkpoint 2/CI independently**

  Run:

  ```powershell
  npm test
  npm run typecheck
  npm run lint
  npm run build
  npm run check:bundle
  pnpm install --frozen-lockfile --lockfile-only
  node scripts/security/run-integration-suite.mjs
  git diff --check
  ```

  The integration command is expected to fail clearly when scratch variables
  are absent; that is a PASS for the fail-closed guard, not a skipped live test.
  Record exact counts and files before proceeding.

---

### Task 4: Harden probe targets and add Supabase local configuration

**Files:**

- Modify: `scripts/security/lib/probe-guard.mjs`
- Modify: `scripts/security/lib/probe-guard.test.mjs`
- Create: `supabase/config.toml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/upgrade/stage-09/RECOVERY_RUNBOOK.md`
- Modify: `docs/upgrade/stage-10/HANDOFF.md`

**Interfaces:**

- Consumes: Stage 8's compiled production denylist and Stage 9 exact-host guard.
- Produces: a security-probe guard that cannot target production, pinned
  Supabase CLI `2.115.0`, and reproducible local reset commands.

- [ ] **Step 1: Add RED production-ref probe tests**

  Add cases proving that all explicit opt-ins still cannot authorize the known
  production ref, while loopback and a different exact Supabase ref remain
  eligible:

  ```js
  test("the production project is refused even with every write opt-in", () => {
    const verdict = evaluateProbeGuard(fullyOptedInProductionEnv, productionUrl);
    assert.equal(verdict.allowed, false);
    assert.match(verdict.problems.join("\n"), /KNOWN PRODUCTION/);
  });
  ```

  Run and observe RED against the current guard.

- [ ] **Step 2: Share the compiled production denylist**

  Move or re-export `KNOWN_PRODUCTION_PROJECT_REFS` from one dependency-free
  safety module and make both load-test and security-probe guards consume it.
  In `evaluateProbeGuard`, add the problem before any network client is created:

  ```js
  if (actualRef && KNOWN_PRODUCTION_PROJECT_REFS.has(actualRef)) {
    problems.push(`project "${actualRef}" is a KNOWN PRODUCTION project and cannot be probed`);
  }
  ```

  Re-run both load-test safety and probe-guard suites.

- [ ] **Step 3: Pin the Supabase CLI**

  Run:

  ```powershell
  npm install --save-dev --save-exact supabase@2.115.0
  pnpm install --lockfile-only
  npx supabase --version
  ```

  Expected: `2.115.0` and synchronized lockfiles.

- [ ] **Step 4: Generate and review local configuration**

  Run `npx supabase init` only if `supabase/config.toml` does not exist. Keep the
  generated schema/auth/storage defaults, use local ports, and set:

  ```toml
  project_id = "pacemate-stage-10-local"

  [db.seed]
  enabled = false
  sql_paths = ["./seed/*.sql"]
  ```

  Seed files are catalog/demo fixtures and are deliberately not part of the
  clean migration-chain proof. Add package scripts:

  ```json
  {
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop",
    "supabase:reset": "supabase db reset --local --no-seed"
  }
  ```

- [ ] **Step 5: Attempt the local clean rebuild safely**

  Start Docker Desktop if available, then run:

  ```powershell
  npm run supabase:start
  npm run supabase:reset
  npm test -- --test-name-pattern="migration|snapshot|RLS|security"
  ```

  Confirm the resolved target is loopback before reset. If the Docker engine or
  required image download remains unavailable, record repository support as
  `UNVERIFIED` and execution as `BLOCKED — local Docker engine unavailable`.
  Never relink the working directory to production for this task.

- [ ] **Step 6: Inspect available cloud projects read-only**

  Run `npx supabase projects list` without creating or deleting a project. If an
  existing project is clearly designated scratch/non-production and its
  credentials are available, verify its ref is not in the production denylist.
  Otherwise record cloud execution as `BLOCKED — no approved scratch project
  and/or credentials`. Project creation is not performed silently.

- [ ] **Step 7: Close the checkpoint**

  Run the full offline suite, typecheck, lint, build, bundle budget, both safety
  suites, frozen-lock checks, and `git diff --check`. Record clean-rebuild
  execution separately from implemented support.

---

### Task 5: Add a real Realtime notification probe

**Files:**

- Create: `scripts/security/realtime-notification-probe.mjs`
- Create: `scripts/security/realtime-notification-probe.test.mjs`
- Modify: `scripts/security/run-integration-suite.mjs`
- Modify: `docs/upgrade/stage-10/HANDOFF.md`

**Interfaces:**

- Consumes: `assertSafeToProbe`, `createProbeLifecycle`, `ProbeLedger`,
  `provisionProbeTenants`, per-run credentials, and the same Supabase JavaScript
  client used by the application.
- Produces: a real socket/real INSERT proof with direct, broadcast, wrong-user,
  and wrong-tenant outcomes, plus exact-run cleanup.

- [ ] **Step 1: Write RED unit/contract tests**

  With injected channel clients and insertion functions, require:

  ```text
  authenticate -> subscribe -> SUBSCRIBED -> insert -> wait for exact id
  ```

  Add tests that fail when subscription occurs before `setAuth`, when a generic
  payload counts instead of the exact inserted id, when a negative observer is
  absent, or when cleanup failure does not fail the process.

- [ ] **Step 2: Implement the probe on the Stage 9 harness**

  Provision tenants A and B with `provisionProbeTenants`. Sign in the intended
  A student, A professor (wrong same-tenant user), and B student (wrong tenant).
  Create authenticated Realtime clients, call `realtime.setAuth(token)`, and
  wait for each channel's `SUBSCRIBED` status before inserting.

  Insert two controlled rows through the service-role REST client and record
  both immediately in the caller-owned ledger:

  ```js
  const direct = {
    recipient_id: A.profile.id,
    recipient_role: null,
    school_id: A.school.id,
    target_group: "ALL",
    category: "system",
    title: `${runMarker} realtime direct`,
    body: `${runMarker} realtime direct body`,
    target_href: "/notifications",
  };

  const broadcastCopy = {
    ...direct,
    recipient_role: "student",
    target_group: "STUDENT",
    title: `${runMarker} realtime broadcast`,
  };
  ```

  Positive observers must receive the exact inserted ids. Wrong-user and
  wrong-tenant observers must remain silent for a bounded window after positive
  delivery. RLS, not client filtering, determines the server payload.

- [ ] **Step 3: Make cleanup and channel teardown fatal**

  Unsubscribe/remove every channel, then run the existing quiesce, ledger,
  exact-marker sweep, and residue verification. A subscription error, timeout,
  unexpected negative delivery, cleanup failure, or unverifiable residue exits
  nonzero and prints the exact run marker/recovery command.

- [ ] **Step 4: Verify offline and, if available, live**

  Run the new unit suite and all Stage 9 harness tests. If an approved scratch
  environment exists, run the real probe followed by a residue check. If not,
  report `UNVERIFIED — real socket/INSERT not executed` and `BLOCKED — scratch
  environment/credentials unavailable`; do not substitute a fake PASS.

- [ ] **Step 5: Close the checkpoint**

  Run the full offline suite, typecheck, lint, build, bundle budgets, and
  `git diff --check`. Record exact counts and any live outcomes before rendered
  QA begins.

---

### Task 6: Rendered QA and recovery evidence

**Files:**

- Modify only if a newly reproduced Stage 10 correctness/security defect needs
  a narrow fix; otherwise documentation-only.
- Modify: `docs/upgrade/stage-10/HANDOFF.md`
- Modify: `docs/upgrade/KNOWN_ISSUES.md`

**Interfaces:**

- Consumes: a production build from the verified prior checkpoint and available
  non-production/browser credentials.
- Produces: rendered results with console/server observations and read-only
  recovery capability evidence.

- [ ] **Step 1: Start the production server without changing data**

  Run `npm run build`, then `npm start` on a free local port. Capture server
  logs during QA.

- [ ] **Step 2: Run sessionless and role-specific rendered checks**

  In a real browser, verify `/support` sessionless refusal, then use the existing
  gated QA login only when credentials are already configured. Inspect
  `/admin?result=stale`, assistant and professor `/professor`, roadmap feedback,
  professor course settings, notifications, dashboard, counseling, and roadmap.

  Do not manufacture privileged credentials or disclose values. Do not perform
  destructive data mutation on production. Any legitimate UI mutation used for
  QA must have an exact owned identifier and immediate residue verification.

- [ ] **Step 3: Verify the notification menu**

  Confirm mark-read behavior and console cleanliness. Visible real-time toast
  delivery is `PASS` only if the browser is connected to the approved scratch
  environment and the exact controlled notification appears. Otherwise report
  the rendered menu separately from Realtime E2E.

- [ ] **Step 4: Inspect recovery capability read-only**

  Use available Supabase management tooling to read PITR/backup metadata. A
  restore drill runs only with an actual backup and approved disposable target.
  Record `pitr_enabled`, backup count, and exact blockers. Do not state RPO/RTO
  without a measured restore.

- [ ] **Step 5: Classify any defect before changing code**

  Reproduce, name the root cause, add a failing regression, implement the
  narrow fix, and rerun the affected prior checkpoint. A significant new scope
  change requires owner review; routine narrow Stage 10 fixes do not.

- [ ] **Step 6: Close the checkpoint**

  Record every rendered route, role, result, console/server error count,
  mutation/residue outcome, recovery result, and unavailable environment.

---

### Task 7: Final documentation and completion gate

**Files:**

- Modify: `docs/upgrade/CURRENT_STAGE.md`
- Modify: `docs/upgrade/DECISIONS.md`
- Modify: `docs/upgrade/KNOWN_ISSUES.md`
- Modify: `docs/upgrade/stage-09/HANDOFF.md` only for a clearly marked post-merge
  status addendum if needed
- Modify: `docs/upgrade/stage-10/SPEC.md`
- Modify: `docs/upgrade/stage-10/IMPLEMENTATION_PLAN.md`
- Modify: `docs/upgrade/stage-10/HANDOFF.md`

**Interfaces:**

- Consumes: all closed checkpoint evidence.
- Produces: the final Stage 10 evidence package without a completion claim for
  anything blocked or unverified.

- [ ] **Step 1: Reconcile status language**

  Mark Stage 9 merged/complete in current-state documentation and Stage 10 as
  current. Preserve historical review-round text. Use only `PASS`, `FAIL`,
  `BLOCKED`, `UNVERIFIED`, or `DEFERRED` with exact evidence/reason.

- [ ] **Step 2: Record decisions and remaining issues**

  Add durable decisions for offline-vs-credentialed CI and compiled
  production-target refusal. Resolve KI-002 only with its RED/GREEN evidence.
  Carry Realtime/rebuild/recovery items with the status actually achieved.

- [ ] **Step 3: Run named Stage 5–9 regression groups**

  Select the same test files documented by prior stages, record each file list
  in the handoff, and run them as separate Node test commands. Report exact
  totals for Stage 5, 6, 7, 8, and 9; do not infer group counts from the full
  suite.

- [ ] **Step 4: Run the final release gate**

  Run:

  ```powershell
  npm test
  npm run typecheck
  npm run lint
  npm run build
  npm run check:bundle
  pnpm install --frozen-lockfile --lockfile-only
  git diff --check
  git status --short --branch
  ```

  Then scan tracked changes for credential-shaped values and confirm
  `.superpowers/` is absent from the diff.

- [ ] **Step 5: Produce the evidence package and stop**

  List every changed file by checkpoint, every command and exact count, all
  named failures/skips, clean-rebuild and Realtime outcomes, rendered QA,
  recovery limits, new-vs-baseline classification, remaining risk, final Git
  state, and confirmation that no commit/push/PR/merge occurred.
