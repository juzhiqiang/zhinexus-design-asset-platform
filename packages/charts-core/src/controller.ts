import { buildLineOption } from './charts/line.js';
import { normalizeChartData } from './data.js';
import { disposeChartInstance, initChartInstance } from './engine/adapter.js';
import { ensureLineModules } from './engine/modules.js';
import type {
  ChartController,
  ChartData,
  ChartEvent,
  LineChartConfig,
  PointClickListener,
  Renderer,
  SupportedOptionOverrides,
  ThemeName,
  Unsubscribe,
} from './types.js';
import type { EChartsType, SetOptionOpts } from 'echarts/core.js';

/**
 * 创建图表控制器（T02 折线图入口）。
 *
 * 生命周期约定（架构 §6 / rules/platform.md）：
 * - 挂载时检测容器尺寸：零宽高或隐藏容器等待 ResizeObserver 获得有效尺寸后再初始化；
 * - 数据更新以 replaceMerge 按稳定 series id 合并，删除系列不残留；
 * - 主题 / 渲染器变化销毁重建，数据保留；
 * - dispose 幂等，解除监听、断开观察器并销毁实例；
 * - SSR 宿主仅可安全导入，实例只在客户端挂载后创建。
 */
export function createChartController(host: HTMLElement, config: LineChartConfig = {}): ChartController {
  let currentConfig: LineChartConfig = { ...config };
  let currentData: ChartData = { series: [] };
  let currentOverrides: SupportedOptionOverrides | undefined;
  let instance: EChartsType | null = null;
  let disposed = false;
  let lastWidth = 0;
  let lastHeight = 0;
  let pendingRender: Promise<void> = Promise.resolve();
  const renderWaiters: (() => void)[] = [];
  const pointClickListeners = new Set<PointClickListener>();

  function measure(): { width: number; height: number } {
    return { width: host.clientWidth, height: host.clientHeight };
  }

  function hasValidSize(): boolean {
    const { width, height } = measure();
    return width > 0 && height > 0;
  }

  function initializeIfSized(): void {
    if (disposed || instance) {
      return;
    }
    const { width, height } = measure();
    if (!(width > 0) || !(height > 0)) {
      // 零宽高 / 隐藏容器：等待 ResizeObserver，不创建实例
      return;
    }
    const renderer: Renderer = currentConfig.renderer ?? 'canvas';
    ensureLineModules(renderer);
    lastWidth = width;
    lastHeight = height;
    instance = initChartInstance(host, renderer, {
      width: currentConfig.width,
      height: currentConfig.height,
    });
    bindChartEvents(instance);
    applyOption({ replaceMerge: ['series'] });
  }

  function applyOption(setOptionOpts?: SetOptionOpts): void {
    if (!instance) {
      return;
    }
    // 先登记渲染等待者再 setOption：ECharts 可能在 setOption 内同步触发 finished
    // （例如关闭动画时），监听必须先于渲染建立。
    pendingRender = new Promise<void>((resolve) => {
      renderWaiters.push(resolve);
    });
    instance.setOption(buildLineOption(currentData, currentConfig, currentOverrides), setOptionOpts);
  }

  function bindChartEvents(chart: EChartsType): void {
    // 常驻监听：任意一次渲染完成都唤醒等待中的 whenRendered 调用方。
    // ECharts 的 finished 可能在 setOption 内同步触发，因此等待者必须先于渲染登记。
    chart.on('finished', () => {
      const waiters = renderWaiters.splice(0, renderWaiters.length);
      for (const resolve of waiters) {
        resolve();
      }
    });
    chart.on('click', (params) => {
      if (params.componentType !== 'series') {
        return;
      }
      const rawEvent = params.event?.event as { type?: string } | undefined;
      const event: ChartEvent = {
        seriesId: typeof params.seriesId === 'string' ? params.seriesId : '',
        dataIndex: typeof params.dataIndex === 'number' ? params.dataIndex : -1,
        value: [
          typeof params.name === 'string' || typeof params.name === 'number' ? params.name : '',
          typeof params.value === 'number' ? params.value : null,
        ],
        nativeType: rawEvent?.type ?? params.type,
      };
      for (const listener of [...pointClickListeners]) {
        listener(event);
      }
    });
  }

  function disposeInstance(): void {
    if (!instance) {
      return;
    }
    disposeChartInstance(instance);
    instance = null;
    lastWidth = 0;
    lastHeight = 0;
  }

  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (disposed) {
            return;
          }
          if (!instance) {
            initializeIfSized();
            return;
          }
          resize();
        });
  observer?.observe(host);
  // 挂载即有有效尺寸时同步初始化；零尺寸路径由上面的 ResizeObserver 负责
  initializeIfSized();

  function update(data: ChartData, optionOverrides?: SupportedOptionOverrides): void {
    if (disposed) {
      return;
    }
    // 先规范化：隐藏容器中的数据错误也要立刻失败，不留到首次渲染
    currentData = normalizeChartData(data);
    if (optionOverrides !== undefined) {
      // 覆盖为粘性合并：后续 update 省略时沿用上次提供的覆盖
      currentOverrides = { ...currentOverrides, ...optionOverrides };
    }
    if (!instance) {
      initializeIfSized();
      return;
    }
    applyOption({ replaceMerge: ['series'] });
  }

  function resize(): void {
    if (disposed) {
      return;
    }
    if (!instance) {
      initializeIfSized();
      return;
    }
    const { width, height } = measure();
    if (width === lastWidth && height === lastHeight) {
      return;
    }
    lastWidth = width;
    lastHeight = height;
    instance.resize();
  }

  function setPresentation(theme: ThemeName, renderer: Renderer): void {
    if (disposed) {
      return;
    }
    const changed = currentConfig.theme !== theme || currentConfig.renderer !== renderer;
    currentConfig = { ...currentConfig, theme, renderer };
    if (!changed) {
      return;
    }
    // 主题 / 渲染器必须重建实例；数据由 currentData 保留
    disposeInstance();
    initializeIfSized();
  }

  function onPointClick(listener: PointClickListener): Unsubscribe {
    pointClickListeners.add(listener);
    return () => {
      pointClickListeners.delete(listener);
    };
  }

  function whenRendered(): Promise<void> {
    return pendingRender;
  }

  function getInstance(): EChartsType | null {
    return instance;
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    observer?.disconnect();
    pointClickListeners.clear();
    disposeInstance();
    // 避免等待方在销毁后永久挂起
    const waiters = renderWaiters.splice(0, renderWaiters.length);
    for (const resolve of waiters) {
      resolve();
    }
    pendingRender = Promise.resolve();
  }

  return { update, resize, setPresentation, onPointClick, whenRendered, getInstance, dispose };
}
