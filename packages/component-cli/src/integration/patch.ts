/**
 * T16 P1 目标写入与恢复的文件系统原语。
 *
 * 职责：把“原字节备份 + 逐文件 hash 守卫 + 原子写入 + 保留用户后续编辑的恢复”
 * 收敛到一组可复用原语上，供 apply 与 rollback 共用同一套判定，避免两处语义漂移。
 *
 * 边界：
 * - 任何目标路径都先解析真实落点并证明位于项目根内；经链接逃逸、链接环或无法解析一律失败关闭；
 * - 只接受普通文件（写前禁止符号链接/junction/hardlink；恢复时禁止经链接读写工程外字节）；
 * - 写入用同目录临时文件 + rename 形成新 inode，绝不就地写穿硬链接另一侧的字节；
 * - 恢复结果按 restored / unchanged / preserved / unresolved 四组互斥归类，I/O 失败不冒称用户编辑。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { realPathOf } from './resolve.js';
import { isInsideDirectory } from './workspace.js';

/** 进入备份的单文件字节上限：超出即失败关闭，不把大文件读进内存。 */
export const MAX_GUARDED_FILE_BYTES = 4 * 1024 * 1024;

export type PatchErrorCode =
  | 'PATH_UNSAFE'
  | 'WRITE_FAILED'
  | 'BACKUP_INVALID'
  | 'PROJECT_CHANGED'
  | 'TARGET_CHANGED'
  | 'INVALID_PLAN';

/** 原语级失败：`code` 稳定，消息固定脱敏（可附合法项目相对路径）。 */
export class PatchError extends Error {
  readonly code: PatchErrorCode;
  readonly path?: string;

  constructor(code: PatchErrorCode, message: string, relativePath?: string) {
    super(message);
    this.name = 'PatchError';
    this.code = code;
    if (relativePath !== undefined) this.path = relativePath;
  }
}

export type TargetBytes = { exists: true; bytes: Buffer } | { exists: false };

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toAbsolute(root: string, relative: string): string {
  return path.join(root, ...relative.split('/'));
}

/**
 * 读取目标文件当前字节；只有真实“不存在”（ENOENT，或父路径已不是目录的 ENOTDIR）
 * 返回 exists:false。EACCES/EIO 等读取 I/O 错误一律原样上抛，由调用方按 I/O 失败
 * 归类（unresolved / 失败关闭），绝不误当缺失后替用户重建或删除。
 */
export function readTargetBytes(absolute: string): TargetBytes {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false };
    throw error;
  }
  if (!stats.isFile()) {
    throw new PatchError('PATH_UNSAFE', '目标路径不是普通文件，拒绝读取');
  }
  return { exists: true, bytes: fs.readFileSync(absolute) };
}

/**
 * 写前复核：解析真实落点并证明父目录位于项目根内。
 * 返回**可写**的绝对路径（仍按项目相对路径的下一个段创建），不跟随任何链接声明。
 */
export function assertWritableTarget(root: string, relative: string): string {
  const absolute = toAbsolute(root, relative);
  const real = realPathOf(absolute);
  if (!real.ok || !isInsideDirectory(root, real.real)) {
    throw new PatchError('PATH_UNSAFE', '目标路径的真实落点无法证明在项目内', relative);
  }
  return absolute;
}

/**
 * 备份前复核：必须能证明真实落点在项目内；**已存在**的备份源还必须是普通文件、
 * 不是硬链接（硬链接会把写穿带到工程外）且不超出字节上限。计划新建的文件允许尚不存在。
 */
export function assertBackupSource(root: string, relative: string): string {
  const absolute = toAbsolute(root, relative);
  const real = realPathOf(absolute);
  if (!real.ok || !isInsideDirectory(root, real.real)) {
    throw new PatchError('PATH_UNSAFE', '备份源的真实落点无法证明在项目内', relative);
  }
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch {
    return absolute;
  }
  if (!stats.isFile()) {
    throw new PatchError('PATH_UNSAFE', '备份源不是普通文件，拒绝备份', relative);
  }
  if (stats.nlink > 1) {
    throw new PatchError('PATH_UNSAFE', '备份源是硬链接，拒绝备份以免写穿工程外字节', relative);
  }
  if (stats.size > MAX_GUARDED_FILE_BYTES) {
    throw new PatchError('PATH_UNSAFE', '备份源超出受保护的字节上限', relative);
  }
  return absolute;
}

/** 恢复前复核：必须能证明真实落点在项目内，且当前不是链接（绝不读写链接目标）。 */
export function assertRestorableTarget(root: string, relative: string): string {
  const absolute = toAbsolute(root, relative);
  const real = realPathOf(absolute);
  if (!real.ok || !isInsideDirectory(root, real.real)) {
    throw new PatchError('PATH_UNSAFE', '恢复目标的真实落点无法证明在项目内', relative);
  }
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch {
    return absolute;
  }
  if (stats.isSymbolicLink()) {
    throw new PatchError('PATH_UNSAFE', '恢复目标是链接，拒绝经链接读写工程外字节', relative);
  }
  if (!stats.isFile() && !stats.isDirectory()) {
    throw new PatchError('PATH_UNSAFE', '恢复目标不是普通文件', relative);
  }
  return absolute;
}

/** 建立父目录并回报本次创建的目录（倒序即自底向上删除顺序）。 */
export function ensureTargetDirectory(root: string, relative: string): string[] {
  const created: string[] = [];
  let current = root;
  for (const segment of relative.split('/').slice(0, -1)) {
    current = path.join(current, segment);
    const real = realPathOf(current);
    if (!real.ok || !isInsideDirectory(root, real.real)) {
      throw new PatchError('PATH_UNSAFE', '目标父目录的真实落点无法证明在项目内', relative);
    }
    let stats: fs.Stats | undefined;
    try {
      stats = fs.lstatSync(current);
    } catch {
      stats = undefined;
    }
    if (stats === undefined) {
      fs.mkdirSync(current);
      created.unshift(current);
    } else if (!stats.isDirectory()) {
      throw new PatchError('PATH_UNSAFE', '目标父目录不是目录', relative);
    }
  }
  return created;
}

/**
 * 只删除本次创建且已为空的目录；用户目录与任何非空目录一律保留。
 * `created` 由 `ensureTargetDirectory` 以**自底向上**顺序产出，这里按原序删除即可。
 */
export function removeCreatedDirectories(created: readonly string[]): void {
  for (const directory of created) {
    try {
      fs.rmdirSync(directory);
    } catch {
      // 目录非空或已不存在：保留现场，绝不递归清理。
    }
  }
}

function temporaryNameFor(absolute: string): string {
  const unique = createHash('sha256').update(`${absolute}:${process.pid}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 12);
  const base = path.basename(absolute);
  return path.join(path.dirname(absolute), `.${base}.t16-${unique}.tmp`);
}

/**
 * 原子写入目标文件：同目录临时文件 + rename；每次操作前复查父路径。
 * `sink` 回报**本次创建的目录**——即使随后写入失败，调用方也能把它们清掉，
 * 不在目标工程里留下空目录。
 * `expected` 是写前期望状态（apply 由计划守卫派生）：rename 提交前晚复核——
 * 目标在“暂存写入 → rename”窗口内被并发创建/改写时绝不覆盖，失败关闭；
 * 新建目标必须仍然不存在（独占），既有目标必须仍是期望字节。不传则该保护不启用。
 */
export function writeTargetFile(
  root: string,
  relative: string,
  content: Buffer,
  sink?: string[],
  expected?: { exists: boolean; sha256?: string },
): void {
  const absolute = assertWritableTarget(root, relative);
  for (const directory of ensureTargetDirectory(root, relative)) sink?.push(directory);
  const temporary = temporaryNameFor(absolute);
  try {
    fs.writeFileSync(temporary, content);
    const real = realPathOf(path.dirname(absolute));
    if (!real.ok || !isInsideDirectory(root, real.real)) {
      throw new PatchError('PATH_UNSAFE', '写入前父目录真实落点发生变化', relative);
    }
    if (expected !== undefined) {
      const current = readTargetBytes(absolute);
      const currentSha256 = current.exists ? sha256Hex(current.bytes) : undefined;
      if (current.exists !== expected.exists
        || (expected.exists && expected.sha256 !== undefined && currentSha256 !== expected.sha256)) {
        throw new PatchError('WRITE_FAILED', '提交前目标与写前期望状态不符，拒绝覆盖并发写入', relative);
      }
    }
    fs.renameSync(temporary, absolute);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // 临时文件清理失败不影响结论：目标未被改动。
    }
    if (error instanceof PatchError) throw error;
    throw new PatchError('WRITE_FAILED', '目标文件写入失败', relative);
  }
}

/**
 * 安全替换既有文件：同样走临时文件 + rename，保证硬链接另一侧字节不被改写。
 *
 * `expectedSha256` 是调用方在分类时观测到的目标当前摘要（恢复场景即 after 守卫）。
 * rename 之前重新核对一次目标当前字节：若目标在“暂存原字节写入 → rename”这个窗口里
 * 被用户改写，绝不覆盖新字节——删除本次临时文件并返回 false，由调用方按
 * preserved + USER_EDITED 处理。不传则该保护不启用。
 */
export function replaceTargetFile(root: string, relative: string, content: Buffer, expectedSha256?: string): boolean {
  const absolute = assertRestorableTarget(root, relative);
  const temporary = temporaryNameFor(absolute);
  try {
    fs.writeFileSync(temporary, content);
    const real = realPathOf(path.dirname(absolute));
    if (!real.ok || !isInsideDirectory(root, real.real)) {
      throw new PatchError('PATH_UNSAFE', '替换前父目录真实落点发生变化', relative);
    }
    if (expectedSha256 !== undefined) {
      const current = readTargetBytes(absolute);
      const currentSha256 = current.exists ? sha256Hex(current.bytes) : undefined;
      if (currentSha256 !== expectedSha256) {
        try {
          fs.rmSync(temporary, { force: true });
        } catch {
          // 临时文件清理失败不影响结论：用户现场字节未被改动。
        }
        return false;
      }
    }
    fs.renameSync(temporary, absolute);
    return true;
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // 临时文件清理失败不影响结论：用户现场字节未被改动。
    }
    if (error instanceof PatchError) throw error;
    throw new PatchError('WRITE_FAILED', '目标文件恢复写入失败', relative);
  }
}

/**
 * 删除 apply 新建的文件（仅删除普通文件本体，不递归、不进入链接）。
 * 传入 `expectedSha256`（分类时观测的 after 摘要）时删除前晚复核：目标在
 * “分类 → 删除”窗口内被并发改写或已消失则不删除，返回 false 由调用方按
 * 用户后续编辑保留；读取 I/O 失败同样失败关闭。不传则保持原尽力删除语义。
 */
export function deleteTargetFile(root: string, relative: string, expectedSha256?: string): boolean {
  const absolute = assertRestorableTarget(root, relative);
  try {
    if (expectedSha256 !== undefined) {
      const current = readTargetBytes(absolute);
      if (!current.exists || sha256Hex(current.bytes) !== expectedSha256) return false;
    }
    fs.rmSync(absolute, { force: true });
    return true;
  } catch (error) {
    if (error instanceof PatchError) throw error;
    throw new PatchError('WRITE_FAILED', '删除 apply 新建文件失败', relative);
  }
}

export type RestoreGroup = 'restored' | 'unchanged' | 'preserved' | 'unresolved';

export type RestoreIssue = { code: 'USER_EDITED' | 'WRITE_FAILED' | 'RECOVERY_REQUIRED'; path: string };

export type RestoreDecision = { group: RestoreGroup; issue?: RestoreIssue };

export type BackupEntryLike = {
  path: string;
  before: { path: string; exists: boolean; sha256?: string };
  after: { path: string; exists: boolean; sha256?: string };
  originalBase64?: string;
};

/** 当前字节相对备份条目的归类：不执行任何写操作，只做判定。 */
export function classifyBackupEntry(
  root: string,
  entry: BackupEntryLike,
): RestoreDecision & { currentSha256?: string } {
  const relative = entry.path;
  let absolute: string;
  try {
    absolute = assertRestorableTarget(root, relative);
  } catch {
    return { group: 'unresolved', issue: { code: 'RECOVERY_REQUIRED', path: relative } };
  }
  let current: TargetBytes;
  try {
    current = readTargetBytes(absolute);
  } catch {
    return { group: 'unresolved', issue: { code: 'RECOVERY_REQUIRED', path: relative } };
  }
  const currentSha256 = current.exists ? sha256Hex(current.bytes) : undefined;

  if (!entry.before.exists) {
    // apply 新建的文件：仍不存在即未写入；命中 after 才能声称恢复；其余按用户后续编辑保留。
    if (!current.exists) return { group: 'unchanged', currentSha256 };
    if (currentSha256 === entry.after.sha256) return { group: 'restored', currentSha256 };
    return { group: 'preserved', issue: { code: 'USER_EDITED', path: relative }, currentSha256 };
  }
  if (!current.exists) {
    // 原本存在、当前缺失：既非 before 也非 after，按用户后续编辑保留，不替用户重建。
    return { group: 'preserved', issue: { code: 'USER_EDITED', path: relative }, currentSha256 };
  }
  if (currentSha256 === entry.before.sha256) return { group: 'unchanged', currentSha256 };
  if (currentSha256 === entry.after.sha256) return { group: 'restored', currentSha256 };
  return { group: 'preserved', issue: { code: 'USER_EDITED', path: relative }, currentSha256 };
}

/** 执行单个候选的恢复动作；返回归类与问题（调用方汇总四组）。 */
export function restoreBackupEntry(root: string, entry: BackupEntryLike): RestoreDecision & { created: string[] } {
  const decision = classifyBackupEntry(root, entry);
  if (decision.group !== 'restored') return { ...decision, created: [] };
  try {
    if (!entry.before.exists) {
      const deleted = deleteTargetFile(root, entry.path, entry.after.sha256);
      if (!deleted) {
        return { group: 'preserved', issue: { code: 'USER_EDITED', path: entry.path }, created: [] };
      }
      return { group: 'restored', created: [] };
    }
    const original = Buffer.from(entry.originalBase64 ?? '', 'base64');
    // 以分类时观测到的 after 摘要作为期望值：恢复窗口内用户改写了目标就保留新字节。
    const replaced = replaceTargetFile(root, entry.path, original, entry.after.exists ? entry.after.sha256 : undefined);
    if (!replaced) {
      return { group: 'preserved', issue: { code: 'USER_EDITED', path: entry.path }, created: [] };
    }
    const after = readTargetBytes(assertRestorableTarget(root, entry.path));
    if (!after.exists || sha256Hex(after.bytes) !== entry.before.sha256) {
      throw new PatchError('WRITE_FAILED', '恢复后的字节与备份原字节不一致', entry.path);
    }
    return { group: 'restored', created: [] };
  } catch (error) {
    if (error instanceof PatchError) {
      return { group: 'unresolved', issue: { code: error.code === 'PATH_UNSAFE' ? 'RECOVERY_REQUIRED' : 'WRITE_FAILED', path: entry.path }, created: [] };
    }
    return { group: 'unresolved', issue: { code: 'WRITE_FAILED', path: entry.path }, created: [] };
  }
}
