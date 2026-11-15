# 修订验证记录：A3 Runner 失败错误分类脱敏（2026-11-15）

- 工作区：`C:\Users\10208\.codex\worktrees\a-phase2-profiles\zhinexus-design-asset-platform`
- 分支：`feat/a-phase2-profiles`
- 修改文件：`tests/evaluation/runner.ts`、`tests/evaluation/runner.test.ts`（不修改历史记录 `docs/verification/a3-evaluation-runner-2026-11-15.md`）

## 修订原因

原 `runEvaluationCli` 的 `catch` 分支直接将 `error.message` 输出至 `stderr`，会把未知参数、未知字段、非法 `split` 取值、重复 `caseId` 及 IO 文件路径等用户输入值回显到控制台，不符合不打印输入数据的安全边界。

## TDD 与验证实录

1. **RED 阶段**
   - 在 `tests/evaluation/runner.test.ts` 新增包含 `SECRET` 标记的 6 类回归场景（非法 `split`、未知字段、重复 `caseId`、不存在的 IO 路径、位置参数、未知参数）。
   - 命令：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/runner.test.ts`
   - 结果：exit code `1`（5 passed / 1 failed），确认 `stderr` 回显 `SECRET_SPLIT_TOKEN`。

2. **GREEN 阶段**
   - 修改 `tests/evaluation/runner.ts` 的 `runEvaluationCli`，按阶段/错误类型仅输出固定安全错误分类：
     - `evaluation failed: invalid arguments`
     - `evaluation failed: invalid input`
     - `evaluation failed: io error`
     - `evaluation failed: unexpected error`
   - 命令 1：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/scoring.test.ts tests/evaluation/runner.test.ts`
     - 结果：exit code `0`，共 `18 passed`（`runner.test.ts` 6 项 + `scoring.test.ts` 12 项）。
   - 命令 2：`.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`
     - 结果：exit code `0`。
   - 命令 3：`.\scripts\pnpm.ps1 verify:workspace`
     - 结果：exit code `0`（`Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`）。
