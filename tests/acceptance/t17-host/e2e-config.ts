import { createHash } from 'node:crypto';
import { validateManifest } from '@company/contracts';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FixedToolchain } from './runtime.js';

const REQUIRED = [
  'T17_HOST_CLI_TARBALL', 'T17_HOST_CLI_SHA256', 'T17_HOST_CLI_VERSION',
  'T17_HOST_SDK_BUNDLE', 'T17_HOST_SDK_MANIFEST_SHA256',
  'T17_HOST_API_URL', 'T17_HOST_REGISTRY_URL', 'T17_HOST_VARIANTS_FILE', 'T17_HOST_VARIANTS_SHA256',
  'ZHINEXUS_API_TOKEN', 'ZHINEXUS_REGISTRY_TOKEN',
] as const;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export type HostVariant = { componentId: string; framework: 'vue' | 'react'; variantReleaseId: string };
export type HostVariantMap = { schemaVersion: 1; variants: HostVariant[] };
export type T17HostInputValues = {
  cliTarball: string; cliSha256: string; cliVersion: string;
  sdkBundle: string; sdkManifestSha256: string;
  apiUrl: string; registryUrl: string; variantsFile: string; variantsSha256: string;
  apiToken: string; registryToken: string;
};
export type T17HostInputs = T17HostInputValues & {
  sdkManifest: Record<string, unknown>;
  validatedCompatibility?: Record<string, string[]>;
  variants: HostVariantMap;
};

function loopbackOrigin(value: string, name: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(name + ' must be a valid loopback origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash || /[\\?#\s]/.test(value)) {
    throw new Error(name + ' must be a credential-free loopback origin without a path, query, or fragment.');
  }
  return url.origin;
}

export function parseT17HostInputs(env: Record<string, string | undefined>): T17HostInputValues {
  const missing = REQUIRED.filter(name => !env[name]);
  if (missing.length) throw new Error('Missing required T17 host inputs: ' + missing.join(', '));
  const cliTarball = env.T17_HOST_CLI_TARBALL!;
  const cliSha256 = env.T17_HOST_CLI_SHA256!;
  const cliVersion = env.T17_HOST_CLI_VERSION!;
  const sdkBundle = env.T17_HOST_SDK_BUNDLE!;
  const sdkManifestSha256 = env.T17_HOST_SDK_MANIFEST_SHA256!;
  const variantsFile = env.T17_HOST_VARIANTS_FILE!;
  const variantsSha256 = env.T17_HOST_VARIANTS_SHA256!;
  if (![cliTarball, sdkBundle, variantsFile].every(isAbsolute)) throw new Error('T17 host artifact paths must be absolute.');
  if (![cliSha256, sdkManifestSha256, variantsSha256].every(value => /^[0-9a-f]{64}$/.test(value))) throw new Error('T17 host SHA-256 inputs must be lowercase digests.');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cliVersion)) throw new Error('T17_HOST_CLI_VERSION must be an exact semantic version.');
  if (env.ZHINEXUS_API_TOKEN === env.ZHINEXUS_REGISTRY_TOKEN) throw new Error('T17 API and registry credentials must be distinct.');
  return {
    cliTarball: resolve(cliTarball), cliSha256, cliVersion,
    sdkBundle: resolve(sdkBundle), sdkManifestSha256,
    apiUrl: loopbackOrigin(env.T17_HOST_API_URL!, 'T17_HOST_API_URL'),
    registryUrl: loopbackOrigin(env.T17_HOST_REGISTRY_URL!, 'T17_HOST_REGISTRY_URL'),
    variantsFile: resolve(variantsFile), variantsSha256,
    apiToken: env.ZHINEXUS_API_TOKEN!, registryToken: env.ZHINEXUS_REGISTRY_TOKEN!,
  };
}

async function ordinaryFile(path: string, name: string): Promise<Buffer> {
  const stat = await lstat(path).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(name + ' must name an ordinary, unlinked file.');
  return readFile(path);
}

function parseVariantMap(input: unknown): HostVariantMap {
  if (!record(input) || input.schemaVersion !== 1 || !Array.isArray(input.variants)) throw new Error('T17 variant mapping must use schemaVersion 1 and a variants array.');
  const ids = new Set<string>(), releases = new Set<string>();
  const variants = input.variants.map((item, index): HostVariant => {
    if (!record(item) || typeof item.componentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item.componentId)
      || (item.framework !== 'vue' && item.framework !== 'react') || typeof item.variantReleaseId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item.variantReleaseId)) {
      throw new Error('T17 variant mapping entry ' + index + ' is invalid.');
    }
    const identity = item.componentId + ':' + item.framework;
    if (ids.has(identity) || releases.has(item.variantReleaseId)) throw new Error('T17 variant mapping contains duplicate component/framework or release identities.');
    ids.add(identity); releases.add(item.variantReleaseId);
    return { componentId: item.componentId, framework: item.framework, variantReleaseId: item.variantReleaseId };
  });
  return { schemaVersion: 1, variants };
}

function validSdkManifest(value: unknown): value is Record<string, unknown> & { files: unknown[]; packages: unknown[]; variants: unknown[]; reports: unknown[] } {
  return record(value) && value.schemaVersion === 1 && Array.isArray(value.files) && Array.isArray(value.packages)
    && Array.isArray(value.variants) && Array.isArray(value.reports);
}

function safeBundlePath(value: string): boolean {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split('/');
  return parts.every(part => !!part && part !== '.' && part !== '..' && /^[A-Za-z0-9._@+-]+$/.test(part));
}

async function verifySdkFiles(root: string, manifest: Record<string, unknown> & { files: unknown[] }): Promise<void> {
  const seen = new Set<string>();
  for (const [index, raw] of manifest.files.entries()) {
    if (!record(raw) || typeof raw.path !== 'string' || !safeBundlePath(raw.path)
      || typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)
      || !Number.isSafeInteger(raw.bytes) || Number(raw.bytes) < 0) throw new Error('Frozen SDK manifest file entry ' + index + ' is invalid.');
    if (seen.has(raw.path)) throw new Error('Frozen SDK manifest contains duplicate paths.');
    seen.add(raw.path);
    const target = resolve(root, ...raw.path.split('/'));
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Frozen SDK file escapes its bundle root.');
    const resolvedTarget = await realpath(target).catch(() => undefined);
    if (!resolvedTarget) throw new Error('Frozen SDK file is missing: ' + raw.path);
    const resolvedRel = relative(root, resolvedTarget);
    const normalizePath = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (resolvedRel === '..' || resolvedRel.startsWith('..' + sep) || isAbsolute(resolvedRel)
      || normalizePath(resolvedTarget) !== normalizePath(target)) {
      throw new Error('Frozen SDK file escapes its bundle root or uses a symbolic link: ' + raw.path);
    }
    const bytes = await ordinaryFile(target, 'Frozen SDK file ' + raw.path);
    if (bytes.length !== raw.bytes || sha256(bytes) !== raw.sha256) throw new Error('Frozen SDK file digest or byte count mismatch: ' + raw.path);
  }
}

export async function loadT17HostInputs(env: Record<string, string | undefined>): Promise<T17HostInputs> {
  const parsed = parseT17HostInputs(env);
  const tarball = await ordinaryFile(parsed.cliTarball, 'Frozen CLI tarball');
  if (sha256(tarball) !== parsed.cliSha256) throw new Error('Frozen CLI tarball SHA-256 mismatch.');
  const sdkStat = await lstat(parsed.sdkBundle).catch(() => undefined);
  if (!sdkStat?.isDirectory() || sdkStat.isSymbolicLink()) throw new Error('Frozen SDK bundle must be an ordinary directory.');
  const sdkRoot = await realpath(parsed.sdkBundle);
  const manifestBytes = await ordinaryFile(join(sdkRoot, 'manifest.json'), 'Frozen SDK manifest');
  if (sha256(manifestBytes) !== parsed.sdkManifestSha256) throw new Error('Frozen SDK manifest SHA-256 mismatch.');
  let sdkManifest: unknown;
  try { sdkManifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new Error('Frozen SDK manifest is not valid JSON.'); }
  if (!validSdkManifest(sdkManifest)) throw new Error('Frozen SDK manifest must contain packages, variants, and files arrays.');
  await verifySdkFiles(sdkRoot, sdkManifest);
  const reports: Record<string, unknown> = {};
  for (const reportRef of sdkManifest.reports) {
    if (!record(reportRef) || typeof reportRef.path !== 'string' || !safeBundlePath(reportRef.path)) throw new Error('Frozen SDK report reference is invalid.');
    const reportBytes = await ordinaryFile(resolve(sdkRoot, ...reportRef.path.split('/')), 'Frozen SDK report');
    const inventoryEntry = sdkManifest.files.find(entry => record(entry) && entry.path === reportRef.path);
    if (!record(inventoryEntry) || reportBytes.length !== inventoryEntry.bytes || sha256(reportBytes) !== inventoryEntry.sha256) throw new Error('Frozen SDK report bytes differ from their manifest inventory.');
    try { reports[reportRef.path] = JSON.parse(reportBytes.toString('utf8')); } catch { throw new Error('Frozen SDK report is not valid JSON.'); }
  }
  const manifestValidation = validateManifest(sdkManifest, { reports });
  if (!manifestValidation.ok) throw new Error('Frozen SDK manifest and compatibility reports failed contracts validation.');
  const validatedCompatibility: Record<string, string[]> = {};
  for (const variant of manifestValidation.value.variants) {
    validatedCompatibility[variant.componentId + ':' + variant.framework] = variant.compatibility
      .filter(record => record.status === 'passed' && typeof record.reportId === 'string')
      .map(record => record.reportId!);
  }

  const variantsBytes = await ordinaryFile(parsed.variantsFile, 'T17 variant mapping');
  if (sha256(variantsBytes) !== parsed.variantsSha256) throw new Error('T17 variant mapping SHA-256 mismatch.');
  let variantsInput: unknown;
  try { variantsInput = JSON.parse(variantsBytes.toString('utf8')); } catch { throw new Error('T17 variant mapping is not valid JSON.'); }
  const variants = parseVariantMap(variantsInput);
  const sdkKeys = new Set<string>();
  for (const item of sdkManifest.variants) {
    if (!record(item) || typeof item.componentId !== 'string' || (item.framework !== 'vue' && item.framework !== 'react')) throw new Error('Frozen SDK manifest contains an invalid variant identity.');
    const key = item.componentId + ':' + item.framework;
    if (sdkKeys.has(key)) throw new Error('Frozen SDK manifest contains duplicate variant identities.');
    sdkKeys.add(key);
  }
  if (sdkKeys.size !== variants.variants.length || variants.variants.some(item => !sdkKeys.has(item.componentId + ':' + item.framework))) {
    throw new Error('T17 variant mapping must cover the frozen SDK bundle exactly.');
  }
  return { ...parsed, sdkBundle: sdkRoot, sdkManifest: sdkManifest as T17HostInputs['sdkManifest'], validatedCompatibility, variants };
}

export function publicT17HostSummary(inputs: T17HostInputValues | T17HostInputs): Record<string, unknown> {
  return {
    cliTarball: inputs.cliTarball, cliSha256: inputs.cliSha256, cliVersion: inputs.cliVersion,
    sdkBundle: inputs.sdkBundle, sdkManifestSha256: inputs.sdkManifestSha256,
    apiUrl: inputs.apiUrl, registryUrl: inputs.registryUrl, variantsFile: inputs.variantsFile,
    variantsSha256: inputs.variantsSha256, variantCount: 'variants' in inputs ? inputs.variants.variants.length : undefined,
    apiTokenConfigured: inputs.apiToken.length > 0, registryTokenConfigured: inputs.registryToken.length > 0,
  };
}

export function resolveT17FixedToolchain(repositoryRoot: string): FixedToolchain {
  const root = resolve(repositoryRoot);
  const expectedNode = join(root, '.tools', 'node-v26.13.0-win-x64', 'node.exe');
  if (process.platform !== 'win32' || process.version !== 'v26.13.0') throw new Error('T17 host acceptance requires the fixed Windows Node 26.13.0 runtime.');
  const expectedNodeReal = execFileSync('cmd.exe', ['/d', '/s', '/c', 'for %I in ("' + expectedNode + '") do @echo %~fI'], { encoding: 'utf8' }).trim();
  const actualNodeReal = execFileSync('cmd.exe', ['/d', '/s', '/c', 'for %I in ("' + process.execPath + '") do @echo %~fI'], { encoding: 'utf8' }).trim();
  if (expectedNodeReal.toLowerCase() !== actualNodeReal.toLowerCase()) throw new Error('T17 host acceptance must run through the repository-local Node executable.');
  const npmCliPath = join(dirname(expectedNode), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npmVersion = execFileSync(process.execPath, [npmCliPath, '--version'], { encoding: 'utf8' }).trim();
  if (npmVersion !== '11.20.0') throw new Error('T17 host acceptance requires the fixed npm 11.20.0 runtime.');
  return { nodeExecutable: expectedNode, npmCliPath, pnpmWrapper: join(root, 'scripts', 'pnpm.ps1'), repositoryRoot: root };
}
