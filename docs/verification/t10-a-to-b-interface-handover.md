# T10 A → B 接口交接：ECharts 兼容策略与精确矩阵清单

日期：2026-11-13。A（SDK）→ B（CLI / 画廊）。分支：`feat/t10-sdk-compatibility`。
本文约定 A 侧提供什么、B 侧 runner 需要消费什么，避免两边各实现一遍候选解析与矩阵执行。

## 一、边界

| 归属 | 内容 |
| --- | --- |
| **A（本轮已交付）** | `packages/charts-core/src/engine/compatibility.ts` 的纯策略：候选解析、peer 符合性、报告结构与建议判定。不发起网络请求、不写文件、不改 `package.json`。测试为 `tests/unit/sdk-compatibility.test.ts`（51 例）。当前版本 `0.0.10`：`0.0.8`–`0.0.10` 三轮修复了独立评审复现的策略误判（探针收到基线版本、覆盖只按框架、基线取首项、改某一行 echartsVersion 骗取 adopt、报告基线未绑定 supported、单框架齐验），详见 [T10 SDK 兼容验证记录](t10-sdk-compatibility.md) 第八、九节。 |
| **B（未开始）** | `packages/component-cli/src/commands/echarts.ts`、`upgrades/{resolve,matrix,report}.ts`；`component echarts check` / `verify --version <exact>` / `verify --latest`。负责抓 registry 快照、建隔离升级目录、改精确依赖、跑矩阵、落报告。测试为实施计划列出的 `tests/unit/upgrade-policy.test.ts` 与 `tests/integration/upgrade-matrix.test.ts`。 |
| **C** | `compatibility_records` 契约与落库；根 `package.json` / `pnpm-lock.yaml` / `turbo.json` 收口。 |

**测试文件切分**（按 C 2026-11-13 交接要求）：`tests/unit/upgrade-policy.test.ts` 预留给 B 的 CLI 策略测试，A 侧 SDK 策略测试命名为 `tests/unit/sdk-compatibility.test.ts`。实施计划 T10 的 Files 一行同时列了两个文件名，那是计划建立时的划分；实际归属以本文为准，两边互不占用。

B 的 runner **应当直接调用** `@company/charts-core` 导出的 `resolveCandidate` / `verifyCandidate` / `recommend`，不要另写一份版本判定。A 侧已用 20 条单测锁定这些纪律，B 侧复用即可获得同样的约束。

## 一之二、与 contracts 的 CompatibilityRecord 对应关系

`packages/contracts/src/reports.ts` 的 `CompatibilityRecord` 已把状态区分为 `'candidate' | 'passed' | 'failed'`，`passed` 必须带 `reportId` 与 `verifiedAt`，且校验层要求该 `reportId` 指向的报告属于同一 variant、同一 `packageSha256`、同一 `frameworkVersion` 与 `echartsVersion`，报告自身全部 check 为 `passed`、`baselineResult` 为 `PASS`/`NEW`，且 `verifiedAt` 不早于报告创建时间。

A 侧 `CompatibilityReport` 与它的对应关系（**A 不写契约，也不落库**，仅约定字段语义，供 B 生成记录时对齐）：

| A 侧 `CompatibilityReport` | contracts `CompatibilityRecord` |
| --- | --- |
| `candidate`（候选已解析、已跑探针） | `status: 'candidate'`，可不带 `reportId` / `verifiedAt` |
| `recommend(report, supported) === 'adopt'` 且已有匹配的通过报告 | `status: 'passed'`，必须带 `reportId` 与 `verifiedAt` |
| `recommend === 'hold'` 且探针有失败维度 | `status: 'failed'` |
| `peerSatisfied === false` | 记录为 `candidate` 或 `failed`，**不得**记为 `passed` |

本轮 echarts 6.0.0 的实测结论对应 `candidate`（已解析、已跑探针、视觉 not-run、peer 不符合），不是 `passed`。

## 二、A 侧导出清单（`@company/charts-core`）

```ts
// 类型
export type RegistrySnapshot = {
  source: string;                                              // 官方源或本地代理地址
  latest: string;                                              // dist-tag latest 解析值
  versions: Record<string, { integrity: string; releaseNotes?: string }>;
};
export type EChartsCandidate = { version: string; integrity: string; releaseNotesSource: string; source: string };
export type CandidateInput = 'latest' | string;
export type SupportedCombination = { framework: 'vue' | 'react'; frameworkVersion: string; echartsVersion: string };
export type DimensionOutcome = 'passed' | 'failed' | 'not-run';
export type CombinationDimensions = {
  typecheck: DimensionOutcome; runtime: DimensionOutcome; interaction: DimensionOutcome; visual: DimensionOutcome;
  differences: string[];
};
export type CombinationProbe = (combination: SupportedCombination) => Promise<CombinationDimensions>;
export type CompatibilityReport = {
  candidate: EChartsCandidate;
  peerSatisfied: boolean;
  baselineEchartsVersion?: string;   // 0.0.9 起可选；缺失即 fail-closed
  results: CombinationResult[];
  supportedRangeUnchanged: true;               // 恒 true
  requiresVisualBaselineConfirmation: boolean;
};
export type Recommendation = 'adopt' | 'hold';

// 函数
resolveCandidate(input: CandidateInput, registry: RegistrySnapshot): EChartsCandidate   // 可能抛 CandidateError
candidateSatisfiesPeer(candidate: EChartsCandidate, peer: { echarts: string }): boolean
compareVersions(a: string, b: string): number
isExactVersion(input: string): boolean
isPrerelease(version: string): boolean
verifyCandidate(candidate, supported, probe): Promise<CompatibilityReport>
recommend(report: CompatibilityReport, supported: readonly SupportedCombination[]): Recommendation
hasDualFrameworkCoverage(report: CompatibilityReport, supported: readonly SupportedCombination[]): boolean
notRunDimensions(): CombinationDimensions
export class CandidateError extends Error { readonly reason: CandidateRejectionReason }
```

`CandidateRejectionReason` 取值：`'not-exact-version' | 'prerelease' | 'unknown-version' | 'missing-integrity'`。B 侧按 `reason` 分流处理，不要解析消息文本。

## 三、B 侧 runner 需要填的输入

1. **`RegistrySnapshot`**：从官方源（或本地 Verdaccio）抓取后传入。`latest` 取 dist-tag，`versions` 至少包含候选版本及其 `dist.integrity`。代理与官方源不一致时，**两个快照都要留下**，`source` 字段就是为区分二者而设。
2. **`supported`（精确矩阵清单）**：当前已实测通过的组合。本期一期的完整清单是 2 条：

   | framework | frameworkVersion | echartsVersion |
   | --- | --- | --- |
   | `vue` | `3.5.45` | `6.1.0` |
   | `react` | `19.3.1` | `6.1.0` |

   扩大范围时必须先有新的实测通过记录，再改这里和 `peerDependencies`，顺序不能反。
3. **`probe`**：对每个组合跑真实验证后回填四个维度。A 侧不执行任何构建，探针由 B 注入。

   **探针收到的 `combination.echartsVersion` 是候选版本，不是基线版本**（`0.0.8` 修复；此前误把基线原样传给探针，导致报告自称验证候选、实测行写的却是基线）。B 侧 runner 必须按入参里的 `echartsVersion` 去装依赖、建隔离升级目录，**不能**按自己手里的基线版本去装。每个 `CombinationResult` 另带 `baselineEchartsVersion`，是该组合在基线状态下的版本，供对照与留痕；两份版本在候选低于基线（回退验证）时不同。该字段 `0.0.9` 起为**可选**（`0.0.8` 曾设为必填，那对手工构造该公开类型的调用方是破坏性变更），**缺失即判为无法与基线对应**：`hasDualFrameworkCoverage` 返回 `false`、`recommend` 返回 `'hold'`。B 侧 runner 应当始终填上它，但即使漏填也是安全方向。

   **`supported` 是唯一事实来源**（`0.0.10` 起）：`recommend` 只用 `supported` 的唯一 ECharts 基线推导 peer 符合性，并核对报告的 `baselineEchartsVersion` 必须精确等于它；报告里的 `peerSatisfied` 只是转述，不作为判据。B 侧落盘/回读报告时即便字段被改写，也不会改变判定结果。另外 `supported` 必须同时含 Vue 与 React 至少一个精确组合，只有单框架时一律 `hold`。

   另外两条硬约束（同为 `0.0.8` 修复，B 侧传参时会直接碰到）：

   - `supported` 里所有组合的 `echartsVersion` 必须一致，混用不同基线（如一条 6.1.0、一条 6.0.0）会直接抛错、不出报告。上表的一期清单两条都是 `6.1.0`，满足该约束。
   - 覆盖判定按**精确组合**一一对应：`supported` 有几条，`results` 就必须有几条且键完全对齐（框架 + 框架版本 + ECharts 基线版本）。少一条、多一条、重复一条、版本写错一条，`recommend` 都返回 `'hold'`。B 侧若按框架去重或只跑一个代表版本，会被判为不完整。

## 四、报告要求

- 四个维度必须分别结论，`'not-run'` 不是通过。A 侧已保证：任一维度为 `'not-run'`、或少任何一个精确组合的实测，`recommend` 一律返回 `'hold'`。
- `differences` 保留差异原文（例如「柱状图标签位置偏移 2px」），供人工基线确认；`requiresVisualBaselineConfirmation` 为 `true` 时不得自动判过。
- 报告**不得**包含「建议的新支持范围」。扩大范围是人的决定，`supportedRangeUnchanged` 恒为 `true` 就是在结构上堵死自动扩范围的路径。
- 同一份冻结 tarball 的 SHA-256 必须贯穿安装、截图、报告、上传与发布；截图完成后严禁重新打包。

## 五、A 侧本轮已实测的候选结论（供 B 参考，不替代 B 的执行）

- 官方 `latest` = `6.1.0` = 当前基线，**无新上游版本**。
- 第二候选 `echarts@6.0.0`：严格 peer 安装被 `ERESOLVE` 拒绝；放宽后类型 / 运行 / 交互在双框架上全部通过，视觉 not-run；且存在 `skipLibCheck: false` 下的类型静默降级。结论 `hold`。
- 详见 [T10 SDK 兼容验证记录](t10-sdk-compatibility.md) 与 [docs/echarts-upgrade.md](../../echarts-upgrade.md)。

## 六、需要 B 确认的三件事

1. runner 是否直接调用 `charts-core` 的 `resolveCandidate` / `verifyCandidate` / `recommend`（A 的期望：是）。
2. 报告落盘的路径与字段名，A 按它对齐 `CompatibilityReport` 的序列化（若需新增字段请告知，A 不自行改公开类型）。
3. 隔离升级目录的创建位置与清理策略，避免与工作区外消费者目录（T03/T04 既有约定）冲突。
