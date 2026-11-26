import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { resolveLocalPlatformDatabaseUrl } from '../../scripts/dev-environment.js';

const rootPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('uses local PostgreSQL credentials for development and URL-encodes the password', () => {
  const root = mkdtempSync(join(tmpdir(), 'zhinexus-dev-env-'));
  temporaryDirectories.push(root);
  const credentialsDirectory = join(root, '.tools', 'g2-local');
  mkdirSync(credentialsDirectory, { recursive: true });
  writeFileSync(join(credentialsDirectory, 'credentials.json'), JSON.stringify({ postgresPassword: 'p@ss:/word' }));

  expect(resolveLocalPlatformDatabaseUrl(root, {})).toBe('postgresql://zhinexus:p%40ss%3A%2Fword@127.0.0.1:15432/zhinexus');
});

it('preserves an explicitly supplied URL and never reads local credentials in production', () => {
  const root = mkdtempSync(join(tmpdir(), 'zhinexus-dev-env-'));
  temporaryDirectories.push(root);
  expect(resolveLocalPlatformDatabaseUrl(root, { PLATFORM_DATABASE_URL: 'postgresql://configured' }))
    .toBe('postgresql://configured');
  expect(resolveLocalPlatformDatabaseUrl(root, { NODE_ENV: 'production' })).toBeUndefined();
});

it('routes local development and explicit migration through the environment loader', () => {
  expect(rootPackage.scripts.dev).toBe('tsx scripts/dev.ts');
  expect(rootPackage.scripts['dev:infra-migrate']).toBe('tsx scripts/dev.ts migrate');
});
