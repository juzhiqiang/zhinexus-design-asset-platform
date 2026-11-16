# 新 SDK 标签修复后的采纳与回退验收

2026-11-16，Windows x64，C 分支 `feat/t13-c-matching`，冻结源码提交 `8e2aec342009ef4562c2bad3f1cfb7f6939a5ff6`。使用项目固定 Node 26.13.0、pnpm 12.18.0 和本地 Playwright Chromium。

本记录关闭新 SDK 的本地验收链：已安装 CLI → 首轮 hold → 56 张截图审查 → 全新消费者 adopt → strict/legacy → 原双消费者回退 → 实际兼容报告落库。6.1.0 可采纳；6.0.0 仍不在支持范围内。完整一期和生产验收保持开放。

此前的 [标签修复与源码门禁](sdk-label-clipping-repair-2026-11-16.md) 保留原样。新候选冻结、首轮视觉审查和 adopt 执行已在接续前完成，本轮读取其原始记录并独立审计，随后执行新候选的严格拒绝、legacy、回退、API 和 T10 回归；未重复打包或改写旧报告。

## 冻结身份与本地证据

以下路径均相对仓库根目录；完整运行目录由 `.tools/sdk-label-acceptance-path.txt` 指向。

- 本轮运行目录：`.tools/sdk-label-acceptance-8929ffb81fcf4c90b98352c5f8afbed1`（下文记为 `$run`）。
- SDK 冻结目录：`.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`（下文记为 `$sdk`）。
- manifest SHA-256：`04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。
- CLI 冻结文件：`.tools/cli0011-next-7c77701970da41ebb2c90728f3f2a1ed/company-component-cli-0.0.11.tgz`。
- CLI SHA-256：`14775474e4b0181fd3c891f6624ed15b11b2f52582731271063138e606420adf`，220135 bytes。

| 包 | 版本 | bytes | tarball SHA-256 |
| --- | --- | --- | --- |
| `@company/charts-core` | 0.0.11 | 54607 | `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb` |
| `@company/charts-vue` | 0.0.12 | 6683 | `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9` |
| `@company/charts-react` | 0.0.12 | 12221 | `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28` |

新候选已通过 `.\scripts\pnpm.ps1 test:platform tests/platform/current-sdk.test.ts`：隔离三存储发布至 READY、14 个实现的本地 HTTPS 预览及逐资源摘要、Vue/React 各七子路径的精确 Registry 消费通过，1 test passed，日志 `.tools/sdk-label-new-frozen.log`。诊断在 `$sdk.acceptance.json`，位于冻结目录外；它绑定上述 manifest 与逐包摘要。该步骤在首轮截图之前完成，后续均复用同一组冻结材料。

最终 `.tools/sdk-label-final-audit.mjs` 实测 exit 0，输出 `$run/final-artifact-audit.json`：严格读取冻结目录并逐一核对 199 个声明文件的 bytes/SHA，核对旁置诊断、CLI tarball、已安装 CLI 的 207 个文件与 tarball 内容，以及所有报告和回退记录的包身份。截图后未重新 pack，也未修改冻结 CLI 模板。

## 首轮与全新消费者 adopt

矩阵为 7 组件 × Vue/React × light/dark × Canvas/SVG，共 56 组合。首轮 CLI exit 1 / hold，类型、运行、交互通过，无同环境基线时不采纳；`hold/audit.log` 记录独立审计通过。`visual-review/review.json` 绑定原报告摘要，记录七张联系表、56 张截图均已审查，排行榜 `180次`、占比 `120次（40.0%）` 完整显示。该视觉检查覆盖本次夹具和展示组合，不代表任意业务数据或容器尺寸。

adopt 原始执行时间为 2026-11-16 16:09:06–16:09:43（Asia/Shanghai），CLI exit 0。实际执行的是工作区外安装包的 `dist/bin.js echarts verify`，未设置源码探针覆盖入口。参数含 `--version 6.1.0 --baseline <首轮报告>`；完整命令、安装包路径和退出值在 `adopt/invocation.json`。

| 框架 | 首轮 staging | adopt staging | 结果 |
| --- | --- | --- | --- |
| Vue | `a-t10-staging-02Akb5` | `a-t10-staging-jV9eBA` | 不同工作区外目录，全新 strict 安装 exit 0 |
| React | `a-t10-staging-aSBG2i` | `a-t10-staging-ufBKjj` | 不同工作区外目录，全新 strict 安装 exit 0 |

完整路径保留在 `final-artifact-audit.json`。adopt 未复用首轮消费者；首轮自有消费者保留给实际回退，adopt 消费者在该轮结束后由探针清理。

本轮运行 `scripts/audit-t10-evidence.mjs <adopt报告> adopt 56`，exit 0：两框架 typecheck/runtime/interaction/visual 全通过，未覆盖列表为空；重算 56 个环境键并检查字体及截图摘要。最终审计确认 56 个 adopt PNG 的 SHA-256 均与已审查首轮一致。

| 报告 | SHA-256 |
| --- | --- |
| `hold/probe-evidence-hold.json` | `a6f306d085d81d5bc799a93ce44e5625b6d8fa70baf4db3ff98f04a966199bab` |
| `adopt/probe-evidence-adopt.json` | `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7` |
| `legacy/probe-evidence-legacy.json` | `0cd13a3935c19db5789486761f1dc6f807cd7b60724dcef9c3d80fc1da06f869` |

## 6.0.0 拒绝、显式测量与真实回退

分别执行 `strict-vue`、`strict-react`、`strict-only-vue`、`strict-only-react` 四条已安装 CLI 路径，均 exit 1 / `PROBE_FAILED`，内层 `PROBE_PEER_REJECTED`；没有生成报告，没有自动改用 legacy。拒绝发生在冻结 peer 预检，不能把诊断中的 “npm ERESOLVE” 当作实际 npm 解析失败的证据。各模式的 `invocation.json` 与 `cli.log` 留存在 `$run` 下。

显式 `--peer legacy` 的 6.0.0 完成 56 组合：两框架运行、交互、视觉通过，但 Vue Bundler/NodeNext 类型检查均 exit 2，React 均 exit 1。CLI exit 1，`peerSatisfied=false`，`recommendation=hold`。独立测量审计 exit 0（`legacy/measurement-audit.log`）仅证明测量与摘要完整，没有扩大支持范围。

回退调用 `scripts/verify-t10-rollback.mjs`，输入首轮报告及 `owner.json`，exit 0。原 Vue/React 两个自有消费者都实际安装 6.0.0 并构建，再恢复原 package.json 和锁文件字节，严格 `npm ci` 恢复 ECharts 6.1.0、core 0.0.11、各自 wrapper 0.0.12；Bundler/NodeNext、构建和无浏览器全局的 SSR 导入均通过。

`rollback/rollback-evidence.json` 中 `passed=true`、`candidateAdopted=false`，两份清单/锁文件恢复前后 SHA 一致、`errors=[]`。只有两消费者全部恢复成功后才清理其自有 staging；最终审计确认这些目录已移除，ownership 根标记和报告保留。这与历史 Git 工作树清理无关。

## 已安装报告的真实 API 验收与回归

以同一 `$sdk` 和真实 adopt 报告运行 `test:installed-compatibility`，exit 0：服务构建 5/5、0 cached，Vitest 1 passed。测试在独立本地 PostgreSQL/Verdaccio/MinIO 中上传同一冻结材料、发布到 READY，然后针对 **line 的 Vue/React 两个实现**验证：接受报告 201、重复 409、篡改消费者版本 400、API 重启后仍可查询、私有未授权查询 404、公开结果不泄露 subject/reason。输入报告字节保持不变，隔离测试设施按自身生命周期清理。

该接口专项未逐一为其余 12 个实现写入兼容记录；14 实现预览检查与本次两实现兼容接口覆盖须分别理解。READY 仅表示包和预览可达，不替代本地兼容证据或视觉基线审查。

显式将 `A10_FROZEN_BUNDLE` 指向本次新候选后运行 `test:t10`，exit 0：168 passed / 0 failed / 0 skipped（25 suites）。日志为 `$run/test-t10.log`；新冻结输入相关用例确实执行，没有以跳过计为通过。

## 实际命令与留证

下列命令使用固定 Node；已存在的运行目录、模式和独占写入的审计输出不可直接覆盖重跑。需另一次验收时，依照 [T10 Windows 步骤](t10-windows-local-procedure.md) 创建新的证据目录，并继续引用同一冻结产物。

```powershell
$run = (Get-Content -LiteralPath '.tools/sdk-label-acceptance-path.txt' -Raw).Trim()
$sdk = Join-Path $PWD '.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3'
$node = Join-Path $PWD '.tools/node-v26.13.0-win-x64/node.exe'
$env:Path = "$(Join-Path $PWD '.tools/bin');$(Split-Path $node);$env:Path"
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD '.tools/playwright'
$env:npm_config_registry = 'https://registry.npmjs.org'

# 原始 hold/adopt 已执行并保留，本轮审计 adopt
& $node scripts/audit-t10-evidence.mjs "$run/adopt/probe-evidence-adopt.json" adopt 56
& $node .tools/sdk-label-installed-probe.mjs strict-vue
& $node .tools/sdk-label-installed-probe.mjs strict-react
& $node .tools/sdk-label-installed-probe.mjs strict-only-vue
& $node .tools/sdk-label-installed-probe.mjs strict-only-react
& $node .tools/sdk-label-installed-probe.mjs legacy
& $node .tools/audit-legacy-measurement.mjs "$run/legacy/probe-evidence-legacy.json"
& $node scripts/verify-t10-rollback.mjs "$run/hold/probe-evidence-hold.json" "$run/rollback" "$run/owner.json"

$env:A10_FROZEN_BUNDLE = $sdk
$env:INSTALLED_CLI_EVIDENCE = "$run/adopt/probe-evidence-adopt.json"
$env:TURBO_FORCE = 'true'
.\scripts\pnpm.ps1 test:installed-compatibility
.\scripts\pnpm.ps1 test:t10
& $node .tools/sdk-label-final-audit.mjs
```

模式 runner 的 exit 0 表示它断言了预期 CLI 退出值；四条 strict 和 legacy 的 CLI 实际都是 exit 1。辅助 runner、PNG、JSON 和日志留在本机 ignored `.tools`，不纳入 Git，也不应把仓库文档当成二进制证据备份。

## 提交与未覆盖边界

标签修复提交 `a4a3838c`；core 升版 `4b00138d`；Vue/React 升版 `8e2aec34`。CLI 0.0.11 和 API 0.0.8 本轮未改。本次仅补验与文档收口，无产品行为或版本变动，不再升版。

先前源码门禁结果（build 10/10、typecheck 14/14、Vitest 1113、浏览器 270）见独立标签修复记录；本轮没有重复跑这组全量源码检查，不能将旧运行冒充新运行。

- 关闭的是本次新候选的 T10 本地分发、采纳/拒绝、回退及兼容接口专项，不标记完整 T10、G2、T11/T12 或一期上线完成。
- 公司 OIDC、生产独立预览域/TLS/实际 Cookie 策略及生产配置仍待接入；本机隔离设施不替代它们。
- 真实 Vue/React 业务试点，以及 T13/T14 真实 ID 规则、导出与独立人工标注仍未交付。
- 历史工作树清理仍按 [已有记录](four-agent-merge-cleanup-2026-11-16.md) 保持阻塞，本轮未再次尝试。

原始架构文件 SHA-256 最终仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。本轮未推送、未发布到生产环境。
