import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { validateApiMessage, validateReleaseBundle, type ApiMessages, type ReleaseManifestV1 } from '@company/contracts';
import { RecoveryStack } from '../../../infra/scripts/recovery-stack.js';
import { root as repositoryRoot, type Credentials } from '../../../infra/scripts/local.js';
import { ReleaseWorker } from '../../../apps/api/dist/releases/worker.js';
import { grant, platformHarness, release, upload } from '../../platform/http-support.js';
import { realRegistry, registryToken } from '../../platform/t06-support.js';

export type T17LocalServices = {
  apiUrl: string; registryUrl: string; apiToken: string; registryToken: string;
  variantsFile: string; variantsSha256: string; sdkBundle: string; sdkManifestSha256: string;
  /** Present only when the caller explicitly supplies an unchanged, real historical compatibility probe. */
  acceptedCompatibilityFile?: string; compatibilityEvidenceSha256?: string;
  close(): Promise<void>;
};
export type T17CompatibilityEvidenceInput = { file: string; sha256: string };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const inside = (root: string, target: string) => {
  const path = relative(root, target);
  return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path));
};

async function readFrozenBundle(directory: string) {
  const stat = await lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Frozen SDK bundle must be an ordinary directory.');
  const sdkBundle = await realpath(directory), files = new Map<string, Uint8Array>();
  let manifestBytes: Buffer | undefined;
  async function scan(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name), info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Frozen SDK bundle cannot contain symbolic links.');
      if (info.isDirectory()) await scan(path);
      else if (info.isFile() && info.nlink === 1) {
        const name = relative(sdkBundle, path).replaceAll('\\', '/'), bytes = await readFile(path);
        if (name === 'manifest.json') manifestBytes = bytes; else files.set(name, bytes);
      } else throw new Error('Frozen SDK bundle contains a non-ordinary or linked file.');
    }
  }
  await scan(sdkBundle);
  if (!manifestBytes) throw new Error('Frozen SDK manifest is missing.');
  let raw: unknown;
  try { raw = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new Error('Frozen SDK manifest must be valid JSON.'); }
  const validated = await validateReleaseBundle(raw, files);
  if (!validated.ok) throw new Error('Frozen SDK bundle failed contracts or digest validation: ' + [...new Set(validated.issues.map(issue => issue.code))].join(', '));
  if (!validated.value.variants.some(variant => variant.framework === 'vue') || !validated.value.variants.some(variant => variant.framework === 'react')) {
    throw new Error('Frozen SDK bundle must include both Vue and React variants.');
  }
  return { sdkBundle, manifest: validated.value, files, sdkManifestSha256: sha(manifestBytes) };
}

/**
 * Validate an explicit historical installed-CLI probe, its frozen SDK identities, native execution
 * evidence and every real screenshot before infrastructure allocation. No evidence is synthesized,
 * relabelled as a current run, or weakened to a manifest's unaccepted compatibility claim.
 */
export async function readT17CompatibilityEvidence(input: T17CompatibilityEvidenceInput, sdkBundle: string) {
  if (!isAbsolute(input.file)) throw new Error('Historical compatibility evidence requires an absolute file path.');
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Historical compatibility evidence SHA-256 is invalid.');
  const info = await lstat(input.file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Historical compatibility evidence must be an ordinary unlinked file.');
  const bytes = await readFile(input.file);
  if (sha(bytes) !== input.sha256) throw new Error('Historical compatibility evidence SHA-256 digest mismatch.');
  const frozen = await readFrozenBundle(sdkBundle), file = await realpath(input.file);
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const evidence: unknown = JSON.parse(bytes.toString('utf8'));
  if (!record(evidence) || evidence.schemaVersion !== 1 || evidence.kind !== 'a-t10-sdk-probe' || evidence.recommendation !== 'adopt' ||
      !record(evidence.probe) || evidence.probe.packaged !== true || evidence.probe.fontDigestSource !== 'measured' ||
      !record(evidence.bundle) || !Array.isArray(evidence.bundle.packages) || !Array.isArray(evidence.combinations) ||
      !record(evidence.candidate) || evidence.candidate.version !== '6.1.0' || evidence.candidate.integrityVerified !== true ||
      typeof evidence.candidate.integrity !== 'string' || evidence.candidate.source !== 'https://registry.npmjs.org/echarts' ||
      !record(evidence.policy) || evidence.policy.requiresVisualBaselineConfirmation !== false || evidence.policy.candidateIntegrityVerified !== true ||
      !Array.isArray(evidence.uncovered) || evidence.uncovered.length) throw new Error('Historical compatibility probe evidence lacks real passed execution or frozen bundle identity.');
  const packages = evidence.bundle.packages;
  if (packages.length !== frozen.manifest.packages.length || frozen.manifest.packages.some(expected => !packages.some(actual => record(actual) && actual.name === expected.name &&
      actual.version === expected.version && actual.sha256 === expected.tarball.sha256 && actual.bytes === expected.tarball.bytes))) throw new Error('Historical compatibility probe bundle packages differ from the frozen SDK.');
  const frameworks = new Set<string>(), screenshots = new Set<string>(), screenshotRoot = await realpath(join(dirname(file), 'screenshots'));
  for (const combo of evidence.combinations) {
    if (!record(combo) || (combo.framework !== 'vue' && combo.framework !== 'react') || frameworks.has(combo.framework) || combo.frameworkVersion !== (combo.framework === 'vue' ? '3.5.45' : '19.3.1') ||
        combo.echartsVersion !== '6.1.0' || !record(combo.consumer) || combo.consumer.peerMode !== 'strict' || !record(combo.consumer.resolved) ||
        combo.consumer.resolved[combo.framework] !== combo.frameworkVersion || combo.consumer.resolved.echarts !== '6.1.0' ||
        combo.framework === 'react' && combo.consumer.resolved['react-dom'] !== '19.3.1' || !record(combo.evidence)) throw new Error('Historical compatibility probe exact framework/engine consumer evidence mismatch.');
    frameworks.add(combo.framework);
    const execution = combo.evidence;
    if (!Array.isArray(execution.typecheck) || !['Bundler', 'NodeNext'].every(resolution => execution.typecheck instanceof Array && execution.typecheck.some(item => record(item) && item.resolution === resolution && item.exitCode === 0)) ||
        !record(execution.build) || execution.build.exitCode !== 0 || typeof execution.build.output !== 'string' || !execution.build.output.includes('vite') ||
        !record(execution.ssrImport) || execution.ssrImport.exitCode !== 0 || execution.ssrImport.windowDefined !== false || execution.ssrImport.documentDefined !== false ||
        !Array.isArray(execution.browser) || !Array.isArray(execution.visual)) throw new Error('Historical compatibility probe native build/type/SSR source execution evidence is incomplete.');
    const expectedVariants = frozen.manifest.variants.filter(variant => variant.framework === combo.framework);
    if (execution.browser.length !== expectedVariants.length * 4) throw new Error('Historical compatibility probe screenshot coverage is incomplete.');
    for (const run of execution.browser) {
      if (!record(run) || !record(run.screenshot) || typeof run.screenshot.file !== 'string' || typeof run.screenshot.sha256 !== 'string' || typeof run.screenshot.bytes !== 'number' ||
          !Array.isArray(run.click) || run.click.length !== 1 || run.clickError !== null || !Array.isArray(run.pageErrors) || run.pageErrors.length) throw new Error('Historical compatibility probe real interaction/screenshot evidence is incomplete.');
      const screenshot = await realpath(run.screenshot.file), stat = await lstat(run.screenshot.file);
      if (!inside(screenshotRoot, screenshot) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || screenshots.has(screenshot)) throw new Error('Historical compatibility probe screenshot ownership/path is unsafe.');
      const image = await readFile(screenshot);
      if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || image.length !== run.screenshot.bytes || sha(image) !== run.screenshot.sha256) throw new Error('Historical compatibility probe PNG digest/bytes mismatch.');
      screenshots.add(screenshot);
    }
  }
  if (frameworks.size !== 2) throw new Error('Historical compatibility probe must contain independent Vue and React execution.');
  return { file, sha256: input.sha256, evidence, candidate: { version: evidence.candidate.version, integrity: evidence.candidate.integrity, source: evidence.candidate.source }, screenshotsChecked: screenshots.size,
    provenance: 'historical-real-installed-cli-probe-replay' as const };
}

/** Only this fresh stack receives an npm upstream; @company artifacts stay private and immutable. */
class T17RecoveryStack extends RecoveryStack {
  constructor(secrets: Credentials, private readonly registryConfig: string) { super(secrets); }
  override docker(args: string[]): string {
    const source = 'type=bind,src=' + join(repositoryRoot, 'infra/verdaccio/config.yaml') + ',dst=/verdaccio/conf/config.yaml,readonly';
    const replacement = 'type=bind,src=' + this.registryConfig + ',dst=/verdaccio/conf/config.yaml,readonly';
    return super.docker(args[0] === 'run' && args.includes(this.names.verdaccio) ? args.map(arg => arg === source ? replacement : arg) : args);
  }
}
export const registryConfiguration = `storage: /verdaccio/storage
auth:
  htpasswd:
    file: /run/secrets/registry_users
    max_users: -1
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    timeout: 5m
packages:
  '@company/*':
    access: g2reader g2publisher
    publish: g2publisher
    unpublish: []
  '**':
    access: $all
    publish: []
    unpublish: []
    proxy: npmjs
log: { type: stdout, format: json, level: warn }
listen: 0.0.0.0:4873
`;

/**
 * Replays an existing frozen SDK into new owner-labeled local services for the T17 host chain.
 * Local signed OIDC fixtures prove protocol behavior; this is never production/company OIDC acceptance.
 * Call from Vitest (the existing platform upload harness supplies its assertions), then always close().
 */
export async function prepareT17LocalServices(options: { sdkBundle: string; evidenceDirectory: string; compatibilityEvidence?: T17CompatibilityEvidenceInput }): Promise<T17LocalServices> {
  if (!isAbsolute(options.sdkBundle) || !isAbsolute(options.evidenceDirectory)) throw new Error('SDK bundle and evidence directory paths must be absolute.');
  if (inside(resolve(options.sdkBundle), resolve(options.evidenceDirectory))) throw new Error('T17 evidence directory must stay outside the frozen SDK bundle.');
  const frozen = await readFrozenBundle(resolve(options.sdkBundle));
  const compatibility = options.compatibilityEvidence ? await readT17CompatibilityEvidence(options.compatibilityEvidence, frozen.sdkBundle) : undefined;
  let existingParent = resolve(options.evidenceDirectory);
  const missingSegments: string[] = [];
  for (;;) {
    try { await lstat(existingParent); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missingSegments.unshift(basename(existingParent)); existingParent = dirname(existingParent);
    }
  }
  const prospectiveEvidence = resolve(await realpath(existingParent), ...missingSegments);
  if (inside(frozen.sdkBundle, prospectiveEvidence)) throw new Error('T17 evidence directory must stay outside the frozen SDK bundle.');
  await mkdir(prospectiveEvidence, { recursive: true });
  const evidenceStat = await lstat(prospectiveEvidence);
  if (!evidenceStat.isDirectory() || evidenceStat.isSymbolicLink()) throw new Error('T17 evidence directory must be an ordinary directory.');
  const evidenceParent = await realpath(prospectiveEvidence);
  if (inside(frozen.sdkBundle, evidenceParent)) throw new Error('T17 evidence directory must stay outside the frozen SDK bundle.');
  const directory = await mkdtemp(join(evidenceParent, 't17-local-services-')), config = join(directory, 'verdaccio.yaml');
  await writeFile(config, registryConfiguration, { flag: 'wx' });
  const password = () => randomBytes(32).toString('base64url');
  const stack = new T17RecoveryStack({ postgresPassword: password(), publisherPassword: password(), readerPassword: password(), minioUser: 't17-local', minioPassword: password() }, config);
  const owner = { kind: 't17-owned-local-services-v1', id: stack.id, directory: stack.directory, productionAcceptance: false };
  const marker = join(stack.directory, 't17-owner.json'), ownerBytes = JSON.stringify(owner) + '\n';
  await writeFile(marker, ownerBytes, { flag: 'wx' });
  await writeFile(join(directory, 'owner.json'), ownerBytes, { flag: 'wx' });
  let harness: Awaited<ReturnType<typeof platformHarness>> | undefined, closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= (async () => {
    let failed = false;
    try { await harness?.close(); } catch { failed = true; }
    try {
      if (await readFile(marker, 'utf8') !== ownerBytes || relative(resolve(repositoryRoot, '.tools/recovery'), resolve(stack.directory)) !== stack.id) {
        throw new Error('T17 local resource ownership mismatch.');
      }
      await stack.close();
      await rm(stack.directory, { recursive: true });
    } catch { failed = true; }
    if (failed) throw new Error('T17 owned local services cleanup failed; retain ownership metadata for recovery.');
  })();
  try {
    await stack.start();
    const services = { credentials: stack.secrets, postgresPort: stack.ports.postgres, storageEndpoint: 'http://127.0.0.1:' + stack.ports.minio, registryOrigin: 'http://127.0.0.1:' + stack.ports.verdaccio };
    const h = harness = await platformHarness({}, services), subject = 't17-local-host';
    await grant(h, subject, true);
    for (const pkg of frozen.manifest.packages) await h.db.query('INSERT INTO package_permissions(subject,package_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [subject, pkg.name]);
    // This ephemeral fixture must cover the two-hour matrix plus setup/sealing/cleanup margin.
    const apiToken = await h.token(subject, ['reader', 'publisher', 'maintainer'], 'cli', '3h');
    const accepted = await release(h, await upload(h, { manifest: frozen.manifest, files: frozen.files }, apiToken), apiToken);
    if (accepted.status !== 202) throw new Error('Frozen SDK release was not accepted by the isolated API.');
    const body = await accepted.json() as { jobId?: unknown };
    if (typeof body.jobId !== 'string') throw new Error('Isolated API did not return a release job identity.');
    const registry = await realRegistry(services), worker = new ReleaseWorker(h.db, h.store, registry);
    await worker.runOnce(body.jobId);
    const state = (await h.db.query('SELECT state FROM release_jobs WHERE id=$1', [body.jobId])).rows[0]?.state;
    if (state !== 'READY') throw new Error('Frozen SDK did not reach READY in the newly owned local services.');
    for (const pkg of frozen.manifest.packages) await registry.verifyPackage(pkg);
    for (let count = 0; count <= frozen.manifest.packages.length; count++) if (!await worker.tags.runOnce()) break;
    const rows = (await h.db.query<{ id: string; variant_id: string }>('SELECT vr.id,vr.variant_id FROM variant_releases vr JOIN package_releases pr ON pr.id=vr.package_release_id WHERE pr.job_id=$1', [body.jobId])).rows;
    const variants = frozen.manifest.variants.map(variant => {
      const matches = rows.filter(row => row.variant_id === variant.variantId);
      if (matches.length !== 1) throw new Error('Isolated release variant identities do not match the frozen bundle.');
      return { componentId: variant.componentId, framework: variant.framework, variantReleaseId: matches[0]!.id };
    });
    if (rows.length !== variants.length) throw new Error('Isolated release includes unexpected variants.');
    let acceptedCompatibilityFile: string | undefined;
    if (compatibility) {
      const records: ApiMessages['createCompatibilityResponse'][] = [];
      for (const variant of frozen.manifest.variants) {
        const target = variants.find(value => value.componentId === variant.componentId && value.framework === variant.framework)!;
        const pkg = frozen.manifest.packages.find(value => value.name === variant.packageName)!;
        const response = await h.request('/v1/variant-releases/' + target.variantReleaseId + '/compatibility', {
          packageSha256: pkg.tarball.sha256, reason: 'T17 isolated replay of unchanged 2026-11-16 real installed-CLI compatibility probe; not a new current-CLI probe run.',
          candidate: compatibility.candidate, evidence: compatibility.evidence,
        }, apiToken);
        const raw: unknown = await response.json();
        const checked = validateApiMessage('createCompatibilityResponse', raw);
        if (response.status !== 201 || !checked.ok) throw new Error('Historical real compatibility evidence was not accepted by the isolated API: ' + JSON.stringify(raw));
        records.push(checked.value as ApiMessages['createCompatibilityResponse']);
      }
      if (sha(await readFile(compatibility.file)) !== compatibility.sha256) throw new Error('Historical compatibility evidence changed during API submission.');
      acceptedCompatibilityFile = join(directory, 'accepted-compatibility.json');
      await writeFile(acceptedCompatibilityFile, JSON.stringify({ schemaVersion: 1, provenance: compatibility.provenance, inputFile: compatibility.file, inputSha256: compatibility.sha256,
        screenshotsChecked: compatibility.screenshotsChecked, records, productionAcceptance: false }, null, 2) + '\n', { flag: 'wx' });
    }
    const rechecked = await readFrozenBundle(frozen.sdkBundle);
    if (rechecked.sdkManifestSha256 !== frozen.sdkManifestSha256) throw new Error('Frozen SDK manifest changed during local preparation.');
    const variantBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, variants }, null, 2) + '\n'), variantsFile = join(directory, 'variants.json');
    await writeFile(variantsFile, variantBytes, { flag: 'wx' });
    const result = { apiUrl: h.origin(), registryUrl: services.registryOrigin, variantsFile, variantsSha256: sha(variantBytes), sdkBundle: frozen.sdkBundle, sdkManifestSha256: frozen.sdkManifestSha256,
      ...(acceptedCompatibilityFile ? { acceptedCompatibilityFile, compatibilityEvidenceSha256: compatibility!.sha256 } : {}), close } as T17LocalServices;
    // Accidental JSON/log inspection must not reveal the caller's process-only credentials.
    Object.defineProperties(result, { apiToken: { value: apiToken, enumerable: false }, registryToken: { value: await registryToken('g2reader', services), enumerable: false } });
    await writeFile(join(directory, 'services.json'), JSON.stringify({ ...result, state: 'READY', productionAcceptance: false, variantCount: variants.length, packages: frozen.manifest.packages.map((pkg: ReleaseManifestV1['packages'][number]) => ({ name: pkg.name, version: pkg.version, sha256: pkg.tarball.sha256 })) }, null, 2) + '\n', { flag: 'wx' });
    return result;
  } catch (error) {
    try { await close(); } catch { throw new Error('T17 local services preparation failed and owned cleanup requires recovery.'); }
    throw error;
  }
}
