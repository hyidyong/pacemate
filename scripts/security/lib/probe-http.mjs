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
  constructor(message, { status = null, timedOut = false, ambiguous = false, cause = null } = {}) {
    super(message);
    this.name = "ProbeRequestError";
    this.status = status;
    this.timedOut = timedOut;
    /**
     * Codex round 4, 4C. True when the request MAY have reached the server and
     * committed, but we never learned the outcome — a timeout or a transport
     * failure on a mutating verb. "It failed" and "I do not know" are different
     * answers, and only one of them means nothing was created.
     */
    this.ambiguous = ambiguous;
    if (cause) this.cause = cause;
  }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Codex round 4, 4A — ONE cancellation scope shared by every request a probe
 * has in flight.
 *
 * Without it, a SIGINT started destructive cleanup while a create request was
 * still on the wire; that request could then commit AFTER cleanup had already
 * looked, leaving a resource behind that residue verification had no reason to
 * re-check. Cancelling the scope first means every outstanding request is
 * aborted before anything is deleted.
 *
 * Cleanup deliberately does NOT run inside the scope — it needs a live
 * transport precisely when the work scope has been cancelled.
 */
export function createAbortScope() {
  const controller = new AbortController();

  /**
   * Codex round 5, F5 — THE WRAPPER SETTLING IS NOT THE OPERATION ENDING.
   *
   * Round 4 made the deadline independent of the transport, which fixed hangs
   * but introduced a subtler problem for CLEANUP: `Promise.race` rejects the
   * caller's promise while the underlying fetch is still open. So:
   *
   *   abort -> wrapper rejects -> quiesce sees "nothing in flight" ->
   *   cleanup deletes -> process exits -> the server commits the create
   *
   * and the row outlives a run that reported clean. Aborting an AbortController
   * asks the transport to stop; it does not prove the server did not already
   * process the request.
   *
   * So every MUTATING request registers its underlying attempt here and stays
   * registered until that attempt actually settles — not until the wrapper
   * gives up. Cleanup waits on this registry. If an attempt will not settle,
   * the run enters ambiguity recovery: it cannot claim clean, and the marker
   * sweep runs regardless so a late commit is still found.
   *
   * Reads are not tracked: a GET that never returned created nothing.
   */
  const inFlight = new Set();
  // A transport rejection does not prove the server rejected the mutation.
  // Keep that uncertainty after the client Promise leaves `inFlight`; only a
  // later successful response from the SAME underlying attempt can clear it.
  const ambiguous = new Set();
  const waiters = new Set();
  const notify = () => {
    for (const waiter of [...waiters]) waiter();
  };

  return {
    get signal() {
      return controller.signal;
    },
    get aborted() {
      return controller.signal.aborted;
    },
    get pendingMutations() {
      return inFlight.size;
    },
    get ambiguousMutations() {
      return ambiguous.size;
    },
    /** Register an underlying attempt and expose its outcome to the scope. */
    trackMutation(attempt) {
      const entry = { attempt, outcome: "pending" };
      inFlight.add(entry);
      attempt.then(
        () => {
          entry.outcome = "fulfilled";
          inFlight.delete(entry);
          // A real response proves the server-side attempt completed. This is
          // the only outcome that releases a previously latched ambiguity.
          ambiguous.delete(entry);
          notify();
        },
        () => {
          entry.outcome = "rejected";
          inFlight.delete(entry);
          // If the wrapper already classified this mutation as ambiguous, the
          // rejection leaves the latch in place: no response proved the result.
          notify();
        },
      );
      return entry;
    },
    markMutationAmbiguous(entry) {
      if (!entry || entry.outcome === "fulfilled") return;
      entry.ambiguousSince ??= Date.now();
      ambiguous.add(entry);
      notify();
    },
    /**
     * Resolves when every tracked mutation has genuinely settled, or rejects
     * once `timeoutMs` passes with work still outstanding. The rejection is the
     * signal to enter ambiguity recovery — never to assume the work is over.
     */
    async settled(timeoutMs) {
      if (inFlight.size === 0 && ambiguous.size === 0) {
        return { ok: true, outstanding: 0 };
      }
      return new Promise((resolve) => {
        const inFlightDeadline = Date.now() + timeoutMs;
        let finished = false;
        let timer;
        const finish = (result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(result);
        };
        const expire = () =>
          finish({
            ok: false,
            outstanding: inFlight.size,
            ambiguous: ambiguous.size,
          });
        const check = () => {
          if (inFlight.size === 0 && ambiguous.size === 0) {
            finish({ ok: true, outstanding: 0 });
            return;
          }
          // Repeated settled() calls share the original ambiguity window. A
          // normal quiesce pass followed by exact-run recovery must not restart
          // the full grace period and turn 30 seconds into 40.
          const ambiguityDeadline = Math.max(
            0,
            ...[...ambiguous].map((entry) => entry.ambiguousSince + timeoutMs),
          );
          const deadline = ambiguous.size > 0 ? ambiguityDeadline : inFlightDeadline;
          clearTimeout(timer);
          timer = setTimeout(expire, Math.max(0, deadline - Date.now()));
        };
        waiters.add(check);
        check();
      });
    },
    abort(reason = "probe scope cancelled") {
      if (!controller.signal.aborted) {
        controller.abort(new DOMException(String(reason), "AbortError"));
      }
    },
  };
}

/**
 * @returns {Promise<{status:number, headers:Headers, text:string}>}
 */
export async function boundedRequest(
  url,
  init = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl, scopeSignal, scope } = {},
) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const method = String(init.method ?? "GET").toUpperCase();
  let timedOut = false;
  let trackedMutation = null;

  // Codex round 4, 4B. The deadline must NOT depend on the transport
  // co-operating. Aborting the controller only helps if whatever implements
  // `fetch` actually honours the signal; a transport that ignores it — or a
  // body stream that never settles — leaves the `await` hanging forever with
  // the timer already fired. That is precisely the failure this deadline exists
  // to prevent, so the timeout is ALSO raced independently of the abort.
  //
  // Established first, because both the timer and the scope listener below can
  // fire it.
  let rejectDeadline = () => {};
  const deadline = new Promise((_resolve, reject) => {
    rejectDeadline = reject;
  });
  // The deadline promise is always raced, so it must never be an unhandled
  // rejection in the paths where the attempt wins.
  deadline.catch(() => {});

  // A real AbortError, not a TimeoutError: Stage 8 learned that postgrest-js
  // and undici treat the two differently.
  const timer = setTimeout(() => {
    timedOut = true;
    const reason = new DOMException(`probe request exceeded ${timeoutMs}ms`, "AbortError");
    controller.abort(reason);
    rejectDeadline(reason);
  }, timeoutMs);

  // The scope can cancel this request too. AbortSignal.any() is not assumed to
  // exist on every Node the harness may run on, so the link is explicit.
  const cancelledReason = () =>
    scopeSignal?.reason ?? new DOMException("probe scope cancelled", "AbortError");
  const onScopeAbort = () => {
    controller.abort(cancelledReason());
    rejectDeadline(cancelledReason());
  };
  if (scopeSignal) {
    if (scopeSignal.aborted) onScopeAbort();
    else scopeSignal.addEventListener("abort", onScopeAbort, { once: true });
  }

  try {
    const attempt = (async () => {
      const res = await doFetch(url, { ...init, signal: controller.signal });
      // Still inside the same deadline — this is the line the old code missed.
      const text = await res.text();
      return { status: res.status, headers: res.headers, text };
    })();
    // A transport that never settles cannot outlive the deadline.
    attempt.catch(() => {});
    // Codex round 5, F5: the wrapper below may reject on the deadline while
    // THIS attempt is still open and can still commit. Registering it means
    // cleanup waits for the real thing, not for our own giving up. Reads are
    // not registered — a GET that never returned created nothing.
    if (scope && MUTATING.has(method)) trackedMutation = scope.trackMutation(attempt);
    return await Promise.race([attempt, deadline]);
  } catch (error) {
    // A mutating verb that never returned may still have committed.
    const ambiguous = MUTATING.has(method);
    if (ambiguous && scope) scope.markMutationAmbiguous(trackedMutation);
    if (timedOut || error?.name === "AbortError") {
      throw new ProbeRequestError(`request to ${url} exceeded ${timeoutMs}ms`, {
        timedOut: true,
        ambiguous,
        cause: error,
      });
    }
    throw new ProbeRequestError(`request to ${url} failed: ${error?.message ?? error}`, {
      ambiguous,
      cause: error,
    });
  } finally {
    // Only now: the body is consumed or the attempt has failed.
    clearTimeout(timer);
    if (scopeSignal) scopeSignal.removeEventListener("abort", onScopeAbort);
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
export function createRoleClient({
  url,
  baseHeaders,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl,
  scopeSignal,
  scope,
}) {
  const root = `${url.replace(/\/$/, "")}/rest/v1`;
  return async function request(path, init = {}) {
    const { status, text } = await boundedRequest(
      `${root}/${path}`,
      { ...init, headers: { ...baseHeaders, ...(init.headers ?? {}) } },
      { timeoutMs, fetchImpl, scopeSignal, scope },
    );
    return { status, body: parseBody(text) };
  };
}
