# ECharts 升级、兼容矩阵与回退

日期：2026-11-13。负责人：A（SDK）。任务定义见 [T10 实施计划](../superpowers/plans/2026-11-11-component-platform-implementation.md)。
本文件是 T10 的**升级差异、兼容矩阵口径与回退交接材料**；本轮实测证据见 [T10 SDK 兼容验证记录](verification/t10-sdk-compatibility.md)。

## 1. 当前基线（不可随意变动）

| 项 | 值 |
| --- | --- |
| ECharts | `6.1.0`（根 `pnpm-lock.yaml` 锁定，`packages/charts-core` 的 `peerDependencies.echarts` 与 `devDependencies.echarts` 同为 `6.1.0`） |
| zrender | `6.1.0`（echarts 6.1.0 的运行时依赖，随 echarts 一起锁定） |
| Vue | `3.5.45` |
| React / ReactDOM | `19.3.1` |
| 组件包 | `@company/charts-core` / `charts-vue` / `charts-react` 均 `0.0.6` |
| 工具链 | Node `26.13.0`、pnpm `12.18.0`（`.tools/` 固定） |

`rules/platform.md` 规定：任何扩大或缩减兼容版本范围的改动，必须同步更新兼容矩阵测试与 `compatibility_records`。**本文件不构成扩大范围的授权**——扩大范围必须是人在审阅实测报告后的显式动作。

## 2. 兼容策略在 SDK 侧如何落地

`packages/charts-core/src/engine/compatibility.ts` 提供纯策略，网络与文件系统都留给 B 侧 CLI（`component echarts verify`），两边不重复实现：

- `resolveCandidate(input, registry)`：`'latest'` 或精确版本 → `{ version, integrity, releaseNotesSource, source }`。五条拒绝路径全部显式：非精确字面量、预发布、官方源不存在、缺 `dist.integrity`；`latest` 命中预发布时**不会**回退到上一个稳定版。
- `candidateSatisfiesPeer(candidate, peer)`：`peerDependencies` 锁定精确版本，符合性即版本相等。候选低于基线（回退）或高于基线（未验证新版本）都不算符合。
- `verifyCandidate(candidate, supported, probe)`：对每个已支持组合跑注入的探针，汇总**类型 / 运行 / 交互 / 视觉**四维结果与差异。报告恒带 `supportedRangeUnchanged: true`，且**不提供任何「建议的新支持范围」字段**。
- `recommend(report, supported)` / `hasDualFrameworkCoverage(report, supported)`：只有「peer 符合 + 双框架齐验 + 四维全过 + 无差异」才返回 `'adopt'`，其余一律 `'hold'`。共享核心变化少任何一个已支持框架的实测结果即 `'hold'`。

配套测试 `tests/unit/upgrade-policy.test.ts`（20 例）先红后绿，锁定上述纪律。

**候选失败不得扩大 peer 范围**在三个层次上都有实证，不是一句口号：

1. **安装层**：把冻结的 `0.0.6` tarball 与 `echarts@6.0.0` 一起安装，`npm install` 直接 `ERESOLVE`（`peer echarts@"6.1.0" from @company/charts-vue@0.0.6` / `@company/charts-react@0.0.6`），退出码 1，任何代码都不会跑起来。
2. **策略层**：`verifyCandidate` 的报告里 `peerSatisfied === false`、`supportedRangeUnchanged === true`、`suggestedPeerRange === undefined`，`recommend` 返回 `'hold'`。
3. **类型层**：见第 4 节的潜在脆弱点——即便绕过 peer 检查，`skipLibCheck: false` 的消费者会在 6.0.0 上拿到真实的类型解析失败。

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

验证顺序（与 `rules/testing-release.md` 一致）：`verify:workspace` → `build` → `typecheck` → `test` → `test:browser`。本基线在 Linux 复现环境下的实测值：build 10 tasks、typecheck 14 tasks + 根 `tsc`、`test:browser` 173 passed（main 基线 117 + 本轮新增 56）、`core-lifecycle` 11 passed、`upgrade-policy` 20 passed。Windows 开发机应以 `.\scripts\verify.ps1` 复跑并回填，Linux 结果**不**等同于 Windows 原生通过。

### 6.3 产物侧

已发布版本不可变：`0.0.6` 的三个 tarball 一旦发布到 Verdaccio 即冻结，回退只能通过「继续安装 `0.0.6`」实现，不能覆盖或删除重发。若需要修复，递增 `PATCH` 发布新版本，并通过平台把旧版本标记为 `deprecated`。同一份 tarball 的 SHA-256 必须贯穿安装、截图、报告、上传与发布。

## 7. 待办与边界

- **Windows 原生复验未执行**：本文件所有实测均在 Linux 复现环境完成（工具链版本一致）。Windows 原生清单见 [T09 第五批 Windows 原生复验清单](verification/t09-ranking-proportion-windows-native.md)，需由 C 在 Windows 开发机执行并回填。
- **真实三存储闭环未执行**：Verdaccio / PostgreSQL / MinIO 与 OIDC 不在本机可用范围，`compatibility_records` 的 `'passed'` 状态只能在真实注册表与报告上传链路打通后落库。
- **上游新版本未出现**：官方 `latest` 与基线同版本，跨版本升级矩阵待上游发版后重跑。
