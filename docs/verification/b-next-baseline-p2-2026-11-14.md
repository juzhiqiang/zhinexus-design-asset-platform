# B 侧 P2 审查修正独立补充验证记录 (2026-11-14)

- **工作分支**：`feat/b-baseline-cli`
- **基线版本**：`@company/component-cli` 沿用本周期未发布的 `0.0.8`（`CHANGELOG.md` 统一由 C 收口）。
- **工具链**：`.\scripts\pnpm.ps1`（Node `26.13.0`、pnpm `12.18.0`）。

## 1. 工作树已有未混入差异记录

执行前工作树存在两处与本轮无关的既有局部差异（各 1 行空白/尾行换行差异），按协作规范保持原样、未混入本轮提交：
- `apps/gallery/app/(console)/upload/page.tsx`（第 33 行空行尾随空格移除）
- `docs/verification/b-next-baseline-2026-11-13.md`（文件末尾增加 1 个空行）

另外 `tests/acceptance/t10-sdk` 属 A 侧误写范围，由 C 协调处理，本轮未触碰。

## 2. 两项 P2 修正（先 RED 后 GREEN）

1. **PNG 解码器拒绝 `IDAT` 之后的 `tRNS`/`PLTE` 与未知 critical chunk**
   - 修改：[compare.ts](file:///d:/project/zhinexus-design-asset-platform/packages/component-cli/src/local/compare.ts)
   - 修复内容：`PLTE` 与 `tRNS` 若出现在 `IDAT` 之后立即抛出 `INVALID_PNG`；其余非 `IHDR`/`PLTE`/`tRNS`/`IDAT`/`IEND` chunk 若首字节第 5 位为 0（即关键 chunk，首字母大写）立即抛出 `UNSUPPORTED_PNG`。
   - **RED -> GREEN**：[baseline-compare.test.ts](file:///d:/project/zhinexus-design-asset-platform/tests/unit/baseline-compare.test.ts) 新增有效 CRC 的 `IDAT` 后 `tRNS` 与未知 critical chunk `CRIT` 畸形 PNG 用例；修改前确认 `trnsAfterIdat` 未抛出异常（RED），修复后 `10 passed (10)`（GREEN）。

2. **`acceptBaseline` 非 2xx 下 `null`/数组/标量 JSON 响应体防 `TypeError`**
   - 修改：[baseline.ts](file:///d:/project/zhinexus-design-asset-platform/packages/component-cli/src/commands/baseline.ts)
   - 修复内容：抽取 `parseApiError`，仅当响应体 `raw !== null && typeof raw === 'object' && !Array.isArray(raw)` 时读取 `code`/`message`，否则稳定回退到 `HTTP_<status>` 与 `statusText`/默认提示，覆写 `GET /v1/releases/:jobId` 与 `POST /v1/baselines` 两条非 2xx 分支。
   - **RED -> GREEN**：[baseline-cli.test.ts](file:///d:/project/zhinexus-design-asset-platform/tests/unit/baseline-cli.test.ts) 新增 `502 null`、`400 ["bad"]`、`500 "plain-error"` 回归用例；修改前确认 `GET /v1/releases/:jobId` 返回 `null` 时抛出 `TypeError: Cannot read properties of null (reading 'code')`（RED），修复后 `7 passed (7)`（GREEN）。

## 3. 实际执行命令与结果

| 检查项 | 执行命令 | 实际结果 |
|---|---|---|
| 基线窄单测（RED 验证） | `.\scripts\pnpm.ps1 vitest run tests/unit/baseline-compare.test.ts tests/unit/baseline-cli.test.ts` | 修复前预期失败 `2 failed \| 15 passed (17)` |
| 基线窄单测、CLI 构建与全局类型检查 | `.\scripts\pnpm.ps1 vitest run tests/unit/baseline-compare.test.ts tests/unit/baseline-cli.test.ts; .\scripts\pnpm.ps1 --filter @company/component-cli build; .\scripts\pnpm.ps1 typecheck` | 单测 `17 passed (17)`；CLI 构建通过；`typecheck` `14/14` 通过 |
| 根全量测试（最终编辑后） | `.\scripts\pnpm.ps1 test` | **39 passed (39)**，**701 passed (701)**（230.76s） |

## 4. 未覆盖边界

- 第二阶段 `component echarts check/verify` 等待 A 侧探针接口交付后推进。
- 本轮未初始化共享 G2 基础设施，未执行 `git push`、`merge`、`reset` 或 `delete`。
