import { createHash } from 'node:crypto';
import { UPLOAD_LIMITS, type PackageRef } from '@company/contracts';
import { PlatformError } from '../errors.js';
import { parseNpmArchive } from '../uploads/artifact-parser.js';

export type RegistryConfig = { origin: string; token: string };
export type PackageIdentity = Pick<PackageRef, 'name' | 'version'>;
type Metadata = { name: string; version: string; dependencies?: Record<string, string>; dist: { tarball: string; integrity?: string; shasum?: string } };
export const digestBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const identity = (ref: PackageIdentity) => {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(ref.name) ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(ref.version)) throw new PlatformError('ARTIFACT_MISMATCH');
};
export function orderPackages(packages: PackageRef[]): PackageRef[] {
  const pending = new Map(packages.map(pkg => [pkg.name, pkg]));
  if (pending.size !== packages.length) throw new PlatformError('ARTIFACT_MISMATCH');
  const ordered: PackageRef[] = []; const visiting = new Set<string>(); const done = new Set<string>();
  const visit = (pkg: PackageRef) => {
    identity(pkg);
    if (visiting.has(pkg.name)) throw new PlatformError('ARTIFACT_MISMATCH');
    if (done.has(pkg.name)) return;
    visiting.add(pkg.name);
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      const candidate = pending.get(name);
      if (candidate) { if (candidate.version !== version) throw new PlatformError('ARTIFACT_MISMATCH'); visit(candidate); }
    }
    visiting.delete(pkg.name); done.add(pkg.name); ordered.push(pkg);
  };
  packages.forEach(visit); return ordered;
}

/** npm wire protocol only: never invoke npm, install, scripts or imported package code. */
export class RegistryClient {
  readonly origin: string;
  constructor(private readonly config: RegistryConfig) {
    let url: URL;
    try { url = new URL(config.origin); } catch { throw new PlatformError('INFRA_UNAVAILABLE'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) || !config.token || /[\r\n]/.test(config.token)) throw new PlatformError('INFRA_UNAVAILABLE');
    this.origin = url.origin;
  }
  private url(value: string): URL {
    let url: URL;
    try { url = new URL(value, this.origin); } catch { throw new PlatformError('INFRA_UNAVAILABLE'); }
    if (url.origin !== this.origin || url.username || url.password || url.hash || url.search) throw new PlatformError('INFRA_UNAVAILABLE');
    return url;
  }
  private async request(path: string, method = 'GET', body?: unknown, limit = 1024 * 1024): Promise<{ status: number; bytes: Uint8Array }> {
    try {
      const response = await fetch(this.url(path), { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${this.config.token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const reader = response.body?.getReader();
      if (!reader) return { status: response.status, bytes: new Uint8Array() };
      try {
        if (Number(response.headers.get('content-length') ?? 0) > limit) throw new PlatformError('INFRA_UNAVAILABLE');
        const chunks: Uint8Array[] = []; let total = 0;
        while (true) {
          const next = await reader.read(); if (next.done) break;
          total += next.value.byteLength; if (total > limit) throw new PlatformError('INFRA_UNAVAILABLE'); chunks.push(next.value);
        }
        return { status: response.status, bytes: Buffer.concat(chunks, total) };
      } finally { await reader.cancel().catch(() => {}); }
    } catch { throw new PlatformError('INFRA_UNAVAILABLE'); }
  }
  private async metadata(ref: PackageIdentity): Promise<Metadata | undefined> {
    identity(ref);
    const response = await this.request(`/${encodeURIComponent(ref.name)}/${encodeURIComponent(ref.version)}`);
    if (response.status === 404) return undefined;
    if (response.status !== 200) throw new PlatformError('INFRA_UNAVAILABLE');
    let meta: Metadata;
    try { meta = JSON.parse(new TextDecoder().decode(response.bytes)) as Metadata; }
    catch { throw new PlatformError('INFRA_UNAVAILABLE'); }
    if (meta?.name !== ref.name || meta.version !== ref.version || typeof meta.dist?.tarball !== 'string') throw new PlatformError('CONFLICT');
    this.url(meta.dist.tarball);
    return meta;
  }
  private async verify(ref: PackageIdentity, expected?: PackageRef): Promise<Metadata | undefined> {
    const meta = await this.metadata(ref); if (!meta) return undefined;
    const artifact = await this.request(meta.dist.tarball, 'GET', undefined, UPLOAD_LIMITS.tarballBytes);
    if (artifact.status === 404) throw new PlatformError('UPLOAD_INCOMPLETE');
    if (artifact.status !== 200) throw new PlatformError('INFRA_UNAVAILABLE');
    if (expected && (artifact.bytes.byteLength !== expected.tarball.bytes || digestBytes(artifact.bytes) !== expected.tarball.sha256)) throw new PlatformError('CONFLICT');
    if (meta.dist.integrity) {
      if (typeof meta.dist.integrity !== 'string' || meta.dist.integrity !== 'sha512-' + createHash('sha512').update(artifact.bytes).digest('base64')) throw new PlatformError('CONFLICT');
    } else if (!meta.dist.shasum || meta.dist.shasum !== createHash('sha1').update(artifact.bytes).digest('hex')) throw new PlatformError('CONFLICT');
    // Dependency metadata is obtained from the immutable tarball, not mutable packument fields.
    try {
      const archive = parseNpmArchive(artifact.bytes);
      const manifest = JSON.parse(new TextDecoder().decode(archive.get('package.json'))) as Record<string, unknown>;
      if (manifest.name !== ref.name || manifest.version !== ref.version) throw new Error();
      const dependencies = manifest.dependencies ?? {};
      if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies) || Object.values(dependencies).some(value => typeof value !== 'string')) throw new Error();
      return { ...meta, dependencies: dependencies as Record<string, string> };
    } catch { throw new PlatformError('CONFLICT'); }
  }
  async verifyPackage(ref: PackageRef): Promise<void> {
    if (!await this.verify(ref, ref)) throw new PlatformError('UPLOAD_INCOMPLETE');
  }
  async verifyDependencies(ref: PackageIdentity, seen = new Set<string>(), active = new Set<string>()): Promise<void> {
    const key = `${ref.name}@${ref.version}`; if (active.has(key)) throw new PlatformError('ARTIFACT_MISMATCH'); if (seen.has(key)) return;
    if (seen.size + active.size >= 100) throw new PlatformError('LIMIT_EXCEEDED');
    active.add(key);
    const meta = await this.verify(ref); if (!meta) throw new PlatformError('UPLOAD_INCOMPLETE');
    for (const [name, version] of Object.entries(meta.dependencies ?? {})) if (name.startsWith('@company/')) await this.verifyDependencies({ name, version }, seen, active);
    active.delete(key); seen.add(key);
  }
  async ensurePackage(ref: PackageRef, bytes: Uint8Array, candidateTag: string): Promise<{ status: 'published' | 'already-identical'; integrity: string }> {
    identity(ref);
    if (!/^candidate-[A-Za-z0-9-]+$/.test(candidateTag) || bytes.byteLength !== ref.tarball.bytes || digestBytes(bytes) !== ref.tarball.sha256) throw new PlatformError('DIGEST_MISMATCH');
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    if (await this.verify(ref, ref)) return { status: 'already-identical', integrity };
    let pkg: Record<string, unknown>;
    try { pkg = JSON.parse(new TextDecoder().decode(parseNpmArchive(bytes).get('package.json'))) as Record<string, unknown>; }
    catch { throw new PlatformError('ARTIFACT_MISMATCH'); }
    if (pkg.name !== ref.name || pkg.version !== ref.version) throw new PlatformError('ARTIFACT_MISMATCH');
    const filename = `${ref.name.split('/').at(-1)}-${ref.version}.tgz`;
    const payload = { _id: ref.name, name: ref.name, 'dist-tags': { [candidateTag]: ref.version },
      versions: { [ref.version]: { ...pkg, _id: `${ref.name}@${ref.version}`, dist: { integrity, shasum: createHash('sha1').update(bytes).digest('hex'),
        tarball: `${this.origin}/${encodeURIComponent(ref.name)}/-/${filename}` } } },
      _attachments: { [filename]: { content_type: 'application/octet-stream', data: Buffer.from(bytes).toString('base64'), length: bytes.byteLength } } };
    let success = false;
    try { const response = await this.request(`/${encodeURIComponent(ref.name)}`, 'PUT', payload); success = response.status >= 200 && response.status < 300; }
    catch (error) {
      // A lost response is not proof of failure. Never repack or delete a published version.
      if (await this.verify(ref, ref)) return { status: 'already-identical', integrity };
      throw error;
    }
    if (!await this.verify(ref, ref)) throw new PlatformError('INFRA_UNAVAILABLE');
    return { status: success ? 'published' : 'already-identical', integrity };
  }
  async promote(ref: PackageRef): Promise<void> {
    await this.verifyPackage(ref);
    const response = await this.request(`/-/package/${encodeURIComponent(ref.name)}/dist-tags/latest`, 'PUT', ref.version);
    if (response.status < 200 || response.status >= 300) throw new PlatformError('INFRA_UNAVAILABLE');
  }
}
