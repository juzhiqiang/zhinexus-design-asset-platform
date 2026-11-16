# 补充验证记录：A 侧真实浏览器生命周期与 7 组件双框架矩阵（2026-11-16）

- 工作区：`C:\Users\10208\.codex\worktrees\t13-a-eval\zhinexus-design-asset-platform`
- 分支：`feat/t13-a-eval`（基于 `31a115ae`，未改写历史记录 `docs/verification/a-sdk-acceptance-2026-11-16.md`）
- 修改范围：`examples/vue/src/App.vue`、`examples/react/src/App.tsx`、`tests/browser/framework-lifecycle.spec.ts`、`docs/verification/a-sdk-browser-acceptance-2026-11-16.md`
- 约束确认：未修改版本号、根配置、锁文件或他人工作区。

## 新增真实浏览器回归用例

1. `both_frameworks_apply_business_config_when_changing_presentation`（`tests/browser/framework-lifecycle.spec.ts`）：
   - 在真实 Chromium 中同时打开 Vue（`5174`）与 React（`5175`）示例页，通过 `__LINE_LIFECYCLE_CONTROLS__.setConfig({ theme: 'dark', renderer: 'svg', smooth: true, animation: false })` 同次修改展示配置与业务配置；
   - 断言画布从 `<canvas>` 切换为 `<svg>`，且读取真实 ECharts 实例 `getOption().series[0].smooth === true`，无 `pageerror`。
2. `vue_updates_option_overrides_without_data_change`（`tests/browser/framework-lifecycle.spec.ts`）：
   - 在 Vue 示例页保持 `data` 引用不变，仅调用 `__LINE_LIFECYCLE_CONTROLS__.setOptionOverrides({ grid: { left: 96 } })`；
   - 断言真实 ECharts 实例 `getOption().grid[0].left === 96`，无 `pageerror`。
3. **RED/GREEN 追溯**：
   - 修复前的 RED 失败已由提交 `31a115ae` 的 `.\scripts\pnpm.ps1 exec vitest run tests/unit/sdk-lifecycle.test.ts`（exit `1`，1 passed / 2 failed）直接复现；
   - 修复合入后本轮完成全仓构建并补齐上述真实 Chromium 浏览器行为回归，全量通过（GREEN）。

## 实际执行命令与结果

1. **全仓构建**：`.\scripts\pnpm.ps1 build`
   - 结果：exit `0`（10/10 tasks successful，13.228s）
   - 日志：`C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-584.log`
2. **浏览器生命周期与 7 组件 × Vue/React 矩阵**：
   - 命令：`.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts tests/browser/core-lifecycle.spec.ts tests/browser/framework-lifecycle.spec.ts tests/browser/component-matrix.spec.ts tests/browser/presentation-matrix.spec.ts`
   - 结果：exit `0`，**169 passed (23.3s)**（覆盖 `core-lifecycle`、`framework-lifecycle` 含新增 2 项回归、`component-matrix` 7 组件双框架矩阵与 `presentation-matrix` light/dark × canvas/svg 矩阵）。
   - 日志：`C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-588.log`
3. **类型检查与端口释放**：
   - `.\scripts\pnpm.ps1 --filter @company/example-vue --filter @company/example-react typecheck` -> exit `0`
   - `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` -> exit `0`
   - 端口 `5173, 5174, 5175, 5176` 检查：`open_ports_count=0`（已全部释放）。
