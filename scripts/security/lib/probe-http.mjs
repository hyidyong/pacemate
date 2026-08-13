// ONE bounded transport for every security-probe HTTP operation.
//
// Codex round 3, F1. The previous transport had three holes:
//
//   1. The deadline was cleared as soon as `fetch()` resolved — which is when
//      the response HEADERS arrive. Body consumption (`res.text()`) then ran
//      with no bound at all, so a server that sent headers and stalled the body
//      hung the probe indefinitely. During CLEANUP that is the worst possible
//      hang: fixtures stay alive in a live project.
//   2. The role probes in rls-probe.mjs (`rawFetch`) used bare `fetch` with no
//      timeout whatsoever.
//   3. verify-notification-rls.mjs used its own untimed client.
//
// Everything now goes through `boundedRequest`, whose single deadline covers
// DNS/connect → request → response headers → BODY CONSUMPTION → parse. The
// timer is cleared only after the body has been fully read, and the same
// AbortController governs both phases, so undici cancels a stalled body stream
// deterministically.
//
// The transport returns already-consumed text. Callers never receive a live
// stream, so there is no way to accidentally read a body outside the deadline.

export const DEFAULT_TIMEOUT_MS = 15_000;

export class ProbeRequestError extends Error {
  constructor(message, { status = null, timedOut = false, cause = null } = {}) {
    super(message);
    this.name = "ProbeRequestError";
    this.status = status;
    this.timedOut = timedOut;
    if (cause) this.cause = cause;
  }
}

/**
 * @returns {Promise<{status:number, headers:Headers, text:string}>}
 */
export async function boundedRequest(url, init = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  let timedOut = false;

  // A real AbortError, not a TimeoutError: Stage 8 learned that postgrest-js
  // and undici treat the two differently.
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException(`probe request exceeded ${timeoutMs}ms`, "AbortError"));
  }, timeoutMs);

  try {
    const res = await doFetch(url, { ...init, signal: controller.signal });
    // Still inside the same deadline — this is the line the old code missed.
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } catch (error) {
    if (timedOut || error?.name === "AbortError") {
      throw new ProbeRequestError(`request to ${url} exceeded ${timeoutMs}ms`, {
        timedOut: true,
        cause: error,
      });
    }
    throw new ProbeRequestError(`request to ${url} failed: ${error?.message ?? error}`, { cause: error });
  } finally {
    // Only now: the body is consumed or the attempt has failed.
    clearTimeout(timer);
  }
}

/** Parse helper that never throws on a non-JSON body. */
export function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Raw request as an arbitrary principal (anon key, or a user JWT). Used by the
 * attacker-role probes, which previously had no deadline at all.
 *
 * Base headers are merged UNDER the per-call ones so a per-call `Prefer` is
 * never dropped — an earlier version replaced them wholesale, which made a
 * successful INSERT look like a denial.
 */
export function createRoleClient({ url, baseHeaders, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl }) {
  const root = `${url.replace(/\/$/, "")}/rest/v1`;
  return async function request(path, init = {}) {
    const { status, text } = await boundedRequest(
      `${root}/${path}`,
      { ...init, headers: { ...baseHeaders, ...(init.headers ?? {}) } },
      { timeoutMs, fetchImpl },
    );
    return { status, body: parseBody(text) };
  };
}
