# T16 真实 npm 安装与交付阻断记录

本记录新增证据，不改写历史验收。C 在指定 B+C 工作树使用真实固定 Node/npm、真实隔离 PostgreSQL/MinIO/Verdaccio 及已冻结 SDK；当前 CLI 来自开发构建，尚非最终冻结 CLI 验收。完整 T16/T17、八组合矩阵与 D 黑盒均未通过。

旧测试栈的 Verdaccio `uplinks: {}` 拒绝第三方 Vue/ECharts 请求，不能据此认定产品包管理器进程有缺陷。C 新增仅供 T16 本地验收的 `tests/acceptance/t16-registry.yaml` 与 `t16-installed-global-setup.ts`：仅替换独占栈的只读配置挂载，第三方包走真实 npmjs，私有 `@company/*` 不代理；共享及生产配置未修改。生命周期、资源归属、凭据与 teardown 复用 RecoveryStack。

实际运行前设置 `A10_FROZEN_BUNDLE`、`INSTALLED_CLI_EVIDENCE`、`T16_CLI_ENTRY` 为既有冻结 SDK、已安装 SDK 证据及开发 CLI 的绝对路径，`T16_DIAGNOSE_CANDIDATE=true`。命令：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t16-installed.config.ts','-t','vue-npm-standalone','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/installed-uplink-vue.json')
```

exit 1；12 collected / 0 passed / 1 failed / 11 未选择。真实 CLI exit 0 但业务结果 rolled-back / INSTALL_FAILED / reinstall-required；通过必须同时符合结果契约与 applied 状态，退出码不能单独证明成功。

证据保留于仓外临时目录 `zhinexus-t16-installed-XJqIDR`：真实 npm ci 日志 exit 0，第三方及冻结 SDK tarball 请求成功，staging node_modules 已物化。候选 package-lock 在物化前后均为 SHA-256 `236ae4b7788a0e49f33c95438f73eb782bffb8b06a9f61130c8025028f756cfc`。失败发生在 B planDelivery 枚举 npm 自动生成的 `node_modules/.package-lock.json` 普通文件时；不是候选锁变化或 npm 安装进程失败。原始临时配置可能含测试凭据，禁止提交或对外交付。

C 补独立普通元数据文件/同名工程外链接测试并确认 RED，见 [B 补修 brief](../superpowers/plans/2026-11-18-t16-b-npm-metadata-brief.md)。三产品最新完整命令：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-apply.test.ts','tests/integration/project-install-isolation.test.ts','tests/integration/project-rollback.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/product-current-red-84.json')
```

exit 1；84 collected / 73 passed / 11 failed / 0 pending，行为断言失败且无收集错误。C 新增测试与三个验收 TS 文件窄 TS7 检查 exit 0，日志 `c-install-evidence-typecheck.log`；这不证明 B 产品或矩阵已完成。

后续门槛：B 产品补修、C 新构建与全量矩阵、实际 D 黑盒、全图/平台/浏览器验收、版本与单次冻结产物、main 合并后复验。未提供真实业务项目，技术验收也不得替代业务 T16/T17。
