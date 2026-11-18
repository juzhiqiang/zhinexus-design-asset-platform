import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Reproduce only the real fixed version probes, without installing dependencies,
// importing product helpers, reading host credentials or exposing environment values.
const repo = resolve('.');
const node = join(repo, '.tools/node-v26.13.0-win-x64/node.exe');
const npm = join(dirname(node), 'node_modules/npm/bin/npm-cli.js');
const pnpm = join(repo, '.tools/pnpm-native-12.18.0/package/pnpm.exe');
const area = mkdtempSync(join(tmpdir(), 'zhinexus-t16-tool-probes-'));
const userconfig = join(area, 'userconfig'), globalconfig = join(area, 'globalconfig');
writeFileSync(userconfig, ''); writeFileSync(globalconfig, ''); mkdirSync(join(area, 'tmp'));
const env = { PATH: [dirname(node), dirname(pnpm), join(repo, '.tools/bin')].join(';'),
  CI: 'true', NO_COLOR: '1', TMP: join(area, 'tmp'), TEMP: join(area, 'tmp'),
  npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig };
for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA']) {
  const pair = Object.entries(process.env).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
  if (pair?.[1]) env[key] = pair[1];
}
const results = [];
for (const configExists of [false, true]) {
for (const guarded of [false, true]) {
  for (const [id, command, args] of [['node', node, ['--version']], ['npm', node, [npm, '--version']], ['pnpm', pnpm, ['--version']]]) {
    const output = spawnSync(command, args, { cwd: dirname(command),
      env: { ...env, ...(configExists ? {} : { npm_config_userconfig: join(area, 'not-created-userconfig'), npm_config_globalconfig: join(area, 'not-created-globalconfig') }),
        ...(guarded ? { PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false' } : {}) },
      shell: false, windowsHide: true, timeout: 60000, encoding: 'utf8' });
    results.push({ id, configExists, guarded, code: output.status, stdout: output.stdout ?? '', stderr: output.stderr ?? '', error: output.error?.message });
  }
}
}
console.log(JSON.stringify({ area, results }, null, 2));
