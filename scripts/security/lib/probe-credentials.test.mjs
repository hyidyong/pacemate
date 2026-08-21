import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createProbeRunSecret } from "./probe-credentials.mjs";
import { createRunMarker } from "./probe-guard.mjs";

test("each probe execution receives an independent cryptographic secret", () => {
  const runMarker = createRunMarker("a".repeat(32));
  const first = createProbeRunSecret();
  const second = createProbeRunSecret();

  assert.notEqual(first, second);
  assert.ok(first.length >= 40, "the run secret must carry ample encoded entropy");
  assert.equal(first.includes(runMarker), false, "the run marker must not derive the secret");
  assert.equal(first.includes("probe.invalid"), false, "fixture identities must not derive the secret");
});

test("live probe sources contain no committed probe password or secret logging", async () => {
  const sources = await Promise.all(
    ["probe-fixtures.mjs", "../rls-probe.mjs", "../../verify-notification-rls.mjs"].map(
      (path) => readFile(new URL(path, import.meta.url), "utf8"),
    ),
  );
  const combined = sources.join("\n");

  assert.doesNotMatch(combined, /Stage9-(?:notif-)?probe-!aA9/);
  assert.doesNotMatch(combined, /const\s+PROBE_PASSWORD\s*=/);
  assert.doesNotMatch(combined, /console\.(?:log|error)[^\n]*(?:authSecret|runSecret)/);
});
