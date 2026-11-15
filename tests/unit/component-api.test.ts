import { describe, expect, it } from 'vitest';
import { validateComponentApi } from '@company/contracts';
import { buildComponentApi } from '../../packages/component-cli/src/local/component-api.js';
import type { ComponentName } from '../../packages/component-cli/src/local/manifest.js';

const COMPONENTS: ComponentName[] = [
  'line',
  'bar',
  'pie',
  'scatter',
  'trend-card',
  'ranking',
  'proportion',
];

const EXPECTED_CONFIG_TYPE: Record<ComponentName, string> = {
  line: 'LineChartConfig',
  bar: 'BarChartConfig',
  pie: 'PieChartConfig',
  scatter: 'ScatterChartConfig',
  'trend-card': 'TrendCardConfig',
  ranking: 'RankingChartConfig',
  proportion: 'ProportionChartConfig',
};

const EXPECTED_EXPORT_NAME: Record<ComponentName, string> = {
  line: 'LineChart',
  bar: 'BarChart',
  pie: 'PieChart',
  scatter: 'ScatterChart',
  'trend-card': 'TrendCard',
  ranking: 'Ranking',
  proportion: 'Proportion',
};

describe('CLI ComponentApiV1 材料生成（真实 14 实现审计）', () => {
  it('全部 14 个组件实现均生成合法 ComponentApiV1，且无字段重叠或编造类型', () => {
    for (const component of COMPONENTS) {
      for (const framework of ['vue', 'react'] as const) {
        const api = buildComponentApi(component, framework);
        const checked = validateComponentApi(api);
        expect(checked.ok, `${component}-${framework} 契约校验失败`).toBe(true);

        expect(api.schemaVersion).toBe(1);
        expect(api.componentId).toBe(component);
        expect(api.framework).toBe(framework);
        expect(api.exportName).toBe(EXPECTED_EXPORT_NAME[component]);
        expect(api.exportPath).toBe(`./${component}`);
        expect(api.styleExport).toBe('./style.css');
        expect(api.readyMethod).toBe('whenRendered');

        const configProp = api.props.find((p) => p.name === 'config');
        expect(configProp).toEqual({
          name: 'config',
          type: EXPECTED_CONFIG_TYPE[component],
          required: false,
        });

        const overridesProp = api.props.find((p) => p.name === 'optionOverrides');
        expect(overridesProp).toEqual({
          name: 'optionOverrides',
          type: 'SupportedOptionOverrides',
          required: false,
        });

        const dataProp = api.props.find((p) => p.name === 'data');
        expect(dataProp).toEqual({ name: 'data', type: 'ChartData', required: true });

        expect(api.notes.length).toBeGreaterThan(0);
      }
    }
  });

  it('严格区分 React onPointClick 与 Vue point-click，且区分 React 额外 props', () => {
    const reactLine = buildComponentApi('line', 'react');
    expect(reactLine.events).toEqual([{ name: 'onPointClick', payload: 'ChartEvent' }]);
    expect(reactLine.props.map((p) => p.name)).toEqual([
      'data',
      'config',
      'optionOverrides',
      'className',
      'style',
      'ref',
    ]);
    expect(reactLine.props.find((p) => p.name === 'ref')?.type).toBe('Ref<LineChartHandle | null>');

    const vueLine = buildComponentApi('line', 'vue');
    expect(vueLine.events).toEqual([{ name: 'point-click', payload: 'ChartEvent' }]);
    expect(vueLine.props.map((p) => p.name)).toEqual(['data', 'config', 'optionOverrides']);
  });

  it('ranking 与 proportion 使用 RankingChartConfig / ProportionChartConfig 而非编造名', () => {
    expect(buildComponentApi('ranking', 'vue').props.find((p) => p.name === 'config')?.type).toBe(
      'RankingChartConfig',
    );
    expect(buildComponentApi('proportion', 'react').props.find((p) => p.name === 'config')?.type).toBe(
      'ProportionChartConfig',
    );
  });

  it('pie 在 notes 中显式说明 optionOverrides 白名单限制', () => {
    const pieReact = buildComponentApi('pie', 'react');
    expect(pieReact.notes.some((n) => n.includes('tooltip') && n.includes('legend'))).toBe(true);
  });
  it('notes 暴露真实数据与系列约束', () => {
    expect(buildComponentApi('pie', 'vue').notes.join(' ')).toContain('不得为负数');
    expect(buildComponentApi('scatter', 'react').notes.join(' ')).toContain('x 必须为数值');
    expect(buildComponentApi('ranking', 'vue').notes.join(' ')).toContain('单系列');
    expect(buildComponentApi('proportion', 'react').notes.join(' ')).toContain('名称必须唯一');
  });
});
