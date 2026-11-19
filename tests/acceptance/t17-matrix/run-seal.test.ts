import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadT17MatrixInput } from './score.js';

const roots: string[] = [];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
};

async function makeEvidenceRoot() {
  const root = await mkdtemp(join(tmpdir(), 't17-matrix-seal-'));
  roots.push(root);
  const filesRoot = join(root, 'files');
  await mkdir(filesRoot);
  const report = Buffer.from('{"outcome":"refused"}\n');
  const receipt = {
    caseId: 'refuse-unsupported-target',
    receiptEvidencePath: 'refusal-receipt.json',
    expectedOutcome: 'refuse',
    actualOutcome: 'refused',
    beforeProjectSha256: '5'.repeat(64),
    afterProjectSha256: '5'.repeat(64),
    reportPath: 'refusal-report.json',
    reportSha256: sha(report),
    outOfScopeWrites: 0,
  };
  const receiptBytes = Buffer.from(canonical(receipt));
  const evidence = [
    { name: 'refusal-receipt.json', bytes: receiptBytes },
    { name: 'refusal-report.json', bytes: report },
  ];
  const files = [];
  for (const item of evidence) {
    await writeFile(join(filesRoot, item.name), item.bytes, { flag: 'wx' });
    files.push({ name: item.name, sha256: sha(item.bytes), bytes: item.bytes.length });
  }
  await writeFile(join(root, 'run-seal.json'), JSON.stringify({
    schemaVersion: 1,
    runId: 'run-1',
    evidenceRoot: root,
    payload: { cliTarballSha256: 'a'.repeat(64), frozenBundleSha256: 'b'.repeat(64), receipts: [{ caseId: receipt.caseId, kind: 'refusal', evidencePath: receipt.receiptEvidencePath }] },
    files,
  }), { flag: 'wx' });
  return { root, filesRoot, reportPath: join(filesRoot, 'refusal-report.json') };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('T17 run-seal evidence loader', () => {
  it('recomputes each sealed file digest and maps canonical receipts from the evidence directory', async () => {
    const run = await makeEvidenceRoot();
    const input = await loadT17MatrixInput(run.root, 'a'.repeat(64), 'b'.repeat(64));

    expect(input.refusalReceipts).toHaveLength(1);
    expect(input.refusalReceipts[0]).toMatchObject({ caseId: 'refuse-unsupported-target', receiptEvidencePath: 'refusal-receipt.json' });
    expect(input.sealedFiles).toHaveLength(2);
    expect(input.sealPayload).toEqual({ cliTarballSha256: 'a'.repeat(64), frozenBundleSha256: 'b'.repeat(64) });
  });

  it('rejects evidence modified after the run seal was written', async () => {
    const run = await makeEvidenceRoot();
    await writeFile(run.reportPath, 'tampered');

    await expect(loadT17MatrixInput(run.root, 'a'.repeat(64), 'b'.repeat(64))).rejects.toThrow(/digest|bytes|seal/i);
  });
});
