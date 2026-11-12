import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createChartController } from '@company/charts-core';
import type {
  ChartController,
  ChartData,
  ChartEvent,
  LineChartConfig,
  SupportedOptionOverrides,
  Unsubscribe,
} from '@company/charts-core';

export type UseChartOptions = {
  host: RefObject<HTMLDivElement | null>;
  data: ChartData;
  config?: LineChartConfig;
  optionOverrides?: SupportedOptionOverrides;
  onPointClick?: (event: ChartEvent) => void;
};

export type UseChartResult = {
  whenRendered: () => Promise<void>;
};

const CONFIG_FIELDS = [
  'theme',
  'renderer',
  'width',
  'height',
  'animation',
  'smooth',
  'area',
  'connectNulls',
  'xAxisName',
  'yAxisName',
] as const;

/** 配置等价判断：避免父组件传入新对象字面量时无意义重建实例。 */
export function sameLineConfig(a: LineChartConfig | undefined, b: LineChartConfig | undefined): boolean {
  const left = a ?? {};
  const right = b ?? {};
  if ((left.unit?.suffix ?? '') !== (right.unit?.suffix ?? '')) {
    return false;
  }
  if ((left.unit?.decimals ?? 0) !== (right.unit?.decimals ?? 0)) {
    return false;
  }
  return CONFIG_FIELDS.every((field) => left[field] === right[field]);
}

/**
 * 折线图 React 生命周期适配：控制器随挂载创建、随卸载销毁。
 * 兼容 StrictMode 开发态 Effect 重复挂载/清理：每次挂载只产生一个实例，卸载后零监听。
 */
export function useChart(options: UseChartOptions): UseChartResult {
  const { host } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const controllerRef = useRef<ChartController | null>(null);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const appliedConfigRef = useRef<LineChartConfig | undefined>(undefined);

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

  // 挂载/卸载：StrictMode 下清理后重新挂载仍只保留一个实例
  useEffect(() => {
    const hostElement = host.current;
    if (!hostElement) {
      return;
    }
    attach(createChartController(hostElement, optionsRef.current.config ?? {}));
    appliedConfigRef.current = optionsRef.current.config;
    controllerRef.current?.update(optionsRef.current.data, optionsRef.current.optionOverrides);
    return detach;
  }, [attach, detach, host]);

  // 数据与 option 覆盖更新
  useEffect(() => {
    controllerRef.current?.update(options.data, options.optionOverrides);
  }, [options.data, options.optionOverrides]);

  // 配置变化：主题/渲染器走 setPresentation 重建，其余字段变化时重建控制器
  useEffect(() => {
    const controller = controllerRef.current;
    const previous = appliedConfigRef.current;
    const next = options.config;
    appliedConfigRef.current = next;
    if (!controller || !previous) {
      return;
    }
    const theme = next?.theme ?? 'light';
    const renderer = next?.renderer ?? 'canvas';
    if ((previous.theme ?? 'light') !== theme || (previous.renderer ?? 'canvas') !== renderer) {
      controller.setPresentation(theme, renderer);
      return;
    }
    if (sameLineConfig(previous, next)) {
      return;
    }
    detach();
    const hostElement = host.current;
    if (!hostElement) {
      return;
    }
    const recreated = createChartController(hostElement, next ?? {});
    attach(recreated);
    recreated.update(optionsRef.current.data, optionsRef.current.optionOverrides);
  }, [options.config, attach, detach, host]);

  const whenRendered = useCallback(
    () => controllerRef.current?.whenRendered() ?? Promise.resolve(),
    [],
  );

  return { whenRendered };
}
