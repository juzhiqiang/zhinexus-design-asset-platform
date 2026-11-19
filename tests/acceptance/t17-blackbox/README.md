# T17 冻结 CLI / MCP 黑盒验收

本目录只从仓库外安装冻结的 `@company/component-cli` tarball，再以独立 Node 子进程驱动 `dist/bin.js`。测试不导入 CLI 源码，不使用 `workspace:` 链接或源码 alias。冻结 tarball 在安装前、用例间与结束时校验同一 SHA-256；npm 安装禁用生命周期脚本，并使用空白用户/全局 npm 配置。

当前工作树还包含安装包身份校验、receipt 规范化/敏感字段保护、`verify` / `repair` 缺少输入时拒绝、MCP stdio 工具清单及 CLI/MCP `inspect` 对照用例。支架回归和必需输入校验可独立运行；`installed.spec.ts` 必须等真实冻结包和统一 runner 接口后才能执行。
集成用临时项目和 npm 冻结包消费者仅在仓外创建；测试结束时，只有真实路径与本次 `.t17-owner.json` 标记都匹配才清理。独立证据目录保留用于审查。

`installed.spec.ts` 中 MCP `apply_integration` / `verify_integration` 的当前负向调用传入空对象，拒绝结果可能来自参数结构校验；它们暂不作为“无授权写入被拒绝”的产品证据。MCP `plan_integration` 目前只检查工具清单，尚未调用。最终黑盒需要基于公开契约补齐有效 plan 的拒绝/授权路径、计划工具行为、verify/repair 分类与有限修复、项目快照不变性、超时取消和进程退出，并使用最终版本冻结 tarball。

在 PowerShell 中先构建服务端测试所需的本地产物，然后显式设置冻结输入：

```powershell
.\scripts\pnpm.ps1 build:services
$env:T17_D_CLI_TARBALL = 'D:\artifacts\company-component-cli.tgz'
$env:T17_D_CLI_SHA256 = '<冻结 tarball 的 SHA-256>'
$env:T17_D_NPM_CLI = 'D:\tools\node-v26.13.0-win-x64\node_modules\npm\bin\npm-cli.js'
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/t17-blackbox/vitest.config.ts
```

调用者应先完成 `pnpm pack`，计算摘要后冻结该文件；验收期间不得重新打包或替换 tarball。套件在摘要、Node 版本及必需路径校验通过后才启动隔离 PostgreSQL、Verdaccio、MinIO；缺包/摘要/Node/npm 输入或服务启动失败均应使套件失败，不允许 skip。测试临时工程和证据必须创建在仓库外。

支架本身可在不启动服务的情况下验证：

```powershell
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/t17-blackbox/support.vitest.config.ts
.\scripts\pnpm.ps1 exec vitest run --config tests/acceptance/t17-blackbox/preflight.vitest.config.ts
```
