import { onActivated, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { createChartController } from '@company/charts-core';
import type {
  AnyChartConfig,
  BarChartConfig,
  ChartController,
  ChartData,
  ChartEvent,
  ChartType,
  LineChartConfig,
  SupportedOptionOverrides,
  UnitSpec,
  Unsubscribe,
} from '@company/charts-core';

export type UseChartOptions = {
  host: Ref<HTMLElement | null>;
  data: Ref<ChartData>;
  config: Ref<AnyChartConfig | undefined>;
  optionOverrides: Ref<SupportedOptionOverrides | undefined>;
  /** 需传入稳定引用（如围绕 emit 的包装），更新时不会重新订阅。 */
  onPointClick: (event: ChartEvent) => void;
  /** 图表类型：决定 option 构建与缺省配置；缺省 'line'（T02/T03 行为）。 */
  chart?: ChartType;
};

export type UseChartResult = {
  controller: Readonly<Ref<ChartController | null>>;
  whenRendered: () => Promise<void>;
};

/** 全部图表共用的基础配置字段。 */
const BASE_CONFIG_FIELDS = ['theme', 'renderer', 'width', 'height', 'animation'] as const;

/** 按图表类型比较的专属字段：line 与 bar 的配置语义不同，不得互相比较。 */
const CHART_CONFIG_FIELDS: Record<ChartType, readonly string[]> = {
  line: ['smooth', 'area', 'connectNulls', 'xAxisName', 'yAxisName'],
  bar: ['stack', 'xAxisName', 'yAxisName'],
};

/** 图表缺省配置：柱状图必须带判别字段，折线图保持 T02 起的空配置兼容。 */
function defaultConfig(chart: ChartType): AnyChartConfig {
  return chart === 'bar' ? { chart: 'bar' } : {};
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

/**
 * 双框架共用的图表生命周期适配：控制器随挂载创建、随卸载销毁。
 * 图表类型由 `chart` 固定，数据与事件语义共享自 `@company/charts-core`。
 * 兼容 KeepAlive：停用时实例与数据保留，激活后 resize 恢复尺寸。
 */
export function useChart(options: UseChartOptions): UseChartResult {
  const chart: ChartType = options.chart ?? 'line';
  const controller = ref<ChartController | null>(null);
  let unsubscribeClick: Unsubscribe | null = null;
  let appliedConfig: AnyChartConfig | undefined;

  function detach(): void {
    unsubscribeClick?.();
    unsubscribeClick = null;
    controller.value?.dispose();
    controller.value = null;
  }

  function attach(created: ChartController): void {
    controller.value = created;
    unsubscribeClick?.();
    unsubscribeClick = created.onPointClick((event) => options.onPointClick(event));
  }

  function applyData(): void {
    controller.value?.update(options.data.value, options.optionOverrides.value);
  }

  function createController(): void {
    const host = options.host.value;
    if (!host) {
      return;
    }
    appliedConfig = options.config.value ?? defaultConfig(chart);
    attach(createChartController(host, appliedConfig));
    applyData();
  }

  onMounted(createController);
  onBeforeUnmount(detach);

  watch(options.data, () => {
    applyData();
  });

  watch(options.config, (next) => {
    const current = controller.value;
    const previous = appliedConfig;
    appliedConfig = next ?? defaultConfig(chart);
    if (!current || !previous) {
      return;
    }
    const theme = next?.theme ?? 'light';
    const renderer = next?.renderer ?? 'canvas';
    if ((previous.theme ?? 'light') !== theme || (previous.renderer ?? 'canvas') !== renderer) {
      current.setPresentation(theme, renderer);
      return;
    }
    if (sameChartConfig(chart, previous, next)) {
      return;
    }
    // 非展示类配置变化：销毁重建以应用新的 option 语义，数据由当前 props 保留
    detach();
    createController();
  });

  onActivated(() => {
    controller.value?.resize();
  });

  const whenRendered = () => controller.value?.whenRendered() ?? Promise.resolve();
  return { controller: readonly(controller), whenRendered };
}
