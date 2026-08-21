import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvLocal } from "../loadtest/lib/env.mjs";
import { evaluateProbeGuard } from "./lib/probe-guard.mjs";

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PACEMATE_SECURITY_PROBE_ALLOW_WRITES",
  "PACEMATE_SECURITY_PROBE_PROJECT_REF",
];

// Realtime delivery runs inside verify-notification-rls after the direct RLS
// probe. Live snapshot drift remains a separate read-only operator check until
// it has a scratch-target workflow contract of its own. Every mutating command
// here already uses the shared probe guard.
export const INTEGRATION_COMMANDS = [
  ["scripts/security/rls-probe.mjs"],
  ["scripts/verify-notification-rls.mjs"],
];

export function validateIntegrationEnv(env) {
  const problems = [];
  for (const key of REQUIRED_ENV) {
    if (typeof env[key] !== "string" || !env[key].trim()) {
      problems.push(`missing required scratch integration value: ${key}`);
    }
  }

  const rawUrl = typeof env.NEXT_PUBLIC_SUPABASE_URL === "string"
    ? env.NEXT_PUBLIC_SUPABASE_URL.trim()
    : "";
  if (rawUrl) {
    const guard = evaluateProbeGuard(env, rawUrl);
    problems.push(...guard.problems);
  }

  return problems.length
    ? {
        ok: false,
        message: [
          "Refusing to run credentialed Supabase integration.",
          "The target must be an explicitly confirmed scratch/non-production project.",
          ...problems.map((problem) => `  - ${problem}`),
        ].join("\n"),
      }
    : { ok: true };
}

export function runIntegrationSuite({
  env,
  spawn = spawnSync,
  cwd = process.cwd(),
} = {}) {
  const validation = validateIntegrationEnv(env ?? {});
  if (!validation.ok) return validation;

  let completed = 0;
  for (const args of INTEGRATION_COMMANDS) {
    const result = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    if (result.status !== 0) {
      return {
        ok: false,
        failedScript: args[0],
        message: `credentialed integration stopped: ${args[0]} exited ${result.status ?? "without a status"}`,
      };
    }
    completed += 1;
  }

  return { ok: true, completed };
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  const env = { ...loadEnvLocal(), ...process.env };
  const result = runIntegrationSuite({ env });
  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
  } else {
    console.log(`Credentialed scratch integration passed (${result.completed} commands).`);
  }
}
