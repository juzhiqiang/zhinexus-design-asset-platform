# juz-cli 安装时自动下载 Chromium 验证汇编（cli-chromium-autodownload）

> 本文件由 2 篇逐次验证记录按时间序合并而成（2026-11-26，`chore/docs-slim-round3` 分支）。合并范围：`2026-11-25-juz-browser-install.md`、`2026-11-26-juz-main-merge.md`。每篇原记录以 `### <原文件名>` 为标题**完整保留原文**（标题降两级），git 历史可追溯，信息不灭失。
>
> 两篇的关系：第一篇在 `feat/juz-browser-install` 上验证 `postinstall` 自动下载 Chromium；第二篇记录该分支合并进本地 `main` 后的复验与版本收口。两篇的全仓 `pnpm test` 均**退出 1**，失败项是既有的后台 `react` 解析、旧 T17 固定工具链与 worker 异常——历史记录分别见[真实项目发布汇编内的 `2026-11-25-juz-simple-publishing.md` 小节](project-publishing.md#2026-11-25-juz-simple-publishingmd)与[自主管理账号汇编内的 `2026-11-25-admin-login-page.md` 小节](self-managed-accounts.md#2026-11-25-admin-login-pagemd)，不得因本主题通过而把它们标记为已解决。
>
> 计划见 [`../plans/2026-11-25-juz-browser-install.md`](../plans/2026-11-25-juz-browser-install.md)。一条不变事实：**原始架构文档 `component-platform-architecture.md` 的 SHA-256 始终为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`**。

## 逐条合并记录

### 2026-11-25-juz-browser-install.md

日期：2026-11-25。分支：`feat/juz-browser-install`；开工基线：`54bf15ca`。

#### 范围与环境

- 独立 `juz-cli` 分发包增加 `postinstall`，通过 Node 调用自身精确版本的 Playwright CLI 安装 Chromium；不使用 shell 或 npx 解析另一份依赖。
- Windows x64，系统 Node `24.6.0`、npm `11.5.1`、pnpm `12.18.0`，Playwright `1.65.0`。
- 平台 workspace 安装及组件消费者没有新增安装钩子。未执行 npm 发布、Git 推送或合并。

#### 实际执行结果

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

#### 最终本地产物

- 根版本 `0.1.7`，CLI `0.0.30`；功能提交 `9e9f702c`。
- 分发包：`packages/component-cli/.release/juz-cli-0.0.30.tgz`，511715 字节，SHA-256 为 `992bc39699723f0575c57fad9685cf70795a63ae9e77e7400158c1665e2dffe0`。
- 最终安装使用 `npm install --global --prefix <仓库>/.release/juz-0.0.30-validation --foreground-scripts --no-audit --no-fund <tgz>`，明确启用安装脚本和默认下载。npm 输出 `juz-cli@0.0.30 postinstall` 和 Chromium 下载/缓存完成，6 秒安装 56 个包，退出 0。
- 安装验证保留在忽略目录 `.release/juz-0.0.30-validation`；未改写用户正常全局 CLI 安装。

#### 验证边界

- 自动下载需要安装脚本启用及下载源可达；`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/true` 或 npm `--ignore-scripts` 可显式跳过。
- Linux 缺少系统库时 Playwright 可能只警告并返回成功；下载完成不代表系统依赖齐全。此钩子不安装 Linux 系统软件、不自动提权，未执行 Linux/macOS 验证。
- 本轮仅验证安装流程及相关回归，未重跑真实平台发布或全仓测试。之前全仓检查的后台、旧 T17 工具链和 worker 阻塞记录见[`2026-11-25-juz-simple-publishing.md` 小节](project-publishing.md#2026-11-25-juz-simple-publishingmd)，本轮不声称这些问题已解决。
- 工作区同时出现其他任务的后台及本地身份修改，未纳入本轮提交。
- 原始架构文件无 Git 差异；SHA-256 为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。

### 2026-11-26-juz-main-merge.md

本次按用户要求，将 `feat/juz-browser-install` 的 `9e9f702c`、`110aee9b` 合并到本地 `main`。

#### 合并范围

- 合并前 `main` 为 `286d502d`，包含后台登录页；CLI 分支基于共同祖先 `54bf15ca`。
- 合并前工作区干净。已执行 `git fetch origin`，本地 main 比 origin/main 领先 2 个提交，没有落后提交。
- 只有 `CHANGELOG.md` 内容冲突，双方更新记录均保留。CLI 源码、测试和文档与功能分支一致；后台、API 及对应测试与合并前 main 一致。
- 合并提交：`c2ae7cbb`。两个分支都曾使用根版本 `0.1.7`，本次独立收口为根 `0.1.8`，CLI 仍为 `0.0.30`；CLI 条目放在根 CHANGELOG 的 `0.1.8` 节，保留后台 `0.1.7` 记录。
- 本轮未推送远程、未发布 npm、未改写用户全局 CLI 安装。

#### 实际验证

Windows x64，Node `24.6.0`、npm `11.5.1`、pnpm `12.18.0`。

| 命令 / 检查 | 结果 |
| --- | --- |
| `pnpm --filter @company/component-cli build` | 通过，契约同步与 probe 清单复核通过 |
| `pnpm --filter @company/component-cli typecheck` | 通过 |
| `pnpm verify:workspace` | 合并后及根版本收口后均通过，11 个成员、无循环依赖、服务端依赖边界安全 |
| `pnpm exec vitest run tests/integration/juz-browser-install.test.ts tests/unit/juz-distribution.test.ts tests/unit/component-cli-onboarding.test.ts` | 3 文件、19/19 通过，62.65 秒；包括真实 npm 安装、空缓存 Chromium 下载、浏览器启动、503 下载失败与显式跳过 |
| `git diff --cached --check`、`git diff --check` | 通过 |
| `git merge-base --is-ancestor feat/juz-browser-install main` | 通过，CLI 分支提交已全部包含在 main |
| `pnpm test` | 退出 1；前置 Node 测试 161 通过、7 跳过；Vitest 150 文件通过、6 文件失败，2562 项通过、7 失败、2 跳过，另有 2 个 worker 异常；714.42 秒 |

只读审查确认未遗漏 CLI 改动、未覆盖后台代码，无未解决冲突。原始架构文件 SHA-256 仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。

全仓日志保存在忽略目录 `.release/juz-main-merge-full-test.log`。既有问题的历史记录见[`2026-11-25-juz-simple-publishing.md` 小节](project-publishing.md#2026-11-25-juz-simple-publishingmd)和[`2026-11-25-admin-login-page.md` 小节](self-managed-accounts.md#2026-11-25-admin-login-pagemd)；本轮只完成 CLI 合并与版本收口，不将全仓测试标记为通过。

全仓失败明细：

1. T17 `chain`、`chain-failure`、`runner`、`product-executor` 的 7 项测试仍要求仓库内固定 Windows Node `26.13.0`；其中清理阶段还报告目录 inventory 改变。这些文件与合并前 main 一致。
2. 后台 `console-render.test.ts` 无法解析 `react`，`login-page.test.ts` 无法解析 `react-dom/server`，两文件收集失败。后台测试和依赖清单不属于本次 CLI 修改。
3. `project-inspect.test.ts` 与 `project-plan.test.ts` 的 worker 以 `3221226505` 异常退出，与此前记录的类型相同，本轮未解决。

回归收尾时其他任务新增了后台 `shell.tsx`、`login/page.tsx` 与 `TokenLoginForm.tsx` 工作区改动，未纳入本轮提交，也不对这些新改动作验证结论。没有强制清理或切换工作区。
