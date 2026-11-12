# 本地三存储与接入检查（C / T01 / G2）

用户确认目前没有 OIDC 和独立预览域，本轮交付隔离开发环境及后续接入检查工具。三存储探针已真实验证；完整 G2/T01、业务迁移、发布状态机和生产部署仍未完成。历史接入计划见 [G1/G2 清单](../docs/superpowers/plans/2026-11-12-g1-review-g2-access.md)，本轮证据见 [本地设施验证](../docs/verification/g2-local-infra-2026-11-12.md)。

## 启动与验证

要求 Windows x64、Docker Desktop 的 Linux 容器、项目固定工具链和冻结依赖。首次构建需访问 Docker Hub、GitHub codeload 与 Go 模块源，可能耗时数分钟。

```powershell
.\scripts\pnpm.ps1 install --frozen-lockfile
.\scripts\pnpm.ps1 infra:up
.\scripts\pnpm.ps1 test:infra
.\scripts\pnpm.ps1 infra:check-access
# 需要停止时执行；保留数据和凭证
.\scripts\pnpm.ps1 infra:stop
```

| 设施 | 本机地址 | 固定版本 / 用途 |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:15432` | 18.6；用户和库均为 `zhinexus` |
| Verdaccio | `http://127.0.0.1:14873` | 7.1.0；`g2publisher` 写入，`g2reader` 只读 |
| MinIO | `http://127.0.0.1:19000` | RELEASE.2025-10-15T17-29-55Z；S3 API，关闭控制台 |

所有端口仅绑定回环地址；Compose 项目固定为 `zhinexus-g2`，三个命名卷独立于其他项目。命令只启动、重启或停止本项目，不删除卷。PostgreSQL/MinIO 管理凭证仅供本地设施探针，后续 API 业务账号和最小权限需在 T05 中单独实现。

`infra:up` 首次生成随机凭证到 Git 忽略目录 `.tools/g2-local/`，通过 Compose secrets 注入。再次启动复用凭证和卷；发现已有卷但缺凭证时拒绝初始化。请保管这个目录，不要把密码、token、`.npmrc` 或备份贴入提交、日志或群聊。Windows 文件继承当前用户 ACL；这套本机 HTTP/凭证方案不用于共享主机或生产环境。

镜像、源码和构建器摘要见 [versions.json](versions.json)。MinIO 从固定 commit 和校验过的源码包本地构建，使用本次实际 image ID 启动，ID 保存在被忽略的 `images.json`；不采用浮动旧镜像。C 维护本地构建；生产维护、漏洞处置和部署仍需单独明确。

## 探针实际覆盖

`test:infra` 直接运行，不进入 Turbo 缓存，也不隐含在日常 `verify.ps1` 中。每轮创建唯一探针 ID，逐项失败即返回非零：

- PostgreSQL 真实版本、表写读、唯一约束、备份；恢复到独立临时数据库后核对载荷摘要，仅移除该恢复数据库。
- 私有 S3 桶真实字节往返和匿名 403；备份恢复到新对象键。
- 每次 S3 操作（含响应体读取）设置 15 秒上限；超时取消请求、关闭响应流，进入失败报告并释放互斥锁。
- 发布账号登录，将无代码的探针包打包一次，发布唯一包名的 `1.0.0`；只读账号在工作区外干净目录精确安装，禁用生命周期脚本。
- 匿名读取和只读账号写入必须拒绝。重复提交相同 tarball 时绕过 npm 本地版本预检查，必须得到 Verdaccio 的真实 HTTP 409；再次下载并核对 SHA-256，不删除重发。
- 重启本项目三个服务，验证 PostgreSQL、S3 与注册表原数据保持一致。

每轮报告、冻结 tarball 与备份位于 `.tools/g2-local/runs/<runId>/`。探针表、对象和已发布测试包保留以便复核；运行次数增加会累积数据。报告不包含密码或 token，但同目录的消费配置含临时凭证，不应整体分享。探针不运行组件或截图，不等于 T03/T04 冻结组件验收，也不等于 T06 跨存储作业一致性或 T11 全存储灾难恢复。

启动、停止和探针共用 `operation.lock` 互斥。正常成功或异常会释放；进程被强制终止可能留下锁。先确认没有本项目启动/停止/探针进程在运行，再仅移除空目录 `.tools/g2-local/operation.lock` 后重试；不要删除凭证或数据卷。命令只打印阶段和脱敏错误，敏感子进程输出不会原样回显。

## OIDC 与独立预览域

默认 [access.example.json](access.example.json) 两项为 `null`。当前 `infra:check-access` 返回退出码 **2** 和 `g2Ready: false`，表示尚未配置。

资源准备好后，把不含秘密的配置写入 `.tools/g2-local/access.json`，例如：

```json
{
  "oidc": {
    "issuer": "https://identity.example.com/realm",
    "webClientId": "gallery",
    "cliClientId": "component-cli"
  },
  "preview": {
    "platformOrigin": "https://gallery.example.com",
    "apiOrigin": "https://api.example.com",
    "previewOrigin": "https://r-probe.example-assets.net"
  }
}
```

以上是占位地址，须替换为实际资源；必须同时提供画廊和管理 API origin，不接受 HTTP、URL 内凭证、query/hash，预览须与画廊及管理 API 的注册域均不同。

```powershell
$env:G2_ACCESS_CONFIG = '.tools/g2-local/access.json'
.\scripts\pnpm.ps1 infra:check-access
Remove-Item Env:G2_ACCESS_CONFIG
```

退出 **0** 仅表示两项前置检查成功：OIDC discovery 的 issuer/authorization-code/PKCE S256 和公开 JWKS 结构、画廊/API/独立预览 origin 的 DNS/TLS 可达。退出 **1** 表示配置或请求失败，**2** 表示有项未配置。结果写入 `.tools/g2-local/access-result.json`，失败也会覆盖旧结果；任何情况下 `g2Ready` 都为 `false`。

仍须交付：OIDC 网页/CLI 客户端注册、真实登录/回调/角色拒绝与撤销；独立域 wildcard DNS/TLS、逐发布 origin、preview-grant 和浏览器沙箱隔离。当前工具不能证明这些已完成，C 不代填 A/B 业务回执。
