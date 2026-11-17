# T15 已安装 CLI 与真实服务验收记录

日期：2026-11-17；负责人 C / Codex。状态：**RED 已确认，产品集成与 GREEN 尚未完成**。

## 基线与隔离

- P0 基线：`31ae120a270e84ab7c100d3ad77919b233d1d48b`；集成分支 `chore/t15-c-integration`。
- B / Claude 桌面端：`feat/t15-b-integration-plan`；A / Antigravity：`chore/t15-a-project-matrix`；D / Claude Code：`chore/t15-d-plan-acceptance`。各自独立 worktree、工具链目录和依赖目录。
- 专项配置 `tests/acceptance/phase3-plan.config.ts`，复用隔离 PostgreSQL / MinIO / Verdaccio 与实际 Nest HTTP 服务；默认根测试不包含本专项。
- `A10_FROZEN_BUNDLE`、`PHASE3_CLI_TARBALL` 必填；成功计划额外要求 `INSTALLED_CLI_EVIDENCE`，缺环境或文件必须失败，不跳过。

## 冻结输入

- 已接受 SDK bundle 标识：`881238b3-2214-4ec8-bf0c-af5238b7fcd3`，199 个文件、14 份报告；manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。
- core `0.0.11`，Vue/React `0.0.12`。逐文件核对原始 bytes/SHA，使用 `validateReleaseBundle` 校验关联报告，复用同一份 tarball，不重新打包 SDK。
- RED 使用真实安装的 CLI `0.0.11`，tarball SHA-256 `14775474e4b0181fd3c891f6624ed15b11b2f52582731271063138e606420adf`。
- 兼容记录经真实 API 接收既有工作区外探针证据，来源见 `sdk-label-adopt-acceptance-2026-11-16.md`。未直接插入伪造 passed；先验证未采纳时 unverified，再采纳、重新取得 MatchPlan。

## 已执行的 RED

命令：设置上述三个实际输入后运行：

```powershell
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/phase3-plan.config.ts
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
```

- 第一次准备流程使用缺少报告参数的 manifest 校验，导致准备失败；已改为完整 bundle 校验。此失败是测试设施问题，**不计行为 RED**。
- 第二次：服务准备、冻结发布 READY、真实兼容采纳均通过；6 个行为失败来自旧 CLI 未实现 `integrate plan`。一个网络测试只检查 exit 1，不能区分命令缺失与网络错误，未将它记为能力通过。
- 第三次：收紧网络测试并加入 registry 故障传输后，**9/9 失败，0 跳过，exit 1**；Vue/React 未验证与已采纳场景明确报告“命令尚未实现”；故障场景没有发出所需请求或没有 JSON 输出。日志：`.superpowers/sdd/2026-11-16-phase3-t15-kickoff/p4-installed-red3.log`。
- 根 TypeScript 检查 exit 0。

## 测试边界与待验收项

- CLI 以 `npm install --ignore-scripts` 安装到工作区外临时消费者；synthetic Vue/React 项目锁由固定 npm 实际生成。全树文件/目录和字节摘要在每次命令前后比较，输出检查 API/registry 凭证不泄漏。
- 权限撤销、废弃、API 材料元数据损坏发生在隔离测试数据库；registry 故障通过代理真实 Verdaccio 的传输层注入，不覆盖或删除已发布包。
- HTTP 故障代理保留真实元数据与 integrity，仅在损坏场景翻转下载字节，并检查实际请求和只读 token。该代理属于故障注入，不能描述成生产服务自然故障。
- 待 A/B/D 冻结提交集成后，审查测试与实现、升版、冻结新 CLI，再运行 GREEN、完整图构建/类型检查、根测试、平台和浏览器专项。
- 本记录不代表 T15 完成；合成绑定/布局不代表真实业务项目验收；T16/T17、G2 与真实业务试点仍有独立门槛。

## D35 只读目标冲突修复与集成 GREEN（2026-11-17）

- 先前集成候选的 D35 独立黑盒正式结果为 **34 passed / 1 failed / 0 skipped**。唯一失败是已存在目标组件同时属于 Git dirty path 时，`OUTPUT_EXISTS` 计划因缺少同路径 `DIRTY_TARGET` 被 IntegrationPlan 契约拒绝；原始失败和根因见上方交接文件及 B 记录。
- 实际 Claude 桌面端按交接只改 `packages/component-cli/src/integration/plan.ts`：所有最终 `allowedPaths` 与 `inspection.git.dirtyPaths` 按 NFC + 小写键相交时补同路径 `DIRTY_TARGET`，保留 `OUTPUT_EXISTS`、`allowedPaths` 与用户 bytes。正式 P1 三组在 B 工作树复跑 **142/142 passed / 0 skipped / exit 0（35.12s）**；CLI build、CLI typecheck、根 tsc 均 exit 0。修复提交 `006f0547f80476f0ca3c1c811239e93cdba249b5`，以合并提交 `d41dbae5797165f4e039ea409601a40efa85069e` 集成至 C。
- 在合并后的 C 集成树先运行 CLI build，再以固定 Node 26.13.0 / pnpm 12.18.0 执行 P1 三组与 D 独立黑盒五文件：

  ```powershell
  .\scripts\pnpm.ps1 --filter @company/component-cli build
  .\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts --reporter=default --reporter=json --outputFile=.superpowers/t15/host-p1-d35-green-2026-11-17-results.json
  .\scripts\pnpm.ps1 --filter @company/component-cli typecheck
  .\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
  ```

- 集成结果 **177/177 passed、0 skipped、exit 0（61.76s）**；5 个测试文件通过，D35 中原 `OUTPUT_EXISTS` 失败现已通过。CLI build 的 73 文件 package probe 无缺失、污染、链接或变更；CLI typecheck 和根 tsc 均 exit 0。正式 Vitest JSON：`.superpowers/t15/host-p1-d35-green-2026-11-17-results.json`。
- `plan.ts` 本轮 SHA-256：`098518193D3CEC1AF0E78850E8BF7243D363567ED0C339CFD14EA770911B3CDD`。该记录只完成候选集成验证；尚未升 CLI 版本、打包、仓外安装或运行 P4 真实 Nest/PG/MinIO/Verdaccio 专项，T15 仍未完成。

## 中断恢复后的补充 RED（2026-11-17）

- 保留此前记录，复用已有 C 隔离工作树、A 的 `c3c90e3d` 交付和完全相同的旧 CLI / SDK 冻结输入。
- 将撤权和废弃分成独立用例，避免前一个失败遮挡后一个。新增真实 Verdaccio 下载暂停屏障：必须观察到 tarball 请求后才在隔离 PostgreSQL 撤权；恢复下载后要求 CLI 返回 `TARGET_UNAVAILABLE`，结束时恢复隔离权限。
- 根 TypeScript 检查 exit 0；专项实际运行 **11/11 行为失败、0 跳过、exit 1**。服务发布与兼容采纳准备成功；旧 CLI 没有新命令，撤权屏障用例在下载前观察到命令退出，符合预期 RED。
- 完整日志：`.superpowers/sdd/2026-11-16-phase3-t15-kickoff/p4-installed-red4.log`。本次没有重新 pack SDK、没有覆盖或删除 Verdaccio 已发布版本。
- B 已从目录授权恢复：宿主执行 inspection 测试的首次结果是缺模块的 suite 收集失败（0 tests），不计行为 RED；B 补最小失败入口后，固定工具链 **20/20 用例实际执行并失败，0 跳过**。日志由 B 工作树 `.superpowers/t15/host-inspect-behavior-red-2026-11-17.log` 保留，已交还实际 Claude 桌面端继续实现。
- D 的黑盒断言由实际 Claude Code 复核后经 C 宿主校正：越界参数与被观察目录一致、用户并发编辑后完整快照一致、独立 API/registry origin、跨 origin redirect 零目标请求，以及错误响应回显令牌的脱敏反例。D 与 P4 均仍为 RED，等待 B 冻结产品后运行 GREEN。
- 按 requesting-code-review 技能由独立 Codex 审查代理只读检查 P3/P4。C 的验收准备可聚焦提交；D 的三项 Important（错误分支全树快照、inspection 完整契约、API 500 实际请求）由 C 宿主补齐，另在 D 工作树记录复跑结果。审查代理未替代实际 Claude / Antigravity 客户端，也未声称执行真实服务验收。
- A 项目矩阵复跑 5/5、`verify:workspace`、根 TypeScript、`git diff --check` 均通过。P4 后续新 CLI GREEN、完整根测试和平台/浏览器专项尚未运行；本次仅提交验收准备，不升版本、不合入 main。

## 独立项目矩阵的已安装 CLI RED 补充（2026-11-17）

A 根据批准 spec 对缺 ECharts 预期补行为 RED→GREEN，提交 `5a508567`；C 在来源工作树复跑矩阵 **6/6、0 跳过**、窄 TypeScript 和 diff 检查通过，以 `67ffc2ab` 合入 C 并再次复跑 6/6。冻结实际 pnpm/npm 锁快照原字节保持不变。

P4 追加使用实际已安装 CLI 消费 A 的全部 14 个 synthetic 案例。每项命令前后比较项目全树目录集合与文件 SHA，完整校验 inspection，核对独立预期冲突/精确依赖/脚本/Git 与已输出字段，逐项复核实际文件摘要；不足信息允许省略契约可选字段，不允许报告错误值。

设置与前次完全相同的三个冻结输入，实际运行：

```powershell
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/phase3-plan.config.ts
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
```

专项 **25/25 行为失败、0 跳过、exit 1**：新增 14 项和原 11 项均已收集并执行，旧 CLI 0.0.11 缺 `integrate inspect/plan`，服务准备、冻结发布 READY 和真实兼容采纳均成功。运行时间 29.82 秒；日志 `.superpowers/sdd/2026-11-16-phase3-t15-kickoff/p4-installed-matrix-red-2026-11-17.log`。旧 tarball SHA 再次实际读取为 `14775474e4b0181fd3c891f6624ed15b11b2f52582731271063138e606420adf`。根 TypeScript **exit 0**（测试新代码先改为兼容仓库 ES2022 lib 的复制后 sort，未更改工具链或编译配置）。

C 的早期直接模块消费观察另外发现真实 pnpm 双文档被 B 错误当成两份项目锁、A 的 missing importer 案例目标目录不存在；分别交实际 B/A 客户端补独立失败测试与修复，见 `c-t15-inspect-review-2026-11-17.md`。本次 RED 不掩盖夹具缺陷，25 项仍等待修正候选及新 CLI GREEN；不标记 T15 完成。

### 快照审查修复后的重跑（追加）

按独立审查补齐 `__proto__` 文件快照反例并修复后，复用同一旧 CLI 与 SDK 冻结输入，重跑上述完整已安装专项：**25/25 行为失败、0 跳过、exit 1**，23.46 秒；仍为旧 CLI 缺新命令的预期 RED，服务准备与真实兼容采纳成功。日志为 `p4-installed-snapshot-red-2026-11-17.log`。快照反例自身 **1 RED→1 GREEN、0 跳过**，根 TypeScript **exit 0**；该补充只完善 P4 验收准备。

## 首次冻结候选 0.0.12 的 P4 GREEN 与代理修正（追加）

CLI 兼容新增能力按当前 0.x 规则单独升至 `0.0.12`，提交 `52acc3d1b201e4b69ccd41d09ffbcb5aa87e8b40`。构建后只 pack 一次：`.tools/operations/t15-cli-0.0.12/company-component-cli-0.0.12.tgz`，292730 bytes，SHA-256 `1372ed616d49c9c7e2969e64f2318c54a8ea1341045a94dac167bd582069ecda`。其后未改 CLI 产品源码，SDK 仍复用上述冻结 bundle；已安装兼容采纳证据 SHA-256 为 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`。

首轮 P4 为 **24 passed / 1 failed / 0 skipped**。失败来自测试代理把所选组件和新增运行时依赖的 tarball 都损坏，后者触发 registry integrity 执行错误，遮挡所选组件的 `PACKAGE_DIGEST_MISMATCH`。先加断言要求只损坏所选包，窄跑得到 **1 failed / 24 未选中**；将代理限制到所选精确包身份后，同一冻结产物窄跑 **1 passed / 24 未选中**，完整重跑 **25/25 passed、0 skipped**。三个结果 JSON 分别为 `.superpowers/t15/host-p4-corrupt-proxy-red-2026-11-17-results.json`、`host-p4-corrupt-proxy-green-2026-11-17-results.json`、`host-p4-green-2-2026-11-17-results.json`。这是测试故障注入修正，不修改已发布 bytes，也不将标题筛选未运行项计为通过。

中断恢复后，C 再次设置同一 `A10_FROZEN_BUNDLE`、`INSTALLED_CLI_EVIDENCE` 和 `PHASE3_CLI_TARBALL`，执行：

```powershell
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/phase3-plan.config.ts --reporter=default --reporter=json --outputFile=.superpowers/t15/final-p4-results.json
.\scripts\pnpm.ps1 test
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
```

P4 **25/25 passed、0 skipped、exit 0（27.93s）**，真实隔离服务、仓外安装、14 项目矩阵、双框架计划、撤权/废弃/损坏/传输错误及全树只读均执行。根 test **83 文件、1488 passed、0 skipped、exit 0（299.31s）**，其前置 T10 为 **168/168、0 skipped**；根 tsc **exit 0**。日志在 `.superpowers/t15/final-p4.log`、`final-root-test.log`、`final-root-tsc.log`。运行出现既有 Node `DEP0190` 警告，未把它描述成零诊断输出。

这些结果只证明本候选的既有测试通过。最终整分支审查随后报告了同包多组件 registry 证据去重、远端 matched/unverified gap 文案泄漏、已锁运行时依赖冲突等残余；正在按原 B 负责范围补回归并复现，**0.0.12 不作为最终 T15 验收候选，尚不合入 main**。产品修复后必须冻结新版本并重新验收。T16/T17、G2 与真实业务试点继续开放。
