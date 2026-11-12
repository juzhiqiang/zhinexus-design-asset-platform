import { onActivated, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import type { Ref } from 'vue';
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
  host: Ref<HTMLElement | null>;
  data: Ref<ChartData>;
  config: Ref<LineChartConfig | undefined>;
  optionOverrides: Ref<SupportedOptionOverrides | undefined>;
  /** 需传入稳定引用（如围绕 emit 的包装），更新时不会重新订阅。 */
  onPointClick: (event: ChartEvent) => void;
};

export type UseChartResult = {
  controller: Readonly<Ref<ChartController | null>>;
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
 * 折线图 Vue 生命周期适配：控制器随挂载创建、随卸载销毁。
 * 兼容 KeepAlive：停用时实例与数据保留，激活后 resize 恢复尺寸。
 */
export function useChart(options: UseChartOptions): UseChartResult {
  const controller = ref<ChartController | null>(null);
  let unsubscribeClick: Unsubscribe | null = null;
  let appliedConfig: LineChartConfig | undefined;

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
    appliedConfig = options.config.value;
    attach(createChartController(host, options.config.value ?? {}));
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
    appliedConfig = next;
    if (!current || !previous) {
      return;
    }
    const theme = next?.theme ?? 'light';
    const renderer = next?.renderer ?? 'canvas';
    if ((previous.theme ?? 'light') !== theme || (previous.renderer ?? 'canvas') !== renderer) {
      current.setPresentation(theme, renderer);
      return;
    }
    if (sameLineConfig(previous, next)) {
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
