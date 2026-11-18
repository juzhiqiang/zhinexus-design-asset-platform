import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

// Characterize the repository's exact native binary. No host package-manager
// configuration, credentials, Node options or automatic toolchain switch enters it.
const repo = resolve('.');
const node = join(repo, '.tools/node-v26.13.0-win-x64/node.exe');
const pnpm = join(repo, '.tools/pnpm-native-12.18.0/package/pnpm.exe');
const area = mkdtempSync(join(tmpdir(), 'zhinexus-t16-pnpm12-'));
const config = join(area, 'config'); mkdirSync(config);
for (const name of ['userconfig', 'globalconfig']) writeFileSync(join(config, name), '');
mkdirSync(join(area, 'tmp'));
const env = { PATH: [dirname(node), dirname(pnpm)].join(';'), CI: 'true', NO_COLOR: '1',
  TMP: join(area, 'tmp'), TEMP: join(area, 'tmp'),
  npm_config_userconfig: join(config, 'userconfig'), npm_config_globalconfig: join(config, 'globalconfig'),
  PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false' };
for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA']) {
  const pair = Object.entries(process.env).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
  if (pair?.[1]) env[key] = pair[1];
}
const results = [];
function run(id, root, args) {
  const value = spawnSync(pnpm, args, { cwd: root, env, shell: false, windowsHide: true, timeout: 180000, encoding: 'utf8' });
  const result = { id, code: value.status, stdout: value.stdout ?? '', stderr: value.stderr ?? '', error: value.error?.message };
  results.push(result); return result;
}
const settings = 'nodeLinker: hoisted\npackageImportMethod: copy\nenableGlobalVirtualStore: false\nstrictPeerDependencies: true\nengineStrict: true\npmOnFail: error\nignoreScripts: true\nignorePnpmfile: true\n';
function project(id, pin, extra = '') {
  const root = join(area, id); mkdirSync(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: `t16-${id}`, version: '1.0.0', private: true,
    packageManager: `pnpm@${pin}`, engines: { node: '26.13.0', pnpm: '12.18.0' },
    dependencies: { yaml: '2.9.1' }, scripts: { preinstall: 'node poison.cjs', install: 'node poison.cjs', postinstall: 'node poison.cjs' } }));
  const poison = `require('node:fs').writeFileSync(${JSON.stringify(join(area, `${id}-POISON`))},'executed'); throw new Error('poison executed');`;
  writeFileSync(join(root, 'poison.cjs'), poison);
  writeFileSync(join(root, '.pnpmfile.cjs'), poison);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), settings + extra);
  return root;
}
try {
  const version = run('version', area, ['--version']); assert.equal(version.code, 0); assert.equal(version.stdout.trim(), '12.18.0');
  const good = project('good', '12.18.0');
  const base = ['--ignore-scripts', '--ignore-pnpmfile', '--registry=https://registry.npmjs.org/', `--store-dir=${join(area, 'store')}`];
  assert.equal(run('candidate-lock', good, ['install', '--lockfile-only', '--no-frozen-lockfile', ...base]).code, 0);
  assert.equal(run('frozen-materialization', good, ['install', '--frozen-lockfile', ...base]).code, 0);
  assert.equal(existsSync(join(area, 'good-POISON')), false);
  assert.equal(existsSync(join(good, 'node_modules/yaml/package.json')), true);
  const bad = project('mismatched-pin', '12.17.0');
  const mismatch = run('mismatched-pin', bad, ['install', '--lockfile-only', '--no-frozen-lockfile', ...base]);
  assert.notEqual(mismatch.code, 0); assert.match(mismatch.stdout + mismatch.stderr, /12\.17\.0/);
  assert.equal(existsSync(join(bad, 'pnpm-lock.yaml')), false); assert.equal(existsSync(join(bad, 'node_modules')), false);
  const old = project('old-setting', '12.18.0', 'managePackageManagerVersions: false\n');
  const unknown = run('old-setting', old, ['install', '--lockfile-only', '--no-frozen-lockfile', ...base]);
  assert.notEqual(unknown.code, 0); assert.match(unknown.stdout + unknown.stderr, /managePackageManagerVersions/);
  assert.equal(existsSync(join(old, 'pnpm-lock.yaml')), false);
  console.log(JSON.stringify({ area, passed: true, results }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ area, passed: false, results }, null, 2)); throw error;
}
