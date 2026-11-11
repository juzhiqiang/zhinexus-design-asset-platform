/** Draft only: runtime validation and schema freezing belong to G1. */
export type * from './release-manifest.js';
export type * from './examples.js';
export type * from './reports.js';
export const MANIFEST_SCHEMA_VERSION = 1 as const;
export type BootstrapHealth = {
  status: 'ok';
  service: 'api' | 'preview-gateway';
  stage: 'bootstrap';
};
