/**
 * T16 P1 受控依赖安装：包管理器只在工程外暂存区运行。
 *
 * 分为“候选锁生成”和“冻结依赖物化 / 受控目录交付”两个阶段，目标工程从不作为包管理器的
 * cwd/prefix/dir，也不通过临时更名项目 `.npmrc` 或删除 pnpmfile 实现隔离。
 *
 * 固定边界（docs/plans/2026-11-18-t16-b-install-isolation-brief.md 冻结）：
 * - 工具链只用工作区 `.tools` 内的固定绝对路径（Node 26.13.0 + npm 11.20.0 / pnpm 12.18.0），
 *   先验证绝对路径与 `--version`——含裸 `node.exe --version` 精确要求 `v26.13.0`，
 *   不从 PATH 查找、不 corepack、不 npx、不下载其他工具链；
 * - `spawn` 参数数组 + `shell:false`；argv 由产品按固定表构造，占位值不来自 `plan.commands`；
 * - 不继承完整 `process.env`：仅 Windows 必需键、固定工具 PATH、外部 TMP/TEMP、
 *   `CI=true` / `NO_COLOR=1`、两个隔离 npm 配置键与产品内部
 *   `PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false`；令牌绝不进 argv 或环境；
 * - registry 令牌只写进隔离 userconfig 的精确 host/path 键；API 令牌绝不进子进程；
 * - 候选锁生成后冻结；物化前由调用方持久化 `installStarted=true`；冻结锁被改写、
 *   实际版本不符、stage 外链接一律失败关闭；
 * - 目录交付只落在明确枚举的根/成员 `node_modules`，用同卷受控 rename 完成，不递归清理未知树。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';
import type { IntegrationDependency, IntegrationPlanV1 } from '../contracts/integration-plan.js';
import { isPlainObject, realpathOrSelf } from './workspace.js';

/** 安装类失败：映射为固定的 DEPENDENCY_CONFLICT / INSTALL_FAILED / INSTALLED_VERSION_MISMATCH issue。 */
export class InstallError extends Error {
  readonly code: 'DEPENDENCY_CONFLICT' | 'INSTALL_FAILED' | 'INSTALLED_VERSION_MISMATCH' | 'PATH_UNSAFE';

  constructor(code: InstallError['code'], message: string) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
  }
}

const FIXED_NODE_VERSION = '26.13.0';
const FIXED_NPM_VERSION = '11.20.0';
const FIXED_PNPM_VERSION = '12.18.0';
const NODE_DIRECTORY = `node-v${FIXED_NODE_VERSION}-win-x64`;
const PNPM_DIRECTORY = `pnpm-native-${FIXED_PNPM_VERSION}`;
const INSTALL_PROCESS_TIMEOUT_MS = 15 * 60 * 1000;

export type ResolvedToolchain = {
  toolRoot: string;
  nodeExe: string;
  npmCli: string;
  pnpmExe: string;
  npmVersion: string;
  pnpmVersion: string;
};

function moduleDirectory(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function isDirectory(absolute: string): boolean {
  try {
    return fs.statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 定位工作区 `.tools`：依次从本模块目录、cwd、实际启动进程的 Node 路径向上找。
 * 最后一项支持模块与 cwd 均在仓外的已安装 CLI；仍只接受固定目录与精确版本。
 * 找不到即失败关闭——绝不从 PATH 或其他位置猜测工具链。
 */
function findToolRoot(): string | undefined {
  const candidates = [moduleDirectory(), path.resolve(process.cwd()), path.dirname(process.execPath)];
  for (const start of candidates) {
    let current = path.resolve(start);
    for (;;) {
      const candidate = path.join(current, '.tools');
      if (isDirectory(path.join(candidate, NODE_DIRECTORY)) && isDirectory(path.join(candidate, PNPM_DIRECTORY, 'package'))) {
        return candidate;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return undefined;
}

/** 固定工具链的绝对路径（仅定位，不做版本校验）。 */
function resolveToolPaths(): { toolRoot: string; nodeExe: string; npmCli: string; pnpmExe: string } {
  const toolRoot = findToolRoot();
  if (toolRoot === undefined) {
    throw new InstallError('INSTALL_FAILED', '未找到工作区 .tools 固定工具链');
  }
  const paths = {
    toolRoot,
    nodeExe: path.join(toolRoot, NODE_DIRECTORY, 'node.exe'),
    npmCli: path.join(toolRoot, NODE_DIRECTORY, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    pnpmExe: path.join(toolRoot, PNPM_DIRECTORY, 'package', 'pnpm.exe'),
  };
  for (const required of [paths.nodeExe, paths.npmCli, paths.pnpmExe]) {
    if (!fs.existsSync(required)) {
      throw new InstallError('INSTALL_FAILED', '固定工具链产物不完整');
    }
  }
  return paths;
}

function runVersionProbe(command: string, args: readonly string[], env: Record<string, string>): string {
  const result = spawnSync(command, [...args], {
    cwd: path.dirname(command),
    env,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new InstallError('INSTALL_FAILED', '固定工具链版本校验失败');
  }
  return String(result.stdout ?? '').trim();
}

/**
 * 解析并校验固定工具链：绝对路径 + 精确版本，任一不符即失败关闭。
 * 裸 `node.exe --version` 先于 npm/pnpm 探针执行并精确要求 `v26.13.0`：
 * 路径含版本号不证明真实二进制版本；版本不符或探针进程失败都在任何
 * 候选锁 / 物化进程启动之前失败关闭。
 */
export function resolveToolchain(env: Record<string, string>): ResolvedToolchain {
  const paths = resolveToolPaths();
  const nodeVersion = runVersionProbe(paths.nodeExe, ['--version'], env);
  if (nodeVersion !== `v${FIXED_NODE_VERSION}`) {
    throw new InstallError('INSTALL_FAILED', '固定 Node 版本与预期不符');
  }
  const npmVersion = runVersionProbe(paths.nodeExe, [paths.npmCli, '--version'], env);
  if (npmVersion !== FIXED_NPM_VERSION) {
    throw new InstallError('INSTALL_FAILED', '固定 npm 版本与预期不符');
  }
  const pnpmVersion = runVersionProbe(paths.pnpmExe, ['--version'], env);
  if (pnpmVersion !== FIXED_PNPM_VERSION) {
    throw new InstallError('INSTALL_FAILED', '固定 pnpm 版本与预期不符');
  }
  return { ...paths, npmVersion, pnpmVersion };
}

export type InstallManifestInput = {
  /** 项目相对路径（`package.json` 或 `<member>/package.json`）。 */
  relative: string;
  /** 拟写入目标的新清单（已含新增精确依赖）。 */
  manifest: Record<string, unknown>;
};

export type InstallContextInput = {
  operationId: string;
  projectRoot: string;
  packageManager: 'npm' | 'pnpm';
  registryOrigin: string;
  registryToken?: string;
  /** 目标 importer（`.` 或成员相对路径）。 */
  workspace: string;
  /** 静态 workspace 成员（无成员时为空数组）。 */
  members: string[];
  manifests: InstallManifestInput[];
  /** 目标锁文件的项目相对路径。 */
  lockRelative: string;
  /** 计划的确切依赖（用于暂存清单与最终核验）。 */
  exactDependencies: IntegrationDependency[];
  /** 计划已核验的 registry 发布证据（只读；候选锁 SDK 身份绑定的基准，缺省时跳过以兼容低层直接调用）。 */
  registryEvidence?: IntegrationPlanV1['registryEvidence'];
  /** 交付日志落点（只读）：apply 恒传已核验备份根与计划摘要；缺省时低层直接调用不写日志。 */
  deliveryJournal?: { backupRoot: string; planDigest: string };
};

export type InstallContext = {
  input: InstallContextInput;
  toolchain: ResolvedToolchain;
  stagingRoot: string;
  envRoot: string;
  readyRoot: string;
  userConfig: string;
  /** 本次写入 userconfig 的字节 SHA-256：独立删除前的所有权证明，只存哈希不存令牌明文。 */
  userConfigSha256: string;
  globalConfig: string;
  cacheDirectory: string;
  temporaryDirectory: string;
  registryKey: string;
  /** 预检通过的成员 root 身份基准（member → 预检结论）；无成员时为空映射。 */
  memberChecks: ReadonlyMap<string, WorkspaceMemberCheck>;
  environment: Record<string, string>;
};

/** workspace 成员预检结论：真实 root 落点与清单 hash 是交付期身份复核的基准。 */
export type WorkspaceMemberCheck = {
  member: string;
  realRoot: string;
  manifestSha256: string | undefined;
};

/** 成员清单守卫：lstat 须为 nlink=1 的普通文件，返回字节 SHA-256；清单缺失返回 undefined。 */
function manifestGuardHash(memberRoot: string): string | undefined {
  const manifestPath = path.join(memberRoot, 'package.json');
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(manifestPath);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined;
    throw new InstallError('DEPENDENCY_CONFLICT', 'workspace 成员清单不可复核，拒绝安装');
  }
  if (!stats.isFile() || stats.nlink > 1) {
    throw new InstallError('DEPENDENCY_CONFLICT', 'workspace 成员清单不是普通文件或为硬链接，拒绝安装');
  }
  try {
    return createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
  } catch {
    throw new InstallError('DEPENDENCY_CONFLICT', 'workspace 成员清单不可读取，拒绝安装');
  }
}

/**
 * workspace 成员安全预检：从 root 起对每个成员父链逐段 lstat 证明普通目录（junction/链接即阻断），
 * realpath 证明真实落点位于已核验工程根内；成员清单按 file/nlink/hash 守卫。
 * 供 apply 在读取任何成员清单/启动候选锁之前调用；createInstallContext 内再次派生以闭合竞态窗口。
 */
export function verifyWorkspaceMemberRoots(projectRoot: string, members: readonly string[]): Map<string, WorkspaceMemberCheck> {
  const resolvedRoot = path.resolve(projectRoot);
  const realProjectRoot = realpathOrSelf(resolvedRoot);
  const checks = new Map<string, WorkspaceMemberCheck>();
  for (const member of members) {
    let current = resolvedRoot;
    for (const segment of member.split('/')) {
      current = path.join(current, segment);
      let stats: fs.Stats;
      try {
        stats = fs.lstatSync(current);
      } catch {
        throw new InstallError('DEPENDENCY_CONFLICT', 'workspace 成员路径链不可复核，拒绝安装');
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new InstallError('DEPENDENCY_CONFLICT', 'workspace 成员路径链含链接或非目录，拒绝安装');
      }
    }
    const realMemberRoot = realpathOrSelf(current);
    const inside = path.relative(realProjectRoot, realMemberRoot);
    if (inside.length === 0 || inside.startsWith('..') || path.isAbsolute(inside)) {
      throw new InstallError('DEPENDENCY_CONFLICT', 'workspace 成员真实落点不在已核验工程根内，拒绝安装');
    }
    checks.set(member, { member, realRoot: realMemberRoot, manifestSha256: manifestGuardHash(current) });
  }
  return checks;
}

const MANIFEST_FIELD_WHITELIST = [
  'name', 'version', 'private', 'type',
  'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies',
  'engines', 'workspaces',
] as const;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
const SUPPORTED_ENGINE_KEYS = new Set(['node', 'npm', 'pnpm']);
/** 直接影响解析且暂不支持的清单字段：出现即阻断，不静默安装。 */
const RESOLUTION_CRITICAL_FIELDS = ['overrides', 'resolutions', 'pnpm', 'config'];
/** 下载指令与生命周期脚本：暂存清单一律丢弃（安装侧另有 --ignore-scripts / 固定设置兜底）。 */
const DROPPED_MANIFEST_FIELDS = ['packageManager', 'scripts'];

/**
 * pnpm staging YAML 的固定设置（brief 冻结，缺一项即停止该安装分支）。
 * 2026-11-18 固定版本兼容裁定：pnpm 12.18.0 拒绝旧 YAML 键 `managePackageManagerVersions`，
 * 固定 YAML 改用 `pmOnFail: error`；包管理器版本切换由 buildInstallEnvironment 的
 * 产品内部环境键固定为 false，不继承宿主同名键。
 */
export const PNPM_STAGING_SETTINGS: Record<string, string | number | boolean> = {
  nodeLinker: 'hoisted',
  packageImportMethod: 'copy',
  enableGlobalVirtualStore: false,
  strictPeerDependencies: true,
  engineStrict: true,
  pmOnFail: 'error',
  ignoreScripts: true,
  ignorePnpmfile: true,
};

/** 依赖来源协议：白名单外的 file/git/link/portal/patch/workspace/catalog 等前缀一律阻断（与 apply 侧同口径）。 */
const UNSUPPORTED_SPECIFIER_PREFIXES = [
  'git:', 'git+', 'github:', 'bitbucket:', 'gitlab:', 'file:', 'link:', 'portal:', 'patch:', 'workspace:', 'catalog:',
] as const;

function isUnsupportedSpecifier(specifier: string): boolean {
  const trimmed = specifier.trim();
  return UNSUPPORTED_SPECIFIER_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

/**
 * 全部暂存清单（root/target/sibling 成员）四类依赖字段的统一预检：
 * 不支持的来源协议在创建任何外部目录、启动任何包管理器进程（含版本探针）之前
 * 失败关闭——blocked + DEPENDENCY_CONFLICT，目标零副作用。合法 registry semver
 * 依赖、既有 scripts/packageManager 剥离行为与配置白名单均不变。
 */
function assertStagedSpecifiersSupported(manifests: readonly InstallManifestInput[]): void {
  for (const entry of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      const value = entry.manifest[field];
      if (value === undefined) continue;
      if (!isPlainObject(value)) {
        throw new InstallError('DEPENDENCY_CONFLICT', `暂存清单 ${entry.relative} 的 ${field} 不是对象`);
      }
      for (const [name, specifier] of Object.entries(value)) {
        if (typeof specifier !== 'string') {
          throw new InstallError('DEPENDENCY_CONFLICT', `暂存清单 ${entry.relative} 的 ${field}.${name} 不是字符串 specifier`);
        }
        if (isUnsupportedSpecifier(specifier)) {
          throw new InstallError('DEPENDENCY_CONFLICT', `暂存清单 ${entry.relative} 的依赖 ${name} 使用暂不支持的来源协议`);
        }
      }
    }
  }
}

/** 暂存清单：只保留白名单字段，强制 `private:true`，不带脚本/包管理器下载指令/动态配置。 */
export function stagedManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  for (const field of RESOLUTION_CRITICAL_FIELDS) {
    if (manifest[field] !== undefined) {
      throw new InstallError('DEPENDENCY_CONFLICT', `目标清单含有影响解析且暂不支持的字段：${field}`);
    }
  }
  for (const field of DROPPED_MANIFEST_FIELDS) void manifest[field];
  const staged: Record<string, unknown> = {};
  for (const field of MANIFEST_FIELD_WHITELIST) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (field === 'private') continue;
    if (DEPENDENCY_FIELDS.includes(field as (typeof DEPENDENCY_FIELDS)[number])) {
      if (!isPlainObject(value)) {
        throw new InstallError('DEPENDENCY_CONFLICT', `目标清单的 ${field} 不是对象，无法可靠暂存`);
      }
      const dependencies: Record<string, string> = {};
      for (const [name, specifier] of Object.entries(value)) {
        if (typeof specifier !== 'string') {
          throw new InstallError('DEPENDENCY_CONFLICT', `目标清单的 ${field}.${name} 不是字符串 specifier`);
        }
        dependencies[name] = specifier;
      }
      staged[field] = dependencies;
      continue;
    }
    if (field === 'engines') {
      if (!isPlainObject(value)) {
        throw new InstallError('DEPENDENCY_CONFLICT', '目标清单的 engines 不是对象');
      }
      for (const key of Object.keys(value)) {
        if (!SUPPORTED_ENGINE_KEYS.has(key)) {
          throw new InstallError('DEPENDENCY_CONFLICT', `目标清单的 engines.${key} 暂不支持`);
        }
      }
      staged.engines = { ...value };
      continue;
    }
    if (field === 'workspaces') {
      if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
        throw new InstallError('DEPENDENCY_CONFLICT', '目标清单的 workspaces 声明无法识别');
      }
      staged.workspaces = [...value];
      continue;
    }
    if (typeof value !== 'string') {
      throw new InstallError('DEPENDENCY_CONFLICT', `目标清单的 ${field} 不是字符串`);
    }
    staged[field] = value;
  }
  staged.private = true;
  return staged;
}

function registryAuthKey(registryOrigin: string): string {
  const parsed = new URL(registryOrigin);
  return `//${parsed.host}${parsed.pathname}:_authToken`;
}

function windowsKeys(): Record<string, string> {
  const keys = ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'];
  const env: Record<string, string> = {};
  for (const key of keys) {
    const match = Object.entries(process.env).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    const value = match?.[1];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  return env;
}

function passthroughDirectories(projectRoot: string): Record<string, string> {
  const keys = ['USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA'];
  const env: Record<string, string> = {};
  for (const key of keys) {
    const match = Object.entries(process.env).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    const value = match?.[1];
    if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) continue;
    const relative = path.relative(path.resolve(projectRoot), path.resolve(value));
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) continue;
    env[key] = value;
  }
  return env;
}

/**
 * 构造子进程环境白名单：键与值都检查，不继承任意宿主环境。
 * `PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS` 是产品内部固定键（2026-11-18 兼容裁定）：
 * 值恒为 'false'，不继承宿主同名键——隔离进程绝不触发包管理器版本切换或下载。
 */
export function buildInstallEnvironment(
  projectRoot: string,
  toolchain: ResolvedToolchain,
  envRoot: string,
  userConfig: string,
  globalConfig: string,
): Record<string, string> {
  const temporaryDirectory = path.join(envRoot, 'tmp');
  fs.mkdirSync(temporaryDirectory, { recursive: true });
  const env: Record<string, string> = {
    ...windowsKeys(),
    ...passthroughDirectories(projectRoot),
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    PATH: [path.dirname(toolchain.nodeExe), path.dirname(toolchain.pnpmExe), path.join(toolchain.toolRoot, 'bin')].join(path.delimiter),
    CI: 'true',
    NO_COLOR: '1',
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false',
  };
  return env;
}

function sameDirectory(first: string, second: string): boolean {
  if (first === second) return true;
  return process.platform === 'win32' && first.toLowerCase() === second.toLowerCase();
}

/** 同卷判定与测试 helper 一致：只比较卷根（Windows 盘符 / POSIX `/`）。 */
function sameVolumeRoot(first: string, second: string): boolean {
  return path.parse(first).root.toLowerCase() === path.parse(second).root.toLowerCase();
}

/**
 * 用户级配置槽位：npm 的 user config 与 pnpm 的用户配置都落在用户主目录的 `.npmrc`。
 * 本次安装显式覆盖该槽位（argv `--userconfig=U --globalconfig=G` + `npm_config_userconfig`），
 * 且不继承宿主 userconfig，因此主目录根上的 `.npmrc` 不可能被隔离进程读到。
 */
function userConfigSlotRoot(): string {
  // 与 npm 解析 user config 的方式一致：Windows 取 USERPROFILE，POSIX 取 HOME，再回退 os.homedir()。
  // 这两个键本就按白名单传给子进程，因此隔离进程解析到的用户配置槽位与此处完全相同。
  const fromEnv = process.platform === 'win32' ? process.env['USERPROFILE'] : process.env['HOME'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return path.resolve(fromEnv);
  try {
    return path.resolve(os.homedir());
  } catch {
    return '';
  }
}

/**
 * 暂存区祖先配置复核：从暂存父目录一路复核到卷根，逐层检测 `.npmrc` 与 `pnpm-workspace.yaml`。
 *
 * 唯一例外是用户主目录根上的 `.npmrc`——那正是被隔离 userconfig 覆盖的用户配置槽位，
 * 隔离进程既不继承宿主 userconfig 也不读取该文件。包管理器工作区配置（pnpm-workspace.yaml）
 * 在任何层级都仍然阻断：它是唯一会沿祖先向上被发现的解析输入。
 * 复核区域内出现任何其他配置一律 DEPENDENCY_CONFLICT 显式阻断，绝不静默继续安装。
 */
function assertNoAncestorConfig(stagingRoot: string): void {
  const userConfigRoot = userConfigSlotRoot();
  let current = path.dirname(path.resolve(stagingRoot));
  for (;;) {
    for (const name of ['.npmrc', 'pnpm-workspace.yaml']) {
      if (name === '.npmrc' && userConfigRoot.length > 0 && sameDirectory(current, userConfigRoot)) continue;
      const candidate = path.join(current, name);
      if (fs.existsSync(candidate)) {
        throw new InstallError('DEPENDENCY_CONFLICT', `暂存目录的祖先 ${candidate} 可能影响依赖解析，拒绝在该位置安装`);
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/** 仓外同卷暂存父目录候选（按优先级）：工程根兄弟目录优先，其次系统临时目录（须同卷且在工程外）。 */
function externalParentCandidates(projectRoot: string): string[] {
  const candidates = [path.dirname(path.resolve(projectRoot))];
  const temporary = path.resolve(os.tmpdir());
  if (!candidates.some(candidate => sameDirectory(candidate, temporary))) candidates.push(temporary);
  return candidates;
}

/**
 * 选择仓外同卷暂存父目录：候选逐个复核——父目录存在、与目标同卷、不在目标内、
 * 祖先配置复核通过。全部候选都不可用时 DEPENDENCY_CONFLICT 显式阻断（apply 记为 blocked），
 * 不静默退回任何未验证位置，也不移除祖先配置复核。
 */
function chooseExternalParent(projectRoot: string, suffix: string): string {
  const resolved = path.resolve(projectRoot);
  const blocked: string[] = [];
  for (const parent of externalParentCandidates(resolved)) {
    if (!isDirectory(parent)) {
      blocked.push(`${parent} 不是目录`);
      continue;
    }
    if (!sameVolumeRoot(parent, resolved)) {
      blocked.push(`${parent} 与目标不同卷`);
      continue;
    }
    if (sameDirectory(parent, resolved) || path.resolve(parent).startsWith(path.resolve(resolved) + path.sep)) {
      blocked.push(`${parent} 位于目标之内`);
      continue;
    }
    try {
      assertNoAncestorConfig(path.join(parent, `.t16-stage-${suffix}`));
    } catch (error) {
      if (!(error instanceof InstallError)) throw error;
      blocked.push(error.message);
      continue;
    }
    return parent;
  }
  throw new InstallError('DEPENDENCY_CONFLICT', `没有满足同卷与祖先配置约束的仓外暂存位置：${blocked.join('；')}`);
}

/** 外部目录的所有权标记文件名：本次安装创建的目录才携带，清理前读回核验。 */
const OWNER_MARKER_NAME = '.t16-owner.json';

/** 所有权标记的精确字节：operationId 与角色绑定，创建与清理共用同一来源。 */
function ownerMarkerBytes(operationId: string, role: string): Buffer {
  return Buffer.from(`${JSON.stringify({ kind: 't16-external-root', operationId, role }, null, 2)}\n`, 'utf8');
}

/** 目录创建后立即独占写入所有权标记；失败关闭（此时目录尚空，无凭据落盘）。 */
function writeOwnerMarker(directory: string, operationId: string, role: string): void {
  try {
    fs.writeFileSync(path.join(directory, OWNER_MARKER_NAME), ownerMarkerBytes(operationId, role), { flag: 'wx' });
  } catch {
    throw new InstallError('INSTALL_FAILED', `外部${role}目录的所有权标记不可写入`);
  }
}

/**
 * 删除前的所有权证明：目录本身是普通目录，且含有本次 operation+role 的精确标记
 * （普通文件、nlink=1、字节逐一相符）。标记缺失、被替换或不可核验都证明该路径
 * 不再属于本次创建的目录——绝不递归删除未知树，现场如实保留。
 */
function verifyOwnerMarker(directory: string, operationId: string, role: string): boolean {
  let directoryStats: fs.Stats;
  try {
    directoryStats = fs.lstatSync(directory);
  } catch {
    return false;
  }
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) return false;
  let markerStats: fs.Stats;
  try {
    markerStats = fs.lstatSync(path.join(directory, OWNER_MARKER_NAME));
  } catch {
    return false;
  }
  if (markerStats.isSymbolicLink() || !markerStats.isFile() || markerStats.nlink > 1) return false;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(directory, OWNER_MARKER_NAME));
  } catch {
    return false;
  }
  return bytes.equals(ownerMarkerBytes(operationId, role));
}

/** 隔离 userconfig 的精确字节：写入与所有权 SHA-256 基准共用同一来源，绝不发散。 */
function userConfigContent(registryKey: string, registryToken: string | undefined): string {
  return registryToken !== undefined && registryToken.length > 0
    ? `${registryKey}=${registryToken}\n`
    : '# T16 isolated npm userconfig\n';
}

/**
 * 隔离 userconfig 的独立删除守卫：只在字节与本次写入完全一致（SHA-256 相符、
 * 普通文件、nlink=1）时删除——被用户替换的文件一律保留，绝不回显令牌。
 */
function removeUserConfigIfOwned(context: InstallContext): void {
  try {
    if (!fs.existsSync(context.userConfig)) return;
    const stats = fs.lstatSync(context.userConfig);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink > 1) return;
    const bytes = fs.readFileSync(context.userConfig);
    if (createHash('sha256').update(bytes).digest('hex') !== context.userConfigSha256) return;
    fs.rmSync(context.userConfig, { force: true });
  } catch {
    // 尽力而为：不可核验或删除被拒时保留文件，不声称凭据已删除，也不回显令牌。
  }
}

/**
 * 外部根的独占认领创建：创建前先核验父目录起整条祖先链（链接/junction 祖先绝不
 * 授权在其下创建），再以单级 mkdir 创建——EEXIST（含 exists 检查与 mkdir 之间的
 * 抢占窗口）一律失败关闭，绝不认领窗口内被其他进程抢占的同名未知树（不写标记、
 * 不删除未知树）；创建后 lstat 复核普通目录形态并立即写入所有权标记——所有权
 * 证明必须自目录成立的那一刻就存在：认领之后的每一条失败路径（含 context 成型
 * 前的回收与 cleanup）都以标记证明所有权；路径上的目录被其他进程替换时标记缺失，
 * 替换树绝不被认领或删除。
 */
function createExclusiveOwnedRoot(
  directory: string,
  role: string,
  operationId: string,
  existingCode: InstallError['code'] = 'PATH_UNSAFE',
): void {
  assertPlainAncestorChain(path.dirname(path.resolve(directory)));
  try {
    fs.mkdirSync(directory);
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') {
      throw new InstallError(existingCode, `外部${role}目录在创建窗口被抢占，拒绝认领未知树`);
    }
    throw new InstallError('INSTALL_FAILED', `外部${role}目录不可创建`);
  }
  let created: fs.Stats;
  try {
    created = fs.lstatSync(directory);
  } catch {
    throw new InstallError('INSTALL_FAILED', `外部${role}目录创建后不可复核`);
  }
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new InstallError('INSTALL_FAILED', `外部${role}目录创建后不是普通目录`);
  }
  // 认领成立当刻立即写标记：回收/清理出口据此证明当前所有权，路径历史不算证明。
  writeOwnerMarker(directory, operationId, role);
}

/**
 * 预备阶段（context 尚未成型）的已认领根回收：只删除本次独占创建成功、已登记在
 * 认领清单里的目录，且仍须携带本次 operation+role 的精确所有权标记——目录
 * “是普通目录”不构成所有权证明：认领后原路径被其他进程换入的同名树（无标记）
 * 是未知用户树，绝不递归删除、现场如实保留；EEXIST 抢占的未知树从未进入清单，
 * 一律不碰；仅用于 createInstallContext 在认领之后、context 成型之前的部分失败清理。
 */
function removeClaimedRoot(directory: string, role: string, operationId: string): void {
  try {
    const absolute = path.resolve(directory);
    // 删除前以所有权标记证明当前所有权：路径历史不授权删除原路径上被换入的
    // 替换树（lstat 只能证明“存在某个目录”，证明不了“是本次创建的目录”）。
    if (!verifyOwnerMarker(absolute, operationId, role)) return;
    fs.rmSync(absolute, { recursive: true, force: true });
  } catch {
    // 尽力回收：失败如实保留现场，不冒称已清理。
  }
}

function writeStagingTree(context: InstallContext): void {
  const staging = context.stagingRoot;
  // 先复核再落盘：复核不通过时不留下空暂存目录。
  assertNoAncestorConfig(staging);
  // staging 根与其所有权标记已由 createInstallContext 的单级独占认领当刻写好
  // （EEXIST 一律失败关闭，绝不认领创建窗口被抢占的未知树）；暂存材料在此直接
  // 写入，清理前读回核验，未证明本次创建身份绝不删除。
  for (const entry of context.input.manifests) {
    const absolute = path.join(staging, ...entry.relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `${JSON.stringify(stagedManifest(entry.manifest), null, 2)}\n`, 'utf8');
  }
  if (context.input.packageManager === 'pnpm') {
    const lines: string[] = [];
    if (context.input.members.length > 0) {
      lines.push('packages:');
      for (const member of context.input.members) lines.push(`  - ${member}`);
    }
    for (const [key, value] of Object.entries(PNPM_STAGING_SETTINGS)) {
      lines.push(`${key}: ${typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)}`);
    }
    fs.writeFileSync(path.join(staging, 'pnpm-workspace.yaml'), `${lines.join('\n')}\n`, 'utf8');
  }
  // 隔离 userconfig：只写精确 registry host/path 的令牌键；globalconfig 必须为空。
  // env 根与其所有权标记已由 createInstallContext 的独占认领当刻写好（与
  // userconfig 同一删除守卫配套）；凭据只落入本次已认领的 env 目录。
  fs.writeFileSync(context.userConfig, userConfigContent(context.registryKey, context.input.registryToken), 'utf8');
  fs.writeFileSync(context.globalConfig, '', 'utf8');
  fs.mkdirSync(context.cacheDirectory, { recursive: true });
  fs.mkdirSync(context.temporaryDirectory, { recursive: true });
}

function externalSuffix(projectRoot: string): string {
  externalCounter += 1;
  return `${Date.now().toString(36)}-${externalCounter.toString(36)}`;
}

let externalCounter = 0;

/** 建立暂存/隔离环境/ready 三个同卷外部目录，并写入固定暂存材料。 */
export function createInstallContext(input: InstallContextInput): InstallContext {
  // 依赖来源协议统一预检（root/target/sibling 全覆盖）：先于任何外部目录创建与
  // 任何包管理器进程（含版本探针），失败关闭保持 blocked + 目标零副作用。
  assertStagedSpecifiersSupported(input.manifests);
  const projectRoot = path.resolve(input.projectRoot);
  const suffix = `${input.operationId.slice(-12)}-${externalSuffix(projectRoot)}`;
  const parent = chooseExternalParent(projectRoot, suffix);
  const stagingRoot = path.join(parent, `.t16-stage-${suffix}`);
  const envRoot = path.join(parent, `.t16-env-${suffix}`);
  const readyRoot = path.join(parent, `.t16-ready-${suffix}`);
  for (const directory of [stagingRoot, envRoot, readyRoot]) {
    if (fs.existsSync(directory)) {
      throw new InstallError('PATH_UNSAFE', '外部暂存目录已存在，拒绝复用');
    }
  }
  const userConfig = path.join(envRoot, 'npmrc');
  const globalConfig = path.join(envRoot, 'global-npmrc');
  const cacheDirectory = path.join(envRoot, 'cache');
  const temporaryDirectory = path.join(envRoot, 'tmp');
  // workspace 成员安全预检：在写入任何暂存材料、启动任何包管理器进程之前失败关闭。
  const memberChecks = verifyWorkspaceMemberRoots(projectRoot, input.members);
  // 阶段目录独占认领（完整顺序，替换旧 recursive mkdir 认领）：先以单级独占 mkdir
  // 创建 env、再创建 stage——EEXIST（含 exists 检查与 mkdir 之间的抢占窗口）一律
  // 失败关闭，绝不认领创建窗口内被其他进程抢占的同名未知树（不写标记、不删除）；
  // 所有权标记在认领当刻立即写入，其后每条失败路径都以标记证明所有权；ready
  // 留待 buildReadyTree 以同一独占口径创建。认领成功的根逐一登记，其后任何失败
  // 都只回收本次确已独占创建且仍带精确标记的根（未知树与替换树一律不碰），隔离
  // 凭据只落入本次已认领的 env 目录。
  const claimedRoots: { directory: string; role: string }[] = [];
  createExclusiveOwnedRoot(envRoot, 'env', input.operationId);
  claimedRoots.push({ directory: envRoot, role: 'env' });
  let toolchain: ResolvedToolchain;
  try {
    createExclusiveOwnedRoot(stagingRoot, 'stage', input.operationId);
    claimedRoots.push({ directory: stagingRoot, role: 'stage' });
    // 先用固定路径构造环境白名单，再据此校验工具链版本（版本探测本身也走同一套环境）。
    toolchain = resolveToolchain(
      buildInstallEnvironment(projectRoot, { ...resolveToolPaths(), npmVersion: FIXED_NPM_VERSION, pnpmVersion: FIXED_PNPM_VERSION }, envRoot, userConfig, globalConfig),
    );
  } catch (error) {
    // 只回收本次确已独占创建且仍带精确所有权标记的根：认领后原路径被换入的
    // 同名树（无标记）是未知用户树，绝不递归删除；原始错误原样上抛。
    for (const claimed of claimedRoots) {
      removeClaimedRoot(claimed.directory, claimed.role, input.operationId);
    }
    throw error;
  }
  const registryKey = registryAuthKey(input.registryOrigin);
  const context: InstallContext = {
    input,
    toolchain,
    stagingRoot,
    envRoot,
    readyRoot,
    userConfig,
    // 本次写入 userconfig 的字节摘要：独立删除前的所有权证明（与 writeStagingTree 同源）。
    userConfigSha256: createHash('sha256')
      .update(userConfigContent(registryKey, input.registryToken), 'utf8')
      .digest('hex'),
    globalConfig,
    cacheDirectory,
    temporaryDirectory,
    registryKey,
    memberChecks,
    environment: buildInstallEnvironment(projectRoot, toolchain, envRoot, userConfig, globalConfig),
  };
  try {
    writeStagingTree(context);
  } catch (error) {
    // context 构造部分失败（例如隔离 globalconfig 写入被拒）：已落盘的隔离 userconfig
    // （含 registry 令牌）与已创建的固定前缀目录必须一并清除——调用方拿不到 context，
    // 清理只能在此完成；只删除本次 .t16-* 目录，绝不加区分删除父目录，原始错误原样上抛。
    cleanupInstall(context);
    throw error;
  }
  return context;
}

/**
 * 固定 argv（brief 冻结表）：S 是已验证的 staging cwd，R 是已验证 registry origin，
 * U/G/C 是外部隔离的 userconfig/globalconfig/cache。npm 走 node.exe + npm-cli.js，
 * pnpm 走 pnpm.exe；两套凭据独立，令牌绝不进入 argv。
 */
function installArgv(context: InstallContext, step: 'candidate-lock' | 'materialization'): string[] {
  const npm = context.input.packageManager === 'npm';
  const registry = ['--registry', context.input.registryOrigin];
  const isolation = npm
    ? ['--userconfig', context.userConfig, '--globalconfig', context.globalConfig, '--cache', context.cacheDirectory]
    : ['--store-dir', context.cacheDirectory];
  const safety = ['--ignore-scripts', ...(npm ? ['--no-audit', '--no-fund'] : ['--ignore-pnpmfile'])];
  if (step === 'candidate-lock') {
    return npm
      ? ['install', '--package-lock-only', ...safety, ...registry, ...isolation]
      : ['install', '--lockfile-only', '--no-frozen-lockfile', ...safety, ...registry, ...isolation];
  }
  return npm ? ['ci', ...safety, ...registry, ...isolation] : ['install', '--frozen-lockfile', ...safety, ...registry, ...isolation];
}

function runPackageManager(context: InstallContext, step: 'candidate-lock' | 'materialization'): void {
  const npm = context.input.packageManager === 'npm';
  const command = npm ? context.toolchain.nodeExe : context.toolchain.pnpmExe;
  const argv = npm ? [context.toolchain.npmCli, ...installArgv(context, step)] : installArgv(context, step);
  const result = spawnSync(command, argv, {
    cwd: context.stagingRoot,
    env: context.environment,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: INSTALL_PROCESS_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new InstallError('INSTALL_FAILED', step === 'candidate-lock' ? '候选锁生成失败' : '冻结依赖物化失败');
  }
}

/** 候选锁身份绑定用的已验证 registry 证据条目（计划 registryEvidence 的元素，只读）。 */
type RegistryEvidenceEntry = IntegrationPlanV1['registryEvidence'][number];

/** npm v3 候选锁：必须是合法 JSON、lockfileVersion 恰为整数 3、packages 为对象映射。 */
function npmCandidatePackages(lock: Buffer): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lock.toString('utf8'));
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed) || parsed['lockfileVersion'] !== 3) return undefined;
  const packages = parsed['packages'];
  return isPlainObject(packages) ? packages : undefined;
}

/** 受支持的 pnpm 候选锁正文版本：与 locks.ts 同口径，只接受真实标量 '9.0'。 */
const CANDIDATE_PNPM_LOCK_VERSION = '9.0';

/** config-only 文档：全部非空 importer 的键都仅为 configDependencies/packageManagerDependencies。 */
function isPnpmConfigOnlyDocument(document: Record<string, unknown>): boolean {
  const importers = document['importers'];
  if (!isPlainObject(importers)) return false;
  const importerList = Object.values(importers);
  if (importerList.length === 0) return false;
  return importerList.every(importer => {
    if (!isPlainObject(importer)) return false;
    const keys = Object.keys(importer);
    if (keys.length === 0) return false;
    return keys.every(key => key === 'configDependencies' || key === 'packageManagerDependencies');
  });
}

/**
 * pnpm v9 候选锁：多 YAML 文档流严格解析——文档解析错误、非映射顶层、lockfileVersion
 * 非标量 '9.0'、项目锁文档（config-only 之外）缺失或不唯一、缺 packages 映射一律无法
 * 解析。与 locks.ts 的只读解析同口径；npm v3 与 pnpm v9 对等，不信任何声明复制。
 */
function pnpmCandidatePackages(lock: Buffer): Record<string, unknown> | undefined {
  let documents;
  try {
    documents = parseAllDocuments(lock.toString('utf8'), { strict: true, uniqueKeys: true, logLevel: 'silent' });
  } catch {
    return undefined;
  }
  if (!Array.isArray(documents) || documents.length === 0) return undefined;
  const values: Record<string, unknown>[] = [];
  for (const document of documents) {
    if (document.errors.length > 0) return undefined;
    const value = document.toJS();
    if (value === null || value === undefined) continue;
    if (!isPlainObject(value)) return undefined;
    values.push(value);
  }
  const lockDocuments = values.filter(document => 'lockfileVersion' in document || 'importers' in document);
  if (lockDocuments.length === 0) return undefined;
  for (const document of lockDocuments) {
    if (!('lockfileVersion' in document)) continue;
    if (document['lockfileVersion'] !== CANDIDATE_PNPM_LOCK_VERSION) return undefined;
  }
  const projectDocuments = lockDocuments.filter(document => !isPnpmConfigOnlyDocument(document));
  if (projectDocuments.length !== 1) return undefined;
  const packages = projectDocuments[0]!['packages'];
  return isPlainObject(packages) ? packages : undefined;
}

/** tarball（npm `resolved` / pnpm `resolution.tarball`）若提供必须与已验证 registry origin 一致。 */
function assertCandidateTarballOrigin(registryOrigin: string, tarball: unknown, what: string): void {
  if (tarball === undefined) return;
  if (typeof tarball !== 'string') {
    throw new InstallError('DEPENDENCY_CONFLICT', `候选锁 SDK ${what} 的来源地址形态不可核验，拒绝物化`);
  }
  let origin: string;
  try {
    origin = new URL(tarball).origin;
  } catch {
    throw new InstallError('DEPENDENCY_CONFLICT', `候选锁 SDK ${what} 的来源地址不可解析，拒绝物化`);
  }
  if (origin !== registryOrigin) {
    throw new InstallError('DEPENDENCY_CONFLICT', `候选锁 SDK ${what} 的来源 origin 与已验证 registry 不符，拒绝物化`);
  }
}

/** npm 候选锁 SDK 条目核验：version/integrity 与已验证证据逐一相符，resolved origin 同 registry。 */
function verifyNpmSdkEntry(context: InstallContext, packages: Record<string, unknown>, key: string, evidence: RegistryEvidenceEntry): void {
  const entry = packages[key];
  if (!isPlainObject(entry)) {
    throw new InstallError('DEPENDENCY_CONFLICT', `候选锁 SDK ${evidence.name} 的条目形态不可核验，拒绝物化`);
  }
  if (entry['version'] !== evidence.version) {
    throw new InstallError('DEPENDENCY_CONFLICT', `候选锁 SDK ${evidence.name} 的版本与已验证证据不符，拒绝物化`);
  }
  const integrity = entry['integrity'];
  if (typeof integrity !== 'string' || integrity !== evidence.integrity) {
    throw new InstallError('DEPENDENCY_CONFLICT', `候选锁 SDK ${evidence.name} 的 integrity 与已验证证据不符，拒绝物化`);
  }
  assertCandidateTarballOrigin(context.input.registryOrigin, entry['resolved'], evidence.name);
}

/** pnpm 候选锁 SDK 条目核验：精确 name@version 键 + resolution.integrity 绑定，tarball origin 同 registry。 */
function verifyPnpmSdkEntry(context: InstallContext, packages: Record<string, unknown>, evidence: RegistryEvidenceEntry): void {
  const key = `${evidence.name}@${evidence.version}`;
  const entry = packages[key];
  if (!isPlainObject(entry)) {
    throw new InstallError('DEPENDENCY_CONFLICT', `候选锁缺少已验证 SDK ${key} 的精确条目，拒绝物化`);
  }
  const resolution = entry['resolution'];
  if (!isPlainObject(resolution)) {
    throw new InstallError('DEPENDENCY_CONFLICT', `候选锁 SDK ${key} 缺少可核验的 resolution，拒绝物化`);
  }
  const integrity = resolution['integrity'];
  if (typeof integrity !== 'string' || integrity !== evidence.integrity) {
    throw new InstallError('DEPENDENCY_CONFLICT', `候选锁 SDK ${key} 的 integrity 与已验证证据不符，拒绝物化`);
  }
  assertCandidateTarballOrigin(context.input.registryOrigin, resolution['tarball'], key);
}

/**
 * 候选锁 SDK 身份绑定：把真实候选锁字节严格解析出的 SDK 条目（精确 name/version 与
 * 真实 resolution integrity）绑定到已验证 registryEvidence；tarball 若提供必须与已验证
 * registry origin 一致。缺失、歧义或未知格式失败关闭；registryEvidence 未提供时为
 * 低层直接调用的兼容路径，跳过绑定（apply 路径恒提供）。
 */
export function verifyCandidateLockIdentity(context: InstallContext, lock: Buffer): void {
  const evidence = context.input.registryEvidence;
  if (evidence === undefined || evidence.length === 0) return;
  const packages = context.input.packageManager === 'npm'
    ? npmCandidatePackages(lock)
    : pnpmCandidatePackages(lock);
  if (packages === undefined) {
    throw new InstallError('DEPENDENCY_CONFLICT', '候选锁无法按受支持格式严格解析，拒绝绑定已验证身份');
  }
  for (const entry of evidence) {
    if (context.input.packageManager === 'npm') {
      // 按目标 importer 向根方向解析（与 locks.ts 的提升解析语义一致）；首个存在的键即权威条目。
      const segments = context.input.workspace === '.' ? [] : context.input.workspace.split('/');
      let found = false;
      for (let depth = segments.length; depth >= 0; depth--) {
        const prefix = segments.slice(0, depth).join('/');
        const key = prefix === '' ? `node_modules/${entry.name}` : `${prefix}/node_modules/${entry.name}`;
        if (!Object.prototype.hasOwnProperty.call(packages, key)) continue;
        verifyNpmSdkEntry(context, packages, key, entry);
        found = true;
        break;
      }
      if (!found) {
        throw new InstallError('DEPENDENCY_CONFLICT', `候选锁缺少已验证 SDK ${entry.name} 的条目，拒绝物化`);
      }
      continue;
    }
    verifyPnpmSdkEntry(context, packages, entry);
  }
}

/** 候选锁生成：lock-only 进程不表示依赖安装已开始，且没有任何目标写入。 */
export function generateCandidateLock(context: InstallContext): Buffer {
  runPackageManager(context, 'candidate-lock');
  const lock = readStagedLock(context);
  // 候选锁 SDK 身份绑定：先于任何目标写入/备份/冻结物化，偏离已验证证据即失败关闭。
  verifyCandidateLockIdentity(context, lock);
  return lock;
}

/** 冻结依赖物化：候选锁必须原样存在，锁被改写或版本不符一律失败关闭。 */
export function materializeFrozenDependencies(context: InstallContext, frozenLock: Buffer): void {
  if (!readStagedLock(context).equals(frozenLock)) {
    throw new InstallError('INSTALL_FAILED', '冻结候选锁在物化前被改写');
  }
  runPackageManager(context, 'materialization');
  if (!readStagedLock(context).equals(frozenLock)) {
    throw new InstallError('INSTALL_FAILED', '冻结候选锁在物化过程中被改写');
  }
  verifyStagedDependencies(context);
}

function readStagedLock(context: InstallContext): Buffer {
  const absolute = path.join(context.stagingRoot, ...context.input.lockRelative.split('/'));
  try {
    return fs.readFileSync(absolute);
  } catch {
    throw new InstallError('INSTALL_FAILED', '暂存区缺少候选锁文件');
  }
}

/** 物化后核验：实际安装包身份（name+version）必须与计划确切依赖逐一相符（不把计划复制成已安装证据）。 */
function verifyStagedDependencies(context: InstallContext): void {
  for (const dependency of context.input.exactDependencies) {
    const manifest = path.join(context.stagingRoot, 'node_modules', ...dependency.name.split('/'), 'package.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    } catch {
      throw new InstallError('INSTALLED_VERSION_MISMATCH', `依赖 ${dependency.name} 未实际安装`);
    }
    const installedName = isPlainObject(parsed) ? parsed['name'] : undefined;
    if (typeof installedName !== 'string' || installedName !== dependency.name) {
      throw new InstallError('INSTALLED_VERSION_MISMATCH', `依赖 ${dependency.name} 的实际安装包身份与计划不符`);
    }
    const version = isPlainObject(parsed) ? parsed['version'] : undefined;
    if (typeof version !== 'string' || version !== dependency.version) {
      throw new InstallError('INSTALLED_VERSION_MISMATCH', `依赖 ${dependency.name} 的实际安装版本与计划不符`);
    }
  }
}

export type DeliveryAction =
  | { kind: 'copy'; importer: string; name: string; source: string }
  | { kind: 'relink'; importer: string; name: string; member: string };

export type DeliveryPlan = { actions: DeliveryAction[]; importers: string[] };

function isLink(absolute: string): boolean {
  try {
    return fs.lstatSync(absolute).isSymbolicLink();
  } catch {
    return false;
  }
}

/** 校验目录树：只接受普通文件与目录，拒绝链接、硬链接与任何越界路径。 */
function assertSafeTree(root: string, directory: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    throw new InstallError('INSTALL_FAILED', '暂存依赖树不可枚举');
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new InstallError('PATH_UNSAFE', '暂存依赖树含有链接，拒绝交付');
    }
    if (entry.isDirectory()) {
      assertSafeTree(root, absolute);
      continue;
    }
    if (!entry.isFile()) {
      throw new InstallError('PATH_UNSAFE', '暂存依赖树含有非普通文件，拒绝交付');
    }
    const stats = fs.lstatSync(absolute);
    if (stats.nlink > 1) {
      throw new InstallError('PATH_UNSAFE', '暂存依赖树含有硬链接，拒绝交付');
    }
    const relative = path.relative(path.resolve(root), path.resolve(absolute));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new InstallError('PATH_UNSAFE', '暂存依赖树越界，拒绝交付');
    }
  }
}

/**
 * 解析暂存树内的链接并核对成员资格：只有解析后恰好指向**已检查成员 root** 的链接
 * 才允许受控重建；指向工程外、暂存内普通包或无法解析的链接一律失败关闭。
 */
function resolveStagedMemberLink(context: InstallContext, absolute: string, memberSet: Set<string>): string {
  let target: string;
  try {
    target = fs.realpathSync(absolute);
  } catch {
    throw new InstallError('PATH_UNSAFE', '暂存依赖树含有无法解析的链接，拒绝交付');
  }
  const relative = path.relative(path.resolve(context.stagingRoot), path.resolve(target));
  const member = relative === '' ? '.' : relative.split(path.sep).join('/');
  // 只有预检过的成员 root 才是“已检查成员”：仅由 lexical path 列出的成员不算。
  if (!memberSet.has(member) || !context.memberChecks.has(member)) {
    throw new InstallError('PATH_UNSAFE', '暂存依赖树含有指向已检查成员之外的链接，拒绝交付');
  }
  return member;
}

/**
 * 作用域目录（`@scope`）的逐子条目交付计划：成员 junction 按已检查成员 root 受控重建，
 * 普通作用域包整树复制（内部仍禁止任何链接/硬链接），其余形态失败关闭。
 * 生成动作的 `name` 为 `@scope/pkg` 形态，ready 构建按该路径创建父目录。
 */
function planScopeDirectory(
  context: InstallContext,
  importer: string,
  scopeName: string,
  scopeDirectory: string,
  actions: DeliveryAction[],
  memberSet: Set<string>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scopeDirectory, { withFileTypes: true });
  } catch {
    throw new InstallError('INSTALL_FAILED', '暂存依赖树不可枚举');
  }
  for (const entry of entries) {
    const absolute = path.join(scopeDirectory, entry.name);
    const name = `${scopeName}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      actions.push({ kind: 'relink', importer, name, member: resolveStagedMemberLink(context, absolute, memberSet) });
      continue;
    }
    if (!entry.isDirectory()) {
      throw new InstallError('PATH_UNSAFE', '暂存依赖树含有非目录条目，拒绝交付');
    }
    assertSafeTree(context.stagingRoot, absolute);
    actions.push({ kind: 'copy', importer, name, source: absolute });
  }
}

/**
 * 枚举暂存 `node_modules` 并生成受控交付计划：
 * - 真实目录 → 整树复制到 ready（新 inode，不带硬链接）；
 * - 作用域目录（`@scope`）→ 逐子条目裁定：成员链接同样受控重建，普通作用域包整树复制；
 * - 指向已检查成员的链接 → 在目标侧按对应 root 重建；
 * - 指向工程外或不可识别来源的链接 → 失败关闭。
 */
export function planDelivery(context: InstallContext): DeliveryPlan {
  const importers = ['.', ...context.input.members];
  const actions: DeliveryAction[] = [];
  const usedImporters: string[] = [];
  const memberSet = new Set(context.input.members);
  for (const importer of importers) {
    const staged = path.join(context.stagingRoot, ...(importer === '.' ? [] : importer.split('/')), 'node_modules');
    if (!isDirectory(staged)) continue;
    const entries = fs.readdirSync(staged, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(staged, entry.name);
      if (entry.isSymbolicLink()) {
        actions.push({ kind: 'relink', importer, name: entry.name, member: resolveStagedMemberLink(context, absolute, memberSet) });
        continue;
      }
      if (!entry.isDirectory()) {
        // 已知根级元数据裁定（均不交付）：npm ci 在暂存 node_modules 根自动写 `.package-lock.json`；
        // pnpm hoisted 在根写 `.modules.yaml` / `.pnpm-workspace-state-v1.json`，内含 stage/store/cache 绝对路径。
        // 两者都是包管理器在暂存上下文的内部簿记，交付会把隔离绝对路径带入目标，故一律不复制。
        // 目标的权威依赖状态不依赖它们：冻结候选锁仍是权威解析（物化前后均已守卫），
        // 交付后证据从目标真实文件重算。未承诺边界：交付的 node_modules 不是包管理器的
        // 增量安装状态，用户后续自行安装时按目标上下文重建自己的状态文件。
        // 形态仍须复核为普通文件且非硬链接（链接条目已在上面分支处理）；
        // 名单外任何普通/隐藏条目一律失败关闭，不放行任意普通文件。
        const knownRootMetadata = context.input.packageManager === 'npm'
          ? entry.name === '.package-lock.json'
          : entry.name === '.modules.yaml' || entry.name === '.pnpm-workspace-state-v1.json';
        if (entry.isFile() && knownRootMetadata) {
          const stats = fs.lstatSync(absolute);
          if (!stats.isFile() || stats.nlink > 1) {
            throw new InstallError('PATH_UNSAFE', '暂存依赖树的根级元数据不是普通文件或为硬链接，拒绝交付');
          }
          continue;
        }
        throw new InstallError('PATH_UNSAFE', '暂存依赖树含有非目录条目，拒绝交付');
      }
      if (entry.name.startsWith('@')) {
        // 作用域目录不能整树复制：成员包名为 scoped（如 `@diagnosis/client`）时，
        // 包管理器把指向已检查成员 root 的 junction 放在作用域内。逐子条目裁定。
        planScopeDirectory(context, importer, entry.name, absolute, actions, memberSet);
        continue;
      }
      assertSafeTree(context.stagingRoot, absolute);
      actions.push({ kind: 'copy', importer, name: entry.name, source: absolute });
    }
    usedImporters.push(importer);
  }
  return { actions, importers: usedImporters };
}

function copyTree(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
      continue;
    }
    if (!entry.isFile()) {
      throw new InstallError('PATH_UNSAFE', '暂存依赖树含有非普通文件，拒绝交付');
    }
    fs.copyFileSync(from, to);
  }
}

/** 在目标外同卷 ready 目录重建交付树（真实副本 + 按目标 root 重建的成员链接）。 */
export function buildReadyTree(context: InstallContext, plan: DeliveryPlan): void {
  // ready 构建前复核：成员身份必须是预检时的同一真实 root，绝不跟随并发 junction。
  assertMembersStillChecked(context);
  // createInstallContext 已证明该路径当时不存在；此刻既存目录只能是窗口内出现的
  // 未知树——绝不递归删除（与清理同一所有权根因），失败关闭。
  if (fs.existsSync(context.readyRoot)) {
    throw new InstallError('INSTALL_FAILED', '外部 ready 目录在构建前已存在，拒绝删除未知树');
  }
  assertPlainAncestorChain(path.dirname(path.resolve(context.readyRoot)));
  // ready 根同样以单级独占 mkdir 认领：EEXIST（含 exists 检查与 mkdir 之间的抢占
  // 窗口）一律失败关闭，绝不认领创建窗口被抢占的未知树；创建后复核普通目录形态。
  // 创建后复核普通目录形态，所有权标记在认领当刻立即写入：清理前读回核验，
  // 未证明本次创建身份绝不删除。
  createExclusiveOwnedRoot(context.readyRoot, 'ready', context.input.operationId, 'INSTALL_FAILED');
  for (const action of plan.actions) {
    const base = path.join(context.readyRoot, ...(action.importer === '.' ? [] : action.importer.split('/')), 'node_modules');
    fs.mkdirSync(base, { recursive: true });
    if (action.kind === 'copy') {
      copyTree(action.source, path.join(base, action.name));
      continue;
    }
    const link = path.join(base, action.name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    // 重建的 workspace 成员链接绑定预检时记录的真实 root（不跟随并发 junction）。
    const memberCheck = context.memberChecks.get(action.member);
    const memberTarget = memberCheck !== undefined
      ? memberCheck.realRoot
      : path.join(path.resolve(context.input.projectRoot), ...(action.member === '.' ? [] : action.member.split('/')));
    try {
      fs.symlinkSync(memberTarget, link, 'junction');
    } catch {
      fs.symlinkSync(memberTarget, link, 'dir');
    }
  }
}

/**
 * 交付期身份复核：每个成员 root 与父链逐段 lstat 仍须是普通目录，真实落点与预检记录一致，
 * 清单 hash 未被并发修改（目标 importer 的清单由本次 apply 重写，不参与 hash 复核）。
 * buildReadyTree 前、每次 rename 前都重新证明——成员在安装期间被替换为指向工程外的
 * junction 时，在任何目标侧写入之前失败关闭，不删除用户目录、不触碰外部快照。
 */
function assertMembersStillChecked(context: InstallContext): void {
  const resolvedRoot = path.resolve(context.input.projectRoot);
  for (const check of context.memberChecks.values()) {
    let current = resolvedRoot;
    for (const segment of check.member.split('/')) {
      current = path.join(current, segment);
      let stats: fs.Stats;
      try {
        stats = fs.lstatSync(current);
      } catch {
        throw new InstallError('INSTALL_FAILED', 'workspace 成员路径链复核失败，拒绝交付');
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new InstallError('INSTALL_FAILED', 'workspace 成员在安装期间被替换为链接或非目录，拒绝交付');
      }
    }
    if (!sameDirectory(realpathOrSelf(current), check.realRoot)) {
      throw new InstallError('INSTALL_FAILED', 'workspace 成员真实落点与预检时不一致，拒绝交付');
    }
    if (check.member === context.input.workspace) continue;
    const manifestSha256 = manifestGuardHash(current);
    if (manifestSha256 === undefined || manifestSha256 !== check.manifestSha256) {
      throw new InstallError('INSTALL_FAILED', 'workspace 成员清单在安装期间缺失或被修改，拒绝交付');
    }
  }
}

/** 外部目录祖先链核验：从给定目录本体起逐级 lstat 直到卷根，任何一级为链接、非目录
 * 或不可复核都失败关闭（不 realpath、不跟随并发替换）。
 */
function assertPlainAncestorChain(directory: string): void {
  let current = path.resolve(directory);
  for (;;) {
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      throw new InstallError('INSTALL_FAILED', '外部目录祖先链不可复核');
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new InstallError('INSTALL_FAILED', '外部目录祖先链含链接或非目录');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

type DeliveryJournalState = 'planned' | 'quarantined' | 'delivered';

type DeliveryJournalEntry = {
  importer: string;
  /** 工程相对 node_modules 路径（`node_modules` 或 `<member>/node_modules`）。 */
  target: string;
  /** 预扫描在 rename 前真实观测的既有旧树状态，不事后补记。 */
  hadOriginal: boolean;
  /** 旧树移出的同卷工程外绝对路径。 */
  quarantine?: string;
  state: DeliveryJournalState;
};

type DeliveryJournalDocument = {
  schemaVersion: 1;
  kind: 't16-install-delivery';
  operationId: string;
  projectRoot: string;
  planDigest: string;
  entries: DeliveryJournalEntry[];
};

/** 日志所有权句柄：lastWritten 是本安装上次成功写入并读回核验的原字节。 */
type DeliveryJournalHandle = {
  backupRoot: string;
  directory: string;
  path: string;
  lastWritten: Buffer | undefined;
};

function deliveryJournalHandle(context: InstallContext): DeliveryJournalHandle | undefined {
  const journal = context.input.deliveryJournal;
  if (journal === undefined) return undefined;
  const backupRoot = path.resolve(journal.backupRoot);
  const directory = path.join(backupRoot, context.input.operationId);
  return {
    backupRoot,
    directory,
    path: path.join(directory, 'install-delivery.json'),
    lastWritten: undefined,
  };
}

/**
 * 逐文件字节级内容摘要（相对路径 → 文件字节 SHA-256；目录条目记 'dir'）：
 * 每一条目都以 lstat 权威复核形态（目录分支同样 lstat，不信 readdir 瞬时结论），
 * 拒绝链接、硬链接、非普通文件与不可枚举/不可读——同长度的窗口内编辑也会暴露，
 * 不用“路径+大小”代替真实字节。
 */
function treeContentDigest(root: string): Map<string, string> {
  const digest = new Map<string, string>();
  const walk = (directory: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      throw new InstallError('INSTALL_FAILED', '依赖树不可枚举，拒绝计算字节摘要');
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      let stats: fs.Stats;
      try {
        stats = fs.lstatSync(absolute);
      } catch {
        throw new InstallError('INSTALL_FAILED', '依赖树条目不可复核，拒绝计算字节摘要');
      }
      if (stats.isSymbolicLink()) {
        throw new InstallError('PATH_UNSAFE', '依赖树含有链接，拒绝计算字节摘要');
      }
      if (stats.isDirectory()) {
        digest.set(`${relative}/`, 'dir');
        walk(absolute, relative);
        continue;
      }
      if (!stats.isFile() || stats.nlink > 1) {
        throw new InstallError('PATH_UNSAFE', '依赖树含有非普通文件或硬链接，拒绝计算字节摘要');
      }
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(absolute);
      } catch {
        throw new InstallError('INSTALL_FAILED', '依赖树文件不可读取，拒绝计算字节摘要');
      }
      digest.set(relative, createHash('sha256').update(bytes).digest('hex'));
    }
  };
  walk(root, '');
  return digest;
}

function sameTreeDigest(baseline: Map<string, string>, current: Map<string, string>): boolean {
  if (baseline.size !== current.size) return false;
  for (const [key, value] of baseline) {
    if (current.get(key) !== value) return false;
  }
  return true;
}

/** 受控 rename 后的形态复核：目标必须以普通目录真实落位，缺失或被替换即失败关闭。 */
function assertRenamedDirectory(absolute: string, what: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch {
    throw new InstallError('INSTALL_FAILED', `${what}在受控移动后缺失`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new InstallError('INSTALL_FAILED', `${what}在受控移动后不是普通目录`);
  }
}

/**
 * 日志提交晚窗口复核（临时文件已写入、rename 之前）：操作目录仍是普通目录；
 * 原日志按本次是否首次写入分别核验——首次写入要求目标仍未出现（窗口内并发创建的
 * 未知文件不覆盖），更新要求原日志仍是 nlink=1 普通文件且字节与上次写入完全一致
 * （用户编辑保留，绝不 rename 覆盖）；本次临时文件必须读回等于拟写字节（被替换
 * 时连清理都不触碰）。任何偏离都在 rename 之前失败关闭，调用方停止后续交付动作。
 */
function assertPlainJournalCommit(handle: DeliveryJournalHandle, bytes: Buffer, temporary: string): void {
  let operationStats: fs.Stats;
  try {
    operationStats = fs.lstatSync(handle.directory);
  } catch {
    throw new InstallError('INSTALL_FAILED', '交付日志的操作目录在提交前不可复核');
  }
  if (operationStats.isSymbolicLink() || !operationStats.isDirectory()) {
    throw new InstallError('INSTALL_FAILED', '交付日志的操作目录在提交前被替换，拒绝提交');
  }
  let journalStats: fs.Stats | undefined;
  try {
    journalStats = fs.lstatSync(handle.path);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw new InstallError('INSTALL_FAILED', '交付日志在提交前不可复核');
    }
  }
  if (handle.lastWritten === undefined) {
    if (journalStats !== undefined) {
      throw new InstallError('INSTALL_FAILED', '交付日志路径在提交窗口内被并发创建，拒绝覆盖未知文件');
    }
  } else {
    if (journalStats === undefined) {
      throw new InstallError('INSTALL_FAILED', '原交付日志在提交窗口内消失，拒绝提交');
    }
    if (journalStats.isSymbolicLink() || !journalStats.isFile() || journalStats.nlink > 1) {
      throw new InstallError('INSTALL_FAILED', '原交付日志在提交前被替换或为硬链接，拒绝覆盖');
    }
    let onDisk: Buffer;
    try {
      onDisk = fs.readFileSync(handle.path);
    } catch {
      throw new InstallError('INSTALL_FAILED', '原交付日志在提交前不可读取');
    }
    if (!onDisk.equals(handle.lastWritten)) {
      throw new InstallError('INSTALL_FAILED', '原交付日志在提交窗口内被并发编辑，保留用户字节，拒绝覆盖');
    }
  }
  let temporaryStats: fs.Stats;
  try {
    temporaryStats = fs.lstatSync(temporary);
  } catch {
    throw new InstallError('INSTALL_FAILED', '本次交付日志临时文件在提交前不可复核');
  }
  if (temporaryStats.isSymbolicLink() || !temporaryStats.isFile() || temporaryStats.nlink > 1) {
    throw new InstallError('INSTALL_FAILED', '本次交付日志临时文件在提交前被替换，拒绝提交');
  }
  let temporaryBytes: Buffer;
  try {
    temporaryBytes = fs.readFileSync(temporary);
  } catch {
    throw new InstallError('INSTALL_FAILED', '本次交付日志临时文件在提交前不可读取');
  }
  if (!temporaryBytes.equals(bytes)) {
    throw new InstallError('INSTALL_FAILED', '本次交付日志临时文件字节与拟写内容不符，拒绝提交');
  }
}

/** 错误出口的临时文件清理：只在读回字节与本次写入完全一致时删除，绝不触碰被并发替换的未知文件。 */
function removeOwnedTemporary(temporary: string, bytes: Buffer): void {
  try {
    const stats = fs.lstatSync(temporary);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink > 1) return;
    const onDisk = fs.readFileSync(temporary);
    if (!onDisk.equals(bytes)) return;
    fs.rmSync(temporary, { force: true });
  } catch {
    // 清理失败不影响结论：日志未推进，现场如实保留。
  }
}

/**
 * 持久化交付日志（brief 冻结口径）：
 * - 父链完整核验：备份根本体起向上逐级 lstat 到卷根全部为普通目录；操作目录受控
 *   创建（非递归）后同样核验；日志文件只接受 nlink=1 普通文件，链接/硬链接拒绝；
 * - 更新只允许覆盖**本安装上次写入并读回核验的原字节**（读回逐字节相等才继续），
 *   首次写入要求目标不存在——未知、被篡改或被并发替换的日志一律失败关闭；
 * - 独占临时文件（wx）+ 受控 rename 原子替换，写后读回核验拟写内容；任何失败清理
 *   临时文件并上抛，调用方停止后续目录动作、保留现场。日志不含任何令牌。
 */
function persistDeliveryJournal(handle: DeliveryJournalHandle | undefined, document: DeliveryJournalDocument): void {
  if (handle === undefined) return;
  assertPlainAncestorChain(handle.backupRoot);
  try {
    fs.mkdirSync(handle.directory);
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') {
      throw new InstallError('INSTALL_FAILED', '交付日志的操作目录不可创建');
    }
  }
  let operationStats: fs.Stats;
  try {
    operationStats = fs.lstatSync(handle.directory);
  } catch {
    throw new InstallError('INSTALL_FAILED', '交付日志的操作目录不可复核');
  }
  if (operationStats.isSymbolicLink() || !operationStats.isDirectory()) {
    throw new InstallError('INSTALL_FAILED', '交付日志的操作目录不是普通目录');
  }
  let existing: fs.Stats | undefined;
  try {
    existing = fs.lstatSync(handle.path);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw new InstallError('INSTALL_FAILED', '交付日志文件形态不可复核');
    }
  }
  if (existing !== undefined) {
    if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink > 1) {
      throw new InstallError('INSTALL_FAILED', '既存交付日志不是普通文件或为硬链接，拒绝更新');
    }
    if (handle.lastWritten === undefined) {
      throw new InstallError('INSTALL_FAILED', '交付日志已存在且非本次写入，拒绝覆盖未知日志');
    }
    let onDisk: Buffer;
    try {
      onDisk = fs.readFileSync(handle.path);
    } catch {
      throw new InstallError('INSTALL_FAILED', '既存交付日志不可读取');
    }
    if (!onDisk.equals(handle.lastWritten)) {
      throw new InstallError('INSTALL_FAILED', '交付日志与本次最后写入不一致，拒绝覆盖被篡改日志');
    }
  }
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
  const temporary = path.join(
    handle.directory,
    `.install-delivery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    // 提交晚窗口复核：祖先链/操作目录身份、原日志字节与形态、本次临时文件全部
    // 重新核验——原日志在窗口内被并发编辑（用户字节）时绝不 rename 覆盖，
    // 保留用户字节并停止后续交付动作。
    assertPlainAncestorChain(handle.backupRoot);
    assertPlainJournalCommit(handle, bytes, temporary);
    fs.renameSync(temporary, handle.path);
  } catch (error) {
    // 错误出口的临时文件清理只在读回字节与本次写入完全一致时执行，
    // 绝不触碰窗口内被并发替换的未知文件。
    removeOwnedTemporary(temporary, bytes);
    throw error instanceof InstallError ? error : new InstallError('INSTALL_FAILED', '交付日志持久化失败');
  }
  let persisted: Buffer;
  try {
    persisted = fs.readFileSync(handle.path);
  } catch {
    throw new InstallError('INSTALL_FAILED', '交付日志写后不可读回核验');
  }
  if (!persisted.equals(bytes)) {
    throw new InstallError('INSTALL_FAILED', '交付日志写回与拟写内容不符');
  }
  handle.lastWritten = bytes;
}

/**
 * quarantine 根：与暂存区同父（同卷、工程外）的独占目录，命名绑定本次暂存后缀；
 * 不在清理前缀白名单内，任何出口都不删除。首次使用前核验：从暂存父目录到卷根的
 * 完整祖先链逐级普通目录；根自身受控创建（非递归 mkdir）后 lstat 复核为普通目录，
 * 既存或形态异常一律失败关闭，绝不复用未知目录。
 */
function ensureQuarantineRoot(context: InstallContext): string {
  const stagingRoot = path.resolve(context.stagingRoot);
  const suffix = path.basename(stagingRoot).slice('.t16-stage-'.length);
  const root = path.join(path.dirname(stagingRoot), `.t16-quarantine-${suffix}`);
  assertPlainAncestorChain(path.dirname(stagingRoot));
  let existing: fs.Stats | undefined;
  try {
    existing = fs.lstatSync(root);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw new InstallError('INSTALL_FAILED', 'quarantine 根形态不可复核');
    }
  }
  if (existing !== undefined) {
    throw new InstallError('INSTALL_FAILED', 'quarantine 根已存在，拒绝复用未知目录');
  }
  fs.mkdirSync(root);
  let created: fs.Stats;
  try {
    created = fs.lstatSync(root);
  } catch {
    throw new InstallError('INSTALL_FAILED', 'quarantine 根创建后不可复核');
  }
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new InstallError('INSTALL_FAILED', 'quarantine 根创建后不是普通目录');
  }
  return root;
}

/**
 * 同卷受控 rename 逐目录交付（brief 冻结口径）：
 * - 预扫描全部交付目标（形态 + 完整安全清单 + 逐文件字节摘要基线）后，在任何目标
 *   目录 rename 之前以独占临时文件持久化完整 planned 日志（真实 hadOriginal），
 *   日志写入失败即零 rename，不移动任何目标依赖目录；
 * - 既有旧树先复核基线未变，再同卷 rename 至工程外独占 quarantine；rename 后在
 *   quarantine 侧再次真实执行完整安全清单与字节摘要复核——移动窗口内的用户并发
 *   编辑被检出，真实用户字节随树完整保留在 quarantine，日志如实记录 quarantined
 *   与位置后停止新树交付，绝不清理现场；
 * - 旧树移出后记 quarantined、新树交付并复核落位后记 delivered；多目录不承诺跨
 *   目录原子事务，部分交付失败保留已交付新树、各 quarantine 与最后成功日志。
 */
export function deliverReadyTree(context: InstallContext, plan: DeliveryPlan): void {
  const projectRoot = path.resolve(context.input.projectRoot);
  const handle = deliveryJournalHandle(context);
  type PreparedImporter = {
    importer: string;
    relative: string;
    target: string;
    source: string;
    hadOriginal: boolean;
    baseline: Map<string, string> | undefined;
  };
  const prepared: PreparedImporter[] = [];
  for (const importer of plan.importers) {
    const source = path.join(context.readyRoot, ...(importer === '.' ? [] : importer.split('/')), 'node_modules');
    if (!isDirectory(source)) continue;
    const relative = importer === '.' ? 'node_modules' : `${importer}/node_modules`;
    const target = path.join(projectRoot, ...(importer === '.' ? [] : importer.split('/')), 'node_modules');
    let hadOriginal = false;
    let baseline: Map<string, string> | undefined;
    let stats: fs.Stats | undefined;
    try {
      stats = fs.lstatSync(target);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        throw new InstallError('INSTALL_FAILED', '目标 node_modules 形态不可判定');
      }
    }
    if (stats !== undefined) {
      if (stats.isSymbolicLink()) {
        throw new InstallError('INSTALL_FAILED', '目标 node_modules 是链接，拒绝交付');
      }
      if (!stats.isDirectory()) {
        throw new InstallError('INSTALL_FAILED', '目标 node_modules 不是目录，拒绝交付');
      }
      // 完整安全清单（边界即该旧树自身）+ 逐文件字节摘要基线：预扫描真实观测 hadOriginal。
      assertSafeTree(target, target);
      hadOriginal = true;
      baseline = treeContentDigest(target);
    }
    prepared.push({ importer, relative, target, source, hadOriginal, baseline });
  }
  const document: DeliveryJournalDocument = {
    schemaVersion: 1,
    kind: 't16-install-delivery',
    operationId: context.input.operationId,
    projectRoot: realpathOrSelf(projectRoot).split(path.sep).join('/'),
    planDigest: context.input.deliveryJournal?.planDigest ?? '',
    entries: prepared.map(item => ({
      importer: item.importer,
      target: item.relative,
      hadOriginal: item.hadOriginal,
      state: 'planned' as DeliveryJournalState,
    })),
  };
  // 完整 planned 日志先于任何目标目录 rename 实际持久化（brief 冻结）。
  persistDeliveryJournal(handle, document);
  let quarantineRoot: string | undefined;
  const usedQuarantineChildren = new Set<string>();
  for (const item of prepared) {
    // 每次 rename 前重新证明全部成员身份（首轮即全量复核，避免任何部分交付）。
    assertMembersStillChecked(context);
    const entry = document.entries.find(candidate => candidate.target === item.relative);
    if (entry === undefined) {
      throw new InstallError('INSTALL_FAILED', '交付范围与日志条目不一致，停止交付');
    }
    if (item.hadOriginal && item.baseline !== undefined) {
      // 旧树移出前复核：安全清单与字节摘要基线在预扫描后的窗口内未被并发修改。
      assertSafeTree(item.target, item.target);
      if (!sameTreeDigest(item.baseline, treeContentDigest(item.target))) {
        throw new InstallError('INSTALL_FAILED', '旧依赖树在交付前被并发修改，保留用户字节，停止交付');
      }
      if (quarantineRoot === undefined) quarantineRoot = ensureQuarantineRoot(context);
      const child = item.importer === '.' ? 'root' : item.importer.replace(/[^A-Za-z0-9._-]+/g, '_');
      if (usedQuarantineChildren.has(child)) {
        throw new InstallError('INSTALL_FAILED', 'quarantine 子目录命名冲突，停止交付');
      }
      const quarantine = path.join(quarantineRoot, child);
      let existing: fs.Stats | undefined;
      try {
        existing = fs.lstatSync(quarantine);
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') {
          throw new InstallError('INSTALL_FAILED', 'quarantine 目标形态不可复核');
        }
      }
      if (existing !== undefined) {
        throw new InstallError('INSTALL_FAILED', 'quarantine 目标已存在，拒绝覆盖未知目录');
      }
      fs.renameSync(item.target, quarantine);
      usedQuarantineChildren.add(child);
      // rename 后复核：完整安全清单、形态与字节摘要都在 quarantine 侧真实执行，
      // 不以注释代替——窗口内被并发编辑的树以字节级摘要检出。
      assertSafeTree(quarantine, quarantine);
      assertRenamedDirectory(quarantine, 'quarantine 后的旧依赖树');
      entry.quarantine = quarantine;
      entry.state = 'quarantined';
      const movedIntact = sameTreeDigest(item.baseline, treeContentDigest(quarantine));
      // 先如实落盘 quarantined 与位置（含移动窗口内被并发编辑的情况），再判定是否
      // 停止：用户字节保留在 quarantine 且日志可诊断，绝不清理现场。
      persistDeliveryJournal(handle, document);
      if (!movedIntact) {
        throw new InstallError('INSTALL_FAILED', '旧依赖树在移动窗口内被并发修改，保留用户字节，停止交付');
      }
    } else {
      const parent = path.dirname(item.target);
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.renameSync(item.source, item.target);
    assertRenamedDirectory(item.target, '交付后的目标 node_modules');
    entry.state = 'delivered';
    persistDeliveryJournal(handle, document);
  }
}

/** 从**目标**已交付的目录重新计算实际安装证据（name+version 逐一相符）。 */
export function readInstalledVersions(context: InstallContext): IntegrationDependency[] {
  const installed: IntegrationDependency[] = [];
  for (const dependency of context.input.exactDependencies) {
    const manifest = path.join(path.resolve(context.input.projectRoot), 'node_modules', ...dependency.name.split('/'), 'package.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    } catch {
      throw new InstallError('INSTALLED_VERSION_MISMATCH', `依赖 ${dependency.name} 未在目标中实际交付`);
    }
    const installedName = isPlainObject(parsed) ? parsed['name'] : undefined;
    if (typeof installedName !== 'string' || installedName !== dependency.name) {
      throw new InstallError('INSTALLED_VERSION_MISMATCH', `依赖 ${dependency.name} 的目标交付包身份与计划不符`);
    }
    const version = isPlainObject(parsed) ? parsed['version'] : undefined;
    if (typeof version !== 'string' || version !== dependency.version) {
      throw new InstallError('INSTALLED_VERSION_MISMATCH', `依赖 ${dependency.name} 的目标交付版本与计划不符`);
    }
    installed.push({ name: dependency.name, version: dependency.version });
  }
  return installed;
}

const EXTERNAL_ROOT_PREFIXES = ['.t16-stage-', '.t16-env-', '.t16-ready-'];

/**
 * 尽力清理本次创建的外部暂存目录（失败/中断出口）：rm 异常与残留都如实保留现场，
 * 不冒称已清理；删除前必须以所有权标记证明本次创建身份（被未知用户树替换的目录
 * 绝不递归删除）；隔离凭据（含 registry 令牌的 userconfig）在 env 目录整体删除被拒时
 * 也按写入字节所有权单独尽力移除，不回显令牌；quarantine、交付日志与目标工程一律
 * 不触碰（固定前缀白名单之外的目录一律不碰）。
 */
export function cleanupInstall(context: InstallContext): void {
  const projectRoot = path.resolve(context.input.projectRoot);
  const roots: { directory: string; role: string }[] = [
    { directory: context.stagingRoot, role: 'stage' },
    { directory: context.envRoot, role: 'env' },
    { directory: context.readyRoot, role: 'ready' },
  ];
  for (const { directory, role } of roots) {
    const absolute = path.resolve(directory);
    const name = path.basename(absolute);
    // 只清理本次按固定前缀创建、且位于目标之外的目录；其余一律不碰。
    if (!EXTERNAL_ROOT_PREFIXES.some(prefix => name.startsWith(prefix))) continue;
    if (sameDirectory(absolute, projectRoot) || absolute.startsWith(projectRoot + path.sep)) continue;
    if (!fs.existsSync(absolute)) continue;
    // 删除前的所有权证明：标记核验不通过（含被未知树替换）绝不递归删除，现场保留。
    if (!verifyOwnerMarker(absolute, context.input.operationId, role)) continue;
    try {
      fs.rmSync(absolute, { recursive: true, force: true });
    } catch {
      // 失败出口如实保留现场，不声称已清理。
    }
  }
  removeUserConfigIfOwned(context);
}

/**
 * 成功出口的严格清理：staging/env/ready 任一目录 rm 抛错（即使目录随后消失）或
 * 删除后仍存在、所有权标记核验不通过（含被未知用户树替换）、隔离凭据清理后仍残留，
 * 都返回 false——调用方必须失败关闭，不得 applied；凭据尽力按写入字节所有权独立移除
 * 且不回显令牌；quarantine、交付日志与用户目标一律不动。
 */
export function cleanupInstallStrict(context: InstallContext): boolean {
  const projectRoot = path.resolve(context.input.projectRoot);
  let clean = true;
  const roots: { directory: string; role: string }[] = [
    { directory: context.stagingRoot, role: 'stage' },
    { directory: context.envRoot, role: 'env' },
    { directory: context.readyRoot, role: 'ready' },
  ];
  for (const { directory, role } of roots) {
    const absolute = path.resolve(directory);
    const name = path.basename(absolute);
    if (!EXTERNAL_ROOT_PREFIXES.some(prefix => name.startsWith(prefix))) continue;
    if (sameDirectory(absolute, projectRoot) || absolute.startsWith(projectRoot + path.sep)) continue;
    if (!fs.existsSync(absolute)) continue;
    // 删除前的所有权证明：标记核验不通过绝不递归删除未知树，严格清理如实失败关闭。
    if (!verifyOwnerMarker(absolute, context.input.operationId, role)) {
      clean = false;
      continue;
    }
    try {
      fs.rmSync(absolute, { recursive: true, force: true });
    } catch {
      // rm 异常不吞：即使目录随后消失也保守视为未完成清理。
      clean = false;
    }
    if (fs.existsSync(absolute)) clean = false;
  }
  // 隔离凭据尽力独立移除（写入字节所有权守卫，不回显令牌）；残留如实判失败关闭。
  removeUserConfigIfOwned(context);
  if (fs.existsSync(context.userConfig)) clean = false;
  return clean;
}
