# T11/T12 SDK 消费方交接材料

日期：2026-11-13。负责人：A（SDK）。分支：`feat/t10-sdk-compatibility`，HEAD `190b60b`（SDK `0.0.10`）。

本文是**给业务方（真实试点项目）与 B/C 的 SDK 使用与回退交接材料**，不是验收证据。T11/T12 本身**未完成**：两个真实 Vue/React 业务试点未提供业务项目，T10 视觉矩阵未做，G2 未验收（见 [上线验收状态](../release-acceptance.md)）。本文只记录「怎么用、怎么退」，不声称上述任何一项已通过。

所有导入路径、包名、子路径、Props/Handle 形状均于 `190b60b` 从 `packages/charts-{core,vue,react}/package.json` 的 `exports` 与 `src/index.ts`、`src/<chart>.ts`、`src/<chart>-chart.types.ts` 逐条核对，未使用记忆或推测。**2026-11-13 修订**（独立评审复现五项，均在 `190b60b` 源码与 `0.0.10` 构建产物上核对后修正，未改动任何 SDK 源码、未重新打包、未升版）：§3.2 命名碰撞原因改为 `ranking.js` 与 `Ranking.js` 产物名碰撞；§3.3 明确 React 子路径不导出 `Emits`；§3.3 末精确列出 option/entry 类型只有五个、其余须从 `@company/charts-core` 导入；§5.2 去掉「`chart` 缺失或写错运行时会被拒绝」的不实承诺；§5.5/§6.3 限定 `whenRendered` 的调用前提；§6.2 修正 Vue SSR 片段（补 `onMounted` 与 `defineProps`）与 KeepAlive 表述、React 片段改为只依赖真实导出；§4 补样式副作用导入在裸 `tsc` 下需要 `*.css` 声明；§9 删去「大小写敏感文件系统构建未实测」的不实项。

## 一、可用的已验版本

| 版本 | 状态 | 说明 |
| --- | --- | --- |
| `0.0.10` | C 已于 2026-11-13 在 Windows 原生验收 | offline 安装 344 包 0 下载；force build/typecheck 20/20 零缓存；unit+contracts 379 通过；TS6/7 × Bundler/NodeNext 四组严格消费者 0 错误；17 个公开入口通过；旧 `CombinationResult` 形状通过；公开策略六反例全过；同一冻结三包完成真实三存储 READY、14 个 HTTPS 预览 × 5 项检查、Vue/React 各 7 个精确 Registry 导出 |
| `0.0.6` | 最后一次 Windows 原生**全图**验收（`885792b`） | build 10、typecheck 14 + 根 tsc、unit/contracts 322、packed-consumer + cli-bundle 12、完整浏览器 122 |
| `0.0.7` / `0.0.8` / `0.0.9` | 中间版本，均有已知策略缺陷 | `0.0.7` 的策略判定被独立评审复现存三个 Important 缺陷；`0.0.8` 引入必填字段破坏公开类型；二者均已由后续版本修复。**不要作为回退目标** |

回退目标只能是 `0.0.10`（当前）或 `0.0.6`（末次全图验收）。不要回退到 `0.0.7`–`0.0.9`。

## 二、依赖关系：业务方必须自备什么

| 包 | 角色 | 谁安装 |
| --- | --- | --- |
| `@company/charts-vue` / `@company/charts-react` | 框架适配包，业务方直接依赖 | 业务方 |
| `@company/charts-core` | 共享核心，**普通依赖** | 由适配包带入，业务方通常不直接声明 |
| `echarts@6.1.0` | **peerDependencies** | **业务方必须自行安装精确版本** |
| `vue@3.5.45` / `react@19.3.1` + `react-dom@19.3.1` | **peerDependencies** | **业务方必须自行安装精确版本** |

`strictPeerDependencies: true` + `saveExact: true`（`rules/testing-release.md`）：peer 锁定精确版本，装错版本 `npm install` 直接 `ERESOLVE` 退出 1，不会静默降级。业务方 `package.json` 里这三个 peer 必须逐个写精确版本，不要用范围。

`@company/charts-core` 只有一条导出（`.`），其类型（`ChartData`、`ChartEvent`、`Renderer`、`ThemeName`、各 `*ChartConfig` 等）已由两个适配包从根入口再导出，业务方从适配包导入即可，无需直接依赖 core。若确需 core 的纯函数（`normalizeChartData`、`computeRanking`、`formatPercent` 等），可显式安装 core 并从 `@company/charts-core` 导入。

## 三、七组件 × 14 实现的精确导入矩阵

七个逻辑组件：`line`、`bar`、`pie`、`scatter`、`trend-card`、`ranking`、`proportion`。每个框架 7 个实现，共 14 个。两个框架的组件导出名完全一致。

### 3.1 根入口一次导入

Vue：

```ts
import {
  LineChart, BarChart, PieChart, ScatterChart,
  TrendCard, Ranking, Proportion,
} from '@company/charts-vue';
```

React：

```tsx
import {
  LineChart, BarChart, PieChart, ScatterChart,
  TrendCard, Ranking, Proportion,
} from '@company/charts-react';
```

### 3.2 子路径按需导入（推荐）

| 组件 | Vue 导入 | React 导入 | 导出名 |
| --- | --- | --- | --- |
| 折线图 | `@company/charts-vue/line` | `@company/charts-react/line` | `LineChart` |
| 柱状图 | `@company/charts-vue/bar` | `@company/charts-react/bar` | `BarChart` |
| 饼图 | `@company/charts-vue/pie` | `@company/charts-react/pie` | `PieChart` |
| 散点图 | `@company/charts-vue/scatter` | `@company/charts-react/scatter` | `ScatterChart` |
| 趋势卡片 | `@company/charts-vue/trend-card` | `@company/charts-react/trend-card` | `TrendCard` |
| 排行榜 | `@company/charts-vue/ranking` | `@company/charts-react/ranking` | `Ranking` |
| 占比 | `@company/charts-vue/proportion` | `@company/charts-react/proportion` | `Proportion` |

```ts
// Vue
import { Ranking } from '@company/charts-vue/ranking';
// React
import { Ranking } from '@company/charts-react/ranking';
```

**命名注意**：子路径入口模块是 `ranking.ts` / `proportion.ts`，而组件**源文件**是 `RankingChart.vue` / `ProportionChart.vue`（Vue）与 `RankingChart.tsx` / `ProportionChart.tsx`（React），**导出名**是 `Ranking` / `Proportion`，两个框架一致。源文件不按导出名命名（即不叫 `Ranking.vue` / `Ranking.tsx`）的原因：那样它会与子路径入口 `ranking.ts` 分别产出 `Ranking.js` 与 `ranking.js`，在大小写不敏感的文件系统（Windows NTFS、macOS 默认）上是同一个文件，TypeScript 直接报 `TS5056: ... would be overwritten by multiple input files`。业务方按**导出名**导入，不要按文件名猜。

子路径是平台**逐导出覆盖校验**的对象：SDK 新增子路径导出必须同批扩展 `component-cli`，否则平台报 `ARTIFACT_MISMATCH`（见 [T09 图表组件交接](t09-chart-component-handover.md)）。业务方用子路径导入时，安装与发布链路会校验该子路径真实存在。

### 3.3 每条子路径还导出什么

**两个框架的子路径导出不完全相同**：Vue 子路径额外导出该组件的 `Emits` 类型，React 子路径**没有** `Emits`（React 的点击走 `onPointClick` prop，没有独立事件名）。

Vue `/line`（其余六条同构，`same<Chart>Config` 与类型名随图表替换）：

```ts
export { default as LineChart } from './LineChart.vue';
export { useChart, sameLineConfig } from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { LineChartEmits, LineChartHandle, LineChartProps } from './line-chart.types.js';
export type { ChartConfig, ChartData, ChartEvent, /* … */ } from '@company/charts-core';
```

React `/line`（**无 `LineChartEmits`**，其余同构）：

```ts
export { LineChart } from './LineChart.js';
export { useChart, sameLineConfig } from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { LineChartHandle, LineChartProps } from './line-chart.types.js';
export type { ChartConfig, ChartData, ChartEvent, /* … */ } from '@company/charts-core';
```

即每条子路径都带：该组件、`useChart`、该组件自己的 `Handle`/`Props`，以及 core 的公共类型；Vue 侧再多一个 `Emits`。`same<Chart>Config` 与 core 类型的**实际集合逐条不同**，不要按上表推断：

- `same*Config`：`/line` 只有 `sameLineConfig`；`/bar` 起累计前序（`/bar` 有 `sameBarConfig` + `sameLineConfig`，`/pie` 三个，依此递增）；`/ranking` 与 `/proportion` 两条带齐全部七个。`/line` 到 `/proportion` 的顺序即上一小表格的行序。
- core 类型：每条子路径导出**该图表自己的 `*ChartConfig`** 加同一组 11 个公共类型（`ChartConfig`、`ChartData`、`ChartEvent`、`ChartPoint`、`ChartSeries`、`PointClickListener`、`Renderer`、`SupportedOptionOverrides`、`ThemeName`、`UnitSpec`、`Unsubscribe`）。因此 `/bar` 导出 `BarChartConfig` 而不导出 `LineChartConfig`。

根入口比子路径多：全部七个组件、全部七个 `same*Config` 加 `sameChartConfig`、全部七组 `Handle`/`Props`、Vue 侧全部七个 `Emits`、25 个 core 类型，以及 `getVueRuntimeInfo()` / `getReactRuntimeInfo()` 工程探针。

这 25 个 core 类型 = 七个 `*ChartConfig` + 子路径那 11 个公共类型 + `AnyChartConfig` + `ChartType` + **五个 option/entry 类型**。**option/entry 类型只有五个，不要以为「各图表都有」**：

| 能从适配包根入口导入 | 只能从 `@company/charts-core` 导入 |
| --- | --- |
| `ProportionChartOption`、`ProportionShare`、`RankingChartOption`、`RankingDirection`、`RankingEntry` | `LineChartOption`、`BarChartOption`、`PieChartOption`、`ScatterChartOption`、`TrendCardOption`、`ChartComponentOption` |

也就是说 `LineChartOption` 这类**不**在 `@company/charts-vue` / `@company/charts-react` 的根入口里，从适配包导入会直接 `TS2305` / `TS2724`（已实测复现）。需要它们时显式依赖 `@company/charts-core` 并从那里导入——它是**普通依赖**（不是 peer），随适配包一起安装，在消费者的 `node_modules` 里本就解析得到，但建议在 `package.json` 里显式写出以便锁定版本。

## 四、样式引入

样式**不会自动注入**，必须显式引入：

```ts
import '@company/charts-vue/style.css';      // 或
import '@company/charts-react/style.css';
```

两个框架的样式入口内容相同（同一份 `src/style.css` 构建产物），一个项目只装一个适配包、只引一份。样式只含图表宿主的最小布局约束，主题颜色由 `charts-core` 的 `lightTheme` / `darkTheme` 令牌在运行时写入 ECharts option，不在 CSS 里。

**裸 `tsc`（不经 Vite）需要自己声明 CSS 模块**：`import '@company/charts-vue/style.css'` 在只有 `tsc --noEmit` 的工程里会报 `TS2882: Cannot find module or type declarations for side-effect import`，加一句 `declare module '*.css';` 即可。用 Vite 的工程不需要——`vite/client` 已带该声明。

## 五、Props、配置与事件

### 5.1 Props：Vue 三件套，React 三件套 + 四项框架适配

Vue（七个组件同构）：

```ts
type LineChartProps = {
  data: ChartData;              // 必填
  config?: LineChartConfig;     // 可选
  optionOverrides?: SupportedOptionOverrides;  // 可选
};
```

React（七个组件同构）：

```tsx
type LineChartProps = {
  data: ChartData;              // 必填
  config?: LineChartConfig;     // 可选
  optionOverrides?: SupportedOptionOverrides;  // 可选
  onPointClick?: (event: ChartEvent) => void;  // React 侧点击走 props，不是单独事件名
  className?: string;
  style?: CSSProperties;
  ref?: Ref<LineChartHandle | null>;           // 取 whenRendered 用
};
```

`config` 的类型随图表替换（`BarChartConfig`、`RankingChartConfig` …）。`ChartData` 的形状是 `{ series: ChartSeries[] }`，`ChartSeries` 是 `{ id, name, points }`、`ChartPoint` 是 `{ x, y }`；`y` 为 `null` 表示缺失值（**不补 0**，也不进入统计分母）。

**两框架差异要点**：Vue 用 `@point-click` 监听事件、用模板 ref 取句柄；React 用 `onPointClick` prop、用 `ref` 取句柄。除此之外 `data` / `config` / `optionOverrides` 的语义完全一致，配置可互换。

### 5.2 `config.chart` 判别字段：类型层约束，运行时无校验

| 图表 | `chart` 字段 | 说明 |
| --- | --- | --- |
| `line` | `chart?: 'line'` | **可缺省**，缺省视为折线（兼容 T02/T03 既有调用方） |
| `bar` / `pie` / `scatter` / `trend-card` / `ranking` / `proportion` | `chart: '<type>'` | **类型层必填**：TS 判别联合要求字面量与组件匹配，写错编译不过 |

**整个 `config` 可以省略**。两个框架的 `useChart` 在 `config` 为 `undefined` 时填入该组件自己的缺省配置（`defaultConfig(chart)`，如排行榜得到 `{ chart: 'ranking' }`），`chart` 由组件内部固定传对，业务方不写 `config` 也能拿到正确图表。

**但运行时没有任何校验，不要指望它拒绝错误输入。** `charts-core` 的 `chartTypeOf(config)` 是一串 `if` 匹配，匹配不上就 `return 'line'`，既不抛错也不告警。两种实际情况：

- 提供了 `config` 对象但里面没有 `chart`（只有未类型化的输入能做到，TS 下 `BarChartConfig` 等要求该字段）：`chartTypeOf` 回落到 `'line'`。例如给 `Ranking` 传 `{}`，渲染出来的是**折线图**，不报错。
- `config.chart` 是另一个合法字面量（如给 `Ranking` 传 `{ chart: 'pie' }`）：控制器按 `'pie'` 建图，同样不报错。

因此判别字段的保障**来自 TS 类型，不是运行时**。类型化的业务方由编译期挡住；JS 调用方或经接口/JSON 透传的配置需自行保证 `chart` 与组件一致。

### 5.3 主题与渲染器：切换必须重建实例

`config.theme`（`'light' | 'dark'`）与 `config.renderer`（`'canvas' | 'svg'`）变化时，SDK 会销毁并用当前数据重建 ECharts 实例（`rules/platform.md`：不能在 option 层改写）。业务方**不要**自己缓存实例或手动 `setOption` 改渲染器。light/dark × Canvas/SVG 是**声明支持矩阵**，四组合在 14 个实现上都有实测（`tests/browser/presentation-matrix.spec.ts` 56 例）。

### 5.4 事件：两框架载荷同构

Vue 用 `@point-click`，React 用 `onPointClick`，载荷是同一个 `ChartEvent`：

```ts
type ChartEvent = {
  seriesId: string;
  dataIndex: number;
  value: [string | number, number | null];
  nativeType: string;
};
```

### 5.5 命令式句柄与 `useChart`

每个组件都通过句柄暴露 `whenRendered(): Promise<void>`，渲染完成（ECharts `finished`）后 resolve，供截图与自动化就绪判定。`useChart(options)` 提供无组件版的同一能力：

- Vue：`host: Ref<HTMLElement | null>`，`data`/`config`/`optionOverrides` 均为 `Ref`，`onPointClick` 必填且需传稳定引用；返回 `{ controller, whenRendered }`。组件的模板 ref 拿到的是 `defineExpose({ whenRendered })`，即 `{ whenRendered }`。
- React：`host: RefObject<HTMLDivElement | null>`，`data` 为值、`config`/`optionOverrides` 可选，`onPointClick` 可选；返回 `{ whenRendered }`（**不返回 controller**，句柄只能取到 `whenRendered`）。组件用 `ref` prop + `useImperativeHandle` 暴露同一个 `{ whenRendered }`。

**`whenRendered()` 有调用前提，不能无条件当截图就绪信号**（两侧实现相同，见 `packages/charts-core/src/controller.ts` 与两个 `useChart.ts`）：

1. **控制器必须已建立**。Vue 侧是 `controller.value?.whenRendered() ?? Promise.resolve()`，React 侧是 `controllerRef.current?.whenRendered() ?? Promise.resolve()`——控制器为 `null`（尚未挂载、已卸载）时**立即 resolve**，那不是渲染完成。
2. **容器必须已有有效尺寸**。挂载时容器零宽高或处于隐藏状态，SDK 不创建实例，而是等 `ResizeObserver` 拿到非零尺寸才初始化；这期间 `whenRendered()` 同样立即 resolve。
3. **渲染必须已触发**。控制器刚建立时内部 `pendingRender` 也是已 resolve 的 promise，只有这次 `setOption` 触发的 `finished` 才唤醒等待者。

因此截图与自动化就绪判定的正确做法是：**客户端挂载后、容器有非零宽高时再调用**；容器初始隐藏（折叠面板、Tab 页、`display:none`）时，先等它可见再调用。SSR 阶段不要调用。

## 六、SSR 安全导入与客户端挂载

### 6.1 导入层：安全

构建产物在 Node 环境（无 `window` / `document`）下直接 `import` 不报错——顶层不访问浏览器全局。实测入口（`tests/browser/framework-lifecycle.spec.ts` 的 `ssr_import_has_no_dom_access`）：

```
packages/charts-vue/dist/index.js
packages/charts-vue/dist/line.js
packages/charts-react/dist/index.js
packages/charts-react/dist/line.js
```

四条均导入成功且 `LineChart` 已定义。因此业务方可以在 SSR 宿主的模块顶层 `import` 这些入口，不会因为导入就崩。

### 6.2 渲染层：必须客户端

**SSR 宿主只承诺安全导入，不提供服务端图表渲染。** ECharts 需要真实 DOM 与 canvas，服务端不要尝试渲染图表、不要调用 `whenRendered`、不要把图表标记为已挂载。业务方的 SSR 框架需要把图表区域放到客户端才挂载的分支里。

Vue（`mounted` 必须在 `onMounted` 里置真，否则 SSR 输出之后图表永远不挂载）：

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ChartData, RankingChartConfig } from '@company/charts-vue';
import { Ranking } from '@company/charts-vue/ranking';

const props = defineProps<{ data: ChartData; config?: RankingChartConfig }>();

// SSR 阶段 mounted 为 false，服务端输出里不出现图表容器
const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});
</script>

<template>
  <!-- 「仅客户端渲染」的写法取决于所用 SSR 宿主：Nuxt 用 <ClientOnly> 包裹，
       自建宿主用上面的 mounted 守卫；关键是 SSR 输出里不出现图表容器 -->
  <Ranking v-if="mounted" :data="props.data" :config="props.config" />
</template>
```

**KeepAlive 不需要业务方写 `onActivated`。** `useChart` 内部已注册 `onActivated(() => controller.value?.resize())`：停用时实例与数据保留，激活后自动按新容器尺寸 resize。业务方只要把组件放进 `<KeepAlive>` 即可，自己再调一次 resize 或 `nextTick` 反而多余。该路径有实测覆盖（`tests/browser/framework-lifecycle.spec.ts` 的 `vue_keepalive_resizes_on_activate`：停用期间改容器宽度，激活后画布跟随新尺寸，且始终只有一个实例）。

React（StrictMode 下组件会被双调用，SDK 的清理逻辑会正确 dispose 并重挂载，业务方不需要额外处理；实测 `react_strictmode_cleans_and_remounts` 通过）：

```tsx
'use client';
import { Ranking } from '@company/charts-react/ranking';
import type { RankingProps } from '@company/charts-react/ranking';

export function RankingPanel(props: RankingProps) {
  // 组件内部在 effect 中创建实例、在清理中 dispose；
  // StrictMode 的 mount→unmount→mount 不会残留第二个画布
  return <Ranking {...props} />;
}
```

React 侧点击走 `onPointClick` prop（`RankingProps` 已含它），没有 Vue 那样的 `@point-click` 事件名；句柄用 `ref` prop 取，`RankingHandle` 只有 `whenRendered`。

### 6.3 截图就绪判定

用 `whenRendered()`，不要用固定 `sleep`——但**必须满足第 5.5 节的三个前提**：客户端已挂载、容器有非零宽高、渲染已触发。控制器未建立时 `whenRendered()` 会立即 resolve，把它当成就绪信号会拍到空画布。Vue 的 `useChart` / React 的 `useChart` 同样返回 `whenRendered`，前提相同。示例页的完整就绪协议（`window.__COMPONENT_EXAMPLE__` 的 `ready` / `states` / `runState` / `getChecks`）见 G1 回执，业务方试点可复用同一约定以便平台截图。该协议的做法值得照抄：它**先等 DOM 里的系列快照相对上一状态真正发生变化**（`document.fonts.ready` 后轮询系列 id 快照，超时即报错），确认图表确实画出来了，**之后**才 `await whenRendered()`——正是为了绕开「控制器没建好就立即 resolve」这个陷阱。

## 七、从不可变旧版回退到已验版本

### 7.1 原则

**已发布版本不可变**：任何版本一旦发布到 Verdaccio 即冻结，不能覆盖、不能删除重发（`AGENTS.md` 不可违反约束）。因此「回退」永远是**把消费方的依赖指向旧版**，而不是让注册表换个内容。同名同版本不同摘要必须报 `CONFLICT` 并失败关闭。

### 7.2 业务方回退步骤

```powershell
# 1) 确认目标已验版本（当前 0.0.10；末次全图验收 0.0.6）
#    不要选 0.0.7 / 0.0.8 / 0.0.9——三者有已知缺陷

# 2) 改 package.json 为精确版本，不用范围
#    "@company/charts-vue": "0.0.10"   （react 同理）
#    "echarts": "6.1.0"                （peer 必须精确）

# 3) 干净安装（锁定文件同步更新；不要手工编辑 pnpm-lock.yaml）
npm install --no-audit --no-fund

# 4) 核对注册表实际解析到的就是目标版本
npm ls @company/charts-vue @company/charts-core echarts

# 5) 类型与构建
npx tsc -p tsconfig.json --noEmit
npx vite build

# 6) 冒烟：七个组件各渲染一次，确认画布数量与主题令牌
```

### 7.3 什么时候不要回退

- **预期视觉变化未确认时**：任何预期视觉变化（升级、主题令牌调整、渲染器切换）都必须**显式基线确认**。`environmentKey` 不一致时返回 `INCOMPATIBLE`，不得自动判过；网页手动上传截图的 `environmentKey` 固定为 `unknown-manual`，不能用于建立或更新自动回归基线。没有基线可比时，回退本身也需要人确认。
- **仅为躲一次失败时**：先看 `requestId` / `jobId` 对应的 JSON 日志与审计，确认真是 SDK 问题再回退。

### 7.4 仓库侧回退

A/B/C 自己仓库的回退（git 层面）见 [ECharts 升级、兼容矩阵与回退](../echarts-upgrade.md) 第 6.1–6.3 节；根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`turbo.json` 由 C 统一收口，业务方与 A 都不要手工改锁文件。

## 八、Vue / React 真实试点待填回执（未完成）

以下两份回执**均为空白模板**。两个真实业务试点尚未提供业务项目，T11/T12 未完成。回执由试点负责人在真实业务项目中填写后提交，不要由代理会话代填，也不要把本地合成样本计为真实试点。

### 8.1 Vue 真实试点回执

```text
业务项目名称与仓库：
试点负责人（实际评审人）：
联系渠道或评审记录链接：
填写日期时间（Asia/Shanghai）：

安装的 SDK 版本（精确 x.y.z）：
echarts / vue 版本（peer，必须精确）：
安装方式（Registry 精确版本 / 冻结 tarball，二选一并给出来源）：
冻结 tarball SHA-256（若用 tarball）：

使用的组件与导入入口（逐条列：组件名 + 根入口或 /line 等子路径）：
样式引入方式（是否显式 import '@company/charts-vue/style.css'）：
主题与渲染器组合（light/dark × canvas/svg，实际用了哪几种）：
数据规模与形态（系列数、点数、是否存在缺失值 null）：

SSR 场景（是否有 SSR 宿主；若有，导入层是否安全、图表是否仅在客户端挂载）：
KeepAlive / 动态组件场景（若有，activate 后是否触发 resize）：
截图就绪判定方式（是否 whenRendered；调用时客户端是否已挂载、容器是否有非零宽高）：
点击事件是否验证（载荷是否为 seriesId/dataIndex/value/nativeType 四字段）：
类型检查命令与结果：
构建命令与结果：
本地浏览器冒烟命令与结果：

遇到的失败与恢复步骤（含回退到哪个已验版本、为什么）：
遗留问题：
结论：待试点负责人填写
```

### 8.2 React 真实试点回执

```text
业务项目名称与仓库：
试点负责人（实际评审人）：
联系渠道或评审记录链接：
填写日期时间（Asia/Shanghai）：

安装的 SDK 版本（精确 x.y.z）：
echarts / react / react-dom 版本（peer，必须精确）：
安装方式（Registry 精确版本 / 冻结 tarball，二选一并给出来源）：
冻结 tarball SHA-256（若用 tarball）：
@types/react 与 @types/react-dom 版本（须与 react 匹配）：

使用的组件与导入入口（逐条列：组件名 + 根入口或 /line 等子路径）：
样式引入方式（是否显式 import '@company/charts-react/style.css'）：
主题与渲染器组合（light/dark × canvas/svg，实际用了哪几种）：
数据规模与形态（系列数、点数、是否存在缺失值 null）：

SSR 场景（若有 SSR 宿主，导入层是否安全、图表是否仅在客户端挂载）：
StrictMode 场景（是否开启；双调用后画布数量是否为 1）：
并发特性使用情况（Suspense / transition 等，若有）：
截图就绪判定方式（是否 whenRendered；调用时客户端是否已挂载、容器是否有非零宽高）：
点击事件是否验证（onPointClick 载荷是否与 Vue 侧一致）：
类型检查命令与结果：
构建命令与结果：
本地浏览器冒烟命令与结果：

遇到的失败与恢复步骤（含回退到哪个已验版本、为什么）：
遗留问题：
结论：待试点负责人填写
```

## 九、未覆盖边界（不声称项）

- **两个真实业务试点未完成**：未提供业务项目，第八节两份回执为空白模板。
- **T10 视觉矩阵未完成**：`echarts@6.0.0` 候选的视觉维度为 `not-run`，没有截图基线；跨版本升级矩阵也未完成（官方 `latest` 与基线同为 `6.1.0`，无新上游版本）。因此 `peerDependencies.echarts` 保持 `6.1.0`，未扩大。
- **G2 未验收**：本地 G2 探针与备份/容量预演是 C 的本地验证，不等于生产验收。
- **生产三存储发布未做**：真实 Verdaccio / PostgreSQL / MinIO 与公司 OIDC 不在本机可用范围。
- **文件系统大小写敏感性已两侧覆盖**：`RankingChart.*` 的命名是为了避免 `ranking.js` 与 `Ranking.js` 在大小写不敏感文件系统上碰撞（`TS5056`）。A 的 Linux 复现环境本身是大小写敏感的（已实证：同目录下 `A.txt` 与 `a.txt` 是两个文件），全量构建在其上通过；C 另在 Windows（NTFS，大小写不敏感）上对 `190b60b` 完成强制 build/typecheck 20/20。两侧都不是「未实测」。
- **本文不含验收结论**：T11 需要 M2/T08/T10 及真实试点通过，T12 最终验收需 T11 通过（见 [上线验收状态](../release-acceptance.md)）。

## 十、相关文档

- [ECharts 升级、兼容矩阵与回退](../echarts-upgrade.md)：兼容策略口径、候选查证、回退目标。
- [发布与恢复操作边界](../publishing.md)：不可变发布、幂等恢复、缺件恢复。
- [上线验收状态](../release-acceptance.md)：T11/T12 各项当前状态与负责人。
- [A→B 接口交接](t10-a-to-b-interface-handover.md)：`compatibility.ts` 的策略函数与 `supported` 约定。
- [T09 SDK 证据核对](t09-sdk-evidence-audit.md)：七组件 14 实现的证据盘点。
