# T15 契约浏览器入口适配验证

日期：2026-11-17（Asia/Shanghai）；负责人 C / Codex。本记录仅覆盖已有浏览器验收的模块入口适配，T15 产品及最终验收仍在进行。

## 复现与根因

P0 在 `packages/contracts/src/index.ts` 新增 `integration-plan.js` 导出。已有 `tests/browser/contracts-runtime.spec.ts` 通过 HTTPS route 提供构建的契约模块，但固定白名单未包含新模块，导致 Chromium 动态导入整个入口失败。

经 `.\scripts\pnpm.ps1 build` 准备工作区产物：exit 0，10/10 构建任务成功，其中 8 个缓存命中。本次只用于复现准备，不能作为最终强制全图构建证据。确认 5173–5176 无占用后运行：

```powershell
.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts
```

实际 **1 项失败、exit 1**：`page.evaluate: TypeError: Failed to fetch dynamically imported module: https://contracts.example.test/index.js`，失败位于原有入口动态导入。日志为忽略目录 `.superpowers/sdd/2026-11-16-phase3-t15-kickoff/browser-contract-import-red-2026-11-17.log`。

## 最小适配与 GREEN

仅在测试 route 模块白名单增加 `integration-plan`，未改变产品代码、模块导出或原有契约/摘要断言。重新执行同一命令：**1 项通过、0 跳过、exit 0**，3.3 秒。真实本机 Chromium 完成冻结 fixture 校验与 Web Crypto digest 验证。

随后执行：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
git diff --check
```

两项均 exit 0。GREEN 和类型日志分别为 `browser-contract-import-green-2026-11-17.log`、`browser-contract-root-tsc-2026-11-17.log`，构建准备日志为 `browser-contract-build-2026-11-17.log`，均位于上述忽略目录。固定 Node 26.13.0、pnpm 12.18.0；没有 pack、版本升级、SDK 重打包或 push。

最终候选仍须按 T15 P4 执行强制全图 build/typecheck、两个浏览器专项、独立黑盒和同一冻结 CLI 的真实服务验收。本次 GREEN 不代表这些门槛已完成。
