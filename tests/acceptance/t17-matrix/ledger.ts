/**
 * T17 矩阵证据账本与 run-seal 封装。
 *
 * 与 score.ts 的 run-seal 载入器严格对应：
 * - `run-seal.json`：schemaVersion 1；runId；evidenceRoot（真实目录）；payload；files；
 * - 每个证据文件必须位于 evidenceRoot/files/ 的直接子级、普通文件、nlink==1；
 * - receipt 文件字节必须与 canonicalJson(receipt) 完全一致（loader 会重算）。
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './support.js';

export type LedgerEntry = {
  name: string;
  sha256: string;
  bytes: number;
};

export type SealPayload = {
  schemaVersion: 1;
  runId: string;
  frozenAt: string;
  cliTarballSha256: string;
  frozenBundleSha256: string;
  frozenCliVersion: string;
  frozenSdkManifestSha256: string;
  frozenVariantsSha256: string;
  frozenVariants: { componentId: string; framework: 'vue' | 'react'; variantReleaseId: string }[];
  sourceKind: 'temporary/synthetic';
  runs: {
    caseId: string;
    kind: 'positive' | 'refusal';
    receiptPath: string;
    projectRootDigest: string;
    projectRootRegistered: boolean;
    commands: { kind: 'typecheck' | 'build'; exitCode: number; evidencePath: string; sha256: string; stdoutEvidencePath: string; stdoutSha256: string; stderrEvidencePath: string; stderrSha256: string }[];
    receipts: Omit<LedgerEntry, 'bytes'>[] | [];
    status: 'pass' | 'failed' | 'blocked' | 'refused' | 'guarded' | 'detected' | 'skipped';
  }[];
  notes: string[];
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export class EvidenceRootWriter {
  private readonly entries: LedgerEntry[] = [];
  private readonly names = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly runId: string,
  ) {}

  get filesRoot(): string {
    return path.join(this.root, 'files');
  }

  async prepare(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const rootStat = await lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(this.root) !== path.resolve(this.root)) throw new Error('evidence root 必须是未链接的普通目录');
    await mkdir(this.filesRoot, { recursive: true });
    const filesStat = await lstat(this.filesRoot);
    if (!filesStat.isDirectory() || filesStat.isSymbolicLink() || await realpath(this.filesRoot) !== path.resolve(this.filesRoot)) throw new Error('files 根目录必须是未链接的普通目录');
  }

  /** 写入证据字节并登记条目；同名文件不得覆盖（防止运行中改写旧证据）。 */
  async write(name: string, bytes: Uint8Array): Promise<LedgerEntry> {
    const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.endsWith('.') &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
    if (!safeName || path.basename(name) !== name) throw new Error('证据文件名必须是无别名的直接 basename');
    if (this.names.has(name)) throw new Error('证据文件名重复: ' + name);
    const entry = { name, sha256: sha256(bytes), bytes: bytes.byteLength };
    if (entry.bytes === 0) throw new Error('证据不能为空: ' + name);
    await writeFile(path.join(this.filesRoot, name), bytes, { flag: 'wx' });
    this.entries.push(entry);
    this.names.add(name);
    return entry;
  }

  async writeJson(name: string, value: unknown): Promise<LedgerEntry> {
    return await this.write(name, Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'));
  }

  /** 把 receipt 写为 canonicalJson 字节（必须与 score.ts 的重算一致）。 */
  async writeReceipt(name: string, receipt: Record<string, unknown>): Promise<LedgerEntry> {
    const value = { ...receipt, receiptEvidencePath: name };
    return await this.write(name, Buffer.from(canonicalJson(value), 'utf8'));
  }

  list(): readonly LedgerEntry[] {
    return this.entries;
  }

  async seal(payload: Omit<SealPayload, 'schemaVersion' | 'runId'>): Promise<string> {
    const rootStat = await lstat(this.root);
    const filesStat = await lstat(this.filesRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(this.root) !== path.resolve(this.root) ||
        !filesStat.isDirectory() || filesStat.isSymbolicLink() || await realpath(this.filesRoot) !== path.resolve(this.filesRoot)) {
      throw new Error('封存目录身份或真实路径发生变化');
    }
    const diskNames = await readdir(this.filesRoot);
    if (diskNames.some((name) => !this.names.has(name)) || diskNames.length !== this.entries.length) throw new Error('证据目录与登记清单不一致');
    for (const entry of this.entries) {
      const target = path.join(this.filesRoot, entry.name);
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || await realpath(target) !== target) throw new Error('证据必须是未链接的唯一普通文件: ' + entry.name);
      const bytes = await readFile(target);
      if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error('证据摘要或字节数不一致: ' + entry.name);
    }
    const seal: { schemaVersion: 1; runId: string; evidenceRoot: string; payload: SealPayload; files: LedgerEntry[] } = {
      schemaVersion: 1,
      runId: this.runId,
      evidenceRoot: path.resolve(this.root),
      payload: { schemaVersion: 1, runId: this.runId, ...payload },
      files: this.entries,
    };
    const sealPath = path.join(this.root, 'run-seal.json');
    await writeFile(sealPath, JSON.stringify(seal, null, 2) + '\n', { flag: 'wx' });
    await this.verifySealWrite();
    return sealPath;
  }

  /** 封存后立即复核 seal 自身是普通文件且 files 清单与目录一致。 */
  private async verifySealWrite(): Promise<void> {
    const stat = await lstat(path.join(this.root, 'run-seal.json'));
    if (!stat.isFile()) throw new Error('run-seal.json 必须是普通文件');
    const names = this.entries.map((entry) => entry.name).sort();
    if (new Set(names).size !== names.length) throw new Error('run-seal 文件清单重复');
  }
}
