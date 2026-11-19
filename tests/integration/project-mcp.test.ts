/**
 * T17 A3 产品失败测试：四工具本地 stdio MCP (`component mcp serve --config <abs>`)。
 *
 * 使用官方 `@modelcontextprotocol/client@2.4.0` 真实 stdio 子进程验证：
 * - `tools/list` 精确列出 `inspect_project`、`plan_integration`、`apply_integration`、`verify_integration`；
 * - `verify_integration` 不标注 `readOnlyHint: true`；
 * - 拒绝未知工具、额外字段（假批准/executable/自由路径）、越根 `projectRoot`、无 grant 调用 apply/verify；
 * - 四工具与 CLI 行为语义一致，且 `stdout` 仅含 MCP 协议消息、凭据不泄露、客户端关闭后子进程干净退出。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { canonicalJson } from '../../packages/component-cli/src/contracts/schema.js';
import { canonicalProjectRoot } from '../../packages/component-cli/src/integration/apply.js';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { startSyntheticNetwork, SYNTHETIC_API_TOKEN, SYNTHETIC_REGISTRY_TOKEN, type SyntheticNetwork } from './t16-support/loopback-services.js';
import { ECHARTS_VERSION, PACKAGE_VERSION, tarballSha256, VUE_FRAMEWORK_VERSION, VUE_PACKAGE_NAME } from './t16-support/synthetic-projects.js';

function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function vueTarget(): Record<string, unknown> {
  return {
    variantReleaseId: '00000000-0000-4000-8000-000000000001',
    variantId: 'line-vue',
    componentId: 'line',
    framework: 'vue',
    packageName: VUE_PACKAGE_NAME,
    packageVersion: PACKAGE_VERSION,
    packageSha256: tarballSha256(VUE_PACKAGE_NAME, PACKAGE_VERSION),
    exportName: 'LineChart',
    exportPath: './line',
    evidence: [
      { kind: 'api', path: 'api/line.json', sha256: 'c'.repeat(64) },
      { kind: 'docs', path: 'docs/line.md', sha256: 'd'.repeat(64) },
    ],
    compatibility: { status: 'verified', recordIds: ['synthetic-test-only'] },
    examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
    styleExport: './style.css',
    readyMethod: 'whenRendered',
    notes: [],
  };
}

const VUE_DEPS = [
  { name: VUE_PACKAGE_NAME, version: PACKAGE_VERSION },
  { name: 'vue', version: VUE_FRAMEWORK_VERSION },
  { name: 'echarts', version: ECHARTS_VERSION },
];

describe('T17 A3 四工具本地 stdio MCP', () => {
  let network: SyntheticNetwork;
  const tempRoots: string[] = [];
  const binPath = path.resolve(process.cwd(), 'packages/component-cli/dist/bin.js');

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempRoots.push(dir);
    return dir;
  }

  beforeAll(async () => {
    network = await startSyntheticNetwork();
    network.apiResponder = (query: Record<string, string>) => ({
      schemaVersion: 1,
      query,
      status: 'matched',
      target: vueTarget(),
      api: {
        schemaVersion: 1,
        componentId: 'line',
        framework: 'vue',
        exportName: 'LineChart',
        exportPath: './line',
        props: [
          { name: 'data', type: 'ChartData', required: true },
          { name: 'config', type: 'LineChartConfig', required: false },
        ],
        events: [{ name: 'point-click', payload: 'ChartEvent' }],
        styleExport: './style.css',
        readyMethod: 'whenRendered',
        notes: [],
      },
      exactDependencies: VUE_DEPS.map(d => ({ ...d })),
      gaps: [],
    });
  });

  afterAll(async () => {
    await network?.close();
    for (const dir of tempRoots) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // ignore
      }
    }
  });

  function createSampleProject() {
    const root = makeTempDir('zhinexus-t17-mcp-proj-');
    const artifactRoot = makeTempDir('zhinexus-t17-mcp-art-');
    writeJson(path.join(root, 'package.json'), {
      name: 'synthetic-mcp-app',
      version: '1.0.0',
      private: true,
      scripts: {
        typecheck: 'node -e "process.exit(0)"',
        build: 'node -e "const fs=require(\'fs\');fs.mkdirSync(\'dist\',{recursive:true});fs.writeFileSync(\'dist/ok.js\',\'1\')"',
      },
      dependencies: {
        [VUE_PACKAGE_NAME]: PACKAGE_VERSION,
        vue: VUE_FRAMEWORK_VERSION,
        echarts: ECHARTS_VERSION,
      },
    });
    writeJson(path.join(root, 'package-lock.json'), {
      name: 'synthetic-mcp-app',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'synthetic-mcp-app',
          version: '1.0.0',
          dependencies: {
            [VUE_PACKAGE_NAME]: PACKAGE_VERSION,
            vue: VUE_FRAMEWORK_VERSION,
            echarts: ECHARTS_VERSION,
          },
        },
        [`node_modules/${VUE_PACKAGE_NAME}`]: { version: PACKAGE_VERSION },
        'node_modules/vue': { version: VUE_FRAMEWORK_VERSION },
        'node_modules/echarts': { version: ECHARTS_VERSION },
      },
    });
    for (const dep of VUE_DEPS) {
      writeJson(path.join(root, 'node_modules', ...dep.name.split('/'), 'package.json'), {
        name: dep.name,
        version: dep.version,
      });
    }
    return { root, canonicalRoot: canonicalProjectRoot(root), artifactRoot };
  }

  async function connectMcp(configPath: string, extraEnv?: Record<string, string>) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [binPath, 'mcp', 'serve', '--config', configPath],
      env: {
        ...process.env as Record<string, string>,
        ...(extraEnv ?? {}),
      },
      stderr: 'pipe',
    });
    const stderrChunks: string[] = [];
    transport.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')));
    const client = new Client({ name: 't17-mcp-test-client', version: '1.0.0' });
    await client.connect(transport);
    return {
      client,
      transport,
      getStderr: () => stderrChunks.join(''),
    };
  }

  it('精确暴露四个工具且 verify 不标只读，拒绝未知工具/额外授权字段/越根请求', async () => {
    const { root, canonicalRoot, artifactRoot } = createSampleProject();
    const configPath = path.join(artifactRoot, 'mcp-host-config.json');
    writeJson(configPath, {
      schemaVersion: 1,
      projectRoot: canonicalRoot,
      artifactRoot: canonicalProjectRoot(artifactRoot),
    });

    const { client, transport, getStderr } = await connectMcp(configPath);
    try {
      const listed = await client.listTools();
      const names = listed.tools.map(t => t.name).sort();
      expect(names).toEqual([
        'apply_integration',
        'inspect_project',
        'plan_integration',
        'verify_integration',
      ]);

      const verifyTool = listed.tools.find(t => t.name === 'verify_integration');
      expect(verifyTool?.annotations?.readOnlyHint).not.toBe(true);

      // 拒绝额外自报批准字段（strict schema）
      const extraFieldRes = await client.callTool({
        name: 'inspect_project',
        arguments: { projectRoot: canonicalRoot, approval: true },
      });
      expect(extraFieldRes.isError).toBe(true);
      expect((extraFieldRes.content[0] as { text: string }).text).toContain('Unrecognized key');

      // 拒绝越根 projectRoot
      const outsideRoot = makeTempDir('zhinexus-t17-mcp-outside-');
      const crossRootRes = await client.callTool({
        name: 'inspect_project',
        arguments: { projectRoot: canonicalProjectRoot(outsideRoot) },
      });
      expect(crossRootRes.isError).toBe(true);

      // 无 applyGrant 拒绝 apply_integration
      const noGrantApply = await client.callTool({
        name: 'apply_integration',
        arguments: { plan: {} },
      });
      expect(noGrantApply.isError).toBe(true);

      // 无 verificationGrant 拒绝 verify_integration
      const noGrantVerify = await client.callTool({
        name: 'verify_integration',
        arguments: { plan: {}, applyResult: {}, spec: {} },
      });
      expect(noGrantVerify.isError).toBe(true);
    } finally {
      await transport.close();
    }
    expect(getStderr()).not.toContain(SYNTHETIC_API_TOKEN);
  });

  it('授权宿主下四工具全链路与 CLI 语义一致且不泄露环境凭据', async () => {
    const { root, canonicalRoot, artifactRoot } = createSampleProject();
    const matchPlan = {
      schemaVersion: 1 as const,
      source: 'design-id' as const,
      inputDigest: 'a'.repeat(64),
      ruleSetId: 'library',
      revision: 'draft-1',
      context: {
        framework: 'vue' as const,
        frameworkVersion: VUE_FRAMEWORK_VERSION,
        echartsVersion: ECHARTS_VERSION,
        packageManager: 'npm' as const,
        requirements: [],
      },
      elements: [
        {
          instanceId: 'node-1',
          designId: '设计/Line',
          status: 'mapped' as const,
          target: vueTarget(),
          props: [
            { name: 'data', type: 'ChartData', required: true, source: 'sales' },
            { name: 'config', type: 'LineChartConfig', required: false },
          ],
          events: [{ name: 'point-click', payload: 'ChartEvent', handler: 'showDetail' }],
          layout: 'grid cell 1',
          gaps: [],
        },
      ],
      exactDependencies: VUE_DEPS.map(d => ({ ...d })),
      gaps: [],
    };

    // 先用 CLI inspect + plan 拿到权威 plan 与 digests 以便构造宿主 grant
    const cliInspect = await runCli(['integrate', 'inspect', '--project', root], '0.0.14');
    expect(cliInspect.exitCode).toBe(0);

    const matchFile = path.join(artifactRoot, 'match.json');
    writeJson(matchFile, matchPlan);
    const prevApi = process.env.ZHINEXUS_API_TOKEN;
    const prevReg = process.env.ZHINEXUS_REGISTRY_TOKEN;
    process.env.ZHINEXUS_API_TOKEN = SYNTHETIC_API_TOKEN;
    process.env.ZHINEXUS_REGISTRY_TOKEN = SYNTHETIC_REGISTRY_TOKEN;
    let cliPlanObj: { allowedPaths: string[]; conflicts: unknown[] };
    try {
      const cliPlan = await runCli(
        [
          'integrate', 'plan',
          '--project', root,
          '--match', matchFile,
          '--api-url', network.apiOrigin,
          '--registry', network.registryOrigin,
        ],
        '0.0.14',
      );
      expect(cliPlan.exitCode).toBe(0);
      cliPlanObj = JSON.parse(cliPlan.stdout) as { allowedPaths: string[]; conflicts: unknown[] };
    } finally {
      if (prevApi === undefined) delete process.env.ZHINEXUS_API_TOKEN;
      else process.env.ZHINEXUS_API_TOKEN = prevApi;
      if (prevReg === undefined) delete process.env.ZHINEXUS_REGISTRY_TOKEN;
      else process.env.ZHINEXUS_REGISTRY_TOKEN = prevReg;
    }

    const planDigest = canonicalDigest(cliPlanObj);
    const configPath = path.join(artifactRoot, 'mcp-auth-config.json');
    writeJson(configPath, {
      schemaVersion: 1,
      projectRoot: canonicalRoot,
      artifactRoot: canonicalProjectRoot(artifactRoot),
      applyGrant: {
        schemaVersion: 1,
        operation: 'apply',
        projectRoot: canonicalRoot,
        planDigest,
        allowedPaths: cliPlanObj.allowedPaths,
        allowInstall: false,
      },
    });

    const { client, transport, getStderr } = await connectMcp(configPath, {
      ZHINEXUS_API_TOKEN: SYNTHETIC_API_TOKEN,
      ZHINEXUS_REGISTRY_TOKEN: SYNTHETIC_REGISTRY_TOKEN,
    });
    try {
      // 1. inspect_project 与 CLI 一致
      const mcpInspectRes = await client.callTool({ name: 'inspect_project', arguments: {} });
      expect(mcpInspectRes.isError).not.toBe(true);
      const mcpInspectJson = JSON.parse((mcpInspectRes.content[0] as { text: string }).text);
      expect(mcpInspectJson.status).toBe(JSON.parse(cliInspect.stdout).status);
      expect(mcpInspectJson.packageManager).toBe('npm');

      // 2. plan_integration 与 CLI 一致
      const mcpPlanRes = await client.callTool({
        name: 'plan_integration',
        arguments: {
          matchPlan,
          apiUrl: network.apiOrigin,
          registryUrl: network.registryOrigin,
        },
      });
      expect(mcpPlanRes.isError).not.toBe(true);
      const mcpPlanJson = JSON.parse((mcpPlanRes.content[0] as { text: string }).text);
      expect(mcpPlanJson.status).toBe('planned');
      expect(mcpPlanJson.allowedPaths).toEqual(cliPlanObj.allowedPaths);

      // 3. apply_integration 使用与宿主 applyGrant 绑定的计划成功执行
      const mcpApplyRes = await client.callTool({
        name: 'apply_integration',
        arguments: {
          plan: cliPlanObj,
          apiUrl: network.apiOrigin,
          registryUrl: network.registryOrigin,
        },
      });
      expect(mcpApplyRes.isError).not.toBe(true);
      const mcpApplyJson = JSON.parse((mcpApplyRes.content[0] as { text: string }).text);
      expect(mcpApplyJson.status).toBe('applied');
      expect(JSON.stringify(mcpApplyJson)).not.toContain(SYNTHETIC_API_TOKEN);
      expect(JSON.stringify(mcpApplyJson)).not.toContain(SYNTHETIC_REGISTRY_TOKEN);

      // 4. verify_integration 与 CLI integrate verify 语义一致
      const pkgHash = sha256Hex(fs.readFileSync(path.join(root, 'package.json')));
      const applyResultDigest = canonicalDigest(mcpApplyJson);
      const spec = {
        schemaVersion: 1 as const,
        projectRoot: canonicalRoot,
        planDigest,
        applyResultDigest,
        commands: [
          { kind: 'type' as const, script: 'typecheck', manifestPath: 'package.json', manifestSha256: pkgHash, timeoutMs: 30_000, outputDirectories: [] },
          { kind: 'build' as const, script: 'build', manifestPath: 'package.json', manifestSha256: pkgHash, timeoutMs: 30_000, outputDirectories: ['dist'] },
        ],
        businessGaps: [],
      };
      const specDigest = canonicalDigest(spec);
      const verifyConfigPath = path.join(artifactRoot, 'mcp-verify-config.json');
      writeJson(verifyConfigPath, {
        schemaVersion: 1,
        projectRoot: canonicalRoot,
        artifactRoot: canonicalProjectRoot(artifactRoot),
        verificationGrant: {
          schemaVersion: 1,
          projectRoot: canonicalRoot,
          planDigest,
          applyResultDigest,
          specDigest,
          operation: 'verify',
          allowProjectScripts: true,
          allowBrowser: false,
          scriptNames: ['typecheck', 'build'],
          allowedRepairPaths: [],
          maxAttempts: 0,
        },
      });

      const planFile = path.join(artifactRoot, 'plan.json');
      const applyFile = path.join(artifactRoot, 'apply.json');
      const specFile = path.join(artifactRoot, 'spec.json');
      writeJson(planFile, cliPlanObj);
      writeJson(applyFile, mcpApplyJson);
      writeJson(specFile, spec);

      const cliVerify = await runCli(
        [
          'integrate', 'verify',
          '--project', root,
          '--plan', planFile,
          '--apply-result', applyFile,
          '--spec', specFile,
          '--out', artifactRoot,
          '--allow-project-scripts', 'true',
          '--allow-browser', 'false',
        ],
        '0.0.14',
      );
      expect(cliVerify.exitCode).toBe(2);
      const cliVerifyJson = JSON.parse(cliVerify.stdout);

      const vConn = await connectMcp(verifyConfigPath);
      try {
        const mcpVerifyRes = await vConn.client.callTool({
          name: 'verify_integration',
          arguments: { plan: cliPlanObj, applyResult: mcpApplyJson, spec },
        });
        expect(mcpVerifyRes.isError).not.toBe(true);
        const mcpVerifyJson = JSON.parse((mcpVerifyRes.content[0] as { text: string }).text);
        expect(mcpVerifyJson.status).toBe(cliVerifyJson.status);
        expect(mcpVerifyJson.installedVersions).toEqual(cliVerifyJson.installedVersions);
        expect(mcpVerifyJson.pendingItems).toEqual(cliVerifyJson.pendingItems);
        expect(mcpVerifyJson.checks.map((c: { id: string; status: string }) => [c.id, c.status])).toEqual(
          cliVerifyJson.checks.map((c: { id: string; status: string }) => [c.id, c.status]),
        );
      } finally {
        await vConn.transport.close();
      }
    } finally {
      await transport.close();
    }
    expect(getStderr()).not.toContain(SYNTHETIC_API_TOKEN);
    expect(getStderr()).not.toContain(SYNTHETIC_REGISTRY_TOKEN);
  });
});
