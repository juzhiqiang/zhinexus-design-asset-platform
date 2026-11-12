# T09 第三批验证记录：双框架散点图

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-scatter`。任务定义见 [实现计划 T09](../superpowers/plans/2026-11-11-component-platform-implementation.md)，接口以 [T09 第三批对齐件](../superpowers/specs/2026-11-12-sdk-scatter-chart-protocol.md) 为准，柱状图基线见 [T09 第一批验证记录](t09-bar.md)，饼图基线见 [T09 第二批验证记录](t09-pie.md)。

本批只交付散点图（core option + 双框架组件 + `./scatter` 导出 + 共享示例 + 消费者验收 + 截图验证 + B 侧材料生成清单）；trend-card / ranking / proportion 属 T09 后续批次，不在本记录范围内。

## 交付内容

- `packages/charts-core`：`ChartType` 扩展为 `'line' | 'bar' | 'pie' | 'scatter'`；新增 `ScatterChartConfig` / `ScatterChartOption`、`src/charts/scatter.ts`（`buildScatterOption`）；`src/charts/index.ts` 的 `chartTypeOf` / `buildChartOption` 增加 `'scatter'` 分支；`ensureChartModules('scatter', renderer)` 注册 `ScatterChart` + 网格 / 提示 / 图例 / 标题 + 指定渲染器；`src/controller.ts` 点击载荷兼容 `[x, y]` 数值对（`eventValue` 按 `params.value` 是否数组分路）。
- `packages/charts-vue` / `packages/charts-react`：新增 `ScatterChart.vue` / `ScatterChart.tsx`、`scatter-chart.types.ts`、`scatter.ts` 与 `./scatter` 子路径导出；`useChart` 的 `CHART_CONFIG_FIELDS` 增加 `scatter: ['xAxisName', 'yAxisName']`，`defaultConfig('scatter') = { chart: 'scatter' }`；新增 `sameScatterConfig`；`style.css` 增加 `.charts-scatter`；`charts-vue` 的 vite 库入口与 `scripts/build.mjs` 登记 `scatter`。
- 示例：`examples/fixtures/scatter.json`（`default` / `empty` / `missing` / `negative` / `single` / `updated`）、`examples/vue/scatter.html` + `src/ScatterApp.vue` + `src/scatter-main.ts`、`examples/react/scatter.html` + `src/ScatterApp.tsx` + `src/scatter-main.tsx`；两框架 `src/example/runtime.ts` 的测试钩子增强（`seriesData` 兼容 `[x, y]` 数据项、`pointClientPosition` 的 x 取自数据项自身坐标）与就绪协议修复（`runState` 重复应用当前状态幂等返回）。
- 消费者：`tests/consumers/{vue,react}` 各新增散点图页面，`tests/integration/packed-consumer-frameworks.test.ts` 覆盖 `./scatter` 的 Node 导入、`dist/scatter.js` 存在性、多页构建、真实渲染与点击载荷。
- 测试：`tests/unit/chart-semantics.test.ts` 新增 14 项散点图语义；`tests/browser/component-matrix.spec.ts` 新增 13 项双框架矩阵。
- 版本：三包 0.0.3 → 0.0.4（0.x 兼容变更 PATCH），`CHANGELOG.md` 同步；锁文件不变。

## TDD 过程

按 RED → GREEN 执行，RED 提交为 `fb47d7d`（`test: 新增散点图语义、双框架矩阵与消费者验收失败用例`，编辑期误删的饼图用例已在提交前恢复）。确认 RED 后实现，逐域转 GREEN。RED 实测在 rebase 前的基线（`c0e81b6`）上完成；分支随后 rebase 到含 T09 饼图实心覆盖的 main（`2ee1404`），同一提交序列零冲突重放，最终 GREEN 验证在新基线上执行：

| 目标 | RED 实测（`c0e81b6` 基线） | GREEN 实测（`2ee1404` + 本批） |
| --- | --- | --- |
| `tests/unit/chart-semantics.test.ts` | 14 failed / 32 passed（`buildScatterOption is not a function`） | 46 passed |
| `tests/browser/component-matrix.spec.ts --grep scatter` | 13 failed（`/scatter.html` 未注册，画布计数为 0） | 13 passed |
| `tests/integration/packed-consumer-frameworks.test.ts` | 4 failed / 5 passed（缺 `./scatter` 入口、`dist/scatter.js`、`scatter.html` 与点击载荷） | 9 passed |

## 实际执行的验证命令与结果

环境与仓库锁定工具链一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`（`charts-vue` 与示例按既有兼容例外用 `6.0.3` + `vue-tsc 3.3.14`）、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。`test:browser` 按既有约定设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。以下命令均在 `feat/t09-scatter` 分支（0.0.4，rebase 至 main `2ee1404` 后的最终状态，清空 Turbo 本地缓存后）实际执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 锁文件与 `package.json` 一致，无变化 |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 23 files / 491 tests passed，4 skipped（`tests/tooling/verify.test.ts` 既有跳过） |
| `pnpm test:browser` | 71 passed |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed |

- `pnpm test` 491 passed = 新基线 main `2ee1404` 的 477 passed（`c0e81b6` 的 476 + 饼图实心批次 1 项 donut 语义）+ 本批 14 项散点图语义。
- `pnpm test:browser` 71 passed = 新基线 main `2ee1404` 的 58 项（`c0e81b6` 的 46 + 饼图实心批次 12 项实心几何用例）+ 本批 13 项散点图矩阵。饼图实心批次的就绪协议改动（系列快照含 radius、`sectorRadii` 钩子）与本批的钩子扩展、`runState` 幂等修复在同一文件叠加，浏览器 71 项全过确认两类改动兼容。
- 按既有顺序约束，`test:browser` 会清空 `test-results/`，因此先跑浏览器测试、再单独跑一次消费者 vitest 文件以恢复打包体积基线。

## 关键行为证据

- **散点图数据语义**：系列类型为 `scatter`、id 稳定，数据项为 `[x, y]` 数值对（`[[1,120],[2,180],[3,null],[4,200]]`）；`xAxis.type` / `yAxis.type` 均为 `'value'`，`xAxis.boundaryGap` 未设置（与柱状图 `true` 显式区分）。
- **缺失值保持 `null`**：数据项保持 `[3, null]`，option JSON 不含 `null,0`；浏览器端 `seriesData()` 为 `[[120,null,150,null],[40,60,null,80]]`，`pointClientPosition(0, 1)` 返回 `null`（该符号不渲染，实测 zrender 显示列表中无对应 path 元素）。
- **负值透传**：`[2, -40]` 原样进入数据项；浏览器几何断言负值点屏幕 y 大于正值点（零轴以下）。
- **非数值 x 拒绝**：字符串 x 抛 `ChartDataError`，`path` 精确指向 `series[0].points[0].x`。
- **单位口径**：`unit={suffix:'万元',decimals:1}` 时 y 轴标签 `-40.0万元`、x 轴标签 `1,234`（无单位）、tooltip `收入: (1, 120.0万元)`、缺失 `收入: (2, -)`；tooltip 与 y 轴共用 `formatValue`。
- **图例与空数据**：多系列才渲染图例；`{series: []}` → 空系列、无图例、无 NaN、不抛错，浏览器端画布数仍为 1。
- **optionOverrides**：散点图合并 `grid` / `tooltip` / `legend` / `xAxis` / `yAxis` / `title` 六键均生效；调色板仍来自主题，`renderer` 不进入 option。
- **点击载荷（探针 + 双框架）**：ECharts 散点点击 `params.value` 为 `[x, y]` 数组、`params.name` 为 `''`；两框架示例点击同一符号，载荷均为 `{seriesId:'revenue', dataIndex:0, value:[1,120], nativeType:'click'}` 且完全相等；折线 / 柱状 / 饼图的 `[名称, 值]` 载荷经既有矩阵用例确认无变化。
- **系列删减**：`default`（2 系列）→ `single`（1 系列）→ `updated`（2 系列）后实例系列数与画布数始终为 1，无残留系列。
- **StrictMode / 重挂载**：React 开发态（5176）与 Vue 重挂载后仍只有 1 个画布，点击只产生 1 次事件。
- **工作区外消费者**：`pnpm pack` 冻结三个 tarball → 工作区外临时目录 `npm install` → 解析到消费者自身 `node_modules`；`./scatter` 与 `./line` / `./bar` / `./pie` 的 Node 导入均不访问 `window` / `document`；模板工程类型检查通过；缺导出与 `@company/charts-core/src/...` 源码别名仍失败；多页构建（`index.html` + `bar.html` + `pie.html` + `scatter.html`）成功，产物不含 `FunnelView` / `GaugeView` / `MapView` / `EffectScatter` / `BoxplotView` / `SankeyView`，不含 `packages/charts-*/src` 路径；四个页面在真实浏览器渲染并得到等价点击载荷（散点为 `{seriesId:'revenue', dataIndex:0, value:[1,120], nativeType:'click'}`）。
- **打包体积护栏**（护栏 1 MiB，记录于 gitignored 的 `test-results/t03-bundle-baseline.json`）：Vue 消费者 JS `667,506` 字节（0.0.3 饼图后 `657,038`）、React 消费者 JS `825,184` 字节（0.0.3 饼图后 `814,522`），CSS 均 `109` 字节；增量来自消费者页面同时引入四个图表入口。
- **截图验证（两框架，CLI `captureExample` 真实驱动）**：对 `5174/scatter.html` 与 `5175/scatter.html` 各捕获 `default` / `updated` / `empty` 三状态，来源均为 `local-automatic`，自检 `single-instance` / `no-page-error` / `series-match` / `renderer-match` 全部 passed；**两框架 environmentKey 完全一致**（`5b63f34ea4d4aa7b6fff9e74de7b24e33db367afcb5af8bdd0a5f34b5b261430`，canvas / 800×400 / light / Chromium `158.0.8127.18`）；重复捕获 default 状态字节稳定（26,259 B，截图确定性确认）。截图与摘要（gitignored 目录 `test-results/scatter-screenshots/`）：

  | 文件 | 字节 | SHA-256 |
  | --- | --- | --- |
  | `scatter-vue-default.png` | 26,259 | `06e842c977264ff808f5f9f7bb6233813f3a2264ca385c6ac1a02b893bb9fea1` |
  | `scatter-vue-updated.png` | 26,676 | `2cdb92b0f1ff8790b98c2a978cfb6cd3459a9d5b2f3ac5546ff797f21cb653ee` |
  | `scatter-vue-empty.png` | 23,849 | `f03a2f5d825129718f831c7d25de1c3e81c6af31afa4b003c9dd7b6a346c0ca9` |
  | `scatter-react-default.png` | 26,940 | `fb05f839fad499db9c3efd51e70e9bd52e42f1c72d8e8adeb333704d7bac35cb` |
  | `scatter-react-updated.png` | 27,351 | `ff5a52848cda0d6a129c1e4c1e12a683d1b2c18a775e4bc03f743d24ffc21659` |
  | `scatter-react-empty.png` | 24,533 | `4b65a1b2c678def5586c89b10b07f3266bb14c25421edb1316deaad7f22d46ef` |

- **tarball 摘要（0.0.4）**：`charts-core` `25,159` 字节 / `e1227694c30c74478bb4f18c5d6e773e91d1f49c968f2163cb9dce284e3122b6`；`charts-vue` `5,173` / `ae0b42cd74b682387d93f0278aa53a9bb8f8666936c06d6b46f25dd7d2b1bc74`；`charts-react` `9,313` / `a568e79efa3bb36227bf5811b472e6e195f1de23d802193440efc8a6cb84f50f`。

## 实施期间发现并处理的问题

1. **散点点击载荷是 `[x, y]` 数组且 `params.name` 为 `''`**：先以 ECharts dist + Playwright 探针实测确认（数组形状、空 name、null y 不渲染 symbol、负值几何位置），再实现控制器的 `eventValue` 数组分路；两框架载荷一致性由矩阵用例锁定。
2. **`convertToPixel({yAxisIndex:0}, null)` 返回 `null` 而非 `NaN`**：测试钩子对缺失 y 在换算前返回 `null`，不进入坐标换算。
3. **测试钩子需兼容 `[x, y]` 数据项**：`seriesData()` 的 `rawValue` 增加数组分支取 y；`pointClientPosition` 的 x 在数据项为数组时取数据项自身坐标（双数值轴），类目轴图表行为不变；饼图扇形回退不变。页面代码无需按图表类型分叉。
4. **`runState` 重复应用当前状态必超时**：首次用 CLI `captureExample` 真实驱动示例页时暴露——`arm()` 等待系列快照变化，而重复应用同一确定性状态不会产生新快照，`runState('default')`（CLI 截图流程的固定第一步）必超时。修复为同状态幂等返回（复用当前就绪 Promise），同步作用于两框架与全部图表示例页；修复后 59 项浏览器矩阵全过确认无回归，截图验证通过。
5. **编辑期误删既有饼图用例**：新增散点矩阵时误将 `vue_pie_remount_leaves_single_instance` 作为替换锚点删除；通过「基线 46 + 本批 13 ≠ 实测 58」的数量核对发现，已在最终验证前恢复（恢复后 59 passed），并通过 autosquash rebase 将修复并回 RED 提交，分支历史只保留有意变更。
6. **zrender 散点符号元素类型是 `path` 而非 `symbol`**：探针结论，测试不依赖符号几何（坐标轴换算已足够），记录备查。
7. **折线 / 柱状的模块注册与覆盖白名单不一致（既有边界）**：折线未注册 `Legend` / `Title`、柱状未注册 `Title`，而其 `optionOverrides` 白名单允许这些键。本批未改动以免影响既有产物体积基线与冻结历史，已在对齐件第 6 节记录并建议 C / B 在 T09 收口时统一评估；散点图本批即按「白名单 = 已注册组件」实现（含 `Title`）。

## 未覆盖边界与后续

- 本记录的浏览器与消费者验证在上述 Linux 复现环境完成。Windows 开发机原生确认请按 [柱状图 Windows 原生复验清单](t09-bar-windows-native.md) 的同一套命令执行，并把散点图专项窄范围命令替换为：
  `.\scripts\pnpm.ps1 exec vitest run tests/unit/chart-semantics.test.ts`（预期 46 passed）、
  `.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts component-matrix --grep scatter`（预期 13 passed）、
  `.\scripts\pnpm.ps1 exec vitest run tests/integration/packed-consumer-frameworks.test.ts`（预期 9 passed）。
- 散点图暂不提供 `symbolSize` / `symbol` / `itemStyle` 等系列级配置与数值轴 `min` / `max` / `scale` 配置字段（后者可经 `optionOverrides` 设置）；x 轴标签固定 0 位小数、无单位。
- B 的 CLI 材料生成（`prepareReleaseBundle`）当前仍只生成 line / bar，`./pie`（0.0.3 起）与 `./scatter`（0.0.4 起）的覆盖尚未补齐；平台 API 的逐导出覆盖检查会拒绝不完整的 Bundle。实现清单与候选包摘要见 [对齐件第 5 节](../superpowers/specs/2026-11-12-sdk-scatter-chart-protocol.md)。
- `test:infra` 需要本地 PostgreSQL / Verdaccio / MinIO 容器，本环境不具备，未执行。
- T09 后续批次（trend-card / ranking / proportion）按同一模式扩展。
