// Once-only, signal-aware cleanup for probes that mutate a live project.
//
// Codex round 3, F1. `try/finally` covers a thrown error and a normal exit. It
// does NOT cover Ctrl-C or a `kill` from a CI runner — and those are exactly the
// moments an operator interrupts a probe that seems stuck, leaving fixtures and
// Auth users alive in a live project.
//
// Guarantees:
//
//   * cleanup runs exactly once, whether reached by normal completion, by a
//     thrown error, by SIGINT, by SIGTERM, or by several of those at once;
//   * a second signal while cleanup is in flight does NOT start a second
//     destructive pass — it is noted and the first pass is awaited;
//   * cleanup failure is failure: the process exits non-zero even if every
//     security assertion passed;
//   * the process does not exit before cleanup finishes, bounded by a deadline
//     so a hung cleanup cannot hang the runner forever;
//   * signal listeners and timers are removed in `finally`.
//
// NOT CLAIMED: SIGKILL, `kill -9`, a host OOM kill or power loss. No in-process
// mechanism can run then. The recovery path for those is the operator-run
// `--sweep`, which is a separate, tested entry point.

export const DEFAULT_CLEANUP_TIMEOUT_MS = 30_000;
export const DEFAULT_QUIESCE_TIMEOUT_MS = 10_000;

export const EXIT = {
  ok: 0,
  failure: 1,
  sigint: 130,
  sigterm: 143,
};

/**
 * @param {object} options
 * @param {() => Promise<{ok: boolean, detail?: string}>} options.cleanup
 *        Must be idempotent-safe: it is called at most once by this helper.
 * @param {() => void} [options.abortWork]
 *        Cancels the shared request scope. Called FIRST on a signal, before any
 *        destructive cleanup — see the quiesce note below.
 */
export function createProbeLifecycle({
  cleanup,
  abortWork = () => {},
  timeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  quiesceTimeoutMs = DEFAULT_QUIESCE_TIMEOUT_MS,
  logger = console,
  onExit = (code) => process.exit(code),
  processRef = process,
}) {
  let cleanupPromise = null;
  let cleanupResult = null;
  let signalsSeen = [];
  let bodySettled = null;
  let quiesced = false;

  /**
   * Codex round 4, 4A — QUIESCE BEFORE DESTROYING.
   *
   * The previous handler called cleanup the moment a signal arrived, while the
   * probe body was still running. A create request already on the wire could
   * therefore commit AFTER cleanup had enumerated and deleted, leaving a
   * resource alive that nothing would look at again. Ordering now:
   *
   *   1. cancel the shared request scope, so every in-flight request aborts;
   *   2. wait, bounded, for the body to actually stop;
   *   3. only then run the destructive pass.
   *
   * The wait is bounded because a body that refuses to settle must not prevent
   * cleanup entirely — a late cleanup beats none. If the wait times out that is
   * reported, not swallowed.
   */
  async function quiesce(reason) {
    if (quiesced) return { ok: true, detail: "already quiesced" };
    quiesced = true;
    try {
      abortWork(`${reason}: probe interrupted`);
    } catch (error) {
      logger.error(`[quiesce] abort failed: ${error?.message ?? error}`);
    }
    if (!bodySettled) return { ok: true, detail: "no body in flight" };

    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), quiesceTimeoutMs);
    });
    try {
      const outcome = await Promise.race([bodySettled.then(() => "settled"), deadline]);
      if (outcome === "timeout") {
        logger.error(
          `[quiesce] the probe body did not stop within ${quiesceTimeoutMs}ms; cleaning up anyway`,
        );
        return { ok: false, detail: "body did not quiesce" };
      }
      return { ok: true, detail: "body stopped" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function runCleanupOnce(reason) {
    if (cleanupPromise) {
      logger.error(`[cleanup] already in progress (${reason}); awaiting the first pass`);
      return cleanupPromise;
    }
    cleanupPromise = (async () => {
      let timer;
      try {
        const bounded = new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`cleanup exceeded ${timeoutMs}ms`)),
            timeoutMs,
          );
        });
        const result = await Promise.race([cleanup(reason), bounded]);
        cleanupResult = result ?? { ok: true };
      } catch (error) {
        cleanupResult = { ok: false, detail: error?.message ?? String(error) };
      } finally {
        clearTimeout(timer);
      }
      return cleanupResult;
    })();
    return cleanupPromise;
  }

  const handlers = new Map();

  /**
   * Codex round 4, 4E — a cancellation path that WORKS ON WINDOWS.
   *
   * Node on Windows cannot deliver SIGINT/SIGTERM to a child process:
   * `child.kill()` maps to TerminateProcess, which is closer to SIGKILL and
   * runs no in-process handler. That left the quiesce-then-cleanup path
   * untestable there, and "skipped" is not "proven".
   *
   * When the runner is started with an IPC channel, a `probe:cancel` message
   * drives the SAME path a signal drives — abort the scope, wait for the body,
   * clean up, exit. So the control is exercised end to end in a real child
   * process on every platform, and only the POSIX signal DELIVERY mechanism
   * remains platform-specific.
   *
   * Reachability: `process.on("message")` fires only when the parent created an
   * IPC channel, i.e. from a process that already fully controls this one. It
   * adds no surface for anyone else.
   */
  function messageHandler(message) {
    const type = typeof message === "string" ? message : message?.type;
    if (type !== "probe:cancel") return;
    signalsSeen.push("MESSAGE");
    logger.error("\n[probe:cancel] cancellation requested — quiescing, then cleaning up");
    void (async () => {
      const stopped = await quiesce("probe:cancel");
      const result = await runCleanupOnce("probe:cancel");
      const ok = Boolean(result?.ok) && stopped.ok;
      if (!ok) {
        logger.error(`[cleanup] FAILED after probe:cancel: ${result?.detail ?? stopped.detail}`);
      }
      onExit(ok ? EXIT.sigint : EXIT.failure);
    })();
  }

  function install() {
    // Only when a channel actually exists.
    if (typeof processRef.on === "function" && processRef.send) {
      processRef.on("message", messageHandler);
      handlers.set("message", messageHandler);
    }
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        signalsSeen.push(signal);
        logger.error(`\n[${signal}] interrupted — quiescing, then cleaning up; do not kill -9`);
        void (async () => {
          // 4A: stop the work before destroying anything it may still create.
          const stopped = await quiesce(signal);
          const result = await runCleanupOnce(signal);
          if (!stopped.ok && result?.ok) {
            // Cleanup looked clean, but we could not prove the body had
            // stopped, so we cannot prove nothing was created after it ran.
            result.ok = false;
            result.detail = `${result.detail ?? "clean"}; but ${stopped.detail}`;
          }
          const code = result?.ok
            ? signal === "SIGINT"
              ? EXIT.sigint
              : EXIT.sigterm
            : EXIT.failure;
          if (!result?.ok) {
            logger.error(`[cleanup] FAILED after ${signal}: ${result?.detail ?? "unknown"}`);
          }
          onExit(code);
        })();
      };
      handlers.set(signal, handler);
      processRef.on(signal, handler);
    }
  }

  function uninstall() {
    for (const [signal, handler] of handlers) processRef.removeListener(signal, handler);
    handlers.clear();
  }

  return {
    get signalsSeen() {
      return [...signalsSeen];
    },
    get cleanupResult() {
      return cleanupResult;
    },
    /**
     * Runs `body`, then always runs cleanup exactly once. Returns the cleanup
     * outcome alongside the body's, so the caller can fail the run on either.
     */
    async run(body) {
      install();
      let bodyError = null;
      let value;
      // The body's settlement is tracked so a signal handler can WAIT for it
      // rather than racing it (4A). Never rejects: it records instead.
      bodySettled = (async () => {
        try {
          value = await body();
        } catch (error) {
          bodyError = error;
        }
      })();
      try {
        await bodySettled;
      } finally {
        await runCleanupOnce(bodyError ? "error" : "normal");
        uninstall();
      }
      return { value, bodyError, cleanup: cleanupResult ?? { ok: false, detail: "cleanup did not run" } };
    },
  };
}
