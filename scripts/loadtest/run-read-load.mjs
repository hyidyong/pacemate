// Stage 8 read-path load test.
//
// Drives real HTTP GETs against a locally running production build using REAL
// login sessions (see lib/auth-session.mjs for why a minted cookie is not
// enough), one scenario per critical read journey, across concurrency tiers.
//
// Closed-loop by design: `concurrency` virtual users each wait for their page
// before requesting the next one, which models a cohort of students rather than
// an open-loop flood, and cannot bury the live database under an unbounded
// queue.
//
// Usage:
//   node scripts/loadtest/run-read-load.mjs --tier=baseline
//   node scripts/loadtest/run-read-load.mjs --tier=moderate --scenario=counseling
//   node scripts/loadtest/run-read-load.mjs --tier=all --out=docs/upgrade/stage-08/results/read-load.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnvLocal } from "./lib/env.mjs";
import { loginVirtualUser } from "./lib/auth-session.mjs";
import { runClosedLoop, getPage } from "./lib/driver.mjs";
import { summarize, formatSummary } from "./lib/stats.mjs";
import { assertSafeTarget } from "./lib/safety.mjs";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? "http://127.0.0.1:3000"; // loopback by default (finding 5)

const TIERS = {
  smoke: { concurrency: 1, iterations: 5 },
  baseline: { concurrency: 1, iterations: 30, warmup: 3 },
  moderate: { concurrency: 10, iterations: 200, warmup: 5 },
  high: { concurrency: 25, iterations: 400, warmup: 5 },
  stress: { concurrency: 50, iterations: 600, warmup: 5 },
};

const SCENARIOS = {
  dashboard: { path: "/dashboard", role: "student", label: "student dashboard (heaviest fan-out)" },
  counseling: { path: "/counseling", role: "student", label: "counseling availability browse" },
  mypage: { path: "/mypage", role: "student", label: "timetable / my page" },
  courses: { path: "/courses", role: "student", label: "course catalog" },
  professor: { path: "/professor", role: "professor", label: "professor workspace" },
  admin: { path: "/admin", role: "admin", label: "admin listing" },
  login: { path: "/login", role: null, label: "login page (unauthenticated)" },
};

async function main() {
  loadEnvLocal();
  // Review finding 5: virtual users log in with real credentials, so a
  // non-loopback target needs an explicit opt-in, https, and a declared host.
  assertSafeTarget(process.env, BASE_URL);
  const demoUsers = JSON.parse(readFileSync("src/config/demo-users.json", "utf8"));

  // One real session per role. Read-path virtual users share a role's session:
  // this measures server capacity per route, not per-user data diversity, and
  // is stated as such in LOAD_TEST_PLAN.md.
  const sessions = {};
  for (const user of demoUsers) {
    const result = await loginVirtualUser({
      baseUrl: BASE_URL,
      identifier: user.identifier,
      password: user.password,
    });
    sessions[user.role] = result.ok ? result.jar.header() : null;
    console.log(
      `login ${user.role.padEnd(10)} ${user.identifier.padEnd(26)} ${
        result.ok ? "OK" : `FAILED (${result.error})`
      }`,
    );
  }

  const tierNames =
    args.tier === "all" ? ["baseline", "moderate", "high"] : (args.tier ?? "baseline").split(",");
  const scenarioNames = args.scenario ? args.scenario.split(",") : Object.keys(SCENARIOS);

  const results = [];
  for (const tierName of tierNames) {
    const tier = TIERS[tierName];
    if (!tier) throw new Error(`Unknown tier "${tierName}". Known: ${Object.keys(TIERS).join(", ")}`);

    for (const scenarioName of scenarioNames) {
      const scenario = SCENARIOS[scenarioName];
      if (!scenario) throw new Error(`Unknown scenario "${scenarioName}"`);

      const cookie = scenario.role ? sessions[scenario.role] : "";
      if (scenario.role && !cookie) {
        console.log(`\nSKIP ${scenarioName} @ ${tierName} — no ${scenario.role} session`);
        continue;
      }

      const label = `${scenarioName} @ ${tierName} (c=${tier.concurrency}, n=${tier.iterations})`;
      process.stdout.write(`\nRunning ${label} ... `);

      const { samples, wallClockMs } = await runClosedLoop({
        concurrency: tier.concurrency,
        iterations: tier.iterations,
        warmupIterations: tier.warmup ?? 0,
        task: () => getPage(BASE_URL, scenario.path, cookie),
      });

      const summary = summarize(samples, wallClockMs);
      const bytes = samples.filter((s) => s.meta?.bytes).map((s) => s.meta.bytes);
      summary.medianBytes = bytes.length
        ? bytes.sort((a, b) => a - b)[Math.floor(bytes.length / 2)]
        : null;

      console.log("done");
      console.log(formatSummary(`  ${scenario.label}`, summary));

      results.push({
        scenario: scenarioName,
        path: scenario.path,
        role: scenario.role,
        tier: tierName,
        concurrency: tier.concurrency,
        ...summary,
      });
    }
  }

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(
      args.out,
      JSON.stringify(
        { baseUrl: BASE_URL, generatedAt: new Date().toISOString(), results },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${args.out}`);
  }

  console.log("\n=== SUMMARY TABLE ===");
  console.log(["scenario", "tier", "conc", "reqs", "err%", "rps", "p50", "p95", "p99"].join("\t"));
  for (const r of results) {
    console.log(
      [
        r.scenario,
        r.tier,
        r.concurrency,
        r.requests,
        r.errorRatePct,
        r.throughputRps,
        r.latencyMs.p50,
        r.latencyMs.p95,
        r.latencyMs.p99,
      ].join("\t"),
    );
  }
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) out[match[1]] = match[2] ?? true;
  }
  return out;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
