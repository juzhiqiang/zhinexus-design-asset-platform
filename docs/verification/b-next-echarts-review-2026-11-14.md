# B 侧第二阶段 `component echarts` C 复核补强独立验证记录 (2026-11-14)

- **工作分支**：`feat/b-baseline-cli`
- **基线版本**：`@company/component-cli` 沿用本周期未发布的 `0.0.8`（`CHANGELOG.md` 统一由 C 收口）。
- **工具链**：`.\scripts\pnpm.ps1`（Node `26.13.0`、pnpm `12.18.0`）。

## 1. C 复核四项补强（先 RED 后 GREEN）

1. **`--version <exact>` / `--latest` 与 `check` 真实查询 `--registry`**
   - [cli.ts](file:///d:/project/zhinexus-design-asset-platform/packages/component-cli/src/cli.ts) 与 [echarts.ts](file:///d:/project/zhinexus-design-asset-platform/packages/component-cli/src/commands/echarts.ts)：`echarts check` 与 `echarts verify` 均支持 `--version <exact>`、`--latest` 及 `--echarts <exact>` 别名（冲突或非精确版本报 `CONFLICTING_CANDIDATE_OPTIONS` / `NOT_EXACT_VERSION`；`--latest` + `--registry offline` 报 `OFFLINE_LATEST_UNSUPPORTED`）。
   - `checkEchartsBundle` 通过 `resolveCandidateFromRegistry` 联网查询 `--registry`（默认 `https://registry.npmjs.org/echarts`，支持 `AbortSignal.timeout` 与 `redirect: 'error'`），核对候选存在性与 `dist.integrity`，并记录 `candidateIntegrity`、`isOfficialRegistry` 及非官方代理/离线模式说明（`registryProxyNote`）。

2. **`verify` 严格证据绑定与双框架实测校验**
   - `verifyEchartsCandidate` 绑定本次冻结 bundle 三包 `name`/`version`/`sha256`/`bytes`（空 `packages[]` 或任一包不一致报 `BUNDLE_EVIDENCE_MISMATCH`）；绑定请求候选版本（不一致报 `CANDIDATE_MISMATCH`）。
   - 直接校验 `combinations` 中的 `vue` 与 `react` 记录（禁止只信任 `policy` 布尔），拒绝未知或缺失任一框架（`FRAMEWORK_COVERAGE_INVALID`）、拒绝 `adopt` 但 `failures` 非空（`INCOMPLETE_EVIDENCE`）、要求 `policy.supportedRangeUnchanged === true`（否则 `POLICY_NOT_SATISFIED`）。

3. **唯一输出运行目录、防重用旧文件和 `--label` 约束**
   - 校验 `--label` 必须匹配 `/^[a-z0-9-]+$/`（`INVALID_LABEL`）。
   - 未指定 `--out` 时每次创建唯一临时目录并在 `finally` 清理；指定 `--out` 时若目标 `probe-evidence[-<label>].json` 已存在，直接拒绝（`OUTPUT_ALREADY_EXISTS`），杜绝重用同名旧 `adopt` 文件。

4. **`scopeNotes` 与 `uncovered` 口径对齐**
   - `validateProbeEvidence` 支持可选 `scopeNotes?: string[]`，`uncovered` 仅保留缺失的本地检查项；待 A 侧将范围说明迁移至 `scopeNotes` 并完成 Windows/字体/revision 修复后，即可用真实 A 探针完成完整通过路径验证。

## 2. 实际执行命令与结果

| 检查项 | 执行命令 | 实际结果 |
|---|---|---|
| RED 验证（新增 `--version`/`--latest`、代理、防伪造绑定与防重用） | `.\scripts\pnpm.ps1 vitest run tests/unit/echarts-cli.test.ts` | 修复前预期失败 `2 failed \| 5 passed (7)` |
| 窄单测、CLI 构建与全局类型检查 | `.\scripts\pnpm.ps1 vitest run tests/unit/echarts-cli.test.ts tests/unit/baseline-compare.test.ts tests/unit/baseline-cli.test.ts; .\scripts\pnpm.ps1 --filter @company/component-cli build; .\scripts\pnpm.ps1 typecheck` | 单测 **3 文件 `24 passed (24)`**；CLI 构建通过；`typecheck` **14/14** 通过 |
| 真实 `0.0.10` 冻结 bundle `--version 6.1.0` 查询 | `.\scripts\pnpm.ps1 exec node packages/component-cli/dist/index.js echarts check --bundle .tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583 --version 6.1.0 --registry offline --json` | 退出码 `0`（显式记录离线模式 `registryProxyNote`） |

## 3. 独立 CLI 分发限制与未覆盖边界

- **独立分发限制**：`component echarts verify` 默认探针入口指向工作区相对路径 `tests/acceptance/t10-sdk/probe.mjs`（或由 `--probe-entry` / `ZHINEXUS_ECHARTS_PROBE_ENTRY` 指定），在 C 统一完成探针内置打包接线前，**不得宣称独立安装版 `@company/component-cli` 已验收通过**。
- **待合流验证**：待 A 侧补充 `scopeNotes` 并完成 Windows/字体/revision 修复后，使用真实 A 探针完整跑通 `component echarts verify` 通过路径。
- **工作树保留**：既有 4 处空白/尾行换行差异未混入提交。
