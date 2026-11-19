# T17 owned-host runner 实测记录

日期：2026-11-19（Asia/Shanghai）。范围：T17 host runner 在 Windows 临时消费者上安装冻结 CLI，并分别执行 Vue / React `integrate inspect`。本记录是有限的黑盒实测，不代表 T17 整体验收通过。

## 冻结输入与封存证据

- CLI：`@company/component-cli@0.0.17`，tarball SHA-256：`02f8d5277952c072be47bfb8f907424fbbcf4a992c3ed6a625350c8628c78df2`，445,771 bytes。
- 安装后 CLI bin SHA-256：`0d31b3052077b6e39995859b1bea4baac8ec052b1f529dba4dcf5f6eb7ab8753`。
- runner：runId `3a59aac35483afd778d6a0e07cec1eb9`；临时 CLI / Vue / React 项目根由 owned-run 在完成后清理。
- 封存证据：`<系统临时目录>\zhinexus-t17-evidence-<runId>-<suffix>\run-seal.json`，seal payload 为 `passed`，封存 9 个文件。
- Vue inspect stdout SHA-256：`16c5140fdc5ff95ecf2cef06c2b7e99488b6517e17ed80f903c3c89b859a9105`；React inspect stdout SHA-256：`d3b762bc7c1198c546ec91058b29c8cc00cef69593d68bd722c5a1ce5aad4b01`。两次 stderr 均为空。

## 观察结果

| 框架 | 进程结果 | CLI 报告 | 包管理器 / lockfile | 冲突 | 文件快照 |
|---|---:|---|---|---:|---:|
| Vue | exit 0 | `inspected` | npm / `package-lock.json` | 0 | 2 |
| React | exit 0 | `inspected` | npm / `package-lock.json` | 0 | 2 |

报告识别到 Vue `3.5.45` 或 React `19.3.1`、ECharts `6.1.0`，以及固定模板中的 Vite / TypeScript 依赖。runner 核对冻结 tarball 摘要、安装包身份与版本、安装后的 CLI bin 摘要，分开保存 stdout 和 stderr，并在完成后停止所拥有的进程，再封存结果。

## 验证命令

- `scripts/pnpm.ps1 exec vitest run --config tests/acceptance/t17-host/vitest.config.ts`：4 个测试文件、43/43 通过。
- runner / host 九个 TypeScript 源码与测试文件的独立严格检查：`tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node ...`：exit 0。
- `git diff --check`：exit 0；Git 提示 `runtime.ts` 的工作区 CRLF 将规范化为 LF。
- 真实 runner 使用仓库固定 Node `26.13.0` 与 npm `11.20.0`；tarball 安装及 Vue / React inspect 均成功，seal 已从证据目录重读核对。

## 未覆盖范围

此 tarball 是 T16 `integrate inspect` 基线。该运行没有证明 T17 的 plan / apply / verify / repair、四项 MCP 工具、浏览器构建与交互、视觉基线、20 个正向场景和 13 个拒绝场景，也没有连接真实 API、Verdaccio 或有效 variant-release 映射。上述场景和完整 T17 仍未验收；本记录不得用于将 T17 状态改为完成。
