import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const owned: string[] = [];
afterEach(async () => { for (const dir of owned.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function file(root: string, name: string, body = 'export {};') {
  const target = join(root, name); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, body);
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'service-staging-test-')); owned.push(root);
  for (const [service, name] of [['api', '@company/platform-api'], ['preview', '@company/preview-gateway']]) {
    await file(root, `${service}/package.json`, JSON.stringify({ name, version: '0.0.5', type: 'module', dependencies: { '@company/contracts': 'workspace:*' } }));
    await file(root, `${service}/dist/server.js`);
    await file(root, `${service}/node_modules/@company/contracts/package.json`, JSON.stringify({ name: '@company/contracts', version: '0.0.0', exports: { '.': './dist/index.js' } }));
    await file(root, `${service}/node_modules/@company/contracts/dist/index.js`);
  }
  await file(root, 'api/dist/releases/runner.js'); await file(root, 'api/dist/db/migrate.js');
  await file(root, 'api/migrations/001_base.sql', 'SELECT 1;');
  return root;
}

it('checks actual staged service files without executing package scripts', async () => {
  const { verifyServiceStaging } = await import('../../scripts/verify-service-staging.js');
  const root = await fixture();
  await file(root, 'api/node_modules/rxjs/ajax/package.json', JSON.stringify({ name: 'rxjs/ajax', main: '../dist/cjs/ajax/index.js' }));
  const result = await verifyServiceStaging(root);
  expect(result.ok).toBe(true); expect(result.errors).toEqual([]);
  expect(result.services.api.packages).toBe(2);
  expect(result.productionAcceptance).toBe(false);
});

it('rejects a missing worker entry, migration directory or contracts runtime', async () => {
  const { verifyServiceStaging } = await import('../../scripts/verify-service-staging.js');
  for (const path of ['api/dist/releases/runner.js', 'api/migrations', 'preview/node_modules/@company/contracts']) {
    const root = await fixture(); await rm(join(root, path), { force: true, recursive: true });
    expect((await verifyServiceStaging(root)).ok).toBe(false);
  }
});

it('rejects client packages, build tools and leaked source or secret files even if unused', async () => {
  const { verifyServiceStaging } = await import('../../scripts/verify-service-staging.js');
  for (const path of ['api/src/server.ts', 'api/.env', 'api/.npmrc', 'api/node_modules/unused/.env']) {
    const root = await fixture(); await file(root, path, 'do-not-log-this-secret');
    const result = await verifyServiceStaging(root);
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('do-not-log-this-secret');
  }
  for (const name of ['@company/charts-core', '@company/component-cli', '@playwright/test', 'typescript', 'vite', '@nestjs/cli']) {
    const root = await fixture(); await file(root, `api/node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0' }));
    expect((await verifyServiceStaging(root)).ok).toBe(false);
  }
});

it('rejects the other runtime service package from a service closure', async () => {
  const { verifyServiceStaging } = await import('../../scripts/verify-service-staging.js');
  const root = await fixture();
  await file(root, 'preview/node_modules/@company/platform-api/package.json', JSON.stringify({ name: '@company/platform-api', version: '0.0.5' }));
  const result = await verifyServiceStaging(root);
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toContain('@company/platform-api');
});

it('rejects dependency links escaping the individual service closure and missing transitive dependencies', async () => {
  const { verifyServiceStaging } = await import('../../scripts/verify-service-staging.js');
  const root = await fixture();
  await symlink(join(root, 'preview/node_modules/@company/contracts'), join(root, 'api/node_modules/external'), process.platform === 'win32' ? 'junction' : 'dir');
  expect((await verifyServiceStaging(root)).ok).toBe(false);
  const other = await fixture();
  await file(other, 'api/node_modules/@company/contracts/package.json', JSON.stringify({ name: '@company/contracts', version: '0.0.0', dependencies: { missing: '1.0.0' } }));
  expect((await verifyServiceStaging(other)).ok).toBe(false);
});

it('rejects a service root linked outside staging', async () => {
  const { verifyServiceStaging } = await import('../../scripts/verify-service-staging.js');
  const root = await fixture(); const outside = await fixture();
  await rm(join(root, 'api'), { recursive: true });
  await symlink(join(outside, 'api'), join(root, 'api'), process.platform === 'win32' ? 'junction' : 'dir');
  expect((await verifyServiceStaging(root)).ok).toBe(false);
});

it('rejects secret aliases to already visited files', async () => {
  const { verifyServiceStaging } = await import('../../scripts/verify-service-staging.js');
  const aliases = await fixture();
  await file(aliases, 'api/node_modules/a-material/data.txt');
  await mkdir(join(aliases, 'api/node_modules/z-unused'));
  await symlink(join(aliases, 'api/node_modules/a-material'), join(aliases, 'api/node_modules/z-unused/.env'), process.platform === 'win32' ? 'junction' : 'dir');
  expect((await verifyServiceStaging(aliases)).errors.join(' ')).toContain('Sensitive material');
});

it('requires nonempty regular SQL migration files', async () => {
  const { verifyServiceStaging } = await import('../../scripts/verify-service-staging.js');
  for (const directory of [false, true]) {
    const root = await fixture();
    await rm(join(root, 'api/migrations/001_base.sql'));
    if (directory) await mkdir(join(root, 'api/migrations/001_base.sql'));
    else await file(root, 'api/migrations/001_base.sql', '');
    expect((await verifyServiceStaging(root)).ok).toBe(false);
  }
});

it('returns structured failure for malformed dependency manifests', async () => {
  const { verifyServiceStaging } = await import('../../scripts/verify-service-staging.js');
  const root = await fixture();
  await file(root, 'api/node_modules/@company/contracts/package.json', JSON.stringify({
    name: '@company/contracts', dependencies: { pg: '1.0.0' }, optionalDependencies: 'invalid',
  }));
  const result = await verifyServiceStaging(root);
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toContain('Invalid package manifest');
});
