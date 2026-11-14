# T10 `component echarts check/verify` P2 复核修正记录（2026-11-14）

- **角色与分支**：B（`feat/b-baseline-cli`，基线 `0ee149a` / `e752fa1`）
- **目标**：根据 C 对 `0ee149a` 独立复核提出的 4 项 P2 阻断，严格按 RED → GREEN 流程完成修正，不扩大任务范围，不修改根锁文件 / `packages/contracts` / A 与 C 专属文件，保留现有 4 处工作树既有空白差异。

---

## 一、4 项 P2 修正摘要

1. **P2 #1：`combinations` 实测版本与候选、冻结 `supported` 矩阵对齐**
   - 在 `validateProbeEvidence` 强制要求每条 `combinations[]` 具备非空 `frameworkVersion` 与精确 `x.y.z` 格式的 `echartsVersion`。
   - 在 `verifyEchartsCandidate` 逐条校验 `combo.echartsVersion === resolvedCandidate.version`（不匹配返回 `CANDIDATE_MISMATCH`）以及 `bundleCheck.supported` 中存在同 `framework` 与 `frameworkVersion` 的记录（不匹配返回 `FRAMEWORK_VERSION_MISMATCH`）。

2. **P2 #2：保留官方/指定 registry 解析并强绑定 `integrity` / `source` 与离线门禁**
   - `verifyEchartsCandidate` 禁止 `--registry offline` 判定 `adopt`（立即失败关闭，返回 `OFFLINE_VERIFY_CANNOT_ADOPT`；`offline` 仅限 `check` 查询）。
   - `verifyEchartsCandidate` 始终执行 `resolveCandidateFromRegistry` 解析目标版本、官方/指定 `integrity` 与 `source`，并把解析后的精确版本透传给探针 `--echarts`。
   - 严格校验 `evidence.candidate.version === resolvedCandidate.version`、`evidence.candidate.integrity === resolvedCandidate.integrity`（`CANDIDATE_INTEGRITY_MISMATCH`）、`evidence.candidate.source === resolvedCandidate.source && !== 'offline'`（`CANDIDATE_SOURCE_MISMATCH`）以及 `evidence.candidate.integrityVerified === true && evidence.policy.candidateIntegrityVerified === true`（`CANDIDATE_INTEGRITY_UNVERIFIED`）。

3. **P2 #3：`combinations[].failures` 嵌套运行时校验**
   - 在 `validateProbeEvidence` 校验 `Array.isArray(c.failures)`，且其中每个元素均为非 `null` 普通对象，可选字段 `dimension` / `reason` / `detail` 若存在必须为字符串，杜绝 `failures: {}` 或 `[null]` 穿过校验导致后续 `TypeError`，统一结构化返回 `INVALID_PROBE_EVIDENCE`。

4. **P2 #4：Windows `packages` 目录 junction / symlink 越界防护**
   - 在 `readAndVerifyFrozenBundle` 中对 `resolvedDir`、`manifest.json` 与所有 `tarball` 路径执行 `fs.realpath`，结合 `isInsideDir` 校验其真实路径必须位于真实冻结根目录内，否则失败关闭返回 `INVALID_BUNDLE_PATH`。
   - 在 `tests/unit/echarts-cli.test.ts` 新增 Windows junction 越界回归测试，并在 `finally` 中清理临时目录与 junction。

---

## 二、TDD RED → GREEN 与验证记录

### RED 阶段
- 在 `tests/unit/echarts-cli.test.ts` 新增 `P2 复核回归：拒绝组合版本错配/缺字段、integrity/source 篡改、离线 verify adopt、畸形 failures 与 Windows junction 越界` 用例，并同步更新现有 `verify` 用例为合法 mock registry 与 `integrityVerified` 证据。
- 执行 `.\scripts\pnpm.ps1 vitest run tests/unit/echarts-cli.test.ts`：
  - 结果：**1 failed | 7 passed (8)**，新增 P2 回归用例按预期失败（`expected 0 to be 1` 等）。

### GREEN 阶段与全套本地校验
1. **CLI 单元测试**：
   - 命令：`.\scripts\pnpm.ps1 vitest run tests/unit/echarts-cli.test.ts tests/unit/baseline-compare.test.ts tests/unit/baseline-cli.test.ts`
   - 结果：**3 files passed, 25 passed (25)**（其中 `tests/unit/echarts-cli.test.ts` **8/8 passed**）。
2. **CLI 包构建**：
   - 命令：`.\scripts\pnpm.ps1 --filter @company/component-cli build`
   - 结果：**passed**（`sync-contracts.mjs` + `tsc -p tsconfig.build.json` 退出码 0）。
3. **全仓 TypeScript 类型检查**：
   - 命令：`.\scripts\pnpm.ps1 typecheck`
   - 结果：**14 successful, 14 total**（退出码 0，含 `@company/component-cli:typecheck` cache miss 实跑）。

---

## 三、未覆盖边界与说明

- 本轮仅使用 mock probe / mock registry 覆盖 CLI 侧 4 项 P2 协议与路径安全边界；**真实 A 探针（Windows、字体指纹、revision 与 integrity 证据）及真实 `hold`/`adopt` 全路径、独立全局安装分发与根全套测试**由 A 修复探针稳定版后交由 C 统一实跑验收。
- CLI 版本继续沿用未发布的 `0.0.8`，`CHANGELOG.md`、根 `package.json`、`pnpm-lock.yaml` 与 `packages/contracts` 未做修改。
