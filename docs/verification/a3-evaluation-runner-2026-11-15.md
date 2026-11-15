# 验证记录：A3 文件型离线评估 Runner（2026-11-15）

- 工作区：`C:\Users\10208\.codex\worktrees\a-phase2-profiles\zhinexus-design-asset-platform`
- 分支：`feat/a-phase2-profiles`
- 任务范围：A3（仅新增/修改 `tests/evaluation/runner.ts`、`tests/evaluation/runner.test.ts`、`docs/phase2/evaluation-runner.md`、`docs/verification/a3-evaluation-runner-2026-11-15.md`）
- 约束确认：复用 `tests/evaluation/scoring.ts`，未修改评分规则、公共契约、根配置、锁文件、版本号或他人工作区。

## TDD 与验证命令实录

### 1. RED 阶段（创建 `runner.test.ts`，尚未创建 `runner.ts`）

- 命令：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/runner.test.ts`
- 结果：exit code `1`，报错 `Cannot find module './runner.js'`，符合预期 RED。

### 2. GREEN 阶段（实现 `runner.ts` 后）

- 命令 1：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/scoring.test.ts tests/evaluation/runner.test.ts`
  - 结果：exit code `0`，2 个测试文件全部通过，共 `17 passed`（`runner.test.ts` 5 项 + `scoring.test.ts` 12 项）。
  - 覆盖要点：
    - 达标时写入报告并返回退出码 `0`，含原文件字节 `casesSha256` / `observationsSha256`、版本标识、`now` 注入 `generatedAt` 及 `real` / `synthetic` 分组，且 stdout 不泄露原始数据；
    - 合法但未达标（仅 `synthetic` 样本）时写入报告并返回退出码 `2`；
    - 缺失/重复/未知/位置参数返回退出码 `1`；
    - `schemaVersion !== 1`、顶层及条目未知字段、`split: 'train'`、未知 `caseId` 返回退出码 `1`；
    - 独占创建 `wx`：输出已存在或与输入文件相同时拒绝覆盖并返回退出码 `1`。
- 命令 2：`.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`
  - 结果：exit code `0`。
- 命令 3：`.\scripts\pnpm.ps1 verify:workspace`
  - 结果：exit code `0`（`Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`）。

## 未覆盖边界

- 当前仅具备文件型 runner 与单元测试，仓库内**尚无真实人工标注 30+ 样本集与线上搜索观测输出**，因此 **T14 仍未完成**。
- 实际 CLI 进程直接通过 `tsx tests/evaluation/runner.ts` 运行的端到端集成将随真实检索观测样本就绪后验证（当前核心入口 `runEvaluationCli` 已在 Vitest 中全覆盖）。
