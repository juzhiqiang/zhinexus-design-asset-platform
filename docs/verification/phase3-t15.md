# 三期 T15 项目导入与视觉验收汇编（phase3）

> 本文件由 `docs/verification/` 下 14 篇逐次验证记录合并而成（2026-11-22，`chore/docs-consolidation` 分支）。原件已按主题合并删除，git 历史可追溯；每篇原记录以 `### <原文件名>` 为标题完整保留于「逐条合并记录」。总索引见 docs/README.md。
> 2026-11-26（分支 `chore/docs-slim-round3` 的后续收尾）删除原有的「历史脉络」一节（原 9205 字符）：该节按时间序复述各原记录的过程，其事实由「终态结论」与「逐条合并记录」承载，未在别处出现的硬事实已压入终态结论末尾的「历史脉络硬事实」。原文可经 `git show 789addf7:docs/verification/phase3-t15.md` 完整恢复。

## 终态结论

三期 T15 的技术验收与本地 main 收口已于 2026-11-17 完成；2026-11-22 的双框架组件视觉验收完成 QA 检查与测试材料准备，但视觉验收本身尚未通过。

**T15 推进与合入 commit**：2026-11-16 由 C 完成四方规划校验（规划分支 `chore/phase3-t15-planning`，规划基线 `b35498ac9bddcfcc63ff4fdd85c7befaf29e6c0f`），确定 P0 契约（C）、P1 产品（B / Claude 桌面端）、P2 独立矩阵（A / Antigravity）、P3 黑盒（D / Claude Code）、P4 真实集成（C / Codex）分工；此后全部产品分支基线统一为 `31ae120a270e84ab7c100d3ad77919b233d1d48b`。关键提交：`31ae120a`（P0 契约，已先行合 main）、`7c274ad166bf8693dd6c38359b24822cd3fe65e0`（A 独立矩阵最终来源）、`99bf0f46` / `c5ca0e49`（B 只读识别与计划产品交付）、`a946cdea2ff5b3a1f3d9f05f43ab696f111b1871`（D 独立黑盒最终来源，35 项断言）、`88b13803b3024bc4c57dd7f5fa737208a1f16c29`（B 最终五项审查修复及六条回归）、`5347683d`（C 合入 B 最终修复，集成 183/183）、`e23ef890f12282c60916d31f42d84341108d4014`（CLI 0.0.13 独立升版与 CHANGELOG）。本地 `main` 从 `31ae120a270e84ab7c100d3ad77919b233d1d48b` 快进至 **`49968d96a0a0f051527c3a903cf6c132aeae9fa1`**，Git 树 `1c1581b36ae7150ef5b4e1e286e0b3f2a3b12b04`，与已验收 C 集成树逐字节一致；四个工作分支（`chore/t15-a-project-matrix`、`feat/t15-b-integration-plan`、`chore/t15-c-integration`、`chore/t15-d-plan-acceptance`）均以 `git branch -d` 删除，工作树（各 1054 个 reparse point）清理完毕。

**CLI 0.0.13 与最终门禁数字**：最终候选 CLI `0.0.13`，22:01:21 执行一次 pack 后冻结，`company-component-cli-0.0.13.tgz` **294872 bytes**，SHA-256 `d071f7c17f62db75f36b8ed8c0cb44bab0ed8ff1eccda83abbe029cc31a0a7b6`；独立保存位置 `D:\project\zhinexus-design-asset-platform\.tools\operations\t15-final-2026-11-17\t15-cli-0.0.13\`，仓外真实安装目录 `C:\Users\10208\AppData\Local\Temp\zhinexus-t15-installed-DQQge4`。最终门禁（命令前缀 `.\scripts\pnpm.ps1`，固定 Node `26.13.0` / pnpm `12.18.0`）全绿：P1 五文件 **183/183、0 skipped、exit 0，63.74s**；`install --frozen-lockfile` exit 0（0.19s，锁文件未变）；`exec turbo run build typecheck --force` **20/20 tasks、0 cached、exit 0，14.63s**；根 `tsc -p tsconfig.json --noEmit` exit 0（0.59s）；`verify:workspace` exit 0（0.81s，10 成员、无环）；`test` **T10 168/168、Vitest 83 文件 1494/1494、0 skipped、exit 0**，总 337.27s（Vitest 306.20s）；平台专项（tests/platform 四个文件）**41/41、0 skipped、exit 0**，61.57s；浏览器专项（contracts-runtime + phase2-component-query）**18/18、0 skipped、exit 0**，12.30s；P4（`--config tests/acceptance/phase3-plan.config.ts`）**25/25、0 skipped、exit 0**，32.78s。主工作区复跑同样全绿（`install --frozen-lockfile`、`exec turbo run build typecheck --force` 20/20、0 cached、14.486s、根 tsc、`verify:workspace`、P4 22:17:06 开始 25/25、0 failed、0 skipped、exit 0，43.92s），结束后 CLI SHA 仍为 `d071f7c1…31a0a7b6`，结果在 `.tools/operations/t15-final-2026-11-17/`（`main-merge.json` / `main-gates.json`）。历史候选 CLI `0.0.12`（提交 `52acc3d1b201e4b69ccd41d09ffbcb5aa87e8b40`，tarball **292730 bytes**、SHA-256 `1372ed616d49c9c7e2969e64f2318c54a8ea1341045a94dac167bd582069ecda`）曾取得 P4 **25/25**、根测试 **83 文件 1488 passed、0 skipped**，但因整分支审查残余被明确降级为历史候选证据，**不作为最终 T15 验收候选，未合入 main**。T15 全程未 push、未 tag、未生产发布。

**视觉验收 300/302 与三项阻断**：2026-11-22 在 Windows x64 本机、基线 `b665681997ba842de6ed039652bf4f358771db6a`、分支 `chore/component-visual-acceptance` 上完成 302 格 QA 检查，功能 **300/302**（summary.json：total 302、defaultMatrix 224、additionalStates 78、functionalPassed 300、horizontalOverflow 104、hostClipped 48、parityErrors 0），首次运行为 **298/302**（initial-failures.json，含 2 项柱状图点击坐标误判与 2 项饼图自检失败）。runner 退出码为 **1**，不能当作完整视觉批准。三项阻断问题未关闭：**V01**（阻断小屏视觉验收）任一框架 390 宽度七个入口全部横向溢出，除趋势卡外图表被裁切，768 仍有 48 格溢出；**V02**（阻断深色视觉验收）`?theme=dark` 令牌正确但示例宿主保持白底，`#e2e8f0` 标签难以辨认，影响全部 14 个深色示例；**V03**（阻断该路径自检验收）Vue/React `/pie.html?theme=light&renderer=canvas` 新页 ready 后直接 `runState('solid-empty')`，`instance=1, canvas=0, svg=0`，`single-instance` 与 `renderer-match` 失败。账号后台、真实业务项目试点 T11、完整 T12 和生产 G2 没有在本轮验收。

**材料合入**：QA 与测试准备材料以合并提交 **`3861b86e1093d4f66c1ee5ad2a16902c698f4ebc`** 合入本地 `main`，两个父提交为主分支原提交 `f0e8e418bbe76a638003d493bb2eaf4b48fcdf5b` 与验收分支 `172e7d4c`，共 **46 个文件**，仅新增本轮文档、图像和 `tests/acceptance/chart-visual/` 工具，未修改 SDK、示例、账号实现、API、公共契约、锁文件或根配置；合并后完整复跑 `test` **exit 0**（T10 161 passed / 7 skipped，Vitest 136 文件通过、2343 passed / 2 skipped / 0 failed，共 2345 项，428.59 秒）。本轮只完成本地合并，没有 push。

**仍开放问题**：T15 未 push、未 tag、未生产发布；技术验收使用 synthetic 项目与隔离真实栈，不代表两个真实业务试点或公司生产 G2；特殊 8.3 短名、全部文件系统并发竞争、超过 64 跳链接不由本轮用例全面证明；`publicationEvidence` 的 target/api 自由文本 `notes` 未脱敏；CLI 失败 envelope 早期只有沙箱冒烟。T16/T17 已由 `local-project-apply.md`（2026-11-19 本地合并 main，CLI 0.0.14）与 `local-project-verification.md`（CLI 0.0.23）承接，但仍缺真实授权 Vue/React 业务项目。视觉侧 V01–V03 未关闭，图例位置与零总量「无数值百分比」表达待业务确认，全分辨率逐像素回归未建立。平台/业务侧账号后台（A01–A11）、撤权时限实测（R01–R09）、资产发布闭环（P01–P07）、故障与备份（O01–O03）、真实 Vue/React 业务项目消费（B01，T11 保持开放）、生产 DNS/TLS/撤权验收（G01–G02，生产 G2 保持开放）全部待执行。

**范围说明**：`docs/phases/phase3/` 下 4 篇（`integration-plan.md`、`local-project-apply.md`、`local-project-verification.md`、`project-support-matrix.md`）与 `docs/acceptance/` 下 2 篇（`first-batch-assets-2026-11-22.md`、`platform-test-checklist-2026-11-22.md`）不在本次合并范围，已被保留并移动到 `docs/phases/phase3/` 与 `docs/acceptance/`；它们分别是 T15/T16/T17 的公开接口与支持矩阵文档，以及首批资产草案清单与平台试用验收操作清单，内容未在本汇编重复，请直接查阅新路径下的原件。

#### 历史脉络硬事实（叙述已删，2026-11-26）

角色约定：A = SDK（Antigravity）、B = CLI/画廊（Claude 桌面端）、C = 平台（Codex）、D = 消费者黑盒（Claude Code），另设「综合」角色。全程固定工具链 Node `26.13.0` / pnpm `12.18.0`，架构文件 `component-platform-architecture.md` 的 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723` 为受保护基线。

P0–P4 的 TDD 计数轨迹（按轮次，均已先红后绿）：P0 契约自既有 `37/37` 基线推进，四份契约测试 `111/111` → `115/115`，最终 5 文件窄测 `139/139`；P2 矩阵 `5 passed (5)` → `6 passed (6)` → `7 passed (7)`，成果固化为 `docs/phases/phase3/project-support-matrix.md`（14 个 synthetic 案例、12 项 glob 边界、双框架 14 实现审计，锁快照共 10 个目录置于 `tests/fixtures/phase3-projects/lock-snapshots/`）；P1 inspection 自 `20 failed (20)` 起步，经 `7 failed | 21 passed | 1 skipped (29)`、`14 failed | 27 passed | 0 skipped`、`6 failed | 42 passed`、`12 failed | 50 passed`、`2 failed | 63 passed`、`4 failed | 64 passed`、`6 failed | 80 passed`、`8 behavior failed / 81 passed`、`11 failed / 81 passed`、`1 failed / 92 passed`，收口 `63/63` 后 **93/93 passed、0 skipped、exit 0，30.50s**；P1 plan 新增 29 项 RED 后至 **142/142**，整分支审查两轮 `5 failed / 142 passed（147 项，21:21:42，38.51s）` → `1 failed / 147 passed（148 项，21:40:40，36.69s）`，最终 **148/148 passed、exit 0，37.01s**；P3 黑盒自 30/30 行为失败，经 redirect 与三处审查修正至 31/31、补两项至 33/33、再补变换清单两项后窄跑 2 项行为 RED，完整专项 **35/35 行为 RED、0 跳过、exit 1，14.51 秒**；P4 真实服务以旧 CLI `0.0.11`（tarball SHA `14775474…0adf`）逐轮取得行为 RED（6、9/9、11/11、25/25），首冻结候选 `0.0.12`（tarball **292730 bytes**、SHA `1372ed61…ecda`）P4 `24 passed / 1 failed` → **25/25**，因审查残余降级为历史候选、不合入 main。

## 逐条合并记录

### component-visual-acceptance-2026-11-22.md

- **日期／角色／主题**：2026-11-22，Windows x64 本机；Codex（QA 执行）；双框架组件视觉验收与测试准备记录。
- **目的**：对工作区示例做 302 格 QA 检查并准备首批资产/测试材料。
- **承重事实**：
  - 被测源码基线 `b665681997ba842de6ed039652bf4f358771db6a`，分支 `chore/component-visual-acceptance`。
  - 本轮**完成 QA 检查与测试材料准备，视觉验收尚未全部通过**：302 格功能检查中 **300 格通过**，另有窄屏布局和深色宿主可读性问题；账号后台、真实业务项目试点 T11、完整 T12 和生产 G2 没有在本轮验收。
  - 工具链：Node `26.13.0`、pnpm `12.18.0`、Playwright `1.65.0`、Chromium/headless shell `158.0.8127.18`；浏览器上下文 `zh-CN`、`Asia/Shanghai`、deviceScaleFactor `1`。
  - 包版本 charts-core `0.0.11`、charts-vue/charts-react `0.0.12`；运行时 Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`。
  - 命令与结果：`install --frozen-lockfile` exit 0；`build --force` **exit 1**（根脚本已有 `--cache`，Turbo 不允许与 `--force` 同传，保留失败尝试）；`exec turbo run build --force` exit 0，**10/10 任务成功、0 cached，22.821 秒**；`exec playwright install chromium` exit 0；`verify:workspace` exit 0；`exec node --check tests/acceptance/chart-visual/run.mjs` exit 0；`exec node tests/acceptance/chart-visual/run.mjs` 首次 **exit 1，298/302**（两项柱状图点击坐标误判及两项饼图自检失败）；修正点击目标后复跑 **exit 1，300/302**（两项饼图协议失败保留）；`exec node tests/acceptance/chart-visual/export-assets.mjs` exit 0，14 张草案图导出。
  - QA 工具只启动本轮 `127.0.0.1:5184`（Vue）与 `127.0.0.1:5185`（React）Vite preview；端口占用时拒绝启动；运行完成后关闭本轮浏览器和预览进程。
  - 覆盖：default 2 框架 × 7 组件 × 2 主题 × 2 渲染器 × 4 viewport = **224 格，功能 224/224**；全部额外 fixture 状态（1280×720 / light / canvas）**78 格，功能 76/78**；真实点选 **14/14**（每次正好一个事件，双框架载荷相同；柱状图用 single，其余用 default）；键盘 Enter 更新 **14/14**；Vue/React 对等 **151 对，0 差异**；无 console error、pageerror 或失败网络请求；**23 张联系表均已实际打开检查**，14 张裁图导出后另抽查 line-vue、pie-react。
  - viewport 为 390×844、768×1024、1280×720、1440×900；功能通过数不包含 overflow、裁切和人工可读性判断。
  - 溢出/裁切表：390（56 格）横向溢出 56、图表宿主裁切 48；768（56 格）溢出 48、裁切 0；1280（134 格，含额外状态）0/0；1440（56 格）0/0；**合计 302 格、溢出 104、裁切 48**。
  - 三项问题：**V01**（阻断小屏视觉验收）任一框架 390 宽度七个入口全部横向溢出，除趋势卡外图表被裁切，768 仍有 48 格溢出；宿主固定 720/560/360 宽度，部分 `#app` 固定 760，工具栏不换行；证据 `component-visual-acceptance-2026-11-22/default-390-light-canvas.png`、`default-768-light-canvas.png`；入口 `examples/vue/bar.html`、`examples/react/src/styles.css`。**V02**（阻断深色视觉验收）`?theme=dark` 令牌正确但示例宿主保持白底，`#e2e8f0` 标签难以辨认，影响全部 14 个深色示例（两渲染器）；证据 `default-1280-dark-canvas.png`、`packages/charts-core/src/theme.ts`。**V03**（阻断该路径自检验收）Vue/React `/pie.html?theme=light&renderer=canvas` 新页 ready 后直接 `runState('solid-empty')`：`instance=1, canvas=0, svg=0`，`single-instance` 与 `renderer-match` 失败；证据 `states-pie.png` 与汇总中两个 `*-pie-light-canvas-1280-solid-empty`。
  - V03 是已知「空数据 + 控制器重建」限制，[饼图协议](docs/specs/2026-11-12-sdk-pie-chart-protocol.md)「待完成/限制」已记录；既有 `tests/browser/component-matrix.spec.ts` 先经 solid 再到 solid-empty 使最后一步不重建；放宽「一个绘制面」会同时影响 CLI 所依赖协议。
  - 另两项视觉观察供业务确认：柱状/散点图图例落在 x 轴区域；饼图 zero-total/solid-zero-total 呈现两块等大的彩色扇形、显示数值 0 而无百分比（符合「仅数值、不出现 NaN」约定，但「无占比」表达可能误读）；本轮未判为契约违例。
  - 首次柱状图失败不是产品点击故障：已有坐标钩子返回类目中心，分组柱状图中心位于两根柱之间；QA 改用 single fixture 再真实点击。
  - 材料完整性复核：`exec node .superpowers/sdd/2026-11-22-component-visual-acceptance/verify-evidence.mjs` exit 0，从 fixture 重算 302 个 ID，核对 302 张原图、4 张首次失败图、23 张联系表、14 张裁图摘要，逐张重新裁切比对，核对包导出、版本、151 对数据、14 次点击/键盘更新及 **54 个本地文档链接**。
  - 独立审查：范围 `b6656819..fe9e898d`，独立只读审查员 `qa_final_review`，结论 **QA/docs 可合并，无 Critical/Important**；非阻断 Minor：`run.mjs` 的异常清理可分别收集浏览器关闭、子进程终止与日志落盘结果。
  - 合并前常规回归：QA 分支 `6b662d13` 执行 `.\scripts\pnpm.ps1 test` exit 0；T10 **161 passed / 7 skipped / 0 failed（168 项）**；Vitest **134 文件通过、2306 passed / 2 skipped / 0 failed（2308 项）**，耗时 520.59 秒；日志 `full-test.log`。
  - 原始架构 SHA-256 保持 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`；本轮纯 QA 工具与文档，不触发产品版本升级；最终交付的 57 个本地文档链接再次核对可达。
  - 证据 JSON `component-visual-acceptance-2026-11-22/summary.json`（302 格最终汇总，机器可读证据）：`scope` = `workspace-example-qa-only`；`baseline` = `b665681997ba842de6ed039652bf4f358771db6a`；`environment` 为 os `win32`、arch `x64`、node `v26.13.0`、browserVersion `158.0.8127.18`、locale `zh-CN`、timezone `Asia/Shanghai`、deviceScaleFactor `1`；`counts` 为 **total 302、defaultMatrix 224、additionalStates 78、functionalPassed 300、horizontalOverflow 104、hostClipped 48、parityErrors 0**；`parityErrors` 为空数组；`results` 302 条；`contactSheets` **23 张**。
  - 联系表明细（path / cases / sha256 前 16 位）：default-390-light-canvas（14，aa9f594fc1aaa34f）、default-390-light-svg（14，ee6a805b272261d8）、default-390-dark-canvas（14，ccdf76fddd76bca3）、default-390-dark-svg（14，e2110901ca573b10）、default-768-light-canvas（14，e111531a98735b5a）、default-768-light-svg（14，b3088ce9c3c28837）、default-768-dark-canvas（14，551f6a2e594d84a8）、default-768-dark-svg（14，6d171a8735ea8f2c）、default-1280-light-canvas（14，6c0924dec3071db2）、default-1280-light-svg（14，ba8e9c1d5dbe4d18）、default-1280-dark-canvas（14，4eee97d029beb917）、default-1280-dark-svg（14，17dbb4a8a181e90d）、default-1440-light-canvas（14，88e5ce4d6a1da9fa）、default-1440-light-svg（14，f62205829354598a）、default-1440-dark-canvas（14，7af8fc5930b2d392）、default-1440-dark-svg（14，19ab8231c1b5f8ff）、states-line（10，ba63480043696f5e）、states-bar（12，1a768453b89eafee）、states-pie（22，444762973374c246）、states-scatter（12，1c7847c91d11a45f）、states-trend-card（12，618f6955a3f140cc）、states-ranking（12，af4bf7ba86a99d14）、states-proportion（12，149c52f613e7b0d0）。
  - summary.json 维度分布：framework vue 151 / react 151；component pie 52、bar 42、proportion 42、ranking 42、scatter 42、trend-card 42、line 40；state default 224、empty 14、missing 14、updated 14、single 12、negative 4、zero-total 4、nested 2、solid 2、solid-empty 2、solid-missing 2、solid-nested 2、solid-zero-total 2、tied 2、down 2；renderer canvas 190 / svg 112；theme light 190 / dark 112；viewport 宽 1280 → 134、1440 → 56、390 → 56、768 → 56。
  - summary.json 溢出/裁切实测分布：横向溢出 104 格（390 宽 56、768 宽 48）；宿主裁切 48 格（全部在 390 宽）。
  - summary.json 中唯一 2 项 `functionalPassed: false`：`react-pie-light-canvas-1280-solid-empty` 与 `vue-pie-light-canvas-1280-solid-empty`，errors 为「示例自检未全部通过」「实际主题或渲染器不匹配」，`single-instance` 失败（实例=1 canvas=0 svg=0）、`renderer-match` 失败（声明 canvas，canvas=0 svg=0）。
  - summary.json 每条 result 含 `id/framework/component/theme/renderer/viewport/state/url/errors/consoleErrors/networkErrors/runtime/layout/screenshot/functionalPassed`；`runtime.versions.stage` 为 `bootstrap`，`echartsVersion` `6.1.0`，`frameworkVersion` 为 `3.5.45`（vue）/`19.3.1`（react）；示例宿主尺寸固定 720×360（x=25，y 随组件 168.4375 / 198.4375）。
  - 证据 JSON `component-visual-acceptance-2026-11-22/initial-failures.json`（首次运行 298/302 的失败记录）：`counts` 为 **total 302、defaultMatrix 224、additionalStates 78、functionalPassed 298、horizontalOverflow 104、hostClipped 48、parityErrors 0**；`environment` 为 win32/x64、node `v26.13.0`、browserVersion `158.0.8127.18`、locale `zh-CN`、timezone `Asia/Shanghai`、deviceScaleFactor 1。
  - initial-failures.json 4 项失败明细：
    - `react-bar-light-canvas-1280-default`（`http://127.0.0.1:5185/bar.html?theme=light&renderer=canvas`）：errors `page.waitForFunction: Timeout 3000ms exceeded.`；四项自检（single-instance 实例=1 canvas=1 svg=0、no-page-error、series-match 期望 `["revenue","cost"]`、renderer-match 声明 canvas，canvas=1 svg=0）均 passed；data 为两组 4 点；paletteFirst `#3b82f6`、textColor `#263044`；截图 `.tools/qa/component-visual-acceptance-initial/react-bar-light-canvas-1280-default.png`，sha256 `360b835135c59afdf7f08e50d44dee06587009c5f5b980afe88d4e5e1eb0a4ff`，29482 bytes。
    - `vue-bar-light-canvas-1280-default`（`http://127.0.0.1:5184/bar.html?...`）：同样 `page.waitForFunction: Timeout 3000ms exceeded.`；四项自检均 passed；截图 sha256 `b73b726844f3066351441ff46b8f438bf149ebf56c79fde335a32c3bce6cde72`，28847 bytes。
    - `react-pie-light-canvas-1280-solid-empty`：errors「示例自检未全部通过」「实际主题或渲染器不匹配」；`single-instance` failed（实例=1 canvas=0 svg=0）、`renderer-match` failed（声明 canvas，canvas=0 svg=0）；data 为空；截图 sha256 `8ae0a612196735fd8db29f31163584e26ca06269b9e661e5ee905aa412d35b40`，1597 bytes。
    - `vue-pie-light-canvas-1280-solid-empty`：同上，截图 sha256 `8ae0a612196735fd8db29f31163584e26ca06269b9e661e5ee905aa412d35b40`，1597 bytes（与 React 侧字节相同）。
  - initial-failures.json 中四项的 `consoleErrors` 与 `networkErrors` 均为空数组；`layout.horizontalOverflow` 均为 false、`hostClipped` 均为 false。
- **结论与状态**：QA 完成但 V01–V03 阻断视觉验收通过；被 `component-visual-acceptance-integration-2026-11-22.md`（合并）与 `docs/acceptance/*`（材料）接续。
- **交叉引用**：`docs/acceptance/first-batch-assets-2026-11-22.md`、`docs/acceptance/platform-test-checklist-2026-11-22.md`、`docs/specs/2026-11-12-sdk-pie-chart-protocol.md`、`tests/browser/component-matrix.spec.ts`、`component-visual-acceptance-2026-11-22/summary.json`、`component-visual-acceptance-2026-11-22/initial-failures.json`。
- **过时或矛盾点**：文中同时出现 54 个（完整性复核口径）与 57 个（最终交付口径）本地文档链接计数，按各自上下文引用；常规回归通过不替代 V01–V03 复验。`functionalPassed` 298（首次）与 300（最终）差异即上述两项柱状图夹具修正，非产品变化。

### component-visual-acceptance-integration-2026-11-22.md

- **日期／角色／主题**：2026-11-22，Windows x64，Asia/Shanghai；Codex；组件验收材料合并与本机复验。
- **目的**：按用户「完成后合并回主分支」的授权，把 QA 与测试准备材料合并到本地 `main` 并复验。
- **承重事实**：
  - 主分支原提交 `f0e8e418bbe76a638003d493bb2eaf4b48fcdf5b`（已包含其他任务的自主管理账号实现）。
  - 本轮验收分支提交：`ced0707c`（工具/证据）、`fe9e898d`（资产/测试表）、`6b662d13`（独立审查）、`172e7d4c`（合并前常规回归）。
  - 合并提交 `3861b86e1093d4f66c1ee5ad2a16902c698f4ebc`，两个父提交为上述主分支与 `172e7d4c`；**46 个文件**，仅新增本轮文档、图像和 `tests/acceptance/chart-visual/` 工具；未修改 SDK、示例、账号实现、API、公共契约、锁文件或根配置。
  - 合并前主工作区出现未跟踪的 `.write-test-docs`，确认不与合并路径重叠，原样保留并核对摘要；没有暂存或删除该文件。
  - 命令结果（Node 26.13.0 / pnpm 12.18.0，日志 `.tools/qa/component-visual-integration/`）：`install --frozen-lockfile` exit 0；`exec turbo run build --force` exit 0，**10/10 successful、0 cached，21.462 秒**；`verify:workspace` exit 0（10 成员、无循环）；两个 QA 脚本 `node --check` 与合并范围 `git diff --check` exit 0；合并后 JSON/PNG/裁切/版本/导出/本地链接核对 exit 0（302 格、23 联系表、14 裁图、151 对数据、57 链接）。
  - `test` 首次 **exit 1**：Vitest 127 文件通过 / 9 文件失败，**2318 passed / 25 failed / 2 skipped（2345 项）**，331.70 秒。
  - 定位复现：`exec vitest run tests/integration/cli-release.test.ts` exit 1，1 项失败；`captureExample` 启动浏览器时报告固定目录没有 Chromium executable，尚未进入发布断言。
  - `exec playwright install chromium` exit 0，补齐主工作区 `.tools/playwright` 中的固定 Chromium/headless shell `158.0.8127.18`；本机临时 `launch-browser.mjs` exit 0，实际启动并关闭浏览器，读回版本 `158.0.8127.18`（前一次 Node `-e` 调用被 PowerShell 参数绑定拒绝，未运行浏览器，不算验证通过）。
  - 补齐浏览器后完整复跑 **exit 0**：T10 **161 passed / 7 skipped**；Vitest **136 文件通过、2343 passed / 2 skipped / 0 failed（2345 项）**，428.59 秒。
  - 首次失败 9 个文件：cli-baseline、cli-bundle、cli-check、cli-release、compatibility-api、packed-consumer-frameworks、packed-consumer，以及 T17 matrix 的 browser/product-executor；完整错误均指向缺少本机截图浏览器。
  - 测试期间 `main` 保持在 `3861b86e`；本轮只完成本地合并，**没有 push**；验收工作区和分支保留供查看原图、运行日志与问题复现；纯 tests/docs 不触发产品升版。
- **结论与状态**：合并完成并复验通过；V01–V03 与外部验收仍开放。
- **交叉引用**：`component-visual-acceptance-2026-11-22.md`、`docs/acceptance/first-batch-assets-2026-11-22.md`、`docs/acceptance/platform-test-checklist-2026-11-22.md`。
- **过时或矛盾点**：首次 25 项失败被显式归因为缺本机 Chromium，不代表产品缺陷；未在主工作区重跑 QA runner 覆盖历史图片。

### phase3-t15-planning-2026-11-16.md

- **日期／角色／主题**：2026-11-16（Asia/Shanghai）；C / Codex（规划校验）；三期 T15 四方规划校验。
- **目的**：核对 T15 设计、四方执行计划与入口文档，确认依赖安排可执行，产品实现尚未开始。
- **承重事实**：
  - 读取基线 `b35498ac9bddcfcc63ff4fdd85c7befaf29e6c0f`；开始时 main 干净。
  - 交付范围：[T15 设计](docs/specs/2026-11-16-phase3-t15-design.md)（只读项目识别、安装计划、证据和边界）；[四方执行计划](docs/plans/2026-11-16-phase3-t15-kickoff.md)，分工为 **P0 契约、P1 Claude 桌面端主要开发、P2 Antigravity 独立矩阵、P3 Claude Code 黑盒、P4 Codex 真实集成与收口**，附 T16/T17 接续；README、总体实施评估、T01–T17 计划及分工入口增加本轮指引。
  - 创建本轮规划分支 `chore/phase3-t15-planning`；产品开发分支尚未创建，未向实际开发客户端派发。
  - `git status --porcelain=v1` / `git branch --show-current` / `git rev-parse HEAD`：main 干净，基线如上。
  - `git diff --check`：exit 0。
  - 六份设计/计划/入口文档相对 Markdown 链接目标检查：全部目标存在，exit 0。
  - `.\scripts\pnpm.ps1 verify:workspace`：exit 0；10 成员、无循环依赖、4 公开包、安全服务依赖图通过。
  - 架构文件 `component-platform-architecture.md` SHA-256 = `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与受保护基线一致（全文此后均为此值，小写形态 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723` 亦多次出现）。
  - workspace 检查由脚本先恢复本地缺失的 Node/pnpm，输出版本 Node `26.13.0` / pnpm `12.18.0`，未修改全局工具。
- **结论与状态**：规划审查通过；明确没有产品行为变更，未运行产品单元/浏览器/真实服务验收，不据此标记 T15 或三期完成。被后续 `c-t15-contracts-2026-11-17.md`（P0 落地）与 `t15-completion-2026-11-17.md`（终态）更新。
- **交叉引用**：`docs/specs/2026-11-16-phase3-t15-design.md`、`docs/plans/2026-11-16-phase3-t15-kickoff.md`。
- **过时或矛盾点**：基线 `b35498ac…` 是 T15 产品工作起点之前的规划基线；后续所有产品分支基线改用 `31ae120a270e84ab7c100d3ad77919b233d1d48b`。

### t15-completion-2026-11-17.md

- **日期／角色／主题**：2026-11-17（Asia/Shanghai）；C / Codex；T15 最终验收与本地主分支收口。
- **目的**：记录最终候选、门禁、本地 main 快进与工作树/分支清理。
- **承重事实**：
  - 当前状态：**T15 技术验收与本地 main 收口完成**；最终冻结 CLI、集成树及 main 复验通过；四个工作分支和工作树均已安全删除。
  - 交付 `component integrate inspect/plan`：只读识别 Vue 3 / React 19、npm v3 / pnpm v9 锁和显式 workspace，复查发布身份、精确依赖、摘要、权威 API、权限及兼容缺口，形成 `executionAuthorized: false` 的可审查计划。
  - 用户已明确授权验证后合入本地 main 并删除工作分支，**未授权 push 或生产发布**。
  - 五项审查残余表（同包不同组件重复 registry 证据、matched/unverified 远端 gap 文案含令牌、本地已锁运行时依赖与 GET 版本不符、Windows dangling junction、MatchPlan 省略可选 ECharts 版本）全部 RED→GREEN；第五项核对：`ProjectContext` 允许省略 ECharts，但 `IntegrationPlan` 附加规则要求与已锁宿主不一致时含 `MATCH_CONTEXT_MISMATCH`。
  - 宿主 C 在 B 工作树三组 P1 RED：21:21:42 开始 **5 failed / 142 passed（147 项）、0 skipped、exit 1，38.51s**；21:40:40 两跳窄复核 **1 failed / 147 passed（148 项）、exit 1，36.69s**；最终 GREEN 21:46:58 **148/148 passed、0 failed、0 skipped、exit 0，37.01s**。
  - 冻结输入（SHA-256）：原架构 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`；SDK manifest `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`；core `0.0.11` `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb`；Vue `0.0.12` `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9`；React `0.0.12` `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28`；已安装 CLI 兼容采纳证据 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`。SDK 未重新 pack。
  - CLI 修复提交 `88b13803b3024bc4c57dd7f5fa737208a1f16c29`，由 `5347683d` 合入 C；独立版本提交 `e23ef890f12282c60916d31f42d84341108d4014` 升至 **0.0.13**；22:01:21 执行一次 pack 后冻结：`company-component-cli-0.0.13.tgz` **294872 bytes**，SHA-256 `d071f7c17f62db75f36b8ed8c0cb44bab0ed8ff1eccda83abbe029cc31a0a7b6`；独立保存位置 `D:\project\zhinexus-design-asset-platform\.tools\operations\t15-final-2026-11-17\t15-cli-0.0.13\`；仓外真实安装目录 `C:\Users\10208\AppData\Local\Temp\zhinexus-t15-installed-DQQge4`。
  - 最终门禁表（命令前缀 `.\scripts\pnpm.ps1`，固定 Node 26.13.0 / pnpm 12.18.0）：
    - P1 五文件（project-inspect / project-plan / project-plan-network / project-plan-consumer / project-plan-readonly）：**183/183，0 skipped，exit 0，63.74s**；日志 `integrated-final.log` / `integrated-final-results.json`。
    - `install --frozen-lockfile`：exit 0，0.19s，锁文件未变。
    - `exec turbo run build typecheck --force`：**20/20 tasks，0 cached，exit 0**，14.63s。
    - 根 `tsc -p tsconfig.json --noEmit`：exit 0，0.59s。
    - `verify:workspace`：10 成员、无环、公开包与服务闭包检查通过，exit 0，0.81s。
    - `test`：**T10 168/168、Vitest 83 文件 1494/1494，0 skipped，exit 0**；总 337.27s（Vitest 306.20s）。
    - 平台专项（tests/platform 四个文件）：**41/41，0 skipped，exit 0**，61.57s（测试 57.45s）。
    - 浏览器专项（contracts-runtime + phase2-component-query）：**18/18，0 skipped，exit 0**，12.30s（测试 11.5s）；启动前确认 5173–5176 无监听。
    - P4（`--config tests/acceptance/phase3-plan.config.ts`）：**25/25，0 skipped，exit 0**，32.78s（测试 29.57s）。
  - 五项 Review Focus 对应 P1 路径/锁/网络回归、D 黑盒 Git filter 与全树控制、P4 真实服务/安装结果；没有遗留审查阻断或延期 Minor；特殊 8.3 短名、所有文件系统并发竞争与超过 64 跳链接不由本轮用例全面证明。
  - 本地 `main` 从 `31ae120a270e84ab7c100d3ad77919b233d1d48b` **快进至 `49968d96a0a0f051527c3a903cf6c132aeae9fa1`**；Git 树 `1c1581b36ae7150ef5b4e1e286e0b3f2a3b12b04`，与已验收 C 集成树逐字节一致；首次树查询 PowerShell 未引用 `^{tree}` 被解释为脚本块，补单引号后重新查询一致。
  - 主工作区复跑：`install --frozen-lockfile`、`exec turbo run build typecheck --force`（**20/20，0 cached，14.486s**）、根 tsc、`verify:workspace`、P4（22:17:06 开始 **25/25、0 failed、0 skipped、exit 0，43.92s**）全部 exit 0；结束后 CLI SHA 仍为 `d071f7c1…31a0a7b6`；结果在 `.tools/operations/t15-final-2026-11-17/`（`main-merge.json` / `main-gates.json`）。
  - 关键提交表：`31ae120a`（P0 契约，已先行合 main）、`7c274ad166bf8693dd6c38359b24822cd3fe65e0`（A 独立矩阵最终来源）、`99bf0f46` / `c5ca0e49`（B 只读识别与计划产品交付）、`a946cdea2ff5b3a1f3d9f05f43ab696f111b1871`（D 独立黑盒最终来源，35 项断言）、`88b13803b3024bc4c57dd7f5fa737208a1f16c29`（B 最终五项审查修复及六条回归）、`5347683d`（C 合入 B 最终修复，集成 183/183）、`e23ef890f12282c60916d31f42d84341108d4014`（CLI 0.0.13 独立升版与 CHANGELOG）、`49968d96a0a0f051527c3a903cf6c132aeae9fa1`（最终 main 快进目标）。各来源 tip 删除前均以 `git merge-base --is-ancestor <tip> HEAD` 确认 exit 0。
  - 删除前忽略证据复制并逐文件 SHA-256 核对：A **2 文件**、B **131 文件 / 2225752 bytes**、C **179 文件 / 4516559 bytes**、D **37 文件**；0.0.12 历史候选、0.0.13 最终候选与 frozen manifest 分别保留，哈希清单 `*-hashes.json`。
  - 所有工作树各 **1054** 个 reparse point 均只指向本工作树；A 首次 `git worktree remove` 报 `Invalid argument`，原生 PowerShell 删除报 `node.exe` 被占用，核对进程链确认为 A 先前 `pnpm exec node -v` 留下的交互式 Node 与 pnpm（PID 44240 / 7088），只结束这两个任务进程，未停止 Antigravity 应用；再以 `Remove-Item -LiteralPath ... -Recurse` 清理；B/C/D 用 `git -c core.longpaths=true worktree remove` 成功；未用 `--force`、`branch -D`、reset 或跨 shell 递归删除。
  - 四个来源分支均通过 **`git branch -d`** 删除：`chore/t15-a-project-matrix`、`feat/t15-b-integration-plan`、`chore/t15-c-integration`、`chore/t15-d-plan-acceptance`。
  - 七条执行裁定：P0–P4 计划与编号辅助脚本不兼容改用等价 PowerShell ledger；P0 冻结 workspace glob 边界而实际识别放 P1/P2；IntegrationPlan 保留 sourceMatchPlan；P0 只验证结构化声明；B 实现前的 RED 准备不算产品完成；保持已冻结 CLI 参数、去掉额外 timeout CLI 参数；执行错误采用本地 JSON envelope。
  - T16 开工交接：保留 A 的 14 案例与双框架差异表、D 的 35 个独立黑盒、原 `sourceMatchPlan` / 调用方 digest 与 T15 的 `executionAuthorized:false`；C 先定义 ApplyResult、备份和基于 afterHash 的恢复契约。
- **结论与状态**：T15 技术验收与本地 main 收口完成（0.0.13）；未 push、未 tag、未生产发布；T16/T17、生产 G2、真实业务试点继续保持未完成。是 `docs/phases/phase3/integration-plan.md` 状态行的直接依据。
- **交叉引用**：`c-t15-contracts-2026-11-17.md`、`c-t15-inspect-review-2026-11-17.md`、`c-t15-plan-review-2026-11-17.md`、`c-t15-plan-integration-2026-11-17.md`、`b-t15-integration-plan-2026-11-17.md`、`a-t15-project-matrix*.md`、`docs/phases/phase3/integration-plan.md`。
- **过时或矛盾点**：0.0.12 相关 25/25、1488/1488、T10 168/168 在本篇被明确降级为历史候选证据。

### a-t15-project-importer-review-2026-11-17.md

- **日期／角色／主题**：2026-11-17；A / Antigravity；T15 P2 `conflict-missing-importer` 夹具复核记录。
- **目的**：修正矩阵夹具缺陷，使 `IMPORTER_MISSING` 预期可被真实检查器到达。
- **承重事实**：
  - 分支 `chore/t15-a-project-matrix`；基线 `5a50856781e59489eb27234b88a11d28055a44bc`。
  - 缺陷：`conflict-missing-importer` 指定 `workspace: 'apps/missing-pkg'` 与 `expectedConflictCodes: ['IMPORTER_MISSING']`，但 `createProjectCase` 原 `subPackages` 仅创建 `apps/chart-react`，未创建 `apps/missing-pkg/package.json`，真实检查器先触发 `WORKSPACE_INVALID`。
  - 修复位置 `tests/fixtures/phase3-projects/cases.ts`：为该案例 `subPackages` 补充真实存在的 `apps/missing-pkg/package.json`；保留 `apps/chart-react` 与 `pnpm-workspace-explicit/pnpm-lock.yaml` 原字节不变，保留 `IMPORTER_MISSING` 预期，不导入 B 计算预期。
  - 行为 RED：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts` → exit 1，`1 failed | 6 passed (7)`；失败项「conflict-missing-importer 必须真实存在目标 workspace/package.json 且 pnpm 锁正文不含该 importer」；`AssertionError: expected false to be true`。
  - GREEN：同命令 exit 0，`Test Files 1 passed (1)`、`Tests 7 passed (7)`。
  - 窄范围类型检查 exit 0（三文件）；`git diff --check` exit 0。
  - 边界说明：未修改真实锁快照原字节、CLI、contracts、根配置或历史验证记录。
- **结论与状态**：完成（7/7）。矩阵最终来源提交在 `t15-completion-2026-11-17.md` 中记为 `7c274ad166bf8693dd6c38359b24822cd3fe65e0`（补齐真实子包 fixture）。
- **交叉引用**：`c-t15-inspect-review-2026-11-17.md`（独立矩阵初次消费观察指出同一缺陷）、`c-t15-plan-integration-2026-11-17.md`、`docs/phases/phase3/project-support-matrix.md`。
- **过时或矛盾点**：本篇基线 `5a50856781…` 与 `c-t15-plan-integration-2026-11-17.md` 所述「A 对缺 ECharts 预期补行为 RED→GREEN，提交 `5a508567`」数字相同但指代不同事件，引用时须按各自上下文区分。

### a-t15-project-matrix-2026-11-17.md

- **日期／角色／主题**：2026-11-17；A / Antigravity；T15 P2 独立项目矩阵与双框架预期验证记录。
- **目的**：独立产出 14 个合成项目工程预期与真实工具锁快照，供 B（P1）、D（P3）、C（P4）复用。
- **承重事实**：
  - 工作树 `C:\Users\10208\.codex\worktrees\t15-a-project-matrix\zhinexus-design-asset-platform`；分支 `chore/t15-a-project-matrix`；P0 基线 `31ae120a270e84ab7c100d3ad77919b233d1d48b`。
  - Node：`.tools/node-v26.13.0-win-x64/node.exe`（`v26.13.0`）；npm：同目录 `node_modules/npm/bin/npm-cli.js`（`11.20.0`），隔离临时目录 `install --package-lock-only --ignore-scripts`，生成 5 份 `npm-v3` `package-lock.json` 快照。
  - pnpm：`scripts/pnpm.ps1`（`12.18.0`），隔离临时目录 `install --lockfile-only --ignore-scripts`，生成 5 份 `pnpm-v9` `pnpm-lock.yaml` 快照。
  - 产物路径 `tests/fixtures/phase3-projects/lock-snapshots/`，共 **10 个快照目录**，不纳入 pnpm workspace 成员。
  - RED：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts` → exit 1，`Test Files 1 failed (1)`，`Error: Cannot find module '../fixtures/phase3-projects/cases.js'`（后被 `a-t15-project-matrix-review-2026-11-17.md` 澄清为**测试收集失败，非行为 RED**）。
  - 中间发现：pnpm `12.18.0` 在 `package.json` 含 `packageManager` 字段时生成**多文档** `pnpm-lock.yaml`（`---` 分隔 `packageManagerDependencies` 与 `importers`），改用 `yaml` 的 `parseAllDocuments` 读取。
  - GREEN：同命令 exit 0，`✓ tests/evaluation/phase3-project-matrix.test.ts (5 tests) 349ms`、`Test Files 1 passed (1)` / `Tests 5 passed (5)`。
  - 窄范围类型检查：`.\scripts\pnpm.ps1 --% exec tsc --noEmit --ignoreConfig --target es2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck --types node tests/fixtures/phase3-projects/expected.ts tests/fixtures/phase3-projects/cases.ts tests/evaluation/phase3-project-matrix.test.ts` → exit 0。
- **结论与状态**：P2 完成（5/5），随后被同角色两篇复核扩展为 6/6、7/7（见 `a-t15-project-matrix-review-2026-11-17.md`、`a-t15-project-importer-review-2026-11-17.md`）；矩阵文档本体 `docs/phases/phase3/project-support-matrix.md` 仍在用。
- **交叉引用**：`docs/phases/phase3/project-support-matrix.md`、`a-t15-project-matrix-review-2026-11-17.md`、`a-t15-project-importer-review-2026-11-17.md`、`c-t15-contracts-2026-11-17.md`。
- **过时或矛盾点**：第 2 节初次 RED（缺模块、0 test）不是行为 RED，本篇原文未改写，由后续复核篇显式澄清。

### a-t15-project-matrix-review-2026-11-17.md

- **日期／角色／主题**：2026-11-17；A / Antigravity；T15 P2 补充复核验证记录。
- **目的**：澄清历史 RED 性质，并按批准 spec「首轮支持与行为」第 5 条修正缺 ECharts 案例的预期。
- **承重事实**：
  - 工作树同 `C:/Users/10208/.codex/worktrees/t15-a-project-matrix/zhinexus-design-asset-platform`；分支 `chore/t15-a-project-matrix`；基线 `c3c90e3dbd2bf8516ad427c98efb616e692b8233`。
  - 历史记录 `a-t15-project-matrix-2026-11-17.md` 保持原样不改写；该篇第 2 节初次 RED 属缺模块的测试收集失败。
  - 依据 `docs/specs/2026-11-16-phase3-t15-design.md`（「首轮支持与行为」第 5 条）与 `docs/verification/phase3-t15.md`（P0 `LocalProjectInspectionV1`）：宿主缺少 `echarts` 时，本地 `inspect` 应保持 `status: 'inspected'`，`resolvedDependencies` 仅含 `vue@3.5.45`、不伪造 `echarts`，不应仅因缺 `echarts` 标记 `ECHARTS_MISSING` / `conflicted`；`plan` 阶段由 MatchPlan 明确候选版本重新查询。
  - 保留 `conflict-missing-echarts` 作为兼容 `caseId` 与 `lockSnapshotDir` 名称（引用与真实工具锁快照字节不变）。
  - 行为 RED：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts` → exit 1，`1 failed | 5 passed (6)`；失败项「缺 ECharts 案例按 spec 第 5 条与 P0 契约保持 inspected 且不伪造 echarts 依赖」；`AssertionError: expected 'conflicted' to be 'inspected'`。
  - GREEN：同命令 exit 0，`Test Files 1 passed (1)` / `Tests 6 passed (6)`。
  - 窄范围类型检查 exit 0（三文件同上）；`git diff --check` exit 0；`tests/fixtures/phase3-projects/lock-snapshots/**` 原字节、CLI/contracts/根配置及历史验证记录均未改动，未重新 pack SDK。
- **结论与状态**：完成（6/6），被 `a-t15-project-importer-review-2026-11-17.md` 推进到 7/7，最终由 `c-t15-plan-integration-2026-11-17.md` 以 `67ffc2ab` 合入 C 并复跑 6/6。
- **交叉引用**：`a-t15-project-matrix-2026-11-17.md`、`docs/specs/2026-11-16-phase3-t15-design.md`、`c-t15-contracts-2026-11-17.md`、`c-t15-plan-integration-2026-11-17.md`。
- **过时或矛盾点**：`conflict-missing-echarts` 的 `caseId` 名称带 "conflict" 前缀但预期为 `inspected`，属历史命名保留，非预期回退。

### b-t15-integration-plan-2026-11-17.md

- **日期／角色／主题**：2026-11-17（Asia/Shanghai）；B / Claude 桌面端（产品实现），宿主 C 在 Windows 代跑验证；T15 P1 本地项目识别与只读接入计划（含 23 节追加）。
- **目的**：实现并验证 `component integrate inspect/plan`，逐轮以独立审查反例驱动 RED→GREEN。
- **承重事实**：
  - 工作树 `C:\Users\10208\.codex\worktrees\t15-b-integration-plan\zhinexus-design-asset-platform`；分支 `feat/t15-b-integration-plan`；基线 `31ae120a270e84ab7c100d3ad77919b233d1d48b`。
  - 固定工具链 Node `26.13.0` / pnpm `12.18.0`，命令经 `.\scripts\pnpm.ps1`；宿主日志在 `.superpowers/t15/`（gitignore）。
  - B 在 Linux 沙箱用 npm 取得的 `typescript@7.0.2`（linux-x64 原生包）与 `vitest@5.1.0` 做语法/类型/可执行性预检，**不代表固定工具链结果**。
  - 新增产品文件 `packages/component-cli/src/integration/{workspace,locks,inspect}.ts`；CLI build 的 package-probe 复核 **73 个文件**（缺失 0、污染 0、链接 0、被改动 0）。
  - **第一节**：inspect RED 先出现 1 个套件收集失败（`inspect.js` 不存在，不计行为 RED），补最小占位后 **20 failed (20)** 为行为 RED；GREEN **20 passed (20)**、CLI build/typecheck exit 0。
  - **第二节**：独立审查首轮反例，宿主运行 **7 failed | 21 passed | 1 skipped (29)**；跳过项为 `pnpm-workspace.yaml` 文件符号链接用例（Windows 无文件链接权限），登记未覆盖。
  - **第三~四节**：追加 IO spy、Git filter marker ×2、真实锁快照 ×4、项目依赖文档歧义守卫 ×2、Git 子项目拆分为 41 项；宿主正式 RED **14 failed | 27 passed | 0 skipped**；修复 8 项（pnpm 多文档按 config-only 排除、npm importer 不借用提升版本、外链读取前阻断、声明失效关闭、外来锁 `LOCKFILE_MULTIPLE`/`LOCKFILE_UNSUPPORTED`、非法范围 `VERSION_UNRESOLVED`、Git filter 屏蔽、子项目路径折算）。
  - **第五节**：48 项 RED **6 failed | 42 passed (48)**；修复为 `git config -z --get-regexp '^filter\..+\.(clean|process|smudge)$'` 枚举 + `--porcelain -z` 结构化解析（`parsePorcelainZStatus`），driver 名放行 `^[A-Za-z0-9_][A-Za-z0-9._-]*$`；截断用例收紧为精确 `{status:'unavailable', dirtyPaths:[]}`。
  - **第六~七节**：62 项 RED **12 failed | 50 passed** → 修复后 **63/63 passed**；新增 `inferPackageManager`、成员资格未确认即停止解析、坏字段/缺字段区分、pnpm 锁正文版本仅接受标量 `'9.0'`、锁条目不完整失效关闭、npm 近层 link 不借提升版本、manifest 坏类型 `WORKSPACE_INVALID`。
  - **第八~十节**：filter 语义 65 项 **2 failed | 63 passed**；npm 近层残余 68 项 **4 failed | 64 passed**；修复后 **77/77 passed**（新增 `readGitFilterAssociatedPaths`：`ls-files -z` + `check-attr -z filter --stdin`）。
  - **第十一~十二节**：关联枚举 86 项 **6 failed | 80 passed**；Git 子模块 89 项 **8 behavior failed / 81 passed**（另 2 项 setup 因 Windows `core.autocrlf=true` CRLF/LF size 缓存不等导致 fixture 控制失败，**不记为行为 RED**，经 C 修正三处 fixture `core.autocrlf=false` 后复跑确认）。
  - **第十三节**：partial clone lazy-fetch + 共享 argv 92 项 RED **11 failed / 81 passed / 0 skipped**（12:40，30.29s）；GREEN 实现：`GIT_BASE_ARGV` 追加 `--no-lazy-fetch` 与 `-c status.submoduleSummary=false`、status 追加 `--ignore-submodules=all`、新增 `readGitGitlinkState`（`ls-files --stage -z` 逐条校验三段/mode/stage/路径，发现 160000 → unavailable）、`readGitTrackedPaths` 调用 check-attr 前逐条词法校验、名称歧义失效关闭；实现 SHA-256 `B25DEEC2E80A985181C77131F22660B05F2D3687D44BBC382A5F283C5327D33A`。
  - **第十四节**：gitlink 触发可靠性回归 93 项 **1 failed / 92 passed**（12:58，29.35s）；GREEN 移除 `suspicious` 前置，所有项目固定执行一次只读 `ls-files --stage -z`，删除 `GIT_MODULES_FILE` 常量；仅调整一处非行为 argv 计数断言。
  - **第十五节**：inspection 正式收口 **93/93 passed、0 skipped、exit 0（13:06:49，30.50s）**；CLI build/typecheck、根 tsc 均 exit 0；C 代 B 聚焦提交 `99bf0f46`（`feat: 实现本地项目与锁文件只读识别`）。
  - 最终实现 SHA-256：`inspect.ts` `8502273D5451221016AB31AA289D066D91029A022D2E23C0A46B5CED6A229FCB`、`locks.ts` `8C9B8BA31E833E5CE63444F402E4E95CA0E526743899076BD701D9C5438EAF46`、`workspace.ts` `5445B08FB6283F54BE1468D4067D3DF714CF599865F9CE519A739CA094B08576`；测试 `AAE56CE74A74599D86AF2138FCE15591DDF9FA50A5928337FD49587479C76C27`（93 项）。
  - **plan 阶段 RED**：新增 `tests/integration/project-plan.test.ts`（16 项）与 `project-plan-network.test.ts`（13 项）共 29 项；`resolve/registry/plan.ts` 与 `commands/integrate.ts` 仅固定签名 throwing stub；宿主 **29/29 行为失败、0 skip、exit 1（13:25:52，1.45s）**，根 tsc exit 0；夹具补齐后 **31/31 失败（13:44:42，859ms）**、两处残余修正后 **31/31 失败（13:56:02，817ms）**。
  - plan 测试 SHA 演变：`CA361AC86ED82ED57B905404C69C722DCC2D0D8C7B72F1E8A496CD8BFF2A367C` → `DEEAA4A1BC7C3E5E3A3A0DFAD10CA6B568AD091F03F0697422A0F6726544FE8C` → `C8DFC9100B158A16EE3472CF28913F577BD405BB23C54109531F3FAF5F0F7A85`（16 项）；network：`33764E33DCD4A8785458455212514EE1DCA075DBAC2954D6EE762083148FE967` → `FBF64E3E6886A989C506A4362711A83A2DFA9241F2896E5F756DBB71ADD2BF89` → `E1AC8A98896E536D271FBB36A7236014C1A4C18EB741B70858BDFD12D496DFF9`（15 项）。
  - 稳定执行错误契约 `IntegrationPlanError` + `INTEGRATION_PLAN_ERROR_CODES`（`NOT_IMPLEMENTED`/`INVALID_ENDPOINT`/`REQUEST_TIMEOUT`/`DOWNLOAD_LIMIT_EXCEEDED`/`REDIRECT_REJECTED`/`REGISTRY_UNAVAILABLE`）。
  - **第十八节 plan GREEN**：实现 `resolve.ts`/`registry.ts`/`plan.ts`、`commands/integrate.ts`，接线 `cli.ts`/`index.ts`；沙箱 31/31；期间唯一测试侧改动：network「API 返回 gap」用例补推一条相同 gap 响应（断言一字未改），测试 SHA 由 `E1AC8A98896E…96DFF9` 变为 `5E989FCAC925…3CE24`。
  - **第十九节**：宿主候选 **124/124 passed、0 skipped、exit 0（14:30:28，35.28s）**；独立候选审查一次收束 **7 项 Important**（junction/链接读取逃逸、新增依赖下载后缺最终复读、原先不存在的识别关键路径未守卫、新依赖缺 integrity 冒用验证声明、真实组件 bytes 损坏错误分类、执行错误 stdout 缺 JSON、诊断与远端冲突回显令牌）；裁定删除 CLI 额外 `--timeout`、保留库 `PlanOptions.requestTimeoutMs`；新增 18 项回归（沙箱 18 failed | 124 passed (142)）。
  - **第二十节**：宿主正式 RED **15 failed / 127 passed / 142 total / 0 skipped、exit 1（15:50:18–15:50:53，32.91s）**；inspection 93/93、plan 17 passed/3 failed、network 17 passed/12 failed；测试 SHA plan `C6887A7F6CB62F152EB29F3125F856185BA947AEA6F8860445AAEA32B154C798`、network `EF51E0C924A82177A79C3C15E8A0F52297E2F03E0691302516ED309454CF1736`；七项修复落点 `resolve.ts` `BA12B90B5C9BB780FA1DDAC4776CC7A5904AB54AE8EDBE15D13E209C23DA3155`、`registry.ts` `E43D40390DE185B99D2D674E17510FBFD4777DB5C271F244433296AEB262E245`、`plan.ts` `DB12F715085576B87C973C7C54F9A0696005B4BE1D93B2E4C0030A9E4A2057A9`、`commands/integrate.ts` `882123BF72D31FAE59AB4054E0327533BC68A8DB4EC8178BDC4152FCEF984EB0`。
  - **第二十一节（D35）**：宿主 P1 **142/142 passed、0 skipped、exit 0（31.01s）**，已代 B 提交 `c5ca0e4962a3b803b8653e75c2b243c1de279ef9`；C 集成树跑 D 原始 35 项黑盒 **34 passed / 1 failed / 0 skipped**；唯一失败为已存在目标组件同时属 Git dirty path 时 `OUTPUT_EXISTS` 缺同路径 `DIRTY_TARGET` 被契约拒绝；最小修复只改 `plan.ts`（SHA `098518193D3CEC1AF0E78850E8BF7243D363567ED0C339CFD14EA770911B3CDD`）；宿主 16:30:57–16:31:31 复跑 **142/142**。
  - **第二十二节**：最终整分支审查五项；第一轮 RED **5 failed / 142 passed（147 项，21:21:42，38.51s）**；第二轮（补两跳 dangling）**1 failed / 147 passed（148 项，21:40:40，36.69s）**；五项修复（同包两 variant registry 证据去重、matched gap 凭据脱敏 `sanitizePublicationResponse`、`DEPENDENCY_CONFLICT`、dangling 链接多跳失败关闭 `RealPathResolution`、`MATCH_CONTEXT_MISMATCH` + `matchQuery` 的 `lockedEcharts`）；新增 6 回归（plan 20→22、network 29→33、合计 142→148）；`resolve.ts` `810FA7AFDFFB7866EFCB713EC958B0B197BCE35C7DE23C356C2E2DCCFE9BFFA4`、`plan.ts` `2CB671EFC6A78D3003B267DD4885F6A857C9BD7304D220A1823065FE63B61C20`、plan 测试 `6B89371FE08B2CD7523D41A5753F37BA7F5D0BC1CCF1DAA6C45BE78198D3200F`（22 项）、network 测试 `385D60126FA6EFD831147B257F1F288BA5D0542BA4513EB29DDBAAB0534E1B65`（33 项）。
  - **第二十三节**：宿主最终 GREEN **148/148 passed、0 failed、0 skipped、exit 0（21:46:58–21:47:35，37.01s）**；根 TypeScript、CLI build、CLI typecheck 均 exit 0。
  - 未覆盖边界：Windows junction/大小写不敏感/8.3 短名只在宿主实测；`realPathOf` 64 跳上限为工程折中；`publicationEvidence` 的 target/api 自由文本 `notes` 未脱敏；CLI 失败 envelope 早期只有沙箱冒烟。
- **结论与状态**：完成（最终 148/148 + 93/93），产品字节冻结于 `final-five-green-ready`，由 C 代提交、集成、升版并合入 main。被 `c-t15-plan-review-2026-11-17.md`、`c-t15-plan-integration-2026-11-17.md`、`c-t15-inspect-review-2026-11-17.md`、`t15-completion-2026-11-17.md` 从宿主侧交叉记录。
- **交叉引用**：`c-t15-contracts-2026-11-17.md`、`c-t15-inspect-review-2026-11-17.md`、`c-t15-plan-review-2026-11-17.md`、`c-t15-plan-integration-2026-11-17.md`、`t15-completion-2026-11-17.md`、`docs/phases/phase3/integration-plan.md`。
- **过时或矛盾点**：早期「41 项 14 failed | 27 passed」「89 项 8 failed」等为过程口径；`commands/integrate.ts` 早期表内 `03A9C78C…54F3D` 为中间态已更正；沙箱 Git 2.34.1 不支持 `--no-lazy-fetch` 导致的 3 项失败属环境限制。

### c-t15-browser-contract-runtime-2026-11-17.md

- **日期／角色／主题**：2026-11-17（Asia/Shanghai）；C / Codex；T15 契约浏览器入口适配验证。
- **目的**：修复 P0 新增 `integration-plan` 导出导致既有契约浏览器用例动态导入失败的问题。
- **承重事实**：
  - P0 在 `packages/contracts/src/index.ts` 新增 `integration-plan.js` 导出；`tests/browser/contracts-runtime.spec.ts` 通过 HTTPS route 提供构建的契约模块，固定白名单未包含新模块。
  - `.\scripts\pnpm.ps1 build`：exit 0，10/10 构建任务成功，其中 8 个缓存命中（仅复现准备，不能作为最终强制全图构建证据）。
  - 确认 5173–5176 无占用后运行 `.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts`：**1 项失败、exit 1**；`page.evaluate: TypeError: Failed to fetch dynamically imported module: https://contracts.example.test/index.js`。
  - 日志 `.superpowers/sdd/2026-11-16-phase3-t15-kickoff/browser-contract-import-red-2026-11-17.log`。
  - 最小适配：仅在测试 route 模块白名单增加 `integration-plan`，未改变产品代码、模块导出或原有契约/摘要断言。重跑同一命令：**1 项通过、0 跳过、exit 0，3.3 秒**；真实本机 Chromium 完成冻结 fixture 校验与 Web Crypto digest 验证。
  - 随后 `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` 与 `git diff --check`：均 exit 0。
  - GREEN / 类型 / 构建准备日志分别为 `browser-contract-import-green-2026-11-17.log`、`browser-contract-root-tsc-2026-11-17.log`、`browser-contract-build-2026-11-17.log`，均位于上述忽略目录。
  - 固定 Node `26.13.0`、pnpm `12.18.0`；没有 pack、版本升级、SDK 重打包或 push。
- **结论与状态**：本模块 GREEN；不代表 T15 P4 强制全图 build/typecheck、两个浏览器专项、独立黑盒与同一冻结 CLI 真实服务验收已完成。被 `t15-completion-2026-11-17.md` 的浏览器 18/18 门禁覆盖。
- **交叉引用**：`c-t15-contracts-2026-11-17.md`、`t15-completion-2026-11-17.md`。
- **过时或矛盾点**：无。

### c-t15-contracts-2026-11-17.md

- **日期／角色／主题**：2026-11-17；C / Codex；T15 P0 公共契约冻结记录。
- **目的**：冻结 `LocalProjectInspectionV1` / `IntegrationPlanV1` 契约与下游约定，只证明 P0。
- **承重事实**：
  - 执行：Codex，独立工作树 `t15-c-contracts`，分支 `feat/t15-c-contracts`，基线 `0b73f13a`。
  - `packages/contracts/src/integration-plan.ts` 导出 `LocalProjectInspectionV1`、`IntegrationPlanV1`、`IntegrationConflict`、文件快照/依赖/命令/改动类型，以及两个 `unknown → ValidationResult<T>` 校验器；冲突 code 完整清单见导出的 `INTEGRATION_CONFLICT_CODES`；本轮所有冲突 `blocking: true`；planned 与 conflicted 严格对应有无冲突。
  - CLI 镜像由既有 sync 脚本生成，不增加私有运行时依赖。
  - inspection 的 `workspace='.'` 表示根项目；缺少 ECharts 可保留为未解析；P1 必须用 MatchPlan 明确版本重新查询资格，不自行补最新版本。
  - plan 保留 `sourceMatchPlan`；`matchPlanDigest` 为其 `canonicalJson` UTF-8 原始字节 SHA-256，由 P1 计算；契约校验只检查摘要格式。
  - 路径统一项目根相对路径与 `/` 分隔，允许中文与内部空格；Windows 路径别名、穿越、设备名、ADS、末尾点/空格不合法；逻辑去重包含大小写/NFC；realpath、junction/symlink/8.3 逃逸仍须 P1/P3 实测。
  - `fileSnapshots` 现有文件必须携带 SHA，缺失文件禁止携带 SHA；`baseFileHashes` 必须完整保留 inspection 快照；pnpm workspace 还必须快照根 `pnpm-workspace.yaml`；npm workspace 声明包含在根 package.json 内。
  - 支持锁：根 `package-lock.json`（npm-v3）或 `pnpm-lock.yaml`（pnpm-v9）。
  - P0 在 `tests/fixtures/integration-plan.ts#workspacePatternCases` 冻结 glob 边界：支持普通相对目录、独立路径段 `*`/`**`；不支持否定、brace、extglob、部分段通配、问号、反斜杠、穿越和尾斜杠。
  - command 仅预览根目录 `{executable: npm|pnpm, args:['install','--ignore-scripts'], cwd:'.', purpose:'install'}`，以及目标包已有 `build`/`typecheck` 的 `run` 命令；脚本不得实际运行。
  - `publicationEvidence` 保存全部唯一 target 最后 GET 的 response 与 UTC `checkedAt`；`registryEvidence` 保存 name/version/sha256/integrity/verification；平台目标摘要采用 `platform-sha256`，无平台摘要的 runtime/core 只采用 `registry-integrity`。
  - 依赖固定：CLI 运行时 `semver@7.8.6`、`yaml@2.9.1`；`@types/semver@7.8.0` 仅开发依赖；固定 Node `26.13.0`；禁用 `semver.coerce` 与宽松版本猜测。
  - TDD 计数：既有 project-context/match-plan 基线 `37/37`；新契约 RED `38/38` → GREEN；权威 props/events、宿主上下文、生成意图与 registry 关系 `6/46` 失败 → `46/46`；独立审查发现遗漏依赖写入意图及陈旧 target 材料 `4/50` RED → 补后 GREEN；直接 ESM 导入揭示 `integration-plan → digests → schemas` 初始化循环 `1/51` RED（将既有 `canonicalJson` 原样移至 schema 叶模块后 GREEN）；根锁路径及 pnpm workspace 声明快照 `2/53` RED → `53/53` GREEN。
  - `scripts/pnpm.ps1 --filter @company/contracts schemas:generate`：exit 0，两份新 JSON Schema 生成。
  - `scripts/pnpm.ps1 --filter @company/component-cli build`：exit 0，内联契约及 probe 完整性检查通过。
  - 四份契约测试（integration-plan / project-context / match-plan / api-schema）：审查前 `111/111`、首轮修正后 `115/115`；最终 5 文件窄测试（含既有 digest/reports 回归）`139/139`。
  - `scripts/pnpm.ps1 exec turbo run build typecheck --force`：最终 `20/20`，0 cached。
  - 根 `tsc -p tsconfig.json --noEmit`、`verify:workspace`、`install --frozen-lockfile`、`git diff --check`：均 exit 0。
  - 首次根 `test`：Node `168/168`，Vitest `1286 passed / 9 failed`；7 个文件涉及 CLI check/bundle/release/baseline、compatibility-api 和 packed consumer 浏览器验证，原因为新工作树没有 Chromium headless 可执行文件；补齐 Chromium 后复跑 exit 0，Node `168/168`，Vitest **76 文件、1302/1302、0 跳过**；保留既有 Node `DEP0190` 警告。
  - 原架构 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，未变。
  - 复用既有 SDK bundle manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`，根测试显式设置已核对的 `A10_FROZEN_BUNDLE`；未重打已接受 SDK。
  - 日志位于任务隔离工作树 `.superpowers/sdd/2026-11-16-phase3-t15-kickoff/`。
- **结论与状态**：P0 达到合入 main 门槛；P1–P4 尚未完成；CLI 升版与 CHANGELOG 在 P4 候选冻结前统一提交，P0 不独立发布。被 `c-t15-browser-contract-runtime-2026-11-17.md`、`b-t15-integration-plan-2026-11-17.md`、`t15-completion-2026-11-17.md` 接续。
- **交叉引用**：`docs/phases/phase3/project-support-matrix.md`、`a-t15-project-matrix-review-2026-11-17.md`、`c-t15-plan-integration-2026-11-17.md`、`t15-completion-2026-11-17.md`。
- **过时或矛盾点**：`1316/1286` 等中间计数属补齐浏览器前的历史口径；最终口径为 1302/1302、0 跳过。

### c-t15-inspect-review-2026-11-17.md

- **日期／角色／主题**：2026-11-17；C / Codex；T15 项目识别候选审查与 Git 实验（含大量追加轮次）。
- **目的**：以独立只读审查与真实 Git 实验逐轮收口 inspection 的零执行与数据边界。
- **承重事实**：
  - C 集成分支 `chore/t15-c-integration`；B 产品工作树 `C:/Users/10208/.codex/worktrees/t15-b-integration-plan/zhinexus-design-asset-platform`。
  - 宿主初次 GREEN：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts` **20/20 通过、0 跳过、exit 0**；CLI build/typecheck exit 0；`.\scripts\pnpm.ps1 exec turbo run build typecheck --force` **20/20 成功、0 cached、exit 0**。
  - 独立只读审查七类反例：已标记 `pnpm-workspace.yaml` 外链逃逸后仍读取解析根外文件、npm 目标 importer 缺依赖声明借用根 node_modules 提升版本、多份 pnpm packages 声明选首项、npm 非字符串 workspace 条目被丢弃、只检查 npm/pnpm 锁遗漏同目录 Yarn/Bun 锁、非法 `^not-a-version` 约束因 `validRange === null` 跳过验证、Git porcelain 路径相对仓库根导致嵌套项目根基准错误并混入项目外文件。
  - Git clean/process filter 实验（Node `26.13.0`、Git `2.48.1.windows.1`）：命令 `git --no-pager -c core.fsmonitor=false -c core.untrackedCache=false -c core.quotePath=false -c diff.external= -c diff.textconv= --no-optional-locks status --porcelain --untracked-files=all`；两种 filter 均以 `git add` 建立 exit 0 且 marker 出现的控制正例；10 字节等长内容修改 + mtime 变更后 status 两次均 exit 0、输出 ` M payload.txt`、stderr 为空，且再次执行用户过滤器（clean marker `clean-invoked`；process marker 含 `process-start` 与 `command=clean pathname=payload.txt`）→ 仅禁用 fsmonitor/外部 diff/textconv/optional locks 不满足零用户脚本执行要求。
  - 嵌套 Git 实验从 `apps/client` 执行同命令 exit 0，输出 ` M apps/client/package.json` 与项目外 ` M outside.txt`。
  - 独立报告 `C:/Users/10208/AppData/Local/Temp/t15-review-git-filter-c907c70d255c4df1869fa7e7392a8388/independent-review-report.md`；完整材料 C ledger `independent-git-filter-experiment-2026-11-17.json`。
  - 矩阵规格对齐：A 缺 ECharts 案例本地识别应保持无伪造 ECharts 版本的 `inspected`。
  - 独立矩阵初次消费观察：`exec tsx .superpowers/sdd/2026-11-16-phase3-t15-kickoff/observe-matrix.ts` 生成 A 全部 14 案例，实际结果 `matrix-observe-2026-11-17.log`；发现真实 pnpm 12.18.0 快照有两份均带 `lockfileVersion`/`importers` 的 v9 文档导致四个正常 pnpm 案例及框架歧义案例 `LOCKFILE_INVALID`；`conflict-missing-importer` 目标目录不存在导致 `WORKSPACE_INVALID`。
  - D RED 准备提交 `92ab7ccf`，31/31 行为 RED、全图 20/20 与根 TypeScript 通过。
  - 全树快照审查修复：`tests/fixtures/phase3-project-snapshot.ts`；`__proto__` 键被原型 setter 忽略；`exec vitest run tests/integration/phase3-project-snapshot.test.ts` 旧逻辑 **1/1 RED、0 跳过、exit 1**，改无原型对象后 **1/1 GREEN、exit 0**；根 `exec tsc --noEmit` exit 0。
  - Git 执行与路径边界最后一轮：正式 RED **6 failed / 42 passed / 0 skipped、exit 1**；GREEN **48/48 passed、0 skipped、exit 0（10:56，8.77s）**；测试 SHA `C26515925D78A10ACC5F5EDD6A2952BF8ED559BD3F93A8DB0BBDC2F396851A15`、inspect 源 SHA `418F796DA1253F45872F9AC5FD17AA3E7409E455C54EA916973BF968B7A3088A`。
  - 数据边界 RED **12 failed / 50 passed（11:08，8.49s）** → GREEN **63/63 passed（11:25，9.28s）**；测试 SHA `BB9A8FD62ACE38AF7F72D00E59BADBC1AFF96861923AB8A910D5E1E7C8643324`、inspect `EEE0E9EAB46C997861DD09F5EC9ED16C0B442AAEEB8B10995BF418D62A11E729`；临时 alias 重放修复前模块 **13 failed | 50 passed**（旧模块 SHA `8e633b498b692c64516bac741a0fbab61e8c6562ac038c6edeb6c95be536af6f`）。
  - 变换型 filter RED **2 failed / 63 passed（11:37，10.96s）**；近层残余 RED **4 failed / 64 passed（11:43，11.10s）**；GREEN **77/77 passed（11:54，17.17s）**；测试 SHA `18A4F0DC7E8132A861CFDB458FF6AAB18B5602D31814547B9971B42E73D7B56A`、inspect `3EFE46412731860825D8855758DB88326B2821BDBE72FF7FC5315D1A037BD5E5`。
  - 关联枚举 RED **6 failed / 80 passed（12:07，22.53s）**；子模块 RED **8 failed / 81 passed（12:27:34 完整重跑，29.05s）**；零执行边界 RED **11 failed / 81 passed（12:40:11，30.29s）**；gitlink 触发 RED **1 failed / 92 passed（12:58:44，29.35s）**；最终 **93/93 passed、0 skipped、exit 0（13:06:49，30.50s）**。
  - 实证 JSON 与 SHA-256：变换型 filter false-clean `independent-filter-falseclean-2026-11-17.json` `1627a6c08c8bcd518b12b1472743632bbe6eef58292d8e6300ff57ea40c9b9fd`；只读属性控制 `independent-filter-readonly-attributes-2026-11-17.json` `a3ad3bf913a22fd7461d664a1fa41c646f3f0574b3fccf8476ab233f25b6ab00`；子模块执行 `f6619e1aae26e24720013537bd0bc62061e2467fc136c6bcc1c8e69ebfbffe10`；子模块无递归控制 `fa06350ca267b00fa65f98d785349ef665afba819da0ffca70b84653f9a36457`；special driver `55bc90b03ba3f0118cea2d26c186daafa0981afb92519c686cb4694348249c1d`；partial clone lazy-fetch `cafa466b65e8ef2245876b4bc17d0c2b2ea97b6c39ec3b83357a22f2fe59d3a5`。
  - 关键实证结论：特殊属性值（set/unset/unspecified）与显式同名 driver 的 check-attr 输出完全相同，只有显式 driver 执行 helper；变换型显式 driver 的 native status 会执行 helper 并报 dirty，屏蔽后会漏报；子模块下父仓 status 会递归执行子仓 helper（stdout ` M vendor/child`）；partial clone 下 check-attr/status 在属性索引回退时自动 lazy-fetch 并执行外置 ext transport helper（marker `service=git-upload-pack`，exit 128），加全局 `--no-lazy-fetch` 后 exit 0、零 marker。
  - Windows 子模块夹具前提：宿主 `core.autocrlf=true` 时 clone 后 CRLF 工作文件与 LF 索引 stat size 不同，status 可直接标脏而不调用 filter；仅在 seed/parent/child 配置 `core.autocrlf=false` 后控制真实写 marker；推进 mtime 单独不能消除该差异。
  - 提交：C 代 B 提交 `99bf0f46` — `feat: 实现本地项目与锁文件只读识别`，仅含 B 三个实现文件、inspection 测试及当天验证文档；D 变换清单 filter 提交 `a946cdea2ff5b3a1f3d9f05f43ab696f111b1871`（35/35 行为 RED）。
- **结论与状态**：inspection 于 2026-11-17 13:06 收口 93/93；不代表 T15 全部完成。
- **交叉引用**：`b-t15-integration-plan-2026-11-17.md`、`c-t15-plan-integration-2026-11-17.md`、`c-t15-plan-review-2026-11-17.md`、`a-t15-project-matrix-review-2026-11-17.md`、`t15-completion-2026-11-17.md`。
- **过时或矛盾点**：各轮 RED/GREEN 计数（20→29→41→48→62/63→65→68→77→86→89→92→93）为渐进口径，非矛盾；「2 项 setup 失败不计行为 RED」的判定在原文明确标注。

### c-t15-plan-integration-2026-11-17.md

- **日期／角色／主题**：2026-11-17；C / Codex；T15 已安装 CLI 与真实服务验收记录（含 D35 修复、补充 RED、矩阵 RED、0.0.12 P4 GREEN）。
- **目的**：在隔离真实栈上用已安装 CLI 做黑盒与真服务验收，逐轮确认行为 RED。
- **承重事实**：
  - P0 基线 `31ae120a270e84ab7c100d3ad77919b233d1d48b`；集成分支 `chore/t15-c-integration`；B `feat/t15-b-integration-plan`；A `chore/t15-a-project-matrix`；D `chore/t15-d-plan-acceptance`。
  - 专项配置 `tests/acceptance/phase3-plan.config.ts`，复用隔离 PostgreSQL / MinIO / Verdaccio 与实际 Nest HTTP 服务；默认根测试不包含本专项。
  - `A10_FROZEN_BUNDLE`、`PHASE3_CLI_TARBALL` 必填；成功计划额外要求 `INSTALLED_CLI_EVIDENCE`，缺环境或文件必须失败，不跳过。
  - 已接受 SDK bundle 标识 `881238b3-2214-4ec8-bf0c-af5238b7fcd3`，199 个文件、14 份报告；manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`；core `0.0.11`、Vue/React `0.0.12`。
  - RED 使用真实安装的 CLI `0.0.11`，tarball SHA-256 `14775474e4b0181fd3c891f6624ed15b11b2f52582731271063138e606420adf`。
  - RED 轮次：第一次准备流程缺报告参数导致准备失败（测试设施问题，**不计行为 RED**）；第二次 6 个行为失败（旧 CLI 未实现 `integrate plan`）；第三次收紧后 **9/9 失败、0 跳过、exit 1**；中断恢复后补充 RED **11/11 行为失败、0 跳过、exit 1**；A 14 案例矩阵 RED **25/25 行为失败、0 跳过、exit 1**（29.82 秒）；快照审查修复后重跑仍 **25/25 失败**（23.46 秒）。日志 `p4-installed-red3.log`、`p4-installed-red4.log`、`p4-installed-matrix-red-2026-11-17.log`、`p4-installed-snapshot-red-2026-11-17.log`（`.superpowers/sdd/2026-11-16-phase3-t15-kickoff/`）。
  - 根 TypeScript 检查 exit 0（测试新代码先改为兼容仓库 ES2022 lib 的复制后 sort）。
  - B 侧 inspection 测试首次为缺模块 suite 收集失败（0 tests，不计行为 RED）；B 补最小失败入口后 **20/20 用例实际执行并失败、0 跳过**。
  - D 黑盒断言经 C 宿主校正：越界参数、用户并发编辑后完整快照、独立 API/registry origin、跨 origin redirect 零目标请求、错误响应令牌脱敏反例。
  - D35 失败与修复：集成候选 D35 独立黑盒 **34 passed / 1 failed / 0 skipped**；唯一失败为已存在目标组件同时属 Git dirty path 时 `OUTPUT_EXISTS` 计划缺同路径 `DIRTY_TARGET` 被 `IntegrationPlan` 契约拒绝；只改 `packages/component-cli/src/integration/plan.ts`（按 NFC + 小写键相交补同路径 `DIRTY_TARGET`）；修复提交 `006f0547f80476f0ca3c1c811239e93cdba249b5`，以合并提交 `d41dbae5797165f4e039ea409601a40efa85069e` 集成至 C；B 工作树 P1 三组复跑 **142/142 passed / 0 skipped / exit 0（35.12s）**；合并后 C 集成树 P1 三组 + D 五文件 **177/177 passed、0 skipped、exit 0（61.76s）**；CLI build 73 文件 package probe 无缺失/污染/链接/变更；CLI typecheck 与根 tsc exit 0；`plan.ts` 本轮 SHA-256 `098518193D3CEC1AF0E78850E8BF7243D363567ED0C339CFD14EA770911B3CDD`。
  - A 矩阵提交 `5a508567` 由 C 以 `67ffc2ab` 合入 C 并复跑 6/6。
  - **首次冻结候选 0.0.12**：CLI 兼容新增能力按 0.x 规则单独升至 `0.0.12`，提交 `52acc3d1b201e4b69ccd41d09ffbcb5aa87e8b40`；构建后只 pack 一次：`.tools/operations/t15-cli-0.0.12/company-component-cli-0.0.12.tgz`，**292730 bytes**，SHA-256 `1372ed616d49c9c7e2969e64f2318c54a8ea1341045a94dac167bd582069ecda`；已安装兼容采纳证据 SHA-256 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`。
  - 首轮 P4 **24 passed / 1 failed / 0 skipped**（代理同时损坏所选组件与新增运行时依赖 tarball，后者触发 registry integrity 执行错误遮挡 `PACKAGE_DIGEST_MISMATCH`）；限制代理到所选精确包身份后窄跑 **1 passed / 24 未选中**，完整重跑 **25/25 passed**。
  - 中断恢复后最终执行：P4 **25/25 passed、0 skipped、exit 0（27.93s）**；根 `test` **83 文件、1488 passed、0 skipped、exit 0（299.31s）**，其前置 T10 **168/168、0 skipped**；根 tsc exit 0；出现既有 Node `DEP0190` 警告。日志 `final-p4.log`、`final-root-test.log`、`final-root-tsc.log`。
  - 整分支审查报告同包多组件 registry 证据去重、远端 matched/unverified gap 文案泄漏、已锁运行时依赖冲突等残余；**0.0.12 不作为最终 T15 验收候选，尚不合入 main**。
- **结论与状态**：本篇以 0.0.12 候选的 P4 GREEN 收尾但显式保留不合入；最终候选 0.0.13 与 main 合入见 `t15-completion-2026-11-17.md`。
- **交叉引用**：`c-t15-contracts-2026-11-17.md`、`c-t15-inspect-review-2026-11-17.md`、`c-t15-plan-review-2026-11-17.md`、`b-t15-integration-plan-2026-11-17.md`、`t15-completion-2026-11-17.md`、`sdk-label-adopt-acceptance-2026-11-16.md`。
- **过时或矛盾点**：0.0.12 的 25/25 与根测试 1488/1488 在终稿中被降级为「历史候选证据」；最终口径为 0.0.13、P1 183/183、根测试 1494/1494。

### c-t15-plan-review-2026-11-17.md

- **日期／角色／主题**：2026-11-17（Asia/Shanghai）；C / Codex 宿主执行 + 独立只读审查；T15 plan 行为 RED 与夹具前提审查。
- **目的**：证明 plan 行为 RED 真实成立，并在 GREEN 前收窄成功夹具前提。
- **承重事实**：
  - 第一批：B 停在 `plan-behavior-red-ready`，新增 `project-plan.test.ts` 16 项 + `project-plan-network.test.ts` 13 项；`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts` 于 13:25:52 开始，**29 项实际执行并失败、0 跳过、exit 1**，1.45 秒；根 TypeScript exit 0；测试 SHA plan `CA361AC8…A367C`、network `33764E33…E967`，四个 stub SHA 未变。
  - 日志 B `.superpowers/t15/host-plan-behavior-red-2026-11-17.log`、`host-plan-behavior-red-hashes-2026-11-17.json`、`host-plan-behavior-red-root-tsc-2026-11-17.log`，另备份到 C 忽略 ledger `b-inspection-final-evidence/`。
  - 夹具前提审查五类问题：单 server 兼任 registry 且平台 SHA/integrity 为占位、正常 API query 缺完整 packageName 绑定、缺绑定/布局/unverified 未附 gap 且显式 `undefined`、本地编辑靠 sleep 猜测、planned 命令只允许 install；要求独立 synthetic registry、实算 SHA256/integrity/SHA1、精确包名/版本/路径、entered/release 真实屏障、结构化 argv 与正确 cwd、独立依赖 bytes 与真实 integrity 并拒绝坏 integrity。
  - 修正夹具后 B 停 `plan-fixture-red-ready`（13:42:22）；13:44:42 复跑 **31 项实际执行并失败、0 跳过、exit 1**，859ms；SHA plan `DEEAA4A1…FE8C`、network `FBF64E3E…BF89`。
  - 固定快照复审残余两处：plan 测试 430 行 unverified 仍缺 gap、442–448 缺项仍显式 `undefined` 且未补 gap、449–450 取消源合法性断言；network 409 行源 target 为 `OTHER_SHA256` 但首次 API 默认 `TARBALL_SHA256`，下载前已是 `TARGET_CHANGED`。B 13:53:38 停写修正；13:56:02 复跑 **31 项实际执行并失败、0 通过、0 跳过、exit 1**，817ms；SHA plan `C8DFC910…F0F7A85`、network `E1AC8A98…6DFF9`。
  - 正式 RED 与原 P1 GREEN 授权经实际 Claude 桌面端送达 B，界面确认消息已发送且输入框清空；保留 93 inspection 与 31 plan 行为断言。
  - 七项候选审查回归宿主正式 RED：2026-11-17 15:50:18–15:50:53 +08:00 在 B worktree 用 Node 26.13.0 / pnpm 12.18.0 / Git 2.48.1.windows.1 执行三组 + 根 tsc：**15 failed、127 passed、142 total、0 skipped、exit 1，32.91s**；inspection 93/93、plan 17 passed/3 failed、network 17 passed/12 failed；原 124 全 GREEN；新增 18 项中 15 项行为 RED、3 项既有行为守卫 GREEN（其中 exists:false 基准断言实际 RED，不能因其称作守卫就记为通过）。
  - Windows junction 实际建立且 realpath 指向外部目录，三个链接回归均在预期行为断言失败；无 setup、收集、输入合法性或屏障超时失败。
  - 固定测试 SHA：plan `C6887A7F6CB62F152EB29F3125F856185BA947AEA6F8860445AAEA32B154C798`；network `EF51E0C924A82177A79C3C15E8A0F52297E2F03E0691302516ED309454CF1736`。证据 B `.superpowers/t15/host-plan-review-red-2026-11-17-1545*`，逐件核对 SHA 后复制至 C ledger `b-plan-review-red-2026-11-17/`。原架构 SHA 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
  - C 裁定：保持冻结 CLI 参数清单，删除额外 `--timeout` 接受与 help，保留库 `PlanOptions.requestTimeoutMs`；错误 envelope 为命令本地最小 JSON 对象，不新增 contracts DTO。
- **结论与状态**：RED 证据链完整，GREEN 由 B 实施（见 `b-t15-integration-plan-2026-11-17.md` 第二十节）。本篇不代表 T15 完成；未升版、pack 或 push。
- **交叉引用**：`b-t15-integration-plan-2026-11-17.md`、`c-t15-plan-integration-2026-11-17.md`、`t15-completion-2026-11-17.md`。
- **过时或矛盾点**：无（过程口径 29 → 31 → 142 项均按时间顺序记录）。

### d-t15-plan-consumer-2026-11-17.md

- **日期／角色／主题**：2026-11-17；D / Claude Code（实际黑盒客户端），C Windows 宿主执行固定工具链与 Git；T15 P3 黑盒验收准备与 RED（含 Git clean/process filter 与变换清单 filter 两项追加）。
- **目的**：以只观察副作用的黑盒方式准备 inspect/plan 验收，逐轮证明产品行为 RED，并借宿主已实测的 Git filter 执行事实补两项黑盒用例。
- **承重事实**：
  - 工作分支 `chore/t15-d-plan-acceptance`，P0 基线 `31ae120a270e84ab7c100d3ad77919b233d1d48b`。本记录仅证明验收准备和行为 RED，P3 GREEN 与 T15 完成尚未达成。
  - 测试和文档通过实际 Claude Code 会话 `bae14ee4-36a8-48f8-b530-6520d076b6c0` 生成。客户端曾出现工具参数解析错误；已写出的文件保留，后续由同一会话输出文件内容，C Windows 宿主保存、校对契约、执行固定工具链及 Git。未将客户端故障视为测试通过。
  - 独立 Codex 只读审查发现三处误通过风险，C 按审查修正：所有通用调用前后比较项目全树；inspect 结果执行完整 inspection 校验及必需快照断言；API 500 反例要求实际 GET 和正确平台令牌。审查没有替代用户指定的实际开发客户端。
  - 验收内容：子进程只执行构建后的 `packages/component-cli/dist/bin.js`，不导入 CLI 产品模块，只观察参数、环境、退出码、stdout/stderr 及文件副作用；synthetic 项目在工作区外临时目录创建，完整目录集合、文件原始字节 SHA 和链接目标逐项比较，参数、输入 JSON 和网络失败分支也检查零写入；inspection 校验 Vue/npm、React/pnpm、精确锁版本、快照和 Git 脏路径，计划校验结构、来源摘要、依赖及生成意图，缺 prop/event、unverified、撤权均必须阻塞；恶意生命周期/配置及真实 Git fsmonitor marker control，Git 环境覆盖反例要求实际目标和诱饵仓库均保持不变；Windows 实际创建 junction 并检查目标根外字节不变，创建不可用时报环境失败，不能冒充覆盖；tarball 响应暂停期间分别修改关键文件、撤权和废弃，恢复响应后要求重新读取并阻塞，用户编辑后的完整快照必须保留；API 与 registry 使用不同 loopback origin，逐请求校验令牌分离，跨 origin tarball redirect 目标必须零请求，错误响应主动回显两个 synthetic 令牌而输出仍须脱敏。
  - HTTP stub 仅证明协议边界，synthetic tarball 仅提供固定下载字节及摘要，不作为真实发布或兼容证据；真实 Nest/PostgreSQL/MinIO/Verdaccio 和冻结消费者由 C P4 专项验收。
  - 实际验证命令：
    ```powershell
    .\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','--noEmit','--ignoreConfig','--target','es2022','--module','nodenext','--moduleResolution','nodenext','--strict','--skipLibCheck','--types','node','tests/fixtures/phase3-cli-harness.ts','tests/integration/project-plan-consumer.test.ts','tests/integration/project-plan-readonly.test.ts')
    .\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts
    ```
  - 窄 TypeScript 检查：exit 0。初始宿主 RED：30/30 行为失败；加入 redirect 及审查修正后最终 **31/31 行为失败、0 跳过、exit 1**。命令尚未实现导致退出码、输出及请求屏障反例失败；未出现夹具、junction 或 Git marker 环境准备失败。
  - 日志依次保留于 `.superpowers/t15/p3-red-host2.log`、`p3-red-host3.log`、`p3-red-host4.log`，不改写此前失败记录。
  - 根 TypeScript 与 `git diff --check` 的提交前结果由宿主追加；只提交 RED 准备子任务，不宣称完整根测试通过。
  - 宿主提交前补充验证：首次根 TypeScript 检查因独立工作树尚无 Nest/SDK 构建声明而失败，属于环境前置缺失，不计行为 RED。随后 C 在 D 工作树执行：
    ```powershell
    .\scripts\pnpm.ps1 exec turbo run build typecheck --force
    .\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
    git diff --check
    ```
    全图构建和类型检查实际 **20/20 成功、0 cached、exit 0**；补建后根 TypeScript **exit 0**；diff 检查 **exit 0**。日志保存于 `.superpowers/t15/p3-graph-build-2026-11-17.log` 与 `p3-root-tsc-final-2026-11-17.log`。此次提交仍只完成 RED 验收准备；31 项产品行为尚未 GREEN，不标记 P3 或 T15 完成。
  - 后续门槛：B 冻结产品后按 A → B → D 次序集成，在同一候选运行 P3 GREEN、C 真实安装专项及完整回归。使用说明当前为草案，示例将在 GREEN 时实际复核。T16/T17、下载限额和超时的完整覆盖、14 案例消费及真实业务试点仍有各自验收门槛。
  - Git clean/process 黑盒补充（2026-11-17，追加）：延续实际 Claude Code 会话 `bae14ee4-36a8-48f8-b530-6520d076b6c0`，D 根据宿主已实测的 Git filter 执行事实产出 helper 和两项黑盒测试，C 保存至 D 负责的 harness/readonly 文件并执行固定 Windows 工具链。代码经过同会话三轮审查修订：C 指出 CJS/ESM、pkt-line 编码与等长内容的 setup 问题，D 返回修订代码；最终 JSON 尾部被截断，C 仅补齐测试与 JSON 关闭符、删除重复导入，并纠正一处 helper 注释，没有改写产品实现。原始生成材料保留在忽略目录 `.superpowers/t15/filter-followup-{response,response2,response3,final-code}.json`。
  - helper 和 marker 位于 synthetic 项目根外；配置仅指向本次自有 helper。clean 原样透传 Buffer，process 实现 Git v2 pkt-line 握手并透传内容。
  - `git add` 控制正例必须实际写出对应 marker；process 还须出现 `command=clean`，失败即抛环境错误，零跳过。控制 Git add/commit/status 有 10 秒超时。
  - 10 字节 tracked payload 从 `1234567890` 改为 `abcdefghij`，mtime 明确增加 4 秒；随后黑盒依次检查 inspect/plan 的完整契约、真实 dirty 路径、marker 不存在和项目全树原字节保持不变。
  - clean/process 补充实际命令：
    ```powershell
    .\scripts\pnpm.ps1 exec tsc --noEmit
    .\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts
    git diff --check
    ```
    根 TypeScript **exit 0**；完整专项 **33/33 行为 RED、0 跳过、exit 1**，耗时 16.62 秒。两项新增 filter 用例的控制正例与 commit 均成功，实际失败位于旧 CLI 尚无 `integrate inspect` 的退出码断言，不是 helper/权限/setup 失败。日志 `.superpowers/t15/p3-filter-red-host-2026-11-17.log`。
  - 独立只读审查另要求计划结果也精确保留真实 dirty 信息。C 按审查补 `planJson.localProject.git` 的完整 `{status:'dirty',dirtyPaths:[payload]}` 比较，并将 inspect 路径集合收紧为精确值，避免省略 Git 读取或虚构路径通过。先用标题过滤复跑两项：2 RED，另 13 项被选择条件排除（不算完整零跳过验证）；随后重新执行根 TypeScript与**完整 33 项**，根检查 **exit 0**，**33/33 RED、0 跳过、exit 1**，12.54 秒，日志 `p3-filter-final-red-host-2026-11-17.log`。未改写此前历史结果，仍只提交验收准备。
  - 变换清单 filter 黑盒补充（2026-11-17，追加）：继续实际 D Claude Code 的同一会话，新增 Vue/pnpm 与 React/npm 两项独立进程用例。D 返回的 JSON/原始 TS 被截断，且包含双重转义、API 拼写及快照基准错误；C 保存全部原文与校正稿于 `.superpowers/t15/transform-filter-*`，补关闭符、恢复正确换行/NUL 和 Node API 名称，采用 D 后续明确给出的仅版本主号正则变换，并分别保存 whole-tree 与 project 快照。C 仅校正 D 负责的测试，不承担 B 产品开发。
  - 新用例从有效清单 version 1.0.0 开始，实际 `git add` 执行 helper 并将 2.0.0 字节存入索引；再将该索引字节写回工作区，推进 mtime。原生 Git status 必须精确报告 ` M package.json` 且执行 helper；清空 filter 的对照必须输出为空、零 helper，两个 status 均使用 `--no-optional-locks`，全树含 `.git` 原始字节保持不变。控制不成立直接失败，不跳过。之后黑盒要求 inspect 的完整契约和精确 dirtyPaths、plan 的 blocking `DIRTY_TARGET`、零 helper 执行、零凭据输出及所有树字节不变。
  - 变换清单补充实际命令：
    ```powershell
    .\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan-readonly.test.ts -t 'transforming manifest filter'
    .\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
    .\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts
    git diff --check
    ```
    窄跑 **2 项行为 RED**，另 15 项因标题筛选未运行；根 TypeScript **exit 0**。随后完整专项 **35/35 行为 RED、0 跳过、exit 1**，14.51 秒。新增两个用例全部真实 Git 控制及快照控制成功，失败位于旧 bin 缺 `integrate inspect` 的退出码断言；此时 plan 断言尚未执行，不能宣称 `DIRTY_TARGET` 已由产品满足。日志分别为 `p3-transform-filter-red-host-2026-11-17.log`、`p3-transform-filter-typecheck-2026-11-17.log`、`p3-transform-full-red-host-2026-11-17.log`。独立只读审查已派发；完整候选 GREEN、已安装 CLI 与 T15 仍待执行。
  - 独立只读审查确认本轮无阻塞项：两种框架真实控制成立，whole/project 快照基准一致；所选 MatchPlan 会新增图表依赖，确实需要修改 package.json，因此 DIRTY_TARGET 断言覆盖有效。审查未运行项目或修改文件；GREEN 边界保持上述说明。本轮仅聚焦提交独立 RED 准备，停止 D 写入并等待 B 冻结候选。
  - D 的 35 项独立黑盒最终来源提交为 `a946cdea2ff5b3a1f3d9f05f43ab696f111b1871`（见 `t15-completion-2026-11-17.md`）；D RED 准备提交 `92ab7ccf` 记录于 `c-t15-inspect-review-2026-11-17.md`；删除前 D 侧忽略证据复制 **37 文件**。
- **结论与状态**：P3 黑盒 RED 准备完成（31/31 → 33/33 → 35/35 行为 RED），P3 GREEN 与 T15 完成未达成；GREEN 由后续集成轮次达成（C 集成树 P1 三组 + D 五文件 177/177）。
- **交叉引用**：`c-t15-inspect-review-2026-11-17.md`、`c-t15-plan-integration-2026-11-17.md`、`b-t15-integration-plan-2026-11-17.md`、`t15-completion-2026-11-17.md`。
- **过时或矛盾点**：30/30、31/31、33/33、35/35 为逐轮追加口径，按时间顺序理解；「标题过滤复跑 2 RED」与「完整 33 项」的区别在原文明确标注（前者不算完整零跳过验证）。
