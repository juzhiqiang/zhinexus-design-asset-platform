import type { Candidate } from '@company/contracts';

/** Synthetic contract fixture; not a published asset or evaluation observation. */
export const candidateFixture = (): Candidate => ({
  variantReleaseId: 'release-react-line', variantId: 'react-line', componentId: 'line', framework: 'react',
  packageName: '@company/charts-react', packageVersion: '0.1.0', packageSha256: 'a'.repeat(64), exportName: 'LineChart',
  evidence: [
    { kind: 'api', path: 'api/line.json', sha256: 'b'.repeat(64) },
    { kind: 'docs', path: 'docs/line.md', sha256: 'c'.repeat(64) },
  ],
  compatibility: { status: 'unverified', recordIds: [] }, ranking: { text: 0.8 }, gaps: [],
});
