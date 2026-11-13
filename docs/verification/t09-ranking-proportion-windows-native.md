# T09 第五批排行榜与占比：Windows 原生复验清单

日期：2026-11-13。负责人：A（SDK）。分支：`feat/t09-ranking-proportion`。任务定义见 [实现计划 T09](../superpowers/plans/2026-11-11-component-platform-implementation.md)，接口以 [T09 第五批对齐件](../superpowers/specs/2026-11-13-sdk-ranking-proportion-protocol.md) 为准。

[T09 第五批验证记录](t09-ranking-proportion.md) 在 Linux 复现环境中执行，其「未覆盖边界」写明：Windows 开发机原生确认仍建议执行一次。本文就是这次原生复验的**可执行清单与回填模板**，与 [柱状图](t09-bar-windows-native.md)、[散点图](t09-scatter-windows-native.md)、[趋势卡片](t09-trend-card-windows-native.md) 同一模式。

## 状态：阻塞（非失败）

本清单由 A 侧代理会话整理。该会话的命令环境是 Linux 沙箱，无法调用 PowerShell，因此**无法代替用户在 Windows 开发机上执行下列命令**；本文不声称 Windows 原生验证已通过。已通过的证据仍以 Linux 复现环境记录为准（工具链版本一致：Node `26.13.0`、pnpm `12.18.0`、Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`、Vitest `5.1.0`、Playwright + Chromium headless shell）。

执行环境要求（`rules/platform.md`）：Windows 10/11 x64；仓库 `.tools/` 已由 `.\scripts\bootstrap.ps1` 引导固定工具链；不要修改系统全局 Node / pnpm。本批在 Windows 上还有一项额外关注点：`ranking.ts` 与 `RankingChart.tsx` 的输出文件名只差大小写，NTFS 大小写不敏感，组件文件因此已命名为 `RankingChart.*`；若原生构建报 `TS5056: ... would be overwritten by multiple input files`，说明出现了新的只差大小写的源文件对，需按同一模式改名。

## 一、全量入口（一条命令覆盖六个阶段）

在仓库根目录（`D:\project\zhinexus-design-asset-platform`）执行：

```powershell
.\scripts\verify.ps1
```

该脚本按顺序调用 `.\scripts\pnpm.ps1` 执行 `install --frozen-lockfile` → `verify:workspace` → `build` → `typecheck` → `test` → `test:browser`，并在缺失时把 `NEXT_PUBLIC_SITE_URL` 设为 `https://gallery.test`（B/C 既有约定）。任一步骤非零退出即抛错停止。

预期结果（Linux 复现环境实测值，Windows 应完全一致）：

| 阶段 | 预期 |
| --- | --- |
| `install --frozen-lockfile` | 锁文件与 `package.json` 一致，不修改 `pnpm-lock.yaml` |
| `verify:workspace` | `Workspace verified: 10 members, no cycles, four publishable shells, safe service graph` |
| `build` | 10 tasks successful |
| `typecheck` | 14 tasks successful + 根 `tsc -p tsconfig.json --noEmit` 通过 |
| `test` | 除 `cli-release`（需本地 PostgreSQL / MinIO / Verdaccio，既有失败）外全部通过；`tests/integration/cli-bundle.test.ts` 需 14 变体全绿 |
| `test:browser` | 117 passed（main 基线 89 + 本批新增 28） |

`test:browser` 会自行拉起 `5173`（gallery 预览）、`5174`（Vue 示例）、`5175`（React 示例）、`5176`（React 开发态 StrictMode）四个服务，执行前必须确认这些端口未被占用。若本机 `.tools/playwright` 未安装浏览器，先执行一次 `.\scripts\bootstrap.ps1`。

## 二、排行榜与占比专项窄范围命令（便于定位差异）

全量通过可跳过本节；若全量失败，用这些命令把范围缩到本批：

```powershell
# 单元语义（105 项：既有 68 + 本批 37）
.\scripts\pnpm.ps1 exec vitest run tests/unit/chart-semantics.test.ts

# 浏览器矩阵（本批 28 项）
.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts --grep "ranking"
.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts --grep "proportion"

# 冻结 tarball 消费者验收（./ranking 与 ./proportion 子路径）
.\scripts\pnpm.ps1 exec vitest run tests/integration/packed-consumer-frameworks.test.ts

# 发布材料（7 组件 × 2 框架 = 14 变体，平台逐导出校验）
.\scripts\pnpm.ps1 exec vitest run tests/integration/cli-bundle.test.ts
```

本批应特别关注的断言：

| 关注点 | 位置 |
| --- | --- |
| 并列名次 `1,2,2,4` | `chart-semantics.test.ts` 的 `computeRanking 排序与并列语义`；浏览器层经 `categoryLabels()` 断言 `1. 柱状图` / `1. 饼图` / `3. 折线图` |
| `limit` 截断与名次计算时机 | 同上；统计行 `共 6 项 · 取前 5 名` |
| 占比零总量「暂无数据」 | `chart-semantics.test.ts` 的 `占比 option 构建`；浏览器层 `proportion_zero_total_shows_no_data` |
| 缺失值不进占比分母 | 浏览器层 `proportion_missing_values_are_excluded_from_total`（总量 300 → 280） |
| 占比不排序 | 浏览器层 `proportion_keeps_input_order` |
| 负值 / 多系列 / 同名条目拒绝 | `chart-semantics.test.ts` 的 `ChartDataError` 断言 |
| 平台不拒收 Bundle | `cli-bundle.test.ts` 的逐导出覆盖回归护栏 |

### 2026-11-13 追加：T09 收口与 T10 新增范围

T09 收口核对补上了两处证据缺口，Windows 原生复验需一并覆盖（详见 [T09 SDK 证据核对](t09-sdk-evidence-audit.md) 与 [T10 SDK 兼容验证](t10-sdk-compatibility.md)）：

```powershell
# light/dark × Canvas/SVG 在 14 个实现上的矩阵（56 例）
.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts presentation-matrix

# core 层主题/渲染器重建覆盖全部 7 种图表类型（11 例）
.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts core-lifecycle

# ECharts 升级候选的精确兼容策略（20 例）
.\scripts\pnpm.ps1 exec vitest run tests/unit/sdk-compatibility.test.ts
```

人工核对新增入口：示例页现在接受 `?theme=dark&renderer=svg` 查询参数，可直接在地址栏切换，例如 `http://127.0.0.1:5174/ranking.html?theme=dark&renderer=svg` 与 `http://127.0.0.1:5175/ranking.html?theme=dark&renderer=svg`。未识别的值回退 `light` + `canvas`。

预期用例数（Linux 复现环境全量实测值，Windows 应完全一致）：`pnpm exec playwright test --config tests/playwright.config.ts` 合计 **185 passed**（基线 122 + 本轮新增 63，其中 `presentation-matrix` 56 例、`core-lifecycle` 由 4 增至 11 的 7 例）；`sdk-compatibility` 20 passed。基线 122 与 C 在 Windows 于 `885792b` 测得的 122 相同，可直接对照。

#### 待原生复验的提交（截至 2026-11-13 收尾）

分支 `feat/t10-sdk-compatibility` 上相对基线 main `885792b` 的六个提交，**均未做 Windows 原生验收**：

| 提交 | 内容 |
| --- | --- |
| `383d165` | T09 展示矩阵证据：14 个示例页支持 `?theme=&renderer=`，新增 `presentation-matrix.spec.ts` 56 例，`core-lifecycle` 增加 7 例 |
| `6ba03e7` | T10 兼容策略模块 `packages/charts-core/src/engine/compatibility.ts` 及导出 |
| `96b9cd4` | 文档：T09 证据核对、T10 兼容验证、升级与回退、A 侧 G1 回执 |
| `afa92ad` | 测试：`upgrade-policy.test.ts` → `sdk-compatibility.test.ts` 更名，两处类型声明修正 |
| `bf0bfa1` | 三个图表包版本号 `0.0.6` → `0.0.7`（含 CHANGELOG） |
| `f35ebc9` | 文档：版本边界（0.0.7 工作树 / 0.0.6 末次原生验收）与测试归属说明 |

全图入口（推荐先跑这一条，再用上面的窄命令定位）：

```powershell
.\scripts\verify.ps1
```

**注意**：C 于 2026-11-13 完成的 Windows 原生验收覆盖的是基线 `885792b` / SDK `0.0.6`，**不包含**上表六个提交。上表任一提交进入 main 之前，都需在含这些提交的分支上重跑 `.\scripts\verify.ps1` 并回填本节。

## 三、人工目视检查（截图无法覆盖的判断）

Linux 复现环境只验证 option 结构与浏览器自检，不生成人工截图。请在 Windows 上打开下列页面各看一眼：

- `http://127.0.0.1:5174/ranking.html` 与 `http://127.0.0.1:5175/ranking.html`：类目轴标签是否带名次且榜首在最上方；条末数值是否未被裁切；切到 `empty` 是否显示「暂无数据」且不残留「共 N 项」。
- `http://127.0.0.1:5174/proportion.html` 与 `http://127.0.0.1:5175/proportion.html`：条末是否同时显示值与百分比；切到 `zero-total` 是否显示「暂无数据」；百分比之和是否约等于 100%。
- 深色主题：把示例 config 的 `theme` 改为 `'dark'`，确认 graphic 摘要文字与条形对比度可读。
- 两框架页面并排比对：同一状态下条形长度、标签文本与顺序应完全一致。

## 四、回填模板

执行完后请把下表补到 [T09 第五批验证记录](t09-ranking-proportion.md) 的「未覆盖边界」之后（或直接在本文回填后告知 A 侧）：

```markdown
### Windows 原生复验回填（2026-11-13）

- 执行人：
- 机器 / 系统：
- `.\scripts\verify.ps1` 结果：（全绿 / 失败阶段与输出）
- `test` 文件与用例数：
- `test:browser` 用例数：
- `cli-bundle` 14 变体是否全绿：
- 人工目视检查结论：
- 与 Linux 复现环境的差异（若有）：
```

## 五、仍然成立的注意事项

- **不要手动上传截图充当自动验证**：网页发布路径要求每个实现的截图来源为 `manual-upload`，不得伪造 `local-automatic`（`AGENTS.md` 不可违反约束）。
- **同一份 tarball 的 SHA-256 必须贯穿安装、截图、报告、上传与发布**：本批候选摘要见 [T09 第五批验证记录](t09-ranking-proportion.md) 第 4 节；若重新打包，摘要变化必须重新验证。
- **后续批次新增图表时**：SDK 加子路径导出必须同批扩展 `component-cli` 的 `COMPONENT_ENTRY_HTML` / `COMPONENT_EXPORT` / 默认 `components` 与 `capture.ts` 选择器，以及 `cli-bundle` / `cli-release` / `http-support` 三处清单，否则平台以 `ARTIFACT_MISMATCH` 拒绝 Bundle。
