import { verificationAuthorizationFixture, verificationIdentity, verificationReportFixture, verificationSpecDigest, verificationContextFixture } from './integration-verification.js';
export const repairGeneratedPath = 'src/components/zhinexus/component-0001.vue';
export const repairReportDigest = 'b'.repeat(64);
export function repairSourceReportFixture() {
  const report = verificationReportFixture();
  report.status = 'failed'; report.checks[0]!.status = 'failed';
  const issue = { code: 'TYPE_FAILED', message: 'Project type verification failed.' };
  report.checks[0]!.issues.push(issue as never); report.pendingItems.push(issue as never);
  return report;
}
export function repairAuthorizationFixture() {
  return { ...verificationAuthorizationFixture(), operation: 'repair', sourceReportDigest: repairReportDigest, allowedRepairPaths: [repairGeneratedPath], maxAttempts: 2 };
}
export function repairResultFixture() {
  const finalReport = verificationReportFixture();
  for (const values of [finalReport.snapshots.before, finalReport.snapshots.after]) values.find(s => s.path === repairGeneratedPath)!.sha256 = '9'.repeat(64);
  return { ...verificationIdentity, specDigest: verificationSpecDigest, operation: 'repair', id: 'repair-synthetic-1', sourceReportDigest: repairReportDigest, maxAttempts: 2,
    attempts: [{ attempt: 1, recipeId: 'regenerate-generated-component', beforeReportDigest: repairReportDigest, afterReportDigest: 'c'.repeat(64), changedFiles: [repairGeneratedPath],
      beforeHashes: [{ path: repairGeneratedPath, exists: true, sha256: 'e'.repeat(64) }], afterHashes: [{ path: repairGeneratedPath, exists: true, sha256: '9'.repeat(64) }], backupRef: { id: 'repair-backup-1', sha256: 'f'.repeat(64) } }],
    status: 'repaired', stopReason: 'passed', finalReport, changedFiles: [repairGeneratedPath], pendingItems: [] };
}
export function repairContextFixture() { return { ...verificationContextFixture(), reportDigest: repairReportDigest, sourceReport: repairSourceReportFixture() }; }
