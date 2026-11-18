import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';
import { applyAuthorizationFixture, applyBackupFixture, applyResultFixture, rollbackResultFixture, authorizationContextFixture } from '../fixtures/integration-apply.js';

// Optional namespace lookup gives RED assertion failures, not missing-export collection errors.
const call = (name: string, input: unknown, context?: unknown) =>
  (contracts as unknown as Record<string, (v: unknown, c?: unknown) => { ok: boolean; issues?: unknown[] }>)[name]?.(input, context);
const auth = (v: unknown, c?: unknown) => call('validateIntegrationApplyAuthorization', v, c);
const backup = (v: unknown, c?: unknown) => call('validateIntegrationBackup', v, c);
const result = (v: unknown, c?: unknown) => call('validateIntegrationApplyResult', v, c);
const rollback = (v: unknown, c?: unknown) => call('validateIntegrationRollbackResult', v, c);
const reject = (checked: unknown) => expect(checked).toMatchObject({ ok: false });

describe('T16 apply authorization and recovery contracts', () => {
  it('accepts four independent legal fixtures and full cross-reference contexts', () => {
    expect(auth(applyAuthorizationFixture(), authorizationContextFixture())).toMatchObject({ ok: true });
    expect(backup(applyBackupFixture(), authorizationContextFixture())).toMatchObject({ ok: true });
    expect(result(applyResultFixture(), authorizationContextFixture())).toMatchObject({ ok: true });
    expect(rollback(rollbackResultFixture(), applyBackupFixture())).toMatchObject({ ok: true });
  });
  it('keeps T15 plans non-authorizing and rejects a plan as an apply authorization', () => {
    const context = authorizationContextFixture();
    expect(contracts.validateIntegrationPlan(context.plan)).toMatchObject({ ok: true });
    expect(context.plan.executionAuthorized).toBe(false);
    reject(auth(context.plan));
  });
  it.each([
    ['missing authorization operation', (p: any) => { delete p.operation; }],
    ['other operation', (p: any) => { p.operation = 'plan'; }],
    ['relative root', (p: any) => { p.projectRoot = '../project'; }],
    ['root traversal', (p: any) => { p.projectRoot = 'C:/project/../outside'; }],
    ['root alias', (p: any) => { p.projectRoot = 'C:/project./client'; }],
    ['duplicate path', (p: any) => { p.allowedPaths.push('PACKAGE.JSON'); }],
    ['unicode alias', (p: any) => { p.allowedPaths.push('src/é.vue', 'src/e\u0301.vue'); }],
    ['parent file path', (p: any) => { p.allowedPaths.push('src'); }],
    ['outside path', (p: any) => { p.allowedPaths[0] = '../package.json'; }],
    ['credential field', (p: any) => { p.token = 'secret'; }],
    ['invalid hash', (p: any) => { p.planDigest = 'x'.repeat(64); }],
  ])('rejects authorization %s', (_, mutate) => { const p = applyAuthorizationFixture(); mutate(p); reject(auth(p)); });
  it.each([
    ['wrong root', (p: any) => { p.projectRoot = 'D:/other-project'; }],
    ['wrong digest', (p: any) => { p.planDigest = 'a'.repeat(64); }],
    ['missing path', (p: any) => { p.allowedPaths.pop(); }],
    ['extra path', (p: any) => { p.allowedPaths.push('src/other.vue'); }],
    ['case mismatch', (p: any) => { p.allowedPaths[0] = 'Package.json'; }],
    ['install denied', (p: any) => { p.allowInstall = false; }],
  ])('binds authorization to expected plan: %s', (_, mutate) => { const p = applyAuthorizationFixture(); mutate(p); reject(auth(p, authorizationContextFixture())); });
  it('rejects conflicted context even with otherwise matching authorization', () => {
    const context = authorizationContextFixture(); context.plan.status = 'conflicted';
    context.plan.conflicts.push({ code: 'API_MISMATCH', message: 'Changed', blocking: true });
    reject(auth(applyAuthorizationFixture(), context));
  });
  it('allows an empty prior file and a new file without fake original bytes', () => {
    const p = applyBackupFixture(); p.files[0]!.originalBase64 = '';
    expect(backup(p)).toMatchObject({ ok: true });
    expect(p.files[2]!.before.exists).toBe(false);
    expect(p.files[2]!.originalBase64).toBeUndefined();
  });
  it.each([
    ['old bytes missing', (p: any) => { delete p.files[0].originalBase64; }],
    ['new bytes fabricated', (p: any) => { p.files[2].originalBase64 = ''; }],
    ['base64 malformed', (p: any) => { p.files[0].originalBase64 = '@@'; }],
    ['base64 noncanonical pad bits', (p: any) => { p.files[0].originalBase64 = 'Zh=='; }],
    ['base64 whitespace', (p: any) => { p.files[0].originalBase64 = 'Zg==\n'; }],
    ['before path mismatch', (p: any) => { p.files[0].before.path = 'other.json'; }],
    ['after path mismatch', (p: any) => { p.files[0].after.path = 'other.json'; }],
    ['old hash missing', (p: any) => { delete p.files[0].before.sha256; }],
    ['new fake hash', (p: any) => { p.files[2].before.sha256 = 'a'.repeat(64); }],
    ['after missing', (p: any) => { p.files[0].after = { path: p.files[0].path, exists: false }; }],
    ['duplicate path', (p: any) => { p.files.push({ ...p.files[0], path: 'PACKAGE.JSON' }); }],
    ['operation traversal', (p: any) => { p.operationId = '../backup'; }],
  ])('rejects backup %s', (_, mutate) => { const p = applyBackupFixture(); mutate(p); reject(backup(p)); });
  it.each([
    ['wrong base hash', (p: any) => { p.files[0].before.sha256 = 'c'.repeat(64); }],
    ['missing file', (p: any) => { p.files.pop(); }],
    ['wrong project', (p: any) => { p.projectRoot = 'D:/other'; }],
    ['wrong plan', (p: any) => { p.planDigest = 'c'.repeat(64); }],
    ['install intent hidden', (p: any) => { p.installPlanned = false; }],
    ['install start without intent', (p: any) => { p.installPlanned = false; p.installStarted = true; }],
  ])('binds backup to expected plan: %s', (_, mutate) => { const p = applyBackupFixture(); mutate(p); reject(backup(p, authorizationContextFixture())); });
  it.each([
    ['missing before guard', (p: any) => { p.beforeHashes.pop(); }],
    ['missing after guard', (p: any) => { p.afterHashes.pop(); }],
    ['extra guard', (p: any) => { p.afterHashes.push({ path: 'other.json', exists: true, sha256: 'a'.repeat(64) }); }],
    ['duplicate file', (p: any) => { p.changedFiles.push(p.changedFiles[0]); }],
    ['applied with issue', (p: any) => { p.issues = [{ code: 'API_MISMATCH', message: 'The verified component API no longer matches the plan.' }]; }],
    ['applied no file', (p: any) => { p.changedFiles = []; p.beforeHashes = []; p.afterHashes = []; }],
    ['applied install failure', (p: any) => { p.installState = 'failed'; }],
    ['missing backup ref', (p: any) => { delete p.backupRef; }],
    ['backup id mismatch', (p: any) => { p.backupRef.id = 'different-id'; }],
    ['unknown issue code', (p: any) => { p.status = 'blocked'; p.issues = [{ code: 'OK', message: 'ok' }]; }],
    ['duplicate installed version', (p: any) => { p.installedVersions.push(p.installedVersions[0]); }],
    ['unproven installed range', (p: any) => { p.installedVersions[0].version = '^0.0.12'; }],
    ['after false', (p: any) => { p.afterHashes[0] = { path: p.changedFiles[0], exists: false }; }],
  ])('rejects apply result %s', (_, mutate) => { const p = applyResultFixture(); mutate(p); reject(result(p)); });
  it('accepts a pre-write blocked result without backup or invented versions', () => {
    const p: any = applyResultFixture(); p.status = 'blocked'; p.changedFiles = []; p.beforeHashes = []; p.afterHashes = [];
    p.installedVersions = []; p.installState = 'not-run'; delete p.backupRef;
    p.issues = [{ code: 'PROJECT_CHANGED', message: 'Project state changed after planning.' }];
    expect(result(p)).toMatchObject({ ok: true });
  });
  it.each([
    ['post-write issue', (p: any) => {
      p.status = 'blocked'; p.changedFiles = []; p.beforeHashes = []; p.afterHashes = []; p.installedVersions = [];
      p.installState = 'not-run'; delete p.backupRef;
      p.issues = [{ code: 'WRITE_FAILED', message: 'A planned file write failed.' }];
    }],
    ['backup reference', (p: any) => {
      p.status = 'blocked'; p.changedFiles = []; p.beforeHashes = []; p.afterHashes = []; p.installedVersions = [];
      p.installState = 'not-run'; p.issues = [{ code: 'PROJECT_CHANGED', message: 'Project state changed after planning.' }];
    }],
  ])('rejects blocked results carrying fabricated %s evidence', (_, mutate) => {
    const p: any = applyResultFixture(); mutate(p); reject(result(p));
  });
  it('represents a first write failure after backup without inventing committed files', () => {
    const p: any = applyResultFixture(); p.status = 'rolled-back'; p.changedFiles = []; p.beforeHashes = []; p.afterHashes = [];
    p.installedVersions = []; p.installState = 'not-run';
    p.issues = [{ code: 'WRITE_FAILED', message: 'A planned file write failed.' }];
    expect(result(p)).toMatchObject({ ok: true });
  });
  it('rejects recovery-required without write or installation side-effect evidence', () => {
    const p: any = applyResultFixture(); p.status = 'recovery-required'; p.changedFiles = []; p.beforeHashes = []; p.afterHashes = [];
    p.installedVersions = []; p.installState = 'not-run';
    p.issues = [{ code: 'RECOVERY_REQUIRED', message: 'Manual recovery is required.' }];
    reject(result(p));
  });
  it('rejects arbitrary or sensitive issue messages', () => {
    const p: any = applyResultFixture(); p.status = 'blocked'; p.changedFiles = []; p.beforeHashes = []; p.afterHashes = [];
    p.installedVersions = []; p.installState = 'not-run'; delete p.backupRef;
    p.issues = [{ code: 'PROJECT_CHANGED', message: 'token=secret subprocess stderr https://registry.invalid/private' }];
    reject(result(p));
  });
  it('rejects a sanitized message assigned to the wrong issue code', () => {
    const p: any = applyResultFixture(); p.status = 'blocked'; p.changedFiles = []; p.beforeHashes = []; p.afterHashes = [];
    p.installedVersions = []; p.installState = 'not-run'; delete p.backupRef;
    p.issues = [{ code: 'PROJECT_CHANGED', message: 'A target path is unsafe.' }];
    reject(result(p));
  });
  it('requires post-write failures to retain backup and unresolved status', () => {
    const p: any = applyResultFixture(); p.status = 'recovery-required'; p.installState = 'reinstall-required'; p.installedVersions = [];
    p.issues = [{ code: 'USER_EDITED', path: p.changedFiles[0], message: 'A user-edited file was preserved.' }];
    expect(result(p)).toMatchObject({ ok: true }); p.status = 'blocked'; reject(result(p));
  });
  it.each([
    ['wrong version', (p: any) => { p.installedVersions[0].version = '9.0.0'; }],
    ['missing installed version', (p: any) => { p.installedVersions.pop(); }],
    ['extra installed version', (p: any) => { p.installedVersions.push({ name: 'unrelated', version: '1.0.0' }); }],
    ['changed target hash', (p: any) => { p.beforeHashes[0].sha256 = 'e'.repeat(64); }],
    ['applied subset', (p: any) => { p.changedFiles.pop(); p.beforeHashes.pop(); p.afterHashes.pop(); }],
  ])('cross-checks applied result: %s', (_, mutate) => { const p = applyResultFixture(); mutate(p); reject(result(p, authorizationContextFixture())); });
  it.each([
    ['duplicate restored path', (p: any) => { p.restoredPaths.push(p.restoredPaths[0]); }],
    ['overlap', (p: any) => { p.preservedPaths.push(p.restoredPaths[0]); }],
    ['unchanged overlap', (p: any) => { p.unchangedPaths.push(p.restoredPaths[0]); }],
    ['success but preserved', (p: any) => { p.preservedPaths.push(p.restoredPaths.pop()); }],
    ['success but issue', (p: any) => { p.issues = [{ code: 'USER_EDITED', message: 'A user-edited file was preserved.' }]; }],
    ['missing coverage', (p: any) => { p.restoredPaths.pop(); }],
    ['extra coverage', (p: any) => { p.restoredPaths.push('other.txt'); }],
    ['wrong project', (p: any) => { p.projectRoot = 'D:/other'; }],
    ['wrong plan', (p: any) => { p.planDigest = 'c'.repeat(64); }],
    ['wrong operation', (p: any) => { p.operationId = 'another-id'; }],
    ['installation hidden', (p: any) => { p.installState = 'not-run'; }],
  ])('rejects rollback %s', (_, mutate) => { const p = rollbackResultFixture(); mutate(p); reject(rollback(p, applyBackupFixture())); });
  it('accounts for backup candidates that were never written without claiming a restoration', () => {
    const p: any = rollbackResultFixture(); p.unchangedPaths.push(p.restoredPaths.pop());
    expect(rollback(p, applyBackupFixture())).toMatchObject({ ok: true });
  });
  it('separately accounts for a rollback write failure without mislabeling it as a user edit', () => {
    const p: any = rollbackResultFixture(); p.status = 'recovery-required'; p.unresolvedPaths = [p.restoredPaths.pop()];
    p.issues = [
      { code: 'WRITE_FAILED', path: p.unresolvedPaths[0], message: 'A planned file write failed.' },
      { code: 'RECOVERY_REQUIRED', path: p.unresolvedPaths[0], message: 'Manual recovery is required.' },
    ];
    expect(rollback(p, applyBackupFixture())).toMatchObject({ ok: true });
  });
  it.each(['WRITE_FAILED', 'RECOVERY_REQUIRED'])('rejects pathless %s instead of hiding it behind a preserved user edit', (code) => {
    const p: any = rollbackResultFixture(); p.status = 'recovery-required'; p.preservedPaths.push(p.restoredPaths.pop());
    p.issues = [
      { code: 'USER_EDITED', path: p.preservedPaths[0], message: 'A user-edited file was preserved.' },
      { code, message: code === 'WRITE_FAILED' ? 'A planned file write failed.' : 'Manual recovery is required.' },
    ];
    reject(rollback(p, applyBackupFixture()));
  });
  it('requires reinstall only when installation actually started, not merely when it was planned', () => {
    const b: any = applyBackupFixture(); b.installStarted = false;
    const p: any = rollbackResultFixture(); p.installState = 'not-run';
    expect(rollback(p, b)).toMatchObject({ ok: true });
    p.installState = 'reinstall-required'; reject(rollback(p, b));
  });
  it('retains user-edited files as unresolved and names the exact preserved path', () => {
    const p: any = rollbackResultFixture(); p.status = 'recovery-required'; p.preservedPaths.push(p.restoredPaths.pop());
    p.issues = [{ code: 'USER_EDITED', path: p.preservedPaths[0], message: 'A user-edited file was preserved.' }];
    expect(rollback(p, applyBackupFixture())).toMatchObject({ ok: true });
    p.issues = []; reject(rollback(p, applyBackupFixture()));
  });
  it('requires every preserved path to have a matching USER_EDITED issue', () => {
    const p: any = rollbackResultFixture(); p.status = 'recovery-required'; p.preservedPaths.push(p.restoredPaths.pop());
    p.issues = [{ code: 'WRITE_FAILED', path: p.preservedPaths[0], message: 'A planned file write failed.' }];
    reject(rollback(p, applyBackupFixture()));
  });
  it('rejects USER_EDITED issues outside the preserved path set', () => {
    const p: any = rollbackResultFixture(); p.status = 'recovery-required'; p.preservedPaths.push(p.restoredPaths.pop());
    p.issues = [
      { code: 'USER_EDITED', path: p.preservedPaths[0], message: 'A user-edited file was preserved.' },
      { code: 'USER_EDITED', path: p.restoredPaths[0], message: 'A user-edited file was preserved.' },
    ];
    reject(rollback(p, applyBackupFixture()));
  });
  it('returns validation issues instead of throwing for a malformed backup context', () => {
    const p = rollbackResultFixture();
    expect(() => rollback(p, {})).not.toThrow();
    reject(rollback(p, {}));
  });
});
