# 冻结 CLI 0.0.22 回归与证据复读（2026-11-20）

本轮沿用用户授权的仓外临时 Vue / React 项目、独立三存储和固定工具链，`productionAcceptance=false`。历史业务试点、公司 OIDC 和生产独立预览域分别验收。0.0.21 的[回归](t17-cli-0021-regressions-2026-11-20.md)、[宿主](t17-host-0021-2026-11-20.md)和[未通过的全量矩阵](t17-matrix-n10-request-2026-11-20.md)均为历史结果。

## 冻结输入

- CLI 0.0.22 仅 pack 一次，来源 `f96af5ee59cfbd007ba4ff50aad3de60cebafb60`，冻结于 `2026-11-20T04:39:01.0606031+08:00`。`cli-0.0.22-mwo0jfyw-6oszswub/company-component-cli-0.0.22.tgz` 为 453485 字节，SHA-256 `d3da08748faa4c18a19a8b757caf817dae032e82b9405521a87dd8f877c179ef`，同目录保存 `freeze-manifest.json` 和 `pack.log`。
- 保留既有 SDK core 0.0.11、Vue / React 0.0.12 原始字节。manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`，199 个唯一文件、398 个引用；未重包。
- 兼容性输入 SHA-256 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`，来源为 `historical-real-installed-cli-probe-replay`，不代表当前 CLI 的新兼容探针或生产验证。
- 工具链为 Node 26.13.0、pnpm 12.18.0。下述相对证据目录均以 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20` 为根。

## 工程检查

调用采用 `./scripts/pnpm.ps1 -PnpmArgs @(...)`。

| 命令 | 实际结果 | 原始证据 |
| --- | --- | --- |
| `verify:workspace` | 10 个成员与依赖边界通过，exit 0 | `workspace-0.0.22-mwo0gepv-tj4gx2ze/workspace-result.json` |
| `exec turbo run build typecheck --force` | 20/20，0 cached，15.336 秒，exit 0 | 同目录 `build-typecheck.log`、`build-typecheck-result.json` |
| `exec tsc --project tsconfig.json --noEmit` | 首跑测试夹具判别类型触发 TS2345，exit 1；`f96af5ee` 修正后完整根 tsc exit 0 | 同目录 `root-tsc-result.json`、`root-tsc-correction-result.json`，两次原日志分别保留 |
| `--filter @company/component-cli build` 和 `typecheck` | exit 0；打包清单 probe 73/73 | 冻结前实际运行 |
| 完整 `test:platform`，有效冻结 SDK、实际 Next 5173 | 35 文件、137/137，570.34 秒、exit 0 | `platform-0.0.22-mwo0kxpv-x9v1mxli/platform.log`、`platform-result.json` |
| 完整根 `test`，有效 `A10_FROZEN_BUNDLE` 与 `ZHINEXUS_SDK_BUNDLE_DIR` | T10 168/168、零跳过；Vitest 123 文件、2198/2198，796.34 秒、exit 0 | `full-test-0.0.22-mwo0kxpv-x9v1mxli/test.log`、`test-result.json` |
| 完整 `test:browser`，有效冻结 SDK、启动前端口空闲 | 288/288，3.4 分钟、exit 0 | `browser-0.0.22-mwo0xzrd-lsb5d634/browser.log`、`browser-result.json` |

平台命令在 `2026-11-20T04:49:52.7423847+08:00` 自然结束，控制方收取原会话 exit 0；wrapper 外层耗时 580.125 秒。`summary.json` 确认 ownedGalleryStopped=true，随后自有 owner `4759ddc3-efba-4c5b-80ac-4475bdafe343` 的容器与数据卷均为空，5173–5176 无监听。完整 `test:browser` 依此顺序启动，不与该轮 Next 服务抢占端口。

完整根命令于 `04:54:04.3126279+08:00` 自然结束，wrapper 耗时 834.016 秒；浏览器于 `04:53:48.9706030+08:00` 自然结束，wrapper 耗时 203.836 秒。两组均收取原会话 exit 0；没有名称过滤或环境缺失跳过。根测包括新加入的矩阵请求回归及两项产品缺陷回归，完整浏览器包括六项真实三存储网页提交测试。

在 0.0.22 中，[修复全源快照续接](t17-repair-source-continuity-2026-11-20.md)及 [MCP SDK 错误脱敏](t17-mcp-sdk-redaction-2026-11-20.md)的独立产品复核已完成。`bf65180a` 只变更外部矩阵请求夹具和验证记录，在冻结后未改动 CLI 产品或公共契约。

控制方随后用固定 Node 独立复读 16 份工程日志、退出码结果和冻结清单，逐项重新确认上述计数、CLI 原字节及原架构摘要，failures=[]、passed=true。结果在完整根测目录 `root-engineering-regression-reopen.json`，SHA-256 `e6cfad6859fccfa0b34a77522a92429a222a091a4104f9795852c5efa283344e`，每份源日志的大小和摘要均保留。该复读仍将新宿主、33 格正式矩阵、最终黑盒/T15/T16 及清理审查列为待收，不据工程部分通过提前结束三期验收。

## 后续独立验收收取

2026-11-20 05:15 +08:00 追加，不改写上次复读时的待收状态：

- [同包黑盒与 T15/T16](t17-blackbox-0022-2026-11-20.md)：四个完整配置分别 5/5、5/5、25/25、14/14，合计 49/49、无跳过、自然 exit 0；控制方独立原件/副本复读 336 文件、17 receipts 通过。
- [完整双框架宿主](t17-host-0022-2026-11-20.md)：正向与单次修复四链的最终报告均为六项通过；34681 个清理前归档文件、1754 个保留原 evidence、四链摘要和四张 PNG 经控制方独立复读通过。
- 当前宿主 owner 资源已释放，但黑盒八个 owned 根的清理被自动审批拒绝，命令未启动，目录及清理前身份/inventory 保留。历史受阻目录未重试。
- 正式 33 格矩阵与最终审查仍在进行，尚不据上述单项通过宣布整个 T17 完成。

## 05:38 后续发现：本候选不作最终交付

正式矩阵 R08 的 browser 行为失败后，独立真实产品探针两次确认正常 250ms 异步文本更新被提前判为 BEHAVIOR_FAILED。同步 control 通过、永久不匹配仍失败，既有完整工程回归没有覆盖这条时序。随后仓库新增真实 Chromium suite 得到有效 RED（8 failed / 4 passed）；产品修复与独立复审正在推进，原失败瞬间 R08 实际文本仍未知。

本记录保留上述全部 0.0.22 命令、通过结果和冻结原字节，不以新结果覆盖；候选必须另升 0.0.23、只 pack 一次并重新完成技术验收。诊断与续接见 [集成记录](t17-integration-2026-11-20.md)，正式 33 格的最终分数仍以 [原矩阵记录](t17-matrix-0022-2026-11-20.md) 为准。

## 05:55 正式矩阵已自然结束

0.0.22 全矩阵最终为正向 `19/20`（Vue `10/10`、React `9/10`）、强制拒绝 `13/13`，完整入口 `1/1`、`3340.98s`、自然 exit 0。原 R08 failed 不变；旧聚合门槛满足不能替代关闭已确认 Important/P1 产品缺陷。原 `59` roots / `23162` files / `493332540` bytes 的 seal 与归档由控制方独立逐字节复读通过，`59` owned parent 已不存在，旧 evidence roots 保留；详见独立提交 `9fb5f215` 的 [矩阵记录](t17-matrix-0022-2026-11-20.md)。

异步断言已在 `10ca2957` 修复并经独立审查批准，Critical 0、Important 0，见 [修复验证](t17-async-assertion-2026-11-20.md)。另立候选 `0.0.23` 的冻结、完整重验和结果分别记录于 [新版本回归](t17-cli-0023-regressions-2026-11-20.md) 及其关联记录，本版成功和失败均保留原样。
