# T03 验证记录：双框架适配与真实候选包消费

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t03-adapters`。任务定义见 [实现计划 T03](../superpowers/plans/2026-11-11-component-platform-implementation.md)，接口以 [T03 公共接口对齐说明](../superpowers/specs/2026-11-12-sdk-framework-example-protocol.md) 为准。

## 交付内容

- `packages/charts-react`：`LineChart.tsx`、`useChart.ts`、`line-chart.types.ts`、`line.ts`、`index.ts`、`style.css`、`scripts/copy-style.mjs`；`tsc` 发射 ESM + 声明，导出 `.` / `./line` / `./style.css`。
- `packages/charts-vue`：`LineChart.vue`（SFC）、`useChart.ts`、`line-chart.types.ts`、`line.ts`、`index.ts`、`style.css`、`vite.config.ts`、`scripts/build.mjs`；`vue-tsc` 发射声明（含 `.vue` 的 `DefineComponent`）+ `vite` 库模式发射 ESM，导出 `.` / `./line` / `./style.css`。
- 示例：`examples/fixtures/line.json`（双框架共用状态数据）、`examples/vue` 折线图页与 `keepalive.html`（KeepAlive 演示）、`examples/react` 折线图页与 `dev:strict`（5176 开发态）；两例均实现 `window.__COMPONENT_EXAMPLE__` 就绪协议。
- 测试：`tests/browser/framework-lifecycle.spec.ts`、`tests/integration/packed-consumer-frameworks.test.ts`、`tests/consumers/{vue,react}` 模板；`tests/playwright.config.ts` 增加 React dev webServer。

## 实际执行的验证命令与结果

环境与仓库锁定工具链一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`（`charts-vue` 与示例按既有兼容例外用 `6.0.3` + `vue-tsc 3.3.14`）、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell。首次执行前确认 RED（4 个生命周期/消费者用例失败）。

| 命令 | 结果 |
| --- | --- |
| `pnpm build` | 10 tasks successful（清空 Turbo 本地缓存后执行） |
| `pnpm typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `pnpm test` | 3 files / 26 tests passed（含 `packed-consumer-frameworks` 9 项） |
| `pnpm test:browser` | 14 passed（bootstrap 3、gallery 3、core-lifecycle 4、framework-lifecycle 4） |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |

`test:browser` 需按画廊迁移记录设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。

## 关键行为证据

- 双框架点击载荷等价：Vue 与 React 示例点击同一数据点，载荷均为 `{seriesId:'revenue', dataIndex:0, value:['周一',120], nativeType:'click'}`。
- StrictMode：开发态（5176）首次挂载后仅 1 个实例；`remount()` 后仍 1 个实例、点击只产生 1 次事件（旧监听已解除）、无页面错误。
- KeepAlive：切到占位视图后图表 DOM 移出文档、实例与数据保留；切回后 `single-instance` / `series-match` 自检通过；停用期间修改容器宽度，激活后画布跟随新宽度。
- SSR 安全：Node 环境（无 `window`/`document`）导入工作区产物与消费者安装的 ESM 均不访问浏览器全局，`LineChart` / `useChart` / `./line` 导出完整。
- 消费者真实性：`pnpm pack` 冻结三个 tarball（SHA-256 已记录）→ 工作区外临时目录 `npm install` → 解析路径位于消费者自身 `node_modules`（非工作区源码）；框架包 `package.json` 中 `@company/charts-core` 为精确版本且未被 `overrides` 重写；候选 core 通过 overrides 解析成功。
- 消费者类型检查：模板工程 `vue-tsc` / `tsc --noEmit` 通过；导入不存在导出与 `@company/charts-core/src/...` 源码别名均失败。
- 按需加载与纯净产物：消费者构建产物不含 `FunnelView` / `GaugeView` / `MapView` / `EffectScatter` / `BoxplotView` / `SankeyView`，不含 `packages/charts-*/src` 路径。
- 打包体积基线（初始校准值，护栏 1 MiB，记录于 `test-results/t03-bundle-baseline.json`）：Vue 消费者 JS `585,318` 字节，React 消费者 JS `742,797` 字节，CSS 均 `69` 字节；tarball 分别 `3,304` / `5,154` / `15,914` 字节。

## 实施期间发现并修复的问题

1. **SFC 产物泄漏构建机绝对路径**：`@vitejs/plugin-vue` 在 `isProduction` 为 false 时写入 `__file: <绝对路径>`，既泄漏路径又破坏产物可复现性。修复：构建脚本对 vite 子进程显式 `NODE_ENV=production`，并在插件选项中关闭 `prodDevtools`；集成测试对构建/类型检查子进程同样强制生产模式（测试进程 `NODE_ENV=test` 会传染）。
2. **样式入口必须显式导入**：示例与消费者未导入 `@company/charts-*/style.css` 时 `.charts-line` 无尺寸，控制器按预期等待 `ResizeObserver` 而不初始化——已在示例与消费者模板中显式导入并保留该行为断言。
3. **KeepAlive 缓存粒度**：`<KeepAlive>` 的直接子节点必须是组件才会缓存；包在元素 `<section>` 外层的写法会连元素一起销毁重建。示例改用 `ChartPane` 组件作为直接子节点。
4. **Turbo 本地缓存重放旧产物**：重复构建时 `.turbo` 缓存曾重放含 `__file` 的历史 `dist`。最终验证前清空缓存执行；副作用验收（pack/消费者）不依赖缓存，与规则一致。

## 未覆盖边界与后续

- 浏览器与消费者验证在上述 Linux 复现环境完成；建议在 Windows 开发机再执行一次 `.\scripts\pnpm.ps1 test:browser` 与 `.\scripts\pnpm.ps1 test` 作为原生确认。
- 就绪协议的 JSON Schema / 运行时校验属 G1，待 C 在 `packages/contracts` 落 validator；`CheckResult` / `ComponentExample` 形状已在对齐说明中冻结。
- T02 控制器当前为折线专用；T09 增加其他图表时把 config 泛化为图表类型联合，框架层 `config` 类型随之扩展。
- 依赖变更（`charts-vue` 增加 `vue-tsc 3.3.14`、`typescript 6.0.3`）已由 pnpm 生成 8 行锁文件差异，需 C 在合并时复核。
