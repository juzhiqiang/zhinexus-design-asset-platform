# T15 plan 行为 RED 与夹具前提审查

日期：2026-11-17（Asia/Shanghai）；C / Codex 宿主执行与独立只读审查。产品实现归实际 Claude 桌面端 B，本记录不代表 T15 完成。

## 第一批正式运行

B 停在 `plan-behavior-red-ready`，新增 `project-plan.test.ts` 16 项与 `project-plan-network.test.ts` 13 项；plan/resolve/registry/integrate 仅为固定签名的 throwing stub。C 在 B 独立工作树通过固定工具链执行：

```powershell
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
```

13:25:52 开始，**29 项实际执行并失败、0 跳过、exit 1**，1.45 秒；根 TypeScript **exit 0**。失败发生在当前 `NOT_IMPLEMENTED` 与预期结构化计划/错误码的行为断言，两个文件均成功收集。测试 SHA 前后一致：plan `CA361AC86ED82ED57B905404C69C722DCC2D0D8C7B72F1E8A496CD8BFF2A367C`、network `33764E33DCD4A8785458455212514EE1DCA075DBAC2954D6EE762083148FE967`；四个 stub 同样未变。

日志与前后摘要保存于 B `.superpowers/t15/host-plan-behavior-red-2026-11-17.log`、`host-plan-behavior-red-hashes-2026-11-17.json`、`host-plan-behavior-red-root-tsc-2026-11-17.log`，另备份到 C 忽略 ledger `b-inspection-final-evidence/`。Node 26.13.0、pnpm 12.18.0；未打包新 CLI 或执行安装计划。

## GREEN 前的同批前提审查

throwing stub 不发请求，首批 RED 不能证明成功夹具或并发屏障可成立。C 预审与独立 reviewer 在旧快照确认以下问题，并交实际 B 同批修正测试；产品 stub 保持未实现：

- plan 测试原 server 对所有路径返回 matched API，不能提供正常 registry 元数据/tarball；平台 SHA 与 network integrity 为占位值，无法核对真实 served bytes。要求独立 synthetic registry、实算 SHA256/integrity/SHA1，以及精确包名/版本/路径。
- 正常 API query 缺完整 packageName 绑定。要求完整 query 对照，错配反例单独变更。
- 缺绑定/布局/unverified 输入未附相应 gap，部分可选字段显式为 undefined，违反冻结 MatchPlan 动态契约。要求真正删除字段并补 gap，逐项验证源输入合法；产品不得改写 sourceMatchPlan 或放宽契约来迁就测试。
- 本地编辑靠 sleep 猜测请求已开始，tarball 撤权 hold 未接入 handler。要求 entered/release 真实屏障，先观察请求到达再修改材料，之后核对最终 GET；stub 在入口失败与环境超时须区分。
- planned 命令断言只允许 install，未涵盖已有原生 typecheck/build 预览；要求结构化 argv 与正确 cwd，保留零执行边界。
- 原 registry-integrity 案例只测所选组件的平台摘要错配，未覆盖没有平台 SHA 的新增运行时依赖。要求独立依赖 bytes、真实 integrity 与实际读取证据，并拒绝坏 integrity。

交接为 B 已授权忽略目录 `c-plan-red-fixture-precheck-2026-11-17.md`，实际客户端已收到。独立 reviewer 未执行服务或修改文件；B 写入中的文件不作为最终候选审查。停写后固定 SHA 复审、宿主完整 RED、B GREEN、三组 P1 测试/构建/类型检查、独立黑盒与真实冻结 CLI 验收仍待后续。

## 修正夹具后的完整 31 项 RED（追加）

B 停在新 `plan-fixture-red-ready`（13:42:22），补齐上述前提，并新增两个未锁依赖的 integrity 正反用例。该 synthetic 运行时依赖为 ECharts 6.1.0，输入 MatchPlan 显式提供候选，本地项目没有锁定它；所选图表包与该依赖分别使用独立 bytes，只有图表包有平台 SHA，新增依赖只能声明 registry-integrity。测试不把这个合成材料当 SDK 或真实兼容证据。

C 再次执行同一两个测试文件及根 TypeScript。13:44:42 开始，**31 项实际执行并失败、0 跳过、exit 1**，859ms；根 TypeScript **exit 0**。失败为 `NOT_IMPLEMENTED` 与预期计划/错误码不符，或未实现入口先结束、没有进入真实请求屏障（`settled` 应为 `entered`）；没有 fixture 收集失败、预期合法输入校验失败或屏障超时。源 MatchPlan 的语义反例仍保存完整输入，未放宽公共契约。

两测试 SHA 前后一致：plan `DEEAA4A1BC7C3E5E3A3A0DFAD10CA6B568AD091F03F0697422A0F6726544FE8C`、network `FBF64E3E6886A989C506A4362711A83A2DFA9241F2896E5F756DBB71ADD2BF89`；四个产品 stub SHA 与首批 RED 相同。日志 B `host-plan-fixture-red-2026-11-17.log`、`host-plan-fixture-red-hashes-2026-11-17.json`、`host-plan-fixture-red-root-tsc-2026-11-17.log`。独立 reviewer 仅针对该固定 SHA 复审既有前提，不追逐写入中的文件或扩张 Git 配置；后续 GREEN 和最终 T15 门槛仍待完成。

## 固定快照复审残余（追加）

独立 reviewer 前后核对同一 SHA，静态关闭远端 registry、完整 query、原生命令、真实 entered/release 与新增依赖 integrity 前提，但仍确认两处原夹具问题：

1. plan 测试 430 的 unverified 仍缺 gap，442–448 的绑定缺项仍显式 undefined 且未补 gap；449–450 取消源合法性断言没有解决结果契约再次校验完整 sourceMatchPlan 的要求。需要真正修正这几个源输入，再逐项确认 validateMatchPlan 成功。
2. network 测试 409 的源 target 为 OTHER_SHA256，但首次 API 默认返回正常 TARBALL_SHA256，下载前已是 TARGET_CHANGED。摘要损坏反例需要首次和最终 API 都稳定声称 OTHER_SHA256，与实际 tarball bytes 独立不符，才能核对 PACKAGE_DIGEST_MISMATCH。

C 核对源码后已将两处精准校正交实际 B，保持产品 stub、原有结果合法性断言和既定范围。31 项首轮完整 RED 不被改写，也不因为没有触及这些后续输入/网络前提就宣称夹具全部有效；两处校正后的完整 RED 和原 GREEN 待后续记录。reviewer 未执行项目、服务或改文件。

## 两处前提关闭后的最终 RED 与实现交接（追加）

B 于 13:53:38 更新停写报告。C 只复核上述两处残余：unverified 补 COMPATIBILITY_UNVERIFIED；缺 prop source、event handler、layout 真正删除对应可选字段并补各自 gap，入口前恢复 validateMatchPlan 成功断言；摘要损坏反例首次与最终 API 都稳定声明 OTHER_SHA256，实际 tarball bytes 保持独立，并要求真实下载请求。原有结果契约断言保留，四个产品 throwing stub 未变。

C 通过同一固定工具链执行前述完整两个测试文件与根 TypeScript。13:56:02 开始，**31 项实际执行并失败、0 通过、0 跳过、exit 1**，817ms；根 TypeScript **exit 0**。全部失败为 NOT_IMPLEMENTED 与预期结构化结果/错误码不符，或 stub 先 settled 而未进入请求屏障；没有源输入合法性、setup、收集或屏障超时失败。此结果证明当前 RED 行为与已核对前提，成功网络链路仍须由 GREEN 实现运行证明。

两测试 SHA 前后一致：plan `C8DFC9100B158A16EE3472CF28913F577BD405BB23C54109531F3FAF5F0F7A85`、network `E1AC8A98896E536D271FBB36A7236014C1A4C18EB741B70858BDFD12D496DFF9`。四 stub SHA 与首批 RED 相同。独立新日志为 B `.superpowers/t15/host-plan-final-fixture-red-2026-11-17.log`、`host-plan-final-fixture-red-hashes-2026-11-17.json`、`host-plan-final-fixture-red-root-tsc-2026-11-17.log`，另备份到 C 忽略 ledger；历史日志和记录保留。

正式 RED 与原 P1 GREEN 授权已通过实际 Claude 桌面端送达 B，界面确认消息已发送且输入框清空。B 继续 resolve/registry/plan、integrate 与 cli/index 接线，保留 93 inspection 与 31 plan 行为断言；公共契约、独立 A/C/D 测试、根配置/锁/版本仍由各负责人维护。B 停在 plan-green-ready 后由 C 正式执行三组 P1 测试、CLI build/typecheck、根 tsc 与候选审查。独立黑盒、冻结 CLI 的真实安装/服务验收、最终全图验证及 main 集成尚未完成；未升版、pack 或 push。
