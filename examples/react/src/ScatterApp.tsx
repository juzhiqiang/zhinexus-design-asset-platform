import { useEffect, useRef, useState } from 'react';
import {
  ScatterChart,
  getReactRuntimeInfo,
  type ChartData,
  type ChartEvent,
  type ScatterChartConfig,
  type ScatterChartHandle,
} from '@company/charts-react';
import scatterFixture from '../../fixtures/scatter.json';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
  resolvePresentation,
} from './example/runtime.js';

// 展示配置可由 URL 查询参数覆盖（?theme=dark&renderer=svg），缺省 light + canvas；
// light/dark × Canvas/SVG 矩阵测试与人工核对都靠它，不各自硬编码。
const presentation = resolvePresentation();

const states = Object.keys(scatterFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = scatterFixture.states[name as keyof typeof scatterFixture.states].expectedSeriesIds;
}

// 散点图：x / y 双数值轴；unit 缺省时不带单位，x 轴同样按无单位格式化
const config: ScatterChartConfig = {
  chart: 'scatter',
  theme: presentation.theme,
  renderer: presentation.renderer,
  animation: false,
};

export function ScatterApp() {
  const [stateName, setStateName] = useState(states[0] ?? 'default');
  const data = scatterFixture.states[stateName as keyof typeof scatterFixture.states].data as ChartData;
  const [clicks, setClicks] = useState<ChartEvent[]>([]);
  const chartRef = useRef<ScatterChartHandle | null>(null);
  const runtimeRef = useRef<ReturnType<typeof createExampleRuntime> | null>(null);
  const clicksRef = useRef(clicks);
  clicksRef.current = clicks;

  function onPointClick(event: ChartEvent): void {
    setClicks((previous) => [...previous, event]);
  }

  useEffect(() => {
    installPageErrorCollector();
  }, []);

  useEffect(() => {
    if (runtimeRef.current) {
      // StrictMode 开发态二次执行不重复创建运行时
      return;
    }
    const runtime = createExampleRuntime({
      states,
      expectedSeriesIds,
      applyStateData: (name) => {
        setStateName(name);
      },
      whenRendered: () => chartRef.current?.whenRendered() ?? Promise.resolve(),
      renderer: presentation.renderer,
      hostSelector: '.charts-scatter',
    });
    runtimeRef.current = runtime;
    window.__COMPONENT_EXAMPLE__ = runtime.example;
    window.__COMPONENT_EXAMPLE_TEST__ = createExampleTestHook({
      getClicks: () => clicksRef.current,
      clearClicks: () => setClicks([]),
      hostSelector: '.charts-scatter',
    });
  }, []);

  return (
    <main>
      <h1>React 散点图示例</h1>
      <p>消费工作区内的 @company/charts-react；同一数据与事件语义在 Vue 示例中对等实现。</p>
      <div className="toolbar">
        {states.map((name) => (
          <button
            key={name}
            type="button"
            className={name === stateName ? 'active' : undefined}
            data-testid={`state-${name}`}
            onClick={() => {
              void runtimeRef.current?.example.runState(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="chart-frame">
        <ScatterChart ref={chartRef} data={data} config={config} onPointClick={onPointClick} />
      </div>
      <section className="clicks">
        <h2>点击载荷</h2>
        <pre data-testid="click-log">{JSON.stringify(clicks, null, 2)}</pre>
      </section>
      <footer>
        <pre data-testid="runtime-info">{JSON.stringify(getReactRuntimeInfo(), null, 2)}</pre>
      </footer>
    </main>
  );
}
