# 补充验证记录：严格冻结副本 `next-sdk-handoff-zQIRda` 复验与 CLI 0.0.10 阻塞排查（2026-11-16）

- 工作区：`C:\Users\10208\.codex\worktrees\t13-a-eval\zhinexus-design-asset-platform`
- 分支：`feat/t13-a-eval`（基于 `ce34c390`，保留历史记录 `docs/verification/a-t10-frozen-policy-2026-11-16.md` 不改）
- 严格冻结副本：`D:\project\zhinexus-design-asset-platform\.tools\operations\next-sdk-handoff-zQIRda`
- 证据文件：`D:\project\zhinexus-design-asset-platform\.tools\operations\next-sdk-handoff-zQIRda.evidence.json`
  - `manifestSha256`: `917f195aaa1deb12c30ad55a482241cbfd1182173777f4757edfbeff523c997d`（`declaredFiles: 199`）
  - `@company/charts-core@0.0.10` (`2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752`)
  - `@company/charts-vue@0.0.11` (`5880c22a446074a8e68c2b898406ba76eaf658d8614965426a76c95328b2cf49`)
  - `@company/charts-react@0.0.11` (`0443b89f386300f756138913d7ce34721e2d9ada9b035694354c9b0faffa26fb`)

## 1. 严格冻结副本 `test:t10` 实跑结果

- 命令：`A10_FROZEN_BUNDLE=D:\project\zhinexus-design-asset-platform\.tools\operations\next-sdk-handoff-zQIRda .\scripts\pnpm.ps1 test:t10`
- 结果：exit `0`，**167 passed / 0 failed / 0 skipped**（25 suites，23465ms；日志：`C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-673.log`）。
- 原先跳过的 7 项冻结策略用例在严格冻结副本上同样全部通过。

## 2. 冻结 CLI `0.0.10` 阻塞确认（只读检查）

- 被检 tarball：`D:\project\zhinexus-design-asset-platform\.tools\b-cli0010-distribution-KJhUCm\company-component-cli-0.0.10.tgz`
  - 实测 SHA-256：`0261b846c6c738e509a99afeb2c8089902538856d42a6609f85484cb629063e9`（218759 bytes）
- 阻塞证据：只读提取 tarball 内置 `package/dist/probe/bundle.mjs` 第 69–74 行，仍为旧版等版本校验逻辑：
  ```js
  const version = manifest.packages[0].version;
  for (const entry of manifest.packages) {
    if (entry.version !== version) {
      throw new Error(`PROBE_INPUT 版本不一致：${entry.name} 为 ${entry.version}，其余为 ${version}`);
    }
  }
  ```
- 结论：**已冻结的 CLI `0.0.10` 内置旧 `bundle.mjs` 必然拒绝 `charts-core@0.0.10` + `charts-vue@0.0.11` + `charts-react@0.0.11` 的严格冻结副本**。在不修改 B 文件且不重打包的前提下，特此回报 C/B 阻塞：需待合入 A 的探针修复并由 C 收口升级 CLI 版本重新打包后，方可由已安装 CLI 对该冻结 SDK 执行 56 组合探针验收。

## 3. 需要更新的分发文件清单（供后续 CLI 新版本打包）

以下文件均在 `packages/component-cli/scripts/package-probe.mjs` 白名单中，需在后续 CLI 构建打包时同步进入 `dist/probe/`（A 本轮未改 B 文件，也未重打包）：

1. `tests/acceptance/t10-sdk/bundle.mjs`（支持三包独立精确语义化版本并核对 `coreVersion` 依赖）
2. `tests/acceptance/t10-sdk/probe.test.mjs`（新增独立版本与依赖错配回归用例）
3. `examples/vue/src/App.vue`（上一轮 `98cee34c` 补充 `__LINE_LIFECYCLE_CONTROLS__`）
4. `examples/react/src/App.tsx`（上一轮 `98cee34c` 补充 `__LINE_LIFECYCLE_CONTROLS__`）
5. `packages/component-cli/dist/probe/probe-manifest.json`（随新版本 CLI 构建时由 `package-probe.mjs` 重新生成）
