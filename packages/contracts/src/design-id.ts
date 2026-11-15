import type { ValidationIssue } from './errors.js';
import type { ValidationResult } from './release-manifest.js';
import { array, choice, object, text, validateSchema } from './schema.js';

/** User-supplied routing configuration, never authority for access or compatibility. */
export type DesignIdMappingV1 = {
  schemaVersion: 1;
  ruleSetId: string;
  revision: string;
  entries: { designId: string; framework: 'vue' | 'react'; variantReleaseId: string }[];
};
export type DesignElementV1 = { instanceId: string; designId: string };
export type DesignIdInputV1 = { schemaVersion: 1; mapping: DesignIdMappingV1; elements: DesignElementV1[] };

const version = { type: 'integer', const: 1 } as const;
export const designIdMappingSchema = {
  ...object({
    schemaVersion: version, ruleSetId: text, revision: text,
    entries: array(object({ designId: text, framework: choice('vue', 'react'), variantReleaseId: text })),
  }),
  description: 'Opaque IDs are compared exactly. The runtime validator additionally rejects duplicate designId/framework pairs. This configuration is not eligibility evidence.',
};
export const designIdInputSchema = {
  ...object({ schemaVersion: version, mapping: designIdMappingSchema, elements: array(object({ instanceId: text, designId: text })) }),
  description: 'The runtime validator additionally requires unique instanceIds. Unknown designIds remain valid input for gap reporting; multiple instances may share a designId.',
};

function mappingIssues(mapping: DesignIdMappingV1, prefix = ''): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  mapping.entries.forEach((entry, i) => {
    // JSON tuple encoding preserves opaque strings without delimiter collisions.
    const key = JSON.stringify([entry.designId, entry.framework]);
    if (seen.has(key) && issues.length < 100) issues.push({
      code: 'DUPLICATE_ID', path: `${prefix}/entries/${i}/designId`,
      message: 'A designId/framework pair must have exactly one mapping entry',
    });
    seen.add(key);
  });
  return issues;
}

export function validateDesignIdMapping(input: unknown): ValidationResult<DesignIdMappingV1> {
  const result = validateSchema<DesignIdMappingV1>(designIdMappingSchema, input);
  if (!result.ok) return result;
  const issues = mappingIssues(result.value);
  return issues.length ? { ok: false, issues } : result;
}

export function validateDesignIdInput(input: unknown): ValidationResult<DesignIdInputV1> {
  const result = validateSchema<DesignIdInputV1>(designIdInputSchema, input);
  if (!result.ok) return result;
  const issues = mappingIssues(result.value.mapping, '/mapping');
  const seen = new Set<string>();
  result.value.elements.forEach((element, i) => {
    if (seen.has(element.instanceId) && issues.length < 100) issues.push({
      code: 'DUPLICATE_ID', path: `/elements/${i}/instanceId`, message: 'Each design element must have a unique instanceId',
    });
    seen.add(element.instanceId);
  });
  return issues.length ? { ok: false, issues } : result;
}
