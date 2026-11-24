export type RequestSample = { durationMs: number; ok: boolean };

/** Nearest-rank percentiles include unsuccessful requests; no filtered success-only claims. */
export function summarizeRequests(samples: readonly RequestSample[], targetMs: number) {
  if (!samples.length || !Number.isFinite(targetMs) || targetMs <= 0 ||
    samples.some(s => !Number.isFinite(s.durationMs) || s.durationMs < 0 || typeof s.ok !== 'boolean')) {
    throw new Error('Capacity measurements and a positive target are required');
  }
  const ordered = samples.map(s => s.durationMs).sort((a, b) => a - b);
  const percentile = (q: number) => ordered[Math.ceil(q * ordered.length) - 1]!;
  const failures = samples.filter(s => !s.ok).length;
  const p95Ms = percentile(0.95);
  return { count: samples.length, failures, p50Ms: percentile(0.5), p95Ms, maxMs: ordered.at(-1)!, targetMs,
    passed: failures === 0 && p95Ms <= targetMs };
}
