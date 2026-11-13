# T10 SDK 侧兼容策略与第二候选实测记录

日期：2026-11-13。负责人：A（SDK）。分支：`feat/t10-sdk-compatibility`（基线 main `885792b`）。
任务定义见 [T10 实施计划](../superpowers/plans/2026-11-11-component-platform-implementation.md)。
策略与回退的完整说明见 [docs/echarts-upgrade.md](../echarts-upgrade.md)，本文只记录**实际执行的命令与结果**。

## 一、执行环境

Linux 复现环境（非 Windows 原生）：Node `26.13.0`、pnpm `12.18.0`、Vue `3.5.45`、React / ReactDOM `19.3.1`、ECharts `6.1.0`、TypeScript `7.0.2`、Vitest `5.1.0`、Playwright + Chromium headless shell。仓库为 `feat/t10-sdk-compatibility` 分支的独立 worktree，基线 `885792b`。

## 二、候选查证（不猜版本）

从官方 registry 元数据核实，未使用任何「我记得最新是几」的判断：

```
GET https://registry.npmjs.org/echarts/latest   → version: 6.1.0
GET https://registry.npmjs.org/echarts/6.0.0    → 存在，dist.integrity sha512-Tte/grDQ…
```

| 候选 | 来源 | zrender | 文件数 / 解包体积 | types 入口 |
| --- | --- | --- | --- | --- |
| `6.1.0` | 官方 `latest`，与仓库锁定基线同一版本 | `6.1.0` | 1347 / 60,297,703 | `types/dist/echarts.d.cts` |
| `6.0.0` | 官方源第二个实际可获取稳定版（同主线上一稳定版） | `6.0.0` | 1319 / 57,572,927 | `index.d.ts`（`export =`） |

结论：**官方 latest 与基线同版本，「无新上游版本」分支成立**。因此本轮只用当前精确版本验证了命令流程，跨版本升级矩阵未完成；第二候选 `6.0.0` 用于验证「版本差异处理」这条路走得通。

## 三、SDK 策略实现与测试（先红后绿）

新增 `packages/charts-core/src/engine/compatibility.ts` 并从 `charts-core` 根导出。红态证据：测试文件先于模块存在，`vitest run tests/unit/sdk-compatibility.test.ts` 报模块不存在（`no tests`）。

```
$ pnpm exec vitest run tests/unit/sdk-compatibility.test.ts
 ✓ tests/unit/sdk-compatibility.test.ts (20 tests) 7ms
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

20 例覆盖：版本字面量判定（只认 `x.y.z`，拒绝 `^`/`~`/`>=`/`6.x`/`6.1.*`/`*`/`latest`/缺段）、预发布识别（`-rc.1` 是、`+build` 不是）、数值段版本比较（`10.0.0 > 9.0.0`）、`resolveCandidate` 的五条拒绝路径（预发布 latest、显式预发布、非精确字面量、官方源不存在、缺 integrity）、peer 符合性（低于/高于基线都不符合）、失败候选不扩范围（`peerSatisfied=false`、`supportedRangeUnchanged=true`、`suggestedPeerRange` 未定义、`recommend='hold'`）、双框架覆盖缺失即 hold、未运行维度不计通过、视觉差异留痕、registry 代理与官方源差异。

实现期修过一处判定顺序：预发布检查必须早于「是否精确版本」检查，否则 `6.2.0-rc.1` 会先被「不是精确版本」拦下，给出误导性的失败原因。

## 四、隔离消费者实测（echarts 6.0.0）

### 4.1 冻结产物

探针执行时打包的是 `0.0.6`：

```
921bce480f578ac7e07400b947d1cb335f940da4b6bcdcc2aa9c4aa1d921f51c  48744  company-charts-core-0.0.6.tgz
4c3ff2dba5eba0c918e526887ead25c5b7436b403d94540df046094d0bd30945  12003  company-charts-react-0.0.6.tgz
90c70ce2f1d36fa1992887c0f513c09b04503595ec27be4d2770c9ebac3d4444   6621  company-charts-vue-0.0.6.tgz
```

其中 vue / react 两个摘要与 T09 第五批记录完全一致（探针执行时这两个包尚未升版）。core 的摘要相对 T09 记录变化，原因是新增了 `engine/compatibility.ts` 并导出。

任务收尾时三个图表包按发布约定同步升到 `0.0.7`（core 因新增公开 API；vue / react 因对 core 的精确依赖随动）。升版后的冻结产物：

```
e7cf6b21d422edd245cc2cd4ed5b8b973cba183d840145e806d70c1f4fae884d  48744  company-charts-core-0.0.7.tgz
b1ce0212acb46f7b9053d833c7a2a7763d7e0b7e3e70e4baef0fc947eea88aa1  12003  company-charts-react-0.0.7.tgz
654bda9c6b8401cef57e0e5feea2acc5905ed3efb28635061f2c0fd1b458b858   6621  company-charts-vue-0.0.7.tgz
```

**0.0.6 → 0.0.7 只改 `package.json`**：解包后逐文件比对，除 `package.json` 外三个包的其余内容完全一致（`diff -r --exclude=package.json` 无差异）；`package.json` 的差异为 2 行（core，仅版本号）与 4 行（vue / react，版本号 + core 精确依赖）。因此 4.3 节在 0.0.6 上取得的类型/运行/交互结论对 0.0.7 同样成立，不是重新假设而是已比对。

### 4.2 安装层：严格 peer 直接被拒

Vue 消费者（`@company/charts-vue` tarball + `echarts@6.0.0` + `vue@3.5.45`）：

```
$ npm install --no-audit --no-fund --loglevel=error
npm error code ERESOLVE
npm error Could not resolve dependency:
npm error peer echarts@"6.1.0" from @company/charts-vue@0.0.6
退出码=1
```

React 消费者（`@company/charts-react` tarball + `echarts@6.0.0` + `react@19.3.1`）：同样 `ERESOLVE`，`peer echarts@"6.1.0" from @company/charts-react@0.0.6`，退出码 1。

这是「候选失败不扩大 peer 范围」最硬的一层证据：**任何代码都不会跑起来**。

### 4.3 探针：绕过 peer 检查后到底能不能用

`npm install --legacy-peer-deps`（仅探针用，不改变 SDK 声明）后装到 `echarts 6.0.0` + `zrender 6.0.0`。

**类型维度**——探针源码用公开 API 消费全部 7 个组件，tsconfig 与仓库 `tsconfig.base.json` 同款设置：

```
$ ./node_modules/.bin/tsc -p tsconfig.json
vue  退出码=0
react 退出码=0
```

**运行与交互维度**——vite 构建后用 Playwright + Chromium 打开，逐容器统计画布、点击首柱读事件载荷：

| 组合 | Vue 3.5.45 | React 19.3.1 |
| --- | --- | --- |
| light + canvas | 7/7 组件各 1 个 canvas，`errors: []` | 7/7 组件各 1 个 canvas，`errors: []` |
| dark + svg | 7/7 组件各 1 个 svg、0 个 canvas，`errors: []` | 7/7 组件各 1 个 svg、0 个 canvas，`errors: []` |
| 点击首柱 | `{"seriesId":"b","dataIndex":0,"value":["A",30],"nativeType":"click"}` | 与 Vue 完全一致 |

**视觉维度：not-run**。没有 6.0.0 的截图基线，无法做视觉对比；按 `rules/testing-release.md`，预期视觉变化必须显式基线确认，不自动判过。

### 4.4 潜在脆弱点：skipLibCheck 掩盖的类型降级

`packages/charts-core/dist/types.d.ts` 从根入口 `'echarts'` 导入选项类型，并从 `'echarts/core.js'` 导入 `ComposeOption` / `EChartsType`。把探针的 `skipLibCheck` 关掉后：

```
echarts@6.0.0：
  node_modules/@company/charts-core/dist/types.d.ts(1,15): error TS2305:
    Module '"echarts/core.js"' has no exported member 'ComposeOption'.
  node_modules/@company/charts-core/dist/types.d.ts(2,15): error TS2305:
    Module '"echarts"' has no exported member 'BarSeriesOption'.
  …（GraphicComponentOption / GridComponentOption / LegendComponentOption 等同类错误）

echarts@6.1.0：
  无上述错误（只剩 ./LineChart.vue 之类与 echarts 无关的打包痕迹问题）
```

也就是说，在 `skipLibCheck: true` 下 6.0.0 会**通过**类型检查，但消费者的类型被静默降级。这是扩范围前必须先解决的问题，本轮未改动该导入路径（触及公开类型表面，需独立验证）。

## 五、结论

| 项 | 结论 |
| --- | --- |
| `recommend` | `hold`——不把 `peerDependencies.echarts` 扩到 `6.0.0` |
| 理由 | 候选低于基线（属回退非升级）；安装层被 `ERESOLVE` 拒绝；存在 4.4 节的类型静默降级 |
| 跨版本升级矩阵 | **未完成**。官方 latest 与基线同版本，无新上游版本可升 |
| 视觉基线 | **未确认**。6.0.0 无截图基线 |
| 工作区锁文件 | **未修改**。候选只在工作区外隔离目录验证，`pnpm-lock.yaml` 保持 echarts `6.1.0` |

## 六、升版 0.0.7 后的回归实测

版本号单独成提交（`bf0bfa1`）后重跑，确认 0.0.7 与 0.0.6 行为一致：

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/unit --test-timeout=60000` | 12 files / **191 passed** |
| `pnpm exec vitest run tests/integration/auth.test.ts tests/integration/platform-config.test.ts tests/integration/upload-validation.test.ts` | 3 files / **212 passed** |
| `pnpm exec vitest run tests/integration/release-registry.test.ts` | 1 file / **14 passed** |
| `pnpm exec vitest run tests/integration/packed-consumer.test.ts` | **1 passed**，但耗时 131s——见下方环境说明 |
| `pnpm exec vitest run tests/unit/sdk-compatibility.test.ts` | **20 passed** |
| `pnpm exec playwright test --config tests/playwright.config.ts presentation-matrix` | **56 passed** |
| `pnpm exec playwright test --config tests/playwright.config.ts core-lifecycle` | **11 passed** |
| `pnpm exec playwright test --config tests/playwright.config.ts component-matrix` | **96 passed** |
| `pnpm exec playwright test --config tests/playwright.config.ts framework-lifecycle bootstrap contracts-runtime capture-ready` | **11 passed** |
| `pnpm exec playwright test --config tests/playwright.config.ts gallery-rendering manual-release` | **11 passed** |
| `pnpm exec playwright test --config tests/playwright.config.ts`（全量） | **185 passed**（基线 122 + 新增 63） |
| `pnpm build` | **10 successful, 10 total** |
| `pnpm verify:workspace` | `Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.` |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 退出码 0，无错误 |

**`packed-consumer.test.ts` 的 60s 硬编码超时**：该用例把 `60_000` 作为 `it()` 的第三参数传入，`--test-timeout` 无法覆盖。Linux 复现环境的隔离消费者安装 + vite 构建 + Chromium 启动需要约 131s，因此在沙箱里必然超时。本次用「同目录临时副本放大超时后运行、跑完即删」的方式验证，**原文件未改动**（`git status` 干净）；结论是 0.0.7 的冻结 tarball 在工作区外干净消费者中导出、类型、SSR 导入、浏览器渲染与事件全部通过。Windows 上该用例在 60s 内通过（C 的 885792b 基线验收含 packed-consumer + cli-bundle 12 例），但在慢机器上这是个真实脆弱点，建议后续把超时改为常量或读环境变量——这属于共享测试文件调整，需 B/C 收口。

`cli-check.test.ts`、`cli-bundle.test.ts`、`cli-release.test.ts`、`packed-consumer-frameworks.test.ts` 在沙箱内单次超过 178s 的命令上限（`packed-consumer-frameworks` 的 `beforeAll` 就要为两个框架各做一次隔离安装），本轮未在 0.0.7 上整体重跑；这四个文件均不含版本字面量断言（`cli-check` 里的 `'0.0.1'` 是暂存目录名），升版不改变其判定输入。`cli-check` 的 `rejects`、`executes component check for vue`、`executes component check for react`、`tampered` 四条已在 0.0.6 上单独跑通。

## 八、独立评审复现的三处策略误判与修复（2026-11-13）

C 在固定 `f35ebc9` 上完成 `0.0.7` 的 Windows 原生复验后，独立评审对该 git 对象的 `compatibility.ts` 直接复现了三处误判，并明确「当前测试通过不视为策略已验收」。三处的共同点是**报告自称验证了某件事、实际验的是另一件事**，因此都足以让 `recommend` 在缺少实测的情况下返回 `'adopt'`。

### 8.1 复现（修复前，`f35ebc9`）

```
===== 缺陷①：探针收到基线版本，results 与 candidate 不一致 =====
candidate.version      = 6.0.0
probe 收到的 echarts   = 6.1.0, 6.1.0
results 的 echarts     = 6.1.0, 6.1.0

===== 缺陷②：覆盖判定只按 framework，漏框架版本 =====
supported 精确组合数   = 3 (Vue3.5.45, Vue3.4.0, React19.3.1)
results 条数           = 2          # reviewer 原述：只测了两项
hasDualFrameworkCoverage = true
recommend              = adopt      # 少验一个 Vue 3.4.0 却建议采纳

===== 缺陷③：基线取 supported[0]，混合基线随顺序翻转 =====
baselineEchartsVersion = 6.1.0 (取自 supported[0])
peerSatisfied          = true
recommend              = adopt
交换数组顺序后 baseline = 6.0.0 peerSatisfied = false recommend = hold
```

缺陷② 的四个变体（缺一条精确组合、框架版本写错、多出 `supported` 里没有的组合、任一侧重复）在修复前**全部**返回 `coverage=true` / `recommend=adopt`。

### 8.2 RED → GREEN

`tests/unit/sdk-compatibility.test.ts` 由 20 例增至 **33 例**，新增 13 例，其中 **11 例先红**（另 2 例描述的是修复后仍应成立的正向行为，修复前即通过）。红态证据：

```
$ pnpm exec vitest run tests/unit/sdk-compatibility.test.ts
 × 候选低于基线时，probe 收到候选 echartsVersion，实测行另行记录基线对照
 × 框架与框架版本取自基线，不随候选改写
 × 候选与基线同版本时，实测行与基线一致
 × supported 有三个精确组合而 results 只有两项时，不得判为完整覆盖
 × results 的框架版本与 supported 不一致时，不得判为完整覆盖
 × results 多出 supported 里没有的组合时，不得判为完整覆盖
 × supported 自身有重复组合时，不得判为完整覆盖
 × results 重复记录同一组合时，不得判为完整覆盖
 × 混合 echarts 基线直接拒绝，不静默取首项
 × 拒绝与数组顺序无关
 × 候选 6.0.0 配混合基线同样拒绝，不因候选与其中一项相同就放行
AssertionError: expected [ '6.1.0', '6.1.0' ] to deeply equal [ '6.0.0', '6.0.0' ]
AssertionError: expected true to be false
AssertionError: promise resolved "{ candidate: { …(4) }, …(5) }" instead of rejecting
 Tests  11 failed | 22 passed (33)
```

修复后：

```
$ pnpm exec vitest run tests/unit/sdk-compatibility.test.ts
 Test Files  1 passed (1)
      Tests  33 passed (33)
```

### 8.3 修复后的逐条断言（17 项全 PASS）

用与 8.1 相同的输入重跑，并补足缺陷② 的四个变体与「不扩 peer」回归：

```
--- ① 探针收到候选版本 ---
PASS  probe 收到 6.0.0 而非基线 6.1.0
PASS  results.echartsVersion = 候选 6.0.0
PASS  results.baselineEchartsVersion = 基线 6.1.0
PASS  report.baselineEchartsVersion = 6.1.0
PASS  框架与框架版本仍取自基线
--- ② 覆盖按精确组合 ---
PASS  三个精确组合全实测 → adopt
PASS  缺一条精确组合 → hold
PASS  框架版本写错 → hold
PASS  多出组合 → hold
PASS  supported 重复 → hold
PASS  results 重复 → hold
PASS  有 not-run 维度 → hold
--- ③ 基线唯一 ---
PASS  候选6.1.0 正序 混合基线被拒绝
PASS  候选6.1.0 反序 混合基线被拒绝
PASS  候选6.0.0 正序 混合基线被拒绝
PASS  基线一致时正反序结论相同
PASS  候选 6.0.0 对 6.1.0 基线仍 hold（不扩 peer）
```

混合基线的拒绝消息（节选）：

```
Error: verifyCandidate 要求所有已支持组合的 ECharts 基线一致：收到 6.1.0 与 6.0.0（react@19.3.1）。
混合基线无法判定候选是否落在当前 peer 精确版本上，已拒绝出报告。
```

### 8.4 改动范围与升版

只改 `packages/charts-core/src/engine/compatibility.ts` 与 `tests/unit/sdk-compatibility.test.ts`；`peerDependencies.echarts` 仍为 `6.1.0`，未扩范围。`CombinationResult` 由 `SupportedCombination & CombinationDimensions` 改为显式类型并新增必填字段 `baselineEchartsVersion`（该类型由本包产出、不由调用方构造），按 `0.x` 兼容变更递增 PATCH：三包 `0.0.7 → 0.0.8`。

仓库内除 `tests/unit/sdk-compatibility.test.ts` 与 `src/index.ts` 的导出外无其他调用点；C 的 `e490564`（`tests/platform/*`、`tests/unit/platform-harness-cleanup.test.ts`）不引用本模块，修复不影响 C 侧测试。

`0.0.8` 冻结产物（Linux 复现环境，重复打包一致，tarball 只含 `dist/`；已核对包内 `dist/engine/compatibility.d.ts` 与 `.js` 均含修复，vue / react 的 `dependencies` 为 `@company/charts-core: 0.0.8`）：

```
8af080504c5d1bf57eb52a647bf6e95daef798cc213c4ea68ed7132223f0ece4  51538  company-charts-core-0.0.8.tgz
2bd53114187d504145726a673400bd487e8e368502c171dfdd8a41e850be6aee   6621  company-charts-vue-0.0.8.tgz
c7f3f6d3ee14033b2bfc9e3fbc1683842f1ef7f116e5bb375b66e5f258412e7d  12003  company-charts-react-0.0.8.tgz
```

**跨平台摘要差异已实证**：C 在 Windows 为 `0.0.7` 取得的三包摘要（`70232cd9…` / `861d4ee9…` / `e4630ba2…`）与 Linux 同版本摘要（`e7cf6b21…` / `654bda9c…` / `b1ce0212…`）不同。发布用的权威摘要必须由 C 在 Windows 从同一提交重新打包取得。

### 8.5 升版后的回归

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/unit --test-timeout=60000` | 12 files / **204 passed**（原 191 + 新增 13） |
| `pnpm --filter @company/charts-core typecheck` | 通过 |
| `pnpm --filter @company/charts-core build` | 通过 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 退出码 0，无错误 |

## 九、复审遗漏与 Vue 声明缺陷（2026-11-13 第二轮）

### 9.1 实测行版本被篡改仍 adopt

C 对 `83ec74d` 用 tsx 复现：一份全 `passed` 的报告，只把 `results[0].echartsVersion`
改成 `6.0.0`，`hasDualFrameworkCoverage` 仍 `true`、`recommend` 仍 `'adopt'`。根因是
造键只用 `baselineEchartsVersion`，没校验每行**实际验的** `echartsVersion` 必须等于
`report.candidate.version`。同类问题还有盲信传入的 `peerSatisfied`。

复现输出（修复前）：

```
原始报告: candidate = 6.1.0  baseline = 6.1.0
results  = vue/6.1.0, react/6.1.0
recommend = adopt

篡改后: results[0].echartsVersion = 6.0.0
hasDualFrameworkCoverage = true
recommend              = adopt   <-- 应为 hold

伪造 peerSatisfied=true 且 baseline=6.0.0 / candidate=6.1.0:
recommend = adopt   <-- 应为 hold
```

修复（`9679bac`）后同一脚本：

```
篡改后: results[0].echartsVersion = 6.0.0
hasDualFrameworkCoverage = false
recommend              = hold

伪造 peerSatisfied=true 且 baseline=6.0.0 / candidate=6.1.0:
recommend = hold
```

`tests/unit/sdk-compatibility.test.ts` 由 33 例增至 **41 例**，新增 8 例（5 例先红）。
红态：篡改某一行（含非第一行）的 `echartsVersion`、`peerSatisfied` 置真或置假、
`supported` 混基线，均曾放行 `'adopt'`。

### 9.2 公开类型兼容性判定修正

`0.0.8` 给导出的 `CombinationResult` 加了**必填** `baselineEchartsVersion`，那对手工
构造该类型的调用方是破坏性变更，却按 PATCH 发版，不符合 `AGENTS.md`
「破坏性变更递增 MINOR」。`0.0.9` 改为**可选**：旧公开类型形状依然可构造；缺失即
fail-closed（`hasDualFrameworkCoverage` 返回 `false`、`recommend` 返回 `'hold'`），
不会因为少字段放行，也不重新开放「报告与实测脱节」的误判。已有 RED 用例
「缺少逐行基线对照时不得判为完整覆盖」与「逐行基线与 supported 不一致时」锁定该行为。

### 9.3 charts-vue 发布声明的 NodeNext 缺陷

`src/index.ts` 等入口的 `export { default as LineChart } from './LineChart.vue'` 被
vue-tsc 原样写进 `dist/*.d.ts`，而真实声明文件叫 `LineChart.vue.d.ts`。仓库与多数
消费者用 `moduleResolution: 'Bundler'`，TS 能解析过去，缺陷因此在仓库内一直不可见。

修复前，用**真实冻结 tarball** 装到工作区外隔离消费者目录、`moduleResolution:
NodeNext` + `skipLibCheck: false` 实跑 `tsc`，报 9 处：

```
node_modules/@company/charts-vue/dist/index.d.ts(1,38): error TS2307: Cannot find module './LineChart.vue' or its corresponding type declarations.
node_modules/@company/charts-vue/dist/index.d.ts(2,37): error TS2307: Cannot find module './BarChart.vue' …
…（PieChart / ScatterChart / TrendCard / RankingChart / ProportionChart / bar.d.ts / ranking.d.ts）
```

修复（`5393fea`）：`packages/charts-vue/scripts/build.mjs` 在声明发射后把 `./X.vue`
改写为 `./X.vue.js`——NodeNext 与 Bundler 都会把 `.js` 说明符映射到 `X.vue.d.ts`。
只碰声明文件；vite 产出的运行时 chunk 用哈希文件名，从不出现裸 `.vue` 说明符。

验收（`b0979d9`，`tests/unit/charts-vue-declarations.test.ts` 6 例，4 例先红）：
静态断言裸 `.vue` 说明符为 0、所有相对说明符以 `.js` 结尾且指向的声明文件存在；
动态断言用仓库锁定的 TypeScript 以 NodeNext + `skipLibCheck: false` 对真实 `dist`
的 `.d.ts` 实跑 `tsc`，无相对说明符的 TS2307。

**真实冻结消费者验证（`0.0.9` tarball，工作区外隔离目录，`npm install` 严格 peer）**：

| 消费者 | `moduleResolution: Bundler` | `moduleResolution: NodeNext` |
| --- | --- | --- |
| Vue 3.5.45 + echarts 6.1.0 | 退出码 0，无错误 | 退出码 0，无错误 |
| React 19.3.1 + echarts 6.1.0 | 退出码 0，无错误 | 退出码 0，无错误 |

消费者源码经公开 API 消费全部 7 个组件 + `./ranking` / `./bar` 子路径，`tsconfig`
与仓库 `tsconfig.base.json` 同款 `strict` + `skipLibCheck: false`。修复前 Vue 侧
NodeNext 为 9 处 TS2307、Bundler 已为 0；修复后四种组合全部 0。

### 9.4 报告基线未绑定 supported 与单框架齐验（第三轮复审，`0.0.10`）

C 对 `e2e27c9` 复现两类问题（均非推测，tsx 实测）：

```
===== 问题 A：报告基线未绑定 supported 唯一真实基线 =====
supported 唯一基线 = 6.1.0  candidate = 6.0.0
forged.baselineEchartsVersion = 6.0.0  peerSatisfied = true
hasDualFrameworkCoverage = true
recommend              = adopt   <-- 应为 hold

===== 问题 B：只有 Vue 一个框架也 adopt（违反双框架齐验）=====
supported = vue@3.5.45 （仅 Vue）
results  = 1 条，四维全过
hasDualFrameworkCoverage = true
recommend              = adopt   <-- 应为 hold
仅 React 时 recommend   = adopt   <-- 应为 hold
```

**A 的根因**：`peerFlagSelfConsistent` 只比较 `candidate.version` 与
`report.baselineEchartsVersion`——两者都在报告里，可以一起伪造。`supported` 这个
外部事实来源反而没被用上。

**修复**（`b901dc4`）：新增 `supportedBaseline()` 取 `supported` 的唯一 ECharts 基线；
`hasDualFrameworkCoverage` 要求 `report.baselineEchartsVersion` **精确等于**它；
`recommend` 直接用 `supported` 基线推导 peer 符合性，不再读 `report.peerSatisfied`。
报告只能被核对，不能作为判据，**不能改写已支持范围**。

**B 的根因**：原条件只是「`supported` 里每个组合都有实测」。`supported` 本身只有
一个框架时该条件被轻易满足，而 `supported` 描述的是当前已支持范围，共享核心变化
必须两个框架都验。

**修复**（同一提交）：`hasDualFrameworkCoverage` 要求 `supported` 同时覆盖 Vue 与
React。用框架集合判定而非计数——同一框架列多个版本时仍只要求该框架被覆盖到。

修复后同一脚本：

```
forged.baselineEchartsVersion = 6.0.0  peerSatisfied = true
hasDualFrameworkCoverage = false
recommend              = hold

supported = vue@3.5.45 （仅 Vue）
hasDualFrameworkCoverage = false
recommend              = hold
仅 React 时 recommend   = hold
```

`tests/unit/sdk-compatibility.test.ts` 由 41 例增至 **51 例**，新增 10 例
（6 例先红）。另修正 1 例旧断言并新增 1 例：peer 改由 `supported` 推导后，伪造
`peerSatisfied` 的 `true`/`false` 都不再影响判定（它只是转述），只有与 `supported`
基线矛盾才 `hold`。

**版本判定**：本轮是行为收紧，**未改任何导出类型形状**——`CombinationResult.
baselineEchartsVersion` 自 `0.0.9` 起保持可选，`0.0.10` 不动它。因此按 `0.x`
兼容变更递增 PATCH，无需 MINOR。

### 9.5 0.0.10 冻结产物与回归

```
e6f298f90a122f6e51393a5058b2f0bb0f9404d46630e5d833515b5a40231826  53513  company-charts-core-0.0.10.tgz
3d64d250e0b265ab80123aae5a43c9add0b826126a180429f6783d4533f059fa   6630  company-charts-vue-0.0.10.tgz
ae70d1a18cb663c8dd2cc9e639425c82f6e7e13966d9824c04c9bb201b40cafc  12006  company-charts-react-0.0.10.tgz
```

Linux 复现环境重复打包两次结果一致；已核对包内 `compatibility.js` 含 `supportedBaseline`、
`charts-vue` 的 `dependencies` 为 `@company/charts-core: 0.0.10`。**发布用的权威摘要
仍须由 C 在 Windows 上从同一提交重新打包取得**（跨平台差异已在 8.4 节实证）。

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/unit --test-timeout=60000` | 13 files / **228 passed**（原 218 + 新增 10） |
| `pnpm exec vitest run tests/unit/sdk-compatibility.test.ts` | **51 passed** |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 退出码 0，无错误 |

### 9.6 0.0.9 冻结产物与回归（第一轮修复后）

```
319292460fd29068c837b55630ebc482ab6ce1277a8f0c71685c1d24cfd7892b  52737  company-charts-core-0.0.9.tgz
ac8b1da97d239ef850f27da1a73dae5a94b95db86ddac66fa0eb626d147913e2   6627  company-charts-vue-0.0.9.tgz
308c2cd0fb4837a2db37edac0d1a7ce0aaed0b65aa31105e59d9831ba4f947d2  12003  company-charts-react-0.0.9.tgz
```

Linux 复现环境重复打包两次结果一致；已核对 `charts-vue` 包内 `dist/index.d.ts`
为 `./LineChart.vue.js`、`dependencies` 为 `@company/charts-core: 0.0.9`。
**发布用的权威摘要仍须由 C 在 Windows 上从同一提交重新打包取得**（跨平台差异已在
8.4 节实证）。

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/unit --test-timeout=60000` | 13 files / **218 passed**（原 204 + 新增 14） |
| `pnpm --filter @company/charts-vue typecheck`（vue-tsc） | 通过 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 退出码 0，无错误 |
| `pnpm exec playwright test --config tests/playwright.config.ts` | **185 passed** |
| `pnpm build` | 10 successful, 10 total |
| `pnpm verify:workspace` | 通过 |

## 十、未覆盖边界

- **`0.0.9` 的 Windows 原生复验未执行**：C 于 2026-11-13 在固定 `f35ebc9` 上完成的 `0.0.7` 原生复验**不覆盖**本轮修复，且 C 已明确记录「当前兼容策略保持未验收」。`0.0.9` 需在含修复提交的分支上重跑，并重点核对三项误判各自的判定：

  ```powershell
  .\scripts\verify.ps1
  .\scripts\pnpm.ps1 exec vitest run tests/unit/sdk-compatibility.test.ts          # 预期 51 passed
  .\scripts\pnpm.ps1 exec vitest run tests/unit/charts-vue-declarations.test.ts    # 预期 6 passed
  ```

- Windows 开发机原生验证（`.\scripts\verify.ps1`）未执行；本记录全部来自 Linux 复现环境。
- 真实三存储（Verdaccio / PostgreSQL / MinIO）与 OIDC 不在本机可用范围，`compatibility_records` 的 `'passed'` 无法落库。
- B 侧 CLI `component echarts check` / `verify` 命令与 `upgrades/{resolve,matrix,report}.ts` 不在本轮范围（B 主责）；A 侧只提供 `charts-core` 的策略函数与接口约定。修复后 `CombinationProbe` 收到的组合 `echartsVersion` 为候选版本，B 侧实现探针时须按该版本安装依赖、建隔离目录，**不能**按组合里原有的基线版本去装。
- 6.0.0 的视觉回归未做，因此即便类型/运行/交互全过，也不能据此扩大支持范围。
