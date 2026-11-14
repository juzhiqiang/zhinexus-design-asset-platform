# B 侧第二阶段 `component echarts check/verify` 独立验证记录 (2026-11-14)

- **工作分支**：`feat/b-baseline-cli`
- **基线版本**：`@company/component-cli` 沿用本周期未发布的 `0.0.8`（`CHANGELOG.md` 统一由 C 收口）。
- **工具链**：`.\scripts\pnpm.ps1`（Node `26.13.0`、pnpm `12.18.0`）。
- **只读对接的 A 侧探针**：`C:\Users\10208\.codex\worktrees\a-sdk-probes\zhinexus-design-asset-platform\tests\acceptance\t10-sdk\probe.mjs`（交接文档 `a-t10-probes-next-2026-11-13.md`，未复制或合并 A 源码）。

## 1. 功能实现与失败关闭边界

1. **`component echarts check`（只读查询冻结 bundle 与支持矩阵，不安装/不运行消费者、不修改 peer）**
   - 实现文件：[echarts.ts](file:///d:/project/zhinexus-design-asset-platform/packages/component-cli/src/commands/echarts.ts)（`checkEchartsBundle`）与 [cli.ts](file:///d:/project/zhinexus-design-asset-platform/packages/component-cli/src/cli.ts)。
   - 逐项校验冻结 `manifest.json`（`schemaVersion=1`、`@company/charts-core` / `charts-vue` / `charts-react` 三包版本一致、统一 `peerDependencies.echarts`、`tarball.path` 不越界且 SHA-256 / 字节数逐一匹配）。
   - 拒绝非精确版本（`NOT_EXACT_VERSION`）、混合 peer 基线（`MIXED_PEER_BASELINE`）、摘要篡改（`BUNDLE_DIGEST_MISMATCH`）、以及未通过双框架实测的候选（`PEER_UNSATISFIED` / `VERIFY_REQUIRED`）。

2. **`component echarts verify`（调用探针子进程执行真实干净消费者验证，严格失败关闭）**
   - 实现文件：[echarts.ts](file:///d:/project/zhinexus-design-asset-platform/packages/component-cli/src/commands/echarts.ts)（`verifyEchartsCandidate`）与 [cli.ts](file:///d:/project/zhinexus-design-asset-platform/packages/component-cli/src/cli.ts)。
   - 支持 `--probe-entry <path>` 与环境变量 `ZHINEXUS_ECHARTS_PROBE_ENTRY`（默认回退仓库 `tests/acceptance/t10-sdk/probe.mjs`），透传 `--bundle`、`--echarts`、`--frameworks`、`--components`、`--presentations`、`--registry`、`--peer`、`--out`、`--label`、`--consumer-root`、`--baseline`、`--keep`、`--skip-browser` 并固定传 `--json`。
   - **严格失败关闭口径**：
     - 子进程退出码 `0` 仅代表探针运行完毕，绝不直接判通过；
     - 优先读取 `--out` 下 `probe-evidence[-<label>].json`（兼容带 `[probe]` 日志前缀的 stdout JSON），并使用 `validateProbeEvidence` 进行运行时 schema 校验（非法即报 `INVALID_PROBE_EVIDENCE`）；
     - 仅当 `recommendation === 'adopt'`、`uncovered` 为空、全部组合四维（`typecheck`/`runtime`/`interaction`/`visual`）均为 `passed`、且 `policy.peerSatisfied && policy.hasDualFrameworkCoverage && !policy.requiresVisualBaselineConfirmation` 时才返回退出码 `0`；`hold`（`PROBE_HOLD`）、缺证据/未跑维度（`INCOMPLETE_EVIDENCE`）、策略未满足（`POLICY_NOT_SATISFIED`）或子进程非零退出（`PROBE_FAILED`）均以退出码 `1` 失败关闭。

## 2. 实际执行命令与结果（先 RED 后 GREEN）

| 检查项 | 执行命令 | 实际结果 |
|---|---|---|
| `echarts-cli` 单测（RED 验证） | `.\scripts\pnpm.ps1 vitest run tests/unit/echarts-cli.test.ts` | 实现前预期失败 `4 failed (4)` |
| 窄单测（echarts + baseline） | `.\scripts\pnpm.ps1 vitest run tests/unit/echarts-cli.test.ts tests/unit/baseline-compare.test.ts tests/unit/baseline-cli.test.ts` | **3 文件 22 passed (22)** |
| CLI 构建与全局类型检查 | `.\scripts\pnpm.ps1 --filter @company/component-cli build; .\scripts\pnpm.ps1 typecheck` | CLI 构建通过；`typecheck` **14/14** 通过 |
| 真实 `0.0.10` 冻结 bundle `echarts check` | `.\scripts\pnpm.ps1 exec node packages/component-cli/dist/index.js echarts check --bundle .tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583 --echarts 6.1.0 --registry offline --json` | **退出码 0**，`bundleVersion=0.0.10`、`hasDualFrameworkCoverage=true`、`supported=2` |
| 对接 A 侧 `probe.mjs` 真实子进程冒烟（`--skip-browser`） | `.\scripts\pnpm.ps1 exec node packages/component-cli/dist/index.js echarts verify --bundle .tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583 --echarts 6.1.0 --frameworks "vue,react" --components line --presentations light-canvas --registry offline --skip-browser --label cli-smoke --probe-entry "C:\Users\10208\.codex\worktrees\a-sdk-probes\zhinexus-design-asset-platform\tests\acceptance\t10-sdk\probe.mjs" --json` | A 探针完成消费端构建/typecheck/SSR 导入并返回 `probeExitCode=0` + `recommendation="hold"`，CLI 严格失败关闭返回 **退出码 1 (`PROBE_HOLD`)** |

## 3. 给 C 侧的打包收口说明与未覆盖边界

- **打包接线说明**：`component echarts verify` 当前通过 `--probe-entry` / `ZHINEXUS_ECHARTS_PROBE_ENTRY` 或仓库默认路径 `tests/acceptance/t10-sdk/probe.mjs` 调用探针。后续 A 侧探针合并入主仓并由 C 打包发布 `@company/component-cli` 时，如需独立分发可由 C 统一决定将 `tests/acceptance/t10-sdk/` 一并打包或提供内置入口路径。
- **未覆盖边界**：本轮冒烟对接 A 侧 `probe.mjs` 时使用了 `--skip-browser`（验证子进程参数透传、Windows 干净消费者构建/typecheck/SSR 导入及 `PROBE_HOLD` 失败关闭）；Windows 原生完整浏览器 56 组合全矩阵实测、以及 A 侧后续补充的字体指纹与候选回退证据用例仍待 A/C 合流后执行。
- **工作树保留差异**：既有 4 处空白/尾行换行差异（`apps/gallery/app/(console)/upload/page.tsx`、`docs/verification/b-next-baseline-2026-11-13.md`、`docs/verification/b-next-baseline-review-2026-11-14.md`、`docs/verification/b-next-baseline-p2-2026-11-14.md`）均未混入提交。
