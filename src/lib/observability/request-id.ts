/**
 * Correlation id (Stage 8 P2, hardened after review finding 6).
 *
 * Nothing generated one before, so a failed booking could not be joined to its
 * middleware entry, its Supabase error, or a user report. Middleware mints one
 * per request and forwards it as a header; server components and actions read
 * it back and attach it to structured log lines.
 *
 * TRUST BOUNDARY: `x-pacemate-request-id` is our own internal header, but it
 * also arrives on INBOUND requests where the client controls it completely.
 * Adopting it verbatim would let a caller choose their own correlation id —
 * enough to forge log lines, deliberately collide with another request's id, or
 * inject newlines and quotes into a JSON log stream. It is therefore never
 * adopted from a client, only ever set by middleware.
 *
 * The platform's own id is reused when present so app logs correlate with
 * platform logs, but it is normalised to the safe charset first.
 */

export const REQUEST_ID_HEADER = "x-pacemate-request-id";
const VERCEL_REQUEST_ID_HEADER = "x-vercel-id";

const MAX_REQUEST_ID_LENGTH = 128;
// Deliberately narrow: safe to embed in a JSON log line and in a header value.
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

type HeaderReader = { get(name: string): string | null };

export function isSafeRequestId(value: unknown): value is string {
  return typeof value === "string" && SAFE_REQUEST_ID.test(value);
}

/**
 * Coerces a trusted-but-messy value (e.g. Vercel's `iad1::abc-123`) into the
 * safe charset. Returns null when nothing usable remains.
 */
export function normalizeRequestId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, MAX_REQUEST_ID_LENGTH);
  const meaningful = normalized.replace(/-/g, "");
  return meaningful.length ? normalized : null;
}

/**
 * Mints the id for a request. Called by middleware ONLY.
 *
 * Note what is deliberately absent: the inbound REQUEST_ID_HEADER is never
 * consulted. A client cannot pick its own correlation id.
 */
export function mintRequestId(headers: HeaderReader): string {
  const platformId = normalizeRequestId(headers.get(VERCEL_REQUEST_ID_HEADER));
  if (platformId) {
    return platformId;
  }
  return crypto.randomUUID();
}

/**
 * Reads the id that middleware set, for attaching to log lines. Returns
 * undefined rather than a suspect value: a log line with no requestId is
 * better than one carrying attacker-chosen content.
 */
export function readRequestId(headers: HeaderReader): string | undefined {
  const value = headers.get(REQUEST_ID_HEADER);
  return isSafeRequestId(value) ? value : undefined;
}
