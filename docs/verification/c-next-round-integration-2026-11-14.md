# A/B/C 下一轮集成与 Windows 原生复验

日期：2026-11-14。负责人：C。基线 `4dc93fec1c0c702fb615b0709f8f7a9816bc3ec9`；集成分支 `chore/c-next-round-integration`。本文新增记录本轮实际执行结果，不改写各方历史验证记录。

## 分支与审查

- C：`acd9d5739291236e284fd1db1472ff00514127c2`，镜像身份预检、完整登记原子发布与独立平台专项；独立复审已关闭并发登记 P2。本地合并 `0b71cf44019f43dbbb516787b2f717a7ff14f1cd`。
- B 第一阶段：`d1f61500a6f6e80e6bbd9a50749bd663ccc1fcbb`，本地视觉基线、真实 API CAS、网页异常恢复和冻结材料参数；独立复核窄测试 17/17，两项 P2 已关闭。集成合并 `20d01e4`。
- A 首份交付：`698e2321511a67be305be9996b716442e0e48cfd`，Git bundle 完整性验证通过，已快进导入 Windows A 工作树。首轮审查发现问题，尚未合并；后续修正另记。
- B 第二阶段兼容 CLI 与 A 候选/回退证据仍在实施。不能将本轮进度写为完整 T10 完成。
- 原 SDK 冻结批次不重新 pack。三方均保留独立分支；不 push、不删除分支或工作树。

## C 与 B 第一阶段集成验证

命令在 Windows C 工作树执行，使用项目固定 Node 26.13.0 / pnpm 12.18.0。

| 命令 | 实际结果与边界 |
| --- | --- |
| `scripts/pnpm.ps1 vitest run tests/unit/local-images.test.ts tests/unit/platform-isolation.test.ts` | C 合并前新鲜执行，10/10 |
| `scripts/pnpm.ps1 test` | C 合并前新鲜执行，38 文件、693/693，203.21s |
| `scripts/pnpm.ps1 test:platform` | C 合并后相同源码树，28 文件、88/88，229.45s，exit 0；独立栈 `b2efee12-b7ca-4ba7-a51c-b6d7aa447304` 已清理 |
| `scripts/pnpm.ps1 install --frozen-lockfile` | C+B 集成通过；未改写锁文件 |
| `scripts/pnpm.ps1 verify:workspace` | 10 成员、无环、4 公开包、服务端依赖图通过 |
| `scripts/pnpm.ps1 exec turbo run build typecheck --force` | 20/20 实际执行通过，0 cached，17.24s |
| `scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 根类型检查 exit 0。首次简写调用因 PowerShell 参数绑定失败，改显式数组后实跑通过；首次失败不算通过 |
| `scripts/pnpm.ps1 test:browser` | 195/195，1.4m，exit 0；先强制构建并确认 5173–5176 空闲，设置 `ZHINEXUS_SDK_BUNDLE_DIR` 指向权威冻结批次 |

浏览器范围包含 14 实现、56 项主题/渲染器展示、手动发布失败恢复与 6 项真实三存储网页 E2E。不能替代公司 OIDC、生产独立域/TLS 或真实业务试点。

原始架构 SHA-256 再核对为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，未变。

## A 首份交付的 Windows 失败与运行证据

在 Windows A 工作树使用 C 的固定工具链启动，未修改 A 源码。

1. `install --frozen-lockfile --ignore-scripts`：通过，10.9s。A 工作树最初没有 `.tools`；首次日志重定向未能建立文件，命令未执行，不计入验证。
2. `node --test tests/acceptance/t10-sdk/probe.test.mjs`：51 项中 46 通过、5 失败，exit 1。失败均由测试 fixture 使用 Unix `cat`，Windows `spawnSync cat ENOENT`。已将准确堆栈反馈 A。
3. `probe.mjs --bundle <权威冻结目录> --echarts 6.1.0 --out test-results/t10-sdk-probes/windows-initial --label windows-baseline`：exit 0；两框架各 28 次浏览器运行，类型/生产构建/SSR/运行/交互与 bar 卸载重挂均通过；无视觉基线，`visual=not-run`、`recommendation=hold`。两份消费者目录确认已清理。
4. 只读临时探针复现：两份同组合基线冲突时 `conflicts.length=1`，比较仍返回 `PASS`；缺 SSR/生命周期/浏览器运行证据时 `runtime=passed`。已反馈 A 补 RED/GREEN。

首轮报告还使用常量字体摘要与浏览器 revision，并含硬编码 Linux 未覆盖说明；因此这批截图只作为故障排查证据，不能升级为可信视觉通过。新环境指纹修正后必须重新生成基线并复验。

审查还要求未核对候选来源/integrity 时保持 hold、读取真实框架解析版本、冲突基线失败关闭及跨平台测试。A 最终修正、候选回退、B 命令和最终 main 门禁将在后续段落追加。

## 未验收门槛

公司 OIDC/PKCE/撤权、生产独立预览域/TLS、真实 Vue/React 业务试点、跨版本兼容记录落库均不因本地测试自动通过。完整 G2/T10/T11/T12 保持开放。

## 追加复核：修正交付前的实际失败

下列失败发生于 A 未提交草稿或 B 固定提交，不覆盖上面的首轮记录；均已反馈各自负责人，修正后的通过结果另记。

- A Windows 真实浏览器 smoke：`measureFontFingerprint` 在 `page.evaluate` 中引用 Node 外层常量，抛 `ReferenceError: FONT_MEASUREMENT_SOURCE is not defined`；浏览器 revision 读取先后遇到缺失 `fileURLToPath` 和 pnpm 包路径解析失败。C 从真实 `@playwright/test → playwright → playwright-core` 依赖链解析 `browsers.json`，读到 Chromium revision `1254`，已给 A 可复现的定位方法。
- A `nativePlatformNote` 必须进 `scopeNotes`，不能让本机完整验证因“其他操作系统未复验”永远 hold。默认 strict 安装失败不得自动重试 legacy；只有显式选择 legacy 才允许继续测量。消费者来源需与真实 npm lock 的版本、integrity、resolved 和非链接状态核对。
- B `0ee149a` 独立窄测 3 文件、24/24 通过，但额外临时反例复现四项 P2：组合实际 ECharts/框架版本未绑定、resolver integrity/source 被丢弃、畸形 `failures` 引发未捕获异常、Windows junction 可越出冻结根目录。该提交暂不合并第二阶段；后续固定 head 另行复核。
- C 已完成根脚本接线草稿：`test:t10` 与 `probe:t10`，根 `test` 将在服务构建后运行探针 Node 单测，再运行 Vitest；仍不进入 Turbo 缓存。冻结安装与工作区边界检查实际通过，锁文件未变。A 源码尚未导入时不运行或宣称根最终门禁通过。

## B 第二阶段复核通过与集成

- 固定交付头 `8cbc8b7d296390b45a88a4a31ecde842d7ca80e5`：`d8433a9` 修正四类 P2，`8cbc8b7` 追加独立记录。独立复核直接读取固定 Git 对象，并非活跃草稿；3 文件、25/25、3.22s，四项原问题全部关闭，无剩余代码阻断。
- 反例覆盖组合实际 ECharts/框架版本、候选 integrity/source/验证标记、畸形 failures 与 Windows junction 越界；合法显式版本/latest 控制输入通过，离线 check 可查询、离线 verify 拒绝采用。具体错误码和边界见 [B 修正记录](b-next-echarts-p2-2026-11-14.md)。
- C 按用户授权以 `30c0a88` 本地合入 `chore/c-next-round-integration`；保留 C 自有三项脚本/文档草稿及 B 工作树原有四项差异，未推送。
- 合入后设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`，实跑 `scripts/pnpm.ps1 -PnpmArgs @('exec','turbo','run','build','typecheck','--force')`：20/20、0 cached、5.952s、exit 0；`scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`：exit 0。日志分别为 `.tools/c-final-build-types-2026-11-14.log` 与 `.tools/c-final-root-tsc-2026-11-14.log`。
- 独立逐文件复核原冻结批次：199 文件、14 实现，大小与 SHA-256 差异均为 0；证据 `.tools/c-final-frozen-audit-2026-11-14.json`。冻结安装和工作区图检查通过，锁文件未改。
- A 修正交付前，C 只读检查另发现消费者成功路径引用 try 内的 `rewritten`、离线 registry 被直接构造 URL；均已反馈 A，尚不当作修正通过。真实 Windows 新指纹矩阵、A/B adopt 联动与最终根 test 仍待执行。

## A 第二版固定交付：单测通过，真实消费者仍拒绝采用

- 固定头 `fc047103564fd8869953aa3e84afd547b7ea1a8e`，交接 Git bundle SHA-256 `f0b7a98f1e0d208b23621eaffbda248c47c5423cdbdc029af0cb321a16f9c4a3`。`git bundle verify` 通过，A 干净 Windows 工作树以 `--ff-only` 导入；C 使用 `77b95e3` 合入集成分支，尚未合 main。
- 显式配置 `A10_FROZEN_BUNDLE` 后，用固定 Windows Node 26.13.0 运行 `node --test tests/acceptance/t10-sdk/probe.test.mjs`：104/104、0 fail、0 skip，11.61s。随后根 `scripts/pnpm.ps1 test` 实际执行服务构建、104/104 Node 用例与 42 文件 719/719 Vitest，182.89s（Vitest），exit 0。日志 `.tools/a-t10-final-windows-unit-2026-11-14.log`、`.tools/c-final-integrated-test-2026-11-14.log`。
- 使用编译后的真实 CLI 执行 `echarts verify --version 6.1.0 --consumer-root <本次独占外部且带空格的新目录> --keep --out test-results/t10-sdk-probes/windows-final-initial --label windows-final-initial --json`，产生两框架共 56 次运行。类型/构建/SSR/运行/交互通过、无视觉基线保持 not-run；但消费者 lock 的 ECharts 条目没有 `resolved` / `integrity`，CLI 以 `CANDIDATE_INTEGRITY_UNVERIFIED`、exit 1 拒绝，探针自身 exit 0。**本轮不是干净消费者验收通过，也不是期望的纯视觉 PROBE_HOLD。**
- 定位为 `cp(exampleDir, ...)` 未排除 Windows 示例目录中已有的 `node_modules`、`dist` 和 `.turbo`，使本地依赖状态进入外部消费者。已向 A 派发复制边界和 dirty-source 回归；另两项独立复核问题为显式 `--font-digest` 被实测值覆盖、宿主缺失时空环境投影崩溃。须在下一固定头上复验，不能用当前单测通过掩盖此失败。
- 首轮错误报告、56 张截图及两份 lock 诊断副本保留在 ignored 本地证据；未改报告。独立审计器亦 exit 1 拒绝该证据。失败消费者仅在核对随机运行 ID、双份 ownership marker、真实路径、直接父子关系及完整双消费者集合后清理，未触碰其它工作树。
- C 本地审计/回退辅助工具的两项审查问题已修：全部类型检查必须成功且四维完整；adopt 的 failures 必须为空；清理必须证明本次运行所有权。独立反例中，三项原审计反例及空 checks/click、visual DIFF 均拒绝，10 项路径/marker/junction 反例拒绝；清理采用 mock 删除接口，合法集合仅安排两个 staging 与一个父目录，第二消费者非法时安排删除数为 0。辅助工具本身不替代真实锁文件恢复实跑。

## C 证据审计与回退工具进入永久回归

- 将已独立审查的本地工具纳入 `scripts/audit-t10-evidence.mjs`、`scripts/t10-consumer-ownership.mjs` 与 `scripts/verify-t10-rollback.mjs`；新增 [Windows 复现步骤](t10-windows-local-procedure.md)。脚本使用 contracts 的包名与 exports，未复制协议实现，也不修改冻结包。
- 新增 `tests/unit/t10-evidence.test.mjs`：完整双框架 56-run 的 adopt/hold 控制、6 项畸形证据、10 项路径/marker/junction 反例，以及两种 mock 清理调度，共 21 项。只有测试自建 fixture 会真实删除；测试中的报告路径不进入真实递归删除接口。
- `test:t10` 先构建 contracts，再运行 A 与 C 的 Node 回归；根 `test` 仍先构建服务，所有测试不进 Turbo 缓存。显式配置权威 `A10_FROZEN_BUNDLE` 后，`scripts/pnpm.ps1 test:t10` 实际通过 125/125、0 fail、0 skip、11.04s，exit 0；C 新文件单独执行 21/21、0 skip、exit 0。
- 当前测试只证明工具对控制输入与反例的行为；真实 Windows 干净消费者、显式基线复验、6.0.0 候选和原双消费者回退仍等 A 下一固定头后执行。没有用 fixture 通过替代上述验收。
- 本批根 `scripts/pnpm.ps1 test` 已完整读回 exit 0：Node 125/125、0 skip；Vitest 42 文件、719/719、203.10s。运行中出现既有 Windows 子进程 `DEP0190` 警告，没有将警告写成“零告警”。日志 `.tools/c-t10-audit-integration-test-2026-11-14.log`；独立入口最终配置另跑通过，日志 `.tools/c-t10-permanent-entry-2026-11-14.log`。三工具语法检查及 `git diff --check` exit 0。纯测试与复现文档不单独升版。

## A 第四版与官方源 Windows 真实验收

- A 固定头 `faf0a6485c71d865230e98384237ab27dc2dcfcf`，新目录 bundle SHA-256 `c4ce277b4c7bacdfdb4e5a895912f22a9860d5c99d2f00a68b819b433a3b9d8a`，摘要与 `git bundle verify` 均通过。相对第三版仅将脏源哨兵路径断言改为 `path.join`；Windows 固定 Node、权威冻结材料下 115/115、0 skip、exit 0，6.21s。日志 `.tools/a-t10-r4-windows-unit-2026-11-14.log`。C 以 `bfa34f3` 合入。
- 新干净消费者的第一轮仍以 `CANDIDATE_INTEGRITY_UNVERIFIED` 拒绝：这次不是复制污染，而是本机 npm 配置将包下载到 `registry.npmmirror.com`，候选元数据来自 `registry.npmjs.org/echarts`，锁文件来源主机不一致。报告保留为 `test-results/t10-sdk-probes/windows-clean-initial/`，两个消费者经完整 ownership 验证后清理，没有绕过来源闸门。
- 后续仅对验收进程设置 `npm_config_registry=https://registry.npmjs.org`，不改用户全局配置。`--registry` 是包元数据端点，不能误传 registry 根地址；一次根地址误传被 `UNKNOWN_VERSION` 拒绝，尚未创建消费者，诊断另存 `.tools/c-cli-invalid-registry-endpoint-2026-11-14.*`。[复现步骤](t10-windows-local-procedure.md) 已补充两层配置的区别。
- 首轮真实 CLI：`component echarts verify --bundle <同一冻结目录> --version 6.1.0 --registry https://registry.npmjs.org/echarts --consumer-root <随机独占外部目录> --keep --out test-results/t10-sdk-probes/windows-official-initial --label windows-official-initial --json`。两框架各 28 次运行，类型、构建、SSR、生命周期、运行与交互通过；候选来源两者 verified，视觉无基线为 not-run，CLI exit 1 / `PROBE_HOLD`。独立 `audit-t10-evidence.mjs <首轮报告> hold 56` exit 0，重算 56 个环境键和截图摘要；两份 contact sheet 已实际查看。
- 显式传 `--baseline <首轮报告>`，以全新消费者执行 `windows-official-visual`，CLI exit 0、recommendation `adopt`、uncovered 空、四维全过、56/56 视觉 PASS。独立 `audit-t10-evidence.mjs <复验报告> adopt 56` exit 0。第二轮消费者已自动清理；没有重新 pack 或更换 SDK tarball。
- ECharts 6.0.0 的默认 strict 与显式 strict-only 都实际以 npm ERESOLVE / `PROBE_PEER_REJECTED` 拒绝，探针及 CLI exit 1，未自动 legacy。显式 `--peer legacy --baseline <首轮报告>` 才执行双框架 56 次测量：构建、SSR、运行、交互及 56 张视觉对比通过，但两框架 Bundler / NodeNext 类型均失败（TS1203、TS2305 等），peer 不匹配，因此 CLI exit 1 / `PROBE_HOLD`，未扩大兼容范围。独立本地审计重算 56 个环境键、实测字体及截图摘要，并确认该失败结论；报告在 `windows-600-legacy/`，审计摘要 `.tools/c-t10-legacy-independent-audit-2026-11-14.json`。

## 原消费者回退发现的生成代码类型阻断

- 用 `windows-official-initial` **原来的两份保留消费者**执行 `verify-t10-rollback.mjs <首轮报告> test-results/t10-sdk-probes/windows-original-pair-rollback <ownership 文件>`。两个消费者确实从 6.1.0 改到 6.0.0、显式 legacy 安装并构建，再恢复原 manifest / lock 字节并严格 `npm ci` 回到 6.1.0；清单与锁 SHA 均完全恢复。
- 但是恢复后的类型复检失败：`src/a-t10-echarts-registry.ts:9` 把 `document.querySelector()` 返回的 `Element` 传入要求 `HTMLElement` 的 `getInstanceByDom`，Vue 报 TS2345、React 报 TS2740。此文件由 `browser.mjs` 注入，而初轮类型检查先于注入，所以先前类型结果没有覆盖它。**回退脚本 exit 1，证据 `passed: false`，不得记回退完成。**
- 原失败证据和清单/锁副本保留；两个自有临时消费者已按 ownership 安全清理。已派 A 仅修生成 helper 的宿主类型、补生成后真实类型回归并提供新固定交付，随后 C 必须用新首轮的原消费者再演练，不能用新建恢复消费者替代。Task 3 与本轮 main 合并仍未完成。
- 本轮只读审查对 `bfa34f3` 未发现 Critical / Important，11 项新 A 回归与 21 项 C 回归独立通过。该短测不代替真实回退；新发现阻断按上条返修。平台隔离代码相对本轮 main 未变，先前独立 88/88 验证仍保留，不从短测推断外部 G2 已完成。

## A 第五版固定交付与 C 编译器回归收口

- A 固定头 `c42dcc7c4324c79f34a0829710c5f700f6c3a8cf`，交接 bundle SHA-256 `faf5287b390f71ba568380e1f745695a5530223ddb432b1b0a8c10249163cce7`。摘要、`git bundle verify` 和 Windows 干净工作树快进导入均通过；C 以 `3d0dcf1` 合入。生成注册表先检查 `element instanceof HTMLElement` 再调用 ECharts，避免用类型断言掩盖实际宿主类型。
- Windows 独立 `node --test tests/acceptance/t10-sdk/probe.test.mjs`：117/117、0 fail、0 skip、35.29s、exit 0；日志 `.tools/a-t10-r5-windows-unit-2026-11-14.log`。新增回归覆盖注入后的辅助文件，不再只检查注入前消费者。
- C 进一步发现新增测试 helper 无条件使用 `vue-tsc`，React 消费者并未声明该工具，`npm exec` 可能隐式下载。已从 Claude UI 通知 A 冻结固定头并由 C 临时接管该测试文件。先加入本地声明/安装版本/编译器入口校验，实测 RED：`react: 编译器 vue-tsc 必须由消费者精确声明`；随后按框架选择本地 `vue-tsc` / `typescript` 的 `tsc`，直接用当前 Node 执行本地 bin，禁止隐式 npx 安装。
- `scripts/pnpm.ps1 test:t10`：138/138、0 fail、0 skip、18.17s、exit 0；`git diff --check` exit 0。RED/GREEN 日志分别为 `.tools/c-registry-compiler-red-2026-11-14.log` 与 `.tools/c-registry-compiler-green-2026-11-14.log`。纯测试修正不单独升版。
- 最终集成树 `scripts/pnpm.ps1 test` 完整执行服务构建、Node 138/138（0 fail、0 skip、21.18s）及 Vitest 42 文件 719/719（184.45s），exit 0；日志 `.tools/c-r5-final-root-test-2026-11-14.log`。仍有既有 Windows 子进程 `DEP0190` 警告，未宣称零告警。

## 最终固定源码 Windows 真实复验（r5）

以下结果均在 A 第五版和 C 编译器测试修正后的集成树上执行。仍使用原冻结 SDK 0.0.10，不修改 peer、不重新 pack、不写线上兼容记录；仅验收进程设置官方 npm 下载源。

| 实际命令/场景 | 结果与独立证据 |
| --- | --- |
| 6.1.0 首轮：`component echarts verify --bundle <冻结目录> --version 6.1.0 --consumer-root <本次随机独占目录> --keep --out test-results/t10-sdk-probes/windows-r5-initial --label windows-r5-initial --json` | CLI exit 1 / `PROBE_HOLD`；两框架各 28 组合，类型/构建/SSR/生命周期/运行/交互通过，候选来源均 verified，视觉 not-run。`audit-t10-evidence.mjs <首轮报告> hold 56` exit 0；两框架 contact sheet 已实际查看。 |
| 6.1.0 全新消费者：显式 `--baseline <r5 首轮报告> --out test-results/t10-sdk-probes/windows-r5-visual --label windows-r5-visual` | CLI exit 0 / `adopt`，uncovered 空、四维全过、56/56 视觉 PASS。独立 `audit-t10-evidence.mjs <复验报告> adopt 56` exit 0，重算 56 个环境键及截图 SHA；复验消费者自动清理。 |
| 6.0.0 默认 strict 与显式 `--peer strict-only` | 两次真实安装均 npm ERESOLVE / `PROBE_PEER_REJECTED`；CLI `PROBE_FAILED`，CLI 与 probe 均 exit 1，没有自动放宽。日志 `.tools/c-cli-r5-600-default-2026-11-14.*` 与 `strict-only`。 |
| 6.0.0 显式 `--peer legacy --baseline <r5 首轮报告>` | 完整双框架 56 组合；构建/SSR/生命周期/运行/交互与视觉均通过，但两框架 Bundler/NodeNext 类型失败，peer 不符，CLI exit 1 / `PROBE_HOLD`。独立审计重算 56 个环境键、字体与截图 SHA，确认 typecheck failed / 其余三维 passed、supportedRangeUnchanged true；摘要 `.tools/c-t10-r5-legacy-independent-audit-2026-11-14.json`，报告 `windows-r5-600-legacy/`。不扩大支持范围。 |
| `node scripts/verify-t10-rollback.mjs <r5 首轮报告> test-results/t10-sdk-probes/windows-r5-original-pair-rollback .tools/c-t10-r5-owned-root.json` | 使用首轮保留的原双消费者，6.1.0 → 6.0.0 legacy 安装/构建 → 恢复原 manifest/lock 字节 → 严格 `npm ci` 回 6.1.0。两消费者 SDK 实际版本 0.0.10，4 组类型检查、构建与无 DOM 的 SSR 导入全通过，manifest/lock SHA 完全恢复，errors 空、cleaned true、`passed: true`，脚本 exit 0。日志 `.tools/c-r5-original-pair-rollback-2026-11-14.log`。 |

回退使用的 ownership run ID 为 `6d49c39cb6f8354b86e6ff768cdad16f`。只在完整校验双 marker、真实路径、双 staging 集合及无额外条目后清理这两个消费者；原始失败记录没有被覆盖，不能把最终成功倒填为旧回退已通过。

最终审计 `.tools/c-r5-final-invariants-2026-11-14.json`：冻结 199 文件 / 14 实现，大小和 SHA 差异 0；原架构 SHA 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`；锁文件 SHA 仍为 `8001977F7DC87FE10E5683B4156B9BCF716EA90F865B6904DF857A3B687BC9D7`。A 工作树干净，B 四项原有空白差异保留，未推送。

## 最终应用构建与浏览器检查的覆盖范围

- 在 `3480f31` 实际执行 `install --frozen-lockfile`、`verify:workspace`，均 exit 0，锁文件未变。`exec turbo run build typecheck --cache=local:w` 为 20/20、0 cached、14.086s，根 `tsc --noEmit` exit 0。日志 `.tools/c-merge-ready-install-2026-11-14.log`、`c-merge-ready-workspace-2026-11-14.log`、`c-merge-ready-build-type-2026-11-14.log`、`c-merge-ready-root-tsc-2026-11-14.log`。
- 同一阶段完成 `scripts/pnpm.ps1 test:browser`：195/195、1.3m、exit 0，含 6 项真实三存储网页发布/断网恢复；自有设施已 teardown，5173–5176 无监听。日志 `.tools/c-merge-ready-browser-2026-11-14.log`。最初一条无效 Turbo cache flags 及一条 PowerShell 参数绑定失败均保留诊断，改正后实际执行的结果才计为通过。
- 后续 A 第五版只改探针 `.mjs`、其回归和独立记录；C 仅收口测试 helper，应用与包构建源、浏览器套件被测源码未变。195 项结果按这一精确范围沿用；探针运行时改变则已由上述 r5 全新消费者矩阵及原 pair 回退重新实测，不以应用浏览器测试替代。

## 工程裁决与代价

1. 平台专项使用 Vitest globalSetup 内存 provide/inject；无设施即失败，不回退共享凭据。代价：环境不适配时须修专项设施，不能借共享栈绕过。
2. 镜像登记先写完整同盘临时文件再以无覆盖硬链接发布，避免 `wx` 暴露半文件。代价：要求文件系统支持该原子发布方式；不支持应明确失败。
3. 独立 `test:t10` 先构建 contracts，使用包 exports。代价：根 test 重复一次轻量构建。
4. 只对验收进程统一官方 npm 下载源，保留来源不一致拒绝，不改全局。代价：每次复现需显式环境配置。
5. C 临时接管 A 新测试 helper，按消费者精确声明的本地编译器检查。代价：新增安装后版本/入口校验，失配会明确失败。
6. 平台 88/88 与应用浏览器 195/195 按未变源码的覆盖范围沿用，最终探针矩阵和真实回退由 C 重跑。代价：这些结果不能外推为公司 OIDC、生产域/TLS 或业务试点已完成。
