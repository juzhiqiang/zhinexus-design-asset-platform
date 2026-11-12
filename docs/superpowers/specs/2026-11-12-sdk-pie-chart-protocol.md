# T09 第二批：双框架饼图 / 环形图公共接口对齐说明

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-pie`。任务定义见 [实现计划 T09](../plans/2026-11-11-component-platform-implementation.md)；柱状图基线见 [T09 第一批对齐件](2026-11-12-sdk-bar-chart-protocol.md) 与 [柱状图验证记录](../verification/t09-bar.md)。

本文是 T09 第二批（饼图 / 环形图）的接口对齐件，供 C（contracts / 根工具链）与 B（CLI / 消费者）评审。T09 后续批次（scatter / trend-card / ranking / proportion）按同一模式扩展，不改变本文已冻结的形状，也不改变第一批已冻结的折线与柱状形状。

## 1. 范围与前置

- 输入：T02 `@company/charts-core` 0.0.2、T03 双框架折线图、T09 第一批双框架柱状图（`ChartType` 联合已显式判别，`buildChartOption` 已按类型分发）。
- 本批交付：`@company/charts-core` 饼图 option 与图表类型联合扩展、`@company/charts-vue` / `@company/charts-react` 的 `PieChart` 与 `./pie` 子路径、双框架饼图示例（共享 `examples/fixtures/pie.json`）、消费者 `./pie` 验收。
- 不在本批：scatter / trend-card / ranking / proportion、ECharts 升级矩阵（T10）。柱状图的横向柱状、柱宽与圆角配置同样不在本批。

## 2. charts-core：图表类型联合扩展

| 类型 | 形状 |
| --- | --- |
| `ChartType` | `'line' \| 'bar' \| 'pie'` |
| `PieChartConfig` | `ChartConfig & { chart: 'pie'; donut?: boolean }` |
| `PieChartOption` | `ComposeOption<PieSeriesOption \| ChartComponentOption>` |
| `AnyChartConfig` | `LineChartConfig \| BarChartConfig \| PieChartConfig`（`createChartController` 入口） |

- `chart` 在 `PieChartConfig` 中为必填判别字段，与柱状图一致：框架组件在缺省配置时注入 `{ chart: 'pie' }`，调用方显式传配置时必须带该字段。
- `chart` 在 `LineChartConfig` 中仍可选，T02/T03 既有调用方行为不变。
- 新增导出：`buildPieOption`；`buildLineOption` / `buildBarOption` / `createChartController` / `ChartData` / `ChartEvent` / `SupportedOptionOverrides` 等既有导出的语义不变。
- 内部新增 `src/charts/pie.ts`；`src/charts/index.ts` 的 `chartTypeOf` / `buildChartOption` 增加 `'pie'` 分支；`src/engine/modules.ts` 的 `ensureChartModules('pie', renderer)` 注册 `PieChart` + `Tooltip` + `Legend` + `Title` + 指定渲染器（饼图无坐标轴，不注册 `Grid` 与轴组件）。
- `src/format.ts` 新增 `formatPercent(value, total)`：总量不可算（`total <= 0`）或值缺失时返回 `null`，由调用方省略占比，禁止产出 `NaN`。

### 2.1 饼图 option 语义

- **数据复用 `ChartData`**：`series[].points[].x` 为扇形名称，`points[].y` 为数值。一个 `ChartSeries` 对应一圈（一环），多系列为**同心嵌套环**，外环在前（`series[0]` 最外）。
- **缺失值**（`null`）原样保留为 `value: null`，ECharts 不渲染该扇形；不补 0、不参与占比分母。
- **负值拒绝**：饼图角度没有负值语义，`buildPieOption` 对任一负值抛出 `ChartDataError`（`path` 指向出错点），与折线 / 柱状图的负值透传规则显式区分。
- **空数据**：`series: []` → 空系列、无图例、JSON 不含 `NaN`，不抛错。
- **半径**：外半径固定 `70%`；`n` 个系列时每环带宽 `70%/n`。`donut: true` 时从内侧预留 `35%`（外半径的 50%）作为内孔，其余规则不变——**donut 只改变内半径语义**，不影响数据、角度顺序、图例规则与占比口径。`donut` 缺省为 `false`（实心饼图）。
- **图例**：多系列（`series.length > 1`）才渲染，单系列与空数据不渲染；单系列靠扇形标签说明。
- **占比格式化**：`total` 为全部系列非缺失值之和。`total > 0` 时 tooltip 与标签展示 `值（xx.x%）`（占比固定 1 位小数）；`total <= 0`（全零或全缺失）时只展示值，不展示占比，不产出 `NaN`。
- **tooltip**：`trigger: 'item'`，`formatter` 输出 `名称: 值（占比）`。
- **标签**：`label.formatter` 输出 `名称\n值（占比）`；颜色取自主题文本色。
- **emphasis**：不显式设置，使用 ECharts 饼图默认的扇形外扩交互（与折线 / 柱状的 `focus: 'series'` 显式区分）。
- **optionOverrides**：饼图只深层合并 `tooltip` / `legend` / `title`；`grid` / `xAxis` / `yAxis` 对饼图无意义，合并不生效（显式规则，便于测试断言）。系列、主题与渲染器仍不可覆盖。

### 2.2 控制器与生命周期

- 控制器按运行期联合分发：`chartTypeOf({chart:'pie'})` → `'pie'`；`update` 仍按稳定 series id 以 `replaceMerge: ['series']` 合并，删减系列不残留。
- 主题 / 渲染器变化仍销毁重建，数据保留；零宽高 / 隐藏容器等待 `ResizeObserver`；`dispose` 幂等。以上与折线 / 柱状共用同一实现，无饼图专属分支。
- 图表类型在单个组件实例生命周期内固定，`config.chart` 不用于运行时切换。

## 3. 框架包导出面

| 入口 | 内容 |
| --- | --- |
| `.` | `LineChart`、`BarChart`、`PieChart`、`useChart`、`sameLineConfig` / `sameBarConfig` / `samePieConfig` / `sameChartConfig`、组件与 hook 类型、自 core 重新导出的共享类型（含 `PieChartConfig`） |
| `./pie` | 仅饼图入口（组件 + hook + 类型），供按需加载 |
| `./style.css` | 容器基础样式（`.charts-line` / `.charts-bar` / `.charts-pie`） |

- 两包仍不重新导出 `createChartController` / `buildLineOption` / `buildBarOption` / `buildPieOption`。
- 组件属性与折线 / 柱状对等：`data` / `config` / `optionOverrides`；Vue `@point-click` 与 React `onPointClick` 共用 `ChartEvent`；React 另保留 `className` / `style` / `ref`。容器类名固定为 `charts-pie`。
- `useChart` 的 `chart` 参数接受 `'pie'`；`CHART_CONFIG_FIELDS.pie = ['donut']`，`defaultConfig('pie') = { chart: 'pie' }`；折线与柱状字段不变。
- 新增 `samePieConfig(a, b)`，与 `sameLineConfig` / `sameBarConfig` 同构。

## 4. 示例与消费者

- 共享 fixture：`examples/fixtures/pie.json`，状态 `default` / `empty` / `missing` / `zero-total` / `nested` / `updated`，每状态带 `expectedSeriesIds`；两框架示例读取同一文件，数据与点击载荷完全一致。
- 示例页：`examples/vue/pie.html`（`src/pie-main.ts` + `src/PieApp.vue`）与 `examples/react/pie.html`（`src/pie-main.tsx` + `src/PieApp.tsx`）；示例固定使用 `donut: true`（环形图），实心饼图半径规则由单元测试断言。
- 就绪协议不变（`ready` / `states` / `runState` / `getChecks`，自检 `single-instance` / `no-page-error` / `series-match` / `renderer-match`）。
- 测试钩子增强（两框架 `src/example/runtime.ts` 同步修改，服务测试也服务消费者）：
  - `seriesData()` 兼容饼图数据项（`{name, value}` 取 `value`），缺失仍为 `null`；
  - `pointClientPosition(seriesIndex, dataIndex)` 泛化：有坐标轴时走 `convertToPixel`（折线 / 柱状），无坐标轴时回退到扇形几何中心（饼图 / 环形图），页面代码无需按图表类型分叉。
- 消费者模板新增饼图页面（`tests/consumers/{vue,react}/pie.html` 与对应入口），`tests/integration/packed-consumer-frameworks.test.ts` 覆盖 `./pie` 的 Node 导入、多页构建、真实渲染与点击载荷。
- `vite.config.ts`（两示例 + 两消费者 + `charts-vue` 库入口）显式登记 `pie` 入口。

## 5. 需要 C / B 配合

1. 无新增依赖、无锁文件变化（饼图复用既有 ECharts 按需模块）。
2. `packages/contracts` 的 `ExampleRef.requiredStates` 若需覆盖饼图示例状态，按本文第 4 节的状态集合补充；当前 fixtures 未引用饼图状态。
3. B 的 CLI 截图流程以 `ready` → `runState(state)` → `getChecks()` 驱动；饼图状态名与折线 / 柱状图一致（`empty` / `missing` 等），只有 `zero-total` 与 `nested` 是饼图新增状态名，manifest 状态定义如需覆盖饼图示例须补充这两个名字。

## 6. 已知边界与后续

- 饼图暂不提供 `roseType`（南丁格尔玫瑰）、`minAngle`、自定义内半径与环形间距配置；需要时通过 `optionOverrides` 或后续批次以兼容方式新增（升 PATCH / MINOR 按规则评估）。
- 饼图不接受负值（见 2.1）；若后续要展示盈亏构成等含负值场景，应在 core 增加显式的正值化或正负分栏语义，不得静默取绝对值。
- 散点 / 场景组件按同一模式扩展：core 增加图表入口与模块注册、框架包增加组件与子路径、fixtures 与示例同步、`component-matrix` 与消费者验收补充。
- `pointClientPosition` 的扇形几何回退依赖 zrender 显示列表（`type === 'sector'` 的 `shape.cx/cy/r0/r/startAngle/endAngle`）与系列顺序，属测试钩子内部实现，不进契约；若 ECharts 升级后该结构变化，T10 兼容矩阵会暴露。
