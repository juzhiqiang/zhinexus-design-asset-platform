# T09 SDK 侧证据核对与缺口补齐

日期：2026-11-13。负责人：A（SDK）。分支：`feat/t10-sdk-compatibility`（基线 main `885792b`）。
任务定义见 [T09 实施计划](../superpowers/plans/2026-11-11-component-platform-implementation.md)；验收标准是「7 个组件、14 个实现；双框架生命周期、事件、空数据和干净消费者验证通过」。

本文是 T09 收口时对 **SDK 自身证据**的逐项核对记录，以及补齐的两处缺口。此前各批次的验证记录（柱状图、饼图、散点、趋势卡片、排行榜与占比）保持原样，本文不改写历史。

## 一、核对范围与方法

按验收标准逐项核对「SDK API / 示例 / 交互 / 空·缺失·零总量 / light·dark / Canvas·SVG」六个面，在每个面上问同一个问题：**有没有一条测试或人工核对入口，证明它在 14 个实现上真的成立**，而不是只证明「代码里声明了」。

证据来源分三类：`tests/unit/chart-semantics.test.ts`（core 语义）、`tests/browser/component-matrix.spec.ts` 与 `tests/browser/core-lifecycle.spec.ts`（双框架真实渲染）、`tests/integration/packed-consumer-frameworks.test.ts`（工作区外冻结 tarball 消费）。

## 二、逐项核对结果

| 面 | 证据 | 状态 |
| --- | --- | --- |
| SDK API | 7 个逻辑组件 × 2 框架共 14 个实现；`charts-vue` / `charts-react` 各有 `.` 与 `./line` `./bar` `./pie` `./scatter` `./trend-card` `./ranking` `./proportion` 八条子路径导出；`sameChartConfig` 等配置等价判定双框架对等实现 | 已有 |
| 示例 | `examples/{vue,react}` 各 7 个页面 + fixture（default / empty / missing / updated 等状态），React 另带 StrictMode 开发态入口 | 已有 |
| 交互 | `component-matrix` 中每个组件的 `*_click_payload_is_consistent` 覆盖两框架，另有 `*_click_payload_matches_in_both_frameworks` 交叉比对 | 已有 |
| 空 / 缺失 / 零总量 | 空数据不出系列、缺失值保持 `null` 不入统计、占比与饼图零总量走「暂无数据」不产 `NaN`；单测与浏览器层双侧覆盖 | 已有 |
| **light / dark × Canvas / SVG** | 示例页把 `theme:'light', renderer:'canvas'` 硬编码在配置里；`core-lifecycle` 只有折线图一条 `setPresentation` 覆盖 | **缺口，本轮补齐** |
| 干净消费者 | `packed-consumer-frameworks` 用 `pnpm pack` 冻结 tarball，在工作区外临时目录 `npm install`，断言 `workspace:*` 已转精确版本、ESM/类型/样式/子路径可用 | 已有 |

## 三、缺口一：light/dark × Canvas/SVG 在 14 个实现上没有证据

`rules/platform.md` 要求「主题 / 渲染器（canvas / svg）切换重建」，并把 light/dark × Canvas/SVG 称为**声明支持矩阵**。但补齐前：

- 14 个示例页全部硬编码 `theme: 'light', renderer: 'canvas'`，地址栏没有任何入口能切到 dark 或 svg；
- `core-lifecycle.spec.ts` 的 `set_presentation_rebuilds_without_losing_data` 只覆盖折线图一种图表类型；
- `component-matrix` 的 `renderer-match` 自检只校验「声明了什么」，没有校验「实例上真正生效的颜色是不是那个主题的」。

### 补齐方式

1. `examples/{vue,react}/src/example/runtime.ts` 新增 `resolvePresentation()`：从 URL 查询参数解析 `?theme=dark&renderer=svg`，未识别的值回退 `light` + `canvas` 缺省，不把错误输入带进图表实例。14 个示例页的配置与 `createExampleRuntime({ renderer })` 改用它。
2. 同一 runtime 新增 `appliedPresentation()` 测试钩子：从 ECharts 实例的 `getOption()` 读回**真实生效**的调色板首色与全局文本颜色，并统计 DOM 中 canvas / svg 数量。这样断言的是「实例里生效什么」，不是「页面声明什么」。
3. 新增 `tests/browser/presentation-matrix.spec.ts`：7 组件 × 2 主题 × 2 渲染器 × 2 框架 = **56 例**。每例断言四件事：DOM 中 canvas/svg 数量与声明的渲染器一致且只有一个；实例上生效的调色板首色与文本颜色等于该主题在 `charts-core/src/theme.ts` 里的令牌；`single-instance` / `no-page-error` / `series-match` / `renderer-match` 四项自检通过；无页面错误。

### 实测结果

`presentation-matrix` **56 passed**。dark 主题的令牌（`#60a5fa` / `#e2e8f0`）与 light（`#3b82f6` / `#263044`）在 14 个实现上都被真实读回，svg 渲染下 canvas 数为 0、canvas 渲染下 svg 数为 0。

过程中有两个值得记录的问题：一是 `trend-card` / `ranking` / `proportion` 三个示例页的外层布局类名是 `trend-card-frame` / `ranking-frame` / `proportion-frame`，与前四个组件的 `chart-frame` 不一致，测试因此改用组件自身的容器类名 `.charts-<组件名>`；二是 ECharts 实例不挂到 `window` 上，最初想从测试里直接取实例拿不到，改为经测试钩子从页面内读数。

## 四、缺口二：core 层 setPresentation 只覆盖折线图

`set_presentation_rebuilds_without_losing_data` 用缺省配置创建实例，`chartTypeOf` 对无 `chart` 字段的配置返回 `line`，因此 T09 新增的六种图表类型在「主题 / 渲染器切换后能否重新渲染」这条上没有证据。任一类型漏注册图表模块都会在切换后渲染不出来。

### 补齐方式

`core-lifecycle.spec.ts` 新增 `set_presentation_rebuilds_<图表类型>` 七例，对全部 7 种图表类型走 `light+canvas → dark+svg → light+canvas` 双向切换，每轮断言系列 id 不丢、canvas/svg 数量恰为一个、无页面错误。数据形状按图表类型区分：散点图 x 必须为数值，排行榜与占比只接受单系列（多系列抛 `ChartDataError`）。

### 实测结果

`core-lifecycle` **11 passed**（原有 4 + 新增 7）。

## 五、回归核对

补齐改动只涉及示例页与测试，未改 SDK 运行时行为，但仍全量回归：

| 范围 | 结果 |
| --- | --- |
| `presentation-matrix`（新增） | 56 passed |
| `core-lifecycle` | 11 passed |
| `component-matrix` | 96 passed（无回归） |
| `framework-lifecycle` / `bootstrap` / `contracts-runtime` / `capture-ready` | 11 passed |
| `verify:workspace` | `Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.` |
| `charts-core` typecheck / build | 通过 |

## 六、仍未覆盖的边界

- **本轮新增测试的 Windows 原生验证未执行**：C 已于 2026-11-13 在 Windows 开发机完成**基线 `885792b` / SDK `0.0.6`** 的原生验收（build 10 tasks、typecheck 14 + 根 `tsc`、unit/contracts 322、packed-consumer + cli-bundle 12、完整浏览器 122 均通过；`current-sdk` 从旧 10 实现 RED 后改为 14 实现，隔离三存储发布 READY、逐预览/截图摘要、Vue/React 各 7 子路径的精确 Registry 安装全部通过）。但该验收**不包含**本轮新增的 `presentation-matrix` 56 例与 `core-lifecycle` 新增 7 例——这两批要在含本轮提交的分支上重跑 `.\scripts\verify.ps1` 才算原生通过。本文所有结果均来自 Linux 复现环境。
- **人工目视检查未执行**：截图无法覆盖的判断（深色主题下 graphic 摘要文字与条形对比度、条末标签是否被裁切、两框架并排比对）仍需在 Windows 上人看一眼。示例页现已支持 `?theme=dark&renderer=svg`，可直接在地址栏切换后核对。
- **真实三存储闭环在 A 侧未执行**：C 已在隔离环境完成三存储发布 READY 与逐预览/截图摘要核对；A 侧本轮只做了工作区外隔离消费者的安装与渲染探针，未走 Verdaccio / PostgreSQL / MinIO 的完整发布链路。
- **大小写敏感文件系统的构建未验证**：`ranking.ts` 与 `RankingChart.tsx` 只差大小写，在大小写不敏感的 NTFS 上已按 `RankingChart.*` 命名规避；大小写敏感文件系统上的构建未实测。
