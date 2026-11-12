# C 本地三存储与接入检查验证

日期：2026-11-12，Windows x64 / Docker Desktop Linux amd64；起点 main `471ae8e`，开发分支 `feat/g2-local-infra`。用户确认暂无 OIDC 和独立预览域，先完成本地三存储及接入检查。本文是新增记录，不覆盖历史 G0/G1 证据。

## 交付范围与结论

- `d18ce0e`：可选只读 `ComponentExample.states`、`COMPONENT_EXAMPLE_GLOBAL` 和 requiredStates 权威语义；验证见 [契约独立记录](g2-example-contract-2026-11-12.md)。
- 独立 Compose `zhinexus-g2`，回环端口 15432 / 14873 / 19000，不复用已有 5432 / 5433 / 9000 服务。三个服务当前保留运行，命名卷和凭证保留。
- PostgreSQL、私有 S3、注册表精确安装、拒绝权限、真实重复发布 HTTP 409、重启持久化、隔离 PG/S3 恢复，已两轮通过。
- 接入工具缺配置退出 2、错误配置退出 1；报告始终 `g2Ready: false`。本地探针不等于完整 G2/T01、组件冻结/截图验收、业务迁移或 T06 发布协调器。

## 固定设施与依赖

| 项目 | 实际固定值 |
| --- | --- |
| PostgreSQL | 18.6；`postgres:18.6@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42` |
| Verdaccio | 7.1.0；`verdaccio/verdaccio:7.1.0@sha256:c1b1b86154b43a4e1861bc7a4496d4977aa43c8bdb5db49b68445f8a9273729f` |
| MinIO release / commit | RELEASE.2025-10-15T17-29-55Z / `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a` |
| MinIO source archive SHA-256 | `45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841` |
| Go builder | `golang:1.27.3-bookworm@sha256:dc0963f32053e4bc451d24d87e3892d42d01021b61f093e98eb95c0352bb84b0` |
| 实际 MinIO image ID | `sha256:8cddf933628349b40111a4f03c04408d4f653803dc27a0d19786af7df6b6b8c0` |
| 本地客户端 | `@aws-sdk/client-s3 3.1167.0`、`pg 8.23.1`、`@types/pg 8.23.1`、`tldts 7.4.22` |

源码 URL 和精确依赖来源见 `infra/versions.json`。MinIO 从校验后的源码包实际构建，后续启动绑定实际 image ID；不声称跨机器重复构建能得到相同镜像 ID。C 维护本地构建，生产漏洞处置责任尚待明确。

容器内 `/minio --version` 实测为上述 release/commit、`go1.27.3 linux/amd64`；Docker inspect 核对运行中 MinIO image ID 与报告一致。PG/Verdaccio 的实际平台镜像 ID 分别为 `sha256:8bca9649e52d948114ccc8164b55b7ab26b64e729893e420114bb5c87bf7c7cc` / `sha256:1d014b80fafa1419c2a098aeb5f9508b310cfabac97743491cb835993ae37d38`。本项目卷为 `zhinexus-g2_postgres_data`、`zhinexus-g2_verdaccio_data`、`zhinexus-g2_minio_data`。

pnpm 安装最新精确客户端时为新发布依赖写入以下 `minimumReleaseAgeExclude`，本轮明确保留并验证：`@aws-sdk/client-s3@3.1167.0`、`@aws-sdk/credential-provider-ini@3.973.30`、`@aws-sdk/credential-provider-login@3.972.92`、`@aws-sdk/credential-provider-node@3.972.97`、`tldts-core@7.4.22`、`tldts@7.4.22`。均限精确版本，不放开整个包或更改全局依赖策略。

## RED / GREEN 与实际命令

1. `exec vitest run tests/infra/access-config.test.ts`：先因实现缺失失败，再通过 HTTPS、缺字段、同注册域、issuer、authorization-code、PKCE S256 和 JWKS 公开密钥结构用例。
2. `test:infra`：未启动服务时 preflight 退出 1，不返回空成功。
3. 首轮真实服务：PostgreSQL/S3 通过，Verdaccio 登录返回 409。检查固定镜像源码确认 `{SHA}` 密码受支持，根因为请求缺少 Basic 认证头，进入已关闭的注册流程；补齐头后完整探针通过。保留原密码、卷和禁注册配置。
4. 加强重复发布判定时发现 npm 会在本地预检已存在版本，无法证明注册表拒绝；仅对同一冻结探针 tarball 使用 `--force --json` 绕过客户端预检，必须从注册表得到 `E409`，并再次校验原 tarball SHA-256。未删除或覆盖已发布版本。
5. `exec vitest run tests/infra/local.test.ts`：命令脱敏错误码、并发互斥和失败释放锁先 RED 后 GREEN。基础设施配置与本地工具测试共 **13/13**；根 TypeScript 检查通过。
6. `infra:up`：固定源码 MinIO 构建和 Compose 启动通过；`infra:stop` 后重新 `infra:up` 通过，凭证/命名卷复用。运行后 Docker 仅本项目三个容器绑定上述回环端口。
7. `infra:check-access`：未配置实际退出 **2**；HTTP issuer 错误配置退出 **1** 且覆盖旧报告为 failed/false；最后恢复默认未配置报告。没有实际 OIDC/DNS/TLS 资源，因此未执行真实外部登录或域名成功验证。
8. `$env:TURBO_FORCE='true'; .\scripts\verify.ps1`：冻结安装、工作区 **10 成员**检查、build **10/10（0 缓存）**、typecheck **14/14（0 缓存）**及根 tsc、根测试 **194/194**、浏览器 **15/15** 全通过。日志 `.tools/g2-local/final-full.log`；基础服务前置构建也实际执行，未依赖 Turbo 命中。

以上命令（除明确完整写出的命令）均使用 `.\scripts\pnpm.ps1` 包装调用。设施测试独立于日常 verify 和 Turbo。正在并行出现的 CLI 文件修改属于其他工作，不纳入 C 提交；本记录只说明上述命令运行时的通过结果。

## 两轮真实设施证据

两轮均包含 PG 唯一约束 23505、S3 匿名 403、注册表匿名 401/403、只读写入 403、重复发布 E409、外部干净消费者精确安装、三服务重启后字节复核、独立 PG/S3 恢复；报告状态均为 passed 且 `g2Ready: false`。

| 轮次 | runId | 完成时间（UTC） | tarball SHA-256 | 探针数据 SHA-256 |
| --- | --- | --- | --- | --- |
| 1 | `e5d415dd51a64239bd280f792d9ad0d8` | 2026-11-12 03:08:41 | `226d882fad69bf509f8a4daa335e83f46a48f19ba7ee557151c470bf23b57ff3` | `dbc88c6cc3be7da22f5a3828fa7521433927f4bfd21b8ddb68a26ec30bd16760` |
| 2，停止/启动之后 | `a44fcde57dda4171a11d99a3061613f7` | 2026-11-12 03:09:52 | `5d52e31386dbc965e2d3b9f072590757fb5001a78cdbf744a1767216d0d2abff` | `5a2439f9b4102b5558a75084decba8d7f7d4ea7c91bbf4dccf00f76cf8eb6629` |

对应包名为 `@g2-probe/probe-<runId>@1.0.0`，每轮唯一，不重用版本。报告在 `.tools/g2-local/runs/<runId>/report.json`，备份与凭证按使用说明留本地，不提交。

## 未覆盖边界与交接

G1 仍待 A/B 业务回执；完整 G2/T01 保持未完成。OIDC 真实网页登录与 CLI PKCE/回调、角色/撤销，独立注册域 wildcard DNS/TLS、逐发布 origin、preview-grant/沙箱仍未验证。PG 探针表不是 T05 业务迁移；S3 根账号不是生产最小权限；注册表重启证据不是完整 Verdaccio 离机恢复；本轮没有组件代码、截图、真实业务试点或三存储作业故障注入。

根与公开包仍为 0.0.0 工程阶段，本轮内部设施/私有契约调整不发布公开包，不触发升版。原始架构 SHA-256 实测仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 独立审查与最终复核

独立只读审查覆盖本轮 contracts 与 C 设施文件，发现两项 P2，无 Critical/Minor；本轮已完成一次修复及 RED→GREEN：

1. **S3 请求/响应体可能无限等待**：新增 `withS3Deadline` 和 `readS3Object`，全部操作含响应体读取共用 15 秒上限，取消后关闭流。真实本地 HTTP 服务器分别在响应头之前、返回 200 后暂停响应体；测试验证超时失败、连接关闭和互斥锁释放。新增模块缺失时 RED，修复后两例通过。
2. **预览注册域漏核对管理 API**：配置新增必需 `apiOrigin`，预览须同时与画廊/API 的注册域分离；缺少 API、API/预览同注册域用例先 RED，修复后通过。三处 origin 都做 DNS/TLS 前置检查，仍不声称真实鉴权已验收。

共享目录被并行 CLI 工作切换到 `feat/t04-cli-check` 后，C 创建独立工作树并沿用 `feat/g2-local-infra` 完成修复和提交。仅复制 C 文件，未切换、清理或提交 CLI 的源目录改动；共享目录的既有 C 副本也保留。最终代码以 C 分支为准。新工作树通过被忽略的 `.tools` junction 复用同一固定本机工具链/浏览器/开发凭证，独立执行冻结依赖安装和全仓验证。

最终在独立工作树执行 `$env:TURBO_FORCE='true'; .\scripts\verify.ps1`：冻结安装/工作区检查通过，build **10/10**、typecheck **14/14** 及根 tsc 通过，全部为 **0 缓存**；根测试 **198/198**、浏览器 **15/15** 通过。设施单测 **17/17**，默认接入检查仍退出 **2**。日志为 `.tools/g2-local/worktree-final-full.log`、`review-green.log`、`worktree-access.log`。

修复后的两轮实际探针再次全部通过，MinIO image ID 与前两轮一致：

| runId | 完成时间（UTC） | tarball SHA-256 | 探针数据 SHA-256 |
| --- | --- | --- | --- |
| `8989ab0754224452b0a5f9fcddd965d6` | 2026-11-12 03:26:21 | `86ab2298b4f17c0c085f6c7c007e93684446ec74cfe635955b9ece34a72b58ac` | `fbe0547b93ebdd561c73247e104833cb0bdc1f8c70117151b1988de6e79e7cfd` |
| `ed0d93e55d0e4f15a8ce2cc656e20813` | 2026-11-12 03:26:30 | `7546a99e48c1a0d0bfb099f5a1ea55bb3537c880534e19f91078b151a63abfb2` | `ef7335732ad14ab4ec730b0b1afa9bc81f82f40170422da061041110583a7150` |

审查排除其他并行 CLI/测试改动；真实 OIDC/客户端角色、wildcard/grant/沙箱、T05/T06 业务迁移/权限/作业、生产 MinIO/ACL/完整 Verdaccio 恢复、真实组件截图与业务试点均按上述边界保留后续验收。没有待处理的审查 Minor；本轮提交不执行 push 或 merge。
