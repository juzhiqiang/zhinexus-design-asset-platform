# 平台与产物安全规则

## 服务端零执行与本地隔离

- `apps/api` 与 `apps/preview-gateway` 只接收、校验、存储和分发开发者本地预构建产物（tarball、manifest、文档、截图、检查报告和静态预览文件）。
- 服务端进程与部署镜像严禁构建组件、严禁导入或动态执行上传包中的代码、严禁运行 npm 生命周期脚本（`preinstall` / `install` / `postinstall`）、严禁启动 Playwright 或任何无头浏览器。
- 本地工作区在 `pnpm-workspace.yaml` 中通过 `allowBuilds` 仅允许白名单构建脚本（`esbuild: true`）；CLI 在工作区外临时消费者安装候选 tarball 时，同样不得放开任意第三方安装脚本执行。

## 静态预览隔离与网关策略

- 网关默认使用与画廊和 API 不同的注册域，按发布版本隔离 origin。经用户确认，暂无域名时可显式启用 `PLATFORM_PREVIEW_MODE=ip-port`，使用同一 IPv4 上与画廊、API 不同的 HTTPS 端口。入口须过滤 Cookie 和 Authorization，且不得记录或缓存授权 URL。IP 模式使用一次性 grant 换取绑定发布版本的短期授权路径，iframe 与响应 CSP 的沙箱均只赋予 `allow-scripts`，使预览文档使用不透明源。具体配置见 [IP 预览部署](../docs/guides/preview-ip-port.md)。
- 画廊内嵌预览必须使用沙箱 `iframe`（受控 `sandbox` 属性），禁止赋予与主站同源的特权或顶层窗口劫持能力；预览页面严禁获取平台登录凭证或直接请求管理 API。
- 访问预览资源必须通过 `POST /v1/preview-grants` 颁发的短期授权（`bootstrapUrl` / `expiresAt`）；未授权、授权过期、权限撤销或版本未就绪时，`preview-gateway` 必须拒绝访问，严禁将 MinIO 存储桶直接公开暴露。
- `preview-gateway` 必须对请求路径做规范化与固定包内前缀校验，拦截 `..`、反斜杠、编码绕过和符号链接穿越；响应头必须设置严格的 `Content-Security-Policy`（CSP）、`X-Content-Type-Options: nosniff` 和准确的 MIME 类型。

## 上传校验与来源防伪

- 所有来自 CLI、网页表单、HTTP 请求、上传 manifest（`ReleaseManifestV1`）及检查报告（`CheckReportV1`）的输入默认视为不可信 `unknown`，必须先通过 `@company/contracts` 的运行时 Schema 与交叉引用校验，不得仅使用 TypeScript `as` 断言。
- 上传完成（`POST /v1/uploads/:id/complete`）与发布校验阶段必须逐文件核对字节数、小写十六进制 SHA-256 摘要、实际文件头/MIME 类型及图片宽高，拒绝伪造后缀、超限文件或夹带脚本的异常资源。
- 无论是单组件包还是一包多组件，每个待发布组件的每个框架实现（`VariantRef`）必须关联至少一张所属框架与 `variantId` 匹配的有效截图；严禁跨框架借图（如用 Vue 截图充当 React 截图）或部分实现缺图放行。
- 网页手动提交（`channel: 'web'`）必须在前端和 `apps/api` 两端同时拦截缺图，且服务端强制将截图来源设为 `'manual-upload'`、`environmentKey` 设为 `'unknown-manual'`；无关联本地检查报告时，`compatibility.status` 只能为空或 `'candidate'`，严禁客户端通过参数伪造 `'local-automatic'` 或 `'passed'`。

## 身份鉴权、凭证与日志

- 2026-11-27 用户授权：CLI 平台接入允许 HTTP 与 HTTPS，HTTP 只提示推荐 HTTPS，不强制确认或阻断；此范围仅限 CLI 客户端接入，不降低浏览器、生产身份源或预览部署的既有策略。三种登录方式（账号密码、浏览器 PKCE、Token）共用服务端身份与 ACL；账号密码需取得真实 CLI client 的令牌，密码不回显、不持久化，不能借用 web client 冒充自动验证来源。

- CLI（OIDC PKCE / 本地回环回调）与网页端共用同一 OIDC 身份体系（操作者 `subject` 一律从服务端鉴权上下文提取，不信任请求体字段），按角色与组件负责人校验上传、发布、基线更新和版本废弃权限。
- Verdaccio 严格分离平台发布服务专用的写入账号与开发者/业务项目的只读消费凭证；客户端不直接持有 PostgreSQL、MinIO 或 Verdaccio 的写凭证。
- 数据库密码、MinIO 密钥、Verdaccio Token、OIDC Client Secret、Cookie 等敏感值只能通过环境变量或密钥管理注入，严禁写入代码、配置文件、`docs/verification/` 日志、检查报告或 Git 提交。
- 发布状态变更、视觉基线创建/更新（含操作者与理由）、版本废弃（`POST /v1/variant-releases/:id/deprecate`）及鉴权拒绝均须记录到 `audit_events` 表。

## 公开画廊与内网管理端

- 公开画廊与管理端独立部署；公网入口只允许目录、登录与预览所需的精确 API 路径。管理端页面、上传、发布、账号、配置和管理查询接口仅从公司网络/VPN 进入；CORS 或隐藏导航不能代替网络限制。
- 两个前端使用同一 API origin 承载 host-only 会话 Cookie。API 对两端精确 origin 执行 CORS 与 Cookie 写请求 CSRF 校验；入口的网络限制依据真实连接来源，不信任用户提供的转发头。源站服务不得直接暴露公网。
- OIDC target 仅接受 gallery/admin 两个固定值，服务端持久化绑定；禁止任意 return URL。候选配置登录固定回内网管理端。私有目录仍使用逐组件 catalog_can_read 权限，不因登录自动授权。
- 私有目录不进入公开 HTML、metadata、sitemap 或共享缓存；登出、会话失效和权限拒绝时清除页面中的私有数据。配置模板和生产网络/TLS 验收分别记录，不能把本机通过等同已部署。
