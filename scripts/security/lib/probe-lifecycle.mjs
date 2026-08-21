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
  // Called only after the ordinary cleanup pass when quiescence is ambiguous.
  // It must wait for the real mutation attempts (bounded), sweep the same run
  // again, and verify residue. The callback is deliberately separate from
  // `abortWork`: cancellation is a request, recovery is proof.
  recoverAmbiguous = null,
  abortWork = () => {},
  // Codex round 5, F5: resolves when every in-flight MUTATION has genuinely
  // settled. Supplied by the scope; without it the lifecycle can only wait for
  // the body, which is not the same thing.
  awaitMutations = null,
  timeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  quiesceTimeoutMs = DEFAULT_QUIESCE_TIMEOUT_MS,
  logger = console,
  onExit = (code) => process.exit(code),
  processRef = process,
}) {
  let cleanupPromise = null;
  let cleanupResult = null;
  let recoveryPromise = null;
  let recoveryResult = null;
  let signalsSeen = [];
  let bodySettled = null;
  let bodyOutcomeError = null;
  let quiesced = false;

  function includeBodyAmbiguity(stopped) {
    if (!bodyOutcomeError?.ambiguous || stopped?.ambiguous) return stopped;
    logger.error(
      "[quiesce] the body ended with an unacknowledged mutating request; forcing marker recovery",
    );
    return {
      ...stopped,
      ok: false,
      detail: `${stopped?.detail ?? "body stopped"}; mutating request outcome unacknowledged`,
      ambiguous: true,
    };
  }

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
  /**
   * Codex round 5, F5 amends this again. Round 4 waited for the BODY to stop,
   * which is the caller's async function. But the body stops the moment its
   * awaited wrapper rejects — and round 4's own deadline fix made the wrapper
   * reject independently of the underlying fetch. So:
   *
   *   abort -> wrapper rejects -> body returns -> quiesce says "stopped"
   *   -> cleanup deletes -> exit -> the server commits the create
   *
   * Waiting for the body is necessary and NOT sufficient. Quiesce now also
   * waits for the scope's registry of in-flight MUTATIONS to drain, which
   * tracks the underlying attempts rather than the wrappers.
   *
   * When either wait times out the run is AMBIGUOUS, and that is reported as a
   * distinct state — not as "clean anyway". The caller reacts by forcing the
   * marker sweep and failing the run: a late commit is then still found, and
   * nothing claims success it cannot support.
   */
  /**
   * The happy path: do NOT cancel anything, just wait for outstanding mutations
   * to settle. Cancelling here would abort work that is completing normally.
   */
  async function quiesceNormally() {
    if (typeof awaitMutations !== "function") {
      return {
        ok: true,
        detail: "no mutation registry",
        ambiguous: false,
        bodyStopped: true,
        mutationsSettled: true,
      };
    }
    const drained = await awaitMutations(quiesceTimeoutMs);
    if (drained?.ok) {
      return {
        ok: true,
        detail: "all mutations settled",
        ambiguous: false,
        bodyStopped: true,
        mutationsSettled: true,
      };
    }
    const unacknowledged = Number(drained?.ambiguous ?? 0);
    const outstanding = drained?.outstanding ?? "?";
    logger.error(
      unacknowledged > 0
        ? `[quiesce] ${unacknowledged} mutation outcome(s) remain unacknowledged;` +
            " forcing marker recovery"
        : `[quiesce] ${outstanding} mutation(s) still in flight at the end of the run;` +
            " a late commit is possible, so this run cannot be reported clean",
    );
    return {
      ok: false,
      detail:
        unacknowledged > 0
          ? `${unacknowledged} mutation outcome(s) unacknowledged`
          : `${outstanding} mutation(s) unsettled`,
      ambiguous: true,
      bodyStopped: true,
      mutationsSettled: outstanding === 0,
    };
  }

  let quiescePromise = null;
  async function quiesce(reason) {
    // One shared promise, not a boolean race: two signals arriving together
    // must await the SAME quiesce rather than one of them skipping it.
    if (quiescePromise) return quiescePromise;
    quiescePromise = (async () => {
      quiesced = true;
      try {
        abortWork(`${reason}: probe interrupted`);
      } catch (error) {
        logger.error(`[quiesce] abort failed: ${error?.message ?? error}`);
      }

      const problems = [];
      let bodyStopped = true;
      let mutationsSettled = true;

      // 1. The body: the caller's own async function.
      if (bodySettled) {
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
            problems.push("body did not quiesce");
            bodyStopped = false;
          }
        } finally {
          clearTimeout(timer);
        }
      }

      // 2. The network: mutations whose underlying attempt has not settled.
      //    This is the one the wrapper cannot answer.
      if (typeof awaitMutations === "function") {
        const drained = await awaitMutations(quiesceTimeoutMs);
        if (!drained?.ok) {
          const unacknowledged = Number(drained?.ambiguous ?? 0);
          const outstanding = drained?.outstanding ?? "?";
          if (unacknowledged > 0) {
            logger.error(
              `[quiesce] ${unacknowledged} mutation outcome(s) remain unacknowledged; ` +
                "forcing marker recovery",
            );
          }
          if (unacknowledged === 0) {
            logger.error(
              `[quiesce] ${drained?.outstanding ?? "?"} mutation(s) still in flight after ` +
                `${quiesceTimeoutMs}ms — a late commit is possible; forcing marker recovery`,
            );
          }
          problems.push(
            unacknowledged > 0
              ? `${unacknowledged} mutation outcome(s) unacknowledged`
              : `${outstanding} mutation(s) unsettled`,
          );
          mutationsSettled = outstanding === 0;
        }
      }

      return problems.length === 0
        ? {
            ok: true,
            detail: "body stopped and all mutations settled",
            ambiguous: false,
            bodyStopped,
            mutationsSettled,
          }
        : {
            ok: false,
            detail: problems.join("; "),
            ambiguous: true,
            bodyStopped,
            mutationsSettled,
          };
    })();
    return quiescePromise;
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

  async function runRecoveryOnce(reason, stopped) {
    if (!stopped?.ambiguous) return { ok: true, detail: "no ambiguity recovery needed" };
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      if (typeof recoverAmbiguous !== "function") {
        recoveryResult = {
          ok: false,
          detail: `${stopped.detail}; no ambiguity recovery callback is installed`,
        };
        return recoveryResult;
      }
      try {
        recoveryResult = await recoverAmbiguous({ reason, quiesce: stopped });
      } catch (error) {
        recoveryResult = { ok: false, detail: error?.message ?? String(error) };
      }
      return recoveryResult ?? { ok: false, detail: "ambiguity recovery returned no result" };
    })();
    return recoveryPromise;
  }

  async function cleanupAndRecover(reason, stopped) {
    const initial = await runCleanupOnce(reason);
    if (!stopped?.ambiguous) return initial;

    const recovered = await runRecoveryOnce(reason, stopped);
    cleanupResult = recovered.ok
      ? {
          ...recovered,
          detail: `${initial?.detail ?? "initial cleanup complete"}; ${recovered.detail ?? "ambiguity recovered"}`,
        }
      : {
          ...recovered,
          ok: false,
          detail: `${initial?.detail ?? "initial cleanup complete"}; ${recovered.detail ?? stopped.detail}`,
        };
    return cleanupResult;
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
      const stopped = includeBodyAmbiguity(await quiesce("probe:cancel"));
      const result = await cleanupAndRecover("probe:cancel", stopped);
      const ok = Boolean(result?.ok);
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
          const stopped = includeBodyAmbiguity(await quiesce(signal));
          const result = await cleanupAndRecover(signal, stopped);
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
      bodyOutcomeError = null;
      let value;
      // The body's settlement is tracked so a signal handler can WAIT for it
      // rather than racing it (4A). Never rejects: it records instead.
      bodySettled = (async () => {
        try {
          value = await body();
        } catch (error) {
          bodyError = error;
          bodyOutcomeError = error;
        }
      })();
      let stopped = {
        ok: true,
        detail: "not interrupted",
        ambiguous: false,
        bodyStopped: true,
        mutationsSettled: true,
      };
      try {
        await bodySettled;
        // Even on the happy path, a mutation whose wrapper timed out may still
        // be open. Quiescing here is what stops cleanup racing it.
        stopped = includeBodyAmbiguity(await quiesceNormally());
      } finally {
        await cleanupAndRecover(bodyError ? "error" : "normal", stopped);
        uninstall();
      }
      const result = cleanupResult ?? { ok: false, detail: "cleanup did not run" };
      return { value, bodyError, quiesce: stopped, cleanup: result };
    },
  };
}
