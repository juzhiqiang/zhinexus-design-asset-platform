/**
 * T17 矩阵 harness 基础工具：摘要、路径、项目快照、JSON 读写。
 * 纯 Node 实现，不依赖产品包，便于在冻结包/环境就绪前做结构校验。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export async function sha256File(file: string): Promise<string> {
  return sha256Bytes(await readFile(file));
}

export function sha256Text(text: string): string {
  return sha256Bytes(Buffer.from(text, 'utf8'));
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** 稳定排序后的规范化 JSON（与 @company/contracts canonicalJson 相同规则）。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

export const canonicalSha256 = (value: unknown): string => sha256Text(canonicalJson(value));

const SNAPSHOT_EXCLUDES = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo', 'coverage']);

/** 递归列出项目源文件（相对路径，/ 分隔），排除依赖、VCS 与构建输出。 */
export function listProjectFiles(root: string, base = ''): string[] {
  const absolute = path.join(root, ...base.split('/').filter(Boolean));
  if (!existsSync(absolute)) return [];
  const output: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || SNAPSHOT_EXCLUDES.has(entry.name)) continue;
    const relative = base ? `${base}/${entry.name}` : entry.name;
    const entryPath = path.join(absolute, entry.name);
    const info = statSync(entryPath);
    if (info.isSymbolicLink()) {
      output.push(relative);
      continue;
    }
    if (info.isDirectory()) output.push(...listProjectFiles(root, relative));
    else if (info.isFile()) output.push(relative);
  }
  return output.sort();
}

/** 项目源快照摘要：排序后的 (path, sha256) 规范 JSON 的 SHA-256。 */
export async function digestProject(root: string): Promise<string> {
  const entries: { path: string; sha256: string }[] = [];
  for (const relative of listProjectFiles(root)) {
    const absolute = path.join(root, ...relative.split('/'));
    const info = statSync(absolute);
    if (info.isSymbolicLink()) entries.push({ path: relative, sha256: 'symlink' });
    else entries.push({ path: relative, sha256: await sha256File(absolute) });
  }
  return canonicalSha256(entries);
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

/** 项目根的正斜杠规范形式（与 CLI canonicalProjectRoot 的比对口径一致）。 */
export function canonicalProjectRoot(root: string): string {
  return normalizeSlashes(path.resolve(root));
}
