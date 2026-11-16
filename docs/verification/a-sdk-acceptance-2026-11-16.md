# 验证记录：A 侧 T02 生命周期与 T09 双框架对等审计及修复（2026-11-16）

- 工作区：`C:\Users\10208\.codex\worktrees\t13-a-eval\zhinexus-design-asset-platform`
- 分支：`feat/t13-a-eval`（基线 `93acfa8b`）
- 修改范围：`packages/charts-vue/src/useChart.ts`、`packages/charts-react/src/useChart.ts`、`tests/unit/sdk-lifecycle.test.ts`、`docs/verification/a-sdk-acceptance-2026-11-16.md`
- 约束确认：未修改 `contracts`、根配置、锁文件、CLI、gallery、API 或包版本号。

## 审计发现与 TDD 修复

1. **Vue `useChart` 未监听 `optionOverrides` 变化（与 React 不对等）**
   - 位置：`packages/charts-vue/src/useChart.ts:186-188`
   - 现象：React 版 `useChart.ts:192-194` 在 `[options.data, options.optionOverrides]` 变化时均调用 `controller.update`，而 Vue 版仅 `watch(options.data, ...)`，导致父组件仅更新 `:option-overrides` 时 ECharts 实例不刷新。
   - 修复：改为 `watch([options.data, options.optionOverrides], () => { applyData(); });`。

2. **Vue / React `useChart` 同时修改 `theme`/`renderer` 与业务配置字段时丢失业务配置**
   - 位置：`packages/charts-vue/src/useChart.ts:190-209`、`packages/charts-react/src/useChart.ts:197-216`
   - 现象：只要 `theme` 或 `renderer` 发生变化就直接调用 `setPresentation(theme, renderer)` 并 `return`，导致同次更新的其他配置字段（例如 `smooth: true`、`donut: true` 等）被静默丢弃。
   - 修复：仅在 `presentationChanged && sameChartConfig(chart, { ...previous, theme, renderer }, next)` 成立时走 `setPresentation`；若同时包含其他配置字段变更，则走控制器销毁重建路径以应用完整新配置。

3. **T09 七组件双框架对等与 T02 生命周期审计**
   - 核对 `packages/charts-vue/src/index.ts`、`packages/charts-react/src/index.ts` 及 `package.json`：7 个组件（`LineChart`、`BarChart`、`PieChart`、`ScatterChart`、`TrendCard`、`Ranking`、`Proportion`）与 `./style.css` 及子路径导出完全对等，且 `examples/vue` 与 `examples/react` 均覆盖全部 7 个独立组件页面。
   - 核对 `packages/charts-core/src/controller.ts`：零尺寸容器延迟初始化、`ResizeObserver` 触发创建、幂等 `dispose()` 及 `whenRendered()` 唤醒均正常。

## TDD 与实际验证结果

1. **RED 阶段**
   - 命令：`.\scripts\pnpm.ps1 exec vitest run tests/unit/sdk-lifecycle.test.ts`
   - 结果：exit code `1`（1 passed / 2 failed），复现 `optionOverrides` 未更新与同改 `theme` + `smooth` 未重建控制器的缺陷。

2. **GREEN 阶段（最终代码实跑全通过）**
   - `.\scripts\pnpm.ps1 --filter @company/charts-core --filter @company/charts-vue --filter @company/charts-react --filter @company/example-vue --filter @company/example-react build` -> exit `0`
   - `.\scripts\pnpm.ps1 --filter @company/charts-core --filter @company/charts-vue --filter @company/charts-react --filter @company/example-vue --filter @company/example-react typecheck` -> exit `0`
   - `.\scripts\pnpm.ps1 exec vitest run tests/unit/sdk-lifecycle.test.ts tests/unit/chart-data.test.ts tests/unit/chart-semantics.test.ts tests/unit/charts-vue-declarations.test.ts tests/unit/sdk-compatibility.test.ts tests/evaluation/id-matching.test.ts` -> exit `0`（6 个测试文件全部通过，共 `191 passed`：`sdk-lifecycle.test.ts` 5、`charts-vue-declarations.test.ts` 6、`chart-semantics.test.ts` 105、`sdk-compatibility.test.ts` 51、`id-matching.test.ts` 12、`chart-data.test.ts` 12）
   - `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` -> exit `0`
   - `.\scripts\pnpm.ps1 verify:workspace` -> exit `0`（`Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`）

## 未覆盖边界

- 按本轮四方协作指令，浏览器渲染（`test:browser`）与 infra 测试暂未运行，留待 C 统一协调调度。
