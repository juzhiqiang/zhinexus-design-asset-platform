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
  /** 饼图 / 环形图的内外半径（百分比字符串），用于断言 donut 只改变内半径。 */
  seriesRadius(seriesIndex: number): [string, string] | null;
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

/** 数据项数值：折线 / 柱状为裸数值，饼图为 { name, value }。 */
function rawValue(item: unknown): number | null {
  if (typeof item === 'number') {
    return item;
  }
  if (item && typeof item === 'object' && 'value' in item) {
    const value = (item as { value?: unknown }).value;
    return typeof value === 'number' ? value : null;
  }
  return null;
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
  return series.map((item) => (item.data ?? []).map((value) => rawValue(value)));
}

function seriesRadius(selector: string, seriesIndex: number): [string, string] | null {
  const instance = chartInstance(selector);
  const series = (instance?.getOption().series as { radius?: unknown }[] | undefined) ?? [];
  const radius = series[seriesIndex]?.radius;
  if (Array.isArray(radius) && radius.length === 2) {
    return [String(radius[0]), String(radius[1])];
  }
  return null;
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
      const value = rawValue(series[seriesIndex]?.data?.[dataIndex]);
      if (value === null) {
        return null;
      }
      // 直角坐标系图表（折线 / 柱状）：按类目与数值换算像素
      const categories =
        (instance.getOption().xAxis as { data?: unknown[] }[] | undefined)?.[0]?.data ?? [];
      const category = categories[dataIndex];
      const x = instance.convertToPixel({ xAxisIndex: 0 }, category as string);
      const y = instance.convertToPixel({ yAxisIndex: 0 }, value);
      const rect = host.getBoundingClientRect();
      if (
        typeof x === 'number' &&
        typeof y === 'number' &&
        !Number.isNaN(x) &&
        !Number.isNaN(y)
      ) {
        return { x: rect.left + x, y: rect.top + y };
      }
      // 饼图 / 环形图：没有坐标轴，取扇形内外半径中点与角度中点
      const center = sectorCenter(instance, seriesIndex, dataIndex);
      return center ? { x: rect.left + center.x, y: rect.top + center.y } : null;
    },
    getClicks: options.getClicks,
    clearClicks: options.clearClicks,
    seriesData: () => seriesData(hostSelector),
    seriesRadius: (seriesIndex: number) => seriesRadius(hostSelector, seriesIndex),
    remount: () => {
      window.__EXAMPLE_REMOUNT__?.();
    },
  };
}

/**
 * 扇形几何中心（画布局部坐标）：zrender 显示列表中的 sector 元素按系列顺序、
 * 系列内按数据序排列，按各系列数据长度顺序切片定位。缺失值扇形的起止角度为
 * null（不渲染），此时返回 null。
 * zrender 的 Displayable 未把 shape 收窄为具体形状，这里按测试需要显式描述结构。
 */
type SectorShape = {
  cx: number;
  cy: number;
  r0: number;
  r: number;
  startAngle: number | null;
  endAngle: number | null;
};

type SectorLike = { type: string; shape?: Partial<SectorShape> };

function sectorCenter(
  instance: NonNullable<ReturnType<typeof chartInstance>>,
  seriesIndex: number,
  dataIndex: number,
): { x: number; y: number } | null {
  const displayList = instance.getZr().storage.getDisplayList(false) as unknown as SectorLike[];
  const sectors = displayList.filter(
    (element) => element.type === 'sector' && element.shape != null,
  );
  const series = (instance.getOption().series as { data?: unknown[] }[] | undefined) ?? [];
  let offset = 0;
  for (let index = 0; index < seriesIndex; index += 1) {
    offset += (series[index]?.data ?? []).length;
  }
  const shape = sectors[offset + dataIndex]?.shape;
  if (
    !shape ||
    typeof shape.startAngle !== 'number' ||
    typeof shape.endAngle !== 'number' ||
    typeof shape.cx !== 'number' ||
    typeof shape.cy !== 'number' ||
    typeof shape.r0 !== 'number' ||
    typeof shape.r !== 'number'
  ) {
    return null;
  }
  const midAngle = (shape.startAngle + shape.endAngle) / 2;
  const midRadius = (shape.r0 + shape.r) / 2;
  return {
    x: shape.cx + midRadius * Math.cos(midAngle),
    y: shape.cy + midRadius * Math.sin(midAngle),
  };
}
