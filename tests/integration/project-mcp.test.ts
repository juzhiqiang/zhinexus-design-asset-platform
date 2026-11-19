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
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { canonicalJson } from '../../packages/component-cli/src/contracts/schema.js';
import { canonicalProjectRoot } from '../../packages/component-cli/src/integration/apply.js';
import { createRunArtifactSession } from '../../packages/component-cli/src/integration/report.js';
import { parseMcpHostConfig } from '../../packages/component-cli/src/mcp/server.js';
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

function buildMcpMatchPlan() {
  return {
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
    elements: [{
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
    }],
    exactDependencies: VUE_DEPS.map(d => ({ ...d })),
    gaps: [],
  };
}

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

  function createSampleProject(options?: { typecheckScript?: string }) {
    const root = makeTempDir('zhinexus-t17-mcp-proj-');
    const artifactRoot = makeTempDir('zhinexus-t17-mcp-art-');
    writeJson(path.join(root, 'package.json'), {
      name: 'synthetic-mcp-app',
      version: '1.0.0',
      private: true,
      scripts: {
        typecheck: options?.typecheckScript ?? 'node -e "process.exit(0)"',
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

  it('拒绝 artifactRoot/runs junction，避免验证证据写入外部目标', () => {
    const artifactRoot = makeTempDir('zhinexus-t17-mcp-runs-root-');
    const outside = makeTempDir('zhinexus-t17-mcp-runs-outside-');
    const outsideBefore = fs.readdirSync(outside);
    fs.symlinkSync(outside, path.join(artifactRoot, 'runs'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => createRunArtifactSession(artifactRoot)).toThrow(/PATH_UNSAFE/);
    expect(fs.readdirSync(outside)).toEqual(outsideBefore);
  });

  it('MCP 宿主将缺失 artifactRoot 固定到已解析的物理父目录', () => {
    const root = makeTempDir('zhinexus-t17-mcp-bound-project-');
    const outsideA = makeTempDir('zhinexus-t17-mcp-bound-a-');
    const outsideB = makeTempDir('zhinexus-t17-mcp-bound-b-');
    const aliasParent = path.join(makeTempDir('zhinexus-t17-mcp-bound-alias-'), 'artifacts');
    fs.symlinkSync(outsideA, aliasParent, process.platform === 'win32' ? 'junction' : 'dir');
    const configPath = path.join(makeTempDir('zhinexus-t17-mcp-bound-config-'), 'host.json');
    const configuredArtifactRoot = path.join(aliasParent, 'new-artifacts');
    writeJson(configPath, { schemaVersion: 1, projectRoot: canonicalProjectRoot(root), artifactRoot: configuredArtifactRoot });

    const parsed = parseMcpHostConfig(configPath);
    expect(parsed.artifactRoot).toBe(path.join(outsideA, 'new-artifacts').replaceAll('\\', '/'));
    fs.unlinkSync(aliasParent);
    fs.symlinkSync(outsideB, aliasParent, process.platform === 'win32' ? 'junction' : 'dir');
    const session = createRunArtifactSession(parsed.artifactRoot);
    expect(path.dirname(session.runDirAbs)).toBe(path.join(outsideA, 'new-artifacts', 'runs'));
    expect(fs.existsSync(path.join(outsideB, 'new-artifacts'))).toBe(false);
  });

  it('MCP 宿主拒绝相对 projectRoot', () => {
    const artifactRoot = makeTempDir('zhinexus-t17-mcp-relative-artifact-');
    const relativeConfigPath = path.join(makeTempDir('zhinexus-t17-mcp-relative-config-'), 'host.json');
    writeJson(relativeConfigPath, { schemaVersion: 1, projectRoot: '.', artifactRoot });
    expect(() => parseMcpHostConfig(relativeConfigPath)).toThrow(/projectRoot.*绝对路径/);
  });

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
      allowedApiOrigins: [network.apiOrigin],
      allowedRegistryOrigins: [network.registryOrigin],
    });

    const unboundConfigPath = path.join(artifactRoot, 'mcp-host-unbound-config.json');
    writeJson(unboundConfigPath, {
      schemaVersion: 1,
      projectRoot: canonicalRoot,
      artifactRoot: canonicalProjectRoot(artifactRoot),
    });
    const unboundConnection = await connectMcp(unboundConfigPath, {
      ZHINEXUS_API_TOKEN: 'MCP_UNBOUND_API_TOKEN_SENTINEL',
      ZHINEXUS_REGISTRY_TOKEN: 'MCP_UNBOUND_REGISTRY_TOKEN_SENTINEL',
    });
    try {
      const requestCount = network.requests.length;
      const unboundPlan = await unboundConnection.client.callTool({
        name: 'plan_integration',
        arguments: { matchPlan: buildMcpMatchPlan(), apiUrl: network.apiOrigin, registryUrl: network.registryOrigin },
      });
      expect(unboundPlan.isError).toBe(true);
      expect((unboundPlan.content[0] as { text: string }).text).toContain('ENDPOINT_NOT_ALLOWED');
      expect(network.requests).toHaveLength(requestCount);
    } finally {
      await unboundConnection.transport.close();
    }

    const { client, transport, getStderr } = await connectMcp(configPath, {
      ZHINEXUS_API_TOKEN: 'MCP_UNTRUSTED_API_TOKEN_SENTINEL',
      ZHINEXUS_REGISTRY_TOKEN: 'MCP_UNTRUSTED_REGISTRY_TOKEN_SENTINEL',
    });
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

      let untrustedHits = 0;
      const untrustedServer = http.createServer((_req, res) => {
        untrustedHits += 1;
        res.writeHead(404).end();
      });
      await new Promise<void>(resolve => untrustedServer.listen(0, '127.0.0.1', resolve));
      const address = untrustedServer.address();
      const untrustedOrigin = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0);
      try {
        const untrustedPlan = await client.callTool({
          name: 'plan_integration',
          arguments: { matchPlan: buildMcpMatchPlan(), apiUrl: network.apiOrigin, registryUrl: untrustedOrigin },
        });
        expect(untrustedPlan.isError).toBe(true);
        expect((untrustedPlan.content[0] as { text: string }).text).toContain('ENDPOINT_NOT_ALLOWED');
        expect(untrustedHits).toBe(0);
      } finally {
        await new Promise<void>(resolve => untrustedServer.close(() => resolve()));
      }

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
      allowedApiOrigins: [network.apiOrigin],
      allowedRegistryOrigins: [network.registryOrigin],
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
      let untrustedHits = 0;
      let receivedAuthorization: string | undefined;
      const untrustedServer = http.createServer((req, res) => {
        untrustedHits += 1;
        receivedAuthorization = req.headers.authorization;
        res.writeHead(404).end();
      });
      await new Promise<void>(resolve => untrustedServer.listen(0, '127.0.0.1', resolve));
      const address = untrustedServer.address();
      const untrustedOrigin = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0);
      try {
        const beforeApply = fs.readFileSync(path.join(root, 'package.json'));
        const untrustedApply = await client.callTool({
          name: 'apply_integration',
          arguments: { plan: cliPlanObj, apiUrl: untrustedOrigin, registryUrl: network.registryOrigin },
        });
        expect(untrustedApply.isError).toBe(true);
        expect((untrustedApply.content[0] as { text: string }).text).toContain('ENDPOINT_NOT_ALLOWED');
        expect(untrustedHits).toBe(0);
        expect(receivedAuthorization).toBeUndefined();
        expect(fs.readFileSync(path.join(root, 'package.json'))).toEqual(beforeApply);
      } finally {
        await new Promise<void>(resolve => untrustedServer.close(() => resolve()));
      }

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

  it('stdio 客户端取消 verify 后会终止脚本进程树', async () => {
    const slowScript = "node -e \"const fs=require('node:fs');const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{stdio:'ignore'});fs.writeFileSync('cancel-grandchild.pid',String(child.pid));setTimeout(()=>fs.writeFileSync('cancel-sentinel.txt','late'),2200);\"";
    const { root, canonicalRoot, artifactRoot } = createSampleProject({ typecheckScript: slowScript });
    const matchPlan = buildMcpMatchPlan();
    const matchFile = path.join(artifactRoot, 'cancel-match.json');
    writeJson(matchFile, matchPlan);
    const previousApi = process.env.ZHINEXUS_API_TOKEN;
    const previousRegistry = process.env.ZHINEXUS_REGISTRY_TOKEN;
    process.env.ZHINEXUS_API_TOKEN = SYNTHETIC_API_TOKEN;
    process.env.ZHINEXUS_REGISTRY_TOKEN = SYNTHETIC_REGISTRY_TOKEN;
    let plan: { allowedPaths: string[]; [key: string]: unknown };
    try {
      const planned = await runCli([
        'integrate', 'plan', '--project', root, '--match', matchFile,
        '--api-url', network.apiOrigin, '--registry', network.registryOrigin,
      ], '0.0.14');
      expect(planned.exitCode).toBe(0);
      plan = JSON.parse(planned.stdout) as typeof plan;
    } finally {
      if (previousApi === undefined) delete process.env.ZHINEXUS_API_TOKEN;
      else process.env.ZHINEXUS_API_TOKEN = previousApi;
      if (previousRegistry === undefined) delete process.env.ZHINEXUS_REGISTRY_TOKEN;
      else process.env.ZHINEXUS_REGISTRY_TOKEN = previousRegistry;
    }

    const applyConfigPath = path.join(artifactRoot, 'cancel-apply-config.json');
    writeJson(applyConfigPath, {
      schemaVersion: 1, projectRoot: canonicalRoot, artifactRoot: canonicalProjectRoot(artifactRoot),
      allowedApiOrigins: [network.apiOrigin], allowedRegistryOrigins: [network.registryOrigin],
      applyGrant: {
        schemaVersion: 1, operation: 'apply', projectRoot: canonicalRoot,
        planDigest: canonicalDigest(plan), allowedPaths: plan.allowedPaths, allowInstall: false,
      },
    });
    const applyConnection = await connectMcp(applyConfigPath, {
      ZHINEXUS_API_TOKEN: SYNTHETIC_API_TOKEN, ZHINEXUS_REGISTRY_TOKEN: SYNTHETIC_REGISTRY_TOKEN,
    });
    let applyResult: Record<string, unknown>;
    try {
      const applied = await applyConnection.client.callTool({ name: 'apply_integration', arguments: {
        plan, apiUrl: network.apiOrigin, registryUrl: network.registryOrigin,
      } });
      expect(applied.isError).not.toBe(true);
      applyResult = JSON.parse((applied.content[0] as { text: string }).text) as Record<string, unknown>;
      expect(applyResult.status).toBe('applied');
    } finally {
      await applyConnection.transport.close();
    }

    const applyResultDigest = canonicalDigest(applyResult);
    const packageHash = sha256Hex(fs.readFileSync(path.join(root, 'package.json')));
    const spec = {
      schemaVersion: 1 as const, projectRoot: canonicalRoot, planDigest: canonicalDigest(plan), applyResultDigest,
      commands: [
        { kind: 'type' as const, script: 'typecheck', manifestPath: 'package.json', manifestSha256: packageHash, timeoutMs: 15_000, outputDirectories: [] },
        { kind: 'build' as const, script: 'build', manifestPath: 'package.json', manifestSha256: packageHash, timeoutMs: 15_000, outputDirectories: ['dist'] },
      ],
      businessGaps: [],
    };
    const verifyConfigPath = path.join(artifactRoot, 'cancel-verify-config.json');
    writeJson(verifyConfigPath, {
      schemaVersion: 1, projectRoot: canonicalRoot, artifactRoot: canonicalProjectRoot(artifactRoot),
      verificationGrant: {
        schemaVersion: 1, operation: 'verify', projectRoot: canonicalRoot,
        planDigest: canonicalDigest(plan), applyResultDigest, specDigest: canonicalDigest(spec),
        allowProjectScripts: true, allowBrowser: false, scriptNames: ['typecheck', 'build'],
        allowedRepairPaths: [], maxAttempts: 0,
      },
    });
    const verificationConnection = await connectMcp(verifyConfigPath);
    const controller = new AbortController();
    try {
      const request = verificationConnection.client.callTool({
        name: 'verify_integration', arguments: { plan, applyResult, spec },
      }, { signal: controller.signal });
      const pidPath = path.join(root, 'cancel-grandchild.pid');
      const startedAt = Date.now();
      while (!fs.existsSync(pidPath) && Date.now() - startedAt < 10_000) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(fs.existsSync(pidPath)).toBe(true);
      const childPid = Number(fs.readFileSync(pidPath, 'utf8'));
      controller.abort();
      await expect(request).rejects.toThrow();
      const processAlive = () => {
        try { process.kill(childPid, 0); return true; }
        catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
      };
      const stoppedAt = Date.now();
      while (processAlive() && Date.now() - stoppedAt < 10_000) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(processAlive()).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 2300));
      expect(fs.existsSync(path.join(root, 'cancel-sentinel.txt'))).toBe(false);
    } finally {
      controller.abort();
      await verificationConnection.transport.close();
    }
  }, 45_000); // 包含握手、原有两段 10s 条件等待和 2.3s 哨兵观察；内部期限不变。
});
