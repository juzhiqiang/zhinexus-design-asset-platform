# 二期首批启动计划（2026-11-15）

基准：fa24ab525e5945e7096ed816a83f11962ba5f000。依据总体实施计划 T13/T14、三人分工及现有 contracts 执行。原始架构保持只读。

## 范围与验收边界

一期本地链路已有记录；公司 OIDC、生产独立预览域、真实业务试点仍未验收。本轮允许启动不依赖这些外部条件的准备任务，不将 T13/T14 或一期门槛标为完成。模型提供方、设计文件连接器及真实标注集尚未确定，不新增外部模型调用或上传设计稿。

原 T14 的 DesignMatch.vue 路径为历史技术栈残留，画廊按现有 React + Next App Router 实现；该路径修正不改变业务协议。当前只实现项目上下文输入与本地校验，不伪造匹配结果或 HTTP 服务。

## 文件所有权与执行批次

|负责人|工作区/分支|本批交付|允许修改|
|---|---|---|---|
|A / Antigravity|a-phase2-profiles / feat/a-phase2-profiles|真实组件档案审计、评估协议与缺口|docs/phase2/component-profiles.md、docs/phase2/evaluation-protocol.md、docs/verification/a-phase2-profiles-2026-11-15.md|
|B / Claude|b-phase2-matching / feat/b-phase2-matching|React 项目上下文输入、校验错误和明确未接入状态；契约交付后实现|apps/gallery、tests/gallery/phase2-context.test.ts、docs/verification/b-phase2-matching-2026-11-15.md|
|C / Codex|c-phase2-search / feat/c-phase2-search|ProjectContext 公共契约、JSON Schema、校验及边界测试；协调集成|packages/contracts、tests/contracts/project-context.test.ts、本计划、README.md、独立 C 验证记录；根配置由 C 独占|

B 在 C 的 ProjectContext 契约提交并原样交接之前仅做只读审计，不自行定义公共 DTO。A 不依赖新契约。所有任务独立 worktree，保留原有旧工作区。无 merge、push 或发布授权。

## C1 公共契约

ProjectContext 字段：framework（vue/react）、frameworkVersion（精确版本）、echartsVersion（可选精确版本）、packageManager（npm/pnpm）、requirements（字符串数组，可为空）。拒绝范围版本、未知字段、空白需求、非 JSON 输入。校验只证明输入形状，不证明真实兼容性。

先写契约行为测试并确认 RED，再实现类型/运行时校验、加入 schemas 注册与生成文件。GREEN 后运行 contracts 构建、窄测试、verify:workspace、强制完整构建/类型及相关全量测试，记录真实结果和缺口。contracts 仍为 private 0.0.0；没有对外新增 API/页面行为的 C1 不触发发布版本升级。B 的页面若达到对外功能条件，由 C 协调独立升版提交。

## 后续依赖

T13 还需 Candidate/MatchPlan、当前状态与权限重检、peer 范围过滤、outbox/PG 索引及真实集成验证；T14 还需区域解析/unknown、真实 API 映射和装配、截图入口、真实标注评估集及质量门槛。首批项目上下文表单不能替代这些能力。

## 交付标准

各负责人记录实际命令和结果、未覆盖边界及聚焦中文 commit。C 独立检查 diff、原始架构摘要、文件范围和测试证据，再提供可供后续集成的提交，不自动合并。文档审计不冒称真实多模态验证；手动截图不冒称自动回归。
