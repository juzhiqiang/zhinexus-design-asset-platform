/** Synthetic T16 contract fixtures; hashes are shape evidence, never real byte verification. */
import type { IntegrationPlanV1 } from '@company/contracts';
import { validIntegrationPlanFixture } from './integration-plan.js';

export const applyRoot = 'C:/synthetic/业务 项目';
export const applyDigest = 'd'.repeat(64);
export const applyOperation = 't16-synthetic-0001';
export function applyAuthorizationFixture() {
  return { schemaVersion: 1, operation: 'apply', projectRoot: applyRoot, planDigest: applyDigest,
    allowedPaths: [...validIntegrationPlanFixture().allowedPaths], allowInstall: true };
}
export function applyBackupFixture() {
  const plan = validIntegrationPlanFixture();
  return { schemaVersion: 1, operationId: applyOperation, projectRoot: applyRoot, planDigest: applyDigest,
    installPlanned: true, installStarted: true,
    files: plan.allowedPaths.map(path => ({ path,
      before: { ...plan.baseFileHashes.find(f => f.path === path)! },
      after: { path, exists: true, sha256: 'e'.repeat(64) },
      ...(plan.baseFileHashes.find(f => f.path === path)!.exists ? { originalBase64: 'b2xkCg==' } : {}),
    })) };
}
export function applyResultFixture() {
  const backup = applyBackupFixture();
  return { schemaVersion: 1, operation: 'apply', operationId: applyOperation, projectRoot: applyRoot,
    planDigest: applyDigest, status: 'applied', changedFiles: backup.files.map(f => f.path),
    beforeHashes: backup.files.map(f => f.before), afterHashes: backup.files.map(f => f.after),
    installedVersions: validIntegrationPlanFixture().exactDependencies.map(d => ({ ...d })),
    issues: [], backupRef: { id: applyOperation, sha256: 'f'.repeat(64) }, installState: 'succeeded' };
}
export function rollbackResultFixture() {
  return { schemaVersion: 1, operation: 'rollback', operationId: applyOperation, projectRoot: applyRoot,
    planDigest: applyDigest, status: 'rolled-back', restoredPaths: [...validIntegrationPlanFixture().allowedPaths],
    unchangedPaths: [], preservedPaths: [], unresolvedPaths: [], issues: [], installState: 'reinstall-required' };
}
export function authorizationContextFixture() {
  return { plan: validIntegrationPlanFixture() as IntegrationPlanV1, planDigest: applyDigest, projectRoot: applyRoot };
}
