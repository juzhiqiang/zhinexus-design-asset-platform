# NestJS / React 工程调整验证

日期：2026-11-11，Windows x64。按用户明确要求，将平台 API 与预览网关改为 NestJS，平台前端改为最新稳定 React；保持 Monorepo + pnpm workspace + Turborepo。此记录覆盖初始化修正，完整 T01 和业务任务继续开放。

## 当前实现

| 部位 | 已落地结构 |
| --- | --- |
| apps/api | NestJS module/controller/service，GET /healthz，3000 |
| apps/preview-gateway | 独立 NestJS module/controller/service，GET /healthz，3001 |
| apps/gallery | React + Vite，createRoot/StrictMode、TSX、独立 CSS，5173 |
| SDK 与 examples | Vue/React 双框架保留，示例 5174/5175 |
| 测试入口 | test 先 build:services，再运行 Vitest；HTTP 测试加载已编译 Nest 应用 |

两个后端使用 Nest 默认 Express 适配器，尚未实现静态文件代理、上传、鉴权、发布与作业。POST /v1/releases 仍返回 404。健康响应保持 status=ok、stage=bootstrap，不作为生产 readiness。

## 官方版本与编译器

从官方 npm Registry 的 latest 查询并精确锁定：React/React DOM **19.3.1**、React 类型 **19.3.0**，NestJS common/core/platform-express **12.4.2**、Nest CLI **12.0.12**、reflect-metadata **0.2.2**、RxJS **7.8.2**。查询时间、来源与完整包列表见 [版本发现](../versions.discovery.json)，实际依赖以 package.json 与 pnpm-lock.yaml 为准。

Nest CLI 的官方 TypeScript 依赖为 ~6.0.2，因此两个后端显式固定 **TypeScript 6.0.3**，build/dev 均使用 Nest CLI，typecheck 使用相同本地编译器，启用 experimentalDecorators 与 emitDecoratorMetadata。此选择避免测试或开发转译器不产生依赖注入 metadata 的问题；证据见 [Nest 编译器元数据](nest-typescript-compatibility.json)。根、React 画廊与 SDK 保持 TypeScript 7.0.2；仅 Vue example 继续使用已有 vue-tsc/TS6 兼容例外。代价是维护两类编译器并在升级时重新验证。

## 实际验证结果

| 检查 | 结果与证据 |
| --- | --- |
| 官方版本发现 | 24 个候选包，React/Nest 版本与安装清单一致 |
| 冻结安装 / peers | 锁文件未更新；No peer dependency issues found |
| workspace | 10 个成员、无环、4 个公开包壳，服务边界通过 |
| 全量 build / typecheck | 10/10 构建；14/14 Turbo 类型检查及依赖构建任务，根脚本/测试类型检查通过 |
| 单元与服务 HTTP | 5/5：CLI 3 项、两个已编译 Nest 服务各 1 项；实际 DI、health 200 和发布 404 |
| 浏览器 | 3/3：React 画廊、Vue 示例、React 示例 |
| 缺少 dist 的测试启动 | 将 API/网关/contracts 的 dist 移至隔离备份，并强制绕过 Turbo 缓存；根 test 自动完成 5 个服务任务，再通过 5/5 测试 |
| 后端 start/dev | API 与网关各 2 个真实命令，4 次 health 200；各次仅结束本次测试进程树，端口均释放 |
| 服务任务图 | 只有 contracts build、两个后端 build/typecheck，共 5 项；没有组件、画廊、示例或浏览器 |
| 重复 build | 10/10 命中本地缓存；测试本身未进入 Turbo 缓存 |
| 原架构文档 | SHA-256 仍为 e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723 |

证据：[完整验证日志](nest-react-checks.log)、[无 dist 测试日志](nest-clean-test.log)、[服务入口冒烟](nest-service-smoke.json)、[服务任务图](nest-services-graph.json)、[重复构建](nest-react-build-repeat.log)。

服务 HTTP 测试先在原 Fastify 工厂上失败：它不支持 Nest 的 listen/getUrl 调用，出现 2 failed / 3 passed；[RED 日志](nest-services-red.log) 保留此次基线。迁移后同一测试通过，健康路由经 controller 注入 service 返回真实响应。画廊保持既有可见内容，复用现有浏览器行为验收。

Windows 服务入口冒烟使用 taskkill /T /F 清理本次拥有的进程树，验证的是端口释放，**不声称验证了优雅信号关闭**。应用已启用 Nest shutdown hooks；目标部署系统的信号处理与在途请求排空仍需在部署验收中实测。浏览器测试出现 NO_COLOR/FORCE_COLOR 环境警告；既有 React 示例约 504 kB 的体积警告仍留在 T02/T03 按需打包验收，本轮未掩盖。

## 协作与后续

三人分工继续按 A：SDK、B：CLI/React 画廊、C：NestJS 平台推进。B 的页面和 C 的模块开发可在契约 fixtures 冻结后并行，真实上传、目录、预览验收仍依赖 T05/T06/T07；SDK 与画廊不存在必须串行的实现依赖。完整负载、必要依赖与年底风险见 [三人分工计划](../superpowers/plans/2026-11-11-three-person-allocation.md)。

工程基线 G0 已完成。G1 schema/运行时校验、G2 三存储/OIDC/独立预览域，以及 T02–T17 仍按原验收门槛推进，不能将本次健康检查与空页面称为业务平台完成。

## 实施决定

| 决定 | 原因与代价 |
| --- | --- |
| 在当前 checkout 的 chore/nest-react-bootstrap 分支修正 | 延续用户指定目录；并行改动需独立工作区，避免覆盖 |
| Nest 使用 Express 适配器与独立模块 | 使用 Nest 默认入口；未来网关需采用适配 Express 的静态授权中间件 |
| 保留 Vue SDK/example | 平台前端修正为 React，组件双框架要求仍有效；若未来取消 Vue，需单独调整范围 |
| 两个 Nest 应用固定 TypeScript 6.0.3 | 对齐 CLI 编译器；升级时需重新验证编译器兼容 |

独立审查结论在本轮审查后补充。
