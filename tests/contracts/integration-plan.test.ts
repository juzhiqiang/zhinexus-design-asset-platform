import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validInspectionFixture, validIntegrationPlanFixture } from '../fixtures/integration-plan.js';

// Namespace lookup lets RED report missing contract behavior rather than an import-resolution error.
const validate = (input: unknown) => (contracts as unknown as Record<string, (x: unknown) => { ok: boolean }>).validateIntegrationPlan?.(input);
const inspect = (input: unknown) => (contracts as unknown as Record<string, (x: unknown) => { ok: boolean }>).validateLocalProjectInspection?.(input);
describe('T15 read-only integration contracts', () => {
  it('loads its ESM module independently without a schema initialization cycle', () => {
    const moduleUrl = new URL('../../packages/contracts/dist/integration-plan.js', import.meta.url).href;
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)})`], { cwd: fileURLToPath(new URL('../..', import.meta.url)), stdio: 'pipe' })).not.toThrow();
  });
  it('accepts independent valid inspection and integration fixtures', () => {
    expect(inspect(validInspectionFixture())).toMatchObject({ ok: true });
    expect(validate(validIntegrationPlanFixture())).toMatchObject({ ok: true });
    const first = validIntegrationPlanFixture(); first.localProject.scripts.push('other');
    expect(validIntegrationPlanFixture().localProject.scripts).toEqual(['build', 'typecheck']);
  });
  it.each([
    ['authorization', (p: any) => { p.executionAuthorized = true; }],
    ['missing guard', (p: any) => { p.baseFileHashes.pop(); }],
    ['fake prior hash', (p: any) => { p.baseFileHashes[2].sha256 = 'a'.repeat(64); }],
    ['missing existing hash', (p: any) => { delete p.baseFileHashes[0].sha256; }],
    ['snapshot changed', (p: any) => { p.baseFileHashes[0].sha256 = 'd'.repeat(64); }],
    ['duplicate path', (p: any) => { p.allowedPaths.push('PACKAGE.JSON'); }],
    ['duplicate dependency', (p: any) => { p.exactDependencies.push(p.exactDependencies[0]); }],
    ['absolute cwd', (p: any) => { p.commands[0].cwd = 'C:/project'; }],
    ['shell string', (p: any) => { p.commands[0] = 'pnpm install && curl attacker'; }],
    ['shell executable', (p: any) => { p.commands[0].executable = 'powershell'; }],
    ['shell args', (p: any) => { p.commands[0].args = ['exec', 'curl', 'attacker']; }],
    ['credential args', (p: any) => { p.commands[0].args.push('--token=secret'); }],
    ['uncovered write', (p: any) => { p.changes[0].path = 'other/package.json'; }],
    ['inconsistent status', (p: any) => { p.status = 'conflicted'; }],
    ['nonblocking conflict', (p: any) => { p.conflicts = [{ code: 'MISSING_PROP', message: 'Missing data', blocking: false }]; }],
    ['missing publication', (p: any) => { p.publicationEvidence = []; }],
    ['missing registry', (p: any) => { p.registryEvidence = []; }],
    ['mismatched digest', (p: any) => { p.registryEvidence[0].sha256 = 'f'.repeat(64); }],
    ['missing authoritative prop', (p: any) => { p.sourceMatchPlan.elements[0].props = []; }],
    ['missing authoritative event', (p: any) => { p.sourceMatchPlan.elements[0].events = []; }],
    ['changed authoritative type', (p: any) => { p.sourceMatchPlan.elements[0].props[0].type = 'string'; }],
    ['changed host query', (p: any) => { p.publicationEvidence[0].response.query.frameworkVersion = '3.5.44'; p.publicationEvidence[0].response.exactDependencies[1].version = '3.5.44'; }],
    ['host context mismatch', (p: any) => { p.sourceMatchPlan.context.frameworkVersion = '3.5.44'; }],
    ['orphan registry evidence', (p: any) => { p.registryEvidence.push({ ...p.registryEvidence[0], name: 'unrelated' }); }],
    ['missing generation intent', (p: any) => { p.changes.pop(); p.allowedPaths.pop(); }],
    ['missing dependency installation intent', (p: any) => { p.changes.splice(0, 2); p.allowedPaths.splice(0, 2); }],
    ['empty manifest dependencies', (p: any) => { p.changes[0].dependencies = []; }],
    ['altered export identity', (p: any) => { p.sourceMatchPlan.elements[0].target = { ...p.sourceMatchPlan.elements[0].target, exportName: 'WrongChart' }; }],
    ['altered API digest', (p: any) => { const t = structuredClone(p.sourceMatchPlan.elements[0].target); t.evidence[0].sha256 = 'a'.repeat(64); p.sourceMatchPlan.elements[0].target = t; }],
  ])('rejects %s', (_name, mutate) => {
    const plan = validIntegrationPlanFixture(); mutate(plan);
    expect(validate(plan)).toMatchObject({ ok: false });
  });
  it.each(['../escape', '/absolute', 'a\\b', 'a//b', 'a/./b', 'a/../b', 'NUL.txt', 'a./b', 'a /b', 'a/*', 'a:stream', 'a\u0000b'])('rejects ambiguous path %s', path => {
    const p = validIntegrationPlanFixture(); p.allowedPaths[2] = path;
    expect(validate(p)).toMatchObject({ ok: false });
  });
  it('accepts Chinese and spaces in explicitly guarded paths', () => {
    const p = validIntegrationPlanFixture(); const path = 'src/业务 组件/component-0001.vue';
    p.allowedPaths[2] = path; p.baseFileHashes[2]!.path = path; p.changes[2]!.path = path;
    expect(validate(p)).toMatchObject({ ok: true });
  });
  it.each(['COMPATIBILITY_UNVERIFIED', 'MISSING_PROP', 'MISSING_EVENT', 'LAYOUT_UNKNOWN'])('keeps %s blocking even when an upstream result has a gap', code => {
    const p: any = validIntegrationPlanFixture();
    p.sourceMatchPlan.elements[0].gaps.push({ code, message: 'Unresolved' });
    expect(validate(p)).toMatchObject({ ok: false });
    p.conflicts.push({ code, instanceId: 'node-1', message: 'Unresolved', blocking: true }); p.status = 'conflicted';
    expect(validate(p)).toMatchObject({ ok: true });
  });
  it('represents incomplete inspections honestly as conflicted', () => {
    const p: any = validInspectionFixture(); delete p.packageManager; delete p.lockfile;
    expect(inspect(p)).toMatchObject({ ok: false });
    p.status = 'conflicted'; p.conflicts.push({ code: 'LOCKFILE_MISSING', message: 'No lockfile', blocking: true });
    expect(inspect(p)).toMatchObject({ ok: true });
  });
  it('rejects a clean Git claim containing dirty files', () => {
    const p = validInspectionFixture(); p.git.dirtyPaths.push('package.json' as never);
    expect(inspect(p)).toMatchObject({ ok: false });
  });
  it('rejects the wrong canonical root lock path', () => {
    const p = validInspectionFixture(); p.lockfile!.path = 'package-lock.json'; p.fileSnapshots[1]!.path = 'package-lock.json';
    expect(inspect(p)).toMatchObject({ ok: false });
  });
  it('requires a pnpm workspace declaration snapshot for an explicit subpackage', () => {
    const p = validInspectionFixture(); p.workspace = 'apps/业务'; p.fileSnapshots.push({ path: 'apps/业务/package.json', exists: true, sha256: 'e'.repeat(64) });
    expect(inspect(p)).toMatchObject({ ok: false });
    p.fileSnapshots.push({ path: 'pnpm-workspace.yaml', exists: true, sha256: 'f'.repeat(64) });
    expect(inspect(p)).toMatchObject({ ok: true });
  });
  it('preserves an API mismatch as an explicit blocking result', () => {
    const p: any = validIntegrationPlanFixture(); p.sourceMatchPlan.elements[0].props = [];
    p.status = 'conflicted'; p.conflicts.push({ code: 'API_MISMATCH', instanceId: 'node-1', message: 'Required property removed', blocking: true });
    expect(validate(p)).toMatchObject({ ok: true });
  });
});
