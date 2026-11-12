import { createApp } from 'vue';
import BarApp from './BarApp.vue';
import '@company/charts-vue/style.css';

let app: ReturnType<typeof createApp> | null = null;

function mountApp(): void {
  app = createApp(BarApp);
  app.mount('#app');
}

mountApp();

// 测试钩子：卸载后重新挂载，验证清理是否彻底（实例、画布与监听均不残留）
window.__EXAMPLE_REMOUNT__ = () => {
  app?.unmount();
  mountApp();
};
