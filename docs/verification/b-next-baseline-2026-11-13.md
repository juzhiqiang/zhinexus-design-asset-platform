# B 侧第一阶段交付与验证记录（T04 本地视觉基线闭环 + WebCrypto 异常恢复 + 冻结 Bundle 环境变量化）

> 日期：2026-11-13  
> 负责人：B（Antigravity）  
> 工作分支：`feat/b-baseline-cli`（基于 `main` `4dc93fe`）  
> 关联阶段：第一阶段完成（等待 A 探针接口以进入第二阶段 `component echarts check/verify`）

---

## 1. 本轮交付内容摘要

1. **T04 本地视觉基线比对与确认闭环**：
   - 新增 [compare.ts](file:///D:/project/zhinexus-design-asset-platform/packages/component-cli/src/local/compare.ts)：实现无外部运行时依赖的纯 Node PNG 像素解码/编码与 `compareBaseline(current, baseline, options?)`；
     - 严格按 `environmentKey` 判定环境一致性：`os`/`arch`/`browserVersion`/`fontDigest`/`locale`/`timezone`/`deviceScaleFactor`/`renderer`/`width`/`height`/`theme` 任意不一致即返回 `INCOMPATIBLE`，绝不判定为 `PASS`；
     - 仅 `echartsVersion` 或 `frameworkVersion` 升级时保持同一 `environmentKey` 并正常执行图像像素对比；
     - 支持 `PASS` / `DIFF` / `NEW` / `INCOMPATIBLE` 四态输出，超阈值（默认 `pixelThreshold=0.1`、`maxDiffPixelRatio=0.001`）生成红色高亮差异图 PNG `diffImage` 与精确 `diffRatio`；
     - 显式拒绝 `unknown-manual` 手动上传来源参与自动基线比对。
   - 新增 [baseline.ts](file:///D:/project/zhinexus-design-asset-platform/packages/component-cli/src/commands/baseline.ts) 与 CLI 接入（[cli.ts](file:///D:/project/zhinexus-design-asset-platform/packages/component-cli/src/cli.ts)）：实现 `component baseline accept --report <path> --reason <text> [--api-url <url>] [--token <jwt>] [--expected-revision <rev>]`；
     - 前置本地契约与来源门禁：拒绝失败检查报告（`CHECK_FAILED`）、不兼容环境报告（`INCOMPATIBLE_ENVIRONMENT`）、手动上传图（`manual-upload` / `unknown-manual` -> `SOURCE_FORBIDDEN`）及空理由，绝不伪造 `local-automatic`；
     - 复用服务端 `POST /v1/baselines` 权限校验与 `expectedRevision` CAS 机制，透传 `409 CONFLICT` 与 `403 FORBIDDEN` 等错误码并保证非零退出。
   - 增强 [check.ts](file:///D:/project/zhinexus-design-asset-platform/packages/component-cli/src/commands/check.ts)：支持 `--baseline-dir <dir>` 可选参数，在检查闭环中自动执行 `compareBaseline`、写出 `diffs/<variantId>-diff.png` 并据实写入 `CheckReportV1.baselineResult`。

2. **网页提交前 WebCrypto 异常 busy 锁死修复**：
   - 修复 [upload/page.tsx](file:///D:/project/zhinexus-design-asset-platform/apps/gallery/app/(console)/upload/page.tsx) 中 `handleSubmitRelease`：`validateVariantScreenshots` 与 `await validateUploadFiles(manifest, filesMap)` 原位于 `try/finally` 之外，导致 `crypto.subtle.digest` reject 时 `isSubmitting` 永不复位；现已全部纳入 `try/catch/finally` 保护，异常后报错并立即恢复提交按钮可用状态；未扩多上下文草稿范围。

3. **冻结 Bundle 环境变量化（移除 D 盘硬编码 0.0.6 路径）**：
   - 更新 [web-upload-real-e2e.spec.ts](file:///D:/project/zhinexus-design-asset-platform/tests/browser/web-upload-real-e2e.spec.ts)：彻底移除硬编码的 D 盘 `0.0.6` 目录及版本号，改为强制读取环境变量 `ZHINEXUS_SDK_BUNDLE_DIR`，缺变量或缺少 `manifest.json` 时直接抛出 `MISSING_ENV_ZHINEXUS_SDK_BUNDLE_DIR` / `INVALID_SDK_BUNDLE_DIR` 阻断；所有包路径与版本号均从给定冻结清单动态读取，绝不自动重新 `pnpm pack`。

---

## 2. TDD RED -> GREEN 验证记录与命令结果

### 2.1 WebCrypto 异常恢复回归测试（RED -> GREEN）

- **RED 复现**：在 [manual-release.spec.ts](file:///D:/project/zhinexus-design-asset-platform/tests/browser/manual-release.spec.ts) 新增用例 `提交前最终快照校验触发 WebCrypto 异常时必须恢复提交按钮可用状态并提示错误`，注入 `window.crypto.subtle.digest` reject；修改前执行：
  - 命令：`.\scripts\pnpm.ps1 exec playwright test tests/browser/manual-release.spec.ts -g "WebCrypto" --config tests/playwright.config.ts`
  - 结果：**RED (1 failed)**，`#upload-status-message` 停留在 `"正在执行提交前最终快照完整性核验..."`，按钮保持 disabled。
- **GREEN 验证**：修复 `upload/page.tsx` 并重新编译 `@company/gallery` 后重跑：
  - 命令：`.\scripts\pnpm.ps1 exec playwright test tests/browser/manual-release.spec.ts --config tests/playwright.config.ts`
  - 结果：**9 passed (9) (5.0s)**，包含 WebCrypto 异常恢复用例在内的全部手动发布浏览器回归均通过。

### 2.2 缺失 `ZHINEXUS_SDK_BUNDLE_DIR` 失败报错验证

- 命令：`$env:ZHINEXUS_SDK_BUNDLE_DIR=""; .\scripts\pnpm.ps1 exec playwright test tests/browser/web-upload-real-e2e.spec.ts -g "真实三存储全链路" --config tests/playwright.config.ts`
- 结果：立即失败退出（0ms）并清晰报错 `MISSING_ENV_ZHINEXUS_SDK_BUNDLE_DIR`，未执行自动 `pack`，未启动临时容器。

### 2.3 T04 视觉基线比对与 CLI 确认测试（RED -> GREEN）

- **RED 复现**：先编写 [baseline-compare.test.ts](file:///D:/project/zhinexus-design-asset-platform/tests/unit/baseline-compare.test.ts) 与 [baseline-cli.test.ts](file:///D:/project/zhinexus-design-asset-platform/tests/unit/baseline-cli.test.ts)，运行 `.\scripts\pnpm.ps1 vitest run tests/unit/baseline-compare.test.ts tests/unit/baseline-cli.test.ts` 确认模块缺失失败（RED）。
- **GREEN 验证**：实现 `compare.ts`、`commands/baseline.ts`、`cli.ts`、`check.ts` 后：
  - `.\scripts\pnpm.ps1 --filter @company/component-cli build`：编译与 contracts 同步通过；
  - `.\scripts\pnpm.ps1 typecheck`：全工作区 10 包 + 根工程 **0 错误 (FULL TURBO)**；
  - `.\scripts\pnpm.ps1 verify:workspace`：**10 members, no cycles, four publishable shells, safe service graph**；
  - `.\scripts\pnpm.ps1 vitest run tests/unit/`：**18 test files passed, 275 tests passed (6.30s)**。

---

## 3. 未覆盖边界说明

1. **真实冻结 0.0.10 Bundle 三存储 E2E**：本轮已改造 `web-upload-real-e2e.spec.ts` 支持 `ZHINEXUS_SDK_BUNDLE_DIR` 动态驱动，待 C 提供统一 0.0.10 冻结材料路径后执行完整三存储 E2E 实跑；
2. **`POST /v1/baselines` 真实 Postgres 数据库集成测试**：本轮 `baseline-cli.test.ts` 使用进程内 HTTP stub 精确校验了请求载荷、Authorization 头与 `409 CONFLICT` / `403 FORBIDDEN` 契约，未初始化共享 G2 基础设施；
3. **`component echarts check / verify`**：将在第二阶段接入 A 交付的探针接口后实施。

---

## 4. B 侧独立 CHANGELOG 草稿（供 C 最后统一收口）

### `@company/component-cli` [0.0.7] - 2026-11-13
- **新增**：实现 T04 本地视觉基线比对 `compareBaseline`（支持 `PASS`/`DIFF`/`NEW`/`INCOMPATIBLE`、同环境像素对比与红色差异图输出、环境不一致强制 `INCOMPATIBLE`、仅引擎/框架升级仍对比已有基线）。
- **新增**：实现 `component baseline accept --report <path> --reason <text>` 命令，复用 `POST /v1/baselines` 权限与 `expectedRevision` CAS，本地前置拦截手动截图（`manual-upload` / `unknown-manual`）、失败报告与不兼容环境报告。
- **变更**：`component check` 支持可选 `--baseline-dir <dir>` 自动执行基线对比并生成差异图。

### `@company/gallery` [0.0.5] - 2026-11-13
- **修复**：将发布控制台提交前 `validateVariantScreenshots` 与 `validateUploadFiles` 纳入 `try/catch/finally` 保护，解决 WebCrypto `digest` 异常拒绝后提交按钮持续处于 busy 锁死状态的问题。
