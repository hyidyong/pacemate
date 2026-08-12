import assert from "node:assert/strict";
import test from "node:test";
import { createMockIdentityProvider, verifyMockIdToken } from "./mock-idp.ts";

// Stage 7 mock IdP — deterministic in-process issuer. These tests prove the
// verification checks BITE (signature, issuer, audience, expiry, kid): the
// forgeries a real IdP integration must reject, demonstrated locally without
// any network. The clock is injected everywhere (no wall-clock flake).

const NOW = 1_754_000_000_000; // fixed epoch ms
const AUDIENCE = "pacemate-client";

function makeIdp() {
  return createMockIdentityProvider({ issuer: "https://idp.univ-a.test" });
}

test("mint + verify roundtrip yields the exact claims with deterministic times", () => {
  const idp = makeIdp();
  const token = idp.mintIdToken({
    sub: "subject-1",
    audience: AUDIENCE,
    email: "member@univ-a.test",
    emailVerified: true,
    affiliation: "student",
    now: NOW,
    expiresInSeconds: 300,
  });
  const claims = verifyMockIdToken(token, {
    jwks: idp.jwks(),
    issuer: idp.issuer,
    audience: AUDIENCE,
    now: NOW,
  });
  assert.ok(claims, "token minted by the IdP must verify against its JWKS");
  assert.equal(claims.sub, "subject-1");
  assert.equal(claims.email, "member@univ-a.test");
  assert.equal(claims.email_verified, true);
  assert.equal(claims.iat, Math.floor(NOW / 1000));
  assert.equal(claims.exp, Math.floor(NOW / 1000) + 300);
});

test("a token signed with the wrong key is rejected", () => {
  const idp = makeIdp();
  const forged = idp.mintIdToken({
    sub: "subject-1",
    audience: AUDIENCE,
    now: NOW,
    useWrongKey: true,
  });
  assert.equal(
    verifyMockIdToken(forged, { jwks: idp.jwks(), issuer: idp.issuer, audience: AUDIENCE, now: NOW }),
    null,
  );
});

test("a tampered payload is rejected (signature covers the payload)", () => {
  const idp = makeIdp();
  const token = idp.mintIdToken({ sub: "subject-1", audience: AUDIENCE, now: NOW });
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  claims.sub = "someone-else";
  const tampered = [
    header,
    Buffer.from(JSON.stringify(claims), "utf8").toString("base64url"),
    signature,
  ].join(".");
  assert.equal(
    verifyMockIdToken(tampered, { jwks: idp.jwks(), issuer: idp.issuer, audience: AUDIENCE, now: NOW }),
    null,
  );
});

test("wrong issuer and wrong audience are rejected", () => {
  const idp = makeIdp();
  const wrongIssuer = idp.mintIdToken({
    sub: "subject-1",
    audience: AUDIENCE,
    now: NOW,
    issuerOverride: "https://idp.evil.test",
  });
  assert.equal(
    verifyMockIdToken(wrongIssuer, { jwks: idp.jwks(), issuer: idp.issuer, audience: AUDIENCE, now: NOW }),
    null,
  );
  const wrongAudience = idp.mintIdToken({ sub: "subject-1", audience: "other-client", now: NOW });
  assert.equal(
    verifyMockIdToken(wrongAudience, { jwks: idp.jwks(), issuer: idp.issuer, audience: AUDIENCE, now: NOW }),
    null,
  );
});

test("expired and not-yet-issued tokens are rejected", () => {
  const idp = makeIdp();
  const token = idp.mintIdToken({ sub: "s", audience: AUDIENCE, now: NOW, expiresInSeconds: 300 });
  // 301 seconds later: expired.
  assert.equal(
    verifyMockIdToken(token, {
      jwks: idp.jwks(),
      issuer: idp.issuer,
      audience: AUDIENCE,
      now: NOW + 301_000,
    }),
    null,
  );
  // Minted 2 minutes in the future: beyond the 60s skew allowance.
  const future = idp.mintIdToken({ sub: "s", audience: AUDIENCE, now: NOW + 120_000 });
  assert.equal(
    verifyMockIdToken(future, { jwks: idp.jwks(), issuer: idp.issuer, audience: AUDIENCE, now: NOW }),
    null,
  );
});

test("a token from one IdP does not verify against another IdP's JWKS", () => {
  const idpA = makeIdp();
  const idpB = createMockIdentityProvider({
    issuer: "https://idp.univ-b.test",
    keyId: "univ-b-key",
  });
  const token = idpA.mintIdToken({ sub: "s", audience: AUDIENCE, now: NOW });
  assert.equal(
    verifyMockIdToken(token, {
      jwks: idpB.jwks(),
      issuer: idpA.issuer,
      audience: AUDIENCE,
      now: NOW,
    }),
    null,
  );
});
