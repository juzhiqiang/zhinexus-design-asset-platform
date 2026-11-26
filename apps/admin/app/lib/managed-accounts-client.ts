import {
  validateManagedAccountAuditResponse,
  validateManagedAccountDetail,
  validateManagedAccountListResponse,
  type ManagedAccountAction,
  type ManagedAccountAuditResponse,
  type ManagedAccountComponentGrant,
  type ManagedAccountDetail,
  type ManagedAccountListResponse,
  type ManagedAccountRole,
} from '@company/contracts';
import { getAuthCredentials, getAuthHeaders, getStoredSession, notifySessionExpired, platformApiOrigin } from './auth';

export class ManagedAccountApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type ManagedAccountDraft = {
  username: string;
  displayName: string;
  roles: ManagedAccountRole[];
  componentGrants: ManagedAccountComponentGrant[];
  packageGrants: string[];
};

const base = platformApiOrigin + '/v1/managed-accounts';

async function send(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const session = getStoredSession();
  const response = await fetch(base + path, {
    method,
    credentials: getAuthCredentials(session),
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(25_000),
    headers: { 'content-type': 'application/json', ...getAuthHeaders(session) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired();
    const message = response.status === 403
      ? '仅平台管理员可以管理成员账号。'
      : response.status === 401
        ? '请使用平台账号登录。'
        : response.status === 409
          ? '账号版本已变化，或该操作的前置条件尚未满足，请刷新后重试。'
          : response.status === 400
            ? '填写内容不符合账号规则，请检查用户名、显示名、角色与授权。'
            : response.status === 503
              ? '成员账号服务未连接到数据库，暂时不可用。'
              : '账号服务暂时不可用，请稍后重试。';
    throw new ManagedAccountApiError(message, response.status);
  }
  return response.json();
}

export async function listManagedAccounts(query: { query?: string; enabled?: boolean; page?: number; pageSize?: number } = {}): Promise<ManagedAccountListResponse> {
  const search = new URLSearchParams();
  if (query.query) search.set('query', query.query);
  if (query.enabled !== undefined) search.set('enabled', String(query.enabled));
  if (query.page) search.set('page', String(query.page));
  if (query.pageSize) search.set('pageSize', String(query.pageSize));
  const parsed = validateManagedAccountListResponse(await send(search.toString() ? '?' + search.toString() : '', 'GET'));
  if (!parsed.ok) throw new Error('账号服务返回了无效的成员列表。');
  return parsed.value;
}

export async function readManagedAccount(id: string): Promise<ManagedAccountDetail> {
  const parsed = validateManagedAccountDetail(await send('/' + encodeURIComponent(id), 'GET'));
  if (!parsed.ok) throw new Error('账号服务返回了无效的账号详情。');
  return parsed.value;
}

export async function createManagedAccount(draft: ManagedAccountDraft): Promise<ManagedAccountDetail> {
  const parsed = validateManagedAccountDetail(await send('', 'POST', draft));
  if (!parsed.ok) throw new Error('账号服务返回了无效的账号详情。');
  return parsed.value;
}

export async function setManagedAccountPassword(id: string, expectedRevision: string, password: string): Promise<ManagedAccountDetail> {
  const parsed = validateManagedAccountDetail(await send('/' + encodeURIComponent(id) + '/password', 'POST', { expectedRevision, password }));
  if (!parsed.ok) throw new Error('账号服务返回了无效的账号详情。');
  return parsed.value;
}

export async function mutateManagedAccount(id: string, action: 'update' | 'disable' | 'enable' | 'force-logout', body: unknown): Promise<ManagedAccountDetail> {
  const parsed = validateManagedAccountDetail(await send('/' + encodeURIComponent(id) + '/' + action, 'POST', body));
  if (!parsed.ok) throw new Error('账号服务返回了无效的账号详情。');
  return parsed.value;
}

export async function managedAccountAudit(): Promise<ManagedAccountAuditResponse> {
  const parsed = validateManagedAccountAuditResponse(await send('/audit', 'GET'));
  if (!parsed.ok) throw new Error('账号服务返回了无效的操作记录。');
  return parsed.value;
}

export const CREDENTIAL_LABELS: Record<ManagedAccountDetail['credentialState'], string> = {
  unset: '待设置密码',
  set: '已设置密码',
  uncertain: '待运维核实',
};

export const SYNC_LABELS: Record<ManagedAccountDetail['syncState'], string> = {
  pending: '等待同步',
  syncing: '同步中',
  synced: '已同步',
  failed: '同步失败',
};

export const ACTION_LABELS: Record<ManagedAccountAction, string> = {
  create: '创建账号',
  'set-password': '设置临时密码',
  update: '修改账号',
  disable: '停用',
  enable: '恢复',
  'force-logout': '强制重新登录',
};
