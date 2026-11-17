# T15 最终验收与本地主分支收口

日期：2026-11-17（Asia/Shanghai）。本记录追加最终候选、门禁和清理证据，不改写此前 RED/GREEN 历史。当前状态：最终审查修复的宿主 P1 已通过，最终打包、全套门禁与 main 合并待验收。

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

SDK 不重新 pack；CLI 产品修复后生成新版本候选并重新验证。

## 最终门禁

待最终产品提交后执行并追加实际命令、exit、数量、跳过数和日志：冻结安装、强制全图 build/typecheck、根 tsc、workspace 边界、根 test、真实平台 41 项、浏览器 18 项及新冻结 CLI 仓外 P4 25 项。在 main 合并后再次核对树、构建与同一已安装 CLI 专项。

## 边界与接续

技术验收使用 synthetic 项目和隔离的真实 Nest/PostgreSQL/MinIO/Verdaccio；不代表两个真实业务试点或公司生产 G2。T16 安装、代码生成与安全回退，T17 验证、有限修复与 MCP，继续保持未完成。下一轮先冻结写入/恢复契约，取得具体目标项目、路由和路径授权后再实施。

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

待验证后追加 main hash、来源祖先检查、客户端停写、工作树状态、忽略证据备份与链接检查、分支删除结果。不强制移除工作树，不递归清理共享 junction，不 push。
