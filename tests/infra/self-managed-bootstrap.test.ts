import { describe, expect, it } from 'vitest';
import {
  assertSelfManagedIssuer,
  localAdministratorPresent,
  seedLocalAdministrator,
  type SeedingSql,
} from '../../infra/scripts/self-managed.js';

/**
 * The local identity service (`PLATFORM_IDENTITY_MODE=local`) keeps credentials in the platform
 * database and exposes no administration surface, so the first platform administrator can only be
 * seeded by a deployment-side bootstrap. These tests pin that seed's shape without PostgreSQL:
 * an enabled administrator row, a credential that must be replaced on first login, and no
 * plaintext password in any statement.
 *
 * Execution status: run under the host `vitest` (root config includes `tests/**\/*.test.ts`).
 * No Docker, PostgreSQL or identity service is involved.
 */
const ISSUER = 'https://api.zhinexus.internal/identity';
const PASSWORD_HASH = 'scrypt$65536$8$1$64$c2FsdHNhbHQ$aGFzaA';

/** Records every statement so the seed's parameters can be asserted directly. */
function recordingDatabase(administratorIssuers: readonly string[] = []) {
  const statements: { sql: string; values: unknown[] }[] = [];
  const sql: SeedingSql = {
    query: async (statement: string, values: unknown[] = []) => {
      statements.push({ sql: statement, values });
      // Scoped by issuer exactly like the real unique index, so a guard that ignored it cannot pass.
      if (/SELECT administrator FROM managed_accounts/.test(statement)) {
        return { rows: administratorIssuers.includes(String(values[0])) ? [{ administrator: true }] : [] };
      }
      return { rows: [] };
    },
  };
  return { sql, statements };
}

const seed = {
  id: '3f6f1c3e-7a41-4a1e-9d2b-0f5a2c8e1b44',
  subject: 'b1d4e9a2-6c33-4f70-8a15-2e9c7d0b5f31',
  platformSubject: 'oidc:8f14e45fceea167a5a36dedd4bea2543',
  issuer: ISSUER,
  username: 'platform-admin',
  displayName: '平台管理员',
  roles: ['reader'] as readonly string[],
  passwordHash: PASSWORD_HASH,
};

describe('self-managed issuer', () => {
  it('accepts an https issuer and rejects anything else', () => {
    expect(assertSelfManagedIssuer(ISSUER)).toBe(ISSUER);
    for (const rejected of [
      undefined,
      '',
      '   ',
      'http://api.zhinexus.internal/identity',
      'https://operator:secret@api.zhinexus.internal/identity',
      `${ISSUER}?probe=1`,
      `${ISSUER}#fragment`,
    ]) {
      expect(() => assertSelfManagedIssuer(rejected)).toThrow();
    }
  });
});

describe('local administrator guard', () => {
  it('only reports an administrator registered under the same issuer', async () => {
    const empty = recordingDatabase();
    expect(await localAdministratorPresent(empty.sql, ISSUER)).toBe(false);
    expect(empty.statements.map(statement => statement.values)).toEqual([[ISSUER]]);

    const foreign = recordingDatabase(['https://other.example.com/identity']);
    expect(await localAdministratorPresent(foreign.sql, ISSUER)).toBe(false);

    const seeded = recordingDatabase([ISSUER]);
    expect(await localAdministratorPresent(seeded.sql, ISSUER)).toBe(true);
  });
});

describe('local administrator seed', () => {
  it('writes an enabled administrator bound to the local identity subject', async () => {
    const { sql, statements } = recordingDatabase();
    await seedLocalAdministrator(sql, seed);

    const directory = statements.find(statement => /INSERT INTO managed_accounts/.test(statement.sql));
    expect(directory).toBeDefined();
    expect(directory!.values).toEqual([
      seed.id, ISSUER, seed.subject, seed.platformSubject, seed.username, seed.displayName, ['reader'],
      true, true, false, true, 'synced', seed.id, 1, 0, 1,
    ]);
  });

  it('stores only the digest and requires a replacement on first login', async () => {
    const { sql, statements } = recordingDatabase();
    await seedLocalAdministrator(sql, seed);

    const credential = statements.find(statement => /INSERT INTO local_credentials/.test(statement.sql));
    expect(credential).toBeDefined();
    expect(credential!.values[0]).toBe(seed.id);
    expect(credential!.values[1]).toBe(PASSWORD_HASH);
    expect(credential!.values[2]).toBe(true);
  });

  it('never places a temporary password in a statement', async () => {
    const { sql, statements } = recordingDatabase();
    await seedLocalAdministrator(sql, seed);

    expect(JSON.stringify(statements)).not.toContain('temporary-password');
    expect(JSON.stringify(statements)).toContain(PASSWORD_HASH);
  });

  it('records the seeding in the audit trail', async () => {
    const { sql, statements } = recordingDatabase();
    await seedLocalAdministrator(sql, seed);

    const audit = statements.find(statement => /INSERT INTO audit_events/.test(statement.sql));
    expect(audit).toBeDefined();
    expect(audit!.values[0]).toBe('deployment:self-managed-bootstrap-local');
    expect(audit!.values[1]).toBe('MANAGED_ACCOUNT_CREATE');
    expect(audit!.values[2]).toBe(seed.username);
    expect(JSON.parse(String(audit!.values[3]))).toMatchObject({ username: seed.username, administrator: true });
  });
});
