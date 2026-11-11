import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  fullyParallel: true,
  workers: 2,
  use: { browserName: 'chromium', headless: true },
  webServer: [
    { command: 'pnpm --filter @company/gallery preview', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
    { command: 'pnpm --filter @company/example-vue preview', url: 'http://127.0.0.1:5174', reuseExistingServer: false },
    { command: 'pnpm --filter @company/example-react preview', url: 'http://127.0.0.1:5175', reuseExistingServer: false },
    // React StrictMode 的 Effect 双调用只发生在开发态，预览产物无法覆盖，单独起 dev 服务验证
    { command: 'pnpm --filter @company/example-react dev:strict', url: 'http://127.0.0.1:5176', reuseExistingServer: false },
  ],
});
