# T16 受控应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans in each assigned client. Preserve the actual-client ownership; Codex review subagents do not replace Antigravity, Claude desktop or Claude Code. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接续 T15，交付受控安装、Vue/React 代码生成、备份及保留用户编辑的恢复；没有真实项目时保持完整 T16 未验收。

**Architecture:** C 先冻结四个新增协议与 fixture；B 在现有 CLI 实现 apply/install/generate/rollback；A 提供独立预期，D 做黑盒恢复验收，C 集成真实冻结 CLI/SDK 与服务。已有 inspect/plan 零写入和 schemaVersion 保持兼容。

**Tech Stack:** 固定 Windows x64 / Node 26.13.0 / pnpm 12.18.0 / TypeScript 7.0.2 / 既有 Vitest、本地 Playwright 与三存储；npm lock v3 / pnpm lock v9。

2026-11-18 独立续接检查点：B11 五条回归5/5，完整产品120 collected/111 passed/9 failed/0 pending，exit1；B12八条依赖输入与候选锁RED已交实际桌面，旧树quarantine和未补边界仍开放。D apply/recovery首轮无源码失败，第二轮完整源码有错误尚未接收；C纠正公开API路径和无安装备份候选brief后退实际Claude Code第三轮。完整GREEN、全图/浏览器、升版与冻结消费者通过后才本地合main，保留全部worktrees和原始证据，不push。见两份2026-11-18独立验证记录，前文历史不改。

**Spec:** [T16 设计](../specs/2026-11-18-phase3-t16-design.md)，上位 T16 条目与 T15 交接保持原验收边界。

## Global Constraints

- 用户没有真实试点项目；只在仓外 synthetic 工程安装/构建，完整 T16 与真实业务试点保持未完成。
- 原架构 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`；冻结 SDK 不重新 pack。
- inspect/plan 的 executionAuthorized 恒 false；授权仅来自显式 apply 调用，结构校验不证明人类授权、远端资格或原字节摘要。
- 项目脚本不随安装执行；业务表达式不直接拼进源码；用户后续编辑不得被回退覆盖。
- C 独占 contracts、公共 fixtures、根配置/锁与版本；其他客户端独立文件范围，最多四项并行。
- 完成且验证通过的本地提交可合 main、删工作分支；不 push、不 tag、不生产发布。

## Review Focus

### 2026-11-18 实际客户端文本交付补充

B 的实际 Claude 桌面和 D 的实际 Claude Code 保持各自作者职责。因渠道的文件工具参数/解析持续失败，允许实际客户端直接返回原始 unified diff 或完整文件文本；C 保留原始交付与摘要，核对唯一文件范围、当前上下文和停写状态后机械应用。应用失败或内容需修正时交回原作者，不由 C 改写产品或独立黑盒测试，也不放宽既有断言。D 本次以 `--tools ""` 禁用内置工具，原文上下文由 C 提供；按用户后续授权仅本次覆盖 GLM-5.3，不改全局配置，不伪造本次测试执行。最终成功仍须真实 CLI 进程、冻结 tarball 与消费者验收。

Ruling：文本是实际客户端的可追溯代码产物，可替代故障文件工具的落盘步骤；不能替代作者或验收。判断错误的成本是退回交付、重新执行验证，未经验证不得合 main。保留全部 worktree 和原始证据至可靠归档，当前不清理。

1. 备份跨项目或错误 plan 绑定：拒绝恢复到其他 root；P0 结构与 P1/P3 真实 root 检查。
2. Windows 路径、大小写、链接/硬链接及并发替换：失败关闭，用户新编辑保留；P1/P3。
3. npm/pnpm 配置 hooks、环境和安装脚本：禁止任意命令和凭据泄漏；P1/P3。
4. 部分写入/安装失败后 node_modules 不等于回退成功：状态保留 reinstall-required；P0/P1/P3。
5. 任意绑定/布局文本与原型键：按字符串键传入，不当源码执行；P1/P2/P3。

## 文件与依赖

C P0：新增 `packages/contracts/src/integration-apply.ts`、四份 Schema、`tests/contracts/integration-apply.test.ts`、`tests/fixtures/integration-apply.ts`；修改契约导出/注册、CLI 内联脚本及对应镜像。B：`integration/{apply,install,generate-vue,generate-react,patch,backup}.ts`、`commands/integrate.ts`、CLI help/exports、P1 测试。A：独立生成案例及 SDK 预期。D：独立 CLI 黑盒、用户文档。C：真实集成、README/计划/验证记录和版本。

### Task 1: C / P0 写入与恢复契约

**Files:** 上述 C P0 文件及 `packages/contracts/README.md`。不实现 CLI 写入命令。

**Interfaces:** 四个类型 `IntegrationApplyAuthorizationV1`、`IntegrationApplyResultV1`、`IntegrationBackupV1`、`IntegrationRollbackResultV1`；四个同名 `validate...` 函数返回既有 ValidationResult，关联参数以 `IntegrationApplyContext` 或 backup 类型为准。备份同时记录 installPlanned 与持久化 installStarted，恢复以 restored/unchanged/preserved/unresolved 四组覆盖全部备份候选，避免把未写入文件冒称已恢复或把 I/O 失败冒称用户编辑。首写失败可携有效 backupRef 和空写入证据返回 rolled-back。纯 JSON 校验不得导入 node:crypto/fs/path。

- [x] 先写 RED：用 namespace 查找导出，缺能力应为行为断言失败。覆盖四种合法对象、存在/不存在/空原文件、缺守卫、别名重复/父子路径、错状态、未知 issue、错误授权/摘要/路径集合、计划安装与实际启动区分、备份候选的 restored/unchanged/preserved 覆盖不一致。无函数缺失的 import/collect 失败。
- [x] 运行 `exec vitest run tests/contracts/integration-apply.test.ts`，预期收集全部用例且因缺少 validator 失败，保存日志。
- [x] 实现 Schema 与动态约束，复用相对路径 schema，不改变 T15；添加公共 fixture 与 CLI 同步列表/导出，重新生成 Schema，运行相同测试 GREEN。
- [x] 运行 `--filter @company/contracts schemas:generate`、`--filter @company/component-cli build`、`verify:workspace`、根 tsc、`exec vitest run tests/contracts`；新增数据必须可通过真实 Schema 和 CLI 字节同步检查。
- [x] 触碰公共契约运行 `exec turbo run build typecheck --force`、根 test（设置既有冻结 T10 输入），记录实际证据；独立审查后提交中文聚焦 commit。P0 无新增 CLI 产品入口，不升产品版本。

### Task 2: B / P1 产品实现

**Interfaces:** `applyIntegration(root,plan,options)`、`rollbackIntegration(root,backupRef,options)`，输出 P0 类型；真实 replan 与路径核验独立实现，不能只信任离线 Schema。具体 options、固定安装 argv、配置与凭据隔离、依赖目录受控交付及首批 RED 范围见 [B 安装隔离 brief](2026-11-18-t16-b-install-isolation-brief.md)。先编写产品测试，C 在 Windows 确认 RED 后再开 GREEN。

- [x] P0 完整 hash 交接后，B 实际 Claude 桌面端先写失败行为测试并由 Windows 宿主确认 RED。最终提交 `b951f43d`，62 collected / 62 failed，无收集或fixture错误，见独立 RED 记录。
- [ ] 实现生成器、暂存安装、原字节备份、写前/写后 hash 守卫、用户后续编辑保护及 CLI 显式调用；T15 行为保持。
- [ ] 真实 Vue/React 样例类型/构建、npm/pnpm/workspace、故障恢复及网络资格复验全部通过后停写交 C。

2026-11-18 后续授权：用户明确选择继续产品 GREEN 与验收，通过后本地合 main；新阶段遵循 [B 产品 GREEN brief](2026-11-18-t16-b-product-green-brief.md)，RED 历史中的禁止实现仅属于此前测试阶段。

### Task 3: A / P2 与 D / P3 独立验收

- [x] A 实际 Antigravity 交付安全字符串绑定、SFC/TSX、14 实现 API 差异和独立案例期望；不改 B 或 contracts。独立预期收口于 `0504d599`，三轮 18/18、窄 TS7 exit 0；此项不替代冻结消费者的真实类型/构建验收。
- [ ] D 实际 Claude Code 以构建 CLI 独立进程验证授权、未知字段、hash 改变、失败恢复、用户后续编辑保护和副作用范围；不从产品计算 expected。

### Task 4: C / P4 集成与本地收口

- [ ] 合并冻结 A/B/D，独立全分支审查；阻断项按 RED→GREEN 修复。
- [ ] 精确版本升 CLI、单独 CHANGELOG 提交；pack 一次后冻结，仓外安装同一 CLI 与 SDK 运行真实服务和本地双框架项目验收。
- [ ] 强制全图、根测试、受影响平台/浏览器验收和 main 复验；记录范围与限制，合 main 后安全清理分支/工作树。
- [ ] 无真实授权项目 diff 时只标记技术交付；T16 总任务与 T17 不勾选完成。

2026-11-18 C 补充验收：产品当前 84 collected / 73 passed / 11 failed；真实 npm 安装 exit 0 仍被交付阶段拒绝，不能标为成功。C 已增加恢复、固定 Node/pnpm 与 npm metadata 断言并交 B 补修，见 [安装交付记录](../../verification/t16-npm-installed-delivery-2026-11-18.md)。验收令牌期限问题已按独立 RED→GREEN 修复，见 [令牌与检查点记录](../../verification/t16-acceptance-token-2026-11-18.md)。B 等待当前目录权限窗口，D 默认模型仍因工具调用解析失败未交付；产品 GREEN、真实矩阵、D 黑盒与本地合并保持未完成。本轮保留 worktree 与原始证据，不清理、不 push。

2026-11-18 后续文本接收检查点：B 首份原始补丁机械应用后 CLI build 通过，产品窄测 84 collected / 83 passed / 1 failed，React 公共 API 类型/ref 案例仍失败。Vue/npm standalone 真实安装、构建和迁移通过，四个 hostile 配置拒绝通过；Vue/npm workspace 与 pnpm 两矩阵失败，C 定位为作用域成员链接及已知 pnpm 元数据在交付层被拒绝，三个诊断目标快照未变。B 第二份回复截断，未应用，已退实际 B 修正。用户已授权 D 本次 GLM-5.3；真实文件工具任务因必要参数缺失耗尽轮数，没有测试，现为无工具分阶段文本交付，保持实际作者并不改全局配置。详细原始摘要、命令和未覆盖边界见 [实际客户端文本交付记录](../../verification/t16-client-text-delivery-2026-11-18.md)。产品、完整安装矩阵、D 黑盒、冻结产物和本地 main 合并门槛均未完成，保留全部 worktree 与原始证据。

2026-11-18 第四份 B React 文本补丁：作者更正首 hunk并授权拼回原其余八段，C机械校验应用；CLI build/typecheck exit 0、probe 73 文件复核通过，产品三份窄测 84/84、零失败（`product-b-glm-patch-04.json`）。安装三处 delivery 拒绝已退 B 第五轮修正；D 文本第一阶段仍无交付。产品窄测 GREEN 不替代仓外真实编译、完整安装矩阵、独立黑盒及冻结 CLI 验收，Task 3/4 尚未完成。

2026-11-18 第五份 B 安装文本补丁：scope workspace junction 按精确成员资格重建，已知 pnpm 根元数据经普通/非硬链接检查后省略，未知条目仍失败关闭。原文 SHA-256 `c28eaa7883d61fc632d87a775396c8c72b12f599e6e48d17891f2d32cb7454d9`，C 机械应用后 build/typecheck、probe 73 文件、产品窄测 84/84 和 diff 检查通过。完整八组真实安装/迁移与四组 hostile 配置矩阵正在执行，D 大上下文无 stdout 已结束并保存 receipt，小上下文 GLM-5.3 重试仍等待；产品只读审查已确认接收。详细证据与未覆盖边界追加在上述实际客户端记录，最终冻结 CLI、全量验收与本地主分支合并保持待通过，不清理 worktrees。

2026-11-18 独立审查修复补充：第五轮开发 CLI 真实矩阵最终 12/12、exit 0，仍需最终冻结产物复验。B05 独立审查发现 13 项 Important；C 新增 RED 后 B06/B07/B08 完整产品结果依次为 97/91/6、115/93/22、117/97/20（collected/passed/failed，均零 pending、exit 1）。B08 四条安装配置清理与包名 RED 转 GREEN，固定 build/typecheck 和 probe 通过。D 首份完整修正版黑盒真实执行 1/1、exit 0，只证明缺 plan 边界。B09 四条写入/恢复修复及 D 三条输入拒绝任务运行中；[产品审查记录](../../verification/t16-product-review-2026-11-18.md)逐项保留已覆盖和未覆盖范围。Task 3/4、最终冻结 CLI、全量验收和 main 合并仍未完成；保留全部 worktrees、原始证据及架构原字节。

2026-11-18 B10/D02 新补充：B09 完整 120/100/20，B10 为 120/106/14（均零 pending、exit 1），固定 CLI build/typecheck/probe73通过。C 首写并发测试按真实契约纠正后 RED→B10 GREEN，零产品提交返回 rolled-back；backup五类真实链接拒绝转 GREEN。D 参数拒绝两文件实际开发 CLI 黑盒4/4、exit0，先前误用 dist/cli.js 的失败保留并以 dist/bin.js 重跑更正。B11 已交实际 Claude 桌面修前5条RED；D六条授权apply/恢复任务仍等完整原文。独立 journal、Next/RSC、cleanup宽故障、依赖校验与既有依赖树交付、冻结矩阵、全量回归和本地合main仍待通过，Task3/4及完整T16/T17不勾完成。详细原文摘要与命令追加于[实际客户端交付记录](../../verification/t16-client-text-delivery-2026-11-18.md)，保留工作树和证据，不push。


2026-11-18 新实跑检查点：B12接收后固定build/typecheck/probe73通过、依赖/锁窄测8/8；加C4四条实质RED后，完整产品 **124 collected/119 passed/5 failed/0 pending，exit1**。B13原文已Copy，但机械接收与静态审查阻断，未应用；B14已实际发送原5条返修。D04输出上限失败无源码，D05仅提高子进程上限重试中。详见 [本轮产品审查](../../verification/t16-product-review-2026-11-18.md) 与 [实际文本接收](../../verification/t16-client-text-delivery-2026-11-18.md)。Next消费者及更宽故障边界、D完整黑盒、全图与冻结验收仍未通过，保持技术交付与main合并未完成、保留证据和worktrees。

2026-11-18 后续检查点：B14因缺少合法删除 hunk 机械拒收，产品仍为B12；B15已在实际桌面续写。C两条日志持久化测试为2 failed/43 skipped，失败于注入必须命中断言，当前尚未命中真实日志I/O路径。Next第三轮普通Server Page控制build通过，实际安装generated消费在预渲染报useRef不存在，1 failed/12 skipped、exit1，已作为客户端边界RED交独立只读审查；前两轮fixture失败明确保留。D05完整文本静态拒收未执行，D06基于公共契约重建单个无安装控制运行中。C新增fixture根tsc exit0；完整新产品总数需接收后实跑确认。详细证据追加于[实际客户端记录](../../verification/t16-client-text-delivery-2026-11-18.md)，产品GREEN、完整黑盒、冻结与main合并门槛保持未完成。
2026-11-18 C 完整补测检查点：未接收 B15 的 B12 产品实跑三个 project 文件，126 collected / 119 passed / 7 failed / 0 pending，exit 1（`product-b12-c6-full-01`）。七条安装交付/日志/清理 RED 与 Next Server Page 产品 RED 仍开放；B15 接收前必须确认实际桌面完整交付与停写，B16 未发送。D06 原进程等待，不重复启动。全 GREEN、独立审查及最终冻结验收通过后才合 main；完整 T16/T17 保持未完成。

2026-11-19 独立备份祖先路径补测：两个真实 Windows junction RED 已确认；完整 B12 产品实跑 **128 collected / 119 passed / 9 failed / 0 pending，exit 1**（`product-b12-c7-full-01`），保留前七条失败。普通 backupRoot 本体与有效摘要不能授权穿链接祖先恢复，创建缺失备份根也不得先穿 junction 写外部目录。B17 backup/apply 原作者 brief 已准备，等待 B15/B16 完整停写后交接；C 不代写产品。详见 [19 日独立记录](../../verification/t16-backup-ancestor-2026-11-19.md)。全 GREEN、D 黑盒、Next、全图及冻结验收后才按既有授权本地合 main，保留全部证据与 worktree；完整 T16/T17 未验收。

2026-11-19 同次恢复检查点：B19 完整产品 **132/127/5/0**（collected/passed/failed/pending，exit 1）；固定 CLI build/typecheck/probe73通过。Next Server Page 开发 CLI 真实消费者复跑通过，仍非最终冻结证据。C 三条日志窗口源码恢复补测 **51 collected/0 passed/3 failed/48 unselected，exit 1**，根 fixtures tsc exit 0。B20 正由实际桌面原作者修热恢复及精确 stage helper，D11 正由实际 Code 原作者采用完整候选并补断言；尚未接收或声称全 GREEN。裁定、命令及未覆盖边界见 [同次恢复记录](../../verification/t16-hot-recovery-2026-11-19.md)，Task 3/4 与 main 合并仍待完整验收。

2026-11-19 B20 接收检查点：实际桌面原文六个 hunk 唯一有序匹配后机械接收，三条恢复 RED 转 GREEN；完整产品 **134/134/0/0，exit 0**，CLI build/typecheck、probe73、根 fixtures tsc、workspace 和强制全图 **20/20、0 cached** 通过。D11 上下文改写导致机械拒绝，未落盘执行，已交实际 D12 原作者重修。独立审查、根回归、完整 D 黑盒与最终冻结消费者仍待通过，Task 3/4 和 main 合并保持未完成；详见上述同次恢复记录。保留全部工作树与原始证据。

2026-11-19 C21 补充：独立审查三个 Important 已由四条真实文件系统 C21 用例确认 RED，最终 `c21-review-red-02` 为 **109/0/4/105，exit 1**（collected/passed/failed/unselected）。实际 B21 已交桌面原作者修 apply/backup/install。根普通 Vitest **1744 passed / 3 failed / 2 skipped，exit 1**，三失败对应新增源码与备份用例；stage 新用例未计入本次根执行，修后须完整复跑。D12 十分钟 thinking 超时无完整交付，保留原文及 receipt，实际同模型续写请求缩小。Task 3/4、最终冻结验收及 main 合并继续待通过，不 push、不清理、不勾完整 T16/T17。详见 [同次恢复记录](../../verification/t16-hot-recovery-2026-11-19.md) 和 [B21 brief](2026-11-19-t16-b21-review-brief.md)。
