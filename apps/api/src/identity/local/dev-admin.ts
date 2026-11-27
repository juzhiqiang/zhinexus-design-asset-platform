import { randomUUID } from 'node:crypto';
import type { PlatformOptions } from '../../platform.js';
import type { Database } from '../../db/database.js';
import { PlatformError } from '../../errors.js';
import { managedPlatformSubject } from '../../accounts/service.js';
import { hashPassword } from './password.js';

export type DevAdminConfig = { username: string; password: string };
const apiOrigin = 'http://127.0.0.1:3000';
const issuer = apiOrigin + '/identity';
const subject = 'dev-admin';

/** Only internally generated loopback settings receive the development HTTP exception. */
export function developmentOptions(options: PlatformOptions): PlatformOptions {
  if (process.env.NODE_ENV === 'production' || process.env.PLATFORM_BIND_HOST === '0.0.0.0'
    || !options.databaseUrl || options.oidc || options.access || options.localIdentity || options.identity || options.managedAccounts
    || (options.adminOrigin && options.adminOrigin !== 'http://127.0.0.1:5177')
    || (options.galleryOrigin && options.galleryOrigin !== 'http://127.0.0.1:5173')) throw new PlatformError('INVALID_SCHEMA');
  const initialOidc = { issuer, audience: 'zhinexus-admin', webClientId: 'zhinexus-web', cliClientId: 'zhinexus-cli', webRedirectUri: apiOrigin + '/v1/auth/oidc/callback', cliRedirectUri: 'http://127.0.0.1:54321/callback', roleClaim: 'roles', roleMapping: { reader: 'reader', publisher: 'publisher', maintainer: 'maintainer' } };
  return { ...options, galleryOrigin: 'http://127.0.0.1:5173', adminOrigin: 'http://127.0.0.1:5177',
    access: { apiOrigin, administrators: [{ issuer, subject }], outbound: [], initialOidc },
    managedAccounts: { issuer, realm: 'local' },
    localIdentity: { issuer, audience: initialOidc.audience, webClientId: initialOidc.webClientId, cliClientId: initialOidc.cliClientId, webRedirectUris: [initialOidc.webRedirectUri], cliRedirectUris: [initialOidc.cliRedirectUri] },
    oidc: { issuer, audience: initialOidc.audience, jwksUri: issuer + '/jwks', webClientIds: [initialOidc.webClientId], cliClientIds: [initialOidc.cliClientId] },
  };
}

/** First boot only. Serialises concurrent boots and never resets an existing account. */
export async function bootstrapDevelopment(db: Database, config: DevAdminConfig): Promise<void> {
  const username = config.username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(username)) throw new PlatformError('INVALID_SCHEMA');
  await db.transaction(async sql => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('zhinexus-local-development-bootstrap'))");
    if ((await sql.query("SELECT 1 FROM access_active WHERE section='oidc' AND active_revision_id IS NOT NULL")).rowCount) throw new PlatformError('UNAUTHENTICATED');
    if ((await sql.query('SELECT 1 FROM managed_accounts WHERE issuer=$1 AND subject=$2', [issuer, subject])).rowCount) return;
    const id = randomUUID();
    await sql.query(`INSERT INTO managed_accounts(id,issuer,subject,platform_subject,username,display_name,roles,administrator,enabled,awaiting_activation,credentials_set,sync_state,remote_user_id,desired_revision,access_epoch,version)
      VALUES ($1,$2,$3,$4,$5,'本地管理员',$6,true,true,false,true,'synced',$7,1,0,1)`,
    [id, issuer, subject, managedPlatformSubject(issuer, subject), username, ['reader', 'publisher', 'maintainer'], id]);
    await sql.query('INSERT INTO local_credentials(account_id,password_hash,must_change) VALUES ($1,$2,false)', [id, await hashPassword(config.password)]);
    await sql.query('INSERT INTO audit_events(subject,event,target_id,data) VALUES ($1,$2,$3,$4)', ['deployment:local-development', 'MANAGED_ACCOUNT_CREATE', username, JSON.stringify({ administrator: true })]);
  });
}
