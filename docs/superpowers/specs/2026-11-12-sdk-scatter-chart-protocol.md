# T09 第三批：双框架散点图公共接口对齐说明

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-scatter`。任务定义见 [实现计划 T09](../plans/2026-11-11-component-platform-implementation.md)；柱状图基线见 [T09 第一批对齐件](2026-11-12-sdk-bar-chart-protocol.md)，饼图基线见 [T09 第二批对齐件](2026-11-12-sdk-pie-chart-protocol.md)，验证证据见 [T09 第三批验证记录](../verification/t09-scatter.md)。

本文是 T09 第三批（散点图）的接口对齐件，供 C（contracts / 根工具链）与 B（CLI / 消费者）评审。T09 后续批次（trend-card / ranking / proportion）按同一模式扩展，不改变本文已冻结的形状，也不改变前两批已冻结的折线、柱状与饼图形状。

## 1. 范围与前置

- 输入：T02 `@company/charts-core` 0.0.3、T03 双框架折线图、T09 第一批双框架柱状图（0.0.2）、T09 第二批双框架饼图 / 环形图（0.0.3，`ChartType` 联合已显式判别，`buildChartOption` 已按类型分发）。
- 本批交付：`@company/charts-core` 散点图 option 与图表类型联合扩展（0.0.4）、`@company/charts-vue` / `@company/charts-react` 的 `ScatterChart` 与 `./scatter` 子路径、双框架散点图示例（共享 `examples/fixtures/scatter.json`）、消费者 `./scatter` 验收、示例就绪协议的重复状态幂等修复。
- 不在本批：trend-card / ranking / proportion、`symbolSize` 等散点专属配置、ECharts 升级矩阵（T10）。

## 2. charts-core：图表类型联合扩展

| 类型 | 形状 |
| --- | --- |
| `ChartType` | `'line' \| 'bar' \| 'pie' \| 'scatter'` |
| `ScatterChartConfig` | `ChartConfig & { chart: 'scatter'; xAxisName?: string; yAxisName?: string }` |
| `ScatterChartOption` | `ComposeOption<ScatterSeriesOption \| ChartComponentOption>` |
| `AnyChartConfig` | `LineChartConfig \| BarChartConfig \| PieChartConfig \| ScatterChartConfig`（`createChartController` 入口） |

- `chart` 在 `ScatterChartConfig` 中为必填判别字段，与柱状图、饼图一致：框架组件在缺省配置时注入 `{ chart: 'scatter' }`，调用方显式传配置时必须带该字段。
- `chart` 在 `LineChartConfig` 中仍可选，T02/T03 既有调用方行为不变。
- 新增导出：`buildScatterOption`；`buildLineOption` / `buildBarOption` / `buildPieOption` / `createChartController` / `ChartData` / `ChartEvent` / `SupportedOptionOverrides` 等既有导出的语义不变。
- 内部新增 `src/charts/scatter.ts`；`src/charts/index.ts` 的 `chartTypeOf` / `buildChartOption` 增加 `'scatter'` 分支；`src/engine/modules.ts` 的 `ensureChartModules('scatter', renderer)` 注册 `ScatterChart` + `Grid` + `Tooltip` + `Legend` + `Title` + 指定渲染器（散点图是双数值轴图表，坐标轴组件全部需要）。

### 2.1 散点图 option 语义

- **数据复用 `ChartData`**：`points[].x` 为数值轴坐标，`points[].y` 为数值；系列数据项为 `[x, y]` 数值对（与折线 / 柱状的「类目 + 数值」显式区分）。
- **x 必须为数值**：散点图 x 轴为数值轴，字符串 x 没有坐标语义，`buildScatterOption` 对任一非数值 x 抛 `ChartDataError`（`path` 指向出错点）。共享规范化（重复 id、NaN y 等）规则不变。
- **缺失值**（`null`）原样保留为 `[x, null]`，ECharts 不渲染该符号；不补 0、不参与任何聚合（实测 zrender 中该符号不产生 path 元素）。
- **负值透传**：x / y 负值原样进入数据项，由数值轴自行渲染零轴以下区域；option 层不裁剪、不取绝对值（与折线 / 柱状一致，与饼图的负值拒绝显式区分）。
- **空数据**：`series: []` → 空系列、无图例、JSON 不含 `NaN`，不抛错。
- **单位口径**：`unit` 只作用于 y 轴与 tooltip 的 y（与折线 / 柱状「unit 描述被度量数值」的口径一致）；x 轴标签与 tooltip 的 x 按 `formatValue(value)` 无单位格式化（千分位分组、0 位小数）。
- **tooltip**：`trigger: 'item'`，`formatter` 输出 `名称: (x, y)`；y 缺失时输出 `名称: (x, -)`。
- **图例**：多系列（`series.length > 1`）才渲染，单系列与空数据不渲染。
- **坐标轴**：`xAxis.type='value'`、`yAxis.type='value'`，均显式设置 `axisLabel.formatter` 保证截图可复现；y 轴带分割线，x 轴不带；不设置 `boundaryGap`（散点图没有类目带，与柱状图的 `boundaryGap: true` 显式区分）。
- **emphasis**：`focus: 'series'`，与折线 / 柱状一致。
- **optionOverrides**：散点图合并全部坐标轴类字段 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title`；系列、主题与渲染器仍不可覆盖。

### 2.2 控制器与事件语义

- 控制器按运行期联合分发：`chartTypeOf({chart:'scatter'})` → `'scatter'`；`update` 仍按稳定 series id 以 `replaceMerge: ['series']` 合并，删减系列不残留；主题 / 渲染器变化仍销毁重建，数据保留；零宽高 / 隐藏容器等待 `ResizeObserver`；`dispose` 幂等。以上与既有图表共用同一实现，无散点专属分支。
- **点击载荷扩展**（本批对 `ChartEvent` 的唯一语义变化）：散点图数据项为 `[x, y]` 数值对，ECharts 点击参数 `params.value` 即该数组，控制器将其原样放入 `ChartEvent.value`（`value: [x, y]`，x / y 均为数值，y 缺失时为 `null`）。折线 / 柱状 / 饼图的 `[名称, 值]` 载荷形状与行为不变（控制器按 `params.value` 是否为数组显式分路，实测 `params.name` 对散点为 `''`，因此数值对路径不依赖 name）。
- 图表类型在单个组件实例生命周期内固定，`config.chart` 不用于运行时切换。

## 3. 框架包导出面

| 入口 | 内容 |
| --- | --- |
| `.` | `LineChart`、`BarChart`、`PieChart`、`ScatterChart`、`useChart`、`sameLineConfig` / `sameBarConfig` / `samePieConfig` / `sameScatterConfig` / `sameChartConfig`、组件与 hook 类型、自 core 重新导出的共享类型（含 `ScatterChartConfig`） |
| `./scatter` | 仅散点图入口（组件 + hook + 类型），供按需加载 |
| `./style.css` | 容器基础样式（`.charts-line` / `.charts-bar` / `.charts-pie` / `.charts-scatter`） |

- 两包仍不重新导出 `createChartController` / `buildScatterOption`。
- 组件属性与折线 / 柱状 / 饼图对等：`data` / `config` / `optionOverrides`；Vue `@point-click` 与 React `onPointClick` 共用 `ChartEvent`；React 另保留 `className` / `style` / `ref`。容器类名固定为 `charts-scatter`。
- `useChart` 的 `chart` 参数接受 `'scatter'`；`CHART_CONFIG_FIELDS.scatter = ['xAxisName', 'yAxisName']`，`defaultConfig('scatter') = { chart: 'scatter' }`；折线、柱状与饼图字段不变。
- 新增 `sameScatterConfig`，与 `sameLineConfig` / `sameBarConfig` / `samePieConfig` 同构。

## 4. 示例与消费者

- 共享 fixture：`examples/fixtures/scatter.json`，状态 `default` / `empty` / `missing` / `negative` / `single` / `updated`，每状态带 `expectedSeriesIds`；两框架示例读取同一文件，数据与点击载荷完全一致。
- 示例页：`examples/vue/scatter.html`（`src/scatter-main.ts` + `src/ScatterApp.vue`）与 `examples/react/scatter.html`（`src/scatter-main.tsx` + `src/ScatterApp.tsx`）；示例固定 `{ chart: 'scatter', theme: 'light', renderer: 'canvas', animation: false }`，不带 unit。
- 就绪协议不变（`ready` / `states` / `runState` / `getChecks`，自检 `single-instance` / `no-page-error` / `series-match` / `renderer-match`），另有一项协议修复：**`runState` 重复应用当前已激活状态时幂等返回**（状态→数据映射确定，重复应用不产生新快照；修复前会等待永不出现的变化而超时——CLI 截图流程总是先 `runState('default')`，驱动示例页必现）。该修复同时作用于折线 / 柱状 / 饼图示例页，与饼图实心批次的就绪协议改动（系列快照含 radius）叠加后浏览器矩阵 71 项全过，确认无回归。
- 测试钩子增强（两框架 `src/example/runtime.ts` 同步修改，服务测试也服务消费者）：
  - `seriesData()` 兼容 `[x, y]` 数值对（取 y，缺失仍为 `null`）；
  - `pointClientPosition(seriesIndex, dataIndex)` 泛化：数据项为数组时 x 取数据项自身坐标（散点图双数值轴），否则按类目轴取 x（折线 / 柱状），无坐标轴时回退扇形几何中心（饼图）——页面代码无需按图表类型分叉。
- 消费者模板新增散点图页面（`tests/consumers/{vue,react}/scatter.html` 与对应入口），`tests/integration/packed-consumer-frameworks.test.ts` 覆盖 `./scatter` 的 Node 导入、多页构建、真实渲染与点击载荷（`{seriesId:'revenue', dataIndex:0, value:[1,120], nativeType:'click'}`）。
- `vite.config.ts`（两示例 + 两消费者 + `charts-vue` 库入口）显式登记 `scatter` 入口。

## 5. 需要 C / B 配合

### 5.1 候选包（0.0.4，`feat/t09-scatter` 分支）

候选 tarball 由 `pnpm pack` 冻结（Linux 复现环境，Node `26.13.0` / pnpm `12.18.0`），摘要如下，供 B 的材料生成接入与核对；**B 应在自己的工作树重新冻结并以新摘要贯穿自己的链路**（同一份 tarball 的 SHA-256 必须贯穿安装、截图、报告与上传）：

| 包 | 版本 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `@company/charts-core` | 0.0.4 | 25,159 | `e1227694c30c74478bb4f18c5d6e773e91d1f49c968f2163cb9dce284e3122b6` |
| `@company/charts-vue` | 0.0.4 | 5,173 | `ae0b42cd74b682387d93f0278aa53a9bb8f8666936c06d6b46f25dd7d2b1bc74` |
| `@company/charts-react` | 0.0.4 | 9,313 | `a568e79efa3bb36227bf5811b472e6e195f1de23d802193440efc8a6cb84f50f` |

0.0.3 → 0.0.4 为兼容变更（0.x 阶段按规则升 PATCH），无新增依赖、锁文件不变（`workspace:*` 协议）。

### 5.2 B：CLI 发布材料生成实现清单

当前 `packages/component-cli/src/local/manifest.ts` 的 `ComponentName = 'line' | 'bar'`，Bundle 入口只生成 line / bar 材料；SDK 0.0.3 起已有 `./pie`、本批再增 `./scatter`，**平台 API 的逐导出覆盖检查会拒绝未覆盖全部导出的 Bundle**（该拒绝行为已由 T05 实测记录，不得放宽）。需要 B 至少完成以下改动：

1. `manifest.ts`：
   - `ComponentName` 扩展为 `'line' | 'bar' | 'pie' | 'scatter'`；`components` 缺省值建议改为四者全量（与 API 的逐导出覆盖要求对齐）。
   - 入口文件名映射：`component === 'line' ? 'index.html' : \`${component}.html\``（bar / pie / scatter 均已有消费者页面，由 A 交付）。
   - `exportName` 映射补 `'PieChart'` / `'ScatterChart'`（可统一为按 componentId 首字母大写的映射表）。
   - docs 文案映射补「饼图 / 环形图」与「散点图」。
   - fixture 读取路径 `examples/fixtures/${component}.json` 已泛化，无需改动；`pie.json` 与 `scatter.json` 均已存在。
2. `capture.ts`（可选增强）：容器尺寸探测的选择器链当前为 `.charts-line` / `.charts-bar` / `.charts-pie` / `.chart-frame` / `#chart` / `#app`，散点页经 `.chart-frame` 已可探测；建议补 `.charts-scatter` 使探测更直接。
3. B 侧测试同步：`tests/unit/release-bundle.test.ts`、`tests/integration/cli-bundle.test.ts` 中硬编码的组件清单需覆盖 pie / scatter。
4. 状态名：若 Bundle 需要覆盖示例页多于 `default` 的状态，`ExampleRef.requiredStates` 与 manifest 状态定义需补充散点状态名（`negative` / `single`）与饼图状态名（`zero-total` / `nested`）；当前 fixtures 未被 manifest 引用，不影响默认流程。
5. 就绪协议驱动示例页时依赖本批的 `runState` 幂等修复（见第 4 节）；驱动消费者页面不依赖（消费者页 `runState` 为无操作）。

### 5.3 C：contracts

- 无 schema 变化：`ComponentExample` / `CheckResult` / `ChartEvent`（payload 结构未变，仅散点取值口径为 `[x, y]`）/ `ExampleRef` / `ScreenshotRef` 形状均未变。
- 若 `ExampleRef.requiredStates` 需要覆盖 pie / scatter 示例状态，按各自 fixture 的状态集合补充（pie：`zero-total` / `nested`；scatter：`negative` / `single`）。

## 6. 已知边界与后续

- 散点图暂不提供 `symbolSize` / `symbol` / `itemStyle` 等系列级配置（系列不可通过 `optionOverrides` 覆盖）；需要时以兼容方式新增配置字段（升 PATCH / MINOR 按规则评估）。
- x 轴标签固定 0 位小数、无单位；小数 x 的轴标签会取整展示，需要小数刻度时通过 `optionOverrides.xAxis.axisLabel` 自定义。
- 数值轴的 `min` / `max` / `scale` 未做成配置字段，当前经 `optionOverrides.xAxis` / `yAxis` 合并设置。
- trend-card / ranking / proportion 按同一模式扩展：core 增加场景入口与模块注册、框架包增加组件与子路径、fixtures 与示例同步、消费者与矩阵测试补充。
- 折线与柱状图的模块注册未包含 `Title` / `Legend`（折线）/ `Title`（柱状）组件，而其 `optionOverrides` 白名单允许对应键——这是 T02/T09 第一批的既有边界，本批未改动以免影响既有产物体积基线；建议由 C / B 在 T09 收口时统一评估补齐（补齐后需重跑消费者体积护栏）。散点图本批即按「白名单 = 已注册组件」实现（含 `Title`）。
