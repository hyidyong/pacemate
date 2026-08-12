/**
 * Bounded fetch for every Supabase client (Stage 8 P1-2, corrected after review).
 *
 * supabase-js applies no default timeout, so a hung PostgREST or GoTrue request
 * occupied the serverless invocation until the platform killed it.
 *
 * The first implementation created a fresh `AbortSignal.timeout` per fetch CALL,
 * which was wrong in two ways that only show up at SDK level:
 *
 *  1. `AbortSignal.timeout()` rejects with a DOMException named `TimeoutError`
 *     (code 23). postgrest-js 2.110.1 decides whether to retry with
 *     `err.name === "AbortError" || err.code === "ABORT_ERR"`, so a TimeoutError
 *     was NOT recognised as an abort and was retried as a network error
 *     (retryEnabled defaults to true, DEFAULT_MAX_RETRIES = 3, backoff 1s/2s/4s
 *     on GET/HEAD/OPTIONS). One hung GET became FOUR requests over ~47s against
 *     a 10s documented bound — amplifying load on an already-struggling
 *     database. Measured: 4 calls / 8.3s against a 300ms budget.
 *  2. Even where an SDK retries deliberately (auth-js `_refreshAccessToken`
 *     wraps attempts in `retryable()` with backoff bounded by
 *     AUTO_REFRESH_TICK_DURATION_MS = 30s), each attempt received a fresh full
 *     timeout, so the effective bound was per-attempt, not total.
 *
 * This version therefore (a) aborts with a real `AbortError` so SDKs stop
 * retrying, and (b) shares ONE deadline across consecutive attempts to the same
 * endpoint, so a retry chain cannot multiply the bound.
 *
 * No retry is added here. Retrying a booking mutation is forbidden by D-013's
 * reasoning (a conflict retry is guaranteed to fail again) and would turn
 * overload into a retry storm. Bounded failure only.
 */

// Comfortably above the measured p99 for the heaviest route (1196 ms at 10
// concurrent users, stage-08/SCALE_AUDIT.md §2) so legitimate slow requests are
// not severed, and below typical serverless function limits so the app fails
// before the platform does.
export const SUPABASE_REQUEST_TIMEOUT_MS = 10000;

function abortError(timeoutMs: number) {
  // Named AbortError on purpose: this is the reason string the Supabase SDKs
  // check to decide that a request was deliberately cancelled and must NOT be
  // retried. See the header comment.
  return new DOMException(
    `Supabase request exceeded the ${timeoutMs}ms budget`,
    "AbortError",
  );
}

function burstKeyFor(input: RequestInfo | URL, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return `${method} ${url}`;
}

export function createTimeoutFetch(timeoutMs: number = SUPABASE_REQUEST_TIMEOUT_MS): typeof fetch {
  // Burst state lives in this closure, i.e. per client instance. Server clients
  // are constructed per call, so this never leaks between requests; the SDK
  // retry chains this exists to bound all happen within one client's lifetime.
  const burstDeadlines = new Map<string, number>();

  return function timeoutFetch(input: RequestInfo | URL, init?: RequestInit) {
    const key = burstKeyFor(input, init);
    const now = Date.now();
    let deadline = burstDeadlines.get(key);

    // Start a new burst when there is none, or when the previous burst AND its
    // equal-length cool-off have fully elapsed. The cool-off is what stops an
    // SDK retry chain from immediately claiming a fresh full budget; it is
    // backpressure against an endpoint that just proved unhealthy, not a kill
    // switch — a genuinely later request starts clean.
    if (deadline === undefined || now >= deadline + timeoutMs) {
      deadline = now + timeoutMs;
      burstDeadlines.set(key, deadline);
      pruneExpired(burstDeadlines, now, timeoutMs);
    }

    const remaining = deadline - now;
    if (remaining <= 0) {
      return Promise.reject(abortError(timeoutMs));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(abortError(timeoutMs)), remaining);
    // An explicit caller signal still wins; AbortSignal.any keeps both live so a
    // caller cancellation propagates with its own reason.
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;

    return fetch(input, { ...init, signal })
      .then((response) => {
        // The endpoint answered, so the burst is over: the next request to it
        // deserves a full budget.
        burstDeadlines.delete(key);
        return response;
      })
      .finally(() => {
        clearTimeout(timer);
      });
  };
}

// Keeps the map from growing unbounded on long-lived clients (the browser
// singleton). Entries past their burst and cool-off carry no meaning.
function pruneExpired(deadlines: Map<string, number>, now: number, timeoutMs: number) {
  if (deadlines.size < 64) return;
  for (const [key, deadline] of deadlines) {
    if (now >= deadline + timeoutMs) deadlines.delete(key);
  }
}
