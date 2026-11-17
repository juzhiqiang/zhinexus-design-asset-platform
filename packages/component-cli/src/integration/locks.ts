import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseAllDocuments } from 'yaml';
import { isFile, isPlainObject } from './workspace.js';

/**
 * T15 P1 锁文件只读解析：npm package-lock v3 与 pnpm lockfile v9。
 * pnpm 12.18.0 实际产出的锁可能包含多个 YAML 文档（packageManagerDependencies 之后是 v9 正文），
 * 因此统一使用 parseAllDocuments，并要求文档无解析错误、锁文档唯一（拒绝歧义）。
 * 锁内容仅用于定位精确版本，绝不执行项目配置或脚本。
 */

export const NPM_LOCK_FILE = 'package-lock.json';
export const PNPM_LOCK_FILE = 'pnpm-lock.yaml';
/** 其他包管理器锁：出现即明确冲突，不自动迁移、不静默忽略。 */
export const FOREIGN_LOCK_FILES = ['yarn.lock', 'bun.lock', 'bun.lockb'] as const;

export type NpmImporterEntry = {
  version?: string;
  resolved?: string;
  link?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
export type NpmLockData = { packages: Record<string, NpmImporterEntry> };
export type PnpmDependencyEntry = { specifier?: string; version?: string };
export type PnpmImporterEntry = {
  dependencies?: Record<string, PnpmDependencyEntry>;
  devDependencies?: Record<string, PnpmDependencyEntry>;
  optionalDependencies?: Record<string, PnpmDependencyEntry>;
};
export type PnpmLockData = { importers: Record<string, PnpmImporterEntry> };

export type LockReadResult =
  | { ok: true; format: 'npm-v3'; data: NpmLockData }
  | { ok: true; format: 'pnpm-v9'; data: PnpmLockData }
  | { ok: false; reason: 'unsupported' | 'invalid'; message: string };

function readText(abs: string): string | undefined {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
}

/** npm package-lock v3：lockfileVersion 必须为整数 3，packages 必须为对象。 */
export function readNpmLock(root: string): LockReadResult {
  const text = readText(path.join(root, NPM_LOCK_FILE));
  if (text === undefined) return { ok: false, reason: 'invalid', message: 'package-lock.json 不可读' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid', message: 'package-lock.json 不是合法 JSON' };
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: 'invalid', message: 'package-lock.json 顶层不是对象' };
  if (parsed['lockfileVersion'] !== 3) {
    return { ok: false, reason: 'unsupported', message: `仅支持 npm package-lock v3，实际 lockfileVersion=${JSON.stringify(parsed['lockfileVersion'])}` };
  }
  const packages = parsed['packages'];
  if (!isPlainObject(packages)) return { ok: false, reason: 'invalid', message: 'package-lock.json 缺少 packages 映射' };
  return { ok: true, format: 'npm-v3', data: { packages: packages as Record<string, NpmImporterEntry> } };
}

function parseYamlDocuments(text: string): Record<string, unknown>[] | string {
  let documents;
  try {
    documents = parseAllDocuments(text, { strict: true, uniqueKeys: true, logLevel: 'silent' });
  } catch {
    return 'YAML 解析失败（含重复键等严格错误）';
  }
  if (!Array.isArray(documents) || documents.length === 0) return '空 YAML 文档流';
  const values: Record<string, unknown>[] = [];
  for (const document of documents) {
    if (document.errors.length > 0) return `YAML 文档含有解析错误：${document.errors[0]?.message ?? '未知错误'}`;
    const value = document.toJS();
    if (value === null || value === undefined) continue;
    if (!isPlainObject(value)) return 'YAML 文档顶层不是映射';
    values.push(value);
  }
  return values;
}

/**
 * 判断锁文档是否为“仅配置”文档：所有 importer 都只含 configDependencies/packageManagerDependencies。
 * 真实 pnpm 12.18.0 的锁由多个 v9 文档组成：前者仅含这两类配置键，后者才是项目依赖；
 * 空 importer（零依赖项目）不属于 config-only。据此区分，既不一概视为歧义，也不把配置文档当项目锁。
 */
function isConfigOnlyDocument(document: Record<string, unknown>): boolean {
  const importers = document['importers'];
  if (!isPlainObject(importers)) return false;
  const importersList = Object.values(importers);
  if (importersList.length === 0) return false;
  return importersList.every(importer => {
    if (!isPlainObject(importer)) return false;
    const keys = Object.keys(importer);
    if (keys.length === 0) return false;
    return keys.every(key => key === 'configDependencies' || key === 'packageManagerDependencies');
  });
}

/**
 * 受支持的 pnpm 锁正文版本：真实 pnpm 12.18.0 写 `lockfileVersion: '9.0'`（带引号的标量字符串）。
 * 只接受这一个值：数组/对象/数字/null 等非标量判为无效，其余标量（含伪造的 `9.x` 尾缀）判为不支持。
 */
const PNPM_LOCK_VERSION = '9.0';

function classifyPnpmLockVersion(raw: unknown): 'supported' | 'unsupported' | 'invalid' {
  if (typeof raw !== 'string') return 'invalid';
  if (raw === PNPM_LOCK_VERSION) return 'supported';
  return 'unsupported';
}

/**
 * pnpm lockfile v9：多文档时按项目依赖文档定位；config-only 文档忽略，多个项目文档拒绝歧义。
 * 项目锁正文必须显式声明受支持的标量 lockfileVersion——缺字段、非标量或伪造 9.x 尾缀都不得靠
 * “其他文档有版本”或字符串化蒙混过关（真实 config-only + 正文多文档仍受支持）。
 */
export function readPnpmLock(root: string): LockReadResult {
  const text = readText(path.join(root, PNPM_LOCK_FILE));
  if (text === undefined) return { ok: false, reason: 'invalid', message: 'pnpm-lock.yaml 不可读' };
  const documents = parseYamlDocuments(text);
  if (typeof documents === 'string') return { ok: false, reason: 'invalid', message: `pnpm-lock.yaml ${documents}` };
  const lockDocuments = documents.filter(document => 'lockfileVersion' in document || 'importers' in document);
  if (lockDocuments.length === 0) return { ok: false, reason: 'invalid', message: 'pnpm-lock.yaml 中找不到锁文档' };
  for (const document of lockDocuments) {
    if (!('lockfileVersion' in document)) continue;
    const raw = document['lockfileVersion'];
    const verdict = classifyPnpmLockVersion(raw);
    if (verdict === 'invalid') {
      return { ok: false, reason: 'invalid', message: `pnpm-lock.yaml 的 lockfileVersion 不是合法标量版本：${JSON.stringify(raw)}` };
    }
    if (verdict === 'unsupported') {
      return { ok: false, reason: 'unsupported', message: `仅支持 pnpm lockfile v9，实际 lockfileVersion=${JSON.stringify(raw)}` };
    }
  }
  const projectDocuments = lockDocuments.filter(document => !isConfigOnlyDocument(document));
  if (projectDocuments.length === 0) {
    return { ok: false, reason: 'invalid', message: 'pnpm-lock.yaml 中找不到项目锁文档（仅含配置文档）' };
  }
  if (projectDocuments.length > 1) {
    return { ok: false, reason: 'invalid', message: 'pnpm-lock.yaml 含有多个项目锁文档，拒绝歧义' };
  }
  const lock = projectDocuments[0]!;
  // 项目锁正文必须自带受支持的标量版本；缺字段同样失效关闭。
  if (classifyPnpmLockVersion(lock['lockfileVersion']) !== 'supported') {
    return {
      ok: false,
      reason: 'invalid',
      message: `pnpm-lock.yaml 的项目锁文档缺少受支持的 lockfileVersion（仅支持 ${PNPM_LOCK_VERSION}）：${JSON.stringify(lock['lockfileVersion'])}`,
    };
  }
  const importers = lock['importers'];
  if (!isPlainObject(importers)) return { ok: false, reason: 'invalid', message: 'pnpm-lock.yaml 的项目锁文档缺少 importers 映射' };
  return { ok: true, format: 'pnpm-v9', data: { importers: importers as Record<string, PnpmImporterEntry> } };
}

/**
 * npm 解析：依赖必须由目标 importer 自身声明；未声明时不得借用其他 importer/node_modules 的提升版本。
 * 逐层向下查找 `node_modules/<name>` 记录：
 * - 该层**没有**这条记录 → 继续向根方向查找（正常提升解析）；
 * - 该层记录存在但给不出精确版本 → 它实际遮蔽更外层条目，一律失效关闭（`unresolved`）：
 *   仅 `link === true` 且 `resolved` 指向锁内合法包的链接记录才解析其目标版本，
 *   其余缺 `version` 的记录（含 `resolved` 指向无关包、无 link 标记）不得借旁边或根上的版本冒充；
 * - 显式坏记录（`null`/数组/标量）与“记录缺失”不是一回事，同样失效关闭。
 */
export function resolveNpmDependency(
  packages: Record<string, NpmImporterEntry>,
  importerKey: string,
  name: string,
): { version?: string; specifier?: string; unresolved?: boolean } | undefined {
  const importer = packages[importerKey];
  if (!importer) return undefined;
  let specifier: string | undefined;
  let malformedSpecifier = false;
  for (const map of [importer?.dependencies, importer?.devDependencies, importer?.optionalDependencies]) {
    if (!isPlainObject(map) || !(name in map)) continue;
    const declared = map[name];
    if (typeof declared === 'string') { specifier = declared; break; }
    // 显式声明但类型错误：不得当作未声明，也不得借用其他 map 的字符串蒙混。
    malformedSpecifier = true;
  }
  if (specifier === undefined) return malformedSpecifier ? { unresolved: true } : undefined;
  const segments = importerKey === '' ? [] : importerKey.split('/');
  for (let depth = segments.length; depth >= 0; depth--) {
    const prefix = segments.slice(0, depth).join('/');
    const key = prefix ? `${prefix}/node_modules/${name}` : `node_modules/${name}`;
    // 用“键是否存在”区分记录缺失与显式坏记录。
    if (!Object.prototype.hasOwnProperty.call(packages, key)) continue;
    const entry = packages[key];
    if (!isPlainObject(entry)) return { specifier, unresolved: true };
    if (typeof entry.version === 'string') return { version: entry.version, specifier };
    const linked = entry.link === true && typeof entry.resolved === 'string' ? packages[entry.resolved] : undefined;
    const linkedVersion = isPlainObject(linked) && typeof linked.version === 'string' ? linked.version : undefined;
    return { version: linkedVersion, specifier, unresolved: linkedVersion === undefined };
  }
  return { specifier };
}

/**
 * pnpm 解析：importer 依赖条目中的 version 即精确版本（去除 peer 后缀）。
 * `unresolved` 表示条目不完整（缺 specifier 或 specifier 非字符串）：不得默认相信缺失字段，
 * 必须由调用方显式冲突，不能跳过与 package.json 声明的一致性核对。
 */
export function resolvePnpmDependency(
  importers: Record<string, PnpmImporterEntry>,
  importerKey: string,
  name: string,
): { version?: string; specifier?: string; unresolved?: boolean } | undefined {
  const importer = importers[importerKey];
  for (const map of [importer?.dependencies, importer?.devDependencies, importer?.optionalDependencies]) {
    const entry = map?.[name];
    if (!entry) continue;
    const raw = typeof entry.version === 'string' ? entry.version : '';
    const version = raw.split('(')[0]!.trim();
    if (entry.specifier === undefined) return { version: version || undefined, unresolved: true };
    if (typeof entry.specifier !== 'string') return { version: version || undefined, unresolved: true };
    return { version: version || undefined, specifier: entry.specifier };
  }
  return undefined;
}

export function lockFileExists(root: string, file: 'npm' | 'pnpm'): boolean {
  return isFile(path.join(root, file === 'npm' ? NPM_LOCK_FILE : PNPM_LOCK_FILE));
}

/** 返回根目录下存在的其他包管理器锁文件名（yarn/bun），用于明确冲突而非静默忽略。 */
export function foreignLocksPresent(root: string): string[] {
  return FOREIGN_LOCK_FILES.filter(file => isFile(path.join(root, file)));
}
