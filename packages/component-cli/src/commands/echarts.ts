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
  version?: string;
  latest?: boolean;
  registry?: string;
  fetchImpl?: typeof fetch;
}

export interface EchartsCheckResult {
  ok: boolean;
  errorCode?: string;
  error?: string;
  bundleDir?: string;
  bundleVersion?: string;
  baselineEchartsVersion?: string;
  candidateEchartsVersion?: string;
  candidateIntegrity?: string;
  candidateSource?: string;
  isOfficialRegistry?: boolean;
  registryProxyNote?: string;
  peerSatisfied?: boolean;
  hasDualFrameworkCoverage?: boolean;
  supported?: SupportedCombination[];
  verifyRequired?: boolean;
}

export interface ProbeCombinationRecord {
  framework: string;
  frameworkVersion: string;
  echartsVersion: string;
  dimensions: {
    typecheck: ProbeDimensionStatus;
    runtime: ProbeDimensionStatus;
    interaction: ProbeDimensionStatus;
    visual: ProbeDimensionStatus;
  };
  failures: Array<{ dimension?: string; reason?: string; detail?: string }>;
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
    integrityVerified?: boolean;
    source?: string;
    resolution?: string;
  };
  combinations: ProbeCombinationRecord[];
  policy: {
    peerSatisfied: boolean;
    supportedRangeUnchanged?: boolean;
    requiresVisualBaselineConfirmation: boolean;
    hasDualFrameworkCoverage: boolean;
    candidateIntegrityVerified?: boolean;
  };
  recommendation: string;
  uncovered: string[];
  scopeNotes?: string[];
}

export interface EchartsVerifyOptions {
  bundleDir: string;
  echartsVersion?: string;
  version?: string;
  latest?: boolean;
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
  fetchImpl?: typeof fetch;
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
const LABEL_RE = /^[a-z0-9-]+$/;
const OFFICIAL_ECHARTS_REGISTRY = 'https://registry.npmjs.org/echarts';
const REQUIRED_SDK_PACKAGES = ['@company/charts-core', '@company/charts-vue', '@company/charts-react'] as const;
const VALID_DIMENSIONS = new Set<ProbeDimensionStatus>(['passed', 'failed', 'not-run']);

interface FrozenBundlePackageInfo {
  name: string;
  version: string;
  sha256: string;
  bytes: number;
}

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
      packages: FrozenBundlePackageInfo[];
      supported: SupportedCombination[];
    }
  | { ok: false; errorCode: string; error: string }
> {
  const resolvedDir = path.resolve(bundleDir);
  const manifestPath = path.join(resolvedDir, 'manifest.json');

  let realBundleDir: string;
  try {
    realBundleDir = await fs.realpath(resolvedDir);
    const realManifestPath = await fs.realpath(manifestPath);
    if (!isInsideDir(realBundleDir, realManifestPath)) {
      return {
        ok: false,
        errorCode: 'INVALID_BUNDLE_PATH',
        error: 'manifest.json 真实路径越出冻结 bundle 根目录',
      };
    }
  } catch (err: unknown) {
    return {
      ok: false,
      errorCode: 'INVALID_BUNDLE_MANIFEST',
      error: `无法读取冻结 bundle manifest (${manifestPath}): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

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
  const verifiedPackages: FrozenBundlePackageInfo[] = [];

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

    let realTarballPath: string;
    try {
      realTarballPath = await fs.realpath(absTarball);
    } catch (err: unknown) {
      return {
        ok: false,
        errorCode: 'BUNDLE_FILE_MISSING',
        error: `缺少冻结 tarball ${tarballPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!isInsideDir(realBundleDir, realTarballPath)) {
      return {
        ok: false,
        errorCode: 'INVALID_BUNDLE_PATH',
        error: `${name} tarball 真实路径越出冻结 bundle 根目录 (symlink/junction 逃逸): ${tarballPath}`,
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
    verifiedPackages.push({ name, version: pkgVersion, sha256: actualSha, bytes: fileBuf.length });
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
    packages: verifiedPackages,
    supported: [...supportedMap.values()],
  };
}

async function resolveCandidateFromRegistry(options: {
  baselineEchartsVersion: string;
  echartsVersion?: string;
  version?: string;
  latest?: boolean;
  registry?: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | {
      ok: true;
      version: string;
      integrity?: string;
      source: string;
      isOfficialRegistry: boolean;
      registryProxyNote?: string;
    }
  | { ok: false; errorCode: string; error: string }
> {
  const explicitV = options.version?.trim();
  const explicitE = options.echartsVersion?.trim();
  if (explicitV && explicitE && explicitV !== explicitE) {
    return {
      ok: false,
      errorCode: 'CONFLICTING_CANDIDATE_OPTIONS',
      error: `--version (${explicitV}) 与 --echarts (${explicitE}) 冲突`,
    };
  }
  const requested = explicitV || explicitE;
  if (options.latest && requested) {
    return {
      ok: false,
      errorCode: 'CONFLICTING_CANDIDATE_OPTIONS',
      error: '--latest 不能与 --version / --echarts 同时指定',
    };
  }
  if (requested && !EXACT_SEMVER_RE.test(requested)) {
    return {
      ok: false,
      errorCode: 'NOT_EXACT_VERSION',
      error: `候选 ECharts 版本必须为精确 x.y.z 字面量，收到: ${requested}`,
    };
  }

  const registry = (options.registry ?? OFFICIAL_ECHARTS_REGISTRY).trim();
  if (registry === 'offline') {
    if (options.latest) {
      return {
        ok: false,
        errorCode: 'OFFLINE_LATEST_UNSUPPORTED',
        error: '--latest 需要联网查询 registry，不能与 --registry offline 同时使用',
      };
    }
    return {
      ok: true,
      version: requested ?? options.baselineEchartsVersion,
      source: 'offline',
      isOfficialRegistry: false,
      registryProxyNote: '离线模式 (--registry offline)，未查询官方 registry integrity',
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(registry);
  } catch {
    return { ok: false, errorCode: 'INVALID_REGISTRY_URL', error: `无效的 --registry 地址: ${registry}` };
  }
  if ((parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') || parsedUrl.username || parsedUrl.password) {
    return {
      ok: false,
      errorCode: 'INVALID_REGISTRY_URL',
      error: `registry 地址仅支持无内嵌凭证的 http/https 协议: ${registry}`,
    };
  }

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  let resp: Response;
  try {
    resp = await fetchFn(parsedUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: unknown) {
    return {
      ok: false,
      errorCode: 'REGISTRY_QUERY_FAILED',
      error: `查询 ECharts registry (${registry}) 失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      errorCode: 'REGISTRY_QUERY_FAILED',
      error: `查询 ECharts registry 返回 HTTP ${resp.status}`,
    };
  }

  let packument: unknown;
  try {
    packument = await resp.json();
  } catch {
    return { ok: false, errorCode: 'REGISTRY_QUERY_FAILED', error: 'registry 返回内容不是合法 JSON' };
  }

  if (!packument || typeof packument !== 'object' || Array.isArray(packument)) {
    return { ok: false, errorCode: 'REGISTRY_QUERY_FAILED', error: 'registry packument 结构无效' };
  }

  const doc = packument as Record<string, unknown>;
  let targetVersion = requested ?? options.baselineEchartsVersion;
  if (options.latest) {
    const distTags =
      doc['dist-tags'] && typeof doc['dist-tags'] === 'object' && !Array.isArray(doc['dist-tags'])
        ? (doc['dist-tags'] as Record<string, unknown>)
        : null;
    const latestTag = distTags && typeof distTags.latest === 'string' ? distTags.latest.trim() : '';
    if (!EXACT_SEMVER_RE.test(latestTag)) {
      return {
        ok: false,
        errorCode: 'NOT_EXACT_VERSION',
        error: `registry dist-tags.latest (${latestTag || 'empty'}) 不是精确 x.y.z 版本`,
      };
    }
    targetVersion = latestTag;
  }

  const versions =
    doc.versions && typeof doc.versions === 'object' && !Array.isArray(doc.versions)
      ? (doc.versions as Record<string, unknown>)
      : null;
  const verObj =
    versions && versions[targetVersion] && typeof versions[targetVersion] === 'object'
      ? (versions[targetVersion] as Record<string, unknown>)
      : null;
  if (!verObj) {
    return {
      ok: false,
      errorCode: 'UNKNOWN_VERSION',
      error: `registry 中不存在 ECharts 版本 ${targetVersion}`,
    };
  }
  const distObj =
    verObj.dist && typeof verObj.dist === 'object' && !Array.isArray(verObj.dist)
      ? (verObj.dist as Record<string, unknown>)
      : null;
  const integrity = distObj && typeof distObj.integrity === 'string' ? distObj.integrity.trim() : '';
  if (!integrity) {
    return {
      ok: false,
      errorCode: 'MISSING_INTEGRITY',
      error: `registry 中 ECharts@${targetVersion} 缺少 dist.integrity`,
    };
  }

  const isOfficialRegistry = registry === OFFICIAL_ECHARTS_REGISTRY;
  return {
    ok: true,
    version: targetVersion,
    integrity,
    source: registry,
    isOfficialRegistry,
    ...(isOfficialRegistry ? {} : { registryProxyNote: `使用非官方镜像/代理源: ${registry}` }),
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

  const resolved = await resolveCandidateFromRegistry({
    baselineEchartsVersion: bundle.baselineEchartsVersion,
    echartsVersion: options.echartsVersion,
    version: options.version,
    latest: options.latest,
    registry: options.registry,
    fetchImpl: options.fetchImpl,
  });
  if (!resolved.ok) {
    return {
      ...resolved,
      bundleDir: bundle.bundleDir,
      bundleVersion: bundle.bundleVersion,
      baselineEchartsVersion: bundle.baselineEchartsVersion,
    };
  }

  const candidateEchartsVersion = resolved.version;
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
      candidateIntegrity: resolved.integrity,
      candidateSource: resolved.source,
      isOfficialRegistry: resolved.isOfficialRegistry,
      registryProxyNote: resolved.registryProxyNote,
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
    candidateIntegrity: resolved.integrity,
    candidateSource: resolved.source,
    isOfficialRegistry: resolved.isOfficialRegistry,
    registryProxyNote: resolved.registryProxyNote,
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
  if (candObj.integrityVerified !== undefined && typeof candObj.integrityVerified !== 'boolean') {
    return { ok: false, error: '探针输出 candidate.integrityVerified 必须为布尔值' };
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
    if (typeof c.frameworkVersion !== 'string' || !c.frameworkVersion) {
      return { ok: false, error: 'combinations[] 缺少有效的 frameworkVersion' };
    }
    if (typeof c.echartsVersion !== 'string' || !EXACT_SEMVER_RE.test(c.echartsVersion)) {
      return { ok: false, error: `combinations[].echartsVersion 必须为精确语义化版本: ${String(c.echartsVersion)}` };
    }
    if (!Array.isArray(c.failures)) {
      return { ok: false, error: 'combinations[].failures 必须为数组' };
    }
    for (const f of c.failures) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) {
        return { ok: false, error: 'combinations[].failures[] 元素必须为非空对象' };
      }
      const fObj = f as Record<string, unknown>;
      for (const field of ['dimension', 'reason', 'detail'] as const) {
        if (fObj[field] !== undefined && typeof fObj[field] !== 'string') {
          return { ok: false, error: `combinations[].failures[].${field} 必须为字符串` };
        }
      }
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
    typeof p.requiresVisualBaselineConfirmation !== 'boolean' ||
    (p.candidateIntegrityVerified !== undefined && typeof p.candidateIntegrityVerified !== 'boolean')
  ) {
    return { ok: false, error: '探针输出 policy 布尔字段缺失或类型错误' };
  }
  if (typeof obj.recommendation !== 'string' || !obj.recommendation) {
    return { ok: false, error: '探针输出缺少 recommendation' };
  }
  if (!Array.isArray(obj.uncovered) || obj.uncovered.some((u) => typeof u !== 'string')) {
    return { ok: false, error: '探针输出 uncovered 必须为字符串数组' };
  }
  if (obj.scopeNotes !== undefined && (!Array.isArray(obj.scopeNotes) || obj.scopeNotes.some((n) => typeof n !== 'string'))) {
    return { ok: false, error: '探针输出 scopeNotes 必须为字符串数组' };
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

  if (options.label !== undefined && !LABEL_RE.test(options.label)) {
    return {
      ok: false,
      errorCode: 'INVALID_LABEL',
      error: `--label 仅允许 [a-z0-9-] 字符，收到: ${options.label}`,
    };
  }

  const bundleCheck = await readAndVerifyFrozenBundle(options.bundleDir);
  if (!bundleCheck.ok) {
    return bundleCheck;
  }

  const explicitV = options.version?.trim();
  const explicitE = options.echartsVersion?.trim();
  if (explicitV && explicitE && explicitV !== explicitE) {
    return {
      ok: false,
      errorCode: 'CONFLICTING_CANDIDATE_OPTIONS',
      error: `--version (${explicitV}) 与 --echarts (${explicitE}) 冲突`,
    };
  }
  let requestedCandidateVersion = explicitV || explicitE;
  if (options.latest && requestedCandidateVersion) {
    return {
      ok: false,
      errorCode: 'CONFLICTING_CANDIDATE_OPTIONS',
      error: '--latest 不能与 --version / --echarts 同时指定',
    };
  }
  if (requestedCandidateVersion && !EXACT_SEMVER_RE.test(requestedCandidateVersion)) {
    return {
      ok: false,
      errorCode: 'NOT_EXACT_VERSION',
      error: `候选 ECharts 版本必须为精确 x.y.z 字面量，收到: ${requestedCandidateVersion}`,
    };
  }

  if ((options.registry ?? OFFICIAL_ECHARTS_REGISTRY).trim() === 'offline') {
    return {
      ok: false,
      errorCode: 'OFFLINE_VERIFY_CANNOT_ADOPT',
      error: '离线模式 (--registry offline) 仅支持 check 查询，verify 不得判定 adopt',
    };
  }

  const resolvedCandidate = await resolveCandidateFromRegistry({
    baselineEchartsVersion: bundleCheck.baselineEchartsVersion,
    echartsVersion: explicitE,
    version: explicitV,
    latest: options.latest,
    registry: options.registry,
    fetchImpl: options.fetchImpl,
  });
  if (!resolvedCandidate.ok) {
    return resolvedCandidate;
  }
  requestedCandidateVersion = resolvedCandidate.version;

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

  const evidenceFileName = options.label ? `probe-evidence-${options.label}.json` : 'probe-evidence.json';
  let tempOutDir: string | undefined;
  let effectiveOutDir: string;
  if (options.outDir) {
    effectiveOutDir = path.resolve(options.outDir);
    const existingTarget = path.join(effectiveOutDir, evidenceFileName);
    const exists = await fs
      .access(existingTarget)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return {
        ok: false,
        errorCode: 'OUTPUT_ALREADY_EXISTS',
        error: `输出目录已存在同名证据文件 (${existingTarget})，拒绝重用旧证据；请更换 --out 或 --label`,
      };
    }
  } else {
    tempOutDir = await fs.mkdtemp(path.join(os.tmpdir(), 't10-echarts-out-'));
    effectiveOutDir = tempOutDir;
  }

  try {
    const probeArgs: string[] = ['--bundle', bundleCheck.bundleDir, '--out', effectiveOutDir, '--json'];
    if (requestedCandidateVersion) probeArgs.push('--echarts', requestedCandidateVersion);
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

    // 绑定证据中的三包 name/version/sha256/bytes 必须与本次冻结 bundle 完全一致
    if (evidence.bundle.version !== bundleCheck.bundleVersion || evidence.bundle.packages.length !== bundleCheck.packages.length) {
      return {
        ok: false,
        errorCode: 'BUNDLE_EVIDENCE_MISMATCH',
        probeExitCode: proc.exitCode,
        evidence,
        error: `探针证据 bundle 版本或包数量与冻结目录不一致 (expected=${bundleCheck.bundleVersion}/${bundleCheck.packages.length}, actual=${evidence.bundle.version}/${evidence.bundle.packages.length})`,
      };
    }
    for (const expectedPkg of bundleCheck.packages) {
      const matched = evidence.bundle.packages.find(
        (p) =>
          p &&
          p.name === expectedPkg.name &&
          p.version === expectedPkg.version &&
          p.sha256 === expectedPkg.sha256 &&
          p.bytes === expectedPkg.bytes,
      );
      if (!matched) {
        return {
          ok: false,
          errorCode: 'BUNDLE_EVIDENCE_MISMATCH',
          probeExitCode: proc.exitCode,
          evidence,
          error: `探针证据中的包 ${expectedPkg.name}@${expectedPkg.version} 摘要或字节数与冻结 bundle 不匹配`,
        };
      }
    }

    // 绑定请求候选版本、integrity、source 与完整性验证标志
    if (evidence.candidate.version !== resolvedCandidate.version) {
      return {
        ok: false,
        errorCode: 'CANDIDATE_MISMATCH',
        probeExitCode: proc.exitCode,
        evidence,
        error: `探针证据候选版本 (${evidence.candidate.version}) 与请求候选 (${resolvedCandidate.version}) 不一致`,
      };
    }
    if (!resolvedCandidate.integrity || evidence.candidate.integrity !== resolvedCandidate.integrity) {
      return {
        ok: false,
        errorCode: 'CANDIDATE_INTEGRITY_MISMATCH',
        probeExitCode: proc.exitCode,
        evidence,
        error: `探针证据候选 integrity (${evidence.candidate.integrity ?? 'none'}) 与官方解析结果 (${resolvedCandidate.integrity ?? 'none'}) 不一致`,
      };
    }
    if (evidence.candidate.source === 'offline' || evidence.candidate.source !== resolvedCandidate.source) {
      return {
        ok: false,
        errorCode: 'CANDIDATE_SOURCE_MISMATCH',
        probeExitCode: proc.exitCode,
        evidence,
        error: `探针证据候选来源 (${evidence.candidate.source ?? 'none'}) 与解析来源 (${resolvedCandidate.source}) 不一致或为 offline`,
      };
    }
    if (evidence.candidate.integrityVerified !== true || evidence.policy.candidateIntegrityVerified !== true) {
      return {
        ok: false,
        errorCode: 'CANDIDATE_INTEGRITY_UNVERIFIED',
        probeExitCode: proc.exitCode,
        evidence,
        error: '探针证据未完成 candidate integrity 校验 (candidate.integrityVerified / policy.candidateIntegrityVerified 必须为 true)',
      };
    }

    // 检查真实 vue + react 组合记录及每条组合的 echartsVersion / frameworkVersion 对齐
    const seenFrameworks = new Set<string>();
    for (const combo of evidence.combinations) {
      if (combo.framework !== 'vue' && combo.framework !== 'react') {
        return {
          ok: false,
          errorCode: 'FRAMEWORK_COVERAGE_INVALID',
          probeExitCode: proc.exitCode,
          evidence,
          error: `探针证据包含未知框架记录: ${combo.framework}`,
        };
      }
      if (combo.echartsVersion !== resolvedCandidate.version) {
        return {
          ok: false,
          errorCode: 'CANDIDATE_MISMATCH',
          probeExitCode: proc.exitCode,
          evidence,
          error: `组合 ${combo.framework} 实测 echartsVersion (${combo.echartsVersion}) 与候选 (${resolvedCandidate.version}) 不一致`,
        };
      }
      const supportedMatch = bundleCheck.supported.some(
        (s) => s.framework === combo.framework && s.frameworkVersion === combo.frameworkVersion,
      );
      if (!supportedMatch) {
        return {
          ok: false,
          errorCode: 'FRAMEWORK_VERSION_MISMATCH',
          probeExitCode: proc.exitCode,
          evidence,
          error: `组合 ${combo.framework} 实测 frameworkVersion (${combo.frameworkVersion}) 与冻结 bundle supported 不一致`,
        };
      }
      seenFrameworks.add(combo.framework);
    }
    if (!seenFrameworks.has('vue') || !seenFrameworks.has('react')) {
      return {
        ok: false,
        errorCode: 'FRAMEWORK_COVERAGE_INVALID',
        probeExitCode: proc.exitCode,
        evidence,
        error: `探针证据缺少完整双框架 (vue + react) 实测记录，当前仅包含: ${[...seenFrameworks].join(', ') || '(none)'}`,
      };
    }

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
    const nonEmptyFailures = evidence.combinations.flatMap((c) =>
      (c.failures ?? []).map((f) => `${c.framework}:${f.dimension ?? 'unknown'}:${f.reason ?? 'failed'}`),
    );

    if (evidence.uncovered.length > 0 || incompleteDims.length > 0 || nonEmptyFailures.length > 0) {
      return {
        ok: false,
        errorCode: 'INCOMPLETE_EVIDENCE',
        probeExitCode: proc.exitCode,
        recommendation: evidence.recommendation,
        uncovered: evidence.uncovered,
        evidence,
        error: `存在未覆盖项、未通过维度或 failures 记录，禁止判定通过: ${[...evidence.uncovered, ...incompleteDims, ...nonEmptyFailures].join('; ')}`,
      };
    }

    if (
      !evidence.policy.peerSatisfied ||
      !evidence.policy.hasDualFrameworkCoverage ||
      evidence.policy.supportedRangeUnchanged !== true ||
      evidence.policy.requiresVisualBaselineConfirmation
    ) {
      return {
        ok: false,
        errorCode: 'POLICY_NOT_SATISFIED',
        probeExitCode: proc.exitCode,
        recommendation: evidence.recommendation,
        uncovered: evidence.uncovered,
        evidence,
        error: '探针策略条件未全部满足 (peerSatisfied / hasDualFrameworkCoverage / supportedRangeUnchanged / requiresVisualBaselineConfirmation)',
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
