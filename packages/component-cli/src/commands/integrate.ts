/**
 * T15 P1 `component integrate` 命令。
 *
 * 冻结命令形态（docs/superpowers/specs/2026-11-16-phase3-t15-design.md）：
 *
 * ```text
 * component integrate inspect --project <path> [--workspace <relative-path>]
 * component integrate plan --project <path> [--workspace <relative-path>] --match <file>
 *                       --api-url <origin> --registry <origin> [--output-dir <relative-path>]
 * ```
 *
 * 边界：目标项目零写入、零执行（不执行安装/构建/项目脚本/浏览器，不创建目录/缓存/备份）；
 * stdout 只写结构化 JSON，诊断一律 stderr；凭据只从环境 `ZHINEXUS_API_TOKEN` /
 * `ZHINEXUS_REGISTRY_TOKEN` 读取（不读项目配置），两类令牌分别注入且互不转发，绝不进入输出。
 *
 * 退出码：0 = 只读检查/计划完成且无已知阻塞；2 = 形成了含 conflicts 的结构化结果；
 * 1 = 参数/JSON/文件读取/网络等执行错误。
 *
 * 执行错误同样只往 stdout 写一个 JSON 对象（命令本地最小稳定对象
 * `{status:'error',error:{code,message}}`，不冒称 IntegrationPlan），诊断走 stderr；
 * 错误 code 分为参数（INVALID_ARGUMENTS）、MatchPlan 输入（INVALID_MATCH_PLAN）、
 * 透传 IntegrationPlanError.code 与兜底 EXECUTION_FAILED 四类，均不含凭据或远端原文。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateMatchPlan } from '../contracts/match-plan.js';
import { inspectProject } from '../integration/inspect.js';
import { planIntegration, IntegrationPlanError } from '../integration/plan.js';
import type { LocalProjectInspectionV1 } from '../contracts/integration-plan.js';

export type IntegrateCommandResult = { exitCode: number; stdout: string; stderr: string };

const USAGE = `用法:
  component integrate inspect --project <path> [--workspace <relative-path>]
  component integrate plan --project <path> [--workspace <relative-path>] --match <file> --api-url <origin> --registry <origin> [--output-dir <relative-path>]

只读边界: inspect 仅本地读取；plan 只读取目标项目与远端元数据/包内容，
不写入目标项目、不创建目录/缓存/备份、不执行安装/构建/项目脚本/浏览器。
凭据从环境变量 ZHINEXUS_API_TOKEN / ZHINEXUS_REGISTRY_TOKEN 读取，不进入任何输出。
退出码: 0 无已知阻塞；2 含 conflicts 的结构化结果；1 参数/JSON/读取/网络错误。`;

/** 只认显式给出的标志；重复或缺失都按参数错误处理（exit 1）。 */
const INSPECT_FLAGS = new Set(['--project', '--workspace']);
const PLAN_FLAGS = new Set(['--project', '--workspace', '--match', '--api-url', '--registry', '--output-dir']);

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
    if (arg === undefined || !arg.startsWith('--')) {
      return { ok: false, message: `无法识别的参数 ${arg ?? '(空)'}` };
    }
    if (!allowed.has(arg)) {
      return { ok: false, message: `未知参数 ${arg}` };
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

/**
 * 失败路径统一形态：exit 1 + **单一 JSON stdout** + stderr 诊断。
 * stdout 是命令本地最小稳定对象（共享 contracts 没有专用执行错误 envelope，不冒称 IntegrationPlan）。
 */
function failureEnvelope(code: string, message: string, detail?: string): IntegrateCommandResult {
  const payload = { status: 'error', error: { code, message } };
  return {
    exitCode: 1,
    stdout: `${JSON.stringify(payload, null, 2)}\n`,
    stderr: `✖ [${code}] ${message}\n${detail ?? ''}`,
  };
}

/** 执行错误（含网络/读取/计划内部失败）统一映射为 exit 1，消息不得含凭据。 */
function executionFailure(error: unknown): IntegrateCommandResult {
  if (error instanceof IntegrationPlanError) {
    return failureEnvelope(error.code, error.message);
  }
  if (error instanceof IntegrateCommandError) {
    return failureEnvelope(error.code, error.message, error.detail);
  }
  const message = error instanceof Error ? error.message : String(error);
  return failureEnvelope(EXECUTION_ERROR, message);
}

/** 结构化结果：stdout 只有 JSON；conflicts 非空按 exit 2，否则 exit 0。 */
function structuredResult(payload: unknown, conflicts: readonly unknown[]): IntegrateCommandResult {
  return {
    exitCode: conflicts.length > 0 ? 2 : 0,
    stdout: `${JSON.stringify(payload, null, 2)}\n`,
    stderr: '',
  };
}

function emitInspection(inspection: LocalProjectInspectionV1): IntegrateCommandResult {
  return structuredResult(inspection, inspection.conflicts);
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
    // 不回显底层读取/解析异常原文（JSON 解析错误可能夹带文件内容摘录）。
    throw matchPlanError(`无法读取或解析 --match 文件：${matchFile}`);
  }
  const checked = validateMatchPlan(matchPlan);
  if (!checked.ok) {
    throw matchPlanError(`--match 不是合法的 MatchPlanV1：${checked.issues.map(issue => `${issue.path} ${issue.message}`).join('; ')}`);
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

export async function runIntegrateCommand(args: readonly string[]): Promise<IntegrateCommandResult> {
  const [subcommand, ...rest] = args;
  if (subcommand === undefined) {
    return failureEnvelope(ARGUMENTS_ERROR, '缺少子命令', USAGE);
  }
  if (subcommand === '--help' || subcommand === '-h') {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (subcommand !== 'inspect' && subcommand !== 'plan') {
    return failureEnvelope(ARGUMENTS_ERROR, `未知 integrate 子命令 ${subcommand}`, USAGE);
  }

  const parsed = parseArgs(rest, subcommand === 'inspect' ? INSPECT_FLAGS : PLAN_FLAGS);
  if (!parsed.ok) return failureEnvelope(ARGUMENTS_ERROR, parsed.message, USAGE);

  try {
    return subcommand === 'inspect' ? await runInspect(parsed.values) : await runPlan(parsed.values);
  } catch (error) {
    return executionFailure(error);
  }
}
