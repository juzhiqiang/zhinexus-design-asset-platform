# 二期 ID 规则匹配执行计划

> **For agentic workers:** 使用 executing-plans 按任务执行，继续 Codex C、Antigravity A、Claude 桌面 B 协作；未冻结契约前不得独立发明相互冲突的协议。

**Goal:** 用显式 ID 配置定位组件，经真实资格/API 证据校验生成装配方案，本期不接模型。

**Architecture:** contracts 定义不透明 ID、配置与实例输入；API 定位精确发布，复用目录鉴权和兼容检查；Gallery 经 HTTP 展示结果/缺口。

**Tech Stack:** 沿用 pnpm/TypeScript、NestJS、React/Next、PostgreSQL，不新增模型/向量依赖。

**Spec:** [范围与接口设计](../specs/2026-11-15-phase2-id-matching-design.md)。

## 全局约束

- 原架构字节不变，历史验证保留；文本检索保留人工发现用途。
- ID 规则未定，不硬编码分隔符/前缀、正则或大小写转换。
- C 唯一维护 contracts、根配置/锁；A/B 在各自 worktree 文件范围内工作。
- 不改已发布产物，服务端不执行组件；Ready、兼容、来源独立。
- 中文聚焦提交、不 push；内部配置契约不单独升版，后续 API/UI 功能独立升版。

## Review Focus

1. 路径/原型键形状的 ID 仅作字符串，不执行或遍历原型。
2. 重复映射同目标/异目标都拒绝，Vue/React 可分别配置。
3. 实例 ID 唯一，同一 designId 可供多个实例复用。
4. 用户提交的发布 ID 不充当权限、Ready 或兼容证据。
5. 修改配置、上下文或身份后，旧响应不能继续用于装配。

## Task 1：C 配置与输入契约

**Files:** 新增 `packages/contracts/src/design-id.ts`、`tests/contracts/design-id.test.ts`；修改 `packages/contracts/src/{index,schemas}.ts`；生成对应 JSON Schema；同步 CLI 内联契约与 `tests/browser/contracts-runtime.spec.ts` 模块清单。

**Interfaces:** spec 中的三个 V1 类型；`validateDesignIdMapping(input:unknown)`、`validateDesignIdInput(input:unknown)` 返回既有 `ValidationResult<T>`。

- [ ] 新增失败测试：两框架映射、重复映射/实例、同设计多实例、不透明 ID 原样保留、非法/未知字段、schema 注册。
- [ ] 基线构建 contracts，运行 `exec vitest run tests/contracts/design-id.test.ts` 确认缺导出的 RED。
- [ ] 实现 schema 与跨字段唯一性；不访问目录，不声称匹配成功。
- [ ] 运行 `--filter @company/contracts schemas:generate`、contracts 测试、全图强制构建/类型、根 tsc、CLI 内联检查、contracts 浏览器冒烟与 workspace 检查。
- [ ] 独立审查、新增验证记录，提交配置契约。

## Task 2：C 发布解析与方案（Task 1 后）

**Files:** `apps/api/src/matching/`、`packages/contracts/src/match-plan.ts`、`tests/integration/match-plan.test.ts` 与 Nest 注册。

- [ ] 冻结 MatchPlan/HTTP 协议给 A/B；精确发布定位不依赖文本 Top-50 或文本索引状态。
- [ ] RED 覆盖正确 ID/框架、未知 ID、非 Ready/废弃/不可读/peer 不符、材料摘要不符、撤权、缺 API、未知业务参数；不可读目标不泄露细节。
- [ ] 实现确定性解析和最终资格复读，读取同一冻结发布 API/示例，输出精确依赖、证据和缺口。新产物如需修正事件元数据，不能回写历史产物。
- [ ] 隔离服务验证 HTTP→目录→资格→方案，量测 200–1000 实现规模延迟，记录实际结果。
- [ ] 独立审查、聚焦提交，对应包单独升级版本/CHANGELOG。

## Task 3：B 输入与方案界面（Task 2 契约冻结后）

**Files:** `apps/gallery/src/` 现有 Next/React 路由/服务与 `tests/browser/` 匹配测试。

- [ ] RED：输入元素清单与规则 JSON、字段错误/缺口、空配置提示、重复实例拒绝与同设计多实例。
- [ ] 实现 HTTP 和方案展示；配置/上下文/身份变化取消旧响应；手动选候选必须显式更新配置，不替换未知 ID。
- [ ] 真实 API 联调，Gallery 类型/构建/浏览器测试，聚焦提交与独立升版。

## Task 4：A 规则评估与收口

**Files:** `tests/evaluation/` 新增 ID 规则评估、`docs/phase2/` 与新验证记录，保留历史模型评分工具定义。

- [ ] 冻结契约后建立正确/未知/冲突/跨框架/多实例/错误材料案例，先 RED 再实现报告。
- [ ] 审查真实 API/示例，包括 React onPointClick 与 Vue point-click 差异，报告具体阻断项。
- [ ] 验证规定测试集精确映射 100%、误装配/硬违规 0；合成与真实设计样本分开报告。
- [ ] 实际 ID 规则/导出样本到位后验收；未到位不虚报 T14 完成，不再将模型列为阻塞。
