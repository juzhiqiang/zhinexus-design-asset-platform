import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import { audit, requireComponents, uuid, type RequestContext } from '../db/access.js';
import { PlatformError } from '../errors.js';

const SHA256_RE = /^[a-f0-9]{64}$/;
const EXACT_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const VALID_DIMENSIONS = new Set(['passed', 'failed', 'not-run']);

type ValidatedProbeEvidence = {
  schemaVersion: 1;
  kind: 'a-t10-sdk-probe';
  bundle: {
    version: string;
    packages: Array<{ name: string; version: string; sha256: string; bytes: number }>;
  };
  candidate: {
    version: string;
    integrity?: string;
    source?: string;
    integrityVerified?: boolean;
  };
  combinations: Array<{
    framework: string;
    frameworkVersion: string;
    echartsVersion: string;
    dimensions: { typecheck: string; runtime: string; interaction: string; visual: string };
    failures: Array<{ dimension?: string; reason?: string; detail?: string }>;
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

function validateProbeEvidencePayload(raw: unknown): ValidatedProbeEvidence | null {
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion !== 1 || raw.kind !== 'a-t10-sdk-probe') return null;
  if (!isPlainObject(raw.bundle) || typeof raw.bundle.version !== 'string' || !Array.isArray(raw.bundle.packages) || raw.bundle.packages.length === 0) {
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
  if (!isPlainObject(raw.candidate) || typeof raw.candidate.version !== 'string' || !EXACT_SEMVER_RE.test(raw.candidate.version)) {
    return null;
  }
  if (raw.candidate.integrityVerified !== undefined && typeof raw.candidate.integrityVerified !== 'boolean') {
    return null;
  }
  if (!Array.isArray(raw.combinations) || raw.combinations.length === 0) return null;
  for (const c of raw.combinations) {
    if (
      !isPlainObject(c) ||
      typeof c.framework !== 'string' ||
      typeof c.frameworkVersion !== 'string' ||
      !c.frameworkVersion ||
      typeof c.echartsVersion !== 'string' ||
      !EXACT_SEMVER_RE.test(c.echartsVersion) ||
      !isPlainObject(c.dimensions) ||
      !Array.isArray(c.failures)
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
    if (!EXACT_SEMVER_RE.test(candVersion) || !candIntegrity || !candSource || candSource === 'offline') {
      throw new PlatformError('INVALID_SCHEMA');
    }
    try {
      const parsedUrl = new URL(candSource);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new PlatformError('INVALID_SCHEMA');
      }
    } catch {
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
        }>(
          `SELECT vr.id, vr.variant_id, v.component_id, v.framework, pr.id AS package_release_id,
                  pr.name AS package_name, pr.version AS package_version, pr.sha256 AS package_sha256,
                  vr.availability, pr.state AS pkg_state, rj.state AS job_state
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

      if (evidence.bundle.version !== row.package_version) {
        throw new PlatformError('REPORT_MISMATCH');
      }
      const matchedPkg = evidence.bundle.packages.find(
        (p) => p.name === row.package_name && p.version === row.package_version && p.sha256 === row.package_sha256,
      );
      if (!matchedPkg) {
        throw new PlatformError('DIGEST_MISMATCH');
      }

      if (
        evidence.candidate.version !== candVersion ||
        evidence.candidate.integrity !== candIntegrity ||
        evidence.candidate.source === 'offline' ||
        evidence.candidate.source !== candSource
      ) {
        throw new PlatformError('REPORT_MISMATCH');
      }

      if (evidence.candidate.integrityVerified !== true || evidence.policy.candidateIntegrityVerified !== true) {
        throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
      }

      if (evidence.combinations.some((c) => c.echartsVersion !== candVersion)) {
        throw new PlatformError('REPORT_MISMATCH');
      }

      const matchingCombos = evidence.combinations.filter((c) => c.framework === row.framework);
      if (matchingCombos.length === 0) {
        throw new PlatformError('COMPATIBILITY_EVIDENCE_REQUIRED');
      }

      const allDimsPassed = matchingCombos.every(
        (c) =>
          c.dimensions.typecheck === 'passed' &&
          c.dimensions.runtime === 'passed' &&
          c.dimensions.interaction === 'passed' &&
          c.dimensions.visual === 'passed' &&
          c.failures.length === 0,
      );

      if (
        !allDimsPassed ||
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
      const evidenceSha256 = createHash('sha256').update(JSON.stringify(input.evidence)).digest('hex');
      const frameworkVersion = matchingCombos[0]!.frameworkVersion;

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
            frameworkVersion,
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
        frameworkVersion,
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

  async list(variantReleaseId: string, subject: string | null = null) {
    const id = uuid(variantReleaseId);
    const release = (
      await this.db.query<{ id: string }>(
        `SELECT vr.id
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
      items: rows.map((r) => ({
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
        reason: r.reason,
        subject: r.subject,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }
}
