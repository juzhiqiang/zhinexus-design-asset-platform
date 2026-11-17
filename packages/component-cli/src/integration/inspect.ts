import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import semver from 'semver';
import { validateLocalProjectInspection } from '../contracts/integration-plan.js';
import type {
  IntegrationConflict,
  IntegrationDependency,
  IntegrationFileSnapshot,
  LocalProjectInspectionV1,
} from '../contracts/integration-plan.js';
import {
  NPM_LOCK_FILE,
  PNPM_LOCK_FILE,
  foreignLocksPresent,
  lockFileExists,
  readNpmLock,
  readPnpmLock,
  resolveNpmDependency,
  resolvePnpmDependency,
  type NpmLockData,
  type PnpmLockData,
} from './locks.js';
import {
  isDirectory,
  isFile,
  isInsideDirectory,
  isLexicalWorkspacePathValid,
  isPlainObject,
  isSupportedWorkspacePattern,
  matchesAnyWorkspacePattern,
  readNpmWorkspacePatterns,
  readPnpmWorkspacePatterns,
  realpathOrSelf,
  resolveWorkspaceTarget,
  toPosix,
  type WorkspacePatternsRead,
} from './workspace.js';

/**
 * T15 P1 项目识别编排：只读读取根/目标清单、锁文件、Git 状态与原生脚本名，
 * 产出通过 LocalProjectInspectionV1 运行时校验的识别结果。
 *
 * 只读边界：不写目标项目任何字节，不执行安装/构建/项目脚本/浏览器，不加载执行项目配置；
 * Git 仅以固定 argv/cwd 调用只读子命令，禁用 optional locks、fsmonitor、外部 diff/textconv，
 * 清除环境中可能改变实际检查目标的 Git 目录/索引覆盖变量，屏蔽用户 filter driver，
 * 并阻断一切会递归或拉取对象从而执行项目/外部代码的路径：
 * - 所有 status 加 `--ignore-submodules=all` 与 `-c status.submoduleSummary=false`，
 *   避免递归检查子仓（实测会执行子仓自己的 filter helper）；
 * - 项目内存在 gitlink 时无法安全完整识别其 dirty 状态，明确报 unavailable，不忽略后伪称 clean；
 * - 所有调用共享 `--no-lazy-fetch`，阻断 partial clone/promisor 对象的自动 lazy-fetch
 *   （实测会执行外置 ext transport helper）；
 * - status 输出按 `--porcelain -z` 结构化解析，输出不可信即整体报 git unavailable，不伪造观察结果。
 */

const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml';
const EXACT_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+(?:\.[0-9A-Za-z.-]+)*)?$/;
const GIT_ENV_OVERRIDES = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_EXTERNAL_DIFF', 'GIT_TEXTCOV',
];
/**
 * 固定只读 Git 子进程的基础参数：禁 optional locks、fsmonitor、外部 diff/textconv、
 * 子模块摘要与 promisor 对象的自动 lazy-fetch。这些参数位于子命令之前（git 顶层选项），
 * 因此对 config/ls-files/rev-parse/status/check-attr 全部调用一致生效。
 * 某个 Git 版本不支持其中任何一项时命令直接失败，由各调用方失效关闭为 unavailable，
 * 绝不去掉保护参数重试（不回退到无保护调用）。
 */
const GIT_BASE_ARGV = [
  '--no-pager',
  '--no-lazy-fetch',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'core.quotePath=false',
  '-c', 'diff.external=',
  '-c', 'diff.textconv=',
  '-c', 'status.submoduleSummary=false',
  '--no-optional-locks',
];
/** 已批准的非范围声明形式：协议前缀与 dist-tag，以锁内精确版本为准，不做范围校验。 */
const APPROVED_SPECIFIER_PREFIXES = [
  'workspace:', 'catalog:', 'portal:', 'npm:', 'file:', 'link:', 'patch:',
  'git:', 'git+', 'github:', 'bitbucket:', 'gitlab:', 'http:', 'https:',
];
const DIST_TAG_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/;
/**
 * filter driver 名中可安全用作 `-c` 键的形态。真实 Git 的 section/subsection 名允许
 * 字母、数字、`-`、`_` 与 `.`（实测 Git 2.34.1/2.48.1 均接受下划线），故不得沿用旧假设；
 * 但 `..`、首尾 `.` 以及任何其他字符（`=`、空格、控制字符、非 ASCII 等）都无法可靠屏蔽，
 * 出现即失效关闭（git unavailable），绝不静默跳过屏蔽继续执行 status。
 */
const FILTER_DRIVER_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
/** porcelain v1 的合法状态字符（X/Y 列）。 */
const PORCELAIN_STATUS_CHARS = new Set([' ', 'M', 'A', 'D', 'R', 'C', 'U', '?', '!', 'T']);
/** 表示 rename/copy 的状态字符：其后紧跟一个 NUL 字段记录源路径。 */
const PORCELAIN_RENAME_CHARS = new Set(['R', 'C']);
/**
 * `git check-attr -z filter` 的信息值中表示“状态”而非 driver 名的三个取值：
 * `set`（属性被置为某值）、`unset`（显式取消）、`unspecified`（未配置）。
 * 它们与“driver 就叫这个名字”的输出完全一致，但语义相反（实测 Git 2.34.1/2.48.1）：
 * 无法据此可靠区分，故与已枚举 driver 同名时一律失效关闭。
 */
const CHECK_ATTR_STATE_INFO = new Set(['set', 'unset', 'unspecified']);
/** index mode 的合法形态（Git 固定输出 6 位八进制）。 */
const INDEX_MODE_PATTERN = /^[0-7]{6}$/;
/** index stage 取值 0-3（0=普通，1-3=冲突）。 */
const INDEX_STAGE_PATTERN = /^[0-3]$/;
/** 子模块 gitlink 的 index mode。 */
const GITLINK_MODE = '160000';

function isApprovedNonRangeSpecifier(specifier: string): boolean {
  if (APPROVED_SPECIFIER_PREFIXES.some(prefix => specifier.startsWith(prefix))) return true;
  return DIST_TAG_PATTERN.test(specifier);
}

type PackageManager = 'npm' | 'pnpm';
type GitStatus = { status: 'clean' | 'dirty' | 'unavailable'; dirtyPaths: string[] };
type FileProbe = { exists: boolean; escaped: boolean; snapshot?: IntegrationFileSnapshot };

function readManifest(dir: string): Record<string, unknown> | undefined {
  try {
    const text = fs.readFileSync(path.join(realpathOrSelf(dir), 'package.json'), 'utf8').replace(/^\uFEFF/, '');
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 读取清单声明的依赖：只接受字符串 specifier；显式存在但类型错误的条目不静默丢弃，
 * 记入 malformed 由调用方显式冲突（失效关闭，不猜测意图）。
 */
function readDeclaredDependencies(manifest: Record<string, unknown> | undefined):
  { declared: Map<string, string>; malformed: string[] } {
  const declared = new Map<string, string>();
  const malformed: string[] = [];
  if (!manifest) return { declared, malformed };
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (!isPlainObject(value)) {
      malformed.push(field);
      continue;
    }
    for (const [name, specifier] of Object.entries(value)) {
      if (typeof specifier !== 'string') {
        malformed.push(`${field}.${name}`);
        continue;
      }
      if (name && !declared.has(name)) declared.set(name, specifier);
    }
  }
  return { declared, malformed };
}

/** 读取清单声明的脚本名：只接受字符串命令；坏类型不输出假的可用脚本，并记入 malformed。 */
function readDeclaredScripts(manifest: Record<string, unknown> | undefined):
  { scripts: string[]; malformed: string[] } {
  const scripts: string[] = [];
  const malformed: string[] = [];
  const value = manifest?.['scripts'];
  if (value === undefined) return { scripts, malformed };
  if (!isPlainObject(value)) {
    malformed.push('scripts');
    return { scripts, malformed };
  }
  for (const [name, command] of Object.entries(value)) {
    if (typeof command !== 'string') {
      malformed.push(`scripts.${name}`);
      continue;
    }
    if (name) scripts.push(name);
  }
  return { scripts, malformed };
}

type DeclaredPackageManager =
  | { kind: PackageManager }
  | { kind: 'unsupported'; name: string }
  | { kind: 'malformed' }
  | { kind: 'none' };

function readDeclaredPackageManager(manifest: Record<string, unknown> | undefined): DeclaredPackageManager {
  const raw = manifest?.['packageManager'];
  // 字段显式存在但不是非空字符串：失效关闭，不得当作“未声明”继续推断。
  if (raw !== undefined && (typeof raw !== 'string' || !raw.trim())) return { kind: 'malformed' };
  if (typeof raw !== 'string') return { kind: 'none' };
  const at = raw.indexOf('@');
  const name = (at > 0 ? raw.slice(0, at) : raw).trim().toLowerCase();
  if (name === 'npm' || name === 'pnpm') return { kind: name };
  return { kind: 'unsupported', name: raw };
}

/**
 * 依据 packageManager 声明与锁文件推断实际包管理器（不产出冲突，仅用于选择 workspace 声明来源）。
 * 声明不受支持或无法判定时返回 undefined，由调用方按既有优先级退化处理。
 */
function inferPackageManager(
  manifest: Record<string, unknown> | undefined,
  realRoot: string,
): PackageManager | undefined {
  const declared = readDeclaredPackageManager(manifest);
  if (declared.kind === 'npm' || declared.kind === 'pnpm') return declared.kind;
  const npmLock = lockFileExists(realRoot, 'npm');
  const pnpmLock = lockFileExists(realRoot, 'pnpm');
  if (npmLock && !pnpmLock) return 'npm';
  if (pnpmLock && !npmLock) return 'pnpm';
  return undefined;
}

function gitChildEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of GIT_ENV_OVERRIDES) delete env[key];
  env['GIT_TERMINAL_PROMPT'] = '0';
  return env;
}

/**
 * 枚举当前 Git 配置视图中的 filter driver 名。`git config` 只读取配置文件，
 * 不触碰工作区内容，因此不会触发任何用户 filter；与 status 使用同一套清除后的环境，
 * 故读取结果与 status 实际可见的配置一致。
 *
 * 输出以 `-z` 取得 NUL 终止记录（记录格式为 `key\nvalue\0`：沙箱 Git 2.34.1 实测；
 * `git config -z` 的记录分隔行为自该选项引入起保持稳定，宿主 Git 2.48.1 由正式复跑确认），
 * 以便区分“记录完整”与“输出被截断”。失效关闭规则：
 * - 退出码 1 表示“无匹配配置”，属正常（无 filter）；
 * - 其余退出码、spawn 错误、stdout 非字符串、末条记录缺 NUL、记录结构不可解析，
 *   或 driver 名无法可靠屏蔽 → 一律判定枚举失败，由调用方停止 status 并报 git unavailable。
 */
type FilterDriverEnumeration =
  | { ok: true; drivers: string[] }
  | { ok: false; reason: string };

function readGitFilterDrivers(realRoot: string, env: Record<string, string | undefined>): FilterDriverEnumeration {
  const result = spawnSync('git', [...GIT_BASE_ARGV, 'config', '-z', '--get-regexp', '^filter\\..+\\.(clean|process|smudge)$'], {
    cwd: realRoot, encoding: 'utf8', env, timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) return { ok: false, reason: `枚举 Git filter 配置失败：${result.error.message}` };
  if (result.status === 1) return { ok: true, drivers: [] };
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return { ok: false, reason: `枚举 Git filter 配置失败：退出码 ${String(result.status)}` };
  }
  const stdout = result.stdout;
  if (stdout === '') return { ok: true, drivers: [] };
  const fields = stdout.split('\0');
  const tail = fields.pop();
  if (tail !== undefined && tail !== '') {
    return { ok: false, reason: '枚举 Git filter 配置的输出不完整（末条记录缺少 NUL 终止）' };
  }
  const drivers = new Set<string>();
  for (const field of fields) {
    if (field === '') return { ok: false, reason: '枚举 Git filter 配置出现空记录' };
    const newline = field.indexOf('\n');
    const key = newline >= 0 ? field.slice(0, newline) : field;
    const match = /^filter\.(.+)\.(clean|process|smudge)$/.exec(key);
    if (!match) return { ok: false, reason: `无法可靠解析的 filter 配置项：${JSON.stringify(key)}` };
    const name = match[1]!;
    if (!FILTER_DRIVER_NAME_PATTERN.test(name) || name.includes('..') || name.endsWith('.')) {
      return { ok: false, reason: `filter driver 名无法可靠屏蔽：${JSON.stringify(name)}` };
    }
    drivers.add(name);
  }
  return { ok: true, drivers: [...drivers].sort() };
}

/**
 * 屏蔽用户 filter：将 clean/process/smudge 置空并关闭 required，使 filter 变为 no-op 透传。
 * 实测（Git 2.48.1）：仅置空 clean 在 filter.<driver>.required=true 时会 fatal，
 * 必须同时覆盖 required。该做法不执行任何用户命令。
 * 语义边界（宿主已实证，不再声称“完全同语义”）：对“原样透传”型 filter，脏判定与不禁用时一致；
 * 对“变换型” filter（clean 会改写内容），置空后 Git 以原始字节与索引中的已过滤 blob 比对，
 * 可能把真实改动误判为未改（false-clean）。该漏报由 readGitFilterAssociatedPaths 收口：
 * 只读枚举实际关联已枚举 driver 的已跟踪路径并保守记为 dirty，因此这类路径会被多报，
 * 但不会漏报；差异方向以该实现为准，不宣称“只多报不漏报”适用于其他场景。
 */
function gitFilterShieldArgs(drivers: readonly string[]): string[] {
  const args: string[] = [];
  for (const name of drivers) {
    args.push(
      '-c', `filter.${name}.clean=`,
      '-c', `filter.${name}.process=`,
      '-c', `filter.${name}.smudge=`,
      '-c', `filter.${name}.required=false`,
    );
  }
  return args;
}

/**
 * 解析 `git status --porcelain -z` 输出（结构经沙箱 Git 2.34.1 实测复现，
 * 宿主 Git 2.48.1 侧已由 C 核对状态列空格与 rename 字段顺序）：
 * - 普通条目为 `XY PATH\0`（两列状态 + 一个空格，`-z` 下路径不做引号/八进制转义）；
 * - rename/copy 条目为 `XY <目标>\0<源>\0`，源路径是紧随其后的独立 NUL 字段，且必须先记目标后记源。
 *
 * 失效关闭：末条记录缺 NUL 终止（输出被截断）、状态列非法、条目缺少路径、rename 缺少源路径，
 * 一律判定不可信，由调用方整体报 git unavailable + 空 dirtyPaths；
 * 不允许把不可信输出裁剪成“看起来干净/少量路径”的结果冒充已观察。
 */
function parsePorcelainZStatus(stdout: string): { ok: true; paths: string[] } | { ok: false } {
  if (stdout === '') return { ok: true, paths: [] };
  const fields = stdout.split('\0');
  const tail = fields.pop();
  if (tail !== undefined && tail !== '') return { ok: false };
  const paths: string[] = [];
  let expectOrigPath = false;
  for (const field of fields) {
    if (expectOrigPath) {
      if (field === '') return { ok: false };
      paths.push(field);
      expectOrigPath = false;
      continue;
    }
    if (field.length < 4 || field[2] !== ' ') return { ok: false };
    if (!PORCELAIN_STATUS_CHARS.has(field[0]!) || !PORCELAIN_STATUS_CHARS.has(field[1]!)) return { ok: false };
    const entryPath = field.slice(3);
    if (!entryPath) return { ok: false };
    paths.push(entryPath);
    if (PORCELAIN_RENAME_CHARS.has(field[0]!) || PORCELAIN_RENAME_CHARS.has(field[1]!)) expectOrigPath = true;
  }
  if (expectOrigPath) return { ok: false };
  return { ok: true, paths };
}

/**
 * 按 NUL 切分并校验完整性：输出必须以 NUL 结尾，否则视为被截断（不可信）。
 */
function splitNulTerminated(stdout: string): { ok: true; records: string[] } | { ok: false } {
  if (stdout === '') return { ok: true, records: [] };
  const parts = stdout.split('\0');
  const tail = parts.pop();
  if (tail !== undefined && tail !== '') return { ok: false };
  return { ok: true, records: parts };
}

/**
 * 已跟踪路径（`ls-files` 输出）在送入属性命令、并入 dirtyPaths 之前的词法校验。
 * 复用 workspace 参数的同一套约束：拒绝空串、绝对路径、`.`/`..` 段、空段、设备名、
 * Windows 非法字符与末尾点/空格；这些形态都不能作为契约内的项目相对路径
 * （`integrationPathSchema`），出现即整体失效关闭，绝不拼进 dirtyPaths 让契约校验失败。
 */
function isTrackedRelPathValid(relPath: string): boolean {
  if (!isLexicalWorkspacePathValid(relPath)) return false;
  return !relPath.includes('\u007f');
}

/**
 * 只读枚举已跟踪路径：固定 argv 的 `ls-files -z`（cwd 即项目根，输出本就是项目相对路径，
 * 因此 Git 根在项目根之上时不会把项目外路径带进来）。
 *
 * 任一路径不满足项目相对路径的词法约束即判定本次枚举不可信：这些路径既不能送入
 * 属性命令（可能指向项目外目标），也不能并入 dirtyPaths（会产出无法通过契约校验的结果）。
 * 因此在调用 check-attr 之前就整体失效关闭，由调用方报 git unavailable。
 */
function readGitTrackedPaths(
  realRoot: string,
  env: Record<string, string | undefined>,
  shield: readonly string[],
): { ok: true; paths: string[] } | { ok: false } {
  const listed = spawnSync('git', [...GIT_BASE_ARGV, ...shield, 'ls-files', '-z'], {
    cwd: realRoot, encoding: 'utf8', env, timeout: 20000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (listed.error || listed.status !== 0 || typeof listed.stdout !== 'string') return { ok: false };
  const tracked = splitNulTerminated(listed.stdout);
  if (!tracked.ok) return { ok: false };
  for (const relPath of tracked.records) {
    if (!isTrackedRelPathValid(relPath)) return { ok: false };
  }
  return { ok: true, paths: tracked.records };
}

/**
 * 只读探测项目范围内是否存在子模块 gitlink（index mode 160000）。
 *
 * 背景：`git status` 默认会递归检查子模块工作区，递归过程中会执行子仓自己的
 * filter helper（C 已实证：父仓 filter 枚举为空，marker 仍从 2 变 3）——即使用户没有要求
 * 执行任何项目代码。因此所有 status 一律加 `--ignore-submodules=all`；但“忽略子模块”不等于
 * “已观察”：项目内存在 gitlink 时无法安全完整识别其 dirty 状态，必须明确报 unavailable，
 * 不得忽略后伪称 clean（也不得一律 unavailable：普通无 gitlink 项目保持既有脏识别）。
 *
 * 做法：**所有已能进入 Git 状态读取的项目都固定执行**一次只读的 `ls-files --stage -z`
 * （cwd 即项目根，输出本就是项目相对路径，故项目范围之外的子模块不会出现在结果里），
 * 逐条校验记录结构 `<mode> <sha> <stage>\t<path>\0`；发现 160000 即判定项目内存在 gitlink。
 * 该命令只读索引，不触碰工作区内容，不会触发任何 filter。
 *
 * 为什么不能用工作树形态做触发前置（C 复审实证，`c-gitlink-trigger-implementation-review-2026-11-17.md`）：
 * gitlink 登记在**索引**里——子模块目录可以不存在，`.gitmodules` 可以在当前 project 根之外、
 * 被用户删除或从未登记，plain `ls-files` 只有路径名、不能据此证明“不是 gitlink”。
 * 依据工作树目录/`.gitmodules` 推断 index 模式会漏掉本应 unavailable 的项目，
 * 并让 status 在忽略子模块后伪称 clean。因此不为省一个只读子进程而推断，一律枚举。
 *
 * 失效关闭：退出码异常、spawn 错误、末条缺 NUL、记录缺 `\t`、字段不是三段、
 * mode/stage/路径形态非法 → 一律判不可信，由调用方整体报 git unavailable。
 */
function readGitGitlinkState(
  realRoot: string,
  env: Record<string, string | undefined>,
  shield: readonly string[],
): { ok: true; hasGitlink: boolean } | { ok: false } {
  const staged = spawnSync('git', [...GIT_BASE_ARGV, ...shield, 'ls-files', '--stage', '-z'], {
    cwd: realRoot, encoding: 'utf8', env, timeout: 20000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (staged.error || staged.status !== 0 || typeof staged.stdout !== 'string') return { ok: false };
  const records = splitNulTerminated(staged.stdout);
  if (!records.ok) return { ok: false };
  let hasGitlink = false;
  for (const record of records.records) {
    const tab = record.indexOf('\t');
    if (tab < 0) return { ok: false };
    const fields = record.slice(0, tab).split(' ');
    const relPath = record.slice(tab + 1);
    if (fields.length !== 3) return { ok: false };
    const [mode, oid, stage] = fields as [string, string, string];
    if (!INDEX_MODE_PATTERN.test(mode) || !/^[0-9a-fA-F]{40,64}$/.test(oid) || !INDEX_STAGE_PATTERN.test(stage)) {
      return { ok: false };
    }
    if (!isTrackedRelPathValid(relPath)) return { ok: false };
    if (mode === GITLINK_MODE) hasGitlink = true;
  }
  return { ok: true, hasGitlink };
}

/**
 * 只读枚举“实际关联用户 filter”的已跟踪路径，用于收口变换型 filter 的 false-clean。
 *
 * 根因：把 filter 置空后，`status` 用**原始字节**与索引中的**已过滤 blob** 比对；当用户把文件
 * 改写成“变换后的内容”时，原始字节恰好等于索引 blob，status 输出为空 → 漏报真实改动。
 *
 * 做法：已跟踪路径由 readGitTrackedPaths 取得（调用前已完成逐条词法校验），
 * 再用 `check-attr -z filter --stdin` 取每条路径的 filter 属性
 * （记录形如 `<path>\0filter\0<info>\0`）。只有属性值等于**已枚举到的 driver 名**时才认为关联，
 * 随后保守并入 dirtyPaths——即使置空 filter 后的 raw status 为空。
 * 这是明确的只读保守边界：受 filter 影响的未修改路径会被多报为 dirty。
 *
 * 名称歧义失效关闭：信息值 `set`/`unset`/`unspecified` 与“driver 就叫这个名字”的输出
 * 完全一致，但前者是属性状态、后者会真实应用 filter.<name>.clean（索引字节已变换），
 * 无法据此可靠区分。一旦该名字同时是已枚举 driver，整体判不可信报 unavailable——
 * 既不会把未关联文件全标脏（多报），也不会在消掉多报时漏报真实改动。
 *
 * 失效关闭：退出码异常、spawn 错误、末条缺 NUL、记录不是三字段、属性名不符、
 * 路径不在本次输入的已跟踪集合内或重复、已跟踪路径缺失记录、名称歧义
 * → 一律判不可信，由调用方整体报 git unavailable
 * （不用“清洗成干净”冒充观察，也不用全部 unavailable 掩盖清单改动）。
 */
function readGitFilterAssociatedPaths(
  realRoot: string,
  env: Record<string, string | undefined>,
  shield: readonly string[],
  drivers: readonly string[],
  tracked: readonly string[],
): { ok: true; associated: string[] } | { ok: false } {
  if (drivers.length === 0 || tracked.length === 0) return { ok: true, associated: [] };
  const attrs = spawnSync('git', [...GIT_BASE_ARGV, ...shield, 'check-attr', '-z', '--stdin', 'filter'], {
    cwd: realRoot, encoding: 'utf8', env, timeout: 20000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    input: `${tracked.join('\0')}\0`,
  });
  if (attrs.error || attrs.status !== 0 || typeof attrs.stdout !== 'string') return { ok: false };
  const fields = splitNulTerminated(attrs.stdout);
  if (!fields.ok) return { ok: false };
  if (fields.records.length === 0 || fields.records.length % 3 !== 0) return { ok: false };
  const expected = new Set(tracked);
  const seen = new Set<string>();
  const associated: string[] = [];
  for (let index = 0; index < fields.records.length; index += 3) {
    const relPath = fields.records[index]!;
    const attribute = fields.records[index + 1]!;
    const info = fields.records[index + 2]!;
    if (attribute !== 'filter') return { ok: false };
    // 路径归属可靠：必须是本次输入的已跟踪路径，且不重复、不遗漏。
    if (!expected.has(relPath) || seen.has(relPath)) return { ok: false };
    seen.add(relPath);
    if (!drivers.includes(info)) continue;
    // 属性状态值与已枚举 driver 同名：无法可靠区分“未关联”与“显式关联同名 driver”。
    if (CHECK_ATTR_STATE_INFO.has(info)) return { ok: false };
    associated.push(relPath);
  }
  if (seen.size !== expected.size) return { ok: false };
  return { ok: true, associated };
}

function readGitStatus(realRoot: string): GitStatus {
  const env = gitChildEnv();
  // 枚举失败/不可靠屏蔽即停止：不再调用后续任何 Git 命令，直接报 unavailable。
  const enumeration = readGitFilterDrivers(realRoot, env);
  if (!enumeration.ok) return { status: 'unavailable', dirtyPaths: [] };
  const shield = gitFilterShieldArgs(enumeration.drivers);
  // 已跟踪路径：既是 filter 关联枚举的输入，也是 gitlink 探测的触发依据。
  // 任一路径不合法即在送入任何属性命令前失效关闭（不得产出非法 inspection）。
  const tracked = readGitTrackedPaths(realRoot, env, shield);
  if (!tracked.ok) return { status: 'unavailable', dirtyPaths: [] };
  // 子模块零执行：项目内存在 gitlink 时无法安全完整识别其 dirty 状态。
  // 必须在调用 status 之前判定，避免给递归执行子仓代码留下任何机会，也不得忽略后伪称 clean。
  const gitlink = readGitGitlinkState(realRoot, env, shield);
  if (!gitlink.ok || gitlink.hasGitlink) return { status: 'unavailable', dirtyPaths: [] };
  // 定位 Git 根与项目根相对前缀：porcelain v1 路径相对 Git 根，需折算为项目相对并剔除项目外条目。
  const prefixResult = spawnSync('git', [...GIT_BASE_ARGV, ...shield, 'rev-parse', '--show-toplevel', '--show-prefix'], {
    cwd: realRoot, encoding: 'utf8', env, timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  if (prefixResult.error || prefixResult.status !== 0 || typeof prefixResult.stdout !== 'string') {
    return { status: 'unavailable', dirtyPaths: [] };
  }
  const prefixLines = prefixResult.stdout.split(/\r?\n/);
  const prefix = (prefixLines[1] ?? '').trim();
  // `--ignore-submodules=all`：不递归检查子模块工作区（递归会执行子仓自己的 filter helper）。
  // 与基础 argv 中的 `-c status.submoduleSummary=false` 共同保证 status 不触碰子仓。
  const result = spawnSync('git', [...GIT_BASE_ARGV, ...shield, 'status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=all'], {
    cwd: realRoot, encoding: 'utf8', env, timeout: 20000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    return { status: 'unavailable', dirtyPaths: [] };
  }
  // 先取完整记录（含 rename 的源与目标），再按 project root 限定路径。
  const parsed = parsePorcelainZStatus(result.stdout);
  if (!parsed.ok) return { status: 'unavailable', dirtyPaths: [] };
  const dirtyPaths: string[] = [];
  const seen = new Set<string>();
  for (const entryPath of parsed.paths) {
    let normalized = toPosix(entryPath);
    if (prefix) {
      // 只保留项目根之内的路径，并折算为项目相对路径。
      if (!normalized.startsWith(prefix)) continue;
      normalized = normalized.slice(prefix.length);
      if (!normalized) continue;
    }
    const dedupeKey = normalized.normalize('NFC').toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    dirtyPaths.push(normalized);
  }
  // 变换型 filter 的 false-clean 收口：把实际关联已枚举 filter driver 的已跟踪路径保守并入。
  // 这些路径即使置空 filter 后 raw status 为空，也可能藏着被改写成“变换后内容”的真实改动。
  const associated = readGitFilterAssociatedPaths(realRoot, env, shield, enumeration.drivers, tracked.paths);
  if (!associated.ok) return { status: 'unavailable', dirtyPaths: [] };
  for (const relPath of associated.associated) {
    // ls-files 的 cwd 即项目根，输出本就是项目相对路径（与 porcelain 折算后的口径一致）。
    const normalized = toPosix(relPath);
    if (!normalized) continue;
    const dedupeKey = normalized.normalize('NFC').toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    dirtyPaths.push(normalized);
  }
  return dirtyPaths.length > 0 ? { status: 'dirty', dirtyPaths } : { status: 'clean', dirtyPaths: [] };
}

export async function inspectProject(root: string, options?: { workspace?: string }): Promise<LocalProjectInspectionV1> {
  const resolvedRoot = path.resolve(root);
  if (!isDirectory(resolvedRoot)) {
    throw new Error(`项目根目录不存在或不是目录：${resolvedRoot}`);
  }
  const realRoot = realpathOrSelf(resolvedRoot);
  const conflicts: IntegrationConflict[] = [];
  const addConflict = (code: IntegrationConflict['code'], message: string, extra?: { path?: string }): void => {
    conflicts.push({ code, message, blocking: true, ...(extra?.path !== undefined ? { path: extra.path } : {}) });
  };

  const probes = new Map<string, FileProbe>();
  const probe = (relativePosix: string): FileProbe => {
    const cached = probes.get(relativePosix);
    if (cached) return cached;
    const abs = path.join(realRoot, ...relativePosix.split('/'));
    let result: FileProbe;
    if (!isFile(abs)) {
      result = { exists: false, escaped: false };
    } else {
      const real = realpathOrSelf(abs);
      if (!isInsideDirectory(realRoot, real)) {
        result = { exists: true, escaped: true };
      } else {
        const bytes = fs.readFileSync(real);
        result = {
          exists: true, escaped: false,
          snapshot: { path: relativePosix, exists: true, sha256: createHash('sha256').update(bytes).digest('hex') },
        };
      }
    }
    probes.set(relativePosix, result);
    return result;
  };

  // 根清单：逃逸或不可读均记录冲突，缺失时不虚构内容。
  const rootManifestProbe = probe('package.json');
  let rootManifest: Record<string, unknown> | undefined;
  if (rootManifestProbe.escaped) {
    addConflict('PATH_UNSAFE', '根 package.json 的 realpath 逃逸出项目根', { path: 'package.json' });
  } else {
    rootManifest = readManifest(realRoot);
    if (!rootManifest) addConflict('WORKSPACE_INVALID', '根 package.json 不可读或不是合法 JSON 对象');
  }

  // workspace 目标解析（词法 → 存在性 → realpath 边界）。
  const workspaceResolved = resolveWorkspaceTarget(resolvedRoot, options?.workspace);
  let workspace = '.';
  let targetDetermined = false;
  let targetManifest: Record<string, unknown> | undefined;
  if (!workspaceResolved.ok) {
    conflicts.push(workspaceResolved.conflict);
  } else {
    workspace = workspaceResolved.workspace;
    targetDetermined = true;
    if (workspace === '.') {
      targetManifest = rootManifest;
    } else {
      const memberProbe = probe(`${workspace}/package.json`);
      if (memberProbe.escaped) {
        addConflict('PATH_UNSAFE', `目标清单 ${workspace}/package.json 的 realpath 逃逸出项目根`, { path: `${workspace}/package.json` });
      } else {
        targetManifest = readManifest(workspaceResolved.targetDir);
        if (!targetManifest) {
          addConflict('WORKSPACE_INVALID', `目标 workspace 的 package.json 不可读或不是合法 JSON 对象：${workspace}`, { path: `${workspace}/package.json` });
        }
      }
    }
  }

  // 锁与 workspace 声明文件的存在性/逃逸探测（快照在结果中统一给出）。
  for (const lockRelative of [NPM_LOCK_FILE, PNPM_LOCK_FILE]) {
    if (probe(lockRelative).escaped) {
      addConflict('PATH_UNSAFE', `锁文件 ${lockRelative} 的 realpath 逃逸出项目根`, { path: lockRelative });
    }
  }
  const pnpmWorkspaceProbe = probe(PNPM_WORKSPACE_FILE);
  if (pnpmWorkspaceProbe.escaped) {
    addConflict('PATH_UNSAFE', `pnpm-workspace.yaml 的 realpath 逃逸出项目根`, { path: PNPM_WORKSPACE_FILE });
  }

  // 目标清单字段类型校验：坏类型一律失效关闭（不静默丢弃依赖声明、不输出假的可用脚本）。
  const targetManifestPath = workspace === '.' ? 'package.json' : `${workspace}/package.json`;
  const targetDependenciesRead = readDeclaredDependencies(targetManifest);
  const targetScriptsRead = readDeclaredScripts(targetManifest);
  for (const field of targetDependenciesRead.malformed) {
    addConflict('WORKSPACE_INVALID', `目标清单的 ${field} 声明不是字符串，无法可靠识别依赖`, { path: targetManifestPath });
  }
  for (const field of targetScriptsRead.malformed) {
    addConflict('WORKSPACE_INVALID', `目标清单的 ${field} 不是字符串，不能当作可用脚本`, { path: targetManifestPath });
  }

  // monorepo 声明与成员校验：根未指定 --workspace 必须冲突；成员必须落在声明的 glob 子集内。
  if (targetDetermined && rootManifest) {
    const npmPatternsRead = readNpmWorkspacePatterns(rootManifest);
    // 外链（realpath 逃逸）的声明文件一律不读取，只用 PATH_UNSAFE 表达，禁止跟随链接取字节。
    const pnpmPatternsRead = pnpmWorkspaceProbe.exists && !pnpmWorkspaceProbe.escaped
      ? readPnpmWorkspacePatterns(path.join(realRoot, PNPM_WORKSPACE_FILE))
      : undefined;
    // 依据实际包管理器选择原生 workspace 声明：pnpm 项目只认 pnpm-workspace.yaml，
    // npm 项目只认 package.json workspaces；不得用另一种包管理器的声明接受对方已排除的成员。
    // pnpm 项目缺少 pnpm-workspace.yaml 即无原生成员声明（契约也要求 inspected 的 pnpm workspace
    // 必须带该文件快照），此时按“未声明成员”处理，不退回 npm 声明。
    // 包管理器无法判定（无 packageManager 声明且锁缺失/并存）时维持“npm 优先、其次 pnpm”的既有优先级。
    const effectivePm = inferPackageManager(rootManifest, realRoot);
    let declarationRead: WorkspacePatternsRead | undefined;
    let monorepo: PackageManager | undefined;
    if (effectivePm === 'pnpm') {
      declarationRead = pnpmPatternsRead;
      monorepo = declarationRead === undefined ? undefined : 'pnpm';
    } else if (effectivePm === 'npm') {
      declarationRead = npmPatternsRead;
      monorepo = declarationRead === undefined ? undefined : 'npm';
    } else {
      declarationRead = npmPatternsRead ?? pnpmPatternsRead;
      monorepo = declarationRead === undefined ? undefined : (npmPatternsRead !== undefined ? 'npm' : 'pnpm');
    }
    if (monorepo && workspace === '.') {
      addConflict('WORKSPACE_REQUIRED', 'monorepo 必须通过 --workspace 指定目标成员目录', { path: monorepo === 'pnpm' ? PNPM_WORKSPACE_FILE : 'package.json' });
      targetDetermined = false;
    } else if (monorepo && workspace !== '.') {
      const declarationPath = monorepo === 'npm' ? 'package.json' : PNPM_WORKSPACE_FILE;
      const read = declarationRead!;
      if (!read.ok) {
        // 声明不可解析（多文档歧义、非字符串条目、packages 类型错误等）：失效关闭，不猜测成员范围。
        addConflict('WORKSPACE_INVALID', `无法解析 workspace 声明：${read.message}`, { path: declarationPath });
        targetDetermined = false;
      } else if (read.patterns.some(pattern => !isSupportedWorkspacePattern(pattern))) {
        addConflict('WORKSPACE_INVALID', 'workspace 声明含有不支持的 glob 语法（仅支持完整路径段 * 与 **）', { path: declarationPath });
        targetDetermined = false;
      } else if (!matchesAnyWorkspacePattern(read.patterns, workspace)) {
        addConflict('WORKSPACE_INVALID', `目标目录不在声明的 workspace 成员范围内：${workspace}`, { path: workspace });
        // 成员资格未确认：不再解析该目录的锁 importer、依赖与脚本，避免把被拒成员当作已验证目标。
        targetDetermined = false;
      }
    } else if (!monorepo && workspace !== '.') {
      addConflict('WORKSPACE_INVALID', '项目未声明 workspace 成员，不能指定 --workspace');
      // 成员资格未确认：不解析该目录的锁 importer、依赖与脚本。
      targetDetermined = false;
    }
  }

  // 包管理器与锁文件：声明、锁类型必须一致；缺锁、多锁、格式不支持均为明确冲突。
  let packageManager: PackageManager | undefined;
  let lockFormat: 'npm-v3' | 'pnpm-v9' | undefined;
  let lockPath: string | undefined;
  let npmData: NpmLockData | undefined;
  let pnpmData: PnpmLockData | undefined;
  if (targetDetermined) {
    const declaredPm = readDeclaredPackageManager(rootManifest);
    const npmLock = lockFileExists(realRoot, 'npm');
    const pnpmLock = lockFileExists(realRoot, 'pnpm');
    const foreignLocks = foreignLocksPresent(realRoot);
    if (declaredPm.kind === 'malformed') {
      // packageManager 显式存在但不是非空字符串：失效关闭，不得当作未声明继续推断。
      addConflict('WORKSPACE_INVALID', '根 package.json 的 packageManager 声明不是非空字符串，无法确定包管理器');
    } else if (declaredPm.kind === 'unsupported') {
      addConflict('PACKAGE_MANAGER_UNSUPPORTED', `不支持的包管理器声明：${declaredPm.name}（仅支持 npm 与 pnpm）`);
    } else if (npmLock && pnpmLock) {
      addConflict('LOCKFILE_MULTIPLE', '同时存在 package-lock.json 与 pnpm-lock.yaml，无法确定包管理器');
    } else if (foreignLocks.length > 0 && (npmLock || pnpmLock)) {
      // 受支持锁与其他包管理器锁并存：明确冲突，不自动迁移或创建锁。
      addConflict('LOCKFILE_MULTIPLE', `受支持锁与其他包管理器锁并存：${foreignLocks.join('、')}`);
    } else if (declaredPm.kind === 'npm' && pnpmLock) {
      addConflict('PACKAGE_MANAGER_MISMATCH', 'packageManager 声明为 npm，但项目只有 pnpm-lock.yaml');
    } else if (declaredPm.kind === 'pnpm' && npmLock) {
      addConflict('PACKAGE_MANAGER_MISMATCH', 'packageManager 声明为 pnpm，但项目只有 package-lock.json');
    } else if (!npmLock && !pnpmLock) {
      if (foreignLocks.length > 0) {
        // 仅有其他包管理器锁：显式不支持，不静默按缺锁忽略。
        addConflict('LOCKFILE_UNSUPPORTED', `仅找到其他包管理器锁（${foreignLocks.join('、')}），不支持该包管理器`);
      } else {
        addConflict('LOCKFILE_MISSING', '未找到受支持的锁文件（package-lock.json v3 或 pnpm-lock.yaml v9）');
      }
    } else {
      packageManager = declaredPm.kind === 'npm' || declaredPm.kind === 'pnpm' ? declaredPm.kind : (npmLock ? 'npm' : 'pnpm');
      const lockRelative = packageManager === 'npm' ? NPM_LOCK_FILE : PNPM_LOCK_FILE;
      if (probe(lockRelative).escaped) {
        addConflict('PATH_UNSAFE', `锁文件 ${lockRelative} 的 realpath 逃逸出项目根`, { path: lockRelative });
      } else {
        const read = packageManager === 'npm' ? readNpmLock(realRoot) : readPnpmLock(realRoot);
        if (read.ok) {
          lockFormat = read.format;
          lockPath = lockRelative;
          if (read.format === 'npm-v3') npmData = read.data; else pnpmData = read.data;
        } else if (read.reason === 'unsupported') {
          addConflict('LOCKFILE_UNSUPPORTED', read.message, { path: lockRelative });
        } else {
          addConflict('LOCKFILE_INVALID', read.message, { path: lockRelative });
        }
      }
    }
  }

  // 目标 importer 必须存在于锁中。
  let importerKey: string | undefined;
  let importerPresent = false;
  if (targetDetermined && packageManager && lockFormat) {
    importerKey = packageManager === 'npm'
      ? (workspace === '.' ? '' : workspace)
      : (workspace === '.' ? '.' : workspace);
    importerPresent = packageManager === 'npm'
      ? npmData!.packages[importerKey] !== undefined
      : pnpmData!.importers[importerKey] !== undefined;
    if (!importerPresent) {
      addConflict('IMPORTER_MISSING', `锁文件中没有目标 importer：${importerKey}`, { path: lockPath });
    }
  }

  // 框架判定与精确版本解析：范围不当成精确版本，无法从锁证实即冲突。
  const resolvedDependencies: (IntegrationDependency & { specifier: string })[] = [];
  let framework: 'vue' | 'react' | undefined;
  if (targetDetermined && targetManifest && packageManager && lockFormat && importerPresent && importerKey !== undefined) {
    const declared = targetDependenciesRead.declared;
    const hasVue = declared.has('vue');
    const hasReact = declared.has('react');
    if (hasVue && hasReact) {
      addConflict('FRAMEWORK_AMBIGUOUS', '同时声明 vue 与 react 依赖，无法确定目标框架');
    } else if (hasVue) {
      framework = 'vue';
    } else if (hasReact) {
      framework = 'react';
    } else {
      addConflict('FRAMEWORK_MISSING', '未声明受支持的框架依赖（vue 3 或 react 19）');
    }

    const resolvedVersions = new Map<string, string>();
    for (const [name, specifier] of declared) {
      const resolved = packageManager === 'npm'
        ? resolveNpmDependency(npmData!.packages, importerKey, name)
        : resolvePnpmDependency(pnpmData!.importers, importerKey, name);
      const version = resolved?.version;
      if (!version || !EXACT_VERSION.test(version)) {
        addConflict('VERSION_UNRESOLVED', `依赖 ${name} 的声明无法从锁文件证实为精确版本`);
        continue;
      }
      // 锁内条目不完整（缺 specifier / specifier 非字符串）或近层条目遮蔽后无法解析：
      // 不得默认相信缺失字段，也不得借用其他层版本冒充一致；显式冲突且不计入已解析依赖。
      if (resolved?.unresolved) {
        addConflict('VERSION_MISMATCH', `依赖 ${name} 的锁文件条目不完整（缺少可核对的 specifier 或精确版本），无法验证与 package.json 声明的一致性`);
        continue;
      }
      let clean = true;
      if (resolved?.specifier !== undefined && resolved.specifier !== specifier) {
        addConflict('VERSION_MISMATCH', `依赖 ${name} 的锁文件声明（${resolved.specifier}）与 package.json 声明（${specifier}）不一致`);
        clean = false;
      }
      const range = specifier ? semver.validRange(specifier) : null;
      if (specifier && range === null && !isApprovedNonRangeSpecifier(specifier)) {
        // 声明形似范围却不是有效 semver 范围，且不属于已批准的协议/tag：无法证实，显式冲突。
        addConflict('VERSION_UNRESOLVED', `依赖 ${name} 的声明 ${JSON.stringify(specifier)} 不是有效的 semver 范围，也不属于已批准的协议或 tag`);
        clean = false;
      } else if (specifier && range !== null && !semver.satisfies(version, range)) {
        addConflict('VERSION_MISMATCH', `依赖 ${name} 的锁存版本 ${version} 不满足声明范围 ${specifier}`);
        clean = false;
      }
      if (clean) {
        resolvedDependencies.push({ name, version, specifier });
        resolvedVersions.set(name, version);
      }
    }

    if (framework === 'vue') {
      const vueVersion = resolvedVersions.get('vue');
      if (vueVersion && !vueVersion.startsWith('3.')) {
        addConflict('FRAMEWORK_UNSUPPORTED', `锁存 vue 版本 ${vueVersion} 不属于受支持的 3.x`);
      }
    } else if (framework === 'react') {
      const reactVersion = resolvedVersions.get('react');
      if (reactVersion && !reactVersion.startsWith('19.')) {
        addConflict('FRAMEWORK_UNSUPPORTED', `锁存 react 版本 ${reactVersion} 不属于受支持的 19.x`);
      }
      if (!resolvedVersions.has('react-dom')) {
        addConflict('REACT_DOM_MISSING', 'React 项目缺少已解析的 react-dom 精确版本');
      }
    }
  }

  // 脚本名只取字符串命令条目；坏类型已在上面显式冲突，此处不输出假的可用脚本。
  const scripts = targetDetermined ? targetScriptsRead.scripts : [];
  const git = readGitStatus(realRoot);
  const fileSnapshots = [...probes.values()].flatMap(entry => (entry.snapshot ? [entry.snapshot] : []));

  const result: LocalProjectInspectionV1 = {
    schemaVersion: 1,
    status: conflicts.length > 0 ? 'conflicted' : 'inspected',
    workspace,
    ...(packageManager !== undefined ? { packageManager } : {}),
    ...(lockFormat !== undefined && lockPath !== undefined ? { lockfile: { path: lockPath, format: lockFormat } } : {}),
    ...(framework !== undefined ? { framework } : {}),
    resolvedDependencies,
    scripts,
    git,
    fileSnapshots,
    conflicts,
  };
  const checked = validateLocalProjectInspection(result);
  if (!checked.ok) {
    throw new Error(`inspectProject 产出未通过 LocalProjectInspectionV1 运行时校验：${JSON.stringify(checked.issues)}`);
  }
  return result;
}
