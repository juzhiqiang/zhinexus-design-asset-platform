import { MANAGED_ACCOUNT_ROLES, type ManagedAccountRole } from '@company/contracts';
import { RemoteStatusFailure, type RestrictedHttps } from '../access/outbound.js';
import type { IdentityAccountInput, IdentityAdapter, IdentityUpdateInput, RemoteAccount } from './adapter.js';

export type KeycloakOptions = {
  /** Fixed realm base, for example https://identity.internal:9443/realms/zhinexus. */
  baseUrl: string;
  realm: string;
  /** Service account client inside the same realm; a master administrator token is never used. */
  adminClientId: string;
  adminClientSecret: string;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Only ordinary JSON objects survive, so field access is always a narrowable unknown. */
const entries = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(record) : [];
const roleNames = MANAGED_ACCOUNT_ROLES as readonly string[];

export class KeycloakIdentityAdapter implements IdentityAdapter {
  private token?: { value: string; expiresAt: number };
  constructor(private readonly network: RestrictedHttps, private readonly options: KeycloakOptions) {
    let url: URL;
    try { url = new URL(options.baseUrl); } catch { throw new Error('Invalid identity realm base'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.startsWith('/realms/')) throw new Error('Invalid identity realm base');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.realm) || !options.adminClientId || !options.adminClientSecret) throw new Error('Invalid identity service account');
  }
  private get realmUrl(): string { return `${this.options.baseUrl.replace(/\/$/, '')}/admin/realms/${this.options.realm}`; }
  /** Client-credentials token for the realm service account, cached until shortly before expiry. */
  private async authorize(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 5000) return this.token.value;
    const endpoint = `${this.options.baseUrl.replace(/\/$/, '')}/protocol/openid-connect/token`;
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.options.adminClientId, client_secret: this.options.adminClientSecret });
    const token = await this.network.json(endpoint, form);
    if (!record(token) || typeof token.access_token !== 'string' || typeof token.expires_in !== 'number' || token.expires_in <= 0) throw new RemoteStatusFailure(0, false);
    this.token = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
    return this.token.value;
  }
  private async send(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown, query: Record<string, string> = {}): Promise<{ value: unknown; location?: string }> {
    return this.network.call(`${this.realmUrl}${path}`, method, payload, { authorization: `Bearer ${await this.authorize()}` }, query);
  }
  private account(value: unknown): RemoteAccount | undefined {
    if (!record(value) || typeof value.id !== 'string' || typeof value.username !== 'string') return undefined;
    const attributes = record(value.attributes) ? value.attributes : {};
    const roles = entries(value.roles)
      .filter(role => typeof role.name === 'string' && roleNames.includes(role.name))
      .map(role => role.name as ManagedAccountRole);
    const marker = entries(attributes['platform_managed_user_id'])[0];
    return { id: value.id, username: value.username, enabled: value.enabled === true, ...(typeof marker === 'string' ? { managedUserId: marker } : {}), roles };
  }
  private async realmRoles(): Promise<{ id: string; name: ManagedAccountRole }[]> {
    return entries((await this.send('GET', '/roles')).value)
      .flatMap(role => typeof role.id === 'string' && typeof role.name === 'string' && roleNames.includes(role.name) ? [{ id: role.id, name: role.name as ManagedAccountRole }] : []);
  }
  private async applyRoles(remoteUserId: string, desired: ManagedAccountRole[]): Promise<void> {
    const available = await this.realmRoles();
    const wanted = new Set<ManagedAccountRole>(desired);
    const current = entries((await this.send('GET', `/users/${remoteUserId}/role-mappings/realm`)).value)
      .filter(role => typeof role.id === 'string' && typeof role.name === 'string')
      .map(role => ({ id: role.id, name: role.name as ManagedAccountRole }));
    const additions = available.filter(role => wanted.has(role.name) && !current.some(existing => existing.name === role.name));
    const removals = current.filter(existing => roleNames.includes(existing.name) && !wanted.has(existing.name));
    for (const role of additions) await this.send('POST', `/users/${remoteUserId}/role-mappings/realm`, [role]);
    for (const role of removals) await this.send('DELETE', `/users/${remoteUserId}/role-mappings/realm`, [role]);
  }
  async createAccount(input: IdentityAccountInput): Promise<RemoteAccount> {
    const created = await this.send('POST', '/users', {
      username: input.username,
      firstName: input.displayName,
      enabled: false,
      emailVerified: false,
      attributes: { platform_managed_user_id: [input.managedUserId], platform_account_version: [input.accountVersion] },
    });
    // Keycloak answers 201 with the new user in Location, never with a body.
    const id = /\/users\/([^/]+)$/.exec(created.location ?? '')?.[1];
    const parsed = id ? this.account((await this.send('GET', `/users/${id}`)).value) : undefined;
    if (!parsed) throw new RemoteStatusFailure(0, false);
    await this.applyRoles(parsed.id, input.roles);
    return { ...parsed, roles: input.roles };
  }
  async updateAccount(remoteUserId: string, input: IdentityUpdateInput): Promise<RemoteAccount> {
    const body: Record<string, unknown> = { attributes: { platform_account_version: [input.accountVersion] } };
    if (input.displayName !== undefined) body['firstName'] = input.displayName;
    if (input.enabled !== undefined) body['enabled'] = input.enabled;
    await this.send('PUT', `/users/${remoteUserId}`, body);
    if (input.roles) await this.applyRoles(remoteUserId, input.roles);
    const parsed = this.account((await this.send('GET', `/users/${remoteUserId}`)).value);
    if (!parsed) throw new RemoteStatusFailure(0, false);
    return { ...parsed, enabled: input.enabled ?? parsed.enabled, ...(input.roles ? { roles: input.roles } : {}) };
  }
  async setTemporaryPassword(remoteUserId: string, password: string, accountVersion: string): Promise<void> {
    await this.send('PUT', `/users/${remoteUserId}/reset-password`, { type: 'password', value: password, temporary: true });
    // The signed version claim must move with the credential, or every new token would be stale.
    await this.send('PUT', `/users/${remoteUserId}`, { attributes: { platform_account_version: [accountVersion] } });
  }
  async revokeSessions(remoteUserId: string): Promise<void> {
    await this.send('POST', `/users/${remoteUserId}/logout`, {});
  }
  async findByUsername(username: string): Promise<RemoteAccount | undefined> {
    return this.account(entries((await this.send('GET', '/users', undefined, { username, exact: 'true' })).value)[0]);
  }
}
