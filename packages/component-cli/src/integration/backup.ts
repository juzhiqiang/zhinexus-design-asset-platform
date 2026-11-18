/**
 * T16 P1 备份存储：不可变版本 + 原子 latest 引用。
 *
 * 职责：把 apply 的原字节证据落到目标工程之外，并按内容寻址保存**不可变**版本；
 * 同一 operation 的“当前可信版本”由 latest 原子指针表达，恢复只接受最新引用。
 *
 * 边界：
 * - 版本文件按序列化字节的 SHA-256 命名并原样落盘，绝不改写或复用旧摘要；
 * - latest 用临时文件 + rename 原子替换，持久化失败即向上抛错（调用方据此不启动安装）；
 * - 读取侧不信任任何自报字段：latest 的结构版本/指针、版本文件字节、JSON 结构、原字节摘要逐层复算；
 * - 过时引用、字节被篡改、损坏 JSON、root/id 错绑一律抛固定脱敏 BACKUP_INVALID。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  validateIntegrationBackup,
  type IntegrationBackupV1,
} from '../contracts/integration-apply.js';
import { sha256Hex } from './patch.js';

export type BackupReference = { id: string; sha256: string };

export type BackupJournal = {
  schemaVersion: 1;
  operationId: string;
  sha256: string;
  updatedAt: string;
};

/** 备份不可信：固定脱敏执行错误，由 CLI 映射为 exit 1，绝不编造合法 rollback 对象。 */
export class BackupError extends Error {
  readonly code = 'BACKUP_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** 备份路径各层级只接受普通目录：junction/链接/不可读一律 BACKUP_INVALID，I/O 失败关闭。 */
function assertPlainDirectory(absolute: string, what: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch {
    throw new BackupError(`${what}不可读`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new BackupError(`${what}不是普通目录`);
  }
}

/** 备份文件只接受 nlink=1 的普通文件：硬链接/链接/不可读一律 BACKUP_INVALID。 */
function assertPlainBackupFile(absolute: string, what: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch {
    throw new BackupError(`${what}不可读`);
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink > 1) {
    throw new BackupError(`${what}不是普通文件或为硬链接`);
  }
}

/** 断言子路径仍落在备份根内（防引用 id 等路径段逃逸）。 */
function assertInsideBackupRoot(backupRoot: string, child: string): void {
  const relative = path.relative(path.resolve(backupRoot), path.resolve(child));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new BackupError('备份路径越出备份根');
  }
}

/** 创建单个目录并在创建后复核形态：已存在（含 junction）时只复核不跟随。 */
function ensurePlainDirectory(absolute: string, what: string): void {
  try {
    fs.mkdirSync(absolute);
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw new BackupError(`${what}不可创建`);
  }
  assertPlainDirectory(absolute, what);
}

/** 一次性独占临时文件名后缀：避免与残留临时文件碰撞后写穿既有 inode。 */
function uniqueSuffix(): string {
  return sha256Hex(Buffer.from(`${process.pid}:${Date.now()}:${Math.random()}`)).slice(0, 12);
}

/** 路径存在性核验：真实 ENOENT 返回 false，其余 I/O 失败一律失败关闭。 */
function pathExistsForBackup(absolute: string): boolean {
  try {
    fs.lstatSync(absolute);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw new BackupError('备份路径不可核验');
    return false;
  }
}

/**
 * 备份路径上层祖先链核验：从给定目录的父目录起逐级 lstat 到卷根，任何一级为
 * 链接（含 junction）、非目录或不可复核都失败关闭。上层父目录为 junction 时，
 * 即使备份根本身是普通目录、内部版本摘要有效，也绝不沿链接读取或写入证据；
 * 绝不 realpath 洗掉链接，I/O 失败同样关闭。
 */
function assertPlainAncestorChain(absolute: string, what: string): void {
  let current = path.dirname(path.resolve(absolute));
  for (;;) {
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      throw new BackupError(`${what}的上层祖先路径不可读`);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new BackupError(`${what}的上层祖先路径不是普通目录`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/**
 * 备份根链的逐级核验与创建：先向上找到最深的**已存在**祖先，对它与其上层逐级
 * lstat 核验普通目录（junction/链接在**任何创建之前**失败关闭——recursive mkdir
 * 会沿 junction 在工程外落盘）；其下缺失的普通子链只在已核验普通父目录下逐级
 * 创建、逐级复核形态，绝不递归穿行。
 */
function ensurePlainDirectoryChain(absolute: string, what: string): void {
  const resolved = path.resolve(absolute);
  const missing: string[] = [];
  let deepest = resolved;
  for (;;) {
    if (pathExistsForBackup(deepest)) break;
    missing.push(deepest);
    const parent = path.dirname(deepest);
    if (parent === deepest) break;
    deepest = parent;
  }
  assertPlainDirectory(deepest, what);
  assertPlainAncestorChain(deepest, what);
  for (const level of missing.reverse()) {
    ensurePlainDirectory(level, what);
  }
}

/**
 * 备份临时文件的清理守卫：清理前先证明整条祖先链仍全部是普通目录、临时文件仍是
 * 本次写入的 nlink=1 普通字节——路径在提交窗口内被替换为指向外部树的链接时绝不
 * 沿其清理（外部 temp 现场原样保留）；不可核验或清理失败都如实保留现场。
 */
function removeOwnedBackupTemporary(absolute: string, bytes: Buffer): void {
  try {
    assertPlainAncestorChain(absolute, '备份临时文件链');
    const stats = fs.lstatSync(absolute);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink > 1) return;
    const onDisk = fs.readFileSync(absolute);
    if (!onDisk.equals(bytes)) return;
    fs.rmSync(absolute, { force: true });
  } catch {
    // 祖先链不可信、临时文件缺失或清理失败：现场如实保留，不影响失败结论。
  }
}

/**
 * 既存不可变版本不得“exists 就信任”：必须是 nlink=1 普通文件且字节实算摘要一致。
 * 不存在时用独占临时文件（wx）+ rename 落盘；rename 前再核验目标未并发出现，
 * 出现则按既存版本核验（一致复用、不一致失败关闭），绝不覆盖。
 */
function ensureImmutableVersion(version: string, sha256: string, bytes: Buffer, directory: string): void {
  if (pathExistsForBackup(version)) {
    assertPlainBackupFile(version, '既存备份版本文件');
    let existing: Buffer;
    try {
      existing = fs.readFileSync(version);
    } catch {
      throw new BackupError('既存备份版本文件不可读');
    }
    if (sha256Hex(existing) !== sha256) {
      throw new BackupError('既存备份版本字节与拟写入摘要不符');
    }
    return;
  }
  const temporary = path.join(directory, `.backup-${sha256}.${uniqueSuffix()}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    if (pathExistsForBackup(version)) {
      removeOwnedBackupTemporary(temporary, bytes);
      ensureImmutableVersion(version, sha256, bytes, directory);
      return;
    }
    // 提交窗口复核：真实 temp 已写入后、rename 前，原始整条祖先链（含备份根之上
    // 每一级）必须仍全部是普通目录——窗口内被替换为 junction 的祖先绝不授权沿其
    // 提交版本；temp 自身必须是 nlink=1 普通文件且字节与本次写入完全一致。
    assertPlainAncestorChain(version, '备份版本链');
    assertPlainBackupFile(temporary, '本次备份版本临时文件');
    const temporaryBytes = fs.readFileSync(temporary);
    if (!temporaryBytes.equals(bytes)) {
      throw new BackupError('本次备份版本临时文件字节与拟写内容不符');
    }
    fs.renameSync(temporary, version);
    // 持久化后读回：版本文件真实字节与拟写内容一致才允许返回成功引用。
    const persisted = fs.readFileSync(version);
    if (!persisted.equals(bytes)) {
      throw new BackupError('备份版本写回与拟写内容不符');
    }
    // 最终真实路径再复核：读回字节一致不代表路径可信——读回窗口内真实路径仍可能
    // 被并发替换（祖先 junction / 多链接）；整条祖先链与文件当前形态全部再核验
    // 通过才算可信持久化，不可信路径的引用过不了冷 loadBackup，不得授权后续提交。
    assertPlainAncestorChain(version, '备份版本链');
    assertPlainBackupFile(version, '已提交的备份版本文件');
  } catch (error) {
    // 路径不可信时绝不沿其清理 temp：清理前同样证明祖先链与本次写入字节所有权。
    removeOwnedBackupTemporary(temporary, bytes);
    throw error instanceof BackupError ? error : new BackupError('备份版本落盘失败');
  }
}

function operationDirectory(backupRoot: string, operationId: string): string {
  return path.join(backupRoot, operationId);
}

function versionDirectory(backupRoot: string, operationId: string): string {
  return path.join(operationDirectory(backupRoot, operationId), 'versions');
}

function versionPath(backupRoot: string, operationId: string, sha256: string): string {
  return path.join(versionDirectory(backupRoot, operationId), `backup-${sha256}.json`);
}

function latestPath(backupRoot: string, operationId: string): string {
  return path.join(operationDirectory(backupRoot, operationId), 'latest.json');
}

/** 生成安全的单段 operationId（契约限制 `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`）。 */
export function createOperationId(prefix: string): string {
  const unique = sha256Hex(Buffer.from(`${prefix}:${process.pid}:${Date.now()}:${Math.random()}`)).slice(0, 24);
  return `${prefix}-${unique}`;
}

export function serializeBackup(document: IntegrationBackupV1): Buffer {
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

/**
 * 落盘一份不可变备份版本，并把 latest 原子指向它。
 * 任一步骤失败都向上抛错：调用方必须在此基础上才允许推进到安装启动。
 */
export function persistBackup(backupRoot: string, document: IntegrationBackupV1): BackupReference {
  const checked = validateIntegrationBackup(document);
  if (!checked.ok) {
    throw new BackupError('备份文档未通过契约校验，拒绝落盘');
  }
  const bytes = serializeBackup(document);
  const sha256 = sha256Hex(bytes);
  const operationId = document.operationId;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(operationId)) {
    throw new BackupError('备份操作身份形态不合法');
  }
  const root = path.resolve(backupRoot);
  // 备份根链逐级核验与创建（先于任何落盘写入）：已存在祖先逐级 lstat 拒绝链接/
  // junction，缺失普通子链只在已核验普通父目录下逐级创建并复核——绝不 recursive
  // mkdir 沿链接在工程外落盘；创建后整链再复核（含全部上层祖先）。
  ensurePlainDirectoryChain(root, '备份根链');
  assertPlainDirectory(root, '备份根');
  assertPlainAncestorChain(root, '备份根链');
  const operation = operationDirectory(root, operationId);
  assertInsideBackupRoot(root, operation);
  ensurePlainDirectory(operation, '备份操作目录');
  const directory = versionDirectory(root, operationId);
  assertInsideBackupRoot(root, directory);
  ensurePlainDirectory(directory, '备份版本目录');
  const version = versionPath(root, operationId, sha256);
  ensureImmutableVersion(version, sha256, bytes, directory);
  const journal: BackupJournal = {
    schemaVersion: 1,
    operationId,
    sha256,
    updatedAt: new Date().toISOString(),
  };
  const journalBytes = Buffer.from(`${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  const target = latestPath(root, operationId);
  const temporary = path.join(operation, `.latest-${sha256}.${uniqueSuffix()}.tmp`);
  try {
    fs.writeFileSync(temporary, journalBytes, { flag: 'wx' });
    // rename 覆盖前核验既存 latest（若有）：硬链接/链接拒绝，绝不穿写另一侧字节。
    if (pathExistsForBackup(target)) {
      assertPlainBackupFile(target, '既存备份最新引用文件');
    }
    // 提交窗口复核：真实 temp 已写入后、rename 前，原始整条祖先链必须仍全部是普通
    // 目录——窗口内被替换为 junction 的祖先绝不授权沿其提交 latest；temp 自身必须
    // 是 nlink=1 普通文件且字节与本次写入完全一致。
    assertPlainAncestorChain(target, '备份最新引用链');
    assertPlainBackupFile(temporary, '本次备份最新引用临时文件');
    const temporaryBytes = fs.readFileSync(temporary);
    if (!temporaryBytes.equals(journalBytes)) {
      throw new BackupError('本次备份最新引用临时文件字节与拟写内容不符');
    }
    fs.renameSync(temporary, target);
    // 持久化后读回：latest 真实字节与拟写内容一致才允许返回成功引用。
    const persisted = fs.readFileSync(target);
    if (!persisted.equals(journalBytes)) {
      throw new BackupError('备份最新引用写回与拟写内容不符');
    }
    // 最终真实路径再复核：读回字节一致不代表路径可信——读回窗口内真实路径仍可能
    // 被并发替换为同字节 junction/多链接；同字节替换不构成可信持久化。整条祖先链
    // 与 latest、version 两个文件的当前形态全部再核验通过才返回成功引用，否则该
    // 引用过不了冷 loadBackup，不得授权任何后续目标源码提交。
    assertPlainAncestorChain(target, '备份最新引用链');
    assertPlainBackupFile(target, '已提交的备份最新引用文件');
    // version 的完整祖先链同样必须核验：仅 lstat version 文件本体不够——读回窗口内
    // versions 目录被换成同字节 junction 时，version 沿链接解析仍是"普通文件且字节
    // 相符"，但冷 loadBackup 的逐级目录核验会拒绝该路径，成功引用因此不可恢复。
    assertPlainAncestorChain(version, '备份版本链');
    assertPlainBackupFile(version, '已提交的备份版本文件');
  } catch (error) {
    // 路径不可信时绝不沿其清理 temp：清理前同样证明祖先链与本次写入字节所有权。
    removeOwnedBackupTemporary(temporary, journalBytes);
    throw error instanceof BackupError ? error : new BackupError('备份最新引用持久化失败');
  }
  return { id: operationId, sha256 };
}

/**
 * 备份根就绪核验（apply 前置调用，替换先 recursive mkdir 的旧路径）：已存在祖先
 * 逐级 lstat 拒绝链接/junction——上层 junction 在任何 mkdir、备份落盘或目标写入
 * 之前失败关闭；缺失普通子链只在已核验普通父目录下逐级创建并复核，完成后备份根
 * 与全部上层祖先都是普通目录。任何失败抛固定脱敏 BackupError。
 */
export function ensureBackupRoot(backupRoot: string): void {
  const root = path.resolve(backupRoot);
  ensurePlainDirectoryChain(root, '备份根链');
  assertPlainDirectory(root, '备份根');
  assertPlainAncestorChain(root, '备份根链');
}

function readJsonFile(absolute: string): unknown {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(absolute);
  } catch {
    throw new BackupError('备份文件不可读');
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new BackupError('备份文件不是合法 JSON');
  }
}

/**
 * 读取**最新**备份并逐层复核：latest 指针 → 版本字节实算摘要 → JSON 结构 →
 * operationId / projectRoot 绑定 → 原字节摘要。任何一层不符都抛 BACKUP_INVALID。
 */
export function loadBackup(backupRoot: string, reference: BackupReference, projectRoot: string): IntegrationBackupV1 {
  const root = path.resolve(backupRoot);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(reference.id) || !/^[0-9a-f]{64}$/.test(reference.sha256)) {
    throw new BackupError('备份引用形态不合法');
  }
  // 从收到的原始 backupRoot 逐级核验到两个文件：junction/链接/硬链接一律 BACKUP_INVALID
  // （即使 JSON 合法、摘要有效），绝不先 realpath 洗掉链接；I/O 失败同样关闭。
  assertPlainDirectory(root, '备份根');
  // 上层祖先链核验：备份根**之上**的任何 junction/链接即使内部目录与版本摘要有效，
  // 也不授权沿链接读取恢复证据——在读备份、恢复写入之前失败关闭。
  assertPlainAncestorChain(root, '备份根链');
  const operation = operationDirectory(root, reference.id);
  assertInsideBackupRoot(root, operation);
  assertPlainDirectory(operation, '备份操作目录');
  const versions = versionDirectory(root, reference.id);
  assertInsideBackupRoot(root, versions);
  assertPlainDirectory(versions, '备份版本目录');
  const latest = latestPath(root, reference.id);
  assertPlainBackupFile(latest, '备份最新引用文件');
  const version = versionPath(root, reference.id, reference.sha256);
  assertPlainBackupFile(version, '备份版本文件');
  const journal = readJsonFile(latest);
  if (journal === null || typeof journal !== 'object' || Array.isArray(journal)) {
    throw new BackupError('备份最新引用不是合法 JSON 对象');
  }
  const record = journal as Record<string, unknown>;
  // latest 的结构版本不受支持时绝不按旧语义解释：固定脱敏 BACKUP_INVALID，目标零写入。
  if (record['schemaVersion'] !== 1) {
    throw new BackupError('备份最新引用的结构版本不受支持');
  }
  if (record['operationId'] !== reference.id || record['sha256'] !== reference.sha256) {
    // 过时引用或伪造摘要：绝不据此洗掉安装副作用，也不覆盖用户文件。
    throw new BackupError('备份引用不是该操作的最新可信版本');
  }
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(version);
  } catch {
    throw new BackupError('备份版本文件不存在');
  }
  if (sha256Hex(bytes) !== reference.sha256) {
    throw new BackupError('备份版本字节与引用摘要不符');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new BackupError('备份版本不是合法 JSON');
  }
  const checked = validateIntegrationBackup(parsed);
  if (!checked.ok) {
    throw new BackupError('备份版本未通过契约校验');
  }
  const document = checked.value;
  if (document.operationId !== reference.id) {
    throw new BackupError('备份版本与引用的操作身份不符');
  }
  if (document.projectRoot !== projectRoot) {
    throw new BackupError('备份绑定的工程根与本次调用不符');
  }
  for (const file of document.files) {
    if (!file.before.exists) continue;
    const original = Buffer.from(file.originalBase64 ?? '', 'base64');
    if (sha256Hex(original) !== file.before.sha256) {
      throw new BackupError('备份记录的原字节与快照摘要不符');
    }
  }
  return document;
}
