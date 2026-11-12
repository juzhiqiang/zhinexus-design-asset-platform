# T09 第三批合并验证记录：散点图合入 main

日期：2026-11-12。负责人：A（SDK）。分支：`feat/t09-scatter` → `main`。合并提交：`254cee9`（`merge: 合并 T09 第三批双框架散点图至 main`，父提交 `2ee1404` + `51401ec`）。分支内验证见 [T09 第三批验证记录](t09-scatter.md)，接口以 [T09 第三批对齐件](../superpowers/specs/2026-11-12-sdk-scatter-chart-protocol.md) 为准。

本记录覆盖三件事：合并前的状态核对、合并执行的安全措施、合并结果上的全图验证与 B/C 交付核对，以及按用户决定记录在案的 B 材料生成缺口。

## 合并前状态核对

- `main` 停在 `2ee1404`（docs: 记录实心饼图覆盖合入 main 的验证与空合并事故），与分支 rebase 基线一致，未被推进。
- **主工作树当前检出的是 B 的分支 `feat/t04-t06-release-registry` 且带未提交改动**（B/C 在飞的 CLI 材料生成工作）。因此不在主工作树 `git checkout main`，改为 `git worktree add <outputs>/t09-merge main`，在独立 worktree 上执行合并；B 的未提交改动零干扰。
- 冲突预检：`git diff --name-only 2ee1404 main` 为空（main 侧无新提交），与分支改动集零交集，预判无冲突。
- 历史事故核对：早前 `1161e03` 空合并（树与父提交相同的饼图实心合并）已被 B/C 经 `e4469ac` + docs `2ee1404` 重新落地，本批基线上的饼图实心文件（`examples/fixtures/pie.json`、双框架 `runtime.ts`、矩阵与语义用例等 10 个文件）确认在位，未受空合并影响。

## 合并执行

```
git worktree add <scratch> main          # main 未被主工作树检出，命令成功
git merge --no-ff feat/t09-scatter -m "merge: 合并 T09 第三批双框架散点图至 main"
```

- 合并提交 `254cee9`，两个父提交正确（`2ee1404` 旧 main 尖端 + `51401ec` 分支尖端），零冲突。
- **空合并核对**（`1161e03` 事故后的固定检查）：`git diff --name-only 2ee1404 254cee9` 非空，共 50 个文件；合并树与分支树一致（`b74572bc…`），散点交付（`charts/scatter.ts`、双框架 `ScatterChart`、`examples/fixtures/scatter.json`、双示例页与消费者页面、矩阵与语义用例）全部在合并树内。

## 合并结果上的全图验证

在 Linux 复现环境（Node `26.13.0`、pnpm `12.18.0`，清空 Turbo 本地缓存后从合并提交重新同步源码）实际执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 锁文件与 `package.json` 一致，无变化 |
| `pnpm exec tsx scripts/verify-workspace.ts` | Workspace verified: 10 members, no cycles, four publishable shells, safe service graph |
| `pnpm build` | 10 tasks successful（0 缓存，全量重建） |
| `pnpm typecheck` | 14 tasks successful（退出码 0） |
| `pnpm test` | 23 files / 491 tests passed，4 skipped |
| `pnpm test:browser` | 71 passed |
| `pnpm exec vitest run tests/integration/packed-consumer-frameworks.test.ts` | 9 passed |

与分支验证记录（t09-scatter.md）的数字完全一致，合并未改变任何验证结论。tarball 摘要与截图摘要不在本记录重复，仍以 [分支验证记录](t09-scatter.md) 为准（合并树与分支树一致，产物不变）。

### 环境问题（非代码回归）

首次 `pnpm build` 时 `@company/gallery` 失败：Turbopack 报 `Could not find the Next.js package (next/package.json)`，并警告 `Next.js ignored pnpm-workspace.yaml … because it would include your home directory`。原因是本次复现环境把 `HOME` 设在了仓库目录内（`v09/home`），Next.js 据此拒绝使用 `pnpm-workspace.yaml`、回退到 `apps/gallery` 作为 filesystem root，根 `node_modules` 中的 `next` 落在 root 之外无法解析。将 `HOME` 移到仓库外后 10/10 通过。本批改动未触及 `apps/`（`git diff --name-only 2ee1404 254cee9` 中 `apps/` 文件数为 0），确认为环境配置问题。

## B/C 交付核对（未被回退）

- `packages/component-cli/src/local/{capture,manifest}.ts`、`tests/unit/release-bundle.test.ts`、`tests/platform/*` 均在合并树内。
- 饼图实心批次的 10 个文件（`e4469ac`）在位；浏览器矩阵 71 项通过已覆盖其实心几何用例。
- B 在主工作树 `feat/t04-t06-release-registry` 上的未提交改动（CLI 增加饼图支持、真实静态预览生成、`.charts-pie` 选择器等）未受本次合并影响。

## 记录在案的缺口：B 的材料生成尚未覆盖 pie / scatter 导出

按用户决定（「按计划合并，缺口记录在案」），本批合并不等待 B 的 CLI 材料生成改造。缺口与 0.0.3 饼图导出同状态：

- main 上 `packages/component-cli/src/local/manifest.ts` 的 `ComponentName` 仍为 `'line' | 'bar'`，`prepareReleaseBundle` 只生成 line / bar 两种材料。
- SDK 自 0.0.3 起提供 `./pie`、本批（0.0.4）再增 `./scatter`；**平台 API 的逐导出覆盖检查会拒绝未覆盖全部导出的 Bundle**（T05 实测结论，不得放宽）。
- B 在飞工作（未提交）已把 pie 加入 `ComponentName` / 缺省值 / 静态预览生成，但尚未覆盖 scatter。
- B 需要完成的具体改动（`ComponentName` 扩展、入口文件名映射、`exportName` / docs 文案映射、`.charts-scatter` 选择器、侧测试同步、状态名补充）见 [对齐件第 5.2 节](../superpowers/specs/2026-11-12-sdk-scatter-chart-protocol.md)；候选包 0.0.4 摘要见同文件第 5.1 节。

## 未覆盖边界与后续

- Windows 开发机原生复验按 [柱状图 Windows 原生复验清单](t09-bar-windows-native.md) 同一套命令执行，散点专项窄范围命令见 [分支验证记录](t09-scatter.md)。
- 合并只在本地 `main` 完成，未 push（需用户显式授权）。
- `test:infra` 需要本地 PostgreSQL / Verdaccio / MinIO 容器，本环境不具备，未执行。
- T09 后续批次（trend-card / ranking / proportion）按同一模式扩展。
