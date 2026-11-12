# 工程脚本整理验证（2026-11-12）

本次为 C 负责的工程入口整理，依据 [实施子计划](../superpowers/plans/2026-11-12-simplify-project-scripts.md)。根 scripts 从 8 个文件减为 5 个；不改变业务协议、依赖版本、包版本或 G1/G2/T01 验收状态。

## 入口对应关系

| 原入口 | 当前入口与职责 |
| --- | --- |
| `scripts/verify-bootstrap.ps1` | `scripts/verify.ps1 -Bootstrap`，只验证首次下载和缓存重跑 |
| `scripts/verify-gallery-cache.mjs` | `tests/integration/gallery-cache.mjs`，通过 `scripts/pnpm.ps1 test:gallery-cache` 独立执行 |
| `scripts/generate-contract-schemas.ts` | `packages/contracts/scripts/generate-schemas.ts`，通过 `scripts/pnpm.ps1 --filter @company/contracts schemas:generate` 先构建后生成 |
| Schema 生成脚本 `--check` | 普通契约测试 `tests/contracts/api-schema.test.ts` 检查内容、缩进和末尾换行精确一致 |
| 日常验证末尾的 `build:services` | 删除该次重复调用；根 `typecheck` 和 `test` 的服务构建前置保持不变 |

历史计划和验证记录中的旧命令保留当时原貌；复跑应使用上表。版本发现脚本仍保留，只刷新候选记录，不升级依赖。

## 实际验证

所有工作区命令通过项目固定工具链运行：Windows x64、Node 26.13.0、pnpm 12.18.0；PowerShell 专项通过 Windows 自带 `powershell.exe -NoProfile -NonInteractive` 执行。

| 命令 / 检查 | 本次结果 |
| --- | --- |
| `scripts/pnpm.ps1 exec vitest run tests/contracts/api-schema.test.ts`（改动前） | 退出 0，26/26 通过 |
| `scripts/pnpm.ps1 exec vitest run tests/tooling/verify.test.ts`（RED） | 退出 1，3 失败 / 1 通过；捕获末尾重复服务构建及缺少 Bootstrap 独立模式 |
| `scripts/pnpm.ps1 exec vitest run tests/tooling/verify.test.ts tests/contracts/api-schema.test.ts`（GREEN） | 退出 0，30/30 通过；覆盖默认流程、失败停止、环境/目录恢复及专项成功/失败后的清理 |
| `scripts/pnpm.ps1 --filter @company/contracts schemas:generate` | 退出 0；重新生成的 23 份 Schema 无 Git 差异 |
| `scripts/verify.ps1 -Bootstrap` | 退出 0；真实首次下载、摘要与固定版本校验、缓存重跑通过；结束后无 bootstrap-check 临时目录残留 |
| `scripts/pnpm.ps1 exec playwright install chromium` | 退出 0；项目 `.tools/playwright` 安装 Chromium/headless shell v1254（158.0.8127.18）及配套工具 |
| `$env:TURBO_FORCE='true'; scripts/verify.ps1` | 退出 0；冻结安装、10 成员边界、构建 10/10、类型任务 14/14 与根 tsc、服务前置任务均通过；各 Turbo 阶段 0 cached，实际执行；Vitest 11 文件 / 180 测试通过，Playwright 15/15 通过 |
| `scripts/pnpm.ps1 test:gallery-cache` | 退出 0；A→B→A→unset 四轮真实构建/start/HTTP sitemap 通过 |
| `git diff --check` | 退出 0 |
| 受保护文件 | pnpm-lock.yaml、全部 Schema、原始架构文档均无差异；verify.ps1 工作区行尾 CRLF |

窄测试开发中曾发现测试夹具将 PowerShell 未设置变量与空字符串混为一谈；Bootstrap 模式实际没有修改该变量。调整夹具为显式 origin，验证专项成功/失败均保留原值；未为迎合断言修改生产代码。

原架构 SHA-256 前后相同：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 审查与边界

独立只读代码审查覆盖全部差异及新增文件：无 Critical、Important 或 Minor 发现。实际下载与全套运行结果由主代理验证。完整日志保存在本地被忽略的 `.tools/scripts-maintenance/`，不提交工具链、依赖和构建产物。

运行中有 Vite chunk 大小提示、Node DEP0190 和 NO_COLOR/FORCE_COLOR 警告，均未导致失败；本次没有扩大为这些提示的治理任务。新 PowerShell 单元测试仅在 Windows 运行；其他系统未新增支持声明。没有执行真实 PostgreSQL、Verdaccio、MinIO、OIDC 或发布验收，不据此关闭 G2/T01；本次也不触发业务包升版。
