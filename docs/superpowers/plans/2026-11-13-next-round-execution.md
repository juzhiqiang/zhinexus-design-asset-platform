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

- [x] 为缺登记、已有登记、不匹配来源和非法登记写失败测试并观察 RED。
- [x] 从本机锁定标签解析镜像，校验 linux/amd64、源码 revision、release 标签；使用精确 image ID，登记原子创建，已有坏登记失败关闭。
- [x] 跑窄范围测试与类型检查，新增验证记录并聚焦提交。

## Task 2：C 平台专项隔离

- [x] 写默认设施未注入即拒绝的失败测试，排除读取共享凭据的旧路径。
- [x] Vitest global setup 创建 RecoveryStack，通过内存 provide/inject 传入 worker；测试使用动态端口。
- [x] 实跑平台专项、备份恢复、发布恢复及根测试，记录来源/结果与资源清理。

## Task 3：A/B 交接与集成

- [x] A 精确组合探针、类型/运行/交互/截图及回退证据，给 B 接口。
- [x] B 基线闭环、CAS 接受命令、WebCrypto 错误恢复和冻结材料路径参数化。
- [x] C 审查三个分支、公共配置与版本记录，按授权合 main。
- [x] main 全图检查、强制构建/类型、根测试和浏览器验证；新增集成记录并报告提交与外部阻塞。

2026-11-14 进度：Task 1/2 已通过独立复审并本地合 main。Task 3 由 `chore/c-next-round-integration` 收口；C+B 第一阶段强制构建/类型 20/20、根类型与浏览器 195/195 通过。A 首份探针已在 Windows 跑出真实消费者结果，但 5 项跨平台单测与证据边界仍待修正，暂不合并。详见 [独立集成验证记录](../../verification/c-next-round-integration-2026-11-14.md)。

2026-11-14 接续：B 第二阶段 ECharts check/verify 固定 `8cbc8b7` 的四项 P2 全部通过独立复核（25/25），已由 `30c0a88` 合入 C 集成分支；合入后强制构建/类型 20/20、0 cached 及根类型检查通过。A 修正稳定交付、新环境指纹下 Windows 完整矩阵、候选与回退、真实 CLI adopt 及最终根 test 仍待完成，Task 3 尚不关闭。

2026-11-14 本轮收尾：A 固定 `c42dcc7`、B 固定 `8cbc8b7` 和 C 收口 `448ae7a` 已按授权以 `299f9b8` 本地合 main。r5 真实双框架首轮 56 hold、全新消费者 56 视觉 adopt、6.0 strict 拒绝/legacy 类型失败 hold、原双消费者清单锁文件回退 passed:true 均已实测及独立核验。main 新鲜执行工作区图检查、20/20 无缓存构建/类型、根 tsc、Node 138/138 零跳过、Vitest 719/719 与浏览器 195/195，全部 exit 0。Task 3 仅本轮本地范围完成；完整 G2/T10/T11/T12、独立安装 CLI、公司 OIDC/生产域/TLS 与真实业务双项目仍未验收。三方分支/worktree 和 B 原四处差异保留，未 push。详见 [最终集成验证记录](../../verification/c-next-round-integration-2026-11-14.md)。
