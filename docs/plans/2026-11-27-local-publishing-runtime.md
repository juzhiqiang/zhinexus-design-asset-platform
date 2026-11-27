# 本地上传与发布运行配置修复

目标：修复本地 `pnpm dev` 下登录成功但创建上传会话返回 `INFRA_UNAVAILABLE` 的问题，并提供使用相同本地存储的独立发布 worker 入口。

证据：本机 API 登录 200；`POST /v1/uploads` 返回 503；三存储探针均可达。现有开发加载器只注入 PostgreSQL，没有配置 S3，也未启动发布 worker。healthz 只表示存活。

边界：保留生产配置、OIDC、预览 HTTPS/沙箱与现有发布协议；不修改 contracts 或原始架构文件，不改写用户冻结材料。仅在非生产且未指定对象存储时读取受忽略目录中的本地凭证。注册表发布 token 仅加载到独立 worker。

实施：

- [x] 在 `tests/unit/dev-platform-storage.test.ts` 增加缺省本地存储、显式配置优先、生产禁用、损坏凭证与注册表登录隔离测试，确认 RED。
- [x] 在 `scripts/dev-storage.ts` 解析本地存储、初始化私有桶，并限制注册表凭证只发送到固定本地地址；扩展 `scripts/dev.ts` 及根 `dev:worker` 脚本，确认 GREEN。
- [x] 运行工作区检查、根类型检查与测试，记录实际结果；用独立诊断材料验证创建会话、真实 PUT 与 worker 发布，不以 fixture 证明组件浏览器验收。
- [x] 更新 README、API/设施说明及独立验证记录；实现提交 `9a542863`，平台根版本独立递增至 `0.2.11` 并同步 CHANGELOG，禁止 push。

关键反例：显式远程地址不能混入本地密钥；生产不读取本地凭证；认证拒绝/重定向不泄漏密码；缺少本地凭证不重建数据卷；已有桶和已发布版本不覆盖。

本机处置：原 `.tools/g2-local` 仅有数据库密码，旧 MinIO / Verdaccio 挂载凭证无法恢复。用户已明确选择保留旧环境、另建隔离设施。本轮新增 `zhinexus-local-publish` 项目、独立卷与回环端口 19010 / 14883，显式接入原本地 API 和独立 worker；沿用原数据库并仅新增私有诊断资产及其权限，不扩大既有组件授权。真实 HTTP 上传 201、14 次 PUT 200、完成 200、发布 202，worker 已达 READY。实际证据与重启命令见 [独立记录](../verification/2026-11-27-local-publishing-runtime.md)。
