/**
 * T17 A1 产品失败测试：verifyIntegration（本地验证与证据报告）。
 *
 * 覆盖：
 * - 真实 apply 后进入验证，错误 root/摘要/manifest/授权/apply 状态均结构化拒绝；
 * - T15 预览与 apply 前 hash 不构成执行证据；
 * - 无安装 apply (installedVersions=[]) 可读，但真实 node_modules 缺失或版本不匹配时 dependency-guard 失败；
 * - 授权 npm/pnpm 原生脚本实际运行，pre/post poison sentinel 绝不触发；
 * - 合法 dist 输出允许，src/通配/别名/外链目录拒绝；源快照捕获新增、修改、删除；
 * - 超时结构化失败，敏感环境变量与原始错误文本不进入报告或日志；
 * - artifactRoot 必须在工程外，写入独占子目录，缺失业务信息归类为 missing-business-info。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { canonicalJson } from '../../packages/component-cli/src/contracts/schema.js';
import { validateIntegrationVerificationReport } from '../../packages/component-cli/src/contracts/integration-verification.js';
import type {
  IntegrationExecutionAuthorizationV1,
  IntegrationVerificationReportV1,
  IntegrationVerificationSpecV1,
} from '../../packages/component-cli/src/contracts/integration-verification.js';
import type { IntegrationPlanV1 } from '../../packages/component-cli/src/contracts/integration-plan.js';
import type {
  IntegrationApplyAuthorizationV1,
  IntegrationApplyResultV1,
} from '../../packages/component-cli/src/contracts/integration-apply.js';
import type { MatchPlanV1 } from '../../packages/component-cli/src/contracts/match-plan.js';
import { planIntegration } from '../../packages/component-cli/src/integration/plan.js';
import { applyIntegration, canonicalProjectRoot } from '../../packages/component-cli/src/integration/apply.js';
import { collectSourceSnapshots } from '../../packages/component-cli/src/integration/verify.js';
import { startSyntheticNetwork, SYNTHETIC_API_TOKEN, SYNTHETIC_REGISTRY_TOKEN, type SyntheticNetwork } from './t16-support/loopback-services.js';
import { ECHARTS_VERSION, linkDirectory, PACKAGE_VERSION, tarballSha256, VUE_FRAMEWORK_VERSION, VUE_PACKAGE_NAME } from './t16-support/synthetic-projects.js';
import { callVerify, loadT17CliExports, type T17CliExports } from './t17-support/verify-namespace.js';

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

function buildVueMatchPlan(pm: 'npm' | 'pnpm' = 'npm'): MatchPlanV1 {
  const target = vueTarget() as MatchPlanV1['elements'][number]['target'];
  return {
    schemaVersion: 1,
    source: 'design-id',
    inputDigest: 'a'.repeat(64),
    ruleSetId: 'library',
    revision: 'draft-1',
    context: {
      framework: 'vue',
      frameworkVersion: VUE_FRAMEWORK_VERSION,
      echartsVersion: ECHARTS_VERSION,
      packageManager: pm,
      requirements: [],
    },
    elements: [
      {
        instanceId: 'node-1',
        designId: '设计/Line',
        status: 'mapped',
        target,
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
}

function buildVuePackageLock(): Record<string, unknown> {
  return {
    name: 'synthetic-vue-verify-app',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'synthetic-vue-verify-app',
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
  };
}

function buildPnpmLock(): string {
  return [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '  .:',
    '    dependencies:',
    `      '${VUE_PACKAGE_NAME}':`,
    `        specifier: ${PACKAGE_VERSION}`,
    `        version: ${PACKAGE_VERSION}`,
    '      vue:',
    `        specifier: ${VUE_FRAMEWORK_VERSION}`,
    `        version: ${VUE_FRAMEWORK_VERSION}`,
    '      echarts:',
    `        specifier: ${ECHARTS_VERSION}`,
    `        version: ${ECHARTS_VERSION}`,
    '',
    'packages:',
    `  '${VUE_PACKAGE_NAME}@${PACKAGE_VERSION}':`,
    '    resolution: {integrity: sha512-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC==}',
    `  vue@${VUE_FRAMEWORK_VERSION}:`,
    '    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}',
    `  echarts@${ECHARTS_VERSION}:`,
    '    resolution: {integrity: sha512-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB==}',
    '',
  ].join('\n');
}

function populateInstalledNodeModules(projectDir: string, deps: { name: string; version: string }[]): void {
  for (const dep of deps) {
    const pkgJsonPath = path.join(projectDir, 'node_modules', ...dep.name.split('/'), 'package.json');
    writeJson(pkgJsonPath, { name: dep.name, version: dep.version });
  }
}

describe('T17 A1 verifyIntegration（本地验证与证据报告）', () => {
  let cliExports: T17CliExports;
  let network: SyntheticNetwork;
  const tempRoots: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempRoots.push(dir);
    return dir;
  }

  beforeAll(async () => {
    cliExports = await loadT17CliExports();
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
        // Windows 临时目录释放句柄偶发延迟
      }
    }
  });

  async function setupAppliedProject(options?: {
    packageManager?: 'npm' | 'pnpm';
    scripts?: Record<string, string>;
    installNodeModules?: boolean;
    extraSrcFiles?: Record<string, string>;
  }): Promise<{
    root: string;
    canonicalRoot: string;
    artifactRoot: string;
    plan: IntegrationPlanV1;
    applyResult: IntegrationApplyResultV1;
  }> {
    const pm = options?.packageManager ?? 'npm';
    const root = makeTempDir('zhinexus-t17-verify-proj-');
    const backupRoot = makeTempDir('zhinexus-t17-verify-backup-');
    const artifactRoot = makeTempDir('zhinexus-t17-verify-artifacts-');

    const pkgJson: Record<string, unknown> = {
      name: 'synthetic-vue-verify-app',
      version: '1.0.0',
      private: true,
      scripts: options?.scripts ?? {
        typecheck: 'node -e "process.exit(0)"',
        build: 'node -e "const fs=require(\'fs\');fs.mkdirSync(\'dist\',{recursive:true});fs.writeFileSync(\'dist/bundle.js\',\'// ok\')"',
        pretypecheck: 'node -e "require(\'fs\').writeFileSync(\'pre-sentinel.txt\',\'poison\')"',
        posttypecheck: 'node -e "require(\'fs\').writeFileSync(\'post-sentinel.txt\',\'poison\')"',
        prebuild: 'node -e "require(\'fs\').writeFileSync(\'prebuild-sentinel.txt\',\'poison\')"',
        postbuild: 'node -e "require(\'fs\').writeFileSync(\'postbuild-sentinel.txt\',\'poison\')"',
      },
      dependencies: {
        [VUE_PACKAGE_NAME]: PACKAGE_VERSION,
        vue: VUE_FRAMEWORK_VERSION,
        echarts: ECHARTS_VERSION,
      },
    };
    writeJson(path.join(root, 'package.json'), pkgJson);
    if (pm === 'npm') {
      writeJson(path.join(root, 'package-lock.json'), buildVuePackageLock());
    } else {
      fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), buildPnpmLock(), 'utf8');
    }
    if (options?.extraSrcFiles) {
      for (const [rel, content] of Object.entries(options.extraSrcFiles)) {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
      }
    }

    const matchPlan = buildVueMatchPlan(pm);

    const plan = await planIntegration(root, matchPlan, {
      apiUrl: network.apiOrigin,
      registryUrl: network.registryOrigin,
      apiToken: SYNTHETIC_API_TOKEN,
      registryToken: SYNTHETIC_REGISTRY_TOKEN,
    });
    expect(plan.status).toBe('planned');

    const canonicalRoot = canonicalProjectRoot(root);
    const planDigest = canonicalDigest(plan);
    const auth: IntegrationApplyAuthorizationV1 = {
      schemaVersion: 1,
      operation: 'apply',
      projectRoot: canonicalRoot,
      planDigest,
      allowedPaths: plan.allowedPaths,
      allowInstall: false,
    };

    const applyResult = await applyIntegration(root, plan, {
      authorization: auth,
      apiUrl: network.apiOrigin,
      registryUrl: network.registryOrigin,
      apiToken: SYNTHETIC_API_TOKEN,
      registryToken: SYNTHETIC_REGISTRY_TOKEN,
      backupRoot,
    });
    expect(applyResult.status).toBe('applied');
    expect(applyResult.installedVersions).toEqual([]);

    if (options?.installNodeModules !== false) {
      populateInstalledNodeModules(root, plan.exactDependencies);
    }

    return { root, canonicalRoot, artifactRoot, plan, applyResult };
  }

  function makeSpecAndAuth(
    canonicalRoot: string,
    plan: IntegrationPlanV1,
    applyResult: IntegrationApplyResultV1,
    overrides?: {
      commands?: IntegrationVerificationSpecV1['commands'];
      browser?: IntegrationVerificationSpecV1['browser'];
      businessGaps?: IntegrationVerificationSpecV1['businessGaps'];
      authOverrides?: Partial<IntegrationExecutionAuthorizationV1>;
    },
  ): {
    spec: IntegrationVerificationSpecV1;
    authorization: IntegrationExecutionAuthorizationV1;
  } {
    const manifestPath = plan.localProject.workspace === '.' ? 'package.json' : `${plan.localProject.workspace}/package.json`;
    const manifestHash =
      applyResult.afterHashes.find(h => h.path === manifestPath)?.sha256 ??
      plan.baseFileHashes.find(h => h.path === manifestPath)?.sha256 ??
      sha256Hex(fs.readFileSync(path.join(canonicalRoot, manifestPath)));
    const planDigest = canonicalDigest(plan);
    const applyResultDigest = canonicalDigest(applyResult);

    const spec: IntegrationVerificationSpecV1 = {
      schemaVersion: 1,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      commands: overrides?.commands ?? [
        { kind: 'type', script: 'typecheck', manifestPath, manifestSha256: manifestHash, timeoutMs: 30_000, outputDirectories: [] },
        { kind: 'build', script: 'build', manifestPath, manifestSha256: manifestHash, timeoutMs: 30_000, outputDirectories: ['dist'] },
      ],
      businessGaps: overrides?.businessGaps ?? [],
      ...(overrides?.browser ? { browser: overrides.browser } : {}),
    };
    const specDigest = canonicalDigest(spec);
    const authorization: IntegrationExecutionAuthorizationV1 = {
      schemaVersion: 1,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      operation: 'verify',
      allowProjectScripts: true,
      allowBrowser: Boolean(overrides?.browser),
      scriptNames: [...new Set(spec.commands.map(c => c.script))],
      allowedRepairPaths: [],
      maxAttempts: 0,
      ...overrides?.authOverrides,
    };
    return { spec, authorization };
  }

  it('拒绝错误 root、篡改的 plan/apply/spec 摘要、未 applied 结果与缺失/越权授权', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject();
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);

    // 1. 错误 root
    const wrongRoot = makeTempDir('zhinexus-t17-wrong-root-');
    const rWrongRoot = await callVerify(cliExports, wrongRoot, plan, { applyResult, spec, authorization, artifactRoot });
    expect(rWrongRoot).toBeDefined();
    expect(rWrongRoot!.status).toBe('blocked');
    expect(rWrongRoot!.pendingItems.some(i => i.code === 'IDENTITY_MISMATCH' || i.code === 'INVALID_INPUT')).toBe(true);

    // 2. 篡改 specDigest 授权不匹配
    const rBadSpecAuth = await callVerify(cliExports, root, plan, {
      applyResult,
      spec,
      authorization: { ...authorization, specDigest: 'f'.repeat(64) },
      artifactRoot,
    });
    expect(rBadSpecAuth).toBeDefined();
    expect(rBadSpecAuth!.status).toBe('blocked');
    expect(rBadSpecAuth!.pendingItems.some(i => i.code === 'AUTHORIZATION_MISMATCH' || i.code === 'IDENTITY_MISMATCH')).toBe(true);

    // 3. applyResult 非 applied 状态拒绝执行
    const rNotApplied = await callVerify(cliExports, root, plan, {
      applyResult: { ...applyResult, status: 'blocked' },
      spec,
      authorization,
      artifactRoot,
    });
    expect(rNotApplied).toBeDefined();
    expect(rNotApplied!.status).toBe('blocked');

    // 4. operation='repair' 传给 verify 拒绝
    const rWrongOp = await callVerify(cliExports, root, plan, {
      applyResult,
      spec,
      authorization: { ...authorization, operation: 'repair', allowedRepairPaths: [], maxAttempts: 1 },
      artifactRoot,
    });
    expect(rWrongOp).toBeDefined();
    expect(rWrongOp!.status).toBe('blocked');
  });

  it('未通过执行授权时不创建 artifactRoot 或 runs 证据目录', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject();
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);
    expect(fs.readdirSync(artifactRoot)).toHaveLength(0);

    const report = await callVerify(cliExports, root, plan, {
      applyResult,
      spec,
      authorization: { ...authorization, specDigest: 'f'.repeat(64) },
      artifactRoot,
    });

    expect(report).toBeDefined();
    expect(report!.status).toBe('blocked');
    expect(report!.pendingItems.some(issue => issue.code === 'AUTHORIZATION_MISMATCH')).toBe(true);
    expect(fs.readdirSync(artifactRoot)).toHaveLength(0);
  });

  it('拒绝被 junction 重定向的 runs 证据目录', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject();
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);
    const redirectedRoot = makeTempDir('zhinexus-t17-redirected-runs-');
    fs.symlinkSync(redirectedRoot, path.join(artifactRoot, 'runs'), 'junction');

    const report = await callVerify(cliExports, root, plan, {
      applyResult, spec, authorization, artifactRoot,
    });

    expect(report).toBeDefined();
    expect(report!.status).toBe('blocked');
    expect(report!.pendingItems.some(issue => issue.code === 'PATH_UNSAFE')).toBe(true);
    expect(fs.readdirSync(redirectedRoot), '不能把验证报告写入 junction 目标目录').toEqual([]);
  });

  it('源快照对项目内硬链接失败关闭', () => {
    const root = makeTempDir('zhinexus-t17-hardlink-snapshot-');
    const outsideRoot = makeTempDir('zhinexus-t17-hardlink-snapshot-outside-');
    const outsideSentinel = path.join(outsideRoot, 'sentinel.txt');
    const projectAlias = path.join(root, 'linked-sentinel.txt');
    fs.writeFileSync(outsideSentinel, 'external sentinel stays unchanged\n');
    fs.linkSync(outsideSentinel, projectAlias);

    const result = collectSourceSnapshots(root, new Set());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('PATH_UNSAFE');
    expect(fs.readFileSync(outsideSentinel, 'utf8')).toBe('external sentinel stays unchanged\n');
  });

  it('接受无安装 apply(installedVersions=[]) 并在真实 node_modules 缺失或版本不匹配时令 dependency-guard 失败', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject({
      installNodeModules: false,
    });
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);

    // 缺失 node_modules：脚本运行成功，但 dependency-guard 必须失败
    const reportMissing = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
    expect(reportMissing).toBeDefined();
    expect(reportMissing!.status).toBe('failed');
    expect(reportMissing!.installedVersions).toEqual([]);
    const guardCheck = reportMissing!.checks.find(c => c.id === 'dependency-guard');
    expect(guardCheck).toBeDefined();
    expect(guardCheck!.category).toBe('behavior');
    expect(guardCheck!.status).toBe('failed');
    expect(guardCheck!.issues.some(i => i.code === 'DEPENDENCY_MISMATCH')).toBe(true);

    // 版本不匹配：安装错误版本 echarts
    populateInstalledNodeModules(root, plan.exactDependencies);
    writeJson(path.join(root, 'node_modules', 'echarts', 'package.json'), { name: 'echarts', version: '5.5.0' });
    const reportMismatch = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
    expect(reportMismatch).toBeDefined();
    expect(reportMismatch!.status).toBe('failed');
    expect(reportMismatch!.checks.find(c => c.id === 'dependency-guard')?.status).toBe('failed');
  });

  it('拒绝错误包名、node_modules 链接逃逸和与计划不符的锁文件', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject();
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);
    const packageManifest = path.join(root, 'node_modules', 'echarts', 'package.json');

    writeJson(packageManifest, { name: 'other-package', version: ECHARTS_VERSION });
    const wrongName = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
    expect(wrongName?.checks.find(c => c.id === 'dependency-guard')?.status).toBe('failed');

    writeJson(packageManifest, { name: 'echarts', version: ECHARTS_VERSION });
    const outside = makeTempDir('zhinexus-t17-dep-outside-');
    writeJson(path.join(outside, 'package.json'), { name: 'echarts', version: ECHARTS_VERSION });
    fs.rmSync(path.join(root, 'node_modules', 'echarts'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, 'node_modules', 'echarts'), 'junction');
    const linked = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
    expect(linked?.checks.find(c => c.id === 'dependency-guard')?.status).toBe('failed');

    fs.rmSync(path.join(root, 'node_modules', 'echarts'), { recursive: true, force: true });
    writeJson(path.join(root, 'node_modules', 'echarts', 'package.json'), { name: 'echarts', version: ECHARTS_VERSION });
    const lock = buildVuePackageLock();
    const lockPackages = lock.packages as Record<string, { version?: string }>;
    lockPackages['node_modules/echarts'] = { version: '5.5.0' };
    const lockPath = path.join(root, 'package-lock.json');
    writeJson(lockPath, lock);
    const lockSha = sha256Hex(fs.readFileSync(lockPath));
    const lockBaselinePlan = structuredClone(plan);
    const baseLockSnapshot = lockBaselinePlan.baseFileHashes.find(snapshot => snapshot.path === 'package-lock.json')!;
    baseLockSnapshot.sha256 = lockSha;
    const inspectionLockSnapshot = lockBaselinePlan.localProject.fileSnapshots.find(snapshot => snapshot.path === 'package-lock.json')!;
    inspectionLockSnapshot.sha256 = lockSha;
    const trustedLockDriftApplyResult: IntegrationApplyResultV1 = {
      ...applyResult,
      planDigest: canonicalDigest(lockBaselinePlan),
    };
    const { spec: lockSpec, authorization: lockAuthorization } = makeSpecAndAuth(canonicalRoot, lockBaselinePlan, trustedLockDriftApplyResult);
    const driftedLock = await callVerify(cliExports, root, lockBaselinePlan, {
      applyResult: trustedLockDriftApplyResult,
      spec: lockSpec,
      authorization: lockAuthorization,
      artifactRoot,
    });
    expect(driftedLock?.status).toBe('failed');
    expect(driftedLock?.checks.find(c => c.id === 'dependency-guard')?.status).toBe('failed');
    expect(driftedLock?.checks.find(c => c.id === 'dependency-guard')?.issues.some(i => i.code === 'DEPENDENCY_MISMATCH')).toBe(true);
  });

  it('快照重读失败时记录源守卫失败，不以初始快照冒充结束快照', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject({
      scripts: {
        typecheck: 'node -e "process.exit(0)"',
        build: 'node -e "const fs=require(\'fs\');fs.mkdirSync(\'dist\',{recursive:true});fs.symlinkSync(\'dist\',\'blocked-link\',\'junction\')"',
      },
    });
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);
    const report = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
    expect(report?.status).not.toBe('passed');
    expect(report?.checks.find(c => c.id === 'source-guard')?.status).toBe('failed');
    expect(report?.pendingItems.some(i => i.code === 'PATH_UNSAFE')).toBe(true);
  });

  it('允许 pnpm node_modules 内部链接并拒绝链接逃逸项目 node_modules', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject({ packageManager: 'pnpm' });
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);
    const nodeModules = path.join(root, 'node_modules');
    const echartsDir = path.join(nodeModules, 'echarts');
    const storeDir = path.join(nodeModules, '.pnpm', 'echarts@' + ECHARTS_VERSION, 'node_modules', 'echarts');
    fs.rmSync(echartsDir, { recursive: true, force: true });
    writeJson(path.join(storeDir, 'package.json'), { name: 'echarts', version: ECHARTS_VERSION });
    fs.symlinkSync(storeDir, echartsDir, 'junction');
    const internal = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
    expect(internal?.checks.find(c => c.id === 'dependency-guard')?.status).toBe('passed');

    const outside = makeTempDir('zhinexus-t17-pnpm-outside-');
    writeJson(path.join(outside, 'package.json'), { name: 'echarts', version: ECHARTS_VERSION });
    fs.rmSync(echartsDir, { recursive: true, force: true });
    fs.symlinkSync(outside, echartsDir, 'junction');
    const escaped = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
    expect(escaped?.checks.find(c => c.id === 'dependency-guard')?.status).toBe('failed');
  });

  it('浏览器拒绝 data/blob 与外源 WebSocket，保留同源 WebSocket 且诊断移除 URL 查询令牌', async () => {
    const server = http.createServer((_request, response) => {
      const port = (server.address() as import('node:net').AddressInfo).port;
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body><main>ready</main><script>' +
        "fetch('data:text/plain,secret').catch(()=>{});" +
        "fetch(URL.createObjectURL(new Blob(['secret']))).catch(()=>{});" +
        "new WebSocket('ws://127.0.0.1:" + port + "/same');" +
        "try { new WebSocket('ws://example.invalid/private?token=URL_SECRET_7429'); } catch {}" +
        "setTimeout(()=>{throw new Error('runtime https://example.invalid/error?token=URL_SECRET_7429')},200);" +
        '</script></body></html>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as import('node:net').AddressInfo;
    const url = 'http://127.0.0.1:' + addr.port + '/';
    try {
      const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject();
      const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult, {
        browser: {
          url,
          readySelector: 'main',
          timeoutMs: 10_000,
          viewport: { width: 640, height: 480 },
          renderer: 'canvas',
          theme: 'light',
          actions: [],
          assertions: [{ kind: 'visible', selector: 'main' }],
        },
      });
      const report = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
      expect(report?.checks.find(c => c.id === 'browser')?.status).toBe('failed');
      const behavior = report!.artifacts.find(a => a.path.endsWith('behavior.json'))!;
      const evidence = fs.readFileSync(path.join(artifactRoot, behavior.path), 'utf8');
      expect(evidence).not.toContain('URL_SECRET_7429');
      expect(evidence).not.toContain('example.invalid');
      expect(evidence).not.toContain('data:text');
      expect(evidence).not.toContain('blob:');
      expect(evidence.match(/outbound_blocked/g)?.length).toBeGreaterThanOrEqual(2);
      expect(evidence.match(/websocket_blocked/g)?.length).toBe(1);
      expect(JSON.stringify(report)).not.toContain('URL_SECRET_7429');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('运行 npm 与 pnpm 授权脚本且不触发 pre/post poison sentinel，合法 dist 不报源变更', async () => {
    for (const pm of ['npm', 'pnpm'] as const) {
      const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject({
        packageManager: pm,
      });
      const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);

      const report = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
      expect(report).toBeDefined();
      expect(validateIntegrationVerificationReport(report!).ok).toBe(true);
      expect(report!.checks.find(c => c.category === 'type')?.status).toBe('passed');
      expect(report!.checks.find(c => c.category === 'build')?.status).toBe('passed');
      expect(report!.checks.find(c => c.id === 'dependency-guard')?.status).toBe('passed');
      expect(report!.installedVersions.length).toBe(plan.exactDependencies.length);
      expect(report!.changedFiles).toEqual([]);

      // 确认 dist/bundle.js 真实产出，且所有 poison sentinel 均未生成
      expect(fs.existsSync(path.join(root, 'dist', 'bundle.js'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'pre-sentinel.txt'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'post-sentinel.txt'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'prebuild-sentinel.txt'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'postbuild-sentinel.txt'))).toBe(false);
    }
  });

  it('拒绝 src/通配/工程内 artifactRoot，且源快照捕获新增、修改与删除', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject({
      extraSrcFiles: {
        'src/keep.ts': 'export const a = 1;\n',
        'src/to-delete.ts': 'export const b = 2;\n',
      },
    });
    const manifestHash = sha256Hex(fs.readFileSync(path.join(root, 'package.json')));

    // 1. artifactRoot 在工程内必须被拒绝
    const insideArtifactRoot = path.join(root, '.verify-out');
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);
    const rInside = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot: insideArtifactRoot });
    expect(rInside).toBeDefined();
    expect(rInside!.status).toBe('blocked');
    expect(rInside!.pendingItems.some(i => i.code === 'PATH_UNSAFE')).toBe(true);

    // 2. outputDirectories 指定 src 必须被拒绝
    const { spec: badOutSpec, authorization: badOutAuth } = makeSpecAndAuth(canonicalRoot, plan, applyResult, {
      commands: [
        { kind: 'build', script: 'build', manifestPath: 'package.json', manifestSha256: manifestHash, timeoutMs: 30_000, outputDirectories: ['src'] },
      ],
    });
    const rBadOut = await callVerify(cliExports, root, plan, { applyResult, spec: badOutSpec, authorization: badOutAuth, artifactRoot });
    expect(rBadOut).toBeDefined();
    expect(rBadOut!.status).toBe('blocked');

    // 3. 原生脚本在执行期间新增、修改、删除源文件，verify 必须捕获全部三类变化
    const { root: root2, canonicalRoot: cRoot2, artifactRoot: art2, plan: plan2, applyResult: apply2 } = await setupAppliedProject({
      scripts: {
        typecheck: 'node -e "process.exit(0)"',
        build: 'node -e "const fs=require(\'fs\');fs.writeFileSync(\'src/added.ts\',\'// new\');fs.writeFileSync(\'src/keep.ts\',\'// modified\');fs.unlinkSync(\'src/to-delete.ts\');"',
      },
      extraSrcFiles: {
        'src/keep.ts': 'export const a = 1;\n',
        'src/to-delete.ts': 'export const b = 2;\n',
      },
    });
    const mutManifestHash = sha256Hex(fs.readFileSync(path.join(root2, 'package.json')));
    const { spec: mutSpec, authorization: mutAuth } = makeSpecAndAuth(cRoot2, plan2, apply2, {
      commands: [
        { kind: 'type', script: 'typecheck', manifestPath: 'package.json', manifestSha256: mutManifestHash, timeoutMs: 30_000, outputDirectories: [] },
        { kind: 'build', script: 'build', manifestPath: 'package.json', manifestSha256: mutManifestHash, timeoutMs: 30_000, outputDirectories: ['dist'] },
      ],
    });
    const rMut = await callVerify(cliExports, root2, plan2, { applyResult: apply2, spec: mutSpec, authorization: mutAuth, artifactRoot: art2 });
    expect(rMut).toBeDefined();
    expect(rMut!.status).toBe('failed');
    expect(rMut!.changedFiles.sort()).toEqual(['src/added.ts', 'src/keep.ts', 'src/to-delete.ts']);
    expect(rMut!.pendingItems.some(i => i.code === 'PROJECT_CHANGED')).toBe(true);
  });

  it('拒绝经父级 junction 指向工程内且目标目录尚不存在的 artifactRoot', async () => {
    const { root, canonicalRoot, plan, applyResult } = await setupAppliedProject();
    const aliasParent = path.join(makeTempDir('zhinexus-t17-artifact-alias-'), 'project-alias');
    linkDirectory(aliasParent, root);
    expect(fs.realpathSync(aliasParent)).toBe(path.resolve(canonicalRoot));

    const artifactRoot = path.join(aliasParent, 'missing-artifacts');
    const escapedArtifactRoot = path.join(root, 'missing-artifacts');
    expect(fs.existsSync(artifactRoot)).toBe(false);
    expect(fs.existsSync(escapedArtifactRoot)).toBe(false);

    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult);
    const report = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });

    expect(report).toBeDefined();
    expect(report!.status).toBe('blocked');
    expect(report!.pendingItems.some(issue => issue.code === 'PATH_UNSAFE')).toBe(true);
    expect(fs.existsSync(escapedArtifactRoot), '拒绝前不得沿 junction 在项目内创建 artifactRoot').toBe(false);
  });

  it('脚本超时结构化失败且报告与证据不泄露敏感环境变量或执行建议', async () => {
    const secretMarker = 'ZHINEXUS_SECRET_VALUE_SHOULD_NOT_LEAK_99182';
    const prevApi = process.env.ZHINEXUS_API_TOKEN;
    const prevReg = process.env.ZHINEXUS_REGISTRY_TOKEN;
    process.env.ZHINEXUS_API_TOKEN = secretMarker;
    process.env.ZHINEXUS_REGISTRY_TOKEN = secretMarker;

    try {
      const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject({
        scripts: {
          typecheck: `node -e "console.error('${secretMarker} run npm install evil'); setTimeout(() => {}, 5000);"`,
          build: 'node -e "process.exit(0)"',
        },
      });
      const manifestHash = sha256Hex(fs.readFileSync(path.join(root, 'package.json')));
      const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult, {
        commands: [
          { kind: 'type', script: 'typecheck', manifestPath: 'package.json', manifestSha256: manifestHash, timeoutMs: 250, outputDirectories: [] },
          { kind: 'build', script: 'build', manifestPath: 'package.json', manifestSha256: manifestHash, timeoutMs: 30_000, outputDirectories: ['dist'] },
        ],
      });

      const report = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
      expect(report).toBeDefined();
      expect(report!.status).toBe('failed');
      const typeCheck = report!.checks.find(c => c.category === 'type');
      expect(typeCheck?.status).toBe('failed');
      expect(typeCheck?.issues.some(i => i.code === 'TIMEOUT')).toBe(true);
      expect(report!.checks.find(c => c.category === 'build')?.status).toBe('not-run');

      // 检查报告 JSON 和所有输出产物均不含敏感值
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(secretMarker);
      for (const art of report!.artifacts) {
        const full = path.join(artifactRoot, art.path);
        if (fs.existsSync(full) && /\.(log|txt|json)$/i.test(full)) {
          expect(fs.readFileSync(full, 'utf8')).not.toContain(secretMarker);
        }
      }
    } finally {
      if (prevApi === undefined) delete process.env.ZHINEXUS_API_TOKEN;
      else process.env.ZHINEXUS_API_TOKEN = prevApi;
      if (prevReg === undefined) delete process.env.ZHINEXUS_REGISTRY_TOKEN;
      else process.env.ZHINEXUS_REGISTRY_TOKEN = prevReg;
    }
  });

  it('取消信号会终止运行中的原生脚本且保留 CANCELLED 结果', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject({
      scripts: {
        typecheck: "node -e \"setTimeout(() => require('fs').writeFileSync('cancel-sentinel.txt', 'finished'), 1500)\"",
        build: 'node -e "process.exit(0)"',
      },
    });
    const manifestHash = sha256Hex(fs.readFileSync(path.join(root, 'package.json')));
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult, {
      commands: [
        { kind: 'type', script: 'typecheck', manifestPath: 'package.json', manifestSha256: manifestHash, timeoutMs: 10_000, outputDirectories: [] },
        { kind: 'build', script: 'build', manifestPath: 'package.json', manifestSha256: manifestHash, timeoutMs: 10_000, outputDirectories: ['dist'] },
      ],
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const report = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot, signal: controller.signal });
      expect(report).toBeDefined();
      expect(report!.status).toBe('failed');
      expect(report!.pendingItems.some(issue => issue.code === 'CANCELLED')).toBe(true);
      expect(fs.existsSync(path.join(root, 'cancel-sentinel.txt'))).toBe(false);
      expect(report!.checks.find(check => check.category === 'build')?.status).toBe('not-run');
    } finally {
      clearTimeout(timer);
    }
  });

  it('取消信号会终止等待中的浏览器验证并跳过视觉检查', async () => {
    let loaded = false;
    let sideEffectCount = 0;
    const controller = new AbortController();
    const server = http.createServer((request, response) => {
      if (request.url === '/waiting') {
        loaded = true;
        response.writeHead(204);
        response.end();
        setTimeout(() => controller.abort(), 150);
        return;
      }
      if (request.url === '/side-effect') {
        sideEffectCount += 1;
        response.writeHead(204);
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<html><body><main id="started">started</main>' +
        '<script>window.addEventListener("load", () => fetch("/waiting"));' +
        'setTimeout(() => fetch("/side-effect"), 700)</script>' +
        '</body></html>',
      );
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as import('node:net').AddressInfo;
    const url = 'http://127.0.0.1:' + address.port + '/';

    try {
      const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject();
      const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult, {
        browser: {
          url,
          readySelector: '#never-ready',
          timeoutMs: 10_000,
          viewport: { width: 640, height: 480 },
          renderer: 'canvas',
          theme: 'light',
          actions: [],
          assertions: [{ kind: 'visible', selector: '#never-ready' }],
        },
      });
      const startedAt = Date.now();
      const report = await callVerify(cliExports, root, plan, {
        applyResult,
        spec,
        authorization,
        artifactRoot,
        signal: controller.signal,
      });
      expect(loaded).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(3_000);
      expect(report).toBeDefined();
      expect(report!.status).toBe('failed');
      expect(report!.pendingItems.some(issue => issue.code === 'CANCELLED')).toBe(true);
      expect(report!.checks.find(check => check.id === 'browser')?.issues.some(issue => issue.code === 'CANCELLED')).toBe(true);
      expect(report!.checks.find(check => check.id === 'visual')?.status).toBe('not-run');
      await new Promise(resolve => setTimeout(resolve, 850));
      expect(sideEffectCount).toBe(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30_000);

  it('存在业务缺口时归类 missing-business-info 且不标记 passed', async () => {
    const { root, canonicalRoot, artifactRoot, plan, applyResult } = await setupAppliedProject();
    const { spec, authorization } = makeSpecAndAuth(canonicalRoot, plan, applyResult, {
      businessGaps: ['data-source', 'event-handler'],
    });

    const report = await callVerify(cliExports, root, plan, { applyResult, spec, authorization, artifactRoot });
    expect(report).toBeDefined();
    expect(report!.status).toBe('failed');
    const gapCheck = report!.checks.find(c => c.category === 'missing-business-info');
    expect(gapCheck?.status).toBe('failed');
    expect(gapCheck?.issues.some(i => i.code === 'MISSING_BUSINESS_INFO')).toBe(true);
  });
});
