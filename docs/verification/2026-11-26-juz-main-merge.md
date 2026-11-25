# juz Chromium 自动安装合并 main 验证

本次按用户要求，将 `feat/juz-browser-install` 的 `9e9f702c`、`110aee9b` 合并到本地 `main`。

## 合并范围

- 合并前 `main` 为 `286d502d`，包含后台登录页；CLI 分支基于共同祖先 `54bf15ca`。
- 合并前工作区干净。已执行 `git fetch origin`，本地 main 比 origin/main 领先 2 个提交，没有落后提交。
- 只有 `CHANGELOG.md` 内容冲突，双方更新记录均保留。CLI 源码、测试和文档与功能分支一致；后台、API 及对应测试与合并前 main 一致。
- 合并提交：`c2ae7cbb`。两个分支都曾使用根版本 `0.1.7`，本次独立收口为根 `0.1.8`，CLI 仍为 `0.0.30`；CLI 条目放在根 CHANGELOG 的 `0.1.8` 节，保留后台 `0.1.7` 记录。
- 本轮未推送远程、未发布 npm、未改写用户全局 CLI 安装。

## 实际验证

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

全仓日志保存在忽略目录 `.release/juz-main-merge-full-test.log`。既有问题的历史记录见 `2026-11-25-juz-simple-publishing.md` 和 `2026-11-25-admin-login-page.md`；本轮只完成 CLI 合并与版本收口，不将全仓测试标记为通过。

全仓失败明细：

1. T17 `chain`、`chain-failure`、`runner`、`product-executor` 的 7 项测试仍要求仓库内固定 Windows Node `26.13.0`；其中清理阶段还报告目录 inventory 改变。这些文件与合并前 main 一致。
2. 后台 `console-render.test.ts` 无法解析 `react`，`login-page.test.ts` 无法解析 `react-dom/server`，两文件收集失败。后台测试和依赖清单不属于本次 CLI 修改。
3. `project-inspect.test.ts` 与 `project-plan.test.ts` 的 worker 以 `3221226505` 异常退出，与此前记录的类型相同，本轮未解决。

回归收尾时其他任务新增了后台 `shell.tsx`、`login/page.tsx` 与 `TokenLoginForm.tsx` 工作区改动，未纳入本轮提交，也不对这些新改动作验证结论。没有强制清理或切换工作区。
