// Latency/throughput summary. Percentiles use nearest-rank on the sorted sample,
// which is exact for the sample (no interpolation guesswork in reported numbers).
export function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const rank = Math.ceil((p / 100) * sortedValues.length);
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, rank - 1))];
}

export function summarize(samples, wallClockMs) {
  const ok = samples.filter((s) => s.ok);
  const durations = ok.map((s) => s.durationMs).sort((a, b) => a - b);
  const statusCounts = {};
  for (const s of samples) {
    const key = s.error ? `ERR:${s.error}` : String(s.status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  return {
    requests: samples.length,
    ok: ok.length,
    failed: samples.length - ok.length,
    errorRatePct: samples.length ? round((1 - ok.length / samples.length) * 100, 2) : 0,
    throughputRps: wallClockMs ? round((samples.length / wallClockMs) * 1000, 2) : null,
    latencyMs: {
      min: durations.length ? round(durations[0], 1) : null,
      p50: round(percentile(durations, 50), 1),
      p95: round(percentile(durations, 95), 1),
      p99: round(percentile(durations, 99), 1),
      max: durations.length ? round(durations[durations.length - 1], 1) : null,
      mean: durations.length
        ? round(durations.reduce((a, b) => a + b, 0) / durations.length, 1)
        : null,
    },
    statusCounts,
    wallClockMs: round(wallClockMs, 0),
  };
}

function round(value, digits) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function formatSummary(label, s) {
  const l = s.latencyMs;
  return [
    `${label}`,
    `  requests=${s.requests} ok=${s.ok} failed=${s.failed} errorRate=${s.errorRatePct}%`,
    `  throughput=${s.throughputRps} req/s  wall=${s.wallClockMs}ms`,
    `  latency p50=${l.p50}ms p95=${l.p95}ms p99=${l.p99}ms max=${l.max}ms`,
    `  status=${JSON.stringify(s.statusCounts)}`,
  ].join("\n");
}
