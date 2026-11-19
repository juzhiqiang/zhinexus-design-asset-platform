import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cleanEnvironment, evidenceArea, installFrozenCli, requiredFile, run } from './support.mjs';

let frozen: Awaited<ReturnType<typeof installFrozenCli>>;
let nodeExe: string;
let npmCli: string;
let artifactDirectory: string;

beforeAll(async () => {
  const tarball = await requiredFile('T17_D_CLI_TARBALL');
  nodeExe = process.execPath;
  npmCli = await requiredFile('T17_D_NPM_CLI');
  artifactDirectory = await evidenceArea();
  frozen = await installFrozenCli({ area: artifactDirectory, tarball, node: nodeExe, npmCli });
  await writeFile(join(artifactDirectory, 'frozen-cli-identity.json'), JSON.stringify({
    package: '@company/component-cli', version: frozen.version, sha256: frozen.sha256,
    tarball: frozen.tarball, installedBin: frozen.bin, nodeVersion: process.version,
    productionAcceptance: false,
  }, null, 2));
}, 300_000);

afterAll(async () => {
  if (frozen) await frozen.assertUnchanged();
});

describe('frozen installed CLI package', () => {
  it('runs the installed package version entry point with clean stdout', async () => {
    const env = await cleanEnvironment(artifactDirectory, 'cli-version', { dirs: [dirname(nodeExe)] });
    const result = await run(nodeExe, [frozen.bin, '--version'], { cwd: frozen.root, env, timeoutMs: 30_000 });

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(frozen.version);
    expect(result.stderr).toBe('');
    await frozen.assertUnchanged();
  }, 60_000);

  it('records the installed manifest version independently of workspace sources', async () => {
    const packageManifest = JSON.parse(await readFile(join(frozen.root, 'node_modules', '@company', 'component-cli', 'package.json'), 'utf8'));

    expect(packageManifest.version).toBe(frozen.version);
    expect(packageManifest.dependencies?.['@company/contracts']).toBeUndefined();
  });
});
