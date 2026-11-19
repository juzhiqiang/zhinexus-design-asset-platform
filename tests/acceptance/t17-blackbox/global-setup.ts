import { readFile } from 'node:fs/promises';
import { required, requiredFile, sha256 } from './support.mjs';

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
  if (process.version !== 'v26.13.0') throw new Error(`T17 黑盒必须使用 Node v26.13.0，当前为 ${process.version} (${process.execPath})`);
  if (!npmCli.toLowerCase().endsWith('npm-cli.js')) throw new Error('T17_D_NPM_CLI 必须指向 npm-cli.js');

}
