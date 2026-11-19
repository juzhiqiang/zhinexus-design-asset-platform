import { describe, expect, it } from 'vitest';
import {
  T17_POSITIVE_SCENARIOS,
  T17_REFUSAL_SCENARIOS,
  validateT17ScenarioMatrix,
} from '../../fixtures/t17-matrix/scenarios.js';
import { canonicalEvidenceSha256, evaluateT17Matrix, type T17CellReceipt } from './score.js';

const CLI_SHA = 'a'.repeat(64);
const SDK_SHA = 'b'.repeat(64);

function passedReceipt(caseId: string, framework: 'vue' | 'react'): T17CellReceipt {
  const scenario = T17_POSITIVE_SCENARIOS.find((item) => item.caseId === caseId)!;
  return {
    caseId,
    receiptEvidencePath: `${caseId}-receipt.json`,
    framework,
    packageManager: scenario.packageManager,
    host: scenario.host,
    expectedOutcome: 'pass',
    actualOutcome: 'pass',
    sourceKind: 'temporary-host',
    cliTarballSha256: CLI_SHA,
    frozenBundleSha256: SDK_SHA,
    planSha256: 'c'.repeat(64),
    applyResultSha256: 'd'.repeat(64),
    verificationSpecSha256: '8'.repeat(64),
    reportSha256: 'e'.repeat(64),
    reportPath: `${caseId}-report.json`,
    planEvidencePath: `${caseId}-plan.json`,
    applyResultEvidencePath: `${caseId}-apply.json`,
    verificationSpecEvidencePath: `${caseId}-verification.json`,
    commands: [
      { kind: 'typecheck', exitCode: 0, evidencePath: `${caseId}-typecheck.log`, sha256: '1'.repeat(64), stdoutEvidencePath: `${caseId}-typecheck.out`, stdoutSha256: '1'.repeat(64), stderrEvidencePath: `${caseId}-typecheck.err`, stderrSha256: '1'.repeat(64) },
      { kind: 'build', exitCode: 0, evidencePath: `${caseId}-build.log`, sha256: '2'.repeat(64), stdoutEvidencePath: `${caseId}-build.out`, stdoutSha256: '2'.repeat(64), stderrEvidencePath: `${caseId}-build.err`, stderrSha256: '2'.repeat(64) },
    ],
    generatedPath: `src/generated/${caseId}.${framework === 'vue' ? 'vue' : 'tsx'}`,
    generatedSha256: '9'.repeat(64),
    generatedEvidencePath: `${caseId}-generated.txt`,
    browserAssets: [{ path: '/assets/chart.js', evidencePath: `${caseId}-asset.bin`, url: 'http://127.0.0.1:4173/assets/chart.js', sha256: '3'.repeat(64), bytes: 128, status: 'loaded' }],
    interaction: { action: 'click', observed: true, before: 0, after: 1, evidencePath: `${caseId}-interaction.json`, sha256: 'a'.repeat(64) },
    visualCheck: { status: 'passed', screenshotPath: `${caseId}-screen.png`, screenshotSha256: '4'.repeat(64), baselinePath: `${caseId}-baseline.png`, baselineSha256: '7'.repeat(64) },
    outOfScopeWrites: 0,
    lostUserEdits: 0,
    cleanup: { projectRootRemoved: true, evidenceRetained: true, userProjectPreserved: true },
  };
}

function passedRefusalReceipts() {
  return T17_REFUSAL_SCENARIOS.map((scenario) => ({
    caseId: scenario.caseId,
    receiptEvidencePath: `${scenario.caseId}-receipt.json`,
    expectedOutcome: 'refuse' as const,
    actualOutcome: 'refused' as const,
    beforeProjectSha256: '5'.repeat(64),
    afterProjectSha256: '5'.repeat(64),
    reportPath: `${scenario.caseId}-report.json`,
    reportSha256: '6'.repeat(64),
    outOfScopeWrites: 0,
  }));
}

function sealPositiveReceipts(receipts: readonly T17CellReceipt[]) {
  return receipts.flatMap((receipt) => [
    { name: receipt.receiptEvidencePath, sha256: canonicalEvidenceSha256(receipt), bytes: 10 },
    { name: receipt.reportPath, sha256: receipt.reportSha256, bytes: 10 },
    { name: receipt.planEvidencePath!, sha256: receipt.planSha256, bytes: 10 },
    { name: receipt.applyResultEvidencePath!, sha256: receipt.applyResultSha256, bytes: 10 },
    { name: receipt.verificationSpecEvidencePath!, sha256: receipt.verificationSpecSha256, bytes: 10 },
    { name: receipt.generatedEvidencePath!, sha256: receipt.generatedSha256, bytes: 10 },
    ...receipt.commands.flatMap((command) => [
      { name: command.evidencePath, sha256: command.sha256, bytes: 10 },
      { name: command.stdoutEvidencePath, sha256: command.stdoutSha256, bytes: 10 },
      { name: command.stderrEvidencePath, sha256: command.stderrSha256, bytes: 10 },
    ]),
    ...receipt.browserAssets.map((asset) => ({ name: asset.evidencePath!, sha256: asset.sha256, bytes: asset.bytes })),
    { name: receipt.interaction.evidencePath!, sha256: receipt.interaction.sha256!, bytes: 10 },
    { name: receipt.visualCheck.screenshotPath, sha256: receipt.visualCheck.screenshotSha256, bytes: 10 },
    { name: receipt.visualCheck.baselinePath!, sha256: receipt.visualCheck.baselineSha256, bytes: 10 },
  ]);
}

function sealRefusalReceipts(receipts: ReturnType<typeof passedRefusalReceipts>) {
  return receipts.flatMap((receipt) => [
    { name: receipt.receiptEvidencePath, sha256: canonicalEvidenceSha256(receipt), bytes: 10 },
    { name: receipt.reportPath, sha256: receipt.reportSha256, bytes: 10 },
  ]);
}

describe('T17 独立 Vue / React 项目验收矩阵', () => {
  it('固定 20 个正向场景，Vue 与 React 各 10 个，拒绝场景独立于分母', () => {
    expect(T17_POSITIVE_SCENARIOS).toHaveLength(20);
    expect(T17_POSITIVE_SCENARIOS.filter((item) => item.framework === 'vue')).toHaveLength(10);
    expect(T17_POSITIVE_SCENARIOS.filter((item) => item.framework === 'react')).toHaveLength(10);
    expect(T17_REFUSAL_SCENARIOS.length).toBeGreaterThan(0);
    expect(validateT17ScenarioMatrix()).toEqual({ valid: true, errors: [] });
  });

  it('仅当两套冻结产物、真实命令、生成文件、浏览器资源、交互与截图证据都对齐才通过 cell', () => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA,
      expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: receipts,
      refusalReceipts: passedRefusalReceipts(),
      sealedFiles: [...sealPositiveReceipts(receipts), ...sealRefusalReceipts(passedRefusalReceipts())],
    });
    expect(result.errors).toEqual([]);

    expect(result.positive.total).toBe(20);
    expect(result.positive.passed).toBe(20);
    expect(result.frameworks.vue).toMatchObject({ total: 10, passed: 10, required: 8 });
    expect(result.frameworks.react).toMatchObject({ total: 10, passed: 10, required: 8 });
    expect(result.refusals.total).toBe(T17_REFUSAL_SCENARIOS.length);
    expect(result.matrixAccepted).toBe(true);
  });

  it('缺失、重复、跳过、错摘要或越界写入均不能计为通过', () => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    receipts[0] = { ...receipts[0]!, actualOutcome: 'skipped' };
    receipts[1] = { ...receipts[1]!, cliTarballSha256: '9'.repeat(64) };
    receipts[2] = { ...receipts[2]!, outOfScopeWrites: 1 };
    const incomplete = receipts.slice(0, -1);
    incomplete.push(receipts[3]!);

    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA,
      expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: incomplete,
      refusalReceipts: [],
      sealedFiles: sealPositiveReceipts(incomplete),
    });

    expect(result.positive.total).toBe(20);
    expect(result.positive.passed).toBe(16);
    expect(result.matrixAccepted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('缺字段的执行回执失败关闭，不因结构损坏崩溃或计为通过', () => {
    const malformed = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    malformed[0] = { caseId: 'V01', receiptEvidencePath: 'V01-receipt.json' } as T17CellReceipt;
    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA,
      expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: malformed,
      refusalReceipts: [],
      sealedFiles: [],
    });
    expect(result.positive.passed).toBe(0);
    expect(result.matrixAccepted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('拒绝项必须明确拒绝且项目前后摘要一致，拒绝结果不增加正向分母', () => {
    const refusalReceipts = T17_REFUSAL_SCENARIOS.map((scenario) => ({
      caseId: scenario.caseId,
      receiptEvidencePath: `${scenario.caseId}-receipt.json`,
      expectedOutcome: 'refuse' as const,
      actualOutcome: 'refused' as const,
      beforeProjectSha256: '5'.repeat(64),
      afterProjectSha256: '5'.repeat(64),
      reportPath: `${scenario.caseId}-report.json`,
      reportSha256: '6'.repeat(64),
      outOfScopeWrites: 0,
    }));
    const positives = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));

    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA,
      expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: positives,
      refusalReceipts,
      sealedFiles: [...sealPositiveReceipts(positives), ...sealRefusalReceipts(refusalReceipts)],
    });

    expect(result.positive.total).toBe(20);
    expect(result.positive.passed).toBe(20);
    expect(result.refusals).toMatchObject({ total: T17_REFUSAL_SCENARIOS.length, passed: T17_REFUSAL_SCENARIOS.length });
    expect(result.matrixAccepted).toBe(true);

    const acceptedBadRefusal = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA,
      expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: positives,
      refusalReceipts: refusalReceipts.map((receipt, index) => index === 0
        ? { ...receipt, actualOutcome: 'accepted' as const }
        : receipt),
      sealedFiles: [...sealPositiveReceipts(positives), ...sealRefusalReceipts(refusalReceipts)],
    });
    expect(acceptedBadRefusal.refusals.passed).toBe(T17_REFUSAL_SCENARIOS.length - 1);
    expect(acceptedBadRefusal.matrixAccepted).toBe(false);
  });
});
