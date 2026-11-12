import { expect, it } from 'vitest';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { PlatformEvents } from '../../apps/api/dist/observability/events.js';
import { metrics } from '../../apps/api/dist/observability/metrics.js';
import { workerHarness, realRegistry } from './t06-support.js';

it('protects metrics separately and reports durable backlog and bounded stage observations', async () => {
  const lines: string[] = []; const events = new PlatformEvents(line => lines.push(line));
  const token = 'metrics-test-token-with-at-least-32-characters';
  const h = await workerHarness(undefined, { events, metricsToken: token });
  try {
    expect((await h.request('/internal/metrics', undefined, undefined, 'GET')).status).toBe(401);
    expect((await h.request('/internal/metrics', undefined, h.auth, 'GET')).status).toBe(401);
    let response = await h.request('/internal/metrics', undefined, token, 'GET');
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('platform_release_jobs{state="PENDING"} 1');
    await new ReleaseWorker(h.db, h.store, await realRegistry(), 60_000, events).runOnce(h.jobId);
    response = await h.request('/internal/metrics', undefined, token, 'GET');
    const rendered = await response.text();
    expect(rendered).toContain('platform_release_jobs{state="READY"} 1');
    expect(rendered).toContain('platform_index_jobs{state="pending"} 1');
    expect(rendered).toContain('platform_release_stage_duration_seconds_count{stage="READY_TX",outcome="success"} 1');
    expect(rendered).not.toContain(h.jobId);
    const stages = lines.map(line => JSON.parse(line)).filter(e => e.event === 'RELEASE_STAGE');
    expect(stages).toHaveLength(5);
    expect(stages.every(e => e.taskId === h.jobId && e.attempt === 1 && e.requestId && e.durationMs >= 0)).toBe(true);
    expect(lines.join('')).not.toContain(token); expect(lines.join('')).not.toContain(h.auth);
    const created = (await h.db.query("SELECT request_id FROM audit_events WHERE event='RELEASE_CREATED'")).rows[0];
    expect(stages[0].requestId).toBe(created!.request_id);
    expect(await metrics(h.db)).toContain('platform_release_stage_duration_seconds_count{stage="READY_TX",outcome="success"} 1');
    await h.restart();
    expect(await (await h.request('/internal/metrics', undefined, token, 'GET')).text()).toContain('platform_release_jobs{state="READY"} 1');
  } finally { await h.close(); }
});
