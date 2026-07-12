import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const DEMO_SESSION_COOKIE = "pacemate_session";
const LEGACY_PROFILE_COOKIE = "pacemate_profile_id";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type DemoSessionRole = "student" | "professor" | "assistant" | "admin";

export type DemoSession = {
  profileId: string;
  role: DemoSessionRole;
  issuedAt: number;
  expiresAt: number;
};

type SessionClaims = Pick<DemoSession, "profileId" | "role">;

function getSessionSecret() {
  const secret = process.env.PACEMATE_SESSION_SECRET;

  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("PACEMATE_SESSION_SECRET must be at least 32 bytes");
  }

  return secret;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payloadSegment: string) {
  return createHmac("sha256", getSessionSecret())
    .update(payloadSegment)
    .digest("base64url");
}

function hasValidSignature(payloadSegment: string, signature: string) {
  const expected = Buffer.from(sign(payloadSegment), "base64url");
  const actual = Buffer.from(signature, "base64url");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isSessionRole(value: unknown): value is DemoSessionRole {
  return (
    value === "student" ||
    value === "professor" ||
    value === "assistant" ||
    value === "admin"
  );
}

export function createDemoSessionToken(claims: SessionClaims, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const payload: DemoSession = {
    profileId: claims.profileId,
    role: claims.role,
    issuedAt,
    expiresAt,
  };
  const payloadSegment = encode(JSON.stringify(payload));

  return `${payloadSegment}.${sign(payloadSegment)}`;
}

export function verifyDemoSessionToken(token: string, now = Date.now()): DemoSession | null {
  const [payloadSegment, signature, ...extraSegments] = token.split(".");

  if (!payloadSegment || !signature || extraSegments.length > 0) {
    return null;
  }

  try {
    if (!hasValidSignature(payloadSegment, signature)) {
      return null;
    }

    const payload = JSON.parse(decode(payloadSegment)) as Partial<DemoSession>;
    const currentTime = Math.floor(now / 1000);

    if (
      typeof payload.profileId !== "string" ||
      !payload.profileId ||
      !isSessionRole(payload.role) ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= currentTime ||
      payload.issuedAt > currentTime + 60
    ) {
      return null;
    }

    return {
      profileId: payload.profileId,
      role: payload.role,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

export async function createDemoSession(claims: SessionClaims) {
  const cookieStore = await cookies();
  const token = createDemoSessionToken(claims);

  cookieStore.set(DEMO_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  cookieStore.delete(LEGACY_PROFILE_COOKIE);
  cookieStore.delete("pacemate_role");
}

export async function readDemoSession(): Promise<DemoSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEMO_SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  return verifyDemoSessionToken(token);
}

export async function requireDemoSession() {
  const session = await readDemoSession();

  if (!session) {
    throw new Error("Unauthenticated demo session");
  }

  return session;
}

export async function destroyDemoSession() {
  const cookieStore = await cookies();
  cookieStore.delete(DEMO_SESSION_COOKIE);
  cookieStore.delete(LEGACY_PROFILE_COOKIE);
  cookieStore.delete("pacemate_role");
}

export const demoSessionCookieName = DEMO_SESSION_COOKIE;
