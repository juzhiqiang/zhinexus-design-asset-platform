# 画廊与内网管理端部署

配套入口为 `infra/gateway/gallery-public.conf` 和 `infra/gateway/admin-internal.conf`。模板必须替换域名、证书、真实网络和源站地址后才能部署；测试通过不代表生产上线。

## 应用与端口

| 应用 | 本地端口 | 职责 |
| --- | --- | --- |
| gallery | 5173 | 公开目录、详情，以及登录后的 /library |
| admin | 5177 | 仅内网/VPN：上传、任务、匹配、账号权限、接入设置 |
| API | 3000 | 共用身份、目录、发布、权限服务 |
| preview-gateway | 3001 | 隔离的静态预览入口 |
| Vue / React 示例 | 5174 / 5175 | 开发示例 |

11 个工作区成员仍由 Turborepo 编排。production compose 保持 API、worker、preview-gateway、PostgreSQL、Verdaccio、MinIO 六服务拓扑；两前端和 TLS 入口独立部署，不改变后端安全拓扑检查。

## 共用 API origin

例如画廊为 https://assets.example.com，管理端为 https://admin.assets.example.com，两端均在构建时设置 `NEXT_PUBLIC_PLATFORM_API_URL=https://api.assets.example.com`。优先使用同站点 HTTPS 域名，并验收真实浏览器 Cookie 策略。

API 注入精确 origin，不含路径、通配符或尾斜杠：

```text
PLATFORM_GALLERY_ORIGIN=https://assets.example.com
PLATFORM_ADMIN_ORIGIN=https://admin.assets.example.com
PLATFORM_API_ORIGIN=https://api.assets.example.com
```

API 已实现两端精确 CORS/CSRF 检查。登录分别用 `?target=gallery` 和 `?target=admin`，目标持久化在 OIDC attempt，完成后分别回到 /library、/upload；候选接入验证回管理端 /access-settings。未知 target 与任意返回 URL 被拒绝。新增迁移014按迁移ID应用，013留给独立在途身份服务工作。

会话是 host-only `__Host-platform` Cookie（Secure、HttpOnly、Path=/，无 Domain）。IdP 回调为同一 API origin 的 /v1/auth/oidc/callback。admin hostname 的 /v1/、/identity/、/internal/ 均404，浏览器直接请求 API hostname。

## 网络边界

公网 API 仅开放明确的目录、详情、材料、兼容记录读取、登录/会话/退出与预览授权。私有目录由既有 catalog_can_read 和逐组件权限控制，登录不自动授予全部资产权限。

发布、上传、匹配、账号/接入管理、候选配置、CLI 登录、/internal/ 以及兼容记录写入仅接受可信内网/VPN连接来源，之后仍需 API 身份鉴权。未知路径默认拒绝。Origin、X-Forwarded-For 和 Forwarded 均不能伪造内网身份；两配置可信CIDR保持一致，默认占位网段不放行真实用户。前置代理存在时，仅对审核过的代理设置 set_real_ip_from，并阻断绕过入口的源站访问。

内网 API 必须使用与公网相同的 hostname 和外部 HTTPS 443 origin，通过分流DNS指向私有VIP即可。模板中的全部 `listen 8443`（包括default_server）是测试占位：部署时换成私有VIP的443监听。若容器内部保留8443，仅允许私有VIP的443映射进入，浏览器仍访问相同HTTPS443 origin，转发头应反映外部origin。不能向公网发布8443，不能让内外网default_server绑定同一地址端口冲突。

替换两模板的主机名、TLS路径、可信CIDR、listener和upstream。loopback upstream仅适合同机进程；Docker入口应通过私有edge网络使用真实服务地址。3000、3001、5173、5177及存储源端口均不得直接对公网开放。预览继续按独立注册域名或已授权IP分HTTPS端口模式隔离。

API入口请求体上限8MiB，与Nest的8mb JSON上限配套。保留身份端点限速；日志不记查询串、Cookie和Authorization。/identity/默认拒绝，本次未集成独立本地身份服务。

## 构建与启动

Windows构建前设置API地址：

```powershell
$env:NEXT_PUBLIC_PLATFORM_API_URL='https://api.assets.example.com'
pnpm install --frozen-lockfile
pnpm --filter @company/gallery --filter @company/admin build
```

在两个受进程管理器管理的终端分别运行：

```powershell
pnpm --filter @company/gallery preview
pnpm --filter @company/admin preview
```

默认监听127.0.0.1:5173/5177。容器内需在相应应用目录执行等价的 `next start --hostname 0.0.0.0 --port 5173` 或5177，仅加入私有入口网络。NEXT_PUBLIC变量在构建时写入客户端产物，改变API地址后须重新构建两端。

本地开发运行 `pnpm dev`。遇端口占用先确认已有服务归属，避免重复启动；开发服务本身不提供生产VPN边界。

## 迁移与验收

画廊旧 /upload、/jobs/:id、/match、/users、/access-settings 返回404；内部书签改成admin origin对应路径。默认登录回跳改为/library。root/gallery/API因此升至0.1.0，新admin为0.0.1。

```powershell
pnpm verify:workspace
pnpm verify:deployment
pnpm -PnpmArgs @('exec','vitest','run','tests/infra/gallery-admin-ingress.test.ts')
```

实际Docker Nginx配置和行为13项通过：两个nginx -t、可信/不可信网络、伪造请求头、默认拒绝、OIDC参数、2MiB接受与9MiB拒绝。最终证据见 [集成验证记录](../verification/2026-11-24-gallery-admin-split.md)。Claude早期审查保留为历史基线。

上线仍需在真实公网和VPN验证DNS/TLS、共享会话/退出、资产授权、管理拒绝、源站不可达、公司IdP回调及预览隔离。本机签名OIDC测试不替代公司IdP验收。
