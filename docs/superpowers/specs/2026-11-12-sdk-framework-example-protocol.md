# T03 双框架适配与示例就绪协议：公共接口对齐说明

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t03-adapters`。任务定义见 [实现计划 T03](../superpowers/plans/2026-11-11-component-platform-implementation.md)。

本文是 T03 开工前的接口对齐件，供 C（contracts / 根工具链）与 B（CLI / 消费者）评审。评审通过后 A 按本文实现；如有异议以本文更新版为准，再进入代码。

## 1. 范围与前置

- 输入：T02 已冻结并提交的 `@company/charts-core` 0.0.1 公共接口（`ChartData` / `ChartEvent` / `ChartConfig` / `LineChartConfig` / `SupportedOptionOverrides` / `buildLineOption` / `createChartController`）。
- 本任务交付：`@company/charts-vue` 0.0.1 与 `@company/charts-react` 0.0.1 的折线图组件、`./line` 子路径与样式入口、双框架示例（含统一就绪协议）、工作区外真实 tarball 消费者验收。
- 不在本任务：manifest / 截图 / 基线（T04）、bar/pie/scatter 与场景组件（T09）、 contracts 运行时校验（G1，C 主责）。

## 2. 框架包公共 API

两个包的组件 API 保持对等：同名 props / 回调、同一数据与事件语义，按框架惯例暴露（Vue 模板中用 `@point-click`，React 中用 `onPointClick`）。

### 2.1 导出面

| 入口 | 内容 |
| --- | --- |
| `.` | `LineChart`、`useChart` / `useLineChart`、组件与 hook 类型、自 core 重新导出的共享类型 |
| `./line` | 仅折线图入口（组件 + hook + 类型），供按需加载；`. ` 从 `./line` 聚合，T09 起按图表继续拆分 |
| `./style.css` | 容器基础样式（`.charts-line`），不含框架运行时 |

自 core 重新导出的共享类型（两包一致）：`ChartData`、`ChartSeries`、`ChartPoint`、`ChartEvent`、`ChartConfig`、`LineChartConfig`、`SupportedOptionOverrides`、`Renderer`、`ThemeName`、`UnitSpec`、`PointClickListener`、`Unsubscribe`。两包均不重新导出 `createChartController` / `buildLineOption`（高级用法请直接依赖 `@company/charts-core`，与 T02 文档一致）。

### 2.2 组件属性与事件

| Vue（`LineChart.vue`） | React（`LineChart.tsx`） | 类型 | 说明 |
| --- | --- | --- | --- |
| `data` | `data` | `ChartData` | 必填；更新按稳定 series id 合并，删除系列不残留 |
| `config` | `config` | `LineChartConfig` | 可选；`theme`/`renderer`/`unit`/`width`/`height`/`animation`/`smooth`/`area`/`connectNulls`/`xAxisName`/`yAxisName` |
| `optionOverrides` | `optionOverrides` | `SupportedOptionOverrides` | 可选；仅 grid/tooltip/legend/xAxis/yAxis/title 可深层合并 |
| — | `className` | `string` | 容器附加类名 |
| — | `style` | `CSSProperties` | 容器附加样式 |
| `@point-click` | `onPointClick` | `ChartEvent` | 统一载荷 `{seriesId, dataIndex, value:[x,y], nativeType}` |

- 容器：组件渲染单个 `div`，类名固定为 `charts-line`；容器需要明确宽高（由宿主 CSS 或 `config.width/height` 提供），零宽高等待 `ResizeObserver`。
- 生命周期：Vue 兼容 `KeepAlive` 激活后 `resize`；React 兼容 `StrictMode` 开发态 Effect 重复挂载/清理；两者卸载均解除监听、断开观察器并 `dispose()`，重复挂载只产生一个实例。
- 依赖声明：`vue`/`react`/`react-dom`/`echarts` 为 peer（精确实测版本 3.5.45 / 19.3.1 / 6.1.0），`@company/charts-core` 为普通依赖（打包时转精确版本）。

## 3. 示例就绪协议（`window.__COMPONENT_EXAMPLE__`）

示例页面（`examples/vue`、`examples/react`）在客户端挂载后暴露：

```ts
type CheckResult = { name: string; status: 'passed' | 'failed'; message?: string };
type ComponentExample = {
  readonly ready: Promise<void>;
  readonly states: readonly string[];   // A 提议新增：供 CLI 枚举可用状态
  runState(name: string): Promise<void>;
  getChecks(): CheckResult[];
};
```

语义约定（截图与消费验收共用，禁止以固定 sleep 代替就绪判定）：

- `ready`：组件已挂载、容器有效尺寸、`document.fonts.ready` 完成、控制器 `whenRendered()`（ECharts `finished`）后 resolve；随后刷新自检。
- `runState(name)`：切换到命名状态（初定 `default` / `empty` / `updated` / `missing` / `interaction`）并等待与 `ready` 相同条件；未知名称 reject 且保持当前状态不变。
- `getChecks()`：返回当前状态自检，至少包含 `single-instance`（实例数=1）、`no-page-error`（无未捕获 error / unhandledrejection）、`series-match`（系列 id 与状态定义一致）、`renderer-match`（实际渲染器与声明一致）。
- 页面级错误由示例启动时安装的 `error` / `unhandledrejection` 收集器计入 `no-page-error`。
- SSR 边界：协议相关模块顶层不访问 `window` / `document`，仅在客户端挂载后赋值全局。

需要 C 收口进 `packages/contracts/src/examples.ts`（G1）：`CheckResult`、`ComponentExample` 形状与 `COMPONENT_EXAMPLE_GLOBAL = '__COMPONENT_EXAMPLE__'` 常量；并增加 fixture 断言 `ExampleRef.requiredStates ⊆ 示例 states`。需要 B 确认：CLI 截图流程以 `ready` → `runState(state)` → `getChecks()` 驱动，`states` 枚举是否满足 T04 的 manifest `requiredStates` 需求。

## 4. 消费者模板与验收口径

- 模板：`tests/consumers/vue`、`tests/consumers/react`（A 建，供 B 复用）；自动化验收在 `tests/integration/packed-consumer.test.ts`。
- 口径（依 rules/testing-release.md）：`pnpm pack` 冻结 → 工作区外临时目录安装 tarball → 断言 `workspace:*` 已转精确版本、无私有依赖残留、`./line` 与 `./style.css` 可加载、Node 导入不访问 DOM、消费者 `tsc --noEmit` 通过、缺导出或源码 alias 必须失败、`vite build` 产物不含其他图表模块与跨包源码路径、真实浏览器渲染与点击载荷正确。
- 候选 core：消费者用 `overrides` 指向候选 core tarball；冻结的框架包 `package.json` 仍声明正式精确 core 版本，打包后不重写。

## 5. 需要 C 配合的工程变更

1. `packages/charts-vue` 增加 devDependencies `vue-tsc 3.3.14`、`typescript 6.0.3`（SFC 类型检查与声明 emit 的既有兼容例外，与 `examples/vue` 一致；根及其余包保持 TypeScript 7.0.2）；`rules/platform.md` 的编译器分层同步补充该例外范围。
2. `tests/playwright.config.ts` 增加 React 示例 dev 模式 webServer（`127.0.0.1:5176`）：StrictMode 双调用只发生在开发态，预览产物无法覆盖，规则要求验证该行为。
3. 合并本分支后由 C 执行一次 `pnpm install` 重新生成 `pnpm-lock.yaml`（A 不手工改锁文件）。

## 6. 已知边界与后续

- T02 控制器当前为折线专用（`createChartController(host, LineChartConfig)`）；T09 增加其他图表时把 config 泛化为图表类型联合，框架层 `config` 类型随之扩展。这是计划内扩展点，T03 不提前泛化。
- 就绪协议的 JSON Schema / 运行时校验属 G1，由 C 在 contracts 落 validator；本文只冻结形状与语义。
- API 清单由编译产物的类型/Props/Emits/TSX 生成（`docs/api/`），不与手写文档并行维护；示例与清单由测试交叉核对。

## 7. 实施结果（2026-11-12）

按本文实现完成，与本文的差异如下：

- 组件新增命令式句柄 `whenRendered()`：Vue 通过 `defineExpose`，React 通过 `ref` prop（React 19 约定，未使用已废弃的 `forwardRef`）。示例就绪协议依赖该信号判定渲染完成。
- Hook 名称统一为 `useChart`（两包一致），未提供 `useLineChart` 别名；`sameLineConfig` 一并导出供上层复用。
- 示例状态集合固定为 `default` / `empty` / `updated` / `missing` / `single`，数据与期望系列 id 由 `examples/fixtures/line.json` 统一驱动，保证两框架示例等价。
- 示例与消费者模板均显式导入 `<package>/style.css`；`.charts-line` 需要明确宽高，零宽高按设计等待 `ResizeObserver`。
- `charts-vue` 构建链为 `vue-tsc`（声明）+ `vite` 库模式（ESM）；构建对 vite 子进程强制 `NODE_ENV=production` 并关闭 `prodDevtools`，避免 SFC 产物写入构建机绝对路径（`__file`）。
- 集成测试命名为 `tests/integration/packed-consumer-frameworks.test.ts`：B 已在 `feat/t04-cli` 提交 `tests/integration/packed-consumer.test.ts`（charts-core 消费者），本任务聚焦框架包消费者，避免互相覆盖。
- `tests/playwright.config.ts` 增加 React 示例 dev webServer（`dev:strict`，端口 5176）用于 StrictMode 开发态验证。
