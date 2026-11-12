# C：本地三存储与接入检查 Implementation Plan

> **For agentic workers:** 使用 executing-plans 串行实施，行为变更先 RED 再 GREEN，最后独立审查。

**Goal:** 交付可实际运行的本地 PostgreSQL/Verdaccio/MinIO、真实非缓存验收及 OIDC/预览域接入检查工具，收口示例状态契约。

**Architecture:** 开发设施采用独立 `zhinexus-g2` Compose 项目和命名数据卷，只绑定本机回环地址；不复用其他项目容器。验证工具在开发机执行，使用真实数据库/注册表/S3 操作并重启本项目服务后复核。服务端应用不引入构建/截图能力。

**Tech Stack:** 现有固定 Node/pnpm；Docker Desktop Linux amd64；PostgreSQL 18.6、Verdaccio 7.1.0；MinIO RELEASE.2025-10-15T17-29-55Z 从固定 commit 构建。新测试客户端仅加根 devDependencies，精确版本与镜像摘要记录于 infra/versions.json。

**Spec:** 本次用户明确授权执行 C 的任务，并确认“暂时没有，先完成本地三存储和接入检查工具”；原实施计划 T01/G2、三人分工和 rules/security.md 为约束。

## Global Constraints

- C 仅修改 contracts、infra、根配置及所属测试/文档，不修改 SDK/CLI/画廊实现。
- OIDC/独立注册域没有现成资源；缺参数必须返回未配置/非零状态，发现文档或 TLS 成功不冒充真实登录或沙箱验收。
- 示例以 ExampleRef.requiredStates 为执行清单；ComponentExample.states 为可选枚举，不改变既有必需方法，不以单框架结果推断另一框架通过。
- 三存储只使用本项目隔离开发资源，测试包使用每次唯一名称，禁止删除重发；重启仅操作本 Compose 的服务，不删除卷。
- 凭证随机生成到被忽略的 .tools/g2-local，使用 Compose secrets/环境注入；不打印、不提交密码和 token。
- 不修改原始架构；不覆盖历史验证记录；不推送、不合并。G1 人工回执和完整 G2/T01 保持独立。

## Review Focus

1. 新契约仍接受没有 states 的既有示例；必需状态不从可选枚举推断。
2. 本机已存在其他 PG/MinIO，端口、卷、Compose 项目和重启范围必须隔离。
3. 每次测试执行实际写读、精确安装和摘要校验；失败/未配置不能返回成功。
4. 注册表 reader 不得发布、匿名请求不得读取私有资源；已发布包字节重启前后一致。
5. 预览域按注册域判断，拒绝同一注册域的不同子域；OIDC 检查不能误称登录已通过。

### Task 1：契约收口

**Files:** contracts/src/examples.ts、index.ts、contracts README、tests/contracts/example-capabilities.test.ts、评估/实施计划补充。

**Interfaces:** `ComponentExample.states?: readonly string[]`、`COMPONENT_EXAMPLE_GLOBAL`；既有 ready/runState/getChecks 保持不变。

- [x] 增加类型兼容测试：旧示例、只读枚举、错误成员类型；类型检查 RED 后增加可选字段/常量。
- [x] 文档确定 requiredStates 为权威清单、未知状态 reject、每个状态等待就绪后检查。
- [x] contracts 构建/类型与契约测试通过后聚焦提交。

### Task 2：设施启动与真实验收

**Files:** infra/compose.yaml、minio/Dockerfile、verdaccio/config.yaml、versions.json、scripts/{local,check,access,access-config}.ts；根 package/lock/tsconfig；tests/infra/*.test.ts。

**Interfaces:** `infra:up` 初始化本地随机凭证并构建固定 MinIO、启动服务；`infra:stop` 停止但保留卷；`test:infra` 执行三存储写读/权限/重启持久化与备份恢复探针，输出脱敏报告；`infra:check-access` 检查可选 OIDC/域名配置，未配置退出 2。

- [x] 接入配置/元数据反例先 RED：缺字段、HTTP/带凭证 URL、同注册域、issuer 不匹配、缺 PKCE S256。
- [x] 固定所有镜像/source 摘要，生成独立配置与 Compose secrets；先运行 compose config 验证模型。
- [x] 实现真实 PostgreSQL、npm publish/install 和 S3 探针，重启后验证同一数据；隔离备份恢复目标，不删除原数据。
- [x] 启动并运行 test:infra 两次，确认每次真实执行；记录镜像 ID、数据摘要和结果。
- [x] 缺少外部配置时实测 access 命令非零，增加可供后续接入的无秘密配置示例。
- [x] 全图 build/typecheck/test/browser、workspace 检查与独立审查；新增验证记录并提交。

## Execution record

- 起点 main 471ae8e，工作区干净；开发分支 feat/g2-local-infra。
- 本机 Docker Engine 29.8.2 / Compose 5.5.1 可用；现有 5432、5433、9000 等属其他项目，使用 15432/14873/19000。
- 基线 contracts 145/145 通过。用户已确认无现成 OIDC/独立预览域，本轮只交付对应接入检查工具。
- Task 1 已提交 d18ce0e；Task 2 独立审查两项 P2（S3 超时、管理 API 注册域）均已 RED→GREEN 修复。最终独立工作树全图 build10/type14 无缓存、根198、浏览器15、设施17 测试通过，修复后真实三存储再次两轮通过；证据见 docs/verification/g2-local-infra-2026-11-12.md。
- 共享目录被 CLI 工作切换分支后，C 在独立工作树 feat/g2-local-infra 提交，保留源目录已有修改；最终代码以 C 分支为准。不合并、不推送，完整 G1/G2/T01 状态不变。
