import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 8 review finding 6 (round 2). The correlation id exists and is
// trustworthy, but it is only useful if it actually reaches the operational
// events. These tests assert propagation at the EVENT level for the four
// surfaces Stage 8 added: booking, login, SSO identity, and unhandled
// server errors.

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

const REQUEST_ID = "3f2a1b0c-4d5e-4f60-9a71-2b3c4d5e6f70";

async function compile(relativePath, replacements) {
  let source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  source = source.replace('import "server-only";', "");
  for (const [from, to] of replacements) source = source.split(from).join(to);
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  assert.ok(!compiled.includes('from "@/'), `unrewritten alias import in ${relativePath}`);
  return import(toDataUrl(compiled));
}

const LOG_CAPTURE_STUB = toDataUrl(
  `export const logEvent = (event) => { (globalThis.__capturedEvents ??= []).push(event); };
   export const buildLogRecord = () => ({});
   export const classifyPostgresError = () => 'fault';`,
);

function captured() {
  return globalThis.__capturedEvents ?? [];
}

function resetCapture() {
  globalThis.__capturedEvents = [];
}

test("SSO identity events carry the server-minted request id", async () => {
  resetCapture();
  const audit = await compile("../sso/sso-audit.ts", [
    ['from "@/lib/observability/log"', `from ${JSON.stringify(LOG_CAPTURE_STUB)}`],
  ]);

  audit.emitSsoAuditEvent({
    event: "sso_login_denied",
    reason: "tenant_mismatch",
    requestId: REQUEST_ID,
    schoolId: "aaaaaaaa-0000-4000-8000-00000000000a",
  });

  const [event] = captured();
  assert.ok(event, "an event should have been emitted");
  assert.equal(event.requestId, REQUEST_ID, "an SSO denial must be joinable to its request");
  assert.equal(event.outcome, "denied");
});

test("the SSO audit allowlist still refuses identity material while carrying the id", async () => {
  resetCapture();
  const audit = await compile("../sso/sso-audit.ts", [
    ['from "@/lib/observability/log"', `from ${JSON.stringify(LOG_CAPTURE_STUB)}`],
  ]);

  audit.emitSsoAuditEvent({
    event: "sso_login_ok",
    requestId: REQUEST_ID,
    // None of these are allowlisted and must not survive.
    email: "student@university.ac.kr",
    token: "eyJhbGciOi",
    claims: { sub: "abc" },
    name: "홍길동",
  });

  const [event] = captured();
  assert.equal(event.requestId, REQUEST_ID);
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes("university.ac.kr"), "no email may reach the log");
  assert.ok(!serialized.includes("eyJhbGciOi"), "no token may reach the log");
  assert.ok(!serialized.includes("홍길동"), "no display name may reach the log");
});

test("unhandled server errors carry a validated request id, and drop an unsafe one", async () => {
  resetCapture();
  const instrumentation = await compile("../../instrumentation.ts", [
    ['from "@/lib/observability/log"', `from ${JSON.stringify(LOG_CAPTURE_STUB)}`],
    [
      'from "@/lib/observability/request-id"',
      `from ${JSON.stringify(new URL("./request-id.ts", import.meta.url).href)}`,
    ],
  ]);

  instrumentation.onRequestError(
    new TypeError("boom"),
    { path: "/counseling", headers: { "x-pacemate-request-id": REQUEST_ID } },
    { routePath: "/counseling" },
  );
  instrumentation.onRequestError(
    new TypeError("boom"),
    // onRequestError can fire for requests that never passed middleware, so the
    // value is validated rather than trusted for having arrived in that header.
    { path: "/counseling", headers: { "x-pacemate-request-id": 'evil","level":"info' } },
    { routePath: "/counseling" },
  );

  const [good, hostile] = captured();
  assert.equal(good.requestId, REQUEST_ID, "a valid id must be propagated");
  assert.equal(good.outcome, "fault");
  assert.equal(good.detail, "TypeError", "only the error NAME is logged, never its message");
  assert.equal(hostile.requestId, undefined, "an unsafe id must be dropped, not logged");
});

// Booking and login propagation is asserted at the source level: both call
// sites are inside server actions whose surrounding modules need the whole
// Next request context to execute, which a unit test cannot supply. The runtime
// evidence for login is recorded in the handoff (an emitted auth.login_denied
// line carrying a server-minted requestId).
test("booking and login events pass a request id through the trusted helper", async () => {
  const booking = await readFile(
    new URL("../../services/counseling.actions.ts", import.meta.url),
    "utf8",
  );
  const login = await readFile(
    new URL("../../services/demo-auth.service.ts", import.meta.url),
    "utf8",
  );

  for (const [name, source, expectedEvents] of [
    [
      "counseling.actions.ts",
      booking,
      ["booking.availability_unavailable", "booking.slot_conflict", "booking.storage_failure"],
    ],
    ["demo-auth.service.ts", login, ["auth.login_denied"]],
  ]) {
    assert.match(
      source,
      /import \{ getRequestId \} from "@\/lib\/observability\/request-context"/,
      `${name} must obtain the id from the trusted helper`,
    );
    for (const eventName of expectedEvents) {
      const block = source.slice(source.indexOf(`event: "${eventName}"`));
      assert.match(
        block.slice(0, 300),
        /requestId: await getRequestId\(\)/,
        `${name}: ${eventName} must carry a requestId`,
      );
    }
  }
});
