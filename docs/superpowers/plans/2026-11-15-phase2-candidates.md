# 二期第二批：候选契约、资格过滤与离线评分实施计划

> **For agentic workers:** 使用 executing-plans 逐任务执行；三方在现有独立 worktree 协作，禁止跨所有权修改。

**Goal:** 交付可独立验证的候选数据契约、服务端资格过滤、候选展示组件和离线评估器，为真实检索服务接入建立边界。

**Architecture:** 复用 ProjectContext、发布元数据和已有兼容记录。C 冻结公共契约后原样交给 B；A 评分器处理显式人工标注与观测结果，不调用外部模型。候选组件本批不挂载到 /match，不使用测试结果冒充在线检索。

**Tech Stack:** 现有 TypeScript、React 19.3.1、Next 16.4.6、Nest 12.4.2；固定 Node 26.13.0/pnpm 12.18.0，无新增依赖。

**Spec:** 总体实现计划 T13/T14、原始架构（只读）、首批 kickoff、A 的 evaluation-protocol.md。

## 全局边界与本轮工程选择

- 沿用 A `feat/a-phase2-profiles`、B `feat/b-phase2-matching`、C `feat/c-phase2-search`；开始前均为干净提交。用户授权继续开发；本轮无 merge/push/部署。
- C 独占公共契约、CLI 契约镜像、根配置与版本收口；A/B 不新增公共 DTO。
- 本轮是 T13/T14 的下一子任务，不是完整检索服务。HTTP、PG 索引/outbox、模型与设计连接器留待下一批；不创建伪端点。
- 服务端过滤器只支持当前仓库的精确 peer 声明；范围声明或未知宿主 peer 显式拒绝，不自行实现半套 SemVer，不将未知判断为满足。
- ReactDOM 版本不能由 React 版本推断。内部调用可提供显式 hostPeers 补充事实；没有 react-dom 事实则拒绝需要它的候选。此参数不是 ProjectContext 字段，也不代表其自动受信任。
- 文本/用途/视觉分数分开，缺失分数不填 0，不把相似度称为兼容证明。verified 必须匹配服务器接受的发布、摘要和精确组合记录。

## Review Focus

1. 索引命中后权限/废弃状态变化：返回前重新读快照并过滤。
2. 请求缺 ECharts/ReactDOM：拒绝所需 peer 无法判定的候选，不猜版本。
3. 手动图与验证来源独立：不由截图来源推导兼容已验证，亦不伪造自动回归。
4. 合成样本与空分母：单独统计，正式验收不足 30 real / 10 陷阱或分母为零不通过。
5. 非法响应、重复候选与不存在的结果：拒绝不可信响应；UI 不显示虚构候选或原始异常内容。

## C2：公共候选契约与服务端过滤

Files: `packages/contracts/src/search.ts`、index/schemas/生成 JSON、CLI sync 清单与镜像、`tests/contracts/search.test.ts`、`tests/fixtures/search.ts`；`apps/api/src/search/eligibility.ts`、`tests/integration/search-eligibility.test.ts`、独立验证文档。

Interfaces:

```ts
type Candidate = {
  variantReleaseId: string; variantId: string; componentId: string; framework: 'vue'|'react';
  packageName: string; packageVersion: string; packageSha256: string; exportName: string;
  evidence: { kind: 'api'|'docs'|'screenshot'; path: string; sha256: string; source?: 'manual-upload'|'local-automatic' }[];
  compatibility: { status: 'verified'|'unverified'; recordIds: string[] };
  ranking: { text: number; usage?: number; visual?: number };
  gaps: string[];
};
type SearchCandidatesResponse = { candidates: Candidate[]; gaps: string[] };
// 导出 validateCandidate 与 validateSearchCandidatesResponse，返回既有 ValidationResult。
```

运行时拒绝未知字段、范围版本、非有限/超出 [0,1] 分数、重复 releaseId、verified 无记录、unverified 夹带记录、非截图带 source 或截图缺 source；形状校验不能证明记录真实性。Candidate 必须含 api/docs 证据，视觉分数存在必须有截图证据；缺用途/视觉评分保持省略。

- [x] 契约失败测试 RED → GREEN，schema 生成一致性、CLI 内联镜像完整（e0a7f5ee，198 契约测试）。
- [x] 契约验证提交后原样交 B；接收者逐文件 blob 核对（dcb4d52e，12 文件一致）。
- [x] `filterEligibleCandidates(context, hits, loadCurrent, hostPeers?)` 异步过滤，loadCurrent 由未来持久化检索层提供；对命中先读、返回前复读，失败关闭。
- [x] 测试 Vue-only/非Ready/权限拒绝/废弃/索引过期/peer 不符/缺 peer/旧摘要证据/撤权/重复命中/缺组合为 unverified；校验来自真实编译 dist，明确未接 PG/HTTP。
- [x] 运行 contracts/服务构建、窄测试、根类型与测试、全图构建和边界检查，独立审查后聚焦提交。

## A2：离线评分器

仅写 `tests/evaluation/scoring.ts`、`tests/evaluation/scoring.test.ts`、独立 `docs/verification/a-phase2-scoring-2026-11-15.md`。A 可读原评估协议，不修改 SDK/契约/根配置。

Interfaces: 导出 `scoreEvaluation(cases, observations)`，case 最小字段 caseId/origin(real|synthetic)/category/acceptableVariantIds/requiredGapFields；observation 为 caseId/top5VariantIds/gapFields/hardViolations:string[]。这是测试工具内部类型，不是公共 DTO，不声称自动检测语义硬违规。

- [x] TDD：all matchable groundTruth 非空案例作 Top5 分母（不限 category）；gapRecall 按所需字段计，去重不重复加分；硬违规按案例计；每例输出失败原因。
- [x] real 与 synthetic 分开；空分母指标为 null/N/A，passed false；real>=30 且陷阱类>=10，加上硬违规0、Top5>=0.8、gapRecall>=0.9 才能 passed（另按评估协议补齐无匹配拒绝率>=0.9，见执行裁决）。
- [x] 缺 observation 算失败；重复 caseId/未知 observation/重复 observation/非法数据抛明确错误，防静默漏计；仅取前5候选。
- [x] 人工构造测试全部注明 synthetic 验证输入（即使为覆盖统计而模拟 origin=real，也不是真实评估集）；不新建虚构30真实样本文件。
- [x] 实跑窄测试/根类型、记录边界，中文提交并独立审查。

## B2：候选响应与展示组件

仅写 `apps/gallery/app/lib/candidate-results.ts`、`apps/gallery/app/(console)/match/CandidateResults.tsx`、`tests/gallery/candidate-results.test.ts` 和独立 B2 记录。不修改 /match 页面、auth、导航或根配置。

Interfaces: `parseCandidateResults(input: unknown)` 复用 C 的 `validateSearchCandidatesResponse`；`CandidateResults({ response }: { response: SearchCandidatesResponse })` 纯展示。根据实际 export 接口实现，不自定义公共响应结构。

- [x] 契约交付前只读现有组件/测试模式并准备测试清单，不写公共类型。
- [x] 交付后先写失败测试，C 宿主 RED 再实现：非法/重复/伪verified拒绝，成功保留真实字段，不推导缺省分数；空数组输出诚实空态。
- [x] 展示精确包版本、框架、真实证据路径与来源、verified/unverified、独立评分和 gaps；没有 visual 显示“未提供视觉评分”。证据路径以文本显示，不拼造可点击存储地址，不生成预览链接。
- [x] 不挂载本组件到在线 /match，不发请求、不持久化；用服务端静态渲染测试可见文本与 HTML 转义。现有表单行为保持原样。
- [x] C 宿主验证与本地提交；未对外接入的组件不触发重复 Gallery 升版，接入真实服务时再统一升版。

## 交接与验收

每个任务实际 RED/GREEN、未覆盖边界和中文 commit 独立记录。C 在 A/B/C 三个工作区核对文件归属和架构 SHA256，禁止重写历史记录。只在任务完成后标记本表，保持 T13/T14 总任务未完成。

## 执行裁决与补充

- A2 原计划简写遗漏评估协议的无匹配拒绝率门槛；依既有 `docs/phase2/evaluation-protocol.md` 补齐 `noMatchRejection >= 0.9` 且分母非零，防止无匹配误报仍通过。另拒绝稀疏字段数组。A 修订提交 `2bea0082`，12 项评分测试通过；正式样本仍缺失。
- B2 静态渲染测试从 gallery 自身依赖边界加载 React；根 `tsconfig.json` 由 C 增加 `jsx: react-jsx` 以检查导入的 TSX。没有添加根 React 运行时依赖或修改锁文件。
- 过滤器读取接口必须由将来的持久化适配器绑定已认证 subject，读取当前权威元数据。两轮复读不等价于跨候选的数据库事务快照；接入 PG 时仍须实现一致性策略。

## 本批提交与验证汇总

| 负责人 | 提交 | 交付与验证 |
| --- | --- | --- |
| C | d4162065 | 本批分工计划 |
| C | e0a7f5ee | 候选公共契约；27 新测试、198 契约测试通过 |
| C | 154b9812 | 资格复核；32 新测试，根 Vitest 817 通过，node:test 159 通过 / 7 跳过 |
| B 接收，C 操作 | dcb4d52e | 原样接入契约，12 文件 blob 一致 |
| A | 988db80e、2bea0082 | 评分器及边界修订；12 项测试与根类型检查通过，C 独立复跑 |
| A | 15511ec9、a102d711 | C/B 独立只读审查，无阻断项 |
| C 维护 B 根配置 | a0ee0fae | JSX 静态测试和根类型支持 |
| Claude 桌面端 B，C 验证提交 | f71d32f3 | 候选展示与校验；24 新测试、60 相关测试、根 Vitest 818 通过，node:test 159 通过 / 7 跳过 |

A/B/C 本批子任务完成。B/C 全图强制构建各 10/10 成功、强制类型任务各 14/14 成功；A/B/C 架构 SHA256 均未变。保留各工作区分支，无 merge/push/发布。

下一批剩余：真实 PostgreSQL 索引/outbox 与已认证快照读取适配器、HTTP 检索与降级、/match 实际接入、模型/设计解析、真实 30 样本评估。当前评分器只处理显式观测，候选组件未挂路由，不能标记 T13/T14 整体完成。

详细证据：C 分支 `docs/verification/c-phase2-candidate-contract-2026-11-15.md` 与 `c-phase2-eligibility-2026-11-15.md`；B 分支 `docs/verification/c-b2-candidates-acceptance-2026-11-15.md`；A 分支评分器及 C/B 独立审查记录。
