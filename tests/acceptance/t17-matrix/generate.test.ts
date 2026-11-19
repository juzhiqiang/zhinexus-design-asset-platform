import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ComponentApiV1, PackageRef } from '@company/contracts';
import type { GeneratedBindingModel } from '../../../packages/component-cli/src/integration/bindings.js';
import { generateReactComponent } from '../../../packages/component-cli/src/integration/generate-react.js';
import { afterEach, describe, expect, it } from 'vitest';
import { materializeProject } from '../../fixtures/t17-matrix/generate.js';
import { T17_POSITIVE_SCENARIOS } from '../../fixtures/t17-matrix/scenarios.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('T17 React host fixture', () => {
  it('imports the exact component symbol exported by the production React generator', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 't17-react-fixture-'));
    roots.push(root);
    const scenario = T17_POSITIVE_SCENARIOS.find((item) => item.framework === 'react' && item.components.length === 1)!;
    const component = scenario.components[0]!;
    const api: ComponentApiV1 = {
      schemaVersion: 1, componentId: component.componentId, framework: 'react', exportName: 'LineChart', exportPath: './line',
      props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
      events: [{ name: 'point-click', payload: 'ChartEvent' }], styleExport: './style.css', readyMethod: 'ready', notes: [],
    };
    const bundleManifest = { packages: [
      { name: '@company/charts-react', version: '0.0.12' },
      { name: '@company/charts-core', version: '0.0.11' },
    ] as PackageRef[] };
    const project = await materializeProject(
      { workRoot: root } as never, scenario, bundleManifest, new Map([[component.instanceId, api]]),
    );
    const host = await readFile(path.join(project.workspaceDir, 'src', 'App.tsx'), 'utf8');
    const generatedSource = generateReactComponent({
      exportName: api.exportName, sdkIdentifier: 'SDKLineChart', importSpecifier: '@company/charts-react/line',
      styleSpecifier: '@company/charts-react/style.css', componentName: 'ZhinexusLineChart',
      bindings: [{ kind: 'source', prop: 'data', type: 'ChartData', key: 'matrix.data', required: true, registry: 'dataSources' }],
      typeImports: ['ChartData'],
    } satisfies GeneratedBindingModel);
    const generatedExportName = /export function ([A-Za-z_$][A-Za-z0-9_$]*)\(/.exec(generatedSource)?.[1];
    expect(generatedExportName).toBe('ZhinexusLineChart');
    expect(host).toContain(`import { ${generatedExportName} as Chart1 } from './components/zhinexus/component-0001.tsx';`);
  });
});
