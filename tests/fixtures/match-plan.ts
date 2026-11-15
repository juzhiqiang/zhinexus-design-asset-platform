export const componentApiFixture = (framework: 'vue'|'react' = 'vue') => ({
  schemaVersion: 1 as const, componentId: 'line', framework, exportName: 'LineChart', exportPath: './line',
  props: [{ name: 'data', type: 'ChartData', required: true }, { name: 'config', type: 'LineChartConfig', required: false }],
  events: [{ name: framework === 'vue' ? 'point-click' : 'onPointClick', payload: 'ChartEvent' }],
  styleExport: './style.css', readyMethod: 'whenRendered', notes: [],
});
export const matchRequestFixture = () => ({
  design: { schemaVersion: 1 as const, mapping: { schemaVersion: 1 as const, ruleSetId: 'library', revision: 'draft-1',
    entries: [{ designId: '设计/Line', framework: 'vue' as const, variantReleaseId: '00000000-0000-4000-8000-000000000001' }] },
  elements: [{ instanceId: 'node-1', designId: '设计/Line' }] },
  context: { framework: 'vue' as const, frameworkVersion: '3.5.45', echartsVersion: '6.1.0', packageManager: 'pnpm' as const, requirements: [] },
});
export const matchPlanFixture = () => ({
  schemaVersion: 1 as const, source: 'design-id' as const, inputDigest: 'a'.repeat(64), ruleSetId: 'library', revision: 'draft-1', context: matchRequestFixture().context,
  elements: [{ instanceId: 'node-1', designId: '设计/Line', status: 'mapped' as const,
    target: { variantReleaseId: '00000000-0000-4000-8000-000000000001', variantId: 'line-vue', componentId: 'line', framework: 'vue' as const,
      packageName: '@company/charts-vue', packageVersion: '0.0.10', packageSha256: 'b'.repeat(64), exportName: 'LineChart', exportPath: './line',
      evidence: [{ kind: 'api' as const, path: 'api/line.json', sha256: 'c'.repeat(64) }, { kind: 'docs' as const, path: 'docs/line.md', sha256: 'd'.repeat(64) }],
      compatibility: { status: 'unverified' as const, recordIds: [] }, examples: [{ id: 'example', previewEntry: 'preview/index.html' }],
      styleExport: './style.css', readyMethod: 'whenRendered', notes: [], },
    props: [{ name: 'data', type: 'ChartData', required: true, source: 'sales' }],
    events: [{ name: 'point-click', payload: 'ChartEvent', handler: 'showDetail' }], layout: 'grid cell 1',
    gaps: [{ code: 'COMPATIBILITY_UNVERIFIED' as const, message: '缺少实测组合' }],
  }], exactDependencies: [{ name: '@company/charts-vue', version: '0.0.10' }], gaps: [],
});
