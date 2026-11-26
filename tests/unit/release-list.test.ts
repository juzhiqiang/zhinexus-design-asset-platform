import { describe, expect, it } from 'vitest';
import { ReleaseService } from '../../apps/api/dist/releases/service.js';
import type { Database } from '../../apps/api/dist/db/database.js';
import type { UploadService } from '../../apps/api/dist/uploads/service.js';
import type { RequestContext } from '../../apps/api/dist/db/access.js';

function makeContext(subject: string, roles: ('reader' | 'publisher' | 'maintainer')[]): RequestContext {
  return {
    requestId: 'req-1',
    principal: { subject, roles, clientId: 'web', channel: 'web', generation: '0' },
  };
}

describe('ReleaseService.list (GET /v1/releases)', () => {
  it('rejects invalid state or out-of-range limit', async () => {
    const db = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database;
    const service = new ReleaseService(db, {} as UploadService);
    await expect(service.list({ state: 'INVALID' }, makeContext('alice', ['reader']))).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    await expect(service.list({ limit: '999' }, makeContext('alice', ['reader']))).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    await expect(service.list({ limit: '0' }, makeContext('alice', ['reader']))).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
  });

  it('returns only authorized jobs for maintainer and skips forbidden jobs', async () => {
    const now = new Date('2026-11-26T00:00:00.000Z');
    const queries: unknown[][] = [];
    const db = {
      query: async (sql: string, values?: unknown[]) => {
        queries.push([sql, values]);
        if (sql.includes('FROM release_jobs')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                subject: 'alice',
                client_id: 'cli',
                channel: 'cli',
                state: 'READY',
                stage: 'READY',
                attempt: 1,
                last_error: null,
                created_at: now,
                updated_at: now,
                manifest: {
                  packages: [{ name: '@company/charts-vue', version: '0.1.0' }],
                  variants: [{ componentId: 'line', variantId: 'line-vue' }],
                },
              },
              {
                id: '22222222-2222-4222-8222-222222222222',
                subject: 'bob',
                client_id: 'web',
                channel: 'web',
                state: 'RETRY_WAIT',
                stage: 'ENSURE_PACKAGES',
                attempt: 2,
                last_error: { code: 'REGISTRY_UNAVAILABLE' },
                created_at: now,
                updated_at: now,
                manifest: {
                  packages: [{ name: '@company/secret-pkg', version: '1.0.0' }],
                  variants: [{ componentId: 'secret-chart', variantId: 'secret-vue' }],
                },
              },
            ],
          };
        }
        // bob's job fails component permission check for alice
        return { rowCount: 0, rows: [] };
      },
    } as unknown as Database;

    const service = new ReleaseService(db, {} as UploadService);
    const result = await service.list({ state: 'READY', limit: '10' }, makeContext('alice', ['reader', 'maintainer']));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      jobId: '11111111-1111-4111-8111-111111111111',
      channel: 'cli',
      subject: 'alice',
      state: 'READY',
      packages: [{ name: '@company/charts-vue', version: '0.1.0' }],
      variantCount: 1,
    });
  });
});
