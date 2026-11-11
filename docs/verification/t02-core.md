# T02 验证记录：共享图表核心与折线图

日期：2026-11-11。负责人：A（SDK）。分支：`feat/t02-core`。任务定义见 [实现计划 T02](../superpowers/plans/2026-11-11-component-platform-implementation.md)。

## 交付内容

- `packages/charts-core/src/types.ts`：`ChartData` / `ChartSeries` / `ChartPoint` / `ChartEvent` / `ChartConfig` / `LineChartConfig` / `SupportedOptionOverrides` / `ChartController` 等公共类型。
- `packages/charts-core/src/data.ts`：`normalizeChartData`（`ChartDataError`）、`collectCategories`、`alignSeriesValues`。
- `packages/charts-core/src/format.ts`：`formatValue` / `MISSING_VALUE_DISPLAY`，确定性格式化（不使用 `toLocaleString`）。
- `packages/charts-core/src/theme.ts`：`lightTheme` / `darkTheme` / `resolveTheme`。
- `packages/charts-core/src/engine/modules.ts`：`ensureLineModules`，按渲染器按需注册 ECharts 模块。
- `packages/charts-core/src/engine/adapter.ts`：`initChartInstance` / `disposeChartInstance` / `assertClient`（SSR 守卫）。
- `packages/charts-core/src/charts/line.ts`：`buildLineOption`（稳定 series id + `replaceMerge` 语义 + 受支持 overrides 深层合并）。
- `packages/charts-core/src/controller.ts`：`createChartController`（零尺寸延迟初始化、`update` / `resize` / `setPresentation` / `onPointClick` / `whenRendered` / `getInstance` / 幂等 `dispose`）。
- 测试：`tests/unit/chart-data.test.ts`、`tests/browser/core-lifecycle.spec.ts`。
- 示例夹具：`examples/vue/harness.html`、`examples/vue/src/core-harness.ts`（框架无关，仅服务浏览器生命周期测试）。

## 实际执行的验证命令与结果

以下命令在与仓库锁定工具链完全一致的环境中执行：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。该环境由仓库 `pnpm-lock.yaml` 冻结安装复现，未修改任何锁定版本。

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/unit/chart-data.test.ts`（实现前） | 10 failed / 2 passed（RED，导入与断言均失败） |
| `pnpm exec vitest run tests/unit/chart-data.test.ts`（实现后） | 12 passed |
| `pnpm exec playwright test tests/browser/core-lifecycle.spec.ts --config tests/playwright.config.ts` | 4 passed（`removes_series_without_ghosts`、`does_not_initialize_zero_size`、`dispose_is_idempotent_and_releases_the_instance`、`set_presentation_rebuilds_without_losing_data`） |
| `pnpm build` | 10 tasks successful |
| `pnpm typecheck` | 14 tasks successful（含根 `tsc -p tsconfig.json --noEmit` 与 `examples/vue` 的 `vue-tsc`） |
| `pnpm test`（全量 Vitest） | 2 files / 17 tests passed |
| `pnpm test:browser`（全量 Playwright） | 10 passed（含 B/C 的 bootstrap 与 gallery 用例） |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |

`pnpm test:browser` 需要按画廊迁移记录设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test` 后构建 gallery，否则 sitemap 用例因环境变量缺失失败（与 T02 无关的既有约定）。

## 关键行为证据

- `null` 缺失值：`buildLineOption` 输出 `data: [100, null, 1234.5]`，缺类目的第二系列对齐为 `null` 而非 `0`。
- 单位一致：`tooltip.valueFormatter` 与 `yAxis.axisLabel.formatter` 对同一数值输出一致（`1,234.5%`），缺失值为 `-`。
- 无残留系列：A/B → A 更新后实例 option 的 series 仅为 `['alpha']`，宿主内仍只有 1 个 canvas。
- 零尺寸：0×0 容器不创建实例、无 canvas；恢复 320×200 后经 `ResizeObserver` 初始化并渲染。
- `dispose` 幂等：重复调用安全，销毁后 `update` 不再创建实例。
- `setPresentation('dark','svg')`：数据保留（series ids 不变），宿主仅存 1 个 `svg`、无 canvas 残留。
- SSR 安全：Node 环境（无 `window`）导入模块并构建 option 不访问浏览器全局。
- `finished` 时序：ECharts 在关闭动画时可能于 `setOption` 内同步触发 `finished`；控制器采用“先登记等待者再 setOption + 常驻 finished 监听”避免 `whenRendered` 永久挂起（浏览器测试覆盖）。

## 未覆盖边界与后续

- 浏览器与全量验证在上述 Linux 复现环境完成；按项目约定（本地 Windows + 本地 Playwright Chromium）建议在开发机再执行一次 `.\scripts\pnpm.ps1 test:browser` 作为原生确认。
- 工作区外真实 tarball 消费、`./line` 子路径导出与打包体积属于 T03 验收范围，本任务不声称已完成。
- `examples/vue` 新增 `@company/charts-core` 依赖，`pnpm-lock.yaml` 已生成 3 行 workspace 链接（工作区未提交状态中还有其他成员的锁文件修改，按分工由 C 统一提交锁文件）。
- 实现计划中 T02 的勾选待锁文件与计划文档负责人（C）提交其未完成修改后一并更新，本记录先行固证。
