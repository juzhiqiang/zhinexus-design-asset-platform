import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';
import { verificationAuthorizationFixture, verificationContextFixture, verificationReportFixture, verificationSpecFixture } from '../fixtures/integration-verification.js';
const call = (name: string, value: unknown, context?: unknown) => (contracts as unknown as Record<string, (v: unknown, c?: unknown) => unknown>)[name]?.(value, context);
const spec = (v: unknown, c?: unknown) => call('validateIntegrationVerificationSpec', v, c);
const auth = (v: unknown, c?: unknown) => call('validateIntegrationExecutionAuthorization', v, c);
const report = (v: unknown, c?: unknown) => call('validateIntegrationVerificationReport', v, c);
const rejects = (v: unknown) => expect(v).toMatchObject({ ok: false });

describe('T17 verification specification and execution authorization', () => {
  it('accepts explicit native scripts, loopback browser controls and a fully evidenced report', () => {
    expect(spec(verificationSpecFixture(), verificationContextFixture())).toMatchObject({ ok: true });
    expect(auth(verificationAuthorizationFixture(), verificationContextFixture())).toMatchObject({ ok: true });
    expect(report(verificationReportFixture(), verificationContextFixture())).toMatchObject({ ok: true });
  });
  it.each([
    ['unknown field', (v: any) => { v.token = 'synthetic'; }],
    ['self-declared digest', (v: any) => { v.specDigest = 'a'.repeat(64); }],
    ['root traversal', (v: any) => { v.projectRoot = 'C:/project/../other'; }],
    ['shell command instead of script name', (v: any) => { v.commands[0].script = 'typecheck && curl x'; }],
    ['unsafe manifest', (v: any) => { v.commands[0].manifestPath = '../package.json'; }],
    ['unguarded manifest', (v: any) => { v.commands[0].manifestSha256 = ''; }],
    ['timeout zero', (v: any) => { v.commands[0].timeoutMs = 0; }],
    ['source exclusion', (v: any) => { v.commands[1].outputDirectories = ['src']; }],
    ['root exclusion', (v: any) => { v.commands[1].outputDirectories = ['.']; }],
    ['glob exclusion', (v: any) => { v.commands[1].outputDirectories = ['**/dist']; }],
    ['aliased output directory', (v: any) => { v.commands[1].outputDirectories = ['dist', 'DIST']; }],
    ['remote browser', (v: any) => { v.browser.url = 'https://example.com/demo'; }],
    ['localhost subdomain', (v: any) => { v.browser.url = 'http://localhost.evil/demo'; }],
    ['browser credentials', (v: any) => { v.browser.url = 'http://a:b@127.0.0.1/demo'; }],
    ['browser query', (v: any) => { v.browser.url += '?token=synthetic'; }],
    ['browser fragment', (v: any) => { v.browser.url += '#token'; }],
    ['encoded noncanonical loopback', (v: any) => { v.browser.url = 'http://2130706433/demo'; }],
    ['click payload', (v: any) => { v.browser.actions[0].value = 'x'; }],
    ['fill without value', (v: any) => { v.browser.actions[0].kind = 'fill'; }],
    ['count without integer', (v: any) => { v.browser.assertions[0].kind = 'count'; }],
    ['negative visual ratio', (v: any) => { v.browser.visual.maxDiffPixelRatio = -1; }],
    ['baseline path escape', (v: any) => { v.browser.visual.baseline.image.path = '../secret.png'; }],
    ['invented business gap', (v: any) => { v.businessGaps = ['invent-api']; }],
  ])('rejects specification %s', (_, mutate) => { const v = verificationSpecFixture(); mutate(v); rejects(spec(v)); });
  it.each([
    ['repair scope on verify', (v: any) => { v.allowedRepairPaths = ['src/generated.vue']; }],
    ['repair attempts on verify', (v: any) => { v.maxAttempts = 1; }],
    ['repair report on verify', (v: any) => { v.sourceReportDigest = 'a'.repeat(64); }],
    ['scripts not explicitly authorized', (v: any) => { v.allowProjectScripts = false; }],
    ['browser not explicitly authorized', (v: any) => { v.allowBrowser = false; }],
    ['unrequested script', (v: any) => { v.scriptNames.push('deploy'); }],
    ['wrong spec identity', (v: any) => { v.specDigest = 'a'.repeat(64); }],
  ])('rejects authorization %s', (_, mutate) => { const v = verificationAuthorizationFixture(); mutate(v); rejects(auth(v, verificationContextFixture())); });
  it('accepts absent browser only when no browser execution is authorized', () => {
    const context: any = verificationContextFixture(); delete context.spec.browser;
    const authorization = verificationAuthorizationFixture(); authorization.allowBrowser = false;
    expect(auth(authorization, context)).toMatchObject({ ok: true });
  });
});

describe('T17 verification report consistency', () => {
  it.each([
    ['type success cannot hide click failure', (v: any) => { v.checks[2].status = 'failed'; v.checks[2].issues = [{ code: 'BEHAVIOR_FAILED', message: 'Browser behavior verification failed.' }]; }],
    ['missing category', (v: any) => { v.checks = v.checks.filter((c: any) => c.category !== 'build'); }],
    ['missing dependency guard', (v: any) => { v.checks = v.checks.filter((c: any) => c.id !== 'dependency-guard'); }],
    ['duplicate check identity', (v: any) => { v.checks[1].id = v.checks[0].id; }],
    ['missing installed proof', (v: any) => { v.installedVersions = []; }],
    ['incompatible exact dependency', (v: any) => { v.installedVersions[0].version = '99.0.0'; }],
    ['duplicate dependency', (v: any) => { v.installedVersions.push(v.installedVersions[0]); }],
    ['NEW visual result', (v: any) => { v.visualResult = 'NEW'; }],
    ['missing environment', (v: any) => { delete v.environment; }],
    ['viewport mismatch', (v: any) => { v.environment.width = 800; }],
    ['missing screenshot', (v: any) => { v.checks[4].evidence = []; }],
    ['unknown artifact ref', (v: any) => { v.checks[0].evidence[0] = { ...v.checks[0].evidence[0], sha256: '0'.repeat(64) }; }],
    ['artifact path alias', (v: any) => { v.artifacts.push({ ...v.artifacts[0], path: 'RUN/TYPE.LOG' }); }],
    ['sparse guards', (v: any) => { v.snapshots.after.pop(); }],
    ['inconsistent existence guard', (v: any) => { v.snapshots.before[0].exists = false; }],
    ['hidden source change', (v: any) => { v.snapshots.after[0].sha256 = '0'.repeat(64); }],
    ['pending business information', (v: any) => { v.pendingItems = [{ code: 'MISSING_BUSINESS_INFO', message: 'Required business information is missing.' }]; }],
    ['forged fixed issue message', (v: any) => { v.status = 'failed'; v.pendingItems = [{ code: 'TYPE_FAILED', message: 'secret detail' }]; v.checks[0].status = 'failed'; v.checks[0].issues = v.pendingItems; }],
    ['wrong apply identity', (v: any) => { v.applyResultDigest = '0'.repeat(64); }],
    ['aliased source guards', (v: any) => { v.snapshots.before.push({ ...v.snapshots.before[0], path: 'PACKAGE.JSON' }); }],
    ['pass check with failure issue', (v: any) => { v.checks[0].issues = [{ code: 'TYPE_FAILED', message: 'Project type verification failed.' }]; }],
  ])('rejects %s', (_, mutate) => { const v = verificationReportFixture(); mutate(v); rejects(report(v, verificationContextFixture())); });
  it('accepts honest failed behavior without requiring every category to pass', () => {
    const v: any = verificationReportFixture(); v.status = 'failed'; v.checks[2].status = 'failed';
    v.checks[2].issues = [{ code: 'BEHAVIOR_FAILED', message: 'Browser behavior verification failed.' }]; v.pendingItems = [...v.checks[2].issues];
    expect(report(v, verificationContextFixture())).toMatchObject({ ok: true });
  });
  it('does not reject an existing no-install apply merely because installedVersions is empty there', () => {
    const context: any = verificationContextFixture(); context.applyResult.installState = 'not-run'; context.applyResult.installedVersions = [];
    expect(report(verificationReportFixture(), context)).toMatchObject({ ok: true });
  });
});
