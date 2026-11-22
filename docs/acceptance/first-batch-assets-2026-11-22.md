# 首批组件资产与素材草案

2026-11-22。清单覆盖仓库现有 **7 个逻辑组件、14 个 Vue / React 实现**。负责人：本轮 QA 与材料整理为 Codex；业务说明确认及发布负责人待实际试用时登记。

本轮材料来自 `main` 基线 `b665681997ba842de6ed039652bf4f358771db6a` 的工作区示例，尚未上传或发布。现有包版本：`@company/charts-core@0.0.11`，`@company/charts-vue@0.0.12`，`@company/charts-react@0.0.12`。这说明被测源码版本，不证明相同版本已在目标注册表可用。

## 资产清单

组件 ID 沿用 fixture 名称；`<component>-vue` / `<component>-react` 是本清单建议的素材标识，实际 `variantReleaseId` 由平台发布登记生成。

| 组件 ID / 名称 | 分类与建议用途 | 两框架导出名 / 子路径 | 示例入口（两框架相同） | 特有配置与数据要求 | QA 草案图 |
| --- | --- | --- | --- | --- | --- |
| `line` / 折线图 | 基础图表；收入、成本与时间趋势 | `LineChart` / `./line` | `/index.html` | `smooth`、`area`、`connectNulls`、轴名称；`x` 为类目，`y:null` 表示缺失 | [Vue](first-batch-assets-2026-11-22/line-vue.png) · [React](first-batch-assets-2026-11-22/line-react.png) |
| `bar` / 柱状图 | 基础图表；类别间对比、分组或堆叠 | `BarChart` / `./bar` | `/bar.html` | `chart:'bar'`、`stack`、轴名称；负值保留、缺失柱不补零 | [Vue](first-batch-assets-2026-11-22/bar-vue.png) · [React](first-batch-assets-2026-11-22/bar-react.png) |
| `pie` / 饼图与环形图 | 基础图表；渠道构成与分层环形 | `PieChart` / `./pie` | `/pie.html` | `chart:'pie'`、`donut`；一个系列一圈，`x` 为扇形名称，负值非法 | [Vue](first-batch-assets-2026-11-22/pie-vue.png) · [React](first-batch-assets-2026-11-22/pie-react.png) |
| `scatter` / 散点图 | 基础图表；两个数值指标的分布 | `ScatterChart` / `./scatter` | `/scatter.html` | `chart:'scatter'`、轴名称；`x` 必须为数值，`y:null` 的点不显示 | [Vue](first-batch-assets-2026-11-22/scatter-vue.png) · [React](first-batch-assets-2026-11-22/scatter-react.png) |
| `trend-card` / 趋势卡片 | 场景组件；当前指标与前期对比 | `TrendCard` / `./trend-card` | `/trend-card.html` | `chart:'trend-card'`、`title`、`previousValue`；当前值取首系列末个非空值 | [Vue](first-batch-assets-2026-11-22/trend-card-vue.png) · [React](first-batch-assets-2026-11-22/trend-card-react.png) |
| `ranking` / 排行榜 | 场景组件；热门资产或指标 Top N | `Ranking` / `./ranking` | `/ranking.html` | `chart:'ranking'`、`direction`、`limit`、`title`；单系列，缺失项不排名，并列保留输入顺序 | [Vue](first-batch-assets-2026-11-22/ranking-vue.png) · [React](first-batch-assets-2026-11-22/ranking-react.png) |
| `proportion` / 占比条形图 | 场景组件；渠道份额与总量 | `Proportion` / `./proportion` | `/proportion.html` | `chart:'proportion'`、`title`；单系列，输入顺序不变，缺失项不进分母，零总量显示暂无数据 | [Vue](first-batch-assets-2026-11-22/proportion-vue.png) · [React](first-batch-assets-2026-11-22/proportion-react.png) |

## 共用数据与接入说明

实际共享数据类型是 `ChartData = { series: { id: string; name: string; points: { x: string | number; y: number | null }[] }[] }`。`id` 必须稳定且不可重复；不能把 `null` 转成 0。两框架均使用 `data` / `config` / `optionOverrides`，点击事件分别为 Vue `point-click` 与 React `onPointClick`，载荷统一为 `{ seriesId, dataIndex, value: [x, y], nativeType }`。

通用配置包括 `theme:'light'|'dark'`、`renderer:'canvas'|'svg'`、`animation`、`width`、`height`、`unit:{suffix,decimals}`。消费项目应引入对应 `@company/charts-vue/style.css` 或 `@company/charts-react/style.css`，并提供非零宽高的容器。图表背景透明，深色主题需要宿主提供合适背景。

示例使用确定性模拟数据，例如周一至周四收入/成本、搜索/直投/合作来源和活跃用户，不包含真实公司经营数据。所有当前输入、配置与导出以 `packages/charts-core/src/types.ts`、两个框架包的 `package.json#exports` / `src/index.ts` 及 `examples/fixtures/` 为事实依据。

## 已检查的数据状态

| 组件 | fixture 状态 |
| --- | --- |
| line | default、empty、updated、missing、single |
| bar / scatter | default、empty、missing、negative、single、updated |
| pie | default、empty、missing、zero-total、nested、updated、solid、solid-empty、solid-missing、solid-zero-total、solid-nested |
| trend-card | default、empty、missing、single、updated、down |
| ranking | default、empty、missing、single、updated、tied |
| proportion | default、empty、zero-total、missing、single、updated |

default 覆盖明暗主题、Canvas / SVG 与四种 viewport；额外状态只覆盖 1280×720 / light / canvas。结果及问题见 [本轮视觉验收](../verification/component-visual-acceptance-2026-11-22.md)。窄屏、深色宿主及空实心饼图自检尚有问题，不能用此清单宣布所有场景通过。

## 素材来源与正式发布前的缺项

14 张草案图从本轮 **1280×720 / light / canvas / default** 工作区页面截图裁出图表宿主，未改图表内容。原始页面 SHA-256 在 QA 汇总中，裁图 SHA-256 及来源坐标在 [素材索引](first-batch-assets-2026-11-22/index.json)。这些裁图便于内部挑选，不带 `ScreenshotRef` 或可信报告，不应直接作为本版本发布材料。

进入正式发布前，发布负责人需补齐：

1. 确认资产名称、说明、分类、维护人、版本与组件/包授权范围。
2. 构建并 `pnpm pack` 冻结候选 tarball，记录源提交与同一份包的 SHA-256；在工作区外干净消费者安装该包。
3. 从安装冻结 tarball 的消费者分别运行 Vue / React 示例并重新截图；至少为每个待发布实现关联一张正确版本与框架的图片，不复用另一框架图片。
4. 形成 API、docs、example/fixture 摘要、预览静态文件、截图、报告及 ReleaseManifest；校验大小、摘要、路径与每个实现的必需状态。截图后不重新打包。
5. 网页入口手动上传截图时，来源为 `manual-upload`、环境为 `unknown-manual`，不得伪造 `local-automatic`；CLI 自动来源需真实本地消费者证据。
6. 用有组件 ACL 和包 ACL 的 publisher 提交，等待三存储协调达到 Ready，再核对安装、目录、详情和隔离预览。Ready、检查来源、视觉基线和索引状态分别登记。

没有真实 Vue / React 业务项目，本轮不填写 T11 业务试点通过；后续可先进行受控内部试用，再由真实项目完成正式验收。
