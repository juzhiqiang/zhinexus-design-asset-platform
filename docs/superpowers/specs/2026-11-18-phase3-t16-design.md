# T16 受控安装、代码生成与恢复设计

日期：2026-11-18（Asia/Shanghai）。基线 `main@c067c81d`。本文细化用户要求继续的 T16，沿用既有 T15–T17 范围；具体方案由 C 选择。用户当前没有真实试点项目，开发和技术验收仅在明确标注 synthetic 的仓外临时 Vue/React 工程中运行。不得因此标记完整 T16 或三期完成。

## 目标和边界

消费 T15 的 `IntegrationPlanV1`，提供显式 apply、受控依赖安装、Vue SFC / React TSX 生成，以及保留用户后续编辑的恢复。T15 的 inspect/plan 和 `executionAuthorized:false` 语义保持不变。服务端、画廊、SDK、冻结 SDK tarball、原始架构文件不改。

本轮先完成 C 所有的 P0 写入/恢复契约与公共 fixtures，然后依原四客户端约定交 B 产品、A 矩阵、D 黑盒、C 集成。不可把 Codex 子代理冒称实际客户端。客户端不可用时记录情况，产品文件归属调整须显式记入本轮计划，不能互相覆盖。

## 授权与协议

新增 `IntegrationApplyAuthorizationV1`：schemaVersion=1、operation=`apply`、projectRoot（调用者显式提供的绝对路径）、planDigest（整个规范 JSON 计划 SHA-256）、allowedPaths（精确列举计划改动）、allowInstall（布尔）。仅 CLI 显式 apply 调用能在内存构造授权；磁盘旧计划本身永不授权执行。验证器只证明结构和交叉引用；实际 root 的 realpath、授权来源、计划新鲜度由调用边界检验，不将 JSON 自报字段当人类授权。

新增 `IntegrationApplyResultV1`：schemaVersion=1、operation=`apply`、operationId（安全单段 ID）、projectRoot、planDigest、status=`applied|blocked|rolled-back|recovery-required`、changedFiles、beforeHashes、afterHashes、installedVersions、issues、backupRef?、installState=`not-run|succeeded|failed|reinstall-required`。changedFiles 是已实际提交写入的路径；每个路径必须各有 before/after 快照；新增文件用 exists:false 表示旧状态。installedVersions 只表示真实安装后验证的精确直接依赖，不能从计划复制。`applied` 无 issues，且 before/after/changedFiles 非空；有安装意图时须成功验证。失败恢复仍保留已经尝试写入的摘要证据，不能把状态洗为成功。

新增 `IntegrationBackupV1`：schemaVersion=1、operationId、projectRoot、planDigest、installPlanned、installStarted、files。`installPlanned` 绑定计划意图；`installStarted` 是恢复日志中的实际副作用证据，安装进程启动前必须先持久写为 true。files 逐项包含 path、before 快照、after 快照、originalBase64?。旧文件必须提供原始字节（允许空文件的空串），新增文件禁止提供原始字节。快照 path 必须与外层 path 完全一致；所有路径按 NFC + 大小写去重。JSON Schema 给结构，运行时验证器补所有交叉约束；原字节 SHA-256 必须由本地恢复代码实际复算，不由同步纯结构校验器伪称验证。

新增 `IntegrationRollbackResultV1`：schemaVersion=1、operation=`rollback`、operationId、projectRoot、planDigest、status=`rolled-back|recovery-required`、restoredPaths、unchangedPaths、preservedPaths、必填 unresolvedPaths、issues、installState=`not-run|reinstall-required`。四组路径互斥、去重并完整覆盖备份候选集：匹配 afterHash 且安全恢复的进入 restoredPaths，仍匹配 beforeHash 或仍不存在的未写入候选进入 unchangedPaths，实际发现后续编辑的进入 preservedPaths + `USER_EDITED` 且不得覆盖；读取、删除或恢复写入失败的进入 unresolvedPaths + 同路径 `WRITE_FAILED` 或 `RECOVERY_REQUIRED`，不得误报用户编辑。仅在 preservedPaths 和 unresolvedPaths 都为空时 rolled-back 且无 issues。只有安装实际启动时，文件恢复才必须返回 reinstall-required；单有安装计划不能伪造副作用。

2026-11-18 恢复补充：备份落盘后首个目标写入失败且安全恢复完成，apply 可返回 rolled-back、空 changedFiles / beforeHashes / afterHashes、not-run 和 WRITE_FAILED，保留有效 backupRef；不能虚构已提交写入以适配状态机。每次持久化 installStarted 或改变备份字节后，必须重新计算 backupRef.sha256，返回与最后落盘字节一致的不可变引用。rollback 的 WRITE_FAILED / RECOVERY_REQUIRED 必须显式绑定 unresolvedPaths 内的路径，不接受无路径的全局摘要问题。

固定 issue code：`INVALID_PLAN`、`AUTHORIZATION_REQUIRED`、`AUTHORIZATION_MISMATCH`、`PROJECT_CHANGED`、`PATH_UNSAFE`、`DIRTY_TARGET`、`TARGET_CHANGED`、`DEPENDENCY_CONFLICT`、`API_MISMATCH`、`BINDING_UNSUPPORTED`、`INSTALL_FAILED`、`INSTALLED_VERSION_MISMATCH`、`BACKUP_INVALID`、`WRITE_FAILED`、`USER_EDITED`、`RECOVERY_REQUIRED`。消息为固定脱敏说明，可附合法相对 path，不能回显网络/子进程原文或令牌。

## 应用流程

1. 校验完整计划、canonical 摘要、planned 状态和独立授权，重新 derive 写入路径和固定命令，拒绝任意离线 commands/allowedPaths 注入。
2. 重跑 inspection 和远端计划核验。比较原始 MatchPlan、精确发布/摘要/API、依赖、文件快照和写入意图；忽略 checkedAt 等纯检查时间字段。任何差异失败关闭；API / registry 两套凭据不互传。
3. 生成器消费权威 API 与已验证 MatchPlan。生成文件不直接注入 source/handler/layout 文本为源码；业务源/事件名通过安全字符串 key 和显式 props/callbacks 适配，未知必需数据不得伪造。Vue 用 SFC，React 用 TSX 和客户端边界；styles 使用真实导出，事件采用真实框架 API。不自动修改已有路由或页面。
4. 依赖安装前，仓外暂存区生成候选锁，禁用生命周期脚本和项目自定义包管理器 hooks/config。暂存区仅复制明确允许的 manifests/锁/workspace 配置；不支持的本地依赖/动态配置明确拒绝，不执行。读取官方 npm/pnpm 对应版本资料后在产品计划中固定具体 argv 与环境。暂存安装不触碰目标。
5. 写入前备份原字节到目标外独占目录；只接受安全普通文件，无符号链接/junction/hardlink；限制大小，校验原字节摘要。备份在任何目标写入前完整落盘。逐文件再次检查 base hash，再以独占新增或受控替换写入；每次原子操作前复查父路径，拒绝 root 外路径。恢复时对全部备份候选逐项归入 restored、unchanged、preserved 或 unresolved，部分写入不得把未写入候选冒称为恢复，I/O 失败不得冒称为用户编辑。并发不能完全由字符串校验证明，测试覆盖实际发现边界，文档明确限制。
6. 需要安装时显式授权 `allowInstall=true`，使用确定的包管理器和候选冻结锁安装；启动安装进程前先将备份恢复日志的 installStarted 持久化为 true。不执行项目 typecheck/build（T17），不把离线 plan 的命令传给 shell。node_modules 属于明确的安装副作用，不属于源码备份范围；不递归删除或覆盖未知链接。
7. 安装后实际读取直接依赖版本、目标清单/锁与生成文件 SHA；成功才输出 applied。失败后按 afterHash 恢复可恢复文件；任何新编辑保留并返回 recovery-required，依赖状态明确 reinstall-required。不可假称完全回滚 node_modules。

## CLI 与恢复

产品预期接口：`applyIntegration(root, plan, options):Promise<IntegrationApplyResultV1>`，`rollbackIntegration(root, backupRef, options):Promise<IntegrationRollbackResultV1>`。apply options 包含调用边界构造的 authorization、apiUrl、registryUrl、两套独立内存凭据和外部 backupRoot；没有 authorization 即拒绝，不能从文件或 MatchPlan 推断。rollback 不复用旧 apply 授权对象；本次显式 root + backupRef 调用构成恢复授权边界，并重新核验 operationId、projectRoot、planDigest、备份摘要和实际字节。

CLI `component integrate apply --project <root> --plan <file> --api-url <origin> --registry <origin> --backup-root <outside-root> --allow-install <true|false>` 明确授权本次 root 和 plan 摘要；授权路径只能来自重新派生且完全一致的计划。rollback 要求显式 project + backup，复核备份 root 绑定和实际字节。退出 0 成功，2 结构化阻断/需人工恢复，1 参数或执行失败；stdout 单 JSON。错误输出不得泄露凭据。

## 验收

P0：合法四种契约、授权错绑、旧计划授权 false、路径/摘要/快照错配、空旧文件、坏 base64、重复/别名路径、状态造假、伪造 installedVersions、计划安装与实际启动区分、首写失败无虚构写入、恢复四组覆盖及 Schema/CLI 副本同步；固定工具链构建、类型、全图及根回归。

P1 的 options、安装 argv、环境白名单、暂存产物进入目标的方法和首批产品 RED 用例由 [B 安装隔离 brief](../plans/2026-11-18-t16-b-install-isolation-brief.md) 冻结；安装隔离仍须以真实 Windows npm/pnpm 进程验收，不以文档或 mock 验收。

产品：npm/pnpm × Vue/React、显式 workspace；真实仓外冻结 SDK 安装，真实类型与构建；未知 prop/event、危险绑定表达式、原始文件变化、安装失败、中途编辑、Windows 路径和双跳 junction、恢复前/期间改动保护。独立进程验收与同一冻结 CLI 真实服务验收后方可称技术完成；两个真实授权业务项目 diff 仍是完整 T16 门槛。版本按公开 CLI 既有 0.x 规则独立升级，不发布生产或 push。

2026-11-19 同次 apply 恢复补充：本次执行可以从最后成功持久化、绑定 backupRef id/hash 与上下文的可信不可变内存备份恢复源码；磁盘祖先被替换后不再读取该路径，冷启动 rollback 仍完整拒绝不可信磁盘路径。未落盘候选不算备份，安装副作用分类和用户编辑保护保持原契约。精确外部目录所有权标记及独立 RED 见 [安装 brief](../plans/2026-11-18-t16-b-install-isolation-brief.md) 与 [本轮记录](../../verification/t16-hot-recovery-2026-11-19.md)。
