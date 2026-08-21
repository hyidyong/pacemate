import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { isLoopbackUrl } from "../security/lib/probe-guard.mjs";

const cliExecutable = process.platform === "win32" ? "npx.cmd" : "npx";

export function runLocalReset({ spawn = spawnSync, cwd = process.cwd() } = {}) {
  const status = spawn(cliExecutable, ["supabase", "status", "-o", "json"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (status.status !== 0) {
    return {
      ok: false,
      message: "local Supabase is unavailable; start the loopback stack before reset",
    };
  }

  let apiUrl;
  try {
    const parsed = JSON.parse(status.stdout);
    apiUrl = parsed.API_URL ?? parsed.api?.url;
  } catch {
    return { ok: false, message: "local Supabase status did not return valid JSON" };
  }

  if (!isLoopbackUrl(apiUrl)) {
    return {
      ok: false,
      message: `Supabase status target is not loopback; reset refused (${apiUrl ?? "missing URL"})`,
    };
  }

  const reset = spawn(cliExecutable, ["supabase", "db", "reset", "--local", "--no-seed"], {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (reset.status !== 0) {
    return { ok: false, message: `local Supabase reset failed with exit code ${reset.status}` };
  }

  return { ok: true, target: apiUrl };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  const result = runLocalReset();
  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
  } else {
    console.log(`local Supabase reset completed against ${result.target}`);
  }
}
