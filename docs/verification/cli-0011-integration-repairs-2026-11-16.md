# 集成后的 CLI 独立版本与 API 证据绑定修复

日期：2026-11-16。基线 `93022ee5`，沿用用户授权的 C 集成分支；A/B/D 已按批准顺序合并。本文新增验证，不改写历史结果。

## 修复范围

- CLI 接受冻结清单中各包的独立版本；同版时 `bundle.version` 为单版本，不同版时按 manifest 顺序以 `, ` 连接 `name@version`，与包内探针一致。
- API 从已发布的权威 manifest 重建相同聚合版本，继续逐包核对名称、版本、SHA-256、bytes；单个 wrapper 的版本不能冒充 bundle 身份。
- `echarts verify --help` 补齐 consumer-root、keep、timeout、skip-browser。

## 实际验证

固定 Windows Node 26.13.0 / pnpm 12.18.0，仓库命令均通过 `scripts/pnpm.ps1`。

| 命令 | 实际结果 | ignored 日志 |
| --- | --- | --- |
| `exec vitest run tests/unit/echarts-cli.test.ts`（RED） | 2 failed / 9 passed，分别命中旧同版本限制和 help 缺项 | `.tools/next-cli-red.log` |
| 同命令（GREEN） | 11 passed | `.tools/next-cli-green.log` |
| `exec vitest run tests/integration/compatibility-api.test.ts`（RED） | 真实 HTTP 返回 400 REPORT_MISMATCH，预期 201 | `.tools/next-api-red.log` |
| 同命令（GREEN） | 1 passed；包括单包/反序聚合拒绝、正确聚合接受及持久化 | `.tools/next-api-green.log` |
| `--filter @company/component-cli build` | exit 0；分发探针 73 文件，清单检查通过 | `.tools/next-cli-build.log` |
| `--filter @company/component-cli typecheck` | exit 0 | `.tools/next-cli-typecheck.log` |

API 测试使用严格冻结 SDK `.tools/operations/next-sdk-handoff-zQIRda`（core 0.0.10、Vue/React 0.0.11）；manifest SHA-256 `917f195aaa1deb12c30ad55a482241cbfd1182173777f4757edfbeff523c997d`。接口测试包含本地真实服务，不代表公司 OIDC 或生产 G2 接入。

## 当前边界

上述结果只覆盖本次修复。新版本号、冻结 CLI、新消费者 56 组合 hold/adopt、真实回退和 installed-compatibility 另行记录；当前不能据此宣布它们通过。原 SDK 和 CLI 0.0.10 tarball 保持不变。
