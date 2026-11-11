# 平台与产物安全规则

## 服务端零执行与本地隔离

- `apps/api` 与 `apps/preview-gateway` 只接收、校验、存储和分发开发者本地预构建产物（tarball、manifest、文档、截图、检查报告和静态预览文件）。
- 服务端进程与部署镜像严禁构建组件、严禁导入或动态执行上传包中的代码、严禁运行 npm 生命周期脚本（`preinstall` / `install` / `postinstall`）、严禁启动 Playwright 或任何无头浏览器。
- 本地工作区在 `pnpm-workspace.yaml` 中通过 `allowBuilds` 仅允许白名单构建脚本（`esbuild: true`）；CLI 在工作区外临时消费者安装候选 tarball 时，同样不得放开任意第三方安装脚本执行。

## 静态预览隔离与网关策略

- 静态预览网关（`apps/preview-gateway`）必须使用与平台画廊（`apps/gallery`）和管理 API（`apps/api`）不同的独立注册域名，并按发布版本隔离 origin，防止预览脚本读取主平台 Cookie、`localStorage`、`sessionStorage` 或 IndexedDB。
- 画廊内嵌预览必须使用沙箱 `iframe`（受控 `sandbox` 属性），禁止赋予与主站同源的特权或顶层窗口劫持能力；预览页面严禁获取平台登录凭证或直接请求管理 API。
- 访问预览资源必须通过 `POST /v1/preview-grants` 颁发的短期授权（`bootstrapUrl` / `expiresAt`）；未授权、授权过期、权限撤销或版本未就绪时，`preview-gateway` 必须拒绝访问，严禁将 MinIO 存储桶直接公开暴露。
- `preview-gateway` 必须对请求路径做规范化与固定包内前缀校验，拦截 `..`、反斜杠、编码绕过和符号链接穿越；响应头必须设置严格的 `Content-Security-Policy`（CSP）、`X-Content-Type-Options: nosniff` 和准确的 MIME 类型。

## 上传校验与来源防伪

- 所有来自 CLI、网页表单、HTTP 请求、上传 manifest（`ReleaseManifestV1`）及检查报告（`CheckReportV1`）的输入默认视为不可信 `unknown`，必须先通过 `@company/contracts` 的运行时 Schema 与交叉引用校验，不得仅使用 TypeScript `as` 断言。
- 上传完成（`POST /v1/uploads/:id/complete`）与发布校验阶段必须逐文件核对字节数、小写十六进制 SHA-256 摘要、实际文件头/MIME 类型及图片宽高，拒绝伪造后缀、超限文件或夹带脚本的异常资源。
- 无论是单组件包还是一包多组件，每个待发布组件的每个框架实现（`VariantRef`）必须关联至少一张所属框架与 `variantId` 匹配的有效截图；严禁跨框架借图（如用 Vue 截图充当 React 截图）或部分实现缺图放行。
- 网页手动提交（`channel: 'web'`）必须在前端和 `apps/api` 两端同时拦截缺图，且服务端强制将截图来源设为 `'manual-upload'`、`environmentKey` 设为 `'unknown-manual'`；无关联本地检查报告时，`compatibility.status` 只能为空或 `'candidate'`，严禁客户端通过参数伪造 `'local-automatic'` 或 `'passed'`。

## 身份鉴权、凭证与日志

- CLI（OIDC PKCE / 本地回环回调）与网页端共用同一 OIDC 身份体系（操作者 `subject` 一律从服务端鉴权上下文提取，不信任请求体字段），按角色与组件负责人校验上传、发布、基线更新和版本废弃权限。
- Verdaccio 严格分离平台发布服务专用的写入账号与开发者/业务项目的只读消费凭证；客户端不直接持有 PostgreSQL、MinIO 或 Verdaccio 的写凭证。
- 数据库密码、MinIO 密钥、Verdaccio Token、OIDC Client Secret、Cookie 等敏感值只能通过环境变量或密钥管理注入，严禁写入代码、配置文件、`docs/verification/` 日志、检查报告或 Git 提交。
- 发布状态变更、视觉基线创建/更新（含操作者与理由）、版本废弃（`POST /v1/variant-releases/:id/deprecate`）及鉴权拒绝均须记录到 `audit_events` 表。
