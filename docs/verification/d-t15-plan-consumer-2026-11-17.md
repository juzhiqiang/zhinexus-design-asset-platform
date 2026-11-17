# D / T15 黑盒验收准备与 RED

日期：2026-11-17。工作分支 `chore/t15-d-plan-acceptance`，P0 基线 `31ae120a270e84ab7c100d3ad77919b233d1d48b`。本记录仅证明验收准备和行为 RED，P3 GREEN 与 T15 完成尚未达成。

## 实际客户端与宿主配合

测试和文档通过实际 Claude Code 会话 `bae14ee4-36a8-48f8-b530-6520d076b6c0` 生成。客户端曾出现工具参数解析错误；已写出的文件保留，后续由同一会话输出文件内容，C Windows 宿主保存、校对契约、执行固定工具链及 Git。未将客户端故障视为测试通过。

独立 Codex 只读审查发现三处误通过风险，C 按审查修正：所有通用调用前后比较项目全树；inspect 结果执行完整 inspection 校验及必需快照断言；API 500 反例要求实际 GET 和正确平台令牌。审查没有替代用户指定的实际开发客户端。

## 验收内容

- 子进程只执行构建后的 `packages/component-cli/dist/bin.js`；不导入 CLI 产品模块。只观察参数、环境、退出码、stdout/stderr 及文件副作用。
- synthetic 项目在工作区外临时目录创建；完整目录集合、文件原始字节 SHA 和链接目标逐项比较。参数、输入 JSON 和网络失败分支也检查零写入。
- inspection 校验 Vue/npm、React/pnpm、精确锁版本、快照和 Git 脏路径。计划校验结构、来源摘要、依赖及生成意图；缺 prop/event、unverified、撤权均必须阻塞。
- 恶意生命周期/配置及真实 Git fsmonitor marker control；Git 环境覆盖反例要求实际目标和诱饵仓库均保持不变。
- Windows 实际创建 junction，检查目标根外字节不变；创建不可用时报环境失败，不能冒充覆盖。
- tarball 响应暂停期间分别修改关键文件、撤权和废弃。恢复响应后要求重新读取并阻塞；用户编辑后的完整快照必须保留。
- API 与 registry 使用不同 loopback origin，逐请求校验令牌分离；跨 origin tarball redirect 目标必须零请求。错误响应主动回显两个 synthetic 令牌，输出仍须脱敏。

HTTP stub 仅证明协议边界，synthetic tarball 仅提供固定下载字节及摘要，不作为真实发布或兼容证据。真实 Nest/PostgreSQL/MinIO/Verdaccio 和冻结消费者由 C P4 专项验收。

## 实际验证

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','--noEmit','--ignoreConfig','--target','es2022','--module','nodenext','--moduleResolution','nodenext','--strict','--skipLibCheck','--types','node','tests/fixtures/phase3-cli-harness.ts','tests/integration/project-plan-consumer.test.ts','tests/integration/project-plan-readonly.test.ts')
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts
```

- 窄 TypeScript 检查：exit 0。
- 初始宿主 RED：30/30 行为失败；加入 redirect 及审查修正后最终 **31/31 行为失败、0 跳过、exit 1**。命令尚未实现导致退出码、输出及请求屏障反例失败；未出现夹具、junction 或 Git marker 环境准备失败。
- 日志依次保留于 `.superpowers/t15/p3-red-host2.log`、`p3-red-host3.log`、`p3-red-host4.log`，不改写此前失败记录。
- 根 TypeScript 与 `git diff --check` 的提交前结果由宿主追加；只提交 RED 准备子任务，不宣称完整根测试通过。

### 宿主提交前补充验证

首次根 TypeScript 检查因独立工作树尚无 Nest/SDK 构建声明而失败，属于环境前置缺失，不计行为 RED。随后 C 在 D 工作树执行：

```powershell
.\scripts\pnpm.ps1 exec turbo run build typecheck --force
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
git diff --check
```

全图构建和类型检查实际 **20/20 成功、0 cached、exit 0**；补建后根 TypeScript **exit 0**；diff 检查 **exit 0**。日志保存于 `.superpowers/t15/p3-graph-build-2026-11-17.log` 与 `p3-root-tsc-final-2026-11-17.log`。此次提交仍只完成 RED 验收准备；31 项产品行为尚未 GREEN，不标记 P3 或 T15 完成。

## 后续门槛

B 冻结产品后按 A → B → D 次序集成，在同一候选运行 P3 GREEN、C 真实安装专项及完整回归。使用说明当前为草案，示例将在 GREEN 时实际复核。T16/T17、下载限额和超时的完整覆盖、14 案例消费及真实业务试点仍有各自验收门槛。

## Git clean/process 黑盒补充（2026-11-17，追加）

延续实际 Claude Code 会话 `bae14ee4-36a8-48f8-b530-6520d076b6c0`，D 根据宿主已实测的 Git filter 执行事实产出 helper 和两项黑盒测试，C 保存至 D 负责的 harness/readonly 文件并执行固定 Windows 工具链。代码经过同会话三轮审查修订：C 指出 CJS/ESM、pkt-line 编码与等长内容的 setup 问题，D 返回修订代码；最终 JSON 尾部被截断，C 仅补齐测试与 JSON 关闭符、删除重复导入，并纠正一处 helper 注释，没有改写产品实现。原始生成材料保留在忽略目录 `.superpowers/t15/filter-followup-{response,response2,response3,final-code}.json`。

- helper 和 marker 位于 synthetic 项目根外；配置仅指向本次自有 helper。clean 原样透传 Buffer，process 实现 Git v2 pkt-line 握手并透传内容。
- `git add` 控制正例必须实际写出对应 marker；process 还须出现 `command=clean`，失败即抛环境错误，零跳过。控制 Git add/commit/status 有 10 秒超时。
- 10 字节 tracked payload 从 `1234567890` 改为 `abcdefghij`，mtime 明确增加 4 秒；随后黑盒依次检查 inspect/plan 的完整契约、真实 dirty 路径、marker 不存在和项目全树原字节保持不变。

实际命令：

```powershell
.\scripts\pnpm.ps1 exec tsc --noEmit
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts
git diff --check
```

根 TypeScript **exit 0**；完整专项 **33/33 行为 RED、0 跳过、exit 1**，耗时 16.62 秒。两项新增 filter 用例的控制正例与 commit 均成功，实际失败位于旧 CLI 尚无 `integrate inspect` 的退出码断言，不是 helper/权限/setup 失败。日志 `.superpowers/t15/p3-filter-red-host-2026-11-17.log`。该补充仅完善 P3 RED 准备，完整产品 GREEN、P4 和 T15 仍未完成。

独立只读审查另要求计划结果也精确保留真实 dirty 信息。C 按审查补 `planJson.localProject.git` 的完整 `{status:'dirty',dirtyPaths:[payload]}` 比较，并将 inspect 路径集合收紧为精确值，避免省略 Git 读取或虚构路径通过。先用标题过滤复跑两项：2 RED，另 13 项被选择条件排除（不算完整零跳过验证）；随后重新执行根 TypeScript与**完整 33 项**，根检查 **exit 0**，**33/33 RED、0 跳过、exit 1**，12.54 秒，日志 `p3-filter-final-red-host-2026-11-17.log`。未改写此前历史结果，仍只提交验收准备。

## 变换清单 filter 黑盒补充（2026-11-17，追加）

继续实际 D Claude Code 的同一会话，新增 Vue/pnpm 与 React/npm 两项独立进程用例。D 返回的 JSON/原始 TS 被截断，且包含双重转义、API 拼写及快照基准错误；C 保存全部原文与校正稿于 `.superpowers/t15/transform-filter-*`，补关闭符、恢复正确换行/NUL 和 Node API 名称，采用 D 后续明确给出的仅版本主号正则变换，并分别保存 whole-tree 与 project 快照。C 仅校正 D 负责的测试，不承担 B 产品开发。

新用例从有效清单 version 1.0.0 开始，实际 `git add` 执行 helper 并将 2.0.0 字节存入索引；再将该索引字节写回工作区，推进 mtime。原生 Git status 必须精确报告 ` M package.json` 且执行 helper；清空 filter 的对照必须输出为空、零 helper，两个 status 均使用 `--no-optional-locks`，全树含 `.git` 原始字节保持不变。控制不成立直接失败，不跳过。之后黑盒要求 inspect 的完整契约和精确 dirtyPaths、plan 的 blocking `DIRTY_TARGET`、零 helper 执行、零凭据输出及所有树字节不变。

C 实际运行：

```powershell
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan-readonly.test.ts -t 'transforming manifest filter'
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts
git diff --check
```

窄跑 **2 项行为 RED**，另 15 项因标题筛选未运行；根 TypeScript **exit 0**。随后完整专项 **35/35 行为 RED、0 跳过、exit 1**，14.51 秒。新增两个用例全部真实 Git 控制及快照控制成功，失败位于旧 bin 缺 `integrate inspect` 的退出码断言；此时 plan 断言尚未执行，不能宣称 `DIRTY_TARGET` 已由产品满足。日志分别为 `p3-transform-filter-red-host-2026-11-17.log`、`p3-transform-filter-typecheck-2026-11-17.log`、`p3-transform-full-red-host-2026-11-17.log`。独立只读审查已派发；完整候选 GREEN、已安装 CLI 与 T15 仍待执行。

独立只读审查确认本轮无阻塞项：两种框架真实控制成立，whole/project 快照基准一致；所选 MatchPlan 会新增图表依赖，确实需要修改 package.json，因此 DIRTY_TARGET 断言覆盖有效。审查未运行项目或修改文件；GREEN 边界保持上述说明。本轮仅聚焦提交独立 RED 准备，停止 D 写入并等待 B 冻结候选。
