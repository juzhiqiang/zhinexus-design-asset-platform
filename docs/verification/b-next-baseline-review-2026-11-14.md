# B 侧审查补强与 0.0.10 真实 E2E 独立补充验证记录 (2026-11-14)

- **工作分支**：`feat/b-baseline-cli`
- **基线提交**：继承第一阶段已提交记录（`5231838`、`bbbf24d`、`1cd95a6`、`e405344`），不改写历史记录 `docs/verification/b-next-baseline-2026-11-13.md`。
- **工具链**：`.\scripts\pnpm.ps1`（Node `26.13.0`、pnpm `12.18.0`）。

## 1. C 审查三项补强与 PNG 解码器加固（TDD RED -> GREEN）

1. **环境摘要校验与基线元数据运行时校验**
   - `packages/component-cli/src/local/compare.ts`：`compareBaseline` 始终按传入 `environment` 重新计算 `environmentKey`，若与外部传入 `environmentKey` 不一致或任一方不匹配立即返回 `INCOMPATIBLE`（`diffRatio: 1`）。
   - `packages/component-cli/src/commands/check.ts`：读取 `baseline.json` 时使用 `validateSchema` + `environmentSchema` 进行运行时结构校验，失败返回 `INVALID_BASELINE_METADATA`，移除 `as` 断言。
   - **RED -> GREEN**：`tests/unit/baseline-compare.test.ts` 新增伪造 `environmentKey` 拒绝用例（先确认 FAIL，修复后通过）。

2. **自写 PNG 解码器安全性与透明块兼容加固**
   - `packages/component-cli/src/local/compare.ts`：重写 PNG 解析逻辑，逐 chunk 校验 CRC32、强制校验 `IHDR`/`IDAT`/`IEND` 顺序与唯一性、限制宽高 `<= 8192` 与最大像素数、使用 `zlib.inflateSync(..., { maxOutputLength })` 防止解压炸弹，并新增 `PLTE` 调色板与 `tRNS`（灰度/RGB/调色板）透明块解析。
   - **RED -> GREEN**：`tests/unit/baseline-compare.test.ts` 新增坏 CRC32 拒绝、畸形超大尺寸拒绝、RGB `tRNS` 透明 PNG 像素对比回归用例（`9 passed (9)`）。

3. **`acceptBaseline` 响应校验、请求边界与 `baselineCandidates` 消歧**
   - `packages/component-cli/src/commands/baseline.ts` & `packages/component-cli/src/cli.ts`：
     - 使用 `validateApiMessage('createBaselineResponse', ...)` 与 `validateApiMessage('releaseJobResponse', ...)` 校验接口响应，`HTTP 200 {}` 或非合法 UUID `revisionId` 返回 `INVALID_RESPONSE`。
     - 对齐 `release.ts` 边界：`http`/`https` 协议校验、禁止 URL 内嵌凭证、`AbortSignal.timeout(timeoutMs)`、`redirect: 'error'`，以及 `PLATFORM_API_URL`/`PLATFORM_TOKEN` 环境变量回退。
     - 支持 `--job-id <uuid>` 从 `releaseJob.baselineCandidates` 中按本地 `client_ref` 映射唯一服务端 `screenshotId`（保持本地报告与截图映射，不以服务端 UUID 反向筛选本地数组）。
   - **RED -> GREEN**：`tests/unit/baseline-cli.test.ts` 新增 `HTTP 200 {}` 拒绝及 `--job-id` `baselineCandidates` 映射与 `redirect: 'error'` / `signal` 断言（`6 passed (6)`）。

4. **真实 API + PostgreSQL 集成验收**
   - `tests/integration/cli-baseline.test.ts`（自有 `RecoveryStack` + `platformHarness`）：实测验证首次接受基线（`201 rev1`）、无权限用户 `403 FORBIDDEN`、缺失/过期 `expectedRevision` 触发 `409 CONFLICT`、正确 `expectedRevision` 推进（`201 rev2`），以及多版本相同 `client_ref` 无 `jobId` 触发 `409 CONFLICT` 后传入 `jobId` 通过 `baselineCandidates` 精确消歧推进（`201 rev3`）。
   - `tests/integration/cli-check.test.ts`：同步更新 `--framework all` 断言为 `[vue] 验证完成` / `[react] 验证完成`。

## 2. 实际执行命令与结果

| 检查项 | 执行命令 | 实际结果 |
|---|---|---|
| CLI 构建与基线单测 | `.\scripts\pnpm.ps1 --filter @company/component-cli build; .\scripts\pnpm.ps1 vitest run tests/unit/baseline-compare.test.ts tests/unit/baseline-cli.test.ts` | 构建通过；2 文件 `15 passed (15)` |
| 真实 API 基线集成测试 | `.\scripts\pnpm.ps1 vitest run tests/integration/cli-baseline.test.ts` | 1 文件 `1 passed (1)` |
| CLI check 集成测试 | `.\scripts\pnpm.ps1 vitest run tests/integration/cli-check.test.ts` | 1 文件 `6 passed (6)` |
| SDK `0.0.10` 真实三存储 E2E | `$env:ZHINEXUS_SDK_BUNDLE_DIR="D:\project\zhinexus-design-asset-platform\.tools\operations\current-sdk\dcc49e73-37c6-4579-a814-713e780ae583"; .\scripts\pnpm.ps1 exec playwright test tests/browser/web-upload-real-e2e.spec.ts --config tests/playwright.config.ts` | **6 passed (47.3s)**，端口 `5173–5176` 已释放 |
| 工作区与全局类型检查 | `.\scripts\pnpm.ps1 verify:workspace; .\scripts\pnpm.ps1 typecheck` | `10 members` 校验通过；`typecheck` 14/14 通过 |
| 根全量测试（最终编辑后） | `.\scripts\pnpm.ps1 test` | **39 passed (39)**，**699 passed (699)**（207.57s） |

## 3. 版本与 CHANGELOG 变更说明（待 C 统一收口写入根 `CHANGELOG.md`）

- `@company/component-cli`：`0.0.7` -> `0.0.8`
  - 修复 `compareBaseline` 信任外部 `environmentKey` 与 `check.ts` 未运行时校验 `baseline.json` 的缺陷；
  - 加固自写 PNG 解码器（chunk CRC32、顺序、尺寸与解压上限、`PLTE`/`tRNS` 透明块支持）；
  - 修复 `acceptBaseline` 响应契约校验、`redirect: 'error'` / 超时 / URL 凭证边界，并支持 `--job-id` 通过 `releaseJob.baselineCandidates` 进行多版本 `client_ref` 消歧。

## 4. 未覆盖边界

- 第二阶段 `component echarts check/verify` 仍等待 A 侧交付运行时探针接口后接入。
- 本次测试未初始化共享 G2 基础设施，未执行 `git push`、`merge` 或 `delete`。
