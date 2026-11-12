import type { ExampleRef, ScreenshotRef } from './examples.js';
import type { CompatibilityRecord } from './reports.js';
import type { ValidationIssue } from './errors.js';

export type Framework = 'vue' | 'react';
export type ScreenshotSource = 'local-automatic' | 'manual-upload';
export type ReleaseChannel = 'cli' | 'web';
/** Runtime validators require 64 lowercase hexadecimal characters. */
export type Sha256 = string;
export type ArtifactRef = { path: string; sha256: Sha256; bytes: number };
export type PackageRef = {
  name: string; version: string; tarball: ArtifactRef;
  sourceDigest: Sha256; sourceCommit?: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};
export type VariantRef = {
  componentId: string; variantId: string; framework: Framework;
  packageName: string; packageVersion: string;
  exportPath: string; exportName: string;
  api: ArtifactRef; docs: ArtifactRef; examples: ExampleRef[];
  screenshots: ScreenshotRef[]; compatibility: CompatibilityRecord[];
};
export type ReleaseManifestV1 = {
  schemaVersion: 1; channel: ReleaseChannel;
  packages: PackageRef[]; variants: VariantRef[];
  files: ArtifactRef[]; reports: ArtifactRef[];
};
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };
