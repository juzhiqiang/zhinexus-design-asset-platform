# 验证记录：A 侧 T10 冻结策略验收与多包独立版本适配（2026-11-16）

- 工作区：`C:\Users\10208\.codex\worktrees\t13-a-eval\zhinexus-design-asset-platform`
- 分支：`feat/t13-a-eval`（基于 `135a0b9c`）
- 冻结 SDK 输入：`.tools/operations/current-sdk/6d567b22-6c72-4e7a-a254-ade94b104df1`
  - `@company/charts-core@0.0.10`：`sha256=2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752`（53524 bytes）
  - `@company/charts-vue@0.0.11`：`sha256=5880c22a446074a8e68c2b898406ba76eaf658d8614965426a76c95328b2cf49`（6682 bytes）
  - `@company/charts-react@0.0.11`：`sha256=0443b89f386300f756138913d7ce34721e2d9ada9b035694354c9b0faffa26fb`（12220 bytes）
- 目录与校验保护：原目录诊断文件 `acceptance.json` 原样保留（`Test-Path ...acceptance.json` 为 `True`），未删除、未重打包、未放宽严格校验。
- 修改文件：`tests/acceptance/t10-sdk/bundle.mjs`、`tests/acceptance/t10-sdk/probe.test.mjs`、`docs/verification/a-t10-frozen-policy-2026-11-16.md`

## 发现的缺口与 RED → GREEN 修复

1. **RED 复现**：
   - 设置 `A10_FROZEN_BUNDLE` 为 `.tools/operations/current-sdk/6d567b22-6c72-4e7a-a254-ade94b104df1` 首次实跑 `.\scripts\pnpm.ps1 test:t10`，exit `1`（日志：`C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-631.log`）。
   - 7 项冻结策略用例全部报错：`Error: PROBE_INPUT 版本不一致：@company/charts-vue 为 0.0.11，其余为 0.0.10`。
   - 原因：`tests/acceptance/t10-sdk/bundle.mjs:69-74` 硬编码要求三个包版本号全等，无法读取合法独立升版的冻结产物（`core 0.0.10` + `vue/react 0.0.11`）。

2. **修复（GREEN）**：
   - 修改 `tests/acceptance/t10-sdk/bundle.mjs`：改为校验各包 `entry.version` 均为合法精确语义化版本，保留 `charts-vue` 与 `charts-react` 对 `@company/charts-core` 的 `dependencies` 精确等于 `coreVersion` 的强制校验，以及逐文件 SHA-256、字节数与无 `workspace:` 校验；三包同版本时 `bundle.version` 仍返回单一版本号，独立版本时返回各包版本汇总。
   - 在 `tests/acceptance/t10-sdk/probe.test.mjs` 新增用例「允许框架包独立语义化版本（core 0.0.10 + vue/react 0.0.11），但仍拒绝 core 依赖版本不匹配」。

## 实际验证命令与 7 项冻结策略用例明细

- 命令：`A10_FROZEN_BUNDLE=<repo>/.tools/operations/current-sdk/6d567b22-6c72-4e7a-a254-ade94b104df1 .\scripts\pnpm.ps1 test:t10`
- 结果：exit `0`，**167 passed / 0 failed / 0 skipped**（25 suites，21680ms；日志：`C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-660.log`）。
- 工作区校验：`.\scripts\pnpm.ps1 verify:workspace` -> exit `0`。

此前因缺 `A10_FROZEN_BUNDLE` 而跳过的 **7 个冻结策略用例** 本轮全部实跑通过：
1. `✔ 候选低于基线（回退方向）不满足 peer：recommend 必为 hold` (72.2189ms)
2. `✔ 四维全过但 peer 不满足，仍不得判 adopt` (63.9784ms)
3. `✔ 候选等于唯一基线且双框架各有一条实测时才 adopt（回退到 6.1.0 的判据）` (65.4613ms)
4. `✔ 只验了一个框架时不构成双框架覆盖，哪怕候选就是基线` (66.7345ms)
5. `✔ 有一维 not-run 就不得 adopt：视觉无基线同样拦住采用` (65.2324ms)
6. `✔ 有差异就不得 adopt，哪怕四维全过` (98.0597ms)
7. `✔ 候选版本与 supported 唯一基线不一致就 hold（不得靠版本号相近放行）` (296.4762ms)

## 未覆盖边界

- 本轮仅完成冻结策略与 T10 探针单元测试验收（不占用 5173–5175 端口，未跑完整浏览器矩阵）。
- ECharts 6.1.0 双框架 56 组合真实探针执行、6.0.0 strict 拒绝、显式 legacy 测量与双消费者锁文件回退仍由 B/C 在宿主按序验收，当前保持开放。
- 严格发布目录校验与 `acceptance.json` 额外诊断分离问题仍按计划由 C 处理。
