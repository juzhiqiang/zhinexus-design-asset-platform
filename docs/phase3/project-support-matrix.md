# 三期 T15 项目识别矩阵与双框架 SDK 审计（P2）

本文档记录 A（Antigravity）建立的 T15 独立合成项目矩阵（`synthetic`）及 14 个双框架 SDK 实现的独立审计结果，供 B（P1）、D（P3）与 C（P4）验收复用。所有预期均由包声明、真实工具生成锁与 SDK 源码类型独立推导，不导入 B 的检查器计算预期，也不代表两个真实业务试点已验收。

## 1. 真实锁生成工具与格式实测

- **npm**：`.tools/node-v26.13.0-win-x64/node.exe .tools/node-v26.13.0-win-x64/node_modules/npm/bin/npm-cli.js`（实测版本 `11.20.0`），在隔离临时目录执行 `install --package-lock-only --ignore-scripts`，生成 `package-lock.json`（`lockfileVersion: 3`）。
- **pnpm**：`scripts/pnpm.ps1`（实测版本 `12.18.0`），在隔离临时目录执行 `install --lockfile-only --ignore-scripts`，生成 `pnpm-lock.yaml`（`lockfileVersion: '9.0'`）。
  - **实测发现**：当 `package.json` 声明 `"packageManager": "pnpm@12.18.0"` 时，`pnpm 12.18.0` 会生成包含多份 YAML 文档（`---` 分隔）的 `pnpm-lock.yaml`：首段为 `packageManagerDependencies`，项目 `importers` 与依赖位于后续文档。解析器必须支持多文档 YAML（如 `yaml` 的 `parseAllDocuments`），不能假设单文档根下即含所有依赖。

## 2. 14 个合成项目案例清单（`origin: 'synthetic'`）

由 `tests/fixtures/phase3-projects/cases.ts` 导出 `projectCases` 与 `createProjectCase(caseId, tempRoot)`，矩阵校验规则位于 `tests/fixtures/phase3-projects/expected.ts`：

| `caseId` | `framework` | `packageManager` | `lockType` | `workspace` | `expected.status` | `expectedConflictCodes` | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `npm-vue-single` | `vue` | `npm` | `npm-v3` | `.` | `inspected` | `[]` | npm 单包 Vue 3.5.45 + ECharts 6.1.0 |
| `npm-react-single` | `react` | `npm` | `npm-v3` | `.` | `inspected` | `[]` | npm 单包 React 19.3.1 + React DOM 19.3.1 + ECharts 6.1.0 |
| `pnpm-vue-single` | `vue` | `pnpm` | `pnpm-v9` | `.` | `inspected` | `[]` | pnpm 单包 Vue 3.5.45 + ECharts 6.1.0 |
| `pnpm-react-single` | `react` | `pnpm` | `pnpm-v9` | `.` | `inspected` | `[]` | pnpm 单包 React 19.3.1 + React DOM 19.3.1 + ECharts 6.1.0 |
| `npm-workspace-explicit` | `vue` | `npm` | `npm-v3` | `packages/app-vue` | `inspected` | `[]` | npm 显式 workspace 子包 |
| `pnpm-workspace-explicit` | `react` | `pnpm` | `pnpm-v9` | `apps/chart-react` | `inspected` | `[]` | pnpm 显式 workspace 子包（含 `pnpm-workspace.yaml`） |
| `spaces-chinese-dirty` | `vue` | `pnpm` | `pnpm-v9` | `业务 应用/前端 client` | `inspected` | `[]` | 空格与中文路径 workspace + 无关 Git 脏文件 `notes/草稿.txt` |
| `conflict-multiple-locks` | `vue` | `pnpm` | `multiple` | `.` | `conflicted` | `["LOCKFILE_MULTIPLE"]` | `package-lock.json` 与 `pnpm-lock.yaml` 并存 |
| `conflict-missing-lock` | `vue` | `npm` | `none` | `.` | `conflicted` | `["LOCKFILE_MISSING"]` | 缺少锁文件 |
| `conflict-missing-react-dom` | `react` | `npm` | `npm-v3` | `.` | `conflicted` | `["REACT_DOM_MISSING"]` | React 19 缺少 `react-dom` |
| `conflict-missing-importer` | `react` | `pnpm` | `pnpm-v9` | `apps/missing-pkg` | `conflicted` | `["IMPORTER_MISSING"]` | 指定 `--workspace` 在锁中无 importer |
| `conflict-framework-ambiguous` | — | `pnpm` | `pnpm-v9` | `.` | `conflicted` | `["FRAMEWORK_AMBIGUOUS"]` | 同时声明 `vue` 与 `react` |
| `conflict-missing-echarts` | `vue` | `npm` | `npm-v3` | `.` | `inspected` | `[]` | 保留历史 `caseId` 与锁快照目录名；按 spec 第 5 条与 P0 契约，缺 `echarts` 时本地 `inspect` 保持 `inspected`（`resolvedDependencies` 仅含 `vue@3.5.45`，不伪造 `echarts`），待 `plan` 阶段采用 MatchPlan 候选版本重新查询 |
| `conflict-workspace-required` | — | `pnpm` | `pnpm-v9` | — | `conflicted` | `["WORKSPACE_REQUIRED"]` | Monorepo 未指定 `--workspace` |

同时完整保留 P0 冻结的 `tests/fixtures/integration-plan.ts#workspacePatternCases`（12 项 glob 正反边界用例）。

## 3. 双框架 14 实现独立审计与 T16 生成器差异清单

复用 `tests/fixtures/component-query-sdk.ts` 的 `expectedSdkComponents` 并核对 `packages/charts-core`（`0.0.11`）、`packages/charts-vue`（`0.0.12`）、`packages/charts-react`（`0.0.12`）源码与 `package.json`：

- **非统一版本**：`@company/charts-core` 为 `0.0.11`，`@company/charts-vue` 与 `@company/charts-react` 为 `0.0.12`，T15/T16 计划与依赖修改必须按包独立读取，严禁写成统一 SDK 版本。
- **导出名差异**：`ranking` 导出 `Ranking`（`./ranking`）、`proportion` 导出 `Proportion`（`./proportion`）、`trend-card` 导出 `TrendCard`（`./trend-card`），其余 4 类为 `LineChart` / `BarChart` / `PieChart` / `ScatterChart`。
- **事件与 Props 差异（T16 生成器必须保留）**：
  - Vue：模板事件 `@point-click`（`Emits` 声明 `'point-click': [event: ChartEvent]`），属性使用 kebab-case `:option-overrides`，命令式就绪句柄 `whenRendered()`。
  - React：回调属性 `onPointClick`（`Props` 声明 `onPointClick?: (event: ChartEvent) => void`），额外支持 `className`、`style`、`ref?: Ref<*Handle | null>`，同样提供 `whenRendered()`。
- **样式与宿主容器**：双框架均须导入 `<packageName>/style.css`（`./style.css`），宿主容器需具备非零宽高；Vue peer 为 `vue@3.5.45` + `echarts@6.1.0`，React peer 为 `react@19.3.1` + `react-dom@19.3.1` + `echarts@6.1.0`。
- **SDK 缺陷审计结论**：本次审计未发现双框架 14 实现的导出、事件或样式契约缺陷；若 T16 实测生成用例发现新缺陷，将另报 C 划定修复文件。
