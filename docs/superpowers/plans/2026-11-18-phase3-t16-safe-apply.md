# T16 受控应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans in each assigned client. Preserve the actual-client ownership; Codex review subagents do not replace Antigravity, Claude desktop or Claude Code. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接续 T15，交付受控安装、Vue/React 代码生成、备份及保留用户编辑的恢复；没有真实项目时保持完整 T16 未验收。

**Architecture:** C 先冻结四个新增协议与 fixture；B 在现有 CLI 实现 apply/install/generate/rollback；A 提供独立预期，D 做黑盒恢复验收，C 集成真实冻结 CLI/SDK 与服务。已有 inspect/plan 零写入和 schemaVersion 保持兼容。

**Tech Stack:** 固定 Windows x64 / Node 26.13.0 / pnpm 12.18.0 / TypeScript 7.0.2 / 既有 Vitest、本地 Playwright 与三存储；npm lock v3 / pnpm lock v9。

**Spec:** [T16 设计](../specs/2026-11-18-phase3-t16-design.md)，上位 T16 条目与 T15 交接保持原验收边界。

## Global Constraints

- 用户没有真实试点项目；只在仓外 synthetic 工程安装/构建，完整 T16 与真实业务试点保持未完成。
- 原架构 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`；冻结 SDK 不重新 pack。
- inspect/plan 的 executionAuthorized 恒 false；授权仅来自显式 apply 调用，结构校验不证明人类授权、远端资格或原字节摘要。
- 项目脚本不随安装执行；业务表达式不直接拼进源码；用户后续编辑不得被回退覆盖。
- C 独占 contracts、公共 fixtures、根配置/锁与版本；其他客户端独立文件范围，最多四项并行。
- 完成且验证通过的本地提交可合 main、删工作分支；不 push、不 tag、不生产发布。

## Review Focus

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
