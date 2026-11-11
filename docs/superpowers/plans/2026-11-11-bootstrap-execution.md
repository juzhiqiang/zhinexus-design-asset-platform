# 工程初始化执行范围

> **For agentic workers:** 使用 executing-plans 执行本次初始化；只执行下列范围，不将整个 T01–T17 当作本次授权范围。

**Goal:** 建立 3 名开发能够开始协作的可安装、可构建、可验证工作区，并交付依赖与分配计划。
**Architecture:** 沿用已确认的 Monorepo + pnpm workspace + Turborepo；本地组件链路与服务端职责分离。
**Tech Stack:** TypeScript、Vue、React、ECharts、Vite、Fastify；精确版本从官方源重新解析。
**Spec:** 根 component-platform-architecture.md，以及 2026-11-11-component-platform-implementation.md 的 T01。

## 范围与完成条件

- [x] 初始化 Git、10 个工作区成员、精确依赖与锁文件、本地工具链和 Turbo 任务图。
- [x] 建立协议类型草案、API/预览网关健康检查、CLI 帮助与未实现命令拒绝、双框架可构建示例入口。
- [x] 运行工作区、构建、类型、基础行为测试；核对缓存命中/失效与服务端任务白名单。
- [x] 写 3 人分配文档，区分开工依赖、联调依赖、验收依赖，给出容量和年底风险。

T01 的完整运行时 manifest 校验、三存储读写/重启恢复、OIDC/域名接入与发布验收不因工程骨架存在而完成。后续分配文档必须逐项列出。示例仅验证工程入口，不称为已完成图表组件。

## 执行决定

- 原目录无 Git 仓库，直接在用户指定目录初始化；不创建无法承载未建仓工程的额外 worktree。
- 系统 Node 为 24.6.0、pnpm 为 10.25.0；项目使用官方重新发现的 Node 26.13.0、pnpm 12.18.0，本地隔离到 .tools，不修改全局安装。
- 初始化不增加生产部署配置或伪造存储通过结果；服务端只有健康检查，不开放上传/发布接口。
- 工作区图中的 bootstrap 导出可由 T02/T03 替换；协议类型是 G1 冻结讨论输入，尚无生产校验保证。
