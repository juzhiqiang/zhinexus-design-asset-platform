import { expect, it } from 'vitest';
import { PlatformEvents } from '../../apps/api/dist/observability/events.js';

it('logs only bounded safe fields and never serializes untrusted extras or invalid identifiers', () => {
  const lines: string[] = []; const events = new PlatformEvents(line => lines.push(line));
  events.emit({ event: 'RELEASE_STAGE', taskId: 'b207a5af-019f-4d6b-877d-83fc78aa3522',
    requestId: 'https://private/?token=SECRET', stage: 'ENSURE_PACKAGES', attempt: 2,
    durationMs: 5, code: 'INFRA_UNAVAILABLE', token: 'SECRET', error: new Error('Bearer SECRET'),
    url: 'https://object/?X-Amz-Signature=SECRET' } as never);
  const output = JSON.parse(lines[0]!);
  expect(output).toMatchObject({ event: 'RELEASE_STAGE', taskId: 'b207a5af-019f-4d6b-877d-83fc78aa3522', stage: 'ENSURE_PACKAGES', attempt: 2, durationMs: 5 });
  expect(lines.join('')).not.toMatch(/SECRET|https|Bearer|Signature/);
  events.emit({ event: 'SECRET', code: 'SECRET', stage: 'SECRET' } as never);
  expect(lines.join('')).not.toContain('SECRET');
});

it('does not let a logging sink failure abort business work', () => {
  const events = new PlatformEvents(() => { throw new Error('broken sink'); });
  expect(() => events.emit({ event: 'WORKER_UNAVAILABLE' })).not.toThrow();
});
