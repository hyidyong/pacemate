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
 */
export function createProbeLifecycle({
  cleanup,
  timeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  logger = console,
  onExit = (code) => process.exit(code),
  processRef = process,
}) {
  let cleanupPromise = null;
  let cleanupResult = null;
  let signalsSeen = [];

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
  function install() {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        signalsSeen.push(signal);
        logger.error(`\n[${signal}] interrupted — cleaning up before exit; do not kill -9`);
        void (async () => {
          const result = await runCleanupOnce(signal);
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
      try {
        value = await body();
      } catch (error) {
        bodyError = error;
      } finally {
        await runCleanupOnce(bodyError ? "error" : "normal");
        uninstall();
      }
      return { value, bodyError, cleanup: cleanupResult ?? { ok: false, detail: "cleanup did not run" } };
    },
  };
}
