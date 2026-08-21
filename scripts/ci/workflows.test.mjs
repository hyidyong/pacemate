import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

test("the workflow YAML parser is a declared direct dev dependency", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.ok(
    Object.hasOwn(pkg.devDependencies ?? {}, "js-yaml"),
    "workflow tests must not rely on ESLint's transitive js-yaml dependency",
  );
});

test("offline CI is secret-free and runs every release gate", () => {
  const source = read(".github", "workflows", "ci.yml");
  const workflow = yaml.load(source);
  const runs = workflow.jobs.offline.steps.flatMap((step) => step.run ? [step.run] : []);

  assert.equal(workflow.jobs.offline["runs-on"], "ubuntu-latest");
  assert.match(source, /node-version:\s*24/);
  assert.doesNotMatch(source, /secrets\./, "offline CI must not receive repository secrets");
  for (const command of [
    "npm ci",
    "npm test",
    "npm run typecheck",
    "npm run lint",
    "npm run build",
    "npm run check:bundle",
  ]) {
    assert.ok(runs.some((run) => run.includes(command)), `offline CI is missing ${command}`);
  }
  assert.ok(runs.some((run) => run.includes("pnpm@11.10.0") && run.includes("--frozen-lockfile")));
  assert.ok(runs.some((run) => run.includes("git diff --check")));
});

test("credentialed security CI is manual, scratch-scoped, and separate", () => {
  const source = read(".github", "workflows", "security-integration.yml");
  const workflow = yaml.load(source);
  const triggers = Object.keys(workflow.on ?? {});
  const job = workflow.jobs.scratch_security;
  const runs = job.steps.flatMap((step) => step.run ? [step.run] : []);

  assert.deepEqual(triggers, ["workflow_dispatch"]);
  assert.equal(job.environment, "scratch");
  assert.ok(runs.some((run) => run.includes("npm run test:security:live")));
  assert.match(source, /secrets\.SCRATCH_SUPABASE_URL/);
  assert.match(source, /secrets\.SCRATCH_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(source, /secrets\.SCRATCH_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /secrets\.SCRATCH_SUPABASE_PROJECT_REF/);
  assert.doesNotMatch(source, /pull_request|push:/, "credentialed checks must never run implicitly");
});

test("package scripts expose one offline entrypoint and one credentialed entrypoint", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(
    pkg.scripts.test,
    'node --test "src/**/*.test.mjs" "scripts/**/*.test.mjs" "supabase/**/*.test.mjs"',
  );
  assert.equal(pkg.scripts["test:offline"], "npm test");
  assert.equal(pkg.scripts["test:security:live"], "node scripts/security/run-integration-suite.mjs");
  assert.match(pkg.scripts["check:release"], /npm test/);
  assert.match(pkg.scripts["check:release"], /npm run build/);
});
