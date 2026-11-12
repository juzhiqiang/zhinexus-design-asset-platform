# T09 第三批散点图：Windows 原生复验清单

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-scatter`（已合入 `main`）。任务定义见 [实现计划 T09](../superpowers/plans/2026-11-11-component-platform-implementation.md)，接口以 [T09 第三批对齐件](../superpowers/specs/2026-11-12-sdk-scatter-chart-protocol.md) 为准。

[T09 第三批验证记录](t09-scatter.md) 与 [合并主分支全图验证记录](t09-scatter-main-merge-2026-11-12.md) 都在 Linux 复现环境中执行，两份记录的「未覆盖边界」都写明：Windows 开发机原生确认（`.\scripts\pnpm.ps1 test` / `test:browser`）仍建议执行一次。本文就是这次原生复验的**可执行清单与回填模板**，与 [柱状图 Windows 原生复验清单](t09-bar-windows-native.md) 同一模式。

> 注：自本批之后 main 又合入了 T09 第四批趋势卡片（0.0.5）。本文的命令与预期值以**当前 main** 为准，趋势卡片已包含在全量入口的预期计数中；若在合入趋势卡片之前执行，请按当日的 `pnpm test` / `test:browser` 实际计数比对，或先合并 `feat/t09-trend`。

## 状态：阻塞（非失败）

本清单由 A 侧代理会话整理。该会话的命令环境是 Linux 沙箱，无法调用 PowerShell，因此**无法代替用户在 Windows 开发机上执行下列命令**；本文不声称 Windows 原生验证已通过。已通过的证据仍以两份 Linux 复现环境记录为准（工具链版本一致：Node `26.13.0`、pnpm `12.18.0`、TypeScript `7.0.2`、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright `1.65.0` + Chromium headless shell）。

执行环境要求（`rules/platform.md`）：Windows 10/11 x64；仓库 `.tools/` 已由 `.\scripts\bootstrap.ps1` 引导固定工具链；不要修改系统全局 Node / pnpm。

## 一、全量入口（一条命令覆盖六个阶段）

在仓库根目录（`D:\project\zhinexus-design-asset-platform`）执行：

```powershell
.\scripts\verify.ps1
```

该脚本按顺序调用 `.\scripts\pnpm.ps1` 执行 `install --frozen-lockfile` → `verify:workspace` → `build` → `typecheck` → `test` → `test:browser`，并在缺失时把 `NEXT_PUBLIC_SITE_URL` 设为 `https://gallery.test`（B/C 既有约定，见 `tests/browser/gallery-rendering.spec.ts`）。任一步骤非零退出即抛错停止。

预期结果（Linux 复现环境实测值，Windows 应完全一致；计数含 T09 第四批趋势卡片）：

| 阶段 | 预期 |
| --- | --- |
| `install --frozen-lockfile` | 锁文件与 `package.json` 一致，不修改 `pnpm-lock.yaml` |
| `verify:workspace` | `Workspace verified: 10 members, no cycles, four publishable shells, safe service graph` |
| `build` | 10 tasks successful |
| `typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `test` | 23 files / 512 tests passed，4 skipped（`tests/tooling/verify.test.ts` 既有跳过） |
| `test:browser` | 86 passed |

`test:browser` 会自行拉起 `5173`（gallery 预览）、`5174`（Vue 示例）、`5175`（React 示例）、`5176`（React 开发态 StrictMode）四个服务，执行前必须确认这些端口未被占用（`rules/platform.md`）。若本机 `.tools/playwright` 未安装浏览器，先执行一次 `.\scripts\bootstrap.ps1`。

## 二、散点图专项窄范围命令（便于定位差异）

全量通过可跳过本节；若全量失败，用这些命令把范围缩到散点图：

```powershell
# 工作区边界（无散点图专属内容，作为前置门槛）
.\scripts\pnpm.ps1 verify:workspace

# 散点图 option 语义（16 项）+ 共享数据规则（12 项）
.\scripts\pnpm.ps1 exec vitest run tests/unit/chart-semantics.test.ts tests/unit/chart-data.test.ts

# 双框架散点图浏览器矩阵（13 项：5174 / 5175 各 5 项 + 跨框架点击等价 + StrictMode 重挂载 + Vue 重挂载）
.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts component-matrix

# 折线图无回归（core 生命周期 4 项 + 双框架生命周期 4 项）
.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts core-lifecycle framework-lifecycle

# 工作区外真实 tarball 消费者（10 项，含 ./line / ./bar / ./pie / ./scatter / ./trend-card 的 Node 导入、多页构建、真实渲染与点击载荷）
.\scripts\pnpm.ps1 exec vitest run tests/integration/packed-consumer-frameworks.test.ts
```

预期逐项结果：`chart-semantics` 68 passed（含散点 16 项 + 趋势卡片 21 项）、`chart-data` 12 passed、`component-matrix` 86 passed、`core-lifecycle` + `framework-lifecycle` 8 passed、`packed-consumer-frameworks` 10 passed。

`packed-consumer-frameworks` 会执行 `pnpm pack` 冻结 tarball 并在工作区外临时目录安装；它依赖 `test-results/t03-bundle-baseline.json` 作为打包体积护栏（该文件由它自己写出，被 Playwright 的输出目录清理规则覆盖）。**必须先跑 `test:browser`、再单独跑这个 vitest 文件**，否则护栏基线缺失。

## 三、需要人工目视确认的项

自动化通过后，仍需人工确认（截图属于本地人工环节，不替代自动断言）：

1. `examples/vue/scatter.html`（`http://127.0.0.1:5174/scatter.html`）与 `examples/react/scatter.html`（`http://127.0.0.1:5175/scatter.html`）六个状态（`default` / `empty` / `missing` / `negative` / `single` / `updated`）下符号、缺失缺口与负值零轴以下区域的观感一致。
2. 两个框架 `default` 状态的截图在相同窗口尺寸下视觉等价（符号位置、双数值轴刻度、图例）。
3. 顺带核对 T09 第四批趋势卡片：`examples/{vue,react}/trend-card.html` 的 `default`（标题 + 大号当前值 + meta 行 + sparkline）、`down`（下降箭头为红）、`empty`（「暂无数据」且无 meta 行）三状态观感符合预期。
4. `getChecks()` 四项（`single-instance` / `no-page-error` / `series-match` / `renderer-match`）在每个状态下都是 `passed`——浏览器测试已断言，目视可复核页面无控制台报错。

## 四、回填模板

Windows 执行完后，把下列信息回复给 A 侧，由 A 追加到本文件（不改写已有记录，遵循 `AGENTS.md` 第 10 条）：

```
执行日期：
Windows 版本 / 架构：
Node 版本（node -v）：
pnpm 版本（pnpm -v）：
verify.ps1 结果：<逐阶段 exit code 或失败阶段与报错摘要>
窄范围命令结果：<逐条 passed/failed 计数>
与 Linux 复现环境的差异：<如有>
截图存放路径：<如有>
```

若任一步骤失败，**不要**回滚或改代码绕过；把失败输出原文反馈，A 侧按 TDD 补 RED 测试后再修。

## 五、未覆盖边界（沿用）

- 本文只覆盖散点图（含合入后的趋势卡片全量计数）；T09 后续批次（ranking / proportion）按 [散点对齐件第 6 节](../superpowers/specs/2026-11-12-sdk-scatter-chart-protocol.md) 同一模式扩展，每批都需重复本清单。
- `test:infra` 需要本地 PostgreSQL / Verdaccio / MinIO 容器，属 C 侧 G2 范围，不在本清单内。
- ECharts 兼容矩阵（T10）与真实双项目试点（T11）各自有独立的原生验证要求。
