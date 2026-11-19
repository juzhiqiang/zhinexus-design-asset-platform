# T17 冻结 CLI / MCP 黑盒验收

本目录只从仓库外安装冻结的 `@company/component-cli` tarball，再以独立 Node 子进程驱动 `dist/bin.js`。测试不导入 CLI 源码，不使用 `workspace:` 链接或源码 alias。冻结 tarball 在安装前、用例间与结束时校验同一 SHA-256；npm 安装禁用生命周期脚本，并使用空白用户/全局 npm 配置。

当前提交包含支架回归、必需输入校验和冻结包安装 smoke test。T17 的 verify/repair/MCP 产品命令场景仍需等冻结包实现与临时 Vue/React runner 接口落地后补齐；这组支架测试不代表 T17 完成。

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
