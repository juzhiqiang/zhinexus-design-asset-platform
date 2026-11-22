# T16 D / P3 独立 CLI 黑盒验收交接

2026-11-19 当前冻结交接：CLI `0.0.14` tarball SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`；B26 产品 141/141，D 既有三文件在仓外实际安装入口 5/5。D27 超时无源码，D28 静态错误未接收；D29 独立辅助文件、后续主测试和字段控制由实际 Claude Code GLM-5.3 原作者继续交付。当前不合 main，历史 brief 状态保留。C 提供真实 API/registry、同一冻结 SDK、固定 Node/npm 和已安装 CLI 入口；所有 D 断言仍由实际 D 编写。

纠错：`changedFiles` 是 `string[]`，`beforeHashes` / `afterHashes` 是 `{path,exists,sha256?}[]`，`installedVersions` 是 `{name,version}[]`；备份 `originalBase64` 在 files 项上，与 `before` 同级。URL 环境不能使用文件绝对路径判断；Windows 协议 root 使用规范化正斜杠，与实际路径独立归一后比较。基线 npm 不继承进程凭据或用户 npm 环境，两个空 config 必须为普通文件。源码快照只排除根 `node_modules`，备份快照不排除条目；两者 lstat 拒绝链接/硬链接。生命周期毒脚本必须实际写到传入的本轮绝对 marker。禁止占位断言或把数组索引当路径。

冷无效备份公开 CLI：exit 1、单 JSON `status:error,error.code:EXECUTION_FAILED` 和固定脱敏信息，无写入；不是 exit 2 的有效 recovery-required 报告。原字节/root/id 字段篡改须重新建立对应 SHA 命名版本文件并同步最新 journal，然后以新引用调用冷 rollback；故意篡改后的 snapshot 才是失败零写入对照。陈旧 ref 使用真实新旧合法版本/journal证明，不能以缺文件或引用失配冒充字段校验。无法稳定注入竞态时明确未覆盖交 C。

日期：2026-11-18。D 必须为实际 Claude Code，C 为 Codex。用户已授权产品 GREEN、技术验收通过后本地合 main；不 push/tag/生产发布。

唯一工作树：C:/Users/10208/.codex/worktrees/t16-blackbox-cases/zhinexus-design-asset-platform，基线 b951f43dd65fef9bd97a564455e608ce6857db42。仅写 tests/acceptance/t16-d/** 与新增 docs/verification/t16-d-blackbox-2026-11-18.md。不改 main、B、SDK、contracts、根配置/锁、产品、既有测试、原架构。不提交/pack/升版。使用 executing-plans，设计已批准。

先读 AGENTS.md、rules/architecture.md、rules/platform.md、rules/testing-release.md、rules/security.md、rules/code-review.md、docs/specs/2026-11-18-phase3-t16-design.md、docs/plans/2026-11-18-phase3-t16-safe-apply.md、安装隔离 brief、packages/contracts 公共定义和既有公开 CLI README/help 约定。不可读 B 的 integration/{apply,backup,install,patch,generate-*}.ts 计算 expected。

阶段一：先交付独立 harness/案例和执行说明。用 node:child_process shell:false 调用真实构建/已安装 CLI 单独进程，绝不 import apply/rollback 产品函数、mock fs/child_process 或伪造产品输出。CLI 路径用 T16_D_CLI_ENTRY 环境变量；冻结最终 tarball 用 PHASE3_CLI_TARBALL，未提供时清楚报不可执行，不 skip/todo 冒称通过。允许独立 loopback synthetic API/registry，不复制 B/C 的 recorder 来模拟安装成功；需要真实安装时使用冻结 SDK 同一 tarball 与真实固定 npm/pnpm。不得重pack SDK。

案例至少包括：
- 参数/坏 JSON/未知字段拒绝（exit1），有效 blocked/recovery-required exit2，成功 exit0，stdout严格一个JSON，stderr/stdout不回显synthetic令牌/查询。
- inspect/plan零写入且executionAuthorized=false，apply显式root/plan/allow-install边界，篡改计划commands永不执行。
- 成功控制 + 原始hash改变/跨root/路径穿越或Windows alias阻断，独立逐字节树快照。
- 成功apply产生真实backupRef，再独立进程rollback；新文件删除、原文件原字节恢复、用户后续编辑保留、四组互斥完整覆盖，installStarted副作用一直reinstall-required。
- 原backup摘要失配、原字节/root/id绑定破坏、stale ref保守拒绝，不能让缺索引或未建立成功fixture冒充字段检查。
- 未授权安装无进程、副作用范围/恶意目标hook或配置不执行、两token隔离；不能读取用户真实凭据配置。
- 恢复期间竞态需要可观测实际边界，不能使用sleep赌时序或改产品加公共runner；无法可靠注入时明确未覆盖交C，不编造通过。

C/B当前产品62测试为42passed/20failed，安装选址正在修复。你此阶段写harness与独立测试，最终真实CLI执行留待C提供冻结路径后再次启动D。本机依赖初始未安装，C可安装；可用B固定 scripts/pnpm.ps1，但含-p参数必须数组splat。SDK冻结目录 D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3，manifest sha256 04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1。日志不得记录凭据。仓外synthetic只证明技术验收，完整T16/T17保持未完成。

交付后停写，报告实际文件/命令/exit/未覆盖边界；不擅自宣称产品GREEN。

## 2026-11-18 单成功控制交接纠错

C 提供的 apply/recovery 第二轮文本 brief 曾错误给出 API `/v1/integration-targets`；实际公开查询路径为 GET `/v1/matching/components`。子进程凭据使用公开 `ZHINEXUS_API_TOKEN` / `ZHINEXUS_REGISTRY_TOKEN`，不能用 harness 私有变量名代替。完整 MatchPlan 写入 match 文件，真实 plan stdout 保存到外部 plan 文件，再交 apply；plan 也必须显式传 registry。此纠错不修改产品适配测试。

无安装、只有 generated-component 的成功控制中，未变清单与锁的原字节通过完整工程快照证明。公开 IntegrationBackupV1 是 JSON，files 仅覆盖计划变更候选；不能要求未变 package.json/锁出现在备份或恢复候选中，也不能把任意 index/manifest/首文件当 backupRef 证据。递归 lstat 拒绝链接和硬链接，独立实算唯一版本文档 SHA-256 匹配真实 backupRef；核对 operation/root/plan 身份、候选 before/after 与实际字节。rollback 四组互斥完整覆盖该真实候选集。此控制未覆盖既有文件原字节恢复，须后续另立案例。

实际 D 第二轮原文完整但有 ESM 入口、端点/凭据、fixture 和证据断言错误，C 未落盘、未执行、未改写。第三轮已按上述纠错退回原作者重交完整同文件。不得据交付状态宣称黑盒成功。
