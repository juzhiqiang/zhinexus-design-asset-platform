# 同一台服务器按 HTTPS 端口提供组件预览

只有 IPv4 时，画廊、管理 API 和预览网关可以放在同一台服务器。预览使用专用 HTTPS 端口，画廊和 API 也可以共用一个 HTTPS 入口，由反向代理分流。

## 启用 IP 预览

以下用 `192.0.2.8` 示意，部署时换成客户端实际访问的 IPv4。证书的 SAN 必须包含该 IPv4，且访问者的浏览器信任签发链。三个地址都填完整的 HTTPS origin，省略末尾斜杠。预览端口必须显式填写，且不同于画廊与 API 的端口。

| 变量 | 示例 | 使用位置 |
| --- | --- | --- |
| `PLATFORM_PREVIEW_MODE` | `ip-port` | API 和预览网关运行环境 |
| `PLATFORM_GALLERY_ORIGIN` | `https://192.0.2.8` | API 和预览网关运行环境 |
| `PLATFORM_API_ORIGIN` | `https://192.0.2.8:8444` | API 和预览网关运行环境 |
| `PLATFORM_PREVIEW_ORIGIN` | `https://192.0.2.8:8443` | API 和预览网关运行环境 |
| `NEXT_PUBLIC_SITE_URL` | `https://192.0.2.8` | 画廊构建环境 |
| `NEXT_PUBLIC_PLATFORM_API_URL` | `https://192.0.2.8:8444` | 画廊构建环境 |
| `NEXT_PUBLIC_PLATFORM_PREVIEW_MODE` | `ip-port` | 画廊构建环境 |

1. 按 [平台运维](operations.md) 配置现有存储、OIDC 和最小权限凭证，给画廊、API 和预览配置各自的 TLS 入口。身份提供方若限制回调 URL，更新已有客户端注册。
2. 使用 [Nginx 预览入口模板](../infra/gateway/preview-ip.conf) 监听专用端口。主机进程部署时，上游可用 `127.0.0.1:3001`。使用 Compose 时，让入口容器加入 `PLATFORM_EDGE_NETWORK`，把模板上游改为 `preview-gateway:3001`。保持网关内部明文端口不可对外访问。填写实际证书与密钥挂载路径后执行 `nginx -t`。
3. 使用上述变量构建画廊并启动服务。`NEXT_PUBLIC_*` 在 Next.js 构建时写入产物。运行 `.\scripts\pnpm.ps1 preflight:production --environment` 和 `.\scripts\pnpm.ps1 verify:deployment --environment`。使用 Compose 时再运行 `docker compose -f infra/compose.production.yaml config --quiet`。
4. 用浏览器访问画廊，登录后打开一个 Ready 实现，分别切换框架并刷新预览。应在 iframe 中看到预览，刷新会申请新授权。可在 [接入检查](../infra/README.md#oidc-与独立预览域) 的 `preview` 对象中加 `"mode": "ip-port"`，填入三个 origin 后检查目标入口的 TLS。

画廊只把一次性授权交给 iframe。网关兑换后签发绑定发布版本的资源路径，有效期从签发授权开始计算，共五分钟。此模式不签发也不接受预览 Cookie。浏览器仍可能把同一 IP 的 Cookie 发给 TLS 入口，所以入口在转发前清除 Cookie 和 Authorization。上游代理、负载均衡器与监控也须避免收集或缓存 `/bootstrap` 的查询串和 `/_preview/` 的授权路径。预览在不透明源沙箱内运行，组件静态资源仍按发布清单和摘要校验。

## 获得域名后切换

准备独立预览域的通配 DNS 和 TLS，启用 [域名入口模板](../infra/gateway/preview.conf)。将三项服务 origin 换成对应域名，把 `PLATFORM_PREVIEW_MODE` 和 `NEXT_PUBLIC_PLATFORM_PREVIEW_MODE` 设为 `domain` 或去掉，再构建画廊并重启服务。若画廊入口有变更，同步更新身份提供方回调地址。现有发布资料与数据库结构可继续使用，切换后由画廊为预览重新申请授权。

正式 G2 仍需在公司环境验证登录、撤权和独立预览域 DNS/TLS。
