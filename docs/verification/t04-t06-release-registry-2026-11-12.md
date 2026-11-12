# T04/T06：完整发布材料与注册表适配发布闭环验证记录

**执行日期:** 2026-11-12  
**负责人:** B（CLI / 画廊 / 本地验证）+ C 协助（注册表与发布适配器）  
**关联任务:** 
- T04 完整发布材料补齐（覆盖折线、柱状、饼图、散点图全量实现截图、报告、API元数据、Markdown文档、真实静态预览、release/status/resume 命令）
- T06 注册表摘要及依赖可达性适配器（RegistryClient、Verdaccio 候选发布、幂等复用、防冲突核验、拓扑依赖检查、推进 Ready 与注册表精确安装）

---

## 1. 交付内容与设计架构

### 1.1 完整变体材料生成 (`packages/component-cli/src/local/manifest.ts`)
- 全面覆盖折线（`line`）、柱状（`bar`）、饼图（`pie`）、散点图（`scatter`）四组件在 Vue 3 与 React 19 双框架下的全量 8 个变体实现（`line-vue`, `line-react`, `bar-vue`, `bar-react`, `pie-vue`, `pie-react`, `scatter-vue`, `scatter-react`）。
- 驱动本地 Playwright Chromium 在工作区外干净消费者中对全部 8 个变体逐一执行 `ready` → `runState` → `getChecks` 协议，采集真实视口截图并生成关联同一冻结 tarball SHA-256 的合法 `CheckReportV1`（baselineResult 为 `NEW`）。
- 自动生成标准化 API JSON 元数据（`LineChartConfig`, `BarChartConfig`, `PieChartConfig`, `ScatterChartConfig`）及文档 Markdown 文件，纳入 `ReleaseManifestV1` 清单。

### 1.2 干净消费者真实静态预览构建 (`packages/component-cli/src/local/manifest.ts`)
- 严格遵循服务端零执行与沙箱隔离原则：在工作区外干净消费者安装冻结产物后，在消费者端执行 `npm run build`（调用 Vite）构建真实静态资源。
- 将多页构建产物（`index.html`, `bar.html`, `pie.html`, `scatter.html` 及 `assets/*`）复制至 `bundleDir/preview/${variantId}/`，生成自包含静态预览页面，供沙箱 `iframe` 通过 `preview-gateway` 隔离运行。
- 所有预览文件均自动登记至 `example.previewFiles` 与 `manifest.files`，通过 T05 平台服务端严格校验器 `validatePlatformBundle`。

### 1.3 客户端发布、状态与恢复命令 (`packages/component-cli/src/local/release.ts` 与 `cli.ts`)
- 新增 `component release`、`component status`、`component resume` 命令行子命令。
- 基于 `.release-session.json` 持久化本地发布会话：
  - 若 `manifestDigest` 未发生变化，复用原有的 `idempotencyKey`、`uploadSessionId` 与 `jobId`，支持断点自动续传。
  - 支持文件分块上传至对象存储、通知服务端完成核验、向平台提交发布作业、轮询状态直至完成。
  - 遇到重试或重新恢复时，严格沿用原摘要与幂等键。

### 1.4 注册表摘要及依赖可达性适配器 (`apps/api/src/releases/registry-client.ts` 与 `worker.ts`)
- **Verdaccio 适配客户端 (`RegistryClient`)**:
  - 管理 `g2publisher`（发布）与 `g2reader`（读取/核对）凭据与动态 Token 获取。
  - `ensurePackage`: 检查 Verdaccio 中是否存在目标版本。若存在且 SHA-256 一致返回 `already-identical`；若 SHA-256 不一致抛出 `CONFLICT`（同名同版本不同内容严禁覆盖）；若不存在则以 `candidate-<jobId>` 临时标签执行 `npm publish`。
  - `promoteDistTag`: 发布全量成功后将 candidate 标签晋升为 `latest`。
  - `checkAvailability`: 验证包及其拓扑依赖在注册表上的可读性与可达性（`charts-core` 必须先于 `charts-vue` 和 `charts-react` 达就绪状态）。
- **发布推进状态机 (`worker.advanceRelease`)**:
  - 驱动发布作业从 `PENDING` 推进至 `PUBLISHING` (`ENSURE_PACKAGES` → `CHECK_AVAILABILITY`)，最终进入 `READY` 并触发原子事务持久化。
  - 严格保持数据库租约控制与 fencing token 乐观并发校验，记录审计日志。

### 1.5 产物确定性打包与行尾归一化
- `packages/component-cli/src/local/pack.ts`: 在执行 `pnpm pack` 时显式注入 `SOURCE_DATE_EPOCH: '1700000000'`，固化 tar 归档内的文件时间戳，确保源码不变时多次打包生成的 tarball 字节与 SHA-256 绝对一致。
- `packages/charts-react/scripts/copy-style.mjs` 与 `packages/charts-vue/scripts/build.mjs`: 复制 `style.css` 至 `dist` 时统一转换为 LF 换行符（`replace(/\r\n/g, '\n')`），防止 Windows 平台检出换行符波动破坏已冻结包的摘要一致性。

---

## 2. 验证执行与测试结果证据

### 2.1 发布材料与真实预览集成测试 (`tests/integration/cli-bundle.test.ts`)
```powershell
.\scripts\pnpm.ps1 vitest run tests/integration/cli-bundle.test.ts
```
- **测试结果:** 3 个用例全部通过（16.6s）。
  - 生成包含 line, bar, pie, scatter 四组件 × Vue, React 双框架的全部 8 个变体材料。
  - 生成自包含的真实 Vite 静态预览文件并在 `files` 清单中登记。
  - T05 服务端 `validatePlatformBundle` 校验完全接受该 Bundle。
  - 缺图与错配框架注入测试准确报错阻断。

### 2.2 全链路发布、状态恢复与 Verdaccio 安装测试 (`tests/integration/cli-release.test.ts`)
```powershell
.\scripts\pnpm.ps1 vitest run tests/integration/cli-release.test.ts
```
- **测试结果:** 1 个综合长跑用例（~27s）全部通过。
  1. 生成 8 个实现的完整冻结材料 Bundle。
  2. CLI `release` 执行上传并向 API 提交发布，由后端 RegistryClient 发布至本地 Verdaccio，推进状态至 `READY`。
  3. 验证本地 `.release-session.json` 持久化记录正确。
  4. 验证 CLI `status` 命令返回 `READY`。
  5. 验证 CLI `resume` 命令复用原幂等键与 jobId 成功返回。
  6. 数据库查询验证：`variant_releases` 表中 Availability 为 `Ready` 的变体数 >= 8，`package_releases` 中为 `READY` 的包数 >= 3。
  7. 干净临时目录中配置 `.npmrc`（作用域注册表 `@company:registry=http://127.0.0.1:14873/`），通过 `npm install` 从 Verdaccio 精确拉取 `@company/charts-vue@0.0.4`。
  8. 执行独立 Node 测试脚本安全导入 line, bar, pie, scatter，输出 `VERDACCIO_INSTALL_VERIFIED_SUCCESS`。

### 2.3 集成测试套件 (`tests/integration`)
```powershell
.\scripts\pnpm.ps1 vitest run tests/integration
```
- **测试结果:** 9 个测试文件、246 个测试全部通过。

### 2.4 全套工程门禁验证 (`.\scripts\verify.ps1`)
```powershell
.\scripts\verify.ps1
```
- **执行内容与结果:**
  - `verify:workspace`: 10 members, no cycles, four publishable shells, safe service graph (通过)。
  - `build`: 10 个包全部构建通过（Next.js 画廊、NestJS 服务、CLI、Vue/React 图表核心及示例）。
  - `typecheck`: 10 个包 TypeScript / Vue 类型检查全部通过。
  - `test`: 24 个测试文件、468 个测试全部通过。
  - `test:browser`: 71 个 Playwright 浏览器端到端测试用例全部通过。
  - 最终状态：`Bootstrap verification passed`。

### 2.5 真实平台全套服务测试 (`.\scripts\pnpm.ps1 test:platform`)
```powershell
.\scripts\pnpm.ps1 test:platform
```
- **执行内容与结果:** 18 个测试文件、62 个用例全部通过（涵盖 PostgreSQL 实测迁移、MinIO S3 对象存储不可变上传、NestJS 真实会话与分片、发布作业原子持久化、基线 CAS 更新、所有权审计与注册表适配器）。

---

## 3. 验收标准达成情况

| 验收标准 | 状态 | 证明方式 |
|---|---|---|
| SDK 完整 Bundle 被 T05 接受 | **达成** | `validatePlatformBundle` 在 `cli-bundle.test.ts` 中针对完整 8 变体 bundle 验证通过 |
| 真实静态预览能在沙箱运行 | **达成** | 干净消费者构建静态预览并在 `preview-gateway` / `preview-browser.test.ts` 沙箱运行通过 |
| 上传恢复沿用原摘要和幂等键 | **达成** | `executeResumeCommand` 与 `.release-session.json` 持久化，原幂等键一致性通过 |
| 查到 Ready 状态 | **达成** | `executeStatusCommand` 轮询返回 `READY`，数据库 `variant_releases` 确认为 `Ready` |
| 从注册表精确安装并安全运行 | **达成** | 独立干净消费者从 `http://127.0.0.1:14873/` 安装 `@company/charts-vue@0.0.4` 并成功导入各子路径 |

## 3. 语义化版本与发布记录

- `@company/component-cli`: 从 `0.0.3` 升级至 `0.0.4`，并在 `packages/component-cli/CHANGELOG.md` 中记录对外可见的发布材料全覆盖、静态预览构建与 release/status/resume 命令支持。

