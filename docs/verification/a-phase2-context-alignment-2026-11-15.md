# A 二期 ProjectContext 契约对齐修订与澄清记录（2026-11-15）

修订日期：2026-11-15  
隔离工作区：`C:\Users\10208\.codex\worktrees\a-phase2-profiles\zhinexus-design-asset-platform`  
分支：`feat/a-phase2-profiles`（基于 `f172dbacb075c6c4ef91d41cc90b7fc8a5a3686f`，新建聚焦提交，未 amend）  
变更文件：
- `docs/phase2/evaluation-protocol.md`
- `docs/verification/a-phase2-context-alignment-2026-11-15.md`（本文件）

> 注：历史审查/验证记录（`a-phase2-profiles-2026-11-15.md`、`a-phase2-profiles-review-2026-11-15.md`、`a-review-project-context-2026-11-15.md`）均保持原样未修改。

---

## 1. 本次修订内容

1. **对齐 C 已交付 `e8248fb3` `ProjectContext` 契约**：
   - 将 `docs/phase2/evaluation-protocol.md` 第 2 节 `DesignEvalCaseV1` 草案及第 5 节 `SYNTH-MATCH-001` 的 `projectContext.reactDomVersion` 移出，改为置于独立的 `evalEnvironment` 字段（`{ "reactDomVersion": "19.3.1" }`），避免与 `@company/contracts` `projectContextSchema` 的 `additionalProperties: false` 冲突。
   - 明确声明 `projectContext` **只使用** `framework`、`frameworkVersion`、`echartsVersion?`、`packageManager`、`requirements` 5 个字段，不扩展 `@company/contracts`。

---

## 2. 对上一份独立审查记录的文字澄清

对 `docs/verification/a-review-project-context-2026-11-15.md` 中第 2 条的描述作补充澄清（不修改原文件）：

- `null` 本身是**合法的 JSON 值**，`packages/contracts/src/schema.ts` 中的 `assertJson` 会放行 `null`（见 `assertJson` L42）。
- `validateProjectContext(null)` 之所以返回 `{ ok: false }`，是因为 `projectContextSchema` 声明了 `type: 'object'`，在 `validateSchema` 的 `visit` 阶段（`schema.ts` L75-76）检测到 `actual === 'null' !== 'object'` 而拒绝（报错 `Expected object`），**不是 `assertJson` 拒绝 `null`**；`assertJson` 拒绝的是 `new Date()`、循环引用、accessor、稀疏数组等非普通 JSON 值。

---

## 3. 实际执行的检查与结果

| 命令 | 目的 | 实际结果 |
| --- | --- | --- |
| PowerShell `-Encoding UTF8` 解析 `evaluation-protocol.md` 第 5 节 JSON 示例 | 校验 `SYNTH-MATCH-001` 与 `SYNTH-TRAP-002` 的 `projectContext` 仅含 5 个允许字段且 JSON 合法 | 通过：`SYNTH-MATCH-001` 与 `SYNTH-TRAP-002` 均 `extra=`（无多余字段） |
| `.\scripts\pnpm.ps1 verify:workspace` | 校验工作区 10 成员、无环与依赖边界 | 通过（exit 0，`Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`） |
| `git diff --check` | 检查修订无空白符或行尾异常 | 通过（exit 0） |

---

## 4. 未覆盖边界

- 本次仅修改评估协议文档与新增对齐说明，未改动 `packages/contracts`、`packages/charts-*` 或测试代码；尚未运行全量 Vitest/浏览器套件。
