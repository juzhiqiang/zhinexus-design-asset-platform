import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createChartController } from '@company/charts-core';
import type {
  AnyChartConfig,
  BarChartConfig,
  ChartController,
  ChartData,
  ChartEvent,
  ChartType,
  LineChartConfig,
  PieChartConfig,
  SupportedOptionOverrides,
  UnitSpec,
  Unsubscribe,
} from '@company/charts-core';

export type UseChartOptions = {
  host: RefObject<HTMLDivElement | null>;
  data: ChartData;
  config?: AnyChartConfig;
  optionOverrides?: SupportedOptionOverrides;
  onPointClick?: (event: ChartEvent) => void;
  /** 图表类型：决定 option 构建与缺省配置；缺省 'line'（T02/T03 行为）。 */
  chart?: ChartType;
};

export type UseChartResult = {
  whenRendered: () => Promise<void>;
};

/** 全部图表共用的基础配置字段。 */
const BASE_CONFIG_FIELDS = ['theme', 'renderer', 'width', 'height', 'animation'] as const;

/** 按图表类型比较的专属字段：各图表的配置语义不同，不得互相比较。 */
const CHART_CONFIG_FIELDS: Record<ChartType, readonly string[]> = {
  line: ['smooth', 'area', 'connectNulls', 'xAxisName', 'yAxisName'],
  bar: ['stack', 'xAxisName', 'yAxisName'],
  pie: ['donut'],
};

/** 图表缺省配置：柱状与饼图必须带判别字段，折线图保持 T02 起的空配置兼容。 */
function defaultConfig(chart: ChartType): AnyChartConfig {
  if (chart === 'bar') {
    return { chart: 'bar' };
  }
  if (chart === 'pie') {
    return { chart: 'pie' };
  }
  return {};
}

/** 配置等价判断：避免父组件传入新对象字面量时无意义重建实例。 */
export function sameChartConfig(
  chart: ChartType,
  a: AnyChartConfig | undefined,
  b: AnyChartConfig | undefined,
): boolean {
  const left = (a ?? {}) as Record<string, unknown>;
  const right = (b ?? {}) as Record<string, unknown>;
  const leftUnit = left.unit as UnitSpec | undefined;
  const rightUnit = right.unit as UnitSpec | undefined;
  if ((leftUnit?.suffix ?? '') !== (rightUnit?.suffix ?? '')) {
    return false;
  }
  if ((leftUnit?.decimals ?? 0) !== (rightUnit?.decimals ?? 0)) {
    return false;
  }
  return [...BASE_CONFIG_FIELDS, ...CHART_CONFIG_FIELDS[chart]].every(
    (field) => left[field] === right[field],
  );
}

/** 折线图配置等价判断（保留 T03 导出名）。 */
export function sameLineConfig(
  a: LineChartConfig | undefined,
  b: LineChartConfig | undefined,
): boolean {
  return sameChartConfig('line', a, b);
}

/** 柱状图配置等价判断（T09）。 */
export function sameBarConfig(a: BarChartConfig | undefined, b: BarChartConfig | undefined): boolean {
  return sameChartConfig('bar', a, b);
}

/** 饼图 / 环形图配置等价判断（T09 第二批）。 */
export function samePieConfig(a: PieChartConfig | undefined, b: PieChartConfig | undefined): boolean {
  return sameChartConfig('pie', a, b);
}

/**
 * 双框架共用的图表生命周期适配：控制器随挂载创建、随卸载销毁。
 * 图表类型由 `chart` 固定，数据与事件语义共享自 `@company/charts-core`。
 * 兼容 StrictMode 开发态 Effect 重复挂载/清理：每次挂载只产生一个实例，卸载后零监听。
 */
export function useChart(options: UseChartOptions): UseChartResult {
  const { host } = options;
  const chart: ChartType = options.chart ?? 'line';
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const controllerRef = useRef<ChartController | null>(null);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const appliedConfigRef = useRef<AnyChartConfig | undefined>(undefined);

  const detach = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    controllerRef.current?.dispose();
    controllerRef.current = null;
  }, []);

  const attach = useCallback((controller: ChartController) => {
    controllerRef.current = controller;
    unsubscribeRef.current?.();
    unsubscribeRef.current = controller.onPointClick((event) => {
      optionsRef.current.onPointClick?.(event);
    });
  }, []);

  const createController = useCallback(() => {
    const hostElement = host.current;
    if (!hostElement) {
      return;
    }
    appliedConfigRef.current = optionsRef.current.config ?? defaultConfig(chart);
    const created = createChartController(hostElement, appliedConfigRef.current);
    attach(created);
    created.update(optionsRef.current.data, optionsRef.current.optionOverrides);
  }, [attach, host, chart]);

  // 挂载/卸载：StrictMode 下清理后重新挂载仍只保留一个实例
  useEffect(() => {
    createController();
    return detach;
  }, [createController, detach]);

  // 数据与 option 覆盖更新
  useEffect(() => {
    controllerRef.current?.update(options.data, options.optionOverrides);
  }, [options.data, options.optionOverrides]);

  // 配置变化：主题/渲染器走 setPresentation 重建，其余字段变化时重建控制器
  useEffect(() => {
    const controller = controllerRef.current;
    const previous = appliedConfigRef.current;
    const next = options.config;
    appliedConfigRef.current = next ?? defaultConfig(chart);
    if (!controller || !previous) {
      return;
    }
    const theme = next?.theme ?? 'light';
    const renderer = next?.renderer ?? 'canvas';
    if ((previous.theme ?? 'light') !== theme || (previous.renderer ?? 'canvas') !== renderer) {
      controller.setPresentation(theme, renderer);
      return;
    }
    if (sameChartConfig(chart, previous, next)) {
      return;
    }
    detach();
    createController();
  }, [options.config, createController, detach, chart]);

  const whenRendered = useCallback(
    () => controllerRef.current?.whenRendered() ?? Promise.resolve(),
    [],
  );

  return { whenRendered };
}
