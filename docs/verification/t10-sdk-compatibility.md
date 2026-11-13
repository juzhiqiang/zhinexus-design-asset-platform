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

## 六、未覆盖边界

- Windows 开发机原生验证（`.\scripts\verify.ps1`）未执行；本记录全部来自 Linux 复现环境。
- 真实三存储（Verdaccio / PostgreSQL / MinIO）与 OIDC 不在本机可用范围，`compatibility_records` 的 `'passed'` 无法落库。
- B 侧 CLI `component echarts check` / `verify` 命令与 `upgrades/{resolve,matrix,report}.ts` 不在本轮范围（B 主责）；A 侧只提供 `charts-core` 的策略函数与接口约定。
- 6.0.0 的视觉回归未做，因此即便类型/运行/交互全过，也不能据此扩大支持范围。
