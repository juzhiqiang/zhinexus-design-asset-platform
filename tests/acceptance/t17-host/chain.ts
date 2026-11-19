/**
 * T17 owned-host 临时消费者真实 CLI 验收链（plan → 显式授权 apply → verify / 有限 repair）。
 *
 * 边界：
 * - 缺失冻结 CLI tarball、服务凭据、SDK bundle 或变体映射时立即 fail-closed，不静默降级或冒称通过；
 * - 严禁把 T16 `inspect` 当作 T17 通过；双框架（Vue + React）均须完成真实 `plan → apply → verify`（及可选有限 `repair`）；
 * - `repair` 严格限制预算 `maxAttempts ∈ {0, 1, 2}`，并校验 `attempts.length <= maxAttempts`；
 * - 全程凭据仅经子进程环境变量注入，绝不进入 argv、日志或落盘回执；
 * - 结束前必须停止所有 owned 子进程并在封存回执与清理前验证无残留进程。
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  canonicalJson,
  validateComponentMatchResponse,
  validateIntegrationApplyResult,
  validateIntegrationPlan,
  validateIntegrationRepairResult,
  validateIntegrationVerificationReport,
  validateIntegrationVerificationSpec,
  validateMatchPlan,
  type ComponentMatchResponseV1,
  type IntegrationApplyResultV1,
  type IntegrationPlanV1,
  type IntegrationRepairResultV1,
  type IntegrationVerificationReportV1,
  type IntegrationVerificationSpecV1,
  type MatchPlanV1,
} from '@company/contracts';
import { createOwnedRun, installFrozenCli, startBuiltHost, verifyBuiltImportEvidence, type Framework } from './host.js';
import { runConsumerScript, scaffoldConsumerProject, wireAppliedGeneratedComponent } from './consumer.js';
import { loadT17HostInputs, resolveT17FixedToolchain, type T17HostInputs } from './e2e-config.js';
import {
  buildHostBrowserSpec,
  collectBrowserLoadedAssets,
  readBuiltGraphEvidence,
  stageApprovedVisualBaseline,
  type ApprovedVisualBaseline,
} from './host-browser.js';
import { assertLifecycleHooksSuppressed, installDependencies, runFrozenCli, type FrozenCliInstallation } from './runtime.js';
import { preserveFailedInspectEvidence } from './runner.js';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const digest = (value: unknown) => sha(canonicalJson(value));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type BoundedRepairBudget = 0 | 1 | 2;

export type T17FrameworkChainEvidence = {
  framework: Framework;
  packageManager: 'npm';
  planStatus: 'planned';
  applyStatus: 'applied';
  verifyStatus: 'passed' | 'failed' | 'blocked';
  repairStatus: 'not-needed' | 'repaired' | 'stopped' | 'blocked' | 'recovery-required';
  repairMaxAttempts: BoundedRepairBudget;
  repairAttempts: number;
  planDigest: string;
  applyResultDigest: string;
  specDigest: string;
  verifyReportDigest: string;
  projectRoot: string;
  repairResultDigest?: string;
  planEvidence: string;
  applyEvidence: string;
  specEvidence: string;
  verifyEvidence: string;
  repairEvidence?: string;
  builtImportEvidence?: string;
  childProcessesCleaned: boolean;
};

export type T17HostChainReceipt = {
  schemaVersion: 1;
  acceptanceKind: 't17-owned-host-chain';
  productionAcceptance: false;
  runId: string;
  evidenceRoot: string;
  result: 'passed';
  receiptEvidencePath: string;
  sealPath: string;
  sealSha256: string;
  projectRoots: Record<Framework, string>;
  cli: FrozenCliInstallation & { tarballSha256: string; tarballBytes: number; manifestSha256: string };
  chains: T17FrameworkChainEvidence[];
  childProcessesCleaned: boolean;
};

export type T17HostChainOptions = {
  env: Record<string, string | undefined>;
  repositoryRoot: string;
  maxRepairAttempts?: number;
  allowBrowser?: boolean;
  visualBaselines?: Partial<Record<Framework, ApprovedVisualBaseline>>;
  browserActions?: NonNullable<IntegrationVerificationSpecV1['browser']>['actions'];
  browserAssertions?: NonNullable<IntegrationVerificationSpecV1['browser']>['assertions'];
  timeoutMs?: number;
  faultLayoutForRepair?: Partial<Record<Framework, string>>;
};

export function assertBoundedRepairBudget(value: number): BoundedRepairBudget {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new Error(`Invalid T17 repair budget (maxAttempts=${String(value)}); allowed values are 0, 1, or 2.`);
  }
  return value;
}

export function parsePlanOutput(stdout: string, framework: Framework): IntegrationPlanV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error('Frozen CLI plan stdout is not valid JSON.');
  }
  const checked = validateIntegrationPlan(raw);
  if (!checked.ok) {
    throw new Error('Frozen CLI plan output failed IntegrationPlanV1 contract validation.');
  }
  if (checked.value.status !== 'planned' || checked.value.conflicts.length > 0) {
    throw new Error(`Frozen CLI plan did not reach planned status (status=${checked.value.status}).`);
  }
  if (checked.value.localProject.framework !== framework) {
    throw new Error(`Frozen CLI plan framework (${checked.value.localProject.framework}) does not match ${framework}.`);
  }
  return checked.value;
}

export function parseApplyOutput(
  stdout: string,
  expectedProjectRoot: string,
  expectedPlanDigest: string,
): IntegrationApplyResultV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error('Frozen CLI apply stdout is not valid JSON.');
  }
  const checked = validateIntegrationApplyResult(raw);
  if (!checked.ok) {
    throw new Error('Frozen CLI apply output failed IntegrationApplyResultV1 contract validation.');
  }
  if (checked.value.status !== 'applied') {
    throw new Error(`Frozen CLI apply did not reach applied status (status=${checked.value.status}).`);
  }
  if (checked.value.projectRoot !== expectedProjectRoot || checked.value.planDigest !== expectedPlanDigest) {
    throw new Error('Frozen CLI apply output identity (projectRoot/planDigest) does not match.');
  }
  return checked.value;
}

export function parseVerifyOutput(
  stdout: string,
  expectedProjectRoot: string,
  expectedPlanDigest: string,
  expectedApplyDigest: string,
  expectedSpecDigest: string,
): IntegrationVerificationReportV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error('Frozen CLI verify stdout is not valid JSON.');
  }
  const checked = validateIntegrationVerificationReport(raw, {
    projectRoot: expectedProjectRoot,
    planDigest: expectedPlanDigest,
    applyResultDigest: expectedApplyDigest,
    specDigest: expectedSpecDigest,
  });
  if (!checked.ok) {
    throw new Error('Frozen CLI verify output failed IntegrationVerificationReportV1 contract validation or digest binding.');
  }
  return checked.value;
}

export function parseRepairOutput(
  stdout: string,
  expectedProjectRoot: string,
  expectedPlanDigest: string,
  expectedApplyDigest: string,
  expectedSpecDigest: string,
  expectedSourceReportDigest: string,
  maxAttempts: number,
): IntegrationRepairResultV1 {
  const budget = assertBoundedRepairBudget(maxAttempts);
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error('Frozen CLI repair stdout is not valid JSON.');
  }
  const checked = validateIntegrationRepairResult(raw, {
    projectRoot: expectedProjectRoot,
    planDigest: expectedPlanDigest,
    applyResultDigest: expectedApplyDigest,
    specDigest: expectedSpecDigest,
    reportDigest: expectedSourceReportDigest,
  });
  if (!checked.ok) {
    throw new Error('Frozen CLI repair output failed IntegrationRepairResultV1 contract validation or digest binding.');
  }
  if (checked.value.attempts.length > budget || checked.value.maxAttempts > budget) {
    throw new Error(`Frozen CLI repair exceeded bounded maxAttempts budget (${checked.value.attempts.length} > ${budget}).`);
  }
  return checked.value;
}

export async function fetchAuthoritativeTargetForHost(
  framework: Framework,
  inputs: T17HostInputs,
  timeoutMs = 30_000,
): Promise<ComponentMatchResponseV1> {
  const variant = inputs.variants.variants.find(v => v.framework === framework && v.componentId === 'line')
    ?? inputs.variants.variants.find(v => v.framework === framework);
  if (!variant) {
    throw new Error(`Missing variant mapping for framework=${framework} in T17 host inputs.`);
  }
  const manifestPackages = inputs.sdkManifest.packages;
  if (!Array.isArray(manifestPackages)) {
    throw new Error('Frozen SDK manifest must contain a packages array.');
  }
  const pkgName = `@company/charts-${framework}`;
  const sdkPkg = manifestPackages.find(p => isRecord(p) && p.name === pkgName);
  if (!isRecord(sdkPkg) || typeof sdkPkg.version !== 'string') {
    throw new Error(`Missing package ${pkgName} version in frozen SDK manifest.`);
  }

  const frameworkVersion = framework === 'vue' ? '3.5.45' : '19.3.1';
  const url = new URL('/v1/matching/components', inputs.apiUrl);
  url.searchParams.set('componentId', variant.componentId);
  url.searchParams.set('framework', framework);
  url.searchParams.set('packageName', pkgName);
  url.searchParams.set('packageVersion', sdkPkg.version);
  url.searchParams.set('frameworkVersion', frameworkVersion);
  url.searchParams.set('echartsVersion', '6.1.0');
  if (framework === 'react') {
    url.searchParams.set('reactDomVersion', '19.3.1');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${inputs.apiToken}`,
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Authoritative component match API failed for ${framework} (HTTP ${res.status}).`);
    }
    const body = (await res.json()) as unknown;
    const checked = validateComponentMatchResponse(body);
    if (!checked.ok || checked.value.status !== 'matched' || !checked.value.target || !checked.value.api) {
      throw new Error(`Authoritative component match API did not return a valid matched target for ${framework}.`);
    }
    return checked.value;
  } finally {
    clearTimeout(timer);
  }
}

export function buildMatchPlanForHost(
  framework: Framework,
  inputs: T17HostInputs,
  options?: { faultLayout?: string; authoritativeMatch?: ComponentMatchResponseV1 },
): MatchPlanV1 {
  const variant = inputs.variants.variants.find(v => v.framework === framework && v.componentId === 'line')
    ?? inputs.variants.variants.find(v => v.framework === framework);
  if (!variant) {
    throw new Error(`Missing variant mapping for framework=${framework} in T17 host inputs.`);
  }
  const manifestVariants = inputs.sdkManifest.variants;
  const manifestPackages = inputs.sdkManifest.packages;
  if (!Array.isArray(manifestVariants) || !Array.isArray(manifestPackages)) {
    throw new Error('Frozen SDK manifest must contain packages and variants arrays.');
  }

  const pkgName = `@company/charts-${framework}`;
  const sdkPkg = manifestPackages.find(p => isRecord(p) && p.name === pkgName);
  if (!isRecord(sdkPkg)) {
    throw new Error(`Missing package ${pkgName} in frozen SDK manifest.`);
  }
  if (
    typeof sdkPkg.version !== 'string' ||
    !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(sdkPkg.version)
  ) {
    throw new Error(`Missing or invalid exact package version for ${pkgName} in frozen SDK manifest.`);
  }
  const pkgVersion = sdkPkg.version;

  if (
    !isRecord(sdkPkg.tarball) ||
    typeof sdkPkg.tarball.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(sdkPkg.tarball.sha256)
  ) {
    throw new Error(`Missing or invalid tarball SHA-256 digest for ${pkgName} in frozen SDK manifest.`);
  }
  const pkgSha = sdkPkg.tarball.sha256;

  const sdkVariant = manifestVariants.find(
    v => isRecord(v) && v.componentId === variant.componentId && v.framework === framework,
  );
  if (!isRecord(sdkVariant)) {
    throw new Error(`Missing variant ${variant.componentId}:${framework} in frozen SDK manifest.`);
  }
  if (sdkVariant.packageName !== pkgName || sdkVariant.packageVersion !== pkgVersion) {
    throw new Error(`Frozen SDK variant ${variant.componentId}:${framework} is not bound to the selected package identity.`);
  }
  if (
    typeof sdkVariant.exportName !== 'string' ||
    !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(sdkVariant.exportName)
  ) {
    throw new Error(`Missing or invalid variant exportName for ${variant.componentId}:${framework} in frozen SDK manifest.`);
  }
  if (
    typeof sdkVariant.exportPath !== 'string' ||
    !/^\.(?:\/[A-Za-z0-9._-]+)+$/.test(sdkVariant.exportPath)
  ) {
    throw new Error(`Missing or invalid variant exportPath for ${variant.componentId}:${framework} in frozen SDK manifest.`);
  }
  const exportName = sdkVariant.exportName;
  const exportPath = sdkVariant.exportPath;

  const frameworkVersion = framework === 'vue' ? '3.5.45' : '19.3.1';
  if (options?.authoritativeMatch) {
    const checkedAuth = validateComponentMatchResponse(options.authoritativeMatch);
    if (!checkedAuth.ok || checkedAuth.value.status !== 'matched' || !checkedAuth.value.target || !checkedAuth.value.api) {
      throw new Error(`Authoritative component match response for ${framework} failed contract validation or is not matched.`);
    }
    const { query, target, api, exactDependencies: authDeps, gaps: authGaps } = checkedAuth.value;
    if (
      query.framework !== framework ||
      query.frameworkVersion !== frameworkVersion ||
      query.echartsVersion !== '6.1.0' ||
      (framework === 'react' ? query.reactDomVersion !== '19.3.1' : query.reactDomVersion !== undefined)
    ) {
      throw new Error(`Authoritative component match query identity mismatch for ${framework}.`);
    }
    if (
      target.variantReleaseId !== variant.variantReleaseId ||
      target.componentId !== variant.componentId ||
      target.framework !== framework ||
      target.packageName !== pkgName ||
      target.packageVersion !== pkgVersion ||
      target.packageSha256 !== pkgSha ||
      target.exportName !== exportName ||
      target.exportPath !== exportPath
    ) {
      throw new Error(
        `Authoritative API target identity drifted from frozen SDK manifest/variants for ${variant.componentId}:${framework}.`,
      );
    }
    const props = api.props.map(prop => ({
      ...prop,
      ...(prop.name === 'data' || prop.required ? { source: 'revenue' } : {}),
    }));
    const events = api.events.map(event => ({
      ...event,
      handler: 'onChartClick',
    }));
    const plan: MatchPlanV1 = {
      schemaVersion: 1,
      source: 'design-id',
      inputDigest: sha(`t17-host-${framework}-${variant.componentId}`),
      ruleSetId: 't17-host-acceptance',
      revision: '1',
      context: {
        framework,
        frameworkVersion,
        echartsVersion: '6.1.0',
        packageManager: 'npm',
        requirements: [],
      },
      elements: [
        {
          instanceId: 'node-1',
          designId: `t17-host/${framework}/${variant.componentId}`,
          status: 'mapped',
          target: structuredClone(target),
          props,
          events,
          layout: options.faultLayout ?? 'grid cell 1',
          gaps: structuredClone(authGaps),
        },
      ],
      exactDependencies: structuredClone(authDeps),
      gaps: [],
    };
    const checkedPlan = validateMatchPlan(plan);
    if (!checkedPlan.ok) {
      throw new Error(`Constructed authoritative MatchPlan failed contract validation: ${JSON.stringify(checkedPlan.issues)}`);
    }
    return checkedPlan.value;
  }

  const verifiedCompatibility = inputs.validatedCompatibility?.[variant.componentId + ':' + framework] ?? [];
  const exactDependencies = [
    { name: pkgName, version: pkgVersion },
    { name: framework, version: frameworkVersion },
    ...(framework === 'react' ? [{ name: 'react-dom', version: '19.3.1' }] : []),
    { name: 'echarts', version: '6.1.0' },
  ];

  return {
    schemaVersion: 1,
    source: 'design-id',
    inputDigest: sha(`t17-host-${framework}-${variant.componentId}`),
    ruleSetId: 't17-host-acceptance',
    revision: '1',
    context: {
      framework,
      frameworkVersion,
      echartsVersion: '6.1.0',
      packageManager: 'npm',
      requirements: [],
    },
    elements: [
      {
        instanceId: 'node-1',
        designId: `t17-host/${framework}/${variant.componentId}`,
        status: 'mapped',
        target: {
          variantReleaseId: variant.variantReleaseId,
          variantId: `${variant.componentId}-${framework}`,
          componentId: variant.componentId,
          framework,
          packageName: pkgName,
          packageVersion: pkgVersion,
          packageSha256: pkgSha,
          exportName,
          exportPath,
          evidence: [],
          compatibility: (() => {
            const records = Array.isArray(sdkVariant.compatibility) ? sdkVariant.compatibility : [];
            const matching = records.filter(record => isRecord(record)
              && record.status === 'passed'
              && record.framework === framework
              && record.frameworkVersion === frameworkVersion
              && record.echartsVersion === '6.1.0'
              && (framework !== 'react' || record.reactDomVersion === '19.3.1')
              && typeof record.reportId === 'string' && record.reportId.length > 0 && verifiedCompatibility.includes(record.reportId)
              && typeof record.verifiedAt === 'string' && Number.isFinite(Date.parse(record.verifiedAt)));
            return matching.length
              ? { status: 'verified' as const, recordIds: matching.map(record => (record as Record<string, unknown>).reportId as string) }
              : { status: 'unverified' as const, recordIds: [] as string[] };
          })(),
          examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
          styleExport: './style.css',
          readyMethod: 'whenRendered',
          notes: [],
        },
        props: [
          { name: 'data', type: 'ChartData', required: true, source: 'revenue' },
        ],
        events: [
          { name: 'point-click', payload: 'ChartEvent', handler: 'onChartClick' },
        ],
        layout: options?.faultLayout ?? 'grid cell 1',
        gaps: [],
      },
    ],
    exactDependencies,
    gaps: [],
  };
}

/** Normalize only the owned host's single import; the applied generated SFC remains unchanged. */
export function normalizeVueHostGeneratedImport(source: string, generatedPath: string): string {
  if (!/^src\/components\/zhinexus\/[A-Za-z0-9_-]+\.vue$/.test(generatedPath)) {
    throw new Error('Owned Vue generated path must identify a .vue component.');
  }
  const modulePath = './' + generatedPath.slice('src/'.length, -'.vue'.length);
  const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('(' + String.raw`\bfrom\s*` + ')(["\'])' + escaped + String.raw`(?:\.vue)?\2`, 'g');
  if ([...source.matchAll(pattern)].length !== 1) throw new Error('Owned Vue host must import the generated component exactly once.');
  return source.replace(pattern, (_whole, prefix: string, quote: string) => prefix + quote + modulePath + '.vue' + quote);
}

export function buildVerificationSpecForHost(params: {
  canonicalProjectRoot: string;
  planDigest: string;
  applyResultDigest: string;
  manifestSha256: string;
  browser?: IntegrationVerificationSpecV1['browser'];
  timeoutMs?: number;
}): IntegrationVerificationSpecV1 {
  const spec: IntegrationVerificationSpecV1 = {
    schemaVersion: 1,
    projectRoot: params.canonicalProjectRoot,
    planDigest: params.planDigest,
    applyResultDigest: params.applyResultDigest,
    commands: [
      {
        kind: 'type',
        script: 'typecheck',
        manifestPath: 'package.json',
        manifestSha256: params.manifestSha256,
        timeoutMs: params.timeoutMs ?? 120_000,
        outputDirectories: [],
      },
      {
        kind: 'build',
        script: 'build',
        manifestPath: 'package.json',
        manifestSha256: params.manifestSha256,
        timeoutMs: params.timeoutMs ?? 120_000,
        outputDirectories: ['dist'],
      },
    ],
    ...(params.browser ? { browser: params.browser } : {}),
    businessGaps: [],
  };
  const checked = validateIntegrationVerificationSpec(spec);
  if (!checked.ok) {
    throw new Error('Constructed T17 host VerificationSpec failed contract validation.');
  }
  return checked.value;
}

type RetainedArtifact = { bytes: Buffer; sha256: string };

function retainedPathSegments(path: string): string[] {
  const segments = path.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\:\u0000-\u001f]/.test(segment) || /[. ]$/.test(segment))) {
    throw new Error('Retained artifact path is unsafe.');
  }
  return segments;
}

/** Re-open every sealed entry, including evidence absent from report.artifacts. */
async function readRetainedArtifactInventory(outputRoot: string, inventory: unknown): Promise<Map<string, RetainedArtifact>> {
  if (!isRecord(inventory) || inventory.recursive !== true || !Array.isArray(inventory.children)) {
    throw new Error('Retained artifact inventory is missing or incomplete in the seal.');
  }
  const artifacts = new Map<string, RetainedArtifact>();
  const assertIdentity = (stat: { dev: bigint; ino: bigint }, expected: Record<string, unknown>) => {
    const identity = expected.identity;
    if (!isRecord(identity) || typeof identity.dev !== 'string' || typeof identity.ino !== 'string'
      || !/^\d+$/.test(identity.dev) || !/^\d+$/.test(identity.ino)
      || identity.dev !== String(stat.dev) || identity.ino !== String(stat.ino)) {
      throw new Error('Retained artifact identity differs from the sealed inventory.');
    }
  };
  const walk = async (path: string, node: Record<string, unknown>, relativePath?: string): Promise<void> => {
    const stat = await lstat(path, { bigint: true });
    assertIdentity(stat, node);
    if (stat.isSymbolicLink() || await realpath(path) !== path) throw new Error('Retained artifact path is linked or unsafe.');
    if (relativePath !== undefined && node.kind === 'file') {
      if (!stat.isFile() || stat.nlink !== 1n || !Number.isSafeInteger(node.bytes) || (node.bytes as number) < 0
        || typeof node.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(node.sha256)) {
        throw new Error('Retained artifact inventory has a linked or non-ordinary file.');
      }
      const bytes = await readFile(path);
      if (bytes.length !== node.bytes || stat.size !== BigInt(bytes.length) || sha(bytes) !== node.sha256) {
        throw new Error('Retained artifact bytes differ from the sealed digest.');
      }
      const after = await lstat(path, { bigint: true });
      assertIdentity(after, node);
      if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n || after.size !== stat.size) throw new Error('Retained artifact changed during read-back.');
      artifacts.set(relativePath, { bytes, sha256: node.sha256 });
      return;
    }
    if (!stat.isDirectory() || (relativePath !== undefined && (node.kind !== 'directory' || node.bytes !== 0)) || !Array.isArray(node.children)) {
      throw new Error('Retained artifact inventory has a non-ordinary or incomplete directory.');
    }
    const children: Record<string, unknown>[] = [];
    for (const child of node.children) {
      if (!isRecord(child) || typeof child.name !== 'string' || retainedPathSegments(child.name).length !== 1) throw new Error('Retained artifact inventory has an invalid child.');
      children.push(child);
    }
    const expectedNames = children.map(child => child.name as string).sort();
    if (new Set(expectedNames).size !== children.length || canonicalJson((await readdir(path)).sort()) !== canonicalJson(expectedNames)) {
      throw new Error('Retained artifact directory differs from the sealed inventory.');
    }
    for (const child of children) {
      const name = child.name as string;
      await walk(join(path, name), child, relativePath === undefined ? name : relativePath + '/' + name);
    }
    const after = await lstat(path, { bigint: true });
    assertIdentity(after, node);
    if (!after.isDirectory() || after.isSymbolicLink() || canonicalJson((await readdir(path)).sort()) !== canonicalJson(expectedNames)) {
      throw new Error('Retained artifact directory changed during read-back.');
    }
  };
  await walk(outputRoot, inventory);
  return artifacts;
}

function verifyRetainedArtifactRefs(refs: { path: string; sha256: string; bytes: number }[], artifacts: Map<string, RetainedArtifact>): void {
  for (const ref of refs) {
    retainedPathSegments(ref.path);
    const actual = artifacts.get(ref.path);
    if (!actual || actual.bytes.length !== ref.bytes || actual.sha256 !== ref.sha256) throw new Error('Retained artifact reference differs from its sealed bytes or digest.');
  }
}

function verifyRetainedRepairBackups(repair: IntegrationRepairResultV1, artifacts: Map<string, RetainedArtifact>): void {
  const ids = new Set<string>();
  for (const attempt of repair.attempts) {
    const { id, sha256 } = attempt.backupRef;
    const matches = [...artifacts].filter(([path]) => path.split('/').at(-1) === id + '.json');
    if (ids.has(id) || matches.length !== 1 || matches[0]![1].sha256 !== sha256) throw new Error('Retained repair backupRef is missing, ambiguous, or differs from its digest.');
    ids.add(id);
    let backup: unknown;
    try { backup = JSON.parse(matches[0]![1].bytes.toString('utf8')); }
    catch { throw new Error('Retained repair backup is not valid JSON.'); }
    if (!isRecord(backup) || backup.id !== id || typeof backup.originalBase64 !== 'string'
      || attempt.beforeHashes.length !== 1 || backup.path !== attempt.beforeHashes[0]!.path || attempt.beforeHashes[0]!.exists !== true) {
      throw new Error('Retained repair backup does not identify the attempted original file.');
    }
    const original = Buffer.from(backup.originalBase64, 'base64');
    if (original.toString('base64') !== backup.originalBase64 || sha(original) !== backup.sha256 || backup.sha256 !== attempt.beforeHashes[0]!.sha256) {
      throw new Error('Retained repair backup original bytes differ from the beforeHashes digest.');
    }
  }
}

export async function verifyHostChainReceipt(input: unknown): Promise<void> {
  if (!isRecord(input) || input.acceptanceKind !== 't17-owned-host-chain' || input.schemaVersion !== 1) {
    throw new Error('Invalid T17 host chain receipt: inspect-only or malformed receipts cannot satisfy T17.');
  }
  const receipt = input as unknown as T17HostChainReceipt;
  if (receipt.productionAcceptance !== false || receipt.result !== 'passed' || receipt.childProcessesCleaned !== true) {
    throw new Error('T17 host chain receipt must record passed status, non-production boundary, and cleaned child processes.');
  }
  if (!Array.isArray(receipt.chains) || receipt.chains.length !== 2) {
    throw new Error('T17 host chain receipt must contain both Vue and React acceptance chains.');
  }
  const frameworks = new Set(receipt.chains.map(c => c.framework));
  if (!frameworks.has('vue') || !frameworks.has('react')) {
    throw new Error('T17 host chain receipt must cover both vue and react frameworks.');
  }

  const evidenceRoot = resolve(receipt.evidenceRoot);
  const rootStat = await lstat(evidenceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (await realpath(evidenceRoot)) !== evidenceRoot) {
    throw new Error('T17 host chain evidence root is not a retained real directory.');
  }

  const sealPath = resolve(receipt.sealPath);
  if (!isAbsolute(sealPath) || relative(evidenceRoot, sealPath) !== 'run-seal.json') {
    throw new Error('T17 host chain seal escapes its retained evidence root.');
  }
  const sealStat = await lstat(sealPath);
  if (!sealStat.isFile() || sealStat.isSymbolicLink() || sealStat.nlink > 1) {
    throw new Error('T17 host chain seal is not an ordinary retained file.');
  }
  const sealBytes = await readFile(sealPath);
  if (sha(sealBytes) !== receipt.sealSha256) {
    throw new Error('T17 host chain seal SHA-256 mismatch.');
  }
  const seal = JSON.parse(sealBytes.toString('utf8')) as {
    schemaVersion?: unknown;
    runId?: unknown;
    evidenceRoot?: unknown;
    files?: unknown;
    payload?: unknown;
    inventories?: unknown;
  };
  if (seal.schemaVersion !== 1 || seal.runId !== receipt.runId || seal.evidenceRoot !== evidenceRoot || !Array.isArray(seal.files) || !isRecord(seal.payload)) {
    throw new Error('T17 host chain seal identity or file inventory is invalid.');
  }

  const expectedPayload = {
    acceptanceKind: 't17-owned-host-chain',
    productionAcceptance: false,
    result: receipt.result,
    cli: receipt.cli,
    chains: receipt.chains,
    projectRoots: receipt.projectRoots,
    childProcessesCleaned: receipt.childProcessesCleaned,
    receiptEvidencePath: 'files/t17-host-acceptance.json',
  };
  if (canonicalJson(seal.payload) !== canonicalJson(expectedPayload)) {
    throw new Error('T17 host chain receipt differs from its sealed payload.');
  }
  if (!/^[0-9a-f]{64}$/.test(receipt.cli.tarballSha256) || !/^[0-9a-f]{64}$/.test(receipt.cli.manifestSha256)
    || !/^[0-9a-f]{64}$/.test(receipt.cli.entrySha256) || !Number.isSafeInteger(receipt.cli.tarballBytes) || receipt.cli.tarballBytes < 1
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(receipt.cli.version)) {
    throw new Error('T17 host chain frozen CLI identity is invalid.');
  }
  if (!isRecord(receipt.projectRoots) || !(['vue', 'react'] as const).every(framework => typeof receipt.projectRoots[framework] === 'string' && isAbsolute(receipt.projectRoots[framework] as string))) {
    throw new Error('T17 host chain must bind both owned project roots.');
  }
  const persistedPath = resolve(receipt.receiptEvidencePath);
  if (relative(evidenceRoot, persistedPath) !== join('files', 't17-host-acceptance.json')) {
    throw new Error('T17 host chain persisted receipt escapes its retained files directory.');
  }
  const persistedStat = await lstat(persistedPath);
  if (!persistedStat.isFile() || persistedStat.isSymbolicLink() || persistedStat.nlink > 1) {
    throw new Error('T17 host chain persisted receipt is not an ordinary retained file.');
  }
  const persistedBytes = await readFile(persistedPath);
  const receiptEntry = seal.files.find((entry: unknown) => isRecord(entry) && entry.name === 't17-host-acceptance.json');
  if (!isRecord(receiptEntry) || receiptEntry.bytes !== persistedBytes.length || receiptEntry.sha256 !== sha(persistedBytes)) {
    throw new Error('T17 host chain persisted receipt differs from its sealed inventory.');
  }
  let persisted: unknown;
  try { persisted = JSON.parse(persistedBytes.toString('utf8')); } catch { throw new Error('T17 host chain persisted receipt is not valid JSON.'); }
  const expectedPersisted = { ...receipt, sealPath: '', sealSha256: '' };
  if (!isRecord(persisted) || canonicalJson(persisted) !== canonicalJson(expectedPersisted)) {
    throw new Error('T17 host chain persisted receipt differs from the caller-facing receipt.');
  }
  if (!Array.isArray(seal.files) || new Set(seal.files.map((entry: unknown) => isRecord(entry) ? entry.name : '')).size !== seal.files.length) {
    throw new Error('T17 host chain seal contains duplicate or invalid evidence inventory entries.');
  }

  for (const chain of receipt.chains) {
    if (!['vue', 'react'].includes(chain.framework)) throw new Error('T17 host chain has an unsupported framework identity.');
    assertBoundedRepairBudget(chain.repairMaxAttempts);
    if (chain.planStatus !== 'planned' || chain.applyStatus !== 'applied' || chain.childProcessesCleaned !== true) {
      throw new Error(`T17 host chain (${chain.framework}) did not complete plan → apply with cleaned child processes.`);
    }
    if (chain.repairAttempts < 0 || !Number.isSafeInteger(chain.repairAttempts) || chain.repairAttempts > chain.repairMaxAttempts) throw new Error(`T17 host chain (${chain.framework}) exceeded or malformed its repair budget.`);
    const evidencePaths = [
      chain.planEvidence,
      chain.applyEvidence,
      chain.specEvidence,
      chain.verifyEvidence,
      ...(chain.repairEvidence ? [chain.repairEvidence] : []),
      ...(chain.builtImportEvidence ? [chain.builtImportEvidence] : []),
    ];
    if (new Set(evidencePaths.map(value => resolve(value))).size !== evidencePaths.length) throw new Error(`T17 host chain (${chain.framework}) reuses a stage evidence file.`);
    const evidenceBytes = new Map<string, Buffer>();
    for (const filePath of evidencePaths) {
      const abs = resolve(filePath);
      const rel = relative(evidenceRoot, abs);
      if (!isAbsolute(abs) || !rel.startsWith('files' + sep) || rel.split(sep).length !== 2) {
        throw new Error(`T17 host chain evidence escapes retained files directory: ${filePath}`);
      }
      const stat = await lstat(abs);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
        throw new Error(`T17 host chain evidence is not an ordinary retained file: ${filePath}`);
      }
      const bytes = await readFile(abs);
      const name = rel.slice(('files' + sep).length).replaceAll(sep, '/');
      const sealed = seal.files.find((entry: unknown) => isRecord(entry) && entry.name === name);
      if (!isRecord(sealed) || sealed.bytes !== bytes.length || sealed.sha256 !== sha(bytes)) {
        throw new Error(`T17 host chain evidence differs from its retained seal: ${name}`);
      }
      evidenceBytes.set(filePath, bytes);
    }
    const parseEvidence = (path: string, stage: string) => {
      try { return JSON.parse(evidenceBytes.get(path)!.toString('utf8')) as unknown; }
      catch { throw new Error(`T17 host chain (${chain.framework}) ${stage} evidence is not valid JSON.`); }
    };
    const planResult = validateIntegrationPlan(parseEvidence(chain.planEvidence, 'plan'));
    if (!planResult.ok || planResult.value.status !== 'planned' || planResult.value.sourceMatchPlan.context.framework !== chain.framework
      || digest(planResult.value) !== chain.planDigest) throw new Error(`T17 host chain (${chain.framework}) plan evidence failed contract, framework, or digest validation.`);
    const plan = planResult.value;
    const expectedRoot = resolve(receipt.projectRoots[chain.framework]!).replaceAll('\\', '/');
    const applyRaw = parseEvidence(chain.applyEvidence, 'apply');
    if (!isRecord(applyRaw)) throw new Error(`T17 host chain (${chain.framework}) apply evidence is invalid.`);
    const applyResult = validateIntegrationApplyResult(applyRaw, { plan, planDigest: chain.planDigest, projectRoot: expectedRoot });
    if (!applyResult.ok || applyResult.value.status !== 'applied' || digest(applyResult.value) !== chain.applyResultDigest
      || applyResult.value.projectRoot !== expectedRoot || chain.projectRoot !== expectedRoot) throw new Error(`T17 host chain (${chain.framework}) apply evidence failed contract, project-root, or digest validation.`);
    const apply = applyResult.value;
    const specRaw = parseEvidence(chain.specEvidence, 'spec');
    const specResult = validateIntegrationVerificationSpec(specRaw, { projectRoot: expectedRoot, planDigest: chain.planDigest, applyResultDigest: chain.applyResultDigest, plan, applyResult: apply });
    if (!specResult.ok || digest(specResult.value) !== chain.specDigest) throw new Error(`T17 host chain (${chain.framework}) verification spec failed contract or digest validation.`);
    const spec = specResult.value;
    const reportRaw = parseEvidence(chain.verifyEvidence, 'verify');
    const reportResult = validateIntegrationVerificationReport(reportRaw, { projectRoot: expectedRoot, planDigest: chain.planDigest, applyResultDigest: chain.applyResultDigest, specDigest: chain.specDigest, plan, applyResult: apply, spec });
    if (!reportResult.ok || digest(reportResult.value) !== chain.verifyReportDigest || reportResult.value.status !== chain.verifyStatus) {
      throw new Error(`T17 host chain (${chain.framework}) verification report failed contract, status, or digest validation.`);
    }
    const areaName = `t17-${chain.framework}-verify-out`;
    const areas = isRecord(seal.inventories) && isRecord(seal.inventories.evidenceAreas) ? seal.inventories.evidenceAreas : {};
    const retainedArtifacts = await readRetainedArtifactInventory(join(evidenceRoot, areaName), areas[areaName]);
    verifyRetainedArtifactRefs(reportResult.value.artifacts, retainedArtifacts);
    const baseline = spec.browser?.visual?.baseline.image;
    if (baseline) verifyRetainedArtifactRefs([baseline], retainedArtifacts);
    if (chain.verifyStatus === 'passed') {
      if (chain.repairStatus !== 'not-needed' || chain.repairAttempts !== 0 || chain.repairEvidence || chain.repairResultDigest) throw new Error(`T17 host chain (${chain.framework}) has inconsistent unnecessary repair evidence.`);
    } else {
      if (chain.verifyStatus !== 'failed') throw new Error(`T17 host chain (${chain.framework}) cannot claim successful repair after a blocked verification.`);
      if (chain.repairStatus !== 'repaired' || !chain.repairEvidence || !chain.repairResultDigest || chain.repairAttempts < 1) throw new Error(`T17 host chain (${chain.framework}) did not provide successful repair evidence.`);
      const repairRaw = parseEvidence(chain.repairEvidence, 'repair');
      if (!isRecord(repairRaw)) throw new Error(`T17 host chain (${chain.framework}) repair evidence is invalid.`);
      const repairResult = validateIntegrationRepairResult(repairRaw, {
        projectRoot: expectedRoot, planDigest: chain.planDigest, applyResultDigest: chain.applyResultDigest, specDigest: chain.specDigest,
        plan, applyResult: apply, spec, reportDigest: chain.verifyReportDigest, sourceReport: reportResult.value,
      });
      if (!repairResult.ok || repairResult.value.status !== 'repaired' || repairResult.value.attempts.length !== chain.repairAttempts
        || digest(repairResult.value) !== chain.repairResultDigest) throw new Error(`T17 host chain (${chain.framework}) repair evidence failed contract, status, attempt, or digest validation.`);
      verifyRetainedArtifactRefs(repairResult.value.finalReport.artifacts, retainedArtifacts);
      verifyRetainedRepairBackups(repairResult.value, retainedArtifacts);
    }
  }
}

async function registerHostPaths(run: Awaited<ReturnType<typeof createOwnedRun>>, framework: Framework): Promise<void> {
  const root = run.projectRoots[framework];
  const candidates = [
    'package.json', '.t17-hook.cjs', 'index.html', 'tsconfig.json',
    'src/vite-env.d.ts', 'src/components/zhinexus', 'src/main.ts', 'src/main.tsx',
    'src/App.vue', 'vite.config.mts', '.t17-install', 'node_modules', 'package-lock.json', 'dist',
  ];
  const existing: string[] = [];
  for (const rel of candidates) {
    if (await lstat(resolve(root, rel)).then(() => true).catch(() => false)) {
      existing.push(rel);
    }
  }
  await run.registerOwnedPath(root, existing);
}

/**
 * 运行完整 T17 owned-host 临时消费者真实 CLI 验收链（Vue + React）。
 * 缺失冻结 tarball、服务凭据、SDK bundle 或变体映射时立即 fail-closed。
 */
export async function runT17HostAcceptanceChain(options: T17HostChainOptions): Promise<T17HostChainReceipt> {
  const maxRepairAttempts = assertBoundedRepairBudget(options.maxRepairAttempts ?? 2);
  // Fail-closed: 校验全部冻结产物、服务 URL、凭据与变体映射
  const inputs = await loadT17HostInputs(options.env);
  const toolchain = resolveT17FixedToolchain(options.repositoryRoot);
  const allowBrowser = options.allowBrowser ?? false;

  const run = await createOwnedRun({ baseDirectory: tmpdir() });
  let sealed = false;
  // 在 try 外声明，catch 分支需要据此仅登记尚未登记的框架工程以便失败清理
  const registeredFrameworks = new Set<Framework>();
  const evidenceAreas = new Set<string>();
  const createChainEvidenceArea = async (name: string) => {
    const area = await run.createEvidenceArea(name);
    evidenceAreas.add(area);
    return area;
  };
  const authEnv = {
    ZHINEXUS_API_TOKEN: inputs.apiToken,
    ZHINEXUS_REGISTRY_TOKEN: inputs.registryToken,
  };

  try {
    const installed = await installFrozenCli({
      run,
      tarballPath: inputs.cliTarball,
      nodeExecutable: toolchain.nodeExecutable,
      npmCliPath: toolchain.npmCliPath,
      expectedVersion: inputs.cliVersion,
      expectedTarballSha256: inputs.cliSha256,
      registry: inputs.registryUrl,
    });
    const installation: FrozenCliInstallation = {
      root: installed.root,
      entry: installed.entry,
      entrySha256: installed.entrySha256,
      version: installed.version,
    };

    const chains: T17FrameworkChainEvidence[] = [];
    for (const framework of ['vue', 'react'] as const) {
      const project = await scaffoldConsumerProject(run, framework, 'npm');
      await installDependencies(run, {
        projectRoot: project.root,
        manager: 'npm',
        toolchain,
        registry: inputs.registryUrl,
      });

      const workArea = await createChainEvidenceArea(`t17-${framework}-work`);
      const backupArea = await createChainEvidenceArea(`t17-${framework}-backups`);
      const verifyOutArea = await createChainEvidenceArea(`t17-${framework}-verify-out`);
      // Product verification preserves TEMP/TMP while sanitizing optional build
      // variables. Native compiler caches must stay outside source snapshots.
      const scriptTmp = await createChainEvidenceArea(`t17-${framework}-script-temp`);
      const baseTempEnv = {
        TEMP: scriptTmp, TMP: scriptTmp, NODE_DISABLE_COMPILE_CACHE: '1',
        PLAYWRIGHT_BROWSERS_PATH: join(toolchain.repositoryRoot, '.tools', 'playwright'),
      };

      // 1. Plan（从权威匹配 API 获取完整 target，再交叉绑定冻结 SDK 身份，绝不自行合成空 evidence 或硬编码 verified）
      const authoritativeMatch = await fetchAuthoritativeTargetForHost(framework, inputs, options.timeoutMs);
      const matchPlan = buildMatchPlanForHost(framework, inputs, {
        faultLayout: options.faultLayoutForRepair?.[framework],
        authoritativeMatch,
      });
      const matchFile = join(workArea, 'match.json');
      await writeFile(matchFile, JSON.stringify(matchPlan, null, 2) + '\n', { flag: 'wx' });
      const planRun = await runFrozenCli(run, {
        installation,
        projectRoot: project.root,
        args: [
          'integrate', 'plan',
          '--project', project.root,
          '--match', matchFile,
          '--api-url', inputs.apiUrl,
          '--registry', inputs.registryUrl,
        ],
        extraEnv: { ...baseTempEnv, ...authEnv },
        toolchain,
        timeoutMs: options.timeoutMs,
      });
      if (planRun.exitCode !== 0 || planRun.timedOut) {
        throw new Error(`Frozen CLI integrate plan failed for ${framework} (exit=${String(planRun.exitCode)}).`);
      }
      const planStdout = await readFile(planRun.stdoutEvidence, 'utf8');
      const plan = parsePlanOutput(planStdout, framework);
      const planDigest = digest(plan);
      const planFile = join(workArea, 'plan.json');
      await writeFile(planFile, planStdout, { flag: 'wx' });

      // 2. Explicit-authorization Apply
      const deliveryGuard = await run.prepareInstallDelivery({ projectRoot: project.root, backupRoot: backupArea, planDigest });
      const applyRun = await runFrozenCli(run, {
        installation,
        projectRoot: project.root,
        args: [
          'integrate', 'apply',
          '--project', project.root,
          '--plan', planFile,
          '--api-url', inputs.apiUrl,
          '--registry', inputs.registryUrl,
          '--backup-root', backupArea,
          '--allow-install', 'true',
        ],
        extraEnv: { ...baseTempEnv, ...authEnv },
        toolchain,
        timeoutMs: options.timeoutMs,
      });
      if (applyRun.exitCode !== 0 || applyRun.timedOut) {
        throw new Error(`Frozen CLI integrate apply failed for ${framework} (exit=${String(applyRun.exitCode)}).`);
      }
      await assertLifecycleHooksSuppressed(project.root);
      const canonicalRoot = (await realpath(project.root)).replaceAll('\\', '/');
      const applyStdout = await readFile(applyRun.stdoutEvidence, 'utf8');
      const applyResult = parseApplyOutput(applyStdout, canonicalRoot, planDigest);
      await deliveryGuard.register(applyResult.operationId);
      const applyResultDigest = digest(applyResult);
      const applyFile = join(workArea, 'apply.json');
      await writeFile(applyFile, applyStdout, { flag: 'wx' });

      await wireAppliedGeneratedComponent(project, { dataKey: 'revenue', eventKey: 'onChartClick' });
      if (framework === 'vue') {
        const appPath = join(project.root, 'src/App.vue');
        const appSource = await readFile(appPath, 'utf8');
        await writeFile(appPath, normalizeVueHostGeneratedImport(appSource, project.generatedPath));
      }

      // 3. Build & Browser Host (when allowBrowser is enabled) + Verify
      let browserSpec: IntegrationVerificationSpecV1['browser'] | undefined;
      let builtImportEvidencePath: string | undefined;
      let builtHost: Awaited<ReturnType<typeof startBuiltHost>> | undefined;
      const workFiles = ['match.json', 'plan.json', 'apply.json', 'spec.json', 'report.json'];

      try {
        if (allowBrowser) {
          const buildGraphFile = join(workArea, 'build-graph.json');
          workFiles.push('build-graph.json');
          const buildRes = await runConsumerScript(run, project, 'build', toolchain, {
            ...baseTempEnv,
            T17_BUILD_GRAPH_OUT: buildGraphFile,
          });
          if (buildRes.code !== 0) {
            throw new Error(`Owned ${framework} host build failed before browser verification (exit=${String(buildRes.code)}).`);
          }
          const graphEvidence = await readBuiltGraphEvidence(project.root, buildGraphFile);
          builtHost = await startBuiltHost({ projectRoot: project.root, run });
          const loadedAssets = await collectBrowserLoadedAssets(builtHost, {
            readySelector: '[data-testid="ready"]',
            timeoutMs: options.timeoutMs ?? 30_000,
          });
          const importProof = await verifyBuiltImportEvidence({
            projectRoot: project.root,
            generatedPath: project.generatedPath,
            emittedEntry: graphEvidence.emittedEntry,
            sourceMapPath: graphEvidence.sourceMapPath,
            viteModules: graphEvidence.viteModules,
            host: builtHost,
            loadedAssets,
            emittedAssetSha256: graphEvidence.emittedAssetSha256,
          });
          builtImportEvidencePath = (
            await run.writeEvidence(
              `t17-${framework}-built-import.json`,
              Buffer.from(JSON.stringify(importProof, null, 2) + '\n'),
            )
          ).path;

          const approvedBaseline = options.visualBaselines?.[framework];
          const stagedBaseline = approvedBaseline
            ? await stageApprovedVisualBaseline(approvedBaseline, verifyOutArea, framework)
            : undefined;
          browserSpec = buildHostBrowserSpec({
            url: builtHost.url,
            stagedBaseline,
            timeoutMs: options.timeoutMs ?? 30_000,
            actions: options.browserActions,
            assertions: options.browserAssertions,
          });
        }

        const pkgBytes = await readFile(join(project.root, 'package.json'));
        const spec = buildVerificationSpecForHost({
          canonicalProjectRoot: canonicalRoot,
          planDigest,
          applyResultDigest,
          manifestSha256: sha(pkgBytes),
          browser: browserSpec,
          timeoutMs: options.timeoutMs,
        });
        const specDigest = digest(spec);
        const specEvidence = (await run.writeEvidence(`t17-${framework}-spec.json`, Buffer.from(JSON.stringify(spec, null, 2) + '\n'))).path;
        const specFile = join(workArea, 'spec.json');
        await writeFile(specFile, JSON.stringify(spec, null, 2) + '\n', { flag: 'wx' });

        const verifyRun = await runFrozenCli(run, {
          installation,
          projectRoot: project.root,
          args: [
            'integrate', 'verify',
            '--project', project.root,
            '--plan', planFile,
            '--apply-result', applyFile,
            '--spec', specFile,
            '--out', verifyOutArea,
            '--allow-project-scripts', 'true',
            '--allow-browser', allowBrowser ? 'true' : 'false',
          ],
          extraEnv: baseTempEnv,
          toolchain,
          timeoutMs: options.timeoutMs,
        });
        if ((verifyRun.exitCode !== 0 && verifyRun.exitCode !== 2) || verifyRun.timedOut) {
          throw new Error(`Frozen CLI integrate verify crashed for ${framework} (exit=${String(verifyRun.exitCode)}).`);
        }
        const verifyStdout = await readFile(verifyRun.stdoutEvidence, 'utf8');
        const verifyReport = parseVerifyOutput(verifyStdout, canonicalRoot, planDigest, applyResultDigest, specDigest);
        const verifyReportDigest = digest(verifyReport);
        const reportFile = join(workArea, 'report.json');
        await writeFile(reportFile, verifyStdout, { flag: 'wx' });

        // 4. Bounded Repair (only when verify did not pass and budget > 0)
        let repairStatus: T17FrameworkChainEvidence['repairStatus'] = 'not-needed';
        let repairAttempts = 0;
        let repairResultDigest: string | undefined;
        let repairEvidence: string | undefined;

        if (verifyReport.status === 'failed' && maxRepairAttempts > 0) {
          const repairRun = await runFrozenCli(run, {
            installation,
            projectRoot: project.root,
            args: [
              'integrate', 'repair',
              '--project', project.root,
              '--plan', planFile,
              '--apply-result', applyFile,
              '--spec', specFile,
              '--report', reportFile,
              '--out', verifyOutArea,
              '--allow-project-scripts', 'true',
              '--allow-browser', allowBrowser ? 'true' : 'false',
              '--max-attempts', String(maxRepairAttempts),
            ],
            extraEnv: baseTempEnv,
            toolchain,
            timeoutMs: options.timeoutMs,
          });
          if ((repairRun.exitCode !== 0 && repairRun.exitCode !== 2) || repairRun.timedOut) {
            throw new Error(`Frozen CLI integrate repair crashed for ${framework} (exit=${String(repairRun.exitCode)}).`);
          }
          const repairStdout = await readFile(repairRun.stdoutEvidence, 'utf8');
          const repairResult = parseRepairOutput(
            repairStdout,
            canonicalRoot,
            planDigest,
            applyResultDigest,
            specDigest,
            verifyReportDigest,
            maxRepairAttempts,
          );
          repairStatus = repairResult.status;
          repairAttempts = repairResult.attempts.length;
          repairResultDigest = digest(repairResult);
          repairEvidence = repairRun.stdoutEvidence;
        }

        await registerHostPaths(run, framework);
        registeredFrameworks.add(framework);
        await run.registerEvidenceAreaContents(workArea, workFiles);
        const backupEntries = await readdir(backupArea);
        if (backupEntries.length > 0) await run.registerEvidenceAreaContents(backupArea, backupEntries);
        const verifyEntries = await readdir(verifyOutArea);
        if (verifyEntries.length > 0) await run.registerEvidenceAreaContents(verifyOutArea, verifyEntries);
        const scriptTempEntries = await readdir(scriptTmp);
        if (scriptTempEntries.length > 0) await run.registerEvidenceAreaContents(scriptTmp, scriptTempEntries);

        if (verifyReport.status !== 'passed' && repairStatus !== 'repaired') {
          throw new Error(
            `T17 host chain (${framework}) did not pass verification or repair (verify=${verifyReport.status}, repair=${repairStatus}).`,
          );
        }

        chains.push({
          framework,
          packageManager: 'npm',
          planStatus: 'planned',
          applyStatus: 'applied',
          verifyStatus: verifyReport.status,
          repairStatus,
          repairMaxAttempts: maxRepairAttempts,
          repairAttempts,
          planDigest,
          applyResultDigest,
          specDigest,
          verifyReportDigest,
          projectRoot: canonicalRoot,
          ...(repairResultDigest ? { repairResultDigest } : {}),
          planEvidence: planRun.stdoutEvidence,
          applyEvidence: applyRun.stdoutEvidence,
          specEvidence,
          verifyEvidence: verifyRun.stdoutEvidence,
          ...(repairEvidence ? { repairEvidence } : {}),
          ...(builtImportEvidencePath ? { builtImportEvidence: builtImportEvidencePath } : {}),
          childProcessesCleaned: true,
        });
      } finally {
        await builtHost?.close();
      }
    }

    await run.stopOwnedProcesses();

    const receiptPath = resolve(run.evidenceRoot, 'files', 't17-host-acceptance.json');
    const receipt: T17HostChainReceipt = {
      schemaVersion: 1,
      acceptanceKind: 't17-owned-host-chain',
      productionAcceptance: false,
      runId: run.runId,
      evidenceRoot: run.evidenceRoot,
      result: 'passed',
      receiptEvidencePath: receiptPath,
      sealPath: '',
      sealSha256: '',
      projectRoots: { vue: run.projectRoots.vue, react: run.projectRoots.react },
      cli: {
        root: installed.root,
        entry: installed.entry,
        entrySha256: installed.entrySha256,
        version: installed.version,
        tarballSha256: installed.tarballSha256,
        tarballBytes: installed.tarballBytes,
        manifestSha256: installed.manifestSha256,
      },
      chains,
      childProcessesCleaned: true,
    };

    await run.writeEvidence('t17-host-acceptance.json', Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
    receipt.sealPath = await run.sealEvidence({
      acceptanceKind: 't17-owned-host-chain',
      productionAcceptance: false,
      result: receipt.result,
      cli: receipt.cli,
      chains: receipt.chains,
      projectRoots: receipt.projectRoots,
      childProcessesCleaned: receipt.childProcessesCleaned,
      receiptEvidencePath: 'files/t17-host-acceptance.json',
    });
    sealed = true;
    receipt.sealSha256 = sha(await readFile(receipt.sealPath));
    await run.cleanup();
    await verifyHostChainReceipt(receipt);
    return receipt;
  } catch (error) {
    if (sealed) throw error;
    await run.stopOwnedProcesses().catch(() => undefined);
    // Partial plan/apply/build output must be inventoried before failure cleanup.
    // The native registration still rejects a replaced area or changed prior content.
    for (const area of evidenceAreas) {
      try {
        const entries = await readdir(area);
        if (entries.length > 0) await run.registerEvidenceAreaContents(area, entries);
      } catch { /* preserveFailedInspectEvidence reports any unsafe cleanup. */ }
    }
    for (const fw of ['vue', 'react'] as const) {
      if (!registeredFrameworks.has(fw)) {
        await registerHostPaths(run, fw).catch(() => undefined);
      }
    }
    const retained = await preserveFailedInspectEvidence(run);
    const errorName = error instanceof Error ? error.name : 'Error';
    const rawMsg = error instanceof Error ? error.message : String(error);
    const safeMsg = rawMsg
      .replaceAll(inputs.apiToken, '[REDACTED]')
      .replaceAll(inputs.registryToken, '[REDACTED]');
    const cleanupNote = retained.projectCleanupFailed
      ? ` Temporary project cleanup also failed; inspect owned root ${run.parentRoot}.`
      : '';
    throw new Error(
      `T17 owned-host CLI chain acceptance failed (${errorName}: ${safeMsg}). Failure evidence retained at ${retained.evidenceRoot}.${cleanupNote}`,
    );
  }
}
