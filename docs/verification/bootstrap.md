# 工程初始化验证记录

日期：2026-11-11，Windows x64。范围为 [初始化执行范围](../superpowers/plans/2026-11-11-bootstrap-execution.md)，不是整个 T01 的验收。

## 已验证结果

| 命令 / 项目 | 实际结果 |
| --- | --- |
| scripts/bootstrap.ps1 | 官方 Node SHA-256、pnpm 平台包 SHA-512 校验；项目本地版本探测通过 |
| scripts/verify-bootstrap.ps1 | Windows PowerShell 5.1.26100.9444 非交互、干净目录首次下载与缓存重跑均通过；修复前观察到确认提示导致失败 |
| pnpm install --frozen-lockfile | 成功，无锁文件更新 |
| pnpm peers check | No peer dependency issues found |
| pnpm verify:workspace | 10 个成员，依赖无环，4 个公开包壳，平台依赖边界通过 |
| pnpm build | 10/10 构建成功 |
| pnpm typecheck | 10 包类型检查和根 scripts/tests 类型检查通过（包含 4 个依赖 build，共 14 Turbo 任务） |
| pnpm test | 5/5 基础测试通过；实现前观察到 CLI 未实现和 healthz 404 导致的 5 项失败 |
| pnpm test:browser | 3/3 通过：画廊、Vue 示例、React 示例；Chromium headless 158.0.8127.18 / revision 1254 |
| component --version / --help | 0.0.0、骨架帮助正确；component release 返回退出码 1 |
| pnpm build:services | 仅 contracts/API/preview-gateway，5/5 任务通过 |
| pnpm dev | 修正持久任务并发上限后 10 任务可启动；3000/3001 健康检查、5173/5174/5175 均 HTTP 200 |
| 缓存 | 重复构建 10 命中；core 变化 5 失效/5 命中；恢复后 10 命中，见 turbo-baseline.md |

浏览器检查的是工作区包 exports 构建入口和运行时版本，未渲染实际业务图表，也未生成发布截图。API/网关只提供 liveness，上传路径返回 404。contracts 没有假冒成功的运行时校验器。

## 工具链及兼容处理

实际安装：Node 26.13.0、pnpm 12.18.0、Turbo 2.11.10、TypeScript 7.0.2、Vite 8.3.8、Vue 3.5.45、React/React DOM 19.3.1、ECharts 6.1.0、Fastify 5.12.8、Vitest 5.1.0、Playwright 1.65.0。完整精确依赖在各 package.json 与 pnpm-lock.yaml；官方候选发现见 `docs/versions.discovery.json`。

实际发现并解决四项工具链适配：

1. pnpm 12 使用原生平台可执行文件，旧 `bin/pnpm.cjs` 入口不存在。bootstrap 按官方 `@pnpm/exe.win32-x64@12.18.0` 元数据下载并校验，启动真实 `pnpm.exe`；不修改系统 Node 24.6.0 / pnpm 10.25.0。
2. pnpm 12 将安装设置放在 workspace YAML，旧 onlyBuiltDependencies 已被 allowBuilds 替代。改为只允许 esbuild 构建，并显式指定官方 registry、精确依赖与严格 peer/engine 检查；保留安装器为固定 Vite 8.3.8 生成的 release-age 例外，不放宽所有包。
3. vue-tsc 3.3.14 的 Volar 依赖要求 TypeScript `<7`，直接运行也报 `ERR_PACKAGE_PATH_NOT_EXPORTED: typescript/lib/tsc`。根 TS 保持 7.0.2，仅 gallery/Vue example 的 SFC 类型检查隔离使用官方稳定 6.0.3。元数据见 vue-typescript-exception.json；修正后无 peer 问题且两类类型检查通过。该例外须在 Vue 工具支持原生 TS 后重新评估，不宣称所有包均用 TS7。
4. 独立审查发现 Windows PowerShell 5.1 的 `Invoke-WebRequest` 首次请求需要确认，导致非交互脚本失败；统一加 `-UseBasicParsing`。新增隔离回归先失败再通过，真实重新下载 Node/pnpm、校验摘要与版本，并再次运行缓存路径；证据为 `bootstrap-ps51-red.log` / `bootstrap-ps51-green.log`。修复后重跑完整验证，构建、类型、5 个单元测试、3 个浏览器测试和服务白名单均通过，见 `final-checks.log`。

兼容处理的代价是同时维护两种类型检查器；没有把候选版本发现当作完整组件兼容矩阵。React 示例构建约 504 kB，触发 Vite 的 500 kB 警告；当前版本探针引入 ECharts 核心，按需注册/分包与体积验收留在 T02/T03，不掩盖该警告。

官方核对入口（本次通过官方 HTTP 元数据及安装结果核对）：`registry.npmjs.org` 的包/version 与 latest，`nodejs.org/dist/index.json` 和对应 SHASUMS256，`pnpm.io/settings/build` 的 allowBuilds。后续刷新发现值不自动修改项目版本。

## 尚未完成

- G1：schema/运行时 manifest 校验、确定性摘要、逐实现截图与来源/兼容性关联、API 契约 fixtures。
- G2：PostgreSQL/Verdaccio/MinIO 实际读写、重启恢复、固定部署版本/镜像、OIDC、独立预览域/TLS。
- T02/T03：真实图表、生命周期、按需打包、工作区外消费者与候选 tarball 安装。
- T04–T12：本地冻结/截图/报告、上传发布作业、授权预览、画廊/网页提交、升级回退、试点与恢复验收。

完整 T01 保持开放；后续按 [三人分工计划](../superpowers/plans/2026-11-11-three-person-allocation.md) 继续。原始架构文件 SHA-256 保持 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
