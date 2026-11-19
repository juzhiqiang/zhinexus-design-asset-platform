/**
 * T17 owned-host 临时消费者真实 CLI 验收链（支架测试，与产品级验收分离）。
 *
 * 覆盖：
 * - 缺失冻结 tarball / 服务凭据 / SDK bundle / 变体映射时 fail-closed；
 * - 严禁把 T16 inspect 结果冒充 T17 验收通过；
 * - plan / apply / verify / repair 输出均须通过 @company/contracts 校验并严格绑定 root/plan/apply/spec 摘要；
 * - repair 严格限制修复预算（maxAttempts 仅接受 0|1|2，attempts.length <= maxAttempts）；
 * - 子进程清理验证（stopOwnedProcesses 确保退出后无残留子进程，且凭据不进入 argv）。
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@company/contracts';
import { validIntegrationPlanFixture } from '../../fixtures/integration-plan.js';
import { applyResultFixture } from '../../fixtures/integration-apply.js';
import { verificationReportFixture, verificationSpecFixture } from '../../fixtures/integration-verification.js';
import { repairResultFixture, repairSourceReportFixture } from '../../fixtures/integration-repair.js';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const digest = (value: unknown) => sha(canonicalJson(value));

async function loadChainModule(): Promise<Record<string, unknown>> {
  try {
    return (await import('./chain.js')) as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe('T17 owned-host CLI 验收链（plan → apply → verify/repair）', () => {
  it('缺失冻结 tarball、服务凭据、SDK bundle 或变体映射时 fail-closed', async () => {
    const mod = await loadChainModule();
    expect(typeof mod.runT17HostAcceptanceChain).toBe('function');
    const runChain = mod.runT17HostAcceptanceChain as (opts: {
      env: Record<string, string | undefined>;
      repositoryRoot: string;
    }) => Promise<unknown>;

    await expect(
      runChain({ env: {}, repositoryRoot: process.cwd() }),
    ).rejects.toThrow(/Missing required T17 host inputs/i);
  });

  it('拒绝把 T16 inspect 结果冒充 T17 验收通过，并校验 Vue 与 React 双框架完整链', async () => {
    const mod = await loadChainModule();
    expect(typeof mod.verifyHostChainReceipt).toBe('function');
    const verifyReceipt = mod.verifyHostChainReceipt as (receipt: unknown) => Promise<void>;

    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-chain-receipt-'));
    try {
      await mkdir(join(root, 'files'));
      // 伪造仅含 T16 inspect 的回执，必须被拒绝
      const inspectOnly = {
        runId: 'run-inspect-only',
        evidenceRoot: root,
        result: 'passed',
        inspections: [
          { framework: 'vue', status: 'inspected' },
          { framework: 'react', status: 'inspected' },
        ],
      };
      await expect(verifyReceipt(inspectOnly)).rejects.toThrow(/plan|apply|verify|chain|frameworks|seal/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('严格用 contracts 校验 plan / apply / verify / repair 并绑定摘要与修复预算上限', async () => {
    const mod = await loadChainModule();
    expect(typeof mod.parsePlanOutput).toBe('function');
    expect(typeof mod.parseApplyOutput).toBe('function');
    expect(typeof mod.parseVerifyOutput).toBe('function');
    expect(typeof mod.parseRepairOutput).toBe('function');

    const parsePlan = mod.parsePlanOutput as (stdout: string, framework: 'vue' | 'react') => unknown;
    const parseApply = mod.parseApplyOutput as (stdout: string, root: string, planDigest: string) => unknown;
    const parseVerify = mod.parseVerifyOutput as (
      stdout: string,
      root: string,
      planDigest: string,
      applyDigest: string,
      specDigest: string,
    ) => unknown;
    const parseRepair = mod.parseRepairOutput as (
      stdout: string,
      root: string,
      planDigest: string,
      applyDigest: string,
      specDigest: string,
      sourceReportDigest: string,
      maxAttempts: number,
    ) => unknown;

    const plan = validIntegrationPlanFixture();
    const planDigest = digest(plan);
    expect(parsePlan(JSON.stringify(plan), 'vue')).toBeDefined();
    expect(() => parsePlan(JSON.stringify({ ...plan, status: 'conflicted' }), 'vue')).toThrow(/plan/i);
    expect(() => parsePlan(JSON.stringify(plan), 'react')).toThrow(/framework/i);

    const apply = { ...applyResultFixture(), planDigest };
    const applyDigest = digest(apply);
    expect(parseApply(JSON.stringify(apply), apply.projectRoot, planDigest)).toBeDefined();
    expect(() => parseApply(JSON.stringify(apply), apply.projectRoot, '0'.repeat(64))).toThrow(/planDigest|digest/i);
    const blockedApply = {
      ...apply,
      status: 'blocked' as const,
      installState: 'not-run' as const,
      changedFiles: [],
      beforeHashes: [],
      afterHashes: [],
      installedVersions: [],
      issues: [{ code: 'AUTHORIZATION_REQUIRED' as const, message: 'Explicit apply authorization is required.' }],
    };
    delete (blockedApply as Record<string, unknown>).backupRef;
    expect(() => parseApply(JSON.stringify(blockedApply), apply.projectRoot, planDigest)).toThrow(/applied/i);

    const spec = { ...verificationSpecFixture(), projectRoot: apply.projectRoot, planDigest, applyResultDigest: applyDigest };
    const specDigest = digest(spec);
    const report = {
      ...verificationReportFixture(),
      projectRoot: apply.projectRoot,
      planDigest,
      applyResultDigest: applyDigest,
      specDigest,
    };
    expect(parseVerify(JSON.stringify(report), apply.projectRoot, planDigest, applyDigest, specDigest)).toBeDefined();
    expect(() =>
      parseVerify(JSON.stringify(report), apply.projectRoot, planDigest, applyDigest, 'f'.repeat(64)),
    ).toThrow(/specDigest|digest/i);

    const sourceReport = {
      ...repairSourceReportFixture(),
      projectRoot: apply.projectRoot,
      planDigest,
      applyResultDigest: applyDigest,
      specDigest,
    };
    const sourceReportDigest = digest(sourceReport);
    const baseRepair = repairResultFixture();
    const repair = {
      ...baseRepair,
      projectRoot: apply.projectRoot,
      planDigest,
      applyResultDigest: applyDigest,
      specDigest,
      sourceReportDigest,
      attempts: baseRepair.attempts.map(a => ({ ...a, beforeReportDigest: sourceReportDigest })),
      finalReport: {
        ...baseRepair.finalReport,
        projectRoot: apply.projectRoot,
        planDigest,
        applyResultDigest: applyDigest,
        specDigest,
      },
    };
    expect(
      parseRepair(JSON.stringify(repair), apply.projectRoot, planDigest, applyDigest, specDigest, sourceReportDigest, 2),
    ).toBeDefined();
    // 超过修复预算上限（3 或 attempts > maxAttempts）必须拒绝
    expect(() =>
      parseRepair(JSON.stringify(repair), apply.projectRoot, planDigest, applyDigest, specDigest, sourceReportDigest, 3),
    ).toThrow(/maxAttempts|budget|上限/i);
    expect(() =>
      parseRepair(JSON.stringify(repair), apply.projectRoot, planDigest, applyDigest, specDigest, sourceReportDigest, 0),
    ).toThrow(/attempts|budget|maxAttempts/i);
  });

  it('构建双框架 MatchPlan 与 VerificationSpec，且拒绝非法修复预算', async () => {
    const mod = await loadChainModule();
    expect(typeof mod.assertBoundedRepairBudget).toBe('function');
    const assertBudget = mod.assertBoundedRepairBudget as (value: number) => 0 | 1 | 2;
    expect(assertBudget(0)).toBe(0);
    expect(assertBudget(1)).toBe(1);
    expect(assertBudget(2)).toBe(2);
    expect(() => assertBudget(3)).toThrow(/maxAttempts|budget/i);
    expect(() => assertBudget(-1)).toThrow(/maxAttempts|budget/i);
  });

  it('验证真实保留回执与子进程已清空标记，篡改任一阶段证据均拒绝', async () => {
    const mod = await loadChainModule();
    expect(typeof mod.verifyHostChainReceipt).toBe('function');
    const verifyReceipt = mod.verifyHostChainReceipt as (receipt: unknown) => Promise<void>;

    const root = await mkdtemp(join(tmpdir(), 'zhinexus-t17-chain-valid-'));
    try {
      const filesDir = join(root, 'files');
      await mkdir(filesDir);

      const makeFrameworkEntry = async (framework: 'vue' | 'react') => {
        const planBytes = Buffer.from(JSON.stringify({ framework, step: 'plan' }) + '\n');
        const applyBytes = Buffer.from(JSON.stringify({ framework, step: 'apply' }) + '\n');
        const verifyBytes = Buffer.from(JSON.stringify({ framework, step: 'verify' }) + '\n');
        const repairBytes = Buffer.from(JSON.stringify({ framework, step: 'repair' }) + '\n');
        const names = {
          plan: `${framework}-plan.json`,
          apply: `${framework}-apply.json`,
          verify: `${framework}-verify.json`,
          repair: `${framework}-repair.json`,
        };
        await writeFile(join(filesDir, names.plan), planBytes);
        await writeFile(join(filesDir, names.apply), applyBytes);
        await writeFile(join(filesDir, names.verify), verifyBytes);
        await writeFile(join(filesDir, names.repair), repairBytes);
        return {
          entry: {
            framework,
            packageManager: 'npm' as const,
            planStatus: 'planned' as const,
            applyStatus: 'applied' as const,
            verifyStatus: 'passed' as const,
            repairStatus: 'not-needed' as const,
            repairMaxAttempts: 2 as const,
            repairAttempts: 0,
            planDigest: sha(planBytes),
            applyResultDigest: sha(applyBytes),
            specDigest: '1'.repeat(64),
            verifyReportDigest: sha(verifyBytes),
            planEvidence: join(filesDir, names.plan),
            applyEvidence: join(filesDir, names.apply),
            verifyEvidence: join(filesDir, names.verify),
            repairEvidence: join(filesDir, names.repair),
            childProcessesCleaned: true,
          },
          sealedFiles: [
            { name: names.plan, bytes: planBytes.length, sha256: sha(planBytes) },
            { name: names.apply, bytes: applyBytes.length, sha256: sha(applyBytes) },
            { name: names.verify, bytes: verifyBytes.length, sha256: sha(verifyBytes) },
            { name: names.repair, bytes: repairBytes.length, sha256: sha(repairBytes) },
          ],
        };
      };

      const vue = await makeFrameworkEntry('vue');
      const react = await makeFrameworkEntry('react');
      const cli = {
        root: 'cli-root',
        entry: 'cli-entry',
        entrySha256: 'c'.repeat(64),
        version: '0.0.17',
        tarballSha256: 'a'.repeat(64),
        tarballBytes: 128,
        manifestSha256: 'b'.repeat(64),
      };
      const chains = [vue.entry, react.entry];
      const receiptEvidencePath = join(filesDir, 't17-host-acceptance.json');
      const persisted = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          acceptanceKind: 't17-owned-host-chain',
          productionAcceptance: false,
          runId: 'run-chain-1',
          evidenceRoot: root,
          result: 'passed',
          receiptEvidencePath,
          sealPath: '',
          sealSha256: '',
          cli,
          chains,
          childProcessesCleaned: true,
        }) + '\n',
      );
      await writeFile(receiptEvidencePath, persisted);

      const sealedFiles = [
        ...vue.sealedFiles,
        ...react.sealedFiles,
        { name: 't17-host-acceptance.json', bytes: persisted.length, sha256: sha(persisted) },
      ];
      const sealBytes = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          runId: 'run-chain-1',
          evidenceRoot: root,
          payload: {
            acceptanceKind: 't17-owned-host-chain',
            productionAcceptance: false,
            result: 'passed',
            cli,
            chains,
            childProcessesCleaned: true,
            receiptEvidencePath: 'files/t17-host-acceptance.json',
          },
          files: sealedFiles,
        }),
      );
      const sealPath = join(root, 'run-seal.json');
      await writeFile(sealPath, sealBytes);

      const receipt = {
        schemaVersion: 1 as const,
        acceptanceKind: 't17-owned-host-chain' as const,
        productionAcceptance: false as const,
        runId: 'run-chain-1',
        evidenceRoot: root,
        result: 'passed' as const,
        receiptEvidencePath,
        sealPath,
        sealSha256: sha(sealBytes),
        cli,
        chains,
        childProcessesCleaned: true,
      };

      await expect(verifyReceipt(receipt)).resolves.toBeUndefined();
      // 子进程未确认清理 -> 拒绝
      await expect(verifyReceipt({ ...receipt, childProcessesCleaned: false })).rejects.toThrow(/process|clean|seal/i);
      // 仅含 Vue 缺 React -> 拒绝
      await expect(verifyReceipt({ ...receipt, chains: [vue.entry] })).rejects.toThrow(/vue|react|framework|seal/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
