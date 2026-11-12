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

依赖：API 新增 pg 8.23.1、jose 6.2.17、AWS S3 client/presigner 3.1167.0、tar-stream 3.2.2、pngjs 7.0.0、jpeg-js 0.4.4，均固定精确版本；presigner 3.1167.0 与已有 S3 客户端配套，pnpm 的 minimumReleaseAgeExclude 仅新增该精确版本例外，未关闭全局依赖年龄策略。

## 仍需执行 / 外部边界

本文件的首轮结果不代表整仓验收或最终审查完成。分片 HTTP/并发 fencing、实际 SDK 冻结产物穿过 API、完整无缓存验证和独立整分支审查将在后续追加记录。

### 分片与并发补充

- 追加 11 MiB 真 MinIO 分片上传 HTTP：缺片、错 ETag、重复片均为 409，正确完成后冻结字节一致；同 subject 的另一客户端不能完成原会话。
- 通过测试层暂停实际 S3 read、在独立数据库推进租约过期，真实 HTTP 验证活动租约冲突、新 fence 完成后旧请求返回 LEASE_LOST；最终状态/对象键不变，审计只登记一次。
- `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/uploads.test.ts`：5/5 通过；根 `tsc --noEmit` 通过。故障注入仅在测试层，无运行时绕过开关。

### 实际 SDK 材料接入

同步 main 的 9c355ca（B 的完整 Bundle 生成入口）后，先直接构建 charts-core/vue/react 与 API，再执行 `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/real-artifacts.test.ts`，1/1 通过（13.67 秒）。通过 CLI 在工作区外干净消费者实际安装同一候选包、驱动本地 Chromium 截图，3 份包、4 个实现完整提交到真实 Nest/PG/MinIO，全部文件在磁盘/manifest/冻结对象之间摘要一致；登记 4 个 PENDING 实现，无 Ready。

首份机器证据保存在忽略目录 `test-results/t05-real-c6baa495-5268-4975-8356-216fc7ae3464/evidence.json`，含包/图片摘要与时间，无凭证。fixture JWT 使用真实 RSA 签名，不能替代公司 OIDC。B 的 preview HTML 仍为占位，未宣称在线预览可用。SDK 截图后未重新 pack。

### 合并最新主分支的额外边界

主分支 c5329d3 后 SDK 0.0.3 含 ./pie，现有 CLI Bundle 只生成 line/bar，会被 API 按实际导出覆盖规则拒绝。没有修改或放宽验证器。正向回归保留第二次实际验证过的 0.0.2 Bundle 到 tests/fixtures/releases/t05-verified-sdk（包/图片/报告原字节及 2026-11-12T05:01:30.536Z 机器证据），新负例仍实际生成当前 SDK Bundle 并经 HTTP 验证拒绝且无作业登记。B 的 pie 材料接入保持未完成。

Playwright 的 test-results 清理会移除早期忽略证据；因此后续运行证据改存 .tools/t05/real-*，不依赖会被清空的临时输出。受版本管理的样本记录原始消费者/截图执行；重放测试不冒充重新执行过该版本浏览器。

目前没有公司 OIDC 或独立预览域，真实登录/PKCE/撤权、G2 与完整 T05 外部身份验收保持未完成；签名测试不替代该证据。T06 的三存储发布、Ready 与 T07 预览授权也未宣称完成。
