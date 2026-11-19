/** Synthetic T17 protocol fixtures. Hashes do not prove real project or artifact bytes. */
import { applyResultFixture, applyRoot, applyDigest } from './integration-apply.js';
import { validIntegrationPlanFixture } from './integration-plan.js';

export const verificationIdentity = { schemaVersion: 1, projectRoot: applyRoot, planDigest: applyDigest, applyResultDigest: '1'.repeat(64) };
export const verificationSpecDigest = '2'.repeat(64);
export function verificationEnvironmentFixture() {
  return { os: 'windows', arch: 'x64', browserVersion: '158.0.8127.18', browserRevision: '1254', fontDigest: '3'.repeat(64),
    locale: 'en-US', timezone: 'UTC', deviceScaleFactor: 1, renderer: 'canvas', width: 1280, height: 720, theme: 'light', frameworkVersion: '3.5.45', echartsVersion: '6.1.0' };
}
export function verificationSpecFixture() {
  return { ...verificationIdentity, commands: [
    { kind: 'type', script: 'typecheck', manifestPath: 'package.json', manifestSha256: 'e'.repeat(64), timeoutMs: 60000, outputDirectories: [] },
    { kind: 'build', script: 'build', manifestPath: 'package.json', manifestSha256: 'e'.repeat(64), timeoutMs: 120000, outputDirectories: ['dist'] },
  ], browser: { url: 'http://127.0.0.1:5174/demo', readySelector: '[data-ready=true]', timeoutMs: 30000, viewport: { width: 1280, height: 720 },
    renderer: 'canvas', theme: 'light', actions: [{ kind: 'click', selector: '#refresh' }], assertions: [{ kind: 'visible', selector: 'canvas' }],
    visual: { baseline: { image: { path: 'baseline/vue.png', sha256: '4'.repeat(64), bytes: 1024 }, environment: verificationEnvironmentFixture() }, pixelThreshold: 0.1, maxDiffPixelRatio: 0.01 } }, businessGaps: [] };
}
export function verificationAuthorizationFixture() {
  return { ...verificationIdentity, specDigest: verificationSpecDigest, operation: 'verify', allowProjectScripts: true, allowBrowser: true,
    scriptNames: ['typecheck', 'build'], allowedRepairPaths: [], maxAttempts: 0 };
}
export function verificationReportFixture() {
  const artifacts = ['type.log', 'build.log', 'behavior.json', 'screenshot.png'].map((name, i) => ({ path: `run/${name}`, sha256: String(i + 5).repeat(64), bytes: 128 }));
  const snapshots = applyResultFixture().afterHashes;
  return { ...verificationIdentity, specDigest: verificationSpecDigest, operation: 'verify', id: 'verify-synthetic-1', toolVersion: '0.0.15', verifiedAt: '2026-11-19T00:00:00Z', status: 'passed',
    checks: [
      { id: 'typecheck', category: 'type', status: 'passed', issues: [], evidence: [artifacts[0]] },
      { id: 'build', category: 'build', status: 'passed', issues: [], evidence: [artifacts[1]] },
      { id: 'browser', category: 'behavior', status: 'passed', issues: [], evidence: [artifacts[2]] },
      { id: 'dependency-guard', category: 'behavior', status: 'passed', issues: [], evidence: [artifacts[2]] },
      { id: 'visual', category: 'visual', status: 'passed', issues: [], evidence: [artifacts[3]] },
      { id: 'business', category: 'missing-business-info', status: 'passed', issues: [], evidence: [] },
    ], changedFiles: [], snapshots: { before: structuredClone(snapshots), after: structuredClone(snapshots) },
    installedVersions: validIntegrationPlanFixture().exactDependencies.map(d => ({ ...d, manifestSha256: 'a'.repeat(64) })), visualResult: 'PASS',
    environment: verificationEnvironmentFixture(), artifacts, pendingItems: [] };
}
export function verificationContextFixture() {
  return { projectRoot: applyRoot, planDigest: applyDigest, applyResultDigest: verificationIdentity.applyResultDigest, specDigest: verificationSpecDigest,
    plan: validIntegrationPlanFixture(), applyResult: applyResultFixture(), spec: verificationSpecFixture() };
}
