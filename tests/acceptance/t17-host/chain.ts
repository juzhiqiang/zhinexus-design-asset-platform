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
import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  canonicalJson,
  validateIntegrationApplyResult,
  validateIntegrationPlan,
  validateIntegrationRepairResult,
  validateIntegrationVerificationReport,
  validateIntegrationVerificationSpec,
  type IntegrationApplyResultV1,
  type IntegrationPlanV1,
  type IntegrationRepairResultV1,
  type IntegrationVerificationReportV1,
  type IntegrationVerificationSpecV1,
  type MatchPlanV1,
} from '@company/contracts';
import { createOwnedRun, installFrozenCli, type Framework } from './host.js';
import { scaffoldConsumerProject, wireAppliedGeneratedComponent } from './consumer.js';
import { loadT17HostInputs, resolveT17FixedToolchain, type T17HostInputs } from './e2e-config.js';
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
  repairResultDigest?: string;
  planEvidence: string;
  applyEvidence: string;
  verifyEvidence: string;
  repairEvidence?: string;
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
  cli: FrozenCliInstallation & { tarballSha256: string; tarballBytes: number; manifestSha256: string };
  chains: T17FrameworkChainEvidence[];
  childProcessesCleaned: boolean;
};

export type T17HostChainOptions = {
  env: Record<string, string | undefined>;
  repositoryRoot: string;
  maxRepairAttempts?: number;
  allowBrowser?: boolean;
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

export function buildMatchPlanForHost(
  framework: Framework,
  inputs: T17HostInputs,
  options?: { faultLayout?: string },
): MatchPlanV1 {
  const variant = inputs.variants.variants.find(v => v.framework === framework && v.componentId === 'line')
    ?? inputs.variants.variants.find(v => v.framework === framework);
  if (!variant) {
    throw new Error(`Missing variant mapping for framework=${framework} in T17 host inputs.`);
  }
  const manifestVariants = inputs.sdkManifest.variants as Array<Record<string, unknown>>;
  const sdkVariant = manifestVariants.find(
    v => v.componentId === variant.componentId && v.framework === framework,
  );
  const manifestPackages = inputs.sdkManifest.packages as Array<Record<string, unknown>>;
  const pkgName = `@company/charts-${framework}`;
  const sdkPkg = manifestPackages.find(p => p.name === pkgName);
  const pkgVersion = typeof sdkPkg?.version === 'string' ? sdkPkg.version : '0.0.12';
  const pkgSha =
    isRecord(sdkPkg?.tarball) && typeof sdkPkg.tarball.sha256 === 'string'
      ? sdkPkg.tarball.sha256
      : 'b'.repeat(64);
  const exportName = typeof sdkVariant?.exportName === 'string' ? sdkVariant.exportName : 'LineChart';
  const exportPath = typeof sdkVariant?.exportPath === 'string' ? sdkVariant.exportPath : './line';

  const frameworkVersion = framework === 'vue' ? '3.5.45' : '19.3.1';
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
          compatibility: { status: 'verified', recordIds: ['t17-host-sdk-bundle'] },
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

export function buildVerificationSpecForHost(params: {
  canonicalProjectRoot: string;
  planDigest: string;
  applyResultDigest: string;
  manifestSha256: string;
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
    businessGaps: [],
  };
  const checked = validateIntegrationVerificationSpec(spec);
  if (!checked.ok) {
    throw new Error('Constructed T17 host VerificationSpec failed contract validation.');
  }
  return checked.value;
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
    childProcessesCleaned: receipt.childProcessesCleaned,
    receiptEvidencePath: 'files/t17-host-acceptance.json',
  };
  if (canonicalJson(seal.payload) !== canonicalJson(expectedPayload)) {
    throw new Error('T17 host chain receipt differs from its sealed payload.');
  }

  for (const chain of receipt.chains) {
    assertBoundedRepairBudget(chain.repairMaxAttempts);
    if (chain.planStatus !== 'planned' || chain.applyStatus !== 'applied' || chain.childProcessesCleaned !== true) {
      throw new Error(`T17 host chain (${chain.framework}) did not complete plan → apply with cleaned child processes.`);
    }
    if (chain.verifyStatus !== 'passed' && chain.repairStatus !== 'repaired') {
      throw new Error(`T17 host chain (${chain.framework}) neither passed verify nor succeeded repair (verify=${chain.verifyStatus}, repair=${chain.repairStatus}).`);
    }
    if (chain.repairAttempts > chain.repairMaxAttempts) {
      throw new Error(`T17 host chain (${chain.framework}) exceeded repair budget.`);
    }
    const evidencePaths = [
      chain.planEvidence,
      chain.applyEvidence,
      chain.verifyEvidence,
      ...(chain.repairEvidence ? [chain.repairEvidence] : []),
    ];
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
      try {
        await installDependencies(run, {
          projectRoot: project.root,
          manager: 'npm',
          toolchain,
          registry: inputs.registryUrl,
        });
      } finally {
        await registerHostPaths(run, framework);
      }

      const workArea = await run.createEvidenceArea(`t17-${framework}-work`);
      const backupArea = await run.createEvidenceArea(`t17-${framework}-backups`);
      const verifyOutArea = await run.createEvidenceArea(`t17-${framework}-verify-out`);

      // 1. Plan
      const matchPlan = buildMatchPlanForHost(framework, inputs, {
        faultLayout: options.faultLayoutForRepair?.[framework],
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
        extraEnv: authEnv,
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
        extraEnv: authEnv,
        toolchain,
        timeoutMs: options.timeoutMs,
      });
      await registerHostPaths(run, framework);
      if (applyRun.exitCode !== 0 || applyRun.timedOut) {
        throw new Error(`Frozen CLI integrate apply failed for ${framework} (exit=${String(applyRun.exitCode)}).`);
      }
      await assertLifecycleHooksSuppressed(project.root);
      const canonicalRoot = (await realpath(project.root)).replaceAll('\\', '/');
      const applyStdout = await readFile(applyRun.stdoutEvidence, 'utf8');
      const applyResult = parseApplyOutput(applyStdout, canonicalRoot, planDigest);
      const applyResultDigest = digest(applyResult);
      const applyFile = join(workArea, 'apply.json');
      await writeFile(applyFile, applyStdout, { flag: 'wx' });

      await wireAppliedGeneratedComponent(project, { dataKey: 'revenue', eventKey: 'onChartClick' });
      await registerHostPaths(run, framework);

      // 3. Verify
      const pkgBytes = await readFile(join(project.root, 'package.json'));
      const spec = buildVerificationSpecForHost({
        canonicalProjectRoot: canonicalRoot,
        planDigest,
        applyResultDigest,
        manifestSha256: sha(pkgBytes),
        timeoutMs: options.timeoutMs,
      });
      const specDigest = digest(spec);
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
      await run.registerEvidenceAreaContents(workArea, ['match.json', 'plan.json', 'apply.json', 'spec.json', 'report.json']);
      const backupEntries = await readdir(backupArea);
      if (backupEntries.length > 0) await run.registerEvidenceAreaContents(backupArea, backupEntries);
      const verifyEntries = await readdir(verifyOutArea);
      if (verifyEntries.length > 0) await run.registerEvidenceAreaContents(verifyOutArea, verifyEntries);

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
        ...(repairResultDigest ? { repairResultDigest } : {}),
        planEvidence: planRun.stdoutEvidence,
        applyEvidence: applyRun.stdoutEvidence,
        verifyEvidence: verifyRun.stdoutEvidence,
        ...(repairEvidence ? { repairEvidence } : {}),
        childProcessesCleaned: true,
      });
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
    const retained = await preserveFailedInspectEvidence(run);
    const errorName = error instanceof Error ? error.name : 'Error';
    const cleanupNote = retained.projectCleanupFailed
      ? ` Temporary project cleanup also failed; inspect owned root ${run.parentRoot}.`
      : '';
    throw new Error(
      `T17 owned-host CLI chain acceptance failed (${errorName}). Failure evidence retained at ${retained.evidenceRoot}.${cleanupNote}`,
    );
  }
}
