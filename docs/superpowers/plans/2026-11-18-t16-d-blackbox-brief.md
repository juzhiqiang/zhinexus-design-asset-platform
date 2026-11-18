# T16 D / P3 独立 CLI 黑盒验收交接

日期：2026-11-18。D 必须为实际 Claude Code，C 为 Codex。用户已授权产品 GREEN、技术验收通过后本地合 main；不 push/tag/生产发布。

唯一工作树：C:/Users/10208/.codex/worktrees/t16-blackbox-cases/zhinexus-design-asset-platform，基线 b951f43dd65fef9bd97a564455e608ce6857db42。仅写 tests/acceptance/t16-d/** 与新增 docs/verification/t16-d-blackbox-2026-11-18.md。不改 main、B、SDK、contracts、根配置/锁、产品、既有测试、原架构。不提交/pack/升版。使用 executing-plans，设计已批准。

先读 AGENTS.md、rules/architecture.md、rules/platform.md、rules/testing-release.md、rules/security.md、rules/code-review.md、docs/superpowers/specs/2026-11-18-phase3-t16-design.md、docs/superpowers/plans/2026-11-18-phase3-t16-safe-apply.md、安装隔离 brief、packages/contracts 公共定义和既有公开 CLI README/help 约定。不可读 B 的 integration/{apply,backup,install,patch,generate-*}.ts 计算 expected。

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
