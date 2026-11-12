import type { ArtifactRef, Framework, ScreenshotSource, Sha256 } from './release-manifest.js';

export type Renderer = 'canvas' | 'svg';
export type CheckResult = { name: string; status: 'passed' | 'failed'; message?: string };
/** Browser examples expose this as window.__COMPONENT_EXAMPLE__; no DOM global augmentation. */
export type ComponentExample = {
  ready: Promise<void>;
  /** Optional discovery only; ExampleRef.requiredStates remains the execution checklist. */
  readonly states?: readonly string[];
  runState(name: string): Promise<void>;
  getChecks(): CheckResult[];
};
export type ExampleRef = {
  id: string; previewEntry: string; previewFiles: ArtifactRef[];
  fixtureDigest: Sha256; renderer: Renderer; theme: string;
  width: number; height: number; requiredStates: string[];
};
export type ScreenshotRef = {
  id: string; variantId: string; framework: Framework;
  packageVersion: string; exampleId: string; state: string;
  source: ScreenshotSource; image: ArtifactRef;
  packageSha256: Sha256; environmentKey: string; reportId?: string;
};
