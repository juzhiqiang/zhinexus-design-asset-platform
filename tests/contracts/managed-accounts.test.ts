import { describe, expect, it } from 'vitest';
import {
  MANAGED_ACCOUNT_PASSWORD_MIN_LENGTH,
  normalizeManagedAccountUsername,
  validateCreateManagedAccount,
  validateManagedAccountAuditResponse,
  validateManagedAccountDetail,
  validateManagedAccountListQuery,
  validateManagedAccountListResponse,
  validateManagedAccountMutation,
  validateManagedAccountSummary,
  validateManagedAccountUsername,
  validateSetManagedAccountPassword,
  validateUpdateManagedAccount,
  type ManagedAccountDetail,
} from '@company/contracts';

const detail = (overrides: Partial<ManagedAccountDetail> = {}): ManagedAccountDetail => ({
  id: '6f1d5f8e-7c2b-4b3a-9e11-2c4d5e6f7a8b',
  username: 'lin.wei',
  displayName: '林伟',
  roles: ['reader'],
  enabled: false,
  credentialState: 'unset',
  syncState: 'pending',
  administrator: false,
  accountVersion: '0',
  desiredRevision: '1',
  accessEpoch: '0',
  createdAt: '2026-11-22T06:00:00.000Z',
  updatedAt: '2026-11-22T06:00:00.000Z',
  componentGrants: [],
  packageGrants: [],
  ...overrides,
});

describe('自管账号用户名', () => {
  it('按 ASCII 小写规范化，保留数字、点、下划线与连字符', () => {
    expect(normalizeManagedAccountUsername('Lin.Wei_01-A')).toBe('lin.wei_01-a');
  });
  it('拒绝非 ASCII 字符，不按 Unicode 大小写折叠', () => {
    expect(validateManagedAccountUsername('Lin.Wei').ok).toBe(true);
    expect(validateManagedAccountUsername('林伟').ok).toBe(false);
    expect(validateManagedAccountUsername('Älice').ok).toBe(false);
  });
  it('拒绝长度越界、首位非字母数字与保留分隔符', () => {
    expect(validateManagedAccountUsername('ab').ok).toBe(false);
    expect(validateManagedAccountUsername('a'.repeat(65)).ok).toBe(false);
    expect(validateManagedAccountUsername('.lin').ok).toBe(false);
    expect(validateManagedAccountUsername('-lin').ok).toBe(false);
    expect(validateManagedAccountUsername('_lin').ok).toBe(false);
    expect(validateManagedAccountUsername('lin..wei').ok).toBe(true);
    expect(validateManagedAccountUsername('lin wei').ok).toBe(false);
    expect(validateManagedAccountUsername('lin@wei').ok).toBe(false);
  });
});

describe('创建自管账号', () => {
  const base = { username: 'Lin.Wei', displayName: '林伟', roles: ['reader'] };
  it('接受合法请求并把用户名规范化为小写', () => {
    const result = validateCreateManagedAccount(base);
    expect(result).toEqual({ ok: true, value: { ...base, username: 'lin.wei', roles: ['reader'] } });
  });
  it('接受精确组件与包授权', () => {
    const result = validateCreateManagedAccount({
      ...base,
      roles: ['reader', 'publisher'],
      componentGrants: [{ componentId: 'bar-chart', canPublish: true, canMaintain: false }],
      packageGrants: ['@company/charts-vue'],
    });
    expect(result.ok).toBe(true);
  });
  it('拒绝通配与空授权', () => {
    for (const componentGrants of [['*'], [''], ['bar*'], ['**'], ['../bar']] as const) {
      expect(validateCreateManagedAccount({ ...base, componentGrants: componentGrants.map(componentId => ({ componentId, canPublish: true, canMaintain: false })) }).ok).toBe(false);
    }
    for (const packageGrants of [['*'], [''], ['@company/*'], ['@scope/charts-vue*']] as const) {
      expect(validateCreateManagedAccount({ ...base, packageGrants }).ok).toBe(false);
    }
  });
  it('拒绝重复授权、非法角色与空显示名', () => {
    expect(validateCreateManagedAccount({ ...base, componentGrants: [
      { componentId: 'bar-chart', canPublish: true, canMaintain: false },
      { componentId: 'bar-chart', canPublish: false, canMaintain: true },
    ] }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, packageGrants: ['@company/charts-vue', '@company/charts-vue'] }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, roles: ['admin'] }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, roles: [] }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, displayName: '   ' }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, displayName: '' }).ok).toBe(false);
  });
  it('拒绝额外字段、客户端提供的身份与版本字段', () => {
    expect(validateCreateManagedAccount({ ...base, issuer: 'https://id.example.com' }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, subject: 'forged' }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, accountVersion: '3' }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, enabled: true }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, administrator: true }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, password: 'x'.repeat(20) }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, syncState: 'synced' }).ok).toBe(false);
  });
  it('拒绝超过授权数量上限', () => {
    expect(validateCreateManagedAccount({ ...base, packageGrants: Array.from({ length: 65 }, (_unused, index) => `pkg-${index}`) }).ok).toBe(false);
    expect(validateCreateManagedAccount({ ...base, componentGrants: Array.from({ length: 257 }, (_unused, index) => ({ componentId: `component-${index}`, canPublish: false, canMaintain: false })) }).ok).toBe(false);
  });
});

describe('修改自管账号', () => {
  it('要求预期修订并使用十进制字符串', () => {
    expect(validateUpdateManagedAccount({ displayName: '林伟' }).ok).toBe(false);
    expect(validateUpdateManagedAccount({ expectedRevision: '0' }).ok).toBe(false);
    expect(validateUpdateManagedAccount({ expectedRevision: 7 }).ok).toBe(false);
    expect(validateUpdateManagedAccount({ expectedRevision: '9007199254740993', displayName: '林伟' }).ok).toBe(true);
    expect(validateUpdateManagedAccount({ expectedRevision: '-1', displayName: '林伟' }).ok).toBe(false);
    expect(validateUpdateManagedAccount({ expectedRevision: '01', displayName: '林伟' }).ok).toBe(false);
  });
  it('接受单独修改显示名、角色或授权', () => {
    expect(validateUpdateManagedAccount({ expectedRevision: '1', displayName: '林伟' }).ok).toBe(true);
    expect(validateUpdateManagedAccount({ expectedRevision: '1', roles: ['publisher', 'maintainer'] }).ok).toBe(true);
    expect(validateUpdateManagedAccount({ expectedRevision: '1', componentGrants: [] }).ok).toBe(true);
    expect(validateUpdateManagedAccount({ expectedRevision: '1', packageGrants: [] }).ok).toBe(true);
  });
  it('拒绝清空角色与额外字段', () => {
    expect(validateUpdateManagedAccount({ expectedRevision: '1', roles: [] }).ok).toBe(false);
    expect(validateUpdateManagedAccount({ expectedRevision: '1', enabled: true }).ok).toBe(false);
    expect(validateUpdateManagedAccount({ expectedRevision: '1', username: 'other' }).ok).toBe(false);
  });
});

describe('瞬时密码设置', () => {
  it('要求预期修订与满足策略的密码', () => {
    expect(validateSetManagedAccountPassword({ expectedRevision: '1', password: 'x'.repeat(MANAGED_ACCOUNT_PASSWORD_MIN_LENGTH) }).ok).toBe(true);
    expect(validateSetManagedAccountPassword({ expectedRevision: '1', password: 'x'.repeat(MANAGED_ACCOUNT_PASSWORD_MIN_LENGTH - 1) }).ok).toBe(false);
    expect(validateSetManagedAccountPassword({ expectedRevision: '1', password: 'x'.repeat(257) }).ok).toBe(false);
    expect(validateSetManagedAccountPassword({ expectedRevision: '1', password: 'x'.repeat(20) + '\n' }).ok).toBe(false);
    expect(validateSetManagedAccountPassword({ expectedRevision: '1', password: ' '.repeat(20) }).ok).toBe(false);
    expect(validateSetManagedAccountPassword({ password: 'x'.repeat(20) }).ok).toBe(false);
  });
  it('账号视图契约一律拒绝密码字段', () => {
    const secret = 'correct horse battery staple';
    expect(validateManagedAccountDetail({ ...detail(), password: secret } as never).ok).toBe(false);
    expect(validateManagedAccountSummary({ ...detail(), password: secret } as never).ok).toBe(false);
    expect(validateManagedAccountListResponse({ items: [detail()], page: 1, pageSize: 20, total: 1, password: secret } as never).ok).toBe(false);
    expect(validateManagedAccountAuditResponse({ items: [{ at: '2026-11-22T06:00:00.000Z', actor: 'https://id.example.com:admin', action: 'create', accountId: detail().id, username: 'lin.wei', result: 'passed', password: secret }] }).ok).toBe(false);
  });
});

describe('账号操作与查询', () => {
  it('停用、恢复与强制重新登录只接受预期修订', () => {
    expect(validateManagedAccountMutation({ expectedRevision: '3' })).toEqual({ ok: true, value: { expectedRevision: '3' } });
    expect(validateManagedAccountMutation({}).ok).toBe(false);
    expect(validateManagedAccountMutation({ expectedRevision: '3', reason: 'x' }).ok).toBe(false);
  });
  it('列表查询限制分页与筛选', () => {
    expect(validateManagedAccountListQuery({})).toEqual({ ok: true, value: {} });
    expect(validateManagedAccountListQuery({ query: '林', enabled: false, page: 2, pageSize: 50 }).ok).toBe(true);
    expect(validateManagedAccountListQuery({ page: 0 }).ok).toBe(false);
    expect(validateManagedAccountListQuery({ pageSize: 101 }).ok).toBe(false);
    expect(validateManagedAccountListQuery({ enabled: 'false' }).ok).toBe(false);
    expect(validateManagedAccountListQuery({ query: 'x'.repeat(129) }).ok).toBe(false);
  });
});

describe('自管账号视图', () => {
  it('接受合法详情', () => {
    expect(validateManagedAccountDetail(detail({ enabled: true, credentialState: 'set', syncState: 'synced' }))).toEqual({ ok: true, value: detail({ enabled: true, credentialState: 'set', syncState: 'synced' }) });
  });
  it('拒绝越界账号版本、非法同步状态与管理员字段伪造', () => {
    expect(validateManagedAccountDetail(detail({ accountVersion: '9007199254740993' })).ok).toBe(true);
    expect(validateManagedAccountDetail(detail({ accountVersion: '-1' })).ok).toBe(false);
    expect(validateManagedAccountDetail(detail({ accessEpoch: '1.5' })).ok).toBe(false);
    expect(validateManagedAccountDetail(detail({ syncState: 'unknown' as never })).ok).toBe(false);
    expect(validateManagedAccountDetail(detail({ credentialState: 'unknown' as never })).ok).toBe(false);
    expect(validateManagedAccountDetail(detail({ roles: ['admin'] as never })).ok).toBe(false);
  });
  it('拒绝包含身份服务内部标识的视图', () => {
    expect(validateManagedAccountDetail({ ...detail(), remoteUserId: 'kc-uuid' } as never).ok).toBe(false);
    expect(validateManagedAccountDetail({ ...detail(), token: 'x' } as never).ok).toBe(false);
    expect(validateManagedAccountDetail({ ...detail(), secretRef: 'PLATFORM_KEYCLOAK_SECRET' } as never).ok).toBe(false);
  });
  it('列表响应限制分页并拒绝额外字段', () => {
    const { componentGrants: _components, packageGrants: _packages, ...summary } = detail();
    const response = { items: [summary], page: 1, pageSize: 20, total: 1 };
    expect(validateManagedAccountListResponse(response)).toEqual({ ok: true, value: response });
    expect(validateManagedAccountListResponse({ ...response, items: [{ ...summary, username: 'a'.repeat(65) }] }).ok).toBe(false);
    expect(validateManagedAccountListResponse({ ...response, total: '1' as never }).ok).toBe(false);
    expect(validateManagedAccountListResponse({ ...response, items: [] }).ok).toBe(false);
  });
  it('审计条目脱敏，只保留动作、主体与结果', () => {
    const response = { items: [{ at: '2026-11-22T06:00:00.000Z', actor: 'https://id.example.com:admin', action: 'create', accountId: detail().id, username: 'lin.wei', result: 'passed', requestId: 'req-1' }] };
    expect(validateManagedAccountAuditResponse(response)).toEqual({ ok: true, value: response });
    expect(validateManagedAccountAuditResponse({ items: [{ ...response.items[0], action: 'delete' }] }).ok).toBe(false);
    expect(validateManagedAccountAuditResponse({ items: [{ ...response.items[0], password: 'x' }] }).ok).toBe(false);
  });
});
