# 二期离线评估协议与标注数据集规范（Evaluation Protocol）

制定日期：2026-11-15  
基线：`fa24ab525e5945e7096ed816a83f11962ba5f000`（分支 `feat/a-phase2-profiles`）  
参考依据：`docs/plans/2026-11-11-component-platform-implementation.md`（T13 / T14）、`docs/phases/phase2/component-profiles.md`

> [!WARNING]
> **当前样本与契约状态声明**：
> 1. 本仓库当前**尚未具备 30 个真实业务标注样本**。本协议仅定义标注集 Schema、指标口径、陷阱案例规范，并提供**明确标记为 `synthetic` 的格式示例**用于后续跑通校验管道；任何情况下不得将 `synthetic` 样本计入 T14「不少于 30 个真实标注案例」的验收基数。
> 2. 本文档中的 `DesignEvalCaseV1` 与 `MatchPlanV1` **仅为二期文档草案**，**不是** `packages/contracts` 中已冻结的公共 DTO；正式契约须在 T13/T14 实施阶段由 `@company/contracts` 统一定义与导出。

---

## 1. 评估目标与独立验收集原则

本协议用于客观评估 T13（多模态检索与兼容过滤）与 T14（设计稿解析与装配方案 `MatchPlanV1`）的质量，防止以下常见失真：

1. **只报总分掩盖关键失效**：必须输出总样本数、真实/合成来源分布、各类别分项指标以及**逐例失败原因**。
2. **编造不存在的 API 或违反组件语义**：例如推荐 `RankingChart`（真实导出为 `Ranking`）、为 `pie` 传入负值数据、将 `manual-upload` 来源的资产标注为 `local-automatic` 已自动回归。
3. **跨框架 / 跨版本硬违规**：例如在 React 19 项目中推荐 `vue` 变体，或在 `echarts` / `vue` / `react` peer 版本不满足时强行装配。
4. **对图上不可见口径胡乱猜测**：例如设计稿未标明时间粒度、`unit` 单位或 `trend-card` 的 `previousValue` 时，未写入 `unknown` / `gaps` 而自行编造数值或业务口径。

---

## 2. 评估样本数据结构草案（`DesignEvalCaseV1`）

> 注：`DesignEvalCaseV1` 为二期评估集文档草案，尚未进入 `packages/contracts` 公共契约。

建议 T14 评估集文件存放于 `tests/evaluation/design-cases.json`（本文档只定规范，不在本次任务创建该文件）。每条案例须符合以下字段约定：

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "caseId": "string (唯一标识)",
      "origin": "real | synthetic",
      "split": "eval",
      "category": "matchable | no-match | missing-constraint | cross-framework-trap | api-trap | data-semantic-trap",
      "sourceDescription": "string (设计稿来源、脱敏业务场景或合成构造说明)",
      "designInput": {
        "imageRef": "string (设计稿截图相对路径或待采集占位符)",
        "viewport": { "width": 1280, "height": 800 },
        "regions": [
          {
            "regionId": "string",
            "bbox": [0, 0, 400, 300],
            "visibleHints": ["string (图上可见的标题、轴标签、图例、数值格式等)"],
            "hiddenOrAmbiguous": ["string (图上不可见的业务口径、单位、同比基线、交互事件要求等)"]
          }
        ]
      },
      "projectContext": {
        "framework": "vue | react",
        "frameworkVersion": "string (精确版本 x.y.z)",
        "echartsVersion": "string (可选精确版本 x.y.z)",
        "packageManager": "pnpm | npm",
        "requirements": ["string (业务需求描述)"]
      },
      "evalEnvironment": {
        "reactDomVersion": "string (可选独立评估环境证据，仅 react 时使用，不写入 projectContext)"
      },
      "groundTruth": {
        "acceptableCandidates": [
          {
            "componentId": "line | bar | pie | scatter | trend-card | ranking | proportion",
            "variantId": "string (如 line-react)",
            "rankPriority": 1,
            "requiredConfigKeys": ["string (必须正确映射的 config 字段)"]
          }
        ],
        "requiredGaps": [
          {
            "field": "string (如 config.previousValue / config.unit / data.series)",
            "reason": "string (为何必须进入 unknown / gaps)"
          }
        ],
        "forbiddenActions": [
          "string (触发即判定为硬违规的具体行为标签)"
        ]
      }
    }
  ]
}
```

### 字段约束说明

- `origin` 必须显式区分 `"real"` 与 `"synthetic"`；正式 T14 验收门禁只统计 `origin === "real"` 且 `split === "eval"` 的样本（目标不少于 30 例，其中陷阱/无匹配/缺约束样本不少于 10 例）。
- `projectContext` 严格对齐 `@company/contracts` 已交付的 `ProjectContext` 契约（`additionalProperties: false`），**只使用** `framework`、`frameworkVersion`、`echartsVersion?`、`packageManager`、`requirements` 5 个字段，不扩展 `contracts`；如评估需要记录 `reactDomVersion` 等宿主环境补充证据，应放在独立 `evalEnvironment` 字段，严禁写入 `projectContext`。
- `acceptableCandidates` 为空数组 `[]` 表示该区域/案例**无可用匹配**（例如雷达图、地理地图、桑基图或当前框架/版本不兼容）。
- `requiredGaps` 列出评估器必须检查出的未知项；若模型未报告这些缺口而直接填充假值，计为缺口漏报。

---

## 3. 核心评估指标与初始门槛

对照 T14 实施计划，定义以下 4 项核心指标及硬门槛。**统计隔离与零分母规则**：
- **`real` 与 `synthetic` 必须分开统计**：正式门槛仅以 `origin === 'real'` 且 `split === 'eval'` 的样本计算达标状态；`synthetic` 样本只可单独输出冒烟统计，严禁与真实样本混算。
- **零分母视为 `N/A` 且不通过**：当任一指标在目标统计集上的分母为 `0`（例如当前无真实样本、或无对应类型样本）时，该项指标必须输出 `N/A` 并标记为**未达标 / 不可判定**，**严禁视为通过**。

| 指标 | 定义与计算公式 | 初始门槛 | 适用样本范围 |
| --- | --- | --- | --- |
| **兼容与契约硬违规数** (`hardViolations`) | 输出方案中出现以下任一情况的案例数（按案例计数，且记录全部违规明细）：<br>1. 跨框架推荐（如 React 宿主推荐 `*-vue`）<br>2. 推荐非 `Ready` 或 `DEPRECATED` 变体<br>3. `peerDependencies`（`vue` / `react` / `react-dom` / `echarts`）版本不兼容<br>4. 编造不存在的导出名（如 `RankingChart`）、props、config 字段或事件名<br>5. 违反组件数据语义硬约束（如 `pie`/`proportion` 配负值、`scatter` 配类目字符串 `x`、`ranking`/`proportion` 配多系列）<br>6. 将 `manual-upload` 伪标为 `local-automatic` | **`0`**（总样本数为 0 时输出 `N/A`，不通过） | 全量 `origin === 'real'` 样本（含可匹配与所有陷阱案例；`synthetic` 另行单独统计） |
| **可匹配案例 Top-5 召回率** (`top5Recall`) | 针对所有 `groundTruth.acceptableCandidates.length > 0` 的样本，候选列表前 5 名中至少命中 1 个可接受 `(componentId, variantId)` 且无硬违规的样本占比：<br>`matched_within_top5_and_valid / count(acceptableCandidates.length > 0)` | **`>= 80%`**（分母为 0 时输出 `N/A`，不通过） | **所有 `origin === 'real'` 且 `acceptableCandidates.length > 0` 的样本**（同时覆盖 `matchable` 与 `missing-constraint` 等含有效候选的样本，不得按 `category` 过滤遗漏） |
| **必需缺口召回率** (`requiredGapRecall`) | 针对所有标注了 `groundTruth.requiredGaps` 的样本，输出 `MatchPlanV1`（草案）的 `unknown` / `gaps` 中准确覆盖全部必需缺口（按语义/字段对齐）的条数占比：<br>`detected_required_gaps / total_required_gaps` | **`>= 90%`**（分母为 0 时输出 `N/A`，不通过） | 所有 `origin === 'real'` 且 `requiredGaps.length > 0` 的样本 |
| **无匹配拒绝准确率** (`noMatchRejectionRate`) | 针对 `acceptableCandidates.length === 0` 的陷阱样本，系统正确输出“无匹配 / 置信不足拒绝装配”而非强行装配错误组件的占比 | 建议 `>= 90%`（且硬违规必须为 `0`；分母为 0 时输出 `N/A`，不通过） | 所有 `origin === 'real'` 且 `acceptableCandidates.length === 0` 的拒绝类样本 |

### 评估报告强制输出格式

每次离线评估运行必须产出结构化报告，至少包含：

1. 运行元信息：评估集路径与 SHA-256、模型/检索器版本、时间戳、**`real` 样本数与 `synthetic` 样本数（分别统计，禁止合并）**。
2. 分组汇总指标：分别列出 `real` 组与 `synthetic` 组的 `hardViolations`、`top5Recall`、`requiredGapRecall`、`noMatchRejectionRate`（含分母计数；分母为 0 时显式标 `N/A` 且判定未通过）。
3. **逐例失败与违规明细**：每条未通过或发生违规的 `caseId`、`origin`、`category`、期望真值、实际输出、具体失败原因分类。

---

## 4. 陷阱案例规范（Trap Taxonomy）

为确保评估集有效检验系统边界，要求真实标注集中至少包含 **10 个**覆盖以下 5 类陷阱的案例：

| 陷阱类别 | 构造要点 | 期望正确行为 | 典型失败表现（硬违规/扣分） |
| --- | --- | --- | --- |
| **1. 无匹配图表类型** (`no-match`) | 设计稿为当前 7 组件之外的图表（如雷达图、漏斗图、地理热力图、桑基图、K 线图） | 输出无匹配/置信不足并给出缺口说明 | 强行用 `pie` 替代雷达图或用 `line` 替代 K 线图 |
| **2. 缺失约束 / 不可见口径** (`missing-constraint`) | 设计稿展示趋势卡片但无前期对比值 `previousValue`，或展示柱状图但未标注单位 `unit` / 堆叠口径 | 选中对应组件，但将缺失字段写入 `unknown` / `gaps` | 自行编造 `previousValue: 100` 或猜测单位为 `%` |
| **3. 跨框架与版本陷阱** (`cross-framework-trap`) | `ProjectContext` 为 `react@19.3.1` 但仅提供 `vue` 候选，或宿主 `echarts` 版本为 `5.5.0`（不满足 `6.1.0` peer） | 拒绝不兼容变体；提示版本冲突或仅在明确标明未验证时阻断装配 | 在 React 方案中输出 `@company/charts-vue` 或忽略 `echarts@6.1.0` 约束 |
| **4. API 幻觉陷阱** (`api-trap`) | 诱导使用不存在的导出名（如 `RankingChart`、`ProportionChart`）或不存在的 `optionOverrides`（如覆盖 `series` 或给 `pie` 配 `xAxis`） | 仅使用 `component-profiles.md` 登记的真实导出与白名单配置 | 生成 `import { RankingChart } from '@company/charts-react'` |
| **5. 数据语义陷阱** (`data-semantic-trap`) | 设计稿需求要求在饼图中展示负增长值、散点图横轴为月份字符串、或排行榜包含多系列对比 | 识别数据语义冲突，拒绝直接装配或提示需改用 `bar`/`line` | 为 `pie` 生成负值样本或为 `ranking` 生成多系列输入 |

---

## 5. 格式示例（明确标记为 `synthetic`）

以下两条样本**均为人工构造的 `synthetic` 示例**，仅用于验证评估工具链的 Schema 解析与规则校验，**不可替代真实设计稿标注样本**：

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "caseId": "SYNTH-MATCH-001",
      "origin": "synthetic",
      "split": "eval",
      "category": "missing-constraint",
      "sourceDescription": "synthetic 示例：顶部 KPI 卡片含大号数字与迷你折线，但图中未标注上期对比数值与指标单位",
      "designInput": {
        "imageRef": "synthetic://trend-card-no-previous.png",
        "viewport": { "width": 400, "height": 220 },
        "regions": [
          {
            "regionId": "r1",
            "bbox": [16, 16, 368, 188],
            "visibleHints": ["标题: 日活趋势", "当前值: 1,280", "底部平滑折线"],
            "hiddenOrAmbiguous": ["无同比/环比前期基线数值", "无明确单位后缀或小数位要求", "未说明点击数据点后的跳转动作"]
          }
        ]
      },
      "projectContext": {
        "framework": "react",
        "frameworkVersion": "19.3.1",
        "echartsVersion": "6.1.0",
        "packageManager": "pnpm",
        "requirements": ["展示日活指标卡片及近期趋势"]
      },
      "evalEnvironment": {
        "reactDomVersion": "19.3.1"
      },
      "groundTruth": {
        "acceptableCandidates": [
          {
            "componentId": "trend-card",
            "variantId": "trend-card-react",
            "rankPriority": 1,
            "requiredConfigKeys": ["chart", "title"]
          }
        ],
        "requiredGaps": [
          {
            "field": "config.previousValue",
            "reason": "设计稿未展示前期基线数值，不得编造对比数据"
          },
          {
            "field": "data.series[0].points",
            "reason": "设计稿仅展示示意折线，需业务接口提供真实时间序列"
          }
        ],
        "forbiddenActions": [
          "fabricate-previousValue",
          "recommend-vue-variant",
          "use-nonexistent-export"
        ]
      }
    },
    {
      "caseId": "SYNTH-TRAP-002",
      "origin": "synthetic",
      "split": "eval",
      "category": "data-semantic-trap",
      "sourceDescription": "synthetic 示例：用户要求用饼图展示包含负值的各部门利润增减额，且项目为 Vue 3",
      "designInput": {
        "imageRef": "synthetic://pie-negative-trap.png",
        "viewport": { "width": 600, "height": 400 },
        "regions": [
          {
            "regionId": "r1",
            "bbox": [0, 0, 600, 400],
            "visibleHints": ["部门利润增量: 研发 +120, 市场 -40, 运维 +30"],
            "hiddenOrAmbiguous": ["需要确认负值是否允许展示"]
          }
        ]
      },
      "projectContext": {
        "framework": "vue",
        "frameworkVersion": "3.5.45",
        "echartsVersion": "6.1.0",
        "packageManager": "pnpm",
        "requirements": ["使用饼图展示包含正负值的利润增量"]
      },
      "groundTruth": {
        "acceptableCandidates": [],
        "requiredGaps": [
          {
            "field": "component.semantic",
            "reason": "PieChart 与 Proportion 均在运行时拒绝负值（抛出 ChartDataError），若需展示正负值应提示改用 BarChart"
          }
        ],
        "forbiddenActions": [
          "assemble-pie-with-negative-values",
          "recommend-react-variant",
          "silent-drop-negative-points"
        ]
      }
    }
  ]
}
```
