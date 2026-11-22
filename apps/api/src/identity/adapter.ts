import type { ManagedAccountRole } from '@company/contracts';

/** The only account facts the platform reads back from the identity service. */
export type RemoteAccount = { id: string; username: string; enabled: boolean; managedUserId?: string; roles: ManagedAccountRole[] };
export type IdentityAccountInput = {
  username: string; displayName: string; roles: ManagedAccountRole[]; managedUserId: string; accountVersion: string;
};
export type IdentityUpdateInput = {
  displayName?: string; roles?: ManagedAccountRole[]; enabled?: boolean; accountVersion: string;
};
/**
 * Identity-service administration. Implementations must address a fixed realm over the
 * deployment allow-list, must never accept a caller-supplied URL, and must never return
 * tokens, secrets or response bodies to the platform caller.
 */
export interface IdentityAdapter {
  createAccount(input: IdentityAccountInput): Promise<RemoteAccount>;
  updateAccount(remoteUserId: string, input: IdentityUpdateInput): Promise<RemoteAccount>;
  /** Temporary credential; the platform never stores, logs or echoes the value. */
  setTemporaryPassword(remoteUserId: string, password: string, accountVersion: string): Promise<void>;
  revokeSessions(remoteUserId: string): Promise<void>;
  findByUsername(username: string): Promise<RemoteAccount | undefined>;
}
