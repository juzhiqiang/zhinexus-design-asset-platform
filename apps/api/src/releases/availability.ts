import { PlatformError } from '../errors.js';
import type { ReleaseLease } from './leases.js';
import type { ReleaseArtifacts } from './artifact-store.js';
import type { RegistryClient } from './registry-client.js';

export type AvailabilityResult = { ok: boolean; missing: { kind: 'object' | 'package'; ref: string }[] };
export async function checkAvailability(lease: ReleaseLease, artifacts: ReleaseArtifacts, registry: RegistryClient): Promise<AvailabilityResult> {
  const missing: AvailabilityResult['missing'] = [];
  const check = async (kind: 'object' | 'package', ref: string, operation: () => Promise<unknown>) => {
    try { await operation(); }
    catch (error) {
      if (!(error instanceof PlatformError) || error.code !== 'UPLOAD_INCOMPLETE') throw error;
      missing.push({ kind, ref });
    }
  };
  for (const ref of lease.manifest.files) await check('object', ref.path, () => artifacts.read(lease, ref));
  // All declared files, including every nested preview resource, must be readable.
  for (const variant of lease.manifest.variants) for (const example of variant.examples) {
    if (!lease.manifest.files.some(file => file.path === example.previewEntry)) throw new PlatformError('ARTIFACT_MISMATCH');
  }
  for (const pkg of lease.manifest.packages) await check('package', pkg.tarball.path, async () => {
    await registry.verifyPackage(pkg); await registry.verifyDependencies(pkg);
  });
  return { ok: missing.length === 0, missing };
}
