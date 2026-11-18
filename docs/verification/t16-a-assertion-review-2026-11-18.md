# T16 A 独立生成绑定断言返工验证记录（2026-11-18）

- **执行日期**：2026-11-18
- **负责角色**：A（Antigravity）
- **唯一工作树**：`C:/Users/10208/.codex/worktrees/t16-api-cases/zhinexus-design-asset-platform`
- **基线提交**：`b951f43dd65fef9bd97a564455e608ce6857db42`
- **提交状态**：按要求**未提交、未 pack、未 merge、未 push**，未改写历史记录 `docs/verification/t16-a-api-cases-2026-11-18.md`，未修改 `main`、B 工作树、SDK、`contracts`、根配置或锁文件。

## 1. 返工修复要点（`tests/acceptance/t16-a/assertions.ts`）

针对独立只读审查指出的 5 项误收/误拒问题完成 AST 级修复：

1. **禁止无关常量 + `data=[]` + 缺 callback 误过**：取消全文 `includes(JSON.stringify(key))`，改为追踪渲染组件属性/事件表达式 AST 中的字面量及可追溯局部常量，同时强制要求 `expected.propBindings` 与 `expected.callbackBindings` 均在渲染节点上实际绑定且键名匹配。
2. **拒绝 `source` 与 `handler` 互换**：分别校验 `data` 属性表达式包含 `propBindings[].sourceKey`、事件属性/指令表达式包含 `callbackBindings[].handlerKey`。
3. **仅沿着导出组件实际渲染调用链扫描 JSX**：`collectExportedRenderRoots` 从 `ExportNamedDeclaration` / `ExportDefaultDeclaration` 出发，沿 `CallExpression` 追踪可达局部函数，排除仅存在于未调用函数中的死 JSX。
4. **补全参数遮蔽检测**：`FunctionDeclaration` 纳入函数参数列表递归检查（含 `export function Bad(LineChart: any)`）。
5. **支持合法单引号/模板字面量解码值**：通过 `@babel/parser` 解码 `StringLiteral.value` 与无插值 `TemplateLiteral`（支持单引号 `'sales'`、双引号 `"sales"` 及换行/反斜杠/HTML 转义），并在 Vue 模板指令中用 `parseExpression` 解析 `:data` 与 `@point-click` 表达式。

## 2. 实际行为 RED → GREEN 验证记录

### 行为 RED（先在 `t16-a-api-cases.test.ts` 新增 5 项审查测试用例，尚未修复 `assertions.ts`）

- **命令**：`& 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'vitest', 'run', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
- **退出码**：`1`
- **摘要**：`1 failed | 4 passed | 1 skipped (6)`（未调用函数 JSX 用例未触发 `COMPONENT_NOT_RENDERED`）。

### GREEN（修复 `assertions.ts` 后重跑）

- **默认自包含 Vitest**：
  - 命令：`& 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'vitest', 'run', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
  - 退出码：`0`
  - 摘要：`Test Files  1 passed (1)`、`Tests  5 passed | 1 skipped (6)`
- **显式 `A10_FROZEN_BUNDLE` Vitest**：
  - 命令：`$env:A10_FROZEN_BUNDLE='D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3'; & 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'vitest', 'run', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
  - 退出码：`0`
  - 摘要：`Test Files  1 passed (1)`、`Tests  6 passed (6)`
- **窄类型检查（TypeScript `7.0.2`）**：
  - 命令：`& 'C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform\scripts\pnpm.ps1' -PnpmArgs @('exec', 'tsc', '--noEmit', '--ignoreConfig', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--strict', '--skipLibCheck', '--types', 'node', 'tests/acceptance/t16-a/sdk-api-matrix.ts', 'tests/acceptance/t16-a/assertions.ts', 'tests/acceptance/t16-a/t16-a-api-cases.test.ts')`
  - 退出码：`0`（无错误输出）
- **格式检查**：`git diff --check` → 退出码 `0`。

## 3. 未覆盖边界

- 本静态 AST 断言不能替代仓外真实 Vue / React 工程的 `vue-tsc`、`tsc` 与 `vite build` 验收。
- 尚未在同一冻结 CLI 上消费本案例并运行真实 8 组合，且无真实业务项目试点，完整 T16 与 T17 仍未验收。
