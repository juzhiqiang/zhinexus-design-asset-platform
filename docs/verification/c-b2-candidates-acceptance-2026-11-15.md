# B2 候选展示宿主验收

日期：2026-11-15。B 实现由 Claude 桌面端完成，C 在 Windows 固定工具链执行验证、根配置调整和本地提交。契约交接为 `dcb4d52e`（C 原提交 `e0a7f5ee`，12 文件 blob 一致）。

## TDD 与工程修订

1. B 先交 23 项测试，没有两个实现文件。首次运行根目录无法解析 React，是测试环境失败，不能计为功能 RED。
2. C 将运行时 React 从 gallery 的 package.json 依赖边界解析，并修正 HTML 转义断言：普通转义文本仍允许含 `onerror` 字符，必须拒绝真实标签而非普通字符串。再次运行因缺失 `candidate-results.js` 失败，确认功能 RED 后通知 B 实现。
3. Next 的 `jsx: preserve` 导致初次 TSX 渲染测试无法执行，C 在根 Vitest 增加 `oxc.jsx.runtime: automatic`；根 `tsconfig.json` 加 `jsx: react-jsx` 检查被测试导入的 TSX。未修改 Next 配置或新增依赖。
4. 原 23 项测试通过。C 新增框架标签回归：契约不含框架版本，组件却硬编码 Vue 3 / React 19，出现 23 通过、1 失败。Claude 将标签改为 Vue / React 后，24 项通过。

## 实际命令与结果

- `.\scripts\pnpm.ps1 exec vitest run tests/gallery/candidate-results.test.ts tests/gallery/phase2-context.test.ts tests/contracts/search.test.ts`：3 文件、60 项通过（24 + 9 + 27）。
- `.\scripts\pnpm.ps1 --filter @company/gallery typecheck` 与根 `tsc -p tsconfig.json --noEmit`：退出 0。
- `.\scripts\pnpm.ps1 exec turbo run build --force`：10/10 成功，0 缓存命中。
- `.\scripts\pnpm.ps1 exec turbo run typecheck --force`：14/14 成功，0 缓存；随后根 tsc 与 `verify:workspace` 通过。
- 构建与类型检查全部结束后串行 `.\scripts\pnpm.ps1 test`：50 文件、818 项 Vitest 通过；node:test 166 项中 159 通过、7 跳过、0 失败。完整命令退出 0。
- `git diff --check` 通过。原架构 SHA256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

A 独立只读审查提交 `a102d711`，记录于 A 分支 `docs/verification/a-review-b2-candidates-2026-11-15.md`，无阻断项。

## 验收边界

本组件未接入 /match，无 HTTP 请求、浏览器存储或真实候选来源；只验证静态渲染和响应校验，不代表在线检索、视觉匹配或浏览器交互验收。未新增公开行为，本批不重复升级 Gallery 0.0.6。T13/T14 真实检索、数据库索引、模型和真实评估集仍未完成。所有合成 fixture 不算真实资产或标注样本。未 merge、push 或发布。
