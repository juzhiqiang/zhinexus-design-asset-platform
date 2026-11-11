# NestJS 与 React 工程基线调整

> **For agentic workers:** 使用 executing-plans 在当前工程完成本次技术栈修正；本轮用户已明确要求执行，不重复请求方案确认。通过测试后做一次独立审查。

**Goal:** API 与预览网关使用 NestJS，平台画廊使用最新稳定 React，保留 Monorepo 与组件双框架边界。
**Architecture:** 两个独立 Nest 模块，使用默认 Express 适配器；每个应用包含健康检查 controller/service 和独立启动入口。画廊用 React + Vite，保持现有页面内容。组件 Vue/React 适配及双框架 examples 继续存在。
**Tech Stack:** 2026-11-11 官方 npm latest：NestJS 12.4.2、Nest CLI 12.0.12、React/React DOM 19.3.1。Nest CLI 官方依赖 TypeScript ~6.0.2，两个服务统一固定 TypeScript 6.0.3；根、React 画廊和组件继续使用 TS7，Vue example 保留既有 TS6 例外。
**Spec:** 用户本轮明确更正“后端要用nestjs，前端用最新的react”，优先于旧计划的 Fastify/Vue 画廊建议；原始 component-platform-architecture.md 中的职责边界继续适用。

## Global Constraints

- 本轮只调整初始化工程，G1/G2 与 T02–T17 仍按既有计划推进。
- 服务仍只暴露 `/healthz`，`/v1/releases` 保持 404；组件构建和截图不进入服务任务图。
- React/React DOM 取官方 latest 的稳定版本并精确锁定，不使用 canary/RC。
- 不修改用户原始架构文档；同步执行计划、分工和当前 README。
- 延续用户指定目录进行已交付骨架修正，在当前干净 checkout 创建独立分支；不迁移现有工作目录。

## Review Focus

- Nest 依赖注入需要真实 decorator metadata：服务测试必须运行已编译代码，并通过 controller→service 返回健康响应。
- 全新安装后直接 `pnpm test`：入口须先构建服务，不依赖遗留 dist。
- `dev` 与 `start` 必须使用同一 Nest 模块，确保监听端口和停止进程可用；实际 HTTP 冒烟覆盖两个入口。
- React 画廊迁移不得误删 Vue SDK/example：工作区检查与三个页面浏览器测试覆盖。
- 平台服务构建不应带入组件和浏览器：重新检查 Turbo 服务子图与重复缓存。

### Task 1: NestJS 服务与真实 HTTP 测试

**Files:** `apps/{api,preview-gateway}/{package.json,tsconfig.json,nest-cli.json,src/app.ts,src/app.module.ts,src/health.controller.ts,src/health.service.ts,src/server.ts}`，根 `package.json`、`pnpm-lock.yaml`、`tests/unit/bootstrap.test.ts`。

**Interfaces:** 保留导出名 `buildServer()`，改为 `Promise<INestApplication>`；`GET /healthz` 返回原 `{status:'ok',service:'api'|'preview-gateway',stage:'bootstrap'}`；Nest 生命周期管理关闭。

- [ ] 将服务测试改为加载真实 dist，await 工厂、监听 loopback 临时端口并通过 fetch 断言 health 200、未实现发布 404；在旧 Fastify 实现上观察失败。
- [ ] 实现两个 Nest module/controller/service，启用 decorator metadata，使用 Nest CLI 构建/开发、Node 运行 dist；精确依赖写入锁文件。
- [ ] `pnpm test` 先执行服务白名单构建再直接运行 Vitest。Expected：5/5 测试通过；服务构建不包含 charts/examples/gallery。
- [ ] 实测两个 `start` 和 `dev` HTTP 入口，停止后端口释放。Expected：各 health 200，停止后无本轮遗留服务。

### Task 2: React 平台入口与文档验证

**Files:** `apps/gallery/{package.json,index.html,vite.config.ts,tsconfig.json,src/App.tsx,src/main.tsx,src/styles.css}`，README、实现/分工计划、版本发现和验证记录。

**Interfaces:** 画廊仍在 5173，Vue/React example 仍在 5174/5175；协议版本来自 contracts，现有画廊标题与骨架提示保持。

- [ ] 用 React createRoot/StrictMode 与 React Vite 插件替换画廊 Vue 入口，移除画廊的 Vue/TS6/vue-tsc 依赖，保留 Vue example。
- [ ] 刷新官方版本发现，更新当前选型和三人职责；旧验证记录明确为迁移前历史。
- [ ] 运行冻结安装、peer 检查、workspace、build、typecheck、test、browser、services。Expected：10 个成员；所有检查通过，3 个浏览器测试通过。
- [ ] 复核 Turbo 服务图、重复构建缓存，记录兼容取舍、已验证范围和后续门槛，独立审查后修复必要问题。
