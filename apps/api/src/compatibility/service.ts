import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, environmentKey, environmentProjection, type EnvironmentV1 } from '@company/contracts';
import type { Database } from '../db/database.js';
import { audit, requireComponents, uuid, type RequestContext } from '../db/access.js';
import { PlatformError } from '../errors.js';

const SHA256_RE = /^[a-f0-9]{64}$/;
const SRI_RE = /^sha(?:256|384|512)-[A-Za-z0-9+/=]{16,}$/;
const EXACT_SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const VALID_DIMENSIONS = new Set(['passed', 'failed', 'not-run']);
const REQUIRED_PRESENTATIONS = ['light-canvas', 'dark-canvas', 'light-svg', 'dark-svg'] as const;
const PRESENTATION_TO_ENV: Record<
  string,
  { theme: 'light' | 'dark'; renderer: 'canvas' | 'svg'; canvases: number; svgs: number }
> = {
  'light-canvas': { theme: 'light', renderer: 'canvas', canvases: 1, svgs: 0 },
  'dark-canvas': { theme: 'dark', renderer: 'canvas', canvases: 1, svgs: 0 },
  'light-svg': { theme: 'light', renderer: 'svg', canvases: 0, svgs: 1 },
  'dark-svg': { theme: 'dark', renderer: 'svg', canvases: 0, svgs: 1 },
};
const REQUIRED_CHECK_NAMES = ['single-instance', 'no-page-error', 'series-match', 'renderer-match'] as const;
const REQUIRED_CHECK_SET = new Set<string>(REQUIRED_CHECK_NAMES);

function hasExactPassedChecks(checks: Array<{ name: string; status: string }>): boolean {
  if (checks.length !== REQUIRED_CHECK_NAMES.length) return false;
  const seen = new Set<string>();
  for (const ch of checks) {
    if (ch.status !== 'passed' || !REQUIRED_CHECK_SET.has(ch.name) || seen.has(ch.name)) {
      return false;
    }
    seen.add(ch.name);
  }
  return seen.size === REQUIRED_CHECK_NAMES.length;
}
const EXPECTED_FIRST_CLICK: Record<string, { seriesId: string; dataIndex: number; value: unknown[]; nativeType: string }> = {
  line: { seriesId: 'revenue', dataIndex: 0, value: ['周一', 120], nativeType: 'click' },
  bar: { seriesId: 'revenue', dataIndex: 0, value: ['周一', 120], nativeType: 'click' },
  pie: { seriesId: 'share', dataIndex: 0, value: ['搜索', 120], nativeType: 'click' },
  scatter: { seriesId: 'revenue', dataIndex: 0, value: [1, 120], nativeType: 'click' },
  'trend-card': { seriesId: 'active', dataIndex: 0, value: ['周一', 120], nativeType: 'click' },
  ranking: { seriesId: 'hot', dataIndex: 0, value: ['柱状图', 180], nativeType: 'click' },
  proportion: { seriesId: 'source', dataIndex: 0, value: ['搜索', 120], nativeType: 'click' },
};

type FontFingerprint = {
  stack: string;
  families: Array<{ family: string; available: boolean; advances: number[] }>;
  loadedFonts: string[];
};

type BrowserRun = {
  component: string;
  presentation: string;
  environment: EnvironmentV1;
  environmentKey: string;
  environmentAudit: {
    projection: unknown;
    canonical: string;
    fontDigest?: string;
    fontFingerprint: FontFingerprint;
  };
  hostCount: number;
  appliedPresentation: { canvases: number; svgs: number };
  pageErrors: unknown[];
  checks: Array<{ name: string; status: string }>;
  clickError: unknown;
  click: unknown[];
  screenshot: { file?: string; bytes: number; sha256: string };
};

type ValidatedProbeEvidence = {
  schemaVersion: 1;
  kind: 'a-t10-sdk-probe';
  probe: {
    platform: string;
    node: string;
    browserRevision: string;
    fontDigestSource: 'measured';
    fontDigest: string;
  };
  bundle: {
    version: string;
    packages: Array<{ name: string; version: string; sha256: string; bytes: number }>;
    variants: Array<{ variantId: string }>;
  };
  candidate: {
    version: string;
    integrity: string;
    source: string;
    integrityVerified: boolean;
    consumerSources: Array<{
      framework: string;
      verified: boolean;
      reason: string | null;
      resolved: string;
      version: string;
      integrity: string;
    }>;
  };
  combinations: Array<{
    framework: 'vue' | 'react';
    frameworkVersion: string;
    echartsVersion: string;
    baselineEchartsVersion?: string;
    consumer: {
      peerMode: string;
      resolved: Record<string, string | null>;
    };
    dimensions: { typecheck: string; runtime: string; interaction: string; visual: string };
    failures: Array<{ dimension?: string; reason?: string; detail?: string }>;
    evidence: {
      typecheck: Array<{ resolution: string; exitCode: number }>;
      build: { exitCode: number };
      ssrImport: { exitCode: number; windowDefined: boolean; documentDefined: boolean };
      lifecycle: {
        component: string;
        status: string;
        before: { hasHost: boolean; hasInstance: boolean };
        disposed: { aliveBeforeUnmount: boolean; staleInstanceAlive: boolean };
        after: { canvases: number; svgs: number; checks: Array<{ name: string; status: string }> };
        pageErrors: unknown[];
      };
      browser: BrowserRun[];
      visual: Array<{
        component: string;
        presentation: string;
        result: string;
        environmentKey?: string;
        screenshotSha256?: string;
        sha256?: string;
        bytes?: number;
      }>;
    };
  }>;
  policy: {
    peerSatisfied: boolean;
    hasDualFrameworkCoverage: boolean;
    supportedRangeUnchanged?: boolean;
    requiresVisualBaselineConfirmation: boolean;
    candidateIntegrityVerified?: boolean;
  };
  recommendation: string;
  uncovered: string[];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function isCleanHttpsRegistryUrl(raw: string): boolean {
  if (!raw || /\s/.test(raw) || raw.includes('\\') || raw.includes('?') || raw.includes('#')) {
    return false;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    return true;
  } catch {
    return false;
  }
}

function validateProbeEvidencePayload(raw: unknown): ValidatedProbeEvidence | null {
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion !== 1 || raw.kind !== 'a-t10-sdk-probe') return null;

  if (!isPlainObject(raw.probe)) return null;
  const probe = raw.probe;
  if (
    typeof probe.platform !== 'string' ||
    !probe.platform ||
    typeof probe.node !== 'string' ||
    !probe.node ||
    typeof probe.browserRevision !== 'string' ||
    !probe.browserRevision ||
    probe.fontDigestSource !== 'measured' ||
    typeof probe.fontDigest !== 'string' ||
    !SHA256_RE.test(probe.fontDigest)
  ) {
    return null;
  }

  if (
    !isPlainObject(raw.bundle) ||
    typeof raw.bundle.version !== 'string' ||
    !Array.isArray(raw.bundle.packages) ||
    raw.bundle.packages.length === 0
  ) {
    return null;
  }
  for (const pkg of raw.bundle.packages) {
    if (
      !isPlainObject(pkg) ||
      typeof pkg.name !== 'string' ||
      !pkg.name ||
      typeof pkg.version !== 'string' ||
      !pkg.version ||
      typeof pkg.sha256 !== 'string' ||
      !SHA256_RE.test(pkg.sha256) ||
      typeof pkg.bytes !== 'number' ||
      !Number.isFinite(pkg.bytes) ||
      pkg.bytes < 0
    ) {
      return null;
    }
  }
  if (!Array.isArray(raw.bundle.variants) || raw.bundle.variants.length === 0) return null;
  for (const v of raw.bundle.variants) {
    if (!isPlainObject(v) || typeof v.variantId !== 'string' || !v.variantId) return null;
  }

  if (
    !isPlainObject(raw.candidate) ||
    typeof raw.candidate.version !== 'string' ||
    !EXACT_SEMVER_RE.test(raw.candidate.version) ||
    typeof raw.candidate.integrity !== 'string' ||
    !SRI_RE.test(raw.candidate.integrity) ||
    typeof raw.candidate.source !== 'string' ||
    !raw.candidate.source ||
    typeof raw.candidate.integrityVerified !== 'boolean'
  ) {
    return null;
  }
  if (!Array.isArray(raw.candidate.consumerSources) || raw.candidate.consumerSources.length === 0) return null;
  for (const cs of raw.candidate.consumerSources) {
    if (
      !isPlainObject(cs) ||
      typeof cs.framework !== 'string' ||
      typeof cs.verified !== 'boolean' ||
      typeof cs.resolved !== 'string' ||
      typeof cs.version !== 'string' ||
      typeof cs.integrity !== 'string' ||
      !SRI_RE.test(cs.integrity)
    ) {
      return null;
    }
  }

  if (!Array.isArray(raw.combinations) || raw.combinations.length === 0) return null;
  for (const c of raw.combinations) {
    if (
      !isPlainObject(c) ||
      (c.framework !== 'vue' && c.framework !== 'react') ||
      typeof c.frameworkVersion !== 'string' ||
      !c.frameworkVersion ||
      typeof c.echartsVersion !== 'string' ||
      !EXACT_SEMVER_RE.test(c.echartsVersion) ||
      !isPlainObject(c.consumer) ||
      typeof c.consumer.peerMode !== 'string' ||
      !isPlainObject(c.consumer.resolved) ||
      !isPlainObject(c.dimensions) ||
      !Array.isArray(c.failures) ||
      !isPlainObject(c.evidence)
    ) {
      return null;
    }
    for (const dim of ['typecheck', 'runtime', 'interaction', 'visual'] as const) {
      if (typeof c.dimensions[dim] !== 'string' || !VALID_DIMENSIONS.has(c.dimensions[dim] as string)) {
        return null;
      }
    }
    for (const f of c.failures) {
      if (!isPlainObject(f)) return null;
      for (const field of ['dimension', 'reason', 'detail'] as const) {
        if (f[field] !== undefined && typeof f[field] !== 'string') return null;
      }
    }

    const ev = c.evidence;
    if (
      !Array.isArray(ev.typecheck) ||
      ev.typecheck.length === 0 ||
      !isPlainObject(ev.build) ||
      typeof ev.build.exitCode !== 'number' ||
      !isPlainObject(ev.ssrImport) ||
      typeof ev.ssrImport.exitCode !== 'number' ||
      typeof ev.ssrImport.windowDefined !== 'boolean' ||
      typeof ev.ssrImport.documentDefined !== 'boolean' ||
      !isPlainObject(ev.lifecycle) ||
      typeof ev.lifecycle.component !== 'string' ||
      !ev.lifecycle.component ||
      typeof ev.lifecycle.status !== 'string' ||
      !isPlainObject(ev.lifecycle.before) ||
      typeof ev.lifecycle.before.hasHost !== 'boolean' ||
      typeof ev.lifecycle.before.hasInstance !== 'boolean' ||
      !isPlainObject(ev.lifecycle.disposed) ||
      typeof ev.lifecycle.disposed.aliveBeforeUnmount !== 'boolean' ||
      typeof ev.lifecycle.disposed.staleInstanceAlive !== 'boolean' ||
      !isPlainObject(ev.lifecycle.after) ||
      typeof ev.lifecycle.after.canvases !== 'number' ||
      !Number.isInteger(ev.lifecycle.after.canvases) ||
      ev.lifecycle.after.canvases < 0 ||
      typeof ev.lifecycle.after.svgs !== 'number' ||
      !Number.isInteger(ev.lifecycle.after.svgs) ||
      ev.lifecycle.after.svgs < 0 ||
      !Array.isArray(ev.lifecycle.after.checks) ||
      ev.lifecycle.after.checks.some(
        (ch) => !isPlainObject(ch) || typeof ch.name !== 'string' || !ch.name || typeof ch.status !== 'string',
      ) ||
      !Array.isArray(ev.lifecycle.pageErrors) ||
      !Array.isArray(ev.browser) ||
      ev.browser.length === 0 ||
      !Array.isArray(ev.visual) ||
      ev.visual.length === 0
    ) {
      return null;
    }
    for (const tc of ev.typecheck) {
      if (!isPlainObject(tc) || typeof tc.resolution !== 'string' || typeof tc.exitCode !== 'number') return null;
    }
    if (
      c.baselineEchartsVersion !== undefined &&
      (typeof c.baselineEchartsVersion !== 'string' || !EXACT_SEMVER_RE.test(c.baselineEchartsVersion))
    ) {
      return null;
    }
    for (const v of ev.visual) {
      if (
        !isPlainObject(v) ||
        typeof v.component !== 'string' ||
        typeof v.presentation !== 'string' ||
        typeof v.result !== 'string'
      ) {
        return null;
      }
      if (v.environmentKey !== undefined && (typeof v.environmentKey !== 'string' || !SHA256_RE.test(v.environmentKey))) {
        return null;
      }
      if (
        v.screenshotSha256 !== undefined &&
        (typeof v.screenshotSha256 !== 'string' || !SHA256_RE.test(v.screenshotSha256))
      ) {
        return null;
      }
      if (v.sha256 !== undefined && (typeof v.sha256 !== 'string' || !SHA256_RE.test(v.sha256))) {
        return null;
      }
      if (v.bytes !== undefined && (typeof v.bytes !== 'number' || !Number.isInteger(v.bytes) || v.bytes <= 0)) {
        return null;
      }
    }
    for (const run of ev.browser) {
      if (
        !isPlainObject(run) ||
        typeof run.component !== 'string' ||
        typeof run.presentation !== 'string' ||
        !isPlainObject(run.environment) ||
        typeof run.environmentKey !== 'string' ||
        !SHA256_RE.test(run.environmentKey) ||
        !isPlainObject(run.environmentAudit) ||
        !isPlainObject(run.environmentAudit.projection) ||
        typeof run.environmentAudit.canonical !== 'string' ||
        !isPlainObject(run.environmentAudit.fontFingerprint) ||
        typeof run.environmentAudit.fontFingerprint.stack !== 'string' ||
        !run.environmentAudit.fontFingerprint.stack.trim() ||
        !Array.isArray(run.environmentAudit.fontFingerprint.families) ||
        run.environmentAudit.fontFingerprint.families.length === 0 ||
        run.environmentAudit.fontFingerprint.families.some(
          (fam) =>
            !isPlainObject(fam) ||
            typeof fam.family !== 'string' ||
            !fam.family.trim() ||
            typeof fam.available !== 'boolean' ||
            !Array.isArray(fam.advances) ||
            fam.advances.some((a) => typeof a !== 'number' || !Number.isFinite(a)),
        ) ||
        !Array.isArray(run.environmentAudit.fontFingerprint.loadedFonts) ||
        run.environmentAudit.fontFingerprint.loadedFonts.some((f) => typeof f !== 'string' || !f.trim()) ||
        typeof run.hostCount !== 'number' ||
        !isPlainObject(run.appliedPresentation) ||
        typeof run.appliedPresentation.canvases !== 'number' ||
        !Number.isInteger(run.appliedPresentation.canvases) ||
        run.appliedPresentation.canvases < 0 ||
        typeof run.appliedPresentation.svgs !== 'number' ||
        !Number.isInteger(run.appliedPresentation.svgs) ||
        run.appliedPresentation.svgs < 0 ||
        !Array.isArray(run.pageErrors) ||
        !Array.isArray(run.checks) ||
        run.checks.some((ch) => !isPlainObject(ch) || typeof ch.name !== 'string' || !ch.name || typeof ch.status !== 'string') ||
        (run.clickError !== null && typeof run.clickError !== 'string') ||
        !Array.isArray(run.click) ||
        !isPlainObject(run.screenshot) ||
        typeof run.screenshot.sha256 !== 'string' ||
        !SHA256_RE.test(run.screenshot.sha256) ||
        typeof run.screenshot.bytes !== 'number' ||
        !Number.isInteger(run.screenshot.bytes) ||
        run.screenshot.bytes <= 0
      ) {
        return null;
      }
    }
  }

  if (!isPlainObject(raw.policy)) return null;
  const p = raw.policy;
  if (
    typeof p.peerSatisfied !== 'boolean' ||
    typeof p.hasDualFrameworkCoverage !== 'boolean' ||
    typeof p.requiresVisualBaselineConfirmation !== 'boolean' ||
    (p.candidateIntegrityVerified !== undefined && typeof p.candidateIntegrityVerified !== 'boolean')
  ) {
    return null;
  }
  if (typeof raw.recommendation !== 'string' || !raw.recommendation) return null;
  if (!Array.isArray(raw.uncovered) || raw.uncovered.some((u) => typeof u !== 'string')) return null;
  return raw as unknown as ValidatedProbeEvidence;
}

type AuthoritativeReleaseMatrix = {
  supported: Array<{ framework: 'vue' | 'react'; frameworkVersion: string; echartsVersion: string }>;
  baselineEchartsVersion: string | null;
  peerEcharts: string | null;
  sdkPackages: Map<string, string>;
  bundlePackages: Map<string, { name: string; version: string; sha256: string; bytes: number }>;
};

function extractAuthoritativeReleaseMatrix(manifest: unknown, packageName: string): AuthoritativeReleaseMatrix {
  const supportedMap = new Map<string, { framework: 'vue' | 'react'; frameworkVersion: string; echartsVersion: string }>();
  const baselineVersions = new Set<string>();
  const sdkPackages = new Map<string, string>();
  const bundlePackages = new Map<string, { name: string; version: string; sha256: string; bytes: number }>();
  const peerVersions = new Set<string>();

  if (isPlainObject(manifest) && Array.isArray(manifest.variants)) {
    for (const variant of manifest.variants) {
      if (!isPlainObject(variant) || !Array.isArray(variant.compatibility)) continue;
      for (const compat of variant.compatibility) {
        if (!isPlainObject(compat)) continue;
        if (compat.status !== undefined && compat.status !== 'passed') continue;
        if (
          (compat.framework === 'vue' || compat.framework === 'react') &&
          typeof compat.frameworkVersion === 'string' &&
          compat.frameworkVersion &&
          typeof compat.echartsVersion === 'string' &&
          EXACT_SEMVER_RE.test(compat.echartsVersion)
        ) {
          const key = `${compat.framework}@${compat.frameworkVersion}@${compat.echartsVersion}`;
          if (!supportedMap.has(key)) {
            supportedMap.set(key, {
              framework: compat.framework,
              frameworkVersion: compat.frameworkVersion,
              echartsVersion: compat.echartsVersion,
            });
          }
          baselineVersions.add(compat.echartsVersion);
        }
      }
    }
  }

  if (isPlainObject(manifest) && Array.isArray(manifest.packages)) {
    for (const pkg of manifest.packages) {
      if (!isPlainObject(pkg) || typeof pkg.name !== 'string' || typeof pkg.version !== 'string') continue;
      if (
        isPlainObject(pkg.tarball) &&
        typeof pkg.tarball.sha256 === 'string' &&
        SHA256_RE.test(pkg.tarball.sha256) &&
        typeof pkg.tarball.bytes === 'number' &&
        Number.isInteger(pkg.tarball.bytes) &&
        pkg.tarball.bytes > 0
      ) {
        bundlePackages.set(pkg.name, {
          name: pkg.name,
          version: pkg.version,
          sha256: pkg.tarball.sha256,
          bytes: pkg.tarball.bytes,
        });
      }
      if (
        pkg.name === packageName ||
        pkg.name === '@company/charts-core' ||
        pkg.name === '@company/charts-vue' ||
        pkg.name === '@company/charts-react'
      ) {
        sdkPackages.set(pkg.name, pkg.version);
        if (
          (pkg.name === packageName || pkg.name === '@company/charts-core') &&
          isPlainObject(pkg.peerDependencies) &&
          typeof pkg.peerDependencies.echarts === 'string'
        ) {
          peerVersions.add(pkg.peerDependencies.echarts);
        }
      }
    }
  }

  return {
    supported: [...supportedMap.values()],
    baselineEchartsVersion: baselineVersions.size === 1 ? ([...baselineVersions][0] ?? null) : null,
    peerEcharts: peerVersions.size === 1 ? ([...peerVersions][0] ?? null) : null,
    sdkPackages,
    bundlePackages,
  };
}

export class CompatibilityService {
  constructor(private readonly db: Database) {}

  async accept(variantReleaseId: string, input: unknown, context: RequestContext) {
    const id = uuid(variantReleaseId);
    if (!isPlainObject(input)) throw new PlatformError('INVALID_SCHEMA');

    const packageSha256 = typeof input.packageSha256 === 'string' ? input.packageSha256 : '';
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!SHA256_RE.test(packageSha256) || !reason || reason.length > 2000) {
      throw new PlatformError('INVALID_SCHEMA');
    }

    if (!isPlainObject(input.candidate)) throw new PlatformError('INVALID_SCHEMA');
    const candVersion = typeof input.candidate.version === 'string' ? input.candidate.version.trim() : '';
    const candIntegrity = typeof input.candidate.integrity === 'string' ? input.candidate.integrity.trim() : '';
    const candSource = typeof input.candidate.source === 'string' ? input.candidate.source.trim() : '';
    if (!EXACT_SEMVER_RE.test(candVersion) || !SRI_RE.test(candIntegrity) || !isCleanHttpsRegistryUrl(candSource)) {
      throw new PlatformError('INVALID_SCHEMA');
    }

    const evidence = validateProbeEvidencePayload(input.evidence);
    if (!evidence) {
      throw new PlatformError('INVALID_SCHEMA');
    }

    return this.db.transaction(async (client) => {
      const row = (
        await client.query<{
          id: string;
          variant_id: string;
          component_id: string;
          framework: 'vue' | 'react';
          package_release_id: string;
          package_name: string;
          package_version: string;
          package_sha256: string;
          availability: string;
          pkg_state: string;
          job_state: string;
          manifest: unknown;
        }>(
          `SELECT vr.id, vr.variant_id, v.component_id, v.framework, pr.id AS package_release_id,
                  pr.name AS package_name, pr.version AS package_version, pr.sha256 AS package_sha256,
                  vr.availability, pr.state AS pkg_state, rj.state AS job_state, rj.manifest
             FROM variant_releases vr
             JOIN variants v ON v.id = vr.variant_id
             JOIN package_releases pr ON pr.id = vr.package_release_id
             JOIN release_jobs rj ON rj.id = pr.job_id
            WHERE vr.id = $1
            FOR UPDATE OF vr`,
          [id],
        )
      ).rows[0];

      if (!row) throw new PlatformError('NOT_FOUND');
      await requireComponents(client, context.principal.subject, [row.component_id], true);
      if (row.availability !== 'Ready' || row.pkg_state !== 'READY' || row.job_state !== 'READY') {
        throw new PlatformError('CONFLICT');
      }

      if (packageSha256 !== row.package_sha256) {
        throw new PlatformError('DIGEST_MISMATCH');
      }

      const matrix = extractAuthoritativeReleaseMatrix(row.manifest, row.package_name);
      const bundlePackages = [...matrix.bundlePackages.values()];
      const bundleVersion = new Set(bundlePackages.map(pkg => pkg.version)).size === 1
        ? bundlePackages[0]?.version
        : bundlePackages.map(pkg => `${pkg.name}@${pkg.version}`).join(', ');
      if (!bundleVersion || evidence.bundle.version !== bundleVersion) {
        throw new PlatformError('REPORT_MISMATCH');
      }
      const matchedPkg = evidence.bundle.packages.find(
        (p) => p.name === row.package_name && p.version === row.package_version && p.sha256 === row.package_sha256,
      );
      if (!matchedPkg) {
        throw new PlatformError('DIGEST_MISMATCH');
      }
      if (!evidence.bundle.variants.some((v) => v.variantId === row.variant_id)) {
        throw new PlatformError('REPORT_MISMATCH');
      }

      if (
        evidence.candidate.version !== candVersion ||
        evidence.candidate.integrity !== candIntegrity ||
        !isCleanHttpsRegistryUrl(evidence.candidate.source) ||
        evidence.candidate.source !== candSource
      ) {
        throw new PlatformError('REPORT_MISMATCH');
      }

      if (evidence.candidate.integrityVerified !== true || evidence.policy.candidateIntegrityVerified !== true) {
        throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
      }
      const candHost = new URL(candSource).host;
      const csFrameworks = new Set<string>();
      for (const cs of evidence.candidate.consumerSources) {
        if (
          (cs.framework !== 'vue' && cs.framework !== 'react') ||
          csFrameworks.has(cs.framework) ||
          !cs.verified ||
          cs.version !== candVersion ||
          cs.integrity !== candIntegrity ||
          !isCleanHttpsRegistryUrl(cs.resolved) ||
          new URL(cs.resolved).host !== candHost
        ) {
          throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
        }
        csFrameworks.add(cs.framework);
      }
      if (!csFrameworks.has('vue') || !csFrameworks.has('react')) {
        throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
      }

      // 精确核对双框架权威支持矩阵、完整 SDK 包集合、peer 策略与实际安装版本（禁止缺失、额外、重复或伪造）
      if (
        matrix.bundlePackages.size === 0 ||
        evidence.bundle.packages.length !== matrix.bundlePackages.size
      ) {
        throw new PlatformError('DIGEST_MISMATCH');
      }
      const seenBundlePkgs = new Set<string>();
      for (const pkg of evidence.bundle.packages) {
        const authPkg = matrix.bundlePackages.get(pkg.name);
        if (
          !authPkg ||
          seenBundlePkgs.has(pkg.name) ||
          pkg.version !== authPkg.version ||
          pkg.sha256 !== authPkg.sha256 ||
          pkg.bytes !== authPkg.bytes
        ) {
          throw new PlatformError('DIGEST_MISMATCH');
        }
        seenBundlePkgs.add(pkg.name);
      }

      if (
        matrix.supported.length === 0 ||
        !matrix.baselineEchartsVersion ||
        !matrix.peerEcharts ||
        candVersion !== matrix.peerEcharts
      ) {
        throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
      }
      const expectedComboKeys = new Set(
        matrix.supported.map((s) => `${s.framework}@${s.frameworkVersion}@${s.echartsVersion}`),
      );
      if (evidence.combinations.length !== expectedComboKeys.size) {
        throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
      }

      const seenComboKeys = new Set<string>();
      const seenFrameworks = new Set<string>();
      for (const combo of evidence.combinations) {
        const comboKey = `${combo.framework}@${combo.frameworkVersion}@${combo.baselineEchartsVersion ?? matrix.baselineEchartsVersion}`;
        if (!expectedComboKeys.has(comboKey) || seenComboKeys.has(comboKey)) {
          throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
        }
        seenComboKeys.add(comboKey);
        seenFrameworks.add(combo.framework);

        if (combo.echartsVersion !== candVersion) {
          throw new PlatformError('REPORT_MISMATCH');
        }
        const resolved = combo.consumer.resolved;
        const frameworkPkgName = combo.framework === 'vue' ? '@company/charts-vue' : '@company/charts-react';
        const otherFrameworkPkgName = combo.framework === 'vue' ? '@company/charts-react' : '@company/charts-vue';
        const expectedWrapperVersion =
          matrix.sdkPackages.get(frameworkPkgName) ??
          (frameworkPkgName === row.package_name ? row.package_version : undefined);
        if (
          combo.consumer.peerMode !== 'strict' ||
          resolved.echarts !== candVersion ||
          resolved[combo.framework] !== combo.frameworkVersion ||
          !expectedWrapperVersion ||
          resolved[frameworkPkgName] !== expectedWrapperVersion ||
          (resolved[otherFrameworkPkgName] !== undefined && resolved[otherFrameworkPkgName] !== null)
        ) {
          throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
        }
        const coreVersion = matrix.sdkPackages.get('@company/charts-core');
        if (coreVersion && resolved['@company/charts-core'] !== coreVersion) {
          throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
        }
        if (
          combo.dimensions.typecheck !== 'passed' ||
          combo.dimensions.runtime !== 'passed' ||
          combo.dimensions.interaction !== 'passed' ||
          combo.dimensions.visual !== 'passed' ||
          combo.failures.length > 0
        ) {
          throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
        }

        // 核对完整嵌套执行明细（不依赖客户端本机路径、不执行任何组件代码）
        const ev = combo.evidence;
        const resolutions = new Set(ev.typecheck.map((t) => t.resolution));
        if (
          !resolutions.has('Bundler') ||
          !resolutions.has('NodeNext') ||
          ev.typecheck.some((t) => t.exitCode !== 0) ||
          ev.build.exitCode !== 0 ||
          ev.ssrImport.exitCode !== 0 ||
          ev.ssrImport.windowDefined !== false ||
          ev.ssrImport.documentDefined !== false ||
          ev.lifecycle.status !== 'passed' ||
          !ev.lifecycle.before.hasHost ||
          !ev.lifecycle.before.hasInstance ||
          !ev.lifecycle.disposed.aliveBeforeUnmount ||
          ev.lifecycle.disposed.staleInstanceAlive ||
          ev.lifecycle.after.canvases + ev.lifecycle.after.svgs !== 1 ||
          !hasExactPassedChecks(ev.lifecycle.after.checks) ||
          ev.lifecycle.pageErrors.length > 0
        ) {
          throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
        }

        if (ev.visual.length !== ev.browser.length) {
          throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
        }
        const visualByKey = new Map<string, (typeof ev.visual)[number]>();
        for (const v of ev.visual) {
          if (v.result !== 'PASS') {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }
          const key = `${v.component}/${v.presentation}`;
          if (visualByKey.has(key)) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }
          visualByKey.set(key, v);
        }

        const browserKeys = new Set<string>();
        for (const run of ev.browser) {
          const key = `${run.component}/${run.presentation}`;
          const visualEntry = visualByKey.get(key);
          if (!visualEntry || browserKeys.has(key)) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }
          browserKeys.add(key);

          if (
            (visualEntry.environmentKey !== undefined && visualEntry.environmentKey !== run.environmentKey) ||
            (visualEntry.screenshotSha256 !== undefined && visualEntry.screenshotSha256 !== run.screenshot.sha256) ||
            (visualEntry.sha256 !== undefined && visualEntry.sha256 !== run.screenshot.sha256) ||
            (visualEntry.bytes !== undefined && visualEntry.bytes !== run.screenshot.bytes)
          ) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }

          const expectedPresentation = PRESENTATION_TO_ENV[run.presentation];
          if (
            !expectedPresentation ||
            run.environment.theme !== expectedPresentation.theme ||
            run.environment.renderer !== expectedPresentation.renderer ||
            run.appliedPresentation.canvases !== expectedPresentation.canvases ||
            run.appliedPresentation.svgs !== expectedPresentation.svgs
          ) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }

          const expectedClick = EXPECTED_FIRST_CLICK[run.component];
          const firstClick = run.click.length === 1 && isPlainObject(run.click[0]) ? run.click[0] : null;
          if (
            !expectedClick ||
            !firstClick ||
            firstClick.seriesId !== expectedClick.seriesId ||
            firstClick.dataIndex !== expectedClick.dataIndex ||
            firstClick.nativeType !== expectedClick.nativeType ||
            JSON.stringify(firstClick.value) !== JSON.stringify(expectedClick.value)
          ) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }

          if (
            run.hostCount !== 1 ||
            run.pageErrors.length > 0 ||
            !hasExactPassedChecks(run.checks) ||
            run.clickError !== null
          ) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }

          const env = run.environment;
          if (
            env.browserRevision !== evidence.probe.browserRevision ||
            env.fontDigest !== evidence.probe.fontDigest ||
            env.frameworkVersion !== combo.frameworkVersion ||
            env.echartsVersion !== candVersion
          ) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }

          const computedEnvKey = await environmentKey(env);
          if (computedEnvKey !== run.environmentKey) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }
          const expectedProj = environmentProjection(env);
          const expectedCanonical = canonicalJson(expectedProj);
          if (
            canonicalJson(run.environmentAudit.projection) !== expectedCanonical ||
            run.environmentAudit.canonical !== expectedCanonical
          ) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }

          const ff = run.environmentAudit.fontFingerprint;
          const computedFontDigest = sha256Hex(
            canonicalJson({
              kind: 'font-fingerprint-v1',
              stack: ff.stack.trim().normalize('NFC'),
              families: ff.families.map((fam) => ({
                family: fam.family,
                available: fam.available === true,
                advances: fam.advances.map((a) => Math.round(a * 1000) / 1000),
              })),
              loadedFonts: ff.loadedFonts.map(String).sort(),
            }),
          );
          if (computedFontDigest !== env.fontDigest) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }
        }

        // 核对目标组件及其全部 4 个展示组合均在实测中覆盖并 PASS（防止仅跑 bar 扩散到 line）
        for (const presentation of REQUIRED_PRESENTATIONS) {
          if (!browserKeys.has(`${row.component_id}/${presentation}`)) {
            throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
          }
        }
      }

      if (!seenFrameworks.has('vue') || !seenFrameworks.has('react')) {
        throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
      }

      if (
        evidence.uncovered.length > 0 ||
        !evidence.policy.peerSatisfied ||
        !evidence.policy.hasDualFrameworkCoverage ||
        evidence.policy.supportedRangeUnchanged !== true ||
        evidence.policy.requiresVisualBaselineConfirmation ||
        evidence.recommendation !== 'adopt'
      ) {
        throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
      }

      const existing = await client.query(
        'SELECT 1 FROM compatibility_evidences WHERE variant_release_id=$1 AND echarts_version=$2',
        [row.id, candVersion],
      );
      if (existing.rowCount) {
        throw new PlatformError('CONFLICT');
      }

      const compatibilityId = randomUUID();
      const evidenceSha256 = sha256Hex(canonicalJson(input.evidence));
      const targetCombo = evidence.combinations.find((c) => c.framework === row.framework)!;

      const inserted = (
        await client.query<{ created_at: Date }>(
          `INSERT INTO compatibility_evidences (
             id, variant_release_id, package_release_id, package_name, package_version, package_sha256,
             framework, framework_version, echarts_version, candidate_integrity, candidate_source,
             status, evidence, evidence_sha256, reason, subject
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'passed',$12,$13,$14,$15)
           RETURNING created_at`,
          [
            compatibilityId,
            row.id,
            row.package_release_id,
            row.package_name,
            row.package_version,
            row.package_sha256,
            row.framework,
            targetCombo.frameworkVersion,
            candVersion,
            candIntegrity,
            candSource,
            JSON.stringify(input.evidence),
            evidenceSha256,
            reason,
            context.principal.subject,
          ],
        )
      ).rows[0]!;

      await audit(
        client,
        context.principal.subject,
        'COMPATIBILITY_ACCEPTED',
        compatibilityId,
        {
          variantReleaseId: row.id,
          variantId: row.variant_id,
          echartsVersion: candVersion,
          packageSha256: row.package_sha256,
          candidateIntegrity: candIntegrity,
          evidenceSha256,
        },
        context.requestId,
      );

      return {
        compatibilityId,
        variantReleaseId: row.id,
        variantId: row.variant_id,
        packageName: row.package_name,
        packageVersion: row.package_version,
        packageSha256: row.package_sha256,
        framework: row.framework,
        frameworkVersion: targetCombo.frameworkVersion,
        echartsVersion: candVersion,
        candidateIntegrity: candIntegrity,
        candidateSource: candSource,
        status: 'passed' as const,
        evidenceSha256,
        reason,
        subject: context.principal.subject,
        createdAt: inserted.created_at.toISOString(),
      };
    });
  }

  async list(variantReleaseId: string, subject: string | null = null, roles: readonly string[] = []) {
    const id = uuid(variantReleaseId);
    const release = (
      await this.db.query<{ id: string; component_id: string }>(
        `SELECT vr.id, v.component_id
           FROM variant_releases vr
           JOIN variants v ON v.id = vr.variant_id
           JOIN components c ON c.id = v.component_id
           JOIN package_releases p ON p.id = vr.package_release_id
           JOIN release_jobs j ON j.id = p.job_id
          WHERE vr.id = $1 AND p.state = 'READY' AND j.state = 'READY'
            AND vr.availability IN ('Ready', 'DEPRECATED')
            AND catalog_can_read(c.id, $2)`,
        [id, subject],
      )
    ).rows[0];
    if (!release) throw new PlatformError('NOT_FOUND', [], subject !== null);

    let includeAuditFields = false;
    if (subject !== null && roles.includes('maintainer')) {
      const perm = await this.db.query(
        'SELECT 1 FROM component_permissions WHERE subject=$1 AND component_id=$2 AND can_maintain=true',
        [subject, release.component_id],
      );
      includeAuditFields = Boolean(perm.rowCount);
    }

    const rows = (
      await this.db.query<{
        id: string;
        variant_release_id: string;
        package_name: string;
        package_version: string;
        package_sha256: string;
        framework: 'vue' | 'react';
        framework_version: string;
        echarts_version: string;
        candidate_integrity: string;
        candidate_source: string;
        status: 'passed';
        evidence_sha256: string;
        reason: string;
        subject: string;
        created_at: Date;
      }>(
        `SELECT id, variant_release_id, package_name, package_version, package_sha256,
                framework, framework_version, echarts_version, candidate_integrity, candidate_source,
                status, evidence_sha256, reason, subject, created_at
           FROM compatibility_evidences
          WHERE variant_release_id = $1
          ORDER BY created_at DESC`,
        [id],
      )
    ).rows;

    return {
      variantReleaseId: id,
      items: rows.map((r) => {
        const base = {
          compatibilityId: r.id,
          variantReleaseId: r.variant_release_id,
          packageName: r.package_name,
          packageVersion: r.package_version,
          packageSha256: r.package_sha256,
          framework: r.framework,
          frameworkVersion: r.framework_version,
          echartsVersion: r.echarts_version,
          candidateIntegrity: r.candidate_integrity,
          candidateSource: r.candidate_source,
          status: r.status,
          evidenceSha256: r.evidence_sha256,
          createdAt: r.created_at.toISOString(),
        };
        return includeAuditFields ? { ...base, reason: r.reason, subject: r.subject } : base;
      }),
    };
  }
}
