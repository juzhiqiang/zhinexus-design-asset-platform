# JWT 两小时有效期与 CLI 续签修复合并验收

日期：2026-11-27。用户明确要求开发完成后合并回主分支；本记录独立补充合并验收，不改写[开发验证记录](2026-11-27-cli-token-renewal.md)。

## 合并范围

- 开始时分支为 `fix/cli-token-renewal`，工作区与暂存区干净，唯一 worktree 为普通主仓库。
- 原本地 `main`：`dc85e77c4df682b5451e01c57fc43722cb221f43`。修复分支包含 `53c616de`（两小时 JWT 与 CLI 活跃续签）及 `159c30dc`（升版至根 0.2.12、API 0.1.10、CLI 0.1.5）。
- 执行 `git switch main`、`git merge --ff-only fix/cli-token-renewal`，快进成功，无冲突。修复分支与合并结果的文件树一致。
- 回归期间，其他任务在同一仓库合入 `6b60797a`（文档与检查脚本），随后提交 `bdb40927`（同步文档索引篇数）。保留这些提交；相对 `159c30dc`，应用、契约、测试源码、锁文件及现有构建/测试配置均未变化。新增脚本在完整测试结束后重新通过全量构建与类型检查。
- 回归期间还观察到 `origin/main` 被并行操作推进至 `bdb40927`，本地 reflog 标记为 `update by push`。本任务未执行推送；新增合并验收记录仅提交本地。
- 相对原主分支执行 `git cherry dc85e77c fix/cli-token-renewal`，两项均为独立补丁。未引入重复修复或再次升版。

## 实际验证

Windows，全局 pnpm 12.18.0。完整构建、类型检查和测试使用仓库已有的 Node v26.13.0；系统 Node v24.6.0 及最低支持范围不变。构建时设置 `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:5173`，构建和类型检查设置 `TURBO_FORCE=true`。测试设置 `PLAYWRIGHT_BROWSERS_PATH` 与 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH` 指向本机已安装的浏览器缓存。

| 命令或检查 | 实际结果 |
| --- | --- |
| `pnpm verify:workspace` | 11 个成员、无循环依赖、公开包边界与服务端安全依赖图通过 |
| `pnpm verify:docs` | 文档链接、操作路径、索引篇数及 TypeScript 声明通过 |
| `pnpm verify:release` | 根 0.2.12 与 CHANGELOG 一致，公开包与未推送升版提交校验通过 |
| `pnpm build` | 11 个任务实际执行，0 缓存，退出 0 |
| `pnpm typecheck` | 15 个任务实际执行，0 缓存；根与后台测试 TypeScript 检查通过，退出 0 |
| `pnpm test` | 退出 0；T10 161 通过、7 既有跳过；Vitest 181 文件通过、2750 测试通过、2 既有跳过，Vitest 耗时 655.60 秒 |
| `git diff --check` | 通过 |

首次运行新合入的文档检查时，索引的计划、验证及总篇数共三项不一致；随后由 `bdb40927` 同步并复验通过，不把首次失败记为通过。本记录新增后再次同步索引并运行上述文档检查。保留已有 Node 子进程 shell 与 localStorage 警告，不声明零警告。

原始输出保存在本机忽略目录 `test-results/2026-11-27-token-renewal-merge-*.log`，不提交完整日志或凭据。

## 产物与验收边界

- 原架构文件 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
- 已安装 CLI 的冻结分发包 `packages/component-cli/.release/juz-cli-0.1.5.tgz` SHA-256 保持 `2936c1d960e00cebba82a26d2a6a3db6f33d198d0d8ef4d571efe01d5e5544c1`；本轮没有重新打包或安装。
- 本轮未重跑独立平台测试与全站 `test:browser`，未代用户发布组件；真实签名、撤权和安装后 CLI 验证见开发记录，不以本轮普通回归替代外部生产 G2 验收。
- 未更改用户开发服务、容器、数据库、账号授权、凭据或冻结发布材料；本任务未执行 push、创建 tag 或向注册表发布。网页主动续签与外部 OIDC refresh 仍不在本轮范围。
