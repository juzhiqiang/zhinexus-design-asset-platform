# 静态预览网关（T07 C）

网关仅从 MinIO 读取 T06 已冻结的静态文件，不安装包、不构建、不运行上传脚本、不启动浏览器。每个 `variant_release` 使用独立 HTTPS origin，例如 `https://r-<uuid>.preview.company-assets.net`；平台/API 使用另一个注册域。运行前先在 API 执行迁移 001–006。

## 配置与运行

通过本地环境变量或密钥管理注入，禁止提交真实值：

- `PLATFORM_DATABASE_URL`：网关数据库连接。
- `PLATFORM_GALLERY_ORIGIN`、`PLATFORM_API_ORIGIN`、`PLATFORM_PREVIEW_ORIGIN`：三个无末尾斜杠的 HTTPS origin；API 与网关完全一致。最后一个为预览基础域，不带 `r-<uuid>`。
- `PLATFORM_S3_ENDPOINT`、`PLATFORM_S3_REGION`、`PLATFORM_S3_BUCKET`、`PLATFORM_S3_ACCESS_KEY`、`PLATFORM_S3_SECRET_KEY`：网关只读对象账户。

`scripts/pnpm.ps1 build:services` 后，`scripts/pnpm.ps1 --filter @company/preview-gateway start` 在 `127.0.0.1:3001` 启动。生产环境通过 [TLS 模板](../../infra/gateway/preview.conf) 反向代理；不得把内部明文端口暴露给访问者。缺少配置时仅 health 可用，资源失败关闭。不信任 X-Forwarded-Host，不从请求推导预览域。

MinIO 账户只授予目标桶 `releases/*` 的 GetObject。网关 PostgreSQL 账户仅需以下权限（管理员先创建角色并配置 secret）：

```sql
GRANT SELECT ON components, component_permissions, disabled_subjects, variants,
  variant_releases, package_releases, release_jobs, release_artifacts,
  preview_grants, preview_sessions TO preview_reader;
GRANT UPDATE (redeemed_at) ON preview_grants TO preview_reader;
GRANT INSERT ON preview_sessions TO preview_reader;
GRANT INSERT ON audit_events TO preview_reader;
GRANT USAGE ON SEQUENCE audit_events_id_seq TO preview_reader;
GRANT EXECUTE ON FUNCTION catalog_can_read(text,text), preview_can_read(uuid,text) TO preview_reader;
```

## 授权及静态目录

1. 平台使用用户 Bearer token 调用 `POST /v1/preview-grants {variantReleaseId}`。角色与组件权限都通过后，返回 `bootstrapUrl` 与 `expiresAt`。
2. 访问该地址一次性兑换 `__Host-preview` Cookie：`Secure; HttpOnly; SameSite=None; Path=/`，没有 Domain。303 跳转至第一示例入口，地址中不再含凭证。
3. grant 及 session 共用签发起 5 分钟期限，不滑动续期；数据库只保存随机令牌 SHA-256。兑换具有事务锁，进程重启不丢会话。
4. 所有 GET/HEAD 文件请求检查当前 Ready、组件 public/ACL、停用用户、grant 撤销与到期，其他方法返回 405。文件须位于该实现声明的 `previewFiles`，对象 key 必须属于同一发布 job；每次读取核对长度与摘要。兄弟实现、任意桶路径、文档和 tarball 不作为预览资源分发。
5. URL 只解码一次，随后按共享契约校验逻辑路径；支持中文文件名，拒绝双重编码、编码分隔符、空段、`.`/`..`、反斜杠和非法设备名。常见 HTML/JS/CSS/JSON、图片、字体、WASM 使用准确 MIME，扩展名大小写不影响识别；其他已声明字节作为 application/octet-stream 分发，不声明可执行。预览单文件上限 50 MiB。

响应始终 `no-store`、`no-referrer`、`nosniff`、`noindex`。CSP 允许同 origin 的脚本/样式及内联预构建代码，禁止 connect、子 iframe、worker、object、外部脚本和顶层导航权限；frame-ancestors 仅为配置的画廊。HTML/SVG 属于不可信代码，安全边界是独立注册域、每版本 origin 和 CSP sandbox。

访问日志不得记录查询串、Cookie、Authorization 或响应 Set-Cookie。反向代理的错误日志也可能记录 bootstrap URL，模板关闭该原始错误日志。上层 LB/APM 同样必须脱敏；应用可记录不含令牌的状态计数。到期数据可由管理员定期 `DELETE FROM preview_grants WHERE expires_at < now() - interval '1 day'`，关联 sessions 自动级联清理。

## B 的画廊接入约定

- iframe 固定 `sandbox="allow-scripts allow-same-origin"`、`referrerPolicy="no-referrer"`；不赋予 forms/popups/top-navigation，不在主站 origin 下运行该组合。
- 只将 `bootstrapUrl` 交给 iframe，平台 Bearer token 不传入 iframe，也不附加到资源 URL。
- 使用详情中的同一 `variantReleaseId` 签发 grant；其他示例入口在同 origin 下读取详情所列路径。
- 到期/404 可重新申请 grant；第三方 Cookie 被阻止时给出“独立窗口打开预览”按钮并重新签发，由用户操作打开隔离域，保持 `noopener,noreferrer`。本轮没有实现 B 的该 UI。
- 如使用 postMessage，必须同时校验消息 schema、`event.origin` 与 `event.source`，不信任预览字符串 HTML。

## 本地验证边界

`scripts/pnpm.ps1 test:platform` 包含真实 PG/MinIO/HTTP 授权与本地 Playwright Chromium 攻击测试。浏览器测试使用运行时生成的自签名证书和只解析测试域到 loopback 的 CONNECT 代理，不修改全局证书信任。样本为协议与恶意 HTML fixture，不冒充 SDK 0.0.4 真正渲染材料。

公司 OIDC/PKCE/撤权、生产独立注册域 wildcard DNS/TLS、目标浏览器第三方 Cookie 策略及 B 的真实画廊/八实现闭环仍需验收；不能据此标记完整 T07/G2/M2 完成。

容器入口支持 PLATFORM_BIND_HOST=0.0.0.0（默认本机loopback），启动失败不输出原始异常。生产准备模板使用独立DB/S3最小权限凭证，见 [operations](../../docs/operations.md)；尚未作为生产部署验证。
