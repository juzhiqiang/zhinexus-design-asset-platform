# G1 公共契约与 G2 接入安排 Implementation Plan

> **For agentic workers:** 使用 executing-plans 按任务实施，行为变更先 RED 再 GREEN。用户已授权在新分支完成；本次在独立 worktree 的 `feat/g1-platform-contracts` 实施。

**Goal:** C 补齐可供 A/B 评审的 V1 运行时契约、错误码和 fixtures，2026-11-13 前评审，独立跟踪 G2。

**Architecture:** 沿用实施计划 2.2–2.3 的字段及来源规则。contracts 保持浏览器/Node 环境无关，无新增第三方依赖；声明式 JSON Schema 同时驱动结构校验与导出的 schema 文件，关联规则单独校验。摘要采用 Web Crypto，纯结构校验不能替代上传字节核验。

**Tech Stack:** 现有 TypeScript 7.0.2、Vitest 5.1.0、Node 26.13.0、pnpm 12.18.0。

**Spec:** `component-platform-architecture.md`（只读）、`component-platform-implementation-assessment.md`、`2026-11-11-component-platform-implementation.md` 2.2–2.3 / T01、三人分工计划 G1/G2。

## Global Constraints

- C 独占 contracts、根配置和相关验证文件；不修改 A/B 的 CLI、SDK、示例或画廊实现。
- 所有输入为 unknown；非法结构、路径、摘要、引用和来源失败关闭，返回 JSON Pointer 字段路径。
- 每个 variant 独立检查截图与对应包版本、框架、示例和状态；web 仅 manual-upload / unknown-manual。
- 自动截图和 passed 兼容记录必须有匹配的报告；包摘要、报告、环境和截图相互核对。
- 不构建或执行上传代码，不证明客户端报告真实性；真实 MIME、tarball 内容和权限验证仍归 T05。
- 保留原架构字节及历史验证；不推送、不合并；G1 人工评审和 G2 未实测保持开放。

## Review Focus

1. 一包多组件、Vue/React 混合发布的逐实现缺图和借图。
2. 已存在包版本的不同摘要、重复路径和资源引用内容不一致。
3. web 伪造来源、自动报告缺失、passed 记录与失败报告不匹配。
4. 非 JSON 输入、危险路径、非有限数值、无效版本/时间与未知字段。
5. 环境键排除被测版本但保留字体/浏览器/尺寸；实际文件变更必须重新校验。

## Task 1：V1 结构、关联和冻结产物校验

**Files:** `packages/contracts/src/{errors,schema,schemas,validation,digests,bundle,api}.ts`、现有类型/index；`packages/contracts/schemas/*.json`；`scripts/generate-contract-schemas.ts`；`tests/contracts/*.test.ts`、`tests/fixtures/releases/g1/*`。

**Interfaces:** `validateManifest(unknown, {reports?})`、`validateCheckReport(unknown)`、`validateEnvironment(unknown)`、`validateReleaseBundle(unknown, ReadonlyMap<string, Uint8Array>)`；`canonicalJson`、`sha256`、`manifestDigest`、`environmentKey`；API DTO/schema 与示例就绪接口。

- [x] 新增正常/缺图/错框架/错摘要/伪造来源/冲突/路径/报告反例及摘要、API 测试。
- [x] 构建原 contracts 后直接运行契约测试，记录预期失败。
- [x] 实现最小 schema 词汇与领域关联规则；生成 JSON Schema，保持类型和 schema 测试一致。
- [x] 同一测试 GREEN；运行冻结安装、workspace、build、typecheck、test、服务图检查；契约测试连续执行两次。
- [x] 记录命令、证据、未覆盖边界并形成中文聚焦提交。

## Task 2：评审交接和接入排期

**Files:** 新增 `docs/verification/g1-contracts-2026-11-12.md`、`docs/superpowers/plans/2026-11-12-g1-review-g2-access.md`；同步 README、contracts README、评估与实施/分工计划。

- [ ] A 评审 ready/runState/getChecks、双框架与示例语义；B 评审冻结摘要/截图/报告/API fixtures；C 收口。
- [x] 明确 2026-11-13 评审时点、记录模板和阻断条件；没有实际回执不标完成。
- [x] 列出 G2 五项唯一接入责任 C、外部交付角色与待确认实名、11-13/16/17/18 计划日期和验收证据。
- [x] 新增验证记录，不改历史证据；独立只读审查后提交文档。
- [x] 完成代码独立评审、四项 P2 修正及窄范围复核；不替 A/B 业务签字。

## 执行记录

- 2026-11-12：源工作区在检查期间出现其他工作流的未提交 CLI 测试，因实现尚缺导致该测试收集失败；未改动其文件。通过原生 worktree 工具从 `8304bff` 隔离；新 worktree 独立冻结安装成功。
- 决策：本次不引入 Zod/Ajv 等新依赖；只实现当前声明的 JSON Schema 词汇，不对外承诺通用 JSON Schema 引擎。
- 决策：fixtures 是合成的契约样本，不是已验证组件包/真实截图或兼容性证据。
- 2026-11-12 收口：实现 `7e10751`、评审/G2 交接 `2b51b25`、审查修正 `0a2a3d6`；全图实际构建 10/10、根测试 162/162、契约 145/145、浏览器 11/11、类型与生成样本检查通过，详见新增验证记录。
- 用户回复“评审就行”：完成代码评审与修正复核，按角色交接，不继续索取实名。G1 状态：代码候选已验证与复核，A/B 业务回执仍开放；G2 状态：未接入验证。T01 不标完成；分支/worktree 保留供审阅，未推送或合并。
