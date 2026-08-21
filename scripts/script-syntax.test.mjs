// Codex round 5, F11 — every committed script must actually PARSE.
//
// `scripts/ensure-demo-operator-auth.mjs` contained a literal newline inside a
// string literal and had never been parseable. Nothing caught it:
//
//   * it is a `scripts/` file, so `tsc --noEmit` does not look at it;
//   * `next lint` covers `src/`, not `scripts/`;
//   * it is an operator tool, so no test imported it;
//   * and the round-3 credential guard that DID reference it read it as TEXT
//     (`assert.match(source, /PACEMATE_DEMO_PASSWORDS/)`), which happily passes
//     against a file the engine cannot compile.
//
// That last point is the lesson. A source-text assertion proves a string is
// present, never that the program is valid. This test closes the gap for the
// whole tree at once rather than for the one file that happened to break.
//
// It parses every committed .mjs — including test files — because the defect
// was introduced by a shell heredoc mangling `\\n` into a real newline, and that
// accident is not specific to any directory.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function committedScripts() {
  const out = execFileSync("git", ["ls-files", "*.mjs", "*.js", "*.cjs"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out.split(/\r?\n/).filter(Boolean);
}

const scripts = committedScripts();

test("the repository actually has committed scripts to check", () => {
  assert.ok(scripts.length > 20, `only found ${scripts.length} committed scripts`);
});

test("every committed JavaScript file parses", () => {
  const broken = [];
  for (const file of scripts) {
    try {
      // `node --check` is the engine's own parser, so this cannot disagree with
      // what would happen at run time.
      execFileSync(process.execPath, ["--check", file], { cwd: repoRoot, stdio: "pipe" });
    } catch (error) {
      const detail = String(error.stderr ?? error.message)
        .split(/\r?\n/)
        .find((line) => /SyntaxError/.test(line)) ?? "unknown syntax error";
      broken.push(`${file}: ${detail.trim()}`);
    }
  }

  assert.deepEqual(broken, [], `these committed scripts do not parse:\n  ${broken.join("\n  ")}`);
});

test("the demo operator script refuses without credentials, and is RUNNABLE", () => {
  // The round-3 guard asserted this file mentions PACEMATE_DEMO_PASSWORDS. It
  // did — inside a file that could not be parsed. Text presence is not
  // behaviour, so this asserts the refusal by RUNNING it with the variable
  // absent, which is the safest non-destructive path through the script: it
  // exits before creating any client or touching any account.
  let stderr = "";
  let exitCode = 0;
  try {
    execFileSync(process.execPath, ["scripts/ensure-demo-operator-auth.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, PACEMATE_DEMO_PASSWORDS: "" },
    });
  } catch (error) {
    exitCode = error.status ?? 1;
    stderr = String(error.stderr ?? "");
  }

  assert.equal(exitCode, 1, "it must refuse, not proceed, without credentials");
  assert.match(stderr, /Refusing to run/);
  assert.doesNotMatch(stderr, /SyntaxError/, "it must be parseable");
  // Nothing secret may reach the output even on the failure path.
  assert.doesNotMatch(stderr, /password["':=]/i);
});
