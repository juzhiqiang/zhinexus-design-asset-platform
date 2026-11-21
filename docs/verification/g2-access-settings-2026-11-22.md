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
