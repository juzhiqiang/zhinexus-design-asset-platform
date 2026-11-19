import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';
import { repairAuthorizationFixture, repairContextFixture, repairResultFixture } from '../fixtures/integration-repair.js';
const call = (name: string, v: unknown, c?: unknown) => (contracts as unknown as Record<string, (v: unknown, c?: unknown) => unknown>)[name]?.(v, c);
const auth = (v: unknown, c?: unknown) => call('validateIntegrationExecutionAuthorization', v, c);
const result = (v: unknown, c?: unknown) => call('validateIntegrationRepairResult', v, c);
const rejects = (v: unknown) => expect(v).toMatchObject({ ok: false });
describe('T17 bounded repair contracts', () => {
  it('accepts explicit generated-file repair authorization and one backed-up verified attempt', () => {
    expect(auth(repairAuthorizationFixture(), repairContextFixture())).toMatchObject({ ok: true });
    expect(result(repairResultFixture(), repairContextFixture())).toMatchObject({ ok: true });
  });
  it.each([
    ['missing report binding', (v: any) => { delete v.sourceReportDigest; }],
    ['wrong report binding', (v: any) => { v.sourceReportDigest = '0'.repeat(64); }],
    ['non-generated manifest repair', (v: any) => { v.allowedRepairPaths = ['package.json']; }],
    ['unplanned path', (v: any) => { v.allowedRepairPaths = ['src/unowned.vue']; }],
    ['aliased scope', (v: any) => { v.allowedRepairPaths.push(v.allowedRepairPaths[0].toUpperCase()); }],
    ['more than two attempts', (v: any) => { v.maxAttempts = 3; }],
  ])('rejects authorization %s', (_, mutate) => { const v = repairAuthorizationFixture(); mutate(v); rejects(auth(v, repairContextFixture())); });
  it.each([
    ['three attempts', (v: any) => { v.maxAttempts = 3; }],
    ['attempt beyond authorized budget', (v: any) => { v.maxAttempts = 0; }],
    ['zero attempt repaired', (v: any) => { v.attempts = []; v.changedFiles = []; }],
    ['non-sequential attempt', (v: any) => { v.attempts[0].attempt = 2; }],
    ['source report mismatch', (v: any) => { v.attempts[0].beforeReportDigest = '0'.repeat(64); }],
    ['missing before guard', (v: any) => { v.attempts[0].beforeHashes = []; }],
    ['missing backup digest', (v: any) => { delete v.attempts[0].backupRef.sha256; }],
    ['undeclared overall change', (v: any) => { v.changedFiles = []; }],
    ['manifest write', (v: any) => { for (const f of ['beforeHashes', 'afterHashes']) v.attempts[0][f][0].path = 'package.json'; v.attempts[0].changedFiles = v.changedFiles = ['package.json']; }],
    ['aliased writes', (v: any) => { v.changedFiles.push(v.changedFiles[0].toUpperCase()); }],
    ['wrong final report spec', (v: any) => { v.finalReport.specDigest = '0'.repeat(64); }],
    ['false repaired status', (v: any) => { v.finalReport.status = 'failed'; }],
    ['wrong successful stop reason', (v: any) => { v.stopReason = 'max-attempts-reached'; }],
    ['pending repaired work', (v: any) => { v.pendingItems = [{ code: 'USER_EDITED', message: 'A user-edited file was preserved.' }]; }],
    ['unknown report field', (v: any) => { v.finalReport.credentials = {}; }],
  ])('rejects repair %s', (_, mutate) => { const v = repairResultFixture(); mutate(v); rejects(result(v, repairContextFixture())); });
  it('accepts a zero-budget stop that preserves a failed report', () => {
    const v: any = repairResultFixture(); v.maxAttempts = 0; v.attempts = []; v.changedFiles = []; v.status = 'stopped'; v.stopReason = 'max-attempts-reached';
    v.finalReport = repairContextFixture().sourceReport; v.pendingItems = [...v.finalReport.pendingItems];
    expect(result(v, repairContextFixture())).toMatchObject({ ok: true });
  });
});
