// Codex round 3, F10 — every tenant role broadcast must carry a tenant.
//
// `user_notifications` is read with: recipient_id is me, OR (recipient_id IS
// NULL AND recipient_role matches AND school_id IS NOT NULL AND school_id is my
// tenant). A role broadcast written with a NULL school_id therefore matches NO
// reader — it is published to nobody and looks like a delivery failure that
// nothing reports.
//
// This test walks every createUserNotification call site in the services and
// requires that any ROLE broadcast (recipientId: null) passes a schoolId.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SERVICES = fileURLToPath(new URL("./", import.meta.url));

function callSites() {
  const sites = [];
  for (const entry of readdirSync(SERVICES)) {
    if (!entry.endsWith(".ts")) continue;
    const source = readFileSync(join(SERVICES, entry), "utf8");
    // Each createUserNotification({...}) literal, matched to its closing brace
    // at the same nesting depth.
    let index = source.indexOf("createUserNotification({");
    while (index !== -1) {
      const open = source.indexOf("{", index);
      let depth = 0;
      let end = open;
      for (; end < source.length; end += 1) {
        if (source[end] === "{") depth += 1;
        else if (source[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      sites.push({ file: entry, body: source.slice(open, end + 1) });
      index = source.indexOf("createUserNotification({", end);
    }
  }
  return sites;
}

test("the scan finds the notification call sites it is meant to police", () => {
  const sites = callSites();
  assert.ok(sites.length >= 5, `expected several call sites, found ${sites.length}`);
});

test("every ROLE broadcast passes a schoolId", () => {
  const offenders = [];
  for (const site of callSites()) {
    const isRoleBroadcast = /recipientId:\s*null/.test(site.body);
    if (!isRoleBroadcast) continue;
    if (!/schoolId:/.test(site.body)) {
      offenders.push(`${site.file}: ${site.body.replace(/\s+/g, " ").slice(0, 110)}…`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `role broadcasts without a tenant (they would be readable by nobody):\n${offenders.join("\n")}`,
  );
});

test("no call site hardcodes a tenant from client input", () => {
  // The tenant must come from the session/resource the server authorized, never
  // from a form field.
  for (const site of callSites()) {
    const schoolId = /schoolId:\s*([^,\n]+)/.exec(site.body);
    if (!schoolId) continue;
    const expression = schoolId[1].trim();
    assert.doesNotMatch(
      expression,
      /formData|searchParams|params\./,
      `${site.file} derives the notification tenant from client input: ${expression}`,
    );
  }
});
