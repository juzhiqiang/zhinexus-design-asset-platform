# 二期组件档案审计（Component Profiles）

审计日期：2026-11-15  
审计基线：`fa24ab525e5945e7096ed816a83f11962ba5f000`（分支 `feat/a-phase2-profiles`）  
职责边界：本档案为只读源码审计产物，服务于二期 T13（档案检索与兼容过滤）与 T14（设计稿匹配与装配方案）；不修改一期公共契约、SDK 源码或历史验证记录。

---

## 1. 审计范围与事实基线

本次审计覆盖工作区现有 SDK 源码、双框架示例与契约定义：

- 公共契约：`packages/contracts/src/{release-manifest,examples,reports,api}.ts`
- 图表核心：`packages/charts-core/package.json`、`packages/charts-core/src/**`
- Vue 3 适配层：`packages/charts-vue/package.json`、`packages/charts-vue/src/**`
- React 19 适配层：`packages/charts-react/package.json`、`packages/charts-react/src/**`
- 双框架示例与夹具：`examples/fixtures/*.json`、`examples/vue/**`、`examples/react/**`

### 当前包版本与 Peer 精确依赖基线

| 包名 | 当前源码版本 | Private | Peer 精确依赖 | 证据路径 |
| --- | --- | --- | --- | --- |
| `@company/charts-core` | `0.0.10` | `false` | `echarts: 6.1.0` | `packages/charts-core/package.json` |
| `@company/charts-vue` | `0.0.10` | `false` | `vue: 3.5.45`, `echarts: 6.1.0` | `packages/charts-vue/package.json` |
| `@company/charts-react` | `0.0.10` | `false` | `react: 19.3.1`, `react-dom: 19.3.1`, `echarts: 6.1.0` | `packages/charts-react/package.json` |

> [!NOTE]
> **版本与验证边界说明**：仓库中 `docs/verification/c-sdk14-acceptance-2026-11-13.md` 记录的是历史 `0.0.6` 版本的 14 实现验收，仅作为平台目录结构与预览检查命名参考，**不得作为当前 `0.0.10` 源码的新验证依据**。当前 `0.0.10` 在本隔离工作区中不存在预生成的独立 `api.json` / `docs.md` 产物或冻结 tarball，相关线上 `variantReleaseId` 与冻结摘要在本档案中均标记为 `unknown`。

---

## 2. 共享底座与通用约定

### 2.1 通用数据协议（`ChartData`）

所有 7 个组件共用 `@company/charts-core` 的 `ChartData` 结构（`packages/charts-core/src/types.ts`、`packages/charts-core/src/data.ts`）：

- `ChartData = { series: ChartSeries[] }`
- `ChartSeries = { id: string; name: string; points: ChartPoint[] }`
  - `id` 必须是非空字符串且在同一 `ChartData` 内唯一；更新时按 `id` 执行 `replaceMerge`，删除的系列不会残留。
  - `name` 必须是字符串。
- `ChartPoint = { x: string | number; y: number | null }`
  - `y === null` 表示**缺失值**，核心层严禁将其转换为 `0`；格式化输出统一为 `MISSING_VALUE_DISPLAY`（`'-'`，`packages/charts-core/src/format.ts`）。
  - `y` 若为 `NaN` 或非 `number | null`，`normalizeChartData` 会抛出 `ChartDataError`。

### 2.2 通用基础配置（`ChartConfig`）

所有组件配置均继承 `ChartConfig`（`packages/charts-core/src/types.ts`）：

| 字段 | 类型 | 默认值 / 行为 | 说明 |
| --- | --- | --- | --- |
| `theme` | `'light' \| 'dark'` | `'light'` | 内置明/暗主题令牌，背景保持透明由宿主页面决定（`packages/charts-core/src/theme.ts`） |
| `renderer` | `'canvas' \| 'svg'` | `'canvas'` | 切换 `theme` 或 `renderer` 会通过 `setPresentation` 销毁并重建实例，保留数据 |
| `unit` | `{ suffix?: string; decimals?: number }` | `decimals = 0`, `suffix = undefined` | 确定性千分位分组格式化，不依赖运行 locale（`packages/charts-core/src/format.ts`） |
| `width` | `number \| undefined` | 跟随宿主容器 | 固定像素宽度；缺省时依赖容器尺寸与 `ResizeObserver` |
| `height` | `number \| undefined` | 跟随宿主容器 | 固定像素高度；缺省时依赖容器尺寸与 `ResizeObserver` |
| `animation` | `boolean \| undefined` | `true`（ECharts 默认） | 截图与自动化测试建议传 `false` |

### 2.3 受支持的 Option 覆盖（`SupportedOptionOverrides`）

- 允许字段：`grid`、`tooltip`、`legend`、`xAxis`、`yAxis`、`title`（`packages/charts-core/src/types.ts`、`packages/charts-core/src/charts/option-overrides.ts`）。
- **硬限制**：`series`、`theme`、`renderer` 及场景组件内部 `graphic` 摘要槽位**不可**通过 `optionOverrides` 覆盖。
- 饼图 `pie` 进一步收窄白名单为 `['tooltip', 'legend', 'title']`，`grid` / `xAxis` / `yAxis` 会被忽略。

### 2.4 双框架统一 Props / 事件 / 句柄与样式边界

- **Vue 3（`@company/charts-vue`）**：
  - Props：`data: ChartData`（必填）、`config?: <SpecificConfig>`、`optionOverrides?: SupportedOptionOverrides`
  - Emits：`@point-click`（载荷 `ChartEvent`）
  - Expose 句柄：`whenRendered(): Promise<void>`
  - 生命周期：内置 `onActivated` 适配 `KeepAlive`、`onBeforeUnmount` 幂等 `dispose`（`packages/charts-vue/src/useChart.ts`）。
- **React 19（`@company/charts-react`）**：
  - Props：`data: ChartData`（必填）、`config?: <SpecificConfig>`、`optionOverrides?: SupportedOptionOverrides`、`onPointClick?: (event: ChartEvent) => void`、`className?: string`、`style?: CSSProperties`、`ref?: Ref<<SpecificHandle> | null>`
  - Ref 句柄：`whenRendered(): Promise<void>`
  - 生命周期：适配 React 19 `StrictMode` 双挂载清理，且支持原生 `ref` prop（无需 `forwardRef`）。
- **事件载荷（`ChartEvent`）**：`{ seriesId: string; dataIndex: number; value: [string | number, number | null]; nativeType: string }`，仅当点击 `componentType === 'series'` 时触发（`packages/charts-core/src/controller.ts`）。
- **样式引入**：需显式导入 `@company/charts-vue/style.css` 或 `@company/charts-react/style.css`（`width: 100%; height: 100%`），且**宿主容器必须提供明确非零宽高**（或传入 `config.width` / `config.height`）；零宽高容器会等待 `ResizeObserver` 而不创建 ECharts 实例。
- **SSR 边界**：`@company/charts-core/src/engine/adapter.ts` 的 `assertClient` 保证模块可被 SSR 宿主安全导入，但**不提供服务端图表渲染**，实例仅在客户端挂载后创建。

---

## 3. 组件档案清单（7 个逻辑组件 × 14 个框架实现）

### 3.1 `line`（折线图）

- **逻辑组件 ID**：`line`（基础图表）
- **双框架实现**：

| 框架 | `variantId` | 包名与导出路径 | 真实导出名 | 容器类名 | 源码证据 |
| --- | --- | --- | --- | --- | --- |
| `vue` | `line-vue` | `@company/charts-vue`（`.` / `./line`） | `LineChart`（类型：`LineChartProps`, `LineChartEmits`, `LineChartHandle`） | `.charts-line` | `packages/charts-vue/src/{index,line,LineChart.vue,line-chart.types}.ts` |
| `react` | `line-react` | `@company/charts-react`（`.` / `./line`） | `LineChart`（类型：`LineChartProps`, `LineChartHandle`） | `.charts-line` | `packages/charts-react/src/{index,line,LineChart.tsx,line-chart.types}.ts` |

- **专属配置（`LineChartConfig`）**：
  - `chart?: 'line'`（可省略，缺省即视为 `'line'`）
  - `smooth?: boolean`（默认 `false`）
  - `area?: boolean`（默认 `false`，为 `true` 时启用 `areaStyle: {}`）
  - `connectNulls?: boolean`（默认 `false`，缺失值断线）
  - `xAxisName?: string`、`yAxisName?: string`
- **事件与句柄**：Vue `@point-click` / React `onPointClick`（`ChartEvent`）；`whenRendered()`。
- **按需注册模块**：`LineChart` + `GridComponent`, `TooltipComponent` + `CanvasRenderer | SVGRenderer`（注意：默认未注册 `LegendComponent`，`packages/charts-core/src/engine/modules.ts`）。
- **适用场景**：时间序列或有序类目趋势对比、多系列指标走势、面积趋势展示。
- **已知限制**：
  - `xAxis` 固定为类目轴（`type: 'category'`, `boundaryGap: false`），多系列按首次出现顺序对齐类目，缺省位补 `null`。
  - 默认模块列表不含 `LegendComponent`；若通过 `optionOverrides.legend` 开启图例，需注意模块注册边界。
  - 空数据（`series: []`）渲染空坐标系，不抛错。
- **示例状态与证据**：`examples/fixtures/line.json`（states: `default`, `empty`, `missing`, `negative`, `single`, `updated`）、`examples/vue/src/App.vue`、`examples/react/src/App.tsx`。
- **缺失信息（`unknown`）**：当前 `0.0.10` 冻结产物摘要、在线 `variantReleaseId`、独立 `api.json`/`docs.md` 产物路径、真实视觉特征向量均未在工作区生成，记为 `unknown`。

---

### 3.2 `bar`（柱状图）

- **逻辑组件 ID**：`bar`（基础图表）
- **双框架实现**：

| 框架 | `variantId` | 包名与导出路径 | 真实导出名 | 容器类名 | 源码证据 |
| --- | --- | --- | --- | --- | --- |
| `vue` | `bar-vue` | `@company/charts-vue`（`.` / `./bar`） | `BarChart`（类型：`BarChartProps`, `BarChartEmits`, `BarChartHandle`） | `.charts-bar` | `packages/charts-vue/src/{index,bar,BarChart.vue,bar-chart.types}.ts` |
| `react` | `bar-react` | `@company/charts-react`（`.` / `./bar`） | `BarChart`（类型：`BarChartProps`, `BarChartHandle`） | `.charts-bar` | `packages/charts-react/src/{index,bar,BarChart.tsx,bar-chart.types}.ts` |

- **专属配置（`BarChartConfig`）**：
  - `chart: 'bar'`（在 `BarChartConfig` 类型中为必填判别字段；框架组件内部若不传 `config`，默认补 `{ chart: 'bar' }`）
  - `stack?: string`（相同 `stack` 值叠加，缺省为分组柱状）
  - `xAxisName?: string`、`yAxisName?: string`
- **事件与句柄**：Vue `@point-click` / React `onPointClick`（`ChartEvent`）；`whenRendered()`。
- **按需注册模块**：`BarChart` + `GridComponent`, `TooltipComponent`, `LegendComponent` + `CanvasRenderer | SVGRenderer`。
- **适用场景**：离散类目数值对比、分组柱状对比、堆叠总量构成对比、含正负双向偏差对比。
- **已知限制**：
  - 仅支持纵向柱状（`xAxis: 'category'`, `yAxis: 'value'`, `boundaryGap: true`），不支持通过配置直接切换为横向条形（横向排名/占比请使用 `ranking` / `proportion`）。
  - 仅当 `series.length > 1` 时自动显示 `legend`。
  - 负值原样透传渲染在零轴以下；缺失值 `null` 不渲染该柱条。
- **示例状态与证据**：`examples/fixtures/bar.json`（states: `default`, `empty`, `missing`, `negative`, `single`, `updated`）、`examples/vue/src/BarApp.vue`、`examples/react/src/BarApp.tsx`。
- **缺失信息（`unknown`）**：当前 `0.0.10` 冻结产物摘要、在线 `variantReleaseId`、独立 `api.json`/`docs.md` 产物路径、真实视觉特征向量为 `unknown`。

---

### 3.3 `pie`（饼图 / 环形图）

- **逻辑组件 ID**：`pie`（基础图表）
- **双框架实现**：

| 框架 | `variantId` | 包名与导出路径 | 真实导出名 | 容器类名 | 源码证据 |
| --- | --- | --- | --- | --- | --- |
| `vue` | `pie-vue` | `@company/charts-vue`（`.` / `./pie`） | `PieChart`（类型：`PieChartProps`, `PieChartEmits`, `PieChartHandle`） | `.charts-pie` | `packages/charts-vue/src/{index,pie,PieChart.vue,pie-chart.types}.ts` |
| `react` | `pie-react` | `@company/charts-react`（`.` / `./pie`） | `PieChart`（类型：`PieChartProps`, `PieChartHandle`） | `.charts-pie` | `packages/charts-react/src/{index,pie,PieChart.tsx,pie-chart.types}.ts` |

- **专属配置（`PieChartConfig`）**：
  - `chart: 'pie'`（框架组件缺省自动补 `{ chart: 'pie' }`）
  - `donut?: boolean`（默认 `false` 实心饼图；`true` 时内半径为外半径 `70%` 的 `50%`，即内径 `35%`）
- **事件与句柄**：Vue `@point-click` / React `onPointClick`（`ChartEvent`）；`whenRendered()`。
- **按需注册模块**：`PieChart` + `TooltipComponent`, `LegendComponent`, `TitleComponent` + `CanvasRenderer | SVGRenderer`（无坐标轴组件）。
- **适用场景**：部分占整体的构成比例展示（单环）或多层同心嵌套构成对比（多系列，第 0 系列在最外环）。
- **已知限制（硬约束）**：
  - **严禁负值**：任意 `point.y < 0` 会抛出 `ChartDataError`（`packages/charts-core/src/charts/pie.ts`）。
  - `points[].x` 为扇形名称，`points[].y` 为数值；`null` 扇形不渲染且不计入分母。
  - 总量为 `0` 时不产出 `NaN%`，仅展示数值。
  - 仅当 `series.length > 1` 时渲染 `legend`。
  - `optionOverrides` 仅允许 `tooltip` / `legend` / `title`，不支持 `grid` / `xAxis` / `yAxis`。
- **示例状态与证据**：`examples/fixtures/pie.json`、`examples/vue/src/PieApp.vue`、`examples/react/src/PieApp.tsx`。
- **缺失信息（`unknown`）**：当前 `0.0.10` 冻结产物摘要、在线 `variantReleaseId`、独立 `api.json`/`docs.md` 产物路径、真实视觉特征向量为 `unknown`。

---

### 3.4 `scatter`（散点图）

- **逻辑组件 ID**：`scatter`（基础图表）
- **双框架实现**：

| 框架 | `variantId` | 包名与导出路径 | 真实导出名 | 容器类名 | 源码证据 |
| --- | --- | --- | --- | --- | --- |
| `vue` | `scatter-vue` | `@company/charts-vue`（`.` / `./scatter`） | `ScatterChart`（类型：`ScatterChartProps`, `ScatterChartEmits`, `ScatterChartHandle`） | `.charts-scatter` | `packages/charts-vue/src/{index,scatter,ScatterChart.vue,scatter-chart.types}.ts` |
| `react` | `scatter-react` | `@company/charts-react`（`.` / `./scatter`） | `ScatterChart`（类型：`ScatterChartProps`, `ScatterChartHandle`） | `.charts-scatter` | `packages/charts-react/src/{index,scatter,ScatterChart.tsx,scatter-chart.types}.ts` |

- **专属配置（`ScatterChartConfig`）**：
  - `chart: 'scatter'`（框架组件缺省自动补 `{ chart: 'scatter' }`）
  - `xAxisName?: string`、`yAxisName?: string`
- **事件与句柄**：Vue `@point-click` / React `onPointClick`（`ChartEvent`）；`whenRendered()`。
- **按需注册模块**：`ScatterChart` + `GridComponent`, `TooltipComponent`, `LegendComponent`, `TitleComponent` + `CanvasRenderer | SVGRenderer`。
- **适用场景**：二维连续数值变量相关性分析、分布聚类观察（支持正负象限）。
- **已知限制（硬约束）**：
  - **`points[].x` 必须为有效数值**（不可为字符串或 `NaN`），否则 `assertNumericAbscissa` 抛出 `ChartDataError`。
  - `config.unit` **仅作用于 `y` 轴与 tooltip 的 `y` 口径**，`x` 轴固定按无单位千分位格式化（`packages/charts-core/src/charts/scatter.ts`）。
  - 不支持通过配置开启气泡图第三维半径映射（`symbolSize` 固定默认，无 `z` 通道）。
  - 仅当 `series.length > 1` 时渲染 `legend`。
- **示例状态与证据**：`examples/fixtures/scatter.json`、`examples/vue/src/ScatterApp.vue`、`examples/react/src/ScatterApp.tsx`。
- **缺失信息（`unknown`）**：当前 `0.0.10` 冻结产物摘要、在线 `variantReleaseId`、独立 `api.json`/`docs.md` 产物路径、真实视觉特征向量为 `unknown`。

---

### 3.5 `trend-card`（趋势卡片）

- **逻辑组件 ID**：`trend-card`（组合场景组件）
- **双框架实现**：

| 框架 | `variantId` | 包名与导出路径 | 真实导出名 | 容器类名 | 源码证据 |
| --- | --- | --- | --- | --- | --- |
| `vue` | `trend-card-vue` | `@company/charts-vue`（`.` / `./trend-card`） | `TrendCard`（类型：`TrendCardProps`, `TrendCardEmits`, `TrendCardHandle`） | `.charts-trend-card` | `packages/charts-vue/src/{index,trend-card,TrendCard.vue,trend-card-chart.types}.ts` |
| `react` | `trend-card-react` | `@company/charts-react`（`.` / `./trend-card`） | `TrendCard`（类型：`TrendCardProps`, `TrendCardHandle`） | `.charts-trend-card` | `packages/charts-react/src/{index,trend-card,TrendCard.tsx,trend-card-chart.types}.ts` |

- **专属配置（`TrendCardConfig`）**：
  - `chart: 'trend-card'`（框架组件缺省自动补 `{ chart: 'trend-card' }`）
  - `title?: string`（指标标题，缺省隐藏标题槽位）
  - `previousValue?: number | null`（前期对比基线；未提供或为 `null`/`NaN` 时只展示当前值，隐藏涨跌 meta 行）
- **事件与句柄**：Vue `@point-click` / React `onPointClick`（`ChartEvent`）；`whenRendered()`。
- **按需注册模块**：`LineChart` + `GridComponent`, `TooltipComponent`, `LegendComponent`, `GraphicComponent` + `CanvasRenderer | SVGRenderer`。
- **适用场景**：KPI 指标卡 + 迷你折线趋势（sparkline）+ 周期涨跌对比摘要。
- **已知限制（硬约束）**：
  - 当前值取**第一个系列**（`series[0]`）最后一个非 `null` 的点；如果设计稿只显示一个总数值但未提供趋势序列或未提供 `previousValue`，**不得编造前期值**，必须将 `previousValue` 标为 `unknown`/缺失。
  - 坐标轴 `show: false`，顶部预留 `top: 96` 像素给 `graphic` 摘要；容器过矮会导致图表区域被压缩。
  - `graphic` 摘要槽位不可被 `optionOverrides` 覆盖；空数据时大字显示 `暂无数据`。
- **示例状态与证据**：`examples/fixtures/trend-card.json`、`examples/vue/src/TrendCardApp.vue`、`examples/react/src/TrendCardApp.tsx`。
- **缺失信息（`unknown`）**：当前 `0.0.10` 冻结产物摘要、在线 `variantReleaseId`、独立 `api.json`/`docs.md` 产物路径、真实视觉特征向量为 `unknown`。

---

### 3.6 `ranking`（排行榜）

- **逻辑组件 ID**：`ranking`（组合场景组件）
- **双框架实现**：

| 框架 | `variantId` | 包名与导出路径 | 真实导出名 | 容器类名 | 源码证据 |
| --- | --- | --- | --- | --- | --- |
| `vue` | `ranking-vue` | `@company/charts-vue`（`.` / `./ranking`） | `Ranking`（类型：`RankingProps`, `RankingEmits`, `RankingHandle`） | `.charts-ranking` | `packages/charts-vue/src/{index,ranking,RankingChart.vue,ranking-chart.types}.ts` |
| `react` | `ranking-react` | `@company/charts-react`（`.` / `./ranking`） | `Ranking`（类型：`RankingProps`, `RankingHandle`） | `.charts-ranking` | `packages/charts-react/src/{index,ranking,RankingChart.tsx,ranking-chart.types}.ts` |

> [!IMPORTANT]
> **导出名注意**：`Ranking` 的源码文件名是 `RankingChart.vue` / `RankingChart.tsx`，但包导出名均为 **`Ranking`**（而非 `RankingChart`）。三期代码生成或二期装配方案不得误写成 `RankingChart`。

- **专属配置（`RankingChartConfig`）**：
  - `chart: 'ranking'`（框架组件缺省自动补 `{ chart: 'ranking' }`）
  - `direction?: 'desc' | 'asc'`（默认 `'desc'`）
  - `limit?: number`（仅正整数生效，截断前 N 名；名次在截断前按竞赛排名 `1,2,2,4` 计算）
  - `title?: string`
- **事件与句柄**：Vue `@point-click` / React `onPointClick`（`ChartEvent`）；`whenRendered()`。
- **按需注册模块**：`BarChart` + `GridComponent`, `TooltipComponent`, `GraphicComponent` + `CanvasRenderer | SVGRenderer`（不含 `LegendComponent`）。
- **适用场景**：Top-N 榜单、条目横向对比排名、带竞赛并列排名的列表条形图。
- **已知限制（硬约束）**：
  - **仅接受单系列**（`series.length > 1` 抛 `ChartDataError`）。
  - **条目名称 `points[].x` 必须唯一**（重复名称抛 `ChartDataError`）。
  - 缺失值 `null` 不进入排行也不占名次；负值允许并渲染在零轴左侧。
  - 默认 `grid.left = 96`，长条目名称可能截断或需要调用方通过 `optionOverrides.grid` 调整。
- **示例状态与证据**：`examples/fixtures/ranking.json`、`examples/vue/src/RankingApp.vue`、`examples/react/src/RankingApp.tsx`。
- **缺失信息（`unknown`）**：当前 `0.0.10` 冻结产物摘要、在线 `variantReleaseId`、独立 `api.json`/`docs.md` 产物路径、真实视觉特征向量为 `unknown`。

---

### 3.7 `proportion`（占比）

- **逻辑组件 ID**：`proportion`（组合场景组件）
- **双框架实现**：

| 框架 | `variantId` | 包名与导出路径 | 真实导出名 | 容器类名 | 源码证据 |
| --- | --- | --- | --- | --- | --- |
| `vue` | `proportion-vue` | `@company/charts-vue`（`.` / `./proportion`） | `Proportion`（类型：`ProportionProps`, `ProportionEmits`, `ProportionHandle`） | `.charts-proportion` | `packages/charts-vue/src/{index,proportion,ProportionChart.vue,proportion-chart.types}.ts` |
| `react` | `proportion-react` | `@company/charts-react`（`.` / `./proportion`） | `Proportion`（类型：`ProportionProps`, `ProportionHandle`） | `.charts-proportion` | `packages/charts-react/src/{index,proportion,ProportionChart.tsx,proportion-chart.types}.ts` |

> [!IMPORTANT]
> **导出名注意**：`Proportion` 的源码文件名是 `ProportionChart.vue` / `ProportionChart.tsx`，但包导出名均为 **`Proportion`**（而非 `ProportionChart`）。

- **专属配置（`ProportionChartConfig`）**：
  - `chart: 'proportion'`（框架组件缺省自动补 `{ chart: 'proportion' }`）
  - `title?: string`
- **事件与句柄**：Vue `@point-click` / React `onPointClick`（`ChartEvent`）；`whenRendered()`。
- **按需注册模块**：`BarChart` + `GridComponent`, `TooltipComponent`, `GraphicComponent` + `CanvasRenderer | SVGRenderer`（不含 `LegendComponent`）。
- **适用场景**：各分类数值与占总量百分比的横向条形对照展示（不排序，严格保留输入顺序）。
- **已知限制（硬约束）**：
  - **仅接受单系列**（`series.length > 1` 抛 `ChartDataError`）。
  - **条目名称 `points[].x` 必须唯一**（重复名称抛 `ChartDataError`）。
  - **严禁负值**（`point.y < 0` 抛 `ChartDataError`）。
  - 总量为 `0`（全零或全 `null`）时整幅图显示 `暂无数据`、无系列、不产出 `NaN%`。
  - **不排序**：若设计稿明确要求按数值高低排序且展示名次，应选用 `ranking` 而非 `proportion`。
- **示例状态与证据**：`examples/fixtures/proportion.json`、`examples/vue/src/ProportionApp.vue`、`examples/react/src/ProportionApp.tsx`。
- **缺失信息（`unknown`）**：当前 `0.0.10` 冻结产物摘要、在线 `variantReleaseId`、独立 `api.json`/`docs.md` 产物路径、真实视觉特征向量为 `unknown`。

---

## 4. 供 T13 / T14 消费的档案索引摘要

1. **真实导出名映射（硬校验基线）**：
   - Vue：`LineChart`, `BarChart`, `PieChart`, `ScatterChart`, `TrendCard`, `Ranking`, `Proportion`
   - React：`LineChart`, `BarChart`, `PieChart`, `ScatterChart`, `TrendCard`, `Ranking`, `Proportion`
   - 任何设计稿匹配结果（`MatchPlanV1`）若输出上述集合之外的组件导出名或 props/event 名（如 `RankingChart`、`onClick`、`options`），在离线评估与契约校验中直接判定为**硬违规**。
2. **与核心辅助工具的关联**：
   - 底层 `@company/charts-core` 另导出 `createChartController`、`computeTrendSummary`、`computeRanking`、`computeProportionShares`、`build*Option`、`resolveCandidate`、`verifyCandidate` 等纯函数（`packages/charts-core/src/index.ts`），供高级集成与测试断言使用，不属于业务页面直接推荐的 UI 组件变体。
3. **当前未填充字段（`unknown` 清单）**：
   - 平台库表中的真实 `variantReleaseId`、已上传 `api.json` / `docs.md` 对象摘要、截图特征 embedding、真实业务项目的 `ProjectContext` 样本库，均需在一期资产真实入库及 T13/T14 实施阶段补全。
