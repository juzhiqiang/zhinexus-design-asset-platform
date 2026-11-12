# T09 图表组件与材料交接清单（line / bar / pie / scatter）

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-trend`（基线 main `3bbf687`，已含 T09 第一批至第三批）。本文是 T09 前四类图表（折线、柱状、饼图 / 环形、散点）的**交接清单**，供 B（CLI / 画廊 / 消费者）与 C（contracts / 平台）核对组件、状态与材料是否齐全；同时记录 B 侧 `component-cli` 的已知材料生成缺口。

趋势卡片（trend-card，T09 第四批）属「组合场景」，单独见 [T09 第四批对齐件](../superpowers/specs/2026-11-12-sdk-trend-card-protocol.md) 与 [验证记录](t09-trend-card.md)；本文聚焦前四类**基础图表**，文末给出趋势卡片与后续批次的对应关系。

## 1. 逻辑组件与实现矩阵

| 逻辑 componentId | Vue 实现 | React 实现 | 包版本（当前） | 状态 |
| --- | --- | --- | --- | --- |
| `line` | `LineChart.vue` | `LineChart.tsx` | 0.0.5 | T02 / T03 已合入 |
| `bar` | `BarChart.vue` | `BarChart.tsx` | 0.0.5 | T09 第一批已合入 |
| `pie` | `PieChart.vue` | `PieChart.tsx` | 0.0.5 | T09 第二批已合入（含实心覆盖） |
| `scatter` | `ScatterChart.vue` | `ScatterChart.tsx` | 0.0.5 | T09 第三批已合入 |
| `trend-card` | `TrendCard.vue` | `TrendCard.tsx` | 0.0.5 | T09 第四批（本分支） |

四类基础图表共 8 个框架实现，加趋势卡片共 10 个；`light` / `dark` × `canvas` / `svg` 为声明支持矩阵（`ChartConfig.theme` / `renderer`）。每个实现都提供 `data` / `config` / `optionOverrides` 属性与 `point-click`（Vue）/ `onPointClick`（React）事件，React 另保留 `className` / `style` / `ref`。

## 2. 包导出面与子路径

三个公开包（`@company/charts-core` / `@company/charts-vue` / `@company/charts-react`）当前 0.0.5：

| 入口 | charts-core | charts-vue / charts-react |
| --- | --- | --- |
| `.` | `buildLineOption` / `buildBarOption` / `buildPieOption` / `buildScatterOption` / `buildTrendCardOption` / `computeTrendSummary` / `pieTotal` / `createChartController` / 共享类型 | `LineChart` / `BarChart` / `PieChart` / `ScatterChart` / `TrendCard` / `useChart` / `same*Config` / 组件类型 / 自 core 重新导出的共享类型 |
| `./line` | — | 仅折线图（组件 + hook + 类型） |
| `./bar` | — | 仅柱状图 |
| `./pie` | — | 仅饼图 / 环形图 |
| `./scatter` | — | 仅散点图 |
| `./trend-card` | — | 仅趋势卡片 |
| `./style.css` | — | `.charts-line` / `.charts-bar` / `.charts-pie` / `.charts-scatter` / `.charts-trend-card` 容器基础样式 |

- 两框架包均**不**重新导出 `createChartController` 与 `build*Option`（core 入口专用）。
- `charts-vue` 的 vite 库入口（`build.lib.entry`）已登记 `index` / `line` / `bar` / `pie` / `scatter` / `trend-card`；`charts-react` 由 `tsc` 直接产出对应 `dist/*.js`。

## 3. charts-core 契约（供 contracts / 平台核对）

- `ChartType = 'line' | 'bar' | 'pie' | 'scatter' | 'trend-card'`；`chartTypeOf` / `buildChartOption` 按该联合分发。
- 配置联合 `AnyChartConfig = LineChartConfig | BarChartConfig | PieChartConfig | ScatterChartConfig | TrendCardConfig`（`createChartController` 入口）。柱状 / 饼图 / 散点 / 趋势卡片的 `chart` 为**必填判别字段**；折线图 `chart?: 'line'` 保持可选以兼容 T02/T03 既有调用方。
- 共享数据协议 `ChartData = { series: { id, name, points: { x, y }[] }[] }`；`normalizeChartData` 校验（重复 id、非法 x/y 抛 `ChartDataError`，`null` 保留为缺失、禁止写成 0）。
- 事件载荷 `ChartEvent = { seriesId, dataIndex, value, nativeType }`：折线 / 柱状 / 饼图 / 趋势卡片为 `[名称, 值]`，散点图为 `[x, y]` 数值对（控制器按 `params.value` 是否数组分路）。
- `optionOverrides` 白名单：折线 / 柱状 / 散点 / 趋势卡片为 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title`；饼图为 `tooltip` / `legend` / `title`（无坐标轴）。系列、主题、渲染器不可覆盖。

## 4. 各图表语义速查

| 图表 | 坐标轴 | 数据项形状 | 缺失值 | 负值 | 图例 | 空数据 |
| --- | --- | --- | --- | --- | --- | --- |
| 折线 | 类目 + 数值，`boundaryGap:false` | 数值 | `null`（不连线可配） | 透传，零轴以下 | 单系列不渲染 | 空系列、无 NaN |
| 柱状 | 类目 + 数值，`boundaryGap:true` | 数值（`stack` 可堆叠） | `null` 不渲染柱条 | 透传，零轴以下 | 多系列才渲染 | 空系列、无 NaN |
| 饼图 / 环形 | 无坐标轴 | `{ name, value }` | `null` 不渲染扇形、不进分母 | 抛 `ChartDataError` | 多系列（环）才渲染 | 空系列、无 NaN |
| 散点 | 双数值轴，无 `boundaryGap` | `[x, y]` 数值对（x 必须为数值） | `[x, null]` 不渲染符号 | 透传，零轴以下 | 多系列才渲染 | 空系列、无 NaN |
| 趋势卡片 | 类目 + 数值，均 `show:false` | 数值（sparkline） | `null` 不参与取末 | 透传 | 多系列才渲染 | 「暂无数据」、无 NaN |

## 5. fixtures 与示例状态（`examples/fixtures/*.json`）

两框架示例读取**同一份** fixture，数据与点击载荷完全一致，截图才能等价。

| fixture | 状态集合 | `expectedSeriesIds` 覆盖 |
| --- | --- | --- |
| `line.json` | `default` / `empty` / `missing` / `updated`（以既有为准） | 每状态自带 |
| `bar.json` | `default` / `empty` / `missing` / `negative` / `single` / `updated` | 每状态自带 |
| `pie.json` | `default` / `empty` / `missing` / `zero-total` / `nested` / `updated` + `solid` / `solid-empty` / `solid-missing` / `solid-zero-total` / `solid-nested` | 每状态自带 |
| `scatter.json` | `default` / `empty` / `missing` / `negative` / `single` / `updated` | 每状态自带 |
| `trend-card.json` | `default` / `empty` / `missing` / `single` / `updated` / `down`；`previousValue` 固定 160 | 每状态自带 |

示例页（两框架各一份，端口 5174 / 5175）：`line.html`、`bar.html`、`pie.html`、`scatter.html`、`trend-card.html`，入口分别为 `src/{line,bar,pie,scatter,trend-card}-main.{ts,tsx}` 与 `src/{Line,Bar,Pie,Scatter,TrendCard}App.{vue,tsx}`。示例统一实现就绪协议（`ready` / `states` / `runState` / `getChecks`，自检 `single-instance` / `no-page-error` / `series-match` / `renderer-match`），`runState` 重复应用当前状态幂等返回。

## 6. 测试覆盖与当前计数

| 层 | 文件 | 趋势卡片前 | 当前（含趋势卡片） |
| --- | --- | --- | --- |
| 单元 | `tests/unit/chart-semantics.test.ts` | 46 passed | 68 passed（趋势卡片 21） |
| 单元 | `tests/unit/chart-data.test.ts` | 12 passed | 12 passed |
| 浏览器 | `tests/browser/component-matrix.spec.ts` | 71 passed | 86 passed（趋势卡片 15） |
| 浏览器 | `core-lifecycle` + `framework-lifecycle` | 8 passed | 8 passed |
| 集成 | `tests/integration/packed-consumer-frameworks.test.ts` | 9 passed | 9 passed（趋势卡片在既有 9 项内扩展覆盖，未新增用例数） |
| 全量 | `pnpm test` | 491 passed | 512 passed，4 skipped |
| 全量 | `pnpm test:browser` | 71 passed | 86 passed |

消费者模板（`tests/consumers/{vue,react}`，非 workspace 成员）：`index.html`（line）+ `bar.html` + `pie.html` + `scatter.html` + `trend-card.html`，各配 `src/*App.{vue,tsx}` 与 `src/*-main.{ts,tsx}`；`vite.config.ts` 的 `rollupOptions.input` 显式登记全部五个入口。

## 7. B 侧材料生成缺口（已在合并 main 时补齐）

**状态更新（2026-11-12 合并 main 后）**：本节原记录 `ComponentName` 只有 `'line' | 'bar'`。合并 `feat/t09-trend` 时实测发现，main 的 T04 已把 `ComponentName` 扩展到 `'line' | 'bar' | 'pie' | 'scatter'`，但 SDK 0.0.5 又新增 `./trend-card` 子路径，**平台 API 的逐导出覆盖检查随即拒绝 Bundle**（`ARTIFACT_MISMATCH: npm runtime component subpath has no declared implementation`），`cli-bundle` 集成测试转红。该缺口已由提交 `70138d2` 按 RED→GREEN 补齐，下面是补齐内容与仍然成立的注意事项。

平台 API 的逐导出覆盖检查会拒绝未覆盖全部导出的 Bundle（该拒绝行为已由 T05 实测记录，**不得放宽**）。规则见 `apps/api/src/uploads/validator.ts`：运行时包 exports 中每个解析为 JavaScript 的子路径（不含聚合根 `.` 与纯 CSS / JSON 目标）都必须有 `variant.exportPath` 与之对应。

已补齐（提交 `70138d2`，A 侧代 B 完成，B 可复核）：

1. `manifest.ts`：`ComponentName` 扩展为 `'line' | 'bar' | 'pie' | 'scatter' | 'trend-card'`；`components` 缺省值改为全量五项（与 API 的逐导出覆盖要求对齐）。
2. 入口文件名映射：改为查表 `COMPONENT_ENTRY_HTML`（`line` → `index.html`，其余 → `<component>.html`）。
3. `exportName` / docs 文案映射：改为查表 `COMPONENT_EXPORT`，补 `TrendCard` 与「趋势卡片」。
4. `capture.ts` 容器尺寸探测选择器链补 `.charts-trend-card`（散点与趋势卡片页经 `.chart-frame` 本就可探测，此步让探测更直接）。
5. B 侧测试同步：`tests/integration/cli-bundle.test.ts` 被测组件扩展到 5 × 2 = 10 变体，并新增**回归护栏**——遍历 `charts-vue` / `charts-react` exports 中每个 JS 子路径，断言都有对应变体；已用临时注入 `./ranking` 子路径的方式验证护栏会以明确信息失败。`tests/integration/cli-release.test.ts` 与 `tests/platform/http-support.ts` 的组件清单同步到 trend-card（`requireComponents` 按 `variant.componentId` 逐项校验发布权限，`grant` 必须 seed 该组件行）。

仍然成立的注意事项：

6. 状态名：若 Bundle 需要覆盖示例页多于 `default` 的状态，`ExampleRef.requiredStates` 与 manifest 状态定义需补充各图表状态名（pie：`zero-total` / `nested`；scatter：`negative` / `single`；trend-card：`missing` / `single` / `down`）；当前 fixtures 未被 manifest 引用，不影响默认流程。
7. 就绪协议驱动示例页时依赖散点批次的 `runState` 幂等修复（已在 main）；驱动消费者页面不依赖（消费者页 `runState` 为无操作）。
8. **新增图表时的固定动作**：SDK 加一个子路径导出，就必须同批扩展 `COMPONENT_ENTRY_HTML`、`COMPONENT_EXPORT`、默认 `components`，以及 `cli-bundle` / `cli-release` / `http-support` 三处清单，否则平台会以 `ARTIFACT_MISMATCH` 拒绝 Bundle。`cli-bundle` 的回归护栏会在漏扩展时给出明确失败信息。

## 8. C 侧 contracts

- 无 schema 变化：`ComponentExample` / `CheckResult` / `ChartEvent` / `ExampleRef` / `ScreenshotRef` 形状均未变（散点仅取值口径为 `[x, y]`，结构不变）。
- 若 `ExampleRef.requiredStates` 需要覆盖各示例状态，按第 5 节 fixture 的状态集合补充。

## 9. 原生复验与后续批次

- Windows 原生复验清单：[柱状图](t09-bar-windows-native.md)、[散点图](t09-scatter-windows-native.md)、[趋势卡片](t09-trend-card-windows-native.md)。均由 A 侧整理为可执行清单与回填模板，需用户在 Windows 开发机执行后回填；A 侧不声称 Windows 原生验证已通过。
- 后续批次：`ranking`（需明确排序方向与并列处理）与 `proportion`（总量为零显示「暂无数据」、不输出 NaN，且不在组件内猜业务指标口径）按同一模式扩展：core 增加场景入口与模块注册、框架包增加组件与子路径、fixtures 与示例同步、消费者与矩阵测试补充。
- 已知遗留：`README.md` 的 SDK 段落自 G0 / T02 起已过期，建议由 C 在 T09 收口时统一刷新。

---

## 10. T09 第五批补充：ranking 与 proportion（2026-11-13）

> 本节是 2026-11-13 的批次补充，不改写上文各节的历史记录。上文表格中的「当前」计数以趋势卡片批次为准，本批之后的最新状态见本节与 [T09 第五批验证记录](t09-ranking-proportion.md)。

本批补齐 T09 计划中最后两个组合场景，7 个逻辑组件、14 个框架实现全部齐套：

| 逻辑 componentId | Vue 实现 | React 实现 | 包版本 | 状态 |
| --- | --- | --- | --- | --- |
| `line` / `bar` / `pie` / `scatter` / `trend-card` | 见上文第 1 节 | 见上文第 1 节 | 0.0.6 | 已合入 main |
| `ranking` | `RankingChart.vue` | `RankingChart.tsx` | 0.0.6 | T09 第五批 |
| `proportion` | `ProportionChart.vue` | `ProportionChart.tsx` | 0.0.6 | T09 第五批 |

- 组件文件名是 `RankingChart.*` / `ProportionChart.*` 而不是 `Ranking.*` / `Proportion.*`：入口文件 `ranking.ts` / `proportion.ts` 与 `Ranking.tsx` 的产物名在大小写不敏感文件系统（Windows NTFS）上会碰撞，TypeScript 直接报 `TS5056`。导出名仍为 `Ranking` / `Proportion`，与 componentId 一致。
- 两个场景都是**单系列横向条形 + graphic 数值摘要**：`ensureChartModules` 注册 `BarChart` + 网格 / 提示 / `Graphic`（单系列不注册图例）。
- 排序方向与并列规则、占比口径、单系列与名称唯一性守卫、graphic 槽位纪律，见 [T09 第五批对齐件](../superpowers/specs/2026-11-13-sdk-ranking-proportion-protocol.md)。
- fixtures：`ranking.json`（`default` / `empty` / `missing` / `single` / `updated` / `tied`，`limit` 固定 5）、`proportion.json`（`default` / `empty` / `zero-total` / `missing` / `single` / `updated`）。示例页与消费者页各新增 `ranking.html` / `proportion.html`，vite `rollupOptions.input` 登记全部七个入口。
- 计数更新：单元 `chart-semantics.test.ts` 68 → 105 passed；浏览器 `component-matrix.spec.ts` 86 → 117 passed（全量 `test:browser`）；`packed-consumer-frameworks.test.ts` 仍为 9 项但覆盖扩展到 7 组件 14 实现；`cli-bundle` 覆盖 10 → 14 变体。
- **写 fixture 的新约束**：占比的 `zero-total` 与 `empty` 渲染结果完全相同（都无系列、都显示「暂无数据」），系列快照不变化会让示例就绪探针 `arm()` 超时，这两个状态必须各自从 `default` 单独进入。
- Windows 原生复验清单：[排行榜与占比](t09-ranking-proportion-windows-native.md)。
- B 侧材料缺口已由 A 侧代 B 同批补齐（`manifest.ts` 两张查表与默认 `components`、`capture.ts` 选择器、三处测试清单），B 可复核；这是 T09 第二批以来第三次因新增子路径而需要同步扩展 `component-cli`。
- 已知遗留（仍未处理）：`README.md` 的 SDK 段落自 G0 / T02 起已过期，建议由 C 在 T09 收口时统一刷新。
