/**
 * T15 P1 `component integrate` 命令。
 *
 * 冻结命令形态（docs/specs/2026-11-16-phase3-t15-design.md）：
 *
 * ```text
 * component integrate inspect --project <path> [--workspace <relative-path>]
 * component integrate plan --project <path> [--workspace <relative-path>] --match <file>
 *                       --api-url <origin> --registry <origin> [--output-dir <relative-path>]
 * ```
 *
 * 边界：inspect/plan 对目标项目零写入、零执行（不执行安装/构建/项目脚本/浏览器，
 * 不创建目录/缓存/备份）；apply/rollback 的写入、安装与恢复范围由 applyIntegration /
 * rollbackIntegration 的产品边界决定（授权只来自本次显式调用，plan.commands 只是
 * 展示数据，仍不执行项目 build/typecheck）。
 * stdout 只写结构化 JSON，诊断一律 stderr；凭据只从环境 `ZHINEXUS_API_TOKEN` /
 * `ZHINEXUS_REGISTRY_TOKEN` 读取（不读项目配置），两类令牌分别注入且互不转发，绝不进入输出。
 *
 * 退出码：0 = 只读检查/计划完成且无已知阻塞，或 apply/rollback 成功；
 * 2 = 形成了含 conflicts 的结构化结果，或 apply/rollback 返回 blocked / recovery-required；
 * 1 = 参数/JSON/文件读取/网络/执行错误。
 *
 * 执行错误同样只往 stdout 写一个 JSON 对象（命令本地最小稳定对象
 * {status:'error',error:{code,message}}，不冒称 IntegrationPlan / IntegrationApplyResult），
 * 诊断走 stderr；错误 code 分为参数（INVALID_ARGUMENTS）、MatchPlan 输入（INVALID_MATCH_PLAN）、
 * 透传 IntegrationPlanError / IntegrationApplyError 的 code 与兜底 EXECUTION_FAILED 四类，
 * 均不含凭据或远端/子进程原文。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { validateMatchPlan } from '../contracts/match-plan.js';
import { validateIntegrationPlan } from '../contracts/integration-plan.js';
import { validateIntegrationApplyResult } from '../contracts/integration-apply.js';
import {
  validateIntegrationVerificationReport,
  validateIntegrationVerificationSpec,
  type IntegrationExecutionAuthorizationV1,
} from '../contracts/integration-verification.js';
import { inspectProject } from '../integration/inspect.js';
import { planIntegration, IntegrationPlanError } from '../integration/plan.js';
import {
  applyIntegration,
  canonicalProjectRoot,
  IntegrationApplyError,
  rollbackIntegration,
} from '../integration/apply.js';
import { verifyIntegration } from '../integration/verify.js';
import { repairIntegration } from '../integration/repair.js';
import { canonicalDigest, sanitizeDiagnosticText } from '../integration/report.js';
import { canonicalJson } from '../contracts/schema.js';
import type { IntegrationApplyAuthorizationV1 } from '../contracts/integration-apply.js';
import type { IntegrationPlanV1, LocalProjectInspectionV1 } from '../contracts/integration-plan.js';

export type IntegrateCommandResult = { exitCode: number; stdout: string; stderr: string };

const USAGE = `用法:
  component integrate inspect --project <path> [--workspace <relative-path>]
  component integrate plan --project <path> [--workspace <relative-path>] --match <file> --api-url <origin> --registry <origin> [--output-dir <relative-path>]
  component integrate apply --project <path> --plan <file> --api-url <origin> --registry <origin> --backup-root <outside-root> --allow-install <true|false> [--workspace <relative-path>] [--output-dir <relative-path>]
  component integrate rollback --project <path> --backup-id <id> --backup-sha256 <sha256> --backup-root <dir>
  component integrate verify --project <path> --plan <file> --apply-result <file> --spec <file> --out <external-dir> --allow-project-scripts <true|false> --allow-browser <true|false>
  component integrate repair --project <path> --plan <file> --apply-result <file> --spec <file> --out <external-dir> --allow-project-scripts <true|false> --allow-browser <true|false> --report <file> [--max-attempts <0|1|2>]

只读边界: inspect 仅本地读取；plan 只读取目标项目与远端元数据/包内容，
不写入目标项目、不创建目录/缓存/备份、不执行安装/构建/项目脚本/浏览器。
apply/rollback/verify/repair 的写入、安装、脚本、浏览器与恢复范围由产品边界决定：授权只来自本次显式调用，
plan.commands 只是展示数据，verify/repair 仅按显式 spec 与授权执行。
凭据从环境变量 ZHINEXUS_API_TOKEN / ZHINEXUS_REGISTRY_TOKEN 读取，不进入任何输出。
退出码: 0 无已知阻塞或操作/验证/修复成功；2 含 conflicts 的结构化结果或 failed/blocked/stopped/recovery-required；1 参数/JSON/读取/网络错误。`;

/** 只认显式给出的标志；重复或缺失都按参数错误处理（exit 1）。 */
const INSPECT_FLAGS = new Set(['--project', '--workspace']);
const PLAN_FLAGS = new Set(['--project', '--workspace', '--match', '--api-url', '--registry', '--output-dir']);
const APPLY_FLAGS = new Set(['--project', '--workspace', '--plan', '--api-url', '--registry', '--backup-root', '--allow-install', '--output-dir']);
const ROLLBACK_FLAGS = new Set(['--project', '--backup-id', '--backup-sha256', '--backup-root']);
const VERIFY_FLAGS = new Set([
  '--project',
  '--plan',
  '--apply-result',
  '--spec',
  '--out',
  '--allow-project-scripts',
  '--allow-browser',
]);
const REPAIR_FLAGS = new Set([
  ...VERIFY_FLAGS,
  '--report',
  '--max-attempts',
]);

type ParsedArgs =
  | { ok: true; values: Map<string, string> }
  | { ok: false; message: string };

/**
 * 命令本地执行错误：`code` 稳定（参数/输入/执行三类 + 透传 IntegrationPlanError.code），
 * 消息与附注都不得包含凭据或远端原文。
 */
class IntegrateCommandError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'IntegrateCommandError';
    this.code = code;
    this.detail = detail;
  }
}

const ARGUMENTS_ERROR = 'INVALID_ARGUMENTS';
const MATCH_PLAN_ERROR = 'INVALID_MATCH_PLAN';
const EXECUTION_ERROR = 'EXECUTION_FAILED';

function argumentsError(message: string, detail: string = USAGE): IntegrateCommandError {
  return new IntegrateCommandError(ARGUMENTS_ERROR, message, detail);
}

function matchPlanError(message: string): IntegrateCommandError {
  return new IntegrateCommandError(MATCH_PLAN_ERROR, message);
}

/** 逐条解析：未知标志、缺值、重复标志都是参数错误，不做任何隐式默认。 */
function parseArgs(args: readonly string[], allowed: ReadonlySet<string>): ParsedArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    // argv 不可信：错误消息不回显参数原文（可能夹带 synthetic 令牌）；
    // 仅回显已通过 allowed 白名单校验的契约参数名。
    if (arg === undefined || !arg.startsWith('--')) {
      return { ok: false, message: '存在未以 -- 开头或缺失的 argv 参数（原文已脱敏）' };
    }
    if (!allowed.has(arg)) {
      return { ok: false, message: '未知参数（参数名已脱敏，可用参数见用法）' };
    }
    if (values.has(arg)) {
      return { ok: false, message: `参数重复 ${arg}` };
    }
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, message: `参数 ${arg} 缺少取值` };
    }
    values.set(arg, value);
  }
  return { ok: true, values };
}

function requireValue(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined || value === '') {
    throw argumentsError(`缺少必填参数 ${flag}`);
  }
  return value;
}

/** 环境令牌：只读，不写计划/日志/命令；空字符串视为未提供。 */
function tokenFromEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  return raw;
}

/** 计划的规范摘要（与授权/备份中的 planDigest 同口径）。 */
function sha256OfCanonical(plan: IntegrationPlanV1): string {
  return createHash('sha256').update(canonicalJson(plan)).digest('hex');
}

/**
 * 失败路径统一形态：exit 1 + **单一 JSON stdout** + stderr 诊断。
 * stdout 是命令本地最小稳定对象（共享 contracts 没有专用执行错误 envelope，不冒称 IntegrationPlan）。
 */
function failureEnvelope(code: string, message: string, detail?: string): IntegrateCommandResult {
  const safeMsg = sanitizeDiagnosticText(message);
  const safeDetail = detail ? sanitizeDiagnosticText(detail) : '';
  const payload = { status: 'error', error: { code, message: safeMsg } };
  return {
    exitCode: 1,
    stdout: `${JSON.stringify(payload, null, 2)}\n`,
    stderr: `✖ [${code}] ${safeMsg}\n${safeDetail}`,
  };
}

/** 执行错误（含网络/读取/计划内部失败）统一映射为 exit 1，消息不得含凭据。 */
function executionFailure(error: unknown): IntegrateCommandResult {
  if (error instanceof IntegrationPlanError) {
    return failureEnvelope(error.code, error.message);
  }
  if (error instanceof IntegrationApplyError) {
    return failureEnvelope(error.code, error.message);
  }
  if (error instanceof IntegrateCommandError) {
    return failureEnvelope(error.code, error.message, error.detail);
  }
  return failureEnvelope(EXECUTION_ERROR, '受控应用执行失败');
}

/** 结构化结果：stdout 只有 JSON；blocked/recovery-required/conflicts 非空按 exit 2，否则 exit 0。 */
function structuredResult(payload: unknown, blocking: readonly unknown[]): IntegrateCommandResult {
  return {
    exitCode: blocking.length > 0 ? 2 : 0,
    stdout: `${JSON.stringify(payload, null, 2)}\n`,
    stderr: '',
  };
}

function emitInspection(inspection: LocalProjectInspectionV1): IntegrateCommandResult {
  return structuredResult(inspection, inspection.conflicts);
}

/** apply 结果的退出码依据：blocked / recovery-required 是结构化人工处置结果（exit 2）。 */
function applyBlocking(result: { status: string; issues: readonly unknown[] }): readonly unknown[] {
  return result.status === 'blocked' || result.status === 'recovery-required' ? result.issues : [];
}

async function runApply(values: Map<string, string>): Promise<IntegrateCommandResult> {
  const project = requireValue(values, '--project');
  const planFile = requireValue(values, '--plan');
  const apiUrl = requireValue(values, '--api-url');
  const registryUrl = requireValue(values, '--registry');
  const backupRoot = requireValue(values, '--backup-root');
  const allowInstall = requireValue(values, '--allow-install');
  const workspace = values.get('--workspace');
  const outputDir = values.get('--output-dir');
  if (allowInstall !== 'true' && allowInstall !== 'false') {
    // 不可信值不回显：值文本可能夹带 synthetic 令牌（契约参数名保留）。
    throw argumentsError('--allow-install 只接受 true 或 false');
  }

  // 输入 IntegrationPlanV1：坏 JSON / 非法结构都是执行错误（exit 1），不冒充计划。
  let plan: unknown;
  try {
    plan = JSON.parse(fs.readFileSync(path.resolve(planFile), 'utf8'));
  } catch {
    // 不可信路径不回显（可能夹带 synthetic 令牌）；契约参数名保留。
    throw matchPlanError('无法读取或解析 --plan 文件（路径已脱敏）');
  }
  const checked = validateIntegrationPlan(plan);
  if (!checked.ok) {
    // issue path/message 可能反射输入 JSON 的未知字段名等不可信文本，一律脱敏。
    throw matchPlanError(`--plan 不是合法的 IntegrationPlanV1（${checked.issues.length} 个结构性问题，细节已脱敏）`);
  }

  const apiToken = tokenFromEnv('ZHINEXUS_API_TOKEN');
  const registryToken = tokenFromEnv('ZHINEXUS_REGISTRY_TOKEN');
  const planDigest = sha256OfCanonical(checked.value);
  // 授权只来自本次显式调用边界：由本命令按计划重新派生，磁盘计划本身不构成授权。
  const authorization: IntegrationApplyAuthorizationV1 = {
    schemaVersion: 1,
    operation: 'apply',
    projectRoot: canonicalProjectRoot(path.resolve(project)),
    planDigest,
    allowedPaths: [...checked.value.allowedPaths],
    allowInstall: allowInstall === 'true',
  };
  const result = await applyIntegration(path.resolve(project), checked.value, {
    authorization,
    apiUrl,
    registryUrl,
    backupRoot: path.resolve(backupRoot),
    ...(workspace !== undefined ? { workspace } : {}),
    ...(outputDir !== undefined ? { outputDir } : {}),
    ...(apiToken !== undefined ? { apiToken } : {}),
    ...(registryToken !== undefined ? { registryToken } : {}),
  });
  return structuredResult(result, applyBlocking(result));
}

async function runRollback(values: Map<string, string>): Promise<IntegrateCommandResult> {
  const project = requireValue(values, '--project');
  const backupId = requireValue(values, '--backup-id');
  const backupSha256 = requireValue(values, '--backup-sha256');
  const backupRoot = requireValue(values, '--backup-root');
  const result = await rollbackIntegration(
    path.resolve(project),
    { id: backupId, sha256: backupSha256 },
    { backupRoot: path.resolve(backupRoot) },
  );
  return structuredResult(result, applyBlocking(result));
}

function readJsonFile(filePath: string, flagName: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  } catch {
    throw matchPlanError(`无法读取或解析 ${flagName} 文件（路径已脱敏）`);
  }
}

function parseBoolFlag(values: Map<string, string>, flagName: string): boolean {
  const raw = requireValue(values, flagName);
  if (raw !== 'true' && raw !== 'false') {
    throw argumentsError(`${flagName} 只接受 true 或 false`);
  }
  return raw === 'true';
}

async function runVerify(values: Map<string, string>): Promise<IntegrateCommandResult> {
  const project = requireValue(values, '--project');
  const planFile = requireValue(values, '--plan');
  const applyFile = requireValue(values, '--apply-result');
  const specFile = requireValue(values, '--spec');
  const outDir = requireValue(values, '--out');
  const allowProjectScripts = parseBoolFlag(values, '--allow-project-scripts');
  const allowBrowser = parseBoolFlag(values, '--allow-browser');

  const rawPlan = readJsonFile(planFile, '--plan');
  const checkedPlan = validateIntegrationPlan(rawPlan);
  if (!checkedPlan.ok) {
    throw matchPlanError(`--plan 不是合法的 IntegrationPlanV1（${checkedPlan.issues.length} 个结构性问题，细节已脱敏）`);
  }

  const rawApply = readJsonFile(applyFile, '--apply-result');
  const checkedApply = validateIntegrationApplyResult(rawApply);
  if (!checkedApply.ok) {
    throw matchPlanError(`--apply-result 不是合法的 IntegrationApplyResultV1（${checkedApply.issues.length} 个结构性问题，细节已脱敏）`);
  }

  const rawSpec = readJsonFile(specFile, '--spec');
  const checkedSpec = validateIntegrationVerificationSpec(rawSpec);
  if (!checkedSpec.ok) {
    throw matchPlanError(`--spec 不是合法的 IntegrationVerificationSpecV1（${checkedSpec.issues.length} 个结构性问题，细节已脱敏）`);
  }

  const canonicalRoot = canonicalProjectRoot(path.resolve(project));
  const planDigest = canonicalDigest(checkedPlan.value);
  const applyResultDigest = canonicalDigest(checkedApply.value);
  const specDigest = canonicalDigest(checkedSpec.value);

  const authorization: IntegrationExecutionAuthorizationV1 = {
    schemaVersion: 1,
    projectRoot: canonicalRoot,
    planDigest,
    applyResultDigest,
    specDigest,
    operation: 'verify',
    allowProjectScripts,
    allowBrowser,
    scriptNames: allowProjectScripts ? [...new Set(checkedSpec.value.commands.map(c => c.script))] : [],
    allowedRepairPaths: [],
    maxAttempts: 0,
  };

  const report = await verifyIntegration(path.resolve(project), checkedPlan.value, {
    applyResult: checkedApply.value,
    spec: checkedSpec.value,
    authorization,
    artifactRoot: path.resolve(outDir),
  });
  return {
    exitCode: report.status === 'passed' ? 0 : 2,
    stdout: `${JSON.stringify(report, null, 2)}\n`,
    stderr: '',
  };
}

async function runRepair(values: Map<string, string>): Promise<IntegrateCommandResult> {
  const project = requireValue(values, '--project');
  const planFile = requireValue(values, '--plan');
  const applyFile = requireValue(values, '--apply-result');
  const specFile = requireValue(values, '--spec');
  const reportFile = requireValue(values, '--report');
  const outDir = requireValue(values, '--out');
  const allowProjectScripts = parseBoolFlag(values, '--allow-project-scripts');
  const allowBrowser = parseBoolFlag(values, '--allow-browser');
  const maxAttemptsRaw = values.get('--max-attempts');
  let maxAttempts: 0 | 1 | 2 = 2;
  if (maxAttemptsRaw !== undefined) {
    if (maxAttemptsRaw !== '0' && maxAttemptsRaw !== '1' && maxAttemptsRaw !== '2') {
      throw argumentsError('--max-attempts 只接受 0、1 或 2');
    }
    maxAttempts = Number(maxAttemptsRaw) as 0 | 1 | 2;
  }

  const rawPlan = readJsonFile(planFile, '--plan');
  const checkedPlan = validateIntegrationPlan(rawPlan);
  if (!checkedPlan.ok) {
    throw matchPlanError(`--plan 不是合法的 IntegrationPlanV1（${checkedPlan.issues.length} 个结构性问题，细节已脱敏）`);
  }

  const rawApply = readJsonFile(applyFile, '--apply-result');
  const checkedApply = validateIntegrationApplyResult(rawApply);
  if (!checkedApply.ok) {
    throw matchPlanError(`--apply-result 不是合法的 IntegrationApplyResultV1（${checkedApply.issues.length} 个结构性问题，细节已脱敏）`);
  }

  const rawSpec = readJsonFile(specFile, '--spec');
  const checkedSpec = validateIntegrationVerificationSpec(rawSpec);
  if (!checkedSpec.ok) {
    throw matchPlanError(`--spec 不是合法的 IntegrationVerificationSpecV1（${checkedSpec.issues.length} 个结构性问题，细节已脱敏）`);
  }

  const rawReport = readJsonFile(reportFile, '--report');
  const checkedReport = validateIntegrationVerificationReport(rawReport);
  if (!checkedReport.ok) {
    throw matchPlanError(`--report 不是合法的 IntegrationVerificationReportV1（${checkedReport.issues.length} 个结构性问题，细节已脱敏）`);
  }

  const canonicalRoot = canonicalProjectRoot(path.resolve(project));
  const planDigest = canonicalDigest(checkedPlan.value);
  const applyResultDigest = canonicalDigest(checkedApply.value);
  const specDigest = canonicalDigest(checkedSpec.value);
  const reportDigest = canonicalDigest(checkedReport.value);
  const generatedPaths = checkedPlan.value.changes
    .filter(c => c.kind === 'generated-component')
    .map(c => c.path);

  const authorization: IntegrationExecutionAuthorizationV1 = {
    schemaVersion: 1,
    projectRoot: canonicalRoot,
    planDigest,
    applyResultDigest,
    specDigest,
    operation: 'repair',
    allowProjectScripts,
    allowBrowser,
    scriptNames: allowProjectScripts ? [...new Set(checkedSpec.value.commands.map(c => c.script))] : [],
    allowedRepairPaths: generatedPaths,
    maxAttempts,
    sourceReportDigest: reportDigest,
  };

  const result = await repairIntegration(path.resolve(project), checkedPlan.value, checkedReport.value, {
    applyResult: checkedApply.value,
    spec: checkedSpec.value,
    authorization,
    artifactRoot: path.resolve(outDir),
    maxAttempts,
  });
  return {
    exitCode: result.status === 'repaired' ? 0 : 2,
    stdout: `${JSON.stringify(result, null, 2)}\n`,
    stderr: '',
  };
}

export async function runIntegrateCommand(args: readonly string[]): Promise<IntegrateCommandResult> {
  const [subcommand, ...rest] = args;
  if (subcommand === undefined) {
    return failureEnvelope(ARGUMENTS_ERROR, '缺少子命令', USAGE);
  }
  if (subcommand === '--help' || subcommand === '-h') {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (
    subcommand !== 'inspect' &&
    subcommand !== 'plan' &&
    subcommand !== 'apply' &&
    subcommand !== 'rollback' &&
    subcommand !== 'verify' &&
    subcommand !== 'repair'
  ) {
    return failureEnvelope(ARGUMENTS_ERROR, '未知 integrate 子命令（子命令已脱敏）', USAGE);
  }

  const flags = subcommand === 'inspect' ? INSPECT_FLAGS
    : subcommand === 'plan' ? PLAN_FLAGS
      : subcommand === 'apply' ? APPLY_FLAGS
        : subcommand === 'rollback' ? ROLLBACK_FLAGS
          : subcommand === 'verify' ? VERIFY_FLAGS
            : REPAIR_FLAGS;
  const parsed = parseArgs(rest, flags);
  if (!parsed.ok) return failureEnvelope(ARGUMENTS_ERROR, parsed.message, USAGE);

  try {
    if (subcommand === 'inspect') return await runInspect(parsed.values);
    if (subcommand === 'plan') return await runPlan(parsed.values);
    if (subcommand === 'apply') return await runApply(parsed.values);
    if (subcommand === 'rollback') return await runRollback(parsed.values);
    return subcommand === 'verify' ? await runVerify(parsed.values) : await runRepair(parsed.values);
  } catch (error) {
    return executionFailure(error);
  }
}

async function runInspect(values: Map<string, string>): Promise<IntegrateCommandResult> {
  const project = requireValue(values, '--project');
  const workspace = values.get('--workspace');
  const inspection = await inspectProject(path.resolve(project), workspace !== undefined ? { workspace } : undefined);
  return emitInspection(inspection);
}

async function runPlan(values: Map<string, string>): Promise<IntegrateCommandResult> {
  const project = requireValue(values, '--project');
  const matchFile = requireValue(values, '--match');
  const apiUrl = requireValue(values, '--api-url');
  const registryUrl = requireValue(values, '--registry');
  const workspace = values.get('--workspace');
  const outputDir = values.get('--output-dir');

  // 输入 MatchPlan：坏 JSON 是执行错误（exit 1），不是“组件不存在”。
  let matchPlan: unknown;
  try {
    matchPlan = JSON.parse(fs.readFileSync(path.resolve(matchFile), 'utf8'));
  } catch {
    // 不回显底层读取/解析异常原文（JSON 解析错误可能夹带文件内容摘录）；路径同样脱敏。
    throw matchPlanError('无法读取或解析 --match 文件（路径已脱敏）');
  }
  const checked = validateMatchPlan(matchPlan);
  if (!checked.ok) {
    // issue path/message 可能反射输入的不可信字段名，一律脱敏。
    throw matchPlanError(`--match 不是合法的 MatchPlanV1（${checked.issues.length} 个结构性问题，细节已脱敏）`);
  }

  const apiToken = tokenFromEnv('ZHINEXUS_API_TOKEN');
  const registryToken = tokenFromEnv('ZHINEXUS_REGISTRY_TOKEN');
  const plan = await planIntegration(path.resolve(project), checked.value, {
    ...(workspace !== undefined ? { workspace } : {}),
    ...(outputDir !== undefined ? { outputDir } : {}),
    apiUrl,
    registryUrl,
    ...(apiToken !== undefined ? { apiToken } : {}),
    ...(registryToken !== undefined ? { registryToken } : {}),
  });
  return structuredResult(plan, plan.conflicts);
}
