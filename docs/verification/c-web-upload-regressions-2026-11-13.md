# C 网页恢复与摘要竞态回归的 RED 记录

日期：2026-11-13。C 仅新增独立验收测试，不修改 B 产品代码。本记录保留测试的失败证据，不表示 B 最终网页版本已验收。

## 测试入口和范围

- `tests/acceptance/web-upload-workflow.mts`：指定源码目录的 12 项工作流诊断；网络、上传和存储接口为显式 mock，检查内存持久化、三元组绑定和恢复规则，不替代真实 HTTP/三存储验收。
- `tests/acceptance/web-upload-recovery.spec.ts`：11 项真实 Chromium UI 测试，API 为显式 mock；覆盖 legacy 缺字段、API/subject/清单不一致、点击时重新检查、原请求重放/四键清理、reload 及同页切换用户。
- `tests/acceptance/web-upload-validation.spec.ts`：1 项真实目录/真实 Web Crypto 摘要的异步竞态测试；只延后一个真实摘要结果的交付，不伪造摘要值，不提交网络发布作业。
- `tests/acceptance/playwright.web-upload.config.ts`：仅收集上述两份 `web-upload-*.spec.ts`。默认启动 5173 的生产画廊，`WEB_UPLOAD_PORT` 可使用独立端口，`WEB_UPLOAD_ORIGIN` 可指向已启动的服务。

工作流脚本是显式执行的独立探针，不会由 Playwright 或根 test 自动收集；不能把只运行浏览器描述为已运行工作流反例。

## 固定旧版本的真实 RED

B 旧固定提交：`cddf54b721183c4bcedf18a6d607925fc12e7afc`。C 通过 Git archive 导出独立目录 `.tools/operations/b-web-native-cddf54b/source`，离线冻结安装退出 0；`turbo run build --force` 实际 10/10、零缓存。只复制 C 自有验收文件，不修改旧产品源码。

冻结材料使用已有 `69443f97-8b73-4ecb-91aa-d8835a0b58dc`（SDK 0.0.6）批次。只读复用，没有重新 pack；需要损坏字节的用例在带 `c-web-digest-` 前缀的系统临时目录内复制材料，并按路径边界校验后清理。浏览器使用端口 5183，不与 B 的 5173–5176 冲突。

实际执行（均先设置冻结目录与端口环境变量）：

```powershell
$env:WEB_UPLOAD_FROZEN_BUNDLE = '<已有冻结批次的绝对路径>'
$env:WEB_UPLOAD_PORT = '5183'
.\scripts\pnpm.ps1 exec playwright test --config tests/acceptance/playwright.web-upload.config.ts --reporter=line
.\scripts\pnpm.ps1 exec playwright test --config tests/acceptance/playwright.web-upload.config.ts --grep 'resume handler' --reporter=line
.\scripts\pnpm.ps1 exec playwright test --config tests/acceptance/playwright.web-upload.config.ts --grep 'older valid' --reporter=line
```

三次阶段性执行结果：最初 8 项恢复 UI 全部按预期失败；追加的 3 项点击 handler 检查全部按预期失败；摘要竞态用例在最终“保持禁用”断言真实失败。分别保存为 `recovery-red.log`、`recovery-handler-red.log`、`digest-race-red-settled.log`，均在上述忽略目录、退出码 1。

竞态时序：合法快照 A 的一个摘要结果延后；导入同名但错字节 tarball 的快照 B，页面先显示 `DIGEST_MISMATCH` 并禁用按钮；放回 A 的真实摘要后，旧空错误列表覆盖 B，提交按钮错误启用。测试等待全部摘要 promise 已完成、React 刷新，并加连续 12 帧的禁用采样，避免仅等待摘要调用数造成假绿。补强后在旧固定版本再次实跑，仍于相同语义断言 RED。

另两个独立工作流反例先在 B 中途源码实跑 RED：同 session 损坏 pending 会换新幂等键继续 POST；无 pending 的上传失败后重试会复用过期 URL。原始诊断 `b-recovery-edge-red.json` 保留在 `.tools/operations/sdk-policy-audit/`。B 后续中途修订已通过 C 的 12 项 mock 探针，但没有最终固定 hash，因此该结果只用于反馈，不作为最终验收。

## C 测试质量检查

C 实际运行根 `tsc --project tsconfig.json --noEmit --pretty false`、`verify:workspace` 和 `git diff --check`，均退出 0。独立审查曾指出 pending 凭据保留断言与摘要 promise 完成时点不足；已分别补上完整 pending/active id/plan 原样保留、release 使用新 session、等待全部 settled 及稳定帧采样，复核无 Critical/Important。审查结论是静态结论，不冒充测试执行。

## 最终验收仍待执行

B 需完成页面竞态和恢复修复、同步单元/浏览器测试、fix 与独立升版提交。C 再导出该固定 hash，复制本轮自有测试后执行离线安装、强制构建/类型、工作区、单元、上述 12 项浏览器与 12 项显式 workflow 探针，以及 B 的真实三存储端到端流程。通过后新增最终记录，不改写此 RED 历史。公司 OIDC、生产独立域/TLS 与真实业务试点仍单列，不能由本套 mock API 测试替代。
