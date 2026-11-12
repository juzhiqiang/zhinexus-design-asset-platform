import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect } from 'vitest';
import { RegistryClient } from '../../apps/api/dist/releases/registry-client.js';
import { createValidBundle, packageBytes, replaceBundleArtifact } from '../fixtures/t05-artifacts.js';
import { platformHarness, grant, upload, release } from './http-support.js';

export async function registryToken(user: 'g2publisher' | 'g2reader' = 'g2publisher'): Promise<string> {
  const secrets = JSON.parse(await readFile(new URL('../../.tools/g2-local/credentials.json', import.meta.url), 'utf8'));
  const password = user === 'g2publisher' ? secrets.publisherPassword : secrets.readerPassword;
  const response = await fetch(`http://127.0.0.1:14873/-/user/org.couchdb.user:${user}`, {
    method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` },
    body: JSON.stringify({ name: user, password, type: 'user', roles: [], date: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error('Local registry authentication failed');
  return (await response.json()).token as string;
}
export async function realRegistry() {
  return new RegistryClient({ origin: 'http://127.0.0.1:14873', token: await registryToken() });
}
/** Unique protocol-test packages: never labeled as real chart/browser evidence. */
export async function workerHarness(configure?: (fixture: Awaited<ReturnType<typeof createValidBundle>>) => void) {
  const fixture = await createValidBundle(); const prefix = `@company/t06-${randomUUID()}`;
  for (const [i, pkg] of fixture.manifest.packages.entries()) {
    const oldName = pkg.name; pkg.name = `${prefix}-${i}`;
    for (const variant of fixture.manifest.variants) if (variant.packageName === oldName) variant.packageName = pkg.name;
    replaceBundleArtifact(fixture, pkg.tarball.path, await packageBytes(fixture, i));
  }
  configure?.(fixture);
  if (configure) for (const [i, pkg] of fixture.manifest.packages.entries()) replaceBundleArtifact(fixture, pkg.tarball.path, await packageBytes(fixture, i));
  const h = await platformHarness();
  await grant(h); const token = await h.token();
  for (const pkg of fixture.manifest.packages) await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice',$1)", [pkg.name]);
  const body = await upload(h, fixture, token);
  const response = await release(h, body, token); expect(response.status).toBe(202);
  const { jobId } = await response.json();
  return { ...h, fixture, jobId: jobId as string, uploadSessionId: body.uploadSessionId, auth: token };
}
