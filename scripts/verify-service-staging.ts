import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type ServiceCheck = { files: number; packages: number; errors: string[] };
type Manifest = { name: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }> };
const serviceNames = { api: '@company/platform-api', preview: '@company/preview-gateway' } as const;
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const forbiddenPackage = (name: string, expected: string) =>
  (name.startsWith('@company/') && ![expected, '@company/contracts'].includes(name)) ||
  /^(?:@playwright\/|@vitejs\/|@vitest\/)/.test(name) ||
  ['playwright', 'playwright-core', 'vite', 'vitest', 'typescript', 'tsx', 'turbo', '@nestjs/cli', 'echarts', 'vue', 'react', 'react-dom'].includes(name);
function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
const sensitiveName = (name: string) => name === '.git' || name === '.npmrc' || name === '.tools' || name === '.env' || name.startsWith('.env.') || /\.(?:pem|key)$/i.test(name) || /^id_(?:rsa|ed25519)(?:\.|$)/.test(name);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function validManifest(value: unknown): value is Manifest {
  if (!record(value)) return false;
  // Nested export metadata can be nameless or use a subpath such as rxjs/ajax.
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim())) return false;
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const entries = value[key];
    if (entries !== undefined && (!record(entries) || Object.entries(entries).some(([name, version]) => !packageName.test(name) || typeof version !== 'string'))) return false;
  }
  const peers = value.peerDependenciesMeta;
  return peers === undefined || (record(peers) && Object.values(peers).every(meta => record(meta) && (meta.optional === undefined || typeof meta.optional === 'boolean')));
}

async function checkService(directory: string, expected: string, api: boolean): Promise<ServiceCheck> {
  const result: ServiceCheck = { files: 0, packages: 0, errors: [] };
  let root: string;
  try {
    if ((await lstat(directory)).isSymbolicLink()) { result.errors.push('Linked service root'); return result; }
    root = await realpath(directory); if (!(await lstat(root)).isDirectory()) throw new Error();
  }
  catch { result.errors.push('Service directory missing'); return result; }
  const visited = new Set<string>();
  const manifests = new Map<string, Manifest>();
  const errors = new Set<string>();
  const label = (file: string) => path.relative(root, file).split(path.sep).join('/');
  async function walk(file: string, ancestors: Set<string>): Promise<void> {
    const relative = label(file);
    try {
      if (sensitiveName(path.basename(file))) { errors.add(`Sensitive material: ${relative}`); return; }
      const actual = await realpath(file);
      if (!within(root, actual)) { errors.add(`External link: ${relative}`); return; }
      if (ancestors.has(actual)) { errors.add(`Cyclic link: ${relative}`); return; }
      if (visited.has(actual)) return;
      visited.add(actual);
      const stat = await lstat(actual);
      if (stat.isDirectory()) {
        const next = new Set(ancestors).add(actual);
        for (const child of await readdir(actual)) await walk(path.join(actual, child), next);
      } else if (stat.isFile()) {
        result.files++;
        if (path.basename(actual) === 'package.json') {
          try {
            const manifest: unknown = JSON.parse(await readFile(actual, 'utf8'));
            if (!validManifest(manifest)) throw new Error();
            if (typeof manifest.name === 'string') {
              manifests.set(path.dirname(actual), manifest);
              if (forbiddenPackage(manifest.name, expected)) errors.add(`Forbidden runtime package: ${manifest.name}`);
            }
          } catch { errors.add(`Invalid package manifest: ${relative}`); }
        }
      } else { errors.add(`Unsupported file: ${relative}`); }
    } catch { errors.add(`Unreadable file or link: ${relative}`); }
  }
  await walk(root, new Set());
  const allowedRoot = new Set(['dist', 'node_modules', 'package.json', ...(api ? ['migrations'] : [])]);
  for (const name of await readdir(root)) {
    if (!allowedRoot.has(name) && !/^(?:README|LICEN[CS]E|NOTICE)(?:[.-].*)?$/i.test(name)) errors.add(`Unexpected service root content: ${name}`);
  }
  if (manifests.get(root)?.name !== expected) errors.add('Service package identity mismatch');
  for (const required of ['dist/server.js', ...(api ? ['dist/releases/runner.js', 'dist/db/migrate.js'] : [])]) {
    try { const actual = await realpath(path.join(root, required)); if (!within(root, actual) || !(await lstat(actual)).isFile()) throw new Error(); }
    catch { errors.add(`Missing runtime entry: ${required}`); }
  }
  if (api) {
    try {
      const migrationRoot = await realpath(path.join(root, 'migrations'));
      if (!within(root, migrationRoot)) throw new Error();
      const migrations = (await readdir(migrationRoot)).filter(name => /^\d+.*\.sql$/.test(name));
      if (!migrations.length) throw new Error();
      for (const name of migrations) {
        const stat = await lstat(path.join(migrationRoot, name));
        if (!stat.isFile() || stat.size === 0) throw new Error();
      }
    } catch { errors.add('SQL migrations missing'); }
  }
  async function resolveDependency(from: string, name: string): Promise<string | undefined> {
    if (!packageName.test(name)) return;
    for (let directory = from; within(root, directory); directory = path.dirname(directory)) {
      try {
        const found = await realpath(path.join(directory, 'node_modules', name));
        if (within(root, found) && manifests.has(found)) return found;
      } catch { /* Continue Node-style ancestor lookup within this closure. */ }
      if (directory === root) break;
    }
  }
  const closure = new Set<string>();
  async function dependencies(directory: string): Promise<void> {
    if (closure.has(directory)) return;
    closure.add(directory);
    const manifest = manifests.get(directory);
    if (!manifest) return;
    const mandatory = Object.keys(manifest.dependencies ?? {}).filter(name => !(name in (manifest.optionalDependencies ?? {})));
    const peers = Object.keys(manifest.peerDependencies ?? {}).filter(name => manifest.peerDependenciesMeta?.[name]?.optional !== true);
    const names = new Set([...mandatory, ...peers, ...Object.keys(manifest.optionalDependencies ?? {})]);
    for (const name of names) {
      const found = await resolveDependency(directory, name);
      if (found) await dependencies(found);
      else if (mandatory.includes(name) || peers.includes(name)) errors.add(`Missing dependency: ${manifest.name} -> ${name}`);
    }
  }
  await dependencies(root);
  const contracts = await resolveDependency(root, '@company/contracts');
  if (!contracts || manifests.get(contracts)?.name !== '@company/contracts') errors.add('Contracts runtime missing');
  else {
    try { if (!(await lstat(path.join(contracts, 'dist/index.js'))).isFile()) throw new Error(); }
    catch { errors.add('Contracts runtime entry missing'); }
  }
  result.packages = closure.size;
  result.errors = [...errors].sort();
  return result;
}

/** Read-only packaging check. Does not import staged modules or execute their scripts. */
export async function verifyServiceStaging(directory: string) {
  const root = path.resolve(directory);
  const api = await checkService(path.join(root, 'api'), serviceNames.api, true);
  const preview = await checkService(path.join(root, 'preview'), serviceNames.preview, false);
  const errors = [...api.errors.map(error => `api: ${error}`), ...preview.errors.map(error => `preview: ${error}`)];
  return { schemaVersion: 1, ok: errors.length === 0, services: { api, preview }, errors, productionAcceptance: false as const };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error();
    const result = await verifyServiceStaging(process.argv[2]!);
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
  } catch { console.error('Service staging check failed; supply one exported staging directory.'); process.exitCode = 1; }
}
