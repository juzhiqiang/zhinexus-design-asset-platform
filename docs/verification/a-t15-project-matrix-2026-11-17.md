# A / T15 P2 独立项目矩阵与双框架预期验证记录

- **执行日期**：2026-11-17
- **负责角色**：A（Antigravity）
- **工作树**：`C:\Users\10208\.codex\worktrees\t15-a-project-matrix\zhinexus-design-asset-platform`
- **分支 / P0 基线**：`chore/t15-a-project-matrix` / `31ae120a270e84ab7c100d3ad77919b233d1d48b`

## 1. 工具链与真实锁生成记录

- **Node**：`.tools/node-v26.13.0-win-x64/node.exe`（`v26.13.0`）
- **npm**：`.tools/node-v26.13.0-win-x64/node_modules/npm/bin/npm-cli.js`（`11.20.0`），隔离临时目录执行 `install --package-lock-only --ignore-scripts`，生成 5 份 `npm-v3` `package-lock.json` 快照。
- **pnpm**：`scripts/pnpm.ps1`（`12.18.0`），隔离临时目录执行 `install --lockfile-only --ignore-scripts`，生成 5 份 `pnpm-v9` `pnpm-lock.yaml` 快照。
- **产物路径**：`tests/fixtures/phase3-projects/lock-snapshots/`（共 10 个快照目录，不纳入 pnpm workspace 成员）。

## 2. TDD RED → GREEN 验证记录

### RED 阶段（先写测试，确认因缺少矩阵模块而预期失败）

- **执行命令**：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts`
- **退出码**：`1`
- **输出摘要**：
  - `Test Files  1 failed (1)`
  - `Error: Cannot find module '../fixtures/phase3-projects/cases.js' imported from .../tests/evaluation/phase3-project-matrix.test.ts`

### GREEN 阶段（实现矩阵、真实锁对齐校验与多文档 YAML 解析后通过）

- **中间发现**：`pnpm 12.18.0` 在 `package.json` 含 `packageManager` 字段时会生成多文档 `pnpm-lock.yaml`（`---` 分隔 `packageManagerDependencies` 与 `importers`），已改用 `yaml` 的 `parseAllDocuments` 读取。
- **执行命令**：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts`
- **退出码**：`0`
- **输出摘要**：
  - `✓ tests/evaluation/phase3-project-matrix.test.ts (5 tests) 349ms`
  - `Test Files  1 passed (1)` / `Tests  5 passed (5)`
- **类型检查（本轮新增 TS 文件）**：
  - 命令：`.\scripts\pnpm.ps1 --% exec tsc --noEmit --ignoreConfig --target es2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck --types node tests/fixtures/phase3-projects/expected.ts tests/fixtures/phase3-projects/cases.ts tests/evaluation/phase3-project-matrix.test.ts`
  - 退出码：`0`（无错误输出）

## 3. 未覆盖项与交接边界

- 本阶段（P2）所有 14 个项目工程均为 `synthetic` 合成案例，不代表两个真实业务试点完成。
- `component integrate inspect` / `plan` 的真实 CLI 产品行为、只读性黑盒验证与隔离 Nest/PG/MinIO/Verdaccio 联调不在 P2 范围，交由 B（P1）、D（P3）与 C（P4）消费 `projectCases` 与 `createProjectCase` 完成。
