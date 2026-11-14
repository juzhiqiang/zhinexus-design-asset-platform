# A/B/C 下一轮执行与集成计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans 逐项实施；C 负责集成与验收。

**Goal:** 补齐本地视觉基线、双框架兼容探针与可复现的平台专项，在独立分支验证后合回 main。

**Architecture:** A 提供 SDK 探针；B 完成本地 CLI 和网页错误恢复；C 维护平台测试设施、公共契约和集成。沿用已冻结产物、现有 API 和三存储恢复状态机。

**Tech Stack:** 项目固定 Node 26.13.0 / pnpm 12.18.0、Vitest 5.1.0、Playwright 1.65.0、Docker。

**Spec:** 原实施计划 T04/T10/T11/T12、三人分工文档及 AGENTS.md；基线 main 为 `4dc93fec1c0c702fb615b0709f8f7a9816bc3ec9`。

## 约束与所有权

- A（Claude）：`feat/a-t10-probes`；SDK、examples、`tests/acceptance/t10-sdk/` 和独立验证记录。
- B（Antigravity）：`feat/b-baseline-cli`；CLI、gallery、相关测试和独立验证记录；先使用 5173–5176。
- C（Codex）：`chore/c-local-acceptance`；infra、scripts、平台测试、公共配置/契约/锁文件和公共文档。
- 原架构只读；同一 tarball 冻结摘要贯穿全流程；服务端零组件执行；不初始化共享 G2、不覆盖已发布版本。
- 用户已授权最终本地合并；不推送、不删除本轮工作树/分支。
- OIDC、生产独立域和真实双项目试点缺失时继续保留未验收状态。

## Review Focus

- 本地镜像登记缺失或非法，必须明确失败或验证锁定来源后登记，不能静默选用任意镜像。
- 干净工作树平台专项不得读取共享密码或占用共享固定端口。
- 隔离资源清理必须验证所有权，失败不能误删其它容器或卷。
- 浏览器失败与环境不一致不得被记录为视觉通过。
- 三方最终提交必须在最新 main 上独立核验，不能仅采信代理的完成消息。

## Task 1：C 镜像身份预检

- [ ] 为缺登记、已有登记、不匹配来源和非法登记写失败测试并观察 RED。
- [ ] 从本机锁定标签解析镜像，校验 linux/amd64、源码 revision、release 标签；使用精确 image ID，登记原子创建，已有坏登记失败关闭。
- [ ] 跑窄范围测试与类型检查，新增验证记录并聚焦提交。

## Task 2：C 平台专项隔离

- [ ] 写默认设施未注入即拒绝的失败测试，排除读取共享凭据的旧路径。
- [ ] Vitest global setup 创建 RecoveryStack，通过内存 provide/inject 传入 worker；测试使用动态端口。
- [ ] 实跑平台专项、备份恢复、发布恢复及根测试，记录来源/结果与资源清理。

## Task 3：A/B 交接与集成

- [ ] A 精确组合探针、类型/运行/交互/截图及回退证据，给 B 接口。
- [ ] B 基线闭环、CAS 接受命令、WebCrypto 错误恢复和冻结材料路径参数化。
- [ ] C 审查三个分支、公共配置与版本记录，按授权合 main。
- [ ] main 全图检查、强制构建/类型、根测试和浏览器验证；新增集成记录并报告提交与外部阻塞。
