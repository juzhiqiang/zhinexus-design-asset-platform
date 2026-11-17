# A / T15 P2 补充复核验证记录（2026-11-17）

- **执行日期**：2026-11-17
- **负责角色**：A（Antigravity）
- **工作树**：`C:/Users/10208/.codex/worktrees/t15-a-project-matrix/zhinexus-design-asset-platform`
- **分支 / 基线**：`chore/t15-a-project-matrix` / `c3c90e3dbd2bf8516ad427c98efb616e692b8233`

## 1. 复核背景与历史记录澄清

- 历史记录 [a-t15-project-matrix-2026-11-17.md](a-t15-project-matrix-2026-11-17.md) 保持原样不改写；需要明确指出，该文档第 2 节所记初次 RED（`Cannot find module '../fixtures/phase3-projects/cases.js'`，`0 test`）属于缺模块导致的**测试收集失败**，而非行为 RED。
- 本次复核独立对照 `docs/superpowers/specs/2026-11-16-phase3-t15-design.md`（「首轮支持与行为」第 5 条）与 `docs/verification/c-t15-contracts-2026-11-17.md`（P0 `LocalProjectInspectionV1`）：宿主缺少 `echarts` 时，允许后续 `plan` 采用 `MatchPlan` 明确候选版本进入只读计划并重新查询，因此本地 `inspect` 应保持 `status: 'inspected'` 且 `resolvedDependencies` 不伪造 `echarts`，不应仅因缺 `echarts` 标记 `ECHARTS_MISSING` / `conflicted`。
- 为保持引用与真实工具锁快照字节不变，保留 `conflict-missing-echarts` 作为兼容 `caseId` 与 `lockSnapshotDir` 名称，并在矩阵文档中显式说明。

## 2. 实际行为 RED → GREEN 验证记录

### 行为 RED（先在测试补充断言，旧 `cases.ts` 仍返回 `ECHARTS_MISSING` / `conflicted`）

- **执行命令**：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts`
- **退出码**：`1`
- **输出摘要**：
  - `1 failed | 5 passed (6)`
  - `FAIL tests/evaluation/phase3-project-matrix.test.ts > P2 三期独立项目矩阵与双框架 SDK 审计 > 缺 ECharts 案例按 spec 第 5 条与 P0 契约保持 inspected 且不伪造 echarts 依赖`
  - `AssertionError: expected 'conflicted' to be 'inspected'`

### GREEN（修正 `cases.ts` 与矩阵文档后重跑）

- **执行命令**：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts`
- **退出码**：`0`
- **输出摘要**：详见下方最终运行结果（`1 passed (1)`、`6 passed (6)`）。
- **边界说明**：`tests/fixtures/phase3-projects/lock-snapshots/**` 原字节、CLI/contracts/根配置及历史验证记录均未改动，未重新 pack SDK。

## 3. 最终验证命令与退出码

- **Vitest**：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/phase3-project-matrix.test.ts` → 退出码 `0`（`Test Files  1 passed (1)`、`Tests  6 passed (6)`）
- **窄范围类型检查**：`.\scripts\pnpm.ps1 --% exec tsc --noEmit --ignoreConfig --target es2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck --types node tests/fixtures/phase3-projects/expected.ts tests/fixtures/phase3-projects/cases.ts tests/evaluation/phase3-project-matrix.test.ts` → 退出码 `0`（无错误输出）
- **格式与空白检查**：`git diff --check` → 退出码 `0`
