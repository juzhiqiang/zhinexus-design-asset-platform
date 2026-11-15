# 二期三方主分支集成复验

日期：2026-11-15。用户明确授权本地合并并提交；未执行 push 或发布。

## 合并结果

- C 分支 `feat/c-phase2-search` → `main`：`d4bb8791`。
- A 分支 `feat/a-phase2-profiles` → `main`：`9cdc4eb8`。
- B 分支 `feat/b-phase2-matching` → `main`：最终集成提交 `cba7b022`。
- B 合并产生 CHANGELOG、README、首批计划和 contracts README 四份文档冲突，已保留双方有效内容；业务源码与公共契约未做冲突改写。
- `main` 当前包含 A/B/C 三个分支的所有提交；未修改 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、根 `package.json`、`turbo.json` 或原始架构文档。

## 复验

- 合并后强制构建：`scripts/pnpm.ps1 exec turbo run build --force`，10/10 成功。
- 合并后强制类型检查：`scripts/pnpm.ps1 exec turbo run typecheck --force`，14/14 成功；根 `tsc --noEmit` 退出 0。
- 首次全量测试因主工作区缺少项目固定 Playwright Chromium 启动文件而失败，9 项均为浏览器可执行文件缺失；未修改业务代码。补齐 `.tools/playwright` 的 Chromium 后重跑：55 文件、895 项通过，node:test 159 通过、7 跳过、0 失败。
- `scripts/pnpm.ps1 verify:workspace`：10 成员、无循环依赖、服务依赖边界通过。
- `scripts/pnpm.ps1 test:browser` 首轮：216 通过、3 失败、4 未运行。契约运行时测试的模块白名单遗漏新增 `project-context`、`search`，导致动态导入失败；补齐白名单后，契约与二期两份页面测试合计 29/29 通过。此为测试适配，不修改业务逻辑，不触发额外升版。
- 其余浏览器失败来自未指定 `ZHINEXUS_SDK_BUNDLE_DIR`；第一次补值误指向 current-sdk 父目录，明确报缺 manifest。随后采用历史已验收冻结批次 `.tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583`，未重 pack，真实网页三存储文件 6/6 通过。首轮未运行的 4 项包含在这次 6 项中；所有 223 个浏览器用例已通过首轮或修订后定向复验覆盖，但未声称整套单次 223/223。
- `scripts/pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/search.test.ts tests/platform/database.test.ts`：隔离真实服务 6/6 通过。
- 原始架构文档 SHA-256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 边界

本次只完成本地合并与回归，不代表远程推送、发布或 T13/T14 总体验收完成。多模态检索、真实 30+ 标注集、生产 OIDC、真实消费者试点和生产独立预览域仍按计划保持未完成。

三方 worktree 为桌面应用管理的现有协作工作区，本次保留供后续继续开发。临时浏览器预览服务已由测试清理；没有归档或删除工作区。
