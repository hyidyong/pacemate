import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 8 P2. The structured logger is the foundation the observability design
// rests on, so its two load-bearing properties are frozen here: the field
// ALLOWLIST (a future caller must not be able to leak PII by passing an extra
// key) and the error TAXONOMY (a booking conflict must never be counted as a
// system fault, or the fault rate an operator alerts on is meaningless).

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

let modulePromise;
function loadModule() {
  modulePromise ??= (async () => {
    const source = await readFile(new URL("./log.ts", import.meta.url), "utf8");
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    return import(toDataUrl(compiled));
  })();
  return modulePromise;
}

test("only allowlisted fields are serialized", async () => {
  const { buildLogRecord } = await loadModule();

  const record = buildLogRecord({
    event: "booking.storage_failure",
    outcome: "fault",
    tenantId: "tenant-uuid",
    profileId: "profile-uuid",
    code: "23505",
    // Everything below is NOT on the allowlist and must be dropped.
    email: "student@university.ac.kr",
    identifier: "student@university.ac.kr",
    name: "홍길동",
    password: "hunter2",
    accessToken: "eyJhbGciOi...",
    authorizationCode: "abc123",
    details: 'Key (identifier)=(student@university.ac.kr) already exists',
  });

  assert.equal(record.event, "booking.storage_failure");
  assert.equal(record.tenantId, "tenant-uuid");
  assert.equal(record.code, "23505");

  for (const forbidden of [
    "email",
    "identifier",
    "name",
    "password",
    "accessToken",
    "authorizationCode",
    "details",
  ]) {
    assert.equal(record[forbidden], undefined, `${forbidden} must never be serialized`);
  }

  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes("university.ac.kr"), "no email may appear in the log line");
  assert.ok(!serialized.includes("hunter2"), "no password may appear in the log line");
  assert.ok(!serialized.includes("eyJhbGciOi"), "no token may appear in the log line");
});

test("empty and absent values are omitted rather than emitted as nulls", async () => {
  const { buildLogRecord } = await loadModule();
  const record = buildLogRecord({ event: "auth.login_denied", outcome: "denied", detail: "" });

  assert.equal("detail" in record, false);
  assert.equal("tenantId" in record, false);
  assert.equal(record.event, "auth.login_denied");
});

test("level defaults follow the outcome taxonomy", async () => {
  const { buildLogRecord } = await loadModule();

  assert.equal(buildLogRecord({ event: "e", outcome: "fault" }).level, "error");
  assert.equal(buildLogRecord({ event: "e", outcome: "conflict" }).level, "warn");
  assert.equal(buildLogRecord({ event: "e", outcome: "denied" }).level, "warn");
  assert.equal(buildLogRecord({ event: "e", outcome: "ok" }).level, "info");
  assert.equal(buildLogRecord({ event: "e" }).level, "info");
  // An explicit level still wins.
  assert.equal(buildLogRecord({ event: "e", outcome: "fault", level: "warn" }).level, "warn");
});

test("booking conflicts are classified as conflicts, never as faults", async () => {
  const { classifyPostgresError } = await loadModule();

  // The exclusion constraint and the partial unique index are the DB doing its
  // job under contention (D-011/D-013).
  assert.equal(classifyPostgresError("23P01"), "conflict");
  assert.equal(classifyPostgresError("23505"), "conflict");
  // An empty compare-and-set result is a lost race, not a failure (D-012).
  assert.equal(classifyPostgresError("PGRST116"), "conflict");
  // Permission denied is an authorization outcome.
  assert.equal(classifyPostgresError("42501"), "denied");
  // Anything unrecognized is a fault — fail loud, not silent.
  assert.equal(classifyPostgresError("08006"), "fault");
  assert.equal(classifyPostgresError(null), "fault");
});

test("a timestamp is always present", async () => {
  const { buildLogRecord } = await loadModule();
  const record = buildLogRecord({ event: "e" }, new Date("2026-08-13T01:02:03.000Z"));
  assert.equal(record.ts, "2026-08-13T01:02:03.000Z");
});
