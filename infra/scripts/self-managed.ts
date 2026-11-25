import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const infra = join(root, 'infra');
const directory = join(root, '.tools/self-managed');
const compose = join(infra, 'compose.self-managed.yaml');
const versions = JSON.parse(readFileSync(join(infra, 'self-managed-versions.json'), 'utf8')) as { keycloak: { image: string | null }; postgres: { image: string }; realmTemplate: string; endpoints: { identityHttps: string; postgres: string } };
const endpoints = versions.endpoints as { identityHttps: string; postgres: string };

function docker(args: string[], options: { input?: string; visible?: boolean } = {}): string {
  return execFileSync('docker', args, {
    cwd: root, encoding: 'utf8', windowsHide: true, shell: false, input: options.input,
    stdio: options.visible ? 'inherit' : 'pipe', maxBuffer: 32 * 1024 ** 2, timeout: 600_000,
    env: { ...process.env, ...(versions.keycloak.image ? { SELF_MANAGED_KEYCLOAK_IMAGE: versions.keycloak.image } : {}), SELF_MANAGED_POSTGRES_IMAGE: versions.postgres.image },
  }) ?? '';
}
function composeArgs(args: string[]): string[] { return ['compose', '-p', 'zhinexus-self-managed', '-f', compose, ...args]; }
function secret(name: string): string { return readFileSync(join(directory, name), 'utf8').trim(); }
function requireSecret(name: string): void {
  if (!existsSync(join(directory, name))) throw new Error(`Missing self-managed credential file: ${name}; run infra:self-managed:up first`);
}

/** Only the first run on an empty private stack may create credentials. */
function initialize(): void {
  mkdirSync(directory, { recursive: true });
  if (existsSync(join(directory, 'state.json'))) {
    for (const file of ['postgres-password', 'keycloak-bootstrap-password', 'tls-certificate.pem', 'tls-private-key.pem']) requireSecret(file);
    return;
  }
  const existing = docker(['volume', 'ls', '--filter', 'label=com.docker.compose.project=zhinexus-self-managed', '--format', '{{.Name}}']).trim();
  if (existing) throw new Error('Existing self-managed volumes found without a state file; recover the private credential directory instead of resetting data');
  const write = (name: string, value: string, mode = 0o600) => { writeFileSync(join(directory, name), value, { mode }); };
  write('postgres-password', randomBytes(32).toString('base64url'));
  // The bootstrap administrator exists only to create the realm and the first platform administrator.
  write('keycloak-bootstrap-password', randomBytes(32).toString('base64url'));
  // A private CA and an IP certificate are generated locally; the client must trust this CA.
  const caKey = join(directory, 'ca-private-key.pem'), caCert = join(directory, 'ca-certificate.pem');
  const host = process.env['PLATFORM_SELF_MANAGED_HOST'] ?? '127.0.0.1';
  docker(['run', '--rm', '-v', `${directory}:/work`, '-w', '/work', 'alpine/openssl:3', 'sh', '-ec',
    `openssl genrsa -out ca-private-key.pem 4096 && openssl req -x509 -new -nodes -key ca-private-key.pem -sha256 -days 3650 -subj "/CN=Zhinexus Self-Managed Local CA" -out ca-certificate.pem && openssl genrsa -out tls-private-key.pem 2048 && openssl req -new -key tls-private-key.pem -subj "/CN=${host}" -out request.csr && printf 'subjectAltName=IP:${host}\\nextendedKeyUsage=serverAuth\\n' > ext.cnf && openssl x509 -req -in request.csr -CA ca-certificate.pem -CAkey ca-private-key.pem -CAcreateserial -out tls-certificate.pem -days 825 -sha256 -extfile ext.cnf && rm -f request.csr ext.cnf`]);
  chmodSync(join(directory, 'ca-private-key.pem'), 0o600);
  write('state.json', JSON.stringify({ createdAt: new Date().toISOString(), host, realm: 'zhinexus' }, null, 2) + '\n');
}

function token(url: string, realm: string, clientId: string, clientSecret: string | undefined, username: string, password: string): string {
  const form = new URLSearchParams({ grant_type: 'password', client_id: clientId, username, password, ...(clientSecret ? { client_secret: clientSecret } : {}) });
  const response = execFileSync('curl', ['-sS', '--fail-with-body', '-X', 'POST', `${url}/realms/${realm}/protocol/openid-connect/token`, '-H', 'content-type: application/x-www-form-urlencoded', '--data-binary', form.toString()], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 ** 2 });
  const parsed = JSON.parse(response) as { access_token?: string };
  if (!parsed.access_token) throw new Error('Identity service refused the administrator token; no credential details printed');
  return parsed.access_token;
}

function call(url: string, path: string, method: string, access: string, body?: unknown): { status: number; value: unknown } {
  const args = ['-sS', '-o', '/dev/stdout', '-w', '\n%{http_code}', '-X', method, `${url}${path}`, '-H', `authorization: Bearer ${access}`, '-H', 'content-type: application/json'];
  if (body !== undefined) args.push('--data-binary', JSON.stringify(body));
  const output = execFileSync('curl', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] });
  const index = output.lastIndexOf('\n');
  return { status: Number(output.slice(index + 1).trim()), value: (() => { try { return JSON.parse(output.slice(0, index)); } catch { return undefined; } })() };
}

const realmTemplate = () => JSON.parse(readFileSync(join(infra, versions.realmTemplate), 'utf8')) as Record<string, unknown>;
const substitute = (value: unknown, replacements: Record<string, string>): unknown => JSON.parse(JSON.stringify(value).replaceAll(/__[A-Z0-9_]+__/gu, match => replacements[match] ?? match));

/** Registers the deployment administrator in the platform directory; never reachable over HTTP. */
async function registerAdministrator(issuer: string, subject: string, username: string, displayName: string): Promise<void> {
  const { Platform, environmentOptions } = await import('../../apps/api/dist/platform.js');
  const platform = new Platform({ ...environmentOptions(), databaseUrl: process.env['PLATFORM_DATABASE_URL']! });
  const digest = createHash('sha256').update(issuer + '\0' + subject).digest('hex');
  await platform.db!.transaction(async sql => {
    await sql.query(`INSERT INTO managed_accounts(id,issuer,subject,platform_subject,username,display_name,roles,administrator,enabled,awaiting_activation,credentials_set,sync_state,desired_revision,access_epoch,version)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,true,true,false,true,'synced',1,0,1)
      ON CONFLICT (issuer,subject) DO UPDATE SET administrator=true,enabled=true,awaiting_activation=false,credentials_set=true,sync_state='synced'`,
      [issuer, subject, 'oidc:' + digest, username, displayName, JSON.stringify(['reader'])]);
    await sql.query('INSERT INTO audit_events(subject,event,target_id,data) VALUES ($1,$2,$3,$4)', ['deployment:self-managed-bootstrap', 'MANAGED_ACCOUNT_CREATE', username, JSON.stringify({ username, result: 'passed', administrator: true })]);
  });
  await platform.onApplicationShutdown();
}

/** The statements the local bootstrap issues; narrow enough to be answered from memory in tests. */
export type SeedingSql = { query: (sql: string, values: unknown[]) => Promise<unknown> };

/**
 * The self-managed issuer is deployment configuration. The same shape is enforced in
 * `apps/api/src/platform.ts`, so an issuer the API would reject cannot be seeded here.
 */
export function assertSelfManagedIssuer(value: string | undefined): string {
  const issuer = (value ?? '').trim();
  if (!issuer) throw new Error('PLATFORM_SELF_MANAGED_ISSUER is required; it is deployment configuration and is never taken from a request');
  let parsed: URL;
  try { parsed = new URL(issuer); } catch { throw new Error('PLATFORM_SELF_MANAGED_ISSUER is not a valid URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('PLATFORM_SELF_MANAGED_ISSUER must be an https URL without credentials, query or fragment');
  }
  return issuer;
}

/** One administrator per issuer: a second seed would silently compete for the same identity. */
export async function localAdministratorPresent(sql: SeedingSql, issuer: string): Promise<boolean> {
  const found = (await sql.query('SELECT administrator FROM managed_accounts WHERE issuer=$1 AND administrator=true LIMIT 1', [issuer])) as { rows: unknown[] };
  return found.rows.length > 0;
}

export type LocalAdministratorSeed = {
  id: string; subject: string; platformSubject: string; issuer: string;
  username: string; displayName: string; roles: readonly string[]; passwordHash: string;
};

/**
 * Seeds the one administrator the local identity service allows. The account is enabled with its
 * credential already set, so no identity operation is queued and the platform never has to
 * synchronise it; `must_change` still forces a replacement on first login. Only the digest is
 * written — the temporary password itself is returned to the operator and never persisted.
 */
export async function seedLocalAdministrator(sql: SeedingSql, seed: LocalAdministratorSeed): Promise<void> {
  await sql.query(`INSERT INTO managed_accounts(id,issuer,subject,platform_subject,username,display_name,roles,administrator,enabled,awaiting_activation,credentials_set,sync_state,remote_user_id,desired_revision,access_epoch,version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
  [seed.id, seed.issuer, seed.subject, seed.platformSubject, seed.username, seed.displayName, JSON.stringify(seed.roles),
    true, true, false, true, 'synced', seed.id, 1, 0, 1]);
  // Same upsert shape as LocalIdentityStore.putCredential, so a replayed seed cannot duplicate a row.
  await sql.query(`INSERT INTO local_credentials(account_id,password_hash,must_change) VALUES ($1,$2,$3)
    ON CONFLICT (account_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,must_change=EXCLUDED.must_change,updated_at=clock_timestamp()`,
  [seed.id, seed.passwordHash, true]);
  await sql.query('INSERT INTO audit_events(subject,event,target_id,data) VALUES ($1,$2,$3,$4)',
  ['deployment:self-managed-bootstrap-local', 'MANAGED_ACCOUNT_CREATE', seed.username, JSON.stringify({ username: seed.username, result: 'passed', administrator: true })]);
}

export type SeededAdministrator = { created: true; username: string; temporaryPassword: string } | { created: false };

export async function seedFirstLocalAdministrator(options: { strict: true }): Promise<{ created: true; username: string; temporaryPassword: string }>;
export async function seedFirstLocalAdministrator(options: { strict: false }): Promise<SeededAdministrator>;

/**
 * Seeds the first platform administrator for the local identity service, or reports that one
 * already exists. Shared by `bootstrap-local` and by `up`, which seeds automatically so a fresh
 * stack is usable without a second command: the default deployment must hand the operator an
 * administrator, because without one no member can be created and no permission assigned.
 *
 * `strict` distinguishes the two callers. The standalone command refuses to run against a
 * directory that already has an administrator, so an operator cannot silently think they just
 * rotated the only administrator's credential; `up` treats that as the normal, already-seeded case.
 */
export async function seedFirstLocalAdministrator(options: { strict: boolean }): Promise<SeededAdministrator> {
  const issuer = assertSelfManagedIssuer(process.env['PLATFORM_SELF_MANAGED_ISSUER']);
  const databaseUrl = process.env['PLATFORM_DATABASE_URL'];
  if (!databaseUrl) throw new Error('PLATFORM_DATABASE_URL is required; the local identity service stores credentials in the platform database');
  const username = process.env['PLATFORM_SELF_MANAGED_ADMIN_USERNAME'] ?? 'platform-admin';
  const displayName = process.env['PLATFORM_SELF_MANAGED_ADMIN_DISPLAY_NAME'] ?? '平台管理员';
  const { Platform } = await import('../../apps/api/dist/platform.js');
  const { managedPlatformSubject } = await import('../../apps/api/dist/accounts/service.js');
  const { hashPassword } = await import('../../apps/api/dist/identity/local/password.js');
  const { migrateRegistry } = await import('../../apps/api/dist/db/migrate.js');
  // Only the database is needed, so unrelated deployment validation cannot block the seed.
  const platform = new Platform({ databaseUrl });
  const password = randomBytes(24).toString('base64url');
  try {
    await migrateRegistry(platform.db!);
    const id = randomUUID(), subject = randomUUID();
    const seeded = await platform.db!.transaction(async sql => {
      if (await localAdministratorPresent(sql, issuer)) {
        if (options.strict) throw new Error('A platform administrator already exists for this issuer; this bootstrap only runs on an empty directory');
        return false;
      }
      await seedLocalAdministrator(sql, {
        id, subject, platformSubject: managedPlatformSubject(issuer, subject), issuer,
        username, displayName, roles: ['reader'], passwordHash: await hashPassword(password),
      });
      return true;
    });
    return seeded ? { created: true, username, temporaryPassword: password } : { created: false };
  } finally { await platform.onApplicationShutdown(); }
}

/**
 * Keycloak-free first administrator for `PLATFORM_IDENTITY_MODE=local`. The platform's own
 * identity service holds credentials in `local_credentials` and exposes no administration
 * surface, so this is the only way an administrator can come to exist; without one,
 * `requireAdministrator` rejects every managed-account call and the console cannot create
 * accounts at all. Migrations run first so a fresh stack needs a single command.
 */
async function bootstrapLocal(): Promise<void> {
  const seeded = await seedFirstLocalAdministrator({ strict: true });
  // The password is shown once, only to the operator, and never written to the repository.
  process.stdout.write(JSON.stringify({
    event: 'SELF_MANAGED_BOOTSTRAPPED_LOCAL', administrator: seeded.username, temporaryPassword: seeded.temporaryPassword,
    note: '首次登录必须更换该临时口令；口令只在本行输出一次',
  }, null, 2) + '\n');
}

async function bootstrap(): Promise<void> {
  requireSecret('keycloak-bootstrap-password');
  const host = process.env['PLATFORM_SELF_MANAGED_HOST'] ?? '127.0.0.1';
  const identity = `https://${host}:29443`;
  const issuer = `${identity}/realms/zhinexus`;
  const apiOrigin = process.env['PLATFORM_API_ORIGIN'] ?? 'https://api.zhinexus.internal';
  const galleryOrigin = process.env['PLATFORM_GALLERY_ORIGIN'] ?? 'https://gallery.zhinexus.internal';
  const cliPort = process.env['PLATFORM_CLI_REDIRECT_PORT'] ?? '43129';
  const master = token(identity, 'master', 'admin-cli', undefined, 'bootstrap-admin', secret('keycloak-bootstrap-password'));
  const realm = substitute(realmTemplate(), {
    __PLATFORM_API_ORIGIN__: apiOrigin,
    __PLATFORM_GALLERY_ORIGIN__: galleryOrigin,
    __PLATFORM_CLI_REDIRECT_PORT__: cliPort,
  }) as Record<string, unknown>;
  const existing = call(identity, '/admin/realms/zhinexus', 'GET', master);
  if (existing.status === 200) throw new Error('Realm zhinexus already exists; this bootstrap only runs on an empty private stack');
  const created = call(identity, '/admin/realms', 'POST', master, realm);
  if (created.status !== 201) throw new Error('Realm creation was rejected; no response details printed');

  // The realm service account gets only the user and role management it needs.
  const serviceAccount = process.env['PLATFORM_IDENTITY_ADMIN_CLIENT_ID'] ?? 'zhinexus-identity-admin';
  const serviceSecret = randomBytes(32).toString('base64url');
  const updated = call(identity, `/admin/realms/zhinexus/clients/${encodeURIComponent(serviceAccount)}`, 'PUT', master, { secret: serviceSecret });
  if (updated.status !== 204) throw new Error('Service account secret rotation was rejected');
  const roles = call(identity, '/admin/realms/zhinexus/roles', 'GET', master);
  const serviceUser = (call(identity, `/admin/realms/zhinexus/clients/${encodeURIComponent(serviceAccount)}/service-account-user`, 'GET', master).value as { id?: string } | undefined)?.id;
  if (!serviceUser) throw new Error('Service account user was not created');
  const available = ((roles.value as { name: string; id: string }[]) ?? []).filter(role => ['manage-users', 'view-users', 'query-users', 'query-groups', 'view-realm'].includes(role.name));
  if (available.length !== 5) throw new Error('Realm management roles are missing; refusing to grant a broader set');
  const mapped = call(identity, `/admin/realms/zhinexus/users/${serviceUser}/role-mappings/realm`, 'POST', master, available.map(role => ({ id: role.id, name: role.name })));
  if (mapped.status !== 204) throw new Error('Service account role assignment was rejected');
  writeFileSync(join(directory, 'identity-admin-client-secret'), serviceSecret, { mode: 0o600 });

  // The first platform administrator: random password, must be changed on first login.
  const username = process.env['PLATFORM_SELF_MANAGED_ADMIN_USERNAME'] ?? 'platform-admin';
  const password = randomBytes(24).toString('base64url');
  const createdUser = call(identity, '/admin/realms/zhinexus/users', 'POST', master, {
    username, firstName: '平台管理员', enabled: true, emailVerified: false, credentials: [{ type: 'password', value: password, temporary: true }],
    requiredActions: ['UPDATE_PASSWORD'],
    attributes: { platform_managed_user_id: [randomBytes(16).toString('hex')], platform_account_version: ['1'] },
  });
  if (createdUser.status !== 201) throw new Error('Administrator creation was rejected');
  const location = String((createdUser.value as { location?: unknown } | undefined)?.location ?? '');
  const subject = /\/users\/([^/]+)$/u.exec(location)?.[1];
  if (!subject) throw new Error('Administrator subject was not returned');
  const granted = call(identity, `/admin/realms/zhinexus/users/${subject}/role-mappings/realm`, 'POST', master, ((roles.value as { name: string; id: string }[]) ?? []).filter(role => role.name === 'reader').map(role => ({ id: role.id, name: role.name })));
  if (granted.status !== 204) throw new Error('Administrator role assignment was rejected');

  await registerAdministrator(issuer, subject, username, '平台管理员');
  // The password is shown once, only to the operator, and never written to the repository.
  process.stdout.write(JSON.stringify({ event: 'SELF_MANAGED_BOOTSTRAPPED', issuer, realm: 'zhinexus', administrator: username, temporaryPassword: password, trustCa: join(directory, 'ca-certificate.pem') }, null, 2) + '\n');
}

/**
 * Seeds the first administrator when the stack runs the platform's own identity service. A fresh
 * local stack must hand the operator a usable administrator: without one, `requireAdministrator`
 * rejects every managed-account request and the console can neither create accounts nor assign any
 * permission. Failures are fatal — a stack that reports success while silently having no
 * administrator is worse than one that refuses to come up.
 */
async function seedOnStackUp(): Promise<void> {
  // The same default `apps/api/src/platform.ts` applies, so the gate cannot drift from the API's.
  if ((process.env['PLATFORM_IDENTITY_MODE'] ?? 'keycloak') !== 'local') return;
  const seeded = await seedFirstLocalAdministrator({ strict: false });
  if (!seeded.created) {
    process.stdout.write(JSON.stringify({ event: 'SELF_MANAGED_ADMINISTRATOR_PRESENT', note: '该 issuer 下已有平台管理员，未重复播种' }) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify({
    event: 'SELF_MANAGED_ADMINISTRATOR_SEEDED', administrator: seeded.username, temporaryPassword: seeded.temporaryPassword,
    note: '首次登录必须更换该临时口令；口令只在本行输出一次，不写入仓库',
  }, null, 2) + '\n');
}

const command = process.argv[2];
if (command === 'up') {
  initialize();
  docker(composeArgs(['up', '-d', '--wait']), { visible: true });
  await seedOnStackUp();
  process.stdout.write(JSON.stringify({ event: 'SELF_MANAGED_STACK_UP', ...endpoints }) + '\n');
} else if (command === 'stop') {
  docker(composeArgs(['down']), { visible: true });
} else if (command === 'credentials') {
  requireSecret('state.json');
  process.stdout.write(JSON.stringify({ event: 'SELF_MANAGED_CREDENTIALS', directory, note: '文件仅位于本机私有凭据目录，不写入 Git' }) + '\n');
} else if (command === 'bootstrap') {
  await bootstrap();
} else if (command === 'bootstrap-local') {
  await bootstrapLocal();
} else if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Guarded as in infra/scripts/local.ts: importing this module (tests) must not start infrastructure.
  process.stderr.write('Usage: self-managed.ts <up|stop|credentials|bootstrap|bootstrap-local>\n');
  process.exitCode = 1;
}
