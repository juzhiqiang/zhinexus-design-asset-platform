import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  T17_POSITIVE_SCENARIOS,
  T17_REFUSAL_SCENARIOS,
  validateT17ScenarioMatrix,
} from '../../fixtures/t17-matrix/scenarios.js';
import { canonicalEvidenceSha256, evaluateT17Matrix, loadT17MatrixInput, type T17CellReceipt } from './score.js';

const CLI_SHA = 'a'.repeat(64);
const SDK_SHA = 'b'.repeat(64);
const bytesSha = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
};

function passedReceipt(caseId: string, framework: 'vue' | 'react'): T17CellReceipt {
  const scenario = T17_POSITIVE_SCENARIOS.find((item) => item.caseId === caseId)!;
  const receipt: T17CellReceipt = {
    caseId,
    receiptEvidencePath: `${caseId}-receipt.json`,
    framework,
    packageManager: scenario.packageManager,
    host: scenario.host,
    projectRoot: `C:/matrix/${caseId}`,
    scenarioIdentity: { topology: scenario.topology, workspace: scenario.workspace, hostMode: scenario.hostMode, components: scenario.components },
    expectedOutcome: 'pass',
    actualOutcome: 'pass',
    sourceKind: 'temporary-host',
    cliTarballSha256: CLI_SHA,
    frozenBundleSha256: SDK_SHA,
    planSha256: canonicalEvidenceSha256(planForScenario(scenario)),
    applyResultSha256: canonicalEvidenceSha256({}),
    verificationSpecSha256: canonicalEvidenceSha256({}),
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
    interaction: { action: canonical(scenario.browser.actions), observed: true, before: scenario.browser.interaction!.from, after: scenario.browser.interaction!.to, evidencePath: `${caseId}-interaction.json`, sha256: 'a'.repeat(64) },
    visualCheck: { status: 'passed', screenshotPath: `${caseId}-screen.png`, screenshotSha256: '4'.repeat(64), baselinePath: `${caseId}-baseline.png`, baselineSha256: '7'.repeat(64) },
    outOfScopeWrites: 0,
    lostUserEdits: 0,
    cleanup: { projectRootRemoved: true, evidenceRetained: true, userProjectPreserved: true },
  };
  receipt.applyResultSha256 = canonicalEvidenceSha256(applyForReceipt(receipt));
  receipt.verificationSpecSha256 = canonicalEvidenceSha256(specForReceipt(receipt));
  receipt.interaction.sha256 = bytesSha(canonical(interactionProof(receipt)));
  const report = positiveReport(receipt);
  receipt.reportSha256 = bytesSha(canonical(report));
  if (scenario.requiresRepairFault) {
    const evidence = repairProof(receipt);
    receipt.repair = { initialReportPath: `${caseId}-initial-report.json`, initialReportSha256: canonicalEvidenceSha256(evidence.initial), resultPath: `${caseId}-repair.json`, resultSha256: canonicalEvidenceSha256(evidence.result) };
  }
  return receipt;
}

function exactDependencies(framework: 'vue' | 'react') {
  return [
    { name: `@company/charts-${framework}`, version: '0.0.12' },
    { name: framework, version: framework === 'vue' ? '3.5.45' : '19.3.1' },
    ...(framework === 'react' ? [{ name: 'react-dom', version: '19.3.1' }] : []),
    { name: 'echarts', version: '6.1.0' },
  ];
}

function passedRefusalReceipts() {
  return T17_REFUSAL_SCENARIOS.map((scenario) => {
    const receipt = {
      caseId: scenario.caseId, framework: scenario.framework, packageManager: scenario.packageManager,
      scenarioIdentity: { kind: scenario.kind, focus: scenario.focus, reason: scenario.reason, setup: scenario.setup },
      receiptEvidencePath: `${scenario.caseId}-receipt.json`,
      expectedOutcome: 'refuse' as const, actualOutcome: 'refused' as const,
      beforeProjectSha256: '5'.repeat(64), afterProjectSha256: '5'.repeat(64),
      reportPath: `${scenario.caseId}-report.json`, reportSha256: '6'.repeat(64), outOfScopeWrites: 0,
    };
    receipt.reportSha256 = bytesSha(canonical(refusalReport(scenario)));
    return receipt;
  });
}

function positiveReport(receipt: T17CellReceipt) {
  const frameworkVersion = receipt.framework === 'vue' ? '3.5.45' : '19.3.1';
  const visualArtifact = { path: 'visual.png', sha256: '4'.repeat(64), bytes: 10 };
  return {
    schemaVersion: 1, projectRoot: receipt.projectRoot, planDigest: receipt.planSha256,
    applyResultDigest: receipt.applyResultSha256, specDigest: receipt.verificationSpecSha256,
    operation: 'verify', id: 'report-' + receipt.caseId, toolVersion: '0.0.14', verifiedAt: '2026-11-19T00:00:00.000Z', status: 'passed',
    checks: [
      { id: 'type', category: 'type', status: 'passed', issues: [], evidence: [] },
      { id: 'build', category: 'build', status: 'passed', issues: [], evidence: [] },
      { id: 'behavior', category: 'behavior', status: 'passed', issues: [], evidence: [] },
      { id: 'visual', category: 'visual', status: 'passed', issues: [], evidence: [visualArtifact] },
      { id: 'business', category: 'missing-business-info', status: 'passed', issues: [], evidence: [] },
      { id: 'dependency-guard', category: 'behavior', status: 'passed', issues: [], evidence: [] },
    ],
    changedFiles: [], snapshots: { before: [{ path: receipt.generatedPath, exists: true, sha256: receipt.generatedSha256 }], after: [{ path: receipt.generatedPath, exists: true, sha256: receipt.generatedSha256 }] },
    installedVersions: exactDependencies(receipt.framework).map((dependency) => ({ ...dependency, manifestSha256: '5'.repeat(64) })), visualResult: 'PASS',
    environment: { os: 'Windows', arch: 'x64', browserVersion: 'test', browserRevision: 'test', fontDigest: '6'.repeat(64), locale: 'zh-CN', timezone: 'Asia/Shanghai', deviceScaleFactor: 1, renderer: 'canvas', width: 640, height: 360, theme: 'light', frameworkVersion, echartsVersion: '6.1.0' },
    artifacts: [visualArtifact], pendingItems: [],
  };
}
function repairProof(receipt: T17CellReceipt) {
  const initial = positiveReport(receipt);
  initial.id = 'initial-' + receipt.caseId; initial.status = 'failed';
  initial.checks[0]!.status = 'failed';
  const issue = { code: 'TYPE_FAILED', message: 'Project type verification failed.' };
  initial.checks[0]!.issues.push(issue as never); initial.pendingItems.push(issue as never);
  initial.snapshots.before[0]!.sha256 = '8'.repeat(64); initial.snapshots.after[0]!.sha256 = '8'.repeat(64);
  const finalReport = positiveReport(receipt);
  const sourceReportDigest = canonicalEvidenceSha256(initial);
  const result = {
    schemaVersion: 1, operation: 'repair', projectRoot: receipt.projectRoot, planDigest: receipt.planSha256, applyResultDigest: receipt.applyResultSha256, specDigest: receipt.verificationSpecSha256,
    id: 'repair-' + receipt.caseId, sourceReportDigest, maxAttempts: 2,
    attempts: [{ attempt: 1, recipeId: 'regenerate-generated-component', beforeReportDigest: sourceReportDigest, afterReportDigest: canonicalEvidenceSha256(finalReport),
      changedFiles: [receipt.generatedPath], beforeHashes: initial.snapshots.after, afterHashes: finalReport.snapshots.before, backupRef: { id: 'repair-backup-' + receipt.caseId, sha256: '7'.repeat(64) } }],
    status: 'repaired', stopReason: 'passed', finalReport, changedFiles: [receipt.generatedPath], pendingItems: [],
  };
  return { initial, result };
}

function applyForReceipt(receipt: T17CellReceipt) {
  const path = 'src/generated/' + receipt.caseId + (receipt.framework === 'vue' ? '.vue' : '.tsx');
  const operationId = 'apply-' + receipt.caseId;
  return {
    schemaVersion: 1, operation: 'apply', operationId, projectRoot: receipt.projectRoot, planDigest: receipt.planSha256,
    status: 'applied', changedFiles: [path], beforeHashes: [{ path, exists: false }],
    afterHashes: [{ path, exists: true, sha256: '8'.repeat(64) }], installedVersions: [],
    issues: [], backupRef: { id: operationId, sha256: '7'.repeat(64) }, installState: 'not-run',
  };
}

function specForReceipt(receipt: T17CellReceipt) {
  return { schemaVersion: 1, projectRoot: receipt.projectRoot, planDigest: receipt.planSha256,
    applyResultDigest: receipt.applyResultSha256, commands: [], businessGaps: [] };
}

function interactionProof(receipt: T17CellReceipt) {
  const scenario = T17_POSITIVE_SCENARIOS.find((item) => item.caseId === receipt.caseId)!;
  const expected = scenario.browser.interaction!;
  return {
    schemaVersion: 1,
    caseId: scenario.caseId,
    framework: scenario.framework,
    host: scenario.host,
    projectRoot: receipt.projectRoot,
    actions: scenario.browser.actions.map((action) => ({
      action,
      status: 'passed',
      observed: { count: 1, ...(action.kind === 'fill' ? { text: action.value } : {}) },
    })),
    interaction: {
      selector: expected.selector,
      pattern: expected.pattern,
      expected: { from: expected.from, to: expected.to },
      before: expected.from,
      after: expected.to,
      status: 'passed',
    },
  };
}

function refusalReport(scenario: (typeof T17_REFUSAL_SCENARIOS)[number]) {
  return {
    schemaVersion: 1, caseId: scenario.caseId, kind: scenario.kind, focus: scenario.focus, reason: scenario.reason, setup: scenario.setup,
    framework: scenario.framework, packageManager: scenario.packageManager, expectedOutcome: 'refuse', actualOutcome: 'refused',
    issueCodes: scenario.expectedCodes ?? [],
    ...(scenario.expectedExit ? { exitCode: scenario.expectedExit[0] } : {}),
    ...(scenario.expectedStatus ? { status: scenario.expectedStatus[0] } : {}),
    ...(scenario.expectedVisual ? { visualResult: scenario.expectedVisual } : {}),
    ...(scenario.expectedDetection ? { detection: scenario.expectedDetection } : {}),
    ...(scenario.expectedRepair ? { repairStatus: scenario.expectedRepair } : {}),
    ...(scenario.assertNoRepairWrite ? { repairWrites: 0 } : {}),
    ...(scenario.assertNoSentinel ? { sentinelAbsent: true } : {}),
  };
}

function reportContents(positives: readonly T17CellReceipt[], refusals: readonly ReturnType<typeof passedRefusalReceipts>[number][]) {
  return Object.fromEntries([
    ...positives.flatMap((receipt) => [
      [receipt.planEvidencePath!, canonical(planForReceipt(receipt))] as const,
      [receipt.applyResultEvidencePath!, canonical(applyForReceipt(receipt))] as const,
      [receipt.verificationSpecEvidencePath!, canonical(specForReceipt(receipt))] as const,
    ]),
    ...positives.map((receipt) => [receipt.reportPath, canonical(positiveReport(receipt))] as const),
    ...positives.flatMap((receipt) => receipt.interaction?.evidencePath
      ? [[receipt.interaction.evidencePath, canonical(interactionProof(receipt))] as const]
      : []),
    ...positives.flatMap((receipt) => receipt.repair ? [[receipt.repair.initialReportPath, canonical(repairProof(receipt).initial)] as const, [receipt.repair.resultPath, canonical(repairProof(receipt).result)] as const] : []),
    ...refusals.map((receipt) => {
      const scenario = T17_REFUSAL_SCENARIOS.find((item) => item.caseId === receipt.caseId)!;
      return [receipt.reportPath, canonical(refusalReport(scenario))] as const;
    }),
  ]);
}

function planForReceipt(receipt: T17CellReceipt) {
  const scenario = T17_POSITIVE_SCENARIOS.find((item) => item.caseId === receipt.caseId)!;
  return planForScenario(scenario);
}

function planForScenario(scenario: (typeof T17_POSITIVE_SCENARIOS)[number]) {
  return {
    localProject: { framework: scenario.framework, packageManager: scenario.packageManager, workspace: scenario.workspace },
    exactDependencies: exactDependencies(scenario.framework),
    changes: [{ kind: 'generated-component', path: `src/generated/${scenario.caseId}.${scenario.framework === 'vue' ? 'vue' : 'tsx'}` }],
    sourceMatchPlan: {
      context: { framework: scenario.framework },
      elements: scenario.components.map((component) => ({
        instanceId: component.instanceId,
        target: { componentId: component.componentId, framework: scenario.framework },
      })),
    },
  };
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
    { name: receipt.interaction.evidencePath!, sha256: receipt.interaction.sha256!, bytes: Buffer.byteLength(canonical(interactionProof(receipt))) },
    { name: receipt.visualCheck.screenshotPath, sha256: receipt.visualCheck.screenshotSha256, bytes: 10 },
    { name: receipt.visualCheck.baselinePath!, sha256: receipt.visualCheck.baselineSha256, bytes: 10 },
    ...(receipt.repair ? [
      { name: receipt.repair.initialReportPath, sha256: receipt.repair.initialReportSha256, bytes: 10 },
      { name: receipt.repair.resultPath, sha256: receipt.repair.resultSha256, bytes: 10 },
    ] : []),
  ]);
}

function sealRefusalReceipts(receipts: ReturnType<typeof passedRefusalReceipts>) {
  return receipts.flatMap((receipt) => [
    { name: receipt.receiptEvidencePath, sha256: canonicalEvidenceSha256(receipt), bytes: 10 },
    { name: receipt.reportPath, sha256: receipt.reportSha256, bytes: 10 },
  ]);
}

describe('T17 独立 Vue / React 项目验收矩阵', () => {
  it('从磁盘 seal 加载修复初始报告与结果正文，保留原始封存字节', async () => {
    const root = await mkdtemp(join(tmpdir(), 't17-repair-seal-'));
    try {
      const filesRoot = join(root, 'files');
      await mkdir(filesRoot);
      const receipt = passedReceipt('V10', 'vue');
      const contents = { ...reportContents([receipt], []), [receipt.receiptEvidencePath]: canonical(receipt) };
      const files = [];
      for (const [name, content] of Object.entries(contents)) {
        await writeFile(join(filesRoot, name), content, { flag: 'wx' });
        files.push({ name, sha256: bytesSha(content), bytes: Buffer.byteLength(content) });
      }
      await writeFile(join(root, 'run-seal.json'), JSON.stringify({ schemaVersion: 1, runId: 'repair-loader-test', evidenceRoot: root, files,
        payload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA, receipts: [{ caseId: 'V10', kind: 'positive', evidencePath: receipt.receiptEvidencePath }] },
      }), { flag: 'wx' });
      const loaded = await loadT17MatrixInput(root, CLI_SHA, SDK_SHA);
      expect(loaded.positiveReceipts[0]!.repair).toEqual(receipt.repair);
      expect(loaded.evidenceContents[receipt.repair!.initialReportPath]).toBe(contents[receipt.repair!.initialReportPath]);
      expect(loaded.evidenceContents[receipt.repair!.resultPath]).toBe(contents[receipt.repair!.resultPath]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('要求修复的 V10/R10 不得仅凭普通 passed verify 报告计为成功', () => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    for (const receipt of receipts) delete receipt.repair;
    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: receipts, refusalReceipts: [],
      sealedFiles: sealPositiveReceipts(receipts), evidenceContents: reportContents(receipts, []),
    });
    expect(result.errors.some((error) => error.startsWith('V10:') && error.includes('repair'))).toBe(true);
    expect(result.errors.some((error) => error.startsWith('R10:') && error.includes('repair'))).toBe(true);
    expect(result.positive.passed).toBe(18);
  });

  it('封存的成功命令允许真实空 stdout/stderr，其他实质证据仍须非空', () => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    const emptySha = bytesSha('');
    for (const receipt of receipts) for (const command of receipt.commands) {
      command.stdoutSha256 = emptySha; command.stderrSha256 = emptySha;
    }
    const files = sealPositiveReceipts(receipts).map((file) => /\.(out|err)$/.test(file.name) ? { ...file, bytes: 0 } : file);
    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: receipts, refusalReceipts: [], sealedFiles: files, evidenceContents: reportContents(receipts, []),
    });
    expect(result.errors.filter((error) => /run-seal 文件条目无效|typecheck 未通过|build 未通过/.test(error))).toEqual([]);
  });

  it.each(['unsealed', 'zero-attempts', 'initial-passed', 'wrong-project', 'broken-chain', 'wrong-final-digest', 'different-final-report', 'unchanged-source'] as const)('拒绝不真实或摘要断链的 repair 证据：%s', (fault) => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    const receipt = receipts.find((item) => item.caseId === 'V10')!;
    const proof = repairProof(receipt);
    if (fault === 'zero-attempts') { proof.result.attempts = []; proof.result.changedFiles = []; }
    if (fault === 'initial-passed') Object.assign(proof.initial, positiveReport(receipt));
    if (fault === 'wrong-project') proof.initial.projectRoot = 'C:/matrix/other-project';
    if (fault === 'broken-chain') proof.result.attempts[0]!.beforeReportDigest = 'a'.repeat(64);
    if (fault === 'wrong-final-digest') proof.result.attempts[0]!.afterReportDigest = 'a'.repeat(64);
    if (fault === 'different-final-report') {
      proof.result.finalReport.id = 'different-valid-report';
      proof.result.attempts[0]!.afterReportDigest = canonicalEvidenceSha256(proof.result.finalReport);
    }
    if (fault === 'unchanged-source') {
      proof.initial.snapshots.before[0]!.sha256 = receipt.generatedSha256;
      proof.initial.snapshots.after[0]!.sha256 = receipt.generatedSha256;
      proof.result.sourceReportDigest = canonicalEvidenceSha256(proof.initial);
      proof.result.attempts[0]!.beforeReportDigest = proof.result.sourceReportDigest;
    }
    receipt.repair!.initialReportSha256 = canonicalEvidenceSha256(proof.initial);
    receipt.repair!.resultSha256 = canonicalEvidenceSha256(proof.result);
    const evidence = { ...reportContents(receipts, []), [receipt.repair!.initialReportPath]: canonical(proof.initial), [receipt.repair!.resultPath]: canonical(proof.result) };
    const files = sealPositiveReceipts(receipts).filter((file) => fault !== 'unsealed' || file.name !== receipt.repair!.resultPath);
    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: receipts, refusalReceipts: [], sealedFiles: files, evidenceContents: evidence,
    });
    expect(result.positive.passed).toBe(19);
    expect(result.errors.some((error) => error.startsWith('V10: repair'))).toBe(true);
  });

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
      evidenceContents: reportContents(receipts, passedRefusalReceipts()),
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
      evidenceContents: reportContents(incomplete, []),
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
      evidenceContents: reportContents(malformed, []),
    });
    expect(result.positive.passed).toBe(0);
    expect(result.matrixAccepted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('拒绝项必须明确拒绝且项目前后摘要一致，拒绝结果不增加正向分母', () => {
    const refusalReceipts = passedRefusalReceipts();
    const positives = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));

    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA,
      expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: positives,
      refusalReceipts,
      sealedFiles: [...sealPositiveReceipts(positives), ...sealRefusalReceipts(refusalReceipts)],
      evidenceContents: reportContents(positives, refusalReceipts),
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
      evidenceContents: reportContents(positives, refusalReceipts),
    });
    expect(acceptedBadRefusal.refusals.passed).toBe(T17_REFUSAL_SCENARIOS.length - 1);
    expect(acceptedBadRefusal.matrixAccepted).toBe(false);
  });

  it('读取正向报告正文并拒绝未通过的 status 或 checks', () => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    const first = receipts[0]!;
    const content = canonical({ ...positiveReport(first), status: 'failed' });
    receipts[0] = { ...first, reportSha256: bytesSha(content) };
    const input = {
      expectedCliTarballSha256: CLI_SHA,
      expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: receipts,
      refusalReceipts: [],
      sealedFiles: sealPositiveReceipts(receipts),
      evidenceContents: { ...reportContents(receipts, []), [first.reportPath]: content },
    };

    const result = evaluateT17Matrix(input);
    expect(result.positive.passed).toBe(19);
    expect(result.matrixAccepted).toBe(false);
    expect(result.errors.join(' ')).toMatch(/report|报告/i);
  });

  it('拒绝摘要正确封存但结构为空的 apply 结果或 verification spec', () => {
    for (const invalidEvidence of ['apply', 'spec'] as const) {
      const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
      const original = receipts[0]!;
      const emptyDigest = canonicalEvidenceSha256({});
      const tampered: T17CellReceipt = invalidEvidence === 'apply'
        ? { ...original, applyResultSha256: emptyDigest }
        : { ...original, verificationSpecSha256: emptyDigest };
      tampered.reportSha256 = bytesSha(canonical(positiveReport(tampered)));
      receipts[0] = tampered;
      const evidenceContents = reportContents(receipts, []);
      evidenceContents[invalidEvidence === 'apply' ? tampered.applyResultEvidencePath! : tampered.verificationSpecEvidencePath!] = canonical({});
      const result = evaluateT17Matrix({
        expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
        sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
        positiveReceipts: receipts, refusalReceipts: [], sealedFiles: sealPositiveReceipts(receipts), evidenceContents,
      });

      expect(result.positive.passed, invalidEvidence).toBe(19);
      expect(result.matrixAccepted, invalidEvidence).toBe(false);
      expect(result.errors.join(' '), invalidEvidence).toMatch(/apply|spec|规范/i);
    }
  });

  it('拒绝与计划精确依赖版本不一致的已安装版本报告', () => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    const first = receipts[0]!;
    const report = positiveReport(first);
    report.installedVersions[0] = { ...report.installedVersions[0]!, version: '99.0.0' };
    const content = canonical(report);
    receipts[0] = { ...first, reportSha256: bytesSha(content) };
    const input = {
      expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: receipts, refusalReceipts: [],
      sealedFiles: sealPositiveReceipts(receipts),
      evidenceContents: { ...reportContents(receipts, []), [first.reportPath]: content },
    };

    const result = evaluateT17Matrix(input);
    expect(result.positive.passed).toBe(19);
    expect(result.matrixAccepted).toBe(false);
    expect(result.errors.join(' ')).toMatch(/dependenc|installedVersions|安装依赖/i);
  });

  it('不采信交互回执自报值，逐项核对封存正文与场景身份、动作、选择器和计数', () => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    const first = receipts[0]!;
    const proof = interactionProof(first);
    const mismatches = [
      { ...proof, caseId: 'V02' },
      { ...proof, framework: 'react' },
      { ...proof, host: 'next-app-router' },
      { ...proof, projectRoot: 'C:/matrix/other' },
      { ...proof, actions: [{ ...proof.actions[0]!, action: { ...proof.actions[0]!.action, selector: '[data-testid=wrong-chart]' } }] },
      { ...proof, actions: [{ ...proof.actions[0]!, status: 'failed' }] },
      { ...proof, interaction: { ...proof.interaction, selector: '[data-testid=wrong-counter]' } },
      { ...proof, interaction: { ...proof.interaction, pattern: 'other=(\\d+)' } },
      { ...proof, interaction: { ...proof.interaction, expected: { ...proof.interaction.expected, from: 5 } } },
      { ...proof, interaction: { ...proof.interaction, before: 5 } },
      { ...proof, interaction: { ...proof.interaction, after: 0 } },
      { ...proof, interaction: { ...proof.interaction, status: 'failed' } },
    ];

    for (const [index, invalidProof] of mismatches.entries()) {
      const interactionEvidence = canonical(invalidProof);
      const digest = bytesSha(interactionEvidence);
      const path = `V01-interaction-${index}.json`;
      const target = { ...first, interaction: { ...first.interaction, evidencePath: path, sha256: digest } };
      receipts[0] = target;
      const allEvidence = reportContents(receipts, []);
      allEvidence[path] = interactionEvidence;
      const sealedFiles = sealPositiveReceipts(receipts);
      sealedFiles.push({ name: path, sha256: digest, bytes: Buffer.byteLength(interactionEvidence) });

      const result = evaluateT17Matrix({
        expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
        sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
        positiveReceipts: receipts, refusalReceipts: [], sealedFiles, evidenceContents: allEvidence,
      });

      expect(result.positive.passed, `mismatch ${index}`).toBe(19);
      expect(result.matrixAccepted, `mismatch ${index}`).toBe(false);
      expect(result.errors.join(' '), `mismatch ${index}`).toMatch(/interaction|交互/i);
      receipts[0] = first;
    }

    for (const interaction of [
      { ...first.interaction, action: 'unrelated-action' },
      { ...first.interaction, before: first.interaction.before + 1 },
      { ...first.interaction, after: first.interaction.after + 1 },
    ]) {
      const tampered = { ...first, interaction };
      const positives = [...receipts];
      positives[0] = tampered;
      const result = evaluateT17Matrix({
        expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
        sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
        positiveReceipts: positives, refusalReceipts: [], sealedFiles: sealPositiveReceipts(positives),
        evidenceContents: reportContents(positives, []),
      });
      expect(result.positive.passed).toBe(19);
      expect(result.matrixAccepted).toBe(false);
      expect(result.errors.join(' ')).toMatch(/interaction|交互/i);
    }
  });

  it('交互正文缺失或字节摘要不匹配时不计为通过', () => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    const first = receipts[0]!;
    const evidenceContents = reportContents(receipts, []);
    evidenceContents[first.interaction.evidencePath!] = '{}';
    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: receipts, refusalReceipts: [], sealedFiles: sealPositiveReceipts(receipts), evidenceContents,
    });
    expect(result.positive.passed).toBe(19);
    expect(result.matrixAccepted).toBe(false);
    expect(result.errors.join(' ')).toMatch(/interaction|交互/i);
  });

  it('按拒绝案例核对报告 issue code，通用拒绝报告不能替代预期问题', () => {
    const positives = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    const refusals = passedRefusalReceipts();
    const target = T17_REFUSAL_SCENARIOS.find((scenario) => scenario.expectedCodes?.length)!;
    const receipt = refusals.find((item) => item.caseId === target.caseId)!;
    const content = canonical({ ...refusalReport(target), issueCodes: ['UNRELATED_FAILURE'] });
    const updatedRefusals = refusals.map((item) => item.caseId === target.caseId
      ? { ...item, reportSha256: bytesSha(content) }
      : item);
    const input = {
      expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: positives, refusalReceipts: updatedRefusals,
      sealedFiles: [...sealPositiveReceipts(positives), ...sealRefusalReceipts(updatedRefusals)],
      evidenceContents: { ...reportContents(positives, updatedRefusals), [receipt.reportPath]: content },
    };

    const result = evaluateT17Matrix(input);
    expect(result.refusals.passed).toBe(T17_REFUSAL_SCENARIOS.length - 1);
    expect(result.matrixAccepted).toBe(false);
  });

  it('receipt 中的字符串 false 不得作为合法布尔证据通过', () => {
    const receipts = T17_POSITIVE_SCENARIOS.map((scenario) => passedReceipt(scenario.caseId, scenario.framework));
    receipts[0] = {
      ...receipts[0]!,
      cleanup: { ...receipts[0]!.cleanup, evidenceRetained: 'false' as unknown as boolean },
    };
    const result = evaluateT17Matrix({
      expectedCliTarballSha256: CLI_SHA, expectedFrozenBundleSha256: SDK_SHA,
      sealPayload: { cliTarballSha256: CLI_SHA, frozenBundleSha256: SDK_SHA },
      positiveReceipts: receipts, refusalReceipts: [], sealedFiles: sealPositiveReceipts(receipts),
      evidenceContents: reportContents(receipts, []),
    });
    expect(result.positive.passed).toBe(19);
    expect(result.matrixAccepted).toBe(false);
  });
});
