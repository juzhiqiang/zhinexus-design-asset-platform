import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export type ProbeDimensionStatus = 'passed' | 'failed' | 'not-run';

export interface SupportedCombination {
  framework: 'vue' | 'react';
  frameworkVersion: string;
  reactDomVersion?: string;
  echartsVersion: string;
  reportId: string;
  verifiedAt: string;
}

export interface EchartsCheckOptions {
  bundleDir: string;
  echartsVersion?: string;
  registry?: string;
}

export interface EchartsCheckResult {
  ok: boolean;
  errorCode?: string;
  error?: string;
  bundleDir?: string;
  bundleVersion?: string;
  baselineEchartsVersion?: string;
  candidateEchartsVersion?: string;
  peerSatisfied?: boolean;
  hasDualFrameworkCoverage?: boolean;
  supported?: SupportedCombination[];
  verifyRequired?: boolean;
}

export interface ProbeCombinationRecord {
  framework: string;
  frameworkVersion?: string;
  echartsVersion?: string;
  dimensions: {
    typecheck: ProbeDimensionStatus;
    runtime: ProbeDimensionStatus;
    interaction: ProbeDimensionStatus;
    visual: ProbeDimensionStatus;
  };
  failures?: Array<{ dimension?: string; reason?: string; detail?: string }>;
}

export interface ProbeEvidence {
  schemaVersion: 1;
  kind: 'a-t10-sdk-probe';
  generatedAt?: string;
  bundle: {
    version: string;
    packages: Array<{ name: string; version: string; sha256: string; bytes: number }>;
  };
  candidate: {
    version: string;
    integrity?: string;
    source?: string;
    resolution?: string;
  };
  combinations: ProbeCombinationRecord[];
  policy: {
    peerSatisfied: boolean;
    supportedRangeUnchanged?: boolean;
    requiresVisualBaselineConfirmation: boolean;
    hasDualFrameworkCoverage: boolean;
  };
  recommendation: string;
  uncovered: string[];
}

export interface EchartsVerifyOptions {
  bundleDir: string;
  echartsVersion?: string;
  frameworks?: string;
  components?: string;
  presentations?: string;
  registry?: string;
  peer?: string;
  outDir?: string;
  label?: string;
  consumerRoot?: string;
  baseline?: string;
  keep?: boolean;
  skipBrowser?: boolean;
  probeEntry?: string;
  timeoutMs?: number;
}

export interface EchartsVerifyResult {
  ok: boolean;
  errorCode?: string;
  error?: string;
  probeExitCode?: number;
  recommendation?: string;
  uncovered?: string[];
  evidence?: ProbeEvidence;
  stderr?: string;
}

const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+$/;
const REQUIRED_SDK_PACKAGES = ['@company/charts-core', '@company/charts-vue', '@company/charts-react'] as const;
const VALID_DIMENSIONS = new Set<ProbeDimensionStatus>(['passed', 'failed', 'not-run']);

function isInsideDir(baseDir: string, targetPath: string): boolean {
  const rel = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function readAndVerifyFrozenBundle(bundleDir: string): Promise<
  | {
      ok: true;
      bundleDir: string;
      bundleVersion: string;
      baselineEchartsVersion: string;
      supported: SupportedCombination[];
    }
  | { ok: false; errorCode: string; error: string }
> {
  const resolvedDir = path.resolve(bundleDir);
  const manifestPath = path.join(resolvedDir, 'manifest.json');

  let rawManifest: unknown;
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    rawManifest = JSON.parse(content);
  } catch (err: unknown) {
    return {
      ok: false,
      errorCode: 'INVALID_BUNDLE_MANIFEST',
      error: `无法读取冻结 bundle manifest (${manifestPath}): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) {
    return { ok: false, errorCode: 'INVALID_BUNDLE_MANIFEST', error: 'manifest.json 必须为 JSON 对象' };
  }

  const m = rawManifest as Record<string, unknown>;
  if (m.schemaVersion !== 1 || !Array.isArray(m.packages)) {
    return {
      ok: false,
      errorCode: 'INVALID_BUNDLE_MANIFEST',
      error: 'manifest.json 缺少合法的 schemaVersion=1 或 packages[]',
    };
  }

  const pkgEntries = m.packages.filter(
    (p): p is Record<string, unknown> => Boolean(p && typeof p === 'object' && !Array.isArray(p)),
  );
  if (pkgEntries.length !== REQUIRED_SDK_PACKAGES.length) {
    return {
      ok: false,
      errorCode: 'INVALID_BUNDLE_MANIFEST',
      error: `packages[] 必须恰好包含 ${REQUIRED_SDK_PACKAGES.join(', ')}`,
    };
  }

  const seenNames = new Set<string>();
  const packageVersions = new Set<string>();
  const echartsPeers = new Set<string>();

  for (const pkg of pkgEntries) {
    const name = typeof pkg.name === 'string' ? pkg.name : '';
    const pkgVersion = typeof pkg.version === 'string' ? pkg.version : '';
    const tarballObj =
      pkg.tarball && typeof pkg.tarball === 'object' && !Array.isArray(pkg.tarball)
        ? (pkg.tarball as Record<string, unknown>)
        : null;
    const tarballPath =
      tarballObj && typeof tarballObj.path === 'string'
        ? tarballObj.path
        : typeof pkg.tarballPath === 'string'
          ? pkg.tarballPath
          : '';
    const expectedSha =
      tarballObj && typeof tarballObj.sha256 === 'string'
        ? tarballObj.sha256
        : typeof pkg.sha256 === 'string'
          ? pkg.sha256
          : '';
    const expectedBytes =
      tarballObj && typeof tarballObj.bytes === 'number'
        ? tarballObj.bytes
        : typeof pkg.bytes === 'number'
          ? pkg.bytes
          : -1;

    if (!REQUIRED_SDK_PACKAGES.includes(name as (typeof REQUIRED_SDK_PACKAGES)[number]) || seenNames.has(name)) {
      return {
        ok: false,
        errorCode: 'INVALID_BUNDLE_MANIFEST',
        error: `packages[] 包含非法或重复包名: ${name || '(empty)'}`,
      };
    }
    if (!pkgVersion) {
      return {
        ok: false,
        errorCode: 'INVALID_BUNDLE_MANIFEST',
        error: `${name} 缺少 version`,
      };
    }
    seenNames.add(name);
    packageVersions.add(pkgVersion);

    const peers =
      pkg.peerDependencies && typeof pkg.peerDependencies === 'object' && !Array.isArray(pkg.peerDependencies)
        ? (pkg.peerDependencies as Record<string, unknown>)
        : null;
    const echartsPeer = peers && typeof peers.echarts === 'string' ? peers.echarts : '';
    if (!echartsPeer) {
      return {
        ok: false,
        errorCode: 'INVALID_BUNDLE_MANIFEST',
        error: `${name} 缺少 peerDependencies.echarts`,
      };
    }
    echartsPeers.add(echartsPeer);

    const absTarball = path.resolve(resolvedDir, tarballPath);
    if (!tarballPath || !isInsideDir(resolvedDir, absTarball)) {
      return {
        ok: false,
        errorCode: 'INVALID_BUNDLE_PATH',
        error: `${name} tarballPath 越界或无效: ${tarballPath}`,
      };
    }

    let fileBuf: Buffer;
    try {
      fileBuf = await fs.readFile(absTarball);
    } catch (err: unknown) {
      return {
        ok: false,
        errorCode: 'BUNDLE_FILE_MISSING',
        error: `缺少冻结 tarball ${tarballPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const actualSha = crypto.createHash('sha256').update(fileBuf).digest('hex');
    if (actualSha !== expectedSha || (expectedBytes >= 0 && fileBuf.length !== expectedBytes)) {
      return {
        ok: false,
        errorCode: 'BUNDLE_DIGEST_MISMATCH',
        error: `${name} tarball 摘要或字节数不匹配 (expected=${expectedSha}, actual=${actualSha})`,
      };
    }
  }

  if (packageVersions.size !== 1) {
    return {
      ok: false,
      errorCode: 'INVALID_BUNDLE_MANIFEST',
      error: `冻结 bundle 三个包版本必须一致，当前为: ${[...packageVersions].join(', ')}`,
    };
  }

  if (echartsPeers.size !== 1) {
    return {
      ok: false,
      errorCode: 'MIXED_PEER_BASELINE',
      error: `冻结 bundle 存在混合 echarts peer 基线: ${[...echartsPeers].join(', ')}`,
    };
  }

  const bundleVersion = [...packageVersions][0]!;
  const baselineEchartsVersion = [...echartsPeers][0]!;
  const supportedMap = new Map<string, SupportedCombination>();

  if (Array.isArray(m.variants)) {
    for (const v of m.variants) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const compatList = (v as { compatibility?: unknown }).compatibility;
      if (!Array.isArray(compatList)) continue;
      for (const rec of compatList) {
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
        const r = rec as Record<string, unknown>;
        if (
          r.status === 'passed' &&
          (r.framework === 'vue' || r.framework === 'react') &&
          typeof r.frameworkVersion === 'string' &&
          typeof r.echartsVersion === 'string' &&
          typeof r.reportId === 'string' &&
          r.reportId.length > 0 &&
          typeof r.verifiedAt === 'string' &&
          r.verifiedAt.length > 0
        ) {
          const key = `${r.framework}:${r.frameworkVersion}:${r.echartsVersion}`;
          if (!supportedMap.has(key)) {
            supportedMap.set(key, {
              framework: r.framework,
              frameworkVersion: r.frameworkVersion,
              ...(typeof r.reactDomVersion === 'string' ? { reactDomVersion: r.reactDomVersion } : {}),
              echartsVersion: r.echartsVersion,
              reportId: r.reportId,
              verifiedAt: r.verifiedAt,
            });
          }
        }
      }
    }
  }

  return {
    ok: true,
    bundleDir: resolvedDir,
    bundleVersion,
    baselineEchartsVersion,
    supported: [...supportedMap.values()],
  };
}

export async function checkEchartsBundle(options: EchartsCheckOptions): Promise<EchartsCheckResult> {
  if (!options.bundleDir) {
    return { ok: false, errorCode: 'MISSING_BUNDLE', error: '缺少必填参数 --bundle <dir>' };
  }

  const bundle = await readAndVerifyFrozenBundle(options.bundleDir);
  if (!bundle.ok) {
    return bundle;
  }

  const candidateEchartsVersion = options.echartsVersion?.trim() || bundle.baselineEchartsVersion;
  if (!EXACT_SEMVER_RE.test(candidateEchartsVersion)) {
    return {
      ok: false,
      errorCode: 'NOT_EXACT_VERSION',
      error: `候选 ECharts 版本必须为精确 x.y.z 字面量，收到: ${candidateEchartsVersion}`,
      bundleDir: bundle.bundleDir,
      bundleVersion: bundle.bundleVersion,
      baselineEchartsVersion: bundle.baselineEchartsVersion,
      candidateEchartsVersion,
    };
  }

  const matchingSupported = bundle.supported.filter((s) => s.echartsVersion === candidateEchartsVersion);
  const hasVue = matchingSupported.some((s) => s.framework === 'vue');
  const hasReact = matchingSupported.some((s) => s.framework === 'react');
  const hasDualFrameworkCoverage = hasVue && hasReact;
  const peerSatisfied = candidateEchartsVersion === bundle.baselineEchartsVersion;

  if (!peerSatisfied || !hasDualFrameworkCoverage) {
    return {
      ok: false,
      errorCode: !peerSatisfied ? 'PEER_UNSATISFIED' : 'VERIFY_REQUIRED',
      error: !peerSatisfied
        ? `候选 ECharts ${candidateEchartsVersion} 与冻结 peer 基线 (${bundle.baselineEchartsVersion}) 不一致，需运行 component echarts verify 获取实测证据`
        : `候选 ECharts ${candidateEchartsVersion} 缺少双框架 (vue + react) 已验证兼容记录，需运行 component echarts verify`,
      bundleDir: bundle.bundleDir,
      bundleVersion: bundle.bundleVersion,
      baselineEchartsVersion: bundle.baselineEchartsVersion,
      candidateEchartsVersion,
      peerSatisfied,
      hasDualFrameworkCoverage,
      supported: bundle.supported,
      verifyRequired: true,
    };
  }

  return {
    ok: true,
    bundleDir: bundle.bundleDir,
    bundleVersion: bundle.bundleVersion,
    baselineEchartsVersion: bundle.baselineEchartsVersion,
    candidateEchartsVersion,
    peerSatisfied,
    hasDualFrameworkCoverage,
    supported: bundle.supported,
    verifyRequired: false,
  };
}

export function validateProbeEvidence(raw: unknown): { ok: true; value: ProbeEvidence } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '探针输出必须为 JSON 对象' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1 || obj.kind !== 'a-t10-sdk-probe') {
    return { ok: false, error: '探针输出缺少 schemaVersion=1 或 kind="a-t10-sdk-probe"' };
  }
  if (!obj.bundle || typeof obj.bundle !== 'object' || Array.isArray(obj.bundle)) {
    return { ok: false, error: '探针输出缺少 bundle 对象' };
  }
  const bundleObj = obj.bundle as Record<string, unknown>;
  if (typeof bundleObj.version !== 'string' || !Array.isArray(bundleObj.packages)) {
    return { ok: false, error: '探针输出 bundle.version 或 bundle.packages 无效' };
  }
  if (!obj.candidate || typeof obj.candidate !== 'object' || Array.isArray(obj.candidate)) {
    return { ok: false, error: '探针输出缺少 candidate 对象' };
  }
  const candObj = obj.candidate as Record<string, unknown>;
  if (typeof candObj.version !== 'string' || !candObj.version) {
    return { ok: false, error: '探针输出缺少 candidate.version' };
  }
  if (!Array.isArray(obj.combinations) || obj.combinations.length === 0) {
    return { ok: false, error: '探针输出 combinations 必须为非空数组' };
  }
  for (const item of obj.combinations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'combinations[] 元素必须为对象' };
    }
    const c = item as Record<string, unknown>;
    if (typeof c.framework !== 'string' || !c.dimensions || typeof c.dimensions !== 'object' || Array.isArray(c.dimensions)) {
      return { ok: false, error: 'combinations[] 缺少 framework 或 dimensions' };
    }
    const d = c.dimensions as Record<string, unknown>;
    for (const key of ['typecheck', 'runtime', 'interaction', 'visual'] as const) {
      if (typeof d[key] !== 'string' || !VALID_DIMENSIONS.has(d[key] as ProbeDimensionStatus)) {
        return { ok: false, error: `combinations[].dimensions.${key} 状态非法: ${String(d[key])}` };
      }
    }
  }
  if (!obj.policy || typeof obj.policy !== 'object' || Array.isArray(obj.policy)) {
    return { ok: false, error: '探针输出缺少 policy 对象' };
  }
  const p = obj.policy as Record<string, unknown>;
  if (
    typeof p.peerSatisfied !== 'boolean' ||
    typeof p.hasDualFrameworkCoverage !== 'boolean' ||
    typeof p.requiresVisualBaselineConfirmation !== 'boolean'
  ) {
    return { ok: false, error: '探针输出 policy 布尔字段缺失' };
  }
  if (typeof obj.recommendation !== 'string' || !obj.recommendation) {
    return { ok: false, error: '探针输出缺少 recommendation' };
  }
  if (!Array.isArray(obj.uncovered) || obj.uncovered.some((u) => typeof u !== 'string')) {
    return { ok: false, error: '探针输出 uncovered 必须为字符串数组' };
  }

  return { ok: true, value: obj as unknown as ProbeEvidence };
}

function runProbeSubprocess(
  probeEntry: string,
  probeArgs: string[],
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; spawnError?: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [probeEntry, ...probeArgs], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({
        exitCode: 1,
        stdout,
        stderr,
        spawnError: `探针子进程超时 (${timeoutMs}ms)`,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr, spawnError: err.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export async function verifyEchartsCandidate(options: EchartsVerifyOptions): Promise<EchartsVerifyResult> {
  if (!options.bundleDir) {
    return { ok: false, errorCode: 'MISSING_BUNDLE', error: '缺少必填参数 --bundle <dir>' };
  }

  const bundleCheck = await readAndVerifyFrozenBundle(options.bundleDir);
  if (!bundleCheck.ok) {
    return bundleCheck;
  }

  if (options.echartsVersion && !EXACT_SEMVER_RE.test(options.echartsVersion.trim())) {
    return {
      ok: false,
      errorCode: 'NOT_EXACT_VERSION',
      error: `候选 ECharts 版本必须为精确 x.y.z 字面量，收到: ${options.echartsVersion}`,
    };
  }

  const probeEntry = path.resolve(
    options.probeEntry?.trim() ||
      process.env.ZHINEXUS_ECHARTS_PROBE_ENTRY?.trim() ||
      path.join(process.cwd(), 'tests/acceptance/t10-sdk/probe.mjs'),
  );

  try {
    await fs.access(probeEntry);
  } catch {
    return {
      ok: false,
      errorCode: 'PROBE_ENTRY_NOT_FOUND',
      error: `找不到探针入口文件: ${probeEntry}（可通过 --probe-entry 或环境变量 ZHINEXUS_ECHARTS_PROBE_ENTRY 指定）`,
    };
  }

  let tempOutDir: string | undefined;
  const effectiveOutDir = options.outDir
    ? path.resolve(options.outDir)
    : (tempOutDir = await fs.mkdtemp(path.join(os.tmpdir(), 't10-echarts-out-')));

  try {
    const probeArgs: string[] = ['--bundle', bundleCheck.bundleDir, '--out', effectiveOutDir, '--json'];
    if (options.echartsVersion) probeArgs.push('--echarts', options.echartsVersion.trim());
    if (options.frameworks) probeArgs.push('--frameworks', options.frameworks);
    if (options.components) probeArgs.push('--components', options.components);
    if (options.presentations) probeArgs.push('--presentations', options.presentations);
    if (options.registry) probeArgs.push('--registry', options.registry);
    if (options.peer) probeArgs.push('--peer', options.peer);
    if (options.label) probeArgs.push('--label', options.label);
    if (options.consumerRoot) probeArgs.push('--consumer-root', path.resolve(options.consumerRoot));
    if (options.baseline) probeArgs.push('--baseline', options.baseline);
    if (options.keep) probeArgs.push('--keep');
    if (options.skipBrowser) probeArgs.push('--skip-browser');

    const proc = await runProbeSubprocess(probeEntry, probeArgs, options.timeoutMs ?? 600_000);
    if (proc.spawnError || proc.exitCode !== 0) {
      return {
        ok: false,
        errorCode: 'PROBE_FAILED',
        probeExitCode: proc.exitCode,
        stderr: proc.stderr,
        error: `探针执行失败 (exitCode=${proc.exitCode}): ${proc.spawnError ?? (proc.stderr.trim() || '未知错误')}`,
      };
    }

    const evidenceFileName = options.label ? `probe-evidence-${options.label}.json` : 'probe-evidence.json';
    const evidenceFilePath = path.join(effectiveOutDir, evidenceFileName);

    let parsedStdout: unknown;
    try {
      const fileContent = await fs.readFile(evidenceFilePath, 'utf8').catch(() => null);
      if (fileContent !== null) {
        parsedStdout = JSON.parse(fileContent);
      } else {
        const trimmed = proc.stdout.trim();
        if (trimmed.startsWith('{')) {
          parsedStdout = JSON.parse(trimmed);
        } else {
          const jsonStart = proc.stdout.indexOf('\n{');
          if (jsonStart === -1) {
            throw new Error('stdout 未包含 JSON 对象');
          }
          parsedStdout = JSON.parse(proc.stdout.slice(jsonStart + 1));
        }
      }
    } catch (err: unknown) {
      return {
        ok: false,
        errorCode: 'INVALID_PROBE_EVIDENCE',
        probeExitCode: proc.exitCode,
        stderr: proc.stderr,
        error: `探针输出不是合法 JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const validated = validateProbeEvidence(parsedStdout);
    if (!validated.ok) {
      return {
        ok: false,
        errorCode: 'INVALID_PROBE_EVIDENCE',
        probeExitCode: proc.exitCode,
        stderr: proc.stderr,
        error: `探针证据未通过 schema 校验: ${validated.error}`,
      };
    }

    const evidence = validated.value;
    if (evidence.recommendation !== 'adopt') {
      return {
        ok: false,
        errorCode: evidence.recommendation === 'hold' ? 'PROBE_HOLD' : 'PROBE_NOT_ADOPTED',
        probeExitCode: proc.exitCode,
        recommendation: evidence.recommendation,
        uncovered: evidence.uncovered,
        evidence,
        error: `探针结论为 ${evidence.recommendation}（禁止判定通过）${evidence.uncovered.length ? `，未覆盖项: ${evidence.uncovered.join(', ')}` : ''}`,
      };
    }

    const incompleteDims = evidence.combinations.flatMap((c) =>
      (['typecheck', 'runtime', 'interaction', 'visual'] as const)
        .filter((k) => c.dimensions[k] !== 'passed')
        .map((k) => `${c.framework}.${k}=${c.dimensions[k]}`),
    );

    if (evidence.uncovered.length > 0 || incompleteDims.length > 0) {
      return {
        ok: false,
        errorCode: 'INCOMPLETE_EVIDENCE',
        probeExitCode: proc.exitCode,
        recommendation: evidence.recommendation,
        uncovered: evidence.uncovered,
        evidence,
        error: `存在未覆盖项或未通过维度，禁止判定通过: ${[...evidence.uncovered, ...incompleteDims].join('; ')}`,
      };
    }

    if (
      !evidence.policy.peerSatisfied ||
      !evidence.policy.hasDualFrameworkCoverage ||
      evidence.policy.requiresVisualBaselineConfirmation
    ) {
      return {
        ok: false,
        errorCode: 'POLICY_NOT_SATISFIED',
        probeExitCode: proc.exitCode,
        recommendation: evidence.recommendation,
        uncovered: evidence.uncovered,
        evidence,
        error: '探针策略条件未全部满足 (peerSatisfied / hasDualFrameworkCoverage / requiresVisualBaselineConfirmation)',
      };
    }

    return {
      ok: true,
      probeExitCode: proc.exitCode,
      recommendation: evidence.recommendation,
      uncovered: evidence.uncovered,
      evidence,
    };
  } finally {
    if (tempOutDir) {
      await fs.rm(tempOutDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
