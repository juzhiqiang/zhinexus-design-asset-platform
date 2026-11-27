import { describe, expect, it } from 'vitest';
import type { Database } from '../../apps/api/src/db/database.js';
import { PreviewService } from '../../apps/api/src/preview/service.js';
import { developmentOptions } from '../../apps/api/src/identity/local/dev-admin.js';
import { environmentOptions as previewGatewayEnvironmentOptions } from '../../apps/preview-gateway/src/config.js';
import { readFileSync } from 'node:fs';

function createFakePreviewDb(allowed: boolean) {
  const inserted: unknown[][] = [];
  const audited: unknown[][] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes('FROM access_active')) {
        return {
          rows: [
            { section: 'oidc', generation: '2', config: null },
            { section: 'preview', generation: '3', config: null },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes('SELECT preview_can_read($1, NULL)')) {
        return { rows: [{ allowed }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO preview_grants')) {
        inserted.push(values);
        return { rows: [{ expires_at: new Date('2026-11-27T19:00:00.000Z') }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO audit_events')) {
        audited.push(values);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const db = {
    transaction: async <T>(fn: (sql: typeof client) => Promise<T>) => fn(client),
  } as unknown as Database;
  return { db, inserted, audited };
}

describe('public anonymous preview grants and loopback dev preview defaults', () => {
  const releaseId = '12345678-1234-4234-8234-123456789abc';
  const previewConfig = {
    mode: 'domain' as const,
    platformOrigin: 'https://gallery.platform.test',
    apiOrigin: 'https://api.platform.test',
    previewOrigin: 'https://preview.assets.test',
  };

  it('mints an anonymous short-lived grant for a public Ready release without requiring login', async () => {
    const { db, inserted, audited } = createFakePreviewDb(true);
    const service = new PreviewService(db, previewConfig);

    const grant = await service.createPublic({ variantReleaseId: releaseId }, 'req-public-1');
    expect(grant.mode).toBe('domain');
    expect(grant.expiresAt).toBe('2026-11-27T19:00:00.000Z');
    expect(grant.bootstrapUrl).toMatch(
      new RegExp(`^https://r-${releaseId}\\.preview\\.assets\\.test/bootstrap\\?grant=[A-Za-z0-9_-]{43}$`),
    );

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row[1]).toBeNull(); // subject is NULL for anonymous public grant
    expect(row[2]).toBe(releaseId);
    expect(row[4]).toBe('3'); // preview_generation
    expect(row[5]).toBe('2'); // oidc_generation
    expect(row[6]).toEqual([]); // read_roles empty
    expect(row[7]).toBeNull(); // account_version NULL

    expect(audited).toHaveLength(1);
    expect(audited[0]?.[0]).toBeNull();
    expect(audited[0]?.[1]).toBe('PREVIEW_GRANTED');
    expect(audited[0]?.[2]).toBe(releaseId);
  });

  it('rejects unauthenticated preview grants for private, unready, or unknown releases with UNAUTHENTICATED', async () => {
    const { db, inserted } = createFakePreviewDb(false);
    const service = new PreviewService(db, previewConfig);

    await expect(service.createPublic({ variantReleaseId: releaseId }, 'req-private-1')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    expect(inserted).toHaveLength(0);
  });

  it('enables guarded loopback dev preview config only for local loopback development', () => {
    const devOpts = developmentOptions({ databaseUrl: 'postgresql://zhinexus:pw@127.0.0.1:15432/zhinexus' });
    expect(devOpts.preview).toEqual({
      mode: 'ip-port',
      platformOrigin: 'http://127.0.0.1:5173',
      apiOrigin: 'http://127.0.0.1:3000',
      previewOrigin: 'http://127.0.0.1:3001',
    });

    const prevEnv = { ...process.env };
    try {
      delete process.env.PLATFORM_PREVIEW_MODE;
      delete process.env.PLATFORM_PREVIEW_ORIGIN;
      delete process.env.PLATFORM_BIND_HOST;
      delete process.env.PLATFORM_DEV_PREVIEW;
      process.env.NODE_ENV = 'development';
      process.env.PLATFORM_DATABASE_URL = 'postgresql://zhinexus:pw@127.0.0.1:15432/zhinexus';
      process.env.PLATFORM_S3_ENDPOINT = 'http://127.0.0.1:19000';
      expect(previewGatewayEnvironmentOptions().preview).toEqual(devOpts.preview);

      process.env.NODE_ENV = 'production';
      expect(previewGatewayEnvironmentOptions().preview).toBeUndefined();

      process.env.NODE_ENV = 'development';
      process.env.PLATFORM_BIND_HOST = '0.0.0.0';
      expect(previewGatewayEnvironmentOptions().preview).toBeUndefined();
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in prevEnv)) delete process.env[key];
      }
      Object.assign(process.env, prevEnv);
    }
  });

  it('passes PLATFORM_* env vars to preview-gateway dev task in turbo.json', () => {
    const turbo = JSON.parse(readFileSync('turbo.json', 'utf8')) as { tasks: Record<string, Record<string, unknown>> };
    expect(turbo.tasks['@company/preview-gateway#dev']).toEqual({
      dependsOn: ['^build'],
      passThroughEnv: ['PLATFORM_*'],
      cache: false,
      persistent: true,
    });
  });
});
