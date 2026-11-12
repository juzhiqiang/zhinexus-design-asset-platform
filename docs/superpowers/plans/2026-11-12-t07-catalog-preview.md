# T07 C：目录与隔离预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 C 所有的 Ready 目录、精确版本详情、受控材料读取、短期授权与静态预览网关，供 B 接入画廊。

**Architecture:** 沿用 T05/T06 PostgreSQL 元数据与 MinIO 冻结对象。公开端点永远只读明确 public 的 Ready 资产，私有端点逐请求验证 OIDC 和组件权限。API 与网关独立部署，通过数据库中的一次性 grant、短期 session 与访问策略协调，不执行上传代码。

**Tech Stack:** 固定 Node 26.13.0、pnpm 12.18.0、NestJS 12.4.2、PostgreSQL、MinIO；现有 pg/S3 SDK/tldts 精确版本复用。

**Spec:** `2026-11-11-component-platform-implementation.md` §2.3/T07、`../specs/2026-11-11-gallery-next-public-private-rendering.md`、`../../../rules/security.md`。用户已要求直接开始 C 任务，本计划是已授权范围的执行细化。

## Global Constraints

- 原始架构 SHA-256 保持不变；C 不修改 B 工作区或 SDK/画廊代码。
- 原有 API DTO 保持兼容；公开与用户态端点分开，均 no-store，B 仅将明确公开 DTO 放入 ISR。
- 默认不公开；沿用 components.public，新增 category 和 can_read；public 管理由可信管理员操作并审计，不通过上传 manifest 自行公开。
- 私有读取需 reader/publisher/maintainer 角色及组件 can_read/can_publish/can_maintain；停用主体立即失效。此为既有授权模型的最小读取细化。
- 每 variant_release 独立 HTTPS origin；注册域必须不同于平台/API，拒绝任意 Host 与转发头推导。
- 5 分钟 grant 仅一次兑换，session 不延长原始有效期；Secure/HttpOnly/SameSite=None、host-only cookie；资源逐次检查 Ready、授权与撤销，全部 no-store。
- 只允许当前实现声明的 previewFiles，固定冻结对象 key，校验实际字节摘要，不开放桶/任意目录/服务端执行。
- 公司 OIDC、独立域 DNS/TLS、B 当前八实现真实材料及完整画廊联调是外部验收项，缺失时 T07/G2/M2 仍开放。

## Review Focus

1. 公共请求携带令牌不能扩大 DTO 范围，分页/框架过滤不能泄漏私有数量。
2. 单实现 Ready、版本差异、手动来源、基线与索引状态不能互相推断。
3. grant 并发兑换/重放、跨主机、过期、撤权和服务重启不能绕过数据库检查。
4. 编码/双编码/反斜杠/目录穿越、未声明文件、MIME 伪造与对象被替换均拒绝。
5. 浏览器不得读取父站存储、发起管理 API 请求、顶层跳转或注册有持久控制能力的 worker；第三方 cookie 失败交 B 提供独立窗口降级。

### Task 1: Ready 目录与版本材料

**Files:** `apps/api/src/catalog/{service,routes}.ts`、`apps/api/migrations/005_catalog_preview.sql`、`apps/api/src/{app,platform}.ts`、`apps/api/src/db/migrate.ts`、`tests/platform/catalog.test.ts`。

**Interfaces:** 消费既有 componentsQuery/componentsResponse/variantReleaseResponse。提供 `GET /v1/components`、`GET /v1/variants/:id/releases/:version`，及 `/v1/me/` 对应端点；材料路径为同详情路径加 `/artifacts?path=`。`CatalogService` 按精确发布记录取元数据。

补充：检查记录通过同详情路径 `/reports` 和新增兼容 DTO `variantReportsResponse` 读取，只匹配当前 job/variant；`packages/contracts/src/preview.ts` 统一无环境依赖的域名配置校验。005_catalog 和 006_preview 分开迁移以保持任务边界。

- [ ] 写 HTTP 失败测试：未公开/未 Ready 返回空；React 筛选、分页与文本/category 筛选正确；公共带 auth 不泄漏；私有角色/ACL/停用用户拒绝；材料不能跨版本或执行 HTML。
- [ ] 运行 `scripts/pnpm.ps1 test:platform tests/platform/catalog.test.ts`，确认预期失败。
- [ ] 实现迁移、查询、状态投影与材料白名单读取；使用当前 baseline head 和当前 outbox，不推断验证通过。
- [ ] 同命令 GREEN，补迁移回滚回归，聚焦提交。

### Task 2: 一次性预览授权与网关

**Files:** `apps/api/src/preview/{config,service}.ts`、`apps/preview-gateway/src/{app,auth,path-policy,config,storage,http}.ts`、双方 package.json/lockfile、`tests/platform/preview.test.ts`、`tests/unit/preview-policy.test.ts`。

**Interfaces:** `POST /v1/preview-grants` 使用既有 DTO；返回 `https://r-<uuid>.<preview-host>/bootstrap?grant=<opaque>`；网关兑换后 303 到第一示例入口，后续资源携带 `__Host-preview` cookie。数据库只保存令牌摘要。

- [ ] 写失败测试：grant 未鉴权/未 Ready/无权限拒绝；兑换成功不泄漏 token；并发仅一次；跨版本、过期、撤权、路径和摘要异常拒绝。
- [ ] 运行 `scripts/pnpm.ps1 test:platform tests/platform/preview.test.ts` 与 policy 测试确认 RED。
- [ ] 实现 5 分钟 DB grant/session、精确 origin 配置、只读 S3、每次访问 SQL 权限检查、强制 CSP/MIME/no-store/no-referrer 与统一无敏感错误。
- [ ] GREEN 后聚焦提交；新增依赖仅复用当前锁定且已验证版本。

### Task 3: 本地浏览器隔离与部署交接

**Files:** `tests/platform/preview-browser.test.ts`、`tests/platform/preview-support.ts`、`infra/gateway/preview.conf`、`apps/preview-gateway/README.md`、`apps/api/README.md`。

**Interfaces:** 测试浏览器仅在开发机启动；本地映射两个不同测试注册域与每版本子域，使用 HTTPS 测试证书，不能声称真实生产 DNS/TLS 验收。

- [ ] 写恶意预览测试并执行：父 DOM/存储不可访问、connect-src 阻止 API、跨版本 cookie 不可用、顶层跳转受限、撤权资源拒绝。
- [ ] 修正浏览器实测发现的问题并复验；提供 B 的 iframe/错误恢复/材料读取接口交接和 TLS/日志脱敏部署配置。
- [ ] 记录本地真实 PG/MinIO/HTTP/浏览器证据及尚缺的外部验收，聚焦提交。

### Task 4: 全图验证、审查与版本

**Files:** `README.md`、实施/分工计划追加状态、`docs/verification/t07-catalog-preview-2026-11-12.md`、根/API/gateway package.json、`CHANGELOG.md`。

- [ ] 执行 frozen install、verify:workspace、无缓存 build/typecheck、test、test:platform 与 test:browser；逐项读取结果。
- [ ] 使用独立审查代理检查本分支的访问控制、预览隔离和契约；Important 修复先 RED 后 GREEN。
- [ ] 平台/API 升 0.0.3，网关首次功能版 0.0.1，CHANGELOG 独立版本提交；不改 SDK/CLI 版本。
- [ ] 提交验证/交接记录并报告 hash。本轮用户授权开发，没有新增 push 授权；保留功能分支供合并。

审查修正：B 使用目录 variantReleaseId 的 `/v1/variant-releases/:releaseId` 及 /reports、/artifacts；旧 variantId/version 查询出现包名迁移同号时返回 CONFLICT。预览逻辑路径复用契约验证，URL仅解码一次；合法中文名和大小写扩展名可用，常见静态MIME与安全二进制fallback保持完整目录可读。Nginx配置正则须整体加引号并实际执行 nginx -t。
