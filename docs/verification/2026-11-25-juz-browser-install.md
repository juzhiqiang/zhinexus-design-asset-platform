# juz 安装时自动下载 Chromium 验证记录

日期：2026-11-25。分支：`feat/juz-browser-install`；开工基线：`54bf15ca`。

## 范围与环境

- 独立 `juz-cli` 分发包增加 `postinstall`，通过 Node 调用自身精确版本的 Playwright CLI 安装 Chromium；不使用 shell 或 npx 解析另一份依赖。
- Windows x64，系统 Node `24.6.0`、npm `11.5.1`、pnpm `12.18.0`，Playwright `1.65.0`。
- 平台 workspace 安装及组件消费者没有新增安装钩子。未执行 npm 发布、Git 推送或合并。

## 实际执行结果

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @company/component-cli build` | 通过；内联契约同步及 probe 分发清单复核通过 |
| `pnpm --filter @company/component-cli typecheck` | 通过 |
| `pnpm verify:workspace` | 通过；11 个成员，公开包和服务端依赖边界不变 |
| `pnpm exec vitest run tests/integration/juz-browser-install.test.ts tests/unit/juz-distribution.test.ts tests/unit/component-cli-onboarding.test.ts` | 3 文件、19/19 通过，耗时 78.29 秒 |
| `git diff --check` | 通过 |
| `pnpm --filter @company/component-cli pack:juz` | 升版后通过，生成 `juz-cli-0.0.30.tgz` |
| 最终 tgz 的 npm 全局 prefix 安装、`juz --version`、`juz --help` | 通过；实际执行 postinstall 并复用缓存，shim 输出 `0.0.30` 和五个常用命令 |

测试先观察旧分发包正常 npm 安装没有执行 Chromium 准备钩子，新增测试按预期失败；实现后通过。先前共享浏览器缓存安装与启动已通过，再使用独立空缓存验证首次真实下载；最终回归包含审查反馈修正。

安装集成测试对真实 tgz 执行 `npm install --global --prefix <临时目录> --foreground-scripts`，保持脚本执行启用，浏览器缓存为独立空目录。随后从该安装包解析 Playwright，真实启动 Chromium、创建页面并读取按钮文本。

失败场景使用本地 HTTP 503 下载源和空缓存，真实执行 `npm rebuild`，确认退出码 1 和可操作的补装提示；另验证 `PLAYWRIGHT_BROWSERS_PATH=0` 包内缓存的失败提示。显式设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 后再次 rebuild，确认退出成功、没有下载请求、空缓存中没有 Chromium。

只读复核发现并修正两点：成功提示限定为“下载/缓存准备完成”；补装统一通过已安装 juz-cli 的 rebuild 执行，避免 npx 的包内缓存与实际 CLI 不一致。复核后未发现新的实质问题。

## 最终本地产物

- 根版本 `0.1.7`，CLI `0.0.30`；功能提交 `9e9f702c`。
- 分发包：`packages/component-cli/.release/juz-cli-0.0.30.tgz`，511715 字节，SHA-256 为 `992bc39699723f0575c57fad9685cf70795a63ae9e77e7400158c1665e2dffe0`。
- 最终安装使用 `npm install --global --prefix <仓库>/.release/juz-0.0.30-validation --foreground-scripts --no-audit --no-fund <tgz>`，明确启用安装脚本和默认下载。npm 输出 `juz-cli@0.0.30 postinstall` 和 Chromium 下载/缓存完成，6 秒安装 56 个包，退出 0。
- 安装验证保留在忽略目录 `.release/juz-0.0.30-validation`；未改写用户正常全局 CLI 安装。

## 验证边界

- 自动下载需要安装脚本启用及下载源可达；`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/true` 或 npm `--ignore-scripts` 可显式跳过。
- Linux 缺少系统库时 Playwright 可能只警告并返回成功；下载完成不代表系统依赖齐全。此钩子不安装 Linux 系统软件、不自动提权，未执行 Linux/macOS 验证。
- 本轮仅验证安装流程及相关回归，未重跑真实平台发布或全仓测试。之前全仓检查的后台、旧 T17 工具链和 worker 阻塞记录见 `2026-11-25-juz-simple-publishing.md`，本轮不声称这些问题已解决。
- 工作区同时出现其他任务的后台及本地身份修改，未纳入本轮提交。
- 原始架构文件无 Git 差异；SHA-256 为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
