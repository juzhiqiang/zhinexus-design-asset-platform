# T17 本地验证、有限修复与 MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 按已确认分工由实际 Antigravity 主开发、Codex 协调，并保留各实际客户端的交付身份。

**Goal:** 交付 T17 原生命令、真实交互和视觉验证、有限模板修复及四工具 stdio MCP，以仓外冻结安装和授权临时 Vue/React 工程完成本轮验收。

**Architecture:** T17 消费 T15 plan、真实 T16 apply 结果、独立 spec 和执行授权。修复沿同一次调用的私有可信哈希链重验。CLI 与 MCP 共用产品和契约，报告、备份和外部证据以摘要关联。

**Tech Stack:** Windows x64、Node 26.13.0、pnpm 12.18.0、本机已验证的 npm 11.20.0、TypeScript、Vitest、Playwright Chromium、Vue 3.5.45、React 19.3.1、ECharts 6.1.0。C0 本机探针使用 `@modelcontextprotocol/server@2.4.0`、`@modelcontextprotocol/client@2.4.0` 与 `zod@4.6.7`。

**Spec:** [T17 设计](docs/specs/2026-11-19-phase3-t17-design.md)。相关基线见 [总实施计划](docs/plans/2026-11-11-component-platform-implementation.md)、[三人分工](docs/plans/2026-11-11-three-person-allocation.md) 和 [T16 main 收口记录](docs/verification/phase3-t16.md)。

## Global Constraints

- 起点 main@`7e10ba19`。C 在 `feat/t17-integration` 集成，各实际客户端使用独立工作树或分支。先冻结契约，最多四项同时进行，A 串行负责 CLI 产品文件。
- 2026-11-20 接续例外：实际 Antigravity 的 Gemini 与 Claude 渠道均额度耗尽，未开启付费 overages；Codex 接手续作，分离产品复核、宿主、矩阵和黑盒的文件所有权。保留原始交付身份，不把子代理称为其他客户端。
- 使用 `scripts/pnpm.ps1` 和 `.tools` 的固定工具链，依赖版本精确锁定。原生命令和 Chromium 只在开发者本机运行。工作区保持 10 个成员，测试及外部安装避开 Turbo 缓存。
- T15 `executionAuthorized:false` 与命令预览语义保持。T16 未安装 apply 可含 `installedVersions=[]`，T17 需从实际安装树、锁与清单字节独立取证。
- 共同身份为 `schemaVersion:1, projectRoot, planDigest, applyResultDigest`。授权、报告、修复结果另绑 `specDigest`。对象摘要按 SHA-256(`canonicalJson`)，文件摘要按原字节。
- 公共 verify 守卫始于原 apply `afterHashes`。修复只允许计划生成文件，`maxAttempts` 接受 `0|1|2`，默认 2。命令来自固定的实际项目脚本。视觉基线只由显式流程接纳。
- 既定验收阈值为 `pixelThreshold=0.1`、`maxDiffPixelRatio=0.001`；spec 含 visual 时必须显式提供两个字段。源快照限单文件 4 MiB、10000 文件、合计 256 MiB。`artifactRoot` 由操作边界绑定到工程外，基线相对此根，证据写独占子目录。
- 接入报告与发布报告分离。本轮采用用户授权创建和清理的 temporary/synthetic 工程。历史真实业务试点需独立验收。
- 原始架构 SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。保留用户工作区与既有证据。Git 提交按仓规聚焦，push/tag、合并及生产操作遵循原授权边界。

## Review Focus

### 2026-11-20 当前证据索引

原任务复选框中有些条目同时要求“最初先确认 RED”与当前产品行为；未追溯到原始运行记录的过程不因当前 GREEN 倒勾。当前可复查的产品验收和历史过程缺口分列如下，最终结论以日期记录为准。

| 范围 | 当前事实 | 独立证据 / 尚待项 |
| --- | --- | --- |
| C0 契约与命令表 | 当前结构、精确依赖/导出、无安装语义、strict stdio 与官方后补已具证据 | [当前本机](docs/verification/phase3-t17.md)、[官方更正](docs/verification/phase3-t17.md)、[无安装契约](docs/verification/phase3-t17.md)；原 P0/初始 RED/原 stderr 空字节仍缺 |
| A1/A2/A3 当前产品 | verify、有限 repair、四工具 MCP 已实现；源快照、SDK错误脱敏和异步DOM断言等待修复均有独立证据与复审 | [源快照续接](docs/verification/phase3-t17.md)、[SDK 错误脱敏](docs/verification/phase3-t17.md)、[异步断言](docs/verification/phase3-t17.md)；不追认未保存的原始实现 RED 顺序 |
| 工程与既有接入回归 | 同一0.0.23：全图 20/20（0 cached）、根 tsc、根测 2210/2210、T10 168/168、平台 137/137、浏览器 288/288；T15 25/25、T16 14/14 | [工程](docs/verification/phase3-t17.md)、[T15/T16](docs/verification/phase3-t17.md)，零跳过 |
| 双框架宿主 | 0.0.23完整入口1/1，正向及受控单次修复四链各6/6通过；34681份归档和四张实图经主线独立复读 | [当前宿主](docs/verification/phase3-t17.md)；顶部标题裁切为固定构图限制 |
| D 当前独立黑盒 | 0.0.23的live与installed两个完整入口各5/5，17 receipts与四条canonical链通过；补充探针另列不增加49分母 | [当前黑盒](docs/verification/phase3-t17.md)；不把该结果计入B分母 |
| B 固定矩阵 | 0.0.23完整入口自然exit0、3481.91s；正向20/20、各框架10/10，13项强制拒绝均符合各自预期；原件正式评分通过 | [当前矩阵](docs/verification/phase3-t17.md)；N13为独立来源检测，未调用verify；[0.0.22历史19/20及R08失败](docs/verification/phase3-t17.md)保留 |
| 清理与终审 | 0.0.23宿主三个parent、D十二新根和矩阵59个parent已清理并独立核对；矩阵59根/23162份evidence原件与副本一致；最终记录独立Approved，Critical/Important/Minor均0 | [当前汇总](docs/verification/phase3-t17.md)、[最终记录审查](docs/verification/phase3-t17.md)；历史受阻及身份不足目录继续保留，不称全部清空 |

### 审查重点

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
| B / 实际 Claude 客户端 | `tests/acceptance/t17-matrix/**`、`tests/fixtures/t17-matrix/**`、`docs/verification/phase3-t17.md` | 可提前编制独立预期，最终使用 C 冻结包 |
| D / 实际 Claude Code | `tests/acceptance/t17-blackbox/**`、`docs/verification/phase3-t17.md` | 可提前编制独立黑盒，最终使用 C 冻结包 |

各作者先读对应仓库规则。以下开工依赖只允许定向 RED 和实现。最终验收需要实际安装、真实 API/Registry、本机原生命令与 Chromium。定向 Vitest 的通用调用为 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run',<test-files>)`。配置入口使用 `--config`。每项交付记录 RED、GREEN、命令和退出码，审查暂存文件，再按仓规创建中文聚焦提交。

### C0 冻结契约与命令表

**接口:** 从 `@company/contracts` 导出 `IntegrationVerificationSpecV1`、`IntegrationExecutionAuthorizationV1`、`IntegrationVerificationReportV1`、`IntegrationRepairResultV1`、四份 Schema，以及 `validateIntegrationVerificationSpec`、`validateIntegrationExecutionAuthorization`、`validateIntegrationVerificationReport`、`validateIntegrationRepairResult`。

- [x] 当前 `tests/contracts/{integration-verification,integration-repair}.test.ts` 和同名 `tests/fixtures/*.ts` 已覆盖固定字段、类别、issue、摘要绑定和例子；apply context 已覆盖无安装 `applied + []` 合法、授权后实际安装记录缺失或错误仍非法。无安装语义有独立 RED/GREEN，见 [契约对齐](docs/verification/phase3-t17.md)。
- [ ] 执行 `./scripts/pnpm.ps1 -PnpmArgs @('--filter','@company/contracts','build')`，再定向跑上述契约与既有 apply suite，记录新导出和现有无安装守卫预期 RED。
- [x] 纯结构与交叉引用验证已实现。`dependency-guard` 为必需 behavior 检查，报告共五类。verify scope 的 repair 路径为空且次数为 0，repair 绑定源报告及生成文件。apply context 已对齐无安装语义。真实授权、字节及执行检查在本地产品边界独立完成。
- [x] 契约 `index.ts`、`schemas.ts` 和 CLI `scripts/sync-contracts.mjs` 已同步；`./scripts/pnpm.ps1 -PnpmArgs @('--filter','@company/contracts','schemas:generate')` 已运行。四份 JSON Schema、相关契约测试与 CLI build/package probe 73/73 均通过。
- [ ] 核验 MCP 官方协议、服务端/客户端 SDK 导出、精确依赖元数据及 peer。固定 Node 实测 server/client 2.4.0 与 zod 4.6.7；`serveStdio` 运行 `McpServer` 并用 `registerTool` 注册，实际通过 stdio 握手、list/call 和 strict schema 的额外字段拒绝，探针 stderr 为空。C 在 P0 记录来源与精确锁。
- [ ] 核验 npm/pnpm run、ignore-scripts 与 lifecycle 语义并记录 poison sentinel。已实测 npm 为固定 `node.exe` 执行 `[npm-cli.js, '--ignore-scripts', 'run', script]`；pnpm 为固定 `pnpm.exe` 执行 `['--pm-on-fail=ignore', '--config.verifyDepsBeforeRun=false', 'run', script]`，环境设 `PNPM_CONFIG_ENABLE_PRE_POST_SCRIPTS=false` 与 `PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false`。两者只写目标脚本 sentinel、退出 0。命令表保留实际绝对路径、cwd、环境白名单、超时与取消方式；验证不隐式安装或重新引导管理器。固定 pnpm 参数效果以本机真实 RED/GREEN 为据，见 [隐式安装](docs/verification/phase3-t17.md) 与 [管理器引导](docs/verification/phase3-t17.md)，不声称已读取不可达官方页面。
- [x] 已冻结命令 `component integrate verify --project <project> --plan <file> --apply-result <file> --spec <file> --out <external-dir> --allow-project-scripts <true|false> --allow-browser <true|false>`；repair 同组参数另加 `--report <file> [--max-attempts <0|1|2>]`。可信边界派生 scriptNames 与生成文件路径。`component mcp serve` 的宿主启动绑定和四工具输入见 [调用说明](docs/phases/phase3/local-project-verification.md)。
- [ ] 在实际 [T17 集成记录](docs/verification/phase3-t17.md) 及其关联记录中保存 RED/GREEN、探针与实际锁定，提交 `feat: 冻结接入验证修复与 MCP 契约`，交实际 A/B/D。官方来源与本机实测分别注明，不引用不存在的冻结记录。

### A1 本地验证与证据报告

**文件:** CLI `src/integration/{verify,report}.ts` 及必要相邻 helper。测试 `tests/integration/project-verify.test.ts`、`tests/browser/generated-page.spec.ts`。

**接口:** `verifyIntegration(root, plan, { applyResult, spec, authorization, artifactRoot, ...adapters }): Promise<IntegrationVerificationReportV1>`。

- [ ] 写 RED。真实 apply 后进入执行。错误 root、plan/apply/spec 摘要、manifest、实际安装树版本或锁均拒绝，页面通过时依赖 guard 仍失败。T15 预览和 apply 前 hash 不能成为执行证据。
- [ ] 写原生命令和快照 RED。授权脚本确实运行，pre/post sentinel 未出现。合法 dist 可产出，src、链接和别名不能排除，新增、修改、删除均进入证据。超时超限结构化失败，stderr 与报告不得反射敏感值或执行建议。
- [ ] 写真实 Chromium RED。Vue/React 宿主 import 实际生成模块。类型通过而点击失败时报告失败。fill/visible/text/count 用实际 DOM。零尺寸、pageerror、外发与弹窗均失败。`NEW/DIFF/INCOMPATIBLE` 不通过，基线 bytes 不变。
- [ ] 定向运行 `project-verify.test.ts`，完成 build、释放已有浏览器测试端口后运行 `test:browser generated-page.spec.ts`，确认 RED。
- [x] 当前已实现分段守卫、真实依赖检查、原生命令、有限行为、视觉比较和人工缺口。输出外部独占证据，按实跑检查赋状态。报告 passed 只说明可信调用方显式给出的宿主页及检查通过；实现与边界见 [调用说明](docs/phases/phase3/local-project-verification.md)。
- [x] 当前0.0.23完整工程、浏览器、双框架宿主和固定矩阵已通过，截图、证据摘要及项目写集已独立复读。实现提交与历史局部RED/GREEN见 [集成记录](docs/verification/phase3-t17.md)，不据当前GREEN补认上列最初RED过程。

### A2 有限修复与 CLI 入口

**文件:** CLI `src/integration/repair.ts`、A1 相邻私有 helper、`src/{commands/integrate,index}.ts`。测试 `tests/integration/{integration-repair,project-verify-cli}.test.ts`。

**接口:** `repairIntegration(root, plan, report, { applyResult, spec, authorization, maxAttempts, artifactRoot, ...adapters }): Promise<IntegrationRepairResultV1>`。

- [ ] 写确定模板 recipe RED。至少一个已知生成模板故障由实际受控 apply 写出并由原始 afterHashes 覆盖，从 behavior failed 修复到 passed。用 T16 权威数据重生成，固定 recipeId 与精确识别字节，存在额外用户差异立即拒绝。夹具标注 synthetic。
- [ ] 写守卫 RED。错误源报告摘要、用户新建/编辑/删除、真实路径替换、备份失败与晚期 hash 变化均阻断写入。部分写入只恢复本次仍匹配字节，无法恢复为 `recovery-required`。预算 0 零写入，1 至多一轮，默认 2 至多两轮，3 冷拒绝。
- [ ] 写续接 RED。修复后完整重验，当前 repair 私有基线来自本轮已写入并复读的字节。下一轮与上一轮已提交哈希、报告摘要对应。外部 JSON/普通 verify 不能提供替代守卫，原 apply/plan/spec 摘要不变，包清单、锁、业务文件和基线未被 repair 修改。
- [ ] 定向运行两个新 suite 确认 RED。实现已知模板 recipe、外部原字节备份、晚 hash 守卫、最窄写入和每轮全量重新验证。保留前后报告及证据链，保护用户修改。预算耗尽或无 recipe 交付问题。
- [x] 当前已按 C0 接入命令与导出。坏 JSON、未知/重复/缺失 flags 与跨根摘要失败。stdout 单 JSON，stderr 脱敏，退出 0/2/1；SDK自动错误与报告回显修复另有 [独立RED/GREEN](docs/verification/phase3-t17.md)。
- [x] 当前完整根测已覆盖新suite及既有apply/rollback/install-isolation，CLI build/typecheck通过；外部宿主真实单次修复及矩阵N10两轮耗尽均有原件，见 [当前汇总](docs/verification/phase3-t17.md)。

### A3 四工具本地 stdio MCP

**文件:** CLI `src/mcp/server.ts`、`src/bin.ts` 及相邻 helper。测试 `tests/integration/project-mcp.test.ts`。

- [ ] 用 C0 官方 SDK 写实际 client RED。initialize、tools/list 精确列出 `inspect_project`、`plan_integration`、`apply_integration`、`verify_integration`。verify 不标只读。未知工具、repair、额外 executable/自由路径/假批准均有协议拒绝。
- [ ] 测试同 plan/apply/spec 与等价权限的 CLI/MCP 语义一致。比较状态、固定 issue code、变更和稳定证据摘要，忽略随机 id、时间和独占目录。未经宿主批准的 apply、脚本/browser 和任何越根请求必须拒绝。核对 stdout、不混入日志、取消和退出只清理本次所有的进程。
- [ ] 定向运行 `project-mcp.test.ts` 确认 RED，再用真实 stdio SDK 接入启动绑定。四工具调用共用产品、校验和路径边界，忽略请求自报批准。verify 仅调用 verify 产品函数。
- [x] 当前真实SDK双进程、CLI build/typecheck及完整installed/live黑盒已确认四工具、取消和退出。完整配置无skip、自然exit0，见 [0.0.23黑盒](docs/verification/phase3-t17.md)；原始实现RED过程仍按上列未追溯项保留。

### B 双框架独立支持矩阵

**文件:** `tests/acceptance/t17-matrix/{vitest.config,matrix.spec}.ts`、`tests/fixtures/t17-matrix/scenarios.json`、独立宿主和记录。

- [x] 已冻结设计表中 Vue 10 + React 10 个正向场景，每例预声明包管理器、standalone/workspace、冻结包身份、真实数据/事件、入口 import、断言和独立基线；故障修复例预声明初始失败与最终通过。定义/评分的单元测试不代替下一项产品实跑。
- [x] 13项强制拒绝均符合各自预期，覆盖peer冲突、脏工程/写入间编辑、无候选、业务缺口、类型过点击失败、画面过版本错、视觉三态、两轮耗尽、路径链接、敏感输出及错宿主/静态替身。N13由独立验收支架检测来源，未调用产品verify。拒绝例不计正向分母，原件与限制见 [本轮矩阵](docs/verification/phase3-t17.md)。
- [x] 已使用真实本地API/Registry和唯一冻结包在仓外运行；20个正向的24个生成模块、入口import、实际构建、loopback URL、已加载JS及source-map正文已独立核对。N13原map正文清理后的复读限制单列。
- [x] 完整真实产品入口 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-matrix/product.vitest.config.ts')` 自然exit0、3481.91s，外层1file/1test；固定场景正向20/20、Vue/React各10/10、拒绝13/13。控制方正式评分和59根/23162文件/493327325字节原件副本复读通过；未筛选、补跑替分或重包。

### D 冻结 CLI 与 MCP 进程验收

**文件:** `tests/acceptance/t17-blackbox/{vitest.config,installed.spec}.ts`、独立支持设施和记录。使用实际 `node <installed>/dist/bin.js` 和 SDK client。

- [x] 当前独立Vue/React临时宿主已完成CLI inspect→plan→apply→verify及失败→repair→重验；实际安装、入口import、单JSON、退出0/2/1、artifact摘要和项目写集经原件复读，预期来自契约与固定输入，见 [宿主](docs/verification/phase3-t17.md) 与 [黑盒](docs/verification/phase3-t17.md)。
- [x] 当前完整黑盒含假apply/安装身份、授权缺失、敏感sentinel、用户后增文件、MCP自报批准/额外工具、关闭/取消后的stdout与进程负例；原记录及补充探针边界见 [本轮黑盒](docs/verification/phase3-t17.md)。
- [x] 同一 CLI 0.0.23 已完成四工具与 CLI 规范化对等。完整四链与取消入口 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-blackbox/live-vitest.config.ts')` 为 5/5，原 `vitest.config.ts` 安装与拒绝入口另为 5/5，均自然 exit 0、无 skip。提交 `90ce47d7` 为真实进程入口的历史实现；当前冻结摘要、17份receipt、四条canonical链与410份正式/补充原件副本复读见 [0.0.23 独立黑盒](docs/verification/phase3-t17.md)。

### C1 集成、文档与冻结

- [x] 已收取本轮实际客户端原交付并由Codex接续集成，原作者身份与额度边界保持；当前契约、产品及验收断言经过 [重点代码审查](docs/verification/phase3-t17.md) 与 [异步修复独立批准](docs/verification/phase3-t17.md)，未解决Critical/Important为0。assessment/总计划已记录用户本轮范围，原架构与历史证据不变。
- [x] README和 [调用说明](docs/phases/phase3/local-project-verification.md) 已记录授权调用、受信loopback、外部备份、退出码、修复证据和stdio权限。passed仅覆盖显式检查，独立验收另核对入口与资源来源。
- [x] 兼容修复已按仓规独立递增PATCH并更新`CHANGELOG.md`；当前CLI为0.0.23，版本提交`edb985ec`，此前候选及R08失败保持原样。
- [x] 构建后当前CLI候选仅pack一次至仓外目录。版本、绝对路径、SHA-256、454155字节与来源HEAD均保存于 [0.0.23冻结回归](docs/verification/phase3-t17.md)。实际安装、矩阵、截图、报告共用该文件。产品若再变必须另立冻结并全量复验，旧证据及既有SDK保留。

### C2 最终验收与临时工程清理

- [x] 当前0.0.23已用包装器完成`verify:workspace`、强制全图build/typecheck 20/20（0 cached）、根tsc、完整根Vitest 2210/2210与T10 168/168（零跳过）、真实`test:platform` 137/137；确认本轮平台已释放端口后的完整`test:browser`为288/288。全部自然exit0，控制方17份原日志/结果复读见 [0.0.23回归](docs/verification/phase3-t17.md)。旧版首次tsc类型失败、旧矩阵R08失败和本轮审计helper首次语法失败均保留各自边界。
- [x] 当前0.0.23冻结CLI与既有冻结SDK已完成`tests/acceptance/phase3-plan.config.ts` 25/25和`tests/acceptance/t16-installed.config.ts` 14/14（含Next），均自然exit0。两组提供有效`A10_FROZEN_BUNDLE`、`PHASE3_CLI_TARBALL`、`INSTALLED_CLI_EVIDENCE`；T10提供`ZHINEXUS_SDK_BUNDLE_DIR`。实际结果见 [本轮黑盒与既有接入回归](docs/verification/phase3-t17.md)。历史CLI诊断独立记录，不抵充当前完整结果。
- [x] 同一冻结CLI的B/D、双框架独立宿主已完整运行；实际安装、T15/T16、原生命令、交互、视觉及一次真实修复四链最终各6/6、visual PASS。全部为temporary/synthetic、productionAcceptance=false；历史业务试点不被替代。
- [x] C正式评分和只读专项已核20个正向的生成模块/真实构建/资源来源，以及N13独立错宿主检测；N13不调用产品verify，已删除map正文只能凭原inventory及运行期extraction复核的限制明确保留。工具链、完整计数、摘要、修复预算及未覆盖项均在分项原件和 [当前汇总](docs/verification/phase3-t17.md)。
- [x] 本轮入口均自然退出，外部保存所需证据后按原owner清理。宿主3个parent、黑盒12个新根、矩阵59个parent已独立复查不存在；完整字节归档范围各自说明。历史被政策拒绝目录不重试，平台凭证配置等缺创建时身份的目录保留，未扩大清理共享目录；不称全局临时目录清空。
- [x] 原架构摘要保持基线，最终交付记录 [独立审查Approved](docs/verification/phase3-t17.md)，Critical/Important/Minor均0。[当前完成记录](docs/verification/phase3-t17.md)保存实际命令索引、结果、限制和聚焦提交，并链接 [追加集成记录](docs/verification/phase3-t17.md)。本轮工具技术状态完成；未追溯的历史过程及业务/生产必检继续单列开放。

复选框按当前可复查证据更新，未勾项继续独立收取。当前 C0 精确依赖、实际导出/类型、stdio/strict 输入及官方来源后补见 [本地补证](docs/verification/phase3-t17.md) 与 [官方后补](docs/verification/phase3-t17.md)。原 P0 独立日志、初始 RED 顺序与原始 stderr 空字节尚未追溯；当前完整测试通过不追认该历史执行过程。
