# T11 合成双框架试点演练记录（2026-11-21）

本记录追加本轮实际交付，不替代任何历史验证记录。日期按 Asia/Shanghai。

**本轮结论：T11「两个真实业务项目」标准项仍未完成，本记录不将其标记为完成。** 本轮交付的是该流程的合成演练与承载它的验收测试，`satisfiesRealBusinessPilot` 恒为 `false`。

## 授权与口径

用户本轮授权：新建开发分支，以合成 Vue / React 工程完成 T11 试点流程，验收后清理临时工程。经确认，口径为**记为预演、标准项保持开放**——即不修改 T11 验收标准，也不把合成工程冒称真实业务项目。

该口径与 T11 第 1 项原文一致：「用真实 Vue 和 React 项目（用户提供访问范围）安装精确发布版本；只读识别项目后创建可审查变更，完成类型/构建、点击/更新交互和页面核对，记录框架/引擎版本。**合成消费者不能替代这一步。**」实施计划开放项清单亦写明「临时技术工程不替代该项，也不替代 T11/T12 或生产 G2」。

## 分支与基线

分支 `feat/t11-pilot-rehearsal`，基线 `7eb5e521`（= `chore/g1-t10-acceptance-closeout`，即 `main` `d289cc88` 之上的 G1/T10 收尾提交）。选该基线而非 `main` 的原因：本机 worktree 从 `7eb5e521` 切到 `d289cc88` 需要删除收尾提交新增的文件，而沙箱 `unlink` 被禁，切换会失败；两者同 commit 使切回无需改动任何文件。这不是对基线的技术评价。

## 已交付文件

| 文件 | 作用 |
| --- | --- |
| `tests/integration/t11-support/pilot-harness.ts` | T11 试点可复用机械部分：只读识别、可审查变更清单、命令结果记录、receipt 组装与判定护栏。非 Vitest 用例 |
| `tests/integration/platform-acceptance.test.ts` | T11 Files 指定的集成验收测试（此前不存在） |
| `tests/browser/platform-acceptance.spec.ts` | T11 Files 指定的浏览器验收测试（此前不存在） |

harness 的行为约束：只读识别不写工程；字节证据全部由本进程 `fs` + `crypto` 实算，不读任何 fixture 占位摘要；临时目录只在系统临时根、带 `t11-pilot-` 前缀、每例独占，清理前 `lstat` 复核登记且只对 `nlink===1` 的普通文件 `chmod`，不跟随符号链接；`synthetic` / `productionAcceptance` / `satisfiesRealBusinessPilot` 三字段由调用方强制提供，`synthetic: true` 配 `satisfiesRealBusinessPilot: true` 或 `productionAcceptance: true` 直接抛错。

浏览器断言语义沿用已冻结的 T17 契约（CLI 0.0.23）：动作后断言共用同一等待预算、文本取首个匹配元素 `textContent().trim()`、数量精确相等、可见性须非零宽高、pageerror 与非 loopback 外发请求均失败。

## 未执行项（阻塞，不得记为通过）

沙箱内**无法运行**本仓库锁定的 Windows 工具链：可用 Node 为 v22.23.5（项目固定 26.13.0），无 `pnpm`，`node_modules` 不完整（缺 `@esbuild` 平台包与 `vitest`）。因此以下全部未执行，且未用退出码 0 冒充：

- `vitest run`（含新增 `tests/integration/platform-acceptance.test.ts`）
- `playwright test`（含新增 `tests/browser/platform-acceptance.spec.ts`）
- 合成工程的 `typecheck` / `build` / 依赖安装
- 根 `tsc --noEmit`、`verify:workspace`、全图 `build`/`typecheck`

已执行的唯一验证是全局 `tsc --noResolve --target es2022 --module esnext --moduleResolution bundler --strict` 对三个新文件的**语法**核对（无 `TS1xxx`）。`--noResolve` 不解析导入，故导入路径只经人工核对（`./t11-support/pilot-harness.js`、`../integration/t11-support/pilot-harness.js` 均对应真实文件，`.js` 后缀与仓库 NodeNext 约定一致），类型与运行时行为一律未经证明。

按 AGENTS.md：「不得基于假设、Turbo 缓存命中或部分输出报告成功」；「如果必需的外部检查无法运行，记录阻塞原因，并保持对应任务状态为未完成」。故 T11 保持未完成。

## T11 五项标准项当前状态

| 标准项 | 状态 |
| --- | --- |
| 1. 两个真实 Vue/React 业务项目安装精确发布版本并完成识别/变更/类型构建/交互/页面核对 | **未完成**。用户未提供真实业务项目访问范围；本轮只交付合成演练与其承载测试 |
| 2. 故障注入（PG/MinIO/Verdaccio 暂不可用、上传中断、worker 重启、发布响应丢失、索引失败、权限撤销） | 2026-11-12 已实测通过（7 项故障预演 + 12 项预览授权回归，合计 19 项），见 [pilot-report](../acceptance/pilot-report.md)，本轮未重跑 |
| 3. 结构化日志与脱敏 | 2026-11-12 已接入（`taskId/requestId/stage/attempt` 白名单 JSON，原始凭证/URL/业务内容不记录），本轮未改动 |
| 4. 容量验收输入（200 组件/400 实现/20 并发/p95≤500ms；100MiB 续传；元数据发布 p95≤30s） | 仅 C 本地预演已验证、非生产 SLA；`scripts/rehearse-capacity.ts` 存在，本轮未重跑 |
| 5. 运行验收测试与两个真实项目的原生命令，逐项保存实测结果 | **未完成**。验收测试本轮才补建且未执行；真实项目原生命令无从运行 |

T11 Files 中的 `apps/api/src/observability/{events,metrics}.ts`、`scripts/rehearse-recovery.ts`、`docs/acceptance/pilot-report.md` 本轮之前已存在，未修改。T11 Interfaces 提到的 `recordUsage(event:{type,variantReleaseId?,projectId?,timestamp})` 在全仓库不存在（已 grep 确认），本轮未实现——它依赖"页面访问/复制安装命令"的采集点，属于独立范围，且其 `projectId` 仅在用户授权提供时记录，需先与用户确认授权边界。

## 独立开放项（不改写）

两个真实业务试点、T11/T12 整体、公司 OIDC、生产独立预览域、完整生产 G2、未追溯的原始 RED/P0 过程，均保持独立开放。本轮「完成」仅指合成演练范围内的交付，不推断上述任何一项。

## 收尾

临时工程全部位于系统临时根并由 harness 登记，`releasePilotDirs()` 在 `afterAll` / `afterEach` 释放；未创建工程内的临时目录，未触碰 `.tools/`、锁文件、契约或版本号。本轮未执行 `git push`、`tag`、合并或生产发布。
