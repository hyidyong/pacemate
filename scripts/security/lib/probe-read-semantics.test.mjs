import assert from "node:assert/strict";
import test from "node:test";

const moduleUnderTest = await import("./probe-read-semantics.mjs").catch(() => ({}));

function evaluate(input) {
  assert.equal(
    typeof moduleUnderTest.evaluateReadIsolation,
    "function",
    "the runner needs one behavior-level read-isolation verdict helper",
  );
  return moduleUnderTest.evaluateReadIsolation(input);
}

const sentinel = { id: "sentinel-1" };

test("a private read cannot pass when the authorized sentinel is missing", () => {
  const verdict = evaluate({
    intendedPublic: false,
    sentinelId: sentinel.id,
    authorizedStatus: 200,
    authorizedBody: [],
    unauthorizedStatus: 401,
    unauthorizedBody: { message: "permission denied" },
  });

  assert.equal(verdict.pass, false);
  assert.match(verdict.detail, /authorized sentinel/i);
});

test("a privileged verification error cannot be converted into an empty-table PASS", () => {
  const verdict = evaluate({
    intendedPublic: false,
    sentinelId: sentinel.id,
    authorizedError: new Error("service verifier unavailable"),
    unauthorizedStatus: 401,
    unauthorizedBody: { message: "permission denied" },
  });

  assert.equal(verdict.pass, false);
  assert.match(verdict.detail, /service verifier unavailable/);
});

test("a generic transport or HTTP failure is not an RLS denial", () => {
  const verdict = evaluate({
    intendedPublic: false,
    sentinelId: sentinel.id,
    authorizedStatus: 200,
    authorizedBody: [sentinel],
    unauthorizedStatus: 500,
    unauthorizedBody: { message: "database unavailable" },
  });

  assert.equal(verdict.pass, false);
  assert.match(verdict.detail, /unexpected anonymous status 500/i);
});

test("a private sentinel passes only with authorized proof and the expected anonymous denial", () => {
  const verdict = evaluate({
    intendedPublic: false,
    sentinelId: sentinel.id,
    authorizedStatus: 200,
    authorizedBody: [sentinel],
    unauthorizedStatus: 401,
    unauthorizedBody: { message: "permission denied" },
  });

  assert.equal(verdict.pass, true);
});

test("an intended-public allow path must expose the exact sentinel", () => {
  const missing = evaluate({
    intendedPublic: true,
    sentinelId: sentinel.id,
    authorizedStatus: 200,
    authorizedBody: [sentinel],
    unauthorizedStatus: 200,
    unauthorizedBody: [],
  });
  const visible = evaluate({
    intendedPublic: true,
    sentinelId: sentinel.id,
    authorizedStatus: 200,
    authorizedBody: [sentinel],
    unauthorizedStatus: 200,
    unauthorizedBody: [sentinel],
  });

  assert.equal(missing.pass, false);
  assert.equal(visible.pass, true);
});
