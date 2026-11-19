# T17 本地验证、有限修复与 MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 按已确认分工由实际 Antigravity 主开发、Codex 协调，并保留各实际客户端的交付身份。

**Goal:** 交付 T17 原生命令、真实交互和视觉验证、有限模板修复及四工具 stdio MCP，以仓外冻结安装和授权临时 Vue/React 工程完成本轮验收。

**Architecture:** T17 消费 T15 plan、真实 T16 apply 结果、独立 spec 和执行授权。修复沿同一次调用的私有可信哈希链重验。CLI 与 MCP 共用产品和契约，报告、备份和外部证据以摘要关联。

**Tech Stack:** Windows x64、Node 26.13.0、pnpm 12.18.0、本机已验证的 npm 11.20.0、TypeScript、Vitest、Playwright Chromium、Vue 3.5.45、React 19.3.1、ECharts 6.1.0。C0 本机探针使用 `@modelcontextprotocol/server@2.4.0`、`@modelcontextprotocol/client@2.4.0` 与 `zod@4.6.7`。

**Spec:** [T17 设计](../specs/2026-11-19-phase3-t17-design.md)。相关基线见 [总实施计划](2026-11-11-component-platform-implementation.md)、[三人分工](2026-11-11-three-person-allocation.md) 和 [T16 main 收口记录](../../verification/t16-main-completion-2026-11-19.md)。

## Global Constraints

- 起点 main@`7e10ba19`。C 在 `feat/t17-integration` 集成，各实际客户端使用独立工作树或分支。先冻结契约，最多四项同时进行，A 串行负责 CLI 产品文件。
- 使用 `scripts/pnpm.ps1` 和 `.tools` 的固定工具链，依赖版本精确锁定。原生命令和 Chromium 只在开发者本机运行。工作区保持 10 个成员，测试及外部安装避开 Turbo 缓存。
- T15 `executionAuthorized:false` 与命令预览语义保持。T16 未安装 apply 可含 `installedVersions=[]`，T17 需从实际安装树、锁与清单字节独立取证。
- 共同身份为 `schemaVersion:1, projectRoot, planDigest, applyResultDigest`。授权、报告、修复结果另绑 `specDigest`。对象摘要按 SHA-256(`canonicalJson`)，文件摘要按原字节。
- 公共 verify 守卫始于原 apply `afterHashes`。修复只允许计划生成文件，`maxAttempts` 接受 `0|1|2`，默认 2。命令来自固定的实际项目脚本。视觉基线只由显式流程接纳。
- 视觉默认 `pixelThreshold=0.1`、`maxDiffPixelRatio=0.001`。源快照限单文件 4 MiB、10000 文件、合计 256 MiB。`artifactRoot` 由操作边界绑定到工程外，基线相对此根，证据写独占子目录。
- 接入报告与发布报告分离。本轮采用用户授权创建和清理的 temporary/synthetic 工程。历史真实业务试点需独立验收。
- 原始架构 SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。保留用户工作区与既有证据。Git 提交按仓规聚焦，push/tag、合并及生产操作遵循原授权边界。

## Review Focus

1. 修复后的内部验证消费当前轮次受信字节，外部替代哈希被拒绝，三个原始身份摘要不变（A2）。
2. 无安装 apply 可读，依赖缺失或被替换时页面通过也不足以通过报告（C0、A1、D）。
3. 错误宿主页或静态替身不计入独立矩阵。保存真实入口 import、构建及模块资源加载证据（B、C2）。
4. 未授权 pre/post 钩子、输出目录别名、用户新增/删除及晚期写入均有拒绝证据（C0、A1、A2）。
5. MCP 假授权、失败/取消后的 stdout 污染及残留进程有真实 stdio 客户端回归（A3、D）。

---

## 文件与先决条件

| 作者 | 唯一写入范围 | 交付与依赖 |
| --- | --- | --- |
| C / Codex | `packages/contracts/src/{integration-verification,integration-repair,integration-apply,index,schemas}.ts`、生成 Schema、共享契约测试与 fixtures、CLI `scripts/sync-contracts.mjs`、依赖/锁、README、assessment/总计划、验收编排、版本/CHANGELOG 与 C 记录 | C0 冻结后 A/B/D 可开工，C1/C2 收取和验证实际交付 |
| A / 实际 Antigravity | CLI `src/integration/{verify,repair,report}.ts`、相邻 helper、`src/mcp/server.ts`、`src/commands/integrate.ts`、`src/{index,bin}.ts`、对应产品测试 | A1 → A2 → A3 |
| B / 实际 Claude 客户端 | `tests/acceptance/t17-matrix/**`、`tests/fixtures/t17-matrix/**`、`docs/verification/t17-matrix-2026-11-19.md` | 可提前编制独立预期，最终使用 C 冻结包 |
| D / 实际 Claude Code | `tests/acceptance/t17-blackbox/**`、`docs/verification/t17-blackbox-2026-11-19.md` | 可提前编制独立黑盒，最终使用 C 冻结包 |

各作者先读对应仓库规则。以下开工依赖只允许定向 RED 和实现。最终验收需要实际安装、真实 API/Registry、本机原生命令与 Chromium。定向 Vitest 的通用调用为 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run',<test-files>)`。配置入口使用 `--config`。每项交付记录 RED、GREEN、命令和退出码，审查暂存文件，再按仓规创建中文聚焦提交。

### C0 冻结契约与命令表

**接口:** 从 `@company/contracts` 导出 `IntegrationVerificationSpecV1`、`IntegrationExecutionAuthorizationV1`、`IntegrationVerificationReportV1`、`IntegrationRepairResultV1`、四份 Schema，以及 `validateIntegrationVerificationSpec`、`validateIntegrationExecutionAuthorization`、`validateIntegrationVerificationReport`、`validateIntegrationRepairResult`。

- [ ] 在 `tests/contracts/{integration-verification,integration-repair}.test.ts` 和同名 `tests/fixtures/*.ts` 钉住固定字段、类别、issue、摘要绑定和例子。为 apply context 加入无安装 `applied + []` 合法、授权后实际安装记录缺失或错误仍非法的用例。
- [ ] 执行 `./scripts/pnpm.ps1 -PnpmArgs @('--filter','@company/contracts','build')`，再定向跑上述契约与既有 apply suite，记录新导出和现有无安装守卫预期 RED。
- [ ] 实现纯结构与交叉引用验证。`dependency-guard` 为必需 behavior 检查，报告共五类。verify scope 的 repair 路径为空且次数为 0，repair 绑定源报告及生成文件。apply context 最小对齐无安装语义。保留真实授权、字节及执行检查到本地产品边界。
- [ ] 补契约 `index.ts`、`schemas.ts` 和 CLI `scripts/sync-contracts.mjs`，运行 `./scripts/pnpm.ps1 -PnpmArgs @('--filter','@company/contracts','schemas:generate')`。四份 JSON Schema、相关契约测试和 CLI build/package probe 均须通过。
- [ ] 核验 MCP 官方协议、服务端/客户端 SDK 导出、精确依赖元数据及 peer。固定 Node 实测 server/client 2.4.0 与 zod 4.6.7；`serveStdio` 运行 `McpServer` 并用 `registerTool` 注册，实际通过 stdio 握手、list/call 和 strict schema 的额外字段拒绝，探针 stderr 为空。C 在 P0 记录来源与精确锁。
- [ ] 核验 npm/pnpm 官方 run、ignore-scripts 与 lifecycle 语义并记录 poison sentinel。已实测 npm 为固定 `node.exe` 执行 `[npm-cli.js, '--ignore-scripts', 'run', script]`；pnpm 为固定 `pnpm.exe` 执行 `['run', script]`，环境设 `PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS=false` 与 `PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false`。两者只写目标脚本 sentinel、退出 0。命令表保留实际绝对路径、cwd、环境白名单、超时与取消方式；验证不隐式安装。
- [ ] 冻结命令 `component integrate verify --project <project> --plan <file> --apply-result <file> --spec <file> --out <external-dir> --allow-project-scripts <true|false> --allow-browser <true|false>`。repair 同组参数另加 `--report <file> [--max-attempts <0|1|2>]`。可信边界派生 scriptNames 与生成文件路径。冻结 `component mcp serve` 的宿主启动绑定、四工具输入和权限示例。
- [ ] 在 `docs/verification/t17-contract-freeze-2026-11-19.md` 记录 RED/GREEN、官方来源、探针与实际锁定，提交 `feat: 冻结接入验证修复与 MCP 契约`，交实际 A/B/D。

### A1 本地验证与证据报告

**文件:** CLI `src/integration/{verify,report}.ts` 及必要相邻 helper。测试 `tests/integration/project-verify.test.ts`、`tests/browser/generated-page.spec.ts`。

**接口:** `verifyIntegration(root, plan, { applyResult, spec, authorization, artifactRoot, ...adapters }): Promise<IntegrationVerificationReportV1>`。

- [ ] 写 RED。真实 apply 后进入执行。错误 root、plan/apply/spec 摘要、manifest、实际安装树版本或锁均拒绝，页面通过时依赖 guard 仍失败。T15 预览和 apply 前 hash 不能成为执行证据。
- [ ] 写原生命令和快照 RED。授权脚本确实运行，pre/post sentinel 未出现。合法 dist 可产出，src、链接和别名不能排除，新增、修改、删除均进入证据。超时超限结构化失败，stderr 与报告不得反射敏感值或执行建议。
- [ ] 写真实 Chromium RED。Vue/React 宿主 import 实际生成模块。类型通过而点击失败时报告失败。fill/visible/text/count 用实际 DOM。零尺寸、pageerror、外发与弹窗均失败。`NEW/DIFF/INCOMPATIBLE` 不通过，基线 bytes 不变。
- [ ] 定向运行 `project-verify.test.ts`，完成 build、释放已有浏览器测试端口后运行 `test:browser generated-page.spec.ts`，确认 RED。
- [ ] 实现分段守卫、真实依赖检查、原生命令、有限行为、视觉比较和人工缺口。输出外部独占证据，按实跑检查赋状态。报告 passed 只说明可信调用方显式给出的宿主页及检查通过。
- [ ] 复跑定向 Vitest、browser spec、CLI build/typecheck，复读截图和证据摘要并核对项目写集。提交 `feat: 实现本地项目验证与证据报告`。

### A2 有限修复与 CLI 入口

**文件:** CLI `src/integration/repair.ts`、A1 相邻私有 helper、`src/{commands/integrate,index}.ts`。测试 `tests/integration/{integration-repair,project-verify-cli}.test.ts`。

**接口:** `repairIntegration(root, plan, report, { applyResult, spec, authorization, maxAttempts, artifactRoot, ...adapters }): Promise<IntegrationRepairResultV1>`。

- [ ] 写确定模板 recipe RED。至少一个已知生成模板故障由实际受控 apply 写出并由原始 afterHashes 覆盖，从 behavior failed 修复到 passed。用 T16 权威数据重生成，固定 recipeId 与精确识别字节，存在额外用户差异立即拒绝。夹具标注 synthetic。
- [ ] 写守卫 RED。错误源报告摘要、用户新建/编辑/删除、真实路径替换、备份失败与晚期 hash 变化均阻断写入。部分写入只恢复本次仍匹配字节，无法恢复为 `recovery-required`。预算 0 零写入，1 至多一轮，默认 2 至多两轮，3 冷拒绝。
- [ ] 写续接 RED。修复后完整重验，当前 repair 私有基线来自本轮已写入并复读的字节。下一轮与上一轮已提交哈希、报告摘要对应。外部 JSON/普通 verify 不能提供替代守卫，原 apply/plan/spec 摘要不变，包清单、锁、业务文件和基线未被 repair 修改。
- [ ] 定向运行两个新 suite 确认 RED。实现已知模板 recipe、外部原字节备份、晚 hash 守卫、最窄写入和每轮全量重新验证。保留前后报告及证据链，保护用户修改。预算耗尽或无 recipe 交付问题。
- [ ] 按 C0 接入命令与导出。坏 JSON、未知/重复/缺失 flags 与跨根摘要失败。stdout 单 JSON，stderr 脱敏，退出 0/2/1。关闭 stderr/报告的敏感输入回显缺口。
- [ ] 复跑新 suite、`project-apply.test.ts`、`project-rollback.test.ts`、`project-install-isolation.test.ts`、CLI build/typecheck。提交 `feat: 交付受控接入修复与命令入口`。

### A3 四工具本地 stdio MCP

**文件:** CLI `src/mcp/server.ts`、`src/bin.ts` 及相邻 helper。测试 `tests/integration/project-mcp.test.ts`。

- [ ] 用 C0 官方 SDK 写实际 client RED。initialize、tools/list 精确列出 `inspect_project`、`plan_integration`、`apply_integration`、`verify_integration`。verify 不标只读。未知工具、repair、额外 executable/自由路径/假批准均有协议拒绝。
- [ ] 测试同 plan/apply/spec 与等价权限的 CLI/MCP 语义一致。比较状态、固定 issue code、变更和稳定证据摘要，忽略随机 id、时间和独占目录。未经宿主批准的 apply、脚本/browser 和任何越根请求必须拒绝。核对 stdout、不混入日志、取消和退出只清理本次所有的进程。
- [ ] 定向运行 `project-mcp.test.ts` 确认 RED，再用真实 stdio SDK 接入启动绑定。四工具调用共用产品、校验和路径边界，忽略请求自报批准。verify 仅调用 verify 产品函数。
- [ ] 复跑真实 SDK 双进程测试、CLI build/typecheck，确认四工具、取消和退出。提交 `feat: 暴露四个本地接入 MCP 工具`。

### B 双框架独立支持矩阵

**文件:** `tests/acceptance/t17-matrix/{vitest.config,matrix.spec}.ts`、`tests/fixtures/t17-matrix/scenarios.json`、独立宿主和记录。

- [ ] 冻结设计表中 Vue 10 + React 10 个正向场景，每例预声明包管理器、standalone/workspace、冻结包身份、真实数据/事件、入口 import、断言和独立基线。预声明故障修复例的初始失败与最终通过。
- [ ] 单列强制拒绝。覆盖 peer 冲突、脏工程/写入间编辑、无候选、业务缺口、类型过点击失败、画面过版本错、视觉三态、两轮耗尽、路径链接、敏感输出、错宿主/静态替身。保存相应前置拒绝或验证报告。拒绝例不计正向分子或分母。
- [ ] 使用真实本地 API/Registry 和 C 冻结包在仓外运行。保存入口对本轮生成文件的 import、文件摘要、实际构建、本地宿主 URL、资源加载和真实浏览器报告。
- [ ] 运行 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-matrix/vitest.config.ts')`。固定分母并报告总计和分框架结果，支持域成功率至少 80%。失败、跳过、未运行和 blocked 不计成功，强制拒绝全部符合预期。提交 `test: 验收 Vue 与 React 的接入验证矩阵`。

### D 冻结 CLI 与 MCP 进程验收

**文件:** `tests/acceptance/t17-blackbox/{vitest.config,installed.spec}.ts`、独立支持设施和记录。使用实际 `node <installed>/dist/bin.js` 和 SDK client。

- [ ] 独立编制 Vue/React 临时宿主的 CLI inspect→plan→apply→verify、失败→repair→重验。验证实际安装清单、入口 import、单 JSON、退出 0/2/1、artifact 摘要和项目写集。预期来自契约与固定输入。
- [ ] 加独立负例。覆盖假 apply/安装身份、CLI 授权缺失、合成敏感 sentinel、用户后增文件、MCP 自报批准/额外工具、关闭/取消后的协议 stdout 和进程状态。
- [ ] 以同一新冻结包测四工具与 CLI 规范化一致。运行 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-blackbox/vitest.config.ts')`，强制项无 skip，记录逐例结果与包 SHA。提交 `test: 验收冻结 CLI 和 MCP 的真实进程`。

### C1 集成、文档与冻结

- [ ] 收取实际 Antigravity、Claude、Claude Code 的分支/补丁与验证。独立审查契约、产品与验收断言，关闭 Critical/Important 后集成。assessment/总计划记录本轮范围决定，原架构与历史证据保持原样。
- [ ] 更新 README 的授权调用、受信 loopback 前置、外部备份、退出码、修复证据和 stdio 权限。报告 passed 仅覆盖显式声明的验证，独立验收另核对入口与资源来源。
- [ ] 兼容改动按仓规独立升 CLI `0.0.14`→`0.0.15`，若已占用则取实际下一 PATCH。更新 `CHANGELOG.md` 与必要版本引用，提交 `chore: 升级版本号至 0.0.15` 或实际版本。
- [ ] 构建后仅一次在 CLI 工作目录执行 `pnpm pack --pack-destination <external-dir>`。通过包装器指定目录或使用现有 `packPackage`。记录版本、绝对路径、SHA-256、大小与来源 HEAD。实际安装、矩阵、截图、报告共用该文件。候选字节若因产品变化须另立冻结并全量复验，保留旧证据及既有 SDK。

### C2 最终验收与临时工程清理

- [ ] 使用包装器运行 `verify:workspace`、`exec turbo run build typecheck --force`（20/20、无缓存）、`exec tsc -p tsconfig.json --noEmit`、根 `test`（含 T10）及真实环境 `test:platform`。先 build，再确认 5173–5176 的验收端口可用并运行 `test:browser`。
- [ ] 用新冻结 CLI 与既有冻结 SDK 运行 `tests/acceptance/phase3-plan.config.ts` 和 `tests/acceptance/t16-installed.config.ts`，证明 T15/T16 行为在新产物中仍成立。两组均提供 `A10_FROZEN_BUNDLE`、`PHASE3_CLI_TARBALL`、`INSTALLED_CLI_EVIDENCE`；T10 用 `ZHINEXUS_SDK_BUNDLE_DIR`。若用旧 CLI 包诊断，须单列版本、SHA 和证据路径。
- [ ] 在同一新冻结 CLI 上运行 B/D。用授权的 Vue 与 React 各一个仓外临时项目完成实际安装、T15/T16 diff、原生命令、关键交互、视觉及修复证据，可复用矩阵中满足要求的两个全流程。记录 temporary/synthetic 与历史业务试点状态。
- [ ] C 复核错宿主页案例。入口应 import 本轮生成路径，真实构建和资源加载应与该次受控服务、hash 和报告绑定。保存工具链、命令、退出码、通过/失败/跳过、分母、文件/依赖、包/证据摘要、修复次数与未覆盖项。
- [ ] 确认本轮工程进程退出，在临时根外保存所需文件清单/hash、报告、截图和 diff。逐项核对创建清单、规范绝对路径、独占根和随机 runId 标记，再只清理本轮创建的临时项目。保留用户目录、工作树、共享目录和旧证据。路径或标记不确定则保留并记录。复查已授权目录清理结果。
- [ ] 核对原架构摘要和独立审查。新增 `docs/verification/t17-completion-2026-11-19.md` 记录实际命令、结果和限制，更新本轮任务状态。缺失的外部必检继续开放，历史真实业务试点保持单列。提交 `docs: 记录三期接入验收与临时工程清理证据`。

所有复选框用于后续执行。工作区已有的早期 RED 或依赖准备需独立核验。
