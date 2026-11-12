# 更新日志

## [0.0.3] - 2026-11-12

### 新增

- 平台/API：公开与已登录 Ready 目录、框架/分类/文本筛选、精确发布详情、受权限保护的文档/API/截图与检查报告读取。
- 平台/API：按 variantReleaseId 精确定位档案；旧 variant/version 地址遇到换包名同号歧义时返回 CONFLICT，避免取错材料。
- 预览网关首次功能版 0.0.1：独立域与每版本 origin、数据库一次性授权、5分钟短期会话、逐资源撤权检查和冻结摘要核对。
- 预览网关：host-only Secure/HttpOnly Cookie、CSP沙箱、中文资源路径与准确MIME、脱敏拒绝审计和TLS部署模板。

### 变更

- 平台根与 platform-api 升至0.0.3；SDK/CLI版本不变。新增005/006向前迁移和独立 contracts/preview配置入口。
- 本地三存储与浏览器隔离验证已通过；公司OIDC、生产独立域、目标浏览器Cookie策略及B画廊/八实现闭环仍需外部验收。

## [0.0.2] - 2026-11-12

### 新增

- 平台/API：独立发布 worker 从 PENDING 推进至 Ready，持久化租约、fencing、检查点与有界重试，进程中断后继续处理原冻结材料。
- 平台/API：MinIO 不可变对象固化、Verdaccio 原 tarball 幂等发布与摘要核对、公司依赖优先发布及完整可达性检查。
- 平台/API：Ready 与包/实现状态、审计、索引 outbox、默认 tag 待办原子登记；tag 独立恢复，GET 作业返回缺失材料路径。

### 变更

- 平台根与 platform-api 升级至 0.0.2；SDK/CLI 独立版本不变。新增 004 向前迁移与 worker 配置/运行说明。
- 本地 T06 通过历史 SDK 冻结证据验证；公司 OIDC、独立预览域、当前 SDK 完整 CLI 材料仍待接入，完整 M2 保持开放。

## [0.0.1] - 2026-11-12

### 新增

- 平台 API 支持 OIDC JWT/JWKS 身份校验、角色与组件/包权限。
- 支持 MinIO 单文件/分片上传、实际 tarball/图片校验、不可变冻结副本及租约恢复。
- 支持 PostgreSQL 发布作业幂等登记和状态读取、服务端候选 ID、基线 CAS、版本废弃及不可变审计。

### 验收范围

- 已有本地真实存储、HTTP、冻结 SDK 与双框架截图证据。
- 公司 OIDC/PKCE/撤权与独立预览域尚未接入；作业停在 PENDING，T06 发布及 T07 在线预览待完成。
- SDK/CLI 独立版本由各自包维护；本次只升级平台根版本与 platform-api 至 0.0.1。
