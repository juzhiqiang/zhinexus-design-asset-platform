# CLI 登录与本地发布修复合入主分支验证

日期：2026-11-27。用户明确要求合并回主分支，仅执行本地合并，不执行 push、tag 或远程发布。

## 合并范围与基线

- 合并前工作区干净，仅有一个普通工作区；`main` 位于 `959c1411`，是 `fix/local-publishing-runtime` 的祖先。
- 来源提交为 `5124550d1060541343f42e907988042d2ae3e828`，包含 CLI 三种登录方式与 HTTP 接入、本地上传存储与独立 worker 修复、对应升版和禁止擅自新增 PowerShell 脚本入口的规则。共 6 个提交，47 个文件。
- 执行 `git switch main`、`git merge --ff-only fix/local-publishing-runtime`，成功快进至上述来源提交，无冲突，无额外合并提交。未拉取远程变更。
- 合并前已测试的来源树与合并后的主分支树均为 `6cc532c5b853286e76ca1f344f4dc8f8a16286d9`。本记录单独以文档提交补充，不改写原有验证历史。

## 实际验证结果

环境为 Windows、Node `v26.13.0`、全局 pnpm `12.18.0`。两个浏览器缓存变量 `PLAYWRIGHT_BROWSERS_PATH`、`T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH` 均指向当前用户的 `AppData/Local/ms-playwright`，未调整测试配置或断言。

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 合并前完整回归 | `pnpm test` | 退出 0；T10：161 通过、7 跳过、0 失败；Vitest：180 文件通过，2725 测试通过、2 跳过、0 失败，Vitest 耗时 620.75 秒 |
| 工作区与依赖边界 | `pnpm verify:workspace` | 退出 0；11 个成员、无环依赖、公开包和服务端依赖边界通过 |
| 合并后类型检查 | `pnpm typecheck` | 退出 0；Turbo 类型检查阶段 15 个任务全部命中缓存，根和 admin 测试 TypeScript 检查由命令实际执行；不记为重新构建所有包 |
| 合并后定向回归 | 下方 Vitest 命令 | 退出 0；4 文件、31 测试通过 |
| 差异检查 | 合并前 `git diff --check main..HEAD` 及合并后 `git diff --check` | 均通过 |

合并前另实际执行 `git diff --check main..HEAD`，检查全部待合并差异。合并后定向命令为：

```text
pnpm exec vitest run tests/unit/cli-login-methods.test.ts tests/unit/cli-http-endpoints.test.ts tests/unit/dev-platform-storage.test.ts tests/unit/dev-platform-environment.test.ts
```

完整日志保存在忽略目录：`test-results/main-merge-test.log`、`test-results/main-merge-workspace.log`、`test-results/main-merge-typecheck.log`、`test-results/main-merge-focused.log`。日志不纳入提交。

原始架构文件 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。完整测试期间有 Node 弃用与实验性 API 警告，命令最终退出 0。

## 验证边界

本次仅完成本地主分支集成，未再次运行独立 `pnpm test:browser`、完整 `test:platform` 或真实用户组件发布；此前真实上传与 worker 发布证据仍以 `2026-11-27-local-publishing-runtime.md` 为准。未重打包用户产物、覆盖已发布版本、修改本地存储凭证或停止现有开发服务。主分支保留全部来源提交；原 `feat/cli-login-methods` 分支保留。
