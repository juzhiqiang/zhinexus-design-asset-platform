# T11/T12 SDK 消费方交接材料

日期：2026-11-13。负责人：A（SDK）。分支：`feat/t10-sdk-compatibility`，HEAD `190b60b`（SDK `0.0.10`）。

本文是**给业务方（真实试点项目）与 B/C 的 SDK 使用与回退交接材料**，不是验收证据。T11/T12 本身**未完成**：两个真实 Vue/React 业务试点未提供业务项目，T10 视觉矩阵未做，G2 未验收（见 [上线验收状态](../release-acceptance.md)）。本文只记录「怎么用、怎么退」，不声称上述任何一项已通过。

所有导入路径、包名、子路径、Props/Handle 形状均于 `190b60b` 从 `packages/charts-{core,vue,react}/package.json` 的 `exports` 与 `src/index.ts`、`src/<chart>.ts`、`src/<chart>-chart.types.ts` 逐条核对，未使用记忆或推测。

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

**命名注意**：排行榜与占比的**源文件**分别是 `RankingChart.vue` / `ProportionChart.vue`（避开大小写不敏感文件系统上的 `ranking.ts` 与 `RankingChart.tsx` 碰撞），但**导出名**是 `Ranking` / `Proportion`，两个框架一致。业务方按导出名导入，不要按文件名猜。

子路径是平台**逐导出覆盖校验**的对象：SDK 新增子路径导出必须同批扩展 `component-cli`，否则平台报 `ARTIFACT_MISMATCH`（见 [T09 图表组件交接](t09-chart-component-handover.md)）。业务方用子路径导入时，安装与发布链路会校验该子路径真实存在。

### 3.3 每条子路径还导出什么

以 `/line` 为范本（其余六条同构，`same<Chart>Config` 与类型名随图表替换）：

```ts
export { default as LineChart } from './LineChart.vue';   // React: from './LineChart.js'
export { useChart, sameLineConfig } from './useChart.js';
export type { UseChartOptions, UseChartResult } from './useChart.js';
export type { LineChartEmits, LineChartHandle, LineChartProps } from './line-chart.types.js';
export type { ChartConfig, ChartData, ChartEvent, /* … */ } from '@company/charts-core';
```

即每条子路径都带：该组件、`useChart`、`same<Chart>Config`、`UseChartOptions`/`UseChartResult`、该组件的 `Emits`/`Handle`/`Props`，以及 core 的公共类型。根入口额外带全部七个组件与全部 `same*Config`。

## 四、样式引入

样式**不会自动注入**，必须显式引入：

```ts
import '@company/charts-vue/style.css';      // 或
import '@company/charts-react/style.css';
```

两个框架的样式入口内容相同（同一份 `src/style.css` 构建产物），一个项目只装一个适配包、只引一份。样式只含图表宿主的最小布局约束，主题颜色由 `charts-core` 的 `lightTheme` / `darkTheme` 令牌在运行时写入 ECharts option，不在 CSS 里。

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

### 5.2 `config.chart` 判别字段

| 图表 | `chart` 字段 | 说明 |
| --- | --- | --- |
| `line` | `chart?: 'line'` | **可缺省**，缺省视为折线（兼容 T02/T03 既有调用方） |
| `bar` / `pie` / `scatter` / `trend-card` / `ranking` / `proportion` | `chart: '<type>'` | **必填判别字段**，缺失或写错都会被拒绝 |

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

每个组件都有 `whenRendered(): Promise<void>`，渲染完成（ECharts `finished`）后 resolve，用于截图与自动化就绪判定。`useChart(options)` 提供无组件版的同一能力：

- Vue：`host: Ref<HTMLElement | null>`，`data`/`config`/`optionOverrides` 均为 `Ref`，`onPointClick` 必填且需传稳定引用；返回 `{ controller, whenRendered }`。
- React：`host: RefObject<HTMLDivElement | null>`，`data` 为值、`config`/`optionOverrides` 可选，`onPointClick` 可选；返回 `{ whenRendered }`。

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

Vue：

```vue
<script setup lang="ts">
import { ref, onActivated, nextTick } from 'vue';
import { Ranking } from '@company/charts-vue/ranking';

const mounted = ref(false);
// 图表只在客户端挂载；SSR 阶段 mounted 为 false，不创建实例
onActivated(async () => {
  // KeepAlive：被缓存后再次激活时容器尺寸可能已变，需触发一次 resize
  await nextTick();
});
</script>

<template>
  <!-- 具体「仅客户端渲染」的写法取决于所用 SSR 框架（如 Nuxt 的 ClientOnly、
       或自建的 mounted 守卫）；关键是 SSR 输出里不出现图表容器 -->
  <Ranking v-if="mounted" :data="data" :config="config" />
</template>
```

React（StrictMode 下组件会被双调用，SDK 的清理逻辑会正确 dispose 并重挂载，业务方不需要额外处理；实测 `react_strictmode_cleans_and_remounts` 通过）：

```tsx
'use client';
import { Ranking } from '@company/charts-react/ranking';

export function RankingPanel({ data, config }: Props) {
  // 组件内部在 effect 中创建实例、在清理中 dispose；
  // StrictMode 的 mount→unmount→mount 不会残留第二个画布
  return <Ranking data={data} config={config} onPointClick={onPointClick} />;
}
```

### 6.3 截图就绪判定

用 `whenRendered()`，不要用固定 `sleep`。对 Vue 的 `useChart` / React 的 `useChart` 同样返回 `whenRendered`。示例页的完整就绪协议（`window.__COMPONENT_EXAMPLE__` 的 `ready` / `states` / `runState` / `getChecks`）见 G1 回执，业务方试点可复用同一约定以便平台截图。

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
截图就绪判定方式（whenRendered 还是固定等待）：
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
截图就绪判定方式（whenRendered 还是固定等待）：
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
- **大小写敏感文件系统的构建未实测**：`ranking.ts` 与 `RankingChart.tsx` 只差大小写，已按 `RankingChart.*` 命名规避 NTFS 碰撞，大小写敏感文件系统上的构建未验证。
- **本文不含验收结论**：T11 需要 M2/T08/T10 及真实试点通过，T12 最终验收需 T11 通过（见 [上线验收状态](../release-acceptance.md)）。

## 十、相关文档

- [ECharts 升级、兼容矩阵与回退](../echarts-upgrade.md)：兼容策略口径、候选查证、回退目标。
- [发布与恢复操作边界](../publishing.md)：不可变发布、幂等恢复、缺件恢复。
- [上线验收状态](../release-acceptance.md)：T11/T12 各项当前状态与负责人。
- [A→B 接口交接](t10-a-to-b-interface-handover.md)：`compatibility.ts` 的策略函数与 `supported` 约定。
- [T09 SDK 证据核对](t09-sdk-evidence-audit.md)：七组件 14 实现的证据盘点。
