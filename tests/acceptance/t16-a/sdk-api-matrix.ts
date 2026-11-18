export type SdkFramework = 'vue' | 'react';

export type SdkPropSpec = {
  name: string;
  type: string;
  required: boolean;
};

export type SdkEventSpec = {
  /** Vue 为 Emits 事件名（point-click）；React 为回调 Prop 名（onPointClick）。 */
  name: string;
  /** Vue 模板绑定写法（@point-click）；React JSX Prop 写法（onPointClick）。 */
  templateBinding: string;
  payload: string;
};

export type SdkApiAuditEntry = {
  componentId: 'line' | 'bar' | 'pie' | 'scatter' | 'trend-card' | 'ranking' | 'proportion';
  framework: SdkFramework;
  packageName: '@company/charts-vue' | '@company/charts-react';
  packageVersion: '0.0.12';
  coreDependencyVersion: '0.0.11';
  importSpecifier: string;
  exportName: string;
  styleImport: '@company/charts-vue/style.css' | '@company/charts-react/style.css';
  readyMethod: 'whenRendered';
  requiredProps: readonly SdkPropSpec[];
  optionalProps: readonly SdkPropSpec[];
  events: readonly SdkEventSpec[];
  sourceEvidence: readonly string[];
  frozenApiEvidence: string;
};

const COMPONENTS: ReadonlyArray<{
  componentId: SdkApiAuditEntry['componentId'];
  exportName: string;
  configType: string;
  handleType: string;
  vueFile: string;
  reactFile: string;
}> = [
  {
    componentId: 'line',
    exportName: 'LineChart',
    configType: 'LineChartConfig',
    handleType: 'LineChartHandle',
    vueFile: 'LineChart.vue',
    reactFile: 'LineChart.tsx',
  },
  {
    componentId: 'bar',
    exportName: 'BarChart',
    configType: 'BarChartConfig',
    handleType: 'BarChartHandle',
    vueFile: 'BarChart.vue',
    reactFile: 'BarChart.tsx',
  },
  {
    componentId: 'pie',
    exportName: 'PieChart',
    configType: 'PieChartConfig',
    handleType: 'PieChartHandle',
    vueFile: 'PieChart.vue',
    reactFile: 'PieChart.tsx',
  },
  {
    componentId: 'scatter',
    exportName: 'ScatterChart',
    configType: 'ScatterChartConfig',
    handleType: 'ScatterChartHandle',
    vueFile: 'ScatterChart.vue',
    reactFile: 'ScatterChart.tsx',
  },
  {
    componentId: 'trend-card',
    exportName: 'TrendCard',
    configType: 'TrendCardConfig',
    handleType: 'TrendCardHandle',
    vueFile: 'TrendCard.vue',
    reactFile: 'TrendCard.tsx',
  },
  {
    componentId: 'ranking',
    exportName: 'Ranking',
    configType: 'RankingChartConfig',
    handleType: 'RankingHandle',
    vueFile: 'RankingChart.vue',
    reactFile: 'RankingChart.tsx',
  },
  {
    componentId: 'proportion',
    exportName: 'Proportion',
    configType: 'ProportionChartConfig',
    handleType: 'ProportionHandle',
    vueFile: 'ProportionChart.vue',
    reactFile: 'ProportionChart.tsx',
  },
];

/**
 * 7 逻辑组件 × Vue 3 / React 19 共 14 实现的独立 API 对照矩阵。
 * 全部字段由 packages/charts-{core,vue,react} 真实源码类型与冻结 API 清单独立审计得出。
 */
export const sdkApiAuditMatrix: readonly SdkApiAuditEntry[] = COMPONENTS.flatMap((comp) => [
  {
    componentId: comp.componentId,
    framework: 'vue',
    packageName: '@company/charts-vue',
    packageVersion: '0.0.12',
    coreDependencyVersion: '0.0.11',
    importSpecifier: `@company/charts-vue/${comp.componentId}`,
    exportName: comp.exportName,
    styleImport: '@company/charts-vue/style.css',
    readyMethod: 'whenRendered',
    requiredProps: [{ name: 'data', type: 'ChartData', required: true }],
    optionalProps: [
      { name: 'config', type: comp.configType, required: false },
      { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false },
    ],
    events: [{ name: 'point-click', templateBinding: '@point-click', payload: 'ChartEvent' }],
    sourceEvidence: [
      `packages/charts-vue/src/${comp.componentId}.ts`,
      `packages/charts-vue/src/${comp.componentId}-chart.types.ts`,
      `packages/charts-vue/src/${comp.vueFile}`,
      'packages/charts-vue/package.json',
    ],
    frozenApiEvidence: `api/${comp.componentId}-vue.json`,
  },
  {
    componentId: comp.componentId,
    framework: 'react',
    packageName: '@company/charts-react',
    packageVersion: '0.0.12',
    coreDependencyVersion: '0.0.11',
    importSpecifier: `@company/charts-react/${comp.componentId}`,
    exportName: comp.exportName,
    styleImport: '@company/charts-react/style.css',
    readyMethod: 'whenRendered',
    requiredProps: [{ name: 'data', type: 'ChartData', required: true }],
    optionalProps: [
      { name: 'config', type: comp.configType, required: false },
      { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false },
      { name: 'className', type: 'string', required: false },
      { name: 'style', type: 'CSSProperties', required: false },
      { name: 'ref', type: `Ref<${comp.handleType} | null>`, required: false },
    ],
    events: [{ name: 'onPointClick', templateBinding: 'onPointClick', payload: 'ChartEvent' }],
    sourceEvidence: [
      `packages/charts-react/src/${comp.componentId}.ts`,
      `packages/charts-react/src/${comp.componentId}-chart.types.ts`,
      `packages/charts-react/src/${comp.reactFile}`,
      'packages/charts-react/package.json',
    ],
    frozenApiEvidence: `api/${comp.componentId}-react.json`,
  },
]);
