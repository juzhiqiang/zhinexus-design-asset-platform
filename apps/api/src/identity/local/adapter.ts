import { MANAGED_ACCOUNT_ROLES, type ManagedAccountRole } from '@company/contracts';
import type { IdentityAccountInput, IdentityAdapter, IdentityUpdateInput, RemoteAccount } from '../adapter.js';
import type { LocalIdentityStore } from './store.js';
import { hashPassword } from './password.js';

export type LocalIdentityAdapterOptions = { issuer: string };
const roleNames = MANAGED_ACCOUNT_ROLES as readonly string[];
const roles = (value: unknown): ManagedAccountRole[] => Array.isArray(value) ? value.filter((role): role is ManagedAccountRole => typeof role === 'string' && roleNames.includes(role)) : [];

/**
 * Identity adapter backed by the platform's own tables. `remote_user_id` is the managed account
 * id, so no separate remote identifier exists and no mirroring write is needed: the account
 * service owns display name, roles and enabled state in `managed_accounts` and commits them only
 * after this adapter confirms the requested state.
 */
export class LocalIdentityAdapter implements IdentityAdapter {
  constructor(private readonly store: LocalIdentityStore, private readonly options: LocalIdentityAdapterOptions) {}

  async createAccount(input: IdentityAccountInput): Promise<RemoteAccount> {
    // The managed account row already exists; the identity side needs no additional record.
    return { id: input.managedUserId, username: input.username, enabled: false, managedUserId: input.managedUserId, roles: roles(input.roles) };
  }

  async updateAccount(remoteUserId: string, input: IdentityUpdateInput): Promise<RemoteAccount> {
    const current = await this.store.account(remoteUserId);
    if (!current) throw new Error('Local identity account no longer exists');
    const row = await this.store.usernameOf(remoteUserId);
    return { id: remoteUserId, username: row, enabled: input.enabled ?? current.enabled, managedUserId: remoteUserId, roles: input.roles ? roles(input.roles) : roles(current.roles) };
  }

  /**
   * Stores a hash that must be replaced on first use. `accountVersion` is owned by
   * `managed_accounts` and already committed by the caller, so it is not duplicated here.
   */
  async setTemporaryPassword(remoteUserId: string, password: string, _accountVersion: string): Promise<void> {
    await this.store.putCredential(remoteUserId, await hashPassword(password), true);
  }

  async revokeSessions(remoteUserId: string): Promise<void> {
    const account = await this.store.account(remoteUserId);
    if (!account) return;
    await this.store.revokeSubjectAccess(account.subject);
  }

  async findByUsername(username: string): Promise<RemoteAccount | undefined> {
    const candidate = await this.store.loginCandidate(this.options.issuer, username);
    if (!candidate) return undefined;
    return { id: candidate.accountId, username: candidate.username, enabled: candidate.enabled, managedUserId: candidate.accountId, roles: roles(candidate.roles) };
  }
}
