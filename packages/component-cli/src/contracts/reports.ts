import type { ArtifactRef, Framework, Sha256 } from './release-manifest.js';
import type { Renderer, ScreenshotRef } from './examples.js';

export type EnvironmentV1 = {
  os: string; arch: string; browserVersion: string; browserRevision: string;
  fontDigest: Sha256; locale: string; timezone: string; deviceScaleFactor: number;
  renderer: Renderer; width: number; height: number; theme: string;
  frameworkVersion: string; echartsVersion: string;
};
/** Runtime validation requires ReactDOM for React and report/time evidence for passed. */
export type CompatibilityRecord = {
  framework: Framework; frameworkVersion: string; reactDomVersion?: string;
  echartsVersion: string; status: 'candidate' | 'passed' | 'failed';
  reportId?: string; verifiedAt?: string;
};
export type CheckReportV1 = {
  id: string; toolVersion: string; variantId: string; packageSha256: Sha256;
  exampleId: string; environment: EnvironmentV1;
  checks: { name: string; status: 'passed' | 'failed'; evidence?: ArtifactRef }[];
  screenshots: ScreenshotRef[]; baselineRevision?: string;
  baselineResult: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE'; createdAt: string;
};
