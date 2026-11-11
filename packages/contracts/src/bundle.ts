import type { ReleaseManifestV1, ValidationResult } from './release-manifest.js';
import type { CheckReportV1 } from './reports.js';
import type { ValidationIssue } from './errors.js';
import { validateSchema } from './schema.js';
import { manifestSchema } from './schemas.js';
import { environmentKey, sha256 } from './digests.js';
import { validateCheckReport, validateManifest } from './validation.js';

/** Bytes must be read from a bounded, safe upload store. Does not unpack, install or execute anything. */
export async function validateReleaseBundle(input: unknown, files: ReadonlyMap<string, Uint8Array>): Promise<ValidationResult<ReleaseManifestV1>> {
  const shape = validateSchema<ReleaseManifestV1>(manifestSchema, input);
  if (!shape.ok) return shape;
  const manifest = shape.value; const issues: ValidationIssue[] = [];
  const listed = new Set(manifest.files.map(ref => ref.path));
  for (const [path] of files) if (!listed.has(path)) issues.push({ code: 'UNEXPECTED_FILE', path: '/files', message: 'Bundle includes an unlisted file' });
  for (const [i, ref] of manifest.files.entries()) {
    const bytes = files.get(ref.path);
    if (!bytes) issues.push({ code: 'FILE_REQUIRED', path: `/files/${i}`, message: 'Declared file bytes are missing' });
    else if (ref.bytes !== bytes.byteLength || await sha256(bytes) !== ref.sha256) issues.push({ code: 'DIGEST_MISMATCH', path: `/files/${i}`, message: 'Actual file bytes or SHA-256 differ from the frozen inventory' });
  }
  if (issues.length) return { ok: false, issues: issues.slice(0, 100) };
  const reports: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [i, ref] of manifest.reports.entries()) {
    const bytes = files.get(ref.path);
    if (!bytes) { issues.push({ code: 'FILE_REQUIRED', path: `/reports/${i}`, message: 'Report bytes are missing' }); continue; }
    try { reports[ref.path] = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { issues.push({ code: 'INVALID_SCHEMA', path: `/reports/${i}`, message: 'Report must be valid UTF-8 JSON' }); continue; }
    const validated = validateCheckReport(reports[ref.path]);
    if (validated.ok) {
      const report: CheckReportV1 = validated.value; const key = await environmentKey(report.environment);
      for (const [j, shot] of report.screenshots.entries()) if (shot.environmentKey !== key) issues.push({ code: 'REPORT_MISMATCH', path: `/reports/${i}/screenshots/${j}/environmentKey`, message: 'Screenshot environment key differs from the actual report environment' });
    }
  }
  if (issues.length) return { ok: false, issues: issues.slice(0, 100) };
  return validateManifest(manifest, { reports });
}
