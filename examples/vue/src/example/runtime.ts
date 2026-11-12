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
};

export type ExampleRuntimeOptions = {
  states: readonly string[];
  expectedSeriesIds: Record<string, readonly string[]>;
  applyStateData: (name: string) => void;
  whenRendered: () => Promise<void>;
  renderer: Renderer;
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

function chartHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.charts-line');
}

function chartInstance() {
  const host = chartHost();
  return host ? getInstanceByDom(host) : null;
}

function seriesSnapshot(): string {
  const instance = chartInstance();
  if (!instance) {
    return 'no-instance';
  }
  const series = (instance.getOption().series as { id?: string; data?: unknown[] }[] | undefined) ?? [];
  return JSON.stringify(series.map((item) => [item.id ?? '', item.data ?? []]));
}

function seriesIds(): string[] {
  const instance = chartInstance();
  if (!instance) {
    return [];
  }
  const series = (instance.getOption().series as { id?: string }[] | undefined) ?? [];
  return series.map((item) => item.id ?? '');
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createExampleRuntime(options: ExampleRuntimeOptions): { example: ComponentExample } {
  let currentState = options.states[0] ?? 'default';
  let readiness: Promise<void> = Promise.resolve();

  async function arm(previousSnapshot: string): Promise<void> {
    await document.fonts.ready;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let snapshot = seriesSnapshot();
    while (snapshot === previousSnapshot && Date.now() < deadline) {
      await wait(16);
      snapshot = seriesSnapshot();
    }
    if (snapshot === previousSnapshot) {
      throw new Error(`示例状态 ${currentState} 未在超时内应用到图表`);
    }
    await options.whenRendered();
  }

  readiness = arm(INITIAL_SNAPSHOT);

  function collectChecks(): CheckResult[] {
    const host = chartHost();
    const instance = chartInstance();
    const canvases = host ? host.querySelectorAll('canvas').length : 0;
    const svgs = host ? host.querySelectorAll('svg').length : 0;
    const expected = options.expectedSeriesIds[currentState] ?? [];
    const actual = seriesIds();
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
      const previousSnapshot = seriesSnapshot();
      currentState = name;
      options.applyStateData(name);
      readiness = arm(previousSnapshot);
      await readiness;
    },
    getChecks: collectChecks,
  };

  return { example };
}

/** 测试钩子：数据点像素坐标、点击载荷记录与重新挂载。 */
export function createExampleTestHook(options: {
  getClicks: () => ChartEvent[];
  clearClicks: () => void;
}): ExampleTestHook {
  return {
    pointClientPosition(seriesIndex: number, dataIndex: number): { x: number; y: number } | null {
      const host = chartHost();
      const instance = chartInstance();
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
    remount: () => {
      window.__EXAMPLE_REMOUNT__?.();
    },
  };
}
