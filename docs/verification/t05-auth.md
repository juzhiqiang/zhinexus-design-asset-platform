# T05 OIDC 验证与角色授权子任务

日期：2026-11-12。负责人 C 的认证子任务，基线 `6508157`；主代理测试依赖提交 `25726eb` 在独立工作树应用为 `b971384`。本记录仅覆盖认证验证器与角色策略，不标记完整 T05 / G2 验收完成。

## 实现边界

- `apps/api/src/auth/oidc.ts` 导出 `Principal`、`OidcConfig`、`AuthFailure` 和 `OidcVerifier`。`verify(authorization)` 仅接受经过签名、issuer、API audience、有效期与客户端验证的 Bearer JWT。
- 配置 issuer/JWKS 必须为 HTTPS，拒绝 user-info、query、fragment 和空/重叠/重复客户端集合。保留 issuer 的原始精确值作为 JWT issuer 比较值；复制配置以免调用方后续修改授权集合。
- jose `6.2.17` 只允许 RS256 / ES256；要求 exp / sub / iat；拒绝过期、未来 nbf / iat、空 subject、非有限 NumericDate 和混合类型 audience。JWT payload 修改、错误签名、未知客户端、冲突 azp / client_id 均拒绝。
- 入口 channel 只由可信 azp / client_id 对应配置决定。角色只消费已验证的 roles 数组；缺省/空数组不授予默认权限，未知或畸形角色拒绝。scope / channel payload 不能增权。
- Remote JWKS 使用 5 秒超时、5 分钟缓存、30 秒刷新冷却期；jose 使用 `redirect: manual` 并拒绝非 200 响应。上游错误、token 和配置值不会进入对外错误消息。
- 无 OIDC 配置允许创建验证器，但所有 verify 调用拒绝。公钥解析器注入仅作为程序化测试接口，不提供任何运行时禁用签名/认证的配置开关。
- `roles.ts` 的 `requireRole`：read 接受 reader / publisher / maintainer；upload 接受 publisher / maintainer；baseline / deprecate 只接受 maintainer。组件负责人校验、HTTP guard/filter 和数据库审计由主代理接入。

## RED → GREEN 证据

1. 首次 `exec vitest run tests/integration/auth.test.ts`：1 个断言失败，原因是尚无真实编译后的 OIDC 模块。
2. 加入只拒绝访问的最小接口，并先写真实签名与配置/权限测试；修正 RS512 测试密钥必须使用 SHA-512 的夹具问题后，运行相同命令得到 **37 failed / 60 passed（97 tests）**。失败覆盖合法 JWT、入口映射、错误配置与合法角色动作，没有模块导入错误。
3. 实现签名/声明校验及角色策略并先执行 Nest build 后，**97 / 97 passed**。
4. 审查 jose NumericDate / audience 校验边界，先补充真实 CompactSign JSON 数值溢出与混合类型 audience 用例；**4 failed / 97 passed（101 tests）**，均因错误材料被接受。增加有限数值及完整 audience 类型校验后，**101 / 101 passed**。
5. 补充 JWKS 缓存到期撤除签名键、拒绝重定向的回归测试；最终认证套件 **103 / 103 passed**。

所有认证测试都加载 `apps/api/dist/auth/*.js` 的真实 Nest 编译产物；RSA/ECDSA/HMAC/RS512 签名为真实密码学运算。Remote JWKS 测试仅替换 HTTP 网络响应，保留 jose 的 JWKS 解析、缓存、选择公钥与签名验证。

## 实际验证

通过项目固定 Node `26.13.0` / pnpm `12.18.0` 包装脚本运行：

| 命令 | 实际结果 |
| --- | --- |
| `.\scripts\pnpm.ps1 install --frozen-lockfile` | 退出 0，冻结锁文件安装通过 |
| `.\scripts\pnpm.ps1 --filter @company/contracts build` | 退出 0 |
| `.\scripts\pnpm.ps1 --filter @company/platform-api build` | 退出 0，直接执行 Nest 编译，未依赖 Turbo 缓存 |
| `.\scripts\pnpm.ps1 --filter @company/platform-api typecheck` | 退出 0 |
| `.\scripts\pnpm.ps1 @('exec', 'tsc', '-p', 'tsconfig.json', '--noEmit')` | 退出 0；服务声明生成后通过根 TypeScript 检查 |
| `.\scripts\pnpm.ps1 verify:workspace` | 退出 0；10 成员、无循环、公开包及服务闭包安全边界通过 |
| `.\scripts\pnpm.ps1 exec vitest run tests/integration/auth.test.ts` | 退出 0；103 tests passed |
| `.\scripts\pnpm.ps1 test` | 最终退出 0；19 files / 330 tests passed；54.27 秒 |
| `git diff --check` | 退出 0 |

根 test 先执行 build:services，最终运行 API build/typecheck 实际执行，其余未修改服务任务使用本地缓存；Vitest 测试本身不缓存。全仓消费者测试出现既有 `DEP0190` 子进程 shell 参数警告，不影响退出码，认证代码没有创建子进程。

原始架构文档未改动，SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。本子任务不修改共享 manifest、锁文件、contracts 或平台版本；总体平台升版由主代理整合处理。

## 未覆盖与后续验收

公司 OIDC、真实 HTTPS JWKS、网页/CLI 登录及 PKCE 回调、实际身份提供商撤权未运行；受控网络测试不能替代它们。JWKS 缓存允许旧公钥保留最多 5 分钟，JWT 仍按自身 exp 校验；即时撤权需后续身份/权限策略，不声称已验证。HTTP 鉴权拒绝审计、组件负责人权限及真实 PG/S3 接入由主任务验证。本子任务不启动/重启开发服务，不声称完成浏览器登录、G2 或完整 T05 验收。
