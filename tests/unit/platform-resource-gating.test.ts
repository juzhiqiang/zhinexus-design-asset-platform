import { expect, it } from 'vitest';
import { Platform } from '../../apps/api/dist/platform.js';

function platformWithDatabase() {
  const statements: string[] = [];
  const database = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT generation FROM access_active')) return { rows: [{ generation: '0' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    close: async () => {},
  };
  const platform = new Platform({ devAdmin: { username: 'catalog-test', password: 'test-password' } });
  Object.defineProperty(platform, 'db', { value: database });
  return { platform, database, statements };
}

it('allows authenticated catalog reads with PostgreSQL even when upload storage is not configured', async () => {
  const { platform, database, statements } = platformWithDatabase();
  const { access_token: token } = await platform.devAdmin!.login('catalog-test', 'test-password');

  try {
    const result = await platform.run(`Bearer ${token}`, 'read', 'catalog-request', async (_context, _uploads, db) => {
      expect(db).toBe(database);
      return 'catalog-readable';
    });

    expect(result).toBe('catalog-readable');
    expect(statements.some((sql) => sql.includes('access_active'))).toBe(true);
  } finally {
    await platform.onApplicationShutdown();
  }
});

it('keeps upload actions unavailable when their storage service is not configured', async () => {
  const { platform } = platformWithDatabase();
  const { access_token: token } = await platform.devAdmin!.login('catalog-test', 'test-password');

  try {
    await expect(platform.run(`Bearer ${token}`, 'upload', 'upload-request', async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'INFRA_UNAVAILABLE', status: 503 });
  } finally {
    await platform.onApplicationShutdown();
  }
});
