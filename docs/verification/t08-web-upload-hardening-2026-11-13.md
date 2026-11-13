# T08 网页手动发布时序前置重放、三元组严格隔离与前端校验竞态防篡改独立复验记录

> 记录日期：2026-11-13  
> 责任角色：B（CLI / 画廊）  
> 工作区分支：`feat/t08-real-web-upload` (`D:\project\zhinexus-design-asset-platform-b`)  
> 前序基准证据：`docs/verification/t08-real-web-upload-2026-11-13.md`（原始历史验证文档保持原样，不覆盖、不重写）

---

## 1. 复验背景与加固目标

在已完成的 T08 真实网页手动发布（包括真实目录导入 `webkitdirectory`、期望摘要防篡改与丢失响应幂等恢复）基础之上，根据真实浏览器环境深度核验（包括 WebCrypto 校验延迟返回与多目录导入竞态），针对网络中断重试与前端校验竞态进行深度加固：

1. **前置 Pending 重放与零新增 create/PUT/complete**：
   - 在任何网络副作用（`createUploadSession`、文件分片 PUT、`completeUploadSession`）发生前，必须优先核查本地持久化的 `zhinexus_pending_release`；
   - 属于当前三元组的有效 pending 记录直接以原幂等键重放 `submitReleaseJob` 并返回，零新增 createUploadSession / PUT / completeUploadSession（仅执行一次发布提交请求的幂等重放）；
   - 同会话但自身损坏或被篡改的 pending（如 manifest 与声明 digest 不匹配），在任何网络副作用前抛出 `TAMPERED_PENDING_RELEASE` 阻断，严禁更换新 key 发送非幂等请求；
   - 无 pending 上传阶段若预签名 URL 已到期（`expiresAt <= now`），安全新建 session 刷新 URL。

2. **严格三元组绑定与强隔离 (Fail-Closed)**：
   - 本地持久化的待恢复记录与活跃上传计划严格绑定 `(manifestDigest, apiUrl, subject)` 三元组；
   - 任何一项发生变更（切换不同清单内容、切换 API 接口地址、切换登录用户身份），严格视为全新会话，从零开始，杜绝跨用户或跨环境越权复用旧 session 与旧 key；三者完全相同时才允许断点恢复；
   - `executeWebUploadWorkflow` 选项中 `subject: string` 设为必填，从调用入口杜绝空身份提交。

3. **提交成功四键彻底清理**：
   - 收到服务端有效 HTTP 202 成功提交后，前端彻底清理 `zhinexus_upload_draft`、`zhinexus_pending_release`、`zhinexus_active_session_id`、`zhinexus_active_session_plan` 四键；
   - 仅保留 `zhinexus_web_release_session` 供作业状态查看，刷新页面后无恢复卡片展示，下一次发布流程干净生成新会话。

4. **页面校验竞态防护 (Generation / Cancel) 与提交前最终快照门禁**：
   - `validateUploadFiles` 在 `useEffect` 中建立 `cancelled` 代际保护标志与 `isValidatingFiles` 状态，异步校验期间提交按钮保持 disabled，避免旧文件的延迟校验结果覆盖新文件的损坏拦截错误；
   - `handleSubmitRelease` 提交流程在执行前对当前的 `manifest` 与 `filesMap` 进行一次同步快照重新校验，确保即使只读缓存状态异常也由前端最终门禁强阻断，不依赖旧缓存 `fileIssues`。

---

## 2. 实际验证执行命令与测试计数

### 2.1 窄范围单元测试 (`web-upload-workflow.test.ts`)

执行命令：
```powershell
pnpm vitest run tests/unit/web-upload-workflow.test.ts
```

实测结果：**26 passed (26)** (69ms)

覆盖用例明细：
1. `validateVariantScreenshots: 变体列表为空时立即阻断并返回 SCREENSHOT_REQUIRED`
2. `parseAndValidateImportedManifest: 结构校验失败时拒绝并展示字段路径 (/schemaVersion)`
3. `parseAndValidateImportedManifest: variants 为空数组时立即拒绝`
4. `parseAndValidateImportedManifest: packages 为空数组时立即拒绝`
5. `parseAndValidateImportedManifest: 当原始清单中 reports 为 null 时正确拒绝`
6. `parseAndValidateImportedManifest: 当原始清单中 files 包含 null 时正确拒绝`
7. `parseAndValidateImportedManifest: 支持导入外部合法 Manifest JSON`
8. `executeWebUploadWorkflow: subject 为空字符串时前置抛出 SUBJECT_REQUIRED 异常`
9. `executeWebUploadWorkflow: 成功完成发布并取得 202 后清理四个本地存储键`
10. `三元组隔离: 相同清单摘要但不同 API URL 时隔离并新建会话`
11. `三元组隔离: 相同清单与 API 但不同 subject 时隔离并新建会话`
12. `三元组隔离: 相同 API 与 subject 但不同清单摘要时隔离并新建会话`
13. `三元组隔离: 三元组完全相同时允许复用活跃会话计划`
14. `边界①同 session 篡改: 本地 pending 存在但内容被篡改时抛出 TAMPERED_PENDING_RELEASE 且不发起任何网络请求`
15. `边界②过期重签与已有 pending 锁定: 预签名 URL 过期时且无 pending 时重新创建上传会话获取有效 URL`
16. `前置 pending 校验: 属于当前三元组的有效 pending 直接提交 release 并跳过所有 PUT 与 complete (零新增 create/PUT/complete)`
17. `文件大小超限拦截 (超过 500MB)`
18. `文件数量超限拦截 (超过 5000 文件)`
19. `单张图片超限拦截 (超过 10MB)`
20. `单包 Tarball 超限拦截 (超过 50MB)`
21. `文件摘要与期望摘要不一致拦截 (DIGEST_MISMATCH)`
22. `多包多变体真实哈希一致通过`
23. `大文件切片分块上传收集 ETag`
24. `网络中断抛错但保留 pending 记录`
25. `重放提交时保持相同 Idempotency-Key`
26. `发布失败非 202 响应正确抛出异常`

---

### 2.2 平台 CORS 接口单元测试 (`api-cors.test.ts`)

执行命令：
```powershell
pnpm vitest run tests/unit/api-cors.test.ts
```

实测结果：**6 passed (6)** (213ms)

---

### 2.3 生产构建产物更新 (`apps/gallery/dist`)

执行命令：
```powershell
$env:NEXT_PUBLIC_SITE_URL="https://gallery.test"; pnpm --filter @company/gallery build
```

实测结果：**0 错误通过**，生成最新生产包，保证 Playwright 测试服务器运行最新防竞态代码。

---

### 2.4 浏览器手动发布端到端全景测试 (`manual-release.spec.ts`)

执行命令：
```powershell
pnpm exec playwright test tests/browser/manual-release.spec.ts --config tests/playwright.config.ts
```

实测结果：**8 passed (8)** (4.5s)

测试用例清单：
1. `未登录用户访问发布工作区渲染登录后开放且带有 noindex 保护` (通过)
2. `模拟登录后展示发布工作区与逐实现必检清单` (通过)
3. `缺图阻断：任意变体缺图时禁止提交并展示明确错误提示 (blocks_submit_when_any_variant_has_no_image)` (通过)
4. `框架错配拦截：导入错配框架截图时前置阻断 (SCREENSHOT_VARIANT_MISMATCH)` (通过)
5. `独立作业状态机页面支持 7 阶段步骤器展示与状态轮询` (通过)
6. `断点恢复机制：当存在未完成的发布会话时展示恢复卡片并允许一键恢复` (通过)
7. `支持界面选择本地图片替换截图并动态更新大小与摘要` (通过)
8. `上传接口失败时阻断提交流程并展示清晰错误提示` (通过)

---

### 2.5 真实三存储全链路端到端发布测试 (`web-upload-real-e2e.spec.ts`)

执行命令：
```powershell
pnpm exec playwright test tests/browser/web-upload-real-e2e.spec.ts --config tests/playwright.config.ts
```

实测结果：**6 passed (6)** (39.5s)

测试用例清单（真实三存储环境）：
1. `真实三存储全链路：选择真实产物和逐实现手动截图，经 Nest API/MinIO/Worker 推进至 READY`（覆盖 14 变体 185 文件直传、状态机 7 阶段流转、数据库 READY 状态写入以及 Verdaccio 注册表可读性核验）
2. `缺图阻断：从已导入真实材料的可提交状态删一实现截图，严格阻断提交 (SCREENSHOT_REQUIRED)`
3. `框架错配拦截：导入将 React 截图关联给 Vue 变体的清单时前置拦截 (SCREENSHOT_VARIANT_MISMATCH)`
4. `真实后端上传异常阻断：MinIO 故障或上传异常时停止发布，禁止调用 complete 或 release (PUT 中断阻断)`
5. `真实丢失响应恢复与唯一作业断言：网络掉线后刷新页面点击恢复，复用原幂等键且数据库仅一作业 (丢 202 刷新同 key/同 job/DB 唯一)`
6. `清单期望摘要不可篡改：导入同名损坏或篡改 tarball 时保持期望摘要并严格阻断发布 (DIGEST_MISMATCH / 坏 tarball)`

---

### 2.6 工作区健康与全量类型检查

执行命令：
```powershell
pnpm verify:workspace
pnpm typecheck
```

实测结果：
- `verify:workspace`: **10 members, no cycles, four publishable shells, safe service graph.**
- `typecheck`: **全工作区 10 包 + 根项目 0 错误 (FULL TURBO)**

---

## 3. 未覆盖边界与后续注意事项

1. **生产环境 OIDC SSO 深度联调**：当前端到端测试采用本地符合 JWT 标准的模拟私钥签发测试 Token，生产环境真实企业级 IdP 重定向认证、用户属性映射与证书链轮转待正式环境部署时打通；
2. **生产环境静态预览沙箱独立注册域物理隔离**：本轮本地测试重点覆盖上传鉴权、三存储流转与画廊内 iframe 渲染，未在真实生产网络验证跨独立可注册域（例如平台管理域 `company-platform.com` 与静态预览只读域 `company-assets-preview.net` 等不同 eTLD+1 根域）的物理隔离与反向代理策略，待生产域名与网关拓扑就绪后联调；
3. **跨存储持久化最终一致性**：三存储（PostgreSQL、MinIO、Verdaccio）的跨系统写入由服务端的 `ReleaseWorker` 状态机与分布式租约（fencing token）统一兜底保障，前端严格遵循幂等重试契约与四键安全清理规范。
