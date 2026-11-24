# 真实项目 CLI 发布与分类 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户已授权子代理分工；实施任务顺序派发，逐任务独立审查。

**Goal:** 让真实项目开发者通过 CLI 发布已有组件，并在发布前选择后台管理的框架与分类。

**Architecture:** 保留现有冻结 Bundle / 发布作业，新增独立项目配置与本地编排；分类由 Nest API 管理并通过公共契约提供给 CLI 和内网管理端。服务端继续只校验、存储预构建材料。

**Tech Stack:** 现有 Node >=24.6.0、pnpm 12.18.0、TypeScript、NestJS、Next.js、Playwright、PostgreSQL；不引入新运行时依赖。

**Spec:** `docs/specs/2026-11-24-project-cli-publishing.md`

## Global Constraints

- 原始架构文档字节不变；保留当前工作区首页设计改动。
- 所有构建、消费者安装及自动截图仅在开发者电脑运行，不进入 Turbo 验证缓存。
- 冻结 tarball 摘要贯穿安装、截图、报告、上传与发布；已发布版本不可覆盖。
- B 范围：CLI/管理端与消费者测试；C 范围：contracts/API/迁移及根配置；本轮依赖契约先收口再实施。
- 不新增业务组件、不新增 workspace 成员、不改变原有 ACL、不推送或合并。

## Review Focus

1. 用户业务工程为私有应用：拒绝发布，提示选择组件子包，不修改业务 package.json。
2. 声称 React 实际 Vue、源码 alias 或 workspace 链接：必须拒绝，不能伪造消费者通过。
3. 分类停用发生在检查与提交之间：API 再校验并拒绝新发布，历史版本仍可读取。
4. 上传中断再运行 release：复用同一冻结材料与幂等会话，不重新 pack。
5. 一包多组件/多框架：逐导出与逐实现材料完整检查，不能借用别的实现截图。

## Task 1：分类契约与持久化 API（C）

**Files:** `packages/contracts/src/categories.ts`、`release-manifest.ts`、`schemas.ts`、`index.ts`；`apps/api/src/categories/*`、`app.ts`、`platform.ts`、`releases/service.ts` 与新增迁移；`tests/contracts/categories.test.ts`、`tests/platform/categories.test.ts`。

**Interfaces:** `ComponentCategory {id,name,enabled,revision}`；列表返回 `{items}`；创建 `{id,name}`，更新 `{name,enabled,expectedRevision}`。GET `/v1/categories` 供已授权发布者读取启用项；管理员可读取全部，POST 创建及 `/:id/update` 更新。`VariantRef.category?:string` 为分类快照，同组件不同实现不得选冲突分类。GET `/v1/publishing/options` 返回当前主体可发布组件、包与启用分类，用于 CLI 前置检查。

普通组件兼容补充：`EnvironmentV1.echartsVersion`、`ComponentApiV1.styleExport/readyMethod` 改为可选，字段存在时沿用原校验；不使用 ECharts 的组件省略该版本，不生成图表兼容记录。分类 ID 使用既有 component ID 格式，名称非空且最多 128 字符，revision 是从 `"0"` 起的十进制 bigint 字符串。启用分类列表与当前主体可发布组件独立返回，现有分类停用不隐藏已授权组件。

- [ ] 先新增契约、真实 HTTP 测试：普通主体不能管理分类；重复标识/过期 revision/停用分类拒绝；分类与 ACL 正交；旧清单兼容。
- [ ] 运行失败测试，记录预期缺失行为。
- [ ] 最小实现与事务/审计；分类校验置于新作业登记事务，原幂等成功作业重试不受分类后续停用影响。
- [ ] 生成 schemas，构建服务，运行契约与平台专项；通过后聚焦提交。

## Task 2：真实项目配置与 CLI 编排（B）

**Files:** `packages/component-cli/src/project/*`、`commands/project.ts`、`cli.ts`、`bin.ts` 与 CLI 内联契约同步；`tests/unit/project-cli.test.ts`、`tests/integration/project-publish.test.ts`。

**Interfaces:** 配置包含 `schemaVersion:1`、包目录与 build/dev 程序参数、每个实现的 componentId/framework/category/export/API/docs/消费者模板/预览入口及就绪状态。读取配置不执行代码；路径校验以真实项目根为边界。`init/dev/doctor/prepare-release/release` 共用配置读取与框架/分类选择。

- [ ] 写 RED 测试：外部项目初始化不覆盖已有文件；明确参数或交互选择；无效分类/身份/权限在构建前阻断；保留旧 CLI 命令行为。
- [ ] 实现配置、命令与前置检查；CLI 不生成开发者组件。
- [ ] 写 RED→GREEN 独立消费者验证：冻结并安装实际包、静态预览、逐实现截图与合法报告，拒绝源码链接/错框架/篡改。
- [ ] release 接入准备流程、进度输出与原会话恢复；非交互调用参数缺失给出明确提示。
- [ ] 单包类型/构建、窄范围测试及独立安装 CLI 真实验证；聚焦提交。

## Task 3：后台分类与发布选择（B）

**Files:** `apps/admin/app/categories/page.tsx`、`lib/categories-client.ts`、`layout.tsx`、`upload/page.tsx`、`lib/uploads/manifest-form.ts`；`tests/gallery/categories-client.test.ts`、`tests/browser/categories.spec.ts`。

- [ ] 先测试前端 API 响应校验、分类选择入清单、停用/未知分类阻断。
- [ ] 沿用现有控制台样式与认证，增加分类创建/编辑/启停页面及导航；上传时按实现选择实际框架与分类，禁止仅改标签冒充另一框架。
- [ ] 类型/构建及真实浏览器验证，聚焦提交。

## Task 4：全链路验证、文档与升版（C）

**Files:** `README.md`、`component-platform-implementation-assessment.md`、总体/分工计划追加记录、`docs/guides/project-publishing.md`、新增验证记录、对应 package.json 与 CHANGELOG。

- [ ] 验证独立项目 CLI 与平台仓库路径、两框架分别发布、分类选择持久化、恢复与旧冻结材料兼容。
- [ ] 运行 `pnpm verify:workspace`、`pnpm typecheck`、`pnpm build`、`pnpm test`、相关平台/浏览器专项。缺少外部条件时保持对应验收未完成。
- [ ] 独立审查范围 diff，修复实质问题并复验；记录命令、结果、摘要及未覆盖项。
- [ ] 同步使用文档与任务记录；按 0.x 兼容变更 PATCH 规则升级 CLI 和平台/管理端相关版本、同步锁文件，独立升版提交。
