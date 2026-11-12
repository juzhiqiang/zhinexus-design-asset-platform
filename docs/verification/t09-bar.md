# T09 第一批验证记录：双框架柱状图

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-bar`。任务定义见 [实现计划 T09](../superpowers/plans/2026-11-11-component-platform-implementation.md)，接口以 [T09 第一批对齐件](../superpowers/specs/2026-11-12-sdk-bar-chart-protocol.md) 为准。

本批只交付柱状图（core option + 双框架组件 + `./bar` 导出 + 共享示例 + 消费者验收）；饼图、散点与场景组件属 T09 后续批次，不在本记录范围内。

## 交付内容

- `packages/charts-core`：`src/types.ts` 新增 `ChartType` / `BarChartConfig` / `AnyChartConfig` / `BarChartOption`；新增 `src/charts/bar.ts`（`buildBarOption`）、`src/charts/index.ts`（`chartTypeOf` / `buildChartOption` 分发）、`src/charts/option-overrides.ts`（折线与柱状共用的覆盖合并规则）；`src/controller.ts` 按配置联合构建 option，`src/engine/modules.ts` 的 `ensureLineModules` 改为 `ensureChartModules(chart, renderer)`；`src/charts/line.ts` 重构为复用共用覆盖规则，行为不变。
- `packages/charts-vue` / `packages/charts-react`：新增 `BarChart.vue` / `BarChart.tsx`、`bar-chart.types.ts`、`bar.ts` 与 `./bar` 子路径导出；`useChart` 泛化为按图表类型复用同一生命周期实现；`style.css` 增加 `.charts-bar`。
- 示例：`examples/fixtures/bar.json`（`default` / `empty` / `missing` / `negative` / `single` / `updated`）、`examples/vue/bar.html` + `src/BarApp.vue` + `src/bar-main.ts`、`examples/react/bar.html` + `src/BarApp.tsx` + `src/bar-main.tsx`；两框架运行时与测试钩子新增可选 `hostSelector` 与 `seriesData()`。
- 消费者：`tests/consumers/{vue,react}` 各新增柱状图页面，`tests/integration/packed-consumer-frameworks.test.ts` 覆盖 `./bar` 的 Node 导入、多页构建、真实渲染与点击载荷。
- 测试：`tests/unit/chart-semantics.test.ts`（16 项柱状图语义）、`tests/browser/component-matrix.spec.ts`（13 项双框架矩阵）。

## 实际执行的验证命令与结果

环境与仓库锁定工具链一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`（`charts-vue` 与示例按既有兼容例外用 `6.0.3` + `vue-tsc 3.3.14`）、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。首次执行前确认 RED：`chart-semantics` 14/16 失败、`component-matrix` 13/13 失败、`packed-consumer-frameworks` 4/9 失败（失败原因均为柱状图能力缺失）。

| 命令 | 结果 |
| --- | --- |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful（清空 Turbo 本地缓存后执行，0 cached） |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 11 files / 192 tests passed，4 skipped（`tests/tooling/verify.test.ts` 既有跳过） |
| `pnpm test:browser` | 28 passed（bootstrap 3、gallery 3、core-lifecycle 4、framework-lifecycle 4、**component-matrix 13**、contracts-runtime 1） |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed |

`test:browser` 与 gallery 构建需按既有约定设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`（B/C 既有约定，非本批引入）。

## 关键行为证据

- **柱状图语义**：类目轴 `boundaryGap=true`（折线图为 `false`）；空数据返回空系列与空类目轴且 JSON 不含 `NaN`、不渲染图例；缺失值 `null` 保持为 `null`（`[120, null, 180]`、`[40, null, 60]`）；负值原样进入系列数据（`[120, -40, null, -15]`，不含被裁剪的 `0`）；tooltip 与坐标轴共用 `formatValue`（`-40.0万元`）；`stack` 透传、缺省不堆叠；`optionOverrides` 只深层合并受支持字段，调色板来自主题、`renderer` 不进入 option。
- **双框架一致**：Vue 与 React 示例点击同一柱条，载荷均为 `{seriesId:'revenue', dataIndex:0, value:['周一',120], nativeType:'click'}`，且两框架载荷完全相等。
- **空数据 / 缺失值 / 负值 / 更新 / 卸载**：`component-matrix` 对 5174（Vue）与 5175（React）各跑 5 项，另加跨框架点击等价、React StrictMode（5176 开发态）重挂载、Vue 重挂载共 13 项，全部通过；卸载后重新挂载仍只有 1 个画布、点击只产生 1 次事件。
- **负值几何断言**：`negative` 状态中正值柱条（120）的屏幕 y 小于负值柱条（-40）的屏幕 y，即负值渲染在零轴以下。
- **系列删减**：`default`（2 系列）→ `single`（1 系列）→ `updated`（2 系列）后实例系列数与画布数始终为 1，无残留系列。
- **折线图无回归**：`tests/unit/chart-data.test.ts` 12 项、`tests/browser/core-lifecycle.spec.ts` 4 项、`tests/browser/framework-lifecycle.spec.ts` 4 项（含 StrictMode、KeepAlive、跨框架点击、SSR 导入）全部通过；`buildLineOption` 仍为 `line` 系列、`boundaryGap=false`、无 `stack` / 图例。
- **工作区外消费者**：`pnpm pack` 冻结三个 tarball → 工作区外临时目录 `npm install` → 解析到消费者自身 `node_modules`；`./bar` 与 `./line` 的 Node 导入均不访问 `window` / `document`；模板工程类型检查通过；缺导出与 `@company/charts-core/src/...` 源码别名仍失败；多页构建（`index.html` + `bar.html`）成功，产物不含 `FunnelView` / `GaugeView` / `MapView` / `EffectScatter` / `BoxplotView` / `SankeyView`，不含 `packages/charts-*/src` 路径；两个页面在真实浏览器渲染并得到等价点击载荷。
- **打包体积护栏**（初始校准值，护栏 1 MiB，记录于 gitignored 的 `test-results/t03-bundle-baseline.json`）：Vue 消费者 JS `628,474` 字节（T03 后 `585,318`）、React 消费者 JS `785,869` 字节（T03 后 `742,797`），CSS 均 `81` 字节；增量来自消费者页面同时引入折线与柱状两个图表入口。
- **tarball 摘要（0.0.2）**：`charts-core` `18,776` 字节 / `a8971448839272e46b5d184e26943c3235315a4e478fc061128ca09e63fbdac4`；`charts-vue` `4,174` / `02d84ac416b4ac3e1724dbe3dbfa6db3645753b99e8e431c21d08952dcd855ef`；`charts-react` `7,344` / `410412da6724452e74c76dbf403ce254c7e3d440732a1df4371eae1416b6c64d`。

## 实施期间发现并修复的问题

1. **消费者点击偏移必须按图表类型区分**：柱状图点击坐标若取类目带中心会落在分组柱条之间的空隙（多系列时）或柱条顶边描边上。示例测试改为在单系列状态点击并向下偏移 8 像素命中柱体；消费者测试为折线（点符号，偏移 0）与柱状（柱体，偏移 8）分别指定偏移。
2. **重挂载后测试钩子异步替换**：重新挂载后旧的测试钩子仍可能报告文档内坐标（选择器相同），导致读取到旧组件的点击记录。`clickFirstBar` 先等待当前钩子报告有效坐标，再执行点击。
3. **硬编码包版本**：`tests/integration/packed-consumer.test.ts` 与 `tests/unit/release-fingerprint.test.ts` 原硬编码 `0.0.1`，升版即失败；改为从 `packages/charts-core/package.json` 动态读取，版本号唯一事实来源不变。
4. **vite 多入口需显式登记**：`charts-vue` 的 `build.lib.entry` 与两个示例的 `rollupOptions.input` 都需要显式加入 `bar` 入口，否则只产出 `index` / `line`。

## 未覆盖边界与后续

- 浏览器与消费者验证在上述 Linux 复现环境完成；建议在 Windows 开发机再执行一次 `.\scripts\pnpm.ps1 test:browser` 与 `.\scripts\pnpm.ps1 test` 作为原生确认。
- T09 后续批次（pie / scatter / trend-card / ranking / proportion）按同一模式扩展：core 增加图表入口与模块注册、框架包增加组件与子路径、fixtures 与示例同步、`component-matrix` 与消费者验收补充。
- 柱状图暂不提供横向柱状与柱宽 / 圆角专属配置；需要时通过 `optionOverrides` 或后续批次以兼容方式新增。
- `README.md` 的 SDK 段落自 G0 / T02 起已过期（仍写“包壳”“版本 0.0.0”“图表控制器尚待实现”）；本批未改动该根文档，建议由 C 在 T09 收口时统一刷新。
- 就绪协议的 JSON Schema / 运行时代码校验属 G1，待 C 在 `packages/contracts` 落 validator；`ComponentExample` / `CheckResult` 形状未变，测试钩子新增的 `seriesData` 与 `hostSelector` 只服务于测试，不进契约。
