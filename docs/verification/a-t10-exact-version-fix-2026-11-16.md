# 修订验证记录：对齐冻结包精确版本校验至 `contracts` `exactVersion`（2026-11-16）

- 工作区：`C:\Users\10208\.codex\worktrees\t13-a-eval\zhinexus-design-asset-platform`
- 分支：`feat/t13-a-eval`（基于 `8f4ab033`，未改写历史验证记录）
- 修改文件：`tests/acceptance/t10-sdk/bundle.mjs`、`tests/acceptance/t10-sdk/probe.test.mjs`、`docs/verification/a-t10-exact-version-fix-2026-11-16.md`
- 约束确认：未修改 `packages/contracts`、B 文件或旧 tarball。

## 修复内容

- 对齐 `tests/acceptance/t10-sdk/bundle.mjs:53-77` 的 `EXACT_VERSION_PATTERN` 至 `packages/contracts/src/schema.ts:15-16` 的 `exactVersion` 规则：
  - 拒绝主/次/修订号前导零（如 `01.0.11`）
  - 拒绝预发布纯数字标识前导零（如 `0.0.11-01`）
  - 拒绝空预发布标识（如 `0.0.11-rc..1`）
  - 限制长度 `1..2048`
  - 保留合法独立版本（`core 0.0.10` + `vue/react 0.0.11`）、逐包身份、SHA-256 / 字节数、无 `workspace:` 及 `charts-vue` / `charts-react` 对 `coreVersion` 精确依赖校验。

## TDD 与实际验证结果

1. **RED 阶段**
   - 在 `tests/acceptance/t10-sdk/probe.test.mjs:486-493` 新增 3 个非法框架版本（`01.0.11`、`0.0.11-01`、`0.0.11-rc..1`，`core` 保持合法 `0.0.10` 且依赖匹配）回归测试。
   - 命令：`.\.tools\node-v26.13.0-win-x64\node.exe --test --test-name-pattern="冻结 bundle 只读读取" tests/acceptance/t10-sdk/probe.test.mjs`
   - 结果：exit `1`（6 pass / 1 fail），确认旧正则放过 `01.0.11`。

2. **GREEN 阶段（严格冻结副本复验）**
   - 命令：`A10_FROZEN_BUNDLE=D:\project\zhinexus-design-asset-platform\.tools\operations\next-sdk-handoff-zQIRda .\scripts\pnpm.ps1 test:t10`
   - 结果：exit `0`，**168 passed / 0 failed / 0 skipped**（25 suites，21024.7889ms；日志：`C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-703.log`）。
   - 工作区校验：`.\scripts\pnpm.ps1 verify:workspace` -> exit `0`。

## 外部阻塞说明（仅供交接参考）

- C 实测已安装冻结 CLI `0.0.10` 返回 `exit 1 INVALID_BUNDLE_MANIFEST`（三包版本必须一致），未进入 `probe`；B 分发阻塞单列，本修复仅在 A 侧探针源与测试中完成，不修改 B 文件或旧 tarball。
