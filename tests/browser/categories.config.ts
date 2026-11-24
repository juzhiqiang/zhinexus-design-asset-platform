import { defineConfig } from '@playwright/test';

const port = Number(process.env.CATEGORIES_ADMIN_PORT ?? 5278);
export default defineConfig({
  testDir: '.', testMatch: 'categories.spec.ts', workers: 1,
  use: { browserName: 'chromium', headless: true, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm --filter @company/admin exec next start --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false,
  },
});
