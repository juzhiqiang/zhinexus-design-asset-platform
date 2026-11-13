# CHANGELOG

本文件记录 `@company/charts-core` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

## [0.0.10] - 2026-11-13

### Fixed

- `recommend` 与 `hasDualFrameworkCoverage` 改为**以 `supported` 为唯一事实来源**。此前二者读取报告里的 `baselineEchartsVersion` / `peerSatisfied`，而这两个字段与 `candidate.version` 同在报告内、可以被一起伪造：一份候选 `6.0.0`、`supported` 基线 `6.1.0` 的真实报告，只要把 `peerSatisfied` 与 `baselineEchartsVersion` 改成 `true` / `6.0.0`，`recommend` 就返回 `'adopt'`。现在 `recommend` 直接用 `supported` 的唯一基线推导 peer 符合性，报告只能被核对、不能作为判据，**不能改写已支持范围**。
- `hasDualFrameworkCoverage` 强制**双框架齐验**：`supported` 必须同时覆盖 Vue 与 React。此前只要求「`supported` 里每个组合都有实测」，当 `supported` 本身只有一个框架时该条件被轻易满足，共享核心变化未被双框架验证也会 `'adopt'`。

## [0.0.9] - 2026-11-13

### Fixed

- `hasDualFrameworkCoverage` 现在逐行校验**实际验证的 ECharts 版本**：每一行 `results[].echartsVersion` 必须等于 `report.candidate.version`。此前只用 `baselineEchartsVersion` 造键，于是一份全 `passed` 的报告只要把某一行（例如 `results[0]`）的 `echartsVersion` 改成 `6.0.0`，`hasDualFrameworkCoverage` 仍返回 `true`、`recommend` 仍返回 `'adopt'`。该场景已由独立复审用 tsx 复现。
- `recommend` 不再盲信报告自称的 `peerSatisfied`：除判据本身外，还要求 `peerSatisfied` 与「`candidate.version` 是否真的等于 `report.baselineEchartsVersion`」自洽。伪造 `peerSatisfied: true` 而候选与基线并不相等的报告，现在返回 `'hold'`。
- `hasDualFrameworkCoverage` 增加 `supported` 自身基线唯一性兜底：`verifyCandidate` 本就拒绝混合基线，这里对绕过它手工构造的报告再兜一层，混基线一律 `false`。

### Changed

- `CombinationResult.baselineEchartsVersion` 由必填改为**可选**。`0.0.8` 把它设为必填，那对手工构造 `CombinationResult` 的调用方是破坏性变更，却按 PATCH 发版，不符合 `AGENTS.md`「破坏性变更递增 MINOR」。改为可选后旧公开类型形状依然可构造；**缺失即 fail-closed**——`hasDualFrameworkCoverage` 返回 `false`、`recommend` 返回 `'hold'`，不会因为少一个字段就放行，也不会重新开放「报告与实测脱节」的误判。

## [0.0.8] - 2026-11-13

### Fixed

- `verifyCandidate` 现在把**候选版本**交给探针，而不是原样传基线组合。此前候选为 6.0.0、基线为 6.1.0 时，探针收到的是 6.1.0，`results[].echartsVersion` 也记 6.1.0，报告却自称验证 6.0.0——报告与实测脱节。修复后 `results[].echartsVersion` 是实际验证的候选版本，并新增 `results[].baselineEchartsVersion` 记录该组合的基线版本供对照；`report.baselineEchartsVersion` 语义不变。
- `hasDualFrameworkCoverage` 改为按**精确组合**（框架 × 框架版本 × ECharts 基线版本）一一对应判定，不再只按框架分组。此前 `supported` 含 Vue 3.5.45、Vue 3.4.0、React 19.3.1 而实测只覆盖其中两项时仍返回 `true`，`recommend` 随之返回 `'adopt'`。现在缺、额外、重复（任一侧）、框架版本写错、ECharts 基线版本对不上，任一种情况都判为不完整，`recommend` 返回 `'hold'`。
- `verifyCandidate` 显式拒绝混合 ECharts 基线。此前 `baselineEchartsVersion` 取 `supported[0]`，`supported` 为「Vue/6.1.0 + React/6.0.0」时 `peerSatisfied` 为 `true`、`recommend` 为 `'adopt'`，把数组顺序交换则变成 `'hold'`——同一份输入结论随顺序翻转。现在所有已支持组合的 ECharts 基线必须一致，否则抛错且不出报告。

### Changed

- `CombinationResult` 由 `SupportedCombination & CombinationDimensions` 改为显式类型并新增必填字段 `baselineEchartsVersion`。该类型由本包产出、不由调用方构造；`charts-core` 处于 `0.x`，按兼容变更递增 PATCH。

## [0.0.7] - 2026-11-13

### Added

- ECharts 升级候选的精确兼容策略（T10，A 侧 SDK 交付）：`engine/compatibility.ts` 新增 `resolveCandidate` / `candidateSatisfiesPeer` / `verifyCandidate` / `recommend` / `hasDualFrameworkCoverage` / `compareVersions` / `isExactVersion` / `isPrerelease` / `notRunDimensions` 与 `CandidateError`，以及 `RegistrySnapshot` / `EChartsCandidate` / `SupportedCombination` / `CombinationDimensions` / `CombinationProbe` / `CompatibilityReport` / `Recommendation` / `CompatibilityFramework` 等类型。
- 策略约束：`resolveCandidate` 对非精确版本字面量、预发布版本、官方源不存在的版本、缺 `dist.integrity` 四种情况显式拒绝，`latest` 命中预发布时不回退到上一个稳定版；`verifyCandidate` 生成的报告恒带 `supportedRangeUnchanged: true` 且不含任何「建议的新支持范围」字段，扩大支持范围只能是人的显式动作。
- `recommend` 仅在「候选满足当前 peer 精确版本 + 双框架均有实测 + 类型/运行/交互/视觉四维全部通过 + 无差异」时返回 `'adopt'`，其余一律 `'hold'`；共享核心变化缺少任何一个已支持框架的实测结果即 `'hold'`。

### Changed

- 兼容框架标识在 `charts-core` 内本地定义为 `CompatibilityFramework`（`'vue' | 'react'`），与 `@company/contracts` 的 `Framework` 同构；`charts-core` 是公开包，按架构约束不得依赖私有 `@company/contracts`，两边取值集合必须保持一致。

## [0.0.6] - 2026-11-13

### Added

- 排行榜（ranking，T09 第五批「组合场景」）：图表类型联合新增 `'ranking'`、`RankingChartConfig` / `RankingChartOption` / `RankingEntry` / `RankingDirection`，以及 `buildRankingOption` option 构建与 `computeRanking` 纯函数。
- 排行榜语义：单系列横向条形，默认按数值降序（`direction: 'asc'` 反向）；并列（数值相同）共享名次，采用竞赛排名 1,2,2,4，并列项之间保持原始输入顺序；缺失值（null）不进入排行也不占用名次；`limit` 取前 N 名且名次在截断前计算；负值原样参与排行；名次写进类目轴标签（`1. 条目`）；统计行展示条目总数，被截断时说明取前几名；空数据显示「暂无数据」、无系列、不产生 NaN。
- 占比（proportion，T09 第五批「组合场景」）：图表类型联合新增 `'proportion'`、`ProportionChartConfig` / `ProportionChartOption` / `ProportionShare`，以及 `buildProportionOption` option 构建与 `computeProportionShares` 纯函数。
- 占比语义：单系列横向条形，条目顺序保持输入顺序（占比场景不排序，需要排序时用排行榜）；占比 = 值 / 全部条目非缺失值之和，缺失值不参与分母；总量为零（全零或全缺失）时展示「暂无数据」、无系列、不产出 `NaN%`；负值没有占比语义抛 `ChartDataError`；总量行展示参与占比的合计值；不在组件内猜业务指标口径。
- 共享数据工具 `sumDefinedValues`（非缺失值之和）与单系列 / 条目名称唯一性守卫 `assertSingleSeries` / `assertUniqueNames`：多系列与同名条目在类目轴场景下没有定义，明确抛 `ChartDataError` 而不是静默丢弃或互相覆盖。

### Changed

- `createChartController` 的配置联合新增 `RankingChartConfig` 与 `ProportionChartConfig`；排行榜与占比按需注册 `BarChart` + 网格 / 提示 / `Graphic` 组件 + 指定渲染器（单系列不需要图例），不注册其他图表模块。
- `ChartType` 联合新增 `'ranking'` 与 `'proportion'`；`buildChartOption` / `chartTypeOf` 增加对应分发分支，既有图表行为不变。
- `pieTotal` 改为复用 `sumDefinedValues`，计算口径不变（缺失值不补 0、不进入分母）。
- 趋势卡片的 graphic 槽位辅助逻辑提取到 `charts/scene-slots.ts`（`textSlot` / `hiddenSlot` / `EMPTY_DISPLAY` / `mutedColor`），供排行榜与占比复用；槽位 id、`ignore` 纪律与渲染结果不变。

### Fixed

- 排行榜与占比的数值摘要同样使用固定顺序的稳定 graphic 槽位（`ranking-title` / `ranking-meta` / `ranking-empty` 与 `proportion-title` / `proportion-total` / `proportion-empty`），未使用的槽位以 `ignore: true` 隐藏、可见槽位显式 `ignore: false`，避免状态切换时残留上一次的摘要文本。

## [0.0.5] - 2026-11-12

### Added

- 趋势卡片（trend-card，T09 第一个「组合场景」）：图表类型联合新增 `'trend-card'`、`TrendCardConfig` 与 `TrendCardOption`，以及 `buildTrendCardOption` option 构建。
- `computeTrendSummary` 数值摘要纯函数：当前值取第一个系列最后一个非缺失值，前期值来自 `config.previousValue`；变化量 = 当前值 - 前期值，变化率 = 变化量 / |前期值| * 100（前期值为 0 或不可算时为 `null`），方向为 `up` / `down` / `flat` / `none`。
- 趋势卡片语义：类目轴 sparkline（每系列一条平滑折线 + 半透明面积 + 可见符号）；坐标轴 `show: false` 但坐标系仍注册；数值摘要经 `graphic` 渲染（标题 / 当前值大字段落 / meta 行含前期值与上升下降变化，`current` 为空时显示「暂无数据」）；`unit` 作用于当前值、前期值、变化量与 y 轴 / tooltip；多系列才渲染图例；空数据返回空系列、不抛错、不产生 NaN。
- `optionOverrides` 对趋势卡片深层合并 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title`（系列、主题、渲染器与 graphic 不可覆盖）。

### Changed

- `createChartController` 的配置联合新增 `TrendCardConfig`；趋势卡片按需注册 `LineChart` + 网格 / 提示 / 图例 / `Graphic` 组件 + 指定渲染器，不注册其他图表模块。
- `ChartType` 联合新增 `'trend-card'`；`buildChartOption` / `chartTypeOf` 增加对应分发分支，既有图表行为不变。

### Fixed

- 趋势卡片数值摘要改用三个稳定 graphic 槽位（`trend-title` / `trend-value` / `trend-meta`）并在每次构建时完整给出：未使用的槽位以 `ignore: true` 隐藏，可见槽位显式 `ignore: false`。修复控制器首次渲染（数据为空、槽位 `ignore: true`）后 `update` 填数据时，ECharts 按 id 合并 graphic 元素导致可见槽位保留 `ignore: true` 而不渲染，以及切到空数据时残留上一次 meta 行的问题。

## [0.0.4] - 2026-11-12

### Added

- 散点图：图表类型联合新增 `'scatter'`、`ScatterChartConfig` 与 `ScatterChartOption`，以及 `buildScatterOption` option 构建（T09 第三批）。
- 散点图语义：x / y 双数值轴，数据项为 `[x, y]` 数值对；x 必须为数值（字符串 x 抛 `ChartDataError` 且 path 指向出错点）；缺失值保持 `null` 且该符号不渲染；负值原样进入数据项并由数值轴渲染零轴以下；`unit` 只作用于 y 轴与 tooltip 口径，x 轴按无单位格式化；tooltip 以 `trigger: 'item'` 展示 `(x, y)` 数值对；多系列才渲染图例；空数据返回空系列、不抛错、不产生 NaN。
- `optionOverrides` 对散点图深层合并 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title`（系列、主题与渲染器仍不可覆盖）。

### Changed

- `createChartController` 的配置联合新增 `ScatterChartConfig`；散点图按需注册 `ScatterChart` + 网格 / 提示 / 图例 / 标题组件 + 指定渲染器，不注册其他图表模块。
- 点击事件载荷兼容 `[x, y]` 数值对（散点图）：`ChartEvent.value` 为 `[x, y]`；折线 / 柱状 / 饼图的 `[名称, 值]` 载荷形状与既有行为不变。

## [0.0.3] - 2026-11-12

### Added

- 饼图 / 环形图：图表类型联合新增 `'pie'`、`PieChartConfig` 与 `PieChartOption`，以及 `buildPieOption` option 构建（T09 第二批）。
- `pieTotal` 饼图总量计算（缺失值不补 0、不进入分母）与 `formatPercent` 占比格式化（固定 1 位小数；总量不可算或值缺失时返回 `null`，不产出 `NaN%`）。
- 饼图语义：一个系列对应一圈，多系列为同心嵌套环且外环在前；缺失值保持 `null` 且该扇形不渲染；负值没有占比语义，抛 `ChartDataError`；空数据返回空系列、无图例、不抛错；`donut` 只从内侧预留外半径 50% 的内孔；tooltip 与标签共用同一占比口径；多系列才渲染图例。
- `optionOverrides` 对饼图只深层合并 `tooltip` / `legend` / `title`（无坐标轴，`grid` / `xAxis` / `yAxis` 合并不生效）。

### Changed

- `createChartController` 的配置联合新增 `PieChartConfig`；饼图按需注册 `PieChart` + 提示 / 图例 / 标题组件，不注册坐标轴组件。

## [0.0.2] - 2026-11-12

### Added

- 图表类型联合 `ChartType` / `BarChartConfig` / `AnyChartConfig` 与 `BarChartOption`，以及 `buildBarOption` 柱状图 option 构建（T09 第一批）。
- 柱状图语义：类目轴保留边界间距（柱条不贴边）、缺失值保持 `null` 不补 0、负值原样进入系列数据并由数值轴渲染零轴以下、单位与缺失值格式化规则和折线图一致、多系列才渲染图例、`stack` 堆叠分组透传。
- `createChartController` 接受图表配置联合，按类型分发 option 构建与 ECharts 按需模块注册。

### Changed

- `LineChartConfig` 新增可选判别字段 `chart?: 'line'`；既有折线图调用方与全部既有导出行为不变。
- ECharts 模块注册入口由折线专用 `ensureLineModules` 调整为 `ensureChartModules(chart, renderer)`（内部 API，不随包入口导出）。
- 折线与柱状共用同一套受支持 `optionOverrides` 深层合并规则（系列、主题与渲染器仍不可覆盖）。

## [0.0.1] - 2026-11-11

### Added

- 共享图表数据类型 `ChartData` / `ChartSeries` / `ChartPoint` 与统一事件载荷 `ChartEvent`（T02）。
- `normalizeChartData` 数据校验与规范化：重复系列 id、非法 x/y 抛 `ChartDataError`；`null` 保留为缺失值，禁止转换为 0。
- `buildLineOption` 折线图 option 构建：多系列按首次出现顺序对齐共享类目轴，稳定 series id，更新以 `replaceMerge` 防残留系列；支持 `unit` / `smooth` / `area` / `connectNulls` 配置与受支持的 `optionOverrides` 深层合并（系列、主题与渲染器不可覆盖）。
- `formatValue` 确定性数值格式化：千分位分组、固定小数位、单位后缀，不依赖运行 locale；缺失值统一展示为 `-`。
- 内置 light / dark 主题令牌 `resolveTheme` / `lightTheme` / `darkTheme`。
- `createChartController` 实例控制器：零宽高容器等待 `ResizeObserver` 获得有效尺寸后再初始化；提供 `update` / `resize` / `setPresentation` / `onPointClick` / `whenRendered` / `getInstance` 与幂等 `dispose`；Canvas / SVG 模块按需注册；SSR 宿主仅安全导入。
- 保留 `getCoreRuntimeInfo` 工程骨架探针以兼容既有引导验证。
