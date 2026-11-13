# T08 网页手动发布与逐实现截图必检收口验证记录 (2026-11-13)

## 1. 验证目标与工作区隔离

- **角色与任务**：B（CLI / 画廊），负责 T08 真实网页手动发布收口与三存储端到端集成验证。
- **独立工作区**：`D:\project\zhinexus-design-asset-platform-b`
- **基线主干**：`885792b`
- **工作分支**：`feat/t08-real-web-upload`
- **基础设施隔离**：采用随机端口独立 `RecoveryStack` 容器进行三存储（MinIO / PostgreSQL / Verdaccio）全链路验证，严格按所有权在测试结束后自动销毁并清理临时目录；严禁修改或重启共享 G2 基础服务。

---

## 2. 核心功能与安全边界实现

1. **动态覆盖 7 组件 14 实现变体**：
   - 彻底废除写死的 2 组件 4 实现演示数据及假哈希（`dummyTarballSha` / `dummyPreviewSha`）。
   - 完整覆盖折线图 (`line`)、柱状图 (`bar`)、饼图 (`pie`)、散点图 (`scatter`)、趋势卡片 (`trend-card`)、排行榜 (`ranking`) 与占比 (`proportion`) 双框架（Vue 3 / React 19）共 14 个实现变体。
2. **逐实现截图关联与阻断拦截**：
   - 每个逻辑组件的每个框架实现（`VariantRef`）必须关联至少一张有效展示截图。
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
   - 提供 `parseAndValidateImportedManifest` 与界面文件选择器（`#import-manifest-input`），支持用户导入外部 `manifest.json`，自动执行 Schema 清洗与字段规范化（强制 `channel: 'web'`，过滤未声明私有字段）。
   - 提供 `attachLocalFile` 与批量文件选择器（`#import-files-input`），支持导入真实 `.tgz` 与静态文件，路径映射兼顾绝对与目录相对后缀匹配（`mf.path === normalizedPath || normalizedPath.endsWith('/' + mf.path) || (file.name.endsWith('.tgz') && mf.path.endsWith('/' + file.name))`），自动补齐扁平文件导入所缺失的 preview 最小 HTML 并重算 SHA-256，避免同名文件误覆盖。
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

## 3. MinIO 与 NestJS API 实际 CORS 行为证据与结论

### 3.1 MinIO S3 CORS 行为核验实测

1. **S3 REST API 行为**：
   - 在测试初始化时直接向 MinIO 发送 `@aws-sdk/client-s3` 的 `PutBucketCorsCommand`，MinIO 返回 HTTP 501 `NotImplemented: A header you provided implies functionality that is not implemented`。实测表明 MinIO 容器不支持通过 S3 API 动态写入 Bucket CORS 配置。
2. **原生跨域 OPTIONS 预检与 ETag 暴露**：
   - 使用 curl 模拟真实跨域请求探测：
     ```bash
     curl -i -X OPTIONS http://127.0.0.1:19000/test \
       -H "Origin: http://127.0.0.1:5173" \
       -H "Access-Control-Request-Method: PUT" \
       -H "Access-Control-Request-Headers: content-type"
     ```
   - **实测响应**：
     ```http
     HTTP/1.1 204 No Content
     Access-Control-Allow-Credentials: true
     Access-Control-Allow-Headers: content-type
     Access-Control-Allow-Methods: PUT
     Access-Control-Allow-Origin: http://127.0.0.1:5173
     Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
     ```
   - 对 MinIO PUT/GET 请求实测返回响应头中原生包含：
     ```http
     Access-Control-Expose-Headers: Date, Etag, Server, Connection, Accept-Ranges, Content-Range, Content-Encoding, Content-Length, Content-Type, Content-Disposition, Last-Modified, Content-Language, Cache-Control, Retry-After, X-Amz-Bucket-Region, Expires, X-Amz*, *
     ```
   - **结论**：MinIO 镜像已原生内置对 `Origin: http://127.0.0.1:5173` 的放行和 `Etag` 暴露，浏览器前端直传 MinIO 与切片 ETag 提取完全畅通，无需第三方代理或额外 S3 命令。

### 3.2 NestJS API CORS 行为与 C 交付文件接入

1. **C 交付文件接入**：
   - 已选择性接入 C 审查提交的 `apps/api/src/app.ts`、`apps/api/src/platform.ts`、`apps/api/package.json`（0.0.5）与 `tests/unit/api-cors.test.ts`。
   - `buildServer` 中通过 `galleryOrigin: 'http://127.0.0.1:5173'` 精确白名单控制，放行 `['GET', 'POST', 'OPTIONS']` 与头 `['Authorization', 'Content-Type', 'Idempotency-Key']`，严禁 credentials 与任意源。
2. **CORS 单元测试验证**：
   - 执行 `vitest run tests/unit/api-cors.test.ts`，6 项测试全部通过（178ms）：
     - 精确允许配置的画廊 Origin（204）；
     - 拒绝预览 Origin、类似域名、不同端口、null origin 或任意私有头（404）；
     - 未配置 `galleryOrigin` 时全局禁用跨域（404）。

---

## 4. 全量自动化验证通过证据

### 4.1 单元测试套件 (`tests/unit/web-upload-workflow.test.ts` + `tests/unit/api-cors.test.ts`)

1. 执行命令：`pnpm vitest run tests/unit/web-upload-workflow.test.ts`
   实测结果：**15 项全量通过 (45ms)**
   - 覆盖 14 实现动态校验、缺图与错框架阻断、文件大小与 Web Crypto SHA-256 校验、严格时序持久化、错误中止、幂等键复用、外部 Manifest 清洗与路径补齐、分片 ETag 收集与分片失败中止。
   - **新增**：导入已有清单时保持期望摘要不可篡改，同名产物内容篡改或错误时 `validateUploadFiles` 严格阻断并报告 `DIGEST_MISMATCH`，禁止自动重写包期望摘要。
2. 执行命令：`pnpm vitest run tests/unit/api-cors.test.ts`
   实测结果：**6 项全量通过 (243ms)**
   - 验证画廊 Origin 精确白名单、OPTIONS 预检 204、头白名单及未配置 Origin 时严格禁用。

### 4.2 真实三存储端到端浏览器测试 (`tests/browser/web-upload-real-e2e.spec.ts`)

执行命令：`pnpm playwright test tests/browser/web-upload-real-e2e.spec.ts --config tests/playwright.config.ts --workers=1`
实测结果：**6 项全量通过 (49.5s)**

```text
Running 6 tests using 1 worker

  ok 1 tests\browser\web-upload-real-e2e.spec.ts:223:3 › T08: 真实三存储浏览器端到端发布流水线 › 真实三存储全链路：选择真实产物和逐实现手动截图，经 Nest API/MinIO/Worker 推进至 READY (13.5s)
  ok 2 tests\browser\web-upload-real-e2e.spec.ts:309:3 › T08: 真实三存储浏览器端到端发布流水线 › 缺图阻断：从已导入真实材料的可提交状态删一实现截图，严格阻断提交 (SCREENSHOT_REQUIRED) (485ms)
  ok 3 tests\browser\web-upload-real-e2e.spec.ts:344:3 › T08: 真实三存储浏览器端到端发布流水线 › 框架错配拦截：导入将 React 截图关联给 Vue 变体的清单时前置拦截 (SCREENSHOT_VARIANT_MISMATCH) (220ms)
  ok 4 tests\browser\web-upload-real-e2e.spec.ts:413:3 › T08: 真实三存储浏览器端到端发布流水线 › 真实后端上传异常阻断：MinIO 故障或上传异常时停止发布，禁止调用 complete 或 release (633ms)
  ok 5 tests\browser\web-upload-real-e2e.spec.ts:449:3 › T08: 真实三存储浏览器端到端发布流水线 › 真实丢失响应恢复与唯一作业断言：网络掉线后刷新页面点击恢复，复用原幂等键且数据库仅一作业 (21.1s)
  ok 6 tests\browser\web-upload-real-e2e.spec.ts:541:3 › T08: 真实三存储浏览器端到端发布流水线 › 清单期望摘要不可篡改：导入同名损坏或篡改 tarball 时保持期望摘要并严格阻断发布 (DIGEST_MISMATCH) (2.8s)

  6 passed (49.5s)
```

**全链路 Happy Path 流转证据**：
- `POST /v1/uploads` -> HTTP 201 Created (246ms)；
- 浏览器直传真实 NPM 3 个 tarball 与 14 变体 185 个产物文件至 MinIO，全部返回 HTTP 200 并携带有效 ETag；
- `POST /v1/uploads/:id/complete` -> HTTP 200 OK (3663ms)；
- `POST /v1/releases` (带固定 Idempotency-Key) -> HTTP 202 Accepted (618ms)；
- `ReleaseWorker.runOnce(jobId)` 驱动状态机依次通过：
  - `FINALIZE_OBJECTS` -> success (3820ms)
  - `ENSURE_PACKAGES` -> success (194ms)
  - `REGISTER_ASSETS` -> success (7ms)
  - `CHECK_AVAILABILITY` -> success (501ms)
  - `READY_TX` -> success (607ms)
- 数据库 `release_jobs` 状态原子写入 `READY`；
- 前端轮询捕获 `READY` 状态并展示“发布成功！版本状态已原子写入 Ready”；
- 通过 Verdaccio API 携带 publisher token 精确读取 `@company/charts-core`、`@company/charts-vue`、`@company/charts-react` 验证候选发布全部就绪（HTTP 200）。

**丢响应恢复与唯一作业实测证据 (用例 5)**：
- 首次 `POST /v1/releases` 经服务端处理并落库（HTTP 202，jobId: `ec7180a8-...`），对前端注入连接中断（丢弃响应）；
- 前端捕获网络中断提示“发布失败: Failed to fetch”，此时本地持久化原幂等键 `web-1794551727694-xlx3hc8w` 与原清单；
- 用户刷新页面，页面从 `zhinexus_pending_release` 自动识别未完成发布并展示原幂等键卡片；
- 点击“恢复提交”，前端直接重发原请求，服务端根据相同幂等键再次返回相同的 HTTP 202 与相同的 jobId；
- 数据库核验：`SELECT id, idempotency_key FROM release_jobs WHERE idempotency_key=$1` 严格仅有 1 条记录，无重复作业产生；
- ReleaseWorker 推进该作业顺利流转至 `READY`。

**期望摘要不可篡改实测证据 (用例 6)**：
- 复制真实产物目录并将 `company-charts-core-0.0.6.tgz` 字节翻转篡改（保持同长度）；
- 经 `<input webkitdirectory>` 选择器导入真实目录后，前端 `validateUploadFiles` 核验发现真实哈希与清单声明哈希不匹配；
- 界面精准抛出 `[DIGEST_MISMATCH] packages/company-charts-core-0.0.6.tgz: 文件哈希不一致`，强行禁用提交按钮，清单期望摘要保持不变。

### 4.3 浏览器端回归全景 (`manual-release.spec.ts`)

执行命令：`pnpm playwright test tests/browser/manual-release.spec.ts --config tests/playwright.config.ts`
实测结果：**8 项全量通过 (4.5s)**

```text
Running 8 tests using 2 workers

  ok 1 tests\browser\manual-release.spec.ts:16:3 › T08: 网页手动发布与逐实现截图必检 › 未登录用户访问发布工作区渲染登录后开放且带有 noindex 保护 (368ms)
  ok 2 tests\browser\manual-release.spec.ts:27:3 › T08: 网页手动发布与逐实现截图必检 › 模拟登录后展示发布工作区与逐实现必检清单 (445ms)
  ok 3 tests\browser\manual-release.spec.ts:43:3 › T08: 网页手动发布与逐实现截图必检 › 缺图阻断：任意变体缺图时禁止提交并展示明确错误提示 (blocks_submit_when_any_variant_has_no_image) (322ms)
  ok 4 tests\browser\manual-release.spec.ts:83:3 › T08: 网页手动发布与逐实现截图必检 › 框架错配拦截：导入错配框架截图时前置阻断 (SCREENSHOT_VARIANT_MISMATCH) (283ms)
  ok 5 tests\browser\manual-release.spec.ts:155:3 › T08: 网页手动发布与逐实现截图必检 › 独立作业状态机页面支持 7 阶段步骤器展示与状态轮询 (223ms)
  ok 6 tests\browser\manual-release.spec.ts:172:3 › T08: 网页手动发布与逐实现截图必检 › 断点恢复机制：当存在未完成的发布会话时展示恢复卡片并允许一键恢复 (315ms)
  ok 7 tests\browser\manual-release.spec.ts:206:3 › T08: 网页手动发布与逐实现截图必检 › 支持界面选择本地图片替换截图并动态更新大小与摘要 (238ms)
  ok 8 tests\browser\manual-release.spec.ts:224:3 › T08: 网页手动发布与逐实现截图必检 › 上传接口失败时阻断提交流程并展示清晰错误提示 (386ms)

  8 passed (4.5s)
```

### 4.4 工作区架构与类型验证

- `pnpm verify:workspace`: 10 members, no cycles, four publishable shells, safe service graph.
- `pnpm typecheck`: 全工作区 10 个包及根项目 0 错误通过。
- `pnpm --filter @company/gallery build`: Next.js Turbopack 生产打包 0 错误通过。

---

## 5. 未覆盖边界与后续注意事项

1. **OIDC 签名身份限制**：当前端到端测试使用本地 RSA-256 私钥动态签发的测试 Token，仅验证本地联调鉴权流程；公司生产环境 OIDC SSO 登录及生产证书链需待后续联调。
2. **预览域隔离运行**：本地端到端测试重点验证资产上传与发布到 `READY` 及 Verdaccio 注册表可达性；静态预览沙箱 iframe 的独立注册域隔离由专用测试保障。
3. **主干合并与分支保护**：本轮所有改动均收敛于独立工作区 `D:\project\zhinexus-design-asset-platform-b` 与分支 `feat/t08-real-web-upload`，严格遵守未授权不 push、不合入 main 的安全要求。
