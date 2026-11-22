import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const command = process.argv[2];
if (command === 'up') {
  initialize();
  docker(composeArgs(['up', '-d', '--wait']), { visible: true });
  process.stdout.write(JSON.stringify({ event: 'SELF_MANAGED_STACK_UP', ...endpoints }) + '\n');
} else if (command === 'stop') {
  docker(composeArgs(['down']), { visible: true });
} else if (command === 'credentials') {
  requireSecret('state.json');
  process.stdout.write(JSON.stringify({ event: 'SELF_MANAGED_CREDENTIALS', directory, note: '文件仅位于本机私有凭据目录，不写入 Git' }) + '\n');
} else if (command === 'bootstrap') {
  await bootstrap();
} else {
  process.stderr.write('Usage: self-managed.ts <up|stop|credentials|bootstrap>\n');
  process.exitCode = 1;
}
