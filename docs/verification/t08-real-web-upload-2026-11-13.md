# T08 网页手动发布与逐实现截图必检收口验证记录 (2026-11-13)

## 1. 验证目标与工作区隔离

- **角色与任务**：B（CLI / 画廊），负责 T08 真实网页手动发布收口。
- **独立工作区**：`D:\project\zhinexus-design-asset-platform-b`
- **基线主干**：`885792b`
- **工作分支**：`feat/t08-real-web-upload`
- **端口保护**：因 C（平台/Codex）正在使用 5173–5176 端口运行 14 实现三存储闭环回归测试，B 在本轮实施中严格避开 5173–5176 端口，未在本地启动占用该区间的开发或预览服务。

---

## 2. 核心功能与安全边界实现

1. **动态覆盖 7 组件 14 实现变体**：
   - 彻底废除写死的 2 组件 4 实现演示数据及假哈希（`dummyTarballSha` / `dummyPreviewSha`）。
   - 完整覆盖折线图 (`line`)、柱状图 (`bar`)、饼图 (`pie`)、散点图 (`scatter`)、趋势卡片 (`trend-card`)、排行榜 (`ranking`) 与占比 (`proportion`) 双框架（Vue 3 / React 19）共 14 个实现变体。
2. **逐实现截图关联与阻断拦截**：
   - 每个逻辑组件的每个实现（`VariantRef`）必须关联至少一张有效展示截图。
   - 严密比对 `shot.variantId === variant.variantId` 与 `shot.framework === variant.framework`。
   - 缺图时触发 `SCREENSHOT_REQUIRED` 阻断提交并在页面列出明细；框架错配（如用 Vue 图配 React 变体）时触发 `SCREENSHOT_VARIANT_MISMATCH` 阻断提交。
3. **真实文件校验与共享限制核对**：
   - 在浏览器端使用 Web Crypto API 计算文件真实 SHA-256 哈希，逐文件核对声明路径、长度 `byteLength` 与摘要。
   - 严格对照 `@company/contracts` 中的 `UPLOAD_LIMITS` 约束：
     - 单张截图不得超过 10MB（`imageBytes`）；
     - 单个 tarball 不得超过 50MB（`tarballBytes`）；
     - 总大小不得超过 500MB（`totalBytes`）；
     - 总文件数不得超过 5000（`maxFiles`）；
     - 超限时直接在前端抛出 `SIZE_LIMIT_EXCEEDED` 阻断提交。
4. **外部 Manifest 与预构建产物导入**：
   - 提供 `parseAndValidateImportedManifest` 与界面文件选择器，支持用户导入外部 `manifest.json`，自动执行 Schema 清洗与字段规范化（强制 `channel: 'web'`，过滤未声明私有字段）。
   - 提供 `attachLocalFile`，支持批量导入本地 `.tgz` 与静态文件，实时计算哈希并装配到内存文件映射中。
5. **分片上传契约支持 (Multipart)**：
   - 严格处理服务端返回的 `plan.multipart` 分片计划，支持大文件切片直传 MinIO。
   - 收集各分片的 `partNumber` 与 `ETag` 响应头，在 `POST /v1/uploads/:id/complete` 校验阶段如实传递 `parts` 数组。
   - 上传或 complete 校验失败时立即终止抛错，绝不吞错继续发布。
6. **六阶段时序持久化与断点幂等恢复**：
   - 创建上传会话前：持久化草稿元数据与清单摘要（`zhinexus_upload_draft`）；
   - 服务端返回后：立即持久化会话标识（`zhinexus_active_session_id`）；
   - 首次 `POST /v1/releases` 前：持久化固定幂等键及完整原请求（`zhinexus_pending_release`）；
   - 网络中断重试时严格复用原持久化的 `idempotencyKey`，禁止更换新 key 重复占位提交；
   - 页面支持检测未完成会话并提供“恢复提交”与“放弃草稿”操作卡片。
7. **来源可信度分离**：
   - 网页来源强制标记为 `manual-upload` 与 `unknown-manual`，绝不伪造 `local-automatic` 检查报告或将兼容性判定为 `passed`（保持为 `candidate` 或无报告）。

---

## 3. TDD RED/GREEN 验证记录

### 3.1 单元测试套件 (`tests/unit/web-upload-workflow.test.ts`)

- **RED 阶段 1**：创建初始 8 个单元测试，由于缺少 14 实现动态校验与时序持久化模块，初次执行报错。
- **GREEN 阶段 1**：实现 `screenshot-validation.ts` 与 `manifest-form.ts`，8 个测试全部通过。
- **RED 阶段 2**：新增 6 个测试覆盖外部导入、大文件分片、分片失败阻断及 `UPLOAD_LIMITS` 限制检查，执行因未实现对应函数及未隔离 module-level store 预期失败（6 failed | 8 passed）。
- **GREEN 阶段 2**：实现 `parseAndValidateImportedManifest`、`attachLocalFile`、`uploadPartBytes`、分片切片上传、`SIZE_LIMIT_EXCEEDED` 校验及 `createMemoryStorage`，14 个测试全量通过：

```text
 RUN  v5.1.0 D:/project/zhinexus-design-asset-platform-b

 ✓ tests/unit/web-upload-workflow.test.ts (14 tests) 47ms
   ✓ T08: 网页发布真实文件校验与逐实现必检 (4)
     ✓ 验证覆盖 7 组件 14 实现的完整 Manifest 结构与逐实现截图合规 8ms
     ✓ 缺图阻断：当 14 实现中缺失任意变体截图时阻断提交并列出所有缺失项 (SCREENSHOT_REQUIRED) 1ms
     ✓ 错框架阻断：若将 React 截图关联给 Vue 变体必须拦截 (SCREENSHOT_VARIANT_MISMATCH) 0ms
     ✓ 文件一致性校验：核对所有待上传文件的存在性、长度与 SHA-256 摘要 10ms
   ✓ T08: 上传时序持久化、错误停止与幂等恢复 (4)
     ✓ 时序持久化：严格在请求前持久化待上传草稿，返回后持久化 sessionId，发布前持久化固定幂等键 4ms
     ✓ 文件上传失败时立即停止，严禁吞错继续调用 complete 或 release 3ms
     ✓ complete 核验失败时立即停止，严禁吞错继续发布 2ms
     ✓ 网络中断或丢包重试时严格复用原持久化的幂等键，禁止更换新 key 重复占位 5ms
   ✓ T08: 外部 Manifest 与本地文件导入、大小限制与分片契约 (6)
     ✓ 支持导入外部合法 Manifest JSON 并自动清理不合规字段 1ms
     ✓ 拒绝损坏或格式非法的外部 Manifest JSON 0ms
     ✓ 支持导入并关联本地产物文件，正确计算 SHA-256 并同步到映射 0ms
     ✓ 超出共享大小限制时阻断：单张截图超 10MB、tarball 超 50MB 或总超 500MB 14ms
     ✓ 分片上传支持：按契约对大文件切片上传，收集 ETag 并在 complete 时正确提交 3ms
     ✓ 分片上传失败时立即停止，禁止向服务端提交 complete 或 release 3ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  11:23:38
   Duration  214ms
```

### 3.2 静态类型检查与构建验证

- **画廊单包类型检查**：`pnpm --filter @company/gallery typecheck` -> 成功通过，0 错误。
- **全工作区编译与类型检查**：`pnpm typecheck` -> 10 个包与根项目全量通过。
- **画廊 Next.js 生产构建**：`pnpm --filter @company/gallery build` -> 成功生成 8 个核心路由（含 `/upload` 与 `/jobs/[jobId]`）。
- **画廊缓存与多 Origin 动态验证**：`pnpm test:gallery-cache` -> 动态端口（避免 5173–5176 冲突）启动 Next.js 成功通过。

---

## 4. 交付 C 的接口缺口与交接需求

为完成浏览器真实端到端测试（经由 NestJS API、Worker、三存储推进至 READY），需要 C 在完成 `fix/c-sdk14-acceptance` 平台支持改造时提供以下对接支撑：

1. **API 服务 CORS 配置**：
   - 画廊前端运行于浏览器，直接向 API 发起请求时会触发跨域预检（`OPTIONS` 请求）。
   - 请在 `apps/api` 的 `buildServer` 中启用跨域支持（`app.enableCors(...)`），并显式放行 `idempotency-key`、`authorization` 与 `content-type` 请求头。
2. **MinIO 直传 CORS 策略**：
   - 浏览器通过预签名 URL 直传或分片上传产物至 MinIO 时，MinIO 存储桶需允许来自画廊 Origin 的 `PUT` 请求及 `ETag` 响应头暴露（以便前端提取分片 ETag）。
3. **可注入的 `PlatformServices` 接口**：
   - 期待 C 提交的 `PlatformServices` 提供：
     - `apiOrigin`: API 随机端口地址（如 `http://127.0.0.1:<port>`）；
     - `storageEndpoint`: 对象存储端点；
     - `testToken`: 已对七组件与两发布包完成赋权（`grant`）的有效 OIDC 签名 Token（subject: `alice`, azp: `web`, roles: `['publisher', 'maintainer']`）；
     - `advanceWorker`: 用于单次或循环推进后台 `Worker` 处理队列直至作业流转至 `READY`。

---

## 5. 未覆盖边界说明

1. **真实企业 OIDC 单点登录**：当前仅在本地测试环境下使用符合 OIDC 契约的 RS256 JWT 与 mock 开发者凭据联调，真实企业 IdP 鉴权需在后续集成阶段完成。
2. **真实三存储全链路浏览器端到端**：因避免与 C 正在执行的 5173–5176 端口回归发生冲突，完整连通三存储的 Playwright 运行将在 C 交付随机端口 `PlatformServices` 后接入执行。
