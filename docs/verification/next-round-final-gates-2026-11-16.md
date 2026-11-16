# 集成修复全图门禁与审查（2026-11-16）

代码基线：`f9555bc1`，包含 A→B→D 合并、CLI/API 独立版本绑定、回退留证及旁置诊断修复。固定 Windows Node 26.13.0 / pnpm 12.18.0；原始架构 SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 实际门禁

通过 `scripts/pnpm.ps1` 顺序执行 install --frozen-lockfile、verify:workspace、build、typecheck、test。进程设置 `TURBO_FORCE=true`、`NEXT_PUBLIC_SITE_URL=https://gallery.test`，`A10_FROZEN_BUNDLE` / `ZHINEXUS_SDK_BUNDLE_DIR` 均指向 `.tools/operations/next-sdk-handoff-zQIRda`。

| 命令 | 实际结果 |
| --- | --- |
| install --frozen-lockfile | exit 0 |
| verify:workspace | exit 0 |
| build | 10/10 成功，0 cached |
| typecheck | 14/14 成功，0 cached，根 tsc 通过 |
| test | T10 168 passed / 0 failed / 0 skipped；Vitest 70 文件、1113 项通过 |
| test:browser | 260 passed |

本机日志为 ignored `.tools/next-full-{install,verify-workspace,build,typecheck,test}.log` 与 `.tools/next-full-browser-green.log`。浏览器首跑单独进程遗漏 `ZHINEXUS_SDK_BUNDLE_DIR`，254 passed / 2 failed / 4 did not run，明确报 MISSING_ENV；补齐同一冻结输入后完整重跑得到上表结果，首跑日志保留于 `.tools/next-full-browser.log`。

## 独立审查与更正

独立只读审查覆盖 `b13c8aee..f9555bc1`，确认一项 Important：ID 交接文档将 DesignIdInputV1 当成完整 POST 请求，遗漏必填 design/context，导致 INVALID_SCHEMA。已改为完整 JSON 示例，补 context 必需字段、可选 bindings/reactDomVersion，并指向 match-plan.ts 契约。

以固定 Node 执行 `.tools/next-review-doc-check.mjs`：旧形态明确拒绝并定位 /design、/context 缺失；从更正文档提取的 JSON 通过真实 `validateMatchPlanRequest`。此修改仅文档，不增产品行为或永久测试。既有历史验证段落未改写。

审查未发现其他可操作问题；其未评判的实际冻结 CLI 矩阵、回退、installed API 接受继续以新候选实测记录为准，不能用本门禁代替。G2 外部服务和真实 ID 业务样本依旧未完成。

## 执行裁定

- 获授权合并后由 C 内联完成交接修复：A/B/D 已停写，避免继续维护待清理工作树；如仍有并发写入会有冲突风险，已在改前核查干净状态。
- Windows 下按既有叙述计划维护执行台账，未重新生成任务 brief；逐项对照原依赖顺序防止漏项。
- 先完成代码审查再冻结 CLI，以免发现修复后不得重打包的候选需要废弃；实际矩阵仍在审查后执行。
- 本次按现有独立包版本惯例将 CLI 0.0.10→0.0.11、API 0.0.7→0.0.8；根整体版本维持 0.0.5，因为整体平台发布门槛未完成，外部验收不因此关闭。
