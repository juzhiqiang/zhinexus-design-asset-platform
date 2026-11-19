import { T17_POSITIVE_SCENARIOS, T17_REFUSAL_SCENARIOS, validateT17ScenarioMatrix } from '../../fixtures/t17-matrix/scenarios.js';
import type { T17Framework, T17PackageManager } from '../../fixtures/t17-matrix/scenarios.js';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

type Sha256 = string;
type CommandEvidence = { kind: 'typecheck' | 'build'; exitCode: number; evidencePath: string; sha256: Sha256; stdoutEvidencePath: string; stdoutSha256: Sha256; stderrEvidencePath: string; stderrSha256: Sha256 };
type BrowserAssetEvidence = { path: string; evidencePath?: string; url: string; sha256: Sha256; bytes: number; status: 'loaded' | 'missing' | 'failed' };
export type T17CellReceipt = {
  caseId: string; framework: T17Framework; packageManager: T17PackageManager; host: 'vite' | 'next-app-router';
  expectedOutcome: 'pass'; actualOutcome: 'pass' | 'failed' | 'skipped' | 'blocked'; sourceKind: 'temporary-host' | 'authorized-business-project';
  receiptEvidencePath: string; cliTarballSha256: Sha256; frozenBundleSha256: Sha256; planSha256: Sha256; applyResultSha256: Sha256; verificationSpecSha256: Sha256; reportSha256: Sha256; reportPath: string;
  planEvidencePath?: string; applyResultEvidencePath?: string; verificationSpecEvidencePath?: string; generatedEvidencePath?: string;
  commands: CommandEvidence[]; generatedPath: string; generatedSha256: Sha256; browserAssets: BrowserAssetEvidence[];
  interaction: { action: string; observed: boolean; before: number; after: number; evidencePath?: string; sha256?: Sha256 };
  visualCheck: { status: 'passed' | 'failed'; screenshotPath: string; screenshotSha256: Sha256; baselineSha256: Sha256; baselinePath?: string };
  outOfScopeWrites: number; lostUserEdits: number;
  cleanup: { projectRootRemoved: boolean; evidenceRetained: boolean; userProjectPreserved: boolean };
};
export type T17RefusalReceipt = { caseId: string; receiptEvidencePath: string; expectedOutcome: 'refuse'; actualOutcome: 'refused' | 'accepted' | 'error' | 'skipped' | 'blocked'; beforeProjectSha256: Sha256; afterProjectSha256: Sha256; reportPath: string; reportSha256: Sha256; outOfScopeWrites: number };
export type T17SealedFile = { name: string; sha256: Sha256; bytes: number };
export type T17MatrixInput = { expectedCliTarballSha256: Sha256; expectedFrozenBundleSha256: Sha256; sealPayload: { cliTarballSha256: Sha256; frozenBundleSha256: Sha256 }; positiveReceipts: readonly T17CellReceipt[]; refusalReceipts: readonly T17RefusalReceipt[]; sealedFiles: readonly T17SealedFile[] };
export type T17Score = { total: number; passed: number; required: number; rate: number };
export type T17MatrixResult = { positive: T17Score; frameworks: Record<T17Framework, T17Score>; refusals: { total: number; passed: number }; matrixAccepted: boolean; failures: string[]; errors: string[] };

const SHA256 = /^[a-f0-9]{64}$/;
function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
const PLACEHOLDER = new Set(['0'.repeat(64), 'f'.repeat(64)]);
const isSha = (value: string) => SHA256.test(value);
const hasEvidence = (value: string) => isSha(value) && !PLACEHOLDER.has(value);
const score = (total: number, passed: number): T17Score => ({ total, passed, required: Math.ceil(total * 0.8), rate: total ? passed / total : 0 });
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
    return JSON.stringify(value) ?? 'null';
}
export function canonicalEvidenceSha256(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isPositiveReceipt(value: unknown): value is T17CellReceipt {
  if (!isRecord(value) || !Array.isArray(value.commands) || !value.commands.every(isRecord) || !Array.isArray(value.browserAssets) || !value.browserAssets.every(isRecord)) return false;
  if (!isRecord(value.interaction) || !isRecord(value.visualCheck) || !isRecord(value.cleanup)) return false;
  return typeof value.caseId === 'string' && typeof value.receiptEvidencePath === 'string';
}
function isRefusalReceipt(value: unknown): value is T17RefusalReceipt {
  return isRecord(value) && typeof value.caseId === 'string' && typeof value.receiptEvidencePath === 'string';
}

type T17RunSeal = {
  schemaVersion: number;
  runId: string;
  evidenceRoot: string;
  payload: {
    cliTarballSha256: string;
    frozenBundleSha256: string;
    receipts: { caseId: string; kind: 'positive' | 'refusal'; evidencePath: string }[];
  };
  files: T17SealedFile[];
};

export async function loadT17MatrixInput(evidenceRoot: string, expectedCliTarballSha256: string, expectedFrozenBundleSha256: string): Promise<T17MatrixInput> {
  const root = await realpath(resolve(evidenceRoot));
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('T17 evidence root must be a real directory.');
  const sealPath = join(root, 'run-seal.json');
  const sealStat = await lstat(sealPath);
  if (!sealStat.isFile() || sealStat.isSymbolicLink() || sealStat.nlink > 1) throw new Error('T17 run seal must be a regular file.');
  const seal = JSON.parse(await readFile(sealPath, 'utf8')) as T17RunSeal;
  if (seal.schemaVersion !== 1 || typeof seal.runId !== 'string' || !seal.runId || await realpath(seal.evidenceRoot) !== root) throw new Error('T17 run seal identity does not match the evidence root.');
  if (!Array.isArray(seal.files) || !Array.isArray(seal.payload?.receipts)) throw new Error('T17 run seal is missing its file or receipt inventory.');
  const filesRoot = join(root, 'files');
  const filesRootStat = await lstat(filesRoot);
  if (!filesRootStat.isDirectory() || filesRootStat.isSymbolicLink()) throw new Error('T17 sealed files root must be a real directory.');
  const actualNames = (await readdir(filesRoot)).sort();
  const declaredNames = seal.files.map((file) => file.name).sort();
  if (new Set(declaredNames).size !== declaredNames.length || actualNames.length !== declaredNames.length || actualNames.some((name, index) => name !== declaredNames[index])) throw new Error('T17 sealed file inventory differs from evidence directory.');
  for (const file of seal.files) {
    if (!file.name || basename(file.name) !== file.name || file.name.includes('\\') || file.name === '.' || file.name === '..') throw new Error('T17 sealed file name is unsafe.');
    const path = join(filesRoot, file.name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error('T17 evidence entries must be regular unlinked files.');
    const bytes = await readFile(path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== file.bytes || digest !== file.sha256) throw new Error('T17 evidence file digest or byte count differs from run seal: ' + file.name);
  }
  const positiveReceipts: T17CellReceipt[] = [];
  const refusalReceipts: T17RefusalReceipt[] = [];
  const receiptCases = new Set<string>();
  for (const reference of seal.payload.receipts) {
    if (!reference.caseId || receiptCases.has(reference.caseId) || !['positive', 'refusal'].includes(reference.kind) || !reference.evidencePath || basename(reference.evidencePath) !== reference.evidencePath) throw new Error('T17 run seal has an invalid or duplicate receipt index.');
    receiptCases.add(reference.caseId);
    const bytes = await readFile(join(filesRoot, reference.evidencePath));
    let receipt: T17CellReceipt | T17RefusalReceipt;
    try { receipt = JSON.parse(bytes.toString('utf8')) as T17CellReceipt | T17RefusalReceipt; } catch { throw new Error('T17 receipt evidence is not valid JSON: ' + reference.caseId); }
    if (receipt.caseId !== reference.caseId || receipt.receiptEvidencePath !== reference.evidencePath || !Buffer.from(canonicalJson(receipt)).equals(bytes)) throw new Error('T17 receipt identity or canonical bytes differ from its run seal index: ' + reference.caseId);
    if (reference.kind === 'positive') positiveReceipts.push(receipt as T17CellReceipt);
    else refusalReceipts.push(receipt as T17RefusalReceipt);
  }
  return {
    expectedCliTarballSha256,
    expectedFrozenBundleSha256,
    sealPayload: { cliTarballSha256: seal.payload.cliTarballSha256, frozenBundleSha256: seal.payload.frozenBundleSha256 },
    positiveReceipts,
    refusalReceipts,
    sealedFiles: seal.files,
  };
}

function sealedFileMatches(files: ReadonlyMap<string, T17SealedFile>, path: string | undefined, sha256: string | undefined): boolean {
  if (!path || path.includes('/') || path.includes('\\') || path === '.' || path === '..' || !sha256) return false;
  const file = files.get(path);
  return Boolean(file && file.sha256 === sha256 && hasEvidence(file.sha256) && file.bytes > 0);
}

function positiveErrors(receipt: T17CellReceipt, scenarioId: string, cliSha: string, bundleSha: string, files: ReadonlyMap<string, T17SealedFile>): string[] {
  const errors: string[] = [];
  const scenario = T17_POSITIVE_SCENARIOS.find((item) => item.caseId === scenarioId);
  if (!scenario) return ['未知正向 caseId: ' + scenarioId];
  if (!sealedFileMatches(files, receipt.receiptEvidencePath, canonicalEvidenceSha256(receipt))) errors.push(scenarioId + ': receipt 内容未与 run-seal 摘要绑定');
  if (receipt.framework !== scenario.framework || receipt.packageManager !== scenario.packageManager || receipt.host !== scenario.host) errors.push(scenarioId + ': 场景身份不一致');
  if (receipt.expectedOutcome !== 'pass' || !['pass', 'failed', 'skipped', 'blocked'].includes(receipt.actualOutcome)) errors.push(scenarioId + ': outcome 无效');
  if (receipt.cliTarballSha256 !== cliSha || !isSha(receipt.cliTarballSha256)) errors.push(scenarioId + ': CLI 冻结包摘要缺失或不一致');
  if (receipt.frozenBundleSha256 !== bundleSha || !isSha(receipt.frozenBundleSha256)) errors.push(scenarioId + ': SDK 冻结包摘要缺失或不一致');
  for (const [name, digest] of [['plan', receipt.planSha256], ['apply', receipt.applyResultSha256], ['verification', receipt.verificationSpecSha256], ['report', receipt.reportSha256], ...(receipt.actualOutcome === 'pass' ? [['generated', receipt.generatedSha256] as const] : [])] as const) if (!hasEvidence(digest)) errors.push(scenarioId + ': ' + name + ' 证据摘要无效');
  if (!receipt.reportPath || receipt.reportPath.startsWith('/') || receipt.reportPath.includes('..')) errors.push(scenarioId + ': 报告路径不安全');
  if (!sealedFileMatches(files, receipt.reportPath, receipt.reportSha256)) errors.push(scenarioId + ': 报告未被 run-seal 按同一摘要封存');
  if (!sealedFileMatches(files, receipt.planEvidencePath, receipt.planSha256)) errors.push(scenarioId + ': 计划文件未被 run-seal 封存');
  if (!sealedFileMatches(files, receipt.applyResultEvidencePath, receipt.applyResultSha256)) errors.push(scenarioId + ': apply 结果未被 run-seal 封存');
  if (!sealedFileMatches(files, receipt.verificationSpecEvidencePath, receipt.verificationSpecSha256)) errors.push(scenarioId + ': 验证规范未被 run-seal 封存');
  if (receipt.actualOutcome === 'pass' && !sealedFileMatches(files, receipt.generatedEvidencePath, receipt.generatedSha256)) errors.push(scenarioId + ': 生成文件副本未被 run-seal 封存');
  if (receipt.actualOutcome === 'pass' && (!receipt.generatedPath || !/\.(vue|tsx)$/.test(receipt.generatedPath))) errors.push(scenarioId + ': 缺少生成文件');
  const commands = new Map(receipt.commands.map((command) => [command.kind, command]));
  for (const kind of ['typecheck', 'build'] as const) { const command = commands.get(kind); if (!command || (receipt.actualOutcome === 'pass' && command.exitCode !== 0) || !sealedFileMatches(files, command.evidencePath, command.sha256) || !sealedFileMatches(files, command.stdoutEvidencePath, command.stdoutSha256) || !sealedFileMatches(files, command.stderrEvidencePath, command.stderrSha256)) errors.push(scenarioId + ': ' + kind + ' 未通过或缺少封存证据'); }
  if (commands.size !== receipt.commands.length) errors.push(scenarioId + ': 验证命令重复');
  if (receipt.actualOutcome === 'pass' && !receipt.browserAssets.some((asset) => asset.status === 'loaded' && isLoopbackUrl(asset.url) && asset.bytes > 0 && sealedFileMatches(files, asset.evidencePath, asset.sha256))) errors.push(scenarioId + ': 缺少已封存的 loopback 资源证据');
  if (receipt.actualOutcome === 'pass' && (!receipt.interaction.observed || !receipt.interaction.action || receipt.interaction.after <= receipt.interaction.before || !sealedFileMatches(files, receipt.interaction.evidencePath, receipt.interaction.sha256))) errors.push(scenarioId + ': 缺少封存的可观察交互');
  if (receipt.actualOutcome === 'pass' && (receipt.visualCheck.status !== 'passed' || !sealedFileMatches(files, receipt.visualCheck.screenshotPath, receipt.visualCheck.screenshotSha256) || !sealedFileMatches(files, receipt.visualCheck.baselinePath, receipt.visualCheck.baselineSha256))) errors.push(scenarioId + ': 缺少封存的视觉证据');
  if (receipt.outOfScopeWrites !== 0) errors.push(scenarioId + ': 存在越界写入');
  if (receipt.lostUserEdits !== 0) errors.push(scenarioId + ': 存在用户修改丢失');
  if (!receipt.cleanup.evidenceRetained || (receipt.sourceKind === 'temporary-host' && !receipt.cleanup.projectRootRemoved) || (receipt.sourceKind === 'authorized-business-project' && !receipt.cleanup.userProjectPreserved)) errors.push(scenarioId + ': 清理或证据留存不完整');
  return errors;
}

function refusalErrors(receipt: T17RefusalReceipt, scenarioId: string, files: ReadonlyMap<string, T17SealedFile>): string[] {
  const errors: string[] = [];
  if (!sealedFileMatches(files, receipt.receiptEvidencePath, canonicalEvidenceSha256(receipt))) errors.push(scenarioId + ': 拒绝 receipt 未与 run-seal 摘要绑定');
  if (receipt.expectedOutcome !== 'refuse' || receipt.actualOutcome !== 'refused') errors.push(scenarioId + ': 必须实测拒绝');
  if (!hasEvidence(receipt.beforeProjectSha256) || receipt.beforeProjectSha256 !== receipt.afterProjectSha256) errors.push(scenarioId + ': 拒绝前后摘要不一致');
  if (!sealedFileMatches(files, receipt.reportPath, receipt.reportSha256)) errors.push(scenarioId + ': 拒绝报告未封存');
  if (receipt.outOfScopeWrites !== 0) errors.push(scenarioId + ': 拒绝产生越界写入');
  return errors;
}

export function evaluateT17Matrix(input: T17MatrixInput): T17MatrixResult {
  const errors = [...validateT17ScenarioMatrix().errors];
  const failures: string[] = [];
  if (input.sealPayload.cliTarballSha256 !== input.expectedCliTarballSha256 || input.sealPayload.frozenBundleSha256 !== input.expectedFrozenBundleSha256) errors.push('run-seal payload 冻结产物摘要与验收输入不一致');
  const sealedFiles = new Map<string, T17SealedFile>();
  for (const file of input.sealedFiles) {
    if (sealedFiles.has(file.name)) errors.push('run-seal 文件名重复: ' + file.name);
    else sealedFiles.set(file.name, file);
    if (!isSha(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) errors.push('run-seal 文件条目无效: ' + file.name);
  }
  if (!isSha(input.expectedCliTarballSha256)) errors.push('预期 CLI 冻结包 SHA-256 无效');
  if (!isSha(input.expectedFrozenBundleSha256)) errors.push('预期 SDK 冻结包 SHA-256 无效');
  const positive = new Map<string, T17CellReceipt>();
  for (const receipt of input.positiveReceipts) { if (!T17_POSITIVE_SCENARIOS.some((item) => item.caseId === receipt.caseId)) errors.push('未知正向案例: ' + receipt.caseId); else if (positive.has(receipt.caseId)) errors.push('正向案例重复: ' + receipt.caseId); else positive.set(receipt.caseId, receipt); }
  const refusals = new Map<string, T17RefusalReceipt>();
  for (const receipt of input.refusalReceipts) { if (!T17_REFUSAL_SCENARIOS.some((item) => item.caseId === receipt.caseId)) errors.push('未知拒绝案例: ' + receipt.caseId); else if (refusals.has(receipt.caseId)) errors.push('拒绝案例重复: ' + receipt.caseId); else refusals.set(receipt.caseId, receipt); }
  let positivePassed = 0; const byFramework = { vue: { total: 0, passed: 0 }, react: { total: 0, passed: 0 } };
  for (const scenario of T17_POSITIVE_SCENARIOS) {
    byFramework[scenario.framework].total++; const receipt = positive.get(scenario.caseId);
    if (!receipt) { errors.push('正向案例缺失: ' + scenario.caseId); continue; }
    if (!isPositiveReceipt(receipt)) { errors.push(scenario.caseId + ': 正向 receipt 结构不完整'); continue; }
    const before = errors.length; errors.push(...positiveErrors(receipt, scenario.caseId, input.expectedCliTarballSha256, input.expectedFrozenBundleSha256, sealedFiles));
    if (errors.length === before && receipt.actualOutcome === 'pass') { positivePassed++; byFramework[scenario.framework].passed++; }
    else if (errors.length === before) failures.push(scenario.caseId + ': 已运行并留存失败报告');
  }
  let refusalPassed = 0;
  for (const scenario of T17_REFUSAL_SCENARIOS) { const receipt = refusals.get(scenario.caseId); if (!receipt) { errors.push('拒绝案例缺失: ' + scenario.caseId); continue; } if (!isRefusalReceipt(receipt)) { errors.push(scenario.caseId + ': 拒绝 receipt 结构不完整'); continue; } const before = errors.length; errors.push(...refusalErrors(receipt, scenario.caseId, sealedFiles)); if (errors.length === before) refusalPassed++; }
  const positiveScore = score(T17_POSITIVE_SCENARIOS.length, positivePassed);
  const frameworkScores = { vue: score(byFramework.vue.total, byFramework.vue.passed), react: score(byFramework.react.total, byFramework.react.passed) };
  const refusalScore = { total: T17_REFUSAL_SCENARIOS.length, passed: refusalPassed };
  return { positive: positiveScore, frameworks: frameworkScores, refusals: refusalScore, matrixAccepted: positiveScore.passed >= positiveScore.required && frameworkScores.vue.passed >= frameworkScores.vue.required && frameworkScores.react.passed >= frameworkScores.react.required && refusalPassed === refusalScore.total && errors.length === 0, failures, errors };
}
