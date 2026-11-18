# T16 A 第三轮独立断言返工验证记录（2026-11-18）

- **执行日期**：2026-11-18
- **负责角色**：A（Antigravity）
- **唯一工作树**：`C:/Users/10208/.codex/worktrees/t16-api-cases/zhinexus-design-asset-platform`
- **基线提交**：`b951f43dd65fef9bd97a564455e608ce6857db42`
- **提交状态**：按要求**未提交、未 pack、未升版、未 merge、未 push**，保留旧历史验证记录原文不改写，未修改 `main`、B 工作树、SDK、`contracts`、根配置或锁文件。

## 1. 第三轮修复要点（`tests/acceptance/t16-a/assertions.ts`）

1. **`return` / `throw` 控制流终止与 `if (false)` 裁剪**：
   - `collectReachableReturnsFromStatements` 在遇到 `ReturnStatement`、`ThrowStatement` 或必终止分支后立即停止，拒绝第二个不可达 `return <LineChart .../>` 或 `return []; return dataSources['sales'];`；同时跳过静态 `if (false)` 分支。
2. **条件测试、丢弃参数与未知/丢弃调用失败关闭**：
   - `ConditionalExpression` 仅评估 `consequent`/`alternate`，绝不将 `test` 条件字符串当作有效绑定（覆盖 React 与 Vue）。
   - 已知本地函数与 IIFE 调用仅追踪其可达 `return` 表达式，忽略丢弃实参（`((x)=>[])('sales')`）与丢弃内嵌调用（`(() => { (() => 'sales')(); return []; })()`）；未知调用直接失败关闭（仅保留 `hasOwnProperty.call` 与成员回调 `handlers?.[key]?.(ev)`）。
3. **块级作用域隔离（`cloneScope`）**：
   - 每次进入 `BlockStatement` 或 `IfStatement` 分支均克隆独立作用域，阻止 `if (false) { const sourceKey = 'sales'; }` 泄漏并撤销外层参数遮蔽；同时阻止 `if (false) { const LineChart = () => null; }` 误拒外层合法 SDK 渲染。
4. **调用位置作用域函数解析**：
   - 将本地函数表 `fns` 纳入 `BindingScope`（随参数遮蔽删除同名映射），拒绝 `export function Bad(buildChart) { return buildChart(); }` 与 `export function Bad(getData, getHandler)` 借用顶层同名 helper 冒充。
5. **保留合法写法**：
   - 保留合法单引号 `'sales'`/`'onSelect'`、`const Good = () => ...; export default Good;`、`const cb = ...; onPointClick={cb}` 以及真实 SDK `import { LineChart as MyLine }` 别名导入。

## 2. 逐反例 RED → GREEN 实测记录

### 行为 RED（先在 `t16-a-api-cases.test.ts` 新增 11 个独立 `it`，修复 `assertions.ts` 前）

- **命令**：`$env:A10_FROZEN_BUNDLE='D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3'; & 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'vitest', 'run', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
- **退出码**：`1`
- **摘要**：`11 failed | 7 passed (18)`，新增 11 个独立 `it` 全部各自失败：
  - `1a`（`return <div/>` 后死 JSX）、`1b`（`if(false)` 死 return）、`1c`（`return []` 后死 return）
  - `2a`（React 条件测试字符串）、`2b`（Vue 条件测试字符串）、`2c`（丢弃参数）、`2d`（丢弃 IIFE 调用）
  - `3`（块内 `const` 泄漏撤销参数遮蔽）
  - `4a`（`buildChart` 参数遮蔽）、`4b`（`getData`/`getHandler` 参数遮蔽）
  - `5`（无关 `if(false)` 块内 `const LineChart` 误拒合法例）

### GREEN（修复 `assertions.ts` 后重跑）

- **显式 `A10_FROZEN_BUNDLE` Vitest（0 pending）**：
  - 命令：`$env:A10_FROZEN_BUNDLE='D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3'; & 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'vitest', 'run', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
  - 退出码：`0`
  - 摘要：`Test Files  1 passed (1)`、`Tests  18 passed (18)`（`0 pending / 0 skipped`）
- **TS 7.0.2 窄类型检查**：
  - 命令：`& 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'tsc', '--noEmit', '--ignoreConfig', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--strict', '--skipLibCheck', '--types', 'node', 'tests/acceptance/t16-a/sdk-api-matrix.ts', 'tests/acceptance/t16-a/assertions.ts', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
  - 退出码：`0`（无错误输出）
- **格式检查**：`git diff --check` → 退出码 `0`。

## 3. 未覆盖边界

- 静态 AST 解析不承诺任意 JS 运行时语义；无法静态证明的路径按失败关闭处理。
- 本断言不替代仓外真实 Vue / React 工程的 `vue-tsc`、`tsc` 与 `vite build` 验收；尚未在同一冻结 CLI 上运行真实 8 组合，且无真实业务项目试点，完整 T16 与 T17 仍未验收。
