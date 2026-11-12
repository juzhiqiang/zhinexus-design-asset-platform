import { useEffect, useRef, useState } from 'react';
import {
  PieChart,
  getReactRuntimeInfo,
  type ChartData,
  type ChartEvent,
  type PieChartConfig,
  type PieChartHandle,
} from '@company/charts-react';
import pieFixture from '../../fixtures/pie.json';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
} from './example/runtime.js';

const states = Object.keys(pieFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = pieFixture.states[name as keyof typeof pieFixture.states].expectedSeriesIds;
}

// 每个状态自带 donut：环形图族与实心饼图族（solid-*）只差内半径
function configOf(name: string): PieChartConfig {
  const donut = pieFixture.states[name as keyof typeof pieFixture.states].donut ?? true;
  return {
    chart: 'pie',
    donut,
    theme: 'light',
    renderer: 'canvas',
    animation: false,
  };
}

export function PieApp() {
  const [stateName, setStateName] = useState(states[0] ?? 'default');
  const data = pieFixture.states[stateName as keyof typeof pieFixture.states].data as ChartData;
  const config = configOf(stateName);
  const [clicks, setClicks] = useState<ChartEvent[]>([]);
  const chartRef = useRef<PieChartHandle | null>(null);
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
      renderer: 'canvas',
      hostSelector: '.charts-pie',
    });
    runtimeRef.current = runtime;
    window.__COMPONENT_EXAMPLE__ = runtime.example;
    window.__COMPONENT_EXAMPLE_TEST__ = createExampleTestHook({
      getClicks: () => clicksRef.current,
      clearClicks: () => setClicks([]),
      hostSelector: '.charts-pie',
    });
  }, []);

  return (
    <main>
      <h1>React 饼图 / 环形图示例</h1>
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
        <PieChart ref={chartRef} data={data} config={config} onPointClick={onPointClick} />
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
