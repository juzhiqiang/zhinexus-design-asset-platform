# T09 第一批：双框架柱状图公共接口对齐说明

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-bar`。任务定义见 [实现计划 T09](../plans/2026-11-11-component-platform-implementation.md)；折线图基线见 [T03 对齐件](2026-11-12-sdk-framework-example-protocol.md)。

本文是 T09 第一批（柱状图）的接口对齐件，供 C（contracts / 根工具链）与 B（CLI / 消费者）评审。T09 后续批次（pie / scatter / 场景组件）按同一模式扩展，不改变本文已冻结的形状。

## 1. 范围与前置

- 输入：T02 `@company/charts-core` 0.0.1 与 T03 双框架折线图组件（`LineChart`、`./line`、就绪协议）。
- 本批交付：`@company/charts-core` 柱状图 option 与图表类型联合、`@company/charts-vue` / `@company/charts-react` 的 `BarChart` 与 `./bar` 子路径、双框架柱状图示例（共享 `examples/fixtures/bar.json`）、消费者 `./bar` 验收。
- 不在本批：pie / scatter / trend-card / ranking / proportion（T09 后续批次）、manifest 与截图（T04）、ECharts 升级矩阵（T10）。

## 2. charts-core：图表类型联合

T02 控制器为折线专用，T03 对齐件第 6 节约定「T09 增加其他图表时把 config 泛化为图表类型联合」。本批按显式判别联合实现，不使用任意对象：

| 类型 | 形状 |
| --- | --- |
| `ChartType` | `'line' \| 'bar'` |
| `LineChartConfig` | `ChartConfig & { chart?: 'line'; smooth?; area?; connectNulls?; xAxisName?; yAxisName? }` |
| `BarChartConfig` | `ChartConfig & { chart: 'bar'; stack?; xAxisName?; yAxisName? }` |
| `AnyChartConfig` | `LineChartConfig \| BarChartConfig`（`createChartController` 入口） |
| `BarChartOption` | `ComposeOption<BarSeriesOption \| ChartComponentOption>` |

- `chart` 在 `BarChartConfig` 中为必填判别字段：框架组件在缺省配置时注入 `{ chart: 'bar' }`，调用方显式传配置时必须带该字段，避免把柱状图误判为折线。
- `chart` 在 `LineChartConfig` 中可选：T02/T03 既有调用方（`createChartController(host, {})`、`buildLineOption(data, {})`）行为不变。
- 新增导出：`buildBarOption`；`createChartController` / `buildLineOption` / `ChartData` / `ChartEvent` / `SupportedOptionOverrides` 等既有导出的语义不变。
- 内部新增 `src/charts/index.ts`（`chartTypeOf` / `buildChartOption` 分发）与 `src/charts/option-overrides.ts`（折线与柱状共用同一套受支持覆盖合并规则），均不从包入口导出；`ensureLineModules` 改为 `ensureChartModules(chart, renderer)`（非公开 API）。
- 控制器按运行期联合构建 option 与按需注册模块；主题 / 渲染器变化仍销毁重建，数据保留；`replaceMerge` 按稳定 series id 合并的规则不变。

### 2.1 柱状图 option 语义

- 类目轴 + 数值轴：`xAxis.type='category'`、`boundaryGap=true`（柱条不贴边；折线图为 `false`，两者不得互相污染）；`yAxis.type='value'`。
- 缺失值（`null`）原样保留为 ECharts 缺失语义，不补 0；对齐后该类目无数据仍为 `null`。
- 负值原样进入系列数据，由数值轴渲染零轴以下区域；option 层不裁剪、不取绝对值。
- 单位格式化与折线图同一规则（`formatValue`），tooltip 与坐标轴一致；缺失值展示 `-`。
- `stack` 透传到系列；缺省为分组柱状。多系列才渲染图例，单系列与空数据不渲染。
- `optionOverrides` 仅深层合并 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title`；系列、主题与渲染器不可覆盖（与 T02 一致）。
- 空数据：`series: []`、类目轴为空、无 NaN、无图例，不抛错。

## 3. 框架包导出面

| 入口 | 内容 |
| --- | --- |
| `.` | `LineChart`、`BarChart`、`useChart`、`sameLineConfig` / `sameBarConfig` / `sameChartConfig`、组件与 hook 类型、自 core 重新导出的共享类型（含 `BarChartConfig` / `LineChartConfig` / `AnyChartConfig` / `ChartType`） |
| `./line` | 仅折线图入口（组件 + hook + 类型），供按需加载 |
| `./bar` | 仅柱状图入口（组件 + hook + 类型），供按需加载 |
| `./style.css` | 容器基础样式（`.charts-line` 与 `.charts-bar`） |

- 两包仍不重新导出 `createChartController` / `buildLineOption` / `buildBarOption`（高级用法直接依赖 `@company/charts-core`）。
- 组件属性与折线图对等：`data` / `config` / `optionOverrides`；Vue `@point-click` 与 React `onPointClick` 共用 `ChartEvent`；React 另保留 `className` / `style` / `ref`。容器类名固定为 `charts-bar`。
- `useChart` 泛化为接收 `chart: ChartType`，折线与柱状走同一生命周期实现（挂载创建、卸载销毁、StrictMode / KeepAlive 适配、主题渲染器重建），保证两图表语义一致。

## 4. 示例与消费者

- 共享 fixture：`examples/fixtures/bar.json`，状态 `default` / `empty` / `missing` / `negative` / `single` / `updated`，每状态带 `expectedSeriesIds`；两框架示例读取同一文件，数据与点击载荷完全一致。
- 示例页：`examples/vue/bar.html`（`src/bar-main.ts` + `src/BarApp.vue`）与 `examples/react/bar.html`（`src/bar-main.tsx` + `src/BarApp.tsx`）；折线图页面与路由不变。
- 就绪协议不变（`ready` / `states` / `runState` / `getChecks`，自检 `single-instance` / `no-page-error` / `series-match` / `renderer-match`）。
- 测试钩子在 T03 形状上新增 `seriesData(): (number|null)[][]`（断言缺失值保持 `null`、负值不被裁剪），并为运行时 / 钩子新增可选 `hostSelector`（缺省 `.charts-line`），使同一页面可区分多个图表宿主。
- 消费者模板新增柱状图页面（`tests/consumers/{vue,react}/bar.html` 与对应入口），`tests/integration/packed-consumer-frameworks.test.ts` 覆盖 `./bar` 的 Node 导入、多页构建、真实渲染与点击载荷。

## 5. 需要 C / B 配合

1. 无新增依赖、无锁文件变化（柱状图复用既有 ECharts 按需模块）。
2. `packages/contracts` 的 `ExampleRef.requiredStates` 若需覆盖柱状图示例状态，按本文第 4 节的状态集合补充；当前 fixtures 未引用柱状图状态。
3. B 的 CLI 截图流程以 `ready` → `runState(state)` → `getChecks()` 驱动，柱状图示例状态名与折线图一致（`empty` / `missing` 等），可直接复用既有 manifest 状态定义。

## 6. 已知边界与后续

- 柱状图暂不提供 `orientation`（横向柱状）与 `barWidth` / `borderRadius` 专属配置；需要时通过 `optionOverrides` 或后续批次以兼容方式新增（升 PATCH / MINOR 按规则评估）。
- 图表类型在单个组件实例生命周期内固定；切换图表类型应改用对应组件（`LineChart` / `BarChart`），`config.chart` 不用于运行时切换。
- 饼图 / 散点 / 场景组件按同一模式扩展：core 增加图表入口与模块注册、框架包增加组件与子路径、fixtures 与示例同步、消费者与矩阵测试补充。
