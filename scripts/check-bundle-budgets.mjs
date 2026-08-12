// Stage 3 bundle budget guard (D-003: evidence over claims).
//
// Usage:  npm run build && node scripts/check-bundle-budgets.mjs
//
// Reads .next/app-build-manifest.json + build-manifest.json and sums the
// on-disk (pre-gzip) bytes of each route's client chunks. Raw bytes are
// deterministic per build — unlike wall-clock timings — so this is safe to run
// anywhere a fresh build exists. It is intentionally NOT part of the
// `node --test "src/**/*.test.mjs"` glob: against a stale .next it would
// assert nothing meaningful. Exits 1 on any budget breach.
//
// Budgets (raw bytes, ~10% headroom over the 2026-08-12 Stage 3 build):
//   - shared first-load (build-manifest rootMainFiles + app/layout chunks)
//   - /professor page total (Stage 3 cut it from 338 kB gz First Load to
//     225 kB gz by lazy-loading the recharts report view; the raw-byte budget
//     fails if recharts sneaks back into the eager graph)
//   - every other app route's page total (coarse global ceiling)

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const NEXT_DIR = path.resolve(".next");

const BUDGETS = {
  sharedBytes: 550_000, // measured 2026-08-12: 496 kB raw (102 kB gz First Load)
  professorPageBytes: 900_000, // measured 2026-08-12: 766 kB raw (225 kB gz); eager recharts would add ~384 kB and breach this
  anyPageBytes: 850_000, // global ceiling; heaviest route today is /mypage at 721 kB raw
};

async function chunkBytes(files) {
  let total = 0;
  for (const file of files) {
    if (!file.endsWith(".js") && !file.endsWith(".css")) continue;
    try {
      total += (await stat(path.join(NEXT_DIR, file))).size;
    } catch {
      console.error(`MISSING CHUNK: ${file} — run a fresh \`npm run build\` first.`);
      process.exitCode = 1;
    }
  }
  return total;
}

const buildId = await readFile(path.join(NEXT_DIR, "BUILD_ID"), "utf8").catch(() => null);
if (!buildId) {
  console.error("No .next/BUILD_ID — run `npm run build` first.");
  process.exit(1);
}

const appManifest = JSON.parse(
  await readFile(path.join(NEXT_DIR, "app-build-manifest.json"), "utf8"),
);
const buildManifest = JSON.parse(
  await readFile(path.join(NEXT_DIR, "build-manifest.json"), "utf8"),
);

const shared = await chunkBytes([
  ...new Set([...(buildManifest.rootMainFiles ?? []), ...(appManifest.pages["/layout"] ?? [])]),
]);

let failed = false;
function check(label, actual, budget) {
  const ok = actual <= budget;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${(actual / 1024).toFixed(0)} kB raw (budget ${(budget / 1024).toFixed(0)} kB)`,
  );
  if (!ok) failed = true;
}

check("shared first-load", shared, BUDGETS.sharedBytes);

for (const [route, files] of Object.entries(appManifest.pages)) {
  if (route === "/layout") continue;
  const total = await chunkBytes([...new Set(files)]);
  if (route === "/professor/page") {
    check(route, total, BUDGETS.professorPageBytes);
  } else {
    check(route, total, BUDGETS.anyPageBytes);
  }
}

console.log(`\nBUILD_ID ${buildId.trim()} — ${failed ? "BUDGET BREACH" : "all budgets met"}`);
if (failed) process.exit(1);
