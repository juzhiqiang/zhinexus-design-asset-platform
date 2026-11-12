export type * from './release-manifest.js';
export type * from './examples.js';
export const COMPONENT_EXAMPLE_GLOBAL = '__COMPONENT_EXAMPLE__' as const;
/** Shared initial upload limits; APIs still verify actual bytes and enforce aggregate limits. */
export const UPLOAD_LIMITS = Object.freeze({
  tarballBytes: 50 * 1024 ** 2, imageBytes: 10 * 1024 ** 2, totalBytes: 500 * 1024 ** 2,
  archiveBytes: 200 * 1024 ** 2, archiveFiles: 5000, maxFiles: 5000, maxImageDimension: 8192,
  multipartThreshold: 10 * 1024 ** 2, partBytes: 5 * 1024 ** 2,
});
export type * from './reports.js';
export * from './errors.js';
export * from './validation.js';
export * from './digests.js';
export * from './bundle.js';
export * from './api.js';
export { CONTRACT_SCHEMAS } from './schemas.js';
export const MANIFEST_SCHEMA_VERSION = 1 as const;
export type BootstrapHealth = {
  status: 'ok';
  service: 'api' | 'preview-gateway';
  stage: 'bootstrap';
};
