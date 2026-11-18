# T16 A 第二轮独立断言返工验证记录（2026-11-18）

- **执行日期**：2026-11-18
- **负责角色**：A（Antigravity）
- **唯一工作树**：`C:/Users/10208/.codex/worktrees/t16-api-cases/zhinexus-design-asset-platform`
- **基线提交**：`b951f43dd65fef9bd97a564455e608ce6857db42`
- **审查前快照 SHA-256（`assertions.ts`）**：`9E4BEBC8A725D16F55A54609E21BE084286DFD0DB4A37FBD513EC8FC25E8E700`
- **提交状态**：按要求**未提交、未 pack、未 merge、未 push**，保留旧验证记录原文不改写，未修改 `main`、B 工作树、SDK、`contracts`、根配置或锁文件。

## 1. 第二轮返工修复要点（`tests/acceptance/t16-a/assertions.ts`）

1. **表达式求值与返回流追踪（拒绝序列表达式与丢弃语句误收）**：
   - `SequenceExpression` 仅追踪最后一个元素，拒绝 `data={("sales", [])}`、`onPointClick={() => ("onSelect", undefined)}` 与 Vue `:data="('sales', [])"` / `@point-click="() => ('onSelect', undefined)"`。
   - `CallExpression` 仅追踪被调用本地函数的 `ReturnStatement.argument`（或箭头返回表达式），忽略 `0; "sales"; return [];` 中被丢弃的字面量语句。
2. **导出组件真实渲染可达性**：
   - React TSX 仅从导出组件（含 `export function`、`export const`、`const Good = ...; export default Good;`、`export { Good }`）的返回 JSX 路径追踪，跳过未调用的内嵌 `function`/`arrow`、静态 `false` 条件/逻辑分支、`(JSX, null)` 非末项，以及返回值被丢弃的 `helper()` 调用。
   - Vue SFC 模板递归跳过带静态 `v-if="false"` 的节点及其子树。
3. **作用域感知的键名遮蔽**：
   - `deriveChildScope` 将函数参数标识符（含解构/默认值参数）加入 `shadowed` 集合并移除同名外层常量映射，拒绝 `sourceKey` / `handlerKey` 被渲染器同名参数遮蔽。
4. **精确遮蔽范围（不误杀无关函数）**：
   - `LOCAL_SYMBOL_SHADOWING` 仅检查模块顶层同名声明与导出组件可达渲染调用链内的参数/局部声明，不再因无关未调用函数 `function unrelated(LineChart: any)` 误拒合法渲染器。
5. **合法写法与真实 import alias 支持**：
   - 支持 `const Good = () => <LineChart ... />; export default Good;`、`const cb = (ev) => handlers?.['onSelect']?.(ev); onPointClick={cb}`，以及真实 SDK 别名导入 `import { LineChart as MyLine } from '@company/charts-{vue,react}/line'`。

## 2. 实际行为 RED → GREEN 验证记录

### 行为 RED（先在 `t16-a-api-cases.test.ts` 新增第二轮反例与合法写法测试，修复 `assertions.ts` 前）

- **命令**：`& 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'vitest', 'run', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
- **退出码**：`1`
- **摘要**：`1 failed | 5 passed | 1 skipped (7)`（`data={("sales", [])}` 序列表达式被旧实现误收为 `ok: true`）。

### GREEN（修复 `assertions.ts` 后重跑）

- **默认自包含 Vitest**：
  - 命令：`& 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'vitest', 'run', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
  - 退出码：`0`
  - 摘要：`Test Files  1 passed (1)`、`Tests  6 passed | 1 skipped (7)`
- **显式 `A10_FROZEN_BUNDLE` Vitest**：
  - 命令：`$env:A10_FROZEN_BUNDLE='D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3'; & 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'vitest', 'run', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
  - 退出码：`0`
  - 摘要：`Test Files  1 passed (1)`、`Tests  7 passed (7)`
- **窄类型检查（TypeScript `7.0.2`）**：
  - 命令：`& 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'tsc', '--noEmit', '--ignoreConfig', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--strict', '--skipLibCheck', '--types', 'node', 'tests/acceptance/t16-a/sdk-api-matrix.ts', 'tests/acceptance/t16-a/assertions.ts', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
  - 退出码：`0`（无错误输出）
- **格式检查**：`git diff --check` → 退出码 `0`。

## 3. 未覆盖边界

- 静态 AST 断言不替代仓外真实 Vue / React 工程的 `vue-tsc`、`tsc` 与 `vite build` 验收。
- 尚未在同一冻结 CLI 上消费本案例并运行真实 8 组合，且无真实业务项目试点，完整 T16 与 T17 仍未验收。
