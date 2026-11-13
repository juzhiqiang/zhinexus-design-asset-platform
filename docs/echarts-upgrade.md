# ECharts 升级、兼容矩阵与回退

日期：2026-11-13。负责人：A（SDK）。任务定义见 [T10 实施计划](../superpowers/plans/2026-11-11-component-platform-implementation.md)。
本文件是 T10 的**升级差异、兼容矩阵口径与回退交接材料**；本轮实测证据见 [T10 SDK 兼容验证记录](verification/t10-sdk-compatibility.md)。

## 1. 当前基线（不可随意变动）

| 项 | 值 |
| --- | --- |
| ECharts | `6.1.0`（根 `pnpm-lock.yaml` 锁定，`packages/charts-core` 的 `peerDependencies.echarts` 与 `devDependencies.earts` 同为 `6.1.0`） |
| zrender | `6.1.0`（echarts 6.1.0 的运行时依赖，随 echarts 一起锁定） |
| Vue | `3.5.45` |
| React / ReactDOM | `19.3.1` |
| 组件包 | `@company/charts-core` / `charts-vue` / `charts-react` 均 `0.0.10` |
| 工具链 | Node `26.13.0`、pnpm `12.18.0`（`.tools/` 固定） |

**三个「基线」要分清**：`0.0.10` 是本轮工作树上的当前版本（含兼容策略缺陷修复、Vue 声明修复与第三轮基线绑定）；**最后一次完成 Windows 原生全图验收的是 `0.0.7`**（C 于 2026-11-13 在 `f35ebc9` 上实测，但该固定提交的策略判定被独立评审复现有三个 Important 缺陷，C 明确记录「当前兼容策略保持未验收」）；再往前一版是 `0.0.6`。`0.0.8`、`0.0.9`、`0.0.10` 目前只有 Linux 复现环境证据，Windows 原生复验见第 6.2 节。回退时的「上一组已验证组合」指 `0.0.6`。

`rules/platform.md` 规定：任何扩大或缩减兼容版本范围的改动，必须同步更新兼容矩阵测试与 `compatibility_records`。**本文件不构成扩大范围的授权**——扩大范围必须是人在审阅实测报告后的显式动作。

## 2. 兼容策略在 SDK 侧如何落地

`packages/charts-core/src/engine/compatibility.ts` 提供纯策略，网络与文件系统都留给 B 侧 CLI（`component echarts verify`），两边不重复实现：

- `resolveCandidate(input, registry)`：`'latest'` 或精确版本 → `{ version, integrity, releaseNotesSource, source }`。五条拒绝路径全部显式：非精确字面量、预发布、官方源不存在、缺 `dist.integrity`；`latest` 命中预发布时**不会**回退到上一个稳定版。
- `candidateSatisfiesPeer(candidate, peer)`：`peerDependencies` 锁定精确版本，符合性即版本相等。候选低于基线（回退）或高于基线（未验证新版本）都不算符合。
- `verifyCandidate(candidate, supported, probe)`：对每个已支持组合跑注入的探针，汇总**类型 / 运行 / 交互 / 视觉**四维结果与差异。报告恒带 `supportedRangeUnchanged: true`，且**不提供任何「建议的新支持范围」字段**。三条「报告必须与实测一致」的硬约束：探针收到的是**候选版本**（`results[].echartsVersion` 记候选，`results[].baselineEchartsVersion` 记基线对照）；所有已支持组合的 ECharts 基线必须一致，混合基线直接抛错不出报告；覆盖判定按**精确组合**一一对应。
- `recommend(report, supported)` / `hasDualFrameworkCoverage(report, supported)`：**一律以 `supported` 为唯一事实来源**。只有「候选精确等于 `supported` 唯一基线 + `supported` 同时覆盖 Vue 与 React + 每个精确组合都各有一条对应实测 + 每行实际验的 `echartsVersion` 就是候选版本 + 四维全过 + 无差异」才返回 `'adopt'`，其余一律 `'hold'`。缺、额外、重复（任一侧）、框架版本或 ECharts 基线版本对不上、某行版本号被改成非候选版本、报告自称的 `baselineEchartsVersion` 与 `supported` 唯一基线不符，任何一种都判为不完整。报告里的 `peerSatisfied` 只是转述，不作为判据——报告不能改写已支持范围。

配套测试 `tests/unit/sdk-compatibility.test.ts`（51 例）先红后绿，锁定上述纪律。

**候选失败不得扩大 peer 范围**在三个层次上都有实证，不是一句口号：

1. **安装层**：把冻结的 `0.0.6` tarball 与 `echarts@6.0.0` 一起安装，`npm install` 直接 `ERESOLVE`（`peer echarts@"6.1.0" from @company/charts-vue@0.0.6` / `@company/charts-react@0.0.6`），退出码 1，任何代码都不会跑起来。
2. **策略层**：`verifyCandidate` 的报告里 `peerSatisfied === false`、`supportedRangeUnchanged === true`、`suggestedPeerRange === undefined`，`recommend` 返回 `'hold'`。
3. **类型层**：见第 4 节的潜在脆弱点——即便绕过 peer 检查，`skipLibCheck: false` 的消费者会在 6.0.0 上拿到真实的类型解析失败。

### 2.1 2026-11-13 独立评审复现并已修复的策略误判（两轮）

独立评审对 `f35ebc9` 的 git 对象直接复现了三处「报告自称验证了某件事、实际验的是另一件事」的误判。三者都足以让 `recommend` 在缺少实测的情况下返回 `'adopt'`，因此在 `0.0.8` 修复，并各配 RED 用例（33 例中 13 例为本轮新增，其中 11 例先红后绿）：

| 误判 | 复现 | 修复 |
| --- | --- | --- |
| 探针收到基线版本 | 候选 `6.0.0`、基线 `6.1.0` 时，`probe` 收到的 `echartsVersion` 是 `6.1.0`，`results[].echartsVersion` 也是 `6.1.0`，报告却自称验证 `6.0.0` | `verifyCandidate` 把 `combination.echartsVersion` 替换为 `candidate.version` 再交给探针；`results` 新增 `baselineEchartsVersion` 记录基线对照 |
| 覆盖只按框架 | `supported` 含 Vue 3.5.45、Vue 3.4.0、React 19.3.1，实测只覆盖其中两项（或把 3.4.0 记成 3.5.45、多出一条、任一侧重复），`hasDualFrameworkCoverage` 仍返回 `true`、`recommend` 返回 `'adopt'` | 改为按 `framework@frameworkVersion@echartsVersion` 精确组合一一对应判定；缺、额外、重复、版本错一律 `false` |
| 基线取首项 | `supported` 为「Vue/6.1.0 + React/6.0.0」时 `baselineEchartsVersion` 取 `supported[0]`，候选 `6.1.0` 得 `peerSatisfied=true`/`adopt`；交换数组顺序则 `hold` | 所有已支持组合的 ECharts 基线必须一致，否则抛错且不出报告 |

复现与修复后的逐条断言脚本实际输出（17 项全 PASS）见 [T10 SDK 兼容验证记录](verification/t10-sdk-compatibility.md) 第八节。

第二轮（`0.0.9`）与第三轮（`0.0.10`）累计补五处：`hasDualFrameworkCoverage` 逐行校验 `results[].echartsVersion` 必须等于 `report.candidate.version`，堵住「改某一行版本号骗取 adopt」；`recommend` 增加 `peerSatisfied` 自洽校验，不再盲信报告自称。同时按 `AGENTS.md` 把 `CombinationResult.baselineEchartsVersion` 由必填改为可选——必填对手工构造该公开类型的调用方是破坏性变更，不能按 PATCH 发版；缺失即 fail-closed，不放行。第三轮把判据改成「以 supported 为唯一事实来源」并强制双框架齐验，详见同记录第 9.4 节。

## 3. 本轮候选查证结果

官方源 `https://registry.npmjs.org/echarts` 当天 `latest` dist-tag 解析为 **`6.1.0`**，与仓库锁定基线**是同一个版本**。因此「无新上游版本」这一分支成立：本轮只用当前精确版本验证了命令流程，**不得声称完成跨版本兼容**。

按计划要求「以第二个实际可获取版本另行验证版本差异处理」，选取同主线的上一个稳定版 **`echarts@6.0.0`** 作为第二候选（已从 registry 元数据核实存在与完整性摘要，非猜测）：

| 候选 | integrity（registry `dist.integrity`） | zrender |
| --- | --- | --- |
| `6.1.0`（基线 / latest） | `sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==` | `6.1.0` |
| `6.0.0`（第二候选） | `sha512-Tte/grDQRiETQP4xz3iZWSvoHrkCQtwqd6hs+mifXcjrCuo2iKWbajFObuLJVBlDIJlOzgQPd1hsaKt/3+OMkQ==` | `6.0.0` |

两个版本之间存在**可实证的真实差异**，不只是版本号：

- `types` 入口不同：6.1.0 是 `types/dist/echarts.d.cts`（ESM 友好的声明出口），6.0.0 是 `index.d.ts` 且使用 `export =` 导出赋值，与 ESM `module` 目标冲突（关掉 `skipLibCheck` 时 6.0.0 报 `TS1203`）。
- `exports["."]` 的 `types` 结构不同：6.1.0 是 `{ import, default, require }` 三层条件，6.0.0 是单一字符串。
- 运行时依赖 `zrender` 从 `6.1.0` 变为 `6.0.0`。
- 文件数与解包体积：6.1.0 为 1347 文件 / 60,297,703 字节，6.0.0 为 1319 文件 / 57,572,927 字节。

## 4. 隔离环境实测（echarts 6.0.0 × 冻结 0.0.6 tarball）

在工作区**外**的隔离消费者目录中安装同一份冻结 tarball，与 `echarts@6.0.0` 组合，绕过 peer 检查（`--legacy-peer-deps`，仅探针用，**不改变 SDK 声明**）后实测：

| 维度 | Vue 3.5.45 | React 19.3.1 |
| --- | --- | --- |
| 严格 peer 安装 | `ERESOLVE` 拒绝（退出码 1） | `ERESOLVE` 拒绝（退出码 1） |
| 类型（`tsc --noEmit`，仓库同款设置） | passed | passed |
| 运行 · light + canvas | passed：7/7 组件各 1 个 canvas，无页面错误 | passed：7/7 组件各 1 个 canvas，无页面错误 |
| 运行 · dark + svg | passed：7/7 组件各 1 个 svg、0 个 canvas | passed：7/7 组件各 1 个 svg、0 个 canvas |
| 交互（点击首柱） | passed：`{seriesId:'b', dataIndex:0, value:['A',30], nativeType:'click'}` | passed：载荷与 Vue 完全一致 |
| 视觉 | **not-run**：没有 6.0.0 的截图基线，必须人工确认 | **not-run**：同上 |

冻结产物摘要（`pnpm pack`，与发布链同口径）：`company-charts-core-0.0.6.tgz` 48,744 字节 `921bce48…`、`company-charts-vue-0.0.6.tgz` 6,621 字节 `90c70ce2…`、`company-charts-react-0.0.6.tgz` 12,003 字节 `4c3ff2dba5…`。vue / react 两个摘要与 T09 第五批记录一致（本轮未改动这两个包）；core 的摘要与体积相对 T09 记录发生变化，原因是本轮新增了 `engine/compatibility.ts` 及其导出。

### 4.1 潜在脆弱点（重要，建议后续单独处理）

`packages/charts-core` 的声明文件从**根入口** `'echarts'` 导入选项类型（`dist/types.d.ts` 第 2 行：`BarSeriesOption`、`GraphicComponentOption`、`GridComponentOption`、`LegendComponentOption` 等），并从 `'echarts/core.js'` 导入 `ComposeOption` / `EChartsType`。

关掉 `skipLibCheck` 后，两个候选的表现**不同**：

- `echarts@6.0.0`：`Module '"echarts/core.js"' has no exported member 'ComposeOption' / 'EChartsType'`，`Module '"echarts"' has no exported member 'BarSeriesOption' / …`。
- `echarts@6.1.0`：不报上述错误（只剩 `./LineChart.vue` 之类与 echarts 无关的打包痕迹问题）。

也就是说：在仓库自身与绝大多数消费者的 `skipLibCheck: true` 设置下，6.0.0 的类型检查会**通过**，但消费者的类型会被静默降级；只有显式关掉 `skipLibCheck` 才会暴露。这是把支持范围扩到 6.0.0 之前必须先解决的问题，处理方向是让 SDK 的声明文件只依赖 echarts 稳定的子路径入口，不依赖根入口的声明布局。**本轮未改动该导入路径**——它触及公开类型表面，需要独立的类型兼容验证，不混在兼容策略提交里。

## 5. 结论与建议

- **建议 `hold`**：不把 `peerDependencies.echarts` 扩到 `6.0.0`，也不缩。理由是候选低于基线（属于回退而非升级），且存在第 4.1 节的类型静默降级风险；安装层本就会被 `ERESOLVE` 拒绝。
- **跨版本兼容未完成**：官方 `latest` 与基线同版本，本轮没有「新上游版本」可升。待上游发布 6.1.0 之后的稳定版时，用同一套隔离流程重跑，四维全过且人工确认视觉基线后才谈扩范围。
- **视觉基线确认边界**：任何预期视觉变化（升级、主题令牌调整、渲染器切换）都必须显式基线确认；`environmentKey` 不一致时返回 `INCOMPATIBLE`，不得自动判过；网页手动上传截图的 `environmentKey` 固定为 `unknown-manual`，不能用于建立或更新自动回归基线。

## 6. 回退：恢复上一组已验证组合

上一组已验证组合即第 1 节的基线。回退的目标状态是「组件包 `0.0.6` + echarts `6.1.0` + 根锁文件不变 + 双框架可重建可验证」。

### 6.1 仓库侧（升版/升级尝试失败时）

```powershell
# 1) 确认当前分支与状态，避免在他人分支上操作
git branch --show-current
git status --short

# 2) 只回退本任务自己的提交（示例：回退到 main）
git log --oneline -8

# 3) 依赖树回到锁文件状态（不修改 pnpm-lock.yaml 本身）
.\scripts\pnpm.ps1 install --frozen-lockfile

# 4) 确认 echarts 精确版本
.\scripts\pnpm.ps1 ls -r --depth -1 | Select-String echarts
```

**不要**手工编辑 `pnpm-lock.yaml`，也不要 `git checkout --` 丢弃他人未提交改动（`AGENTS.md` 不可违反约束）。根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`turbo.json` 由 C 统一收口。

### 6.2 两个消费者各自恢复、重新构建与验证

Vue 消费者：

```powershell
# 在工作区外的干净消费者目录中
npm install --no-audit --no-fund            # 严格 peer：echarts 6.1.0 正常解析
npx tsc -p tsconfig.json --noEmit           # 类型
npx vite build                              # 构建
```

React 消费者：同上，另需确认 `@types/react` / `@types/react-dom` 与 `react` / `react-dom` 版本匹配。

验证顺序（与 `rules/testing-release.md` 一致）：`verify:workspace` → `build` → `typecheck` → `test` → `test:browser`。

基线 `885792b` / SDK `0.0.6` 的 Windows 原生验收已由 C 于 2026-11-13 实际完成：build 10 tasks、typecheck 14 + 根 `tsc`、unit/contracts 322、packed-consumer + cli-bundle 12、完整浏览器 122 均通过；`current-sdk` 从旧 10 实现 RED 后改为 14 实现，隔离三存储发布 READY、逐预览/截图摘要、Vue/React 各 7 子路径的精确 Registry 安装全部通过。

**该验收不包含本轮新增测试**。含本轮提交的分支在 Windows 上需重跑 `.\scripts\verify.ps1`，重点核对 `presentation-matrix` 56 例、`core-lifecycle` 11 例、`sdk-compatibility` 51 例与 `charts-vue-declarations` 6 例。Linux 复现环境本轮全量实测：`pnpm exec playwright test --config tests/playwright.config.ts` → **185 passed**，即基线 122 + 新增 63（`presentation-matrix` 56 + `core-lifecycle` 由 4 增至 11 的 7 例）。基线 122 与 C 在 Windows 上测得的 122 一致，可作为本轮新增用例的对照基准。

**`0.0.10` 的原生验收已完成**：C 于 2026-11-13 在固定 `190b60b` 上实跑 offline 安装 344 包 0 下载、force build/typecheck 20/20 零缓存、unit+contracts 379 通过、TS6/7 × Bundler/NodeNext 四组严格消费者 0 错误、17 个公开入口与旧 `CombinationResult` 形状通过、公开策略六反例全过，并以同一冻结三包完成真实三存储 READY、14 个 HTTPS 预览 × 5 项检查、Vue/React 各 7 个精确 Registry 导出。Windows 冻结 SHA 与 Linux 不同属正常的独立本地构建；C 未修改 A 的源码、未重新打包本批。**这不覆盖**：T10 视觉矩阵（`echarts@6.0.0` 视觉维度仍为 `not-run`）与两个真实业务试点。

C 另于 2026-11-13 在固定 `f35ebc9` 上完成 `0.0.7` 的 Windows 原生复验（强制构建/类型 20 项、策略 20 项、外部消费者/CLI 材料 13 项、展示/核心浏览器 67 项、十四实现隔离发布与双框架精确 Registry 消费）。**该复验固定的是 `0.0.7`，且 C 明确记录「当前兼容策略保持未验收」**：三个 Important 策略误判是在该固定提交上复现的，修复先后落在 `0.0.8`、`0.0.9` 与 `0.0.10`，因此 `0.0.7` 的结论不能沿用到 `0.0.10`；`0.0.10` 需按上文独立验收。

### 6.3 产物侧

**回退目标组合是 `0.0.6`**（C 已完成 Windows 原生全图验收的那一版），不是 `0.0.7` / `0.0.8` / `0.0.9` / `0.0.10`。

已发布版本不可变：任何版本一旦发布到 Verdaccio 即冻结，回退只能通过「继续安装已发布的 `0.0.6`」实现，不能覆盖或删除重发。若需要修复，递增 `PATCH` 发布新版本，并通过平台把旧版本标记为 `deprecated`。同一份 tarball 的 SHA-256 必须贯穿安装、截图、报告、上传与发布。

`0.0.10` 候选冻结产物摘要（`pnpm pack`，与发布链同口径；Linux 复现环境，重复打包两次结果一致，tarball 只含 `dist/`）：

| 包 | 字节 | SHA-256 |
| --- | --- | --- |
| `company-charts-core-0.0.10.tgz` | 53,513 | `e6f298f90a122f6e51393a5058b2f0bb0f9404d46630e5d833515b5a40231826` |
| `company-charts-vue-0.0.10.tgz` | 6,630 | `3d64d250e0b265ab80123aae5a43c9add0b826126a180429f6783d4533f059fa` |
| `company-charts-react-0.0.10.tgz` | 12,006 | `ae70d1a18cb663c8dd2cc9e639425c82f6e7e13966d9824c04c9bb201b40cafc` |

上表在 Linux 复现环境重复打包两次结果一致（可复现），tarball 只含 `dist/`。**发布用的权威摘要仍须由 C 在 Windows 上从同一提交重新打包取得**——C 在 Windows 为 `0.0.7` 取得的三包摘要（`70232cd9…` / `861d4ee9…` / `e4630ba2…`）与上表同版本的 Linux 摘要（`e7cf6b21…` / `654bda9c…` / `b1ce0212…`）**不同**，已实证跨平台字节差异真实存在。安装、截图、报告、上传必须贯穿同一份 Windows 摘要。

## 7. 待办与边界

- **Windows 原生复验未执行**：本文件所有实测均在 Linux 复现环境完成（工具链版本一致）。Windows 原生清单见 [T09 第五批 Windows 原生复验清单](verification/t09-ranking-proportion-windows-native.md)，需由 C 在 Windows 开发机执行并回填。
- **真实三存储闭环未执行**：Verdaccio / PostgreSQL / MinIO 与 OIDC 不在本机可用范围，`compatibility_records` 的 `'passed'` 状态只能在真实注册表与报告上传链路打通后落库。
- **上游新版本未出现**：官方 `latest` 与基线同版本，跨版本升级矩阵待上游发版后重跑。
