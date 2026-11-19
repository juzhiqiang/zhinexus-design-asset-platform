import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { cleanEnvironment, evidenceArea, installFrozenCli, recordCaseEvidence, required, requiredFile, run, singleJson } from './support.mjs';

let frozen: Awaited<ReturnType<typeof installFrozenCli>>;
let nodeExe: string;
let npmCli: string;
let artifactDirectory: string;
let caseDirectory: string;
let caseOwnerMarker: string;
let frozenOwnerMarker: string;

beforeAll(async () => {
  const tarball = await requiredFile('T17_D_CLI_TARBALL');
  const expectedVersion = required('T17_D_CLI_VERSION');
  nodeExe = process.execPath;
  npmCli = await requiredFile('T17_D_NPM_CLI');
  artifactDirectory = await evidenceArea();
  frozen = await installFrozenCli({ area: artifactDirectory, tarball, node: nodeExe, npmCli, expectedVersion });
  frozenOwnerMarker = JSON.stringify({ runId: randomUUID(), path: await realpath(frozen.root), purpose: 'temporary-frozen-cli-consumer' });
  await writeFile(join(frozen.root, '.t17-owner.json'), frozenOwnerMarker, { flag: 'wx' });
  caseDirectory = await mkdtemp(join(tmpdir(), 't17-d-owned-cases-'));
  caseOwnerMarker = JSON.stringify({ runId: randomUUID(), path: await realpath(caseDirectory), purpose: 'temporary-synthetic-blackbox' });
  await writeFile(join(caseDirectory, '.t17-owner.json'), caseOwnerMarker, { flag: 'wx' });
  await mkdir(caseDirectory, { recursive: true });
  await writeFile(join(artifactDirectory, 'frozen-cli-identity.json'), JSON.stringify({
    package: '@company/component-cli', version: frozen.version, expectedVersion, sha256: frozen.sha256,
    tarball: frozen.tarball, installedBin: frozen.bin, nodeVersion: process.version,
    productionAcceptance: false,
  }, null, 2));
}, 300_000);

afterAll(async () => {
  try {
    if (frozen) await frozen.assertUnchanged();
  } finally {
    try {
      if (frozen) {
        const rootStat = await lstat(frozen.root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(frozen.root) !== resolve(artifactDirectory, 'cli') ||
            await readFile(join(frozen.root, '.t17-owner.json'), 'utf8') !== frozenOwnerMarker) {
          throw new Error('Frozen CLI consumer root changed ownership.');
        }
        await rm(frozen.root, { recursive: true, force: false });
      }
    } finally {
      if (caseDirectory) {
        const resolved = await realpath(caseDirectory);
        if (resolved !== caseDirectory || await readFile(join(caseDirectory, '.t17-owner.json'), 'utf8') !== caseOwnerMarker) {
          throw new Error('Temporary synthetic project ownership changed.');
        }
        await rm(caseDirectory, { recursive: true, force: false });
      }
    }
  }
});

const receiptIndex: Array<{ caseId: string; kind: 'positive' | 'refusal'; evidencePath: string }> = [];
async function saveCase(caseId: string, kind: 'positive' | 'refusal', value: unknown, secrets: string[] = []) {
  const receipt = await recordCaseEvidence({ area: artifactDirectory, caseId, kind, value, secrets });
  receiptIndex.push({ caseId: receipt.caseId, kind: receipt.kind, evidencePath: receipt.evidencePath });
  await writeFile(join(artifactDirectory, 'case-receipts.json'), JSON.stringify({
    receipts: receiptIndex, frozenCli: { version: frozen.version, sha256: frozen.sha256 }, productionAcceptance: false,
  }, null, 2) + '\n');
  await frozen.assertUnchanged();
  return receipt;
}

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

  it('fails closed for verify and repair when required authorization files do not exist', async () => {
    const projectRoot = resolve(caseDirectory, 'project');
    const out = resolve(caseDirectory, 'artifacts');
    const env = await cleanEnvironment(artifactDirectory, 'cli-rejections', { dirs: [dirname(nodeExe)] });
    const verify = await run(nodeExe, [frozen.bin, 'integrate', 'verify', '--project', projectRoot,
      '--plan', resolve(caseDirectory, 'missing-plan.json'), '--apply-result', resolve(caseDirectory, 'missing-apply.json'),
      '--spec', resolve(caseDirectory, 'missing-spec.json'), '--out', out,
      '--allow-project-scripts', 'false', '--allow-browser', 'false'], { cwd: caseDirectory, env, timeoutMs: 30_000 });
    const repair = await run(nodeExe, [frozen.bin, 'integrate', 'repair', '--project', projectRoot,
      '--plan', resolve(caseDirectory, 'missing-plan.json'), '--apply-result', resolve(caseDirectory, 'missing-apply.json'),
      '--spec', resolve(caseDirectory, 'missing-spec.json'), '--out', out,
      '--allow-project-scripts', 'false', '--allow-browser', 'false', '--report', resolve(caseDirectory, 'missing-report.json')],
      { cwd: caseDirectory, env, timeoutMs: 30_000 });
    const verifyJson = singleJson(verify);
    const repairJson = singleJson(repair);
    expect(verify.code).toBe(1);
    expect(verifyJson).toMatchObject({ status: 'error' });
    expect(verify.stderr).not.toContain(caseDirectory);
    expect(repair.code).toBe(1);
    expect(repairJson).toMatchObject({ status: 'error' });
    expect(repair.stderr).not.toContain(caseDirectory);
    await saveCase('D01-cli-verify-missing-input', 'refusal', { code: verifyJson.error, exitCode: verify.code });
    await saveCase('D02-cli-repair-missing-input', 'refusal', { code: repairJson.error, exitCode: repair.code });
  }, 60_000);

  it('uses SDK stdio to compare installed CLI inspect with MCP and rejects ungranted writes/verification', async () => {
    const projectRoot = resolve(caseDirectory, 'synthetic-vue-project');
    const artifactRoot = resolve(caseDirectory, 'mcp-artifacts');
    await mkdir(projectRoot, { recursive: true });
    await mkdir(artifactRoot, { recursive: true });
    const dependencies = { '@company/charts-vue': '0.0.12', vue: '3.5.45', echarts: '6.1.0' };
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({ name: 't17-synthetic-vue', version: '1.0.0', private: true, dependencies }) + '\n');
    await writeFile(join(projectRoot, 'package-lock.json'), JSON.stringify({ name: 't17-synthetic-vue', version: '1.0.0', lockfileVersion: 3, packages: {
      '': { name: 't17-synthetic-vue', version: '1.0.0', dependencies },
      'node_modules/@company/charts-vue': { version: '0.0.12' },
      'node_modules/vue': { version: '3.5.45' },
      'node_modules/echarts': { version: '6.1.0' },
    } }) + '\n');
    for (const [name, version] of Object.entries(dependencies)) {
      const packageDirectory = join(projectRoot, 'node_modules', ...name.split('/'));
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name, version }) + '\n');
    }
    const config = resolve(caseDirectory, 'mcp-config.json');
    await writeFile(config, JSON.stringify({ schemaVersion: 1, projectRoot, artifactRoot }) + '\n');
    const env = await cleanEnvironment(artifactDirectory, 'mcp-client', { dirs: [dirname(nodeExe)] });
    const cli = await run(nodeExe, [frozen.bin, 'integrate', 'inspect', '--project', projectRoot], { cwd: projectRoot, env, timeoutMs: 30_000 });
    const cliValue = singleJson(cli);
    expect(cli.code).toBe(0);

    const transport = new StdioClientTransport({ command: nodeExe, args: [frozen.bin, 'mcp', 'serve', '--config', config], cwd: projectRoot, env, stderr: 'pipe' });
    const stderr: string[] = [];
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
    const client = new Client({ name: 't17-blackbox-client', version: '1.0.0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = listed.tools.map(tool => tool.name).sort();
      expect(names).toEqual(['apply_integration', 'inspect_project', 'plan_integration', 'verify_integration']);
      const mcpInspect = await client.callTool({ name: 'inspect_project', arguments: {} });
      expect(mcpInspect.isError).not.toBe(true);
      const mcpValue = JSON.parse((mcpInspect.content[0] as { text: string }).text);
      expect(mcpValue).toEqual(cliValue);
      const apply = await client.callTool({ name: 'apply_integration', arguments: { plan: {} } });
      const verify = await client.callTool({ name: 'verify_integration', arguments: { plan: {}, applyResult: {}, spec: {} } });
      expect(apply.isError).toBe(true);
      expect(verify.isError).toBe(true);
      await saveCase('D03-mcp-cli-inspect-parity', 'positive', { framework: mcpValue.framework, packageManager: mcpValue.packageManager, status: mcpValue.status, tools: names });
      await saveCase('D04-mcp-no-grant-refusal', 'refusal', {
        apply: JSON.parse((apply.content[0] as { text: string }).text).error,
        verify: JSON.parse((verify.content[0] as { text: string }).text).error,
      });
    } finally {
      await transport.close();
    }
    expect(stderr.join('')).toBe('');
  }, 60_000);
});
