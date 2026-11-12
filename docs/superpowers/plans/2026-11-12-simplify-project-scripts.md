# 工程脚本整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根 scripts 从 8 个文件减为 5 个，保留原有工程验证能力并减少重复入口。

**Architecture:** 保留 bootstrap、pnpm、verify、verify-workspace 和 resolve-versions；工具链专项验证合入 verify 的独立 `-Bootstrap` 模式。画廊缓存回归归属 tests，Schema 生成归属 contracts；测试直接执行，不进入 Turbo 缓存。

**Tech Stack:** Windows PowerShell 5.1、Node 26.13.0、pnpm 12.18.0、TypeScript 7.0.2、Vitest 5.1.0。

**Spec:** 本次对话中已确认的脚本精简建议及用户“你优化下”；职责与约束参照 AGENTS.md、总体实施计划 T01 和三人分工计划。C 单人负责工程收口，画廊仅迁移专项测试入口。

## Global Constraints

- 不改变协议、依赖版本、工作区成员或业务行为；不修改原始架构文档。
- 历史验证记录保持原样，新增独立验证记录说明新旧入口对应关系。
- 保留版本发现脚本，不删除仍在使用的官方候选发现能力。
- 当前目录干净，在 chore/simplify-project-scripts 分支串行实施；不推送、不合并。
- 内部工程整理不触发业务包升版。

## Review Focus

1. `-Bootstrap` 只跑工具链专项，不意外执行安装/构建/浏览器测试。
2. 默认验证失败立即停止，成功或失败均恢复站点变量和工作目录。
3. 工具链专项成功/失败均清理自己的临时目录，不影响其他文件；真实下载独立验证。
4. 画廊脚本迁移后仍从仓库根构建，检查 A→B→A→原配置，关闭自己启动的服务。
5. Schema 生成与类型检查路径迁移完整；普通契约测试同时检查内容和格式，提交 Schema 不变。

### Task 1: 整理入口并保留回归覆盖

**Files:** scripts/verify.ps1；删除 scripts/verify-bootstrap.ps1；迁移 scripts/verify-gallery-cache.mjs → tests/integration/gallery-cache.mjs；迁移 scripts/generate-contract-schemas.ts → packages/contracts/scripts/generate-schemas.ts；package.json、packages/contracts/package.json、tsconfig.json；tests/tooling/verify.test.ts、tests/contracts/api-schema.test.ts；README、contracts README、AGENTS、相关 rules、总体计划及新增验证记录。

**Interfaces:** `verify.ps1` 默认运行日常全套，`verify.ps1 -Bootstrap` 仅运行工具链专项；`pnpm test:gallery-cache` 运行真实画廊回归；`pnpm --filter @company/contracts schemas:generate` 先构建后生成 JSON；`pnpm test` 承担 Schema 精确一致性检查。

- [x] 新增真实 PowerShell 调用测试，外部下载/安装使用临时测试替身；验证默认任务顺序、失败退出和环境恢复、专项模式与隔离清理。运行窄范围测试，记录预期 RED。
- [x] 合入 Bootstrap 模式，移除末尾重复 build:services，保留 test/typecheck 各自的服务构建前置；运行测试达到 GREEN。
- [x] 迁移画廊测试及 Schema 生成，更新相对路径、命令和根类型检查覆盖；将 Schema 精确格式校验并入现有契约测试。
- [x] 更新当前文档/规则/计划中的入口，不改写历史验证；运行新生成命令，确认生成 JSON 无 diff。
- [x] 执行 `scripts/pnpm.ps1 exec vitest run tests/tooling/verify.test.ts tests/contracts/api-schema.test.ts`、`scripts/verify.ps1 -Bootstrap`、`scripts/verify.ps1`、`scripts/pnpm.ps1 test:gallery-cache`；完整构建/类型检查用 TURBO_FORCE=true 确认实际执行。
- [x] 检查原架构 SHA-256、git diff 和独立审查结果，新增真实验证记录，随本任务创建中文聚焦提交。

## Execution record

- 基线：tests/contracts/api-schema.test.ts 26/26 通过；原架构 SHA-256 为 E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723。
- 结果：RED 3 失败 / 1 通过，GREEN 30/30；完整验证 180 项 Vitest、15 项浏览器测试通过；工具链下载与画廊四轮专项通过。详见 [独立验证记录](../../verification/scripts-maintenance-2026-11-12.md)。
- 独立审查无问题；未修改协议、锁文件或原始架构。单任务串行实施，无公共接口冲突。
