import { T17_POSITIVE_SCENARIOS, T17_REFUSAL_SCENARIOS, validateT17ScenarioMatrix } from '../../fixtures/t17-matrix/scenarios.js';
import type { T17Framework, T17PackageManager } from '../../fixtures/t17-matrix/scenarios.js';
import { validateIntegrationApplyResult, validateIntegrationPlan, validateIntegrationRepairResult, validateIntegrationVerificationReport, validateIntegrationVerificationSpec } from '@company/contracts';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

type Sha256 = string;
type CommandEvidence = { kind: 'typecheck' | 'build'; exitCode: number; evidencePath: string; sha256: Sha256; stdoutEvidencePath: string; stdoutSha256: Sha256; stderrEvidencePath: string; stderrSha256: Sha256 };
type BrowserAssetEvidence = { path: string; evidencePath?: string; url: string; sha256: Sha256; bytes: number; status: 'loaded' | 'missing' | 'failed' };
type BudgetEvidenceRef = { evidencePath: string; sha256: Sha256 };
export type T17BudgetRepairEvidence = {
  plan: BudgetEvidenceRef; applyResult: BudgetEvidenceRef; spec: BudgetEvidenceRef; initialReport: BudgetEvidenceRef; result: BudgetEvidenceRef;
  sourceBefore: BudgetEvidenceRef; sourceAfter: BudgetEvidenceRef; backups: BudgetEvidenceRef[];
  generatedSources: { path: string; before: BudgetEvidenceRef; after: BudgetEvidenceRef }[];
};
export type T17CellReceipt = {
  caseId: string; framework: T17Framework; packageManager: T17PackageManager; host: 'vite' | 'next-app-router';
  projectRoot: string; scenarioIdentity: { topology: 'standalone' | 'workspace'; workspace: string; hostMode: string; components: { componentId: string; instanceId: string; dataState: string }[] };
  expectedOutcome: 'pass'; actualOutcome: 'pass' | 'failed' | 'skipped' | 'blocked'; sourceKind: 'temporary-host' | 'authorized-business-project';
  receiptEvidencePath: string; cliTarballSha256: Sha256; frozenBundleSha256: Sha256; planSha256: Sha256; applyResultSha256: Sha256; verificationSpecSha256: Sha256; reportSha256: Sha256; reportPath: string;
  planEvidencePath?: string; applyResultEvidencePath?: string; verificationSpecEvidencePath?: string; generatedEvidencePath?: string;
  repair?: { initialReportPath: string; initialReportSha256: Sha256; resultPath: string; resultSha256: Sha256 };
  commands: CommandEvidence[]; generatedPath: string; generatedSha256: Sha256; browserAssets: BrowserAssetEvidence[];
  interaction: { action: string; observed: boolean; before: number; after: number; evidencePath?: string; sha256?: Sha256 };
  visualCheck: { status: 'passed' | 'failed'; screenshotPath: string; screenshotSha256: Sha256; baselineSha256: Sha256; baselinePath?: string };
  outOfScopeWrites: number; lostUserEdits: number;
  cleanup: { projectRootRemoved: boolean; evidenceRetained: boolean; userProjectPreserved: boolean };
};
export type T17RefusalReceipt = { caseId: string; framework: T17Framework; packageManager: T17PackageManager; scenarioIdentity: { kind: string; focus: string; reason: string; setup: string }; receiptEvidencePath: string; expectedOutcome: 'refuse'; actualOutcome: 'refused' | 'accepted' | 'error' | 'skipped' | 'blocked'; beforeProjectSha256: Sha256; afterProjectSha256: Sha256; reportPath: string; reportSha256: Sha256; outOfScopeWrites: number };
export type T17SealedFile = { name: string; sha256: Sha256; bytes: number };
export type T17MatrixInput = { expectedCliTarballSha256: Sha256; expectedFrozenBundleSha256: Sha256; sealPayload: { cliTarballSha256: Sha256; frozenBundleSha256: Sha256 }; positiveReceipts: readonly T17CellReceipt[]; refusalReceipts: readonly T17RefusalReceipt[]; sealedFiles: readonly T17SealedFile[]; evidenceContents: Readonly<Record<string, string>> };
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
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const nonnegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const validSha = (value: unknown): value is string => typeof value === 'string' && isSha(value);
const safeEvidenceName = (value: unknown): value is string => nonempty(value) && basename(value) === value && !value.includes('\\') && value !== '.' && value !== '..';
function validScenarioIdentity(value: unknown): value is T17CellReceipt['scenarioIdentity'] {
  if (!isRecord(value) || !hasOnlyKeys(value, ['topology','workspace','hostMode','components']) || !['standalone', 'workspace'].includes(String(value.topology)) || !nonempty(value.workspace) || !nonempty(value.hostMode) || !Array.isArray(value.components)) return false;
  return value.components.every((component) => isRecord(component) && hasOnlyKeys(component, ['componentId','instanceId','dataState']) && nonempty(component.componentId) && nonempty(component.instanceId) && nonempty(component.dataState));
}
function isCommandEvidence(value: unknown): value is CommandEvidence {
  return isRecord(value) && hasOnlyKeys(value, ['kind','exitCode','evidencePath','sha256','stdoutEvidencePath','stdoutSha256','stderrEvidencePath','stderrSha256']) && (value.kind === 'typecheck' || value.kind === 'build') && nonnegativeInteger(value.exitCode) && safeEvidenceName(value.evidencePath) && validSha(value.sha256) && safeEvidenceName(value.stdoutEvidencePath) && validSha(value.stdoutSha256) && safeEvidenceName(value.stderrEvidencePath) && validSha(value.stderrSha256);
}
function isBrowserAssetEvidence(value: unknown): value is BrowserAssetEvidence {
  return isRecord(value) && hasOnlyKeys(value, ['path','url','sha256','bytes','status'], ['evidencePath']) && nonempty(value.path) && nonempty(value.url) && validSha(value.sha256) && nonnegativeInteger(value.bytes) && ['loaded', 'missing', 'failed'].includes(String(value.status)) && (value.evidencePath === undefined || safeEvidenceName(value.evidencePath));
}
function isBrowserActionEvidence(value: unknown): value is { action: unknown; status: 'passed' | 'failed'; observed: { count: number; text?: string } } {
  return isRecord(value)
    && hasOnlyKeys(value, ['action','status','observed'])
    && isRecord(value.action)
    && hasOnlyKeys(value.action, ['kind','selector'], ['value'])
    && ['click','fill'].includes(String(value.action.kind))
    && nonempty(value.action.selector)
    && (value.action.kind === 'click' ? value.action.value === undefined : typeof value.action.value === 'string')
    && (value.status === 'passed' || value.status === 'failed')
    && isRecord(value.observed)
    && hasOnlyKeys(value.observed, ['count'], ['text'])
    && nonnegativeInteger(value.observed.count)
    && (value.observed.text === undefined || typeof value.observed.text === 'string');
}
function isBrowserInteractionEvidence(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['schemaVersion','caseId','framework','host','projectRoot','actions','interaction'])) return false;
  const interaction = value.interaction;
  if (!isRecord(interaction) || !hasOnlyKeys(interaction, ['selector','pattern','expected','before','after','status'])) return false;
  const expected = interaction.expected;
  return value.schemaVersion === 1
    && nonempty(value.caseId)
    && (value.framework === 'vue' || value.framework === 'react')
    && ['vite','next-app-router'].includes(String(value.host))
    && typeof value.projectRoot === 'string' && /^[A-Za-z]:[\\/]/.test(value.projectRoot)
    && Array.isArray(value.actions) && value.actions.every(isBrowserActionEvidence)
    && nonempty(interaction.selector) && nonempty(interaction.pattern)
    && isRecord(expected) && hasOnlyKeys(expected, ['from','to'])
    && Number.isSafeInteger(expected.from) && Number.isSafeInteger(expected.to)
    && Number.isSafeInteger(interaction.before) && Number.isSafeInteger(interaction.after)
    && (interaction.status === 'passed' || interaction.status === 'failed');
}
function isPositiveReceipt(value: unknown): value is T17CellReceipt {
  if (!isRecord(value) || !Array.isArray(value.commands) || !value.commands.every(isCommandEvidence) || !Array.isArray(value.browserAssets) || !value.browserAssets.every(isBrowserAssetEvidence)) return false;
  if (!isRecord(value.interaction) || !hasOnlyKeys(value.interaction, ['action','observed','before','after'], ['evidencePath','sha256']) || !isRecord(value.visualCheck) || !hasOnlyKeys(value.visualCheck, ['status','screenshotPath','screenshotSha256','baselineSha256'], ['baselinePath']) || !isRecord(value.cleanup) || !hasOnlyKeys(value.cleanup, ['projectRootRemoved','evidenceRetained','userProjectPreserved']) || !validScenarioIdentity(value.scenarioIdentity)) return false;
  const required = ['caseId','receiptEvidencePath','framework','packageManager','host','projectRoot','scenarioIdentity','expectedOutcome','actualOutcome','sourceKind','cliTarballSha256','frozenBundleSha256','planSha256','applyResultSha256','verificationSpecSha256','reportSha256','reportPath','commands','generatedPath','generatedSha256','browserAssets','interaction','visualCheck','outOfScopeWrites','lostUserEdits','cleanup'];
  const optional = ['planEvidencePath','applyResultEvidencePath','verificationSpecEvidencePath','generatedEvidencePath','repair'];
  if (!hasOnlyKeys(value, required, optional)) return false;
  if (value.repair !== undefined && (!isRecord(value.repair) || !hasOnlyKeys(value.repair, ['initialReportPath','initialReportSha256','resultPath','resultSha256']) || !safeEvidenceName(value.repair.initialReportPath) || !validSha(value.repair.initialReportSha256) || !safeEvidenceName(value.repair.resultPath) || !validSha(value.repair.resultSha256))) return false;
  return nonempty(value.caseId) && safeEvidenceName(value.receiptEvidencePath) && (value.framework === 'vue' || value.framework === 'react') && (value.packageManager === 'npm' || value.packageManager === 'pnpm') && ['vite', 'next-app-router'].includes(String(value.host)) && /^[A-Za-z]:[\\/]/.test(String(value.projectRoot)) && value.expectedOutcome === 'pass' && ['pass', 'failed', 'skipped', 'blocked'].includes(String(value.actualOutcome)) && ['temporary-host', 'authorized-business-project'].includes(String(value.sourceKind)) && validSha(value.cliTarballSha256) && validSha(value.frozenBundleSha256) && validSha(value.planSha256) && validSha(value.applyResultSha256) && validSha(value.verificationSpecSha256) && validSha(value.reportSha256) && safeEvidenceName(value.reportPath) && (value.planEvidencePath === undefined || safeEvidenceName(value.planEvidencePath)) && (value.applyResultEvidencePath === undefined || safeEvidenceName(value.applyResultEvidencePath)) && (value.verificationSpecEvidencePath === undefined || safeEvidenceName(value.verificationSpecEvidencePath)) && (value.generatedEvidencePath === undefined || safeEvidenceName(value.generatedEvidencePath)) && nonempty(value.generatedPath) && validSha(value.generatedSha256) && typeof value.interaction.action === 'string' && typeof value.interaction.observed === 'boolean' && Number.isSafeInteger(value.interaction.before) && Number.isSafeInteger(value.interaction.after) && (value.interaction.evidencePath === undefined || safeEvidenceName(value.interaction.evidencePath)) && (value.interaction.sha256 === undefined || validSha(value.interaction.sha256)) && ['passed', 'failed'].includes(String(value.visualCheck.status)) && safeEvidenceName(value.visualCheck.screenshotPath) && validSha(value.visualCheck.screenshotSha256) && validSha(value.visualCheck.baselineSha256) && (value.visualCheck.baselinePath === undefined || safeEvidenceName(value.visualCheck.baselinePath)) && nonnegativeInteger(value.outOfScopeWrites) && nonnegativeInteger(value.lostUserEdits) && typeof value.cleanup.projectRootRemoved === 'boolean' && typeof value.cleanup.evidenceRetained === 'boolean' && typeof value.cleanup.userProjectPreserved === 'boolean';
}
function isRefusalReceipt(value: unknown): value is T17RefusalReceipt {
  if (!isRecord(value) || !hasOnlyKeys(value, ['caseId','framework','packageManager','scenarioIdentity','receiptEvidencePath','expectedOutcome','actualOutcome','beforeProjectSha256','afterProjectSha256','reportPath','reportSha256','outOfScopeWrites'])) return false;
  return nonempty(value.caseId) && (value.framework === 'vue' || value.framework === 'react') && (value.packageManager === 'npm' || value.packageManager === 'pnpm') && isRecord(value.scenarioIdentity) && hasOnlyKeys(value.scenarioIdentity, ['kind','focus','reason','setup']) && nonempty(value.scenarioIdentity.kind) && nonempty(value.scenarioIdentity.focus) && nonempty(value.scenarioIdentity.reason) && nonempty(value.scenarioIdentity.setup) && safeEvidenceName(value.receiptEvidencePath) && value.expectedOutcome === 'refuse' && ['refused', 'accepted', 'error', 'skipped', 'blocked'].includes(String(value.actualOutcome)) && validSha(value.beforeProjectSha256) && validSha(value.afterProjectSha256) && safeEvidenceName(value.reportPath) && validSha(value.reportSha256) && nonnegativeInteger(value.outOfScopeWrites);
}
function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => keys.has(key));
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
  const requestedRoot = resolve(evidenceRoot);
  for (let current = requestedRoot; ; current = dirname(current)) {
    const component = await lstat(current);
    if (component.isSymbolicLink()) throw new Error('T17 evidence root path must not traverse a link or junction.');
    const parent = dirname(current);
    if (parent === current) break;
  }
  const root = await realpath(requestedRoot);
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
  const evidenceContents: Record<string, string> = {};
  const receiptCases = new Set<string>();
  for (const reference of seal.payload.receipts) {
    if (!reference.caseId || receiptCases.has(reference.caseId) || !['positive', 'refusal'].includes(reference.kind) || !reference.evidencePath || basename(reference.evidencePath) !== reference.evidencePath) throw new Error('T17 run seal has an invalid or duplicate receipt index.');
    receiptCases.add(reference.caseId);
    const bytes = await readFile(join(filesRoot, reference.evidencePath));
    let receipt: T17CellReceipt | T17RefusalReceipt;
    try { receipt = JSON.parse(bytes.toString('utf8')) as T17CellReceipt | T17RefusalReceipt; } catch { throw new Error('T17 receipt evidence is not valid JSON: ' + reference.caseId); }
    const shapeValid = reference.kind === 'positive' ? isPositiveReceipt(receipt) : isRefusalReceipt(receipt);
    if (!shapeValid) throw new Error('T17 receipt runtime schema is invalid: ' + reference.caseId);
    if (receipt.caseId !== reference.caseId || receipt.receiptEvidencePath !== reference.evidencePath || !Buffer.from(canonicalJson(receipt)).equals(bytes)) throw new Error('T17 receipt identity or canonical bytes differ from its run seal index: ' + reference.caseId);
    if (reference.kind === 'positive') positiveReceipts.push(receipt as T17CellReceipt);
    else refusalReceipts.push(receipt as T17RefusalReceipt);
    const evidencePaths = reference.kind === 'positive'
      ? [(receipt as T17CellReceipt).reportPath, (receipt as T17CellReceipt).planEvidencePath, (receipt as T17CellReceipt).applyResultEvidencePath, (receipt as T17CellReceipt).verificationSpecEvidencePath, (receipt as T17CellReceipt).interaction.evidencePath, (receipt as T17CellReceipt).repair?.initialReportPath, (receipt as T17CellReceipt).repair?.resultPath]
      : [(receipt as T17RefusalReceipt).reportPath];
    for (const evidencePath of evidencePaths) {
      if (!evidencePath || !safeEvidenceName(evidencePath) || evidenceContents[evidencePath] !== undefined) continue;
      if (declaredNames.includes(evidencePath)) evidenceContents[evidencePath] = (await readFile(join(filesRoot, evidencePath))).toString('utf8');
    }
    if (reference.kind === 'refusal') {
      const reportText = evidenceContents[receipt.reportPath];
      let report: unknown;
      try { report = reportText === undefined ? undefined : JSON.parse(reportText); } catch { /* Scoring reports invalid JSON. */ }
      if (isRecord(report) && isBudgetRepairEvidence(report.budgetRepair)) {
        for (const ref of budgetEvidenceRefs(report.budgetRepair)) {
          if (declaredNames.includes(ref.evidencePath)) evidenceContents[ref.evidencePath] = (await readFile(join(filesRoot, ref.evidencePath))).toString('utf8');
        }
      }
    }
  }
  return {
    expectedCliTarballSha256,
    expectedFrozenBundleSha256,
    sealPayload: { cliTarballSha256: seal.payload.cliTarballSha256, frozenBundleSha256: seal.payload.frozenBundleSha256 },
    positiveReceipts,
    refusalReceipts,
    sealedFiles: seal.files,
    evidenceContents,
  };
}

function sealedFileMatches(files: ReadonlyMap<string, T17SealedFile>, path: string | undefined, sha256: string | undefined, allowEmpty = false): boolean {
  if (!path || path.includes('/') || path.includes('\\') || path === '.' || path === '..' || !sha256) return false;
  const file = files.get(path);
  return Boolean(file && file.sha256 === sha256 && hasEvidence(file.sha256) && (file.bytes > 0 || (allowEmpty && file.bytes === 0 && file.sha256 === createHash('sha256').digest('hex'))));
}

function jsonEvidence(contents: Readonly<Record<string, string>> | undefined, files: ReadonlyMap<string, T17SealedFile>, path: string | undefined, digest: string | undefined): { value?: unknown; error?: string } {
  if (!path || !digest || !sealedFileMatches(files, path, digest)) return { error: '报告或关联证据未被 run-seal 封存' };
  const content = contents?.[path];
  if (typeof content !== 'string' || createHash('sha256').update(content, 'utf8').digest('hex') !== digest) return { error: '报告或关联证据正文缺失或摘要不一致' };
  try { return { value: JSON.parse(content) }; } catch { return { error: '报告或关联证据不是有效 JSON' }; }
}
function isBudgetRepairEvidence(value: unknown): value is T17BudgetRepairEvidence {
  const ref = (item: unknown): item is BudgetEvidenceRef => isRecord(item) && hasOnlyKeys(item, ['evidencePath','sha256']) && safeEvidenceName(item.evidencePath) && validSha(item.sha256);
  return isRecord(value) && hasOnlyKeys(value, ['plan','applyResult','spec','initialReport','result','sourceBefore','sourceAfter','backups','generatedSources'])
    && ['plan','applyResult','spec','initialReport','result','sourceBefore','sourceAfter'].every((key) => ref(value[key]))
    && Array.isArray(value.backups) && value.backups.length === 2 && value.backups.every(ref)
    && Array.isArray(value.generatedSources) && value.generatedSources.length === 3
    && value.generatedSources.every((item) => isRecord(item) && hasOnlyKeys(item, ['path','before','after']) && nonempty(item.path) && ref(item.before) && ref(item.after));
}
function budgetEvidenceRefs(proof: T17BudgetRepairEvidence): BudgetEvidenceRef[] {
  return [proof.plan, proof.applyResult, proof.spec, proof.initialReport, proof.result, proof.sourceBefore, proof.sourceAfter, ...proof.backups, ...proof.generatedSources.flatMap((source) => [source.before, source.after])];
}
const REFUSAL_REPORT_KEYS = ['schemaVersion','caseId','kind','focus','reason','setup','framework','packageManager','expectedOutcome','actualOutcome','issueCodes','exitCode','status','visualResult','detection','repairStatus','repairWrites','sentinelAbsent','budgetRepair'] as const;
function isRefusalReport(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['schemaVersion','caseId','kind','focus','reason','setup','framework','packageManager','expectedOutcome','actualOutcome','issueCodes'], REFUSAL_REPORT_KEYS.filter((key) => !['schemaVersion','caseId','kind','focus','reason','setup','framework','packageManager','expectedOutcome','actualOutcome','issueCodes'].includes(key)))) return false;
  if (value.schemaVersion !== 1 || !nonempty(value.caseId) || !['refusal','guard','detection'].includes(String(value.kind)) || !nonempty(value.focus) || !nonempty(value.reason) || !nonempty(value.setup) || !['vue','react'].includes(String(value.framework)) || !['npm','pnpm'].includes(String(value.packageManager)) || value.expectedOutcome !== 'refuse' || value.actualOutcome !== 'refused' || !Array.isArray(value.issueCodes) || !value.issueCodes.every(nonempty)) return false;
  if (value.exitCode !== undefined && !nonnegativeInteger(value.exitCode)) return false;
  if (value.status !== undefined && !nonempty(value.status)) return false;
  if (value.visualResult !== undefined && !['PASS','DIFF','NEW','INCOMPATIBLE','not-run'].includes(String(value.visualResult))) return false;
  if (value.detection !== undefined && !nonempty(value.detection)) return false;
  if (value.repairStatus !== undefined && value.repairStatus !== 'stopped-or-rejected') return false;
  if (value.repairWrites !== undefined && !nonnegativeInteger(value.repairWrites)) return false;
  if (value.sentinelAbsent !== undefined && typeof value.sentinelAbsent !== 'boolean') return false;
  if (value.budgetRepair !== undefined && !isBudgetRepairEvidence(value.budgetRepair)) return false;
  return true;
}
function positiveScenarioIdentity(scenario: (typeof T17_POSITIVE_SCENARIOS)[number]) {
  return { topology: scenario.topology, workspace: scenario.workspace, hostMode: scenario.hostMode, components: scenario.components };
}
function repairErrors(receipt: T17CellReceipt, plan: Record<string, unknown> | undefined, finalReport: unknown, files: ReadonlyMap<string, T17SealedFile>, contents?: Readonly<Record<string, string>>): string[] {
  const fail = (reason: string) => [receipt.caseId + ': repair ' + reason];
  const repair = receipt.repair;
  if (!repair) return fail('缺少真实失败与修复证据');
  const initial = jsonEvidence(contents, files, repair.initialReportPath, repair.initialReportSha256);
  const result = jsonEvidence(contents, files, repair.resultPath, repair.resultSha256);
  if (initial.error || result.error) return fail('初始报告或修复结果未封存或正文无效');
  const source = validateIntegrationVerificationReport(initial.value);
  if (!source.ok || source.value.status !== 'failed') return fail('初始报告必须为合法 failed 报告');
  const identity = { projectRoot: receipt.projectRoot, planDigest: receipt.planSha256, applyResultDigest: receipt.applyResultSha256, specDigest: receipt.verificationSpecSha256 };
  if (Object.entries(identity).some(([key, value]) => source.value[key as keyof typeof identity] !== value)) return fail('初始报告项目或输入身份不一致');
  const sourceDigest = canonicalEvidenceSha256(source.value);
  const checked = validateIntegrationRepairResult(result.value, { ...identity, reportDigest: sourceDigest, sourceReport: source.value });
  if (!checked.ok || checked.value.status !== 'repaired' || checked.value.attempts.length === 0) return fail('必须有合法、非零且不超预算的成功修复尝试');
  const repaired = checked.value;
  if (canonicalJson(repaired.finalReport) !== canonicalJson(finalReport) || repaired.attempts.at(-1)?.afterReportDigest !== canonicalEvidenceSha256(repaired.finalReport)) return fail('末次摘要或 finalReport 未绑定最终验收报告');
  const generated = Array.isArray(plan?.changes) ? plan.changes.filter((change) => isRecord(change) && change.kind === 'generated-component').map((change) => (change as Record<string, unknown>).path) : [];
  if (!generated.length || repaired.changedFiles.length === 0 || repaired.changedFiles.some((path) => !generated.includes(path)) || !repaired.changedFiles.includes(receipt.generatedPath)) return fail('修复必须仅写计划内生成文件并覆盖验收生成文件');
  const guards = new Map(source.value.snapshots.after.map((snapshot) => [snapshot.path, snapshot]));
  for (const attempt of repaired.attempts) {
    if (!attempt.changedFiles.length) return fail('尝试必须实际改变生成文件');
    for (const before of attempt.beforeHashes) {
      const after = attempt.afterHashes.find((snapshot) => snapshot.path === before.path);
      if (canonicalJson(guards.get(before.path)) !== canonicalJson(before) || !after?.exists || before.sha256 === after.sha256) return fail('生成文件字节保护链不连续或没有真实改变');
    }
    for (const after of attempt.afterHashes) guards.set(after.path, after);
  }
  if (guards.get(receipt.generatedPath)?.sha256 !== receipt.generatedSha256) return fail('修复后生成文件与封存源码摘要不一致');
  return [];
}
function positiveErrors(receipt: T17CellReceipt, scenarioId: string, cliSha: string, bundleSha: string, files: ReadonlyMap<string, T17SealedFile>, contents?: Readonly<Record<string, string>>): string[] {
  const errors: string[] = [];
  const scenario = T17_POSITIVE_SCENARIOS.find((item) => item.caseId === scenarioId);
  if (!scenario) return ['未知正向 caseId: ' + scenarioId];
  const claimsPass = receipt.actualOutcome === 'pass';
  if (!sealedFileMatches(files, receipt.receiptEvidencePath, canonicalEvidenceSha256(receipt))) errors.push(scenarioId + ': receipt 内容未与 run-seal 摘要绑定');
  if (receipt.framework !== scenario.framework || receipt.packageManager !== scenario.packageManager || receipt.host !== scenario.host) errors.push(scenarioId + ': 场景身份不一致');
  if (canonicalJson(receipt.scenarioIdentity) !== canonicalJson(positiveScenarioIdentity(scenario))) errors.push(scenarioId + ': receipt 场景/组件身份不一致');
  if (receipt.expectedOutcome !== 'pass' || !['pass', 'failed', 'skipped', 'blocked'].includes(receipt.actualOutcome)) errors.push(scenarioId + ': outcome 无效');
  if (receipt.cliTarballSha256 !== cliSha || !isSha(receipt.cliTarballSha256)) errors.push(scenarioId + ': CLI 冻结包摘要缺失或不一致');
  if (receipt.frozenBundleSha256 !== bundleSha || !isSha(receipt.frozenBundleSha256)) errors.push(scenarioId + ': SDK 冻结包摘要缺失或不一致');
  for (const [name, digest] of [['plan', receipt.planSha256], ['apply', receipt.applyResultSha256], ['verification', receipt.verificationSpecSha256], ['report', receipt.reportSha256], ...(receipt.actualOutcome === 'pass' ? [['generated', receipt.generatedSha256] as const] : [])] as const) if (!hasEvidence(digest)) errors.push(scenarioId + ': ' + name + ' 证据摘要无效');
  if (!receipt.reportPath || receipt.reportPath.startsWith('/') || receipt.reportPath.includes('..')) errors.push(scenarioId + ': 报告路径不安全');
  if (!sealedFileMatches(files, receipt.reportPath, receipt.reportSha256)) errors.push(scenarioId + ': 报告未被 run-seal 按同一摘要封存');
  if (!sealedFileMatches(files, receipt.planEvidencePath, receipt.planSha256)) errors.push(scenarioId + ': 计划文件未被 run-seal 封存');
  if (!sealedFileMatches(files, receipt.applyResultEvidencePath, receipt.applyResultSha256)) errors.push(scenarioId + ': apply 结果未被 run-seal 封存');
  if (!sealedFileMatches(files, receipt.verificationSpecEvidencePath, receipt.verificationSpecSha256)) errors.push(scenarioId + ': 验证规范未被 run-seal 封存');
  const planEvidence = jsonEvidence(contents, files, receipt.planEvidencePath, receipt.planSha256);
  const applyEvidence = jsonEvidence(contents, files, receipt.applyResultEvidencePath, receipt.applyResultSha256);
  const specEvidence = jsonEvidence(contents, files, receipt.verificationSpecEvidencePath, receipt.verificationSpecSha256);
  if (planEvidence.error || applyEvidence.error || specEvidence.error) errors.push(scenarioId + ': 缺少可解析的 plan/apply/spec 身份证据');
  const plan = isRecord(planEvidence.value) ? planEvidence.value : undefined;
  const localProject = plan && isRecord(plan.localProject) ? plan.localProject : undefined;
  const matchPlan = plan && isRecord(plan.sourceMatchPlan) ? plan.sourceMatchPlan : undefined;
  const context = matchPlan && isRecord(matchPlan.context) ? matchPlan.context : undefined;
  const elements = matchPlan?.elements;
  if (!localProject || localProject.framework !== scenario.framework || localProject.packageManager !== scenario.packageManager || localProject.workspace !== scenario.workspace || context?.framework !== scenario.framework || !Array.isArray(elements)) {
    errors.push(scenarioId + ': plan 项目框架、包管理器或 workspace 与场景不一致');
  } else {
    const actualComponents = elements.map((element) => isRecord(element) && isRecord(element.target)
      ? { componentId: element.target.componentId, instanceId: element.instanceId, framework: element.target.framework }
      : null);
    const expectedComponents = scenario.components.map((component) => ({ componentId: component.componentId, instanceId: component.instanceId, framework: scenario.framework }));
    if (actualComponents.some((item) => item === null) || canonicalJson(actualComponents) !== canonicalJson(expectedComponents)) errors.push(scenarioId + ': plan 组件/实例身份与场景不一致');
  }
  const exactDependencies = plan?.exactDependencies;
  if (!Array.isArray(exactDependencies) || !exactDependencies.every((dependency) => isRecord(dependency) && nonempty(dependency.name) && nonempty(dependency.version))) {
    errors.push(scenarioId + ': plan 精确依赖证据无效');
  }
  const applyValidation = applyEvidence.error ? undefined : validateIntegrationApplyResult(applyEvidence.value);
  if (!applyValidation?.ok || applyValidation.value.status !== 'applied' || applyValidation.value.projectRoot !== receipt.projectRoot || applyValidation.value.planDigest !== receipt.planSha256) {
    errors.push(scenarioId + ': apply 结果不符合契约或项目/计划身份不匹配');
  } else if (Array.isArray(exactDependencies)) {
    const expected = exactDependencies.map((dependency) => isRecord(dependency) ? { name: dependency.name, version: dependency.version } : null).sort((a, b) => String(a?.name).localeCompare(String(b?.name)));
    const actual = applyValidation.value.installedVersions.map((dependency) => ({ name: dependency.name, version: dependency.version })).sort((a, b) => a.name.localeCompare(b.name));
    if (applyValidation.value.installState === 'succeeded' && canonicalJson(actual) !== canonicalJson(expected)) errors.push(scenarioId + ': apply 已安装依赖与 plan exactDependencies 不一致');
  }
  const specValidation = specEvidence.error ? undefined : validateIntegrationVerificationSpec(specEvidence.value);
  if (!specValidation?.ok || specValidation.value.projectRoot !== receipt.projectRoot || specValidation.value.planDigest !== receipt.planSha256 || specValidation.value.applyResultDigest !== receipt.applyResultSha256) {
    errors.push(scenarioId + ': verification spec 不符合契约或 apply 身份不匹配');
  }
  const reportEvidence = jsonEvidence(contents, files, receipt.reportPath, receipt.reportSha256);
  if ((claimsPass && scenario.requiresRepairFault) || receipt.repair) errors.push(...repairErrors(receipt, plan, reportEvidence.value, files, contents));
  if (reportEvidence.error || !isRecord(reportEvidence.value)) {
    errors.push(scenarioId + ': 正向报告无法解析');
  } else {
    const report = reportEvidence.value;
    if (report.schemaVersion !== 1 || report.operation !== 'verify' || (claimsPass && report.status !== 'passed') || report.projectRoot !== receipt.projectRoot) errors.push(scenarioId + ': 正向报告状态或项目身份不匹配');
    if (claimsPass && (!Array.isArray(report.checks) || report.checks.length === 0 || report.checks.some((check) => !isRecord(check) || check.status !== 'passed'))) errors.push(scenarioId + ': 正向报告 checks 未全部通过');
    const dependencyGuardPassed = Array.isArray(report.checks) && report.checks.some((check) => isRecord(check) && check.id === 'dependency-guard' && check.status === 'passed');
    if ((claimsPass || dependencyGuardPassed) && Array.isArray(exactDependencies) && Array.isArray(report.installedVersions)) {
      const expected = exactDependencies.map((dependency) => isRecord(dependency) ? { name: dependency.name, version: dependency.version } : null).sort((a, b) => String(a?.name).localeCompare(String(b?.name)));
      const actual = report.installedVersions.map((dependency) => isRecord(dependency) ? { name: dependency.name, version: dependency.version } : null).sort((a, b) => String(a?.name).localeCompare(String(b?.name)));
      if (canonicalJson(actual) !== canonicalJson(expected)) errors.push(scenarioId + ': 已安装依赖与 plan exactDependencies 不一致');
    }
    if (!planEvidence.error && report.planDigest !== canonicalEvidenceSha256(planEvidence.value)) errors.push(scenarioId + ': 报告 planDigest 与 receipt 证据不匹配');
    if (!applyEvidence.error && report.applyResultDigest !== canonicalEvidenceSha256(applyEvidence.value)) errors.push(scenarioId + ': 报告 applyResultDigest 与 receipt 证据不匹配');
    if (!specEvidence.error && report.specDigest !== canonicalEvidenceSha256(specEvidence.value)) errors.push(scenarioId + ': 报告 specDigest 与 receipt 证据不匹配');
    const checked = validateIntegrationVerificationReport(report);
    if (!checked.ok) errors.push(scenarioId + ': 正向报告不符合验证报告契约');
    else if (claimsPass) {
      const categories = new Set(checked.value.checks.map((check) => check.category));
      if (!['type','build','behavior','visual','missing-business-info'].every((category) => categories.has(category as never)) || !checked.value.checks.some((check) => check.id === 'dependency-guard' && check.status === 'passed') || checked.value.pendingItems.length || checked.value.visualResult !== 'PASS') errors.push(scenarioId + ': 正向报告缺少完整通过检查');
    }
  }
  if (receipt.actualOutcome === 'pass' && !sealedFileMatches(files, receipt.generatedEvidencePath, receipt.generatedSha256)) errors.push(scenarioId + ': 生成文件副本未被 run-seal 封存');
  if (receipt.actualOutcome === 'pass' && (!receipt.generatedPath || !/\.(vue|tsx)$/.test(receipt.generatedPath))) errors.push(scenarioId + ': 缺少生成文件');
  const interactionEvidence = jsonEvidence(contents, files, receipt.interaction.evidencePath, receipt.interaction.sha256);
  if (interactionEvidence.error || !isBrowserInteractionEvidence(interactionEvidence.value)) {
    errors.push(scenarioId + ': 交互正文缺失、未封存或结构无效');
  } else {
    const proof = interactionEvidence.value;
    const observed = proof.interaction as Record<string, unknown>;
    const expectedInteraction = scenario.browser.interaction;
    const expectedActions = scenario.browser.actions;
    const actionRecords = proof.actions as { action: unknown; status: 'passed' | 'failed'; observed: { count: number; text?: string } }[];
    const actionResultsMatch = actionRecords.length === expectedActions.length && expectedActions.every((action, index) => {
      const record = actionRecords[index];
      if (!record || (claimsPass && record.status !== 'passed') || canonicalJson(record.action) !== canonicalJson(action)) return false;
      if (record.status === 'failed') return true;
      if (record.observed.count !== 1) return false;
      if (action.kind === 'fill') return record.observed.text === action.value;
      return record.observed.text === undefined;
    });
    const proofIdentityMatches = proof.caseId === scenarioId
      && proof.framework === scenario.framework
      && proof.host === scenario.host
      && proof.projectRoot === receipt.projectRoot;
    const declarationMatches = expectedInteraction !== undefined
      && observed.selector === expectedInteraction.selector
      && observed.pattern === expectedInteraction.pattern
      && canonicalJson(observed.expected) === canonicalJson({ from: expectedInteraction.from, to: expectedInteraction.to });
    const observedValuesMatch = observed.before === receipt.interaction.before
      && observed.after === receipt.interaction.after
      && receipt.interaction.action === canonicalJson(expectedActions)
      && actionResultsMatch
      && receipt.interaction.observed === (observed.status === 'passed'
        && observed.before === expectedInteraction?.from
        && observed.after === expectedInteraction?.to);
    if (!proofIdentityMatches || !declarationMatches || !observedValuesMatch) errors.push(scenarioId + ': 交互正文与场景声明或 receipt 不一致');
    if (receipt.actualOutcome === 'pass' && (observed.status !== 'passed' || observed.before !== expectedInteraction?.from || observed.after !== expectedInteraction?.to)) {
      errors.push(scenarioId + ': 正向通过未证明预声明交互真实发生');
    }
  }
  const commands = new Map(receipt.commands.map((command) => [command.kind, command]));
  for (const kind of ['typecheck', 'build'] as const) { const command = commands.get(kind); if (!command || (receipt.actualOutcome === 'pass' && command.exitCode !== 0) || !sealedFileMatches(files, command.evidencePath, command.sha256) || !sealedFileMatches(files, command.stdoutEvidencePath, command.stdoutSha256, true) || !sealedFileMatches(files, command.stderrEvidencePath, command.stderrSha256, true)) errors.push(scenarioId + ': ' + kind + ' 未通过或缺少封存证据'); }
  if (commands.size !== receipt.commands.length) errors.push(scenarioId + ': 验证命令重复');
  if (receipt.actualOutcome === 'pass' && !receipt.browserAssets.some((asset) => asset.status === 'loaded' && isLoopbackUrl(asset.url) && asset.bytes > 0 && sealedFileMatches(files, asset.evidencePath, asset.sha256))) errors.push(scenarioId + ': 缺少已封存的 loopback 资源证据');
  if (receipt.actualOutcome === 'pass' && (!receipt.interaction.observed || !receipt.interaction.action || receipt.interaction.after === receipt.interaction.before || !sealedFileMatches(files, receipt.interaction.evidencePath, receipt.interaction.sha256))) errors.push(scenarioId + ': 缺少封存的可观察交互');
  if (receipt.actualOutcome === 'pass' && (receipt.visualCheck.status !== 'passed' || !sealedFileMatches(files, receipt.visualCheck.screenshotPath, receipt.visualCheck.screenshotSha256) || !sealedFileMatches(files, receipt.visualCheck.baselinePath, receipt.visualCheck.baselineSha256))) errors.push(scenarioId + ': 缺少封存的视觉证据');
  if (receipt.outOfScopeWrites !== 0) errors.push(scenarioId + ': 存在越界写入');
  if (receipt.lostUserEdits !== 0) errors.push(scenarioId + ': 存在用户修改丢失');
  if (!receipt.cleanup.evidenceRetained || (receipt.sourceKind === 'temporary-host' && !receipt.cleanup.projectRootRemoved) || (receipt.sourceKind === 'authorized-business-project' && !receipt.cleanup.userProjectPreserved)) errors.push(scenarioId + ': 清理或证据留存不完整');
  return errors;
}

function budgetRepairErrors(receipt: T17RefusalReceipt, report: Record<string, unknown>, files: ReadonlyMap<string, T17SealedFile>, contents?: Readonly<Record<string, string>>): string[] {
  const fail = (reason: string) => [receipt.caseId + ': budget repair ' + reason];
  if (!isBudgetRepairEvidence(report.budgetRepair)) return fail('缺少两轮预算修复证据');
  const proof = report.budgetRepair;
  const text = (ref: BudgetEvidenceRef): string | undefined => {
    const value = contents?.[ref.evidencePath];
    return typeof value === 'string' && sealedFileMatches(files, ref.evidencePath, ref.sha256)
      && Buffer.byteLength(value) === files.get(ref.evidencePath)?.bytes && createHash('sha256').update(value).digest('hex') === ref.sha256 ? value : undefined;
  };
  if (budgetEvidenceRefs(proof).some((ref) => text(ref) === undefined)) return fail('关联正文、字节数或封存摘要不一致');
  const json = (ref: BudgetEvidenceRef): unknown => { try { return JSON.parse(text(ref)!); } catch { return undefined; } };
  const canonicalRefs = [proof.plan, proof.applyResult, proof.spec, proof.initialReport, proof.result, proof.sourceBefore, proof.sourceAfter];
  if (canonicalRefs.some((ref) => canonicalEvidenceSha256(json(ref)) !== ref.sha256)) return fail('输入、报告或源码清单并非同一 canonical 身份');
  const plan = validateIntegrationPlan(json(proof.plan));
  const apply = validateIntegrationApplyResult(json(proof.applyResult));
  const spec = validateIntegrationVerificationSpec(json(proof.spec));
  if (!plan.ok || plan.value.status !== 'planned' || plan.value.localProject.framework !== receipt.framework || plan.value.localProject.packageManager !== receipt.packageManager || plan.value.localProject.workspace !== '.' || !apply.ok || apply.value.status !== 'applied' || !spec.ok) return fail('plan/apply/spec 不符合真实预算场景契约');
  const identity = { projectRoot: apply.value.projectRoot, planDigest: proof.plan.sha256, applyResultDigest: proof.applyResult.sha256, specDigest: proof.spec.sha256 };
  const context = { ...identity, plan: plan.value, applyResult: apply.value, spec: spec.value };
  if (!validateIntegrationApplyResult(apply.value, { projectRoot: identity.projectRoot, planDigest: identity.planDigest, plan: plan.value }).ok
      || spec.value.projectRoot !== identity.projectRoot || spec.value.planDigest !== identity.planDigest || spec.value.applyResultDigest !== identity.applyResultDigest) return fail('plan/apply/spec 项目与摘要身份断链');
  const initial = validateIntegrationVerificationReport(json(proof.initialReport), context);
  if (!initial.ok || initial.value.status !== 'failed' || initial.value.changedFiles.length) return fail('必须保留真实、无源码变更的初始失败报告');
  const result = validateIntegrationRepairResult(json(proof.result), { ...context, sourceReport: initial.value, reportDigest: proof.initialReport.sha256 });
  if (!result.ok || result.value.status !== 'stopped' || result.value.stopReason !== 'max-attempts-reached' || result.value.maxAttempts !== 2 || result.value.attempts.length !== 2
      || result.value.finalReport.status !== 'failed' || !result.value.finalReport.checks.some((check) => check.category === 'behavior' && check.status === 'failed')
      || canonicalJson(result.value.pendingItems) !== canonicalJson(result.value.finalReport.pendingItems) || report.repairWrites !== 2) return fail('必须真实耗尽两轮且保留末轮行为失败与未决问题');
  const repaired = result.value;
  if (repaired.attempts.at(-1)!.afterReportDigest !== canonicalEvidenceSha256(repaired.finalReport) || repaired.finalReport.changedFiles.length) return fail('最终失败报告摘要断链或验证期间源码变化');
  const generated = plan.value.changes.filter((change) => change.kind === 'generated-component');
  const generatedPaths = generated.map((change) => change.path);
  if (generatedPaths.length !== 3 || canonicalJson(proof.generatedSources.map((source) => source.path)) !== canonicalJson(generatedPaths)
      || generated.some((change) => change.framework !== 'vue' || plan.value.sourceMatchPlan.elements.find((element) => element.instanceId === change.instanceId)?.layout !== 'synthetic-template-fault:t17-N10')
      || canonicalJson(repaired.changedFiles) !== canonicalJson(generatedPaths.slice(0, 2))) return fail('必须是三份已声明故障且恰修复前两份生成文件');
  const snapshot = (value: unknown): Map<string, string> | undefined => {
    if (!Array.isArray(value) || !value.length || !value.every((entry) => Array.isArray(entry) && entry.length === 2 && nonempty(entry[0]) && !entry[0].includes('\\') && !entry[0].startsWith('/') && !entry[0].includes(':') && !entry[0].split('/').some((part) => !part || part === '.' || part === '..') && validSha(entry[1]))) return undefined;
    const entries = value as [string, string][];
    if (new Set(entries.map(([path]) => path.normalize('NFC').toLowerCase())).size !== entries.length) return undefined;
    return new Map(entries);
  };
  const before = snapshot(json(proof.sourceBefore)), after = snapshot(json(proof.sourceAfter));
  if (!before || !after || receipt.beforeProjectSha256 !== proof.sourceBefore.sha256 || receipt.afterProjectSha256 !== proof.sourceAfter.sha256) return fail('完整源码清单未绑定真实前后摘要');
  const differences = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path));
  if (differences.length !== 2 || differences.some((path) => !generatedPaths.slice(0, 2).includes(path)) || before.size !== after.size || [...before.keys()].some((path) => !after.has(path))) return fail('生成范围外存在源码增删改或两份修复没有实际变化');
  const reportMatches = (observed: typeof initial.value, state: Map<string, string>) => [...observed.snapshots.before, ...observed.snapshots.after].every((guard) => guard.exists ? state.get(guard.path) === guard.sha256 : !state.has(guard.path))
    && generatedPaths.every((path) => observed.snapshots.before.some((guard) => guard.path === path && guard.exists) && observed.snapshots.after.some((guard) => guard.path === path && guard.exists));
  if (!reportMatches(initial.value, before) || !reportMatches(repaired.finalReport, after)
      || apply.value.afterHashes.some((guard) => !guard.exists || before.get(guard.path) !== guard.sha256)) return fail('初始、apply 或最终报告保护字节与全源码清单不一致');
  const fault = "const layout = 'synthetic-template-fault:t17-N10';";
  const clean = "const layout = 'grid cell 1';";
  for (const [index, source] of proof.generatedSources.entries()) {
    const original = text(source.before)!, final = text(source.after)!;
    if (source.before.sha256 !== before.get(source.path) || source.after.sha256 !== after.get(source.path) || !original.split('\n').includes(fault)
        || (index < 2 ? final !== original.replace(fault, clean) || final.includes('synthetic-template-fault:t17-N10') : final !== original)) return fail('三份故障源码与两份精确 recipe 输出或第三份保留字节不一致');
    if (index === 2) continue;
    const attempt = repaired.attempts[index]!, backupRef = proof.backups[index]!;
    if (attempt.recipeId !== 'regenerate-generated-component' || canonicalJson(attempt.changedFiles) !== canonicalJson([source.path])
        || attempt.beforeHashes.length !== 1 || attempt.afterHashes.length !== 1 || attempt.beforeHashes[0]!.sha256 !== source.before.sha256 || attempt.afterHashes[0]!.sha256 !== source.after.sha256
        || backupRef.sha256 !== attempt.backupRef.sha256) return fail('每轮必须有同一份生成文件的真实前后字节与备份绑定');
    const backup = json(backupRef);
    if (!isRecord(backup) || !hasOnlyKeys(backup, ['id','path','sha256','originalBase64']) || backup.id !== attempt.backupRef.id || backup.path !== source.path || backup.sha256 !== source.before.sha256 || typeof backup.originalBase64 !== 'string') return fail('备份身份、路径或原字节摘要无效');
    const bytes = Buffer.from(backup.originalBase64, 'base64');
    if (bytes.toString('base64') !== backup.originalBase64 || createHash('sha256').update(bytes).digest('hex') !== backup.sha256 || !bytes.equals(Buffer.from(original))) return fail('备份原字节未真实保留');
  }
  return [];
}

function refusalErrors(receipt: T17RefusalReceipt, scenarioId: string, files: ReadonlyMap<string, T17SealedFile>, contents?: Readonly<Record<string, string>>): string[] {
  const errors: string[] = [];
  const scenario = T17_REFUSAL_SCENARIOS.find((item) => item.caseId === scenarioId);
  if (!scenario) return [scenarioId + ': 未知拒绝场景'];
  if (receipt.framework !== scenario.framework || receipt.packageManager !== scenario.packageManager || canonicalJson(receipt.scenarioIdentity) !== canonicalJson({ kind: scenario.kind, focus: scenario.focus, reason: scenario.reason, setup: scenario.setup })) errors.push(scenarioId + ': 拒绝 receipt 场景身份不一致');
  if (!sealedFileMatches(files, receipt.receiptEvidencePath, canonicalEvidenceSha256(receipt))) errors.push(scenarioId + ': 拒绝 receipt 未与 run-seal 摘要绑定');
  if (receipt.expectedOutcome !== 'refuse' || receipt.actualOutcome !== 'refused') errors.push(scenarioId + ': 必须实测拒绝');
  const isBudget = scenario.caseId === 'N10' && scenario.setup === 'budget' && scenario.focus === 'repair-budget';
  if (!hasEvidence(receipt.beforeProjectSha256) || !hasEvidence(receipt.afterProjectSha256) || (!isBudget && receipt.beforeProjectSha256 !== receipt.afterProjectSha256)) errors.push(scenarioId + ': 拒绝前后摘要不一致');
  const reportEvidence = jsonEvidence(contents, files, receipt.reportPath, receipt.reportSha256);
  if (reportEvidence.error || !isRecord(reportEvidence.value)) errors.push(scenarioId + ': 拒绝报告无法解析');
  else if (!isRefusalReport(reportEvidence.value)) errors.push(scenarioId + ': 拒绝报告结构无效');
  else {
    const report = reportEvidence.value;
    if (isBudget) errors.push(...budgetRepairErrors(receipt, report, files, contents));
    else if (report.budgetRepair !== undefined) errors.push(scenarioId + ': 仅 N10 允许预算修复写入证据');
    if (report.caseId !== scenario.caseId || report.kind !== scenario.kind || report.focus !== scenario.focus || report.reason !== scenario.reason || report.setup !== scenario.setup || report.framework !== scenario.framework || report.packageManager !== scenario.packageManager || report.expectedOutcome !== 'refuse' || report.actualOutcome !== 'refused') errors.push(scenarioId + ': 拒绝报告未绑定当前场景');
    if (scenario.expectedCodes?.length && !(report.issueCodes as string[]).some((code) => scenario.expectedCodes!.includes(code))) errors.push(scenarioId + ': 拒绝报告缺少预期 issue/code');
    if (scenario.expectedExit?.length && !scenario.expectedExit.includes(report.exitCode as number)) errors.push(scenarioId + ': 拒绝报告退出码与场景不符');
    if (scenario.expectedStatus?.length && !scenario.expectedStatus.includes(report.status as string)) errors.push(scenarioId + ': 拒绝报告 status 与场景不符');
    if (scenario.expectedVisual && report.visualResult !== scenario.expectedVisual) errors.push(scenarioId + ': 拒绝报告 visualResult 与场景不符');
    if (scenario.expectedDetection && report.detection !== scenario.expectedDetection) errors.push(scenarioId + ': 拒绝报告 detection 与场景不符');
    if (scenario.expectedRepair && report.repairStatus !== scenario.expectedRepair) errors.push(scenarioId + ': 拒绝报告 repair 状态与场景不符');
    if (scenario.assertNoRepairWrite && report.repairWrites !== 0) errors.push(scenarioId + ': 拒绝报告未证明没有 repair 写入');
    if (scenario.assertNoSentinel && report.sentinelAbsent !== true) errors.push(scenarioId + ': 拒绝报告未证明 sentinel 未落盘');
  }
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
    if (!isSha(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || (file.bytes === 0 && file.sha256 !== createHash('sha256').digest('hex'))) errors.push('run-seal 文件条目无效: ' + file.name);
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
    const before = errors.length; errors.push(...positiveErrors(receipt, scenario.caseId, input.expectedCliTarballSha256, input.expectedFrozenBundleSha256, sealedFiles, input.evidenceContents));
    if (errors.length === before && receipt.actualOutcome === 'pass') { positivePassed++; byFramework[scenario.framework].passed++; }
    else if (errors.length === before) failures.push(scenario.caseId + ': 未通过（' + receipt.actualOutcome + '），已留存验证证据');
  }
  let refusalPassed = 0;
  for (const scenario of T17_REFUSAL_SCENARIOS) { const receipt = refusals.get(scenario.caseId); if (!receipt) { errors.push('拒绝案例缺失: ' + scenario.caseId); continue; } if (!isRefusalReceipt(receipt)) { errors.push(scenario.caseId + ': 拒绝 receipt 结构不完整'); continue; } const before = errors.length; errors.push(...refusalErrors(receipt, scenario.caseId, sealedFiles, input.evidenceContents)); if (errors.length === before) refusalPassed++; }
  const positiveScore = score(T17_POSITIVE_SCENARIOS.length, positivePassed);
  const frameworkScores = { vue: score(byFramework.vue.total, byFramework.vue.passed), react: score(byFramework.react.total, byFramework.react.passed) };
  const refusalScore = { total: T17_REFUSAL_SCENARIOS.length, passed: refusalPassed };
  return { positive: positiveScore, frameworks: frameworkScores, refusals: refusalScore, matrixAccepted: positiveScore.passed >= positiveScore.required && frameworkScores.vue.passed >= frameworkScores.vue.required && frameworkScores.react.passed >= frameworkScores.react.required && refusalPassed === refusalScore.total && errors.length === 0, failures, errors };
}
