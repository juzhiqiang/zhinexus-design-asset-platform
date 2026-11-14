# A 侧交付：T10 探针随 CLI 分发的完整运行材料

日期：2026-11-14（当日续修，版本 r2）。负责人：A（SDK）。分支：`feat/a-probe-distribution`，基线 `bea8d3f912115791a322a3448e13797dcf4e92ad`。

本文是 A 本轮「把 T10 探针做成可随 CLI 发布的完整运行材料」的**接口契约、资源清单、调用方式与实测证据**。
探针本身的四维口径、`environmentKey` 定义与兼容判据见
[a-t10-probes-next-2026-11-13.md](./a-t10-probes-next-2026-11-13.md)，本文不重复。

> **r2 修订**：C 对上一版（`5a9af87`）独立复核出 5 项已复现问题（2 项 P1、3 项 P2），
> 外加 1 项接口补充，本文第五～十节逐项记录修复与证据。第一节至第四节中与新行为
> 冲突的描述已按 r2 实际行为改写。

## 一、本轮要解决什么问题

探针原先只活在源码仓库里：`probe.mjs` 里写死 `REPO_ROOT = HERE/../../..`，
`examples/`、`tsconfig.base.json`、默认输出目录全部按仓库布局推导。这意味着

- 用户装了 `@company/component-cli` 之后**没有办法在自己机器上跑兼容探针**；
- 探针不可能进入任何分发链路（本地 CLI 命令、CI、双项目试点验收）。

本轮把探针连同它需要的模板与配置打成一份**白名单明确的运行材料**，装到
`packages/component-cli/dist/probe/`，并让同一份 `probe.mjs` 在仓库内与安装后都能跑。

## 二、产物布局与资源清单

```
packages/component-cli/dist/probe/
├── probe.mjs               ← 入口（B 侧默认入口接线指向这里）
├── environment.mjs         环境投影与 environmentKey 参考实现
├── bundle.mjs              冻结 bundle 只读读取与摘要校验
├── policy.mjs              从冻结 tarball 动态加载兼容策略
├── consumer.mjs            工作区外干净消费者（复制/改写/安装/类型/构建/SSR）
├── browser.mjs             固定环境浏览器探针
├── evidence.mjs            四维结论装配与未覆盖项收集
├── probe.test.mjs          探针单测（随包分发，安装后也能自检）
├── probe-manifest.json     逐文件 sha256 + 字节数 + 入口 + 资源根
└── resources/
    ├── examples/vue/       ← examples/vue 全量源码（html/src/tsconfig/vite.config/package.json）
    ├── examples/react/     ← examples/react 全量源码
    ├── examples/fixtures/  ← 7 个组件的 fixtures JSON
    └── tsconfig.base.json  ← 各示例 tsconfig 的 extends 目标
```

**为什么必须保留 `resources/examples/<framework>` 与 `resources/examples/fixtures` 这对兄弟关系**：
示例源码里写死了两条相对路径——`src/App.vue` 用 `../../fixtures/line.json`，
各示例 `tsconfig.json` extends `../../tsconfig.base.json`。因此打包时不能把 fixtures
单独挪去别处，也不能把 tsconfig.base.json 放到 `resources/examples/` 之外，
否则复制到工作区外之后这两条路径立刻断链。

打包脚本按**逐文件白名单**复制，实测 **73 个文件 / 397,979 字节**（字节数随模板源码变化，
以当次 `--check` 输出为准）。

### 2.1 白名单是逐文件的，不是目录级的

进包的每一项都显式列出：`PROBE_MODULES`（8 个探针模块）、
`PROBE_TEMPLATE_FILES.vue` / `.react`（各 31 / 27 个模板文件）、
`PROBE_FIXTURE_FILES`（7 个 fixtures）、`tsconfig.base.json`。
规则是**双向**的：

- 白名单内的文件缺失 → 失败并点名缺的是谁；
- 白名单之外的文件出现 → 失败并点名，**不静默跳过、也不靠扩黑名单**。

`PROBE_DIR_NOT_SHIPPED`（当前只有 `package-probe.test.mjs`）是唯一一条
"同目录但不分发"的显式声明——它测的是打包脚本自己，而脚本不在分发物里。

### 2.2 本机构建状态是一份封闭名单，且不参与放行判断

`KNOWN_LOCAL_STATE`（`node_modules`/`dist`/`.turbo`/`.git`/`coverage`/
`test-results`/`playwright-report`/`.release`/`.cache`/`.vite`/`.pnpm-store`）
与 `KNOWN_LOCAL_STATE_FILE_PATTERNS`（`*.tsbuildinfo`、`.eslintcache`）
只回答一个次要问题：「遍历到的东西是不是本机刚构建出来的」。是就整体跳过；
不是、也不在白名单里，就报错。因此**往 examples 里丢一个陌生文件不会被悄悄放行**，
也不会诱导人往这份名单里加规则。刻意不含 `npm-debug.log`、`.env`、
`credentials.json`——那些要么可能带敏感内容，要么说明有人往源码树里丢了不该丢的东西，
必须让人看见。

## 三、调用契约

### 3.1 打包（在仓库根执行，A 侧脚本）

```bash
node packages/component-cli/scripts/package-probe.mjs              # 打包
node packages/component-cli/scripts/package-probe.mjs --check      # 只复核已有产物
node packages/component-cli/scripts/package-probe.mjs --out <dir>  # 指定输出目录
```

`--check` 输出六项判据：清单文件数、实际文件数、缺失、清单外、污染、链接、**被改动**。
任一项非零即退出码 1。建议 B 侧把它接进 CLI 的构建后自检与 CI。

`--out` 在**删除任何东西之前**要过闸门（见 5.1），三种情况一律拒绝：

| 情况 | 行为 |
| --- | --- |
| `--out` 覆盖任一打包源路径（`--out .`、`--out examples`、`--out tests`…） | `PROBE_INPUT`，退出码 1 |
| `--out` 自身是符号链接 / Junction | `PROBE_INPUT`，退出码 1 |
| `--out` 是非空目录且没有 `probe-manifest.json` | `PROBE_INPUT`，退出码 1（不删别人的数据） |

### 3.2 运行（安装后，任意 cwd）

```bash
node <安装目录>/dist/probe/probe.mjs --bundle <冻结 bundle 目录> [选项]
```

完整选项见 `--help`。与仓库形态**完全一致**，没有第二个入口、第二套参数。
相对仓库形态唯二的行为差异：

| 项 | 仓库形态 | 安装形态 |
| --- | --- | --- |
| 资源根 | 仓库根 | `<安装目录>/dist/probe/resources` |
| 默认输出 | 调用者 cwd 下 `test-results/t10-sdk-probes/<UTC 时间戳>` | 同左；**cwd 在安装包内时改道到系统临时目录**并打印原因（见 6.3） |

证据 JSON 的 `probe` 块新增字段用于区分形态与留痕裁决，便于审核方复核「这证据到底是谁产出的」：
`entry`（相对安装根的入口路径）、`resourceRoot`、`installRoot`、`packageRoot`、
`packaged`、`outputSubstituted`、`outputSubstitutionReason`。

### 3.4 给 B 的字段约定：`candidate.consumerSources`

B 侧要交叉校验安装完整性，因此每一行除 `framework`/`verified`/`reason`/
`resolved`/`version` 外，还带 **`integrity`**：

```json
"consumerSources": [
  {
    "framework": "vue",
    "verified": true,
    "reason": null,
    "resolved": "https://registry.npmjs.org/echarts/-/echarts-6.1.0.tgz",
    "version": "6.1.0",
    "integrity": "sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA=="
  }
]
```

取值**只能**来自 `verifyConsumerCandidateSource()` 读回的那条
`package-lock.json` 记录，**不从顶层候选声明抄**——顶层那个值是 registry 的
`dist.integrity`，「注册表声称的字节」与「消费者实际装进的字节」是两件事，
抄过来就等于没校验。三个推论：

- 锁与 registry 不一致时，带出的仍是**锁里的真值**且 `verified:false`
  （差异正是最该被发现的，不能被抹掉）；
- 核对跳过（离线 / 候选未经 registry 声明）时没有锁记录，`integrity` 为 `null`，
  不用顶层值填一个"看起来核对过"的空洞；
- 字段集合固定为 6 个，B 侧可按字段名直接取值。

### 3.3 给 B 的接线约定

B 负责 `packages/component-cli` 的 `package.json` / `build` / `files` / `bin` 与默认入口。
A 侧需要 B 满足的约定：

1. `files` 必须包含 `dist`（已含 `dist/probe`）；打包脚本产物不另出新目录。
2. **运行依赖 `@playwright/test` 精确 `1.65.0`**（已约定）。探针用 `await import('@playwright/test')`
   惰性加载，`--skip-browser` 时完全不碰它；但缺它时**明确失败**，不静默降级。
3. 若 B 想提供 `component probe` 之类的默认入口，请转调
   `dist/probe/probe.mjs` 并原样透传参数，不要在 CLI 里再造一套参数解析。
4. 建议在 CLI `build` 之后追加 `node scripts/package-probe.mjs`，并在发布前跑一次
   `--check`（摘要核对能发现 dist 被污染或篡改）。

## 四、缺少依赖/浏览器时的诊断

两种形态给不同处方——安装形态下根本没有仓库，让用户"去仓库根 pnpm install"是错的方向：

| 形态 | 诊断文案要点 |
| --- | --- |
| 仓库形态 | 请在仓库根执行 `pnpm install`（`@playwright/test` 是根 devDependency，精确 1.65.0） |
| 安装形态 | 确认 `@company/component-cli` 依赖闭包含 `@playwright/test@1.65.0`；执行 `npx playwright install chromium` 或设置 `PLAYWRIGHT_BROWSERS_PATH`；只想跑类型/构建/SSR 请显式 `--skip-browser` |

另外：资源缺失（打包漏了 `resources/`）时 `resolveProbeLayout()` 抛
`PROBE_INPUT` 并直接指出 `resources/` 与重新打包的命令，不会崩在半路。

## 五、r2：C 复核出的五项缺陷与修复

上一版（`5a9af87`）被 C 独立复核出 **5 项已复现问题**（2 项 P1、3 项 P2），外加 1 项
接口补充。逐项先 RED 后 GREEN，危险反例只在**自己创建的临时树**里验。

### 5.1 P1-① `rm(out, recursive)` 无条件执行

**缺陷**：`packageProbe()` 里 `await rm(root, { recursive: true, force: true })` 没有任何前置判断。
`--out .`（即 `out = repoRoot`）时源文件与哨兵全被删掉。

**修复**：新增 `checkOutputDirSafety()`，删除前三判，缺一不可：

1. `out` 不是文件系统根、不是符号链接/Junction（`rm` 对链接只摘链，但链接指向哪不可信）；
2. `out` 与任一**源路径**（文件本身 + 它到 `repoRoot` 之前的每一级祖先目录）既不能互相包含——
   `out` 覆盖源目录会连源一起删，`out` 落在源目录里会把源弄脏。在**真实路径**层面判，
   `..` 折返与链接绕法都现形（`resolveRealPath()` 对不存在的路径先解析到最近已存在祖先）；
3. 目录**可证明是本脚本自己的产物**：不存在、空目录、或带着本脚本写的
   `probe-manifest.json`。来历不明的非空目录一律不删——宁可让人手动确认，
   也不能把别人的数据当成构建残留删掉。

另外：先落一份 `complete: false` 的占位清单再复制。这样中断的下一次跑仍能认领这个目录，
且 `--check` 会报「清单未标记为已完成」而不是把它当成完整产物。

### 5.2 P1-② 实际是整个 examples 递归黑名单拷贝

**缺陷**：`collectProbeResources()` 对 `examples/<framework>` 整目录递归拷贝，只靠黑名单挡。
临时加入 `.envrc`、`credentials.json`、`npm-debug.log`、`src/generated.js` 全被复制且 `ok:true`。

**修复**：改为逐文件显式白名单（见 2.1），双向判据——缺一个失败、多一个也失败并点名。
本机构建状态是一份封闭名单（见 2.2），只回答"是不是本机刚构建出来的"，不参与放行判断。

### 5.3 P2-① 复核调用带排除过滤的 `listFiles`

**缺陷**：`verifyProbeBundle()` 复用带 `isExcluded` 过滤的枚举，污染全被漏掉。往产物里追加
`.env`、`node_modules/extra/index.js`、`dist/residue.js` 后 `--check` 仍 `ok:true`。

**修复**：改为 `enumerateArtifact()` **无过滤枚举**（普通文件 + 符号链接，链接不跟进）。
复核既然要证明"产物干净"，枚举就不能替它决定什么不算脏。清单外 / 污染 / 链接全部检出，
`--check` 输出补「链接」一项并修正实际文件数。

### 5.4 P2-② `--out` 未验证，"先写后报拒绝"

**缺陷**：`probe.mjs` 的 `--out` 到很后面才 `path.resolve`，而 `loadFrozenPolicy()` 早就往
`--consumer-root` 里建好目录了；消费者根更要等到 `createConsumer()` 才被拒。
「先写后报拒绝」等于拒绝没发生。

**修复**：新增 `resolveOutputDir()`，`main()` 在做任何 `mkdir` / 解包 / 建 staging **之前**
就统一校验 `out` 与 `consumer-root`：

- 显式 `--out` 落在只读边界内 → 抛 `PROBE_INPUT`，一个字节都不写；
- 默认输出因 **cwd 在安装包内**而落进边界 → 改道到系统临时目录，打印原因并在证据 JSON 留痕
  （`outputSubstituted` / `outputSubstitutionReason`）。这是默认值不是用户请求，为它报错太苛，
  但绝不能顺理成章写进安装包。

同时把只读边界从 `dist/probe` 扩大到**整个已安装包**（`nearestPackageRoot()` 找最近带
`package.json` 的祖先）：往 `dist/other` 或 `lib/` 里写消费者一样污染安装目录，
而那份污染不会被 `dist/probe` 的清单复核发现。仓库形态下边界就是仓库根本身，行为不变。

### 5.5 P2-③ 随包 `probe.test.mjs` 写死仓库布局

**缺陷**：随包分发的 `probe.test.mjs` 仍用 `HERE/../../..` 与 `examples/fixtures`。
外部安装跑 `node --test --test-name-pattern fixture <installed>/dist/probe/probe.test.mjs`
是 **0 pass / 2 ENOENT**，而同一份文件在源码树里是 2 pass——"随包自检"名不副实。

**修复**：所有资源位置都从 `resolveProbeLayout()` 推导（`installRoot` / `examplesDir` /
`fixturesDir`），两种形态一套代码。

**顺带发现一个坑**：外层 `node:test` 会把 `NODE_TEST_CONTEXT=child-v8` 带进子进程环境，
内层 `node --test` 见到它就认为自己是"被父运行器接管的子进程"，于是把 reporter 输出
**整份吞掉**——stdout 是空串、退出码却是 0。自检用例必须显式删掉这个变量，
否则永远拿不到证据，而且看起来像"静悄悄通过了"。

### 5.6 接口补充：`candidate.consumerSources[].integrity`

B 侧要交叉校验安装完整性，但原先每行只有 `verified`/`reason`/`resolved`/`version`，
没有摘要可校验。新增 `integrity` 字段，取值只能是 `verifyConsumerCandidateSource()`
读回的那条 `package-lock.json` 记录，**不从顶层候选声明抄**。详见 3.4。

## 六、实测证据（隔离 Linux 工具链，Node 26.13.0）

> 沙箱在本次会话中途被重置，隔离 Node / Playwright 浏览器 / `libXdamage` 全部丢失，
> 已按原方式重建（Node 26.13.0 官方 tarball 核对版本、`playwright-core` 官方安装器装
> chromium 1254 与 headless shell、从 Ubuntu jammy 取 `libXdamage1` 解出 `.so` 用
> `LD_LIBRARY_PATH` 指向）。环境差异见第九节。

### 6.1 单测

| 命令 | 结果 |
| --- | --- |
| `A10_FROZEN_BUNDLE=<冻结目录> node --test tests/acceptance/t10-sdk/probe.test.mjs` | **121 / 121 过，0 败，0 skip** |
| 同上但不配 `A10_FROZEN_BUNDLE` | 114 过 / 0 败 / 7 skip（6 例需冻结 bundle，1 例需充足磁盘） |
| `node --test tests/acceptance/t10-sdk/package-probe.test.mjs` | **22 / 22 过，0 败，0 skip** |

`package-probe.test.mjs` 的 22 例全部先红后绿：写测试时 14 例全败（`rm` 会真删源目录、
白名单不拦陌生文件、复核漏污染、`resolveOutputDir` 不存在、`packageRoot` 为 null…），
补齐实现后转绿。其中「改动安装包任何一个字节都必须被抓到」一例，是把
`consumer.mjs` 末尾加一行注释（文件照样能跑）后确认复核失败、恢复后重新通过。

### 6.2 真正的打包材料外部启动

把 `dist/probe` 放到仓库外、模拟已安装的 CLI 包
（`/tmp/a-t10-install-sim-r2/node_modules/@company/component-cli/dist/probe/`，
带真实 `package.json`，连同 B 约定的 `@playwright/test@1.65.0` 运行依赖），
从**任意 cwd** 启动：

```
cd /tmp/a-t10-cwd-r2
node /tmp/a-t10-install-sim-r2/node_modules/@company/component-cli/dist/probe/probe.mjs \
  --bundle <冻结目录> --echarts 6.1.0 --frameworks vue,react \
  --components bar,line --presentations light-canvas \
  --consumer-root "/tmp/a-t10-cwd-r2/consumers/not yet created" \
  --out /tmp/a-t10-cwd-r2/out --label install-external-r2
```

实测输出（双框架各自完整跑完四维，全程 43.9 秒）：

```
vue：  typecheck Bundler 0 / NodeNext 0 / build 0 / SSR 0（window=false document=false）
       浏览器 2 次运行，生命周期=passed，字体指纹实测 154d9215f759c969…（measured）
       四维 {"typecheck":"passed","runtime":"passed","interaction":"passed","visual":"not-run"}
react：typecheck Bundler 0 / NodeNext 0 / build 0 / SSR 0（window=false document=false）
       浏览器 2 次运行，生命周期=passed
       四维同上
```

`recommendation=hold dualFrameworkCoverage=false peerSatisfied=true` —— **因为只跑了 2 个组件的窄矩阵**，
不是缺陷。视觉维度 `not-run` 是因为没有基线，同样如实记录。
两个框架算出**同一个** `environmentKey`（`4db8e7266ec56e5e…`），
符合「被测框架版本与 ECharts 版本不计入 environmentKey」的契约。
证据块的 `probe.packaged=true`、`packageRoot=<安装包根>`、`entry=probe.mjs`。

### 6.3 安装包只读（摘要级证明）

**(a) 外部运行前后**，`--check` 全零：

| 时点 | 清单文件数 | 实际文件数 | 缺失 | 清单外 | 污染 | 链接 | 被改动 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 外部运行前 | 73 | 73 | 0 | 0 | 0 | 0 | 0 |
| 外部运行后 | 73 | 73 | 0 | 0 | 0 | 0 | 0 |

即：真实双框架安装 + 类型 + 构建 + SSR + 浏览器跑完之后，安装目录里 73 个文件
**一个字节都没变**。默认输出落在调用者 cwd，消费者建在 `--consumer-root` 指定的外部目录。

**(b) cwd 就在安装包内**时默认输出改道，实测：

```
[probe] 调用者 cwd（/tmp/a-t10-install-sim-r2/node_modules/@company/component-cli）位于安装包内部，
默认输出 …/component-cli/test-results/t10-sdk-probes/2026-11-14T16-14-54-569Z 会写进只读分发物，
已改道到 /tmp/t10-sdk-probes/2026-11-14T16-14-54-569Z。可用 --out 显式指定包外目录。
```

**(c) `--out` 落在安装包内**时先拒绝再写入，实测：

```
PROBE_INPUT --out …/component-cli/dist/other 位于只读分发边界 …/component-cli 内部。
安装包是只读分发物，往里写证据会污染安装目录；请把 --out 指到包外。
```

(b)(c) 之后安装包整体 sha256 快照前后一致（`05d9458063036b3e…`），一个字节都没写进去。

**(d) 追加污染后 `--check` 必须现形**（这正是上一版漏掉的那类）：

```
$ node packages/component-cli/scripts/package-probe.mjs --check --out <安装包>/dist/probe
  清单文件数：73
  实际文件数：76
  缺失：0
  清单外：3
  污染：3
  链接：0
  被改动：0
  结论：failed
  - 清单外文件：.env
  - 清单外文件：dist/residue.js
  - 清单外文件：node_modules/extra/index.js
  - 污染项：.env, dist/residue.js, node_modules/extra/index.js
```

清掉污染后恢复 `ok` / 退出码 0。

### 6.4 危险反例：`--out` 指到源码目录

在自建临时树（`/tmp/a-t10-danger-tree2`，白名单文件全部真实、另放哨兵文件）里逐个试：

| `--out` | 结果 |
| --- | --- |
| `.`（= 仓库根） | `PROBE_INPUT 输出目录 … 覆盖了打包源路径 …/tests/acceptance/t10-sdk/probe.mjs：删掉它会连源文件一起消失。` 退出码 1 |
| `./examples` / `examples/vue` | 同上，点名 `…/examples/vue/bar.html`。退出码 1 |
| `tests` / `tests/acceptance` / `tests/acceptance/t10-sdk` | 同上，点名 `…/probe.mjs`。退出码 1 |
| `..`（仓库父目录） | 同上。退出码 1 |
| `/` | `PROBE_INPUT 输出目录不能是文件系统根：/`。退出码 1 |

**源树 sha256 快照前后逐字节一致**（`fc5d5e7eb8a20954…`），哨兵文件仍在。
同一棵树上换安全 out（`packages/component-cli/dist/probe`）仍能正常打包 73 文件、复核 `ok`，
且二次打包会清掉上次残留——守卫不是一律拒绝。

### 6.5 `consumerSources[].integrity` 取自锁记录

**(a) 真实生成证据**：`--keep` 跑一次保留消费者，把证据里的 `integrity` 与消费者
`package-lock.json` 的 `node_modules/echarts` 条目逐字节比对：

```
证据  ：sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==
锁文件：sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==
✔ 逐字节相同
```

**(b) 证明不是从顶层候选声明抄的**：把保留的那个消费者的锁文件 integrity 改掉，
再走同一套真实函数：

```
核对 verified = false
核对 reason   = 锁里的 integrity 与 registry 不一致：锁=sha512-tampered000000000…，registry=sha512-q0yaFPggC9FUdsWH4…
证据行 integrity = sha512-tampered000000000000000000000000000000000000000000000000000000
registry 声明值  = sha512-q0yaFPggC9FUdsWH4…
✔ 带出的是锁里的真值，且判未通过——差异没被抹掉
```

单测里另有 4 例覆盖同一语义（含"核对跳过时必须是 null，不用顶层值填洞"、
"字段集合固定为 6 个"）。

### 6.6 消费者仍从同一冻结 tarball 安装

外部运行日志：`候选来源核对通过：echarts@6.1.0 ← https://registry.npmjs.org/echarts/-/echarts-6.1.0.tgz`。
三个 `@company/charts-*` 包由 `rewriteConsumerManifest` 从冻结 tarball 的 `file:` 路径装入，
不是工作区链接。上一轮修掉的脏源排除（`node_modules`/`dist`/`.turbo`/`.git`）继续生效。
冻结 SDK 0.0.10 三个包**未重打包、未改写**（摘要与上一轮一致：
`charts-core sha256=2d9d4208bf070f24… bytes=53524`、
`charts-vue sha256=b01aeec7604b2c39… bytes=6625`、
`charts-react sha256=cd625741f37a95f8… bytes=12052`）。

## 七、未验收项（诚实清单，均标 `pending`）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| Windows 原生全链路 | `pending` | 本轮只在隔离 Linux 工具链上跑过。**不把 Linux 证据宣称 Windows 验证。** C 将在 Windows 做独立安装 CLI 全链路 |
| Windows Junction 变体 | `pending` | 单测在 win32 上用 `mklink /J` 造 junction 覆盖；没有权限时如实 skip，不伪称通过 |
| B 侧接线 | `pending` | `package.json` / `build` / `files` / `bin` / 默认入口归 B，本文只给约定 |
| 完整 56 组合视觉 adopt | `pending` | 本轮只跑 2 组件窄矩阵；完整矩阵与基线比对沿用上一轮命令 |
| 候选差异与回退 | `pending` | 需新候选只能新目录新批次 |
| `compatibility_records` 落库 | `pending` | 真实三存储与 OIDC 不在本机可用范围 |
| 升版 | **未做** | `@company/component-cli` 版本号归 B/C 收口；A 不单独升版，避免与 B 的发布节奏冲突 |

## 八、改动范围

```
packages/component-cli/scripts/package-probe.mjs        白名单/删除闸门/无过滤复核
tests/acceptance/t10-sdk/package-probe.test.mjs         22 例 RED→GREEN
tests/acceptance/t10-sdk/probe.mjs                      resolveOutputDir/packageRoot/consumerSourceRecords
tests/acceptance/t10-sdk/consumer.mjs                   导出 resolveRealPath
tests/acceptance/t10-sdk/probe.test.mjs                 布局推导 + integrity 回归
tests/acceptance/t10-sdk/browser.mjs                    形态化诊断（沿用）
docs/verification/a-probe-distribution-2026-11-14.md    本文
```

**未触碰**：根 `package.json` / `pnpm-lock.yaml` / `packages/contracts` / `packages/charts-*` /
`examples/*` / `apps/*` / CLI 的 `src/` 与 `package.json`。
`tests/acceptance/t10-sdk/*.mjs` 与 `packages/component-cli/scripts/*.mjs` 都不在根
`tsconfig.json` 的 `include`（只收 `tests/**/*.ts`、`scripts/**/*.ts` 等），
因此不影响根 typecheck 门禁；该门禁由 C 实跑。

`packages/component-cli/dist/` 被 `.gitignore` 忽略，**不提交**，由构建时重新生成。

## 九、环境差异说明（隔离 Linux 工具链）

| 差异 | 处置 |
| --- | --- |
| 沙箱 Node 为 v22.23.4，仓库锁定 26.13.0 | 下载 Node 26.13.0 官方 tarball 解包到 `/tmp/t10tools/isolated/`，`PATH` 前置 |
| pnpm 不在锁定版本 | 干净消费者用 `npm install`（工作区外消费者，不参与仓库 pnpm 工作树）；npm 入口同时试 Windows 与 Linux 布局 |
| Playwright 浏览器未预装 | 用 `playwright-core/cli.js install` 官方安装器装 chromium 1254 与 headless shell（`PLAYWRIGHT_BROWSERS_PATH` 指向 `/tmp/t10tools/ms-playwright`） |
| 缺 `libXdamage.so.1` 且无 root/apt 权限 | 从 Ubuntu jammy 取 `libxdamage1` 的 `.deb`，用 Node 解 ar + `tar --zstd` 取出 `.so`，`LD_LIBRARY_PATH` 指向 |
| `/sessions` 剩余空间极小 | 所有重活放 `/tmp`；消费者暂存根命名 `a-t10-staging-*`，`removeConsumer` 只删这个前缀 |
| `TMPDIR` 指向小分区导致 ENOSPC | 显式设 `TMPDIR=/tmp` 与 `A10_CONSUMER_ROOT` |
| `node --test` 跑浏览器相关用例需要仓库 `node_modules` | 临时建 `node_modules` → `/tmp/t10deps/node_modules` 符号链接，**提交前删除**（`git status` 已核对干净） |
| 后台长跑被沙箱超时杀掉 | 探针完整双框架跑一遍只要 ~44 秒，直接前台跑；不要依赖 `&`/`nohup` 后台驻留 |

**以上差异只影响「在哪里跑」，不影响「测的是什么」**：被测物始终是同一份冻结 tarball，
环境差异全部进 `environmentKey`，跨环境不判视觉通过。
