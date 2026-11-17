# A / T15 P2 `conflict-missing-importer` 夹具复核记录（2026-11-17）

- **执行日期**：2026-11-17
- **负责角色**：A（Antigravity）
- **工作树**：`C:/Users/10208/.codex/worktrees/t15-a-project-matrix/zhinexus-design-asset-platform`
- **分支 / 基线**：`chore/t15-a-project-matrix` / `5a50856781e59489eb27234b88a11d28055a44bc`

## 1. 缺陷定位

- 独立消费 14 项目矩阵时发现：`conflict-missing-importer` 指定 `workspace: 'apps/missing-pkg'` 与 `expectedConflictCodes: ['IMPORTER_MISSING']`，但 `createProjectCase` 原 `subPackages` 仅创建了 `apps/chart-react`，未创建 `apps/missing-pkg/package.json`，导致真实检查器在进入锁 importer 校验前先触发 `WORKSPACE_INVALID`。
- 修复方式：在 `tests/fixtures/phase3-projects/cases.ts` 中为 `conflict-missing-importer` 的 `subPackages` 补充真实存在的 `apps/missing-pkg/package.json`（保留 `apps/chart-react` 与 `pnpm-workspace-explicit/pnpm-lock.yaml` 原字节不变，保留 `IMPORTER_MISSING` 预期，不导入 B 计算预期）。

## 2. 实际行为 RED → GREEN 验证记录

### 行为 RED（先补断言，旧 `cases.ts` 尚未创建 `apps/missing-pkg/package.json`）

- **执行命令**：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts`
- **退出码**：`1`
- **输出摘要**：
  - `1 failed | 6 passed (7)`
  - `FAIL tests/evaluation/phase3-project-matrix.test.ts > P2 三期独立项目矩阵与双框架 SDK 审计 > conflict-missing-importer 必须真实存在目标 workspace/package.json 且 pnpm 锁正文不含该 importer`
  - `AssertionError: expected false to be true`（`apps/missing-pkg/package.json` 不存在）

### GREEN（补充 `apps/missing-pkg` 子包后重跑）

- **Vitest**：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts` → 退出码 `0`（`Test Files  1 passed (1)`、`Tests  7 passed (7)`）
- **窄范围类型检查**：`.\scripts\pnpm.ps1 --% exec tsc --noEmit --ignoreConfig --target es2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck --types node tests/fixtures/phase3-projects/expected.ts tests/fixtures/phase3-projects/cases.ts tests/evaluation/phase3-project-matrix.test.ts` → 退出码 `0`
- **格式与空白检查**：`git diff --check` → 退出码 `0`
- **边界说明**：未修改真实锁快照原字节、CLI、contracts、根配置或历史验证记录。
