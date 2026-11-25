import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const skip = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD?.toLowerCase();
if (skip === '1' || skip === 'true') {
  process.stdout.write('juz: 已按 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 跳过 Chromium 下载。\n');
} else {
  let ready = false;
  process.stdout.write('juz: 正在准备截图所需的 Chromium，已有匹配缓存会直接复用。\n');
  try {
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'install', 'chromium'], {
      stdio: 'inherit', windowsHide: true,
    });
    ready = !result.error && result.status === 0;
  } catch { /* Report an actionable installation failure below. */ }
  if (ready) {
    process.stdout.write('juz: Chromium 下载/缓存准备完成。\n');
  } else {
    process.stderr.write('juz: Chromium 安装失败，请检查下载网络后重新安装 juz-cli。\n' +
      '若 juz-cli 已全局安装，可运行 npm rebuild -g juz-cli --foreground-scripts 补装 Chromium。\n' +
      '暂时只安装 CLI 时，可设置 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 后重试。\n');
    process.exitCode = 1;
  }
}
