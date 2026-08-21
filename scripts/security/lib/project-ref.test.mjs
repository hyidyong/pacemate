// Project identity is security-sensitive structured input. The guards may only
// make production/host/equality decisions on a value this parser has accepted.
import assert from "node:assert/strict";
import test from "node:test";

import { CLOUD_PROJECT_REF_RE, parseProjectRef } from "./project-ref.mjs";
import { KNOWN_PRODUCTION_PROJECT_REFS } from "./production-targets.mjs";

const PROD_REF = "szztsqdnvenfbgxtylkl";

test("the compiled production ref and the repository's scratch/local identities are shape-valid", () => {
  for (const ref of [PROD_REF, "stagingref000000", "fakeproject", "someotherproject", "different-scratch-ref"]) {
    assert.equal(CLOUD_PROJECT_REF_RE.test(ref), true, `${ref} must be a valid label`);
  }
  const parsed = parseProjectRef("stagingref000000");
  assert.deepEqual(parsed, {
    present: true,
    wellFormed: true,
    valid: true,
    ref: "stagingref000000",
    production: false,
    productionRefs: [],
    problems: [],
  });
  assert.ok([...KNOWN_PRODUCTION_PROJECT_REFS].every((ref) => CLOUD_PROJECT_REF_RE.test(ref)));
});

test("a missing ref is reported as absent, never as a valid identity", () => {
  for (const raw of [undefined, null, ""]) {
    const parsed = parseProjectRef(raw);
    assert.equal(parsed.present, false);
    assert.equal(parsed.valid, false);
    assert.equal(parsed.ref, null);
  }
});

test("production identity survives whitespace and case variation and is never returned as a usable ref", () => {
  for (const raw of [
    PROD_REF,
    ` ${PROD_REF}`,
    `${PROD_REF} `,
    `\t${PROD_REF}\n`,
    PROD_REF.toUpperCase(),
    "SzZtSqDnVeNfBgXtYlKl",
    `${PROD_REF}.supabase.co`,
    `https://${PROD_REF}.supabase.co`,
    `${PROD_REF}/`,
  ]) {
    const parsed = parseProjectRef(raw);
    assert.equal(parsed.production, true, `${JSON.stringify(raw)} must be recognised as production`);
    assert.deepEqual(parsed.productionRefs, [PROD_REF]);
    assert.match(parsed.problems.join("\n"), /KNOWN PRODUCTION/);
    assert.equal(parsed.valid, false);
    assert.equal(parsed.ref, null);
  }
  // Only the exact canonical spelling is both production AND well-formed; it is
  // still unusable because production is refused outright.
  const exact = parseProjectRef(PROD_REF);
  assert.equal(exact.problems.length, 1);
  assert.equal(exact.wellFormed, true, "the canonical production ref is well-formed, just forbidden");
  assert.equal(parseProjectRef(` ${PROD_REF}`).wellFormed, false);
  assert.equal(parseProjectRef(PROD_REF.toUpperCase()).wellFormed, false);
});

test("malformed refs are rejected fail-closed with no canonical ref", () => {
  const malformed = [
    " ",
    "\t",
    "not/a/ref",
    "https://example.com",
    "foo.supabase.co",
    "foo.bar",
    "ref/path",
    "ref?x=1",
    "ref#frag",
    "ref:5432",
    "-leadinghyphen",
    "trailinghyphen-",
    "under_score",
    "UPPERCASE",
    " stagingref000000",
    "stagingref000000 ",
    "a".repeat(64),
    123,
    {},
  ];
  for (const raw of malformed) {
    const parsed = parseProjectRef(raw, { source: "TEST_REF" });
    assert.equal(parsed.present, true, `${JSON.stringify(raw)} is present`);
    assert.equal(parsed.valid, false, `${JSON.stringify(raw)} must be rejected`);
    assert.equal(parsed.ref, null, `${JSON.stringify(raw)} must not yield a ref`);
    assert.ok(parsed.problems.length >= 1);
    assert.match(parsed.problems.join("\n"), /TEST_REF/);
  }
});
