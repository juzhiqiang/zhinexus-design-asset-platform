# T15 最终验收与本地主分支收口

日期：2026-11-17（Asia/Shanghai）。本记录追加最终候选、门禁和清理证据，不改写此前 RED/GREEN 历史。当前状态：**T15 技术验收与本地 main 收口完成**，最终冻结 CLI、集成树及 main 复验通过；四个工作分支和工作树均已安全删除。

## 范围与归属

交付 `component integrate inspect/plan`，只读识别 Vue 3 / React 19、npm v3 / pnpm v9 锁和显式 workspace，复查发布身份、精确依赖、摘要、权威 API、权限及兼容缺口，形成 `executionAuthorized: false` 的可审查计划。

实际客户端职责保持：B / Claude 桌面端实现产品，A / Antigravity 提供独立项目矩阵，D / Claude Code 提供独立进程黑盒验收，C / Codex 维护契约、宿主验证与集成。Codex 审查代理仅作独立审查。用户已明确授权验证后合入本地 main 并删除工作分支，未授权 push 或生产发布。

## 最终审查修复

0.0.12 的 P4 25/25、根测试 1488/1488 与 T10 168/168 只作为历史候选证据。整分支审查报告五项候选残余，全部按行为测试先失败、最小修复、完整回归执行：

| 发现 | 合格结果 | 当前证据 |
| --- | --- | --- |
| 同包不同组件重复 registry 证据 | 每个精确包一条，保留各实现发布证据 | 正式 RED → P1 GREEN |
| matched/unverified 远端 gap 文案含令牌 | 完整输出无 API/registry 凭据，保留稳定缺口 code | 正式 RED → P1 GREEN |
| 本地已锁运行时依赖与 GET 版本不符 | 合法 `DEPENDENCY_CONFLICT`，不升级、不写文件 | 正式 RED → P1 GREEN |
| Windows dangling junction | `PATH_UNSAFE`，不跟随到项目外读写 | 单跳及两跳正式 RED → P1 GREEN |
| MatchPlan 省略可选 ECharts 版本 | 查询使用可证实精确宿主值，保留所需上下文冲突，不输出非法计划 | 正式 RED → P1 GREEN |

第五项核对：ProjectContext 允许省略 ECharts，但 IntegrationPlan 附加规则要求与已锁宿主不一致时含 `MATCH_CONTEXT_MISMATCH`。源 MatchPlan 和摘要必须保持原样；安全查询采用本地值不代表可消除离线输入缺口。

宿主 C 在 B 工作树正式运行三组 P1（`project-inspect.test.ts`、`project-plan.test.ts`、`project-plan-network.test.ts`）：2026-11-17 21:21:42 开始，**147 项中 5 failed / 142 passed / 0 skipped，exit 1，38.51s**。原 142 项全通过；新增五项在合法输入/响应和真实控制之后分别命中重复证据、远端 gap 凭据泄漏、已锁 core 冲突非法计划、dangling junction 未阻断、ECharts 空 query。没有 fixture、导入、收集或屏障超时失败。根 `tsc -p tsconfig.json --noEmit` **exit 0**；12 个产品和测试源 SHA-256 前后一致。完整命令：

```powershell
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts --reporter=default --reporter=json --outputFile=.superpowers/t15/host-final-five-red-results.json
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
```

C 的 `.superpowers/t15/final-five-red/` 保存原始日志、JSON、运行前后摘要与源副本审计：11 份副本与 RED 一致，network 测试在运行结束后补入 CLI 全树断言，因此该副本不冒称原 RED bytes，差异在 `copy-audit.json` 明记。实际 Claude 桌面会话已收到最小 GREEN 交接。新②③测试补 CLI 调用后的全树对照，原断言保留；最终产品与测试仍待正式 GREEN。

第四项在修复窄复核中补真实两跳 dangling：`src → 项目内 bridge/future`，`bridge → 项目外不存在目录`。单次 readlink 后信任词法落点仍不足以证明安全。实际 B 只补回归后，宿主 C 用相同三组命令（输出文件改为 `host-two-hop-red-results.json`）于 21:40:40 运行：**148 项中 1 failed / 147 passed / 0 skipped，exit 1，36.69s**。原五项及原 142 全通过，唯一行为失败为两跳路径实际 `planned` 而未 `PATH_UNSAFE`。12 源前后 SHA 一致且逐件复制核对成功；日志、JSON、摘要和原始源保存在 `.superpowers/t15/two-hop-red/`。该补充仍属原第四项失败关闭修复，未开展第二次整分支审查或新增功能。

## 冻结输入

最终 GREEN：C 在 B 工作树于 **21:46:58** 运行完整三组 P1，**148/148 passed、0 failed、0 skipped，exit 0，37.01s**。12 个产品和测试源 SHA 前后一致；根 `tsc -p tsconfig.json --noEmit`、CLI `build` 与 `typecheck` 全部 exit 0，构建探针 73 文件白名单复核通过。日志为 B `.superpowers/t15/host-final-green*`。原 142 项及新增六项均保留；产品仅修改 `plan.ts`、`resolve.ts`，新回归仅位于 B 的两份计划测试。构建后再次核对 12 个摘要一致。这组结果关闭五项审查行为缺陷，不能替代 D35、冻结 CLI P4 或最终全图门禁。

- 原架构 SHA-256：`e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
- SDK manifest SHA-256：`04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。
- core 0.0.11：`393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb`。
- Vue 0.0.12：`51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9`。
- React 0.0.12：`bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28`。
- 已安装 CLI 兼容采纳证据 SHA-256：`c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`。

SDK 未重新 pack。CLI 修复提交 `88b13803b3024bc4c57dd7f5fa737208a1f16c29`，由 `5347683d` 合入 C；独立版本提交 `e23ef890f12282c60916d31f42d84341108d4014` 升至 **0.0.13**。于 22:01:21 执行一次 pack 后冻结：

- tarball：`company-component-cli-0.0.13.tgz`，**294872 bytes**。
- SHA-256：`d071f7c17f62db75f36b8ed8c0cb44bab0ed8ff1eccda83abbe029cc31a0a7b6`。
- 独立保存位置：`D:\project\zhinexus-design-asset-platform\.tools\operations\t15-final-2026-11-17\t15-cli-0.0.13\`，复制后逐文件核对摘要。
- 仓外真实安装目录：`C:\Users\10208\AppData\Local\Temp\zhinexus-t15-installed-DQQge4`。P4 日志实际记录 `T15_INSTALLED_CLI`、版本及同一 SHA，不使用工作区链接或私有 contracts 运行时依赖。

## 最终门禁

以下命令在 C 集成工作树通过固定 Node 26.13.0 / pnpm 12.18.0 运行，前缀均为 `.\scripts\pnpm.ps1`。完整日志及结构化结果在 `.superpowers/t15/`，清理前复制到主目录独立备份；既有 Node DEP0190 警告仍存在，本轮未改变相关 shell 调用。

| 命令（去掉共同前缀） | 实际结果 | 日志 |
| --- | --- | --- |
| `exec vitest run tests/integration/project-inspect.test.ts tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts` | **183/183，0 skipped，exit 0，63.74s**；12 源摘要与 B 冻结字节一致 | `integrated-final.log` / `integrated-final-results.json` |
| `install --frozen-lockfile` | exit 0，0.19s；锁文件未变 | `candidate-install.log` |
| `exec turbo run build typecheck --force` | **20/20 tasks，0 cached，exit 0**，14.63s | `candidate-force-graph.log` |
| `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | exit 0，0.59s | `candidate-root-tsc.log` |
| `verify:workspace` | 10 成员、无环、公开包与服务闭包检查通过，exit 0，0.81s | `candidate-workspace.log` |
| `test` | **T10 168/168、Vitest 83 文件 1494/1494，0 skipped，exit 0**；总 337.27s，Vitest 306.20s | `candidate-root-test.log` |
| `exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching.test.ts tests/platform/component-query.test.ts tests/platform/component-query-consumer.test.ts` | **41/41，0 skipped，exit 0**，61.57s（测试 57.45s） | `candidate-platform.log` / `candidate-platform-results.json` |
| `exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts tests/browser/phase2-component-query.spec.ts` | **18/18，0 skipped，exit 0**，12.30s（测试 11.5s）；启动前确认 5173–5176 无监听 | `candidate-browser.log` |
| `exec vitest run --config tests/acceptance/phase3-plan.config.ts` | **25/25，0 skipped，exit 0**，32.78s（测试 29.57s） | `candidate-p4.log` / `candidate-p4-results.json` |

P4 同时设置上述已核对的 `A10_FROZEN_BUNDLE`、`INSTALLED_CLI_EVIDENCE` 及唯一冻结 `PHASE3_CLI_TARBALL`；14 项 A 矩阵、Vue/React 真实兼容证据采纳、权限撤销/废弃、下载中撤权、损坏材料、选定包摘要不符、registry 故障和只读快照均实际执行。三个冻结 SDK、manifest、兼容证据及原始架构摘要保持前述值。P4 后 CLI SHA 再次一致，没有第二次 pack。

五项 Review Focus 对应 P1 路径/锁/网络回归、D 黑盒的 Git filter 与全树控制，以及 P4 真实服务/安装结果。没有遗留审查阻断或延期 Minor。特殊 8.3 短名、所有文件系统并发竞争与超过 64 跳链接不由本轮用例全面证明；该限制不能转换成未来 apply 授权。

main 合并后再次核对树、强制构建与同一冻结 CLI 的仓外 P4，实际通过结果见本文末尾。

## 边界与接续

技术验收使用 synthetic 项目和隔离的真实 Nest/PostgreSQL/MinIO/Verdaccio；不代表两个真实业务试点或公司生产 G2。T16 安装、代码生成与安全回退，T17 验证、有限修复与 MCP，继续保持未完成。下一轮先冻结写入/恢复契约，取得具体目标项目、路由和路径授权后再实施。

T16 开工交接：保留 A 的 14 案例与双框架差异表、D 的 35 个独立黑盒、原 `sourceMatchPlan` / 调用方 digest 与 T15 的 `executionAuthorized:false`。C 先定义 ApplyResult、备份和基于 afterHash 的恢复契约；B/Claude 桌面端承担 install/apply/patch/rollback 与 Vue SFC/React TSX 生成；A/Antigravity 核验生成期望及生命周期；D/Claude Code 独立验证失败恢复与并发修改保护。没有具体宿主、路由、路径和授权前，不运行 apply，也不将 CLI 计划命令当作安装授权。

## 执行裁定

按 ledger 原顺序完整公开本轮裁定及判断错误的代价：

1. P0–P4 计划与编号辅助脚本不兼容，采用等价 PowerShell ledger 记录，保留 brief、base 和命令证据；代价是修复记账，不影响产品。
2. P0 冻结 workspace glob 边界，实际识别放在 P1/P2；若错误，需在最终验收前协调解析器与 fixture。
3. IntegrationPlan 保留 sourceMatchPlan，独立核对 gaps 与权威 API，摘要由调用者计算；若错误，需调整 DTO，仍不能获得 T16 执行权。
4. P0 只验证结构化声明，真实路径、锁、摘要、网络复查和凭据隔离交 P1/P3/P4；若错误，必须阻断 T15，不能以 schema 冒充运行安全。
5. B 实现前的 P1/P3/P4 RED 准备不算产品完成；代价是等待产品及冻结安装证据后才能集成。
6. 保持已冻结 CLI 参数，去掉额外 timeout CLI 参数，保留库 requestTimeoutMs；若错误，需协调帮助与参数测试。
7. 执行错误采用本地 JSON envelope，不新增公共 DTO；若未来需要跨端共用，须补契约迁移。

没有登记延期的 Minor；整分支审查报告的五项 Important 均要求本轮闭环。

## 本地合并与清理

本地 `main` 从 `31ae120a270e84ab7c100d3ad77919b233d1d48b` **快进至 `49968d96a0a0f051527c3a903cf6c132aeae9fa1`**；Git 树为 `1c1581b36ae7150ef5b4e1e286e0b3f2a3b12b04`，与已验收 C 集成树逐字节一致。首次树查询的 PowerShell 未引用 `^{tree}` 被解释为脚本块，查询报错后停止；补单引号后重新查询一致，没有修改文件或重做合并。

在主工作区重新执行以下命令，全部 exit 0：

```powershell
.\scripts\pnpm.ps1 install --frozen-lockfile
.\scripts\pnpm.ps1 exec turbo run build typecheck --force
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
.\scripts\pnpm.ps1 verify:workspace
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/phase3-plan.config.ts --reporter=default --reporter=json --outputFile=.tools/operations/t15-final-2026-11-17/main-p4-results.json
```

强制全图 **20/20，0 cached，14.486s**；main P4 于 **22:17:06** 开始，**25/25，0 failed，0 skipped，exit 0，43.92s**。仍使用上文同一 SDK、兼容证据和独立备份的 CLI tarball，结束后 SHA 仍为 `d071f7c1…31a0a7b6`。完整日志、结果及 `main-merge.json` / `main-gates.json` 位于主工作区 `.tools/operations/t15-final-2026-11-17/`。

本轮关键提交与来源如下；各来源 tip 在删除前均以 `git merge-base --is-ancestor <tip> HEAD` 实际确认 exit 0：

| 提交 | 目的 |
| --- | --- |
| `31ae120a` | P0 本地项目/接入计划契约，已先行合 main |
| `7c274ad166bf8693dd6c38359b24822cd3fe65e0` | A 独立矩阵最终来源，补齐真实子包 fixture |
| `99bf0f46` / `c5ca0e49` | B 只读识别与计划产品交付 |
| `a946cdea2ff5b3a1f3d9f05f43ab696f111b1871` | D 独立黑盒最终来源，35 项断言保留 |
| `88b13803b3024bc4c57dd7f5fa737208a1f16c29` | B 最终五项审查修复及六条回归 |
| `5347683d` | C 合入 B 最终修复，集成 183/183 |
| `e23ef890f12282c60916d31f42d84341108d4014` | CLI 0.0.13 独立升版与 CHANGELOG |
| `49968d96a0a0f051527c3a903cf6c132aeae9fa1` | C 完整验收/交接文档，最终 main 快进目标 |

A/D 已停写且工作树干净；实际 Claude 桌面端明确回复 `final-five-green-ready`，12 个产品/测试摘要复核一致，B 聚焦提交后干净；C 所有改动提交后干净。未提交用户改动没有混入任何提交。

删除前将忽略证据复制到上述独立备份根并逐文件 SHA-256 核对：A **2 文件**、B **131 文件 / 2225752 bytes**、C **179 文件 / 4516559 bytes**、D **37 文件**；B 的两份临时 probe 一并保留。0.0.12 历史候选、0.0.13 最终候选及 frozen manifest 分别保留，哈希清单为 `*-hashes.json`。所有工作树各 **1054** 个 reparse point 均只指向本工作树，无 main 或其它外部目标；逐个解除链接本身后才移除目录。

A 首次 `git worktree remove` 报 `Invalid argument`，注册已解除但目录残留；随后原生 PowerShell 删除实际报 `node.exe` 被占用。核对进程链确认是 A 先前 `pnpm exec node -v` 留下的交互式 Node 与 pnpm（PID 44240 / 7088），只结束这两个任务进程，未停止 Antigravity 应用。再次确认残留目录无链接和绝对根正确后，以原生 `Remove-Item -LiteralPath ... -Recurse` 清理成功。B/C/D 在相同链接检查后通过普通 `git -c core.longpaths=true worktree remove` 成功；未用 `--force`、`branch -D`、reset 或跨 shell 递归删除。

以下四个来源分支均通过 **`git branch -d`** 删除：`chore/t15-a-project-matrix`、`feat/t15-b-integration-plan`、`chore/t15-c-integration`、`chore/t15-d-plan-acceptance`。`git worktree list --porcelain` 仅列主工作区，`git branch --list` 仅列 `main`，四个原目录均不存在。主目录 Node/pnpm 与原架构摘要在清理前后完全一致。没有 push、tag 或生产发布；T16/T17、生产 G2、真实业务试点继续保持未完成。
