# juz 安装时准备 Chromium

用户希望手动测试 CLI 时只安装一个 npm 包，不再额外执行 Playwright 安装命令。

仅在独立 `juz-cli` 分发 manifest 注册 `postinstall`，调用已安装的精确版本 `@playwright/test/cli install chromium`。复用 Playwright 下载源、代理、缓存与版本选择；不通过 npx 重新解析依赖，也不安装 Linux 系统库。

正常安装默认下载，已有缓存复用；`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/true` 显式跳过。下载或子进程失败时安装退出非零，提示重新安装、对已全局安装包执行 rebuild 补装，以及跳过方法。补装使用自身依赖，兼容包内浏览器缓存。平台 workspace 包及组件消费者仍保持原有安装行为。

验证采用实际 npm 全局 prefix 安装、空缓存下载、真实 Chromium 启动、受控本地 HTTP 503 下载失败及显式跳过零请求。补充 CLI 构建、类型检查、分发包回归与工作区边界检查。详细结果另记验证记录。
