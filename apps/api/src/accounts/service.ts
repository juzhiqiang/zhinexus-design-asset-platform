import { createHash, randomUUID } from 'node:crypto';
import {
  type ManagedAccountAction,
  type ManagedAccountComponentGrant,
  type ManagedAccountCredentialState,
  type ManagedAccountDetail,
  type ManagedAccountListQuery,
  type ManagedAccountListResponse,
  type ManagedAccountRole,
  type ManagedAccountSummary,
  type ManagedAccountSyncState,
  type SetManagedAccountPasswordRequest,
  type UpdateManagedAccountRequest,
  validateCreateManagedAccount,
  validateManagedAccountDetail,
  validateManagedAccountListQuery,
  validateManagedAccountMutation,
  validateSetManagedAccountPassword,
  validateUpdateManagedAccount,
} from '@company/contracts';
import type { Database } from '../db/database.js';
import type { Sql } from '../db/access.js';
import { audit } from '../db/access.js';
import { PlatformError } from '../errors.js';
import { AuthFailure, type Principal } from '../auth/oidc.js';
import type { AccessSettingsService } from '../access/service.js';
import type { IdentityAdapter } from '../identity/adapter.js';

export type ManagedAccountsOptions = { issuer: string; realm: string };
export type AccountRow = {
  id: string; issuer: string; subject: string; platform_subject: string;
  username: string; display_name: string; roles: ManagedAccountRole[];
  administrator: boolean; enabled: boolean; awaiting_activation: boolean;
  credentials_set: boolean; credential_uncertain: boolean;
  sync_state: ManagedAccountSyncState; remote_user_id: string | null;
  desired_revision: string; access_epoch: string; auth_time_floor: string;
  last_sync_error: string | null; created_at: Date; updated_at: Date; version: string;
};
export type OperationRow = {
  id: string; account_id: string; kind: ManagedAccountAction; desired_revision: string;
  account_version: string; payload: Record<string, unknown>; state: string; attempts: string; fencing_token: string;
};
export type ManagedAuditEntry = { at: string; actor: string; action: ManagedAccountAction; accountId: string; username: string; result: 'passed' | 'failed'; requestId?: string };

/** The platform subject derivation is shared with the legacy identity path so ACLs keep working. */
export const managedPlatformSubject = (issuer: string, subject: string): string => 'oidc:' + createHash('sha256').update(issuer + '\0' + subject).digest('hex');
const IDENTITY_KINDS: ManagedAccountAction[] = ['create', 'update', 'disable', 'enable', 'force-logout'];

export class ManagedAccountsService {
  constructor(
    private readonly db: Database,
    private readonly access: AccessSettingsService,
    private readonly options: ManagedAccountsOptions,
    private readonly identity: IdentityAdapter,
  ) {}

  async resolveSelfManaged(principal: Principal): Promise<AccountRow | undefined> {
    if (!this.options.issuer || principal.issuer !== this.options.issuer) return undefined;
    return (await this.db.query<AccountRow>('SELECT * FROM managed_accounts WHERE issuer=$1 AND subject=$2', [principal.issuer, principal.identitySubject ?? principal.subject])).rows[0];
  }
  /** Deployment-configured self-managed issuer; empty when the platform runs an external identity source. */
  get selfManagedIssuer(): string { return this.options.issuer; }
  get selfManagedRealm(): string { return this.options.realm; }

  /** Administrator authority comes from the deployment-registered directory, never from a business role. */
  async requireAdministrator(context: { principal: Principal; requestId: string }): Promise<AccountRow | undefined> {
    const principal = context.principal;
    const account = await this.resolveSelfManaged(principal);
    const registered = this.access.options.administrators.some(a => a.issuer === principal.issuer && a.subject === (principal.identitySubject ?? principal.subject));
    if (account ? !account.administrator : !registered) throw new PlatformError('FORBIDDEN');
    if (account && !account.enabled) throw new AuthFailure('FORBIDDEN');
    if ((await this.access.current('oidc')).generation !== principal.generation) throw new AuthFailure('UNAUTHENTICATED');
    return account;
  }

  private summary(row: AccountRow): ManagedAccountSummary {
    const credentialState: ManagedAccountCredentialState = row.credential_uncertain ? 'uncertain' : row.credentials_set ? 'set' : 'unset';
    return {
      id: row.id, username: row.username, displayName: row.display_name, roles: row.roles,
      enabled: row.enabled, credentialState, syncState: row.sync_state, administrator: row.administrator,
      accountVersion: row.version, desiredRevision: row.desired_revision, accessEpoch: row.access_epoch,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    };
  }
  private async grants(sql: Sql, id: string): Promise<{ componentGrants: ManagedAccountComponentGrant[]; packageGrants: string[] }> {
    const components = (await sql.query<{ component_id: string; can_read?: boolean; can_publish: boolean; can_maintain: boolean }>('SELECT component_id,can_read,can_publish,can_maintain FROM managed_account_component_grants WHERE account_id=$1 ORDER BY component_id', [id])).rows;
    const packages = (await sql.query<{ package_name: string }>('SELECT package_name FROM managed_account_package_grants WHERE account_id=$1 ORDER BY package_name', [id])).rows;
    return {
      componentGrants: components.map(row => ({
        componentId: row.component_id,
        ...(row.can_read ? { canRead: true } : {}),
        canPublish: row.can_publish,
        canMaintain: row.can_maintain,
      })),
      packageGrants: packages.map(row => row.package_name),
    };
  }
  private async detailOf(sql: Sql, row: AccountRow): Promise<ManagedAccountDetail> {
    return { ...this.summary(row), ...await this.grants(sql, row.id) };
  }
  private async load(sql: Sql, id: string): Promise<AccountRow> {
    const row = (await sql.query<AccountRow>('SELECT * FROM managed_accounts WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw new PlatformError('NOT_FOUND');
    return row;
  }
  private async record(sql: Sql, row: AccountRow, action: ManagedAccountAction, result: 'passed' | 'failed', context: { principal: Principal; requestId: string }, extra: Record<string, unknown> = {}): Promise<void> {
    await audit(sql, row.platform_subject, 'MANAGED_ACCOUNT_' + action.toUpperCase().replaceAll('-', '_'), row.id, {
      username: row.username, result, revision: row.desired_revision, version: row.version, epoch: row.access_epoch,
      actor: `${context.principal.issuer}:${context.principal.identitySubject ?? context.principal.subject}`, ...extra,
    }, context.requestId);
  }
  private async generation(context: { principal: Principal }, sql: Sql): Promise<void> {
    const active = await this.access.current('oidc', sql, true);
    if (context.principal.generation !== active.generation) throw new AuthFailure('UNAUTHENTICATED');
  }

  /**
   * Immediate local revocation. Runs before any remote call: the epoch grows, the authentication
   * time floor advances to this transaction's current whole second, and every live credential is
   * dropped. A remote failure can never undo this.
   */
  private async tighten(sql: Sql, row: AccountRow, fields: Record<string, unknown>): Promise<AccountRow> {
    const updated = (await sql.query<AccountRow>(`UPDATE managed_accounts SET
        desired_revision = desired_revision + 1, version = version + 1, access_epoch = access_epoch + 1,
        auth_time_floor = GREATEST(auth_time_floor, floor(extract(epoch FROM clock_timestamp()))), updated_at = clock_timestamp()
        WHERE id=$1 RETURNING *`, [row.id])).rows[0]!;
    if (Object.keys(fields).length) await sql.query(`UPDATE managed_accounts SET ${Object.keys(fields).map((key, index) => `${key}=$${index + 2}`).join(',')} WHERE id=$1`, [row.id, ...Object.values(fields)]);
    await sql.query(`DELETE FROM oidc_sessions WHERE principal->>'subject'=$1`, [row.platform_subject]);
    await sql.query(`UPDATE preview_grants SET revoked_at=clock_timestamp() WHERE subject=$1 AND revoked_at IS NULL`, [row.platform_subject]);
    await sql.query(`DELETE FROM oidc_start_tickets WHERE subject=$1 AND consumed_at IS NULL`, [row.platform_subject]);
    return updated;
  }
  /**
   * Closing transaction after the remote service confirmed the new state. The version is not
   * touched here: the identity service already holds it, so a second bump would desynchronise the
   * signed claim. The time floor is advanced again so credentials obtained mid-flight cannot survive.
   */
  private async finalize(sql: Sql, row: AccountRow, fields: Record<string, unknown>): Promise<AccountRow> {
    const updated = (await sql.query<AccountRow>(`UPDATE managed_accounts SET
        access_epoch = access_epoch + 1,
        auth_time_floor = GREATEST(auth_time_floor, floor(extract(epoch FROM clock_timestamp()))), updated_at = clock_timestamp()
        WHERE id=$1 RETURNING *`, [row.id])).rows[0]!;
    if (Object.keys(fields).length) await sql.query(`UPDATE managed_accounts SET ${Object.keys(fields).map((key, index) => `${key}=$${index + 2}`).join(',')} WHERE id=$1`, [row.id, ...Object.values(fields)]);
    return updated;
  }

  private async reduceGrants(sql: Sql, row: AccountRow, componentGrants?: ManagedAccountComponentGrant[], packageGrants?: string[]): Promise<void> {
    if (componentGrants) {
      const ids = componentGrants.map(grant => grant.componentId);
      await sql.query('DELETE FROM managed_account_component_grants WHERE account_id=$1 AND NOT (component_id = ANY($2::text[]))', [row.id, ids]);
      for (const grant of componentGrants) {
        const canRead = Boolean(grant.canRead);
        await sql.query('UPDATE managed_account_component_grants SET can_read=(can_read AND $3),can_publish=(can_publish AND $4),can_maintain=(can_maintain AND $5) WHERE account_id=$1 AND component_id=$2 AND ((can_read AND NOT $3) OR (can_publish AND NOT $4) OR (can_maintain AND NOT $5)) AND ((can_read AND $3) OR (can_publish AND $4) OR (can_maintain AND $5))', [row.id, grant.componentId, canRead, grant.canPublish, grant.canMaintain]);
        await sql.query('DELETE FROM managed_account_component_grants WHERE account_id=$1 AND component_id=$2 AND NOT ((can_read AND $3) OR (can_publish AND $4) OR (can_maintain AND $5))', [row.id, grant.componentId, canRead, grant.canPublish, grant.canMaintain]);
        await sql.query('UPDATE component_permissions SET can_read=(can_read AND $3),can_publish=(can_publish AND $4),can_maintain=(can_maintain AND $5) WHERE subject=$1 AND component_id=$2 AND ((can_read AND NOT $3) OR (can_publish AND NOT $4) OR (can_maintain AND NOT $5))', [row.platform_subject, grant.componentId, canRead, grant.canPublish, grant.canMaintain]);
      }
      await sql.query('DELETE FROM component_permissions WHERE subject=$1 AND NOT (component_id = ANY($2::text[]))', [row.platform_subject, ids]);
    }
    if (packageGrants) {
      await sql.query('DELETE FROM managed_account_package_grants WHERE account_id=$1 AND NOT (package_name = ANY($2::text[]))', [row.id, packageGrants]);
      await sql.query('DELETE FROM package_permissions WHERE subject=$1 AND NOT (package_name = ANY($2::text[]))', [row.platform_subject, packageGrants]);
    }
  }
  private async expandGrants(sql: Sql, row: AccountRow, componentGrants?: ManagedAccountComponentGrant[], packageGrants?: string[]): Promise<void> {
    for (const grant of componentGrants ?? []) {
      const canRead = Boolean(grant.canRead);
      await sql.query(`INSERT INTO managed_account_component_grants(account_id,component_id,can_read,can_publish,can_maintain) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (account_id,component_id) DO UPDATE SET can_read=EXCLUDED.can_read,can_publish=EXCLUDED.can_publish,can_maintain=EXCLUDED.can_maintain`, [row.id, grant.componentId, canRead, grant.canPublish, grant.canMaintain]);
      await sql.query(`INSERT INTO component_permissions(subject,component_id,can_read,can_publish,can_maintain) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (subject,component_id) DO UPDATE SET can_read=EXCLUDED.can_read,can_publish=EXCLUDED.can_publish,can_maintain=EXCLUDED.can_maintain`, [row.platform_subject, grant.componentId, canRead, grant.canPublish, grant.canMaintain]);
    }
    for (const name of packageGrants ?? []) {
      await sql.query('INSERT INTO managed_account_package_grants(account_id,package_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.id, name]);
      await sql.query('INSERT INTO package_permissions(subject,package_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.platform_subject, name]);
    }
  }
  /** Enqueued outside the caller transaction: network work must never hold a database transaction open. */
  private async enqueue(kind: ManagedAccountAction, revision: string, version: string, accountId: string, payload: Record<string, unknown>): Promise<void> {
    await this.db.query(`INSERT INTO identity_operations(id,account_id,kind,desired_revision,account_version,payload) VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), accountId, kind, revision, version, JSON.stringify(payload)]);
  }

  async list(query: ManagedAccountListQuery, context: { principal: Principal; requestId: string }): Promise<ManagedAccountListResponse> {
    await this.requireAdministrator(context);
    const parsed = validateManagedAccountListQuery(query);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const value = parsed.value;
    const page = value.page ?? 1, pageSize = value.pageSize ?? 20;
    const filters: string[] = [], values: unknown[] = [];
    if (value.query !== undefined) { filters.push(`(username ILIKE $${values.length + 1} OR display_name ILIKE $${values.length + 1})`); values.push('%' + value.query.replace(/[%_\\]/g, character => '\\' + character) + '%'); }
    if (value.enabled !== undefined) { filters.push(`enabled=$${values.length + 1}`); values.push(value.enabled); }
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    const total = Number((await this.db.query<{ count: string }>(`SELECT count(*) AS count FROM managed_accounts${where}`, values)).rows[0]!.count);
    const rows = (await this.db.query<AccountRow>(`SELECT * FROM managed_accounts${where} ORDER BY username LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize])).rows;
    return { items: rows.map(row => this.summary(row)), page, pageSize, total };
  }

  async detail(id: string, context: { principal: Principal; requestId: string }): Promise<ManagedAccountDetail> {
    await this.requireAdministrator(context);
    return this.db.transaction(async sql => this.detailOf(sql, await this.load(sql, id)));
  }

  async auditTrail(context: { principal: Principal; requestId: string }): Promise<{ items: ManagedAuditEntry[] }> {
    await this.requireAdministrator(context);
    const rows = (await this.db.query<{ at: Date; subject: string | null; event: string; target_id: string; data: Record<string, unknown>; request_id: string | null }>(
      `SELECT at,subject,event,target_id,data,request_id FROM audit_events WHERE event LIKE 'MANAGED_ACCOUNT_%' ORDER BY id DESC LIMIT 200`)).rows;
    return { items: rows.map(row => ({
      at: row.at.toISOString(),
      actor: String(row.data['actor'] ?? row.subject ?? ''),
      action: row.event.replace('MANAGED_ACCOUNT_', '').toLowerCase().replaceAll('_', '-') as ManagedAccountAction,
      accountId: row.target_id,
      username: String(row.data['username'] ?? ''),
      result: row.data['result'] === 'failed' ? 'failed' : 'passed',
      ...(row.request_id ? { requestId: row.request_id } : {}),
    })) };
  }

  async create(input: unknown, context: { principal: Principal; requestId: string }): Promise<ManagedAccountDetail> {
    await this.requireAdministrator(context);
    const parsed = validateCreateManagedAccount(input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const value = parsed.value;
    const id = randomUUID(), subject = randomUUID();
    const row = await this.db.transaction(async sql => {
      await this.generation(context, sql);
      try {
        await sql.query(`INSERT INTO managed_accounts(id,issuer,subject,platform_subject,username,display_name,roles,awaiting_activation)
          VALUES ($1,$2,$3,$4,$5,$6,$7,true)`, [id, this.options.issuer, subject, managedPlatformSubject(this.options.issuer, subject), value.username, value.displayName, value.roles]);
      } catch (error) { if ((error as { code?: string }).code === '23505') throw new PlatformError('CONFLICT'); throw error; }
      const created = (await sql.query<AccountRow>('SELECT * FROM managed_accounts WHERE id=$1', [id])).rows[0]!;
      await this.record(sql, created, 'create', 'passed', context);
      return created;
    });
    await this.enqueue('create', row.desired_revision, row.version, row.id, { username: row.username, displayName: row.display_name, roles: row.roles });
    return this.db.transaction(sql => this.detailOf(sql, row));
  }

  async update(id: string, input: unknown, context: { principal: Principal; requestId: string }): Promise<ManagedAccountDetail> {
    await this.requireAdministrator(context);
    const parsed = validateUpdateManagedAccount(input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const value = parsed.value;
    const row = await this.db.transaction(async sql => {
      await this.generation(context, sql);
      const current = await this.load(sql, id);
      if (current.administrator) throw new PlatformError('FORBIDDEN');
      if (current.desired_revision !== value.expectedRevision) throw new PlatformError('CONFLICT');
      // Removals and reductions are revoked locally before anything reaches the identity service.
      const tightened = await this.tighten(sql, current, {
        ...(value.displayName !== undefined ? { display_name: value.displayName } : {}),
        ...(value.roles !== undefined ? { roles: value.roles } : {}),
      });
      await this.reduceGrants(sql, tightened, value.componentGrants, value.packageGrants);
      await this.record(sql, tightened, 'update', 'passed', context, { revoked: true });
      return tightened;
    });
    await this.enqueue('update', row.desired_revision, row.version, row.id, {
      ...(value.displayName !== undefined ? { displayName: value.displayName } : {}),
      ...(value.roles !== undefined ? { roles: value.roles } : {}),
      ...(value.componentGrants !== undefined ? { componentGrants: value.componentGrants } : {}),
      ...(value.packageGrants !== undefined ? { packageGrants: value.packageGrants } : {}),
    });
    return this.db.transaction(sql => this.detailOf(sql, row));
  }

  async disable(id: string, input: unknown, context: { principal: Principal; requestId: string }): Promise<ManagedAccountDetail> {
    await this.requireAdministrator(context);
    const parsed = validateManagedAccountMutation(input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const row = await this.db.transaction(async sql => {
      await this.generation(context, sql);
      const current = await this.load(sql, id);
      if (current.administrator) throw new PlatformError('FORBIDDEN');
      if (current.desired_revision !== parsed.value.expectedRevision) throw new PlatformError('CONFLICT');
      const tightened = await this.tighten(sql, current, { enabled: false, awaiting_activation: false });
      await this.record(sql, tightened, 'disable', 'passed', context);
      return tightened;
    });
    await this.enqueue('disable', row.desired_revision, row.version, row.id, {});
    return this.db.transaction(sql => this.detailOf(sql, row));
  }

  async enable(id: string, input: unknown, context: { principal: Principal; requestId: string }): Promise<ManagedAccountDetail> {
    await this.requireAdministrator(context);
    const parsed = validateManagedAccountMutation(input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const row = await this.db.transaction(async sql => {
      await this.generation(context, sql);
      const current = await this.load(sql, id);
      if (current.administrator) throw new PlatformError('FORBIDDEN');
      if (current.desired_revision !== parsed.value.expectedRevision) throw new PlatformError('CONFLICT');
      // A queued request must never open access by itself.
      if (!current.credentials_set || current.credential_uncertain || current.sync_state !== 'synced') throw new PlatformError('CONFLICT');
      const tightened = await this.tighten(sql, current, {});
      await this.record(sql, tightened, 'enable', 'passed', context);
      return tightened;
    });
    await this.enqueue('enable', row.desired_revision, row.version, row.id, {});
    return this.db.transaction(sql => this.detailOf(sql, row));
  }

  async forceLogout(id: string, input: unknown, context: { principal: Principal; requestId: string }): Promise<ManagedAccountDetail> {
    await this.requireAdministrator(context);
    const parsed = validateManagedAccountMutation(input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const row = await this.db.transaction(async sql => {
      await this.generation(context, sql);
      const current = await this.load(sql, id);
      if (current.administrator) throw new PlatformError('FORBIDDEN');
      if (current.desired_revision !== parsed.value.expectedRevision) throw new PlatformError('CONFLICT');
      const tightened = await this.tighten(sql, current, {});
      await this.record(sql, tightened, 'force-logout', 'passed', context);
      return tightened;
    });
    await this.enqueue('force-logout', row.desired_revision, row.version, row.id, {});
    return this.db.transaction(sql => this.detailOf(sql, row));
  }

  /**
   * Transient password setting. The local revocation commits first, the remote call runs inline,
   * and only an explicit remote confirmation clears the denial. An uncertain network outcome keeps
   * the account denied and is resolved by controlled operations, never by an automatic retry.
   */
  async setPassword(id: string, input: unknown, password: string, context: { principal: Principal; requestId: string }): Promise<ManagedAccountDetail> {
    await this.requireAdministrator(context);
    const parsed = validateSetManagedAccountPassword({ ...(input as Record<string, unknown>), password });
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const row = await this.db.transaction(async sql => {
      await this.generation(context, sql);
      const current = await this.load(sql, id);
      if (current.administrator) throw new PlatformError('FORBIDDEN');
      if (current.credential_uncertain) throw new PlatformError('CONFLICT');
      if (current.desired_revision !== parsed.value.expectedRevision) throw new PlatformError('CONFLICT');
      const tightened = await this.tighten(sql, current, { credential_uncertain: true, credentials_set: false });
      await this.record(sql, tightened, 'set-password', 'passed', context, { state: 'requested' });
      return tightened;
    });
    if (!row.remote_user_id) {
      await this.db.query('UPDATE managed_accounts SET sync_state=$2,last_sync_error=$3 WHERE id=$1', [id, 'failed', 'remote account is not synchronised yet']);
      throw new PlatformError('CONFLICT');
    }
    let confirmed: AccountRow;
    try {
      await this.identity.setTemporaryPassword(row.remote_user_id, password, row.version);
      confirmed = await this.db.transaction(async sql => {
        const current = await this.load(sql, id);
        // A newer operation supersedes this one; the confirmation must not resurrect older state.
        if (current.version !== row.version) throw new PlatformError('CONFLICT');
        return this.finalize(sql, current, {
          credential_uncertain: false, credentials_set: true,
          ...(current.awaiting_activation ? { enabled: true, awaiting_activation: false } : {}),
        });
      });
    } catch (error) {
      const superseded = error instanceof PlatformError && error.code === 'CONFLICT';
      await this.db.query('UPDATE managed_accounts SET credential_uncertain=true,credentials_set=false,sync_state=$2,last_sync_error=$3 WHERE id=$1',
        [id, superseded ? 'failed' : 'failed', superseded ? 'superseded by a newer operation' : 'remote password outcome is uncertain']);
      await this.db.transaction(sql => this.record(sql, row, 'set-password', 'failed', context, { reason: superseded ? 'superseded' : 'uncertain' }));
      throw new PlatformError('INFRA_UNAVAILABLE');
    }
    await this.db.transaction(sql => this.record(sql, confirmed, 'set-password', 'passed', context, { state: 'confirmed' }));
    return this.db.transaction(sql => this.detailOf(sql, confirmed));
  }

  /**
   * Called by the authentication path with the signed token payload. Every claim is checked
   * against the directory and every comparison fails closed: a missing or malformed claim,
   * an older account version, or an authentication time at or below the floor all deny access.
   */
  async verifiedAccount(principal: Principal, claims: Record<string, unknown>): Promise<AccountRow> {
    const row = await this.resolveSelfManaged(principal);
    if (!row) throw new AuthFailure('UNAUTHENTICATED');
    if (!row.enabled) throw new AuthFailure('FORBIDDEN');
    const version = claims['platform_account_version'];
    const authTime = claims['auth_time'];
    if (typeof version !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(version) || version !== row.version) throw new AuthFailure('UNAUTHENTICATED');
    if (typeof authTime !== 'number' || !Number.isInteger(authTime) || authTime <= Number(row.auth_time_floor)) throw new AuthFailure('UNAUTHENTICATED');
    const iat = claims['iat'];
    if (typeof iat !== 'number' || !Number.isInteger(iat) || iat < authTime) throw new AuthFailure('UNAUTHENTICATED');
    return row;
  }
  async accountFor(platformSubject: string): Promise<AccountRow | undefined> {
    return (await this.db.query<AccountRow>('SELECT * FROM managed_accounts WHERE platform_subject=$1', [platformSubject])).rows[0];
  }
  async sessionAccount(sql: Sql, platformSubject: string): Promise<AccountRow | undefined> {
    return (await sql.query<AccountRow>('SELECT * FROM managed_accounts WHERE platform_subject=$1 FOR UPDATE', [platformSubject])).rows[0];
  }

  // --- Identity operation processing (restartable, serialised per account) -------------------

  async claimOperations(owner: string, limit: number, leaseSeconds: number): Promise<OperationRow[]> {
    return (await this.db.query<OperationRow>(`UPDATE identity_operations SET state='running',attempts=attempts+1,
        fencing_token=fencing_token+1,lease_owner=$1,lease_expires_at=clock_timestamp()+($2 || ' seconds')::interval,updated_at=clock_timestamp()
      WHERE id IN (SELECT id FROM identity_operations WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $3)
      RETURNING *`, [owner, String(leaseSeconds), limit])).rows;
  }
  async releaseExpiredOperations(): Promise<void> {
    await this.db.query(`UPDATE identity_operations SET state='queued',lease_owner=NULL,lease_expires_at=NULL
      WHERE state='running' AND lease_expires_at < clock_timestamp()`);
  }
  private async finish(id: string, state: 'done' | 'failed' | 'uncertain', error?: string): Promise<void> {
    await this.db.query('UPDATE identity_operations SET state=$2,last_error=$3,lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1', [id, state, error ?? null]);
  }
  private async mark(accountId: string, state: ManagedAccountSyncState, error: string | null): Promise<void> {
    await this.db.query('UPDATE managed_accounts SET sync_state=$2,last_sync_error=$3,updated_at=clock_timestamp() WHERE id=$1', [accountId, state, error]);
  }

  /** Applies one queued operation against the identity service and closes the local state. */
  async processOperation(operation: OperationRow): Promise<void> {
    const payload = operation.payload;
    const row = (await this.db.query<AccountRow>('SELECT * FROM managed_accounts WHERE id=$1', [operation.account_id])).rows[0];
    if (!row) { await this.finish(operation.id, 'done'); return; }
    if (row.version !== operation.account_version) { await this.finish(operation.id, 'done', 'superseded by a newer account version'); return; }
    if (!IDENTITY_KINDS.includes(operation.kind)) { await this.finish(operation.id, 'done'); return; }
    try {
      if (operation.kind === 'create') await this.remoteCreate(row, payload);
      else if (operation.kind === 'update') await this.remoteUpdate(row, payload);
      else if (operation.kind === 'disable') await this.remoteState(row, false);
      else if (operation.kind === 'enable') await this.remoteState(row, true);
      else await this.remoteRevoke(row);
      await this.finish(operation.id, 'done');
    } catch (error) {
      const uncertain = !(error instanceof PlatformError);
      await this.finish(operation.id, uncertain ? 'uncertain' : 'failed', 'identity synchronisation failed');
      await this.mark(row.id, uncertain ? 'pending' : 'failed', uncertain ? 'awaiting controlled reconciliation' : 'identity synchronisation failed');
      throw error;
    }
  }

  private async remoteCreate(row: AccountRow, payload: Record<string, unknown>): Promise<void> {
    const username = String(payload['username'] ?? row.username);
    const existing = await this.identity.findByUsername(username);
    // A same-named remote user is only adopted when it carries this account's own marker.
    if (existing && existing.managedUserId !== row.id) throw new PlatformError('CONFLICT');
    const remote = existing && existing.managedUserId === row.id
      ? await this.identity.updateAccount(existing.id, { displayName: String(payload['displayName'] ?? row.display_name), roles: (payload['roles'] as ManagedAccountRole[]) ?? row.roles, accountVersion: row.version })
      : await this.identity.createAccount({ username, displayName: String(payload['displayName'] ?? row.display_name), roles: (payload['roles'] as ManagedAccountRole[]) ?? row.roles, managedUserId: row.id, accountVersion: row.version });
    if (remote.id !== (row.remote_user_id ?? remote.id)) throw new PlatformError('CONFLICT');
    await this.db.transaction(async sql => {
      const current = await this.load(sql, row.id);
      const closed = await this.finalize(sql, current, { remote_user_id: remote.id, sync_state: 'synced', last_sync_error: null });
      await this.record(sql, closed, 'create', 'passed', { principal: { issuer: row.issuer, identitySubject: row.subject, subject: row.platform_subject, clientId: 'identity-worker', channel: 'cli', roles: [] }, requestId: 'identity-' + row.id }, { synchronised: true });
    });
  }
  private async remoteUpdate(row: AccountRow, payload: Record<string, unknown>): Promise<void> {
    if (!row.remote_user_id) throw new PlatformError('CONFLICT');
    const remote = await this.identity.updateAccount(row.remote_user_id, {
      ...(payload['displayName'] !== undefined ? { displayName: String(payload['displayName']) } : {}),
      ...(payload['roles'] !== undefined ? { roles: payload['roles'] as ManagedAccountRole[] } : {}),
      accountVersion: row.version,
    });
    if (remote.id !== row.remote_user_id) throw new PlatformError('CONFLICT');
    await this.db.transaction(async sql => {
      const current = await this.load(sql, row.id);
      // Widening only happens here, after the identity service confirmed the new state.
      await this.expandGrants(sql, current, payload['componentGrants'] as ManagedAccountComponentGrant[] | undefined, payload['packageGrants'] as string[] | undefined);
      await this.finalize(sql, current, { sync_state: 'synced', last_sync_error: null });
    });
  }
  private async remoteState(row: AccountRow, enabled: boolean): Promise<void> {
    if (!row.remote_user_id) throw new PlatformError('CONFLICT');
    const remote = await this.identity.updateAccount(row.remote_user_id, { enabled, accountVersion: row.version });
    if (remote.id !== row.remote_user_id || remote.enabled !== enabled) throw new PlatformError('CONFLICT');
    await this.identity.revokeSessions(row.remote_user_id);
    await this.db.transaction(async sql => {
      const current = await this.load(sql, row.id);
      await this.finalize(sql, current, enabled
        ? { enabled: true, awaiting_activation: false, sync_state: 'synced', last_sync_error: null }
        : { enabled: false, awaiting_activation: false, sync_state: 'synced', last_sync_error: null });
    });
  }
  private async remoteRevoke(row: AccountRow): Promise<void> {
    if (!row.remote_user_id) throw new PlatformError('CONFLICT');
    await this.identity.revokeSessions(row.remote_user_id);
    await this.db.transaction(async sql => {
      const current = await this.load(sql, row.id);
      await this.finalize(sql, current, { sync_state: 'synced', last_sync_error: null });
    });
  }
}

export { validateManagedAccountDetail, type UpdateManagedAccountRequest, type SetManagedAccountPasswordRequest };
