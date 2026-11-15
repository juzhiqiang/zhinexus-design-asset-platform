# A2：二期离线评分器实现与验证记录（2026-11-15）

验证日期：2026-11-15  
隔离工作区：`C:\Users\10208\.codex\worktrees\a-phase2-profiles\zhinexus-design-asset-platform`  
分支：`feat/a-phase2-profiles`（基于 `5a81a43b79d8d50eff1553cccc960470a72c5e79`）  
参考计划：`docs/superpowers/plans/2026-11-15-phase2-candidates.md`（A2）及 `docs/phase2/evaluation-protocol.md`  
新增文件：
- `tests/evaluation/scoring.ts`
- `tests/evaluation/scoring.test.ts`
- `docs/verification/a-phase2-scoring-2026-11-15.md`（本文件）

> 注：未修改 `packages/contracts`、SDK 源码、根配置/锁文件或任何历史验证/审查记录。

---

## 1. 实现范围与设计边界

1. **内部测试工具类型（非公共 DTO）**：`scoreEvaluation(cases, observations)` 及相关类型仅在 `tests/evaluation/scoring.ts` 内导出，不进入 `@company/contracts`。
2. **指标与隔离规则**：
   - 严格按 `origin`（`real` vs `synthetic`）隔离统计，顶层 `passed` 仅由 `real` 组决定；`synthetic` 组 `passed` 恒为 `false`。
   - 任一比率指标分母为 `0` 时返回 `value: null`、`display: 'N/A'`，且 `passed: false`。
   - `Top-5` 仅取 `top5VariantIds.slice(0, 5)`，且分母覆盖组内所有 `acceptableVariantIds` 非空案例（不限 `category`）。
   - `gapRecall` 按所需字段集合去重计分，观测重复上报不重复加分。
   - 硬违规按案例计数（`hardViolations.length > 0`），且硬违规案例不计入有效 Top-5 命中或无匹配拒绝命中。
   - 缺 `observation` 计入 `missingObservations` 与失败明细，不静默忽略；重复 `caseId`、未知 `observation`、重复 `observation` 及非法字段抛出 `EvaluationInputError`。
   - `real` 组须同时满足 `totalCases >= 30`、`trapCases >= 10`、`missingObservations === 0`、`hardViolationCases === 0`、`top5 >= 0.8`、`gapRecall >= 0.9` 才为 `passed: true`。

---

## 2. TDD 与实际验证命令结果

以下命令均在隔离工作区通过 `.\scripts\pnpm.ps1`（`.tools` 固定 Node `26.13.0` / pnpm `12.18.0`）执行：

| 阶段 / 命令 | 目的 | 实际结果 |
| --- | --- | --- |
| RED：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/scoring.test.ts` | 验证未实现 `scoring.ts` 时先失败 | 预期失败（exit 1，`Cannot find module './scoring.js'`） |
| GREEN：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/scoring.test.ts` | 验证离线评分器 8 项边界行为 | 通过（exit 0，1 file / 8 passed） |
| `.\scripts\pnpm.ps1 build:services` | 生成合约与服务端编译产物作为根 `tsc` 前置 | 通过（exit 0，5 tasks） |
| `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 根 `tsconfig.json`（含 `tests/evaluation/*.ts`）类型检查 | 通过（exit 0，无类型错误） |
| `.\scripts\pnpm.ps1 verify:workspace` | 校验工作区 10 成员、无环与依赖边界 | 通过（exit 0，`Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`） |

---

## 3. 未覆盖边界

- `tests/evaluation/scoring.test.ts` 中为覆盖 `real` 组 30 样本 / 10 陷阱门槛逻辑而构造的模拟输入均属 **synthetic 单测夹具**，**不代表仓库已具备 30 个真实业务标注样本**。
- 本评分器仅消费显式人工标注与观测数组，不调用外部模型，也不声称自动检测语义/兼容硬违规。
- 未运行全量 `test`、`test:browser` 或 `test:platform` 套件。
