// Codex F6 + round 3 F8 — the /support boundary.
//
// SUPPORT REQUIRES A SESSION (F8). The page already enforced that while the
// action still accepted anonymous submissions and wrote a NULL-tenant
// notification no administrator could read. These tests pin the coherent model:
//
//   1. an unauthenticated caller is refused and nothing is persisted;
//   2. a signed-in caller controls only a title, a body and an allowlisted
//      category - never the recipient, role, tenant, notification type or
//      target URL, and the tenant comes from the session;
//   3. the central creation chokepoint bounds what is stored, so a future
//      caller cannot reopen the hole by forgetting to validate.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const NOTIFICATION_STUB = toDataUrl(`
  export const createUserNotification = async (input) => {
    globalThis.__supportNotifications.push(input);
    return { ok: true };
  };
`);
const SESSION_STUB = toDataUrl(`
  export const getDemoProfile = async () => globalThis.__supportProfile;
`);
const CACHE_STUB = toDataUrl("export const revalidatePath = () => {};");

let modulePromise;
async function loadSupport() {
  modulePromise ??= (async () => {
    let source = readFileSync(fileURLToPath(new URL("./support.actions.ts", import.meta.url)), "utf8");
    for (const [from, to] of [
      ['"use server";', ""],
      ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
      ['from "@/services/notifications.create.service"', `from ${JSON.stringify(NOTIFICATION_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_STUB)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(!compiled.includes('from "@/'), "unrewritten alias import in support.actions.ts");
    return import(toDataUrl(compiled));
  })();
  return modulePromise;
}

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function reset(profile = null) {
  globalThis.__supportNotifications = [];
  globalThis.__supportProfile = profile;
}

const BODY = "이 문의는 충분히 길게 작성된 정상적인 내용입니다.";
const TENANT = "33333333-3333-4333-8333-333333333333";
const SIGNED_IN = { id: "p1", name: "학생", school_id: TENANT };

test("an UNAUTHENTICATED submission is refused and persists nothing (F8)", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset(null);

  const result = await submitSupportInquiry(form({ title: "결제 문의", message: BODY, category: "account" }));

  assert.equal(result.ok, false);
  assert.equal(globalThis.__supportNotifications.length, 0, "nothing may be persisted without a session");
});

test("a caller with a session but no tenant is refused", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset({ id: "p1", name: "학생", school_id: null });

  const result = await submitSupportInquiry(form({ title: "문의", message: BODY, category: "system" }));

  assert.equal(result.ok, false);
  assert.equal(globalThis.__supportNotifications.length, 0);
});

test("a normal signed-in submission is accepted and creates one notification", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset(SIGNED_IN);

  const result = await submitSupportInquiry(form({ title: "결제 문의", message: BODY, category: "account" }));

  assert.equal(result.ok, true);
  assert.equal(result.autoReplied, false);
  assert.equal(globalThis.__supportNotifications.length, 1);
});

test("the submission is routed to the submitter own tenant, so admins can read it (F8)", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset(SIGNED_IN);

  await submitSupportInquiry(form({ title: "문의", message: BODY, category: "system" }));

  const [notification] = globalThis.__supportNotifications;
  assert.equal(notification.recipientRole, "admin");
  assert.equal(notification.recipientId, null);
  // A role broadcast with a NULL tenant matches no reader under the
  // notification policy - that was the F8 defect.
  assert.equal(notification.schoolId, TENANT);
});

test("every valid category is accepted", async () => {
  const { submitSupportInquiry } = await loadSupport();
  for (const category of ["system", "account", "counseling", "roadmap", "course", "other"]) {
    reset(SIGNED_IN);
    const result = await submitSupportInquiry(form({ title: "문의", message: BODY, category }));
    assert.equal(result.ok, true, `category ${category} should be accepted`);
  }
});

test("an unknown category is REJECTED, not silently coerced to a default", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset(SIGNED_IN);

  const result = await submitSupportInquiry(
    form({ title: "문의", message: BODY, category: "<script>alert(1)</script>" }),
  );

  assert.equal(result.ok, false);
  assert.equal(globalThis.__supportNotifications.length, 0, "nothing may be persisted");
});

test("an oversized category is rejected", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset(SIGNED_IN);

  const result = await submitSupportInquiry(
    form({ title: "문의", message: BODY, category: "a".repeat(5000) }),
  );

  assert.equal(result.ok, false);
  assert.equal(globalThis.__supportNotifications.length, 0);
});

test("an oversized body is rejected rather than truncated into the record", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset(SIGNED_IN);

  const result = await submitSupportInquiry(
    form({ title: "문의", message: "가".repeat(4001), category: "system" }),
  );

  assert.equal(result.ok, false);
  assert.equal(globalThis.__supportNotifications.length, 0);
});

test("an oversized title is rejected rather than trimmed to fit", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset(SIGNED_IN);

  const result = await submitSupportInquiry(
    form({ title: "가".repeat(121), message: BODY, category: "system" }),
  );

  assert.equal(result.ok, false);
  assert.equal(globalThis.__supportNotifications.length, 0);
});

test("the caller controls no routing field", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset(SIGNED_IN);

  // Everything an attacker would want to steer is submitted here and must be
  // ignored: recipient, role, tenant, notification type and target URL.
  await submitSupportInquiry(
    form({
      title: "문의",
      message: BODY,
      category: "system",
      recipientId: "11111111-1111-4111-8111-111111111111",
      recipientRole: "student",
      schoolId: "22222222-2222-4222-8222-222222222222",
      targetHref: "https://evil.example/steal",
      notificationCategory: "counseling",
    }),
  );

  const [notification] = globalThis.__supportNotifications;
  assert.ok(notification, "expected a notification");
  assert.equal(notification.recipientRole, "admin");
  assert.equal(notification.recipientId, null);
  assert.equal(notification.category, "system");
  assert.equal(notification.targetHref, "/admin");
  // The submitted schoolId is ignored; the session tenant is used.
  assert.equal(notification.schoolId, TENANT);
});

test("a signed-in submission is tenant-stamped from the session, not the form", async () => {
  const { submitSupportInquiry } = await loadSupport();
  reset(SIGNED_IN);

  await submitSupportInquiry(
    form({
      title: "문의",
      message: BODY,
      category: "system",
      schoolId: "22222222-2222-4222-8222-222222222222",
    }),
  );

  const [notification] = globalThis.__supportNotifications;
  assert.equal(notification.schoolId, "33333333-3333-4333-8333-333333333333");
});

test("the page and the action agree that support requires a session (F8)", () => {
  // The contradiction Codex found was UI-vs-server. Both halves are asserted.
  const page = readFileSync(
    fileURLToPath(new URL("../app/support/page.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(page, /requireRoles\(/, "the page must gate itself");
  const action = readFileSync(
    fileURLToPath(new URL("./support.actions.ts", import.meta.url)),
    "utf8",
  );
  assert.match(action, /if \(!profile \|\| !profile\.school_id\)/, "the action must gate itself too");
});

test("the central chokepoint bounds what is persisted", () => {
  // The bound must live where every caller passes through, not at each caller.
  const source = readFileSync(
    fileURLToPath(new URL("./notifications.create.service.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /NOTIFICATION_TITLE_MAX\s*=\s*\d+/);
  assert.match(source, /NOTIFICATION_BODY_MAX\s*=\s*\d+/);
  assert.match(source, /NOTIFICATION_TARGET_HREF_MAX\s*=\s*\d+/);
  assert.match(
    source,
    /title\.length > NOTIFICATION_TITLE_MAX[\s\S]*?body\.length > NOTIFICATION_BODY_MAX[\s\S]*?targetHref\.length > NOTIFICATION_TARGET_HREF_MAX/,
  );
  // Rejection, not truncation, at the boundary.
  assert.doesNotMatch(source, /title\.slice\(/);
  assert.doesNotMatch(source, /body\.slice\(/);
});
