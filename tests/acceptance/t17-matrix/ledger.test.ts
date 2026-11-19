import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvidenceRootWriter } from './ledger.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 't17-ledger-'));
  roots.push(root);
  return root;
}
const payload = {
  frozenAt: '2026-11-19T00:00:00.000Z', cliTarballSha256: 'a'.repeat(64), frozenBundleSha256: 'b'.repeat(64),
  frozenCliVersion: '0.0.14', frozenSdkManifestSha256: 'c'.repeat(64), frozenVariantsSha256: 'd'.repeat(64),
  frozenVariants: [], sourceKind: 'temporary/synthetic' as const, runs: [], notes: [],
};

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('T17 证据账本路径隔离', () => {
  it('只允许直接 basename，拒绝越过 files 根的路径', async () => {
    const root = await tempRoot();
    const writer = new EvidenceRootWriter(root, 'run-1');
    await writer.prepare();

    await expect(writer.write('../../escaped.txt', Buffer.from('outside'))).rejects.toThrow(/basename|文件名|路径/);
    await expect(writer.write('nested/evidence.txt', Buffer.from('nested'))).rejects.toThrow(/basename|文件名|路径/);
    await expect(writer.write('safe.txt', Buffer.from('safe'))).resolves.toMatchObject({ name: 'safe.txt' });
  });

  it('拒绝 evidence root 的目录链接别名', async () => {
    const parent = await tempRoot();
    const realRoot = path.join(parent, 'real-root');
    const aliasRoot = path.join(parent, 'alias-root');
    await mkdir(realRoot);
    await symlink(realRoot, aliasRoot, 'junction');

    const writer = new EvidenceRootWriter(aliasRoot, 'run-1');
    await expect(writer.prepare()).rejects.toThrow(/realpath|链接|符号/);
  });

  it('封存时要求 files 目录与登记证据清单完全一致', async () => {
    const root = await tempRoot();
    const writer = new EvidenceRootWriter(root, 'run-1');
    await writer.prepare();
    await writer.write('receipt.json', Buffer.from('{}'));
    await writeFile(path.join(writer.filesRoot, 'unregistered.txt'), 'tampered', { flag: 'wx' });

    await expect(writer.seal(payload)).rejects.toThrow(/清单|目录|额外|一致/);
  });

  it('拒绝封存前已被外部改写的登记证据', async () => {
    const root = await tempRoot();
    const writer = new EvidenceRootWriter(root, 'run-1');
    await writer.prepare();
    await writer.write('receipt.json', Buffer.from('{}'));
    await writeFile(path.join(writer.filesRoot, 'receipt.json'), 'tampered');

    await expect(writer.seal(payload)).rejects.toThrow(/摘要|字节|修改|不一致/);
  });
});
