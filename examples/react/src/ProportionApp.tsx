import { useEffect, useRef, useState } from 'react';
import {
  Proportion,
  getReactRuntimeInfo,
  type ChartData,
  type ChartEvent,
  type ProportionChartConfig,
  type ProportionHandle,
} from '@company/charts-react';
import proportionFixture from '../../fixtures/proportion.json';
import {
  createExampleRuntime,
  createExampleTestHook,
  installPageErrorCollector,
  resolvePresentation,
} from './example/runtime.js';

// 展示配置可由 URL 查询参数覆盖（?theme=dark&renderer=svg），缺省 light + canvas；
// light/dark × Canvas/SVG 矩阵测试与人工核对都靠它，不各自硬编码。
const presentation = resolvePresentation();

const states = Object.keys(proportionFixture.states);
const expectedSeriesIds: Record<string, readonly string[]> = {};
for (const name of states) {
  expectedSeriesIds[name] = proportionFixture.states[name as keyof typeof proportionFixture.states].expectedSeriesIds;
}

// 占比：横向条形 + 条末「值（百分比）」标签；条目顺序保持输入顺序，状态只改数据
const config: ProportionChartConfig = {
  chart: 'proportion',
  theme: presentation.theme,
  renderer: presentation.renderer,
  animation: false,
  title: '流量来源占比',
  unit: { suffix: '次' },
};

export function ProportionApp() {
  const [stateName, setStateName] = useState(states[0] ?? 'default');
  const data = proportionFixture.states[stateName as keyof typeof proportionFixture.states].data as ChartData;
  const [clicks, setClicks] = useState<ChartEvent[]>([]);
  const chartRef = useRef<ProportionHandle | null>(null);
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
      hostSelector: '.charts-proportion',
    });
    runtimeRef.current = runtime;
    window.__COMPONENT_EXAMPLE__ = runtime.example;
    window.__COMPONENT_EXAMPLE_TEST__ = createExampleTestHook({
      getClicks: () => clicksRef.current,
      clearClicks: () => setClicks([]),
      hostSelector: '.charts-proportion',
    });
  }, []);

  return (
    <main>
      <h1>React 占比示例</h1>
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
      <div className="proportion-frame">
        <Proportion ref={chartRef} data={data} config={config} onPointClick={onPointClick} />
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
