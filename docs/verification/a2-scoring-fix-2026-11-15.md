# A2：离线评分器边界修复与验证记录（2026-11-15）

修订日期：2026-11-15  
隔离工作区：`C:\Users\10208\.codex\worktrees\a-phase2-profiles\zhinexus-design-asset-platform`  
分支：`feat/a-phase2-profiles`（基于 `988db80ebad1113b72ac304872783ddd23e3a9c7`）  
变更文件：
- `tests/evaluation/scoring.ts`
- `tests/evaluation/scoring.test.ts`
- `docs/verification/a2-scoring-fix-2026-11-15.md`（本文件）

> 注：历史验证记录 `docs/verification/a-phase2-scoring-2026-11-15.md` 保持原样未修改。

---

## 1. 修复内容

1. **`noMatchRejectionRate` 门禁与零分母限制**：
   - 对齐 `docs/phase2/evaluation-protocol.md`，在 `real` 组 `passed` 条件中增加 `noMatchRejection.value !== null && noMatchRejection.value >= 0.9`，防止零分母或无匹配误报率过高时错误通过。
2. **稀疏数组空洞（hole）防御**：
   - 将 `tests/evaluation/scoring.ts` 的 `assertStringArray` 从 `Array.prototype.map` 改为 `for (let idx = 0; idx < value.length; idx += 1)` 并校验 `Object.hasOwn(value, idx)`，拒绝 `new Array(1)` 等稀疏数组空洞，防止 `undefined` 在 `Set` 中产生伪命中。
3. **补充边界与阈值测试用例**：
   - 在 `tests/evaluation/scoring.test.ts` 新增 `noMatchRejection` 零分母、`< 90%` 与 `= 90%`、`Top5 80%` 与 `gapRecall 90%` 精确边界，以及稀疏数组空洞拒绝共 4 项测试（总计 12 项）。

---

## 2. TDD 与实际验证结果

| 阶段 / 命令 | 实际结果 |
| --- | --- |
| RED：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/scoring.test.ts` | 预期失败（exit 1，12 tests: 9 passed / 3 failed：`noMatchRejection` 零分母、`< 90%`、稀疏数组空洞） |
| GREEN：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/scoring.test.ts` | 通过（exit 0，1 file / 12 passed） |
| `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 通过（exit 0） |
| `.\scripts\pnpm.ps1 verify:workspace` | 通过（exit 0，`Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`） |

---

## 3. 未覆盖边界

- 全部测试用例均为人工构造的 **synthetic 测试模拟输入**，不代表仓库已具备 30 个真实业务标注样本。
- 未运行全量 `test`、`test:browser` 或 `test:platform` 套件。
