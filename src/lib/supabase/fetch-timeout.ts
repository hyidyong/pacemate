/**
 * Bounded fetch for every Supabase client (Stage 8 P1-2).
 *
 * supabase-js applies no default timeout, so a hung PostgREST or GoTrue request
 * occupied the serverless invocation until the platform killed it — the
 * mechanism by which one slow dependency becomes a site-wide outage. Every
 * factory passes this as `global.fetch` so requests fail in a controlled way
 * first, surfacing through each call site's existing error path.
 *
 * No retry is added. Retrying a booking mutation is forbidden by D-013's
 * reasoning (a conflict retry is guaranteed to fail again) and would turn an
 * overload into a retry storm. Bounded failure only.
 */

// Comfortably above the measured p99 for the heaviest route (1196 ms at 10
// concurrent users, stage-08/SCALE_AUDIT.md §2) so legitimate slow requests are
// not severed, and below typical serverless function limits so the app fails
// before the platform does.
export const SUPABASE_REQUEST_TIMEOUT_MS = 10000;

export function createTimeoutFetch(timeoutMs: number = SUPABASE_REQUEST_TIMEOUT_MS): typeof fetch {
  return function timeoutFetch(input: RequestInfo | URL, init?: RequestInit) {
    // An explicit caller signal wins; otherwise bound the request. AbortSignal.any
    // keeps both live so a caller cancellation still propagates.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

    return fetch(input, { ...init, signal });
  };
}
