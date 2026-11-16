# 修复验证记录：双框架 useChart 展示配置归一化与累计覆盖保留（2026-11-16）

- 工作区：`C:\Users\10208\.codex\worktrees\t13-a-eval\zhinexus-design-asset-platform`
- 分支：`feat/t13-a-eval`（基于 `98cee34c`，未改写历史验证记录）
- 修改文件：`packages/charts-vue/src/useChart.ts`、`packages/charts-react/src/useChart.ts`、`tests/unit/sdk-lifecycle.test.ts`、`tests/browser/framework-lifecycle.spec.ts`、`docs/verification/a-sdk-presentation-normalization-2026-11-16.md`
- 约束确认：未修改版本号、根配置、锁文件或他人工作区。

## 根因与修复

- **根因**：`31a115ae` 仅对 `sameChartConfig` 的左侧 `previous` 注入默认 `theme`/`renderer`，右侧 `next` 在省略 `theme`/`renderer` 时保持 `undefined`，导致 `'light' !== undefined` 使 `sameChartConfig` 误判为 `false`，从而在切回默认主题/渲染器时错误销毁重建控制器，丢失先前累计的 `optionOverrides`（如先设 `grid.left=64` 再设 `tooltip.show=false` 后切回默认 `theme`/`renderer` 时 `grid.left` 回退为 `8`）。
- **修复**：在 `packages/charts-vue/src/useChart.ts:197-220` 与 `packages/charts-react/src/useChart.ts:205-228` 对比较两侧统一构造 `normalizedPrev` 与 `normalizedNext`（将两侧 `theme` 归一化为 `?? 'light'`、`renderer` 归一化为 `?? 'canvas'`），确保仅变更展示字段时走 `setPresentation` 复用控制器，同时保留真正业务配置字段变化时的重建行为。

## TDD 与实际验证结果

1. **RED 阶段**
   - 在 `tests/unit/sdk-lifecycle.test.ts` 新增省略 `theme`/`renderer` 切回默认并保留累计 `grid.left=64` 用例。
   - 命令：`.\scripts\pnpm.ps1 exec vitest run tests/unit/sdk-lifecycle.test.ts`
   - 结果：exit `1`（5 passed / 1 failed），复现 `expect(capturedController!.value).toBe(firstCtrl)` 失败（控制器被错误重建）。

2. **GREEN 阶段（最终代码全通过）**
   - 全仓构建：`.\scripts\pnpm.ps1 build` -> exit `0`（10/10 tasks successful，3.253s）
   - 类型检查：
     - `.\scripts\pnpm.ps1 --filter @company/charts-core --filter @company/charts-vue --filter @company/charts-react --filter @company/example-vue --filter @company/example-react typecheck` -> exit `0`
     - `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` -> exit `0`
   - 单元测试：`.\scripts\pnpm.ps1 exec vitest run tests/unit/sdk-lifecycle.test.ts tests/unit/chart-data.test.ts tests/unit/chart-semantics.test.ts tests/unit/charts-vue-declarations.test.ts tests/unit/sdk-compatibility.test.ts tests/evaluation/id-matching.test.ts` -> exit `0`（6 文件共 **192 passed**）
   - 工作区检查：`.\scripts\pnpm.ps1 verify:workspace` -> exit `0`
   - 单元/构建日志：`C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-611.log`
   - Playwright 浏览器回归与双框架矩阵：`.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts tests/browser/core-lifecycle.spec.ts tests/browser/framework-lifecycle.spec.ts tests/browser/component-matrix.spec.ts tests/browser/presentation-matrix.spec.ts` -> exit `0`（**170 passed**，21.3s，含新增 `both_frameworks_preserve_overrides_when_omitting_theme_and_renderer_back_to_defaults`）
   - 浏览器日志：`C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-615.log`
   - 端口释放：`open_ports_count=0`（5173–5176 已全部释放）。
