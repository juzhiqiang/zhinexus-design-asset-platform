# T05 平台 API 与真实存储验证（2026-11-12）

基线 6993e11，功能分支 feat/t05-platform。本文记录本轮新增证据；不改写早期验证结果。

## 已实现边界

- Nest 真 HTTP + OIDC 签名认证，subject/client/channel 只来自已验证 token；未配置 OIDC 时业务接口 401，healthz 仅表示进程存活。
- PostgreSQL 迁移带摘要与 advisory lock；上传会话/文件、组件与 npm 包权限、作业、包版本/实现、报告/截图、基线历史与审计独立持久化。审计与基线 revision 禁止 UPDATE/DELETE。
- MinIO 单 PUT / 5 MiB 分片；complete 逐文件校验实际字节、SHA-256 与格式后创建条件写入的冻结副本。发布只读冻结对象，原签名地址再写不影响作业材料。上传完成带租约/fencing，允许失败恢复。
- 发布同时校验组件与 npm 包权限；主体+幂等键绑定完整请求、认证客户端。事务登记 PENDING，包名+版本唯一，冲突不覆盖、不留部分记录。T06 发布 worker 未在本任务实施。
- 基线只接受已登记 local-automatic 候选及匹配的成功报告；按 variant/example/environment 执行 CAS，保留旧 revision 与理由。废弃仅适用于已有 Ready 版本。
- 每请求随机 requestId；错误不返回凭证、原始 SQL 或异常堆栈。客户端来源表示声明，不表示平台重新运行过组件。

## 实际执行结果（集成首轮）

| 命令 / 检查 | 结果 |
| --- | --- |
| contracts RED→GREEN | multipart 2 个预期失败，随后 contracts 149 通过 |
| PG 迁移往返、唯一/FK、不可变记录 | 专用独立数据库测试 1 通过 |
| MinIO 单/分片、缺片、重试、冻结不可覆盖 | 真实存储测试 1 通过 |
| HTTP upload RED→GREEN | 原骨架 404 引发 3 个预期失败，接入后 3 通过 |
| release RED→GREEN | 未注册路由 404 引发 2 个预期失败，实现后 2 通过 |
| baseline RED→GREEN | 未注册路由 404 引发 2 个预期失败，实现后 2 通过 |
| `pnpm exec vitest run --config tests/platform/vitest.config.ts` | 5 文件 / 9 用例通过（真实 PG/MinIO；没有 skip） |
| `pnpm --filter @company/platform-api build` | Nest 编译通过 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 通过 |
| `pnpm exec vitest run tests/unit/bootstrap.test.ts tests/integration/auth.test.ts tests/integration/upload-validation.test.ts` | 3 文件 / 162 用例通过 |

上述 pnpm 命令均经固定工具链 `scripts/pnpm.ps1` 执行。PostgreSQL 使用随机独立测试数据库，结束后只删除该数据库；MinIO 使用随机测试 bucket。测试凭证读取忽略目录，不进入记录。

## 仍需执行 / 外部边界

本文件的首轮结果不代表整仓验收或最终审查完成。分片 HTTP/并发 fencing、实际 SDK 冻结产物穿过 API、完整无缓存验证和独立整分支审查将在后续追加记录。

目前没有公司 OIDC 或独立预览域，真实登录/PKCE/撤权、G2 与完整 T05 外部身份验收保持未完成；签名测试不替代该证据。T06 的三存储发布、Ready 与 T07 预览授权也未宣称完成。
