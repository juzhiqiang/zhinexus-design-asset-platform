import type { ValidationResult } from './release-manifest.js';
import { array, choice, exactVersion, object, text, validateSchema } from './schema.js';

/** User-supplied project constraints; shape validation is not compatibility evidence. */
export type ProjectContext = {
  framework: 'vue' | 'react';
  frameworkVersion: string;
  echartsVersion?: string;
  packageManager: 'npm' | 'pnpm';
  requirements: string[];
};

export const projectContextSchema = object({
  framework: choice('vue', 'react'),
  frameworkVersion: exactVersion,
  echartsVersion: exactVersion,
  packageManager: choice('npm', 'pnpm'),
  requirements: array(text),
}, ['echartsVersion']);

export function validateProjectContext(input: unknown): ValidationResult<ProjectContext> {
  return validateSchema<ProjectContext>(projectContextSchema, input);
}
