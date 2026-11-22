import { expect, it } from 'vitest';
import { platformHarness, type Harness } from './http-support.js';
import type { IdentityAdapter, RemoteAccount } from '../../apps/api/dist/identity/adapter.js';

const issuer = 'https://issuer.t05.test';
const adminSubject = 'platform-admin';

/** In-memory realm stand-in; it records the call order so the test can assert the sequencing. */
function fakeIdentity() {
  const users = new Map<string, { id: string; username: string; enabled: boolean; managedUserId?: string; roles: string[]; version?: string; password?: string; revocations: number }>();
  const calls: string[] = [];
  const view = (id: string): RemoteAccount => {
    const user = users.get(id)!;
    return { id: user.id, username: user.username, enabled: user.enabled, ...(user.managedUserId ? { managedUserId: user.managedUserId } : {}), roles: user.roles as RemoteAccount['roles'] };
  };
  return {
    calls, users,
    async createAccount(input: { username: string; displayName: string; roles: string[]; managedUserId: string; accountVersion: string }) {
      calls.push('create');
      const id = `kc-${input.username}`;
      users.set(id, { id, username: input.username, enabled: false, managedUserId: input.managedUserId, roles: input.roles, version: input.accountVersion, revocations: 0 });
      return view(id);
    },
    async updateAccount(id: string, input: { displayName?: string; roles?: string[]; enabled?: boolean; accountVersion: string }) {
      calls.push('update');
      const user = users.get(id);
      if (!user) throw new Error('unknown remote user');
      if (input.enabled !== undefined) user.enabled = input.enabled;
      if (input.roles) user.roles = input.roles;
      user.version = input.accountVersion;
      return view(id);
    },
    async setTemporaryPassword(id: string, password: string, accountVersion: string) {
      calls.push('password');
      const user = users.get(id);
      if (!user) throw new Error('unknown remote user');
      user.password = password;
      user.version = accountVersion;
    },
    async revokeSessions(id: string) {
      calls.push('revoke');
      const user = users.get(id);
      if (user) user.revocations += 1;
    },
    async findByUsername(username: string) {
      const found = [...users.values()].find(user => user.username === username);
      return found ? view(found.id) : undefined;
    },
  };
}

const access = { apiOrigin: 'https://api.example.com', administrators: [{ issuer, subject: adminSubject }], outbound: [{ hostname: '127.0.0.1', port: 443, networks: ['127.0.0.1/32'] }] };
const managed = { issuer, realm: 'zhinexus' };
const row = async (h: Harness, id: string) => (await h.db.query('SELECT * FROM managed_accounts WHERE id=$1', [id])).rows[0] as { version: string; auth_time_floor: string; subject: string; desired_revision: string };
const read = async (h: Harness, id: string, admin: string) => ((await (await h.request(`/v1/managed-accounts/${id}`, undefined, admin, 'GET')).json()) as { account: Record<string, unknown> }).account;
const drain = async (h: Harness) => { for (const operation of (await h.db.query('SELECT * FROM identity_operations ORDER BY created_at')).rows) await h.platform().accounts!.processOperation(operation as never); };

it('self-managed accounts revoke before the remote call, widen only after it confirms, and fail closed on every claim', async () => {
  const identity = fakeIdentity();
  const h = await platformHarness({ galleryOrigin: 'https://gallery.example.com', access, managedAccounts: managed, identityAdapter: identity });
  try {
    const admin = await h.token(adminSubject, ['maintainer']);

    // Only the deployment-registered directory may manage members; a business role is not enough.
    expect((await h.request('/v1/managed-accounts', undefined, await h.token('intruder', ['maintainer']), 'GET')).status).toBe(403);
    expect((await h.db.query("SELECT 1 FROM audit_events WHERE event='AUTH_DENIED' AND target_id='managed-accounts'")).rowCount).toBeGreaterThan(0);
    expect((await h.request('/v1/managed-accounts', undefined, admin, 'GET')).status).toBe(200);

    // --- creation stays closed until directory, role, version and password are all complete -------
    const created = await h.request('/v1/managed-accounts', { username: 'Lin.Wei', displayName: '林伟', roles: ['reader'], componentGrants: [{ componentId: 'bar', canPublish: true, canMaintain: false }] }, admin);
    expect(created.status, JSON.stringify(await created.json())).toBe(201);
    const id = ((await created.json()) as { account: { id: string } }).account.id;
    expect(await read(h, id, admin)).toMatchObject({ username: 'lin.wei', enabled: false, credentialState: 'unset', syncState: 'pending', accountVersion: '1', desiredRevision: '1' });
    expect((await h.request('/v1/managed-accounts', { username: 'LIN.WEI', displayName: '重名', roles: ['reader'] }, admin)).status).toBe(409);
    expect((await h.request('/v1/managed-accounts', { username: 'ab', displayName: 'x', roles: ['reader'], packageGrants: ['*'] }, admin)).status).toBe(400);
    expect((await h.request('/v1/managed-accounts', { username: 'ok.user', displayName: '越权', roles: ['reader'], administrator: true } as never, admin)).status).toBe(400);

    // A queued creation must not open access by itself.
    const memberToken = await h.token('lin.wei-subject', ['reader'], 'web', '5m', { platform_account_version: '1', auth_time: 2000 });
    expect((await h.request('/v1/auth/oidc/session', undefined, memberToken, 'GET')).status).toBe(401);

    await drain(h);
    expect(identity.calls).toEqual(['create']);
    expect([...identity.users.values()][0]).toMatchObject({ enabled: false, managedUserId: id });
    expect(await read(h, id, admin)).toMatchObject({ syncState: 'synced', enabled: false });
    // Grants widen only after the identity service confirmed the new state.
    expect((await h.db.query('SELECT 1 FROM managed_account_component_grants WHERE component_id=$1', ['bar'])).rowCount).toBe(0);
    expect((await h.db.query('SELECT 1 FROM component_permissions WHERE component_id=$1', ['bar'])).rowCount).toBe(0);

    // --- password setting revokes first, then confirms only on an explicit remote answer ---------
    const password = await h.request(`/v1/managed-accounts/${id}/password`, { expectedRevision: '1', password: 'temporary-passphrase-1' }, admin);
    expect(password.status, JSON.stringify(await password.json())).toBe(200);
    expect(identity.calls).toContain('password');
    expect(await read(h, id, admin)).toMatchObject({ enabled: true, credentialState: 'set', accountVersion: '2' });
    const remote = [...identity.users.values()][0]!;
    expect(remote.password).toBe('temporary-passphrase-1');
    expect(remote.version).toBe('2');
    // An update widens the withheld component grant only in its closing transaction.
    const updated = await h.request(`/v1/managed-accounts/${id}/update`, { expectedRevision: '2', componentGrants: [{ componentId: 'bar', canPublish: true, canMaintain: false }] }, admin);
    expect(updated.status).toBe(200);
    expect((await h.db.query('SELECT 1 FROM component_permissions WHERE component_id=$1', ['bar'])).rowCount).toBe(0);
    await drain(h);
    expect((await h.db.query('SELECT 1 FROM managed_account_component_grants WHERE component_id=$1', ['bar'])).rowCount).toBe(1);
    expect((await h.db.query('SELECT 1 FROM component_permissions WHERE subject=$1 AND component_id=$2', ['oidc:' + (await h.db.query('SELECT platform_subject FROM managed_accounts WHERE id=$1', [id])).rows[0].platform_subject, 'bar'])).rowCount).toBe(1);
    expect((await h.request(`/v1/managed-accounts/${id}/update`, { expectedRevision: '2', displayName: '重复提交' }, admin)).status).toBe(409);

    // --- the member authenticates with the current signed version and authentication time --------
    const current = await row(h, id);
    const live = await h.token(current.subject, ['reader'], 'web', '5m', { platform_account_version: current.version, auth_time: Number(current.auth_time_floor) + 1 });
    expect((await h.request('/v1/auth/oidc/session', undefined, live, 'GET')).status).toBe(200);
    for (const claims of [{ platform_account_version: '1' }, { platform_account_version: '2' }, { auth_time: Number(current.auth_time_floor) }, {}, { platform_account_version: String(Number(current.version) + 1), auth_time: Number(current.auth_time_floor) + 1 }]) {
      const stale = await h.token(current.subject, ['reader'], 'web', '5m', { auth_time: Number(current.auth_time_floor) + 1, ...claims });
      expect((await h.request('/v1/auth/oidc/session', undefined, stale, 'GET')).status).toBe(401);
    }

    // --- disable retires the live credential and the preview grant -------------------------------
    expect((await h.request('/v1/preview-grants', { variantReleaseId: '00000000-0000-4000-8000-000000000000' }, live)).status).toBe(401);
    const disabled = await h.request(`/v1/managed-accounts/${id}/disable`, { expectedRevision: (await read(h, id, admin)).desiredRevision as string }, admin);
    expect(disabled.status).toBe(200);
    expect((await h.request('/v1/auth/oidc/session', undefined, live, 'GET')).status).toBe(401);
    expect((await h.db.query('SELECT 1 FROM oidc_sessions')).rowCount).toBe(0);
    await drain(h);
    expect(identity.calls.filter(call => call === 'revoke').length).toBeGreaterThan(0);
    expect([...identity.users.values()][0]).toMatchObject({ enabled: false });
    expect(await read(h, id, admin)).toMatchObject({ enabled: false });

    // --- a deployment administrator is not manageable through the member API --------------------
    await h.db.query('UPDATE managed_accounts SET administrator=true WHERE id=$1', [id]);
    expect((await h.request(`/v1/managed-accounts/${id}/disable`, { expectedRevision: (await read(h, id, admin)).desiredRevision as string }, admin)).status).toBe(403);
    expect((await h.request(`/v1/managed-accounts/${id}/force-logout`, { expectedRevision: (await read(h, id, admin)).desiredRevision as string }, admin)).status).toBe(403);
  } finally { await h.close(); }
});

it('a same-named remote user is never adopted without this account marker, and an uncertain outcome keeps the denial', async () => {
  const orphan = fakeIdentity();
  orphan.users.set('kc-orphan.user', { id: 'kc-orphan.user', username: 'orphan.user', enabled: true, roles: ['maintainer'], revocations: 0 });
  const h = await platformHarness({ access, managedAccounts: managed, identityAdapter: orphan });
  try {
    const admin = await h.token(adminSubject, ['maintainer']);
    const created = await h.request('/v1/managed-accounts', { username: 'orphan.user', displayName: '陌生人', roles: ['reader'] }, admin);
    const id = ((await created.json()) as { account: { id: string } }).account.id;
    await drain(h);
    expect(await read(h, id, admin)).toMatchObject({ enabled: false, syncState: 'failed' });
    expect(orphan.users.get('kc-orphan.user')).toMatchObject({ enabled: true, managedUserId: undefined });
    expect(orphan.users.get('kc-orphan.user')!.roles).toEqual(['maintainer']);
  } finally { await h.close(); }

  const failing: IdentityAdapter = { ...fakeIdentity(), setTemporaryPassword: async () => { throw new Error('identity service unreachable'); } };
  const flaky = await platformHarness({ access, managedAccounts: managed, identityAdapter: failing });
  try {
    const admin = await flaky.token(adminSubject, ['maintainer']);
    const created = await flaky.request('/v1/managed-accounts', { username: 'flaky.user', displayName: '不确定', roles: ['reader'] }, admin);
    const id = ((await created.json()) as { account: { id: string } }).account.id;
    await drain(flaky);
    expect(await read(flaky, id, admin)).toMatchObject({ enabled: false, credentialState: 'unset', syncState: 'pending' });
    // No automatic retry and no concurrent second password while the outcome is unknown.
    expect((await flaky.request(`/v1/managed-accounts/${id}/password`, { expectedRevision: '2', password: 'another-passphrase-99' }, admin)).status).toBe(409);
  } finally { await flaky.close(); }
});
