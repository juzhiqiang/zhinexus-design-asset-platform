# G2 接入设置追加验证

本轮按已批准设计实现配置能力和本机验证。公司真实 Web/CLI、停用及角色撤销时限、生产逐发布 DNS/TLS 仍是独立 G2 待验项。

## 配置契约和持久化

- RED：`scripts/pnpm.ps1 exec vitest run tests/contracts/access-settings.test.ts`，2 新增测试失败（缺少正文解析器、预览模式与地址错配被放行）。
- GREEN：相同命令，4/4，退出 0。
- RED：`scripts/pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/access-settings.test.ts`，2/2 失败（管理端点未实现，返回 404）。
- GREEN：相同命令，隔离 PostgreSQL/MinIO/Verdaccio，2/2，退出 0。覆盖独立管理员、普通 maintainer 拒绝、额外键拒绝、并发 CAS、未验证配置拒绝启用、重启持久化、管理员停用。
- `scripts/pnpm.ps1 build:services`，5/5，退出 0。
- `scripts/pnpm.ps1 --filter @company/contracts schemas:generate`，退出 0。

原始架构 SHA-256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

后续步骤和全图结果将在本记录追加；尚未执行的命令不作为通过证据。

## OIDC 与 CLI 本机验证
- `scripts/pnpm.ps1 exec vitest run tests/contracts/access-settings.test.ts tests/unit/access-cli.test.ts tests/integration/access-network.test.ts tests/integration/auth.test.ts`：110/110，退出 0。TLS 地址固定、IP SAN、网络白名单、越界重定向和响应上限均实测。
- `scripts/pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/access-oidc.test.ts tests/platform/access-settings.test.ts tests/platform/database.test.ts`：5/5，退出 0；完整 Web PKCE、nonce 拒绝、候选权限隔离、配置启用、旧会话失效、逐请求角色限制及空库迁移往返。
- 随后 `tests/platform/access-oidc.test.ts` 再次通过，1/1，退出 0；增加实际 CLI 回环 PKCE 和 TLS 令牌兑换。
- `scripts/pnpm.ps1 --filter @company/component-cli build`：编译和探针打包复核通过，退出 0。
- 发现原契约草稿含字面控制字符，将其改为正则转义，消除 Git 二进制判定；不改变拒绝控制字符的行为。

## 预览活动版本与切换
- RED：新增 IP 宿主到独立域的契约测试失败；新增切换 HTTP 测试因缺少网关检查失败。
- GREEN：`scripts/pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/access-preview.test.ts tests/platform/preview.test.ts`，13/13，退出 0。使用真实预构建协议资产、三存储、TLS 与网关，覆盖错入口拒绝、两个发布 host、IP/域名切换、回退代数与旧 grant/session 拒绝。
- 域名测试将本机 DNS 解析接口固定到测试回环地址，实际 TLS 主机名与通配 SAN、网关路由和资源读取是真实检查；这不替代生产 wildcard DNS 验收。
- `scripts/pnpm.ps1 build:services`，5/5，退出 0。
