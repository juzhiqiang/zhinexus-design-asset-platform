# 验证记录：A 确定性组件 API 材料与 ID 规则评估（2026-11-15）

- 工作区：`C:\Users\10208\.codex\worktrees\a-phase2-evaluation\zhinexus-design-asset-platform`
- 分支：`feat/phase2-id-evaluation`（基线 `01e95e16`）
- 交付内容：
  - 批 1（`840fd5eb`）：`packages/component-cli/src/local/component-api.ts`、`packages/component-cli/src/local/manifest.ts`（API 材料生成片段）、`tests/unit/component-api.test.ts`
  - 批 2：`tests/evaluation/id-matching.ts`、`tests/evaluation/id-matching.test.ts`、`docs/verification/a-phase2-id-evaluation-2026-11-15.md`

## 14 个真实实现源码审计证据

审计目标：`packages/charts-vue/src/*.types.ts`、`packages/charts-react/src/*.types.ts`、`packages/charts-{vue,react}/package.json`：

- 全部 7 个组件（`line`、`bar`、`pie`、`scatter`、`trend-card`、`ranking`、`proportion`）× 2 个框架（`vue`、`react`）的导出名、导出路径 `./<component>`、样式导出 `./style.css` 与就绪句柄 `whenRendered` 一致。
- 修正旧 `manifest.ts` 问题：
  - 补充 `schemaVersion: 1` 及 `ComponentApiV1` 数组结构的 `props` / `events`；
  - `optionOverrides` 类型由编造的 `EChartsOption` 修正为真实 `SupportedOptionOverrides`（`pie` 在 `notes` 说明仅支持 `tooltip`、`legend`、`title`）；
  - `ranking` / `proportion` 的 `config` 类型修正为真实 `RankingChartConfig` / `ProportionChartConfig`；
  - 区分事件命名：React 为 `onPointClick`（且含 `className`/`style`/`ref`），Vue 为 `point-click`。
- 不修改已冻结的旧包历史产物。

## 确定性 ID 规则评估器实现要点

- `evaluateIdMatching` 直接复用 `@company/contracts` 的 `validateMatchPlan`；
- 严格隔离 `real` 与 `synthetic`，总体 `passed` 仅以 `real.passed` 为准；
- 空集（`mappedExpectedInstances === 0`）、未通过 `validateMatchPlan`、越权/未映射误装配、错框架、目标版本/release 不符、React/Vue 跨框架事件混用（如 React 下 `point-click` 或 Vue 下 `onPointClick`）及多实例缺失任一实例均判定失败；
- 不预设任何业务 ID 命名规则。

## 工具链与未运行声明（待 C 链接/复跑）

- 经检查，当前隔离 worktree 根目录尚未链接或安装 `.tools`（`Test-Path .tools` 为 `False`）与 `node_modules`（`Test-Path node_modules` 为 `False`），按协作约束未绕过 `.\scripts\pnpm.ps1` 或擅自触发网络下载安装，因此以下测试命令**尚未在本 worktree 实际运行**：
  - `.\scripts\pnpm.ps1 exec vitest run tests/unit/component-api.test.ts tests/evaluation/id-matching.test.ts`
  - `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`
  - `.\scripts\pnpm.ps1 verify:workspace`
- 已将上述待运行验证命令及阻塞状态如实记录，待 C 准备工具链并在宿主复跑确认 RED/GREEN 结果。
