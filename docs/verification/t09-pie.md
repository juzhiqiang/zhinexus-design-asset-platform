# T09 第二批验证记录：双框架饼图 / 环形图

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-pie`。任务定义见 [实现计划 T09](../superpowers/plans/2026-11-11-component-platform-implementation.md)，接口以 [T09 第二批对齐件](../superpowers/specs/2026-11-12-sdk-pie-chart-protocol.md) 为准，柱状图基线见 [T09 第一批验证记录](t09-bar.md)。

本批只交付饼图 / 环形图（core option + 双框架组件 + `./pie` 导出 + 共享示例 + 消费者验收）；scatter 与三个场景组件属 T09 后续批次，不在本记录范围内。

## 交付内容

- `packages/charts-core`：`ChartType` 扩展为 `'line' | 'bar' | 'pie'`；新增 `PieChartConfig` / `PieChartOption`、`src/charts/pie.ts`（`buildPieOption` / `pieTotal`）、`src/format.ts` 的 `formatPercent`；`src/charts/index.ts` 的 `chartTypeOf` / `buildChartOption` 增加 `'pie'` 分支；`src/charts/option-overrides.ts` 的 `applySupportedOverrides` 增加按图表类型收窄的 `allowedKeys`（饼图只合并 `tooltip` / `legend` / `title`）；`ensureChartModules('pie', renderer)` 注册 `PieChart` + 提示 / 图例 / 标题 + 指定渲染器，不注册坐标轴组件。
- `packages/charts-vue` / `packages/charts-react`：新增 `PieChart.vue` / `PieChart.tsx`、`pie-chart.types.ts`、`pie.ts` 与 `./pie` 子路径导出；`useChart` 的 `CHART_CONFIG_FIELDS` 增加 `pie: ['donut']`，`defaultConfig('pie') = { chart: 'pie' }`；新增 `samePieConfig`；`style.css` 增加 `.charts-pie`；`charts-vue` 的 vite 库入口与 `scripts/build.mjs` 登记 `pie`。
- 示例：`examples/fixtures/pie.json`（`default` / `empty` / `missing` / `zero-total` / `nested` / `updated`）、`examples/vue/pie.html` + `src/PieApp.vue` + `src/pie-main.ts`、`examples/react/pie.html` + `src/PieApp.tsx` + `src/pie-main.tsx`；两框架 `src/example/runtime.ts` 的测试钩子增强（`seriesData` 兼容饼图 `{name, value}` 数据项、`pointClientPosition` 增加扇形几何回退、新增 `seriesRadius`）。
- 消费者：`tests/consumers/{vue,react}` 各新增饼图页面，`tests/integration/packed-consumer-frameworks.test.ts` 覆盖 `./pie` 的 Node 导入、`dist/pie.js` 存在性、多页构建、真实渲染与点击载荷。
- 测试：`tests/unit/chart-semantics.test.ts` 新增 16 项饼图语义；`tests/browser/component-matrix.spec.ts` 新增 15 项双框架矩阵。

## TDD 过程

按 RED → GREEN 执行，RED 提交为 `60e0653`（`test: 新增饼图/环形图语义、双框架矩阵与消费者验收失败用例`）。确认 RED 后实现，逐包转 GREEN：

| 目标 | RED 实测 | GREEN 实测 |
| --- | --- | --- |
| `tests/unit/chart-semantics.test.ts` | 16 failed / 16 passed（`buildPieOption is not a function`、`formatPercent` 未导出） | 32 passed |
| `tests/browser/component-matrix.spec.ts --grep pie` | 15 failed（`/pie.html` 未注册，画布计数为 0） | 15 passed |
| `tests/integration/packed-consumer-frameworks.test.ts` | 4 failed / 5 passed（缺 `./pie` 入口、`dist/pie.js`、`pie.html` 与点击载荷） | 9 passed |

## 实际执行的验证命令与结果

环境与仓库锁定工具链一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`（`charts-vue` 与示例按既有兼容例外用 `6.0.3` + `vue-tsc 3.3.14`）、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。`test:browser` 按既有约定设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 锁文件与 `package.json` 一致（版本号升版不改变 `workspace:*` 协议，锁文件无变化） |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful（清空 Turbo 本地缓存后执行） |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 16 files / 236 tests passed，4 skipped（`tests/tooling/verify.test.ts` 既有跳过） |
| `pnpm test:browser` | 46 passed |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed |

`test:browser` 46 passed = T03/T09 的 31 项 + 本批 15 项；`pnpm test` 236 passed = 合并主分支时的 220 项 + 本批 16 项。按既有顺序约束，`test:browser` 会清空 `test-results/`，因此先跑浏览器测试、再单独跑一次消费者 vitest 文件以恢复打包体积基线。

## 关键行为证据

- **饼图数据语义**：系列类型为 `pie`、id 稳定，扇形数据为 `{ name, value }`；缺失值保持 `null`（`[{name:'自然',value:null}]`）且 ECharts 不渲染该扇形（zrender 中该扇形 `startAngle`/`endAngle` 为 `null`），也不进入占比分母（120 + 80 + 100 = 300）。
- **负值拒绝**：`buildPieOption` 对任一负值抛 `ChartDataError`，`path` 精确指向 `series[0].points[1].y`；与折线 / 柱状图的负值透传规则显式区分。
- **零总量不产出 NaN**：全零数据 `[{name:'搜索',value:0},{name:'直投',value:0}]` 的 option JSON 不含 `NaN`，tooltip 返回 `搜索: 0`、标签返回 `搜索\n0`，占比被省略而非渲染成 `NaN%`；浏览器端 `seriesData()` 为 `[[0, 0]]`。
- **半径规则**：实心饼图 `['0%','70%']`；单系列环形图 `['35%','70%']`；两系列实心嵌套 `['35%','70%']` + `['0%','35%']`；两系列环形嵌套 `['52.5%','70%']` + `['35%','52.5%']`——环形图先预留内孔再均分带宽，任何系列数下内半径都小于外半径。
- **donut 只改变内半径**：同一数据下 donut 与实心的扇形数据、系列 id、图例规则完全一致，只有 `radius` 不同。
- **占比口径一致**：`tooltip` 与 `label` 共用 `formatPercent`；`120/300 → 40.0%`、`80/300 → 26.7%`、`100/300 → 33.3%`；带单位时 `直投: 80.0万元（26.7%）`；缺失值展示 `-`。
- **optionOverrides 收窄**：饼图合并 `tooltip` / `legend` / `title` 生效，`grid` / `xAxis` / `yAxis` 合并不生效（option 中不出现这些键）；调色板仍来自主题，`renderer` 不进入 option。
- **空数据**：`{series: []}` → 空系列、无图例、不抛错、无 NaN；浏览器端画布数仍为 1。
- **系列删减**：`default`（1 环）→ `nested`（2 环）→ `updated`（1 环）后实例系列数与画布数始终为 1，无残留系列。
- **双框架一致**：Vue 与 React 示例点击同一扇形，载荷均为 `{seriesId:'share', dataIndex:0, value:['搜索',120], nativeType:'click'}`，且两框架载荷完全相等。
- **StrictMode / 重挂载**：React 开发态（5176）与 Vue 重挂载后仍只有 1 个画布，点击只产生 1 次事件。
- **折线与柱状无回归**：`core-lifecycle` 4 项、`framework-lifecycle` 4 项（含 StrictMode、KeepAlive、跨框架点击、SSR 导入）、`component-matrix` 的 13 项柱状图用例全部通过；`buildLineOption` 仍为 `line` 系列、`boundaryGap=false`；`buildBarOption` 仍为 `bar` 系列、`boundaryGap=true`、`stack` 透传。
- **工作区外消费者**：`pnpm pack` 冻结三个 tarball → 工作区外临时目录 `npm install` → 解析到消费者自身 `node_modules`；`./pie` 与 `./line` / `./bar` 的 Node 导入均不访问 `window` / `document`；模板工程类型检查通过；缺导出与 `@company/charts-core/src/...` 源码别名仍失败；多页构建（`index.html` + `bar.html` + `pie.html`）成功，产物不含 `FunnelView` / `GaugeView` / `MapView` / `EffectScatter` / `BoxplotView` / `SankeyView`，不含 `packages/charts-*/src` 路径；三个页面在真实浏览器渲染并得到等价点击载荷。
- **打包体积护栏**（护栏 1 MiB，记录于 gitignored 的 `test-results/t03-bundle-baseline.json`）：Vue 消费者 JS `655,769` 字节（T03 后 `585,318`、T09 第一批后 `628,474`）、React 消费者 JS `813,253` 字节（T03 后 `742,797`、T09 第一批后 `785,869`），CSS 均 `93` 字节；增量来自消费者页面同时引入折线、柱状与饼图三个图表入口。
- **tarball 摘要（0.0.3）**：`charts-core` `22,992` 字节 / `8507eb712781a50dfff9135162b455ca6463fcc93dcb62b070e2a9a7117647a3`；`charts-vue` `4,663` / `d7a20cd8e8a82827d72c4654ac8981d86aa8738db22a1db467f47b5ceeb87a48`；`charts-react` `8,359` / `bbd1c34c37f3e0de415e3c21173b916768e147a6137cf7a14b01a8b6fac83757`。

## 实施期间发现并处理的问题

1. **`PieDataItemOption.value` 不接受 `null`**：ECharts 运行期接受 `value: null`（该扇形不渲染，实测 `startAngle`/`endAngle` 为 `null`），但其声明类型未收窄到可空。`buildPieOption` 对 `point.y` 显式断言为 `number` 并注释说明，以保留「null 即缺失，禁止写成 0」的共享数据规则。
2. **饼图无坐标轴，`convertToPixel` 不可用**：测试钩子的 `pointClientPosition` 原实现依赖 `xAxis` / `yAxis`。改为先走直角坐标系换算，失败时回退到 zrender 显示列表中 `type === 'sector'` 元素的几何中心（按各系列数据长度顺序切片定位系列，取内外半径中点与角度中点）。该回退让页面代码无需按图表类型分叉，消费者模板与示例共用同一写法。
3. **扇形局部坐标需要叠加宿主偏移**：zrender sector 的 `shape.cx/cy` 是画布局部坐标，点击坐标必须再加上 `host.getBoundingClientRect()` 的 `left/top`。
4. **`seriesData()` 不识别饼图数据项**：饼图 `series.data` 是 `{name, value}` 对象数组，原实现会把每项映射成 `null`。改为经 `rawValue` 提取 `value`，缺失仍为 `null`。
5. **全局钩子类型冲突**：`component-matrix.spec.ts` 给 `ExampleTestHook` 增加 `seriesRadius` 后，`framework-lifecycle.spec.ts` 的同名全局声明类型不一致，根 `tsc --noEmit` 报 TS2717。两处声明同步补齐该字段（提交 `4ba6a56`）。
6. **vite 多入口需显式登记**：`charts-vue` 的 `build.lib.entry`、两个示例与两个消费者的 `rollupOptions.input` 都需要显式加入 `pie` 入口，否则只产出既有入口。
7. **升版后框架包解析到过期 core 声明**：`charts-vue` / `charts-react` 的 `@company/charts-core` 解析到 `packages/charts-core/dist/index.d.ts`，core 改动后必须先重建 core 再构建框架包，否则报「no exported member named 'PieChartConfig'」。

## 未覆盖边界与后续

- 本记录的浏览器与消费者验证在上述 Linux 复现环境完成。Windows 开发机原生确认请按 [柱状图 Windows 原生复验清单](t09-bar-windows-native.md) 的同一套命令执行，并把饼图专项窄范围命令替换为：
  `.\scripts\pnpm.ps1 exec vitest run tests/unit/chart-semantics.test.ts`（预期 32 passed）、
  `.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts component-matrix`（预期 28 passed = 柱状 13 + 饼图 15）、
  `.\scripts\pnpm.ps1 exec vitest run tests/integration/packed-consumer-frameworks.test.ts`（预期 9 passed）。
- 饼图暂不提供 `roseType`、`minAngle`、自定义内半径与环形间距配置；示例页固定 `donut: true`，实心饼图半径规则由单元测试断言，浏览器端未覆盖实心饼图渲染。
- 饼图负值目前直接抛错；若后续要展示盈亏构成，需在 core 增加显式的正值化或正负分栏语义，不得静默取绝对值。
- `pointClientPosition` 的扇形几何回退依赖 zrender 显示列表结构与系列顺序，属测试钩子内部实现；ECharts 升级（T10）若改变该结构，兼容矩阵会暴露。
- T09 后续批次（scatter / trend-card / ranking / proportion）按同一模式扩展；`README.md` 的 SDK 段落自 G0 / T02 起已过期，建议由 C 在 T09 收口时统一刷新。
- 就绪协议的 JSON Schema / 运行时代码校验属 G1，待 C 在 `packages/contracts` 落 validator；`ComponentExample` / `CheckResult` 形状未变，测试钩子新增的 `seriesRadius` 与 `seriesData` 的饼图兼容只服务于测试，不进契约。
