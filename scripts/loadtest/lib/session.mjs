import { createHmac } from "node:crypto";

// Mirrors src/lib/auth/demo-session.ts createDemoSessionToken so the harness can
// authenticate N virtual users without N GoTrue password grants (which would hit
// vendor auth rate limits and measure the wrong thing). The token is verified by
// the real server, and getDemoProfile still re-reads the profile row and
// cross-checks the role — a minted token cannot grant access the DB denies.
const SESSION_TTL_SECONDS = 60 * 60 * 8;
export const SESSION_COOKIE_NAME = "pacemate_session";

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function mintSessionToken({ profileId, role }, secret, now = Date.now()) {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("PACEMATE_SESSION_SECRET must be at least 32 bytes");
  }
  const issuedAt = Math.floor(now / 1000);
  const payloadSegment = encode(
    JSON.stringify({
      profileId,
      role,
      issuedAt,
      expiresAt: issuedAt + SESSION_TTL_SECONDS,
    }),
  );
  const signature = createHmac("sha256", secret).update(payloadSegment).digest("base64url");
  return `${payloadSegment}.${signature}`;
}

export function sessionCookieHeader(claims, secret) {
  return `${SESSION_COOKIE_NAME}=${mintSessionToken(claims, secret)}`;
}
