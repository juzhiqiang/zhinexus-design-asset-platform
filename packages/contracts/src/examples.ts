import type { ArtifactRef, Framework, ScreenshotSource, Sha256 } from './release-manifest.js';

export type Renderer = 'canvas' | 'svg';
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
