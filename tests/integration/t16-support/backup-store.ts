/**
 * T16 B / P1 产品 RED 辅助：备份存储的独立读取与真实磁盘证据。
 *
 * 依据 docs/plans/2026-11-18-t16-b-install-isolation-brief.md：
 * - 备份摘要/原字节/root/plan/id 不得被信任：本文件只用 Node fs/crypto **独立实算**落盘字节的 SHA-256，
 *   再与产品返回的 `backupRef.sha256` 比对，不用任何自报摘要充当证据；
 * - 字段级破坏与空字节恢复需在真实存储存在后接入；本文件不伪造 latest 或新摘要引用。
 *
 * 本文件不是 Vitest 用例（不匹配 `*.test.ts`），仅被产品测试共用。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'vitest';
import { sha256Hex } from './synthetic-projects.js';

export type BackupFile = { path: string; sha256: string; json: unknown };

export type BackupFileEntry = {
  path: string;
  before: { path: string; exists: boolean; sha256?: string };
  after: { path: string; exists: boolean; sha256?: string };
  originalBase64?: string;
};

export type BackupDocument = {
  schemaVersion: number;
  operationId: string;
  projectRoot: string;
  planDigest: string;
  installPlanned: boolean;
  installStarted: boolean;
  files: BackupFileEntry[];
};

export function isBackupJson(value: unknown): value is BackupDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record['operationId'] === 'string'
    && Array.isArray(record['files'])
    && typeof record['installStarted'] === 'boolean'
    && typeof record['installPlanned'] === 'boolean';
}

/** 独立扫描备份根：跳过链接，只用实算摘要登记每个可解析的备份 JSON。 */
export function readBackupFiles(backupRoot: string): BackupFile[] {
  const files: BackupFile[] = [];
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(absolute);
      } catch {
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(bytes.toString('utf8'));
      } catch {
        continue;
      }
      if (isBackupJson(json)) files.push({ path: absolute, sha256: sha256Hex(bytes), json });
    }
  };
  walk(backupRoot);
  return files;
}

export function backupEntry(document: BackupDocument, relative: string): BackupFileEntry {
  const entry = document.files.find(candidate => candidate.path === relative);
  if (entry === undefined) throw new Error(`T16 辅助：备份中不存在候选 ${relative}`);
  return entry;
}

/** 用实算摘要定位产品真实落盘的备份，并收窄为 BackupDocument（不信任自报字段）。 */
export function storedBackup(backupRoot: string, reference: { id: string; sha256: string }): { path: string; sha256: string; document: BackupDocument } {
  const stored = readBackupFiles(backupRoot).find(backup => backup.sha256 === reference.sha256);
  if (stored === undefined || !isBackupJson(stored.json)) {
    throw new Error(`T16 辅助：backupRef ${reference.id} 的摘要在备份根中不存在或不可解析`);
  }
  return { path: stored.path, sha256: stored.sha256, document: stored.json };
}

/** 可达性控制：证明引用指向真实落盘字节，避免“索引布局不存在”冒充“字段被拒绝”。 */
export function assertReachable(backupRoot: string, reference: { id: string; sha256: string }): BackupDocument {
  const stored = storedBackup(backupRoot, reference);
  expect(stored.document.operationId, '引用必须保持产品自身的 operationId').toBe(reference.id);
  return stored.document;
}
