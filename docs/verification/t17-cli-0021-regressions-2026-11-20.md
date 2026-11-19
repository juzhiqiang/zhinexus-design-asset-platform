# 冻结 CLI 0.0.21 回归与证据复读（2026-11-20）

本记录保留本轮结果，不替换 0.0.20 及更早失败记录。技术验收使用授权临时 Vue/React 工程和 owner 隔离三存储，productionAcceptance=false；历史真实业务试点、公司 OIDC 与生产独立预览域保持单列。

## 冻结身份

- CLI 0.0.21：451414 字节，SHA-256 `7dd4874f0e6c98caddb2de959b942d7bde463c35a04ba82fe31ec67140f5f7cd`，来源 HEAD `3fbcfa9b66900c55e254f15e73f318055c6a104f`。外置 `cli-0.0.21-432a7805-4921-4c7d-a07d-029bbf7ed010/freeze-manifest.json` 保存单次 pack 身份。
- 既有 SDK manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`，199 个唯一产物、398 个重复/唯一引用全部复读通过；未重包。
- 历史兼容 probe SHA-256 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7` 只按 historical-real-installed-cli-probe-replay 使用，不称为当前 CLI 新 probe 或生产 G2。

所有证据根位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20`。

## 实际命令与结果

均由固定工具链包装器 `scripts/pnpm.ps1 -PnpmArgs @(...)` 执行。

| 命令或配置 | 实际结果 | 外置根 |
| --- | --- | --- |
| `verify:workspace` | 10 成员与依赖边界通过，exit 0 | 升版时工具记录 |
| `exec turbo run build typecheck --force` | 20/20，0 cached，18.389 秒，exit 0；随后根 tsc exit 0 | `workspace-0.0.21-665539951682462c8ab6222590ab3fe8` |
| 完整根 `test`，有效 `A10_FROZEN_BUNDLE` 与 `ZHINEXUS_SDK_BUNDLE_DIR` | T10 168/168、零跳过；Vitest 121 文件、2187/2187、零跳过，594.49 秒、exit 0 | `full-test-0.0.21-final-3477abf8131947849354b18116cc239f` |
| `test:platform`，真实 Next 5173 与有效 SDK | 35 文件、137/137、零跳过，694.92 秒、exit 0 | `platform-0.0.21-e7e517e6291b4d2ab4591b4667529655` |
| `test:browser`，有效 SDK，启动前确认 5173–5176 空闲 | 288/288，约 2.3 分钟、exit 0 | `browser-0.0.21-712ad54ded5545eba6971fe0dd87bf92` |
| `exec vitest run --config tests/acceptance/phase3-plan.config.ts` | 完整 T15 25/25、63.22 秒、exit 0 | `t15-t16-0.0.21-1795116035727` |
| `exec vitest run --config tests/acceptance/t16-installed.config.ts` | 完整 T16 14/14，含 Next、无名称过滤，693.99 秒、exit 0 | 同上 |
| `exec vitest run --config tests/acceptance/t17-blackbox/live-vitest.config.ts` | 真实 Vue/React × CLI/MCP 四链、拒绝及取消，5/5、543.99 秒、exit 0 | `blackbox-0.0.21-1795115999104` |
| `exec vitest run --config tests/acceptance/t17-blackbox/vitest.config.ts` | 安装与前置拒绝 5/5、30.60 秒、exit 0 | 同上 |

平台结束后已停止本轮 Next 会话；平台 owner `cd84bf4b-ae52-4fbb-853d-5a8814427cb4` 的 org.zhinexus.recovery 标签容器及卷均为 0。browser 包含六项真实三存储网页提交验收。以上未代替最终宿主或 33 格结果。

首次完整根 test 的 4 项外层超时及 105/105 定向复验见 [预算修正](t17-regression-budgets-2026-11-20.md)。新的完整根 test 未使用名称过滤，于 03:47:04 开始，03:56:59.1119729+08:00 自然结束；控制方收取原会话 exit 0，并复读 test.log 与 result.json。完整结果如上，不改写前次真实失败。服务前置构建使用常规 Turbo 缓存；本轮全图无缓存验证为表中单独执行的强制 build/typecheck。

控制方使用固定 Node 26.13.0 另行读取 11 份构建、完整根测、平台、browser 和四组冻结回归索引/结果，重新检查最终计数、退出码、CLI 原字节及原架构摘要，failures=[]、passed=true。结果保存在完整根测目录的 `root-final-regression-log-reopen.json`，SHA-256 `2da2f9c1632615f3a9423cf6e5401fdb26346f9e9d1543bbb847b9a66e1e8666`，其中保留每份原日志的大小和摘要。此复读仍明确把新宿主、正式矩阵及其清理列为待收，不据已通过部分提前验收。

## 原始证据归档与控制方复读

独立验收方先逐项核对原件与副本：live 158 文件、legacy 8 文件、T15 4 JSON、T16 103 JSON、T16 recovery 22 文件，共 295 文件和 17 receipts；四条成功链各 7 个 artifact refs、独立基线与真实报告均保留。281 个文本的 JWT/Bearer 形态扫描为 0。

索引 `blackbox-0.0.21-1795115999104/final-independent-reopen.json` SHA-256 `d1ffbff630c5f1a8623fc6d5df1535c00b06a126160bb9e43679a6f7c0ca5a46`。控制方另外重新读取该索引及五份 manifest、295 个副本（2222158 字节），各摘要/大小均一致、JWT 形态 0，冻结 CLI 字节未变，结果保存在同目录 `root-archive-reopen.json`。副本复读不冒称清理前原生文件系统身份凭证。

## 清理保留项

live 自有 CLI 和工程已由本轮流程清理；D 本轮三个 owner 的进程、容器、卷均为 0。自动审批检查在执行前拒绝了下列精确目录的递归清理，原因仅为 blocked by policy，整条删除未启动，没有更换 API 重试：

- `C:/Users/10208/AppData/Local/Temp/zhinexus-t15-installed-6v6Cfn`
- `C:/Users/10208/AppData/Local/Temp/zhinexus-t16-installed-k391pW`
- `C:/Users/10208/AppData/Local/Temp/t16-d-fUxufQ`
- 本工作树 `.tools/recovery/0aa55c20-22d8-4945-82da-ba4ad979fd50`
- 本工作树 `.tools/recovery/5fffd99c-983b-4c93-9d1e-f19f626058fd`

精确形态与拒绝结果在 `t15-t16-0.0.21-1795116035727/cleanup-inspection-0021.json` 和 `cleanup-result-0021.json`；此前已拒绝的历史目录继续保留，不据本记录声称全部临时目录清除。
