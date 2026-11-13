# T10 A → B 接口交接：ECharts 兼容策略与精确矩阵清单

日期：2026-11-13。A（SDK）→ B（CLI / 画廊）。分支：`feat/t10-sdk-compatibility`。
本文约定 A 侧提供什么、B 侧 runner 需要消费什么，避免两边各实现一遍候选解析与矩阵执行。

## 一、边界

| 归属 | 内容 |
| --- | --- |
| **A（本轮已交付）** | `packages/charts-core/src/engine/compatibility.ts` 的纯策略：候选解析、peer 符合性、报告结构与建议判定。不发起网络请求、不写文件、不改 `package.json`。 |
| **B（未开始）** | `packages/component-cli/src/commands/echarts.ts`、`upgrades/{resolve,matrix,report}.ts`；`component echarts check` / `verify --version <exact>` / `verify --latest`。负责抓 registry 快照、建隔离升级目录、改精确依赖、跑矩阵、落报告。 |
| **C** | `compatibility_records` 契约与落库；根 `package.json` / `pnpm-lock.yaml` / `turbo.json` 收口。 |

B 的 runner **应当直接调用** `@company/charts-core` 导出的 `resolveCandidate` / `verifyCandidate` / `recommend`，不要另写一份版本判定。A 侧已用 20 条单测锁定这些纪律，B 侧复用即可获得同样的约束。

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
  baselineEchartsVersion: string;
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

## 四、报告要求

- 四个维度必须分别结论，`'not-run'` 不是通过。A 侧已保证：任一维度为 `'not-run'` 或少一个框架的实测，`recommend` 一律返回 `'hold'`。
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
