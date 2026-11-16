import { matchPlanFixture } from './match-plan.js';
import { componentMatchResponseFixture } from './component-match.js';
import type { LocalProjectInspectionV1, IntegrationPlanV1 } from '@company/contracts';

/** P0 boundary frozen for P1/P2: full segments *, **; no negation or extglob syntax. */
export const workspacePatternCases = [
  { pattern: 'apps/*', supported: true }, { pattern: 'packages/**', supported: true },
  { pattern: '业务 应用/client', supported: true }, { pattern: 'apps/*/client', supported: true },
  { pattern: '../outside/*', supported: false }, { pattern: '/apps/*', supported: false },
  { pattern: '!apps/private', supported: false }, { pattern: 'apps/{a,b}', supported: false },
  { pattern: 'apps/client-*', supported: false }, { pattern: 'apps/?', supported: false },
  { pattern: 'apps\\*', supported: false }, { pattern: 'apps/**/', supported: false },
] as const;

/** Synthetic contract data only; no real compatibility or publication claim. */
export function validInspectionFixture(): LocalProjectInspectionV1 {
  return {
    schemaVersion: 1, status: 'inspected', workspace: '.',
    packageManager: 'pnpm', lockfile: { path: 'pnpm-lock.yaml', format: 'pnpm-v9' },
    framework: 'vue', resolvedDependencies: [
      { name: 'vue', version: '3.5.45', specifier: '^3.5.0' },
      { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
    ], scripts: ['build', 'typecheck'], git: { status: 'clean', dirtyPaths: [] },
    fileSnapshots: [{ path: 'package.json', exists: true, sha256: 'a'.repeat(64) },
      { path: 'pnpm-lock.yaml', exists: true, sha256: 'b'.repeat(64) }], conflicts: [],
  };
}

export function validIntegrationPlanFixture(): IntegrationPlanV1 {
  const inspection = validInspectionFixture();
  const response = componentMatchResponseFixture();
  response.target!.compatibility = { status: 'verified', recordIds: ['synthetic-test-only'] };
  response.gaps = [];
  const match = matchPlanFixture();
  const sourceMatchPlan = { ...match, exactDependencies: response.exactDependencies,
    elements: [{ ...match.elements[0]!, target: response.target!,
      props: response.api!.props.map(p => ({ ...p, ...(p.required ? { source: 'sales' } : {}) })), gaps: [] }] };
  return {
    schemaVersion: 1, stage: 'plan', executionAuthorized: false, status: 'planned',
    localProject: inspection, sourceMatchPlan, matchPlanDigest: 'c'.repeat(64),
    baseFileHashes: [...inspection.fileSnapshots.map(f => ({ ...f })), { path: 'src/components/zhinexus/component-0001.vue', exists: false }],
    allowedPaths: ['package.json', 'pnpm-lock.yaml', 'src/components/zhinexus/component-0001.vue'],
    packageManager: 'pnpm', exactDependencies: response.exactDependencies,
    commands: [{ executable: 'pnpm', args: ['install', '--ignore-scripts'], cwd: '.', purpose: 'install' }],
    changes: [
      { kind: 'package-json', path: 'package.json', dependencies: [{ name: '@company/charts-vue', version: '0.0.12' }] },
      { kind: 'lockfile-regeneration', path: 'pnpm-lock.yaml' },
      { kind: 'generated-component', path: 'src/components/zhinexus/component-0001.vue', instanceId: 'node-1', framework: 'vue' },
    ], conflicts: [],
    publicationEvidence: [{ response, checkedAt: '2026-11-17T00:00:00Z' }],
    registryEvidence: [{ name: '@company/charts-vue', version: '0.0.12', sha256: 'b'.repeat(64),
      integrity: 'sha512-' + 'A'.repeat(86) + '==', verification: 'platform-sha256' }],
  };
}
