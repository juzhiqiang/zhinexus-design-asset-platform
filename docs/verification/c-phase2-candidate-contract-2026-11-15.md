# C2 候选公共契约验证

日期：2026-11-15。执行计划：`docs/superpowers/plans/2026-11-15-phase2-candidates.md`。

- RED：`.\scripts\pnpm.ps1 exec vitest run tests/contracts/search.test.ts`，27 项失败，因新校验器和 schema 尚不存在。
- GREEN：`.\scripts\pnpm.ps1 --filter @company/contracts schemas:generate` 通过；`.\scripts\pnpm.ps1 exec node packages/component-cli/scripts/sync-contracts.mjs` 同步通过。
- `.\scripts\pnpm.ps1 exec vitest run tests/contracts`：10 文件、198 项通过（含 27 项新测试和生成 schema 精确一致性）。
- `.\scripts\pnpm.ps1 exec turbo run build --force`：10/10 成功、0 缓存命中；现有示例大 chunk 提示不影响成功。
- `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`：退出 0。
- `.\scripts\pnpm.ps1 verify:workspace`：10 成员、无循环、公开包及服务端依赖边界通过。

候选必须同时提供 API 和文档证据；截图来源、兼容证据和评分各自独立。JSON Schema 描述形状，跨字段约束由运行时校验器执行。形状通过不证明证据真实或兼容记录被服务器接受。私有未接入契约不触发公开功能升版。

本记录仅验收公共契约，不代表 T13 检索服务或 T14 评估完成。无 HTTP/PG 检索、外部模型和真实标注集验证。后续过滤与 A/B 验证另行记录，不覆盖历史记录。
