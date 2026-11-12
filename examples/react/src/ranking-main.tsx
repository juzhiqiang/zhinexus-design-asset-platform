import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RankingApp } from './RankingApp';
import '@company/charts-react/style.css';
import './styles.css';

let root: Root | null = null;

function mountApp(): void {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('Missing app container');
  }
  root = createRoot(container);
  root.render(
    <StrictMode>
      <RankingApp />
    </StrictMode>,
  );
}

mountApp();

// 测试钩子：卸载后重新挂载，验证 StrictMode 清理是否彻底（实例、画布与监听均不残留）
window.__EXAMPLE_REMOUNT__ = () => {
  root?.unmount();
  mountApp();
};
