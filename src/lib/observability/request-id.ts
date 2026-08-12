/**
 * Correlation id (Stage 8 P2).
 *
 * Nothing generated one before, so a failed booking could not be joined to its
 * middleware entry, its Supabase error, or a user report. Middleware mints one
 * per request and forwards it as a header; server components and actions read
 * it back and attach it to every structured log line.
 *
 * The platform's own id is preferred when present so app logs correlate with
 * platform logs instead of carrying a second, unrelated identifier.
 */

export const REQUEST_ID_HEADER = "x-pacemate-request-id";
const VERCEL_REQUEST_ID_HEADER = "x-vercel-id";

type HeaderReader = { get(name: string): string | null };

export function resolveRequestId(headers: HeaderReader): string {
  return (
    headers.get(REQUEST_ID_HEADER) ??
    headers.get(VERCEL_REQUEST_ID_HEADER) ??
    crypto.randomUUID()
  );
}

/** Reads the id from an incoming request without minting a new one. */
export function readRequestId(headers: HeaderReader): string | undefined {
  return (
    headers.get(REQUEST_ID_HEADER) ?? headers.get(VERCEL_REQUEST_ID_HEADER) ?? undefined
  );
}
