import type { ArtifactRef, ReleaseManifestV1, ValidationResult, VariantRef } from './release-manifest.js';
import type { CheckReportV1, EnvironmentV1 } from './reports.js';
import type { ExampleRef, ScreenshotRef } from './examples.js';
import type { ValidationIssue } from './errors.js';
import { validateSchema } from './schema.js';
import { environmentSchema, exampleSchema, manifestSchema, reportSchema, screenshotSchema } from './schemas.js';
import { canonicalJson } from './digests.js';

export const validateEnvironment = (input: unknown) => validateSchema<EnvironmentV1>(environmentSchema, input);
export const validateExample = (input: unknown) => validateSchema<ExampleRef>(exampleSchema, input);
export const validateScreenshot = (input: unknown) => validateSchema<ScreenshotRef>(screenshotSchema, input);
const equalArtifact = (a: ArtifactRef, b: ArtifactRef) => a.path === b.path && a.sha256 === b.sha256 && a.bytes === b.bytes;

export function validateCheckReport(input: unknown): ValidationResult<CheckReportV1> {
  const shape = validateSchema<CheckReportV1>(reportSchema, input);
  if (!shape.ok) return shape;
  const report = shape.value; const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  report.checks.forEach((check, i) => {
    if (ids.has(check.name)) issues.push({ code: 'DUPLICATE_ID', path: `/checks/${i}/name`, message: 'Duplicate check name' });
    ids.add(check.name);
  });
  ids.clear();
  report.screenshots.forEach((shot, i) => {
    if (ids.has(shot.id)) issues.push({ code: 'DUPLICATE_ID', path: `/screenshots/${i}/id`, message: 'Duplicate screenshot id' });
    ids.add(shot.id);
    if (shot.variantId !== report.variantId || shot.packageSha256 !== report.packageSha256 || shot.exampleId !== report.exampleId || shot.reportId !== report.id) issues.push({ code: 'REPORT_MISMATCH', path: `/screenshots/${i}`, message: 'Screenshot must identify this exact report, variant, example and package digest' });
    if (shot.source !== 'local-automatic' || shot.environmentKey === 'unknown-manual') issues.push({ code: 'SOURCE_FORBIDDEN', path: `/screenshots/${i}/source`, message: 'A local check report must contain automatic screenshot evidence' });
  });
  return issues.length ? { ok: false, issues: issues.slice(0, 100) } : shape;
}

export type ManifestValidationContext = {
  /** Parsed report documents, indexed by manifest.reports logical path. Bundle validation binds their bytes. */
  reports?: Readonly<Record<string, unknown>> | undefined;
};

export function validateManifest(input: unknown, context: ManifestValidationContext = {}): ValidationResult<ReleaseManifestV1> {
  const shape = validateSchema<ReleaseManifestV1>(manifestSchema, input);
  if (!shape.ok) return shape;
  const manifest = shape.value; const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssue['code'], path: string, message: string) => { if (issues.length < 100) issues.push({ code, path, message }); };
  const inventory = new Map<string, ArtifactRef>();
  const normalizedPaths = new Set<string>();
  manifest.files.forEach((file, i) => {
    const normalized = file.path.normalize('NFC').toUpperCase();
    if (normalizedPaths.has(normalized)) add('DUPLICATE_ID', `/files/${i}/path`, 'Logical file paths collide under NFC/Windows case normalization');
    normalizedPaths.add(normalized);
    inventory.set(file.path, file);
  });
  const artifact = (ref: ArtifactRef, path: string) => {
    const found = inventory.get(ref.path);
    if (!found) add('REFERENCE_NOT_FOUND', path, 'Artifact is missing from manifest.files');
    else if (!equalArtifact(ref, found)) add('ARTIFACT_MISMATCH', path, 'Artifact metadata differs from manifest.files');
  };
  const unique = (seen: Set<string>, key: string, path: string) => {
    if (seen.has(key)) add('DUPLICATE_ID', path, 'Duplicate identifier in this scope');
    seen.add(key);
  };
  const packages = new Map<string, ReleaseManifestV1['packages'][number]>();
  manifest.packages.forEach((pkg, i) => {
    const key = `${pkg.name}@${pkg.version}`; const existing = packages.get(key);
    if (existing) add(existing.tarball.sha256 !== pkg.tarball.sha256 ? 'CONFLICT' : 'DUPLICATE_ID', `/packages/${i}`, 'Package name and version must be unique; differing digests are a conflict');
    packages.set(key, pkg); artifact(pkg.tarball, `/packages/${i}/tarball`);
  });
  const variantIds = new Set<string>(); const implementations = new Set<string>();
  const variants = new Map<string, VariantRef>();
  manifest.variants.forEach((variant, i) => {
    unique(variantIds, variant.variantId, `/variants/${i}/variantId`);
    unique(implementations, `${variant.componentId}:${variant.framework}`, `/variants/${i}`);
    variants.set(variant.variantId, variant);
  });
  const reports = new Map<string, CheckReportV1>(); const reportPaths = new Set<string>();
  manifest.reports.forEach((ref, i) => {
    const path = `/reports/${i}`; unique(reportPaths, ref.path, path); artifact(ref, path);
    if (!context.reports || !Object.hasOwn(context.reports, ref.path)) { add('REPORT_REQUIRED', path, 'The declared report document must be supplied for cross-reference validation'); return; }
    const result = validateCheckReport(context.reports[ref.path]);
    if (!result.ok) { add('REPORT_MISMATCH', path, 'Declared report is invalid'); issues.push(...result.issues.map(issue => ({ ...issue, path: `${path}${issue.path}` })).slice(0, 100 - issues.length)); return; }
    const report = result.value;
    if (reports.has(report.id)) add('DUPLICATE_ID', `${path}/id`, 'Duplicate report id');
    reports.set(report.id, report);
    const variant = variants.get(report.variantId);
    const pkg = variant && packages.get(`${variant.packageName}@${variant.packageVersion}`);
    const example = variant?.examples.find(e => e.id === report.exampleId);
    if (!variant || !pkg || !example || pkg.tarball.sha256 !== report.packageSha256) add('REPORT_MISMATCH', path, 'Report does not belong to this variant, example and frozen package');
    if (example && (report.environment.width !== example.width || report.environment.height !== example.height || report.environment.renderer !== example.renderer || report.environment.theme !== example.theme)) add('REPORT_MISMATCH', `${path}/environment`, 'Report environment differs from the example configuration');
    report.screenshots.forEach((shot, j) => {
      artifact(shot.image, `${path}/screenshots/${j}/image`);
      if (!variant || shot.framework !== variant.framework || shot.packageVersion !== variant.packageVersion || !example?.requiredStates.includes(shot.state)) add('REPORT_MISMATCH', `${path}/screenshots/${j}`, 'Report screenshot has the wrong framework, version or state');
    });
    report.checks.forEach((check, j) => { if (check.evidence) artifact(check.evidence, `${path}/checks/${j}/evidence`); });
  });
  for (const path of Object.keys(context.reports ?? {})) if (!reportPaths.has(path)) add('UNEXPECTED_FILE', '/reports', 'Supplied report is not declared by the manifest');

  const screenshotIds = new Set<string>(); const exampleIds = new Set<string>();
  manifest.variants.forEach((variant, i) => {
    const base = `/variants/${i}`; const pkg = packages.get(`${variant.packageName}@${variant.packageVersion}`);
    if (!pkg) add('REFERENCE_NOT_FOUND', `${base}/packageName`, 'Variant package/version is not in packages');
    artifact(variant.api, `${base}/api`); artifact(variant.docs, `${base}/docs`);
    const examples = new Map<string, ExampleRef>();
    variant.examples.forEach((example, j) => {
      const path = `${base}/examples/${j}`;
      unique(exampleIds, example.id, `${path}/id`); examples.set(example.id, example);
      const previewPaths = new Set<string>(); const states = new Set<string>();
      example.previewFiles.forEach((ref, n) => { unique(previewPaths, ref.path, `${path}/previewFiles/${n}`); artifact(ref, `${path}/previewFiles/${n}`); });
      example.requiredStates.forEach((state, n) => unique(states, state, `${path}/requiredStates/${n}`));
      if (!previewPaths.has(example.previewEntry)) add('REFERENCE_NOT_FOUND', `${path}/previewEntry`, 'Preview entry must belong to previewFiles');
    });
    if (!variant.screenshots.length) add('SCREENSHOT_REQUIRED', `${base}/screenshots`, 'Every component framework implementation requires a screenshot');
    variant.screenshots.forEach((shot, j) => {
      const path = `${base}/screenshots/${j}`; unique(screenshotIds, shot.id, `${path}/id`);
      const example = examples.get(shot.exampleId);
      if (shot.variantId !== variant.variantId || shot.framework !== variant.framework || shot.packageVersion !== variant.packageVersion || !example || !example.requiredStates.includes(shot.state)) add('SCREENSHOT_VARIANT_MISMATCH', path, 'Screenshot must belong to this variant/framework/version/example/state');
      if (pkg && shot.packageSha256 !== pkg.tarball.sha256) add('DIGEST_MISMATCH', `${path}/packageSha256`, 'Screenshot package digest differs from frozen tarball');
      artifact(shot.image, `${path}/image`);
      if (manifest.channel === 'web' && shot.source !== 'manual-upload' || shot.source === 'manual-upload' && shot.environmentKey !== 'unknown-manual') add('SOURCE_FORBIDDEN', path, 'Web screenshots must be manual uploads with an unknown-manual environment');
      if (shot.source === 'local-automatic') {
        const report = shot.reportId && reports.get(shot.reportId);
        if (!report) add('REPORT_REQUIRED', path, 'Automatic screenshots require their declared check report');
        else if (!report.screenshots.some(s => canonicalJson(s) === canonicalJson(shot))) add('REPORT_MISMATCH', path, 'Screenshot is not identical to the referenced report evidence');
      } else if (shot.reportId) {
        const report = reports.get(shot.reportId);
        if (!report) add('REPORT_REQUIRED', `${path}/reportId`, 'Referenced report does not exist');
        else if (report.variantId !== variant.variantId || report.packageSha256 !== pkg?.tarball.sha256 || report.exampleId !== shot.exampleId) add('REPORT_MISMATCH', `${path}/reportId`, 'Manual screenshot report must refer to the same variant, example and frozen package');
      }
    });
    if (variant.screenshots.some(shot => shot.source === 'local-automatic')) {
      variant.examples.forEach((example, j) => {
        for (const state of example.requiredStates) if (!variant.screenshots.some(shot => shot.source === 'local-automatic' && shot.exampleId === example.id && shot.state === state)) add('REPORT_REQUIRED', `${base}/examples/${j}/requiredStates`, 'Automatic validation must cover every declared example state');
      });
    }
    variant.compatibility.forEach((record, j) => {
      const path = `${base}/compatibility/${j}`; const report = record.reportId && reports.get(record.reportId);
      if (record.framework !== variant.framework || record.framework === 'react' && !record.reactDomVersion) add('COMPATIBILITY_EVIDENCE_REQUIRED', path, 'Compatibility framework must match; ReactDOM exact version is required for React');
      if (record.reportId && !report) add('COMPATIBILITY_EVIDENCE_REQUIRED', `${path}/reportId`, 'Compatibility report must be supplied');
      if (report && (report.variantId !== variant.variantId || report.packageSha256 !== pkg?.tarball.sha256 || report.environment.frameworkVersion !== record.frameworkVersion || report.environment.echartsVersion !== record.echartsVersion)) add('COMPATIBILITY_EVIDENCE_REQUIRED', `${path}/reportId`, 'Compatibility evidence must belong to this exact variant, package and dependency combination');
      if (record.status === 'passed' && (!record.verifiedAt || !report || report.variantId !== variant.variantId || report.packageSha256 !== pkg?.tarball.sha256 || report.environment.frameworkVersion !== record.frameworkVersion || report.environment.echartsVersion !== record.echartsVersion || report.checks.some(check => check.status !== 'passed') || !['PASS', 'NEW'].includes(report.baselineResult) || Date.parse(record.verifiedAt) < Date.parse(report.createdAt))) add('COMPATIBILITY_EVIDENCE_REQUIRED', path, 'Passed compatibility requires a successful report for the exact package and dependency versions, with a valid verification time');
      if (record.status === 'passed') {
        const evidence = [...reports.values()].filter(r => r.variantId === variant.variantId && r.packageSha256 === pkg?.tarball.sha256 && r.environment.frameworkVersion === record.frameworkVersion && r.environment.echartsVersion === record.echartsVersion && Date.parse(r.createdAt) <= Date.parse(record.verifiedAt ?? '') && r.checks.every(c => c.status === 'passed') && ['PASS', 'NEW'].includes(r.baselineResult));
        if (!variant.examples.every(example => example.requiredStates.every(state => evidence.some(r => r.exampleId === example.id && r.screenshots.some(s => s.state === state))))) add('COMPATIBILITY_EVIDENCE_REQUIRED', path, 'Successful reports must cover every required example state for passed compatibility');
      }
      if (record.status !== 'candidate' && !report) add('COMPATIBILITY_EVIDENCE_REQUIRED', path, 'Without a local report only candidate compatibility is permitted');
    });
  });
  return issues.length ? { ok: false, issues } : shape;
}
