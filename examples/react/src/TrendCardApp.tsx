import { useEffect, useRef, useState } from 'react';
import {
  TrendCard,
  getReactRuntimeInfo,
  type ChartData,
  type ChartEvent,
  type TrendCardConfig,
  type TrendCardHandle,
} from '@company/charts-react';
import trendCardFixture from '../../fixtures/trend-card.json';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
} from './example/runtime.js';

const states = Object.keys(trendCardFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = trendCardFixture.states[name as keyof typeof trendCardFixture.states].expectedSeriesIds;
}

// 趋势卡片：类目轴 sparkline + 数值摘要；前期值固定，状态只改数据
const config: TrendCardConfig = {
  chart: 'trend-card',
  theme: 'light',
  renderer: 'canvas',
  animation: false,
  title: '近 7 日活跃用户',
  previousValue: trendCardFixture.previousValue,
};

export function TrendCardApp() {
  const [stateName, setStateName] = useState(states[0] ?? 'default');
  const data = trendCardFixture.states[stateName as keyof typeof trendCardFixture.states].data as ChartData;
  const [clicks, setClicks] = useState<ChartEvent[]>([]);
  const chartRef = useRef<TrendCardHandle | null>(null);
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
      hostSelector: '.charts-trend-card',
    });
    runtimeRef.current = runtime;
    window.__COMPONENT_EXAMPLE__ = runtime.example;
    window.__COMPONENT_EXAMPLE_TEST__ = createExampleTestHook({
      getClicks: () => clicksRef.current,
      clearClicks: () => setClicks([]),
      hostSelector: '.charts-trend-card',
    });
  }, []);

  return (
    <main>
      <h1>React 趋势卡片示例</h1>
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
      <div className="trend-card-frame">
        <TrendCard ref={chartRef} data={data} config={config} onPointClick={onPointClick} />
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
