# 三期 T17 矩阵与黑盒验证汇编（phase3）

> 本文件由 `docs/verification/` 下 38 篇逐次验证记录合并而成（2026-11-22，`chore/docs-consolidation` 分支）；原件已按主题合并删除，git 历史可追溯。每篇原记录以 `### <原文件名>` 为标题完整保留于「逐条合并记录」。总索引见 docs/README.md。
> 2026-11-26（分支 `chore/docs-slim-round3` 的后续收尾）删除原有的「历史脉络」一节（原 8784 字符）：该节按时间序复述各原记录的过程，其事实由「终态结论」与「逐条合并记录」承载，未在别处出现的硬事实已压入终态结论末尾的「历史脉络硬事实」。原文可经 `git show 789addf7:docs/verification/phase3-t17.md` 完整恢复。

## 终态结论

- 唯一交付候选为 CLI **0.0.23**：独立升版提交 `edb985ec0f9ee1b79a5882e935832f8caa9f0daf`，`2026-11-20T05:51:34.8465368+08:00` 仅 pack 一次（`packCount=1`）；冻结目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.23-edb985ec-b8f572a9`，tarball `company-component-cli-0.0.23.tgz` **454155 bytes**，SHA-256 `93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab`；同目录保留 `freeze-manifest.json`（509 字节，SHA-256 `4124d7b5117f761a8966b0837339fa63856833711b7e29bebe95f3f903cd9e8e`）、`pack-command.json` 与 `pack.log`。
- SDK 未重包：core 0.0.11、Vue/React 0.0.12，manifest SHA-256 全程 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`（199 唯一文件 / 398 引用）；历史兼容输入 SHA-256 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`（来源 `historical-real-installed-cli-probe-replay`，非本轮新探针）；原架构文件 SHA-256 全程 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
- 0.0.23 同包重验全绿数字（均无名称过滤、无跳过、自然 exit 0）：

  | 门槛 | 实际结果 | 耗时 |
  | --- | --- | --- |
  | 工作区与强制全图 | 10 members；build/typecheck 20/20、0 cached；根 tsc exit 0 | 14.435s |
  | 完整根测试 | T10 168/168、0 skipped；Vitest 124 files / 2210/2210、0 skipped | Vitest 895.76s，包装器 927.63s |
  | 真实平台 | 35 files / 137/137 | Vitest 711.83s，包装器 719.17s |
  | 完整浏览器 | 288/288 | 3.2min，包装器 192.84s |
  | 黑盒四完整配置 | 5/5 + 5/5 + 25/25 + 14/14 = 49/49 | 700.65 / 28.32 / 61.78 / 941.24 秒（Vitest） |
  | 独立双框架宿主 | 1/1、1235.87s，四链各 6/6、visual PASS | 进程 1236.464 秒 |
  | 固定 33 格矩阵 | 正向 20/20（Vue/React 各 10/10）、强制拒绝 13/13 | 3481.91s，session `93391` |

- 控制方独立复读：工程 `root-engineering-regression-reopen.json` SHA-256 `dc7e44d4f8dbd2a478d69aa9b0bfea4513bdc8a7eaa4b5e098e2438b8b0cc9ea`；冻结字节 `root-initial-frozen-byte-reopen.json` `026fdbca973273343b51346e53ccf14bdcf736dff15232f08323a6153069f173` 与 `root-final-frozen-byte-reopen.json` `37f334c9e9268a1f6b1231d02ce950c464a21e2737848dda8beaaaf002190e82`（306 个 dist 文件逐字节一致）；黑盒 `root-all-original-copy-byte-reopen.json` `5ee88fccfc0e64ff1756cda485bfdb590c06b3bba4a869b70540d26695a4cee6`（410 文件、3332628 字节）；矩阵 `root-original-matrix-score-reopen.json` `bfd8a0da7d1c99b659033f07367acff3511e6e4ba901f4ce5b324416d0162c94`（`matrixAccepted=true`、`failures/errors=[]`）与全字节复读 `root-all-original-copy-byte-reopen.json` `13e50a60be57e03a34f5b24d4a2a0b4e02175f5291cffd5cee090950118f7d8b`（59 roots / 23162 files / 493327325 bytes）。
- **0.0.22 矩阵 R08 失败与 `10ca2957` 修复**：0.0.22（453485 bytes / SHA-256 `d3da08748faa4c18a19a8b757caf817dae032e82b9405521a87dd8f877c179ef`，来源 `f96af5ee59cfbd007ba4ff50aad3de60cebafb60`）工程回归 2198/2198 全绿、黑盒 49/49、宿主 1/1，但正式 33 格矩阵 R08（React StrictMode/pnpm）browser 报 `BEHAVIOR_FAILED`、产品 verify exit 2、1826ms、未超时，正向 19/20（Vue 10/10、React 9/10）、拒绝 13/13、3340.98s、自然 exit 0；两次真实产品探针确认 250ms 异步文本更新在 `timeoutMs=1500` 下过早失败（独立 Chromium 实测更新约 252ms），归为 Important/P1，判定 0.0.22 不作最终交付。修复提交 `10ca2957602d0f225c906acc8b534c6be2ff96e5` 建立 `Date.now() + browser.timeoutMs` 共享截止时间、失败按至多 25ms 短间隔重采样至共享期限耗尽，保留 `first()`/`textContent().trim()`/精确 count/非零可见尺寸与取消语义；有效 RED `8 failed | 4 passed (12)`，最终聚焦 52/52、既有浏览器 1/1，独立审查 Approved、Critical 0、Important 0。
- 仍开放问题：两个历史真实业务试点、T11/T12、公司 OIDC、生产独立预览域、完整生产 G2 均各自独立未完成；本轮 OIDC 为本地签名 fixture，所有验收 `productionAcceptance=false`（temporary/synthetic）。原 P0 独立日志、最初实现 RED 的完整执行顺序、原始 stderr 空字节、原 R08 失败瞬间实际 mounts 文本仍未追溯，明确不追认。
- 清理保留项（归属证据不足或被策略拦截，不得宣称全局临时目录清空）：工程平台 `.tools/recovery/f8074e4f-541a-4e83-939e-ddd69bb03e95` 仍保留四个普通凭证配置文件（缺创建时 marker/首见 native 身份，未发删除命令；`root-engineering-cleanup-boundary-audit.json` 11785 bytes / SHA-256 `726ac0548317e28b199c8e2772ef303a5a5170273c5025aa31e9bc331b02a6c1`）；0.0.22 黑盒八个根因自动审批 `blocked by policy` 在进程启动前被拒（`t17-d-live-C94XDQ`、`t17-d-blackbox-dL4Teo`、`zhinexus-t15-installed-QQY7Hr`、`zhinexus-t16-installed-VF79Eb`、`t16-d-AqrLQT`、`t17-d-0022-redaction-AQSE8T`、`.tools/recovery/76181669-7754-4a5b-b831-d554a85cf8fb`、`.tools/recovery/ff069d9c-b890-487d-8dc3-3af7ff39662c`）；0.0.21 五个被拒目录与宿主旧轮两个被拒路径、0.0.19 轮三个被拒路径同样保留。成功清理仅限 0.0.23 宿主 3 个 owned parent、黑盒 12 个新根（`deleted=12`、`remaining=[]`，`native-cleanup-result.json` 2892 字节 / SHA-256 `08caebc73a7898631c6bb8541988969ff282f5d0c30e7f533db815d7991bd36c`）与矩阵 59 个 owned parent，三者范围独立。
- T17 设计来源为设计稿 `2026-11-19-phase3-t17-design.md`（原位于 `docs/specs/`，本轮不在合并范围，（2026-11-26 文档精简时移除，git 历史可追溯））。全主题所有产品、契约、矩阵与黑盒行为均以该设计为验收依据；本文不重复其内容。
- 分支 `feat/t17-integration`；全程未 push、未 tag、未合并、未生产发布。

#### 历史脉络硬事实（叙述已删，2026-11-26）

CLI 各轮冻结与失败轨迹（均单次 pack，`packCount=1`）：0.0.18（`b46ef834`，451148 bytes / `08d201fa...`）暴露 T16 Next App Router 失败（13 passed / 1 failed，exit 1）；0.0.19（`1615dfc5`，451225 bytes / `45a514e9...`）修工具链定位后 T16 转 14/14，但首轮固定 33 格 0/20 正向 + 6/13 拒绝（seal `2a8acbd3...`，908/908 files）；0.0.20（451327 bytes / `8d56d87e...`）首轮完整矩阵 9/20（Vue 4/10、React 5/10）+ 4/13、`matrixAccepted=false`，首次完整根 test 2123 passed / 3 failed；0.0.21（`3fbcfa9b`，451414 bytes / `7dd4874f...`）正式矩阵 20/20、12/13、exit 1（唯一 N10 请求夹具 HTTP 400，2975.21s，57 roots / 22739 files，根 seal `4ce1ae4e...`）；0.0.22（`f96af5ee`，453485 bytes / `d3da0874...`）R08 browser `BEHAVIOR_FAILED`、产品 verify exit 2、1826ms，正向 19/20 + 拒绝 13/13，归 Important/P1（250ms 异步文本更新在 `timeoutMs=1500` 下过早失败，独立 Chromium 实测约 252ms），判定不作最终交付；0.0.23（`edb985ec`，454155 bytes / `93c90124...`）完整矩阵正向 20/20、拒绝 13/13。字节归档：0.0.20 50 roots / 18542 files（archive-map `8036a039...`）；0.0.21 57 roots / 22739 files（archive-map `74e6d337...`）；0.0.22 59 roots / 23162 files / 493332540 bytes（archive-map `09b3a3af...`，Root 复读 `ee0f8ac0...`）；0.0.23 59 roots / 23162 files / 493327325 bytes（archive-map `441cba52...`，Root 复读 `13e50a60...`），0.0.23 矩阵 seal 2447465 bytes / `3fdf1427...`（33 receipts + 1635 files）。设计基线 main@`7e10ba19`；0.0.22 重点审查 Git 范围 `5a172921..2da99161...`（148 文件 / 24388 行新增 / 22 行删除，Critical 0 / Important 0）。两项基础设施修正：隔离 OIDC fixture 令牌 1h → 有界 3h（最终 GREEN 要求 `8100 <= remainingSeconds <= 10800`，实测 `issuedLifetimeSeconds=10800`、`remainingSeconds=10782`）；T17 `local-services.ts` 内联配置遗漏 5m、实际为 Verdaccio 默认 30s（容器日志 `echarts-6.1.0.tgz` / `ETIMEDOUT` / `requestTimeoutMs=30000` / `totalMs=30003`）。`validateIntegrationApplyResult` 不得伪造 `installedVersions`；回归预算四个 it 分别 30/30/45/15 秒；pnpm 隔离两修（`--config.verifyDepsBeforeRun=false`，RED 时 poison registry 实收 21 次请求；`--pm-on-fail=ignore`，RED 时精确声明工程 `changedFiles=[pnpm-lock.yaml]`）。源快照上限 4 MiB / 10000 文件 / 256 MiB。黑盒安装时序探针：同步 130ms / 延迟 360ms / 383ms（browser passed 但 overall failed + visual NEW）/ 永久负例 1620ms；0.0.22 黑盒四配置封存 336 files / 3,188,592 bytes / 17 receipts，宿主封存 34681 files / 6605 dirs / 2586571483 bytes。

## 逐条合并记录

### t17-a1-hardening-2026-11-19.md

- 日期／角色／主题：2026-11-19；A（SDK/CLI）；A1 本地验证器安全边界回归补充。追加证据，不改写既有 T16/T17 记录。该 CLI 缺陷修复使版本从 `0.0.14` 升至 `0.0.15`，详见 `CHANGELOG.md`。
- 目的：为 A1 本地验证器的安全边界补回归证据。
- 承重事实：

  - 新增项目验证单元测试覆盖：结束源快照失败时失败关闭；安装包名与 exact version 绑定；pnpm node_modules 内合法 store 链接；store 外链接拒绝；锁文件计划依赖复核；浏览器 data/blob 请求与外源 WebSocket 拦截；浏览器诊断中 URL/query 凭据脱敏。
  - 真实 Chromium 浏览器验收沿用并扩展 `tests/browser/generated-page.spec.ts`；运行前须用固定工具链完成 CLI 构建并确保 Playwright 浏览器可用；`test:browser` 的应用服务依赖与结果单独记录，不得以 Vitest 项目单测替代。
  - `./scripts/pnpm.ps1 exec vitest run tests/integration/project-verify.test.ts`：通过，**10/10**；锁漂移用例把漂移锁内容纳入有效计划基线，断言 `dependency-guard` 以 `DEPENDENCY_MISMATCH` 失败。
  - `./scripts/pnpm.ps1 --filter @company/component-cli typecheck`：通过，退出码 0。
  - `./scripts/pnpm.ps1 typecheck`：通过；服务构建前置、**14/14** Turbo 检查与根 `tsc` 均通过。
  - `./scripts/pnpm.ps1 verify:workspace`：通过，10 个成员及服务端依赖边界检查通过。
  - `./scripts/pnpm.ps1 build`：通过，退出码 0；随后 `./scripts/pnpm.ps1 exec turbo run build --force`：**10/10** 任务成功，0 cached。
  - `./scripts/pnpm.ps1 test`：通过，**95 个测试文件、1847 项通过、2 项跳过**；执行包含 `build:services` 和 T10 验证。
  - `./scripts/pnpm.ps1 exec playwright test tests/browser/generated-page.spec.ts --config tests/playwright.config.ts`：通过，真实 Chromium **1/1**；运行前 5173–5176 端口无监听，Playwright 启动所需服务并在结束时退出。
  - `git diff --check`：无空白错误；构建输出含既有 Vite 大 chunk 提示、全仓测试输出含 Node `DEP0190` 弃用提示，均未阻断命令。
- 结论与状态：完成（A1 局部）。本记录不表示完整 T17 或真实公司项目验收完成。被后续 t17-integration 与 0020–0023 系列在更高版本上扩展。
- 交叉引用：`CHANGELOG.md`；`tests/browser/generated-page.spec.ts`；`tests/integration/project-verify.test.ts`；`docs/phases/phase3/local-project-verification.md`。
- 过时或矛盾点：计数口径为 0.0.15 时点，后续版本（0.0.18–0.0.23）测试文件数/项数持续增长，本记录不再代表当前规模。

### t17-async-assertion-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（CLI 产品）；异步浏览器断言修复验证。`feat/t17-integration`、基点 `01aaddb7` 的独立补充记录，不重写 `.22` 原始验收。修复只涉及 `packages/component-cli/src/integration/verify.ts` 的断言阶段，新增 `tests/integration/project-verify-browser-assertions.test.ts` 与本记录。
- 目的：修复冻结 CLI 0.0.22 中 250ms 异步 DOM 更新在 `timeoutMs=1500` 下过早判失败的产品缺陷（R08）。
- 承重事实：

  - 前置公开入口诊断：`D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/r08-async-assertion-probe-20261120-0635-valid/`，已证明冻结 CLI `0.0.22` 的 250ms 延迟更新会在 `timeoutMs=1500` 下过早失败。原 R08 失败瞬间实际文本未留存，本记录不补推，也不把新 synthetic 夹具称作原 R08 重跑。
  - 工具链实测 Node `v26.13.0`、pnpm `12.18.0`；浏览器为固定本地 Playwright Chromium。
  - RED 命令：`$env:T17_ASSERTION_EVIDENCE_ROOT = Join-Path (Get-Location) '.tools/t17-async-assertion/red-valid-artifacts'` + `.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-verify-browser-assertions.test.ts','--reporter','verbose')`。实际退出 **1**，`8 failed | 4 passed (12)`，耗时 **10.17s**。12 例均经公开 `verifyIntegration` 入口、实际 loopback HTML 与真实 Chromium。
  - RED 明细：延迟 250ms 的既有元素精确文本更新失败报 `BEHAVIOR_FAILED`；延迟新增和移除到零的两例精确 count 均失败；missing、hidden、zero-size 转为非零可见的三例均失败；三条永久不匹配只在动作后 **94ms** 返回，未使用声明的 **600ms** 等待预算；等待中取消例在计划的 250ms abort 之前已返回，`abortedAt=0`；已有语义的四个负例通过（只认第一个文本匹配、内部空白精确比较、精确数量、只认第一个可见性匹配）。
  - 首次夹具遗漏生成文件导致 precondition `INVALID_INPUT`；`red.log` 与 `red-artifacts/` 保留但不计产品 RED；补齐夹具后才生成 `red-valid.log` 与有效产品证据，随后才改生产源码。
  - 修复语义：断言阶段建立 `Date.now() + browser.timeoutMs` 共享截止时间；失败按至多 25ms 短间隔重采样至共享期限耗尽；不改 goto/ready/actions 超时协议，不为每条失败断言重开完整预算；保留 Playwright selector、`first()`、`textContent().trim()`、精确 count、`isVisible()` 加正宽高 bounding box；只将 `TimeoutError` 保留为对应条件不匹配；每次采样检查 AbortSignal；取消保留 `CANCELLED`；未提供视觉基线的正向例仍 `visualResult=NEW`、总报告 `failed`。
  - GREEN 表（均经 `scripts/pnpm.ps1 -PnpmArgs`）：聚焦套件首轮 **12/12**、11.23s、exit 0；`project-verify + project-verify-cli + integration-repair` **40/40**、36.85s、exit 0；`build` **10/10**（8 cached）、CLI 与 gallery 实际构建；`--filter @company/component-cli typecheck` exit 0；`test:browser generated-page.spec.ts` 完整 **1/1**（用例 53.8s、总计 59.9s）；`exec tsc -p tsconfig.json --noEmit` 最终 exit 0；最终四套件合计 **52/52**、43.70s、exit 0。
  - 根 tsc 首次发现新测试的 `snapshots.exists` 被推宽为 boolean；给夹具标注现有 `IntegrationPlanV1['baseFileHashes']` 后通过，原失败输出保留于 `root-tsc.log`。
  - 最终新增 12 项证据在 `green-verified-artifacts/`：六个延迟成功例动作至返回 **345–379ms**；永久三条件共享 600ms 后在动作至返回 **691ms** 内失败；取消例在 abort 后 **5ms** 返回 `CANCELLED`。观测含截图、环境采集与关闭开销。
  - 证据根为仓内忽略目录 `.tools/t17-async-assertion/`；`evidence-manifest.json` 列有效 RED、最终 GREEN 产品文件与相关日志共 **273** 项；重新核对 **93** 个产品 artifact 引用，字节数与 SHA-256 全部一致。
  - 摘要：`red-valid.log` `62776f1df2e718f0f8868222be9d8dde01c35b1f06f77a6152e080b476d99ff7`；`final-focused.log` `813fc2a3a0f54b69e6d4b2e28e579c8a0220ce42fadb77adb7ce4d62eecdeec9`；`generated-page.log` `b91c05e8ae6e47989dc7776cb40cdb15d1af8b70cfc16c3ce29a89bb801d0bea`；`evidence-manifest.json` `adb5fe739a0d2c9163de00bdd0ca5284d1388f5f511a48871fbacb18bfdf712d`。
  - 修复独立提交 `10ca2957602d0f225c906acc8b534c6be2ff96e5`；独立 reviewer 对基点 `01aaddb7` 至该提交给出 Spec compliant、Task quality Approved，**Critical 0、Important 0**。reviewer 不能从 diff/日志独立证明 RED 早于产品修改，顺序依赖控制方当时收取的有效 RED handoff。
  - 控制方逐字节重开原 `273` 项、`344840` bytes，结果 `root-original-regression-reopen.json` SHA-256 `0cd494c132222789073676311133d9c05ebf92d80dfa0d7bef680df5b52677db`；仓外补充归档 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/async-assertion-fix-10ca2957`，共 **277 files / 416796 bytes**，`archive-map.json` SHA-256 `6d3c974a27e121169d7f953675cc255d51003c7893962adb8121500e32b05d46`。
  - 独立升版提交 `edb985ec0f9ee1b79a5882e935832f8caa9f0daf` 将 CLI 升至 `0.0.23`；强制全图 build/typecheck **20/20**、0 cached、根 tsc 与 `verify:workspace` exit 0；新 CLI 于 `2026-11-20T05:51:34.8465368+08:00` 仅 pack 一次，**454155 bytes**，SHA-256 `93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab`。
  - 本次没有改版本、pack、覆盖冻结 `.22` tarball、修改矩阵预期、push、merge 或尝试受阻清理。
- 结论与状态：完成并经独立审查批准；直接触发 CLI 0.0.23 升版与全量重验。被 t17-cli-0023-regressions / t17-integration 更新为最终交付状态。
- 交叉引用：`t17-integration-2026-11-20.md`、`t17-cli-0022-regressions-2026-11-20.md`、`t17-cli-0023-regressions-2026-11-20.md`、`t17-matrix-0022-2026-11-20.md`、`t17-matrix-0023-2026-11-20.md`、`t17-completion-2026-11-20.md`。
- 过时或矛盾点：原 R08 失败瞬间实际文本永久缺失；RED 先于修改的顺序无法从事后日志独立证明。

### t17-blackbox-0022-2026-11-20.md

- 日期／角色／主题：2026-11-20；D（消费者黑盒，Codex 子代理执行）；冻结 CLI 0.0.22 的 T15/T16 与独立黑盒回归。只记本轮新增事实，不替换 0.0.21 及更早记录。
- 目的：对 0.0.22 冻结包完成四个完整配置黑盒/T15/T16 回归 + SDK 自动错误脱敏追加探针。
- 承重事实：

  - 唯一 CLI：`company-component-cli-0.0.22.tgz`，**453485 字节**，SHA-256 `d3da08748faa4c18a19a8b757caf817dae032e82b9405521a87dd8f877c179ef`；来源 HEAD `f96af5ee59cfbd007ba4ff50aad3de60cebafb60`；根 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.22-mwo0jfyw-6oszswub`。本验收未执行 pack。
  - 历史兼容 probe SHA-256 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`，仅作 `historical-real-installed-cli-probe-replay` 原字节重放。
  - 四个完整配置全部自然结束，合计 **49/49**，无名称过滤、无跳过；每组外层退出码均 `0`：

    | 完整配置 | 通过数 | Vitest / 外层耗时（秒） |
    | --- | ---: | ---: |
    | `tests/acceptance/t17-blackbox/live-vitest.config.ts` | 5/5 | 462.27 / 463.762 |
    | `tests/acceptance/t17-blackbox/vitest.config.ts` | 5/5 | 40.18 / 44.787 |
    | `tests/acceptance/phase3-plan.config.ts` | 25/25 | 79.20 / 86.452 |
    | `tests/acceptance/t16-installed.config.ts` | 14/14 | 725.76 / 731.766 |

  - 调用形式 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config',<完整配置路径>)`；原日志 SHA-256：live `e9e3c6683e9d80a0ebbbfa7c48fa462f2513c83e5adae21eb8d06770f39c9402`；installed `3afca47ea4c94b799e26ab9ccbd8030fce74f1dd5fc293a3a126c894aca5009a`；T15 `d0c5f41a5089f73dbb2f1fd2caac64c72dd66a8de66374e53feab77e7bdedcec`；T16 `03839c7cd5715c4e5f0c6e453d5e22a226ff3742580e520493aa389763fdf9c8`。T16 全量含 Next server-page 对照及生成代码构建，不以跳过 Next 缩短验收。
  - live 的 Vue/React × CLI/MCP 四条真实安装链均 `status=passed`、`visualResult=PASS`、`changedFiles=[]`、`pendingItems=[]`；视觉阈值 `pixelThreshold=0.1`、`maxDiffPixelRatio=0.001`，回归中未放宽。
  - T15/T16 原始输出与归档根 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/blackbox-0.0.22-e1c0ad94fa084e5ea3ec1f5f226e0401`；最终 live/installed 黑盒与追加 probe 根 `.../blackbox-0.0.22-312398cf718842fab1c07df2f40ec45a`。
  - SDK 自动错误脱敏追加探针：plain / JSON 转义两组合成环境令牌（不沿用实际凭据）；均完成 MCP initialize、四工具列表、未知 JSON key 的 strict 拒绝、未知工具 `-32602` 拒绝、错误后有效 inspect/list、stdin 正常关闭；两组自然 exit 0，非法帧 0；每组 stdout **4776 字节**，SHA-256 `4aa8179f7b0be8a11b916c589466cef82ab43e352279ae26df71c20bab607724`，stderr 0 字节。该 probe 独立列示，不增加 49 分母。
  - 文档交叉检查：对 `docs/phases/phase3/local-project-verification.md` 与实际安装 CLI `integrate --help`、MCP 原始 tools/list 只读比对，`impactingErrors=[]`；四工具均 `additionalProperties=false`（inspect/plan 只读、apply/verify 写）；无 repair MCP 工具；修复预算 `0/1/2`、默认 `2`；host-only applyGrant/verificationGrant；verify 的 operation 绑定。原始帮助存于最终黑盒根 `installed-cli-help.txt`、`documentation-cross-check.json`。
  - 采集失误保留（外置根 `blackbox-0.0.22-4f6fcde119a04f37935de7b667b76d6b`）：T15 首次采集器把 `.tools` junction 的 C 盘拼写与 D 盘规范路径直接比较，拒绝登记 recovery 根并提前退出（owner `9e962f70-68ba-4bba-9c9c-19b40b5c8c9a`，容器/卷均 0）；该根首次 live Vitest 实际显示 5/5、374.93s、12 个 receipt 且 `complete=true`，但排查期间父 PowerShell 被终止，外层退出码 **4294967295**（owner `b54e4221-e323-45f4-99d1-68807a776f8a`）；后续 T15 完整运行自然 exit 0、25/25。
  - 原字节归档：`final-original-archive-reopen.json` 为 172244 字节，SHA-256 `3b4d346514ecb5865735f15f123247b1897ba29fa8f1a28735617e1613754d38`，`failures=[]`、`passed=true`；合计 **336 个文件 / 3,188,592 字节 / 17 个 receipt / 28 个报告与基线引用**；T16 另按 9 个 `backupRef` 验证原始不可变 backup manifest 及文件名 SHA，补充归档 36 个备份文件。
  - 主线独立复读：`root-live-installed-original-reopen.json` 168 文件 / 1,747,473 字节 / 17 receipt，SHA-256 `baf454603ca8fb93aa741fe7a10c297a724c536614932be488a78097144ff7e0`；`root-plans-original-reopen.json` 4 archive / 168 文件 / 1,441,119 字节，SHA-256 `a5e421ba8fe1284834d778597660d6386f59e1768f7aa18f69af988388c2e00e`。
  - `final-owner-resources.json` 按 `infra/scripts/recovery-stack.ts` 的 `org.zhinexus.recovery` 标签检查本轮 live/T15/T16 及两次非最终诊断共五个 owner，容器 0、卷 0，SHA-256 `da8ec9829497bd171a0762d3e68cd4f1ecf37f3452e251706e9f1551b58e7da1`；`exact-owned-cleanup-manifest.json` SHA-256 `25176d7b06662e5807c39def1fa5e8331f2829b40ad8f0fe5e1b278a98819486`。
  - 授权的原生 PowerShell `Remove-Item -LiteralPath -Recurse -Force` 单次精确批次被自动审批在 CreateProcess 阶段拒绝，原因 `blocked by policy`，PowerShell 未启动、未执行任何删除；没有拆分命令重试、没有更换 Node 或其他删除 API。`exact-owned-cleanup-policy-blocked.json` SHA-256 `ae681e579584e68a9d71c2c22dbefd41b4bcc50ed701be86458d4405748b4a84`，`cleanupPassed=false`、`evidenceRetained=true`。本轮不能报告临时目录已清理。
  - 八个策略拦截后保留的根：`C:/Users/10208/AppData/Local/Temp/t17-d-live-C94XDQ`、`t17-d-blackbox-dL4Teo`、`zhinexus-t15-installed-QQY7Hr`、`zhinexus-t16-installed-VF79Eb`、`t16-d-AqrLQT`、`t17-d-0022-redaction-AQSE8T`，以及 `D:/project/zhinexus-design-asset-platform/.tools/recovery/76181669-7754-4a5b-b831-d554a85cf8fb`、`.tools/recovery/ff069d9c-b890-487d-8dc3-3af7ff39662c`。
  - 另有三个非最终 0.0.22 诊断目录继续保留：`C:/Users/10208/AppData/Local/Temp/zhinexus-t15-installed-jViDo5`、`t17-d-live-OF6zTY`、`.tools/recovery/9e962f70-68ba-4bba-9c9c-19b40b5c8c9a`；诊断 live 的服务 recovery 根 `.tools/recovery/b54e4221-e323-45f4-99d1-68807a776f8a` 已由测试内部删除。
  - 本子任务只新增本记录和仓外证据，忽略的 `.tools/t17-blackbox-0022-*.mjs` 用于采集与复读；未修改产品、测试、版本、锁文件或原始架构文档，未提交或推送。
- 结论与状态：完成（49/49 + 追加脱敏 probe）；清理被策略拦截而未完成。被 t17-cli-0022-regressions（05:15 追加）、t17-integration、t17-completion 引用与更新。
- 交叉引用：`t17-blackbox-2026-11-19.md`、`t17-blackbox-2026-11-20.md`（0.0.20）、`t17-cli-0021-regressions-2026-11-20.md`、`t17-host-0022-2026-11-20.md`、`t17-final-review-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-completion-2026-11-20.md`、`docs/phases/phase3/local-project-verification.md`、`tests/acceptance/t17-blackbox/README.md`。
- 过时或矛盾点：最终 live 首次外层退出码 4294967295 与 5/5 并存，不得解释为完整原会话 exit 0；本版 49/49 为 0.0.22 结果，后续被 R08 缺陷阻断为最终交付（见 05:38/05:55 追加）。

### t17-blackbox-0023-2026-11-20.md

- 日期／角色／主题：2026-11-20；D（消费者黑盒，Codex 子代理执行）；冻结 CLI 0.0.23 的 T15/T16、独立黑盒与异步断言回归。只记本轮新增事实，不替换 0.0.22 及更早记录。
- 目的：对 0.0.23 唯一冻结包完成四个完整配置回归 + installed 时序探针 + SDK 脱敏探针 + 十二根清理。
- 承重事实：

  - 唯一 CLI：`D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.23-edb985ec-b8f572a9/company-component-cli-0.0.23.tgz`，**454155 字节**，SHA-256 `93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab`；来源 HEAD `edb985ec0f9ee1b79a5882e935832f8caa9f0daf`。同目录唯一 `freeze-manifest.json` 为 **509 字节**，SHA-256 `4124d7b5117f761a8966b0837339fa63856833711b7e29bebe95f3f903cd9e8e`，`packCount=1`。本子任务没有执行 pack。
  - SDK manifest SHA-256 `04a7c4fb...`（199 独立文件 / 398 引用最终重新打开）；历史兼容输入 `c6182081...`。
  - 本轮证据根（下称 `E`）：`D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/blackbox-0.0.23-149723fbbfc949a281aa3e7e42e0028b`；`E/inputs.json` 不预置 tarball 身份；`E/review-handoff.json` 22449 字节，SHA-256 `ea551d1ba6c05c36839e7070e76c3517fbb42388f5d120ac69c30df38b7da152`。
  - 两个 lane 各有新建的 `TEMP/TMP` 子目录，未扫描或收养旧临时根；所有 CLI 安装消费同一冻结 tarball 并关闭安装脚本。
  - 四个完整配置合计 **49/49**，无名称过滤、无跳过，测试子进程均 `exitCode=0`、`signal=null`，采集错误 0：

    | 完整配置 | 通过数 | Vitest / 外层耗时（秒） |
    | --- | ---: | ---: |
    | `tests/acceptance/t17-blackbox/live-vitest.config.ts` | 5/5 | 700.65 / 702.604 |
    | `tests/acceptance/t17-blackbox/vitest.config.ts` | 5/5 | 28.32 / 30.891 |
    | `tests/acceptance/phase3-plan.config.ts` | 25/25 | 61.78 / 68.583 |
    | `tests/acceptance/t16-installed.config.ts` | 14/14 | 941.24 / 947.442 |

  - 原始外层工具会话自然结束：blackbox lane 会话 `15501` 退出 `0`（live → installed）；plans lane 会话 `14548` 退出 `0`（T15 → T16）；观察记录 `E/outer-blackbox-session.json`、`E/outer-plans-session.json`。四份原日志 SHA-256：live `ce2f816dc1a9a4b8e16f1b367394ce2f2358810ee2298e1ead6d4a3a9988aece`；installed `18d72ee3bf172d40235af8dfd82969155e2e0c73ccf6e86678bd0e85d3a98ad6`；T15 `bec975d0f35783fbdb368dba5c6289b4a36fe81825040f69ddb90aea3410d06b`；T16 `65e8d1b16c6e823b292c39a901fee49354ee1c58a8c60a6f554bdd5a1a8f4856`。
  - T16 含 Next server-page 对照构建和生成代码构建，两者原始记录均退出码 0；另验证九个不可变 `backupRef` 对应的原始版本化 manifest 及其文件名 SHA。
  - installed 异步断言探针（最终 attempt4）位于 `E/installed-async-assertion-probe-attempt4`，原始会话 `83087` 自然退出 `0`，`result.json` SHA-256 `a1e5e1ae7e7afd2567573b782ddccc3493880ae5e56389bb11578f26639b78db`；从仓外路径导入公开 `verifyIntegration`：`C:/Users/10208/AppData/Local/Temp/t17-blackbox-0023-149723fbbfc949a281aa3e7e42e0028b/probes/t17-d-0023-timing-7TcSrX/cli/node_modules/@company/component-cli/dist/index.js`；安装后、各产品调用后和最终审计均核对冻结 tarball 全部 **306 个 dist 文件**原始字节（`installed-dist-comparison.json`）。
  - 探针时序（产品调用结束时距服务端收到点击观察事件的墙钟值，含断言后环境与截图工作）：

    | 产品条件 | 预期 / 实际 browser check | 点击观察至返回（ms） | overall / visualResult |
    | --- | --- | ---: | --- |
    | 同步更新 | passed / passed | 130 | failed / NEW |
    | 延迟更新 1 | passed / passed | 360 | failed / NEW |
    | 延迟更新 2 | passed / passed | 383 | failed / NEW |
    | 永不满足负对照 | failed / failed | 1620 | failed / not-run |

    声明的断言超时为 1500ms。三个正对照未提供独立批准的视觉基线，明确为 `VISUAL_BASELINE_MISSING`、`visualResult=NEW`；另两次直接浏览器参照实际观察 `pending → done` 分别等待 267ms、284ms。**四个产品条件与两个独立参照单列，不增加完整配置的 49 分母。**
  - SDK 脱敏探针 `E/sdk-error-redaction-probe`：原始会话 `83312` 自然退出 `0`；每组 stdout 4776 字节，SHA-256 `a7ba46d5bc38616066508ba8ec15c8d32a67a2edf73e96bc0343a0a27f60fad9`，stderr 0 字节；`result.json` SHA-256 `4eed17c440bd9a07b6dc90d6fe8f95f09e4d55910a07503613b6230cb391f839`；泄漏 0。
  - 三次非最终尝试全部保留：attempt1（会话 `34439`，exit 1）Node 直接加载 TS fixture 无法解析其内部 `match-plan.js` → `.ts` 引用，尚未启动浏览器；attempt2（会话 `52400`，exit 1）CLI 安装树已加载 Playwright，助手再加载工作区测试包触发重复加载保护；attempt3（会话 `52211`，exit 1）四个产品 browser 条件均符合预期，独立参照因库加载后才设置浏览器目录找不到默认 AppData 浏览器。三份非最终 `result.json` SHA-256 依次 `686f58a91228c30ab7224d294470ee5fc4b52a3fce92dd24ecd8ed13f0e9e3cb`、`16b51808c3c5a81a7d6fb6399043f0b05b222af851f301ad6511120037ec24dc`、`a3ecf6915ae3f2377b7116ded378e6900de1e1fd8c4c85a61abc6ddb99388f35`。`E/timing-probe-selection.json` 明确选择 attempt4，SHA-256 `1a37441c917715b9942422d91e2a8b615894aa3e906a636bd9c0a53bb55348be`。
  - 原件/副本审计：`E/final-original-archive-reopen.json` 263161 字节，SHA-256 `15c10beca470e2da0586ca3cae7a70db7f4a81f3154148ac50c3a742cdeb9fce`，`passed=true`、`failures=[]`；完整配置证据合计 **336 个文件 / 3,283,651 字节 / 17 个 receipt / 28 个报告与基线引用**；五组原件归档分别为 live 159 文件、installed 9 文件、T15 5 文件、T16 140 文件、T16 D recovery 23 文件。独立探针与诊断另归档 74 文件、48977 字节，索引 `E/supplement-original-archives.json` SHA-256 `30f0eb4e2a8bd2a43bd8b58b9876574e4932ed6b71c7d3dfe103b88e9cff5468`。
  - 三个 owner：`68303d2e-aa98-463e-91f6-dc52b4207623`（live）、`67704d3b-879c-4520-971e-d057fa2dd827`（T15）、`63291e68-7211-4a3f-98b2-3fb3e0b144e9`（T16），容器 0、卷 0；精确路径活动进程 `[]`，扫描退出 0；未停止或收养既有 5432/9000/9001 监听服务。
  - 主线独立复读：410 份索引原件与副本、共 **3,332,628 字节**，12 个新根、**82,840 条**身份与目录集合；`E/root-all-original-copy-byte-reopen.json` SHA-256 `5ee88fccfc0e64ff1756cda485bfdb590c06b3bba4a869b70540d26695a4cee6`；`E/root-cleanup-inventory-reopen.json` `bdd1a80625900734e6976dc00c6463584d03af972369965afe8e2e9facd7b9ad`；`E/root-canonical-business-and-timing-reopen.json` `51d1c4a668fcb4e31c8afb92c00bb550036871764272acc6492caa83e6e9eb59`。
  - 主线复算助手两次错误预期保留：第一次误将 React 实际 5 项依赖按 Vue 的 4 项检查；第二次误将永不满足 browser 负对照的 visual 预期写为 `NEW`（原报告实际应为 `not-run`）。两次均 exit 1、执行产品测试 0、未写成功索引；不属于产品 RED，也不新增测试分母。
  - 清理：`E/exact-owned-cleanup-manifest.json` 40295707 字节，SHA-256 `5ac357deaa53bc1e89ecff84b7acff62cfa120ae74aef621ee49b18ca861d4e2`（12 个精确新根、82840 条不跟随链接的全树路径/类型/BigInt 身份记录）；`E/native-cleanup-before.json` 3550 字节，SHA-256 `c4c4ce0e010d6bce64756d89fadc39a61c10cb3eef8ec25a6d8146c92c3f0145`；一次 PowerShell 7.6.9 原生批次只对这 12 个精确新根执行 `Remove-Item -LiteralPath <精确根> -Recurse -Force`，外层会话 `97369` 自然退出 `0`，结果 `deletionCalls=12`、`deleted=12`、`remaining=[]`、`failure=null`、`passed=true`；`E/native-cleanup-result.json` 2892 字节，SHA-256 `08caebc73a7898631c6bb8541988969ff282f5d0c30e7f533db815d7991bd36c`；`E/outer-native-cleanup-session.json` SHA-256 `1ba86995b71b9852184ba4decb324d5d5bbec111a4882082a143b18737caa505`。旧 0.0.22 及更早被策略拦截的路径不在本轮候选，未触碰、未重试或换 API 删除。
- 结论与状态：完成（49/49 + 双追加探针 + 12 根精确清理成功）。为 0.0.23 最终交付的黑盒依据；被 t17-cli-0023-regressions、t17-integration、t17-completion 更新引用。
- 交叉引用：`t17-blackbox-0022-2026-11-20.md`、`t17-cli-0023-regressions-2026-11-20.md`、`t17-async-assertion-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-completion-2026-11-20.md`。
- 过时或矛盾点：probe 的 overall 为 failed（缺视觉基线），不得冒称完整业务通过；attempt1–3 的失败均为助手环境问题，不是产品 RED。

### t17-blackbox-2026-11-19.md

- 日期／角色／主题：2026-11-19；D（消费者黑盒）；T17 冻结 CLI/MCP 黑盒验收支架进度。状态：**未完成，未验收 T17**；只记 D 验收支架现状，不把支架回归冒称产品门槛通过。
- 目的：搭建冻结输入校验、路径快照安全、冻结包安装 smoke test 与真实 stdio 支架。
- 承重事实：

  - 新增 `tests/acceptance/t17-blackbox/global-setup.ts`：启动隔离服务前要求绝对路径冻结 tarball、64 位 SHA-256 和 npm CLI；校验字节摘要与 Node `v26.13.0`；缺少或不匹配立即失败。
  - 新增冻结包安装 smoke test：安装到仓库外干净消费者，以实际安装的 `dist/bin.js --version` 验证可运行版本，并确认没有私有 `@company/contracts` 运行时依赖。
  - 修复支架 `snapshotTree()` 漏导入 `readlink` 的缺陷；新增 junction 快照回归用例（只记录链接、不递归读取目标）；新增真实 stdio 子进程 JSON-RPC 往返与正常关闭支架回归。
  - 支架运行说明见 `tests/acceptance/t17-blackbox/README.md`。
  - 验证结果表：`build:services` exit 0、5/5 Turbo；`build` exit 0、10/10 Turbo；根 `tsc -p tsconfig.json --noEmit` exit 0；support 配置导入修复前 exit 1、1 failed（真实复现 `ReferenceError: readlink is not defined`），修复后 exit 0、2/2；preflight 配置 exit 0、2/2；`vitest.config.ts`（必需变量未设置）exit 1，global setup 明确报缺 `T17_D_CLI_TARBALL`、在启动隔离服务前失败、无 skip。
  - 曾在尚无 `build:services` 产物时运行旧配置，失败原因是 platform global setup 导入缺失的 `apps/api/dist/db/database.js`；本轮先运行 `build:services` 并让冻结输入校验发生在服务启动前，此前失败保留为配置前置条件问题。
  - 当日支架回归补充：support 配置 exit 0、**5/5**；preflight exit 0、**3/3**；`-PnpmArgs @('typecheck')` exit 0（5/5 服务构建/检查 + 14/14 workspace typecheck，Turbo 均缓存命中，随后根 tsc 无错误）；`node --check tests/acceptance/t17-blackbox/support.mjs` exit 0；`git diff --check` exit 0；四冻结输入环境变量均未设置时 `vitest.config.ts` exit 1（fail-closed 预期，不是产品用例通过）。
  - 首次完整工作区 typecheck 暴露 `cleanEnvironment()` 声明把无 `undefined` 的返回值误写为 `NodeJS.ProcessEnv`，导致 MCP SDK `env` 入参不兼容；改为 `Record<string,string>` 后复跑通过。新增 preflight 测试后又发现 ESM import 未带 `.js` 扩展名，修正后通过。
  - `installed.spec.ts` 对无效 `{}` apply/verify 参数仅证明结构拒绝，不足以证明真实有效计划必须授权才允许写入；该文件仅列出并连接 MCP 工具，尚未真正调用 `plan_integration`。
  - 尚缺证据：本轮没有可供 D 使用的 T17 冻结 CLI tarball 路径与 SHA；D 当前验收工作树基线只有 T16 `integrate inspect/plan/apply/rollback`，T17 verify/repair 与 MCP 四工具尚未出现在本轮实际安装并运行的冻结 tarball 中；host runner 正在整合仓外临时 Vue/React 项目桥和证据封存 API，其稳定模块尚未接入本工作树；尚未执行 verify/repair 行为分类、stdout JSON 纯度、MCP 权限拒绝与 CLI/MCP 一致性、取消/退出进程清理、双框架案例矩阵。
- 结论与状态：阻塞/未完成（支架就绪但无冻结包）。被 t17-blackbox-2026-11-20（0.0.20）及后续 0022/0023 更新为真实产品黑盒结果。
- 交叉引用：`tests/acceptance/t17-blackbox/README.md`、`global-setup.ts`、`support.mjs`、`preflight.vitest.config.ts`、`vitest.config.ts`、`installed.spec.ts`、`live.spec.ts`、`t17-host-runner-2026-11-19.md`、`t17-matrix-2026-11-19.md`。
- 过时或矛盾点：全部结果为支架层面；不得引用其支持任何产品行为通过。

### t17-blackbox-2026-11-20.md

- 日期／角色／主题：2026-11-20；D（消费者黑盒）；冻结 CLI **0.0.20** 独立黑盒验证。不改写 `t17-blackbox-2026-11-19.md` 或 README 中保留的 `.19` 历史结果。测试从仓库外独立 npm 安装冻结 tarball，以原生 Node 子进程和真实 MCP SDK 驱动已安装入口，不导入 CLI 产品源码。
- 目的：首次对真实冻结 CLI 0.0.20 完成仓外安装的 live + legacy 黑盒。
- 承重事实：

  - 冻结输入表：CLI `@company/component-cli@0.0.20`；tarball `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.20-b8cafdf7-dc09-424a-bcc4-f36023f7916d/company-component-cli-0.0.20.tgz`；tarball 字节 **451327**；tarball SHA-256 `8d56d87e9cc832562c096ba8cd16504ffb5104e688ca8a3df9436447df6c4252`；sourceHead `85c57fc8b7eb612a4091a831a754efd410096435`；SDK 根 `.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`；SDK manifest SHA-256 `04a7c4fb...`；SDK 版本 core `0.0.11`、Vue/React `0.0.12`；历史兼容证据 SHA-256 `c6182081...`。
  - 本轮不执行 pack；安装前、用例间与结束时复核同一 tarball；安装禁用生命周期脚本，使用空白 npm 用户/全局配置，tarball 入口与安装入口字节一致；SDK manifest 全部 199 个文件在归档审计时重新打开校验。
  - 兼容记录通过真实本地 `/compatibility` API 原样接收 2026-11-16 的 CLI `0.0.11` 探针（含 56 张 PNG），不是 `.20` 新生成的兼容探针。
  - 两个真实入口均于本地时间 **2026-11-20 02:28:56** 启动，使用各自仓外安装消费者。
  - 启动环境变量：`T17_D_CLI_TARBALL`、`T17_D_CLI_SHA256`、`T17_D_CLI_VERSION`、`T17_D_NPM_CLI`（`Resolve-Path '.tools/node-v26.13.0-win-x64/node_modules/npm/bin/npm-cli.js'`）、`T17_D_SDK_BUNDLE`（取自 `.tools/sdk-label-acceptance-8929ffb81fcf4c90b98352c5f8afbed1/sdk-freeze.json` 的 root）、`T17_D_COMPATIBILITY_EVIDENCE`、`T17_D_COMPATIBILITY_SHA256`。
  - 配置结果表：

    | 配置 | 实际结果 | 用时 |
    | --- | --- | --- |
    | `support.vitest.config.ts` | 7/7 passed，exit 0 | 903 ms |
    | `preflight.vitest.config.ts` | 4/4 passed，exit 0 | 467 ms |
    | `live-unit-vitest.config.ts` | 2/2 passed，exit 0 | 215 ms |
    | `live-vitest.config.ts` | 5/5 passed，exit 0 | 405.72 s |
    | `vitest.config.ts`（legacy installed） | 5/5 passed，exit 0 | 70.66 s |

  - live 五个用例含 Vue/React × CLI/MCP 四条独立成功链和四链语义对照；每条链经过真实本地 PostgreSQL/Verdaccio/MinIO/API 获取、apply、原生类型检查与构建、本地 Chromium 行为和视觉检查；四份 spec 显式使用 `pixelThreshold=0.1`、`maxDiffPixelRatio=0.001`，均为 passed、视觉 PASS、无 pending。
  - 同轮保留：有效真实 plan/spec 的无 grant apply/verify 拒绝；Vue/React 行为失败后无 recipe 的 `stopped`（零次修复、源文件未变）；真实 MCP `notifications/cancelled`。取消用例观察原生 Node 父/子/孙三个标记进程及实际父子关系，确认它们在关闭 MCP 服务前退出、随后服务仍响应；未扩写为逐一观察所有 npm/cmd 中间进程。无 grant 与 no-recipe 只计边界证据，不计成功修复。
  - legacy 五个用例只证明安装身份、缺输入拒绝、contracts 有效输入的授权拒绝、endpoint 拒绝和 CLI/MCP inspect 对照，不计为真实接入成功链。
  - 归档：live 原始根 `C:/Users/10208/AppData/Local/Temp/t17-d-live-BepWf1` → 稳定归档 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/blackbox-live-0.0.20-4c17068513014bbb9c596a3b0da01177`；legacy 根 `t17-d-blackbox-Nglnrj` → `blackbox-installed-0.0.20-8e254e018b2540e78599701c7f4ae9dd`。两份归档均含 `run.log`、`exit-code.txt` 和独立 `retained-evidence-audit.json`；live 复制 159 份源证据文件，排除临时工程、安装 CLI、npm 缓存与配置；12 份原/复制 receipt 全部按索引复核 SHA-256 与字节。含 audit 自身的最终 JWT 形态扫描为 live 148 个文本文件、legacy 11 个文本文件，均 0 命中。
  - `live-receipts.json` `complete=true`；`live-final-cleanup.json` 为 passed（四条 completed/expected 链完全一致、`ownedProcessTreesCleaned=true`、`servicesClosed=true`、`cleanupFailures=0`）；owner `b99968fb-48a3-4721-be06-d0aa5753ae3b` 的 recovery 根已移除，`docker ps -aq --filter label=org.zhinexus.recovery=b99968fb-48a3-4721-be06-d0aa5753ae3b` 与对应 `docker volume ls -q` 均为空；legacy 安装消费者已移除，TEMP 下无本轮 `t17-d-owned-cases-*` 残留。
  - 集成方独立复核：2026-11-20 03:00 再次执行 support、preflight、live-unit 三个独立配置，分别 7/7、4/4、2/2，均 exit 0；此前已逐个重新打开 live 的 159 个及 legacy 的 8 个归档文件校验摘要和字节，结果保存在仓外 `blackbox-0.0.20-root-recheck.json`；提交前再次读取冻结 tarball SHA-256 仍为 `8d56d87e…f6c4252`。
- 结论与状态：完成（0.0.20 五配置全绿 + 集成方复跑）。被 t17-cli-0020-regressions、t17-integration 与后续 0021/0022/0023 版本取代为历史轮次。
- 交叉引用：`t17-blackbox-2026-11-19.md`、`t17-cli-0020-regressions-2026-11-20.md`、`t17-integration-2026-11-20.md`、`tests/acceptance/t17-blackbox/README.md`、`docs/phases/phase3/local-project-verification.md`。
- 过时或矛盾点：live-unit 配置（2/2）在后续 0021/0022/0023 轮的四配置口径中不再单列。

### t17-c0-current-evidence-2026-11-20.md

- 日期／角色／主题：2026-11-20；C（平台/契约）；C0 当前依赖、SDK 与 stdio 补充证据。只读取证，不重建 2026-11-19 的原始 P0，不追认未定位的初始 RED；没有重新安装、构建、打包或重复运行通过的测试；新增内容仅为本文件。
- 目的：以只读方式固定当前精确依赖、实际安装包导出/类型、strict schema 拒绝与已有完整日志。
- 承重事实：

  - CLI 为 0.0.21，来源 HEAD `3fbcfa9b66900c55e254f15e73f318055c6a104f`；tarball `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.21-432a7805-4921-4c7d-a07d-029bbf7ed010/company-component-cli-0.0.21.tgz`，**451414 字节**，SHA-256 `7dd4874f0e6c98caddb2de959b942d7bde463c35a04ba82fe31ec67140f5f7cd`。
  - 只读差异检查（退出码 0、无输出）：`git diff --exit-code 3fbcfa9b -- pnpm-lock.yaml package.json packages/component-cli/package.json packages/component-cli/src/mcp/server.ts`。
  - 精确依赖：CLI 清单运行时依赖精确为 `@modelcontextprotocol/server` **2.4.0** 与 `zod` **4.6.7**；根清单测试客户端精确为 `@modelcontextprotocol/client` **2.4.0**。`pnpm-lock.yaml` 根 importer 第 175–177 行、CLI importer 第 432–449 行、第 3359–3376 行依赖快照共同固定 client/server/core 2.4.0 和 zod 4.6.7。
  - 实际读取 node_modules 版本：server 2.4.0、client 2.4.0、zod 4.6.7。server/client 均声明 Node >=20，未声明 peerDependencies；两者对 zod 上游范围为 `^4.2.0`，本仓解析为 4.6.7。不能把普通依赖范围误称为 peer，也不能据此声称验证过所有 Node >=20 环境。本地包元数据均指向 modelcontextprotocol/typescript-sdk repository 与 modelcontextprotocol.io homepage；未重新打开官方网页。
  - 文件摘要表：`pnpm-lock.yaml` 157340 / `ef4ae8928503b090d4b7170fdd9891f5ebbf06f0d882ba9f9ddd47a106db10e2`；`package.json` 3136 / `1c392334619e65645ff87eb8848e68ddbc77f5ecfdacd1d171255b683de71675`；`packages/component-cli/package.json` 959 / `26f8e0c3ce4db47151f9531aced795e30252a451cb69a73a4602dfb8e347470f`；`.../node_modules/@modelcontextprotocol/server/package.json` 5102 / `c82767fbf0247c56e39a2b757245d56109a538a12ea0b6162fd65a1d3c0a3c52`；`node_modules/@modelcontextprotocol/client/package.json` 4941 / `a93ec75fda93a16032c092b30a36d16c7ade5eab6306ef429dce3e80ae53af45`；`packages/component-cli/node_modules/zod/package.json` 4142 / `c2d190d9ee4e0bdb60332aaa2130a6a98d65ddb903fe1d29248b15de57832c45`。
  - 导出与类型：两个 MCP 包 exports 将根 ESM 入口映射到 `dist/index.mjs`、声明映射到 `dist/index.d.mts`，`./stdio` 映射到 `dist/stdio.mjs` 与 `dist/stdio.d.mts`，CJS 分支亦在清单声明。server 根声明导出 `McpServer`（`dist/mcp-BCJHyo7l.d.mts` 第 3246 行），第 3373 行提供接受 schema 对象的 `registerTool` 重载；stdio 声明第 62 行导出 `serveStdio(factory, options)`。client 根声明导出 `Client`（`dist/client-BTIWJvaF.d.mts` 第 551、703、1082、1110 行分别定位类、connect、callTool、listTools）；client stdio 声明第 54 行 `StdioClientTransport`、第 62 行接受子进程启动配置。zod 根 ESM/类型入口为 `index.js` 与 `index.d.cts`。
  - 实际安装文件摘要：server `dist/index.mjs` 70276 / `ab7434003c94a09e2c7dec6765647ed600104ad4ebcd347f574dab94f52fcf8d`；`dist/index.d.mts` 52051 / `c5ed30a09923a42ff6e76c9c75311309ef0ac695762201995fc88b431ecad102`；`dist/mcp-BCJHyo7l.d.mts` 194542 / `e69a8b3811163e31e8f328fbab63b25cbabd8eb3ea67b4bf4c0ee9d2075d4801`；`dist/stdio.mjs` 22199 / `892fcad4d0e0c7fa11a88dd769353e298b6d2b445ad833790d16b063e199b10d`；`dist/stdio.d.mts` 4678 / `fe3a52eab97b6b366c09d83fea89d269d80daa5e5170f0561c250905206aed10`；client `dist/index.mjs` 79439 / `b78923b9b9d342109f4fc2a03a9dcea7241fbb89bb2943ec4c9f05a23891b1cf`；`dist/index.d.mts` 128399 / `314d358ab8a1a2a36d984e4bb5768c8a14ee9680ac80b37233a3c3b3b39d0468`；`dist/client-BTIWJvaF.d.mts` 57634 / `9e8a7724bca48a1b774a35ffc324d57674b714055949cbd5902060086df290a8`；`dist/stdio.mjs` 6153 / `d44adf6ca40eb7a9cafb35dec9658de2b9e17c7dea6be01c06fb8e0d594dc211`；`dist/stdio.d.mts` 3360 / `332c24a1f3cbbadab8b02c469cce53f5ff091faf2e1cbeed5c623f133e0c0fca`；zod `index.js` 422 / `32e7efd49a94a765f6d10a1a0a3c02c50c246def17c80c6f0225f85525d98505`；`index.d.cts` 119 / `31506fd6e72c0d09e082b2f0b3741e6bbe90670361c9560ef998bdb1e56edc3e`。
  - `packages/component-cli/src/mcp/server.ts` 第 13–14 行按这些包名导入 `McpServer`/`serveStdio`，第 185、214、257、310 行注册四工具，第 398 行将创建服务器的工厂交给 `serveStdio`；宿主配置使用 strict schema。
  - 已有完整根命令：2026-11-20 **03:47:04 至 03:56:59**，T10 **168/168**、零跳过；Vitest **121 文件、2187/2187**、594.49 秒、exit 0；`test` 本身没有进入 Turbo 缓存；日志首行实际展开为 `pnpm build:services && pnpm test:t10 && vitest run`。
  - 根 Vitest 配置包含 `tests/**/*.test.ts`，仅排除 `tests/platform/**`，因此 `tests/integration/project-mcp.test.ts` 属于该次完整运行范围。其第 231–244 行创建 SDK `StdioClientTransport`、启动 CLI 子进程并 await `Client.connect`；第 252 行断言仅有四工具、verify 不声明只读、额外 approval 字段返回 Unrecognized key、越根请求被拒绝、未绑定或未允许的 endpoint 不发请求、缺失 apply/verify grant 被拒绝；第 358 行覆盖授权全链与 CLI 语义；第 589 行覆盖真实取消与脚本进程树。该日志使用汇总 reporter，没有逐用例名称输出。
  - 冻结 CLI 的独立 live 配置实际 5/5、exit 0、**543.99 秒**；legacy 安装/拒绝配置另为 5/5、exit 0、**30.60 秒**，两者无名称过滤。
  - 外置证据摘要表：`cli-0.0.21-.../freeze-manifest.json` 528 / `bdc7a3c6bff0d634bd2068ef5d0891f39bc62b4dd2e5c3d47663f11b45e4de26`；`full-test-0.0.21-final-3477abf8131947849354b18116cc239f/test.log` 20345 / `219a8b3c79ef689ef0d5376ca8634768a3a49c64b27b75cd2c524ef49e8ea5c2`；同目录 `result.json` 77 / `38df0e52d720c19de9b6e7c8b39a27c1a40f48b5651c393fbe96be0b96f8028f`；`blackbox-0.0.21-1795115999104/live.log` 230 / `abec7861accb33ef3aecfd6c4cffcb6a1d3e095a6306c8d13e3bfb8657ea3fa4`；`installed.log` 243 / `c39b31c2a7aba81de121e26003864f0d6fa04e78eb9bbf2b5225a0a4c16e061e`；`result.json` 378 / `737c72dc541a66c609ee47d5a80bafec497fcd14b8813436e0a0dbace0b7e394`；`final-independent-reopen.json` 5271 / `d1ffbff630c5f1a8623fc6d5df1535c00b06a126160bb9e43679a6f7c0ca5a46`。
  - `final-independent-reopen.json` 将同一冻结 CLI 绑定到五份归档 manifest、**295 份**原件/副本和 **17 receipts**（live 158 文件/12 receipts、legacy 8 文件/5 receipts，余者为 T15/T16）；CLI 前后 SHA 相同，**281** 个文本 JWT/Bearer 形态扫描为零。
  - 产品/测试源码摘要：`packages/component-cli/src/mcp/server.ts` 16160 / `79aec1b0b18628317583e309b1161eab7023e40403fa663f62343ee588365f6e`；`tests/integration/project-mcp.test.ts` 29473 / `dc73c9710ab3a67dd4530e30a3ecf2ad902d4c8a8bcc393d742f7ec45653499d`；`tests/acceptance/t17-blackbox/live.spec.ts` 30377 / `9ce6408acd2bbee088de3857807455e2d873967647eb19c0b44595d938edf5b6`；`installed.spec.ts` 15123 / `2acab03d34f1a452ce24b05f121c13c83663112c365714fba1939aeae001c171`。
  - 实际执行 `Get-Content`、`rg -n`、`Get-FileHash -Algorithm SHA256` 与上述 git diff，只读检查命令退出 0；所有表格摘要来自文件原始字节，未从 Git 文本规范化结果计算。
  - 对 docs/verification、T17 设计/计划及可见 operations/外部证据目录的搜索未定位到原 P0 独立日志；`5a172921` 契约提交本身也未包含该记录。
- 结论与状态：完成（只读取证）。被 t17-c0-official-supplement / t17-c0-official-correction 补充与限定；被 t17-mcp-sdk-redaction 指出 SDK handler 前自动校验可绕过产品脱敏。
- 交叉引用：`t17-cli-0021-regressions-2026-11-20.md`、`t17-c0-official-supplement-2026-11-20.md`、`t17-c0-official-correction-2026-11-20.md`、`t17-mcp-sdk-redaction-2026-11-20.md`、`docs/specs/2026-11-19-phase3-t17-design.md`。
- 过时或矛盾点：仅覆盖 CLI 0.0.21；原 P0 独立日志、原初 RED 完整执行顺序与原始 stderr 空字节仍未追溯。

### t17-c0-official-correction-2026-11-20.md

- 日期／角色／主题：2026-11-20；C/综合；官方来源访问记录更正与补验。纠正提交 `8121f180` 中「官方来源后补核验」的访问范围表述；保留原记录，以本次独立更正限定结论。
- 目的：撤回"四页均已实际打开核验"的不实表述，重新逐页取得可读正文。
- 承重事实：

  - 原记录声称四页均已实际打开核验，但当时可追溯工具输出仅有官方域检索和一个未取得可读正文的打开请求，不能支撑该说法；该段属于证据记录错误。
  - 本次重新通过网页工具逐页取得可读正文，过程发生于 **2026-11-20 04:19–04:20（Asia/Shanghai）**，不能倒推原 P0 或原记录编写时已完成访问。
  - 四页读取结论：

    | 官方页面 | 正文范围与结论 |
    | --- | --- |
    | `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports` | 正文 329 行，stdio 段 121–139：客户端启动子进程，UTF-8 按行 JSON-RPC，stdin/stdout 只传协议，stderr 可供日志 |
    | `https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/serveStdio.html` | 正文 60 行，30–49：serveStdio 创建并连接传输，服务器就绪后返回；legacy 默认 serve 支持列出的 2025 协议，strict 默认 connect 仅支持其列出的更新协议 |
    | `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md` | 正文 615 行，454–461：独立 server 与 client 包；server 根导出 McpServer，server/stdio 导出 serveStdio |
    | `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/index.md` | 正文 623 行，460–482 示例：McpServer、registerTool、serveStdio 基本组合；不能据示例推断本产品严格校验、脱敏或授权已正确实现 |

  - 网页为当前线上文档，不能替代锁定版本 2.4.0、zod 4.6.7 的本地导出、字节和真实 stdio 测试。
  - 最终源码审查另发现 SDK handler 前自动校验回复可绕过产品脱敏，正在独立修复，既有四工具通过不覆盖该问题。
  - 原 P0 独立日志、原初 RED 的完整执行顺序及原始 stderr 空字节仍未补齐，本次不追认其存在，也不宣告 T17 已完成。
- 结论与状态：完成（更正）。是 t17-c0-official-supplement 的权威替代口径。
- 交叉引用：`t17-c0-official-supplement-2026-11-20.md`、`t17-c0-current-evidence-2026-11-20.md`、`t17-mcp-sdk-redaction-2026-11-20.md`。
- 过时或矛盾点：直接推翻 t17-c0-official-supplement 的"四页均已实际打开"表述（该文件保留但被限定）。

### t17-c0-official-supplement-2026-11-20.md

- 日期／角色／主题：2026-11-20；C；C0 官方来源后补核验。控制方在本日实际通过网页检索和打开官方来源补核 stdio 与 SDK API。不重建原 P0 的访问记录、初始 RED 或探针 stderr，也不更改依赖、产品或冻结包。
- 目的：补核当前实现采用的 MCP stdio 规范与 SDK API。
- 承重事实：

  - 四页实际打开的官方来源与核对内容：`https://modelcontextprotocol.io/specification/2025-11-25/basic/transports`（stdio 由客户端启动子进程，stdin/stdout 传输按行分隔的 UTF-8 JSON-RPC，stdout 只承载协议消息，stderr 可承载日志；仅核该版本 stdio 规则，不把产品说成 HTTP MCP 服务）；`https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/serveStdio.html`（serveStdio 接受服务器工厂并管理连接传输与关闭；legacy 默认 serve 可接纳 2025 年协议的开场）；`https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md`（server 根入口 McpServer、server/stdio 子路径 serveStdio、独立 client 包）；`https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/index.md`（v2 示例通过 McpServer.registerTool 注册 schema 再交给 serveStdio）。
  - 线上 SDK 文档覆盖的协议能力可能多于本项目显式验收范围；没有升级到线上其他版本，没有据文档存在宣称所有导出分支或协议版本已运行，也没有把类型声明或官方示例代替当前真实进程结果。
  - 当前 CLI 0.0.21 的实际 stdio、授权、取消与规范化对等，以完整根测试 **2187/2187** 和冻结 live/legacy 各 **5/5** 为据。
  - 原 P0 独立日志、原初 RED 的完整执行顺序及原始 stderr 空字节仍列为历史追溯缺口。
- 结论与状态：过时（访问范围表述被 t17-c0-official-correction 认定为证据记录错误并更正）。
- 交叉引用：`t17-c0-current-evidence-2026-11-20.md`、`t17-c0-official-correction-2026-11-20.md`、`t17-cli-0021-regressions-2026-11-20.md`。
- 过时或矛盾点：与 t17-c0-official-correction 矛盾（后者明确前者的"四页均已实际打开"不成立）。

### t17-cli-0020-regressions-2026-11-20.md

- 日期／角色／主题：2026-11-20；C（集成方）；冻结 CLI **0.0.20** 回归记录。复用一次冻结的 `company-component-cli-0.0.20.tgz`；SDK core 0.0.11、Vue/React 0.0.12；未重新 pack CLI 或 SDK。
- 目的：对 0.0.20 完成工程全图、平台、浏览器、T15/T16 与完整根测试回归。
- 承重事实：

  - tarball 451327 字节，SHA-256 `8d56d87e9cc832562c096ba8cd16504ffb5104e688ca8a3df9436447df6c4252`；SDK manifest SHA-256 `04a7c4fb...`。安装验收设置 `PHASE3_CLI_TARBALL`、`A10_FROZEN_BUNDLE`、`ZHINEXUS_SDK_BUNDLE_DIR` 及历史 `INSTALLED_CLI_EVIDENCE`。
  - 结果表：

    | 实际命令参数 | 结果 | 仓外证据目录 |
    | --- | --- | --- |
    | `exec turbo run build typecheck --force` + 根 `tsc -p tsconfig.json --noEmit` | 全图 **20/20**、0 cached、exit 0、18.103 秒；tsc exit 0 | `workspace-0.0.20-8d4edd6643ed45c2ac85c3a8ac6c123f` |
    | `test:browser` | **288/288**，exit 0、约 3.2 分钟，含六项真实三存储网页提交 | `browser-0.0.20-bbcc80e8085e4dfa881798fe345ecdf9` |
    | `exec vitest run --config tests/acceptance/phase3-plan.config.ts` | T15 **25/25**，exit 0、58.86 秒 | `t15-t16-0.0.20-80b1dcebfc144e2291c6e29baf206932` |
    | `exec vitest run --config tests/acceptance/t16-installed.config.ts` | T16 完整 **14/14**，exit 0、786.02 秒，含 Next App Router、无用例名过滤 | 同上 |
    | `test`（首次完整） | T10 **168/168**、0 skipped；Vitest **2123 passed / 3 failed**，120 文件，exit 1、727.53 秒 | `full-test-0.0.20-03f61ce2b451435db4756dd1fc50767d` |
    | `test:platform`（首次） | 135 passed / 2 skipped，exit 0；两项真实画廊未设置环境而跳过 | 同上 |
    | 设置 `PHASE2_GALLERY_ORIGIN=http://127.0.0.1:5173` 的完整 `test:platform` | 35 文件、**137/137**、0 skipped，exit 0、388.94 秒 | `platform-0.0.20-complete-19d6684d4b004bceb7b2245f9672fc0f` |

  - 日期根 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20`。完整根 test 的三项失败修正及窄测见 `t17-regression-stability-2026-11-20.md`，不得把窄测替代最终完整根回归。上述构建检查在后续 N10 夹具/评分补齐之前执行，验收代码稳定后须重新检查测试源码。
  - 清理：T15 owner `e752afc5-a9ec-47a6-a00a-ecaafda6c8a2`、T16 owner `4c87b008-fa44-498c-85b2-8e613c3bb665`，测试结束后独立核对其 Docker 容器、卷均为 0；T15 顶层 4 份 JSON、T16 顶层 103 份 JSON 及本轮 t16-d 的 18 份过程/恢复证据复制到稳定目录，全部原件和副本逐份校验字节与 SHA-256，JWT/Bearer 形态扫描未命中；原配置、缓存和 node_modules 不归档。
  - 已核验安装 CLI 为 0.0.20、冻结摘要前后相同、三个根无活动进程；T16 内 8 个 workspace junction 的目标均在该同一临时根内。以下精确本轮目录已移入 Windows 回收站，复核原路径均不存在：`C:/Users/10208/AppData/Local/Temp/zhinexus-t15-installed-wGOff4`、`zhinexus-t16-installed-7KHQZw`、`t16-d-R8a3hQ`。清理记录为 `process-evidence-audit.json`、`t16-d-installed-recovery-evidence/evidence-audit.json`、`cleanup-inspection-0020.json`、`cleanup-result-0020.json`；未清空回收站，也未再次操作此前自动审批拒绝的目录。
  - 完整平台最后一轮 owner `19502af6-8df3-4b7e-a507-67b2caa47cb6`；本轮单独启动已构建 Next 画廊后执行，随后结束对应会话并确认 5173 已释放；服务仍为本地隔离签名 fixture，`productionAcceptance=false`。
- 结论与状态：部分失败（首次完整根 test 3 failed，exit 1；后经 t17-regression-stability 修正并在 0.0.21 重跑转绿）。被 t17-cli-0021/0022/0023 取代。
- 交叉引用：`t17-regression-stability-2026-11-20.md`、`t17-blackbox-2026-11-20.md`、`t17-host-fixtures-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-cli-0021-regressions-2026-11-20.md`。
- 过时或矛盾点：`test:platform` 首次 135 passed/2 skipped 与完整 137/137 并存（前者缺环境）；首次完整根 test 3 failed 不得记为全绿。

### t17-cli-0021-regressions-2026-11-20.md

- 日期／角色／主题：2026-11-20；C（集成方）；冻结 CLI **0.0.21** 回归与证据复读。保留本轮结果，不替换 0.0.20 及更早失败记录。`productionAcceptance=false`。
- 目的：对 0.0.21 完成全量工程/平台/浏览器/T15/T16/黑盒回归与原件复读。
- 承重事实：

  - CLI 0.0.21：**451414 字节**，SHA-256 `7dd4874f0e6c98caddb2de959b942d7bde463c35a04ba82fe31ec67140f5f7cd`，来源 HEAD `3fbcfa9b66900c55e254f15e73f318055c6a104f`；外置 `cli-0.0.21-432a7805-4921-4c7d-a07d-029bbf7ed010/freeze-manifest.json` 保存单次 pack 身份。
  - 既有 SDK manifest SHA-256 `04a7c4fb...`，199 个唯一产物、398 个重复/唯一引用全部复读通过；未重包。历史兼容 probe `c6182081...` 只按 `historical-real-installed-cli-probe-replay` 使用。
  - 结果表：

    | 命令或配置 | 实际结果 | 外置根 |
    | --- | --- | --- |
    | `verify:workspace` | 10 成员与依赖边界通过，exit 0 | 升版时工具记录 |
    | `exec turbo run build typecheck --force` | 20/20，0 cached，18.389 秒，exit 0；随后根 tsc exit 0 | `workspace-0.0.21-665539951682462c8ab6222590ab3fe8` |
    | 完整根 `test`（有效 `A10_FROZEN_BUNDLE` 与 `ZHINEXUS_SDK_BUNDLE_DIR`） | T10 **168/168**、零跳过；Vitest **121 文件、2187/2187**、零跳过，594.49 秒、exit 0 | `full-test-0.0.21-final-3477abf8131947849354b18116cc239f` |
    | `test:platform`（真实 Next 5173 与有效 SDK） | 35 文件、**137/137**、零跳过，694.92 秒、exit 0 | `platform-0.0.21-e7e517e6291b4d2ab4591b4667529655` |
    | `test:browser`（有效 SDK，启动前确认 5173–5176 空闲） | **288/288**，约 2.3 分钟、exit 0 | `browser-0.0.21-712ad54ded5545eba6971fe0dd87bf92` |
    | `exec vitest run --config tests/acceptance/phase3-plan.config.ts` | 完整 T15 **25/25**、63.22 秒、exit 0 | `t15-t16-0.0.21-1795116035727` |
    | `exec vitest run --config tests/acceptance/t16-installed.config.ts` | 完整 T16 **14/14**，含 Next、无名称过滤，693.99 秒、exit 0 | 同上 |
    | `exec vitest run --config tests/acceptance/t17-blackbox/live-vitest.config.ts` | 5/5、543.99 秒、exit 0 | `blackbox-0.0.21-1795115999104` |
    | `exec vitest run --config tests/acceptance/t17-blackbox/vitest.config.ts` | 5/5、30.60 秒、exit 0 | 同上 |

  - 平台 owner `cd84bf4b-ae52-4fbb-853d-5a8814427cb4` 的 `org.zhinexus.recovery` 标签容器及卷均为 0；browser 包含六项真实三存储网页提交验收。
  - 首次完整根 test 的 4 项外层超时及 105/105 定向复验见 `t17-regression-budgets-2026-11-20.md`。新的完整根 test 未使用名称过滤，于 **03:47:04** 开始、**03:56:59.1119729+08:00** 自然结束；控制方收取原会话 exit 0，并复读 test.log 与 result.json。
  - 控制方用固定 Node 26.13.0 另行读取 11 份构建、完整根测、平台、browser 和四组冻结回归索引/结果，重新检查最终计数、退出码、CLI 原字节及原架构摘要，`failures=[]`、`passed=true`；结果 `root-final-regression-log-reopen.json`，SHA-256 `2da2f9c1632615f3a9423cf6e5401fdb26346f9e9d1543bbb847b9a66e1e8666`。该复读仍明确把新宿主、正式矩阵及其清理列为待收。
  - 原始证据归档：live 158 文件、legacy 8 文件、T15 4 JSON、T16 103 JSON、T16 recovery 22 文件，共 **295 文件和 17 receipts**；四条成功链各 7 个 artifact refs；281 个文本的 JWT/Bearer 形态扫描为 0。索引 `final-independent-reopen.json` SHA-256 `d1ffbff630c5f1a8623fc6d5df1535c00b06a126160bb9e43679a6f7c0ca5a46`；控制方另读该索引及五份 manifest、295 个副本（2222158 字节）结果保存于同目录 `root-archive-reopen.json`。
  - 清理被自动审批在执行前拒绝（原因仅 `blocked by policy`，整条删除未启动，没有更换 API 重试）的五个精确目录：`C:/Users/10208/AppData/Local/Temp/zhinexus-t15-installed-6v6Cfn`、`zhinexus-t16-installed-k391pW`、`t16-d-fUxufQ`，以及本工作树 `.tools/recovery/0aa55c20-22d8-4945-82da-ba4ad979fd50`、`.tools/recovery/5fffd99c-983b-4c93-9d1e-f19f626058fd`。精确形态与拒绝结果在 `t15-t16-0.0.21-1795116035727/cleanup-inspection-0021.json` 和 `cleanup-result-0021.json`。
- 结论与状态：完成（0.0.21 工程/平台/浏览器/T15/T16/黑盒全绿）。其完整矩阵为 20/20、12/13、exit 1（见 t17-matrix-n10-request），0.0.21 未作最终交付。
- 交叉引用：`t17-regression-budgets-2026-11-20.md`、`t17-blackbox-2026-11-20.md`、`t17-host-0021-2026-11-20.md`、`t17-matrix-n10-request-2026-11-20.md`、`t17-c0-current-evidence-2026-11-20.md`、`t17-no-install-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：被 0.0.22/0.0.23 取代；首次完整根 test 的 4 failed 已由 t17-regression-budgets 修正说明。

### t17-cli-0022-regressions-2026-11-20.md

- 日期／角色／主题：2026-11-20；C（集成方）；冻结 CLI **0.0.22** 回归与证据复读。沿用用户授权的仓外临时 Vue/React 项目、独立三存储和固定工具链，`productionAcceptance=false`。0.0.21 的回归、宿主和未通过的全量矩阵均为历史结果。
- 目的：对 0.0.22 完成工程回归，并在 05:38/05:55 追加记录 R08 缺陷与正式矩阵结果，最终判定本候选不作交付。
- 承重事实：

  - CLI 0.0.22 仅 pack 一次，来源 `f96af5ee59cfbd007ba4ff50aad3de60cebafb60`，冻结于 `2026-11-20T04:39:01.0606031+08:00`；`cli-0.0.22-mwo0jfyw-6oszswub/company-component-cli-0.0.22.tgz` 为 **453485 字节**，SHA-256 `d3da08748faa4c18a19a8b757caf817dae032e82b9405521a87dd8f877c179ef`，同目录保存 `freeze-manifest.json` 和 `pack.log`。SDK manifest `04a7c4fb...`（199 唯一文件 / 398 引用）；兼容输入 `c6182081...`。
  - 工程检查表：

    | 命令 | 实际结果 | 原始证据 |
    | --- | --- | --- |
    | `verify:workspace` | 10 个成员与依赖边界通过，exit 0 | `workspace-0.0.22-mwo0gepv-tj4gx2ze/workspace-result.json` |
    | `exec turbo run build typecheck --force` | 20/20，0 cached，15.336 秒，exit 0 | 同目录 `build-typecheck.log`、`build-typecheck-result.json` |
    | `exec tsc --project tsconfig.json --noEmit` | 首跑测试夹具判别类型触发 **TS2345**，exit 1；`f96af5ee` 修正后完整根 tsc exit 0 | `root-tsc-result.json`、`root-tsc-correction-result.json` |
    | `--filter @company/component-cli build` 和 `typecheck` | exit 0；打包清单 probe **73/73** | 冻结前实际运行 |
    | 完整 `test:platform`（有效冻结 SDK、实际 Next 5173） | 35 文件、**137/137**，570.34 秒、exit 0 | `platform-0.0.22-mwo0kxpv-x9v1mxli/platform.log`、`platform-result.json` |
    | 完整根 `test` | T10 **168/168**、零跳过；Vitest **123 文件、2198/2198**，796.34 秒、exit 0 | `full-test-0.0.22-mwo0kxpv-x9v1mxli/test.log`、`test-result.json` |
    | 完整 `test:browser` | **288/288**，3.4 分钟、exit 0 | `browser-0.0.22-mwo0xzrd-lsb5d634/browser.log`、`browser-result.json` |

  - 平台命令在 `2026-11-20T04:49:52.7423847+08:00` 自然结束，wrapper 外层耗时 580.125 秒；`summary.json` 确认 `ownedGalleryStopped=true`，自有 owner `4759ddc3-efba-4c5b-80ac-4475bdafe343` 容器与数据卷均为空、5173–5176 无监听。完整根命令于 `04:54:04.3126279+08:00` 自然结束，wrapper 耗时 834.016 秒；浏览器于 `04:53:48.9706030+08:00` 自然结束，wrapper 耗时 203.836 秒。两组均收取原会话 exit 0，无名称过滤或环境缺失跳过。根测包括新加入的矩阵请求回归及两项产品缺陷回归；完整浏览器包括六项真实三存储网页提交测试。
  - `bf65180a` 只变更外部矩阵请求夹具和验证记录，在冻结后未改动 CLI 产品或公共契约。
  - 控制方用固定 Node 独立复读 16 份工程日志、退出码结果和冻结清单，逐项重新确认计数、CLI 原字节及原架构摘要，`failures=[]`、`passed=true`；`root-engineering-regression-reopen.json` SHA-256 `e6cfad6859fccfa0b34a77522a92429a222a091a4104f9795852c5efa283344e`。
  - **05:15 追加**：同包黑盒与 T15/T16 四个完整配置 5/5、5/5、25/25、14/14，合计 **49/49**、无跳过、自然 exit 0；控制方独立原件/副本复读 336 文件、17 receipts 通过。完整双框架宿主正向与单次修复四链的最终报告均为六项通过；34681 个清理前归档文件、1754 个保留原 evidence、四链摘要和四张 PNG 经控制方独立复读通过。当前宿主 owner 资源已释放，但黑盒八个 owned 根的清理被自动审批拒绝，命令未启动。正式 33 格矩阵与最终审查仍在进行。
  - **05:38 后续发现：本候选不作最终交付**：正式矩阵 R08 的 browser 行为失败后，独立真实产品探针两次确认正常 250ms 异步文本更新被提前判为 `BEHAVIOR_FAILED`；同步 control 通过、永久不匹配仍失败，既有完整工程回归没有覆盖这条时序。随后仓库新增真实 Chromium suite 得到有效 RED（8 failed / 4 passed）；产品修复与独立复审正在推进，原失败瞬间 R08 实际文本仍未知。候选必须另升 0.0.23、只 pack 一次并重新完成技术验收。
  - **05:55 正式矩阵已自然结束**：0.0.22 全矩阵最终为正向 **19/20**（Vue **10/10**、React **9/10**）、强制拒绝 **13/13**，完整入口 **1/1**、**3340.98s**、自然 exit 0。原 R08 failed 不变；旧聚合门槛满足不能替代关闭已确认 Important/P1 产品缺陷。原 **59 roots / 23162 files / 493332540 bytes** 的 seal 与归档由控制方独立逐字节复读通过，59 个 owned parent 已不存在，旧 evidence roots 保留；详见独立提交 `9fb5f215` 的矩阵记录。
  - 异步断言已在 `10ca2957` 修复并经独立审查批准，Critical 0、Important 0。
- 结论与状态：工程回归完成但最终判定为**非交付候选**（R08 Important/P1）。被 t17-cli-0023-regressions / t17-integration / t17-completion 取代。
- 交叉引用：`t17-cli-0021-regressions-2026-11-20.md`、`t17-host-0021-2026-11-20.md`、`t17-matrix-n10-request-2026-11-20.md`、`t17-blackbox-0022-2026-11-20.md`、`t17-host-0022-2026-11-20.md`、`t17-matrix-0022-2026-11-20.md`、`t17-async-assertion-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-cli-0023-regressions-2026-11-20.md`、`t17-repair-source-continuity-2026-11-20.md`、`t17-mcp-sdk-redaction-2026-11-20.md`。
- 过时或矛盾点：工程 2198/2198 全绿与最终"不作交付"并存——不能因工程回归通过而忽略 R08 产品缺陷；493332540 bytes（0.0.22 矩阵）与 0.0.23 的 493327325 bytes 是两轮不同值。

### t17-cli-0023-regressions-2026-11-20.md

- 日期／角色／主题：2026-11-20；C（集成方）；冻结 CLI **0.0.23** 回归与证据复读。唯一冻结候选的完整工程回归已自然退出通过并完成原日志独立复读；双框架宿主、黑盒/T15/T16 和固定 33 格矩阵见各自独立记录，本记录不代替整体最终结论。0.0.22 的结果和 R08 失败不被覆盖。
- 目的：对 0.0.23 完成工程全量回归与冻结字节复读。
- 承重事实：

  - `10ca2957` 修复原有超时内的异步 DOM 断言等待，保留 first、trim、精确 count、非零可见尺寸、取消和错误分类，所有断言共享一个原有预算；真实 Chromium 有效 RED 为 `8 failed / 4 passed`，最终定向 **52/52**、既有浏览器 **1/1**，独立审查 Critical 0、Important 0。
  - 独立升版提交 `edb985ec0f9ee1b79a5882e935832f8caa9f0daf`。CLI `0.0.23` 于 `2026-11-20T05:51:34.8465368+08:00` 仅 pack 一次，绝对目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.23-edb985ec-b8f572a9`；tarball `company-component-cli-0.0.23.tgz` **454155 bytes**，SHA-256 `93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab`；`freeze-manifest.json`、`pack-command.json` 与 `pack.log` 同目录保留。
  - SDK core 0.0.11、Vue/React 0.0.12 manifest SHA-256 `04a7c4fb...` 未重包；历史兼容输入 `c6182081...` 仅为 historical installed-CLI replay。
  - 工程检查表：

    | 命令 | 实际结果 | 证据目录 |
    | --- | --- | --- |
    | `verify:workspace` | 10 members，exit 0 | `cli-0.0.23-workspace-edb985ec` |
    | `exec turbo run build typecheck --force` | 20/20，0 cached，14.435s，exit 0 | 同上 |
    | `exec tsc --project tsconfig.json --noEmit` | exit 0 | 同上 `root-tsc.log` |
    | `test`（含 `build:services` 前置） | T10 **168/168**、0 skipped；Vitest **124 files / 2210/2210**、0 skipped；Vitest 895.76s，包装器 927.63s，自然 exit 0 | `cli-0.0.23-full-test-edb985ec/test.log`、`test-result.json`、`summary.json` |
    | `test:platform`（含 `build:services` 前置） | **35 files / 137/137**；Vitest 711.83s，包装器 719.17s，自然 exit 0 | `cli-0.0.23-platform-edb985ec/...` |
    | `test:browser` | **288/288**，3.2min，包装器 192.84s，自然 exit 0 | `cli-0.0.23-browser-edb985ec/...` |

  - 强制构建在冻结之前执行，随后只 pack 一次；完整根 `test` 与真实 `test:platform` 于冻结后启动；上述完整入口没有名称筛选、人工中止或将旧版本结果并入计数。
  - 控制方在自然退出后独立复读冻结清单、四组原日志/结果 JSON/summary，共 **17 份文件**；实际计数、退出码、启动与结束时序、CLI 原摘要均相符，`failures=[]`；`cli-0.0.23-full-test-edb985ec/root-engineering-regression-reopen.json` SHA-256 `dc7e44d4f8dbd2a478d69aa9b0bfea4513bdc8a7eaa4b5e098e2438b8b0cc9ea`。
  - 独立日志审计 helper 第一次语法检查因生成字符串中的正则反斜杠丢失而 exit 1；没有运行任何产品测试，也没有写出成功审计文件；诊断保留于同目录 `root-audit-helper-first-parse.log` 和 `root-audit-helper-first-parse.json`；读取源码、改为明确字符串检查后语法检查与完整 17 文件审计均通过；不将 helper 失误记作产品失败。
  - 冻结原字节另由控制方独立拆包复读：包内全部 **306 个 dist 文件**与本次实际构建逐字节一致，**307 个包条目**、运行时私有依赖边界、产品及公共配置相对 `edb985ec` 零差异、原架构摘要均符合；`root-initial-frozen-byte-reopen.json` SHA-256 `026fdbca973273343b51346e53ccf14bdcf736dff15232f08323a6153069f173`。本轮后续只改文档，没有重包。
  - 完整平台本轮 owner `f8074e4f-541a-4e83-939e-ddd69bb03e95`；控制方于 `2026-11-20T06:05:08.4041118+08:00` 实查其容器 0、卷 0、owned Gallery 已停止、5173–5176 无监听，随后才运行完整浏览器入口；原结果 `cli-0.0.23-platform-edb985ec/root-owned-resources-after.json`。
  - 收尾只读审计确认 `.tools/recovery/f8074e4f-541a-4e83-939e-ddd69bb03e95` 仍保留**四个普通凭证配置文件**；原 `platform.log` 的 `PLATFORM_ISOLATED_SERVICES` 事件与原资源记录可精确关联该 owner，当前读取时容器、卷、精确路径匹配进程均为 0；但没有创建时 marker/首见 native 身份，不把事后身份冒充原始所有权证据，因此没有发出删除命令；配置内容未打开、未哈希、未写入证据。浏览器原日志仅含请求/作业 UUID，没有可确认的 recovery owner/路径。`root-engineering-cleanup-boundary-audit.json` 为 11785 bytes，SHA-256 `726ac0548317e28b199c8e2772ef303a5a5170273c5025aa31e9bc331b02a6c1`。
- 结论与状态：完成（0.0.23 工程门槛）；本记录仅证明本轮隔离技术环境的工程门槛。真实业务试点、公司 OIDC、生产独立预览域与完整生产 G2 保持开放；本地签名 OIDC fixture 不冒称公司认证服务。被 t17-completion 汇总为最终交付依据。
- 交叉引用：`t17-async-assertion-2026-11-20.md`、`t17-cli-0022-regressions-2026-11-20.md`、`t17-blackbox-0023-2026-11-20.md`、`t17-host-0023-2026-11-20.md`、`t17-matrix-0023-2026-11-20.md`、`t17-completion-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：`.tools/recovery/f8074e4f-...` 四配置文件因归属证据不足而保留，不等于缺少用户清理授权。

### t17-completion-2026-11-20.md

- 日期／角色／主题：2026-11-20；综合（控制方/集成方收口）；三期 T17 当前交付与验收汇总。不替换追加式集成记录或任何历史失败记录。
- 目的：汇总 0.0.23 唯一冻结候选的全部验收结果、独立复核、清理保留项与开放事项。
- 承重事实：

  - 当前结论：本轮三期 T15–T17 工具技术交付与临时工程验收通过。0.0.22 的 R08 异步 DOM 断言缺陷经 `10ca2957` 修复和独立批准后，CLI `0.0.23` 单次冻结并完成同包完整工程、黑盒、双框架宿主及 33 格矩阵重验；控制方原件评分和字节归档复读通过。
  - 授权范围：用户已授权继续完成三期、创建临时 Vue/React 工程并在保留验收证据后清理；本轮工程明确为 temporary/synthetic，`productionAcceptance=false`。用户再次确认无安装语义：本次没有执行安装时，apply 如实返回 `installedVersions=[]`；verify 独立检查实际安装树、锁文件和包清单。该决定与 t17-no-install-2026-11-20.md 一致。
  - 三期工具链包含 T15 inspect/plan、T16 授权安装/代码生成/备份恢复，T17 integrate verify/repair 和四工具本地 stdio MCP；T17 运行显式授权的项目 type/build 脚本、有限浏览器行为和视觉检查；已知生成模板最多修复两轮，每轮完整重验。
  - 唯一冻结输入表：CLI 0.0.23，source HEAD `edb985ec0f9ee1b79a5882e935832f8caa9f0daf`，2026-11-20 05:51:34 +08:00，`packCount=1`；tarball 454155 bytes / SHA-256 `93c90124...`；SDK core 0.0.11、Vue/React 0.0.12，manifest `04a7c4fb...`，199 unique files / 398 refs，未重包；历史兼容输入 `c6182081...`；工具链 Windows x64 / Node 26.13.0 / pnpm 12.18.0 / npm 11.20.0 / 本机 Playwright Chromium。
  - 当前产品、公共契约和根依赖配置相对冻结来源的差异检查为空；冻结后仅有文档变动；控制方独立重开 tarball 全部 306 个 dist 文件与实际构建字节一致。
  - 当前验收结果表：

    | 门槛 | 实际结果 | 证据 |
    | --- | --- | --- |
    | 工作区与强制全图 | 10 members；build/typecheck 20/20、0 cached；根 tsc exit 0 | t17-cli-0023-regressions |
    | 完整根测试 | T10 168/168，0 skipped；Vitest 124 files、2210/2210，0 skipped；自然 exit 0 | 同上 |
    | 真实平台 | 35 files、137/137，完整入口自然 exit 0 | 同上 |
    | 完整浏览器 | 288/288，平台释放端口后执行，自然 exit 0 | 同上 |
    | T15 / T16 与 CLI / MCP 黑盒 | 四个完整配置 25/25、14/14、5/5、5/5，合计 **49/49**；独立 installed timing probe 另列 | t17-blackbox-0023 |
    | 独立双框架宿主 | 完整入口 **1/1**，**1235.87s**，自然 exit 0；Vue/React 正向与各一次真实 repair 四链各 **6/6**、visual PASS | t17-host-0023 |
    | 固定支持矩阵 | 完整 33 格自然 exit 0、**3481.91s**；正向 **20/20**，Vue/React 各 10/10；13 项强制拒绝均符合各自预期；控制方正式评分 `matrixAccepted=true` | t17-matrix-0023 |
    | 独立审查与修复 | 异步断言修复 Spec compliant / Approved，未解决 Critical 0、Important 0；本轮最终记录独立 Approved，Critical/Important/Minor 均 0 | t17-final-review、t17-async-assertion、t17-final-delivery-review-0023 |

  - 0.0.22 历史：正式矩阵最终正向 19/20、拒绝 13/13，3340.98s、自然 exit 0；R08 failed 保留；原 59 根/23162 文件/493332540 字节已独立复读，59 个 owned parent 已不存在。
  - 控制方独立复核摘要（0.0.23）：`root-initial-frozen-byte-reopen.json` `026fdbca973273343b51346e53ccf14bdcf736dff15232f08323a6153069f173`；`root-final-frozen-byte-reopen.json` `37f334c9e9268a1f6b1231d02ce950c464a21e2737848dda8beaaaf002190e82`；工程 `root-engineering-regression-reopen.json` `dc7e44d4f8dbd2a478d69aa9b0bfea4513bdc8a7eaa4b5e098e2438b8b0cc9ea`；黑盒 `root-all-original-copy-byte-reopen.json` `5ee88fccfc0e64ff1756cda485bfdb590c06b3bba4a869b70540d26695a4cee6`（410 文件、3332628 字节、135 目录）；`root-canonical-business-and-timing-reopen.json` `51d1c4a668fcb4e31c8afb92c00bb550036871764272acc6492caa83e6e9eb59`；宿主 `root-full-archive-byte-reopen.json` `2f514f63571cde29a0f790a853ccf54abb60085df18d35ab5e0a84c14cdf1dfb`（34681 文件、2586567819 字节与 1754 份原 evidence）；`root-second-original-complete-audit.json` `02fd1351f472ff595a4f686695ee888e4ee494af6a2aabdd40d00a546af680c5`；宿主四链与四张 800×400 PNG `root-host-chain-and-png-reopen.json` `5e5eb0b55f6f33ead7555a6c6a436924c7999c478a37f9ecdc7addcddb5f7cbd`（RGBA 差异 0）；矩阵 `root-original-matrix-score-reopen.json` `bfd8a0da7d1c99b659033f07367acff3511e6e4ba901f4ce5b324416d0162c94`，原 top seal `3fdf1427a0fe97e9d12966764d7de9bb642747f73355021877e6cd6207e33457`；矩阵全原件/副本复读 `root-all-original-copy-byte-reopen.json` `13e50a60be57e03a34f5b24d4a2a0b4e02175f5291cffd5cee090950118f7d8b`（59 根/23162 文件/493327325 字节）。
  - 黑盒四链结论：同步和两次延迟案例仅 browser passed，overall failed / visual NEW；永久负例 browser failed、visual not-run，不能冒称完整业务通过。N10 两轮真实写入、两份原字节备份和第三文件不变均吻合；N13 是独立验收支架在真实 build 成功后的 `entry-import-missing` 拒绝，没有调用产品 verify。
  - 清理结果：0.0.23 宿主三个 owned parent 在清理前全字节封存后由原 fixture 删除，控制方另查其不存在；黑盒在 410 份原件/副本独立复读及 12 根/82840 entries 新鲜身份清单核验后，单次原生 PowerShell 批次自然 exit 0，精确删除 12 个新根，`remaining=[]`；矩阵 59 个 owned parent 亦由原 seal 及控制方独立复读确认为不存在。宿主 3、黑盒 12 与矩阵 59 是各自独立范围，不扩大成全局临时目录清空。`native-cleanup-result.json` SHA-256 `08caebc73a7898631c6bb8541988969ff282f5d0c30e7f533db815d7991bd36c`。
  - 保留目录：`.tools/recovery/f8074e4f-541a-4e83-939e-ddd69bb03e95` 仍保留四个普通凭证配置文件（保留原因是归属证据不足，不是缺少用户清理授权）；0.0.22 黑盒八个策略拦截根继续保留（`t17-d-live-C94XDQ`、`t17-d-blackbox-dL4Teo`、`zhinexus-t15-installed-QQY7Hr`、`zhinexus-t16-installed-VF79Eb`、`t16-d-AqrLQT`、`t17-d-0022-redaction-AQSE8T`、`.tools/recovery/76181669-7754-4a5b-b831-d554a85cf8fb`、`.tools/recovery/ff069d9c-b890-487d-8dc3-3af7ff39662c`）。历史 0.0.22 宿主三个 owned parent 已删除，owner `5ed1785b-3995-4b96-ba87-964055abe102` 容器/卷均为 0、秘密目录不存在；该版黑盒五个 exact owner 容器/卷亦均为 0。
  - 历史过程与独立开放事项：0.0.21 完整矩阵为正向 20/20、拒绝 **12/13**、exit 1，唯一 N10 在 MatchPlan 请求阶段因重复设计映射被真实 API 拒绝，不判为产品预算检查通过；原 P0 独立日志、最初实现 RED 的完整顺序和原始 stderr 空字节尚未追溯；两个真实业务试点、T11/T12、公司 OIDC、生产独立预览域和完整生产 G2 仍单独开放；实际 Antigravity 先承担主开发，其 Gemini/Claude 渠道额度耗尽后由 Codex 接续，未开启付费 overages，各原始交付身份保留。
  - 本轮关键聚焦提交：`10ca2957`（异步 DOM 断言最小修复）、`edb985ec`（独立升级 CLI 至 0.0.23 并更新 CHANGELOG）、`7ec3a665`（0.0.23 双框架宿主记录）、`33e5e13c`（完整工程回归记录）、`cc494f21`（0.0.23 独立 CLI/MCP 黑盒、T15/T16 及十二新根清理）、`011694e5`（完整矩阵 20/20+13/13、原件正式评分、59 根字节归档与清理审计）。
  - 当前分支 `feat/t17-integration`；本轮没有执行 push、tag、合并或生产发布；原架构文件 SHA-256 保持 `e59bb77e...`。本轮"完成"仅指用户授权临时工程范围内的三期工具技术交付。
- 结论与状态：**终态汇总（技术收口）**。是全主题最新、最权威的总入口；不替代 t17-integration 的追加式过程记录。
- 交叉引用：全主题绝大多数篇章，特别是 t17-integration、t17-cli-0023-regressions、t17-host-0023、t17-blackbox-0023、t17-matrix-0023、t17-final-review、t17-final-delivery-review-0023、t17-async-assertion、t17-no-install、`docs/phases/phase3/local-project-verification.md`、`docs/specs/2026-11-19-phase3-t17-design.md`。
- 过时或矛盾点：无（本身即最终口径）；但须注意其"完成"严格限定于 temporary/synthetic 技术范围。

### t17-final-delivery-review-0023-2026-11-20.md

- 日期／角色／主题：2026-11-20；综合（独立只读审查子任务，Codex 执行，集成方据实际审查回报落盘）；T17 CLI 0.0.23 最终交付记录独立审查。
- 目的：对 0.0.23 最终交付记录做独立终审。
- 承重事实：

  - 结论为 **Approved，Critical 0、Important 0、Minor 0**。本记录不把该回报冒称审查方新增的文件或额外产品测试。可将本轮收口为"用户授权临时工程范围内的三期 T15–T17 工具技术验收通过"。
  - 审查范围：README、实施评估、总实施计划、分工计划、T17 专项计划、当前完成汇总、0.0.23 工程/宿主/黑盒/矩阵记录，以及追加集成记录的当前末尾；本轮没有修改产品或测试。
  - 关键结论：当前 0.0.23 与 0.0.22 历史结果分列；工程 2210/2210、T10 168/168、平台 137/137、浏览器 288/288、黑盒四完整配置 49/49、双框架四条宿主链和矩阵 20/20+13/13 保持各自分母与原入口身份。N13 明确为独立验收支架在真实 build 成功后的 `entry-import-missing` 来源检测，未调用产品 verify；其完整 source-map 正文已随原 parent 清理，现存可复读范围限原 native inventory 的 hash/size 及运行期 sealed extraction。
  - 宿主 3 个 parent、黑盒 12 个新根、矩阵 59 个 parent 分别记录；工程平台四个普通凭证配置文件因缺创建时 marker/native 身份保留；历史自动审批 policy 拒绝目录不重试；没有把这些保留项写成缺少用户授权，也没有宣称全局临时目录清空。
  - 两项 preflight 措辞 Minor 已修正：五组归档不是五个完整运行配置；两轮修复上限仅在仍未通过时停止并交付问题。终审无剩余发现。
  - 实际复核：读取工程原日志尾部、冻结清单、宿主与黑盒 handoff、矩阵原始 R08/N10/N13 结果，以及正式评分/归档审计 JSON；独立重算 tarball、manifest、原 seal、archive-map 及关键审计文件摘要。矩阵 59 roots / 23162 files / **493327325 bytes** 与记录一致，原件正式评分为 `matrixAccepted=true`、`failures/errors=[]`。
  - 摘要表：唯一 CLI tarball `93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab`；矩阵原 top seal `3fdf1427a0fe97e9d12966764d7de9bb642747f73355021877e6cd6207e33457`；原件正式评分 `bfd8a0da7d1c99b659033f07367acff3511e6e4ba901f4ce5b324416d0162c94`；矩阵 archive-map `441cba52e1ad74ad793ffdc96bbb539e4d9b2a3bf01a80a8dd132cd966ffb065`；Root 矩阵全原件/副本复读 `13e50a60be57e03a34f5b24d4a2a0b4e02175f5291cffd5cee090950118f7d8b`。
  - 审查方执行产品及公共配置相对 `edb985ec` 的只读差异检查，无差异；`git diff --check` 通过，原架构 SHA-256 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。该次阅读范围的 **231 个相对文档链接均存在**；此数字只代表当时链接目标存在检查，不代表 anchor 或远程网页校验。
  - 不作判断的事项：本轮未重读全部产品源码；未重跑大型验收、正式评分或全部归档字节审计；不冒称重新读取已删除的 N13 完整 map 正文；不追认缺失的最初 RED 顺序、原 P0 日志或实施期官方资料读取；不判断尚开放的真实业务试点、公司 OIDC、生产预览域及生产 G2。审查方全程没有修改工作树、index 或 HEAD，没有清理、重包、push 或 merge。
- 结论与状态：完成（Approved）。是 0.0.23 交付的终审依据。
- 交叉引用：`t17-completion-2026-11-20.md`、`t17-final-review-2026-11-20.md`、`t17-async-assertion-2026-11-20.md`、`t17-matrix-0023-2026-11-20.md`、`t17-host-0023-2026-11-20.md`、`t17-blackbox-0023-2026-11-20.md`、`t17-cli-0023-regressions-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：无；但明确声明不替代 t17-final-review（重点代码审查）与 t17-async-assertion（修复独审）两个独立范围。

### t17-final-review-2026-11-20.md

- 日期／角色／主题：2026-11-20；综合（Codex 独立审查子任务，只读）；T17 分支最终重点代码审查。按控制方后续要求仅新增本记录，由控制方复读并提交；本子任务没有修改产品、测试、契约、版本或锁文件，没有 pack、stage、commit、push 或合并。
- 目的：对 0.0.22 时点的 T17 产品源码做重点审查，判定是否阻断交付。
- 承重事实：

  - 结论：确认的 **Critical 为 0、Important 为 0**。该结论不等于逐行复核全部验收支架，也不宣布 T17 全部验收完成。当前 0.0.22 的固定 20 正向 + 13 强制拒绝正式矩阵仍须自然完成、封存并由控制方独立评分；本记录不预填其结果。
  - Git 范围：`5a172921..2da991612196d5c2856dea647b45603590ed3b90`，**148 个文件、24388 行新增、22 行删除**；同时只读检查当时待提交的 README、assessment、总计划、分工计划、T17 专项计划及 0.0.22 矩阵记录。
  - 完整阅读主产品流程：`packages/component-cli/src/integration/{verify,repair,report,browser-environment}.ts` 与 `src/mcp/{server,transport}.ts`；重点核对身份/摘要/授权、原 apply/plan 守卫、全源快照续接、窄范围修复与原字节备份、句柄身份/链接/部分写入恢复、预算、取消/进程树、真实依赖、浏览器 origin 与环境/视觉、外部独占证据、SDK 自动错误脱敏。
  - 阅读 `src/commands/integrate.ts` 的 verify/repair、参数与退出码处理，`src/{cli,index}.ts` 接线/公开导出，`integration/install.ts` 与 `apply.ts` 的本轮差异，以及共享 `integration-apply.ts` 无安装语义差异；核对 verification 契约的 context、spec、authorization、report 状态约束；未把 Schema 验证当成真实执行证明。
  - 按需复核 `tests/integration/project-mcp.test.ts` 的真实 SDK 调用/取消与子进程断言、验证/修复相关回归及独立 host/blackbox 证据入口；没有声称逐行审查本范围所有新增测试。已读架构、平台、安全、测试发布和代码审查规则，以及本轮 T17 设计/专项计划。
  - 关键核对：`verifyIntegrationInternal` 未从公共包根导出，CLI/MCP 的 JSON 输入也没有替代哈希入口；MCP 精确注册四工具，verify 不声明只读；grant 仅来自可信启动配置，严格输入拒绝请求自报批准；原始脚本输出不会直接变成固定 issue 文案；stdio transport 在 SDK 自动错误的线协议出口统一处理已知环境凭据及 JSON 转义表示，保留请求关联标识。
  - 本次执行 `git diff --exit-code f96af5ee59cfbd007ba4ff50aad3de60cebafb60..HEAD -- packages/component-cli/src packages/component-cli/package.json packages/contracts` 无差异；`Get-FileHash` 复核原架构 SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与只读基线一致。
  - 实际浏览器边界探针：验证"未显式设置 `serviceWorkers:block` 是否使新注册的 Service Worker 绕过既有 `context.route`"假设。使用固定包装器、真实本机 Chromium、与产品相同的 context 路由及 window.fetch origin 守卫，启动两个 loopback HTTP server；允许 origin 的页面注册真实 `/sw.js`，由 worker 主动向另一个 origin 发出 `fetch(...,{mode:'no-cors'})`。实际 stdout 原文 `{"outsideHits":0,"routed":["allowed/","allowed/sw.js","OUTBOUND"],"done":false}`，自然 exit 0，外层 3.430748 秒；browser 和两个 HTTP server 由 `finally` 关闭；假设不成立，不列缺陷。命令 `./scripts/pnpm.ps1 -PnpmArgs @('exec','node','--input-type=module','-e',$probe)`。本次未另行落盘该临时探针的独立源文件/原始日志；证据为本次工具会话输出及本记录转录。
  - 已有回归复读：根 Vitest 123 文件 2198/2198、浏览器 288/288、平台 35 文件 137/137；原日志与索引一致。工程复读索引原件位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/full-test-0.0.22-mwo0kxpv-x9v1mxli/root-engineering-regression-reopen.json`。黑盒四完整配置共 49/49、17 receipts 与 336 份结果证据归档。双框架宿主与清理前字节捕获、四张最终截图记录于 t17-host-0022。
  - 当前交付与历史计划条目区分表（行号指本次阅读的 `docs/plans/2026-11-19-phase3-t17-completion.md` 版本，控制方后续增加状态表可能改变行号）：C0 契约/依赖/SDK（专项计划 C0 51/54/55/57 行混合了原 P0、预期 RED、原始探针顺序和空 stderr）；A1/A2/A3 产品（A1 65–68、A2 78–81、A3 89–91 行中的原始 RED 编写/先失败顺序没有完整追溯，不能用当前结果追认）；B 正式独立矩阵（已有固定 20+13 定义与本轮执行，N10 独立诊断不进入正式分数）；D 冻结包进程验收（四完整配置自然 49/49，追加双输入脱敏 probe 单列；不把历史非自然外层会话计入通过；不把结果证据选定副本称为全部临时消费者安装树字节归档）；C2 清理与归档（host 三个 owned parent 已在完整字节归档后清除；D 本轮八个精确根清理被自动审批 `blocked by policy` 在进程启动前拒绝，八根保留且不得换 API 重试；历史拒绝根也保留，因此不能总称临时目录已全部清理）；业务与生产（本轮为用户授权 temporary/synthetic 技术工程，所有相关记录为 `productionAcceptance=false`）。
  - 非阻断限制：`git diff --check 5a172921..HEAD` 报告 `tests/acceptance/t17-host/consumer.ts:43` 的末尾空行，属格式 Minor；本次首次检查也报告宿主文档末尾空行，控制方已在待提交文档中修正；冻结后未为格式问题改动产品或重打包。宿主最终截图顶部 h1 轻微裁切与独立基线一致，图表、坐标轴及 Tuesday=75 提示可读，已在宿主记录公开；不把像素一致夸大成全部视觉设计无缺陷。
  - 不另评为缺陷的范围：可信调用方提供宿主且独立验收另核对真实 import/构建/资源来源，这是已批准设计边界；原生命令是授权的可信项目代码，源快照不是恶意脚本 OS 沙箱；已知模板 recipe 不是任意业务代码自动修复；临时工程不能代替历史业务和生产条件。以上均按显式设计/授权与范围限制保留，没有静默删除原计划要求。
  - 没有发现需要因本次重点代码审查阻断当前产品交付的 Critical/Important；最终技术收口仍由控制方在正式矩阵、最后文档/索引和清理保留项全部如实登记后决定；本记录不授权合并、推送、发布或重试被拒清理。
- 结论与状态：完成（0 阻断项）。为 0.0.22 时点审查；0.0.23 终审由 t17-final-delivery-review-0023 独立承担。
- 交叉引用：`t17-cli-0022-regressions-2026-11-20.md`、`t17-host-0022-2026-11-20.md`、`t17-blackbox-0022-2026-11-20.md`、`t17-c0-current-evidence-2026-11-20.md`、`t17-c0-official-supplement-2026-11-20.md`、`docs/phases/phase3/local-project-verification.md`、`docs/plans/2026-11-19-phase3-t17-completion.md`。
- 过时或矛盾点：审查时 0.0.22 正式矩阵尚未自然完成，本记录不预填其结果；其"无 Critical/Important"结论与随后发现的 R08 Important/P1 属不同范围（源码审查未覆盖该时序路径）。

### t17-host-0021-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（Antigravity 宿主实现方）/综合；T17 0.0.21 本地完整宿主流程验证。追加 0.0.21 同一冻结 CLI 的本地宿主实跑及独立证据核验，不改写旧轮失败。`productionAcceptance: false`，身份验证为本地签名 OIDC fixture，兼容证据为既有真实安装探测的原字节重放。
- 目的：完成 0.0.21 双框架完整宿主（正向 + 受控修复）实跑。
- 承重事实：

  - 冻结输入：CLI 0.0.21 tarball `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.21-432a7805-4921-4c7d-a07d-029bbf7ed010/company-component-cli-0.0.21.tgz`，冻结来源 `3fbcfa9b66900c55e254f15e73f318055c6a104f`，SHA-256 `7dd4874f0e6c98caddb2de959b942d7bde463c35a04ba82fe31ec67140f5f7cd`，451414 字节；SDK bundle 根 `.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`（manifest `04a7c4fb...`）；既有兼容探测证据 `.tools/sdk-label-acceptance-8929ffb81fcf4c90b98352c5f8afbed1/adopt/probe-evidence-adopt.json`（`c6182081...`）。
  - 运行时工作树 HEAD 为 `aa8014785185c6d972425d4ada8390a5fe6cee59`；包含已单独 RED/GREEN 验证的本地进程令牌 fixture 生命周期修正，不改变冻结 CLI 产物。CLI 在此次验收中未重打包。
  - 旧轮 RED：证据目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/host-live-0.0.21-8ab74b65`；2026-11-20 03:21:04 +08:00 开始、03:36:16 +08:00 结束，**911.71 秒，exit 1**；原始日志明确为 `Test timed out in 900000ms`，包含超时后的退出开销。正向 Vue/React 已各完成六项检查并封存通过，无需修复；受控 Vue 已 `failed → repaired` 一次，最终六项通过；受控 React 尚未启动，修复链没有最终 receipt、seal 或完整 summary。该轮保持 `incomplete-outer-timeout`，不计为完整验收。
  - 修正：仅将 `tests/acceptance/t17-host/local-product.spec.ts` 的测试级外层期限和 `local-product.vitest.config.ts` 的 `testTimeout` 从 `900000` 调至 `1800000` 毫秒，并添加真实 Windows 并发 I/O 预算说明；`hookTimeout: 240000` 不变；命令、浏览器及产品检查的内层期限不变；全量依赖目录清单、摘要核验和自有资源清理计入整轮耗时。
  - 本地 API 令牌 fixture 最终设为进程内 `3h`，其真实 READY 后生命周期 RED/GREEN 已单独验证并提交 `aa801478`；令牌值未写入此记录或证据归档。该修正与两处外层预算调整分别记录，不将新轮成功单独归因于某一个变化。
  - GREEN：输入环境变量 `T17_HOST_CLI_TARBALL`、`T17_HOST_CLI_SHA256`、`T17_HOST_CLI_VERSION`、`T17_HOST_SDK_BUNDLE`、`T17_HOST_SDK_MANIFEST_SHA256`、`T17_HOST_COMPAT_EVIDENCE_FILE`、`T17_HOST_COMPAT_EVIDENCE_SHA256`、`T17_HOST_REPO_ROOT`；命令 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-host/local-product.vitest.config.ts')`。
  - 本轮证据目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/host-live-0.0.21-budgetfix-41bfb345`；03:53:25 +08:00 启动、04:07:44 +08:00 退出；1 个文件、**1/1** 测试通过，exit 0，**858.50 秒**。原始命令日志和输入回读为 `host-live.log`、`inputs.json`、`process-result.json`；预算 GREEN 记录为 `outer-budget-green-validation.json`。
  - 自有 Verdaccio 实际已安装 `ProxyStorage` 读取配置并核对：声明 `5m`，规范化请求期限 `300000ms`；探测没有发送网络请求；证据 `registry-timeout-normalized.json`。
  - 四链结果：

    | 链 | 框架 | 初次 verify | repair | 最终报告 |
    | --- | --- | --- | --- | --- |
    | 正向 | Vue | passed | not-needed，0 次 | 六项全部 passed |
    | 正向 | React | passed | not-needed，0 次 | 六项全部 passed |
    | 受控故障 | Vue | failed | repaired，1 次 | 六项全部 passed |
    | 受控故障 | React | failed | repaired，1 次 | 六项全部 passed |

    六项为 type、build、dependency guard、business gaps、browser、visual。受控故障证明本夹具故障可由实际冻结 CLI 修复，不推断所有错误均可修复或耗尽分支已被本流程覆盖。
  - 原始封存与独立复核：三份原证据根及 seal SHA-256：`zhinexus-t17-evidence-d3dc15aeb4483a0f999ab839ff7f2e4e-DTF4hA` / `98003cc850ae97dffc33fca9a465e9503516e0b9492c7375e1f7d8671f5d2e81`（11 文件 / 2 目录）；`...c8b316a8b7f616729c7d63b9122b105f-EJXfiI` / `e09c3203e8bf57f7461fa6f9ae6e9cd07f962802177b9b37bbefaea1751cd02f`（1936 / 839）；`...4240cfaa49362c2a1a7c6da5b3f3cd71-yZP0YT` / `7deb10d381d9a1d4acc5165a7fd59b9dba4c2020d690ba401a86045d4357f82e`（1960 / 857）。先执行 `verifyIndependentReferenceBaselineSeal()` 和两次 `verifyHostChainReceipt()`，再独立递归读取所有保留 inventory（目录身份 dev/ino、子项名称、普通文件形态、字节数与 SHA-256），包括工作区、依赖缓存、备份和验证输出；没有用复制后的 inode 身份替代原件。
  - 四张 PNG 独立核对：Vue（正向最终 + 修复最终）SHA-256 `dc5e078ae1f2dad070c8c11c4b94a734bd9cf7157ee12ae733fcceec3dd7b5fe`，13662 字节，800×400；React `7a6c02a1514de95e24fbb1e165a89eb7898ced19f294194c97fa84aad5d5ae50`，13950 字节，800×400；均与基线字节一致、RGBA 差异 0。结果 `independent-original-complete-audit.json`、`four-final-screenshot-independent-audit.json`。
  - 独立原件复核后创建 `success-byte-archive`，归档 **3916 个文件、688801397 字节**，每个复制文件均重新读取核对摘要；链接 0，JWT 形态命中 0；`success-byte-archive-manifest.json` 明确归档为字节副本，不是文件系统身份 receipt。集成负责人随后再次独立复读全部 3916 文件通过，`root-independent-byte-archive-audit.json`（2026-11-20 04:10:16 +08:00）。
  - 本轮服务 owner `04ad3dd6-d919-4129-904a-3bb772d54174`，Docker 标签 `org.zhinexus.recovery=04ad3dd6-d919-4129-904a-3bb772d54174`；标签容器 0、数据卷 0；秘密目录 `.tools/recovery/04ad3dd6-d919-4129-904a-3bb772d54174` 不存在；三个工程父目录均不存在。服务证据根 `C:/Users/10208/AppData/Local/Temp/zhinexus-t17-local-product-svc-pRdwAC`。
  - 旧轮归档：未封存修复诊断及其工程也归档，合计 **11600 文件、880159036 字节**，11600 个复制文件摘要均复读一致，归档链接 0、JWT 形态命中 0。未封存工程的 `cli-consumer/node_modules/zod/src/v4/mini/tests/string.test.ts` 有一个 JWT 形态测试夹具命中，复制前即保守排除，仅记录路径、身份、15077 字节与摘要 `f4ebdab74387516508d0ce96a56979fe06af7e2425dccc13d34c0a229ba3a050`；不修改封存原件或其引用。秘密文件未归档。
  - 旧 owner `042e1b2e-e801-47b2-9bf4-7299f126f839` 的 3 个容器和 3 个数据卷逐一核对归属标签后清理，复查均为 0；删除工程前又重新核对 8572 个原文件与 1058 个目录的身份、清单和摘要。随后自动批准审查在启动进程前拒绝了精确删除下列两路径的 PowerShell 操作，原因 `blocked by policy`，命令未执行，没有更换 API 或方式重试：`C:/Users/10208/AppData/Local/Temp/zhinexus-t17-ec84b38d44024da2f138a0894bb3d424-BF6joK`、`C:/Users/10208/.codex/worktrees/phase3-t17-integration/zhinexus-design-asset-platform/.tools/recovery/042e1b2e-e801-47b2-9bf4-7299f126f839`。
  - 2026-11-20 04:02:54 +08:00 后续只读复查确认两目录及 marker 可读、旧封存原件可读且 seal SHA 一致、旧 owner 资源仍为 0；8572 个工程文件中未发现进程 JWT 持久化副本或已知服务凭据精确匹配；秘密目录仍含随机密码/哈希材料，密码没有按时间自动到期；对应的隔离服务与数据卷已删除；旧 `1h` API JWT 仅在进程内，该复查时点可能仍处签名寿命，但 API 进程已退出，不能访问已退出的自有 API。不得据此声称残留秘密目录已经删除或已自动过期。
  - 旧轮完整事实入口 `failure-summary.json`，明细 `independent-timeout-original-audit.json`、`failure-byte-archive-manifest.json`、`partial-project-precleanup-audit.json`、`cleanup-blocked-audit.json`，均位于旧轮外置证据目录。后续清理必须遵守该自动拒绝边界，本记录不触发再次删除。
  - 本次只新增此验证文档；负责宿主验证和撰写此记录的代理没有修改产品、契约、计划或原架构基线，没有重打包、暂存、提交或推送；本记录与两处宿主外层预算调整由集成负责人聚焦提交。
- 结论与状态：完成（0.0.21 宿主 1/1 + 四链）。不代表整个 T17 完成；不替代最终独立产品审查；被 t17-host-0022 / t17-host-0023 在同一入口上重跑并取代。
- 交叉引用：`t17-service-token-budget-2026-11-20.md`、`t17-local-registry-timeout-2026-11-20.md`、`t17-cli-0021-regressions-2026-11-20.md`、`t17-host-0022-2026-11-20.md`、`t17-host-0023-2026-11-20.md`、`t17-host-fixtures-2026-11-20.md`、`t17-host-guards-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：旧轮 900000ms 超时 RED 已被 1800000ms 预算修正，但旧失败事实保留；success-byte-archive 3916 文件（0.0.21 轮）与 t17-integration 中 0.0.20 轮复核提到的 3916 文件/688779060 字节是不同轮次的不同数值。

### t17-host-0022-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（Antigravity 宿主实现方）/综合；T17 0.0.22 本地完整宿主与清理前原字节封存验证。独立手写 Vue/React SDK 参考页、正向双框架与受控故障修复链均重新执行；组件构建、浏览器与截图均在本机；`productionAcceptance: false`，使用授权创建的工作区外临时工程、本地签名 OIDC fixture 和原字节重放的历史兼容探测。本轮补足清理前证据留存，不把旧版 0.0.21 已删除的工程字节追认为曾归档。
- 目的：对 0.0.22 完成完整宿主实跑并在清理前做全字节封存。
- 承重事实：

  - 证据根 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/host-live-0.0.22-0101f827`。输入：CLI 0.0.22 tarball `.../cli-0.0.22-mwo0jfyw-6oszswub/company-component-cli-0.0.22.tgz`，source HEAD `f96af5ee59cfbd007ba4ff50aad3de60cebafb60`，04:39:01 +08:00 单次冻结，SHA-256 `d3da08748faa4c18a19a8b757caf817dae032e82b9405521a87dd8f877c179ef`，453485 字节；SDK bundle manifest `04a7c4fb...`；历史兼容探测 `c6182081...`。
  - 运行时仓库 HEAD 为 `bf65180a1961421362dca34fd393fe89b6e1809e`，与冻结产物 source HEAD 分别记录。启动器首次因兼容摘要抄错一位而在任何服务分配或产品执行前失败关闭；纠正为上述既有摘要后执行唯一一次完整产品运行，该输入守卫失败没有计为产品测试失败。
  - 命令：`./scripts/pnpm.ps1 exec vitest run --config tests/acceptance/t17-host/local-product.vitest.config.ts --execArgv=--import=file:///D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/host-live-0.0.22-0101f827/evidence-preload.mjs`。冻结输入以 `T17_HOST_CLI_*`、`T17_HOST_SDK_*`、`T17_HOST_COMPAT_*` 和 `T17_HOST_REPO_ROOT` 显式传入；仅 Vitest worker 通过 `--execArgv` 加载外置取证钩子，未设置 `NODE_OPTIONS`；worker 的 `TEMP/TMP` 指向证据根中本轮独占的 `temporary-roots`。原测试级与配置级外层期限均为 `1800000ms`，命令和浏览器内层期限不变。
  - 2026-11-20 **04:47:24.632** +08:00 启动、**04:58:56.424** +08:00 自然退出；1 文件、**1/1** 测试通过，exit 0；Vitest 原日志 `Duration 689.77s`；进程含启动/退出开销为 **691.792 秒**。原始记录 `run-host.ps1`、`inputs.json`、`host-live.log`、`process-result.json`、`worker-launch-binding.json`（后者记录完整命令、配置及六个宿主源文件摘要，独立审计再次核对无变化）。
  - 四链结果：正向 Vue passed / not-needed 0 次 / 6/6；正向 React 同；受控模板故障 Vue failed / repaired 1 次 / 6/6；受控模板故障 React failed / repaired 1 次 / 6/6。六项实际 ID 为 `type-typecheck`、`build-build`、`dependency-guard`、`business-gaps`、`browser`、`visual`。本流程不推断未知错误、用户修改或所有耗尽分支均可修复。
  - 外置取证钩子：`instrumentation-binding.json` 记录钩子 SHA-256 `08eba79c5d49a95520d5d011e425edcee8f1573c44bba3c01c14ffa626971861`。钩子是证据 instrumentation，不是 CLI 产品功能或共享测试夹具修复。产品运行前已完成：13 项合成测试未实现捕获行为的基线 RED（exit 1，4 passed / 9 failed；预期失败位于留存、所有权、链接、变动、活动子进程与凭证阻断；记录 `preload-red.log`、`preload-red.exitcode`）；同一合成测试实现后 GREEN（exit 0，13/13；`preload-green.log`、`preload-green.exitcode`、`evidence-preload.test.mjs`）；独立 Vitest worker 原生探针（exit 0，1/1；显式固定环境的子 Node 未继承归档配置、`NODE_OPTIONS` 或 preload execArgv；`preload-worker-probe.log`、`preload-worker-probe.exitcode`、`worker-probe/`）。
  - 钩子机制：先等待原 `writeFile` 完成，保留原调用的成功结果或原异常对象；仅在本轮确切临时根直接子目录、文件名为 `run-seal.json` 且 session marker、runId、双根 owner marker、目录身份和受支持 seal 结构均匹配时捕获，其他写入保持原行为；原 fixture 要求停止自有进程才可 seal；钩子被动跟踪 worker 子进程并在捕获前后拒绝活动子进程，不改 CLI 子进程的参数或环境。归档前逐项核对原始 `dev/ino`、完整目录子项、类型、链接数、字节数和摘要；浅层根 inventory 与 projects、files、evidenceAreas、installQuarantines 按身份合并，闭合所有声明节点和空目录，并校验 seal 文件引用与工程快照。每份原文件在复制前复读，复制后再同时复读源与副本并比较原字节；目录集合再次核对后，最后写入并复读 manifest，写入 Promise 才返回，原宿主随后才能 cleanup。未将副本 inode 当作原始 inode，未复制 `.tools/recovery` 秘密目录。
  - 清理前完整原字节归档（三份 manifest 位于 `sealed-byte-archive/<runId>/manifest.json`，保存 `parent/` 与 `evidence/`；文件数包括原始 seal、不包括外加 manifest；目录数包括两个 source 根及全部空/非空子目录）：

    | 范围 / runId | 原始 seal SHA-256 | 文件 / 目录 | 字节 | manifest 完成时间 +08:00 |
    | --- | --- | ---: | ---: | --- |
    | reference / `2e395e5e10530bd14eda08e466d9dda3` | `691c8a7dcf4eddc2d702bd3b89501c9d7ea016c255fc9fbcb7b96c708f27366c` | 6267 / 1588 | 608838721 | 04:50:24.952 |
    | positive / `acee1f41a00d959e856d853ae40e1175` | `4ea49a7e887cff5eb08fda43c922f922b4f90a131d16b8a7daee0d1d8707d647` | 14197 / 2502 | 988822132 | 04:54:56.164 |
    | repair / `6688f72897cbf0a78a2b8cdc44fd88f8` | `d24745cca190dc344f062b41aa3e0b96ea55f7f1c3ac177112ffedaa8d0c6ed5` | 14217 / 2515 | 988910630 | 04:58:39.287 |

    合计 **34681 文件、6605 目录、2586571483 字节**。独立审计从原 seal 重新推导完整集合、重新读取全部归档文件的大小与摘要、重新核对仍保留的原 evidence 目录身份/清单/字节；空目录集合一致，链接 0；实际 exit 0 结果为 `independent-full-byte-archive-audit.json`，脚本、原日志与退出码为同名 `.mjs`、`.log`、`.exitcode`。
  - 正向和受控链各有一份 `cli-consumer/node_modules/zod/src/v4/mini/tests/string.test.ts` 命中 JWT 形态，仅在相对路径、15077 字节与 SHA-256 `f4ebdab74387516508d0ce96a56979fe06af7e2425dccc13d34c0a229ba3a050` 全部匹配已知依赖测试夹具时原字节归档，明确分类为非访问凭证夹具；未知 JWT 形态为 0。八个临时 userconfig 在 seal 时均为空字节，实际配置字节已复读。不将形态扫描扩大为任意敏感信息的绝对保证。
  - 四份最终报告与实际 PNG：Vue（正向最终与修复最终）SHA-256 `dc5e078ae1f2dad070c8c11c4b94a734bd9cf7157ee12ae733fcceec3dd7b5fe`，13662 字节，800×400；React `7a6c02a1514de95e24fbb1e165a89eb7898ced19f294194c97fa84aad5d5ae50`，13950 字节，800×400；均与参考字节相同、RGBA 差异 0。实际查看 Vue/React 修复最终 PNG：折线、三天刻度和 Tuesday=75 tooltip 可读；固定 800×400 构图顶部 h1 字形有少量裁切，与独立参考同字节；不据此宣称宿主页排版无瑕或真实业务 UI 已验收。
  - 服务 owner `5ed1785b-3995-4b96-ba87-964055abe102`，精确 Docker 标签 `org.zhinexus.recovery=5ed1785b-3995-4b96-ba87-964055abe102`；入口 `finally services.close()` 后独立复查该标签容器 0、卷 0；秘密目录 `.tools/recovery/5ed1785b-3995-4b96-ba87-964055abe102` 不存在；三个 runId 对应 owned 工程父目录均不存在，receipt 的自有子进程清理字段为 true。
  - 主线独立复核入口 `root-review-handoff.json` 列出三份 manifest、三个原 seal、两个 receipt、四张 actual PNG 的绝对路径与摘要。主线随后实际逐字节复读全部 34681 文件、2586571483 字节，并同时复读 1754 个原 evidence 文件；目录集合无差异、三个 parent 不存在、两份已知依赖夹具分类与未知形态零命中一致。其原结果 `root-full-archive-byte-reopen.json` 为 passed，SHA-256 `6fc6bf67254768a08d1273b9fe4cae4ae0048511b096225907f439539b1dff02`。主线又独立重算四链 plan/apply/spec/report/repair 的 canonical 摘要与四张 PNG，800×400、RGBA 差异 0；`root-host-chain-and-png-reopen.json` 为 passed，SHA-256 `6033503f2a6899fd87e986b5b2799e1824b36a63c42b57af6deb487967e8f08f`。`completion-summary.json` 为完整汇总。
  - 未修改或再次尝试删除此前自动审批拒绝的 0.0.21 / T16 等历史目录，其状态与限制仍由旧记录解释。本子任务仅新增此文档；未修改产品、共享测试、契约、锁文件、版本或原架构基线，未重包、暂存、提交或推送。
- 结论与状态：完成（0.0.22 宿主 1/1 + 清理前全字节封存）。0.0.22 整体仍因 R08 不作交付；被 t17-host-0023 取代。
- 交叉引用：`t17-host-0021-2026-11-20.md`、`t17-host-0023-2026-11-20.md`、`t17-cli-0022-regressions-2026-11-20.md`、`t17-final-review-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-host-fixtures-2026-11-20.md`、`t17-host-guards-2026-11-20.md`。
- 过时或矛盾点：归档字节数 2586571483（0.0.22 轮）与 0.0.23 轮 2586567819 不同；`root-full-archive-byte-reopen.json` 的 SHA-256 在 0.0.22 与 0.0.23 两轮不同（6fc6bf67... vs 2f514f635...），不得混用。

### t17-host-0023-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（Antigravity 宿主实现方）/综合；T17 0.0.23 完整本地宿主与清理前原字节封存验证。CLI `0.0.23` 唯一冻结包的新一轮完整本地宿主实跑；独立手写 Vue/React SDK 参考页、双框架正向链和受控故障修复链均重新创建并执行，不借用 0.0.22 结果；所有组件构建、运行、浏览器与截图均在本机，`productionAcceptance: false`。用户已授权创建临时 Vue/React 工程并在完成后清理；本流程使用本地签名 OIDC fixture 及明确标记的历史兼容输入。
- 目的：对 0.0.23 完成完整宿主实跑、清理前全字节封存与独立复读。
- 承重事实：

  - 持久证据根 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/host-live-0.0.23-61bc5f2d`。输入：CLI 0.0.23 tarball `.../cli-0.0.23-edb985ec-b8f572a9/company-component-cli-0.0.23.tgz`，454155 字节，SHA-256 `93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab`；`freeze-manifest.json` source HEAD `edb985ec0f9ee1b79a5882e935832f8caa9f0daf`、`packCount: 1`；SDK bundle manifest `04a7c4fb...`；历史兼容探测原件 `c6182081...`（来源保持 `historical-real-installed-cli-probe-replay`，不重新命名为当前兼容探测或生产验收）。
  - 启动时仓库 HEAD 与 CLI source HEAD 均为 `edb985ec0f9ee1b79a5882e935832f8caa9f0daf`。启动器在运行前、进程结束后重新读取输入，独立审计随后再读，CLI 大小与三项摘要均一致。本子任务没有重新 pack，也没有修改产品、宿主夹具、契约、依赖或期限。
  - 命令：`./scripts/pnpm.ps1 exec vitest run --config tests/acceptance/t17-host/local-product.vitest.config.ts --execArgv=--import=file:///D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/host-live-0.0.23-61bc5f2d/evidence-preload.mjs`。`T17_HOST_CLI_*`、`T17_HOST_SDK_*`、`T17_HOST_COMPAT_*` 与 `T17_HOST_REPO_ROOT` 显式绑定；worker 的 `TEMP/TMP` 使用本轮证据根下独占 `temporary-roots`；原测试级与配置级外层期限均为 `1800000ms`，命令与浏览器内层期限保持原值；`worker-launch-binding.json` 在执行前封存完整入口、六份宿主源文件摘要和取证钩子摘要，事后独立复读一致。
  - 2026-11-20 **05:53:05.194** +08:00 启动、**06:13:41.658** +08:00 自然退出；进程耗时 **1236.464 秒**；Vitest 原始输出 **1 文件、1/1 测试通过、1235.87 秒、exit 0**，无 skip。原始文件为 `run-host.ps1`、`inputs.json`、`host-live.log`、`process-result.json`、`worker-launch-binding.json`。
  - 四链结果：正向 Vue passed / not-needed 0 次 / 6/6；正向 React 同；受控模板故障 Vue failed / repaired 1 次 / 6/6；受控模板故障 React failed / repaired 1 次 / 6/6。四份最终报告的 `toolVersion` 都是 `0.0.23`，`visualResult: PASS`。六项实际 ID 为 `type-typecheck`、`build-build`、`dependency-guard`、`business-gaps`、`browser`、`visual`；正向与修复链均从工作区外实际安装的同一冻结 CLI 和 SDK 运行；原 receipt 保存 plan/apply/spec/report/repair 摘要及构建导入证据，`verifyHostChainReceipt()` 对两份原 receipt 的独立复验均通过。受控模板故障保留初次失败报告和一次真实写入，不据此推断任意未知错误均可自动修复。
  - 取证隔离：清理前封存沿用已审查的 worker-only additive 钩子，源码 SHA-256 保持 `08eba79c5d49a95520d5d011e425edcee8f1573c44bba3c01c14ffa626971861`；历史钩子 RED 见 0.0.22 独立记录，本轮没有把历史 RED 重记为新 RED；本轮重新执行 `node --test evidence-preload.test.mjs` 13/13 exit 0、原生 Vitest worker 隔离探针 1/1 exit 0（保留、所有权、链接、变动、活动子进程与未知凭证阻断等断言通过）。正式执行仅通过 Vitest worker `--execArgv` 加载钩子，没有设置 `NODE_OPTIONS`，不改 CLI 子进程的参数或环境，也不放宽产品断言。
  - 清理前完整原字节归档（manifest 位于 `sealed-byte-archive/<runId>/manifest.json`；文件数包含原 seal，不含额外 manifest；目录数包含两个 source 根与全部空/非空子目录）：

    | 范围 / runId | 原始 seal SHA-256 | 文件 / 目录 | 字节 | manifest 完成时间 +08:00 |
    | --- | --- | ---: | ---: | --- |
    | reference / `5c56e83f88ee4cf1ec1ed89ccb5deef1` | `1578928e6f3fd5fd6b85c3bd88254c74e9a8afd2dd4394ad5acaaa7199593011` | 6267 / 1591 | 608840155 | 05:59:42.538 |
    | positive / `e9dac676714b9a5f058f321c6ad939f0` | `5d8679f3f65c57a284250b434934d85138a39b76fde8eb2052f395107750f1b4` | 14197 / 2510 | 988819475 | 06:08:26.781 |
    | repair / `af6554b52a89b3cace6eae645f77c65b` | `c451df3d3a3e9c40c2bdea9ff9bd64ed46626474dd3ea2bd28757b161fbb57a8` | 14217 / 2511 | 988908189 | 06:13:26.512 |

    合计 **34681 文件、6612 目录、2586567819 字节**。`archive-map.json` 索引三个原 seal、manifest 摘要、身份边界与计数，SHA-256 `8b2fc26de232343cee19147ef2aaeb4ea8f0c6e24ba7052193e1d5104b168f65`。原 parent 的 inode/字节证据来自清理前读取；后续复读副本不将副本 inode 冒充原身份。
  - 独立审计从原 seal 重新推导完整集合，重新读取全部归档文件的大小与摘要，并重新核对仍保留的原 evidence 目录身份、清单与字节；空目录集合一致、链接 0、未知凭证形态 0。正向与修复各一份 `cli-consumer/node_modules/zod/src/v4/mini/tests/string.test.ts` 命中 JWT 形态（15077 字节 / SHA-256 `f4ebdab74387516508d0ce96a56979fe06af7e2425dccc13d34c0a229ba3a050`），明确分类为非访问凭证；不把形态扫描称为任意敏感信息的绝对保证。seal 中临时 userconfig 均为空字节，`.tools/recovery` 秘密目录未复制进归档。
  - 独立复核输出：`independent-original-complete-audit.json` exit 0（`verifyIndependentReferenceBaselineSeal()`、两次 `verifyHostChainReceipt()`、原 inventory、冻结输入与清理边界通过），SHA-256 `c1a81cc71be7fa9fe366f6d2f3471e1c2586e8e9d6e76620c6bdde6925b378a0`；`independent-full-byte-archive-audit.json` exit 0（34681 文件、6612 目录、2586567819 字节完整复读），SHA-256 `a61fa62abf6f3dfd794cff4559861c70272d1e62f8f1b2a301b5ed632530346a`；`four-final-screenshot-independent-audit.json` exit 0，SHA-256 `fc7bfe5f5ba98b306a0c78ff0f400b3d575287d2d4c552406667cfc2bceea836`。三个复核入口分别为 `independent-complete-audit.mjs`、`independent-full-byte-archive-audit.mjs`、`independent-screenshot-audit.mjs`，各自 `.log` 与 `.exitcode` 保留。第一项通过固定工具链 `pnpm exec tsx` 执行，后两项通过固定 Node 执行，没有重复运行产品验收或改变预期。
  - 四张 PNG：Vue（正向最终、修复最终）SHA-256 `dc5e078ae1f2dad070c8c11c4b94a734bd9cf7157ee12ae733fcceec3dd7b5fe`，13662 字节，800×400；React `7a6c02a1514de95e24fbb1e165a89eb7898ced19f294194c97fa84aad5d5ae50`，13950 字节，800×400；均与本轮独立参考字节相同、RGBA 差异 0。本记录作者实际查看本轮 Vue/React 修复最终 PNG：折线、三天刻度与 Tuesday Revenue=75 tooltip 可读；固定 800×400 构图顶部 h1 有部分裁切，与本轮独立参考同字节；保留该限制，不据此宣称真实业务 UI 排版验收通过。查看记录 `visual-inspection.json`。
  - 本轮服务 owner `48665ef7-067e-47cb-988b-ff0da675de2e`，标签 `org.zhinexus.recovery=48665ef7-067e-47cb-988b-ff0da675de2e`；入口 `finally services.close()` 后独立检查：容器 **0**、卷 **0**，本轮 `.tools/recovery/48665ef7-067e-47cb-988b-ff0da675de2e` 秘密目录不存在；三个 runId 的 owned 工程 parent 均为实际 ENOENT，receipt 自有子进程清理字段为 true。原 evidence、归档字节与取证辅助文件继续持久保留。没有接触或重试清理任何历史政策拦截路径。
  - 主线独立复核入口 `root-review-handoff.json` 列出三份 manifest、三个原 seal、两份 receipt、四张 actual PNG 及 29 项外置文件摘要，SHA-256 `6b662684d98ab9cda2c5d6ee3a5ae05911c6f02550a4646fc29667760cec05e5`；完整汇总 `completion-summary.json` SHA-256 `d2491808bc7df43995c066354a10a8e1f6f15291251a17370daaf68c5b75699d`。
  - **06:25 主线第二次独立复读**：本分项原记录提交为 `7ec3a665`。控制方另行逐字节重开全部 34681 份归档文件、2586567819 字节，并对仍保留的 1754 份原 evidence 再读原件，集合与摘要相符，`failures=[]`；`root-full-archive-byte-reopen.json` SHA-256 `2f514f63571cde29a0f790a853ccf54abb60085df18d35ab5e0a84c14cdf1dfb`。删除后的 parent 身份仍只依据清理前 manifest，不声称事后观察到原 inode。控制方还对三个原 seal、完整 retained inventory、两份 receipt 和唯一冻结输入再次执行原校验 API，复查三个 parent 的 ENOENT、本轮秘密目录不存在、精确 owner 容器/卷为 0；`root-second-original-complete-audit.json` SHA-256 `02fd1351f472ff595a4f686695ee888e4ee494af6a2aabdd40d00a546af680c5`。独立重算四条 plan/apply/spec/report/repair canonical 链，最终各六项 passed；两条故障链均保持初次 failed、一次 repair 后 passed；四张实际 PNG 与本轮独立基线再次逐字节和解码 RGBA 比较，差异为 0；`root-host-chain-and-png-reopen.json` SHA-256 `5e5eb0b55f6f33ead7555a6c6a436924c7999c478a37f9ecdc7addcddb5f7cbd`。这些复读没有重新运行产品验收、改变分母或重包。本子任务仅新增此文档；未修改原架构、产品、共享测试、契约、锁文件或版本，未重包或推送。
- 结论与状态：完成（0.0.23 宿主 1/1 + 四链 6/6 + 双重独立复读）。是 0.0.23 最终交付的宿主依据。
- 交叉引用：`t17-host-0022-2026-11-20.md`、`t17-cli-0023-regressions-2026-11-20.md`、`t17-completion-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-host-fixtures-2026-11-20.md`、`t17-host-guards-2026-11-20.md`。
- 过时或矛盾点：`root-full-archive-byte-reopen.json` 在 0.0.22 与 0.0.23 两轮 SHA-256 不同，且 0.0.23 轮的控制方复读值（2f514f635...）与本分项记录的独立审计值（a61fa62a...）也是不同文件，不得混用。

### t17-host-fixtures-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（宿主夹具）；T17 冻结产品宿主夹具修正。补充完整宿主真实失败后的夹具修复，不改写既有失败结果，不修改 CLI 产品，也不重新 pack 0.0.20。
- 目的：修三处宿主夹具缺陷，使完整双框架宿主可真实跑通。
- 承重事实：

  - 缺陷 1：Vite 构建图插件在没有 `T17_BUILD_GRAPH_OUT` 时原先把 undefined 交给 `writeFileSync`，冻结产品正确清洗额外环境变量后构建失败。插件改为仅在显式提供输出路径时写构建图；独立预构建仍必须生成真实模块证明。Vue/React 缺环境两例 RED，四例回归 GREEN。
  - 缺陷 2：原 TEMP/TMP 指向消费者源码树内，原生编译缓存正确触发产品源码变更守卫。缓存迁入本轮自有的工程外证据区，正常与失败路径均登记原有内容、封存和清理身份；真实 OwnedRun 的失败清理回归先 RED 后 GREEN，未放宽源码守卫。
  - 缺陷 3：原冻结子进程未取得项目包装器设置的本地 Playwright 路径，完整宿主第二轮 type/build/dependency 通过后浏览器启动失败。真实最小 probe 使用相同环境失败，单独增加项目 `.tools/playwright` 后启动 Chromium **158.0.8127.18** 成功。chain 通过现有 extraEnv 传入已验证 `toolchain.repositoryRoot` 下的固定缓存目录；未扩 runtime 白名单或采用全局浏览器。新增路径期望先 RED 后 GREEN。
  - 作者完整 host 支架为 **10 文件、118/118**，根 TypeScript exit 0。集成方独立执行 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-host/vitest.config.ts')`：2026-11-20 **03:06** 实际 10 文件、118/118，exit 0、**20.53 秒**。
  - 集成方同步全根 TypeScript 检查撞到并行 N10 评分接口未完成窗口，不能据此声称最终全根检查通过，待接口完成后统一复验。
  - 第二轮完整宿主仍如实为失败（**218.49 秒**），1077 份失败证据已逐份核对摘要后保留，JWT 形态扫描 0 命中；本轮正向、参考、recovery 目录已按所有权守卫清理，所属容器/卷为 0。第三轮使用同一 0.0.20 tarball SHA-256 `8d56d87e9cc832562c096ba8cd16504ffb5104e688ca8a3df9436447df6c4252` 重新运行，结果另记；本记录不将支架通过等同完整双框架及 repair 验收通过。
  - 完整产品入口为 `tests/acceptance/t17-host/local-product.vitest.config.ts`，需独立记录双框架通过及已知模板故障实际 failed→repair→passed；上述单元配置不替代该验收。
- 结论与状态：完成（夹具修正 + 支架 118/118）。第二轮宿主仍失败；第三轮结果另记（后续由 t17-host-0021/0022/0023 承接）。
- 交叉引用：`t17-cli-0020-regressions-2026-11-20.md`、`t17-host-guards-2026-11-20.md`、`t17-host-runner-2026-11-19.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：Chromium 版本 158.0.8127.18 为该轮本机值；"第二轮仍失败、第三轮另记"的过程已被后续 host-0021/0022/0023 覆盖。

### t17-host-guards-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（宿主夹具/守卫）；T17 临时宿主封存与清理守卫补充。仅证明验收设施的定向回归，不将临时 synthetic 工程等同历史真实业务试点，也不声明完整 T17 已通过。
- 目的：为宿主封存、receipt 回读、npm cache 外移等证据闭环补 RED/GREEN。
- 承重事实：

  - `prepareInstallDelivery` 在 apply 前捕获自有项目原安装树、父目录和空备份区的身份与完整字节；执行后只凭绑定 `projectRoot`、`operationId`、`planDigest`、`importer`、`targets` 的真实 install-delivery journal，复验原树 inode/字节和父目录变化，才登记产品 quarantine；目录名前缀本身不能授予所有权。
  - receipt 回读完整 verify-out 清单、文件实际字节及路径身份，并将 spec baseline、repair backupRef、备份内容与 beforeHashes 绑定；增加删改基线、备份、未知新增文件、junction/hardlink 和目录替换的真实 RED/GREEN。
  - npm 下载 cache 外移到每次独占的工程外 evidence area，保留工程内空配置的身份与字节守卫；真实大于 4 MiB 文件回归 RED→GREEN，未调宽产品源码快照预算。
  - cache inventory 安全拒绝前先保存有界 stdout/stderr；新回归 RED 1 failed（缺失输出）；修复后完整 `exec vitest run --config tests/acceptance/t17-host/vitest.config.ts` 为 **9 文件、111/111**、exit 0、**15.75 秒**。
  - 独立审查复跑 host/chain/runtime/chain-failure 为 **88/88**、exit 0、**9.46 秒**；未发现 confirmed Critical/Important；审查记录位于仓外 `host-independent-review-5ae1c2cc/review-summary.json`。
  - 集成全图 `exec turbo run build typecheck --force` 为 20/20、0 cached、exit 0；根 tsc exit 0；原始日志位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/workspace-0.0.20-8d4edd6643ed45c2ac85c3a8ac6c123f`。
  - 完整产品入口为 `tests/acceptance/t17-host/local-product.vitest.config.ts`，需独立记录双框架通过及已知模板故障实际 failed→repair→passed；上述单元配置不替代该验收。
- 结论与状态：完成（定向回归）。单元配置不替代 `local-product.vitest.config.ts` 完整验收。
- 交叉引用：`t17-host-fixtures-2026-11-20.md`、`t17-host-runner-2026-11-19.md`、`t17-host-0021-2026-11-20.md`、`t17-repair-source-continuity-2026-11-20.md`。
- 过时或矛盾点：与 t17-host-fixtures 的 118/118、t17-integration 的 62/62 是同一 host 支架套件在不同时点的不同文件数/计数口径，非矛盾但不可混用。

### t17-host-runner-2026-11-19.md

- 日期／角色／主题：2026-11-19；A（宿主 runner）；T17 owned-host runner 实测记录。范围：T17 host runner 在 Windows 临时消费者上安装冻结 CLI，并分别执行 Vue/React `integrate inspect`。有限的黑盒实测，不代表 T17 整体验收通过。
- 目的：首次实测 owned-host runner 安装冻结 CLI 并执行双框架 `integrate inspect`。
- 承重事实：

  - CLI：`@company/component-cli@0.0.17`，tarball SHA-256 `02f8d5277952c072be47bfb8f907424fbbcf4a992c3ed6a625350c8628c78df2`，**445,771 bytes**。
  - 安装后 CLI bin SHA-256 `0d31b3052077b6e39995859b1bea4baac8ec052b1f529dba4dcf5f6eb7ab8753`。
  - runner runId `3a59aac35483afd778d6a0e07cec1eb9`；临时 CLI/Vue/React 项目根由 owned-run 在完成后清理。
  - 封存证据：`<系统临时目录>\zhinexus-t17-evidence-<runId>-<suffix>\run-seal.json`，seal payload 为 `passed`，封存 **9 个文件**。
  - Vue inspect stdout SHA-256 `16c5140fdc5ff95ecf2cef06c2b7e99488b6517e17ed80f903c3c89b859a9105`；React inspect stdout SHA-256 `d3b762bc7c1198c546ec91058b29c8cc00cef69593d68bd722c5a1ce5aad4b01`；两次 stderr 均为空。
  - 观察结果表：Vue 进程结果 exit 0、CLI 报告 `inspected`、npm / `package-lock.json`、冲突 0、文件快照 2；React 同。
  - 报告识别到 Vue `3.5.45` 或 React `19.3.1`、ECharts `6.1.0`，以及固定模板中的 Vite / TypeScript 依赖。runner 核对冻结 tarball 摘要、安装包身份与版本、安装后的 CLI bin 摘要，分开保存 stdout 和 stderr，并在完成后停止所拥有的进程，再封存结果。
  - 验证命令：`scripts/pnpm.ps1 exec vitest run --config tests/acceptance/t17-host/vitest.config.ts`：**4 个测试文件、43/43 通过**；runner/host 九个 TypeScript 源码与测试文件的独立严格检查 `tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node ...`：exit 0；`git diff --check` exit 0（Git 提示 `runtime.ts` 的工作区 CRLF 将规范化为 LF）；真实 runner 使用仓库固定 Node `26.13.0` 与 npm `11.20.0`；tarball 安装及 Vue/React inspect 均成功，seal 已从证据目录重读核对。
  - 未覆盖范围：此 tarball 是 T16 `integrate inspect` 基线；该运行没有证明 T17 的 plan/apply/verify/repair、四项 MCP 工具、浏览器构建与交互、视觉基线、20 个正向场景和 13 个拒绝场景，也没有连接真实 API、Verdaccio 或有效 variant-release 映射。上述场景和完整 T17 仍未验收；本记录不得用于将 T17 状态改为完成。
- 结论与状态：完成（runner 冒烟）。为 T17 host runner 首个实测；被 t17-host-fixtures / t17-host-0021 等取代为完整宿主。
- 交叉引用：`t17-blackbox-2026-11-19.md`、`t17-matrix-2026-11-19.md`、`t17-host-fixtures-2026-11-20.md`、`t17-host-guards-2026-11-20.md`。
- 过时或矛盾点：CLI 0.0.17 与后续 0.0.20–0.0.23 完全不同代；43/43 与后续 118/118、111/111 等是不同时点的套件规模。

### t17-integration-2026-11-20.md

- 日期／角色／主题：2026-11-20；综合（集成方追加式续接记录）；T17 集成与验收续接记录。不替代既有验证记录；当前仍在完成冻结产物的真实宿主、矩阵与黑盒验收。用户已授权本轮创建临时 Vue/React 工程，验收后清理；此类工程标记为 temporary/synthetic。
- 目的：按时间线（初始 → 01:18 → 01:39 → 02:18 → 03:32 → 04:54 → 05:15 → 05:28 → 05:36 → 06:02 → 0.0.23 各节）续接记录 T17 全过程。
- 承重事实：

  - 初始已运行验证（`feat/t17-integration` 集成工作树内，`.tools` 固定 Node 26.13.0、pnpm 12.18.0）：`turbo run build typecheck --force` 20/20、0 cached、exit 0；`test` T10 **161 passed / 7 skipped**，Vitest **109 文件、1996 passed / 2 skipped**，exit 0（首次未注入冻结 SDK，跳过项另行补跑）；带 `A10_FROZEN_BUNDLE` 与 `ZHINEXUS_SDK_BUNDLE_DIR` 的 `test:t10` **168/168**、0 skipped；带 `A10_FROZEN_BUNDLE` 的两文件窄测 **27/27**；`test:browser` **282 passed / 2 failed / 4 did not run**，exit 1（失败原因为未设置 `ZHINEXUS_SDK_BUNDLE_DIR`，保留首次失败事实）；带冻结 SDK 路径的 `test:browser tests/browser/web-upload-real-e2e.spec.ts` **6/6**；四文件窄测 **35/35**；`verify:workspace` 10 members（升版至 0.0.18 后运行）；host 支架套件 **6 文件、62/62**（含新 local-services 的 5 个单测，不计产品矩阵）；matrix 支架套件 **9 文件、75/75**（修复真实 plan/apply 契约误判，不计 20 场景实跑）；带冻结 SDK 与独立 Next 5173 的 `test:platform` **35 文件、137/137**，331.38 秒；环境指纹修复后四文件窄测 **37/37**（42.78 秒，含真实 FontFace、实际 CDP revision、Playwright 组合 selector 与字体超时失败关闭）；`--filter @company/component-cli build` 与 `typecheck` 均 exit 0，打包 probe 清单 **73 文件**、0 缺失/额外/污染/链接/改动；新 repair 评分回归后的完整 matrix 支架套件 **10 文件、94/94**（RED 首轮 2 failed / 12 passed；修复场景、空输出与磁盘加载回归，不计产品实跑）。
  - 冻结 SDK：core 0.0.11、Vue/React 0.0.12；manifest SHA-256 `04a7c4fb...`，199 个文件；未重打包。
  - `prepareT17LocalServices()` 为本轮创建带随机 owner 标签的 PostgreSQL/Verdaccio/MinIO 和编译后的 Nest API；不重启、不修改现有 G2 容器；凭据只在内存和自有临时秘密目录内使用，返回的令牌字段不可枚举。最终真实 smoke **1/1（38.88 秒）**，14 个实现 Ready；私有 API `/v1/me/variant-releases/:id` 与私有 Registry reader 可读，Registry 匿名访问被拒绝，公共 npm 依赖由本次 Verdaccio 代理；此为本地签名 OIDC fixture，不是生产 OIDC 验收。smoke owner `0b73526b-1d9c-4734-89a1-b08ce557d3a5` 收尾：容器 0、卷 0、凭据目录已删除；已有 Docker 资源未操作。smoke 结果位于 `.tools/operations/t17-local-services-smoke/t17-local-services-1cXUSf/smoke-result.json`。
  - 聚焦提交：`3cecc0cc`（固定 MCP 证据物理目录并拒绝运行目录链接；独占写保护既有证据；窄测 35/35、diff check 通过，独立审查无确认的 Critical/Important 回归）；`c901d5d3`（CLI 升级至 0.0.18，同步 CHANGELOG；工作区检查通过；该提交时尚未冻结，随后在下述环境指纹修复提交后一次性冻结）；`b46ef834`（从实际 Chromium CDP、页面字体与已安装依赖采集环境指纹；窄测 37/37、CLI build/typecheck 与 diff check 通过）。
  - **0.0.18 单次冻结**：来源提交 `b46ef8343949bb3ea06d7839404377f1ab4d4b70`；冻结时 `packages/component-cli` 无未提交源码修改；tarball `company-component-cli-0.0.18.tgz`，**451148 字节**，SHA-256 `08d201fa8bf469dac373499c976cf66ae90809ac098895a4b591ab321c5c88d0`；仓外冻结目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.18-bac1c036-dd27-43c4-a160-ace38fc6c415`，同目录 `freeze-manifest.json` 保存来源、时间、大小与摘要。反重力宿主、Codex 矩阵与黑盒，以及 T15/T16 回归均已收到同一冻结输入；后续不重打包该候选。
  - 冻结前发现：独立矩阵实现发现 T17 浏览器报告仍回退到默认字体摘要和 browser revision，按 TDD 修复、独立复验并提交后才冻结候选；V10/R10 的 `requiresRepairFault` 此前未被评分器读取，新增 seal 绑定的 initial failed report / repair result，要求合法非零尝试、连续报告与源码保护摘要、最终 passed 报告及生成文件字节一致，成功命令的真实空 stdout/stderr 可按空字节 SHA 封存；实际 Antigravity 已恢复主责真实双框架宿主 browser/visual 链，Codex 辅助环境、独立审查与复验；实际 Claude Code 本轮调用约 15 分钟仍无文件交付，模型渠道告警后仅终止该次自有进程，无可计入的 RED 交付；Root 已接手并复现评分缺口，保留原有测试修改。
  - **01:18 续接**：`c14ab932` 已聚焦提交 repair 评分与真实空输出证据修复，完整矩阵支架 10 文件 94/94，独立评分复验 23/23（仍不计为产品矩阵通过）；同一 0.0.18 冻结 tarball 的 T15 回归 **25/25**、exit 0、**51.42 秒**（结果与 Vue/React last/match JSON 保留于仓外 `t15-regression-EuEuPg`；仅本轮 `zhinexus-t15-installed-EuEuPg` 临时根核验安装版本与摘要、无 reparse point 后移入系统回收站，原路径已不存在；没有永久删除或清空回收站）；T16 0.0.18 冻结回归 **13 passed / 1 failed**、exit 1、**674.33 秒**，失败为 `Next App Router Server Page directly consumes the installed generated React client component`，apply 返回 `rolled-back`、`INSTALL_FAILED`、`reinstall-required`（证据暂留 `zhinexus-t16-installed-eDXabl`，不得记为 T16 全绿）；独立黑盒从仓外已安装 CLI、仓外工程 cwd 启动时发现 `install.ts` 只从模块目录和 cwd 祖先查找固定工具链、未从实际固定 Node 的 `process.execPath` 查找，导致执行安装前即 `INSTALL_FAILED`/`not-run`（修复仅在最后增加真实执行 Node 的路径来源，保留原优先级、固定绝对路径与三项精确版本校验，无 PATH 降级；专用真实外部模块/外部 cwd 测试 RED 2 failed / 1 passed，作者 GREEN 3/3、安装隔离合计 56/56）；V01 独立参考安装出现 Vite 构建缺少 `@rolldown/binding-win32-x64-msvc`（确认为当前 rolldown 1.2.18 声明的精确可选依赖，具体漏装原因尚未确认，下一轮 fixture 设为精确显式依赖并清理前封存 npm 诊断日志）；V05/R05 冻结 readySelector 明确匹配三个组件而矩阵执行器误要求唯一，控制方新增真实 Chromium 回归，RED 1 failed / 13 passed，修复为至少一个匹配、逐个可见且尺寸非零、共用有界时间和稳定数量检查，GREEN 14/14，预声明动作、数量和三个 canvas 门槛均未改变。
  - **0.0.19 冻结与复验**：`388c75e5` 支持仓外安装 CLI 从实际 Node 定位固定工具链，控制方复验 `project-install-toolchain.test.ts` 与 `project-install-isolation.test.ts` 为 2 文件 56/56、exit 0，CLI typecheck/build 均 exit 0，probe 清单 73/73；`1615dfc5` 独立升级 CLI 至 0.0.19，补齐 CHANGELOG，`verify:workspace` 10 成员、无环、安全服务依赖图，exit 0；新包仅打包一次 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.19-43934935-59c2-4569-8b7e-009f07721519/company-component-cli-0.0.19.tgz`，**451225 字节**，SHA-256 `45a514e9c18e532f7777d57581d7e5879deb1a6997b25009e3d2aad5e3a2500a`，来源 `1615dfc5c6761aa8ccde76708893d5b8e48e797c`，0.0.18 原包未修改、未覆盖；新包 T15 25/25、exit 0、60.20 秒（最初一次误写不存在的 `t15-installed.config.ts`，仅配置启动失败，没有执行测试；仓外结果 `t15-regression-508m5k`，四个 JSON 原始证据逐文件摘要已核对；仅本轮临时根 `zhinexus-t15-installed-508m5k` 移入系统回收站）；旧 T16 0.0.18 根的 101 个顶层 JSON 已核对凭据与摘要后归档至 `t16-regression-eDXabl`（未复制 config/cache/node_modules），独立诊断方完成只读取证后仅本轮旧根 `zhinexus-t16-installed-eDXabl` 移入系统回收站，旧 owner 容器和卷均无残留；新包工程强制全图 `exec turbo run build typecheck --force` 20/20、0 cached、exit 0、22.51 秒；控制方最新完整 matrix 支架复验 10 文件 100/100、exit 0，随后根 `tsc --project tsconfig.json --noEmit` exit 0（B 的新 rolldown 测试已 GREEN，先前并行开发窗口的 99 passed / 1 failed 是该新增回归的 RED，保留失败事实）；新包 Next-only 诊断已真实捕获 `npm ci` 的 `ECONNRESET / Error: aborted`，阶段为 materialization，候选锁生成 exit 0，主轮与低层独立诊断均保留去敏 npm 日志（该证据确认传输失败，不证明工具链问题重现；原约定要求私有 registry 单来源与鉴权槽绑定，未擅自改为绕过注册表下载）；新包黑盒阶段性结果：仓外 cwd Vue CLI 与 Vue MCP 完整成功链均已通过，MCP 无 apply/verify grant 拒绝且源不变，React 与取消链仍在运行。
  - **01:39 续接**：同一冻结 0.0.19 完整根 `test` 自然结束：T10 168/168、0 skipped；Vitest **116 文件、2049/2049**、0 skipped，exit 0，**638.91 秒**（带有效 `A10_FROZEN_BUNDLE` 与 `ZHINEXUS_SDK_BUNDLE_DIR`，没有用环境缺失跳过代替验收）；带有效冻结 SDK 的完整 `test:browser` **288/288**、exit 0、约 3.3 分钟，包括六项真实三存储网页提交验收；真实黑盒 `tests/acceptance/t17-blackbox/live.spec.ts` **5/5**、exit 0、**607.06 秒**（覆盖 Vue/React × CLI/MCP 四条真实安装、plan/apply/type/build/click/visual 成功链及 CLI/MCP 语义等价，四项无 grant 拒绝且项目不变，双框架 failed verify 后无配方 repair 明确停止，以及真实 MCP SDK 取消通知和三层子孙进程在 server 关闭前退出、取消后 server 仍响应；此处的 repair 停止不能替代另一路受控故障修复成功验收）；黑盒稳定证据 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/blackbox-live-0.0.19-ff3e14e7-d6b6-46bd-93cf-c26971fb6a89/retained-evidence-audit.json`，12 份原始与复制 receipt SHA-256 逐项一致，CLI tarball 摘要未变，SDK 199 文件字节/摘要复核通过，145 份保留文本 JWT 形态扫描零命中；自有临时项目、外装 CLI、自有 recovery 目录已清理，final cleanup `passed: true`；Next-only 诊断进一步确认测试基础设施超时：同配置 Verdaccio 冷代理下载四个大包均在约 30 秒中断，去敏 debug 日志明确为 `ETIMEDOUT` / `Timeout awaiting 'request' for 30000ms`，实际 `options.timeout.request=30000`，顺序重试 next/swc 仍在 30 秒失败，echarts 与 rolldown 分别在 27.9 秒、11.6 秒完整成功，公网探针也较慢；矩阵独立参考的 V01 已通过真实固定点击 0→1、1 canvas、零 pageerror，后续 apply 因 fixture 中项目级 `.npmrc` / overrides 被现有安全配置约定拒绝，已交原作者纠正 fixture，不扩大产品支持面。
  - **02:18 续接**：`abfcba8b` 完善矩阵多 ready 元素与失败请求保留（真实 Chromium RED 2 failed，GREEN 16/16；其后补异步 count/text/visible 原精确断言的有界等待，新增真实 Chromium RED 3 failed / 3 passed，GREEN 6/6；完整浏览器及通用执行链 6 文件 69/69，测试源码 tsc、diff check 均 exit 0；没有更改场景动作、期望、分母或超时失败要求）；`10cfb5fd` 仅将隔离验收 Verdaccio 的 upstream request timeout 提高至有界 5 分钟，保留单一 registry 与精确鉴权槽，固定镜像解析为 300000ms，此前日志的 30000ms 截断保留；完整 0.0.19 T16 现为 **14/14、exit 0、657.24 秒**，无测试名过滤，覆盖 Next App Router，前后 tarball SHA-256 均为 `45a514e9...`，稳定证据 `t16-full-0.0.19-timeout5m-5d3483a5fdb94f75a0dd1c3ead1574de`，归档 103 份进程 JSON、10 份去敏 npm 日志及汇总，138 份归档文件已重读摘要，本轮 owner 容器、卷均为 0；首轮固定 33 格产品矩阵均已执行并封存，但实得 **0/20 正向、6/13 拒绝**，不能标为通过，seal `2a8acbd3c97f9224607ee5392c90828a683a8cc3d8a26515a302cdfac6b86d5b`，908/908 文件字节与摘要已复核，该轮 parentRoot 已清理，正在修正初始预装 SDK、公开 config.chart、React 属性/事件和 Vue KeepAlive 等验收 fixture 问题，不改冻结分母或预期；宿主完整实跑先后真实失败（首轮为构建图包含 Vite 虚拟模块；新轮为源码扫描遇工程内 npm 大包缓存，随后未登记的产品 `.t16-quarantine-*` 掩盖了原始 blocked 报告），新轮日志 `host-live-0.0.19-rerun-9654403098c7437eba1328bd6bccb1ff`，1 failed、exit 1、182.98 秒，冻结摘要未变；失败早退清理补充真实 OwnedRun/scaffold 回归（RED 2 failed，登记本轮已创建 evidence area 的现有条目后 GREEN chain 相关 11/11；仍由原生身份、owner marker 和旧内容清单拒绝未知替换；报告 artifact 的封存后篡改/删除曾 RED 1 failed，补逐路径、类型、realpath、nlink、封存 inventory/摘要/大小重读后宿主 9 文件 80/80；独立审查再发现 spec 基线与 repair 备份不在 report.artifacts 中，正补完整回读与专门 RED，不能据 80/80 宣称全部证据闭环）；npm 下载 cache 外移至每次独占的工程外 evidence area，物理大文件回归 RED 1 failed，GREEN runtime 17/17，该项仅修临时宿主，不修改产品源码检查预算。
  - 既定 no-install 语义的遗漏与补齐：先前认为须另问语义决策，补查后确认已提交的 `8def5ad1993b9bd8fa1643279041135ef82bf1ce`（2026-11-19）已明确（设计第 70 行、实施计划第 17/49–51 行要求保留 T16 `not-run + installedVersions=[]`，由 T17 verify 独立读取实际安装树、lock 与清单），因此按已确认范围补齐，不重复等待用户决策；原共享 apply context 无条件要求全量安装版本，与产品 no-install 分支不符，新增四例，真实 RED **2 failed / 87 passed**，最小修复为 no-install 不可伪造列表、计划需要安装时仍必须 succeeded 和精确全量列表，GREEN 六套契约/产品回归 **254/254、exit 0、49.73 秒**；矩阵旧合成 fixture 也伪造了 not-run 的非空安装列表，改为诚实空列表并仅在 apply 实际 succeeded 时核其安装列表，verify 报告仍必须有全量实际版本及清单摘要，相关错版本反例不变，修正前矩阵 18 项失败保留，修正后矩阵 23/23（与 runtime 合计 40/40）通过，未降低正向门槛、强制拒绝或真实安装 proof 要求；真实固定 pnpm 12.18.0 先导确认默认 `verifyDepsBeforeRun` 可在 run 前自动安装，甚至安装失败后脚本仍 exit 0，产品需显式禁该隐式安装并补原生 RED/GREEN，最终将独立升版、另立一次冻结并复验，0.0.19 原包/证据不覆盖、不重打包。
  - 清理受限保留项：自动审批拒绝了完整 T16 本轮两个工程及 recovery 目录的回收/删除，原因仅为 `blocked by policy`，该整条命令未启动；`zhinexus-t16-installed-HR0pbo`、`t16-d-lUzHbo` 与 owner `ff6b32e0-1d1a-465b-92b9-df1cf7c2e0ff` recovery 目录仍保留，精确规范路径与形态见外置 `cleanup-inspection.json`，没有更换删除 API 重试规避；早期浏览器审查 fixture、最小 pnpm probe 亦有自动审批拒绝的保留现场，相关进程已停；宿主失败与新矩阵先导的未封存工程保留，待归档与所有权复核；不能声称本轮所有临时目录已清除。本轮重核原架构 SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
  - **03:32 续接（0.0.21 冻结与最终回归）**：`805c7341` 修复固定 pnpm 在合法精确 packageManager 声明下重新引导管理器、向 pnpm-lock.yaml 追加管理器 YAML 文档的问题，保留项目声明，以真实 RED/GREEN 确定 `--pm-on-fail=ignore` 与 `--config.verifyDepsBeforeRun=false` 的组合，五套产品回归 111/111、CLI typecheck 与根 tsc 通过，此前 0.0.20 的失败现场和原始字节保留，不改写为通过；`3fbcfa9b66900c55e254f15e73f318055c6a104f` 独立升级 CLI 0.0.21，产品/契约源码干净时 build 与 73/73 打包清单 probe 通过，03:17:48.0927238+08:00 仅 pack 一次，451414 字节，SHA-256 `7dd4874f...`，冻结目录 `cli-0.0.21-432a7805-4921-4c7d-a07d-029bbf7ed010`，旧版本均未覆盖，冻结 SDK 199 文件及 manifest 摘要保持原样；该候选强制全图 build/typecheck 20/20、0 cached、18.389 秒，根 tsc exit 0，外置证据 `workspace-0.0.21-665539951682462c8ab6222590ab3fe8`；同包完整 T15 25/25、63.22 秒；真实黑盒 live 5/5、543.99 秒；legacy 安装/拒绝入口 5/5、30.60 秒；矩阵评分和执行器最新完整单元入口 12 文件 185/185，独立只读审查未见 Critical/Important，`ef835de6` 聚焦提交诚实失败计分与真实 N10 两轮耗尽证据校验；0.0.20 完整宿主历史成功证据由控制方独立重读归档：3916 文件、**688779060 字节**，SHA/大小逐项一致，无额外文件、链接或 JWT 形态，外置 `host-live-0.0.20-browserfix-40e54445/root-independent-byte-archive-audit.json`（这是原始字节归档复核，不能替代清理前 filesystem identity receipt，也不能替代 0.0.21 宿主验收）；本时点 0.0.21 完整根 test、平台、T16、双框架宿主受控修复链与正式矩阵仍在执行，完整 browser 须待平台释放 5173 后再运行。
  - **04:54 续接（审查修复与 0.0.22 单次冻结）**：0.0.21 随后完整根测、平台、浏览器、T15/T16、黑盒和双框架宿主均已自然通过；正式矩阵却为正向 20/20、拒绝 **12/13**、exit 1，唯一 N10 在 MatchPlan 请求阶段因重复设计映射被真实 API 拒绝，不判为产品预算检查通过，该轮 2975.21 秒的原日志、57 个证据根与 22739 个归档文件保持原结论；最终独立审查发现两个 Important 缺口：`672582ba` 保持 repair 的完整源报告快照，仅更新确认写入的生成路径，并独立保留原 plan/apply 的清单、锁等守卫，发现用户变化立即停止后续轮次，新增回归先真实 RED，五套 118/118 与独立 6/6 通过；`b193406c` 在 stdio 序列化前清洗 SDK 自动校验错误，保留 JSON-RPC 关联字段与错误码，真实双进程两例先 RED，MCP 8/8 与独立协议探针通过；`43aa9bbf` 单独升级 CLI 0.0.22，`f96af5ee` 只修正回归测试的判别类型，CLI 产品与公共契约源码干净时于 04:39:01+08:00 仅 pack 一次，453485 字节、SHA-256 `d3da0874...`，来源 `f96af5ee59cfbd007ba4ff50aad3de60cebafb60`，既有冻结 SDK 与历史兼容输入未重包或替换；`bf65180a` 修正独立 N10 请求夹具，仅去重相同设计目标，保留三个实例、绑定与 API 映射，不同目标提前拒绝，2 RED→2 GREEN，矩阵支架 13 文件 187/187，根 tsc 与 diff check exit 0，随后同包 N10 诊断 1/1、278.67 秒、exit 0，实际写入两轮后停止且第三文件不变，其 3 根、429 文件、17487244 字节归档由控制方独立逐字节复读通过，3 个 parent 不存在，诊断不计入正式评分；当前正式完整 33 格于 04:45:27+08:00 启动，固定 20 正向、13 强制拒绝，未过滤场景；平台已 35 文件、137/137、exit 0、570.34 秒，其自有 Next、容器及卷退出后才启动完整浏览器；先前官方来源访问范围的不实记录已独立更正并逐页补验，当前证据不追认原 P0 独立日志、最初 RED 顺序与原始 stderr 空字节；用户本轮补充确认的 no-install 语义与已实施修正一致。
  - **05:15 续接**：0.0.22 完整根测自然退出 0（T10 168/168、零跳过；Vitest 123 文件 2198/2198）；真实平台 35 文件 137/137；完整浏览器 288/288，均 exit 0；控制方重新读取 16 份原日志/结果，核对完整计数、冻结包及原架构摘要；同一冻结包的四个独立配置合计 **49/49**，均无筛选、无跳过、自然 exit 0（live 黑盒 5/5、installed 黑盒 5/5、T15 25/25、含 Next 的 T16 14/14）；控制方分别重新读取原件与副本，共 336 份文件、3188592 字节、17 份 receipt，追加的实际安装 SDK 错误脱敏探针另列，不增加测试分母，记录提交 `2da99161`；完整宿主自然 exit 0、1/1，含 Vue/React 各一条正向和一条失败→单次修复→完整通过链，控制方独立复读清理前封存的 34681 份文件、2586571483 字节及 1754 份保留原 evidence，重算四链 canonical 摘要和四张 PNG 均一致，800×400 实图与独立参考 RGBA 差异为 0，标题顶部少量裁切如实列为构图限制，记录提交 `e7c9a6b6`；宿主三个临时 parent 已清理，其 owner 容器/卷为 0，秘密目录不存在；黑盒本轮八个已确认归属目录的单次原生 PowerShell 清理请求被自动审批在进程启动前以 `blocked by policy` 拒绝，八根仍保留，精确路径、身份与 inventory 已持久化，没有换 API、拆分重试或再次清理历史受阻目录，不能报告全部临时目录已清除；正式矩阵此时仅确认 Vue 10/10，React 与 13 个强制拒绝仍在执行；未把 N10 单独诊断、宿主或黑盒的成功计入矩阵分子，不提前宣布三期验收完成；CLI/公共契约及根依赖配置相对冻结来源 `f96af5ee` 的只读差异检查为空。
  - **05:28 续接（正式 R08 行为失败）**：固定正向 20 格已实际执行，当前为 19/20（Vue 10/10、React 9/10）；唯一 R08（React StrictMode/pnpm）产品 verify exit 2、1826ms、未超时，type/build/dependency/business-gaps 通过，browser 为 `BEHAVIOR_FAILED`，visual 未运行；原 behavior 只有 `text_mismatch:[data-testid="mounts"]`，没有保存失败瞬间实际文本，因此不据后续截图补推该值；控制方重新读取原 receipt/report，直接查看实际 PNG，稍后的产品截图与独立矩阵截图、基线同 SHA-256，图中 mounts=2、cleanups=1；正在用真实产品路径最小复现是否存在异步断言过早的缺陷，未凭截图直接认定根因；原消费者已经按原生清理移除，其真实 App 字节仍在加载 sourcemap 与 source inventory 中可追溯；正式 33 格继续自然执行，不干预该轮、不补跑替换 R08、不缩减分母；若确认产品缺陷，将独立 RED/GREEN、升版、新冻结并重新验收，而不是以整体超过 80% 掩盖已知问题。
  - **05:36 续接（真实产品确认异步断言缺陷）**：独立 synthetic 最小宿主通过真实公开 `verifyIntegration` 和固定 Chromium 复现两次（点击后 250ms 更新文本、`browser.timeoutMs=1500`，均提前返回 `BEHAVIOR_FAILED/text_mismatch`）；同步 control 通过，永久不更新 control 仍失败；type/build/dependency/business 四类均通过；独立 Chromium 对相同宿主立即读到 pending，在条件等待后读到 done，实际更新约 252ms；未提供视觉基线的 control 仍为 NEW，不能称整体通过；原冻结 tarball 的 306 个 dist 条目均与探针实际导入字节一致；诊断位于仓外 `r08-async-assertion-probe-20261120-0635-valid`，目录标签不是执行时间，`result.createdAt` 为 2026-11-20 05:30:01+08:00；控制方再次逐一复读 manifest 的 56 文件 / 187652 bytes 和冻结包，`failures=[]`，`root-original-byte-reopen.json` SHA-256 `19da3a13fa01cc3b115e97b6966824d7f3a14c4b0e11a92407d3053ca4409f2b`；该诊断不是完整安装验收，不替代原 R08 或正式评分；缺陷归为 **Important/P1**；新独占产品任务先补真实 Chromium RED，覆盖 delayed text/count/visible、永久负例的有界失败及等待中取消，再做最小修复，保留 first/textContent.trim/精确数量/非零尺寸语义，不放宽断言或增大超时；完成后由另一代理独立审查，控制方另升 0.0.23、只 pack 一次并全量复验；此时修复尚未完成，0.0.22 全矩阵继续自然执行并保留真实 R08 失败。
  - **06:02 续接（异步断言修复、独立批准与 0.0.23 冻结）**：0.0.22 正式完整矩阵已自然 exit 0、3340.98 秒，正向 19/20（Vue 10/10、React 9/10）、强制拒绝 13/13，R08 failed 原样保留，聚合门槛通过不能掩盖 Important/P1；59 roots / 23162 files / 493332540 bytes 经控制方原件与副本独立复读通过，59 owned parents 已删除，独立记录提交 `9fb5f215`；`10ca2957` 最小修复动作后的异步断言等待，共享原有 browser.timeoutMs，没有扩大导航/就绪/动作时限，保留精确断言、取消及失败分类，有效真实 Chromium RED 为 8 failed / 4 passed，最终聚焦 52/52、既有完整 browser case 1/1，控制方独立重开 273 项原证据，另一 reviewer 给出 Spec compliant / Approved、Critical 0、Important 0，RED 的先后顺序依赖当时收取的 pre-edit handoff，不用事后日志冒称独立证明，原 R08 失败瞬间 actual 依旧未知；`edb985ec0f9ee1b79a5882e935832f8caa9f0daf` 独立升版 CLI 0.0.23，冻结前 verify:workspace 10 members、force build/typecheck 20/20（0 cached，14.435s）及完整根 tsc 均 exit 0，于 05:51:34.8465368+08:00 仅 pack 一次，tarball 454155 bytes、SHA-256 `93c90124...`，SDK 与历史兼容输入保持原始冻结字节，不重包；控制方另行解开新 tarball，逐字节核对全部 306 个 dist 文件、包名/版本/运行时私有包边界、相对冻结来源的产品/公共配置零差异及原架构摘要，`failures=[]`，`root-initial-frozen-byte-reopen.json` SHA-256 `026fdbca973273343b51346e53ccf14bdcf736dff15232f08323a6153069f173`；同一新冻结包的完整根测试、真实平台、双框架完整宿主、49 项黑盒/T15/T16 及完整 33 格矩阵正在运行，浏览器全量回归等待平台释放端口，未借用 0.0.22 的通过数，未宣布三期技术验收完成。
  - **0.0.23 同包工程、宿主、黑盒与 R08 原件复核**：新候选完整根测自然 exit 0（T10 168/168、零跳过；Vitest 124 文件 2210/2210、零跳过）；平台 35 文件 137/137；平台精确 owner 服务和 Gallery 停止并确认 5173–5176 无监听后，完整浏览器 288/288 自然 exit 0；控制方另读 17 份原日志/结果/summary 与冻结清单，全部一致，工程分项提交 `33e5e13c`；四个完整黑盒/既有接入配置 5/5、5/5、25/25、14/14，合计 49/49，均未筛选并自然 exit 0，控制方另读 410 份正式/补充原件与副本、3332628 字节、完整文件集合，独立重算四条 canonical 业务链与 28 个 artifact refs，installed 时序探针另列不计 49 分母（同步 130ms 与两次延迟 360/383ms 的 browser 通过，但缺少批准视觉基线使 overall 仍 failed / visual NEW；永久不匹配 1620ms 后 browser 失败、visual not-run），控制方复算 helper 的两次错误预期也保留，均零产品测试；黑盒 12 个新根及 82840 条原身份经独立复读后，新鲜检查和一次原生 PowerShell 精确清理自然 exit 0、deleted 12、remaining 0，控制方另以 Test-Path 确认，旧政策受阻根未触碰，分项提交 `cc494f21`；双框架完整宿主自然 exit 0、1/1、1235.87s（两条正向与两条初次 failed→一次真实 repair→passed 链，四条最终各 6/6、visual PASS），控制方另读 34681 文件、2586567819 字节的完整清理前归档及 1754 份原 evidence，并重验原 seal、receipt、四链 canonical 和四张 800×400 PNG，两张唯一实图已直接查看，图表与 tooltip 可读，顶部标题部分裁切限制保留，三个 owned parent 均不存在，本轮 owner 容器/卷为 0、秘密目录不存在，原分项提交 `7ec3a665`；本时点正式矩阵已有 Vue 10/10、React 前 8/8 通过；控制方直接读取本轮 R08 原 receipt/report 和 CLI 结果，确认 strictmode/react/pnpm、`toolVersion=0.0.23`、六项 passed、visual PASS、exit 0、真实双 toggle 交互 `observed=true`，report SHA-256 `364a578394f1cd509fccff67ea7e43d67c0a74c1c3364f1672f51de42b2bf06a`，实际截图与独立基线同 SHA `f9c275b7600b2c6088fab7c89700ce387743b36fe50b3c1c07dc681a6fffda7f`，控制方已直接看图，mounts=2、cleanups=1 可读；这是本轮正式 R08，不是单例补跑，旧 0.0.22 的 R08 failed 保持原样，完整 33 格尚未结束。
  - **0.0.23 完整矩阵、独立评分与技术收口**：原完整 33 格入口 session `93391` 自然 exit 0，外层 1 file/1 test、3481.91s；正向 20/20，Vue/React 各 10/10；13 项强制拒绝均符合各自预期；原 top seal 含 33 份 receipt 及 1635 份文件，SHA-256 `3fdf1427a0fe97e9d12966764d7de9bb642747f73355021877e6cd6207e33457`，不补跑替分，不改变旧 0.0.22 的 R08 失败；控制方实际从原 seal 运行正式评分，`matrixAccepted=true`、`failures/errors=[]`，外置 `root-original-matrix-score-reopen.json` SHA-256 `bfd8a0da7d1c99b659033f07367acff3511e6e4ba901f4ce5b324416d0162c94`；另对 59 根/23162 文件/493327325 字节的封存 evidence 原件及副本逐字节复读、核对完整集合、owner/seal 和原日志，`failures=[]`，`root-all-original-copy-byte-reopen.json` SHA-256 `13e50a60be57e03a34f5b24d4a2a0b4e02175f5291cffd5cee090950118f7d8b`，59 个 owned parent 均已不存在，该归档不冒称包含全部已删除消费者依赖或 build/map 字节；只读专项审查另核 20 个正向的 24 个生成模块、实际 source-map 正文、已加载 JS 与 40 条 type/build 命令摘要，N10 两次实际写入与两份原字节备份吻合、第三生成文件未变、64391ms 内正常返回预算耗尽 exit 2、未 timeout，N13 为真实 build 0 后独立验收支架的 entry-import-missing 拒绝、没有调用产品 verify，其 map 正文已随 parent 清理，目前只能复读原 native inventory hash/size 和运行时 sealed extraction，不冒称再次读到 map 正文，专项无 Critical/Important/Minor，结果仅在工具会话保留；本轮清理范围明确为宿主三个 parent、黑盒十二新根和矩阵五十九个 parent，各自归属与证据范围独立，工程平台仍保留四个普通凭证配置文件，因缺创建时 marker/native 身份而未删除，精确 owner 服务、容器和卷已释放，历史被自动审批以 `blocked by policy` 拒绝的目录继续保留，未换 API 或拆分重试，不声称全局临时目录清空；收尾再次核对唯一 CLI tarball 及 306 个 dist 文件，产品/公共配置相对冻结来源零差异、原架构摘要不变，`root-final-frozen-byte-reopen.json` SHA-256 `37f334c9e9268a1f6b1231d02ce950c464a21e2737848dda8beaaaf002190e82`；本轮三期 T15–T17 工具技术验收通过，交付和独立开放项汇总于 t17-completion-2026-11-20.md；真实业务试点、T11/T12、公司 OIDC/生产独立预览域/G2，以及未追溯的原始 RED/P0 过程仍独立开放；没有 push、tag、合并或生产发布。
- 结论与状态：**过程性总账（追加式）**，最新至 0.0.23 技术收口。被 t17-completion 作为汇总口径引用，但本记录的过程细节（各版本失败与保留项）不被其取代。
- 交叉引用：本主题全部篇章；另涉 `docs/phases/phase3/local-project-verification.md`、`docs/specs/2026-11-19-phase3-t17-design.md`、`docs/plans/2026-11-19-phase3-t17-completion.md`。
- 过时或矛盾点：文中多处以"正在运行/待收取"描述的状态已被同文件后续小节与 t17-completion 更新；早期 0.0.18/0.0.19 的失败与诊断均明确标注不覆盖、不重打包。

### t17-local-registry-timeout-2026-11-20.md

- 日期／角色／主题：2026-11-20；A/综合；T17 隔离注册表冷下载超时补充。2026-11-20 的完整矩阵新包首格 V01 在 materialization 阶段遇到 npm `ECONNRESET / aborted`。保留该失败，不以基础设施修正改写原矩阵结果。
- 目的：定位并修复隔离验收 registry 的 upstream 超时过短问题。
- 承重事实：

  - T16 的隔离 YAML 已在前次设为 5 分钟；T17 `local-services.ts` 另外生成内联配置，遗漏了此配置，实际仍为 Verdaccio 默认的 30 秒。
  - 从当前 owner `1bae60b0-dc24-4c1f-88cb-21ea9af6121a` 的真实容器日志提取非敏感字段：`echarts-6.1.0.tgz`、`ETIMEDOUT`、`requestTimeoutMs=30000`、`totalMs=30003`。精简原始证据在 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/t17-registry-timeout-30s-observed.json`。
  - 修复：只对新建 T17 隔离服务的 npm upstream 设置 `timeout: 5m`，保留单 registry、私有 `@company/*` 权限和禁止覆盖/删除等规则；不修改现有运行中的服务、共享/生产配置、CLI 产品或冻结 tarball。
  - 回归：新结构回归 RED 1 failed（实际 timeout 为 undefined）；最小修改后完整 `exec vitest run tests/acceptance/t17-host/local-services.test.ts` 为 **7/7**、exit 0、**1.60 秒**。同时核对私有 SDK 无 proxy、发布 ACL 与公共上游来源。
  - 新的真实运行须重新创建 owner 环境；当前轮的失败不变更为通过。最终矩阵分母、动作和期望保持不变，是否达到门槛按完整封存结果判断。
- 结论与状态：完成（5m 有界超时）。与 t17-integration 02:18 节的 `10cfb5fd` 为同一修复的两个视角（本篇聚焦容器日志与单测，t17-integration 记录其对完整 0.0.19 T16 14/14 的影响）。
- 交叉引用：`t17-integration-2026-11-20.md`、`t17-host-0021-2026-11-20.md`、`t17-service-token-budget-2026-11-20.md`、`t17-matrix-executor-2026-11-20.md`。
- 过时或矛盾点：`10cfb5fd` 记录"固定镜像解析为 300000ms"，与本篇修复前的 30000ms 观测一致，无矛盾。

### t17-matrix-0022-2026-11-20.md

- 日期／角色／主题：2026-11-20；B（Claude 客户端矩阵）；T17 冻结 CLI 0.0.22 独立产品矩阵。仅覆盖 CLI 0.0.22 的本机、工作区外临时消费者验收。0.0.21 的失败结果与 N10 请求夹具修正保留在独立历史记录，不改写旧分数、不用独立诊断补正式矩阵。
- 目的：完成 0.0.22 的 N10 独立诊断与完整 33 格正式轮并独立评分。
- 承重事实：

  - 冻结输入：CLI 唯一 tarball `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.22-mwo0jfyw-6oszswub/company-component-cli-0.0.22.tgz`；453485 / `d3da08748faa4c18a19a8b757caf817dae032e82b9405521a87dd8f877c179ef`；打包源 HEAD `f96af5ee59cfbd007ba4ff50aad3de60cebafb60` / 冻结时间 `2026-11-20 04:39:01+08:00`；SDK bundle manifest `04a7c4fb...`；历史兼容证据 `c6182081...`；验收夹具提交 `bf65180a`；工具链 Windows x64 / Node 26.13.0 / pnpm 12.18.0 / npm 11.20.0 / 本地 Playwright Chromium。
  - 两次入口均在启动前实际核对 CLI 文件长度、CLI 摘要、SDK manifest 摘要及历史兼容证据摘要；诊断与正式轮使用同一 tarball，没有重包或覆盖 tarball。
  - **N10 独立诊断（不计正式分数）**：命令 `./.tools/t17-product-0022-launch.ps1`，内部 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-matrix/product.vitest.config.ts')`，仅设置 `T17_PRODUCT_DIAGNOSTIC_CASES=N10`；开始 `04:39:56+08:00`，自然 exit 0，1 文件、1/1 测试通过，**278.67 秒**。MatchPlan 来自真实本地 API；参考工程与候选工程各含 `budget-1`、`budget-2`、`budget-3` 三个真实 line 实例；原始 apply 的 `afterHashes` 绑定三个生成文件的故障字节（`const layout = 'synthetic-template-fault:t17-N10';`），未在 apply 后补写生成故障；初始真实 verify 类型检查、构建、依赖守卫通过，浏览器行为失败；随后真实 repair 的 `maxAttempts=2`，恰好两次尝试，分别只写 `component-0001.vue`、`component-0002.vue`；repair 实际为 `stopped`，停止原因 `max-attempts-reached`；最终报告 `failed`。三个生成文件原始 SHA-256 均为 `34af228e1c521d7d037edd73ae27c9b3247db37f01b05c33393df7c609f5fa07`；前两个修复后 SHA-256 为 `c3d1bf0ab0460200d2e80ff2e6c89e9082963614efe7548f1201d612a7898e20`，第三个前后字节一致。两个真实备份 SHA-256 分别为 `b97bbf25d58f72ece95c0fafd9d88484332cebe82b14661aeabc63727c18e863`、`67f81a6c5e7568dabb31b0d31ac649f6ef7df23e69d168400da5637703fd1263`，与两次 `backupRef` 一致；完整源快照确认只有上述两个授权生成文件改变，用户文件零变更。
  - 诊断证据：原始 evidence root `C:/Users/10208/AppData/Local/Temp/zhinexus-t17-evidence-7659ec482af94f2e70fdde2d3eef8c08-I88khN`；独立原字节归档 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/matrix-0.0.22-N10-diagnostic-7659ec482af94f2e70fdde2d3eef8c08`；原 top seal SHA-256 `fd68ce308f4a211f3cce41bcd7e2fdeda11809f8204503c09235ae71fde9e27d`；archive-map SHA-256 `eafeffc4c08672a735554e1c11d0ffc1d1823727b112d3a38ed4892998c5e2d1`；3 个原始证据根、429 个文件逐文件 bytes/SHA-256 复制复核，3 个 owned parent 实际不存在；原始进程日志 `.tools/t17-product-N10-diagnostic-0022-20261120-043956.log`，归档保留 `process.log` 原字节。主线独立复读器结果为 3 roots、429 files、17,487,244 bytes、3 parents removed，`failures=[]`、`passed=true`，保存于归档目录 `root-independent-byte-reopen.json`。诊断 payload 为 `t17-product-diagnostic-subset`，`productionAcceptance=false`、`fixedDenominatorEvaluated=false`。
  - **完整 33 格正式轮**：命令 `./.tools/t17-product-0022-launch.ps1 -Full`；启动时清除两个诊断环境标志；进程 session `22613`，日志 `.tools/t17-product-33-0022-20261120-044527.log`；原始 evidence root `C:/Users/10208/AppData/Local/Temp/zhinexus-t17-evidence-6164d8bafbdbd902e638fe93fcc42cf2-BWc0Nd`。固定门槛为正向 20 格至少 16 格通过，Vue 与 React 各 10 格至少 8 格通过，强制拒绝 13 格全部通过；N10 必须保留三实例、两次真实写入与两份真实备份；缺失、错误或中断案例不减少分母，不能用其他轮诊断替代。
  - 本轮结果：Vue 正向 **10/10**（100%，V01–V10 全部 `pass`）；React 正向 **9/10**（90%，R01–R07、R09、R10 为 `pass`，R08 为 `failed`）；正向合计 **19/20**（95%）；强制拒绝 **13/13**（N01–N13 全部 `refused`）。全部 33 个 receipt 均已生成，原 seal 的 `executionErrors=[]`。入口 Vitest 的 1/1 是整体门槛测试计数，格级结果如上。
  - 主线对原始 evidence root 独立调用 `.tools/t17-score-product.mts`，实际 exit 0，复读结果仍为正向 19/20、Vue 10/10、React 9/10、拒绝 13/13、`matrixAccepted=true`；`failures` 仅含 R08，`errors=[]`。输出 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/root-matrix-0022-original-score-0542.json`，SHA-256 `a57a664bafce4d991babe4c844f65aa46351a68a6ebb550f11a3392f8246267f`，原日志同目录同 stem 的 `.log`。
  - **V10 与 R10 的单次真实修复**：两个案例初始报告均为 `failed`，类型、构建、依赖守卫、业务缺口与浏览器行为检查通过，视觉检查实际报 `VISUAL_DIFF`；随后 repair 均为 `repaired`、`maxAttempts=1`、恰好 1 次尝试，只写对应的一个授权生成文件，最终报告为 `passed`；两个 receipt 的 `outOfScopeWrites=0`、`lostUserEdits=0`、`projectRootRemoved=true`。V10 唯一修复文件 `src/components/zhinexus/component-0001.vue`，初始报告 SHA-256 `858bcdec96e4148d6ac04e52323a167c0081027ab166c3b1912b7909869ea903`，repair result SHA-256 `600e5db4b86f76862200ec887e9c57e5c784f06163ea7ab537ed02bb40c57f37`；R10 唯一修复文件 `src/components/zhinexus/component-0001.tsx`，初始报告 `9e9187083003703b5f9cc49ed93f6ee6eaa4a6834b5be5a5fca07d3c2d67e170`，repair result `73cb39f52ea5c7150c2e69ae7f185794515daf9cce49ba063c3168697d916c48`。
  - **N10 的本轮两次预算耗尽**：正式轮保留独立参考工程的真实安装、构建与浏览器证据；三个生成文件原 SHA-256 均为 `34af228e1c521d7d037edd73ae27c9b3247db37f01b05c33393df7c609f5fa07`；初始 verify `failed`；repair 实际为 `stopped`、`stopReason=max-attempts-reached`、`maxAttempts=2`，恰好两次尝试，依次只修改 `component-0001.vue` 与 `component-0002.vue`，前两者修复后 SHA-256 均为 `c3d1bf0ab0460200d2e80ff2e6c89e9082963614efe7548f1201d612a7898e20`，第三个 `component-0003.vue` 前后逐字节相同；两份真实备份各 **2029 bytes**，SHA-256 分别为 `d19fd40d23981c7af9804736700c4364c2998a11dc600ffdf4b3b8bd228e1125`、`c56c7b81a7f39b35c9ee5178ffc9b58c829b2e7dc0d48f6b0255fdcfec6f385e`，与两个 `backupRef` 一致；最终报告仍为 `failed`，CLI exit 2；N10 按预算耗尽的预期产生 `refused` 回执；`N10-budget-repair-result.json` 的 SHA-256 为 `e086e3323da10a28983cf57454321c2d5a77dceae95fbae7426cab8d1bbaedaa`。以上均来自本轮正式证据，不使用独立诊断补分。
  - **R08 原样失败与交付阻断**：R08 为 React / pnpm / StrictMode 场景；产品 verify 实际 exit 2、1826ms、未超时；类型、构建、依赖守卫与业务缺口检查通过，浏览器检查报 `BEHAVIOR_FAILED`，视觉 `not-run`；原 `behavior.json` 为 `runtimeErrors=[]`，仅记录 `text_mismatch:[data-testid="mounts"]`；spec 为连续两次点击 `[data-testid="toggle-chart"]` 后检查 `mounts=2`、`cleanups=1` 和 1 个 canvas；原诊断未记录失败当时的实际 mounts 文本。同一案例的独立矩阵浏览器交互实际为 0→1，截图与基线均为 SHA-256 `f9c275b7600b2c6088fab7c89700ce387743b36fe50b3c1c07dc681a6fffda7f`，该比较通过；receipt 的越界写入和用户修改丢失均为 0，owned parent 已由原生夹具清理。
  - R08 原始证据 SHA-256：top `files/R08-receipt.json` `6f4b172592d9d2ca34754be91ad7c29fea5a2b7a9a257b5298bc363e60b5df53`；`files/R08-report.json` `48db9c82a8ebcf6ae37ea9584e607c6b47361a84b35989ba75c76d0d91b961eb`；`files/R08-spec.json` `169f2210d0d9bba57bc85594fd3387204e085c4d8da5bad7aa5169348629d0c2`；`files/R08-cli-verify-3.json` `aaa2072af7ceedbdd8757284476a5444df75b08f80ad358a1fbf842f89516233`；原 case `product-artifacts/runs/verify-1795123346091-74b43d27/behavior.json` `0dc1ab46fb983654a38593c4957345bd29671ff172fbce4346211b33459d48a8`。
  - R08 原 case evidence root `C:/Users/10208/AppData/Local/Temp/zhinexus-t17-evidence-4ae06e5f2046d4f01a938bb964652249-r4cryA`，seal SHA-256 `973bc33fdd17a43f852a1697956d85e4204710d958639d345095794063fe4dab`。实际加载的 `top/files/R08-source-map-0.json` 为 4,638,607 bytes，SHA-256 `69038c7aa788d6046158406c2bb2a8ce01be47036e4e109b046ea3fdcf9886a4`，`sources[311]` 的 `src/App.tsx` 内容 SHA-256 `6058accfa7067ba5321787a4dc59ac7ae75c06a6034df0fc5665f0e4cc74259a`，与报告快照及保留的 `R08-reference-source-3-App.tsx` 相同；原 App 通过真实 `createRoot` / `StrictMode` 挂载，`ChartPane` 的 effect 递增 mounts / cleanups。
  - 原字节归档、清理与核验范围：正式进程自然 exit 0、日志闭合后，使用已独立审查的 `.tools/t17-archive-product-run-v2.mjs` 对原 top root 及其 case / reference 引用闭包归档，归档进程 session `30363` 自然 exit 0，完成于 `2026-11-20 05:45:13+08:00`；归档脚本 SHA-256 `f09183e998a76e666d52cd7d5ffd7e5ff2186aea9f17b33a41f5eebc26f2fec2`。原 sealed top root `C:/Users/10208/AppData/Local/Temp/zhinexus-t17-evidence-6164d8bafbdbd902e638fe93fcc42cf2-BWc0Nd`，原 top seal SHA-256 `3dc83ae6e4b876f5397762bb038e60aa9d6e7484f9c5eab72c06543edfd828e6`；独立归档目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/matrix-0.0.22-full-6164d8bafbdbd902e638fe93fcc42cf2`；archive-map SHA-256 `09b3a3afc28f7141b605a500219de77f3af499e4cfdaf1a50c02b8277f8c2daf`；复制与回读 **59 个原始证据根、23,162 个文件、493,332,540 bytes**，逐文件 bytes/SHA-256 与复制字节相等，原 seal 与副本 seal 相等；已闭合原日志 `.tools/t17-product-33-0022-20261120-044527.log`，归档 `process.log` 221 bytes，SHA-256 `5acc5afd3d36ac45a0443b0909a96f8aac86934eeb78af9b80eb29d82db3ed6b`；owned parent 清理 59/59 实际不存在。主线再以独立 `.tools/t17-root-product-archive-reopen.mjs` 对全部原件与副本复读，实际 exit 0：59 roots、23,162 files、493,332,540 bytes、59 parents removed，`failures=[]`、`passed=true`，输出 `root-independent-byte-reopen.json`，SHA-256 `ee0f8ac0626c6cf5859aabc95c853c57725db776afd98438700fade0b908c1a4`。
  - 验收边界：这是本机冻结产物在临时宿主中的产品验收；本地 API、Registry、独立参考工程和 Chromium 均实际执行，服务端没有构建或运行上传组件、没有启动截图浏览器；历史兼容证据以原摘要显式接纳，来源仍为历史真实 installed-CLI probe，不伪造成本轮新兼容测试。本记录不代替生产 G2、生产 OIDC／独立注册预览域或至少两个真实业务项目试点验收，也不单独宣布 T17 全部业务目标完成；最终交付仍须关闭上述异步断言缺陷，并对后续唯一冻结候选重新完成完整验收。
- 结论与状态：完成（19/20 + 13/13，matrixAccepted=true）但**判定 0.0.22 不作最终交付**（R08 Important/P1）。被 t17-matrix-0023 取代。
- 交叉引用：`t17-matrix-executor-2026-11-20.md`、`t17-matrix-scoring-2026-11-20.md`、`t17-matrix-n10-request-2026-11-20.md`、`t17-matrix-2026-11-19.md`、`t17-cli-0022-regressions-2026-11-20.md`、`t17-async-assertion-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-matrix-0023-2026-11-20.md`。
- 过时或矛盾点：`matrixAccepted=true` 与"不能作为最终交付"并存——聚合门槛通过不替代关闭已确认 Important/P1；N10 诊断的备份 SHA（b97bbf25.../67f81a6c...，2029 bytes 前的另一组）与正式轮备份 SHA（d19fd40d.../c56c7b81...，各 2029 bytes）是两轮不同值，不得混用。

### t17-matrix-0023-2026-11-20.md

- 日期／角色／主题：2026-11-20；B（Claude 客户端矩阵）；T17 冻结 CLI 0.0.23 独立产品矩阵。仅覆盖 CLI 0.0.23 的本机、工作区外临时消费者验收。0.0.22 的 R08 失败、原始分数、修复链和字节归档保留在 t17-matrix-0022-2026-11-20.md，本轮使用新的 owner、evidence root 和完整固定分母，不改写旧轮。
- 目的：对 0.0.23 完成完整 33 格正式轮、原件独立评分与全字节归档复读。
- 承重事实：

  - 冻结输入：唯一 freeze manifest `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.23-edb985ec-b8f572a9/freeze-manifest.json`，manifest SHA-256 `4124d7b5117f761a8966b0837339fa63856833711b7e29bebe95f3f903cd9e8e`；CLI 唯一 tarball 同目录 `company-component-cli-0.0.23.tgz`，454155 / `93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab`；CLI 打包源 HEAD `edb985ec0f9ee1b79a5882e935832f8caa9f0daf`；冻结时间 / packCount `2026-11-20 05:51:34.8465368+08:00` / `1`；SDK bundle manifest `04a7c4fb...`；历史兼容证据 `c6182081...`；工具链 Windows x64 / Node 26.13.0 / pnpm 12.18.0 / 本地 Playwright Chromium。
  - 启动入口 `.tools/t17-product-0023-launch.ps1` 再次核对 manifest 身份、源 HEAD、packCount、tarball 长度与摘要，以及固定 SDK 和历史兼容摘要；清除两个诊断环境标志后，仅执行一次完整 `tests/acceptance/t17-matrix/product.vitest.config.ts`。本轮不重包、不修改产品或矩阵夹具、不补单格。
  - 固定门槛为正向 20 格至少 16 格通过、Vue 与 React 各 10 格至少 8 格通过，强制拒绝 13 格全部符合预期；N10 须保留三实例、两次真实写入、两份真实备份、第三个生成文件不变及最终预算耗尽。
  - 正式进程 session `93391`；起始时间 `2026-11-20 05:54:22+08:00`；独立进程日志 `.tools/t17-product-33-0023-20261120-055422.log`；启动脚本实际通过 PowerShell `Parser.ParseFile` 语法核验后执行一次，初始 Vitest 输出为 `RUN v5.1.0`。外层 Vitest 为 `1 file / 1 test passed`，耗时 **3481.91s**，自然 exit 0。
  - 原始 top evidence root `C:/Users/10208/AppData/Local/Temp/zhinexus-t17-evidence-23760136418936b83cc44dd8e47a202e-iajqNG`，`.t17-owner.json` 实际读取的 `runId=23760136418936b83cc44dd8e47a202e`、`name=evidence`，路径与该 root 一致；该 root 于 `05:54:56+08:00` 创建；本轮不复用旧 owner 或 evidence。
  - 原始 `run-seal.json` 为 **2447465 字节**，SHA-256 `3fdf1427a0fe97e9d12966764d7de9bb642747f73355021877e6cd6207e33457`，其 payload 的 `executionErrors=[]`。原进程日志 221 字节，SHA-256 `31b5385d8249ce124a2416c6fc969babc84d3a2a6238da96808a3f2250b2ce22`。33 份正式回执齐全，未生成 `*-error*` 证据文件；未终止进程、补跑单格、改动分母或替换旧轮证据。
  - 结果表：Vue 正向 10 格 **10/10**（≥8/10）；React 正向 10 格 **10/10**（≥8/10）；正向合计 20 格 **20/20**（≥16/20）；强制拒绝 13 格 **13/13**（13/13）。
  - Root 对原 sealed root 实际调用正式 `loadT17MatrixInput` 与 `evaluateT17Matrix` 只读重评分，命令 exit `0`；独立输出 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/matrix-0.0.23-full-23760136418936b83cc44dd8e47a202e/root-original-matrix-score-reopen.json` 为 1034 字节，SHA-256 `bfd8a0da7d1c99b659033f07367acff3511e6e4ba901f4ce5b324416d0162c94`；B 实际读回确认原 seal、CLI 与 SDK 摘要一致，`matrixAccepted=true`、`failures=[]`、`errors=[]`；评分源码摘要为 `e7d9015b26846d2155314cba3a766abae4627adeef7f28cfc292c62ba49bcf44`。
  - **V10：一次真实修复后通过**：`V10-initial-report.json` 初始为 `failed`，仅视觉检查 `VISUAL_DIFF`；`V10-repair-result.json` 为 `status=repaired`、`stopReason=passed`、`maxAttempts=1`，恰一次真实写入 `src/components/zhinexus/component-0001.vue`，修改前 SHA-256 `9dbc3211f99cc2f6278588d5e364a50186ab9f38d62760b3def313e259db0f1b`，修改后 `c3d1bf0ab0460200d2e80ff2e6c89e9082963614efe7548f1201d612a7898e20`，并引用备份 `repair-backup-1-f212fe0c`；最终产品报告 `passed`、`toolVersion=0.0.23`，六项检查全部通过；正式回执 `actualOutcome=pass`，`outOfScopeWrites=0`、`lostUserEdits=0`。该格 initial report / repair result / final report SHA-256 分别为 `35b95c1476460f8331c4aa0224396695c6591733bd899f4b8761beb5fc2b772f`、`8c3dc7f85ebcdc7d26884392d34f14bb987c233aa53d08fde0892a027953ec4c`、`ac85955e3027fc646f12271096d83368001a636feababa5149773baf28c42d1e`。
  - **R08：React StrictMode 异步生命周期断言通过**：`R08-receipt.json` 的正式结果为 `pass`，场景为 React / pnpm / Vite / `hostMode=strictmode`；本轮 `R08-spec.json` 保留连续两次 toggle，随后要求 `mounts=2`、`cleanups=1` 且画布恰一张，未放宽规范；`R08-cli-verify-3.json` 为 exit `0`、`1883ms`、`timedOut=false`；`R08-report.json` 为 `status=passed`、`toolVersion=0.0.23`，六项均 `passed` 且 `issues=[]`；独立交互原件记录两次动作通过、cleanup `0→1`，基线与产品截图 SHA-256 同为 `f9c275b7600b2c6088fab7c89700ce387743b36fe50b3c1c07dc681a6fffda7f`。该格 spec / interaction / final report SHA-256 分别为 `4bbcdd6e64d9c544de6426cc8012119cb1a5ceb693d781b28c2cfef494c4c1a7`、`18bc343ef1a05050cbb5c553e083f4e2dcc07228fe7bc18ad68ca9c03403881b`、`364a578394f1cd509fccff67ea7e43d67c0a74c1c3364f1672f51de42b2bf06a`。本结果只取自本轮 .23 原件，不覆盖或更改 .22 的真实失败记录。
  - **R10：React 一次真实修复后通过**：`R10-initial-report.json` 初始仅 `VISUAL_DIFF` 失败；`R10-repair-result.json` 为 `repaired` / `passed`、`maxAttempts=1`，恰一次真实写入 `src/components/zhinexus/component-0001.tsx`，SHA-256 从 `3b054fd4579b4156767fdb7d12941a8227f83fc1a2801b80d4ffcf474fb835a0` 变为 `d5578b733c776a6f2f38be53e7744f34f787bf49d778d2510f1f44367ebcb339`，备份为 `repair-backup-1-6c38060d`；最终 .23 产品报告六项全部通过，正式回执 `pass`，`outOfScopeWrites=0`、`lostUserEdits=0`。该格 initial report / repair result / final report SHA-256 分别为 `a70156a8d2d3040a432ec1ae626d7dee3541d5828f4def9bf1f7cdc38b840f2f`、`46978737aa9ab0836cd81fd6ab1f7ebbb79bc80a3bc79cd76d9b2e09750462f0`、`671eae3f555d532f9cf3c98c6e924d230beb56dac6010496af0fdceec1e4608d`。
  - **N10：三实例、两轮真实写入后耗尽预算**：`N10-budget-apply.json.afterHashes` 将三个生成组件都绑定到原始故障 SHA-256 `34af228e1c521d7d037edd73ae27c9b3247db37f01b05c33393df7c609f5fa07`；`N10-budget-repair-result.json` 为 `status=stopped`、`stopReason=max-attempts-reached`、`maxAttempts=2`，恰两次 attempt 分别修改 `component-0001.vue` 与 `component-0002.vue`，均从上述故障摘要变为 `c3d1bf0ab0460200d2e80ff2e6c89e9082963614efe7548f1201d612a7898e20`；第三个 `component-0003.vue` 前后摘要及原字节不变。两份真实备份 `repair-backup-1-d973ce57`、`repair-backup-2-b760c56e` 各保存 **1385 字节**；实际 base64 解码、SHA-256 与原始 before 文件字节比较均一致，backup 文件摘要也分别匹配 attempt 的 `backupRef.sha256`：`e04ef82455a71f0c1ab423dc6c1aab5c44a0890d45e534fe5a8e2e478c61594b`、`fd39771594892c5cd57a790251a96d63cd7cc5ead13b4e89f846d8cfa70f551b`；before / after 源码快照各 `12` 项，仅两个获准生成文件变化，其余 `10` 项不变。最终产品报告 `toolVersion=0.0.23`、`status=failed`，浏览器仍为 `BEHAVIOR_FAILED`，视觉 `not-run`；repair 命令 exit `2`、`64391ms`、`timedOut=false`；正式回执 `actualOutcome=refused`、`outOfScopeWrites=0`，符合本格预期；本轮不是空操作、一次写入或超时替代两轮预算耗尽。该格 initial report / repair result / refusal SHA-256 分别为 `53258a29ce565ab84072a09891a560323efdd3b59bbfb4c2b2e2c87dbc8b3dbe`、`1eb6ecce9aa843276d07b07805fd3c60314a11f41a12733d89274d4b87c7d25d`、`1c4cb980fc8b6192535f1b43454b332d3a2fa31823cea0600f3038bbd4792708`；source-before / source-after 为 `5e5102600caf495e878f0ff3dd30fe6b7aa9de27e37683f6e345cd835713f009` / `9ac57383de2587fc48c0271f9061207a1926498840f4867d48811a08609fcf89`。
  - **N13：独立错宿主／静态替身检测拒绝**：本格真实 Vite build exit `0`、`2712ms`、`timedOut=false` 后，由独立验收支架执行 source-map 来源检查并得到 `entry-import-missing`，`generatedModuleImported=false`；源码 before / after 相同、`outOfScopeWrites=0`，正式回执 `refused`。其调用的是 inspect / plan / apply，未调用产品 verify，不能据此声称 CLI verify 自身识别静态替身。N13 原工程已由原生 fixture 清理，完整 source-map 正文随之删除；当前可复读的是原 native inventory 的 hash / size 与运行时 sealed extraction 摘要，不能声称当前重新读取了该 map 完整正文。此边界与 20 个正向场景的来源核验分开记录。
  - 独立归档与清理核验：唯一归档目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/matrix-0.0.23-full-23760136418936b83cc44dd8e47a202e`；已审查的 v2 helper `.tools/t17-archive-product-run-v2.mjs` 在本轮实际核验 SHA-256 `f09183e998a76e666d52cd7d5ffd7e5ff2186aea9f17b33a41f5eebc26f2fec2` 后启动，归档进程 session `27969` 自然 exit `0`。该 helper 验证引用闭包、原 owner 与 seal、目录／文件集合、原 parent 的 ENOENT、普通文件与稳定读取，再按原字节复制并回读；不改写原 seal，也不删除原 evidence roots。
  - 审计项：归档 roots / files / bytes `59` / `23162` / `493327325`；原生 fixture 清理后的 owned parents `59/59` 为 ENOENT；原件／副本全字节复读 `passed=true`、`failures=[]`；`archive-map.json` 5070914 字节，SHA-256 `441cba52e1ad74ad793ffdc96bbb539e4d9b2a3bf01a80a8dd132cd966ffb065`；归档 `process.log` 221 字节，SHA-256 `31b5385d8249ce124a2416c6fc969babc84d3a2a6238da96808a3f2250b2ce22`，与原日志相同；Root 独立结果 `root-all-original-copy-byte-reopen.json` 14382 字节，SHA-256 `13e50a60be57e03a34f5b24d4a2a0b4e02175f5291cffd5cee090950118f7d8b`。Root 使用独立脚本对每个 map 引用的原件和副本逐文件复读 bytes / SHA-256 / 字节相等，并核对文件集合、seal、owner 和每个原 owned parent 的 ENOENT，exit `0`；B 实际读回独立结果原 JSON 并复算 SHA-256，确认 `59 roots / 23162 files / 493327325 bytes / 59 parentsRemoved`、`passed=true`、`failures=[]`。
  - 归档范围严格为 seal inventory 所表示并仍保留的 evidence roots 与其字节副本；原消费者 parent 已由原生 fixture 在封存证据后清理，当前以原 seal inventory 表示，不能声称这些已删除 parent 的全部原始字节均已归档。B 没有删除原 evidence roots、原日志或历史政策拦截路径，也未重试或绕过历史 auto-review 拒绝。
  - 实际验证命令（均在当前仓库 cwd 执行，四条命令均实际 exit `0`）：`& './.tools/t17-product-0023-launch.ps1'`；`& './scripts/pnpm.ps1' -PnpmArgs @('exec','tsx','.tools/t17-score-product.mts', <原 root>, '93c90124...', '04a7c4fb...', <root-original-matrix-score-reopen.json>)`；`& './.tools/node-v26.13.0-win-x64/node.exe' './.tools/t17-archive-product-run-v2.mjs' <原 root> <归档目录> <原 process.log>`；`& './.tools/node-v26.13.0-win-x64/node.exe' '.tools/t17-root-product-archive-reopen.mjs' <archive-map.json> <root-all-original-copy-byte-reopen.json>`。原始矩阵只执行一轮完整 33 格；两条 Root 命令是只读评分和复读，未重新执行消费者或补跑单格。启动前 `Parser.ParseFile` 无语法错误；冻结输入与归档摘要均通过实际 `Get-FileHash -Algorithm SHA256` 核验。
  - 验收边界：本轮使用本机、工作区外临时宿主，服务端不构建或执行上传组件，也不启动截图浏览器；历史兼容证据以原摘要显式接纳，仍保持其历史来源；已保留自然结束后的原 seal 与原始 evidence roots；只核对本轮新 owner 的原生清理，未触碰历史政策拦截路径。本记录不代替生产 G2、生产 OIDC／独立注册预览域、T11/T12 或真实业务项目试点，也不单独宣布 T17 全部业务目标完成。
- 结论与状态：**完成（20/20 + 13/13，matrixAccepted=true）**，为 0.0.23 最终交付的矩阵依据。
- 交叉引用：`t17-matrix-0022-2026-11-20.md`、`t17-matrix-executor-2026-11-20.md`、`t17-matrix-scoring-2026-11-20.md`、`t17-cli-0023-regressions-2026-11-20.md`、`t17-completion-2026-11-20.md`、`t17-final-delivery-review-0023-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：与 t17-matrix-0022 的两个 N10 备份 SHA/字节、归档字节数均不同，属两轮独立证据；R08 在 .23 为 pass、在 .22 为 failed，两者都如实保留。

### t17-matrix-2026-11-19.md

- 日期／角色／主题：2026-11-19；B（Claude 客户端矩阵）；T17 双框架独立验收矩阵记录。覆盖矩阵定义、评分边界和封存校验；不把 synthetic 工程结果冒称真实业务验收。文件后半段为"B 侧静态矩阵实作追加记录"（同一文件内追加，不改写上文历史证据）。
- 目的：冻结 20 正向 + 13 拒绝场景定义、评分规则与证据封存格式。
- 承重事实：

  - 固定 20 个正向场景：Vue 10 个、React 10 个；整体和分框架最低通过门槛均为 **80%**。
  - 强制拒绝独立计数、不进入正向分母；固定 13 个案例覆盖 peer 冲突、中途编辑、无候选、业务缺口、类型过但行为失败、版本/视觉不匹配、NEW/DIFF/环境不兼容、修复预算、链接路径、敏感 sentinel 与错误宿主。
  - 每个正向 cell 绑定同一份冻结 CLI tarball 摘要和 SDK bundle 摘要，并要求计划、apply、验证规范、报告、生成文件、typecheck/build、loopback 资源、交互、截图与视觉基线证据。
  - `run-seal.json.files` 只采信 `evidenceRoot/files/` 根目录中的直接文件；receipt 路径必须与封存条目的文件名和摘要一致。
  - 缺失、重复、未知、skipped、blocked、摘要不一致、越界写入或用户修改丢失均失败关闭。评分器对缺少必需字段的正向 receipt 进行运行时结构检查；畸形数据记为失败，不会抛出异常或进入通过计数。
  - `runner.ts` 固定迭代 20+13 个场景并调用注入的 scenario executor；异常单独留证据且不减少分母；运行前后核对冻结 tarball 字节摘要、已安装包名/版本/bin 路径；结束时要求宿主先停止自有进程，再用 `payload.receipts[] = {caseId, kind, evidencePath}` 调用 `sealEvidence`，最后从宿主封条重读证据并计算分数。
  - `frozenCliIdentityFromInstall` 适配 T17 owned-host 的安装结果 root/entry/version/tarballSha256，并补有结构映射测试。
  - 矩阵分支尚未集成 T17 host 实现和 CLI integrate verify/repair 入口，且缺少可用 API、Verdaccio、冻结 CLI tarball、SDK bundle 和视觉基线；因此 scenario executor 仍是显式注入边界，当前测试不能视为真实 CLI/Vue/React 运行结果。
  - RED/GREEN：新增 `runner.test.ts` 后首次因 `runner.ts` 不存在而失败；矩阵首轮另发现 V09/R09 的递减交互被旧校验规则错误拒绝，以及 N12 缺少预期拒绝状态，修正规则和场景后通过；缺字段 receipt 新增失败关闭用例；runner/host 身份适配测试先因 `frozenCliIdentityFromInstall is not a function` 失败，再补最小 root/entry 映射后通过。
  - 实测命令与结果：`.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/acceptance/t17-matrix/runner.test.ts','tests/acceptance/t17-matrix/matrix.test.ts','tests/acceptance/t17-matrix/run-seal.test.ts')` — 3 个测试文件、**12/12** 用例通过，exit 0；`.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','--ignoreConfig','--noEmit','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--strict','--skipLibCheck','--types','node', ...)` exit 0；`git diff --check` exit 0。
  - B 侧静态实作文件与职责：`tests/fixtures/t17-matrix/generate.ts`（确定性用例工程生成器，Vue/React × npm/pnpm × standalone/workspace，宿主在 apply 前就 import 计划生成的 `component-000N.{vue|tsx}`，键名与 MatchPlan 对齐 `matrix.<prop>` / `matrixHandler`）；`env.ts`（环境契约解析，必需 `T17_MATRIX_WORK_ROOT`、`T17_MATRIX_API_BASE`、`T17_MATRIX_REGISTRY_BASE`、`T17_MATRIX_VARIANTS`、`A10_FROZEN_BUNDLE`、`PHASE3_CLI_TARBALL`、`ZHINEXUS_API_TOKEN`、`ZHINEXUS_REGISTRY_TOKEN`，缺失即 `ok:false` 并返回清单）；`support.ts`（`sha256Bytes/File/Text`、`canonicalJson`、`digestProject`、路径安全助手）；`toolchain.ts`（冻结 CLI 安装到仓外、固定 npm/pnpm 安装 `--ignore-scripts`、原生脚本执行、最小环境白名单）；`platform.ts`（冻结 bundle 字节逐一核对、变体映射校验、真实 `/v1/matching/plans`，compatibility 必须 verified）；`browser.ts`（limited click/fill 与 visible/text/count、loopback 资源加载统计、零 pageerror 门、视觉 NEW/DIFF/PASS/INCOMPATIBLE 判定，阈值 **0.1 / 0.001**）；`mcp.ts`（`component mcp serve` stdio JSON-RPC 驱动器：initialize、tools/list、tools/call、notification、取消/退出与 stderr 隔离）；`executor.ts`（冻结命令表参数构造、冻结包身份校验、受控子进程 verify、`stableScenarioIdentity`、分母与宿主一致性断言）；`pipeline.ts`（契约结构字段校验、证据账本、四工具集合）；`ledger.ts`（`evidenceRoot/files` 独占写入 `wx`、receipt canonical 字节、`run-seal.json` 封存与自检）；`plan.ts`（实操顺序 C01–C09 / R01–R04、环境就绪判据、复现命令）；`vitest.config.ts`（独立 suite）；`executor.test.ts`、`pipeline.test.ts`（参数形态、分母锁定、宿主一致性、封存顺序与证据绑定的测试壳）。
  - 场景冻结要点：正向 20 为 Vue V01–V10、React R01–R10，覆盖 npm/pnpm × standalone/workspace（V03/V04、R03/R04 为 workspace）、折线/柱状/饼/散点/趋势卡/排名/占比、多实例、空数据→更新、隐藏→可见、KeepAlive（Vue 限定）、StrictMode（React 限定）、系列删减+渲染器切换、已知模板 recipe 修复后通过（V10/R10）；每例都预声明 `readySelector`、动作、断言、交互计数前后值与视觉主题/渲染器，交互必须严格增长。拒绝 13：N01 peer 冲突、N02 中途编辑、N03 无候选、N04 业务缺口、N05 类型过点击失败、N06 画面过版本不符、N07 视觉 NEW、N08 视觉 DIFF、N09 视觉环境不兼容、N10 修复预算、N11 路径链接、N12 敏感哨兵、N13 错宿主静态替身。
  - 独立 observability（不依赖产品自证）：入口 import 要求宿主入口字节中真实出现对每个生成文件的 import 说明符，且清单与 `generatedPaths` 完全一致；`installedVersions` 与 `plan.exactDependencies` 必须逐项一致，缺任何一项或依赖守卫非 passed 均判失败；视觉判定与 manifest proof 分离（`NEW/DIFF/INCOMPATIBLE` 与精确 installed proof 互不替代，任一不过即不过）；run-seal 与 score 引擎重算每个文件的 `sha256` 与 `bytes`，receipt 字节必须等于 `canonicalJson(receipt)`，篡改即抛错。
  - 实测状态（追加段）：已做结构自检（场景声明、分母、拒绝主题集合、CLI 参数、run-seal 封存与防篡改、runner 时序）；未做任何真实 CLI 执行、冻结包安装、宿主构建、loopback 断言、视觉比对、repair 全流程。结论边界：拿到 C 的冻结 tarball / bundle / API / Registry / 授权临时工程之前，20 正 + 13 拒绝**不得**计为通过；临时宿主属 temporary/synthetic，历史真实业务试点保持单列未完成。
  - 未完成边界：本记录没有证明 20 个场景由冻结 CLI 真实执行，也没有证明 Vue/React 临时宿主构建、浏览器截图/交互、视觉基线或真实业务项目验收。集成时须提供宿主 `createOwnedRun`、真实 CLI scenario executor、匹配的冻结 tarball 与 SDK bundle，并启用本机 API/Registry/Chromium；随后从真实 `run-seal.json` 重算结果。T17 技术验收和真实业务试点仍未完成。
- 结论与状态：完成（静态定义与支架）。被 t17-matrix-executor-2026-11-20.md（真实执行器）与后续 0022/0023 正式轮取代。
- 交叉引用：`t17-matrix-executor-2026-11-20.md`、`t17-matrix-scoring-2026-11-20.md`、`t17-matrix-0022-2026-11-20.md`、`t17-matrix-0023-2026-11-20.md`、`t17-host-runner-2026-11-19.md`、`t17-blackbox-2026-11-19.md`。
- 过时或矛盾点：明确的"未做真实执行"边界，不得引用为产品矩阵通过。

### t17-matrix-executor-2026-11-20.md

- 日期／角色／主题：2026-11-20；B（Claude 客户端矩阵）；T17 独立产品矩阵执行器。交付真实产品执行器及夹具，不将单元测试或诊断子集称为完整矩阵通过。固定场景表、20 个正向与 13 个强制拒绝、数据、动作、断言和视觉阈值保持原样。
- 目的：把静态矩阵支架升级为可真实执行冻结 CLI 的产品矩阵执行器。
- 承重事实：

  - 正式入口为 `scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-matrix/product.vitest.config.ts')`；`vitest.config.ts` 只运行单元测试。
  - 执行方式：先用独立手写、直接消费 SDK 的宿主生成参考基线，再移除候选工程的 SDK 依赖，由实际冻结 CLI 的 inspect/plan/apply 安装生成实现；原生命令使用真实宿主脚本；冻结 CLI、SDK、API/registry 与安装身份均有摘要绑定。
  - 独立检查入口 import、本次生成文件摘要、实际构建图、浏览器加载的 JS 与相邻 source map 原始源摘要，拒绝静态替身或错误宿主；真实 click/fill 和 DOM 精确断言按预声明场景执行。
  - 公共 bar grid 参数修正让既定点击落在真实柱条上；KeepAlive 夹具使用生成 Vue 实现的真实 props 类型；没有修改动作、期望事件、分母或产品接口；合法精确 packageManager 声明保留，夹具 native pnpm 也使用既定禁止重新引导的参数。
  - N10 由真实 apply 生成三份故障文件，真实 repair 最多两轮、每轮只修一份，最后仍有第三份故障；逐轮报告、原字节备份、完整源码清单与最终未决问题交由严格评分器验证；不伪造中间报告。
  - 所有项目、证据与缓存都有独占 owner；交付及缓存链接只按捕获的真实 journal/原生文件身份接管；通用源码守卫不按前缀忽略未知条目；封存前检查写集，归档逐文件复读 SHA/大小后才清理本轮所属项目。
  - 验证：完整矩阵单元入口 **12 文件、185/185**；控制方实际 03:19:26、19.69 秒，作者在 N01 修正后复验 03:22:28、34.07 秒，均 exit 0；根 tsc 与 diff check 均 exit 0。
  - 独立只读审查覆盖执行器、fixture/reference/browser/import-proof/process/cache/install-observer 与入口，未发现 Critical/Important；源码摘要记录在外置 `host-live-0.0.21-8ab74b65/independent-scoring-harness-static-review.json`；静态审查不代替正式 33 格。
  - 历史实跑：旧 0.0.20 完整轮诚实结果为正向 **9/20**（Vue 4/10、React 5/10）、拒绝 **4/13**，`matrixAccepted=false`；公开 grid、KeepAlive props 与 pnpm 管理器引导问题已分别修正；运行一小时后测试令牌过期导致后段 401，需另修隔离服务夹具寿命后新 owner 重跑；旧 seal 与失败记录保持原样。
  - 旧轮原字节归档 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/matrix-0.0.20-failed-dde864288f6a87e81a922d689d1b4fda`：50 roots、18542 文件，逐原 seal / inventory 校验并复制后复读，archive-map SHA-256 `8036a03978358a67eb234ff16151fb0f0e232c9109eec37809a8e27552143d18`；50 个本轮 parent 已清理。
  - 0.0.21 的 N01 单格先导真实 GREEN：1/1、exit 0、74.77 秒；plan conflicted、exit 2，含 `DEPENDENCY_CONFLICT`，证明锁定 ECharts 5.6.0 与 MatchPlan 6.1.0 实际冲突；该格先 native install 生成真实锁，未放宽拒绝要求；归档 `matrix-0.0.21-N01-diagnostic-eedda1170d0dee485e22b6a75ba53d05`，`fixedDenominatorEvaluated=false`；23 文件按 seal 复核，2 个本轮 parent 已清理。
  - 正式 0.0.21 同 SHA 完整 33 格已另立 owner 执行，结果须单独记录；评分边界见 t17-matrix-scoring-2026-11-20.md。
- 结论与状态：完成（执行器交付 + 单元 185/185）。被 0.0.22/0.0.23 正式轮超越；其记载的 0.0.20 首轮 9/20、0.0.21 N01 先导为历史保留失败/诊断。
- 交叉引用：`t17-matrix-2026-11-19.md`、`t17-matrix-scoring-2026-11-20.md`、`t17-matrix-n10-request-2026-11-20.md`、`t17-matrix-0022-2026-11-20.md`、`t17-matrix-0023-2026-11-20.md`、`t17-service-token-budget-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：0.0.20 首轮 9/20 与 t17-integration 02:18 节"首轮 33 格 0/20 正向、6/13 拒绝"是不同轮次（后者为另一新 owner 重跑），均如实保留。

### t17-matrix-n10-request-2026-11-20.md

- 日期／角色／主题：2026-11-20；B（Claude 客户端矩阵）；T17 独立矩阵 N10 请求夹具修正。0.0.21 完整产品入口实际执行 2975.21 秒、exit 1，矩阵结论为不通过。
- 目的：修正 N10 的 MatchPlan 请求夹具缺陷（唯一执行错误），不改产品、服务、契约、预期状态和修复预算。
- 承重事实：

  - 0.0.21 完整产品入口实际执行 **2975.21 秒、exit 1**；正向 **20/20**（Vue 10/10、React 10/10），强制拒绝 **12/13**，矩阵结论为不通过。唯一执行错误为 N10：创建 N10 专用工程之前，MatchPlan 请求为同一 Vue 设计键 `matrix/line` 发送了三个相同映射，真实 API 返回 HTTP 400。由此轮结果无法判断产品是否正确停止在两轮预算。V10/R10 分别保留实际 DIFF、一次修复、最终通过的历史证据。
  - 修正仅在独立验收夹具：`buildMatchPlan` 按 designId 和 framework 去重相同目标，为三个实例保留三份元素、绑定与实例 API；同一设计键出现不同目标时，在发送请求前失败。产品、服务、契约、预期状态和修复预算未改动。
  - 验证：`./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/acceptance/t17-matrix/platform.test.ts')` 修正前 2 条预期断言失败，修正后 **2/2**；`./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-matrix/vitest.config.ts')` **13 文件 187/187**、18.57 秒；根 tsc 与 `git diff --check` exit 0。
  - 历史矩阵证据 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/matrix-0.0.21-failed-a739be92b7af922351a731ad17bad851/`：归档逐字节保留 57 个证据根中的 **22739 个文件**和清单；57 个对应临时父目录已复查移除。根 seal SHA-256 `4ce1ae4e14e749037ab21ae455392ff53d1421b7e626274e25c47064df7db04c`，归档映射 SHA-256 `74e6d337ec08b49885763fbc03b870c31770a5c49a35769ba2dcc1245aa79d89`。复评分结论仍为 20/20、12/13、未通过。临时父目录的依赖文件可由 seal 清单辨识，归档范围为证据根原件。
  - 以上支架测试不能抵充完整产品矩阵；N10 诊断与 0.0.22 全量结果另立记录。
- 结论与状态：完成（夹具修正）。对应的 0.0.21 正式轮失败事实保留不改写；0.0.22 N10 独立诊断与正式轮另记。
- 交叉引用：`t17-matrix-2026-11-19.md`、`t17-matrix-executor-2026-11-20.md`、`t17-matrix-0022-2026-11-20.md`、`t17-cli-0021-regressions-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：`bf65180a`（0.0.22 的 N10 夹具修正提交）与本文是同一修正在不同版本/记录中的落地；0.0.21 的 12/13 不得因后续修正而改判。

### t17-matrix-scoring-2026-11-20.md

- 日期／角色／主题：2026-11-20；B（Claude 客户端矩阵）；T17 固定矩阵评分与两轮耗尽证据。只覆盖评分器及其回归，不代表冻结 CLI 的完整 33 格产品验收已通过。场景表、动作、断言、阈值和固定分母均未修改。
- 目的：让评分器诚实计分（真实失败计入失败）并为 N10 两轮耗尽补严格证据校验。
- 承重事实：

  - 固定分母：正向 Vue 10 格、React 10 格，另有 13 格强制拒绝；总正向至少 **16/20** 且每框架至少 **8/10**，强制拒绝全部符合预期、证据错误为零，方可通过。
  - 诚实失败与证据错误：已执行且留存完整、有效、同身份证据的 failed/blocked 正向案例计入失败，不加成功分，不再被一律判作证据错误。缺失、伪造、错摘要、错项目、无合法 plan/apply/spec/report、越界修改或未保留用户编辑仍阻断整体验收。通过案例仍须满足原有全部检查、精确依赖、真实命令、交互与视觉要求。新增回归证明 16/20、Vue/React 各 8/10 加全部拒绝可以达标，也证明损坏失败证据不能借此通过。
  - N10 的授权修复写入：一般拒绝例仍要求完整源码前后摘要相同。仅 **N10 + budget + repair-budget** 三重固定身份允许额外 `budgetRepair` 证据：三份已声明的真实故障生成文件、`maxAttempts=2`、恰好两轮且各修改前两份中的一份，第三份保留原故障字节，终态必须 `stopped`/`max-attempts-reached` 且最终行为失败与未决问题仍存在。
  - 评分逐项校验完整前后源码清单、合法 plan/apply/spec、初始失败报告、两轮连续报告摘要链、末轮摘要、精确 recipe 前后字节，以及两份真实备份的 id/path/base64/原字节 SHA-256；用户文件不得新增、删除或修改。其它拒绝例携带 `budgetRepair` 会被拒绝，receipt 结构未放宽。
  - 实际验证与审查：作者工具记录 03:07:24 新增 N10 两项回归为预期 RED；03:12:43 评分 suite GREEN **74/74**（此处时间和结果来自本轮工具 transcript，没有另造独立日志文件）；控制方实际运行 `scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-matrix/vitest.config.ts')`：03:19:26，**12 文件、185/185**、exit 0、19.69 秒；执行器作者在 N01 最小前置安装修正后复跑同一完整单元入口：03:22:28，12 文件、185/185、exit 0、34.07 秒；根 `tsc -p tsconfig.json --noEmit` 和 `git diff --check` 均 exit 0。
  - 独立只读审查覆盖 `score.ts`/`matrix.test.ts` 全部未提交变更，未发现 Critical/Important；审查确认真实失败保留固定分母，N10 特例未扩大其它拒绝写入范围，原通过要求未放宽。
  - 正式验收仍须使用同一冻结 CLI 和冻结 SDK 跑完整 33 格，并保存实际评分、逐格证据与清理结果；单元测试及单格诊断不能代替。
- 结论与状态：完成（评分器）。为 0.0.22/0.0.23 正式轮评分规则基础。
- 交叉引用：`t17-matrix-2026-11-19.md`、`t17-matrix-executor-2026-11-20.md`、`t17-matrix-0022-2026-11-20.md`、`t17-matrix-0023-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：作者工具记录（03:07:24 RED / 03:12:43 74/74）与控制方 03:19:26 的 185/185 是同一评分器在不同时点/不同入口的计数，非矛盾。

### t17-mcp-sdk-redaction-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（CLI 产品）；T17 MCP SDK 自动错误回复脱敏补验。为最终审查 Important 的独立返工证据，不改写原验收记录。范围仅为 MCP stdio 产品边界及对应回归；本次没有升版、重新冻结 tarball、提交、推送或运行根全量回归。
- 目的：修复 SDK 自动校验错误回复绕过产品脱敏、可能泄漏宿主凭据的缺陷。
- 承重事实：

  - 根因：官方 server SDK 2.4.0 的 tools/call 处理器先调用 `validateToolInput`，再进入注册工具 callback；strict Zod 校验的错误由 SDK 自行转成 isError 工具结果；未知工具则由 SDK 生成 JSON-RPC error。原 `server.ts` 的 `jsonToolError` 脱敏覆盖不到这两条路径，`serveStdio` 的 onerror 仅处理带外错误，也不重写 stdout 回复。SDK 的错误说明会反射未知 JSON 键或工具名；Zod 说明本身还可能包含已转义 JSON 字符串。
  - 变更：新增 `mcp/transport.ts`，以 SDK 官方支持的自定义 `StdioServerTransport` 在 send 序列化前统一清洗 result、error 和 params，包括字符串与对象键；`jsonrpc`、`id`、`method` 保持协议关联语义。在内存捕获两项已知宿主凭据 `ZHINEXUS_API_TOKEN` 和 `ZHINEXUS_REGISTRY_TOKEN`，清洗其原始值及 JSON 嵌套转义表示；同一路径清洗 SDK 带外 stderr 诊断；没有输出环境或凭据内容。四个 inputSchema 仍为 strict，tools/list 的 `additionalProperties=false` 不变；SDK 原有拒绝、错误码及业务 handler 的授权/路径判断保持。
  - 新增正式测试 `tests/integration/project-mcp-redaction.test.ts`：真实 CLI 子进程原始 stdio、initialize、四工具列举与 strict schema、额外字段拒绝、未知工具协议错误、取消通知、错误后的有效 inspect/list、干净退出与 stdout JSON-RPC 帧完整性；仅通过环境白名单继承系统必要键，凭据全部为合成值；断言失败仅显示泄露布尔值。
  - RED/GREEN（固定 Node 26.13.0 / pnpm 12.18.0，只构建本地 dist，没有 pnpm pack）：RED `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-mcp-redaction.test.ts')` 退出 1，2/2 预期失败（普通合成凭据与含引号、反斜杠、Tab、换行的合成凭据均在 `leaked=true` 对 false 的断言失败，前置握手/列举/strict 拒绝/协议错误成立；未输出原始协议帧或凭据）；`--filter @company/component-cli typecheck` 退出 0；`--filter @company/component-cli build` 退出 0（contracts 同步、TypeScript 编译及内嵌 probe 清单复核通过，仍为 **73/73**，缺失/清单外/污染/链接/被改动均为 0；新增 MCP transport 为 CLI 自身编译模块，不属于 probe 清单）；GREEN 跑 `project-mcp-redaction.test.ts` + `project-mcp.test.ts` 初次退出 0，2 个文件 **8/8**；强化错误后的有效调用以及解析后的 SDK 文本转义检查后再次运行，退出 0，仍为 8/8，耗时 **10.69 秒**。两种凭据表示均未进入 stdout/stderr；stdout 均可逐行解析为完整 JSON-RPC 帧。
  - 边界：本次证明源码构建产物的本地 stdio 行为；尚未针对新的冻结 tarball 重跑仓外安装、全图、矩阵或黑盒。统一清洗范围为已知的 API/registry 环境凭据及其原始/JSON 转义表示，不宣称通用污点跟踪或任意编码的秘密识别。保留本次及原有临时现场，未执行清理。
  - 控制方复验与独立复审：控制方于 04:28:50 以同一固定包装器完整运行新旧两份 MCP suite：**8/8**、无 skip、10.15 秒、exit 0。独立复审者另于 04:30:07 运行同两份 suite：**8/8**、9.10 秒、exit 0，并完成 CLI typecheck（exit 0）。独立流探针的九项检查通过，覆盖 result/error.data/params、对象键、原始及六层 JSON 转义、协议 envelope 和 error.code/progressToken/非字符串值保留、原输入不变、构造时凭据快照；复审同时核对 SDK wire/entry/channel 均经 send，以及实际 `dist/mcp/transport.js` 与 `files=[dist]` 分发路径。当前范围无 Critical / Important / Minor。
  - 附加 malformed-input stderr 探针未出现可确认的脱敏标记，其"必须出现标记"断言不计通过；观测无凭据泄露，协议可继续调用并正常退出。该附加探针不抵充正式 suite 或新冻结包门槛，不宣称每条异常 stderr 路径均已独立触发。
- 结论与状态：完成并经独立复审（0.0.22 时点的 `b193406c`）。冻结产物验收由 C 后续收口；0.0.23 的追加黑盒脱敏 probe 见 t17-blackbox-0023/0022。
- 交叉引用：`t17-final-review-2026-11-20.md`、`t17-c0-current-evidence-2026-11-20.md`、`t17-c0-official-correction-2026-11-20.md`、`t17-cli-0022-regressions-2026-11-20.md`、`t17-blackbox-0022-2026-11-20.md`、`t17-blackbox-0023-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：本篇为源码构建产物层面的验证；0.0.22/0.0.23 黑盒中对同一冻结包的脱敏验证是独立的仓外安装 probe，两者互补而非重复。

### t17-no-install-2026-11-20.md

- 日期／角色／主题：2026-11-20；C（平台/契约）；T17 无安装结果的契约对齐。
- 目的：修正共享 apply context 验证器与产品 no-install 分支的偏差，禁止伪造 `installedVersions`。
- 承重事实：

  - 已确认范围：2026-11-19 提交 `8def5ad1993b9bd8fa1643279041135ef82bf1ce` 的 T17 设计第 70 行及实施计划 C0 明确保留 T16 无安装语义：`installState: not-run` 时 `installedVersions` 为 `[]`。T17 verify 另行读取真实安装树、lock、精确版本与清单字节，不能用计划或 apply 空数组证明依赖已安装。补查该已确认决定后，无须再次索取同一语义决策。
  - 缺陷与最小修复：共享 `validateIntegrationApplyResult(input, context)` 原先对所有 applied 结果无条件要求 exactDependencies 全量版本，误拒产品已存在的无安装分支；不带 context 时又允许 not-run 结果捏造非空版本列表。
  - 新增四例：无安装空列表正例、伪造安装列表反例、需要安装却缺实测结果反例、无安装谎称 succeeded 反例。结构 Schema 不变，仅对齐上下文与语义校验：no-install applied 必须 `not-run + []`；计划含 lockfile-regeneration 时仍必须 succeeded 与精确全量安装版本，错版本、缺项、多项继续拒绝；project root、plan digest、完整写集、before/after guards、backup、失败恢复规则不变。
  - 矩阵评分同步读取诚实 apply 结果，只在 apply succeeded 时比对其本次安装列表；verify 报告中的实际全量依赖、清单摘要以及错版本反例继续独立校验，未降低场景动作、预期、20 个正向分母、13 个强制拒绝或 80% 门槛。
  - 实际验证（2026-11-20，固定 Node 26.13.0 / pnpm 12.18.0，`./scripts/pnpm.ps1 -PnpmArgs @(...)`）：`exec vitest run tests/contracts/integration-apply.test.ts`（实现前）RED **2 failed / 87 passed**（合法无安装结果误拒、伪造版本列表误受理；有效 plan fixture 自身校验通过）；`--filter @company/contracts build` exit 0；六套件（integration-apply / integration-verification / integration-repair / project-apply / project-verify / integration-repair）**6 文件 254/254**、exit 0、49.73 秒；`--filter @company/contracts schemas:generate` exit 0（Schema 结构无变化）；三套件（integration-apply / api-schema / t17-matrix matrix.test）**3 文件 140/140**、exit 0。
  - 独立审查确认未放宽实际安装时的精确版本要求；no-install 无 context 也拒绝伪造列表。此记录不代表新 CLI 已冻结或完整矩阵已通过。
  - 用户补充确认与冻结后回归：2026-11-20 用户明确选择"采用如实报告本次安装的语义"（本次未安装即空列表，已有依赖由 verify 实测报告），该决定与上述既有设计和已实施修正一致，无需再次变更协议。随后冻结的 CLI 0.0.21 已包含该修正，tarball SHA-256 `7dd4874f0e6c98caddb2de959b942d7bde463c35a04ba82fe31ec67140f5f7cd`；同一冻结输入的完整根测试为 T10 168/168 与 Vitest 2187/2187，零跳过、exit 0；T15 25/25、T16 14/14 亦已通过。本段追加后续结果，不把上面的冻结前记录改写为当时已通过。
- 结论与状态：完成并纳入 0.0.21 及以后冻结包。
- 交叉引用：`t17-cli-0021-regressions-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-completion-2026-11-20.md`、`docs/specs/2026-11-19-phase3-t17-design.md`。
- 过时或矛盾点：无。

### t17-pnpm-manager-bootstrap-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（CLI 产品）；T17 pnpm 固定管理器验证的补充修复。此前禁止 `verifyDepsBeforeRun` 只覆盖依赖安装。
- 目的：修复工程含合法 `packageManager: pnpm@12.18.0` 声明时，固定 pnpm 仍在授权脚本启动前引导包管理器、污染冻结锁文件的问题。
- 承重事实：

  - 现象：真实矩阵发现工程含 `packageManager: pnpm@12.18.0` 时，固定 pnpm 仍在授权脚本启动前引导包管理器，给冻结锁文件前置管理器 YAML 文档。不能删除工程里的合法声明掩盖该边界。
  - 独立诊断直接调用冻结 CLI 0.0.20：真实 apply 后立即 verify，跳过矩阵自己的 type/build；type/build/dependency/browser 实际通过，末尾 source-guard 正确报告 `PROJECT_CHANGED`；唯一源码差异为 `pnpm-lock.yaml`。原始锁和真实报告逐字节保留在仓外 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/pnpm-direct-verify-0.0.20-1db238942a6b6490404ae614a6b7ee06`，245 份证据重读一致；case seal 有效，外层诊断因空缓存目录登记失败而无 top seal，明确保留 exit 1。
  - 修复：产品在独立校验精确 Node/npm/pnpm 身份之后，仅为 verify 的固定 pnpm argv 增加 `--pm-on-fail=ignore`，与 `--config.verifyDepsBeforeRun=false` 并用；没有修改 T16 安装暂存的 `pmOnFail: error`、manifest 身份或源码守卫。此结论来自本机原生命令对照；先前猜测的 pnpm-v12 网页地址实际为 404，不作为已读取官方材料。
  - 回归：沿用 loopback poison registry、真实脚本及全量精确依赖 manifest，参数化无声明和精确 pnpm 声明两个工程，检查 registry 请求为 0，package/lock/.modules 与依赖 manifest 原始字节不变、真实 dist 存在、类型/构建/依赖检查通过。
  - RED：2026-11-20 03:14:20，1 passed / 1 failed，精确声明案例实际 `changedFiles` 为 `[pnpm-lock.yaml]`。GREEN：03:14:44，**2/2**、exit 0、**2.38 秒**。
  - 完整相关回归：`./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-verify.test.ts','tests/integration/project-verify-cli.test.ts','tests/integration/integration-repair.test.ts','tests/contracts/integration-verification.test.ts','tests/contracts/integration-repair.test.ts')`，**5 文件、111/111**、exit 0、**38.61 秒**。CLI typecheck、根 `tsc -p tsconfig.json --noEmit` 均 exit 0；独立只读审查无确认的 Critical/Important，确认安装隔离固定配置未变。
  - 完整相关日志位于仓外 `pnpm-manager-no-bootstrap-f9f58c3d6b1d49598192f8cd7727a712`。本修复必须另升 0.0.21、构建并一次冻结；0.0.20 不重打包、不覆盖，新版本必须重新运行真实宿主、矩阵、黑盒和 T15/T16。
- 结论与状态：完成。经 `805c7341` 提交并纳入 0.0.21（见 t17-integration 03:32 节）。
- 交叉引用：`t17-pnpm-no-install-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-cli-0021-regressions-2026-11-20.md`。
- 过时或矛盾点：与 t17-pnpm-no-install 是两个相继修复（先禁隐式安装，再禁管理器引导），回归计数从 110/110 增至 111/111，非矛盾。

### t17-pnpm-no-install-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（CLI 产品）；T17 pnpm 验证禁止隐式安装。追加说明产品缺陷修复，不修改既有冻结包或历史验证记录。
- 目的：禁止 pnpm 默认 `verifyDepsBeforeRun` 在授权 run 之前隐式安装依赖。
- 承重事实：

  - 固定工具链：Node 26.13.0、pnpm 12.18.0、npm 11.20.0。
  - 原因：pnpm 默认 `verifyDepsBeforeRun` 会在授权的 `run` 之前尝试安装；仅抑制 pre/post 生命周期不能满足"验证不安装"。
  - 修复：产品仅在固定 pnpm argv 增加 `--config.verifyDepsBeforeRun=false`，保留安装版本、清单摘要、锁文件及 dependency-guard 的独立实测。
  - 真实 RED：完整 v9 snapshots、hoisted 安装元数据与默认 isolated 配置不一致时，loopback poison registry 实际收到 **21 次请求**。
  - GREEN：新回归与既有 npm/pnpm pre/post sentinel 为 **2/2**；实际生成 dist，注册表请求为 0，manifest、lock、安装元数据和各精确依赖 manifest 原始字节保持一致。
  - 作者完整回归：`exec vitest run tests/integration/project-verify.test.ts tests/integration/project-verify-cli.test.ts tests/integration/integration-repair.test.ts tests/contracts/integration-verification.test.ts tests/contracts/integration-repair.test.ts`，**5 文件、110/110**、exit 0、27.87 秒；根 tsc、CLI typecheck、diff check 均 exit 0。
  - 集成方亲自复跑相同五套测试：**110/110**、exit 0、28.15 秒；CLI build（含契约内联同步与真实 package probe）exit 0，probe **73/73** 文件摘要复核一致。
  - 外置原始日志、RED/GREEN 摘要与逐文件 SHA-256 清单位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/pnpm-verify-no-install-7eb9899a`。
  - 最终版本由集成方另行升版、构建并单次冻结，真实宿主、矩阵、黑盒和 T15/T16 均须使用新包复验；上述定向测试不替代最终验收。
- 结论与状态：完成。先于 t17-pnpm-manager-bootstrap；两修复合并后由 0.0.21 冻结承载。
- 交叉引用：`t17-pnpm-manager-bootstrap-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-local-registry-timeout-2026-11-20.md`。
- 过时或矛盾点：无。

### t17-regression-budgets-2026-11-20.md

- 日期／角色／主题：2026-11-20；C（测试稳定性）；T17 完整回归的测试外层预算。CLI 0.0.21 首次完整根 `test` 实际失败，不能记为全绿。
- 目的：修正四个用例的外层默认 5000ms 超时（无行为断言失败）。
- 承重事实：

  - 首次完整根 `test`：T10 168/168、零跳过；Vitest **121 文件、2183 passed / 4 failed**、**814.18 秒**、exit 1。原日志位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/full-test-0.0.21-d37d6fbd53304ef18b991576cb4819a8/test.log`。四项均为外层默认 5000ms 超时：两个真实 Git 子模块 fixture、MCP 取消进程树、首次动态加载 ECharts 的 Vue 生命周期测试；没有行为断言失败。
  - 未改代码先运行三个失败文件：`./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-inspect.test.ts','tests/integration/project-mcp.test.ts','tests/unit/sdk-lifecycle.test.ts')`，03:35:09 实际 **105/105**、exit 0、58.93 秒。结合首次日志中的 **5452ms / 5944ms / 5016ms / 8460ms**，以及 MCP 本身包含两段最长 10 秒条件等待和 2.3 秒哨兵观察，确认默认外层预算无法覆盖合法完整流程。
  - 最小修正仅给上述四个 it 增加第三参数：Git 两项各 **30 秒**、MCP **45 秒**、首次 ECharts 导入 **15 秒**；全局默认和其它用例未改；原内部超时、AbortController、进程终止检查、哨兵观察、nextTick 与所有断言保持原样。独立只读 diff 审查无 Critical/Important。
  - 修正后同一三文件命令 03:41:03 为 **105/105**、exit 0、46.60 秒；根 tsc 与 diff check exit 0。新的完整根 test 已另立外置目录执行，必须依据其最终完整输出报告结果，窄测不能代替。该修正只涉及测试，不改变 CLI 或冻结 tarball。
- 结论与状态：完成。0.0.21 的 2187/2187 全绿根测即在此基础上重跑得出（见 t17-cli-0021-regressions）。
- 交叉引用：`t17-cli-0021-regressions-2026-11-20.md`、`t17-regression-stability-2026-11-20.md`、`t17-c0-current-evidence-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：无。

### t17-regression-stability-2026-11-20.md

- 日期／角色／主题：2026-11-20；C（测试稳定性）；T17 完整回归中的测试稳定性修正。冻结 CLI 0.0.20 的首次完整根 `test` 实得 Vitest 2123 passed / 3 failed，120 文件，exit 1、727.53 秒；原始结果保留在仓外 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/full-test-0.0.20-03f61ce2b451435db4756dd1fc50767d`，不改写为通过。
- 目的：修正 0.0.20 首次完整根 test 的三项失败（两项预算 + 一项断言采样缺陷）。
- 承重事实：

  - 两项失败是测试外层总预算不足：Vue npm inspect 运行真实子进程，原默认 5 秒；双框架独立基线负例包含两次各 2 秒的预期失败及真实浏览器启动，原总预算同样只有 5 秒。分别明确为 **30 秒**和 **20 秒**；内部失败期限、操作与断言不变。
  - 第三项为浏览器断言采样：最后一次 locator 读取超时前，轮询错误地清空了已经完成的上一份观测。移除该清空操作，保留最后完成采样；最新读取异常仍使断言失败并保留 detail，不把超时转为通过。相关完整矩阵支架先观察到 128 passed / 1 failed，修正后 **129/129**。
  - 集成方于 2026-11-20 03:00 执行 `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/acceptance/t17-host/consumer.test.ts','tests/acceptance/t17-host/chain.test.ts','tests/acceptance/t17-host/host.test.ts','tests/acceptance/t17-host/baseline-reference.test.ts','tests/acceptance/t17-matrix/browser.test.ts','tests/integration/project-plan-consumer.test.ts')`：实际 **6 文件、117/117**，exit 0、45.58 秒。该结果只证明窄范围回归；完整根 `test` 仍须在验收代码稳定后重新执行。本次仅修改测试，不变更冻结产品或重新打包。
- 结论与状态：完成。0.0.20 的完整根 test 未在本轮重跑转绿（该版本最终未作交付候选）。
- 交叉引用：`t17-cli-0020-regressions-2026-11-20.md`、`t17-regression-budgets-2026-11-20.md`、`t17-host-fixtures-2026-11-20.md`、`t17-matrix-executor-2026-11-20.md`。
- 过时或矛盾点：与 t17-regression-budgets 是同类问题在不同版本（0.0.20 / 0.0.21）的两次修正，均保留原失败事实。

### t17-repair-source-continuity-2026-11-20.md

- 日期／角色／主题：2026-11-20；A（CLI 产品）；T17 修复重验的完整源快照连续性。最终源码审查在冻结 CLI 0.0.21 中发现两类真实遗漏；旧冻结包和既有验收结果保留，不用本记录追认旧包安全。
- 目的：修复 repair 私有基线不完整、内部重验发现用户变动后仍继续修复的第二类覆盖风险。
- 承重事实：

  - 两类真实遗漏：生成文件写入后、内部重验前新增业务文件会被接纳为新基线；内部重验已经发现用户变动后，repair 仍可能继续修复另一生成文件并覆盖首次问题。
  - 根因：repair 的私有基线仅从 `applyResult.afterHashes` 建立，未保留源报告的完整 `snapshots.after`；verify 只逐项检查部分守卫，不能发现新增路径；repair 消费内部失败报告后未立即停止。
  - RED（产品修改前，控制方新增真实文件回归并通过固定工具链亲跑）：`./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/integration-repair.test.ts','-t','修复写入后重验前')` 04:13:12 开始、5.66 秒、**3 failed / 10 skipped**（新增、编辑、删除三例的真实结果均为 stopped，未按源变更阻断）；`-t '重验中发现用户新增文件'` 04:14:05 开始、4.92 秒、**1 failed / 13 skipped**（预期一轮，实际两轮，第二生成文件被继续写入）。用例使用真实 apply、原生命令与文件字节；只在 fs 实际写入、复读或证据落盘边界注入并发用户改动，不 mock verify 或 repair 的结果。
  - 修复：repair 以源报告完整 `snapshots.after` 为基底，仅更新本轮已安全写入并复读的生成路径；内部 verify 对私有基线与当前完整路径集合比较，覆盖新增、删除、编辑；原 `plan.baseFileHashes` 守卫继续生效；公共 verify 仍使用原 apply 基线，外部调用不能传入内部替代快照。内部重验报告含 `changedFiles`、`PROJECT_CHANGED` 或 `USER_EDITED` 时立即停止，结果为 blocked / user-edited，保留该报告及问题，不再写第二份生成文件；已完成的本轮写入、备份、三个原始身份摘要和用户字节继续如实记录。
  - GREEN：`exec vitest run tests/integration/integration-repair.test.ts` 04:19:02 开始、14.15 秒、1 文件 **14/14**、exit 0、无 skip；四套件（project-verify / project-verify-cli / integration-verification 契约 / integration-repair 契约）04:19:34 开始、24.17 秒、4 文件 **101/101**、exit 0、无 skip。
  - 复审追加：源报告不能替换原始守卫。独立复审进一步复现：源失败报告本身已含 `PROJECT_CHANGED` 时仍可能启动修复；外部报告把锁文件的前后快照同时改成当前摘要，也可使私有全量快照覆盖原 `plan.baseFileHashes` 守卫。控制方新增三项正式回归，第一次因测试文案不符合固定 issue 消息而失败，纠正测试文案后于 04:24:22 重新执行 `-t 源报告`：**3 failed / 1 passed / 13 skipped**、5.89 秒，均真实收到 stopped 而非 blocked。随后补充两处边界：源报告已有 `PROJECT_CHANGED` / `USER_EDITED` 或 changedFiles 时零写入停止；repair 初始校验独立合并原 plan 与实际 apply 的守卫，不能被源报告替换；内部 verify 同样保留该独立守卫，只允许当前调用的生成组件路径由修复私有守卫覆盖，完整路径集合检查仍独立执行。04:25:08 实际运行完整 repair、project-verify、project-verify-cli 和两份 verification/repair 契约套件：**5 文件、118/118**、无 skip、37.54 秒、exit 0。新增断言包括原始锁文件字节及未修复生成文件保持不变、源报告问题保留、源报告已变时 `attempts=[]`。
  - 独立复审随后对最新源码运行 `.tools/review-repair-snapshot-20261120-7727/vitest.config.ts`：04:26:42，**6/6**、exit 0，覆盖诚实源变更报告、无源变更 issue 的伪造锁快照、缺失/未知/false 快照、合法两轮摘要链及带 context 的完整契约验证；公共 verify 的额外 options/第四实参不能替换基线。复审结论无剩余 Critical / Important / 新增 Minor。该 probe 为独占、忽略的 synthetic 源码验证，不替代新冻结消费者验收。
  - 0.0.22 强制全图 build/typecheck 为 **20/20**、0 cached、15.336 秒、exit 0；随后根 tsc 首次因新增测试把 `issue.code` 和固定 message 分别联合推断而报 TS2345；将测试 fixture 改成完整判别对象的两个分支，产品未改，根 tsc 随后 exit 0。04:37:47 复跑 `-t 源报告` 为 **4 passed / 13 skipped**、5.71 秒、exit 0，仅证明该受影响组，完整根回归另行执行。首次失败及追加的 `root-tsc-correction-result.json` 均保留于外置 `workspace-0.0.22-mwo0gepv-tj4gx2ze`，不覆盖原失败记录。
  - 本记录仅证明该源码修复及定向回归；独立复审、新版本单次冻结、完整根测试、宿主、33 格矩阵及冻结包黑盒仍须分别运行；不据此宣告整个 T17 完成。
- 结论与状态：完成并经独立复审。提交 `672582ba`，纳入 0.0.22。
- 交叉引用：`t17-final-review-2026-11-20.md`、`t17-integration-2026-11-20.md`、`t17-cli-0022-regressions-2026-11-20.md`、`t17-host-guards-2026-11-20.md`、`t17-matrix-scoring-2026-11-20.md`。
- 过时或矛盾点：无。

### t17-service-token-budget-2026-11-20.md

- 日期／角色／主题：2026-11-20；A/综合（隔离服务夹具）；T17 隔离服务凭证覆盖完整矩阵预算。旧完整 33 格运行超过一小时后，N09–N13 收到真实 401，旧轮仍保留失败状态。
- 目的：把隔离服务本地临时签名 OIDC fixture 的 API token 寿命从 1h 提高到覆盖两小时矩阵的有界 3h。
- 承重事实：

  - 检查隔离服务夹具发现其 API token 固定为 1h，而矩阵外层允许运行 2h；测试设施会在合法验收流程结束前使凭证过期。
  - 修正只将 `tests/acceptance/t17-host/local-services.ts` 的本地临时签名 OIDC fixture 寿命改为有界 **3h**，覆盖两小时矩阵及准备、封存和清理余量；subject、roles、audience、原 API 鉴权、生产凭证策略和产品代码均未改变，也未刷新或修改旧运行的凭证/报告；新 owner 才使用新寿命。
  - 新增独立实跑入口：`./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-host/local-services-token.vitest.config.ts')`，提供 `A10_FROZEN_BUNDLE` 与工程外 `T17_TOKEN_BUDGET_EVIDENCE`。测试启动本轮 owner 三存储和真实 API，以返回的同一个 API token 完成 SDK 上传、发布与 READY，再从该 token 的签名 payload 读取寿命，不另造 token；始终 finally close，凭证仅在内存，落盘只有数值元数据。
  - RED：03:39:00，1 failed、exit 1、25.65 秒；旧 1h 凭证只有约 3600 秒，低于 8100 秒要求；原数值 3604 包含准备前时间锚点，故仅用于证明旧寿命不足，随后按独立审查修正为 READY 后的实际当前时间；目录 `token-budget-red-8c1a829c6f624e1d88edde3227c6f897`。
  - 初次 GREEN：改 3h 后 1/1、exit 0、23.87 秒。最终 GREEN：采用 READY 后时间锚点，严格要求 `8100 <= remainingSeconds <= 10800`，03:43:31 为 **1/1**、exit 0、**30.10 秒**；真实 `issuedLifetimeSeconds=10800`、`remainingSeconds=10782`；目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/token-budget-final-91c33968ea6f4184a1982a2f4b609840` 保存原日志、退出码与 `lifetime-observed.json`。
  - 根 tsc 与 diff check exit 0；独立只读审查无 Critical/Important，确认 token 不落盘、权限及 READY 流程不变。
  - 这是隔离验收夹具修正，不是生产 OIDC 验收；正式 33 格仍须新 owner 从头实跑。CLI 0.0.21 与 SDK 原冻结字节保持不变。
- 结论与状态：完成。对应提交 `aa801478`（见 t17-host-0021、t17-integration 03:32 节）；0.0.20 首轮矩阵因 401 后段失败的事实保留。
- 交叉引用：`t17-host-0021-2026-11-20.md`、`t17-matrix-executor-2026-11-20.md`、`t17-local-registry-timeout-2026-11-20.md`、`t17-integration-2026-11-20.md`。
- 过时或矛盾点：无。
