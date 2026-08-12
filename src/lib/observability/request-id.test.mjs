import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 8 review finding 6. `x-pacemate-request-id` is OUR internal header, but
// it arrives on inbound requests where a client fully controls it. Adopting it
// verbatim let a caller choose their own correlation id — enough to forge log
// lines, collide deliberately with another request's id, or inject control
// characters into a JSON log stream.

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

let modulePromise;
function loadModule() {
  modulePromise ??= (async () => {
    const source = await readFile(new URL("./request-id.ts", import.meta.url), "utf8");
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    return import(toDataUrl(compiled));
  })();
  return modulePromise;
}

function headers(map) {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}

const HOSTILE_VALUES = [
  'evil","level":"info","event":"fake', // JSON break-out into the log stream
  "line1\nline2", // log injection via newline
  "line1\r\nline2",
  "a".repeat(500), // unbounded growth
  "../../etc/passwd",
  "<script>alert(1)</script>",
  "id with spaces",
  "",
  "   ",
];

test("a client-supplied request id is never adopted verbatim", async () => {
  const { mintRequestId } = await loadModule();

  for (const hostile of HOSTILE_VALUES) {
    const id = mintRequestId(headers({ "x-pacemate-request-id": hostile }));
    assert.notEqual(id, hostile, `must not adopt client value: ${JSON.stringify(hostile)}`);
    assert.match(id, /^[A-Za-z0-9_-]{1,128}$/, "minted ids must be safe to embed in a log line");
  }
});

test("even a well-formed client-supplied id is replaced, not trusted", async () => {
  const { mintRequestId } = await loadModule();
  const clientChosen = "11111111-1111-4111-8111-111111111111";

  const id = mintRequestId(headers({ "x-pacemate-request-id": clientChosen }));
  assert.notEqual(
    id,
    clientChosen,
    "a caller must not be able to choose the correlation id, even a syntactically valid one",
  );
});

test("the platform's own id is accepted when it is safe", async () => {
  const { mintRequestId } = await loadModule();
  const vercelId = "iad1::abcde-1712345678901-0123456789ab";

  const id = mintRequestId(headers({ "x-vercel-id": vercelId }));
  assert.equal(id, sanitizeExpectation(vercelId), "a safe platform id should be reused for correlation");
});

test("an unsafe platform id is replaced rather than sanitized into ambiguity", async () => {
  const { mintRequestId } = await loadModule();

  const id = mintRequestId(headers({ "x-vercel-id": "bad\nvalue" }));
  assert.notEqual(id, "bad\nvalue");
  assert.match(id, /^[A-Za-z0-9_-]{1,128}$/);
});

test("with no headers at all a fresh id is minted", async () => {
  const { mintRequestId } = await loadModule();

  const first = mintRequestId(headers({}));
  const second = mintRequestId(headers({}));
  assert.match(first, /^[A-Za-z0-9_-]{1,128}$/);
  assert.notEqual(first, second, "each request should get its own id");
});

test("readRequestId only returns values that are safe to log", async () => {
  const { readRequestId } = await loadModule();

  assert.equal(readRequestId(headers({ "x-pacemate-request-id": "bad\nvalue" })), undefined);
  assert.equal(readRequestId(headers({ "x-pacemate-request-id": "a".repeat(500) })), undefined);
  assert.equal(readRequestId(headers({})), undefined);

  const good = "0f7c2a1b-3d4e-4f50-9a61-2b3c4d5e6f70";
  assert.equal(readRequestId(headers({ "x-pacemate-request-id": good })), good);
});

// Vercel ids contain "::" which is not in the safe charset; the helper is
// expected to normalise rather than reject outright.
function sanitizeExpectation(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 128);
}
