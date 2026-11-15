# A：二期组件档案审计与离线评估准备验证记录

验证日期：2026-11-15  
隔离工作区：`C:\Users\10208\.codex\worktrees\a-phase2-profiles\zhinexus-design-asset-platform`  
分支：`feat/a-phase2-profiles`（基于 `fa24ab525e5945e7096ed816a83f11962ba5f000`）  
交付文件：
- `docs/phase2/component-profiles.md`
- `docs/phase2/evaluation-protocol.md`
- `docs/verification/a-phase2-profiles-2026-11-15.md`

---

## 1. 源码对照自审结论

1. **包版本与依赖核对**：已对照 `packages/charts-core/package.json`、`packages/charts-vue/package.json`、`packages/charts-react/package.json` 确认当前源码版本为 `0.0.10`，peer 精确依赖为 `vue@3.5.45`、`react@19.3.1`、`react-dom@19.3.1`、`echarts@6.1.0`。未将 `docs/verification/c-sdk14-acceptance-2026-11-13.md` 中的历史 `0.0.6` 验收结果作为 `0.0.10` 新验证。
2. **导出名与子路径核对**：已逐一对照 `packages/charts-vue/src/*.ts`、`*.vue` 与 `packages/charts-react/src/*.ts`、`*.tsx`，确认 7 个逻辑组件 14 个实现导出名分别为 `LineChart`、`BarChart`、`PieChart`、`ScatterChart`、`TrendCard`、`Ranking`、`Proportion`，并显式标注 `RankingChart.*` / `ProportionChart.*` 文件名与真实导出名 `Ranking` / `Proportion` 的差异。
3. **参数、事件与硬限制核对**：已对照 `packages/charts-core/src/{types,data,format,theme,controller}.ts` 及 `packages/charts-core/src/charts/{line,bar,pie,scatter,trend-card,ranking,proportion,option-overrides,scene-slots}.ts` 核对 Props、Config 默认值、`optionOverrides` 白名单（含 `pie` 收窄为 `tooltip`/`legend`/`title`）、`@point-click`/`onPointClick` 载荷 `ChartEvent`、`whenRendered()`、容器宽高要求、SSR 客户端挂载边界，以及 `pie`/`proportion` 拒绝负值、`scatter` 要求数值 `x`、`ranking`/`proportion` 单系列与唯一条目名限制。
4. **缺失信息与合成样本标注**：工作区 `0.0.10` 缺失的独立 `api.json`/`docs.md` 产物、在线 `variantReleaseId` 与视觉特征向量均如实标为 `unknown`；`docs/phase2/evaluation-protocol.md` 中的格式示例全部明确标注 `"origin": "synthetic"`，并明确声明当前**尚未具备 30 个真实标注样本**。
5. **范围与边界遵守**：未修改公共 `packages/contracts`、根配置、`pnpm-lock.yaml`、`README.md`、`CHANGELOG.md`、SDK 源码、历史验证记录或 `component-platform-architecture.md`。

---

## 2. 实际执行的窄范围检查与结果

以下命令均在隔离工作区通过 `.\scripts\pnpm.ps1`（`.tools` 固定 Node `26.13.0` / pnpm `12.18.0`）执行：

| 命令 | 目的 | 实际结果 |
| --- | --- | --- |
| `.\scripts\pnpm.ps1 install --frozen-lockfile` | 在隔离工作区安装只读依赖（不改锁） | 通过（exit 0，344 packages，锁文件无变更） |
| `.\scripts\pnpm.ps1 verify:workspace` | 校验 10 成员、无环与安全依赖边界 | 通过（exit 0，`Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`） |
| `.\scripts\pnpm.ps1 --filter @company/charts-core build` | 构建核心包生成类型声明供适配层类型检查 | 通过（exit 0） |
| `.\scripts\pnpm.ps1 --filter @company/charts-core typecheck` | 核心包 TypeScript 类型检查 | 通过（exit 0） |
| `.\scripts\pnpm.ps1 --filter @company/charts-vue typecheck` | Vue 3 适配层 `vue-tsc` 类型检查 | 通过（exit 0） |
| `.\scripts\pnpm.ps1 --filter @company/charts-react typecheck` | React 19 适配层 TypeScript 类型检查 | 通过（exit 0） |
| `git status --short` / `git diff --check` | 核对变更范围与行尾空白 | 通过（仅新增 `docs/phase2/` 与本验证文件，无空白/行尾异常） |

---

## 3. 未覆盖边界

- 本轮仅交付文档规范与只读审计结果，未新增或修改 SDK 运行时代码、Vitest 单元测试或 Playwright 浏览器测试。
- 未运行全量 `.\scripts\pnpm.ps1 test`、`test:browser`、`test:platform` 及三存储基础设施检查（本任务不涉及平台服务或一期构建发布）。
- 尚未采集或标注 30 个真实业务设计稿评估样本，真实 `tests/evaluation/design-cases.json` 与 T13/T14 检索/装配代码待后续阶段推进。
