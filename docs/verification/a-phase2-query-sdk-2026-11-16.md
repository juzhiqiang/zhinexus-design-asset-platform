# A / P2 二期组件查询双框架 SDK 验收矩阵验证记录

- **执行日期**：2026-11-16
- **负责角色**：A（Antigravity）
- **工作树**：`C:/Users/10208/.codex/worktrees/phase2-a-sdk/zhinexus-design-asset-platform`
- **分支 / 基线**：`chore/phase2-a-sdk-matrix`（基线 `981ba7a529d5d75587d4d1b4606d22cd754401c5`）
- **冻结 bundle 输入**：`D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`

## 1. TDD 验证记录

### RED 阶段（先写测试，确认因缺少 fixture 模块而预期失败）

- **执行命令**：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/component-query-sdk.test.ts`
- **退出码**：`1`
- **输出摘要**：
  - `Test Files  1 failed (1)`
  - `Error: Cannot find module '../fixtures/component-query-sdk.js' imported from .../tests/evaluation/component-query-sdk.test.ts`

### GREEN 阶段（实现矩阵与冻结校验后通过）

- **执行命令**：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/component-query-sdk.test.ts`
- **退出码**：`0`
- **输出摘要**：
  - `✓ tests/evaluation/component-query-sdk.test.ts (8 tests) 43ms`
  - `Test Files  1 passed (1)`
  - `Tests  8 passed (8)`
- **覆盖用例**：
  1. 导出 7 类 × 2 框架共 14 项独立预期矩阵且字段完整（含 `Ranking` / `Proportion` 导出核对）。
  2. 独立核对 `packages/charts-vue` 与 `packages/charts-react` 源码导出、事件类型（`point-click` / `onPointClick`）、样式导出（`./style.css`）、`whenRendered` 与 `data` 必填属性。
  3. 反例：遗漏框架实现（缺 `ranking:react`）被拒绝。
  4. 反例：重复 `(componentId, framework)` 键被拒绝。
  5. 反例：错误事件名（Vue 使用 `onPointClick` 或 React 使用 `point-click`）被拒绝。
  6. 反例：错误导出名（`RankingChart`）或错误导出路径（`./proportion-chart`）被拒绝。
  7. 反例：混用 `@company/charts-core`（`0.0.11`）与框架包（`0.0.12`）版本或错误 SHA-256 被拒绝。
  8. 冻结 bundle `manifest.json`、199 个文件（185 个 manifest 引用文件全量 SHA-256/字节数校验 + 14 个 `reports/*.json`）及 14 个 `api/*.json` 核对通过。

## 2. 冻结材料核对证据

- **文件总数**：bundle 目录共 200 个文件，其中 `manifest.json` 1 个，其余 199 个文件（185 个 manifest 引用文件 + 14 个 `reports/*.json`）全部核对存在，185 个引用文件 SHA-256 与字节数 `0` 不匹配。
- **逐包版本与 SHA-256**：
  - `@company/charts-core`：`0.0.11`，SHA-256 `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb`
  - `@company/charts-vue`：`0.0.12`，SHA-256 `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9`
  - `@company/charts-react`：`0.0.12`，SHA-256 `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28`
- **产品缺陷检查**：未发现 SDK 源码与冻结产物之间的导出、事件或样式缺陷；未重新打包，未修改产品源码、contracts 或版本号。

## 3. 未覆盖项与后续交接边界

- 本阶段（P2）仅完成真实 SDK 源码审计、14 项独立预期矩阵与冻结 bundle 材料核对；尚未对接 P0 冻结后的 `ComponentMatchQueryV1` / `ComponentMatchResponseV1` DTO。
- 真实 HTTP `GET /v1/matching/components`、隔离 PostgreSQL/MinIO/Verdaccio 服务及 Gallery 联调不在 P2 范围，留待 P1（B）、P3（D）与 P4（C）集成验收。
