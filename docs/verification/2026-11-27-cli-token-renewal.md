# 两小时 JWT 与 CLI 活跃续签验证

日期：2026-11-27。Windows，分支 `fix/cli-token-renewal`，基线 `dc85e77c4df682b5451e01c57fc43722cb221f43`；开始时工作区干净。使用全局 pnpm 12.18.0，验证命令以仓库已有的 Node v26.13.0 运行；未更改最低 Node 支持范围。

## 实现范围

- 自托管访问令牌是 ES256 JWT，签发有效期由 300 秒改为 7200 秒。网页 PKCE 会话 Cookie 的寿命改为已验证 access/id token 剩余有效期的较小值。授权尝试的五分钟窗口不变。
- `POST /v1/auth/oidc/renew` 先完整认证仍有效的 Bearer，再用本地密钥签发新 JWT。保留身份、client、账号版本、原始 `auth_time`，使用本次认证后的有效角色，记录不含令牌的审计。
- CLI 在发布前置检查、上传、完成上传、提交作业、状态轮询、重试和基线请求前检查有效期，不足 300 秒时续签；同进程相同凭证的并发续签合并。长上传检查不向对象存储发送 Bearer。
- 登录和续签落盘共用跨进程凭据路径锁；锁内重读并比较原 origin/token，匹配后才通过临时文件和 rename 原子替换。不会覆盖另一终端的新登录，不保存密码；显式或环境 Token 不覆盖其他已保存登录。锁仅有限等待，不自动删除未知锁；异常退出遗留锁需确认无相关 CLI 操作后人工清理。
- 完全过期需重新登录；停用、账号版本变更和强制退出检查继续生效。网页 Cookie 不能换出 JWT，外部 OIDC 不由本地冒签。本轮没有实现网页主动续签或外部 OIDC refresh。
- 未修改用户组件、冻结产物、上传会话、发布权限或已发布版本，未代用户执行 publish。

## RED、审查与定向验证

| 检查 | 实际结果 |
| --- | --- |
| 修改前 identity / credentials 基线 | 2 文件、26 测试通过 |
| 新增两小时签发与 CLI 续签 RED | 12 失败、26 通过，复现旧 300 秒及缺少续签 |
| 真实 HTTP 两小时签发 RED | 1 失败、1 通过，响应仍为 300 秒 |
| 审查回归 RED | 3 失败、13 通过，复现并发新登录被覆盖与前置检查返回旧令牌 |
| `pnpm exec tsx tests/fixtures/releases/g1/generate.ts` 及 `--check` | 共享 API wire snapshot 生成并核对通过 |
| 全部 contracts 与 CLI/identity 定向回归 | 27 文件、657 测试通过 |
| 真实 Nest/PostgreSQL/MinIO 定向回归 | 最终独立环境 3 文件、8 测试通过 |

定向命令：

```powershell
pnpm exec vitest run tests/contracts tests/unit/cli-token-renewal.test.ts tests/unit/cli-release-response.test.ts tests/unit/local-identity.test.ts tests/unit/cli-login-methods.test.ts tests/unit/access-credentials.test.ts
pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/cli-login-methods.test.ts tests/platform/local-development.test.ts tests/platform/access-oidc.test.ts
```

新增 CLI 回归使用真实本地 HTTP 与临时凭据文件，受控时钟覆盖临界过期、长操作跨续签、同进程并发、环境/显式 Token、跨 origin 拒绝、已过期拒绝、404 兼容、错误/重定向/无效响应保留原凭据。并发写入通过文件系统边界同步，覆盖同/异 origin、登录/续签两种先后顺序；另验证失败释放自有锁和不删除未知锁。时间推进不是实际等待两小时。

真实平台测试核对签名令牌 7200 秒、新 jti、身份和原始 auth_time 不变、审计不含 Token，以及强制退出、版本递增、停用、Cookie/Session、外部 issuer 等拒绝路径。独立测试基础设施没有访问共享本地测试账号或发布数据。

只读审查首次发现两项 Important：凭据匹配检查与写入间的竞态，以及前置检查返回旧令牌；补 RED 后修复。复核无剩余阻断项，没有由审查者代替执行完整测试。

## 工程验证

- `pnpm verify:workspace`：11 个成员及服务端依赖边界通过。
- `$env:NEXT_PUBLIC_SITE_URL='http://127.0.0.1:5173'; $env:TURBO_FORCE='true'; pnpm build`：11 个任务实际执行，0 缓存，通过。
- `$env:TURBO_FORCE='true'; pnpm typecheck`：15 个任务实际执行，0 缓存，根和后台测试 TypeScript 检查通过。
- 首轮 `pnpm test`：T10 161 通过、7 既有跳过；Vitest 179 文件通过、2 文件失败，2744 通过、4 失败、2 既有跳过，退出 1。失败包含漏同步的 API wire snapshot 和审查新增的三项回归，不记为全绿；均已在定向回归中修复并通过。
- 最终代码重新执行完整 `pnpm test`：退出 0；T10 161 通过、7 既有跳过，Vitest 181 文件全部通过，2750 测试通过、2 既有跳过（656.25 秒）。保留现有 Node 子进程 shell 与 localStorage 警告，不将其描述为零警告。
- `git diff --check` 通过。共享本地开发 API 的只读健康检查返回 200；不带 Bearer 的新续签路由返回 401，确认开发进程已加载接口，没有读取或续签用户凭据。

测试使用当前用户已安装的 Playwright 缓存，分别设置 `PLAYWRIGHT_BROWSERS_PATH` 与 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH`，不以缺失浏览器的运行替代验收。原始构建、类型检查和测试日志位于本机忽略目录 `test-results/2026-11-27-token-renewal-*.log`，不提交账号、令牌或完整日志。

原始架构文件 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 版本、安装与本机验证

功能修复提交：`53c616de`。版本独立收口为根 `0.2.12`、管理 API `0.1.10`、CLI `0.1.5`，同步 CHANGELOG；未改动依赖或手工编辑锁文件。完整构建、类型检查和测试针对功能实现执行；升版仅改元数据和说明，之后再次运行 `pnpm verify:workspace`，11 成员及服务依赖图通过。

`pnpm --filter @company/component-cli pack:juz` 重新构建 CLI、内联契约、生成并复核 73 个 probe 文件，生成唯一分发包 `packages/component-cli/.release/juz-cli-0.1.5.tgz`（587762 bytes）。SHA-256：

```text
2936c1d960e00cebba82a26d2a6a3db6f33d198d0d8ef4d571efe01d5e5544c1
```

以系统 Node v24.6.0 / npm 11.5.1 执行 `npm install -g <同一份本地 tgz> --no-audit --no-fund --foreground-scripts` 成功，postinstall 完成 Chromium 下载/缓存准备；安装前后复核 tarball SHA-256 一致，未重打包。实际 `juz --version` 返回 `0.1.5`。

再用本地 HTTP 夹具启动全局安装包的真实命令行入口执行 `status`：初始 JWT 剩余 120 秒，先 POST 续签，再用新 JWT GET 发布状态，共两次请求、退出 0。该检查运行在系统 Node v24.6.0，使用全新临时凭据路径，明确 Token 不创建登录文件，不读取或更改用户真实凭据；HTTP 夹具用于安装后传输行为检查，不充当真实服务端签名验收。真实签名与撤权由前述 8 项平台用例验证。

本地开发 API 已运行新路由；旧令牌不会原地延长，建议更新后重新 `juz login` 一次再继续 `juz publish`，复用现有冻结材料。本轮没有合并、push、打标签或发布 npm 包。
