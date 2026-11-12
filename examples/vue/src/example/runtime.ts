import { getInstanceByDom } from 'echarts/core.js';
import type { ChartEvent, Renderer } from '@company/charts-vue';

/**
 * 示例就绪协议（T03 对齐件定义）：页面通过 window.__COMPONENT_EXAMPLE__ 暴露
 * ready / states / runState / getChecks，供 CLI 截图与消费者验收驱动。
 * 就绪判定结合 document.fonts.ready、图表系列实际变化与控制器渲染完成信号，
 * 不使用固定 sleep。
 */
export type CheckResult = { name: string; status: 'passed' | 'failed'; message?: string };

export type ComponentExample = {
  readonly ready: Promise<void>;
  readonly states: readonly string[];
  runState(name: string): Promise<void>;
  getChecks(): CheckResult[];
};

export type ExampleTestHook = {
  pointClientPosition(seriesIndex: number, dataIndex: number): { x: number; y: number } | null;
  getClicks(): ChartEvent[];
  clearClicks(): void;
  remount(): void;
  /** 当前实例的系列数值快照：用于断言缺失值保持 null、负值不被裁剪。 */
  seriesData(): (number | null)[][];
};

export type ExampleRuntimeOptions = {
  states: readonly string[];
  expectedSeriesIds: Record<string, readonly string[]>;
  applyStateData: (name: string) => void;
  whenRendered: () => Promise<void>;
  renderer: Renderer;
  /** 图表容器选择器；同一页面存在多个图表时区分宿主，缺省 `.charts-line`。 */
  hostSelector?: string;
};

export type ExampleTestHookOptions = {
  getClicks: () => ChartEvent[];
  clearClicks: () => void;
  hostSelector?: string;
};

declare global {
  interface Window {
    __COMPONENT_EXAMPLE__?: ComponentExample;
    __COMPONENT_EXAMPLE_TEST__?: ExampleTestHook;
    __EXAMPLE_REMOUNT__?: () => void;
  }
}

const READY_TIMEOUT_MS = 10_000;
const INITIAL_SNAPSHOT = '__initial__';
const DEFAULT_HOST_SELECTOR = '.charts-line';

let collectorInstalled = false;
const pageErrors: string[] = [];

/** 页面级错误收集器：安装一次，计入 no-page-error 自检。 */
export function installPageErrorCollector(): void {
  if (collectorInstalled) {
    return;
  }
  collectorInstalled = true;
  window.addEventListener('error', (event) => {
    pageErrors.push(event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    pageErrors.push(String(event.reason));
  });
}

function chartHost(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

function chartInstance(selector: string) {
  const host = chartHost(selector);
  return host ? getInstanceByDom(host) : null;
}

function seriesSnapshot(selector: string): string {
  const instance = chartInstance(selector);
  if (!instance) {
    return 'no-instance';
  }
  const series = (instance.getOption().series as { id?: string; data?: unknown[] }[] | undefined) ?? [];
  return JSON.stringify(series.map((item) => [item.id ?? '', item.data ?? []]));
}

function seriesIds(selector: string): string[] {
  const instance = chartInstance(selector);
  if (!instance) {
    return [];
  }
  const series = (instance.getOption().series as { id?: string }[] | undefined) ?? [];
  return series.map((item) => item.id ?? '');
}

function seriesData(selector: string): (number | null)[][] {
  const instance = chartInstance(selector);
  if (!instance) {
    return [];
  }
  const series = (instance.getOption().series as { data?: unknown[] }[] | undefined) ?? [];
  return series.map((item) =>
    (item.data ?? []).map((value) => (typeof value === 'number' ? value : null)),
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createExampleRuntime(options: ExampleRuntimeOptions): { example: ComponentExample } {
  const hostSelector = options.hostSelector ?? DEFAULT_HOST_SELECTOR;
  let currentState = options.states[0] ?? 'default';
  let readiness: Promise<void> = Promise.resolve();

  async function arm(previousSnapshot: string): Promise<void> {
    await document.fonts.ready;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let snapshot = seriesSnapshot(hostSelector);
    while (snapshot === previousSnapshot && Date.now() < deadline) {
      await wait(16);
      snapshot = seriesSnapshot(hostSelector);
    }
    if (snapshot === previousSnapshot) {
      throw new Error(`示例状态 ${currentState} 未在超时内应用到图表`);
    }
    await options.whenRendered();
  }

  readiness = arm(INITIAL_SNAPSHOT);

  function collectChecks(): CheckResult[] {
    const host = chartHost(hostSelector);
    const instance = chartInstance(hostSelector);
    const canvases = host ? host.querySelectorAll('canvas').length : 0;
    const svgs = host ? host.querySelectorAll('svg').length : 0;
    const expected = options.expectedSeriesIds[currentState] ?? [];
    const actual = seriesIds(hostSelector);
    const rendererMatched =
      options.renderer === 'canvas' ? canvases === 1 && svgs === 0 : svgs === 1 && canvases === 0;
    return [
      {
        name: 'single-instance',
        status: instance != null && canvases + svgs === 1 ? 'passed' : 'failed',
        message: `实例=${instance == null ? 0 : 1} canvas=${canvases} svg=${svgs}`,
      },
      {
        name: 'no-page-error',
        status: pageErrors.length === 0 ? 'passed' : 'failed',
        message: pageErrors.join('; '),
      },
      {
        name: 'series-match',
        status: JSON.stringify(actual) === JSON.stringify(expected) ? 'passed' : 'failed',
        message: `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
      },
      {
        name: 'renderer-match',
        status: rendererMatched ? 'passed' : 'failed',
        message: `声明 ${options.renderer}，canvas=${canvases} svg=${svgs}`,
      },
    ];
  }

  const example: ComponentExample = {
    get ready(): Promise<void> {
      return readiness;
    },
    get states(): readonly string[] {
      return options.states;
    },
    async runState(name: string): Promise<void> {
      if (!options.states.includes(name)) {
        throw new Error(`未知示例状态: ${name}`);
      }
      const previousSnapshot = seriesSnapshot(hostSelector);
      currentState = name;
      options.applyStateData(name);
      readiness = arm(previousSnapshot);
      await readiness;
    },
    getChecks: collectChecks,
  };

  return { example };
}

/** 测试钩子：数据点像素坐标、点击载荷记录、系列数值快照与重新挂载。 */
export function createExampleTestHook(options: ExampleTestHookOptions): ExampleTestHook {
  const hostSelector = options.hostSelector ?? DEFAULT_HOST_SELECTOR;
  return {
    pointClientPosition(seriesIndex: number, dataIndex: number): { x: number; y: number } | null {
      const host = chartHost(hostSelector);
      const instance = chartInstance(hostSelector);
      if (!host || !instance) {
        return null;
      }
      const series = (instance.getOption().series as { data?: unknown[] }[] | undefined) ?? [];
      const point = series[seriesIndex]?.data?.[dataIndex];
      if (point === null || point === undefined) {
        return null;
      }
      const categories =
        (instance.getOption().xAxis as { data?: unknown[] }[] | undefined)?.[0]?.data ?? [];
      const category = categories[dataIndex];
      const x = instance.convertToPixel({ xAxisIndex: 0 }, category as string);
      const y = instance.convertToPixel({ yAxisIndex: 0 }, point as number);
      if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
        return null;
      }
      const rect = host.getBoundingClientRect();
      return { x: rect.left + x, y: rect.top + y };
    },
    getClicks: options.getClicks,
    clearClicks: options.clearClicks,
    seriesData: () => seriesData(hostSelector),
    remount: () => {
      window.__EXAMPLE_REMOUNT__?.();
    },
  };
}
