import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { required, requiredFile, sha256 } from './support.mjs';

function assertFixedNpmPath({ npmCli, nodeExecutable, nodeVersion }: { npmCli: string; nodeExecutable: string; nodeVersion: string }) {
  if (nodeVersion !== 'v26.13.0') throw new Error(`T17 黑盒必须使用 Node v26.13.0，当前为 ${nodeVersion} (${nodeExecutable})`);
  const expectedNpmCli = resolve(dirname(realpathSync(nodeExecutable)), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const actualNpmCli = resolve(realpathSync(npmCli));
  if (actualNpmCli.toLowerCase() !== expectedNpmCli.toLowerCase()) throw new Error(`T17_D_NPM_CLI 必须使用固定 Node 发行版中的 npm-cli.js: ${expectedNpmCli}`);
}

export function assertFixedNpmCli({ npmCli, nodeExecutable, nodeVersion, npmVersion }: { npmCli: string; nodeExecutable: string; nodeVersion: string; npmVersion: string }) {
  assertFixedNpmPath({ npmCli, nodeExecutable, nodeVersion });
  if (npmVersion !== '11.20.0') throw new Error(`T17 黑盒必须使用 npm 11.20.0，当前为 ${npmVersion}`);
}

/** Fail before creating local services if the frozen product input is absent or changed. */
export default async function setup() {
  const tarball = await requiredFile('T17_D_CLI_TARBALL');
  const npmCli = await requiredFile('T17_D_NPM_CLI');
  const expectedVersion = required('T17_D_CLI_VERSION');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion)) throw new Error('T17_D_CLI_VERSION 必须是精确 semver 版本');
  const expectedSha = required('T17_D_CLI_SHA256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) throw new Error('T17_D_CLI_SHA256 必须是 64 位十六进制 SHA-256');
  const actualSha = sha256(await readFile(tarball));
  if (actualSha !== expectedSha) throw new Error(`冻结 CLI SHA-256 不匹配：期望 ${expectedSha}，实际 ${actualSha}`);
  assertFixedNpmPath({ npmCli, nodeExecutable: process.execPath, nodeVersion: process.version });
  const npmVersion = execFileSync(process.execPath, [npmCli, '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assertFixedNpmCli({ npmCli, nodeExecutable: process.execPath, nodeVersion: process.version, npmVersion });

}
