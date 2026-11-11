import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getReactRuntimeInfo } from '@company/charts-react';

const runtime = getReactRuntimeInfo();
const container = document.getElementById('app');
if (!container) throw new Error('Missing app container');
createRoot(container).render(
  <StrictMode>
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: 48, color: '#263044' }}>
      <h1>React 工程示例</h1>
      <p>工作区包入口已连接，图表组件待 T02/T03 实现。</p>
      <pre data-testid="runtime-info">{JSON.stringify(runtime, null, 2)}</pre>
    </main>
  </StrictMode>,
);
