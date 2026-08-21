import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runLocalReset } from "./run-local-reset.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("local Supabase config uses Postgres 17 and excludes catalog/demo seeds from rebuild proof", () => {
  const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");
  assert.match(config, /^project_id = "pacemate-stage-10-local"/m);
  assert.match(config, /\[db\][\s\S]*?major_version = 17/);
  assert.match(config, /\[db\.migrations\][\s\S]*?enabled = true/);
  assert.match(config, /\[db\.seed\][\s\S]*?enabled = false/);
  assert.match(config, /sql_paths = \["\.\/seed\/\*\.sql"\]/);
  assert.doesNotMatch(config, /szztsqdnvenfbgxtylkl/, "local config must not name production");
});

test("the reset wrapper confirms a loopback API before invoking the explicit local reset", () => {
  const calls = [];
  const result = runLocalReset({
    spawn: (executable, args) => {
      calls.push([executable, args]);
      if (calls.length === 1) {
        return { status: 0, stdout: JSON.stringify({ API_URL: "http://127.0.0.1:54321" }) };
      }
      return { status: 0, stdout: "reset complete" };
    },
    cwd: root,
  });

  assert.deepEqual(result, { ok: true, target: "http://127.0.0.1:54321" });
  assert.deepEqual(calls.map(([, args]) => args), [
    ["supabase", "status", "-o", "json"],
    ["supabase", "db", "reset", "--local", "--no-seed"],
  ]);
});

test("the reset wrapper refuses a non-loopback status before reset", () => {
  const calls = [];
  const result = runLocalReset({
    spawn: (_executable, args) => {
      calls.push(args);
      return { status: 0, stdout: JSON.stringify({ API_URL: "https://stagingref000000.supabase.co" }) };
    },
    cwd: root,
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /not loopback/);
  assert.equal(calls.length, 1, "a remote status must never reach db reset");
});

test("package scripts expose only explicit local lifecycle commands", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["supabase:start"], "supabase start");
  assert.equal(pkg.scripts["supabase:stop"], "supabase stop");
  assert.equal(pkg.scripts["supabase:reset"], "node scripts/supabase/run-local-reset.mjs");
});
