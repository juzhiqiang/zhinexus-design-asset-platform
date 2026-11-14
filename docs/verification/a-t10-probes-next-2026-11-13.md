# T10 A 侧交接：双框架精确版本兼容探针（可运行入口 + 接口契约）

日期：2026-11-13（补记于 2026-11-14）。负责人：A（SDK）。分支：`feat/a-t10-probes`。
任务定义见 [T10 实施计划](../superpowers/plans/2026-11-11-component-platform-implementation.md) 与三人分工。
本文是 A 本轮交付的**入口、输入输出契约、冻结摘要与实测结果**；候选差异与回退用例的后续补充见第七节。

## 一、交付物与边界

| 文件 | 作用 |
| --- | --- |
| `tests/acceptance/t10-sdk/probe.mjs` | **B 可调用的本地入口**。只做编排，不内置任何版本判定 |
| `tests/acceptance/t10-sdk/environment.mjs` | 环境投影与 `environmentKey` 的参考实现（纯逻辑） |
| `tests/acceptance/t10-sdk/bundle.mjs` | 冻结 bundle 只读读取与摘要校验（纯逻辑） |
| `tests/acceptance/t10-sdk/policy.mjs` | 从**冻结 tarball** 里加载兼容策略、解析候选 |
| `tests/acceptance/t10-sdk/consumer.mjs` | 工作区外干净消费者的创建、清单改写、类型/构建/SSR |
| `tests/acceptance/t10-sdk/browser.mjs` | 固定环境浏览器探针（运行/交互/生命周期/视觉） |
| `tests/acceptance/t10-sdk/evidence.mjs` | 四维结论装配与未覆盖项收集（纯逻辑） |
| `tests/acceptance/t10-sdk/probe.test.mjs` | 51 例 `node:test` 单测，先红后绿 |

**边界（与 `AGENTS.md` 一致，逐条可查）：**

1. 探针**不打包、不重新 pack、不改写任何已冻结产物**。冻结 bundle 只读；`readFrozenBundle` 会逐包核对 SHA-256 与字节数，对不上直接抛错不出报告。
2. 探针**不修改**根 `package.json` / `pnpm-lock.yaml` / `packages/contracts`。需要新增依赖时走独立请求文件（见第八节），不手改锁文件。
3. 探针**不 push、不 merge、不启动共享服务**。静态文件服务器端口一律取 `0`（系统分配），**不占用 5173–5176**，也不与 B 的基线 CLI 冲突。
4. 探针**不替任何框架说话**：`--frameworks vue,react` 两个都跑，缺一个就不出具双框架覆盖结论。`hasDualFrameworkCoverage` 为 `false` 时 `recommend` 不可能返回 `adopt`。
5. 探针**不按版本号判通过**：结论只来自真实跑过的类型检查、生产构建、SSR 导入、浏览器挂载、点击载荷、生命周期与同 `environmentKey` 下的逐字节截图比对。
6. `not-run` 保持 `not-run`。没有任何代码路径会把未跑项写成 `passed`；未覆盖项集中列在证据的 `uncovered[]` 里。
7. 兼容策略**从冻结 tarball 里动态加载**（`policy.mjs` 用 `tar xzf` 解包后 import `dist/engine/compatibility.js`），不是从仓库源码 import——否则测的是工作树未提交改动，不是用户真正会装到的包。

## 二、入口命令

在仓库根目录执行。所有选项都有缺省值，最小可用命令只差一个 `--bundle`：

```bash
# 最小可用：跑 supported 里的全部精确组合（vue + react × 7 组件 × 4 展示）
node tests/acceptance/t10-sdk/probe.mjs \
  --bundle .tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583

# 本轮实际用法：显式指定候选 ECharts，分片跑矩阵，第二次带基线做视觉比对
node tests/acceptance/t10-sdk/probe.mjs \
  --bundle .tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583 \
  --echarts 6.1.0 \
  --frameworks vue,react \
  --components line,bar,pie,scatter,trend-card,ranking,proportion \
  --presentations light-canvas \
  --consumer-root /tmp/t10consumers \
  --out test-results/t10-sdk-probes/full \
  --label all-light-verify \
  --baseline test-results/t10-sdk-probes/full/probe-evidence-vue-light-baseline.json,test-results/t10-sdk-probes/full/probe-evidence-react-light-baseline.json
```

完整选项（`--help` 输出与本表一致）：

| 选项 | 取值 | 说明 |
| --- | --- | --- |
| `--bundle <dir>` | 目录 | **必填**。C 冻结的 bundle 目录（含 `manifest.json` 与 `packages/*.tgz`） |
| `--echarts <version>` | 精确版本字面量 | 候选 ECharts。缺省取 `--registry` 的 `latest` |
| `--frameworks <list>` | `vue` / `react`，逗号分隔 | 缺省两者都跑。只传一个时**不会**出具双框架覆盖结论 |
| `--components <list>` | 七个逻辑组件名，逗号分隔 | 缺省全部七个 |
| `--presentations <list>` | `light-canvas` / `dark-canvas` / `light-svg` / `dark-svg` | 缺省全部四种（`?theme=&renderer=` 查询参数） |
| `--registry <url>` | registry 地址 | 缺省 `https://registry.npmjs.org/echarts` |
| `--peer <mode>` | `strict` / `legacy` / `strict-only` | 缺省 `strict`。`legacy` 在严格 peer 被拒后用 `--legacy-peer-deps` 继续测量（**不改变 SDK 声明，也不构成通过结论**）；`strict-only` 直接失败 |
| `--out <dir>` | 目录 | 证据输出目录。缺省 `test-results/t10-sdk-probes/<UTC 时间戳>` |
| `--label <name>` | `[a-z0-9-]` | 证据文件名后缀。分片跑同一批矩阵时互不覆盖 |
| `--consumer-root <dir>` | 目录 | 干净消费者根目录。缺省系统临时目录 |
| `--baseline <file>[,<file>]` | 证据 JSON，可多份 | 视觉基线。多份按框架合并后比对 |
| `--keep` | 开关 | 保留消费者目录（调试用） |
| `--skip-browser` | 开关 | 跳过浏览器维度，`runtime` / `interaction` / `visual` 全部记 `not-run` |
| `--json` | 开关 | stdout 打印证据 JSON |
| `--fail-on-hold` | 开关 | `recommendation` 为 `hold` 时以退出码 2 结束 |

退出码：`0` 探针跑完（不论 recommendation）、`1` 探针自身失败或输入非法、`2` `--fail-on-hold` 且结论为 `hold`。
**退出码 0 不等于「可以 adopt」**——adopt / hold 看证据里的 `recommendation` 字段。

## 三、输入 schema

### 3.1 冻结 bundle（`--bundle`）

C 冻结目录下的 `manifest.json`，`readFrozenBundle` 逐项校验：

| 字段 | 校验 |
| --- | --- |
| `schemaVersion` | 必须为 `1` |
| `channel` | 记录用（本轮为 `cli`） |
| `version` | 三个包版本必须一致 |
| `packages[]` | 必须**恰好**是 `@company/charts-core` / `charts-vue` / `charts-react` 三个，一个不能少、不能多 |
| `packages[].sha256` / `bytes` | 与实际 tarball 字节逐字节核对 |
| `packages[].peerDependencies.echarts` | 三个包必须一致，混合 peer 直接抛错（混合基线不出报告） |
| `packages[].tarballPath` | 必须在 bundle 目录内（拒绝越界路径） |

### 3.2 supported 精确组合清单

从冻结 manifest 的 `variants[].compatibility` 里读，只取 `status === 'passed'` 且带 `reportId` + `verifiedAt` 的记录，按 `(framework, frameworkVersion, echartsVersion)` 去重。**这是 `recommend` 的唯一事实来源**，探针不自己推断支持范围。

### 3.3 候选（`--echarts` / `--registry`）

经 `resolveCandidate` 解析（从冻结 tarball 里加载的那份策略），拒绝路径按 `CandidateError.reason` 分流：`not-exact-version` / `prerelease` / `unknown-version` / `missing-integrity`。**不解析消息文本**。

## 四、输出 schema

证据 JSON（`--out` 目录下的 `probe-evidence[-<label>].json`）与摘要（`summary[-<label>].md`）：

```jsonc
{
  "schemaVersion": 1,
  "kind": "a-t10-sdk-probe",
  "generatedAt": "2026-11-14T…Z",
  "probe": {
    "entry": "tests/acceptance/t10-sdk", "repoRoot": "…",
    "command": ["node", "tests/acceptance/t10-sdk/probe.mjs", "--bundle", "…"],
    "node": "v26.13.0", "npm": "…",
    "platform": "linux", "arch": "x64", "hostIsWindows": false,
    "browserVersion": "158.0.8127.18", "playwright": "1.65.0"
  },
  "bundle": {
    "root": "…", "channel": "cli", "version": "0.0.10",
    "packages": [{ "name": "@company/charts-core", "version": "0.0.10",
                   "sha256": "…", "bytes": 53524, "sourceDigest": "…",
                   "peerDependencies": { "echarts": "6.1.0" } }]
  },
  "candidate":   { "version": "6.1.0", "integrity": "sha512-…", "source": "…", "resolution": "…" },
  "requestedEchartsVersion": "6.1.0",
  "baselineEchartsVersion":  "6.1.0",
  "supported":   [{ "framework": "vue", "frameworkVersion": "3.5.45", "echartsVersion": "6.1.0",
                    "reportId": "…", "verifiedAt": "…" }],
  "combinations": [{
    "framework": "vue", "frameworkVersion": "3.5.45",
    "baselineEchartsVersion": "6.1.0", "echartsVersion": "6.1.0",
    "consumer": { "root": "…", "kept": false, "manifestDigest": "…",
                 "installs": [{ "mode": "strict", "exitCode": 0 }],
                 "peerMode": "strict",
                 "resolved": { "echarts": "6.1.0", "zrender": "6.1.0", "vue": "3.5.45" } },
    "dimensions": { "typecheck": "passed", "runtime": "passed",
                    "interaction": "passed", "visual": "passed" },
    "failures": [],
    "evidence": {
      "typecheck": [{ "tool": "vue-tsc", "resolution": "Bundler", "scope": "example-app", "exitCode": 0 }],
      "build":     { "exitCode": 0 },
      "ssrImport": { "exitCode": 0, "windowDefined": false, "documentDefined": false },
      "lifecycle": { "component": "bar", "status": "passed" },
      "browser":   [{ "component": "line", "presentation": "light-canvas", "hostCount": 1,
                      "checks": [], "appliedPresentation": { "canvases": 1, "svgs": 0 },
                      "click": [{ "seriesId": "revenue", "dataIndex": 0,
                                  "value": ["周一", 120], "nativeType": "click" }],
                      "clickSource": "ideal-point",
                      "screenshot": { "sha256": "…", "bytes": 8214, "width": 720, "height": 361 },
                      "environmentKey": "…" }],
      "visual":    [{ "component": "line", "presentation": "light-canvas", "result": "PASS" }]
    },
    "screenshots": [{ "component": "line", "framework": "vue", "presentation": "light-canvas",
                      "sha256": "…", "bytes": 8214, "environmentKey": "…" }]
  }],
  "policy": { "peerSatisfied": true, "supportedRangeUnchanged": true,
             "requiresVisualBaselineConfirmation": false, "hasDualFrameworkCoverage": true },
  "recommendation": "adopt",
  "uncovered": []
}
```

四维口径（与 `charts-core` 的 `CombinationDimensions` 一一对应，**不新增第五维**）：

| 维度 | `passed` | `failed` | `not-run` |
| --- | --- | --- | --- |
| `typecheck` | 每种解析模式的 `tsc` / `vue-tsc` 都退出 0 | 任一退出非 0 | 一次都没跑 |
| `runtime` | SSR 安全导入 + 生产构建 + 浏览器运行 + 生命周期全过 | 任一失败 | `--skip-browser` |
| `interaction` | 每个组件的点击载荷等于共享语义 | 任一不符或缺失 | 未采集到点击 |
| `visual` | 每张截图都有同 `environmentKey` 基线且字节一致 | 同环境下字节不同 | 无基线（`NEW`）或 `environmentKey` 不同（`INCOMPATIBLE`） |

构建、SSR 导入、生命周期、逐截图 `environmentKey` 作为 `evidence` 附在同一个组合记录里，不另立维度——否则报告的维度集合与策略层判定输入不一致。

## 五、冻结包摘要（0.0.10，只读）

冻结目录：`.tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583`（C 已核实 199 文件 / 14 实现摘要全部一致）。
**本轮未重新 pack、未改写任何字节。** 探针每次运行都重新核对下列摘要：

| 包 | 版本 | SHA-256 | 字节 | sourceDigest | peerDependencies |
| --- | --- | --- | --- | --- | --- |
| `@company/charts-core` | 0.0.10 | `2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752` | 53524 | `9b808701e6ff3eecb8a04673edb50f79842dc5da85373e9dd594526a226ef67e` | `echarts 6.1.0` |
| `@company/charts-vue` | 0.0.10 | `b01aeec7604b2c399a6cb1efa7b4ba1ac3092f12ea92322c682a188045e8c01b` | 6625 | `7b71dabd376fd6ba2a1e0c2403e637d444808f4077fce0e81f2fbcb0e8191f53` | `vue 3.5.45`、`echarts 6.1.0` |
| `@company/charts-react` | 0.0.10 | `cd625741f37a95f81b395b45bce6a34d439135dcaa1df3ea5989c73159ab8e5c` | 12052 | `cab004d9718952c22985dd83b438ccb8f278763b426ccab81ba37ff25052b0a6` | `react 19.3.1`、`react-dom 19.3.1`、`echarts 6.1.0` |

候选 ECharts：`6.1.0`，`integrity sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==`，源 `https://registry.npmjs.org/echarts`。
**候选精确等于 supported 唯一基线**，`peerSatisfied = true`，`supportedRangeUnchanged = true`——本轮不构成任何兼容范围变动。

## 六、精确组合与实测结果

supported 精确组合（来自冻结 manifest，两条）：

| 框架 | 框架版本 | ReactDOM | ECharts | reportId | verifiedAt |
| --- | --- | --- | --- | --- | --- |
| vue | 3.5.45 | — | 6.1.0 | `report-line-vue` | 2026-11-13T06:57:29.148Z |
| react | 19.3.1 | 19.3.1 | 6.1.0 | `report-line-react` | 2026-11-13T06:57:38.089Z |

### 6.1 矩阵覆盖（本轮实测，隔离 Linux 工具链）

**2 框架 × 7 组件 × 4 展示 = 56 个精确组合，四维全部 `passed`。** 每个框架另跑一次生命周期（`bar` 页卸载 / 重挂）与一次 SSR 安全导入（八个公开入口）。

| 实现 | 框架版本 | ECharts | typecheck | runtime | interaction | visual |
| --- | --- | --- | --- | --- | --- | --- |
| vue | 3.5.45 | 6.1.0 | passed | passed | passed | passed |
| react | 19.3.1 | 6.1.0 | passed | passed | passed | passed |

`recommendation = adopt`，`hasDualFrameworkCoverage = true`，`peerSatisfied = true`，`requiresVisualBaselineConfirmation = false`。

### 6.2 每个维度实际做了什么

- **typecheck**：两次。① `Bundler`，以示例自己的 `tsconfig.json` 为底叠加探针严格度（`skipLibCheck: false`、`types: ['vite/client','node']`），覆盖整个示例应用；② `NodeNext`，只覆盖 SDK 公开入口（八个子路径的 `import type`），因为 `charts-vue` 曾在 `.d.ts` 里写过不带扩展名的裸 `.vue` 声明说明符，只有 NodeNext 才暴露。**NodeNext 不把示例应用的风格问题算进 SDK 结论**——示例里 `./BarApp` 这类无扩展名相对导入在 nodenext 下必然报 `TS2835`，与应用能不能用无关。
- **runtime**：`vite build` 生产构建 + 纯 Node 环境 import 八个公开入口（断言模块顶层没碰 `window` / `document` / `navigator`）+ 浏览器按统一就绪协议打开每个示例页（`window.__COMPONENT_EXAMPLE__.ready`，不用固定 sleep）+ 卸载后旧宿主上的 ECharts 实例确实被 dispose、重挂后仍只有一个实例。
- **interaction**：取首个数据点的客户端坐标并**真实鼠标点击**，比对事件载荷与共享语义。点击点由 `findDataPoint` 在 zrender 渲染几何上搜索——多系列柱状图与横向条形的类目轴中心落在图形之间的空隙里，固定偏移会随系列数变化而失效。
- **visual**：固定视口 1000×600、`deviceScaleFactor` 1、locale `zh-CN`、timezone `Asia/Shanghai`、宿主背景按主题固定，对图表宿主元素截图，与同 `environmentKey` 基线逐字节比对。**同环境同字节才判 `PASS`；环境签名不同判 `INCOMPATIBLE`，不自动判过。**

### 6.3 environmentKey

`environmentKey = SHA-256(环境投影的规范化 JSON)`，**不含** `frameworkVersion` 与 `echartsVersion`；`os` / `arch` 小写。投影字段与 `packages/contracts/src/digests.ts` 的 `environmentProjection` 对齐，探针用独立实现复现，单测锁定。

`probe.test.mjs` 里有一条用例用 Windows 输入**精确复现 C 为 0.0.10 冻结 bundle 产出的那个 key**（`97c9cf055322458d64e4c37da6ff181be7d98514355ffbe09665340d03225c17`，line-vue / light / canvas），证明投影口径与 C 侧一致。本轮 Linux 跑出来的 key 与之不同是**预期的**——`os` / `arch` / 浏览器版本不同，签名本就该不同。

### 6.4 实际跑过的命令与结果

隔离 Linux 工具链：Node `v26.13.0`、Chromium `158.0.8127.18`（Playwright `1.65.0` 的 chrome-headless-shell，手动放置）、npm 缓存预热。
每次运行的输出（节选）：

```
[probe] 冻结 bundle：…/current-sdk/dcc49e73-…（channel=cli，版本 0.0.10）
[probe]   @company/charts-core@0.0.10 sha256=2d9d4208bf070f24… bytes=53524
[probe]   @company/charts-vue@0.0.10 sha256=b01aeec7604b2c39… bytes=6625
[probe]   @company/charts-react@0.0.10 sha256=cd625741f37a95f8… bytes=12052
[probe] ECharts：peer 基线 6.1.0，候选 6.1.0
[probe] supported 精确组合：vue@3.5.45@6.1.0, react@19.3.1@6.1.0
[probe] 消费者目录 /tmp/t10consumers/a-t10-staging-XXXXXX/a-t10-consumer-vue（peer=strict）
[probe] 解析到 echarts=6.1.0 zrender=6.1.0 vue=3.5.45 react=null
[probe] typecheck vue-tsc/Bundler（example-app）退出码=0
[probe] typecheck vue-tsc/NodeNext（sdk-surface）退出码=0
[probe] build 退出码=0
[probe] SSR 导入退出码=0 window=false document=false
[probe] 浏览器维度：7 次运行，生命周期=passed
[probe] 四维：{"typecheck":"passed","runtime":"passed","interaction":"passed","visual":"passed"}
[probe] recommendation=adopt dualFrameworkCoverage=true peerSatisfied=true
```

React 侧同构：`tsc/Bundler` 0、`tsc/NodeNext` 0、build 0、SSR 0（`window=false document=false`）、28 次浏览器运行、生命周期 passed。

完整矩阵一次跑完的输出（2 框架 × 7 组件 × 4 展示 = 56 组合，四份分片基线合并后比对）：

```
[probe] 视觉基线：4 份证据，共 56 张截图
[probe] 浏览器维度：28 次运行，生命周期=passed
[probe] 四维：{"typecheck":"passed","runtime":"passed","interaction":"passed","visual":"passed"}
[probe] 浏览器维度：28 次运行，生命周期=passed
[probe] 四维：{"typecheck":"passed","runtime":"passed","interaction":"passed","visual":"passed"}
[probe] recommendation=adopt dualFrameworkCoverage=true peerSatisfied=true
```

本轮证据与 56 张截图已放在仓库的 `test-results/t10-sdk-probes/full/`（该目录被 `.gitignore` 忽略，不进版本库；C 在 Windows 重跑后会生成自己的一份）。

安装一律 `strict` peer 模式一次通过（`added 57 packages in 3s`），**没有走到 `--legacy-peer-deps` 路径**。因此 `consumer.installs` 里只有一条 `strict` 记录，`peerMode` 为 `strict`。

单测：`node --test tests/acceptance/t10-sdk/probe.test.mjs` → **51 例全过**（8 个 suite）。

### 6.5 本轮修掉的七个探针自身缺陷（都不是 SDK 缺陷）

先红后绿，每条都留了用例：

1. **`--label` 缺失导致分片跑互相覆盖**。两次分片会写同一个 `probe-evidence.json`。新增 `--label`（只接受 `[a-z0-9-]`），证据与摘要文件名改为 `probe-evidence-<label>.json` / `summary-<label>.md`。
2. **React typecheck 一片 `TS17004 Cannot use JSX unless the '--jsx' flag is provided`**。原因是探针从零写 tsconfig，丢掉了示例自己的 `jsx` / `resolveJsonModule` / `esModuleInterop`。改为**以示例 tsconfig 为底**叠加探针严格度，并把 NodeNext 收窄到 SDK 公开入口。
3. **视觉基线永远判 `NEW`**。`compareWithBaseline` 读的是顶层 `screenshots`，而证据 JSON 里截图挂在 `combinations[].screenshots` 下，于是任何真实基线都读空，「没有基线」被误报成「有新差异」。新增 `baselineScreenshots` 摊平，并支持 `--baseline` 逗号分隔多份按框架合并。

另修掉一处**期望值错误**：排行榜的期望点击载荷原先按 fixture 输入顺序取 `['折线图', 120]`，但排行榜会按数值降序重排并取前 `limit` 名，渲染下标 0 实际是 `['柱状图', 180]`。现已改为 `['柱状图', 180]`，并由一条用例**从真实 fixture 按公开语义（降序、并列保持输入顺序、缺失值不进入排行、`limit` 取前 N）推导**后比对，fixture 一改就红。

4. **`mergeBaselineEvidence` 按框架去重，把同一框架其他展示的基线整份丢掉**。`--baseline` 收四份分片证据时，只有第一份里的展示能比上，其余 21/28 全判 `NEW`——「有基线」被误报成「没基线」。改为按 (框架, 组件, 展示组合) 去重；同一组合在两份基线里字节或 `environmentKey` 不一致时记进 `conflicts` 并打日志，不静默选一个。
5. **临时目录只在成功路径清理**。策略解包目录与消费者暂存根都是探针自建的，一次中途失败（例如没装 `@playwright/test`）就在临时目录留一份；沙箱小分区被填满后每次运行都 `ENOSPC`。改为收尾任务栈，成功失败都跑，单个任务失败不中断其余。同时策略解包目录改随 `--consumer-root`（沙箱里 `os.tmpdir()` 可能只剩几百 MB）。
6. **证据里记录的 `command` 少了 `probe.mjs`**。原先用目录名拼复现命令，现在用真实 `process.argv[1]`。
7. **缺 `@playwright/test` 时的报错不可操作**。现在是明确的 `PROBE_DEPENDENCY`，提示先 `pnpm install` 或显式 `--skip-browser`——「没装依赖」与「主动跳过」必须分得清。

## 七、未覆盖项（诚实清单，均标 `pending`）

以下全部**未跑**，不构成任何通过结论：

| 项 | 状态 | 说明 |
| --- | --- | --- |
| Windows 原生验收 | `pending` | 本轮只在隔离 Linux 工具链上跑过。**不把 Linux 证据宣称 Windows 验证。** C 在 Windows 上按第二节命令原样重跑即可 |
| `compatibility_records` 落库 | `pending` | 真实三存储（Verdaccio / PostgreSQL / MinIO）与 OIDC 不在本机可用范围。契约与落库归 C |
| 候选差异（非 6.1.0） | `pending` | 需要新候选只能新目录新批次，诚实区分。已知上一轮 `echarts@6.0.0` 的安装层结论是 `ERESOLVE` 直接失败，本轮未重跑 |
| 回退用例 | `pending` | 同上，需新批次 |
| peer 范围改动 | **不做** | 探针只出具报告，不修改任何 `package.json` 的 `peerDependencies`。扩大或缩减范围必须是人在审阅实测报告后的显式动作 |
| 根 `package.json` 脚本接线 | `pending` | 见第八节，需 C 收口 |

## 八、给 C 的依赖请求（不手改锁文件）

探针在仓库根被 B 调用时需要一个 npm script。请 C 在根 `package.json` 增加（A 不碰根清单与锁文件）：

```json
"scripts": {
  "probe:t10": "node tests/acceptance/t10-sdk/probe.mjs"
}
```

`@playwright/test` 已是根 devDependency（`1.65.0`），**无需新增依赖**；探针用 `await import('@playwright/test')` 惰性加载，`--skip-browser` 时完全不碰它。若 C 希望脚本带上固定 bundle 路径，请以 C 侧环境变量或参数形式提供，A 不建议把绝对路径写进脚本。

## 九、环境差异说明（Linux 隔离工具链）

按分工「Linux 可手动隔离安装并说明环境差异」，本轮的差异与处置：

| 差异 | 处置 |
| --- | --- |
| 沙箱 Node 为 v22，仓库锁定 26.13.0 | 下载 Node 26.13.0 官方 tarball，核对 SHA-256 后解包到 `/tmp/t10tools/isolated/`，`PATH` 前置 |
| pnpm 不在锁定版本 | 探针的干净消费者用 `npm install`（工作区外消费者，不参与仓库 pnpm 工作树）。npm 入口同时试 Windows 布局（`<node>/node_modules/npm/bin/npm-cli.js`）与 Linux 布局（`<node>/lib/node_modules/npm`），都不中退回 PATH 上的 `npm`——同一份入口在 Windows（C 跑）与 Linux（A 跑）都能用 |
| Playwright 浏览器下载超过单次命令时长上限 | 直接 `curl` 下载 `chrome-headless-shell-linux64.zip` 并手工放到 `PLAYWRIGHT_BROWSERS_PATH` 对应目录 + `INSTALLATION_COMPLETE` 标记 |
| 缺 `libXdamage.so.1` 且无 root / apt 权限 | 下载 Ubuntu jammy 的 `.deb` 解到 `/tmp/t10tools/syslibs`，用 `LD_LIBRARY_PATH` 指向 |
| `/sessions` 剩余空间约 300 MB | 所有重活（Node、npm 缓存、浏览器、消费者暂存）都放 `/tmp`；消费者暂存根命名 `a-t10-staging-*`，`removeConsumer` 只删这个前缀的目录 |
| 仓库 `node_modules` | 探针不依赖仓库 `node_modules`。干净消费者在工作区外，类型检查与构建不可能经由 workspace 链接命中仓库未提交改动 |

**以上差异只影响「在哪里跑」，不影响「测的是什么」**：被测物始终是同一份冻结 tarball（摘要见第五节），环境差异全部进 `environmentKey`，跨环境不判视觉通过。
