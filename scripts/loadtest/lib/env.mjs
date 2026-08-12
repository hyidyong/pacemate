import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env.local reader — the repo has no dotenv dependency and Stage 8
// must not add one. Only KEY=VALUE lines are honoured; quotes are stripped.
export function loadEnvLocal(root = process.cwd()) {
  let raw;
  try {
    raw = readFileSync(resolve(root, ".env.local"), "utf8");
  } catch {
    return {};
  }

  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function requireEnv(env, key) {
  const value = process.env[key] ?? env[key];
  if (!value) {
    throw new Error(`Missing required environment value: ${key} (set it in .env.local)`);
  }
  return value;
}
