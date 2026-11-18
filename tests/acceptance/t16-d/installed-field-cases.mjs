// tests/acceptance/t16-d/installed-field-cases.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { checkTamper } from './installed-field-tamper.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

export async function checkFieldCases(ctx) {
  let c1;
  await checkTamper(ctx, {
    label: 'original-base64',
    mutate(clone) {
      const e = clone.files.find((f) => f.originalBase64 && f.before?.exists === true && f.before?.sha256 && ctx.s.original.get(f.path)?.length > 0);
      assert.ok(e, '缺少实际原有非空文件的 originalBase64 条目');
      const t = Buffer.from(ctx.s.original.get(e.path));
      t[t.length - 1] ^= 1; // 原 Buffer 仅改一个字节
      const b64 = t.toString('base64'), s = sha(t);
      assert.notStrictEqual(b64, e.originalBase64); assert.notStrictEqual(s, e.before.sha256);
      e.originalBase64 = b64; // 仅改此字段，before.sha256 原样保留
      c1 = { path: e.path, b64, s };
    },
    verify(original, actual) {
      const oe = original.files.find((f) => f.path === c1.path), e = actual.files.find((f) => f.path === c1.path);
      assert.strictEqual(e.originalBase64, c1.b64); assert.notStrictEqual(e.originalBase64, oe.originalBase64);
      const d = sha(Buffer.from(e.originalBase64, 'base64'));
      assert.strictEqual(d, c1.s); assert.notStrictEqual(d, oe.before.sha256);
      e.originalBase64 = oe.originalBase64;
      assert.deepStrictEqual(actual, original);
    },
  });
  const foreignRoot = `${String(ctx.s.area).replace(/\\/g, '/').replace(/\/+$/, '')}/${randomBytes(8).toString('hex')}`;
  mkdirSync(foreignRoot, { recursive: true });
  await checkTamper(ctx, {
    label: 'project-root',
    foreignRoot,
    mutate: (clone) => { clone.projectRoot = foreignRoot; },
    verify: (original, actual) => { assert.strictEqual(actual.projectRoot, foreignRoot); assert.notStrictEqual(actual.projectRoot, original.projectRoot); actual.projectRoot = original.projectRoot; assert.deepStrictEqual(actual, original); },
  });
  const nextId = randomBytes(16).toString('hex'); // 安全单段；helper 保原 id 目录与 latest id，不退化为目录不存在错例
  await checkTamper(ctx, {
    label: 'operation-id',
    mutate: (clone) => { assert.notStrictEqual(nextId, clone.operationId); clone.operationId = nextId; },
    verify: (original, actual) => { assert.strictEqual(actual.operationId, nextId); assert.notStrictEqual(actual.operationId, original.operationId); actual.operationId = original.operationId; assert.deepStrictEqual(actual, original); },
  });
}
