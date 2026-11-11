import { array, artifactPath, choice, exactVersion, hash, integer, object, text, timestamp } from './schema.js';
import type { Schema } from './schema.js';

export const artifactSchema = object({ path: artifactPath, sha256: hash, bytes: integer() });
const framework = choice('vue', 'react');
const renderer = choice('canvas', 'svg');
const id: Schema = { ...text, maxLength: 128, pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]*$' };
export const exampleSchema = object({ id, previewEntry: artifactPath, previewFiles: array(artifactSchema, 1), fixtureDigest: hash, renderer, theme: text, width: integer(1, 8192), height: integer(1, 8192), requiredStates: array(text, 1) });
export const screenshotSchema = object({
  id, variantId: id, framework, packageVersion: exactVersion, exampleId: id, state: text,
  source: choice('local-automatic', 'manual-upload'), image: artifactSchema, packageSha256: hash,
  environmentKey: { type: 'string', pattern: '^(?:[a-f0-9]{64}|unknown-manual)$' }, reportId: id,
}, ['reportId']);
export const environmentSchema = object({
  os: text, arch: text, browserVersion: text, browserRevision: text, fontDigest: hash, locale: text, timezone: text,
  deviceScaleFactor: { type: 'number', exclusiveMinimum: 0 }, renderer, width: integer(1, 8192), height: integer(1, 8192),
  theme: text, frameworkVersion: exactVersion, echartsVersion: exactVersion,
});
export const compatibilitySchema = object({ framework, frameworkVersion: exactVersion, reactDomVersion: exactVersion, echartsVersion: exactVersion, status: choice('candidate', 'passed', 'failed'), reportId: id, verifiedAt: timestamp }, ['reactDomVersion', 'reportId', 'verifiedAt']);
export const reportSchema = object({
  id, toolVersion: exactVersion, variantId: id, packageSha256: hash, exampleId: id, environment: environmentSchema,
  checks: array(object({ name: text, status: choice('passed', 'failed'), evidence: artifactSchema }, ['evidence']), 1),
  screenshots: array(screenshotSchema, 1), baselineRevision: id, baselineResult: choice('PASS', 'DIFF', 'NEW', 'INCOMPATIBLE'), createdAt: timestamp,
}, ['baselineRevision']);
const dependencies: Schema = { type: 'object', additionalProperties: text };
export const packageSchema = object({
  name: { ...text, pattern: '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' }, version: exactVersion,
  tarball: artifactSchema, sourceDigest: hash, sourceCommit: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' }, dependencies, peerDependencies: dependencies,
}, ['sourceCommit']);
export const variantSchema = object({
  componentId: id, variantId: id, framework, packageName: packageSchema.properties!.name!, packageVersion: exactVersion,
  exportPath: { ...text, pattern: '^\\.(?:/[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*)?$' }, exportName: { ...text, pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$' },
  api: artifactSchema, docs: artifactSchema, examples: array(exampleSchema, 1), screenshots: array(screenshotSchema), compatibility: array(compatibilitySchema),
});
export const manifestSchema = object({ schemaVersion: { type: 'integer', const: 1 }, channel: choice('cli', 'web'), packages: array(packageSchema, 1), variants: array(variantSchema), files: array(artifactSchema, 1), reports: array(artifactSchema) });

/** Cross-reference and evidence rules are enforced by validateManifest, not JSON Schema alone. */
export const CONTRACT_SCHEMAS: Record<string, Schema> = Object.fromEntries(Object.entries({
  'release-manifest-v1': manifestSchema, 'example-ref-v1': exampleSchema, 'screenshot-ref-v1': screenshotSchema,
  'environment-v1': environmentSchema, 'check-report-v1': reportSchema,
}).map(([name, schema]) => [name, { $schema: 'https://json-schema.org/draft/2020-12/schema', title: name, ...schema }]));
