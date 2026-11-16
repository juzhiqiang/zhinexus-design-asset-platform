import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { ChartController, ChartData, ChartType, SupportedOptionOverrides } from '../../packages/charts-core/src/index.js';

const vueRequire = createRequire(new URL('../../packages/charts-vue/package.json', import.meta.url));

type VueRef<T> = { value: T };
type VueRuntimeStub = {
  ref: <T>(val: T) => VueRef<T>;
  defineComponent: (opts: { setup: () => () => unknown }) => unknown;
  h: (tag: string) => unknown;
  nextTick: () => Promise<void>;
  createRenderer: <H, E>(opts: {
    patchProp: () => void;
    insert: (child: H, parent: E) => void;
    remove: (child: H) => void;
    createElement: (tag: string) => H;
    createText: (text: string) => H;
    createComment: (text: string) => H;
    setText: () => void;
    setElementText: () => void;
    parentNode: () => E | null;
    nextSibling: () => H | null;
  }) => {
    createApp: (comp: unknown) => { mount: (root: E) => void; unmount: () => void };
  };
};

const vueRuntime = vueRequire('vue') as VueRuntimeStub;

function createDomNodeStub(tag = 'div', clientWidth = 400, clientHeight = 300): Record<string, unknown> {
  const children: unknown[] = [];
  const attrs = new Map<string, string>();
  const style: Record<string, string> = {};
  const node: Record<string, unknown> = {
    tagName: tag.toUpperCase(),
    nodeName: tag.toUpperCase(),
    nodeType: 1,
    clientWidth,
    clientHeight,
    style,
    children,
    childNodes: children,
    firstChild: null,
    parentNode: null,
    setAttribute: (k: string, v: string) => { attrs.set(k, String(v)); },
    setAttributeNS: (_ns: string | null, k: string, v: string) => { attrs.set(k, String(v)); },
    getAttribute: (k: string) => attrs.get(k) ?? null,
    removeAttribute: (k: string) => { attrs.delete(k); },
    removeAttributeNS: (_ns: string | null, k: string) => { attrs.delete(k); },
    appendChild: (c: Record<string, unknown>) => {
      c.parentNode = node;
      children.push(c);
      if (!node.firstChild) node.firstChild = c;
      return c;
    },
    insertBefore: (c: Record<string, unknown>, refNode: Record<string, unknown> | null) => {
      c.parentNode = node;
      const idx = refNode ? children.indexOf(refNode) : -1;
      if (idx >= 0) children.splice(idx, 0, c);
      else children.push(c);
      node.firstChild = children[0] ?? null;
      return c;
    },
    removeChild: (c: Record<string, unknown>) => {
      const idx = children.indexOf(c);
      if (idx >= 0) children.splice(idx, 1);
      c.parentNode = null;
      node.firstChild = children[0] ?? null;
      return c;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => ({
      font: '',
      measureText: (text: string) => ({ width: text.length * 8 }),
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: clientWidth, height: clientHeight, right: clientWidth, bottom: clientHeight }),
    innerHTML: '',
  };
  return node;
}

/** 纯 Node 无 DOM 环境的最小 Vue 渲染器，用于真实触发 setup / onMounted / watch / onBeforeUnmount。 */
function createNoopRenderer() {
  type NodeStub = { tag?: string; text?: string; children: NodeStub[] };
  const noop = () => {};
  return vueRuntime.createRenderer<NodeStub, NodeStub>({
    patchProp: noop,
    insert: (child, parent) => { parent.children.push(child); },
    remove: (child) => { child.children = []; },
    createElement: (tag) => ({ tag, children: [] }),
    createText: (text) => ({ text, children: [] }),
    createComment: (text) => ({ text, children: [] }),
    setText: noop,
    setElementText: noop,
    parentNode: () => null,
    nextSibling: () => null,
  });
}

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
    devicePixelRatio: 1,
  });
  vi.stubGlobal('document', {
    defaultView: { getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', width: '400px', height: '300px' }) },
    createElement: (tag: string) => createDomNodeStub(tag),
    createElementNS: (_ns: string, tag: string) => createDomNodeStub(tag),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text, parentNode: null }),
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('T02 / T09 双框架生命周期与对等审计', () => {
  it('Vue useChart 在仅更新 optionOverrides 时触发 ECharts option 更新（与 React 对等）', async () => {
    const { useChart } = await import('../../packages/charts-vue/src/useChart.js');

    const data = vueRuntime.ref<ChartData>({ series: [{ id: 's1', name: 'A', points: [{ x: '1', y: 10 }] }] });
    const config = vueRuntime.ref({ renderer: 'svg' as const, animation: false });
    const optionOverrides = vueRuntime.ref<SupportedOptionOverrides | undefined>(undefined);
    let capturedController: { readonly value: ChartController | null } | null = null;

    const Comp = vueRuntime.defineComponent({
      setup() {
        const host = vueRuntime.ref(createDomNodeStub('div') as unknown as HTMLElement);
        const res = useChart({
          host,
          data,
          config,
          optionOverrides,
          onPointClick: () => {},
          chart: 'line',
        } as unknown as Parameters<typeof useChart>[0]);
        capturedController = res.controller;
        return () => vueRuntime.h('div');
      },
    });

    const renderer = createNoopRenderer();
    const root = { tag: 'root', children: [] };
    const app = renderer.createApp(Comp);
    app.mount(root);

    const instanceBefore = capturedController!.value!.getInstance()!;
    expect(instanceBefore).not.toBeNull();

    // 仅更新 optionOverrides，不改变 data 引用
    optionOverrides.value = { grid: { left: 64 } };
    await vueRuntime.nextTick();

    const opt = instanceBefore.getOption() as { grid?: Array<{ left?: number }> };
    expect(opt.grid?.[0]?.left).toBe(64);

    app.unmount();
    expect(capturedController!.value).toBeNull();
  });

  it('Vue useChart 同时变更 theme 与业务配置字段时重建控制器，不丢弃业务配置', async () => {
    const { useChart } = await import('../../packages/charts-vue/src/useChart.js');

    const data = vueRuntime.ref<ChartData>({
      series: [{ id: 's1', name: 'A', points: [{ x: '1', y: 10 }] }],
    });
    const config = vueRuntime.ref<{
      theme?: 'light' | 'dark';
      renderer?: 'canvas' | 'svg';
      smooth?: boolean;
      animation?: boolean;
    }>({
      theme: 'light',
      renderer: 'svg',
      smooth: false,
      animation: false,
    });
    const optionOverrides = vueRuntime.ref<SupportedOptionOverrides | undefined>(undefined);
    let capturedController: { readonly value: ChartController | null } | null = null;

    const Comp = vueRuntime.defineComponent({
      setup() {
        const host = vueRuntime.ref(createDomNodeStub('div') as unknown as HTMLElement);
        const res = useChart({
          host,
          data,
          config,
          optionOverrides,
          onPointClick: () => {},
          chart: 'line',
        } as unknown as Parameters<typeof useChart>[0]);
        capturedController = res.controller;
        return () => vueRuntime.h('div');
      },
    });

    const renderer = createNoopRenderer();
    const root = { tag: 'root', children: [] };
    const app = renderer.createApp(Comp);
    app.mount(root);

    const firstCtrl = capturedController!.value!;
    const firstInstance = firstCtrl.getInstance()!;

    // 仅变更 theme，保持 smooth 不变 -> 复用控制器，只走 setPresentation
    config.value = { theme: 'dark', renderer: 'svg', smooth: false, animation: false };
    await vueRuntime.nextTick();
    expect(capturedController!.value).toBe(firstCtrl);
    expect(firstCtrl.getInstance()).not.toBe(firstInstance);

    // 同时变更 theme 与 smooth -> 必须重建控制器，应用 smooth: true
    config.value = { theme: 'light', renderer: 'svg', smooth: true, animation: false };
    await vueRuntime.nextTick();
    expect(capturedController!.value).not.toBe(firstCtrl);
    const rebuiltOpt = capturedController!.value!.getInstance()!.getOption() as {
      series?: Array<{ smooth?: boolean }>;
    };
    expect(rebuiltOpt.series?.[0]?.smooth).toBe(true);

    app.unmount();
  });

  it('Vue 与 React sameChartConfig 对 7 种图表类型配置等价判定完全对等', async () => {
    const vueMod = await import('../../packages/charts-vue/src/useChart.js');
    const reactMod = await import('../../packages/charts-react/src/useChart.js');
    const charts: ChartType[] = ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'];

    for (const chart of charts) {
      expect(vueMod.sameChartConfig(chart, { unit: { suffix: '%', decimals: 2 } }, { unit: { suffix: '%', decimals: 2 } })).toBe(true);
      expect(reactMod.sameChartConfig(chart, { unit: { suffix: '%', decimals: 2 } }, { unit: { suffix: '%', decimals: 2 } })).toBe(true);
      expect(vueMod.sameChartConfig(chart, { unit: { suffix: '%', decimals: 1 } }, { unit: { suffix: '%', decimals: 2 } })).toBe(false);
      expect(reactMod.sameChartConfig(chart, { unit: { suffix: '%', decimals: 1 } }, { unit: { suffix: '%', decimals: 2 } })).toBe(false);
    }
  });

  it('T09 七组件双框架构建产物导出完全对等且 SSR 顶层安全导入', async () => {
    vi.unstubAllGlobals();
    const vuePkg = (await import('../../packages/charts-vue/dist/index.js')) as Record<string, unknown>;
    const reactPkg = (await import('../../packages/charts-react/dist/index.js')) as Record<string, unknown>;
    const expectedComponents = [
      'LineChart',
      'BarChart',
      'PieChart',
      'ScatterChart',
      'TrendCard',
      'Ranking',
      'Proportion',
    ] as const;
    for (const name of expectedComponents) {
      expect(vuePkg[name], `charts-vue 缺少 ${name}`).toBeDefined();
      expect(reactPkg[name], `charts-react 缺少 ${name}`).toBeDefined();
    }
  });

  it('T02 零宽高容器不立即创建 ECharts 实例，获得有效尺寸后初始化且 dispose 幂等', async () => {
    const { createChartController } = await import('../../packages/charts-core/src/index.js');
    let resizeCallback: (() => void) | null = null;
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resizeCallback = cb;
        }
        observe() {}
        disconnect() {
          disconnectSpy();
        }
      },
    );

    const hostNode = createDomNodeStub('div', 0, 0);
    const ctrl = createChartController(hostNode as unknown as HTMLElement, {
      renderer: 'svg',
      animation: false,
    });
    expect(ctrl.getInstance()).toBeNull();

    // 尺寸恢复为非零并触发 ResizeObserver
    hostNode.clientWidth = 320;
    hostNode.clientHeight = 200;
    resizeCallback!();
    expect(ctrl.getInstance()).not.toBeNull();

    // 幂等 dispose 断开 ResizeObserver 并释放实例
    ctrl.dispose();
    ctrl.dispose();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(ctrl.getInstance()).toBeNull();
  });
});
