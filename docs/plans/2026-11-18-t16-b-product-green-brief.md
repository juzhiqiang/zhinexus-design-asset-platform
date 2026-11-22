# T16 B / P1 产品 GREEN 交接

日期：2026-11-18。用户在产品 RED 收口后明确选择“继续完成产品 GREEN 和验收，通过后合并”。本 brief 开启新阶段，不改写 RED 历史。

## 身份、基线与授权

- B 仍为实际 Claude 桌面端，使用 executing-plans；C 为 Codex，负责公共契约、Windows 验证、集成与本地合并。
- 唯一实施 worktree：`C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`。当前 HEAD `b951f43dd65fef9bd97a564455e608ce6857db42`；P0 `2594f2776fb4b2de4a684fc3e50317ccc1d758dd`，恢复同步 `41a88e764059fea267f91451b4923290676f7d7f`。
- C 已实测三个产品测试完整收集：62 collected / 0 passed / 62 failed / 0 pending，缺 applyIntegration 的结果断言失败；契约85/85、CLI build及根typecheck通过。证据见 [最终 RED 记录](docs/verification/phase3-t16.md)。
- 允许 B 在下列产品范围实现 GREEN；B 不提交、不 merge/push、不 pack、不升级版本。C 在全部验收通过后提交及合 main，无 push/tag/生产发布授权。

## 必须先读

`AGENTS.md`、相关 `rules/`、[T16 设计](docs/specs/2026-11-18-phase3-t16-design.md)、[实施计划](docs/plans/2026-11-18-phase3-t16-safe-apply.md)、[安装隔离 brief](docs/plans/2026-11-18-t16-b-install-isolation-brief.md) 的固定接口与安装/恢复要求、最终 RED 记录、现有三个 project 测试及 t16-support、T15 plan/inspect、SDK公开API和现有 CLI 命令边界。

旧 brief 的“仅测试/禁止 GREEN”只描述已完成的 RED 阶段；本阶段产品授权以本 brief 为准，其安装与安全契约继续有效。既有批准设计足够，无需重新等待设计确认。

## 文件所有权

B：`packages/component-cli/src/integration/{apply,install,generate-vue,generate-react,patch,backup}.ts`（允许同职责的内部拆分）、`src/commands/integrate.ts`、CLI `src/index.ts`、help/dispatch/exports 与必要产品命令测试。遵守包 exports 边界。

C 独占：contracts及CLI契约镜像、公共fixtures、根配置/锁、package.json/CHANGELOG、README/计划/验证记录，以及最终 RED 收口的三个 `project-*.test.ts` 和 `tests/integration/t16-support/*`。B 只读这些测试；若测试接点与合理产品不匹配，报告实际写入/读取 API 与布局，由 C 接入，禁止放宽断言、恢复伪 overlay/latest、skip/todo 或逆改测试换 GREEN。SDK、平台与原架构只读。

## 产品完成条件

1. 从CLI根导出固定 `applyIntegration(root,plan,options)` / `rollbackIntegration(root,{id,sha256},{backupRoot})`，options依安装brief，不添加公开runner。显式授权、独立replan、权威字段与base hashes复核；checkedAt变动不造成误拒绝。plan.commands永不执行。
2. Vue/React按真实SDK API生成安全字符串prop/callback。绑定文本是数据；拒绝未知必要绑定。源码/清单/锁用原字节备份和逐文件hash守卫提交，首/次提交失败按已发生动作恢复，不覆盖用户新编辑。
3. 外部同卷staging、固定工具绝对路径与版本、shell:false、argv/env/config/manifest白名单，两token独立。候选锁生成后冻结；源码备份落盘后写目标；物化启动前原子持久化installStarted=true与新摘要/latest，失败零启动。
4. immutable备份版本与最新引用；拒绝过时引用、错误root/plan/id/摘要/原字节、links/hardlinks和并发变化。无可信备份固定脱敏BACKUP_INVALID抛错。恢复四组覆盖精确；安装开始后一直reinstall-required，不能假称node_modules回退。
5. 真实锁与安装身份验证、目录枚举/摘要守卫、ready/quarantine受控同卷rename。workspace多个node_modules仅支持已检查范围；失败保存日志/未知树/用户编辑，不运行目标build/typecheck。
6. CLI严格单JSON stdout；参数/损坏输入exit1，有效成功exit0，blocked/recovery-required exit2。原始错误、URL查询、token不进入输出。

先交付产品存储/生成器接点，由 C 补最终 RED 记录五组待办：空字节及独立备份字段破坏、journal/latest真实故障及并发hash、按真实fs API适配一次性故障、LineChart专属prop/event与不同source/handler值、真实npm/pnpm传递依赖与多目录交付。已有62条不是完整验收。

## 验证与停写交接

Windows宿主C用固定 `scripts/pnpm.ps1` 实测CLI build、三产品测试、T15回归及typecheck；B可在自己的执行环境进行可用窄测，但环境失败不得宣称产品通过。分阶段报告产品布局/接点及当前失败；完成产品后停写，给出实际文件、命令/结果和未覆盖边界。

C随后冻结新CLI一次，复用冻结SDK；A实际Antigravity给独立案例与API预期，D实际Claude Code黑盒验证，C完成仓外Vue/React × npm/pnpm × standalone/workspace与真实服务、全图/根测试/浏览器验收和独立全分支review，再本地合main及复验。没有真实业务项目，只标技术交付；完整T16/T17保持未完成。
