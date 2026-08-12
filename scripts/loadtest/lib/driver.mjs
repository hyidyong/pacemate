import { performance } from "node:perf_hooks";

// Closed-loop concurrency driver: `concurrency` workers each issue requests back
// to back until the iteration budget or duration is exhausted. Closed-loop (not
// open-loop arrival) is deliberate — it models N users each waiting for their
// page before acting again, which is what a university cohort actually does, and
// it cannot melt the live database with an unbounded queue.
export async function runClosedLoop({
  concurrency,
  iterations,
  durationMs,
  task,
  warmupIterations = 0,
  onSample,
}) {
  if (!concurrency || concurrency < 1) throw new Error("concurrency must be >= 1");
  if (!iterations && !durationMs) throw new Error("give iterations or durationMs");

  for (let i = 0; i < warmupIterations; i += 1) {
    await safeRun(task, { worker: -1, iteration: i, warmup: true });
  }

  const samples = [];
  let issued = 0;
  const deadline = durationMs ? performance.now() + durationMs : Infinity;
  const started = performance.now();

  async function worker(workerId) {
    for (;;) {
      if (iterations && issued >= iterations) return;
      if (performance.now() >= deadline) return;
      const iteration = issued;
      issued += 1;
      const sample = await safeRun(task, { worker: workerId, iteration, warmup: false });
      samples.push(sample);
      if (onSample) onSample(sample);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  return { samples, wallClockMs: performance.now() - started };
}

async function safeRun(task, ctx) {
  const start = performance.now();
  try {
    const result = (await task(ctx)) ?? {};
    return {
      ok: result.ok !== false,
      status: result.status ?? 0,
      durationMs: performance.now() - start,
      meta: result.meta,
      error: result.error,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: performance.now() - start,
      error: error?.name === "TimeoutError" ? "timeout" : (error?.code ?? error?.message ?? "error"),
    };
  }
}

// A GET against the running app with a minted session cookie.
export async function getPage(baseUrl, path, cookie, timeoutMs = 30000) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { cookie, "accept-language": "ko-KR" },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text();
  return {
    ok: res.status >= 200 && res.status < 400,
    status: res.status,
    meta: { bytes: body.length, location: res.headers.get("location") ?? undefined },
    body,
  };
}
