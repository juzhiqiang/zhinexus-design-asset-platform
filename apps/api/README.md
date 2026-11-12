# 平台 API 接入

T05 提供身份验证、上传/冻结、发布登记、基线维护和审计。发布作业当前为 PENDING，实际三存储发布与 Ready 由 T06 worker 完成。API 不运行 CLI，不构建、安装或执行上传组件，不启动浏览器。

## 配置

通过进程环境注入；不要把真实值写入仓库、日志或请求 URL。

| 变量 | 含义 |
| --- | --- |
| PLATFORM_DATABASE_URL | 专用 PostgreSQL registry 数据库连接串 |
| PLATFORM_S3_ENDPOINT | MinIO/S3 origin；生产用 HTTPS，仅本机允许 HTTP |
| PLATFORM_S3_BUCKET / PLATFORM_S3_REGION | 私有产物 bucket / region（默认 us-east-1） |
| PLATFORM_S3_ACCESS_KEY / PLATFORM_S3_SECRET_KEY | 平台服务写入身份，客户端不持有 |
| PLATFORM_OIDC_ISSUER / PLATFORM_OIDC_AUDIENCE | 精确 issuer / 管理 API audience |
| PLATFORM_OIDC_JWKS_URI | 身份服务的 HTTPS JWKS 地址 |
| PLATFORM_OIDC_WEB_CLIENT_IDS / PLATFORM_OIDC_CLI_CLIENT_IDS | 逗号分隔的可信客户端 ID，两个列表不能重叠 |

OIDC 接收 RS256/ES256 access token；验证 issuer、audience、签名、时间与 azp/client_id。角色读取 token 的 roles 数组（reader/publisher/maintainer）；身份服务需配置该 claim 映射。web/cli 来源根据已验证客户端确定。CLI PKCE 与网页登录由客户端实现；当前公司资源未提供，无开发后门。缺 OIDC 时业务请求 401；认证通过但缺存储配置时 503。healthz 仅表示进程存活。

## 初始化和运行

1. 本地三存储可用根 `scripts/pnpm.ps1 infra:up` 启动。管理员创建专用数据库和私有 bucket，把凭证注入以上环境变量；API 不把 bucket 改为公开。
2. 构建服务并显式迁移（不会在启动时隐式修改 schema）：

```powershell
.\scripts\pnpm.ps1 build:services
.\scripts\pnpm.ps1 --filter @company/platform-api migrate
.\scripts\pnpm.ps1 --filter @company/platform-api start
```

3. 管理员按已验证 OIDC subject 预建 components、component_permissions 和 package_permissions。组件 grant 的 can_publish/can_maintain 分别控制发布/维护，npm 包发布另需 package_permissions；没有默认通配授权。维护者角色不会自动拥有所有组件。授权变更通过受控运维执行。

迁移目录按顺序、事务和摘要检查执行；不得修改已应用 SQL。程序化空库回滚仅用于测试，拒绝任何有业务数据的库。部署前备份数据库，在测试环境演练向前迁移；迁移后应用回退不能假设 schema 自动回退。

## HTTP

所有业务请求使用 `Authorization: Bearer <access token>`。JSON 请求最大 8 MiB，响应错误结构为 `{code,message,details,requestId}`。角色拒绝 403，他人私有会话/作业返回 404 并记录拒绝审计。

| 接口 | 行为 |
| --- | --- |
| POST /v1/uploads | 返回会话和签名 PUT 地址；大于 10 MiB 返回 5 MiB 分片计划 |
| POST /v1/uploads/:id/complete | 提交 path/partNumber/etag；单 PUT 不填 parts；逐文件重读校验并冻结 |
| POST /v1/releases | uploadSessionId + manifest，必须带 Idempotency-Key；同主体/客户端/请求重试返回同作业 |
| GET /v1/releases/:id | 私有状态、轮询间隔及可选 baselineCandidates 服务端候选 ID |
| POST /v1/releases/:id/retry | 仅 RETRY_WAIT 且租约已释放的作业进入 PENDING，保留发布检查点 |
| POST /v1/baselines | maintainer + 组件权限；服务端 screenshotId、variant/example/environment、reason、更新时 expectedRevision |
| POST /v1/variant-releases/:id/deprecate | maintainer + 组件权限；仅已有 Ready 版本，必须提供 reason |

会话 24 小时，签名 URL 15 分钟。超过 URL 有效期可新建会话重传；目前没有刷新签名 URL 接口。会话绑定 subject/client/channel，complete 重试不会生成另一份已完成材料。冻结副本不接受客户端覆盖，同包同版本不能被另一个作业重新占用。

基线候选服务端 ID 与冻结材料中的客户端截图 ID 分离，原报告和 manifest 保留原字节。旧截图 ID 仅在已授权 variant/example/environment 内唯一时可兼容；歧义 409，应从作业候选映射选择服务端 ID。manual-upload 永远不能升级为自动视觉基线。PENDING/Ready、报告来源、基线确认与索引状态彼此独立。

## 验证与限制

`scripts/pnpm.ps1 test:platform` 必须在 Windows 开发机运行：先构建服务及 SDK，使用隔离测试数据库/私有 bucket、真实签名 JWT、真实 HTTP/S3，并调用本地 CLI 生成双框架截图。缺本地存储会失败，不会 skip；不要在 API 容器中运行此命令。

初始限制为单包 50 MiB、单图 10 MiB、8192 像素边长、tar 展开 200 MiB/5000 文件、总材料 500 MiB；属于安全上限，不是已完成的并发容量承诺。失败/过期冻结尝试可能留下未引用对象，后续运维按引用清理，禁止按时间删除已发布资产。

真实公司 OIDC/PKCE/撤权、独立预览域、T06 发布恢复和生产容量尚未验收。CLI 当前 Bundle 的 preview HTML 为占位内容，本次只验证实际 tarball/截图/报告上传；不会据此宣称 T07 在线预览可用。

合并最新 SDK 后的接入边界：SDK 0.0.3 新增 ./pie，而 CLI 的 Bundle 入口目前仍只生成 line/bar 材料，该输入会被 T05 正确拒绝。正向回归保留实际验证过的 0.0.2 冻结样本；当前 SDK 必须由 B 补齐 pie 的双框架材料后才能完整提交，不允许删除 API 的逐导出覆盖检查。
