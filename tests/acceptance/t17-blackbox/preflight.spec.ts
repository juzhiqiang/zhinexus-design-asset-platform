import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import setup, { assertFixedNpmCli } from './global-setup.js';
import { required, requiredFile, sha256 } from './support.mjs';

const inputNames = ['T17_D_CLI_TARBALL', 'T17_D_CLI_SHA256', 'T17_D_CLI_VERSION', 'T17_D_NPM_CLI'] as const;
const originalInputs = Object.fromEntries(inputNames.map(name => [name, process.env[name]]));
const temporaryDirectories: string[] = [];
async function validFrozenInputs() {
  const directory = await mkdtemp(join(tmpdir(), 't17-preflight-'));
  temporaryDirectories.push(directory);
  const tarball = join(directory, 'cli.tgz');
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const bytes = Buffer.from('synthetic-frozen-tarball');
  await writeFile(tarball, bytes);
  const decoyNpmCli = join(directory, 'npm-cli.js');
  await writeFile(decoyNpmCli, '');
  process.env.T17_D_CLI_TARBALL = tarball;
  process.env.T17_D_CLI_SHA256 = sha256(bytes);
  process.env.T17_D_CLI_VERSION = '0.0.14';
  process.env.T17_D_NPM_CLI = npmCli;
  return { tarball, npmCli, decoyNpmCli };
}
afterEach(() => {
  for (const name of inputNames) {
    const original = originalInputs[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  return Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('T17 frozen-input preflight', () => {
  it('fails with an explicit error when the frozen CLI tarball is missing', () => {
    delete process.env.T17_D_CLI_TARBALL;

    expect(() => required('T17_D_CLI_TARBALL')).toThrow(/缺少必需环境变量 T17_D_CLI_TARBALL/);
  });

  it('rejects a relative tarball path before attempting installation', async () => {
    process.env.T17_D_CLI_TARBALL = 'artifacts/component-cli.tgz';

    await expect(requiredFile('T17_D_CLI_TARBALL')).rejects.toThrow(/必须是绝对路径/);
  });

  it('accepts only a matching frozen checksum, exact version, and npm CLI path', async () => {
    const { tarball, npmCli, decoyNpmCli } = await validFrozenInputs();
    await expect(setup()).resolves.toBeUndefined();

    process.env.T17_D_CLI_SHA256 = '0'.repeat(64);
    await expect(setup()).rejects.toThrow(/SHA-256 不匹配/);
    process.env.T17_D_CLI_SHA256 = sha256(Buffer.from('synthetic-frozen-tarball'));

    process.env.T17_D_CLI_VERSION = 'latest';
    await expect(setup()).rejects.toThrow(/精确 semver/);
    process.env.T17_D_CLI_VERSION = '0.0.14';

    process.env.T17_D_NPM_CLI = decoyNpmCli;
    await expect(setup()).rejects.toThrow(/固定 Node 发行版/);
    process.env.T17_D_NPM_CLI = npmCli;
  });

  it('requires the exact bundled Node and npm versions and path', async () => {
    const bundledNpmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const decoyNpmCli = join(await mkdtemp(join(tmpdir(), 't17-preflight-decoy-')), 'npm-cli.js');
    temporaryDirectories.push(dirname(decoyNpmCli));
    await writeFile(decoyNpmCli, '');
    expect(() => assertFixedNpmCli({ npmCli: bundledNpmCli, nodeExecutable: process.execPath, nodeVersion: 'v26.13.0', npmVersion: '11.20.0' })).not.toThrow();
    expect(() => assertFixedNpmCli({ npmCli: bundledNpmCli, nodeExecutable: process.execPath, nodeVersion: 'v26.12.0', npmVersion: '11.20.0' })).toThrow(/Node v26.13.0/);
    expect(() => assertFixedNpmCli({ npmCli: bundledNpmCli, nodeExecutable: process.execPath, nodeVersion: 'v26.13.0', npmVersion: '11.19.0' })).toThrow(/npm 11.20.0/);
    expect(() => assertFixedNpmCli({ npmCli: decoyNpmCli, nodeExecutable: process.execPath, nodeVersion: 'v26.13.0', npmVersion: '11.20.0' })).toThrow(/固定 Node 发行版/);
  });
});
