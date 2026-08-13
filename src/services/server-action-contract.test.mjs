// A `"use server"` module may export ONLY async functions.
//
// This is a Next.js compile-time rule, and it is a security-relevant one: every
// export of such a module becomes a REMOTELY INVOCABLE endpoint with a
// generated id. Next.js refuses to build a module that exports anything else
// rather than silently publishing a non-callable export.
//
// The guard exists because Stage 9's F5 fix broke it. Extracting the roadmap
// transition matrix into an exported *synchronous* helper made the table easy
// to unit-test — and failed `next build` outright. Nothing caught it until the
// production build ran, because `tsc --noEmit` and `next lint` both accept it.
// A pure helper that a server action needs belongs in a plain module the action
// imports, not in the action file, so it never becomes an endpoint at all.
//
// This test is the fast feedback the build gave too late.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const source = readFileSync(full, "utf8");
    // The directive must be the first statement for Next.js to honour it; a
    // mention inside a comment or string is not one.
    if (!/^\s*["']use server["'];/.test(source)) continue;
    out.push({ file: full.slice(repoRoot.length).replace(/\\/g, "/"), source });
  }
  return out;
}

const serverModules = collect(join(repoRoot, "src"));

test("the repository actually has server-action modules to check", () => {
  assert.ok(serverModules.length > 10, `only found ${serverModules.length} "use server" modules`);
});

test('every export of a "use server" module is an async function', () => {
  const offenders = [];

  for (const { file, source } of serverModules) {
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trimStart();
      // Comments legitimately discuss non-async exports; only code counts.
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (!trimmed.startsWith("export ")) return;
      // `export type` / `export interface` are erased before the directive is
      // interpreted, so they are not endpoints.
      if (/^export\s+(type|interface)\b/.test(trimmed)) return;
      if (/^export\s+async\s+function\b/.test(trimmed)) return;

      const where = `${file}:${index + 1}`;
      if (/^export\s+function\b/.test(trimmed)) {
        offenders.push(`${where} — synchronous function export: ${trimmed}`);
        return;
      }
      if (/^export\s+(const|let|var|class|enum)\b/.test(trimmed)) {
        // `export const f = async (...) =>` is legal; a plain value is not.
        if (/^export\s+const\s+\w+\s*(:[^=]+)?=\s*async\b/.test(trimmed)) return;
        offenders.push(`${where} — non-async export: ${trimmed}`);
        return;
      }
      if (/^export\s*\{/.test(trimmed)) {
        offenders.push(`${where} — re-export cannot be verified as async: ${trimmed}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `a "use server" module may export only async functions:\n  ${offenders.join("\n  ")}`,
  );
});
