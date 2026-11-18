import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, readdir, lstat, readlink, realpath, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateComponentApi, validateIntegrationPlan, validateIntegrationApplyResult,
  validateMatchPlan, validateReleaseBundle, type ReleaseManifestV1, type IntegrationPlanV1 } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { platformHarness, grant, upload, release } from '../platform/http-support.js';
import { registryToken, realRegistry } from '../platform/t06-support.js';
import { localServices } from '../platform/support.js';
import { expectBoundString } from '../integration/t16-support/source-scan.js';

// This suite deliberately launches the CLI and real package managers. No product function,
// runner, filesystem or network mock supplies the installation result or expected versions.
const execute = promisify(execFile);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const repo = resolve('.');
const node = join(repo, '.tools/node-v26.13.0-win-x64/node.exe');
const npm = join(dirname(node), 'node_modules/npm/bin/npm-cli.js');
const pnpm = join(repo, '.tools/pnpm-native-12.18.0/package/pnpm.exe');
type Framework = 'vue' | 'react';
type Manager = 'npm' | 'pnpm';
const matrix = (['vue', 'react'] as const).flatMap(framework =>
  (['npm', 'pnpm'] as const).flatMap(manager => [false, true].map(workspace => ({
    framework, manager, workspace, id: `${framework}-${manager}-${workspace ? 'workspace' : 'standalone'}`,
  }))));
type Harness = Awaited<ReturnType<typeof platformHarness>>;
let h: Harness | undefined;
let area: string, bin: string, sdkRoot: string, manifest: ReleaseManifestV1, readToken: string;
const apiTokens = new Set<string>();
async function freshApiToken() {
  const token = await h!.token('t16-acceptance', ['publisher', 'maintainer'], 'cli', '20m');
  apiTokens.add(token);
  return token;
}
let rows: { id: string; framework: Framework; metadata: ReleaseManifestV1['variants'][number] }[];
const required = (name: string) => {
  const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return resolve(value);
};
const inTree = (root: string, path: string) => {
  const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
};

// Workspace package links are recorded without following them. Source snapshots exclude only
// explicitly enumerated dependency/build trees; every remaining file is independently hashed.
async function tree(root: string, excluded: Set<string> = new Set()) {
  const files: Record<string, string> = {};
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name), rel = relative(root, absolute).replaceAll('\\', '/');
      if (excluded.has(rel)) continue;
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) files[rel] = `link:${await readlink(absolute)}`;
      else if (stat.isDirectory()) await visit(absolute);
      else { expect(stat.isFile()).toBe(true); files[rel] = sha(await readFile(absolute)); }
    }
  }
  await visit(root); return files;
}
async function processResult(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, evidence: string) {
  let code = 0, stdout = '', stderr = '';
  try {
    const output = await execute(command, args, { cwd, env, windowsHide: true, timeout: 900_000, maxBuffer: 8 * 1024 * 1024 });
    stdout = output.stdout; stderr = output.stderr;
  } catch (error) {
    const output = error as { code?: number; stdout?: string; stderr?: string };
    code = typeof output.code === 'number' ? output.code : -1; stdout = output.stdout ?? ''; stderr = output.stderr ?? '';
  }
  // Never retain raw credentials in evidence, even on a package-manager failure.
  const credentials = [...apiTokens, readToken].filter(Boolean);
  const redact = (value: string) => credentials.reduce((text, token) => text.replaceAll(token, '[REDACTED]'), value);
  await writeFile(evidence, JSON.stringify({ code, stdout: redact(stdout), stderr: redact(stderr) }, null, 2));
  // A boolean assertion cannot print the raw token or process output on failure.
  expect(credentials.some(token => (stdout + stderr).includes(token)), 'process output exposed a credential').toBe(false);
  return { code, stdout, stderr };
}
async function cli(args: string[], label: string) {
  const apiToken = await freshApiToken();
  const output = await processResult(node, [bin, 'integrate', ...args], repo,
    { ...process.env, ZHINEXUS_API_TOKEN: apiToken, ZHINEXUS_REGISTRY_TOKEN: readToken }, join(area, `${label}.json`));
  return output;
}

async function cleanManagerEnvironment(label: string) {
  const config = join(area, `${label}-config`);
  await mkdir(config, { recursive: true });
  const userconfig = join(config, 'userconfig'), globalconfig = join(config, 'globalconfig');
  await writeFile(userconfig, ''); await writeFile(globalconfig, '');
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, PATH: `${dirname(node)};${dirname(pnpm)}`, TEMP: config, TMP: config, CI: 'true',
    npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig,
    npm_config_cache: join(config, 'cache'), PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false' };
}

// Diagnostic only: reproduce candidate-lock creation with real npm while the test
// services are alive. Its result never substitutes for the product apply result.
async function diagnoseCandidateLock(root: string, plan: IntegrationPlanV1, label: string) {
  const stage = join(area, `${label}-candidate-diagnostic`);
  await mkdir(stage);
  const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const staged: Record<string, unknown> = {};
  for (const key of ['name', 'version', 'private', 'type', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    if (source[key] !== undefined) staged[key] = source[key];
  }
  staged.dependencies = { ...(staged.dependencies as Record<string, string> | undefined),
    ...Object.fromEntries(plan.exactDependencies.map(dependency => [dependency.name, dependency.version])) };
  await writeFile(join(stage, 'package.json'), JSON.stringify(staged, null, 2));
  const env = await cleanManagerEnvironment(`${label}-candidate-diagnostic`);
  const registry = new URL(localServices().registryOrigin);
  await writeFile(env.npm_config_userconfig!, `//${registry.host}${registry.pathname.replace(/\/?$/, '/')}:_authToken=${readToken}\n`);
  await processResult(node, [npm, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund',
    '--registry', registry.href, '--userconfig', env.npm_config_userconfig!, '--globalconfig', env.npm_config_globalconfig!,
    '--cache', env.npm_config_cache!], stage, env, join(area, `${label}-candidate-diagnostic.json`));
}

// Resolve the package from the actual ESM importer without executing SDK code or
// bypassing its exports. Public SDK packages intentionally hide package.json.
async function installedPackage(name: string, importer: string) {
  const output = await execute(node, ['--experimental-import-meta-resolve', '--input-type=module', '-e',
    'console.log(import.meta.resolve(process.argv[1], process.argv[2]))', name,
    pathToFileURL(join(importer, '__t16_resolution__.mjs')).href], { cwd: importer, windowsHide: true });
  let directory = dirname(fileURLToPath(output.stdout.trim()));
  for (;;) {
    const path = join(directory, 'package.json');
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (value.name === name) return { path, value };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Resolved entry has no manifest for ${name}`);
    directory = parent;
  }
}

async function match(framework: Framework, manager: Manager) {
  const row = rows.find(item => item.framework === framework)!;
  const checked = validateComponentApi(JSON.parse(await readFile(join(sdkRoot, row.metadata.api.path), 'utf8')));
  if (!checked.ok) throw new Error('Frozen API invalid');
  const result = await h!.request('/v1/matching/plans', {
    design: { schemaVersion: 1, mapping: { schemaVersion: 1, ruleSetId: 'synthetic-t16', revision: '1',
      entries: [{ designId: 'synthetic/line', framework, variantReleaseId: row.id }] },
    elements: [{ instanceId: 'installed-line', designId: 'synthetic/line' }] },
    context: { framework, frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1', echartsVersion: '6.1.0', packageManager: manager, requirements: [] },
    ...(framework === 'react' ? { reactDomVersion: '19.3.1' } : {}),
    bindings: [{ instanceId: 'installed-line', props: checked.value.props.map(prop => ({ name: prop.name, source: `source.${prop.name}` })),
      events: checked.value.events.map(event => ({ name: event.name, handler: `handler.${event.name}` })), layout: 'synthetic technical acceptance' }],
  }, await freshApiToken());
  expect(result.status, await result.clone().text()).toBe(200);
  const validated = validateMatchPlan(await result.json());
  if (!validated.ok) throw new Error(JSON.stringify(validated.issues)); return validated.value;
}

beforeAll(async () => {
  expect((await execute(node, ['--version'])).stdout.trim()).toBe('v26.13.0');
  sdkRoot = required('A10_FROZEN_BUNDLE');
  manifest = JSON.parse(await readFile(join(sdkRoot, 'manifest.json'), 'utf8'));
  const files = new Map<string, Uint8Array>();
  for (const entry of manifest.files) {
    const bytes = await readFile(join(sdkRoot, entry.path)); expect(sha(bytes)).toBe(entry.sha256); expect(bytes.length).toBe(entry.bytes); files.set(entry.path, bytes);
  }
  const checked = await validateReleaseBundle(manifest, files);
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues)); manifest = checked.value;
  area = await mkdtemp(join(tmpdir(), 'zhinexus-t16-installed-'));
  console.log(JSON.stringify({ event: 'T16_EVIDENCE_DIRECTORY', artifactDirectory: area, productionAcceptance: false }));
  // Development RED may use the current build. Final acceptance requires the frozen tarball;
  // its digest is recorded before installation and rechecked after every matrix case.
  if (process.env.PHASE3_CLI_TARBALL) {
    const tarball = required('PHASE3_CLI_TARBALL'), cliRoot = join(area, 'cli'); await mkdir(cliRoot);
    const frozenDigest = sha(await readFile(tarball));
    await writeFile(join(cliRoot, 'package.json'), JSON.stringify({ private: true, dependencies: { '@company/component-cli': `file:${tarball.replaceAll('\\', '/')}` } }));
    const installedCli = await processResult(node, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'],
      cliRoot, await cleanManagerEnvironment('frozen-cli'), join(area, 'frozen-cli-install.json'));
    expect(installedCli.code, installedCli.stdout + installedCli.stderr).toBe(0);
    expect(sha(await readFile(tarball))).toBe(frozenDigest);
    bin = join(cliRoot, 'node_modules/@company/component-cli/dist/bin.js');
    const installed = JSON.parse(await readFile(join(cliRoot, 'node_modules/@company/component-cli/package.json'), 'utf8'));
    expect(installed.dependencies?.['@company/contracts']).toBeUndefined();
    await writeFile(join(area, 'frozen-cli.json'), JSON.stringify({ sha256: frozenDigest, version: installed.version }));
  } else { bin = required('T16_CLI_ENTRY'); }
  h = await platformHarness(); await grant(h, 't16-acceptance', true);
  for (const pkg of manifest.packages) await h.db.query('INSERT INTO package_permissions(subject,package_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', ['t16-acceptance', pkg.name]);
  readToken = await registryToken('g2reader');
  const uploaded = await upload(h, { manifest, files }, await freshApiToken());
  const submitted = await release(h, uploaded, await freshApiToken());
  expect(submitted.status).toBe(202); const jobId = (await submitted.json()).jobId;
  const worker = new ReleaseWorker(h.db, h.store, await realRegistry()); let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await worker.runOnce(); await worker.tags.runOnce();
    const job = await (await h.request(`/v1/releases/${jobId}`, undefined, await freshApiToken(), 'GET')).json();
    if (job.state === 'READY') { ready = true; break; }
    if (['REJECTED', 'CONFLICT'].includes(job.state)) throw new Error(`Frozen release ${job.state}`);
  }
  expect(ready).toBe(true);
  rows = (await h.db.query<{ id: string; framework: Framework; metadata: ReleaseManifestV1['variants'][number] }>(
    "SELECT vr.id,v.framework,vr.metadata FROM variant_releases vr JOIN variants v ON v.id=vr.variant_id JOIN package_releases p ON p.id=vr.package_release_id WHERE p.job_id=$1 AND v.component_id='line'", [jobId])).rows;
  expect(rows).toHaveLength(2);
  const evidence = JSON.parse(await readFile(required('INSTALLED_CLI_EVIDENCE'), 'utf8'));
  expect(evidence.recommendation).toBe('adopt'); expect(evidence.probe.packaged).toBe(true);
  for (const row of rows) {
    const pkg = manifest.packages.find(item => item.name === row.metadata.packageName)!;
    const response = await h.request(`/v1/variant-releases/${row.id}/compatibility`, {
      packageSha256: pkg.tarball.sha256, reason: 'Frozen SDK installed acceptance reused for T16 technical matrix',
      candidate: { version: evidence.candidate.version, source: evidence.candidate.source, integrity: evidence.candidate.integrity }, evidence,
    }, await freshApiToken());
    expect(response.status, await response.clone().text()).toBe(201);
  }
});
afterAll(async () => { await h?.close(); });

async function createProject(item: typeof matrix[number]) {
  const root = join(area, `${item.id} 项目`), importer = item.workspace ? 'apps/client' : '.', target = join(root, importer);
  await mkdir(join(target, 'src'), { recursive: true });
  const scripts = { preinstall: 'node poison.cjs', install: 'node poison.cjs', postinstall: 'node poison.cjs', build: 'node poison.cjs', typecheck: 'node poison.cjs' };
  const deps = { [item.framework]: item.framework === 'vue' ? '3.5.45' : '19.3.1',
    ...(item.framework === 'react' ? { 'react-dom': '19.3.1' } : {}), echarts: '6.1.0' };
  const dev = { vite: '8.3.8', typescript: '6.0.3',
    ...(item.framework === 'vue' ? { 'vue-tsc': '3.3.14', '@vitejs/plugin-vue': '6.0.10' } :
      { '@types/react': '19.3.0', '@types/react-dom': '19.3.0', '@vitejs/plugin-react': '6.3.0' }), yaml: '2.9.1' };
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: `t16-${item.id}`, version: '1.0.0', private: true, type: 'module',
    packageManager: `${item.manager}@${item.manager === 'npm' ? '11.20.0' : '12.18.0'}`, scripts, devDependencies: dev,
    ...(item.workspace ? { workspaces: ['apps/client', 'apps/peer'] } : { dependencies: deps }) }, null, 2));
  if (item.workspace) {
    await writeFile(join(target, 'package.json'), JSON.stringify({ name: '@synthetic/client', version: '1.0.0', private: true, type: 'module', scripts, dependencies: deps }));
    await mkdir(join(root, 'apps/peer'), { recursive: true });
    await writeFile(join(root, 'apps/peer/package.json'), JSON.stringify({ name: '@synthetic/peer', version: '1.0.0', private: true, scripts, dependencies: { yaml: '2.8.1' } }));
  }
  if (item.manager === 'pnpm' && item.workspace) await writeFile(join(root, 'pnpm-workspace.yaml'),
    `${item.workspace ? "packages:\n  - apps/client\n  - apps/peer\n" : ''}nodeLinker: hoisted\npackageImportMethod: copy\npmOnFail: error\nignoreScripts: true\nignorePnpmfile: true\n`);
  const env = await cleanManagerEnvironment(item.id);
  const lock = await processResult(item.manager === 'npm' ? node : pnpm, item.manager === 'npm' ?
    [npm, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'] :
    ['install', '--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--registry=https://registry.npmjs.org/'],
    root, env, join(area, `${item.id}-prepare-lock.json`));
  expect(lock.code, lock.stderr).toBe(0);
  const poison = `require('node:fs').writeFileSync(${JSON.stringify(join(area, `${item.id}-POISON`))},'executed');throw new Error('project hook executed');`;
  await writeFile(join(root, 'poison.cjs'), poison);
  if (item.workspace) for (const member of ['client', 'peer']) await writeFile(join(root, `apps/${member}/poison.cjs`), poison);
  // Unsupported resolution configuration belongs to a separate blocked/no-write
  // case. Successful matrix rows exercise lifecycle isolation with valid inputs.
  await writeFile(join(target, 'user-notes.txt'), 'existing user content');
  return { root, target, importer };
}

async function buildProject(root: string, importer: string, framework: Framework, generated: string, label: string) {
  const target = join(root, importer), req = createRequire(join(root, 'package.json'));
  const tool = (name: string, suffix: string) => join(dirname(req.resolve(`${name}/package.json`)), suffix);
  await writeFile(join(target, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noUncheckedIndexedAccess: true,
    skipLibCheck: true, jsx: 'react-jsx', lib: ['ES2022', 'DOM'], noEmit: true, allowImportingTsExtensions: true,
  }, include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue'] }));
  await writeFile(join(target, 'src/assets.d.ts'), 'declare module "*.css";');
  const source = await readFile(join(root, generated), 'utf8');
  const exportMatch = source.match(/export function (Zhinexus[A-Za-z0-9_]+)/);
  const specifier = './' + relative(join(target, 'src'), join(root, generated)).replaceAll('\\', '/');
  // Import the actual generated module into the build. No alias redirects SDK resolution.
  await writeFile(join(target, 'src/main.ts'), framework === 'vue' ?
    `import Component from ${JSON.stringify(specifier)}; console.log(Component);` :
    `import { ${exportMatch?.[1] ?? 'MISSING_GENERATED_EXPORT'} as Component } from ${JSON.stringify(specifier)}; console.log(Component);`);
  await writeFile(join(target, 'index.html'), '<div id="app"></div><script type="module" src="/src/main.ts"></script>');
  await writeFile(join(target, 'vite.config.mjs'), `import {defineConfig} from 'vite';import plugin from '@vitejs/plugin-${framework}';export default defineConfig({plugins:[plugin()]});`);
  const typecheck = await processResult(node, [tool(framework === 'vue' ? 'vue-tsc' : 'typescript', framework === 'vue' ? 'bin/vue-tsc.js' : 'bin/tsc'), '--noEmit', '-p', join(target, 'tsconfig.json')], target, process.env, join(area, `${label}-typecheck.json`));
  expect(typecheck.code, typecheck.stdout + typecheck.stderr).toBe(0);
  const build = await processResult(node, [tool('vite', 'bin/vite.js'), 'build'], target, process.env, join(area, `${label}-build.json`));
  expect(build.code, build.stdout + build.stderr).toBe(0);
}

describe('T16 real isolated services and actual dependency installation', () => {
  it.each((['npm', 'pnpm'] as const).flatMap(manager => ['.npmrc', '.pnpmfile.cjs'].map(config => ({ manager, config }))))(
    '$manager rejects hostile $config without project writes or hook execution', async ({ manager, config }) => {
      const id = `blocked-${manager}-${config.replaceAll('.', '')}`;
      const project = await createProject({ framework: 'vue', manager, workspace: false, id });
      const matchFile = join(area, `${id}-match.json`);
      await writeFile(matchFile, JSON.stringify(await match('vue', manager)));
      const planned = await cli(['plan', '--project', project.root, '--match', matchFile, '--api-url', h!.origin(),
        '--registry', localServices().registryOrigin], `${id}-plan`);
      expect(planned.code, planned.stdout + planned.stderr).toBe(0);
      const plan = validateIntegrationPlan(JSON.parse(planned.stdout));
      if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
      expect(plan.value.status).toBe('planned');
      const poisonPath = join(area, `${id}-POISON`);
      await writeFile(join(project.root, config), config === '.npmrc' ?
        'registry=https://attacker.example.invalid/\nignore-scripts=false\n' :
        `require('node:fs').writeFileSync(${JSON.stringify(poisonPath)},'executed');throw new Error('hostile pnpmfile executed');`);
      const original = await tree(project.root);
      const planFile = join(area, `${id}-plan-input.json`); await writeFile(planFile, JSON.stringify(plan.value));
      const backup = join(area, `${id}-backup`); await mkdir(backup);
      const output = await cli(['apply', '--project', project.root, '--plan', planFile, '--api-url', h!.origin(),
        '--registry', localServices().registryOrigin, '--backup-root', backup, '--allow-install', 'true'], `${id}-apply`);
      expect(output.code, output.stdout + output.stderr).toBe(2);
      const result = validateIntegrationApplyResult(JSON.parse(output.stdout));
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(result.value.status).toBe('blocked');
      expect(result.value.issues.map(issue => issue.code)).toContain('DEPENDENCY_CONFLICT');
      expect(await tree(project.root)).toEqual(original);
      await expect(lstat(poisonPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  it.each(matrix)('$id applies, builds and relocates the installed generated module', async item => {
    const project = await createProject(item), { root, importer } = project;
    const original = await tree(root), matchFile = join(area, `${item.id}-match.json`);
    await writeFile(matchFile, JSON.stringify(await match(item.framework, item.manager)));
    const scope = item.workspace ? ['--workspace', importer] : [];
    const planned = await cli(['plan', '--project', root, '--match', matchFile, '--api-url', h!.origin(), '--registry', localServices().registryOrigin, ...scope], `${item.id}-plan`);
    expect(await tree(root)).toEqual(original);
    expect(planned.code, planned.stdout + planned.stderr).toBe(0);
    const checked = validateIntegrationPlan(JSON.parse(planned.stdout));
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues)); const plan: IntegrationPlanV1 = checked.value;
    expect(plan.status).toBe('planned'); expect(plan.executionAuthorized).toBe(false);
    const planFile = join(area, `${item.id}-plan-input.json`); await writeFile(planFile, JSON.stringify(plan));
    const backup = join(area, `${item.id}-backup`); await mkdir(backup);
    const applied = await cli(['apply', '--project', root, '--plan', planFile, '--api-url', h!.origin(), '--registry', localServices().registryOrigin,
      '--backup-root', backup, '--allow-install', 'true', ...scope], `${item.id}-apply`);
    if (applied.code !== 0 && item.id === 'vue-npm-standalone' && process.env.T16_DIAGNOSE_CANDIDATE === 'true') {
      await diagnoseCandidateLock(root, plan, item.id);
    }
    expect(applied.code, applied.stdout + applied.stderr).toBe(0);
    const result = validateIntegrationApplyResult(JSON.parse(applied.stdout));
    if (!result.ok) throw new Error(JSON.stringify(result.issues)); expect(result.value.status).toBe('applied');
    const excluded = new Set(['node_modules', ...(item.workspace ? ['apps/client/node_modules', 'apps/peer/node_modules'] : [])]);
    const after = await tree(root, excluded);
    for (const [path, hash] of Object.entries(original)) if (!plan.allowedPaths.includes(path)) expect(after[path], path).toBe(hash);
    for (const path of Object.keys(after)) if (!(path in original)) expect(plan.allowedPaths, path).toContain(path);
    for (const dependency of plan.exactDependencies) {
      const installed = await installedPackage(dependency.name, project.target);
      expect(inTree(root, await realpath(installed.path)), dependency.name).toBe(true);
      expect(installed.value.version).toBe(dependency.version);
      expect(result.value.installedVersions).toContainEqual(dependency);
    }
    expect((await installedPackage('echarts', project.target)).value.version).toBe('6.1.0');
    expect((await readdir(join(root, 'node_modules/.bin'))).some(name => /^vite(?:\.cmd|\.ps1)?$/.test(name))).toBe(true);
    if (item.workspace) {
      const peer = createRequire(join(root, 'apps/peer/package.json'));
      expect(JSON.parse(await readFile(peer.resolve('yaml/package.json'), 'utf8')).version).toBe('2.8.1');
      expect(JSON.parse(await readFile(createRequire(join(root, 'package.json')).resolve('yaml/package.json'), 'utf8')).version).toBe('2.9.1');
      expect(await lstat(join(root, 'apps/peer/node_modules'))).toBeDefined();
      if (item.manager === 'npm') expect(await realpath(join(root, 'node_modules/@synthetic/peer'))).toBe(await realpath(join(root, 'apps/peer')));
    }
    const generated = plan.changes.find(change => change.kind === 'generated-component')!;
    const source = await readFile(join(root, generated.path), 'utf8');
    expectBoundString(source, 'source.data', { framework: item.framework, prop: 'data' });
    expectBoundString(source, item.framework === 'vue' ? 'handler.point-click' : 'handler.onPointClick',
      { framework: item.framework, prop: 'onPointClick' });
    await buildProject(root, importer, item.framework, generated.path, item.id);
    const moved = `${root} relocated`; await rename(root, moved);
    await buildProject(moved, importer, item.framework, generated.path, `${item.id}-relocated`);
    await expect(lstat(join(area, `${item.id}-POISON`))).rejects.toMatchObject({ code: 'ENOENT' });
    if (process.env.PHASE3_CLI_TARBALL) expect(sha(await readFile(required('PHASE3_CLI_TARBALL'))))
      .toBe(JSON.parse(await readFile(join(area, 'frozen-cli.json'), 'utf8')).sha256);
  });
});
