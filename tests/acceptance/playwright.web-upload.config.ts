import { defineConfig } from '@playwright/test';

const port = Number(process.env.WEB_UPLOAD_PORT ?? 5173);

export default defineConfig({
  testDir: '.',
  testMatch: 'web-upload-*.spec.ts',
  workers: 1,
  use: { browserName: 'chromium', headless: true },
  webServer: process.env.WEB_UPLOAD_ORIGIN ? undefined : {
    command: `pnpm --filter @company/gallery exec next start --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
