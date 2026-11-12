import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { RegistryClient, orderPackages } from '../../apps/api/dist/releases/registry-client.js';
import { createValidBundle } from '../fixtures/t05-artifacts.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const app = createServer(handler); await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { app.closeAllConnections(); app.close(() => resolve()); }));
  return `http://127.0.0.1:${(app.address() as { port: number }).port}`;
}
const sha512 = (bytes: Uint8Array) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

it('recovers a successful publish with a lost response by comparing the actual original tarball', async () => {
  const fixture = await createValidBundle(); const ref = fixture.manifest.packages[0]!;
  const bytes = fixture.files.get(ref.tarball.path)!; let published = false; let writes = 0;
  const origin = await server((req, res) => {
    if (req.method === 'PUT') { writes++; req.resume(); req.on('end', () => { published = true; req.socket.destroy(); }); return; }
    if (!published) { res.writeHead(404).end(); return; }
    if (req.url === '/pkg.tgz') { res.end(bytes); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ name: ref.name, version: ref.version, dependencies: ref.dependencies, dist: { tarball: origin + '/pkg.tgz', integrity: sha512(bytes) } }));
  });
  const client = new RegistryClient({ origin, token: 'local-test-token' });
  expect(await client.ensurePackage(ref, bytes, 'candidate-test')).toMatchObject({ status: 'already-identical' });
  expect(await client.ensurePackage(ref, bytes, 'candidate-test')).toMatchObject({ status: 'already-identical' });
  expect(writes).toBe(1);
});

it('rejects different existing bytes even when dist integrity claims they match', async () => {
  const fixture = await createValidBundle(); const ref = fixture.manifest.packages[0]!;
  const bytes = fixture.files.get(ref.tarball.path)!; let writes = 0;
  const origin = await server((req, res) => {
    if (req.method === 'PUT') writes++;
    if (req.url === '/pkg.tgz') { res.end(Buffer.from('different')); return; }
    res.end(JSON.stringify({ name: ref.name, version: ref.version, dist: { tarball: origin + '/pkg.tgz', integrity: sha512(bytes) } }));
  });
  await expect(new RegistryClient({ origin, token: 'secret' }).ensurePackage(ref, bytes, 'candidate-test')).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(writes).toBe(0);
});

it.each(['external', 'redirect', 'oversized'])('fails closed for %s registry responses without forwarding the credential', async mode => {
  const fixture = await createValidBundle(); const ref = fixture.manifest.packages[0]!;
  let contacted = false;
  const external = await server((_req, res) => { contacted = true; res.end(); });
  const origin = await server((_req, res) => {
    if (mode === 'redirect') { res.writeHead(302, { location: external }).end(); return; }
    if (mode === 'oversized') { res.writeHead(200, { 'content-length': 2_000_000 }).end(); return; }
    res.end(JSON.stringify({ name: ref.name, version: ref.version, dist: { tarball: external + '/pkg.tgz' } }));
  });
  await expect(new RegistryClient({ origin, token: 'secret' }).verifyPackage(ref)).rejects.toMatchObject({ code: 'INFRA_UNAVAILABLE' });
  expect(contacted).toBe(false);
});

it('orders candidate dependencies first and rejects cycles or mismatched candidate versions', async () => {
  const fixture = await createValidBundle(); const first = fixture.manifest.packages[0]!; const second = fixture.manifest.packages[1]!;
  first.dependencies = { [second.name]: second.version }; second.dependencies = {};
  expect(orderPackages([first, second]).map(p => p.name)).toEqual([second.name, first.name]);
  second.dependencies = { [first.name]: first.version };
  expect(() => orderPackages([first, second])).toThrow('ARTIFACT_MISMATCH');
  second.dependencies = {}; first.dependencies[second.name] = '99.0.0';
  expect(() => orderPackages([first, second])).toThrow('ARTIFACT_MISMATCH');
});
