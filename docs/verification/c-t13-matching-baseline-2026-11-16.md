# 二期 T13/T14 C 匹配服务基线验证

日期：2026-11-16（Asia/Shanghai）。分支 `feat/t13-c-matching`，基线 `b13cc2d7`（main，版本 0.0.5）。本记录只补充本次分支基线验证，不改写历史验证记录。

## 范围

C 在 T13/T14 阶段的工程层交付已在 main 上完成：`packages/contracts/src/{match-plan,design-id,component-api}.ts`、`apps/api/src/{matching,search,index}`、`apps/api/migrations/008_search.sql`。本次分支工作的重点是确认这些实现可在固定工具链下复现，并为 B 的 `/match` 接入提供稳定的契约导出。

## 实际执行

所有命令使用仓库 `.tools` 中 Node 26.13.0 / pnpm 12.18.0，通过 `scripts/pnpm.ps1` 执行。

| 命令（省略 `.\scripts\pnpm.ps1` 前缀） | 实际结果 |
| --- | --- |
| `verify:workspace` | 10 成员、无循环、4 公开包、服务端依赖边界安全 |
| `--filter @company/contracts build` | 通过 |
| `--filter @company/charts-core --filter @company/charts-vue --filter @company/charts-react build` | 通过 |
| `--filter @company/platform-api typecheck` | 通过 |
| `exec vitest run tests/contracts/design-id.test.ts tests/contracts/match-plan.test.ts` | 2 文件、55/55 通过，236ms |
| `exec vitest run tests/integration/match-plan.test.ts tests/integration/search-eligibility.test.ts` | 2 文件、56/56 通过，431ms |
| `exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching.test.ts tests/platform/search.test.ts` | 2 文件、9/9 通过，20.47s；真实隔离 PG/MinIO/Verdaccio/OIDC |

## 契约导出确认

`packages/contracts/src/index.ts` 已导出 `match-plan.js` 全部内容，包括：

- 类型：`MatchPlanRequest`、`MatchPlanV1`、`MatchElement`、`MatchTarget`、`MatchGap`、`MATCH_GAP_CODES`
- 验证器：`validateMatchPlanRequest`、`validateMatchPlan`
- JSON Schema：`match-plan-request-v1`、`match-plan-v1`（`CONTRACT_SCHEMAS`）

B 的 `match-plan-client.ts` 可直接使用这些导出，不需要自定义 HTTP 形状。

## 未覆盖边界

- 真实 30+ 标注集仍未提供，T13/T14 总体验收保持开放。
- 公司 OIDC、独立预览域、真实业务试点不在本分支范围。
- 本次未重跑全量根 `test` 与 `test:browser`；相关验证沿用 `phase2-id-integration-2026-11-16.md` 的历史结果，后续合并前由 C 统一补跑。
- 原架构 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
