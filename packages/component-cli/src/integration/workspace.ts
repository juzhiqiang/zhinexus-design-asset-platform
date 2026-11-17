import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseAllDocuments } from 'yaml';
import type { IntegrationConflict } from '../contracts/integration-plan.js';

/**
 * T15 P1 工作区解析：workspace 参数词法校验、realpath 边界、monorepo 声明与 glob 边界。
 * 边界以 P0 冻结的 workspacePatternCases 为准：仅支持普通相对目录与完整路径段 `*` / `**`；
 * 否定、brace、extglob、部分段通配、问号、反斜杠、穿越与尾斜杠一律拒绝（明确冲突，不猜测成员）。
 */

const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_WORKSPACE_CHARS = /[\\:%?*#<>|"\u0000-\u001f]/;

export type WorkspaceResolution =
  | { ok: true; workspace: string; targetDir: string; realRoot: string; realTarget: string }
  | { ok: false; conflict: IntegrationConflict };

export function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

export function realpathOrSelf(abs: string): string {
  try {
    return fs.realpathSync(abs);
  } catch {
    return path.resolve(abs);
  }
}

/** realpath 边界：child 必须等于 parent 或位于其内部。 */
export function isInsideDirectory(parentReal: string, childReal: string): boolean {
  const relative = path.relative(parentReal, childReal);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** workspace 参数必须是项目根相对目录：拒绝绝对路径、`..`/`.` 段、空段、设备名、Windows 非法字符与末尾点/空格。 */
export function isLexicalWorkspacePathValid(workspace: string): boolean {
  if (workspace === '.') return true;
  if (!workspace) return false;
  if (INVALID_WORKSPACE_CHARS.test(workspace)) return false;
  if (workspace.startsWith('/')) return false;
  for (const segment of workspace.split('/')) {
    if (!segment || segment === '.' || segment === '..') return false;
    if (DEVICE_NAME.test(segment)) return false;
    if (segment.endsWith('.') || segment.endsWith(' ')) return false;
  }
  return true;
}

/** P0 冻结的 glob 子集校验：完整段 `*` / `**`、普通目录；其余语法一律不支持。 */
export function isSupportedWorkspacePattern(pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.includes('\\')) return false;
  if (pattern.startsWith('/') || pattern.endsWith('/')) return false;
  if (/[!?{}[\]]/.test(pattern)) return false;
  const segments = pattern.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return false;
  return segments.every(segment => segment === '*' || segment === '**' || !segment.includes('*'));
}

function matchSegments(pattern: readonly string[], candidate: readonly string[]): boolean {
  if (pattern.length === 0) return candidate.length === 0;
  const head = pattern[0]!;
  const rest = pattern.slice(1);
  if (head === '**') {
    for (let take = 0; take <= candidate.length; take++) {
      if (matchSegments(rest, candidate.slice(take))) return true;
    }
    return false;
  }
  if (candidate.length === 0) return false;
  if (head === '*' || head === candidate[0]) return matchSegments(rest, candidate.slice(1));
  return false;
}

export function matchesWorkspacePattern(pattern: string, candidate: string): boolean {
  return matchSegments(pattern.split('/'), candidate.split('/'));
}

export function matchesAnyWorkspacePattern(patterns: readonly string[], candidate: string): boolean {
  return patterns.some(pattern => matchesWorkspacePattern(pattern, candidate));
}

/** 解析 workspace 目标：词法合法 → 目录与 package.json 存在 → realpath 不逃逸项目根。 */
export function resolveWorkspaceTarget(root: string, workspace: string | undefined): WorkspaceResolution {
  const realRoot = realpathOrSelf(path.resolve(root));
  const target = workspace === undefined ? '.' : workspace;
  if (!isLexicalWorkspacePathValid(target)) {
    return {
      ok: false,
      conflict: {
        code: 'WORKSPACE_INVALID',
        message: `workspace 参数不是合法的项目根相对目录：${JSON.stringify(target)}`,
        blocking: true,
      },
    };
  }
  const targetDir = path.resolve(realRoot, ...target.split('/'));
  if (!isDirectory(targetDir) || !isFile(path.join(targetDir, 'package.json'))) {
    return {
      ok: false,
      conflict: {
        code: 'WORKSPACE_INVALID',
        message: `workspace 目标不存在或缺少 package.json：${target}`,
        blocking: true,
        path: target,
      },
    };
  }
  const realTarget = realpathOrSelf(targetDir);
  if (!isInsideDirectory(realRoot, realTarget)) {
    return {
      ok: false,
      conflict: {
        code: 'PATH_UNSAFE',
        message: `workspace 目标 ${target} 的 realpath 逃逸出项目根`,
        blocking: true,
        path: target,
      },
    };
  }
  return { ok: true, workspace: target, targetDir: realTarget, realRoot, realTarget };
}

export function isDirectory(abs: string): boolean {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

export type WorkspacePatternsRead =
  | { ok: true; patterns: string[] }
  | { ok: false; message: string };

/** 供错误信息描述 YAML 值形态（不引入额外依赖，也不把值内容回显到不可信输出）。 */
function describeYamlType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '数组';
  if (typeof value === 'object') return '对象';
  return typeof value;
}

/** 读取 pnpm-workspace.yaml 的 packages 声明；多个文档都声明 packages 时拒绝歧义（失效关闭）。 */
export function readPnpmWorkspacePatterns(absWorkspaceFile: string): WorkspacePatternsRead | undefined {
  if (!isFile(absWorkspaceFile)) return undefined;
  let documents;
  try {
    documents = parseAllDocuments(fs.readFileSync(absWorkspaceFile, 'utf8'), {
      strict: true,
      uniqueKeys: true,
      logLevel: 'silent',
    });
  } catch {
    return { ok: false, message: 'pnpm-workspace.yaml 解析失败' };
  }
  if (!Array.isArray(documents) || documents.length === 0) return { ok: false, message: 'pnpm-workspace.yaml 不是有效的 YAML 文档' };
  for (const document of documents) {
    if (document.errors.length > 0) return { ok: false, message: 'pnpm-workspace.yaml 含有解析错误' };
  }
  const declarations: string[][] = [];
  for (const document of documents) {
    const value = document.toJS();
    if (!isPlainObject(value)) continue;
    if (!('packages' in value)) continue;
    const packages = value['packages'];
    // 显式声明但类型错误：失效关闭。缺字段可以跳过（该文档未声明成员范围），坏字段不能混同。
    if (!Array.isArray(packages)) {
      return { ok: false, message: `pnpm-workspace.yaml 的 packages 声明不是数组（实际 ${describeYamlType(packages)}）` };
    }
    const patterns = packages.filter((entry): entry is string => typeof entry === 'string');
    if (patterns.length !== packages.length) return { ok: false, message: 'pnpm-workspace.yaml 的 packages 含有非字符串条目' };
    declarations.push(patterns);
  }
  if (declarations.length === 0) return { ok: false, message: 'pnpm-workspace.yaml 缺少 packages 声明' };
  // 多个文档都声明成员范围即歧义：不默认选取第一份，失效关闭。
  if (declarations.length > 1) return { ok: false, message: 'pnpm-workspace.yaml 的多个文档都声明 packages，拒绝歧义' };
  return { ok: true, patterns: declarations[0]! };
}

/** 读取根 package.json 的 npm workspaces 声明（数组或 { packages } 形态）；非字符串条目失效关闭。 */
export function readNpmWorkspacePatterns(rootManifest: Record<string, unknown> | undefined): WorkspacePatternsRead | undefined {
  const workspaces = rootManifest?.['workspaces'];
  if (workspaces === undefined) return undefined;
  const candidates = Array.isArray(workspaces)
    ? workspaces
    : (isPlainObject(workspaces) ? workspaces['packages'] : undefined);
  if (!Array.isArray(candidates)) return { ok: false, message: 'package.json 的 workspaces 声明无法识别' };
  const patterns = candidates.filter((entry): entry is string => typeof entry === 'string');
  if (patterns.length !== candidates.length) return { ok: false, message: 'package.json 的 workspaces 含有非字符串条目' };
  return { ok: true, patterns };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
