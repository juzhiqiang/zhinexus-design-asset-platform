import type { ComponentApiV1 } from '../contracts/component-api.js';
import type { Framework } from '../contracts/release-manifest.js';

export type SupportedComponentName =
  | 'line'
  | 'bar'
  | 'pie'
  | 'scatter'
  | 'trend-card'
  | 'ranking'
  | 'proportion';

type ComponentMeta = {
  exportName: string;
  configType: string;
  handleType: string;
  extraNotes: string[];
};

const COMPONENT_META: Record<SupportedComponentName, ComponentMeta> = {
  line: {
    exportName: 'LineChart',
    configType: 'LineChartConfig',
    handleType: 'LineChartHandle',
    extraNotes: [],
  },
  bar: {
    exportName: 'BarChart',
    configType: 'BarChartConfig',
    handleType: 'BarChartHandle',
    extraNotes: [],
  },
  pie: {
    exportName: 'PieChart',
    configType: 'PieChartConfig',
    handleType: 'PieChartHandle',
    extraNotes: ['optionOverrides 仅支持 tooltip、legend、title，忽略 grid/xAxis/yAxis', '数据值不得为负数'],
  },
  scatter: {
    exportName: 'ScatterChart',
    configType: 'ScatterChartConfig',
    handleType: 'ScatterChartHandle',
    extraNotes: ['数据点 x 必须为数值'],
  },
  'trend-card': {
    exportName: 'TrendCard',
    configType: 'TrendCardConfig',
    handleType: 'TrendCardHandle',
    extraNotes: [],
  },
  ranking: {
    exportName: 'Ranking',
    configType: 'RankingChartConfig',
    handleType: 'RankingHandle',
    extraNotes: ['config.chart 固定为 ranking；点击载荷为 ChartEvent', '仅允许单系列且条目名称必须唯一'],
  },
  proportion: {
    exportName: 'Proportion',
    configType: 'ProportionChartConfig',
    handleType: 'ProportionHandle',
    extraNotes: ['config.chart 固定为 proportion；点击载荷为 ChartEvent', '数据值不得为负数', '仅允许单系列且条目名称必须唯一'],
  },
};

/**
 * 根据 14 个真实 Vue/React 组件源码审计生成版本化 `ComponentApiV1` 元数据。
 * 仅描述组件公开接口与限制，不包含服务端执行逻辑。
 */
export function buildComponentApi(
  componentId: SupportedComponentName,
  framework: Framework,
): ComponentApiV1 {
  const meta = COMPONENT_META[componentId];
  const commonProps: ComponentApiV1['props'] = [
    { name: 'data', type: 'ChartData', required: true },
    { name: 'config', type: meta.configType, required: false },
    { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false },
  ];

  const props: ComponentApiV1['props'] =
    framework === 'react'
      ? [
          ...commonProps,
          { name: 'className', type: 'string', required: false },
          { name: 'style', type: 'CSSProperties', required: false },
          { name: 'ref', type: `Ref<${meta.handleType} | null>`, required: false },
        ]
      : commonProps;

  const events: ComponentApiV1['events'] =
    framework === 'react'
      ? [{ name: 'onPointClick', payload: 'ChartEvent' }]
      : [{ name: 'point-click', payload: 'ChartEvent' }];

  const notes: string[] = [
    '仅客户端挂载后渲染，SSR 宿主仅承诺安全导入',
    '宿主容器须具备明确非零宽高并导入对应包的 ./style.css',
    'whenRendered() 为命令式就绪句柄，仅客户端挂载后可用',
    ...meta.extraNotes,
  ];

  return {
    schemaVersion: 1,
    componentId,
    framework,
    exportName: meta.exportName,
    exportPath: `./${componentId}`,
    props,
    events,
    styleExport: './style.css',
    readyMethod: 'whenRendered',
    notes,
  };
}
