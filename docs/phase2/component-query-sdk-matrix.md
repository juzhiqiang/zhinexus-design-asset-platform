# 二期双框架真实 SDK 预期矩阵（P2）

本文档记录 A（Antigravity）对 `packages/charts-core`、`packages/charts-vue`、`packages/charts-react` 源码类型及已冻结 bundle 的独立审计结果，作为 P3（D）与 P4（C）验收 `GET /v1/matching/components` 响应的基准矩阵。所有导出名、子路径、样式、就绪方法与事件名均从源码类型独立确定，不依赖服务端响应反推。

## 1. 冻结包版本与 SHA-256（禁止统一 SDK 版本）

当前冻结 bundle 路径：`D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`

| 包名 | 版本 | Tarball 路径 | Tarball SHA-256 | 字节数 |
| --- | --- | --- | --- | --- |
| `@company/charts-core` | `0.0.11` | `packages/company-charts-core-0.0.11.tgz` | `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb` | `54607` |
| `@company/charts-vue` | `0.0.12` | `packages/company-charts-vue-0.0.12.tgz` | `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9` | `6683` |
| `@company/charts-react` | `0.0.12` | `packages/company-charts-react-0.0.12.tgz` | `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28` | `12221` |

> **约束**：`@company/charts-core` 为 `0.0.11`，而 `@company/charts-vue` 与 `@company/charts-react` 为 `0.0.12`，查询与验收时必须按具体包从冻结 `manifest.json` 读取 `packageVersion` 与 `tarball.sha256`，严禁混用或写成统一 SDK 版本。

## 2. 14 项独立预期矩阵（7 类 × Vue / React）

由 `tests/fixtures/component-query-sdk.ts` 导出 `expectedSdkComponents`（共 14 项）：

| `componentId` | `framework` | `packageName` | `exportName` | `exportPath` | `styleExport` | `readyMethod` | `eventNames` | 必填 Props |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `line` | `vue` | `@company/charts-vue` | `LineChart` | `./line` | `./style.css` | `whenRendered` | `["point-click"]` | `data` |
| `line` | `react` | `@company/charts-react` | `LineChart` | `./line` | `./style.css` | `whenRendered` | `["onPointClick"]` | `data` |
| `bar` | `vue` | `@company/charts-vue` | `BarChart` | `./bar` | `./style.css` | `whenRendered` | `["point-click"]` | `data` |
| `bar` | `react` | `@company/charts-react` | `BarChart` | `./bar` | `./style.css` | `whenRendered` | `["onPointClick"]` | `data` |
| `pie` | `vue` | `@company/charts-vue` | `PieChart` | `./pie` | `./style.css` | `whenRendered` | `["point-click"]` | `data` |
| `pie` | `react` | `@company/charts-react` | `PieChart` | `./pie` | `./style.css` | `whenRendered` | `["onPointClick"]` | `data` |
| `scatter` | `vue` | `@company/charts-vue` | `ScatterChart` | `./scatter` | `./style.css` | `whenRendered` | `["point-click"]` | `data` |
| `scatter` | `react` | `@company/charts-react` | `ScatterChart` | `./scatter` | `./style.css` | `whenRendered` | `["onPointClick"]` | `data` |
| `trend-card` | `vue` | `@company/charts-vue` | `TrendCard` | `./trend-card` | `./style.css` | `whenRendered` | `["point-click"]` | `data` |
| `trend-card` | `react` | `@company/charts-react` | `TrendCard` | `./trend-card` | `./style.css` | `whenRendered` | `["onPointClick"]` | `data` |
| `ranking` | `vue` | `@company/charts-vue` | `Ranking` | `./ranking` | `./style.css` | `whenRendered` | `["point-click"]` | `data` |
| `ranking` | `react` | `@company/charts-react` | `Ranking` | `./ranking` | `./style.css` | `whenRendered` | `["onPointClick"]` | `data` |
| `proportion` | `vue` | `@company/charts-vue` | `Proportion` | `./proportion` | `./style.css` | `whenRendered` | `["point-click"]` | `data` |
| `proportion` | `react` | `@company/charts-react` | `Proportion` | `./proportion` | `./style.css` | `whenRendered` | `["onPointClick"]` | `data` |

## 3. 审计重点说明

- **Ranking 与 Proportion 导出名**：虽然源文件分别为 `RankingChart.vue` / `RankingChart.tsx` 与 `ProportionChart.vue` / `ProportionChart.tsx`，但 `index.ts` 与子路径入口（`ranking.ts` / `proportion.ts`）实际导出的公开符号为 `Ranking` 与 `Proportion`，而非 `RankingChart` / `ProportionChart`。
- **双框架事件差异**：Vue 实现统一在 `*Emits` 中声明 `'point-click': [event: ChartEvent]`；React 实现统一在 `*Props` 中声明 `onPointClick?: (event: ChartEvent) => void`。
- **公共辅助函数**：`tests/fixtures/component-query-sdk.ts` 提供 `expectedSdkComponents`、`validateExpectedSdkMatrix`、`validatePackageVersionConsistency`、`readFrozenBundleManifest` 与 `verifyFrozenBundleFiles` 供 P4 集成验收直接复用。其中 `verifyFrozenBundleFiles` 以 `manifest.files`（199 项）为权威清单逐项校验存在性、字节数与 SHA-256，并交叉核对 `manifest.reports`（14 份报告）、`packages` 与 `variants` 引用一致性。
- **环境解耦**：默认 `tests/evaluation/component-query-sdk.test.ts` 不硬编码本地路径，完全自包含运行；真实冻结 bundle 校验通过显式传入 `A10_FROZEN_BUNDLE` 触发。
