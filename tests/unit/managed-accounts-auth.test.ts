import { describe, expect, it } from 'vitest';
import { AuthFailure } from '../../apps/api/dist/auth/oidc.js';
import { ManagedAccountsService, managedPlatformSubject, type AccountRow } from '../../apps/api/dist/accounts/service.js';

const issuer = 'https://identity.zhinexus.internal:9443/realms/zhinexus';
const account = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: '6f1d5f8e-7c2b-4b3a-9e11-2c4d5e6f7a8b',
  issuer,
  subject: 'e7b0f1a2-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
  platform_subject: managedPlatformSubject(issuer, 'e7b0f1a2-3c4d-4e5f-8a9b-0c1d2e3f4a5b'),
  username: 'lin.wei',
  display_name: '林伟',
  roles: ['reader'],
  administrator: false,
  enabled: true,
  awaiting_activation: false,
  credentials_set: true,
  credential_uncertain: false,
  sync_state: 'synced',
  remote_user_id: 'kc-user-1',
  desired_revision: '3',
  access_epoch: '2',
  auth_time_floor: '1000',
  last_sync_error: null,
  created_at: new Date('2026-11-22T06:00:00.000Z'),
  updated_at: new Date('2026-11-22T06:00:00.000Z'),
  version: '3',
  ...overrides,
});
const principal = { issuer, identitySubject: 'e7b0f1a2-3c4d-4e5f-8a9b-0c1d2e3f4a5b', subject: 'oidc:subject', clientId: 'gallery-web', channel: 'web' as const, roles: ['reader' as const], generation: '7' };

function harness(rows: AccountRow[], administrators: { issuer: string; subject: string }[] = []) {
  const statements: { sql: string; values: unknown[] }[] = [];
  const db = {
    query: async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (/FROM managed_accounts WHERE issuer=\$1 AND subject=\$2/u.test(sql)) return { rows: rows.filter(row => row.issuer === values[0] && row.subject === values[1]), rowCount: rows.length };
      if (/FROM managed_accounts WHERE platform_subject=\$1/u.test(sql)) return { rows: rows.filter(row => row.platform_subject === values[0]), rowCount: rows.length };
      if (/SELECT generation FROM access_active/u.test(sql)) return { rows: [{ generation: '7' }], rowCount: 1 };
      if (/FROM access_active WHERE section=\$1/u.test(sql)) return { rows: [{ section: 'oidc', generation: '7' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    transaction: async (operation: (client: unknown) => Promise<unknown>) => operation(db),
  };
  const access = { options: { administrators, outbound: [], apiOrigin: 'https://api.zhinexus.internal' }, current: async () => ({ generation: '7' }) };
  const identity = { createAccount: async () => { throw new Error('unused'); }, updateAccount: async () => { throw new Error('unused'); }, setTemporaryPassword: async () => {}, revokeSessions: async () => {}, findByUsername: async () => undefined };
  const service = new ManagedAccountsService(db as never, access as never, { issuer, realm: 'zhinexus' }, identity as never);
  return { service, statements };
}

describe('自管账号的平台主体', () => {
  it('按 issuer 与身份主体派生，不按用户名关联历史用户', () => {
    expect(managedPlatformSubject(issuer, 'a')).toBe(managedPlatformSubject(issuer, 'a'));
    expect(managedPlatformSubject(issuer, 'a')).not.toBe(managedPlatformSubject(issuer, 'b'));
    expect(managedPlatformSubject(issuer, 'a')).not.toBe(managedPlatformSubject('https://other.example/oidc', 'a'));
    expect(managedPlatformSubject(issuer, 'lin.wei')).toMatch(/^oidc:[a-f0-9]{64}$/u);
  });
});

describe('受保护请求的账号版本与认证时间核验', () => {
  const claims = { platform_account_version: '3', auth_time: 1001, iat: 1001 };
  it('接受签名版本与本地一致且 auth_time 严格大于下限的令牌', async () => {
    const { service } = harness([account()]);
    await expect(service.verifiedAccount(principal, claims)).resolves.toMatchObject({ username: 'lin.wei', version: '3' });
  });
  it('拒绝未登记主体', async () => {
    const { service } = harness([]);
    await expect(service.verifiedAccount(principal, claims)).rejects.toBeInstanceOf(AuthFailure);
  });
  it('拒绝外部身份源的主体', async () => {
    const { service } = harness([account()]);
    await expect(service.verifiedAccount({ ...principal, issuer: 'https://sso.company.example' }, claims)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('拒绝停用账号', async () => {
    const { service } = harness([account({ enabled: false })]);
    await expect(service.verifiedAccount(principal, claims)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('拒绝旧账号版本，即使角色看起来仍然有效', async () => {
    const { service } = harness([account()]);
    await expect(service.verifiedAccount(principal, { ...claims, platform_account_version: '2' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('拒绝缺失、非字符串或越界的账号版本声明', async () => {
    const { service } = harness([account()]);
    for (const accountVersion of [undefined, null, 3, '3.0', '-1', '9007199254740993', '', '4']) {
      await expect(service.verifiedAccount(principal, { ...claims, platform_account_version: accountVersion })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });
  it('拒绝 auth_time 等于或早于下限，同一秒的新登录必须下一秒重新认证', async () => {
    const { service } = harness([account({ auth_time_floor: '1000' })]);
    await expect(service.verifiedAccount(principal, { ...claims, auth_time: 1000 })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.verifiedAccount(principal, { ...claims, auth_time: 999 })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.verifiedAccount(principal, { ...claims, auth_time: 1001 })).resolves.toBeTruthy();
  });
  it('拒绝缺失或非数字的 auth_time 与 iat', async () => {
    const { service } = harness([account()]);
    for (const authTime of [undefined, null, '1001', 1000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(service.verifiedAccount(principal, { ...claims, auth_time: authTime })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    await expect(service.verifiedAccount(principal, { ...claims, iat: undefined })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.verifiedAccount(principal, { ...claims, iat: 1000 })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('后台管理员强制', () => {
  it('接受目录中登记的部署管理员', async () => {
    const { service } = harness([account({ administrator: true })]);
    await expect(service.requireAdministrator({ principal, requestId: 'r' })).resolves.toMatchObject({ administrator: true });
  });
  it('接受尚未导入目录的部署登记管理员', async () => {
    const { service } = harness([], [{ issuer, subject: 'e7b0f1a2-3c4d-4e5f-8a9b-0c1d2e3f4a5b' }]);
    await expect(service.requireAdministrator({ principal, requestId: 'r' })).resolves.toBeUndefined();
  });
  it('拒绝普通成员，即使持有 maintainer 业务角色', async () => {
    const { service } = harness([account({ roles: ['maintainer'] })]);
    await expect(service.requireAdministrator({ principal, requestId: 'r' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('拒绝未登记主体与停用的管理员', async () => {
    const anonymous = harness([]);
    await expect(anonymous.service.requireAdministrator({ principal, requestId: 'r' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const disabled = harness([account({ administrator: true, enabled: false })]);
    await expect(disabled.service.requireAdministrator({ principal, requestId: 'r' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('拒绝配置代数已变化的会话', async () => {
    const { service } = harness([account({ administrator: true })]);
    await expect(service.requireAdministrator({ principal: { ...principal, generation: '6' }, requestId: 'r' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('身份操作队列约束', () => {
  it('只按账号串行claim，且密码操作永不入队', async () => {
    const { service, statements } = harness([account()]);
    await expect(service.claimOperations('worker-1', 8, 120)).resolves.toEqual([]);
    const claim = statements.find(statement => /UPDATE identity_operations SET state='running'/u.test(statement.sql));
    expect(claim?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim?.sql).toContain("state='queued'");
  });
});
