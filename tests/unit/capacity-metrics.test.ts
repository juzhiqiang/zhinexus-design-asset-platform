import { expect, it } from 'vitest';
import { summarizeRequests } from '../../scripts/capacity-metrics.js';

it('uses nearest-rank p95 and includes failed request latencies and counts', () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({ durationMs: i + 1, ok: i !== 19 }));
  expect(summarizeRequests(samples, 18)).toEqual({ count: 20, failures: 1, p50Ms: 10, p95Ms: 19, maxMs: 20, targetMs: 18, passed: false });
  expect(summarizeRequests([{ durationMs: 2, ok: true }], 2).passed).toBe(true);
  expect(summarizeRequests([{ durationMs: 1, ok: false }], 500).passed).toBe(false);
});

it('refuses empty, non-finite and negative measurements instead of reporting success', () => {
  expect(() => summarizeRequests([], 500)).toThrow();
  for (const durationMs of [NaN, Infinity, -1]) expect(() => summarizeRequests([{ durationMs, ok: true }], 500)).toThrow();
  for (const threshold of [NaN, Infinity, 0, -1]) expect(() => summarizeRequests([{ durationMs: 1, ok: true }], threshold)).toThrow();
});
