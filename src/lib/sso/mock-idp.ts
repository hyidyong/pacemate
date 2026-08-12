// Stage 7 (SSO readiness) — deterministic in-process mock identity provider.
//
// TEST-ONLY. This module is imported exclusively by *.test.mjs files — a
// source-guard test (sso-wiring.test.mjs) fails the suite if any application
// module ever imports it, and no route, env flag, or registry entry type can
// activate it. Dev/prod separation is structural, not configurational
// (SSO_DESIGN §12): production security is never weakened for the mock.
//
// It mints REAL RS256-signed ID tokens with per-instance keypairs and
// exposes a JWKS plus an "evil twin" signer, so tests can prove that
// signature, issuer, audience, and expiry verification actually bite —
// the protocol checks GoTrue performs vendor-side in production.
//
// Clock is injectable everywhere (the createDemoSessionToken(claims, now)
// precedent) so every scenario is reproducible.

import {
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type MockIdTokenClaims = {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean;
  affiliation?: string;
  name?: string;
  nonce?: string;
};

export type MockMintOptions = {
  sub: string;
  audience: string;
  email?: string;
  emailVerified?: boolean;
  affiliation?: string;
  name?: string;
  nonce?: string;
  now?: number;
  expiresInSeconds?: number;
  // Negative-path knobs:
  useWrongKey?: boolean;
  issuerOverride?: string;
};

function base64UrlEncodeJson(value: JsonRecord): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function base64UrlDecodeJson(segment: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as JsonRecord;
  } catch {
    return null;
  }
}

export function createMockIdentityProvider(options: { issuer: string; keyId?: string }) {
  const issuer = options.issuer;
  const keyId = options.keyId ?? "mock-idp-key-1";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const evilTwin = generateKeyPairSync("rsa", { modulusLength: 2048 });

  function signToken(header: JsonRecord, payload: JsonRecord, key: KeyObject): string {
    const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
    const signature = createSign("RSA-SHA256").update(signingInput).sign(key);
    return `${signingInput}.${signature.toString("base64url")}`;
  }

  return {
    issuer,
    keyId,
    jwks(): { keys: JsonRecord[] } {
      const jwk = publicKey.export({ format: "jwk" }) as JsonRecord;
      return { keys: [{ ...jwk, kid: keyId, alg: "RS256", use: "sig" }] };
    },
    mintIdToken(mint: MockMintOptions): string {
      const nowSeconds = Math.floor((mint.now ?? Date.now()) / 1000);
      const payload: MockIdTokenClaims = {
        iss: mint.issuerOverride ?? issuer,
        sub: mint.sub,
        aud: mint.audience,
        iat: nowSeconds,
        exp: nowSeconds + (mint.expiresInSeconds ?? 300),
      };
      if (mint.email !== undefined) payload.email = mint.email;
      if (mint.emailVerified !== undefined) payload.email_verified = mint.emailVerified;
      if (mint.affiliation !== undefined) payload.affiliation = mint.affiliation;
      if (mint.name !== undefined) payload.name = mint.name;
      if (mint.nonce !== undefined) payload.nonce = mint.nonce;

      const header: JsonRecord = { alg: "RS256", typ: "JWT", kid: keyId };
      const key = mint.useWrongKey ? evilTwin.privateKey : privateKey;
      return signToken(header, payload as unknown as JsonRecord, key);
    },
  };
}

export type MockVerifyOptions = {
  jwks: { keys: JsonRecord[] };
  issuer: string;
  audience: string;
  now?: number;
  clockSkewSeconds?: number;
};

// Reference verifier used by tests to demonstrate which checks reject which
// forgeries (signature, issuer, audience, expiry, not-yet-issued). Returns
// the claims on success, null on ANY failure — fail closed, no partials.
export function verifyMockIdToken(
  token: string,
  options: MockVerifyOptions,
): MockIdTokenClaims | null {
  try {
    const segments = token.split(".");
    if (segments.length !== 3) return null;
    const [headerSegment, payloadSegment, signatureSegment] = segments;

    const header = base64UrlDecodeJson(headerSegment);
    const payload = base64UrlDecodeJson(payloadSegment);
    if (!header || !payload) return null;
    if (header.alg !== "RS256") return null;

    const jwk = options.jwks.keys.find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const publicKey = createPublicKey({
      key: jwk as unknown as import("node:crypto").JsonWebKey,
      format: "jwk",
    });

    const signingInput = `${headerSegment}.${payloadSegment}`;
    const signatureValid = createVerify("RSA-SHA256")
      .update(signingInput)
      .verify(publicKey, Buffer.from(signatureSegment, "base64url"));
    if (!signatureValid) return null;

    const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
    const skew = options.clockSkewSeconds ?? 60;

    if (payload.iss !== options.issuer) return null;
    if (payload.aud !== options.audience) return null;
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
    if (typeof payload.iat !== "number" || payload.iat > nowSeconds + skew) return null;

    return payload as unknown as MockIdTokenClaims;
  } catch {
    return null;
  }
}
