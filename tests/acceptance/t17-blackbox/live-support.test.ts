import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('independent live blackbox inputs', () => {
  it('declares every public prop and framework-specific event without reading CLI output', async () => {
    const { declaredLineApi, makeLiveMatch } = await import('./live-support.js');
    for (const framework of ['vue', 'react'] as const) {
      const api = declaredLineApi(framework);
      expect(api.props.map(p => p.name)).toEqual(framework === 'vue'
        ? ['data', 'config', 'optionOverrides'] : ['data', 'config', 'optionOverrides', 'className', 'style', 'ref']);
      const match = makeLiveMatch(framework, '00000000-0000-4000-8000-000000000123');
      expect(match.elements[0]!.props).toEqual(api.props.map(prop => ({ ...prop, ...(prop.name === 'data' ? { source: 'independentRevenue' } : {}) })));
      expect(match.elements[0]!.events[0]!.name).toBe(framework === 'vue' ? 'point-click' : 'onPointClick');
      expect(match.exactDependencies).toContainEqual({ name: '@company/charts-' + framework, version: '0.0.12' });
    }
  });

  it('keeps the direct SDK reference independent of the generated module and owns cancellation files outside source', async () => {
    const { scaffoldLiveProject } = await import('./live-support.js');
    const area = await mkdtemp(join(tmpdir(), 't17-live-input-unit-'));
    try {
      for (const framework of ['vue', 'react'] as const) {
        const project = await scaffoldLiveProject(area, framework, 'cli');
        const reference = await readFile(join(project.root, project.referenceSource), 'utf8');
        const generatedHost = await readFile(join(project.root, project.generatedHostSource), 'utf8');
        expect(reference).toContain('@company/charts-' + framework + '/line');
        expect(reference).not.toContain('components/zhinexus');
        expect(generatedHost).toContain('components/zhinexus/component-0001');
        const manifest = JSON.parse(await readFile(join(project.root, 'package.json'), 'utf8'));
        expect(manifest.scripts.slowcheck).toBe('node live-cancel.mjs');
        expect(project.cancellationDirectory.startsWith(project.root)).toBe(false);
      }
    } finally { await rm(area, { recursive: true, force: true }); }
  });
});
