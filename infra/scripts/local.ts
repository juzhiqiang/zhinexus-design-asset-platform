import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const localDir = join(root, '.tools/g2-local');
export const versions = JSON.parse(readFileSync(join(root, 'infra/versions.json'), 'utf8'));
export const endpoints = { postgres: '127.0.0.1:15432', registry: 'http://127.0.0.1:14873', s3: 'http://127.0.0.1:19000' };
export type Credentials = { postgresPassword: string; publisherPassword: string; readerPassword: string; minioUser: string; minioPassword: string };
export function command(executable: string, args: string[], options: { cwd?: string; input?: string; visible?: boolean; env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  try {
    return execFileSync(executable, args, {
      cwd: options.cwd ?? root, env: options.env ?? process.env, input: options.input,
      encoding: 'utf8', windowsHide: true, shell: false, timeout: options.timeout ?? 120_000,
      maxBuffer: 32 * 1024 * 1024, stdio: options.visible ? 'inherit' : 'pipe',
    }) ?? '';
  } catch (error) {
    // Command arguments and child output can contain private registry/auth data.
    let code = 'COMMAND_FAILED';
    try {
      const candidate = JSON.parse(String((error as { stdout?: unknown }).stdout)).error?.code;
      if (['EPUBLISHCONFLICT', 'E401', 'E403', 'E409', 'ECONNREFUSED', 'ETIMEDOUT'].includes(candidate)) code = candidate;
    } catch { /* Only allow known structured codes into diagnostics. */ }
    throw new Error(`Local command failed: ${code}; no credentials printed`);
  }
}
export async function withLocalLock<T>(operation: () => Promise<T>, directory = localDir): Promise<T> {
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, 'operation.lock');
  try { mkdirSync(lock); } catch { throw new Error('Local infrastructure is locked; wait for the active operation (see infra/README.md for interrupted runs)'); }
  try { return await operation(); } finally { rmdirSync(lock); }
}
export function credentials(): Credentials {
  return JSON.parse(readFileSync(join(localDir, 'credentials.json'), 'utf8'));
}
function initialize(): void {
  mkdirSync(localDir, { recursive: true });
  if (existsSync(join(localDir, 'credentials.json'))) {
    for (const file of ['postgres-password', 'registry-users', 'minio-user', 'minio-password']) {
      if (!existsSync(join(localDir, file))) throw new Error('Local credential files are incomplete; restore them before starting services');
    }
    return;
  }
  const oldVolumes = command('docker', ['volume', 'ls', '--filter', 'label=com.docker.compose.project=zhinexus-g2', '--format', '{{.Name}}']).trim();
  if (oldVolumes) throw new Error('Existing G2 volumes found without credentials; restore local credentials instead of resetting data');
  const password = () => randomBytes(32).toString('base64url');
  const config: Credentials = { postgresPassword: password(), publisherPassword: password(), readerPassword: password(), minioUser: 'zhinexus-local', minioPassword: password() };
  const htpasswd = (value: string) => `{SHA}${createHash('sha1').update(value).digest('base64')}`;
  for (const [file, value] of Object.entries({
    'postgres-password': config.postgresPassword, 'minio-user': config.minioUser, 'minio-password': config.minioPassword,
    'registry-users': `g2publisher:${htpasswd(config.publisherPassword)}\ng2reader:${htpasswd(config.readerPassword)}\n`,
    'credentials.json': JSON.stringify(config, null, 2),
  })) writeFileSync(join(localDir, file), value, { mode: 0o600, flag: 'wx' });
}
export function imageId(options: { directory?: string; inspect?: (reference: string) => unknown } = {}): string {
  const directory = options.directory ?? localDir;
  const file = join(directory, 'images.json');
  const identity = /^sha256:[a-f0-9]{64}$/;
  const recorded = () => {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8')).minioImageId;
      if (typeof value !== 'string' || !identity.test(value)) throw new Error();
      return value as string;
    } catch { throw new Error('Invalid local MinIO image identity record; restore it before continuing'); }
  };
  const existing = existsSync(file) ? recorded() : undefined;
  let data: unknown;
  try {
    data = (options.inspect ?? (reference => JSON.parse(command('docker', ['image', 'inspect', reference]))))(existing ?? versions.minio.localTag);
  } catch { throw new Error('Pinned local MinIO image unavailable; run infra:up to build it'); }
  const info = Array.isArray(data) && data.length === 1 ? data[0] : undefined;
  const labels = info?.Config?.Labels;
  if (!identity.test(info?.Id ?? '') || (existing && info.Id !== existing)
    || info.Os !== 'linux' || info.Architecture !== 'amd64'
    || labels?.['org.opencontainers.image.source'] !== 'https://github.com/minio/minio'
    || labels?.['org.opencontainers.image.revision'] !== versions.minio.sourceCommit
    || labels?.['org.opencontainers.image.version'] !== versions.minio.release) {
    throw new Error('Local MinIO image identity does not match pinned source and linux/amd64 platform');
  }
  if (existing) return existing;
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(file, `${JSON.stringify({ minioImageId: info.Id }, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // A concurrent registration is authoritative only after the same validation.
    return imageId(options);
  }
  return info.Id;
}
export function compose(args: string[], options: { input?: string; visible?: boolean; timeout?: number } = {}): string {
  return command('docker', ['compose', '--project-name', 'zhinexus-g2', '--file', join(root, 'infra/compose.yaml'), ...args], {
    ...options, env: { ...process.env, G2_MINIO_IMAGE: imageId() },
  });
}
export async function waitForReady(): Promise<void> {
  for (const url of [`${endpoints.registry}/-/ping`, `${endpoints.s3}/minio/health/ready`]) {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* bounded readiness polling */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Local service readiness timed out');
  }
}
export function npm(args: string[], cwd: string, userconfig: string): string {
  const cli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(cli)) throw new Error('Use scripts/pnpm.ps1 so the pinned Node/npm distribution is available');
  return command(process.execPath, [cli, ...args, '--userconfig', userconfig], { cwd, timeout: 120_000 });
}
async function main(): Promise<void> {
  const action = process.argv[2];
  if (action === 'up') {
    initialize();
    console.log('Building MinIO from the pinned source and builder digest...');
    command('docker', ['build', '--platform', 'linux/amd64', '-f', 'infra/minio/Dockerfile', '-t', versions.minio.localTag, 'infra/minio'], { visible: true, timeout: 1_800_000 });
    const minioImageId = command('docker', ['image', 'inspect', versions.minio.localTag, '--format', '{{.Id}}']).trim();
    writeFileSync(join(localDir, 'images.json'), `${JSON.stringify({ minioImageId }, null, 2)}\n`);
    compose(['config', '--quiet']);
    compose(['up', '-d', '--wait', '--wait-timeout', '90'], { visible: true, timeout: 600_000 });
    await waitForReady();
    console.log('Local services ready: PostgreSQL 15432, registry 14873, S3 19000 (127.0.0.1 only).');
  } else if (action === 'stop') {
    compose(['stop'], { visible: true });
    console.log('Stopped this project; credentials and data volumes retained.');
  } else throw new Error('Expected up or stop');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  withLocalLock(main).catch(error => { console.error(error instanceof Error ? error.message : 'Local infrastructure command failed'); process.exitCode = 1; });
}
