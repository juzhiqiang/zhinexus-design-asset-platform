# 二期 ID 配置契约与范围调整验证

日期：2026-11-15。基线 e5f7e7ef，分支 feat/phase2-id-mapping；范围文档提交 487d1ad9。

## 范围与决策

用户明确二期不接大模型，改用设计 ID 规则匹配；规则暂未确定。本次同步实施评估、T13/T14 计划、分工和 README；新增独立规格/执行计划。原架构与历史验证记录未改。无需模型 endpoint/key、视觉 30 样本或模型质量验收。

实现 Task 1：显式映射配置、设计实例输入、运行时校验和 JSON Schema。designId/framework 必须唯一，实例 ID 必须唯一，不同实例可复用 designId；未知 ID 和空配置可通过结构校验，留给后续流程报告缺口。ID 原值精确比较，不设业务命名规范。配置不充当权限/Ready/兼容证据。

## 实际命令与结果

所有 pnpm 命令均使用 `./scripts/pnpm.ps1` 的 Node 26.13.0 / pnpm 12.18.0 固定工具链。

| 命令 | 实际结果 |
| --- | --- |
| `install --frozen-lockfile --offline` | 通过，344 包从缓存安装，锁文件无修改 |
| `--filter @company/contracts build`，随后 `exec vitest run tests/contracts/project-context.test.ts tests/contracts/search.test.ts` | 基线 45/45 通过 |
| `exec vitest run tests/contracts/design-id.test.ts`（实现前） | RED：36/36 失败，原因是新增校验器/Schema 尚未导出 |
| `--filter @company/contracts schemas:generate` | 构建并生成通过，新增 mapping/input 两份 Schema |
| `exec vitest run tests/contracts` | GREEN：12 文件，246/246 通过，含新增 36 项 |
| `exec turbo run build --force` | 10/10，通过，0 缓存命中 |
| `exec turbo run typecheck --force` | 14/14，通过，0 缓存命中 |
| `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 通过 |
| `verify:workspace` | 通过：10 成员、无环、4 公开包、服务依赖边界安全 |
| `test` | 通过：node:test 159 通过/7 skip；Vitest 56 文件、931/931 通过 |
| `exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts` | Chromium 1/1 通过；校验既有冻结 fixture 与摘要、新输入合法及重复实例拒绝 |
| `git diff --check`、变更文档本地 Markdown 链接检查 | 通过 |
| contracts 与 CLI 内联 design-id/index/schemas SHA-256 对比 | 三份副本一致 |

日志保存在本 worktree 的 `.tools/design-id-{red,build,types,test,browser}.log`，不入库。根 test 的 7 项跳过为未显式提供外部冻结 SDK 材料的既有边界，不计为通过。本轮未重跑完整浏览器套件或真实三存储专项，因为未更改服务/前端行为。

独立规格审查补清 ruleSetId/revision 字符串和未知 ID 非格式错误；独立代码审查无阻断，另运行 27 组只读边界断言（非 JSON、循环、getter 不触发、原型键、唯一性、100 错误上限及预算），全部通过。

原架构 SHA-256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与基线一致。

## 未覆盖与后续

当前只交付配置/输入契约。HTTP 精确发布解析、MatchPlan/真实 API 映射、前端配置入口、旧响应失效、真实 ID 规则/设计导出对接与规模量测仍未完成；本轮不能宣称 T13/T14 验收通过。后续 Task 2 必须先冻结具体 HTTP/MatchPlan，不依赖文本 Top-50 或索引状态代替精确 ID 定位。

内部契约和 CLI 内联同步没有新增公开命令/API/UI 行为，本次不单独升版；后续对外功能按规则单独升版。没有 push 或发布。
