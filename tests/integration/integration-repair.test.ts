/**
 * T17 A2 产品失败测试：repairIntegration（有限修复与续接守卫）。
 *
 * 覆盖：
 * - 已知确定性模板 recipe 修复（由真实 applyIntegration 写出并由原始 afterHashes 覆盖，夹具标注 synthetic）；
 * - 守卫阻断：错误源报告摘要、用户新建/编辑/删除、符号链接替换、备份失败、预算 0/1/2/3；
 * - 续接链：两轮修复私有基线续接、attempt 摘要链、原 plan/apply/spec 摘要不变、普通 verify 仍用原 apply 基线。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonicalJson } from '../../packages/component-cli/src/contracts/schema.js';
import { validateIntegrationRepairResult } from '../../packages/component-cli/src/contracts/integration-repair.js';
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
import { startSyntheticNetwork, SYNTHETIC_API_TOKEN, SYNTHETIC_REGISTRY_TOKEN, type SyntheticNetwork } from './t16-support/loopback-services.js';
import { ECHARTS_VERSION, PACKAGE_VERSION, tarballSha256, VUE_FRAMEWORK_VERSION, VUE_PACKAGE_NAME } from './t16-support/synthetic-projects.js';
import { callRepair, callVerify, loadT17CliExports, type T17CliExports } from './t17-support/verify-namespace.js';

const repairFsHooks = vi.hoisted(() => ({
  beforeWrite: null as ((filePath: unknown) => void) | null,
  beforeOpen: null as ((filePath: unknown) => void) | null,
  beforeDescriptorWrite: null as ((args: unknown[]) => void) | null,
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      repairFsHooks.beforeWrite?.(args[0]);
      return actual.writeFileSync(...args);
    },
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      repairFsHooks.beforeOpen?.(args[0]);
      return actual.openSync(...args);
    },
    writeSync: (...args: Parameters<typeof actual.writeSync>) => {
      repairFsHooks.beforeDescriptorWrite?.(args);
      return actual.writeSync(...args);
    },
  };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

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

function buildSyntheticFaultMatchPlan(layoutText: string): MatchPlanV1 {
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
      packageManager: 'npm',
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
        layout: layoutText,
        gaps: [],
      },
    ],
    exactDependencies: VUE_DEPS.map(d => ({ ...d })),
    gaps: [],
  };
}

describe('T17 A2 repairIntegration（有限修复与续接守卫）', () => {
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
        // ignore Windows temp lock
      }
    }
  });

  afterEach(() => {
    repairFsHooks.beforeWrite = null;
    repairFsHooks.beforeOpen = null;
    repairFsHooks.beforeDescriptorWrite = null;
    vi.restoreAllMocks();
  });

  async function setupProjectForRepair(layoutText: string, alwaysFailTypecheck = false) {
    const root = makeTempDir('zhinexus-t17-repair-proj-');
    const backupRoot = makeTempDir('zhinexus-t17-repair-backup-');
    const artifactRoot = makeTempDir('zhinexus-t17-repair-artifacts-');

    // 脚本检查生成文件中是否还包含 synthetic 故障标记
    writeJson(path.join(root, 'package.json'), {
      name: 'synthetic-repair-app',
      version: '1.0.0',
      private: true,
      scripts: {
        typecheck: alwaysFailTypecheck
          ? 'node -e "process.exit(1)"'
          : "node -e \"const fs=require('fs');const c=fs.readFileSync('src/components/zhinexus/component-0001.vue','utf8');if(c.includes('synthetic-template-fault')){console.error('fault');process.exit(1);}\"",
        build: 'node -e "const fs=require(\'fs\');fs.mkdirSync(\'dist\',{recursive:true});fs.writeFileSync(\'dist/ok.js\',\'1\')"',
      },
      dependencies: {
        [VUE_PACKAGE_NAME]: PACKAGE_VERSION,
        vue: VUE_FRAMEWORK_VERSION,
        echarts: ECHARTS_VERSION,
      },
    });
    writeJson(path.join(root, 'package-lock.json'), {
      name: 'synthetic-repair-app',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'synthetic-repair-app',
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

    const plan = await planIntegration(root, buildSyntheticFaultMatchPlan(layoutText), {
      apiUrl: network.apiOrigin,
      registryUrl: network.registryOrigin,
      apiToken: SYNTHETIC_API_TOKEN,
      registryToken: SYNTHETIC_REGISTRY_TOKEN,
    });
    expect(plan.status).toBe('planned');

    const canonicalRoot = canonicalProjectRoot(root);
    const planDigest = canonicalDigest(plan);
    const applyAuth: IntegrationApplyAuthorizationV1 = {
      schemaVersion: 1,
      operation: 'apply',
      projectRoot: canonicalRoot,
      planDigest,
      allowedPaths: plan.allowedPaths,
      allowInstall: false,
    };
    const applyResult = await applyIntegration(root, plan, {
      authorization: applyAuth,
      apiUrl: network.apiOrigin,
      registryUrl: network.registryOrigin,
      apiToken: SYNTHETIC_API_TOKEN,
      registryToken: SYNTHETIC_REGISTRY_TOKEN,
      backupRoot,
    });
    expect(applyResult.status).toBe('applied');

    const pkgHash = sha256Hex(fs.readFileSync(path.join(root, 'package.json')));
    const applyResultDigest = canonicalDigest(applyResult);
    const spec: IntegrationVerificationSpecV1 = {
      schemaVersion: 1,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      commands: [
        { kind: 'type', script: 'typecheck', manifestPath: 'package.json', manifestSha256: pkgHash, timeoutMs: 30_000, outputDirectories: [] },
        { kind: 'build', script: 'build', manifestPath: 'package.json', manifestSha256: pkgHash, timeoutMs: 30_000, outputDirectories: ['dist'] },
      ],
      businessGaps: [],
    };
    const specDigest = canonicalDigest(spec);
    const verifyAuth: IntegrationExecutionAuthorizationV1 = {
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
    };

    const initialReport = await callVerify(cliExports, root, plan, {
      applyResult,
      spec,
      authorization: verifyAuth,
      artifactRoot,
    });
    expect(initialReport).toBeDefined();
    expect(initialReport!.status).toBe('failed');

    const generatedPath = 'src/components/zhinexus/component-0001.vue';
    const reportDigest = canonicalDigest(initialReport);
    const repairAuth: IntegrationExecutionAuthorizationV1 = {
      schemaVersion: 1,
      projectRoot: canonicalRoot,
      planDigest,
      applyResultDigest,
      specDigest,
      operation: 'repair',
      allowProjectScripts: true,
      allowBrowser: false,
      scriptNames: ['typecheck', 'build'],
      allowedRepairPaths: [generatedPath],
      maxAttempts: 2,
      sourceReportDigest: reportDigest,
    };

    return { root, canonicalRoot, artifactRoot, plan, applyResult, spec, initialReport: initialReport!, verifyAuth, repairAuth, generatedPath };
  }

  it('确定性模板 recipe 修复后完整重验，保持原摘要不变并阻断普通 verify 使用旧基线', async () => {
    const ctx = await setupProjectForRepair('synthetic-template-fault:stage-1');
    const result = await callRepair(cliExports, ctx.root, ctx.plan, ctx.initialReport, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: ctx.repairAuth,
      artifactRoot: ctx.artifactRoot,
    });

    expect(result).toBeDefined();
    expect(validateIntegrationRepairResult(result!).ok).toBe(true);
    expect(result!.attempts.length).toBeGreaterThanOrEqual(1);
    expect(result!.attempts.length).toBeLessThanOrEqual(2);
    expect(result!.changedFiles).toEqual([ctx.generatedPath]);
    expect(result!.planDigest).toBe(canonicalDigest(ctx.plan));
    expect(result!.applyResultDigest).toBe(canonicalDigest(ctx.applyResult));
    expect(result!.specDigest).toBe(canonicalDigest(ctx.spec));

    // 普通 verify 仍从原 apply.afterHashes 起步，遇到已修复文件必须报 PROJECT_CHANGED
    const reVerifyWithApply = await callVerify(cliExports, ctx.root, ctx.plan, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: ctx.verifyAuth,
      artifactRoot: ctx.artifactRoot,
    });
    expect(reVerifyWithApply).toBeDefined();
    expect(reVerifyWithApply!.status).toBe('blocked');
    expect(reVerifyWithApply!.pendingItems.some(i => i.code === 'PROJECT_CHANGED')).toBe(true);
  });

  it('预算 0 零写入、预算 3 冷拒绝、用户编辑阻断写入并保留用户字节', async () => {
    const ctx = await setupProjectForRepair('synthetic-template-fault:stage-1');

    // 1. maxAttempts = 0 零写入
    const r0 = await callRepair(cliExports, ctx.root, ctx.plan, ctx.initialReport, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: { ...ctx.repairAuth, maxAttempts: 0 },
      maxAttempts: 0,
      artifactRoot: ctx.artifactRoot,
    });
    expect(r0).toBeDefined();
    expect(r0!.status).toBe('stopped');
    expect(r0!.attempts).toEqual([]);
    expect(r0!.changedFiles).toEqual([]);

    // 2. maxAttempts = 3 冷拒绝
    const r3 = await callRepair(cliExports, ctx.root, ctx.plan, ctx.initialReport, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: ctx.repairAuth,
      maxAttempts: 3 as never,
      artifactRoot: ctx.artifactRoot,
    });
    expect(r3).toBeDefined();
    expect(r3!.status).toBe('blocked');
    expect(r3!.attempts).toEqual([]);

    // 3. 用户编辑生成文件后，repair 必须阻断并保留用户修改
    const userContent = '// user manual edit\n<template><div>keep me</div></template>\n';
    fs.writeFileSync(path.join(ctx.root, ctx.generatedPath), userContent, 'utf8');
    const rUserEdit = await callRepair(cliExports, ctx.root, ctx.plan, ctx.initialReport, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: ctx.repairAuth,
      artifactRoot: ctx.artifactRoot,
    });
    expect(rUserEdit).toBeDefined();
    expect(rUserEdit!.status).toBe('blocked');
    expect(rUserEdit!.stopReason).toBe('user-edited');
    expect(fs.readFileSync(path.join(ctx.root, ctx.generatedPath), 'utf8')).toBe(userContent);
  });

  it('repair 前复核源报告的完整 after 快照并阻断报告后新增的用户文件', async () => {
    const ctx = await setupProjectForRepair('synthetic-template-fault:stage-1');
    const generatedBefore = fs.readFileSync(path.join(ctx.root, ctx.generatedPath));
    const userPath = path.join(ctx.root, 'src', 'user-added-after-report.ts');
    const userBytes = 'export const keep = true;\n';
    fs.writeFileSync(userPath, userBytes, 'utf8');

    const result = await callRepair(cliExports, ctx.root, ctx.plan, ctx.initialReport, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: ctx.repairAuth,
      artifactRoot: ctx.artifactRoot,
    });

    expect(result).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(result!.stopReason).toBe('user-edited');
    expect(result!.attempts).toEqual([]);
    expect(fs.readFileSync(path.join(ctx.root, ctx.generatedPath))).toEqual(generatedBefore);
    expect(fs.readFileSync(userPath, 'utf8')).toBe(userBytes);
  });

  it('每次修复写入前重新核对完整 after 快照并阻断检查后的并发新增文件', async () => {
    const ctx = await setupProjectForRepair('synthetic-template-fault:stage-1');
    const generatedAbs = path.join(ctx.root, ctx.generatedPath);
    const generatedBefore = fs.readFileSync(generatedAbs);
    const userPath = path.join(ctx.root, 'src', 'concurrent-user-file.ts');
    const userBytes = Buffer.from('export const concurrentEdit = true;\n');
    let injected = false;

    repairFsHooks.beforeWrite = filePath => {
      if (
        !injected &&
        typeof filePath !== 'number' &&
        String(filePath).includes(ctx.artifactRoot) &&
        String(filePath).includes('repair-backup-')
      ) {
        injected = true;
        actualFs.writeFileSync(userPath, userBytes);
      }
    };

    const result = await callRepair(cliExports, ctx.root, ctx.plan, ctx.initialReport, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: ctx.repairAuth,
      artifactRoot: ctx.artifactRoot,
    });

    expect(injected).toBe(true);
    expect(result).toBeDefined();
    expect(result!.attempts).toEqual([]);
    expect(result!.status).toBe('blocked');
    expect(result!.stopReason).toBe('user-edited');
    expect(result!.changedFiles).toEqual([]);
    expect(fs.readFileSync(generatedAbs)).toEqual(generatedBefore);
    expect(fs.readFileSync(userPath)).toEqual(userBytes);
  });

  it('目标路径在打开前被替换为链接或新文件时不覆盖替代目标', async () => {
    const ctx = await setupProjectForRepair('synthetic-template-fault:stage-1');
    const generatedAbs = path.join(ctx.root, ctx.generatedPath);
    const victimRoot = makeTempDir('zhinexus-t17-repair-symlink-victim-');
    const victimPath = path.join(victimRoot, 'outside-project.vue');
    const victimBytes = Buffer.from('<template><div>outside stays unchanged</div></template>\n');
    const heldPath = `${generatedAbs}.held`;
    fs.writeFileSync(victimPath, victimBytes);
    let injected = false;
    let replacedWithSymlink = false;

    const replaceWithSymlink = () => {
      if (injected) return;
      injected = true;
      actualFs.renameSync(generatedAbs, heldPath);
      try {
        actualFs.symlinkSync(victimPath, generatedAbs, 'file');
        replacedWithSymlink = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
          actualFs.copyFileSync(victimPath, generatedAbs);
        } else {
          actualFs.renameSync(heldPath, generatedAbs);
          throw error;
        }
      }
    };

    repairFsHooks.beforeOpen = filePath => {
      if (typeof filePath !== 'number' && path.resolve(String(filePath)) === generatedAbs) {
        replaceWithSymlink();
      }
    };
    repairFsHooks.beforeWrite = filePath => {
      if (typeof filePath !== 'number' && path.resolve(String(filePath)) === generatedAbs) {
        replaceWithSymlink();
      }
    };

    const result = await callRepair(cliExports, ctx.root, ctx.plan, ctx.initialReport, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: ctx.repairAuth,
      artifactRoot: ctx.artifactRoot,
    });

    expect(injected).toBe(true);
    expect(result).toBeDefined();
    expect(result!.status).not.toBe('repaired');
    expect(fs.readFileSync(victimPath)).toEqual(victimBytes);
    if (replacedWithSymlink) {
      expect(fs.lstatSync(generatedAbs).isSymbolicLink()).toBe(true);
    } else {
      expect(fs.readFileSync(generatedAbs)).toEqual(victimBytes);
    }
  });

  it('写入失败且路径随后变成链接时通过原文件描述符恢复，不触碰链接目标', async () => {
    const ctx = await setupProjectForRepair('synthetic-template-fault:stage-1');
    const generatedAbs = path.join(ctx.root, ctx.generatedPath);
    const originalBytes = fs.readFileSync(generatedAbs);
    const victimRoot = makeTempDir('zhinexus-t17-repair-recovery-victim-');
    const victimPath = path.join(victimRoot, 'outside-project.vue');
    const victimBytes = Buffer.from('<template><div>external recovery sentinel</div></template>\n');
    const heldPath = `${generatedAbs}.held`;
    fs.writeFileSync(victimPath, victimBytes);
    let injected = false;
    let replacedWithSymlink = false;

    const replacePath = () => {
      if (injected) return;
      injected = true;
      actualFs.renameSync(generatedAbs, heldPath);
      try {
        actualFs.symlinkSync(victimPath, generatedAbs, 'file');
        replacedWithSymlink = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
          actualFs.copyFileSync(victimPath, generatedAbs);
        } else {
          actualFs.renameSync(heldPath, generatedAbs);
          throw error;
        }
      }
    };

    repairFsHooks.beforeDescriptorWrite = args => {
      if (injected) return;
      const [fd, data] = args as [number, Buffer];
      actualFs.writeSync(fd, data, 0, Math.min(8, data.length), 0);
      replacePath();
      throw new Error('injected descriptor write failure');
    };

    const result = await callRepair(cliExports, ctx.root, ctx.plan, ctx.initialReport, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: ctx.repairAuth,
      artifactRoot: ctx.artifactRoot,
    });

    expect(injected).toBe(true);
    expect(result).toBeDefined();
    expect(result!.status).toBe('blocked');
    expect(result!.stopReason).toBe('user-edited');
    expect(fs.readFileSync(victimPath)).toEqual(victimBytes);
    expect(fs.readFileSync(heldPath)).toEqual(originalBytes);
    if (replacedWithSymlink) {
      expect(fs.lstatSync(generatedAbs).isSymbolicLink()).toBe(true);
    } else {
      expect(fs.readFileSync(generatedAbs)).toEqual(victimBytes);
    }
  });

  it('不可自愈故障在 2 次尝试内停止并交付 pendingItems，不修改包清单/锁/业务文件', async () => {
    const ctx = await setupProjectForRepair('grid cell 1', true);
    // 注入不可由模板 recipe 修复的脚本失败
    const pkgBefore = fs.readFileSync(path.join(ctx.root, 'package.json'), 'utf8');
    const lockBefore = fs.readFileSync(path.join(ctx.root, 'package-lock.json'), 'utf8');

    const result = await callRepair(cliExports, ctx.root, ctx.plan, ctx.initialReport, {
      applyResult: ctx.applyResult,
      spec: ctx.spec,
      authorization: ctx.repairAuth,
      artifactRoot: ctx.artifactRoot,
    });
    expect(result).toBeDefined();
    expect(['stopped', 'blocked']).toContain(result!.status);
    expect(result!.attempts.length).toBeLessThanOrEqual(2);
    expect(result!.pendingItems.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(ctx.root, 'package.json'), 'utf8')).toBe(pkgBefore);
    expect(fs.readFileSync(path.join(ctx.root, 'package-lock.json'), 'utf8')).toBe(lockBefore);
  });
});
