# @company/gallery 更新日志

所有对本工作区包的重要实质性修改均记录于此文件。

## [0.0.4] - 2026-11-13

### 修复与加固 (fix)
- **前置 Pending 校验与零新增 create/PUT/complete**:
  - 在执行任何上传（PUT）或 `completeUploadSession` 之前前置检查本地持久化的 `zhinexus_pending_release`。
  - 属于当前三元组的有效 pending 记录直接以原幂等键重放 `submitReleaseJob` 并返回，跳过所有上传操作（零新增 create/PUT/complete）。
  - 同会话但自身损坏或被篡改的 pending（如 manifest 与声明 digest 不匹配），在任何网络副作用前抛出 `TAMPERED_PENDING_RELEASE` 阻断，严禁更换新 key 发送非幂等请求。
  - 无 pending 上传阶段若预签名 URL 已到期，安全新建 session 刷新 URL。
- **三元组隔离与防越权 (Fail-Closed)**:
  - 待恢复记录与活跃上传计划严格绑定 `(manifestDigest, apiUrl, subject)` 三元组。
  - 任何一项发生变更（切换清单内容、切换 API 接口地址、切换登录用户身份），严格视为新会话并从头开始，杜绝跨用户或跨环境复用旧 session 与旧 key。
  - `executeWebUploadWorkflow` 选项中 `subject: string` 必填，前置空身份拦截。
- **发布成功四键清理**:
  - 收到有效 HTTP 202 成功提交后，彻底清理 `zhinexus_upload_draft`、`zhinexus_pending_release`、`zhinexus_active_session_id`、`zhinexus_active_session_plan` 四键，页面刷新后不再展示恢复卡片，下一次发布干净生成新会话。
- **校验代际取消 (Generation / Cancel) 与提交前最终快照门禁**:
  - `validateUploadFiles` 在 `useEffect` 中增加 `cancelled` 代际保护标志与 `isValidatingFiles` 状态，异步校验期间提交按钮保持 disabled，避免旧文件的延迟校验结果覆盖新文件的损坏拦截错误。
  - `handleSubmitRelease` 提交流程在执行前对当前的 `manifest` 与 `filesMap` 进行一次同步快照重新校验，确保即使只读缓存状态异常也由前端最终门禁强阻断，不依赖旧缓存 `fileIssues`。

## [0.0.3] - 2026-11-13

### 新增与优化 (feat/fix)
- **真实目录导入 (`webkitdirectory`)**:
  - 本地构建产物及截图文件输入框支持 `webkitdirectory` 原生目录选择，按真实相对路径剥离顶层目录前缀并精确映射目标资产路径。
  - 测试不再伪造含斜杠的虚拟文件名，完全采用真实临时目录与真实文件路径注入。
- **清单期望摘要防篡改与阻断**:
  - 导入已有外部清单（manifest）时严格保留包的期望哈希与大小，不再被选择文件的哈希错误改写。
  - 同名但内容篡改或损坏的 tarball 严格触发 `DIGEST_MISMATCH` 并前置阻断发布提交。
- **断点恢复重放机制与幂等性保障**:
  - 恢复提交时直接从持久化记录中重放完整请求，避免因空草稿表单未选择文件而拦截。
  - 严格保持与首次提交相同的幂等键（Idempotency-Key），第二次 POST 获得 HTTP 202 响应且返回相同的 `jobId`，数据库中严格仅存在 1 条任务记录。
- **安全收口与测试代码清理**:
  - 移除发布工作区中的一键模拟开发者登录入口与测试专用钩子。
  - 移除从 URL query 参数中解析 JWT 的非安全逻辑，使用独立登录卡片及受保护的会话注入。
  - 修正测试脚本中的 `addInitScript`，避免在页面重载刷新时清空待恢复的发布会话数据。

## [0.0.2] - 2026-11-13

### 新增功能 (feat)
- **真实网页手动发布与逐实现必检收口 (T08)**:
  - 动态覆盖 7 组件 14 实现变体（`line`, `bar`, `pie`, `scatter`, `trend-card`, `ranking`, `proportion` × `vue`/`react`），彻底弃用写死样例与 dummy 哈希。
  - 严密校验每个变体截图所属框架与变体标识（`variantId`），缺图报 `SCREENSHOT_REQUIRED`，跨框架报 `SCREENSHOT_VARIANT_MISMATCH` 并强阻断提交。
  - 前端计算真实 Web Crypto SHA-256 摘要与文件大小，严格遵循 `UPLOAD_LIMITS` 约束（图片 10MB，tarball 50MB，总大小 500MB，最大文件数 5000）。
  - 支持导入外部 `manifest.json` 与本地预构建产物，自动进行 Schema 清洗与摘要核验。
  - 支持大文件分片上传（multipart），切片直传 MinIO 并收集 ETag 提交至 `POST /v1/uploads/:id/complete`。
  - 建立六阶段时序持久化与幂等断点恢复（`zhinexus_upload_draft`、`zhinexus_active_session_id`、`zhinexus_pending_release`），网络中断重试严格复用原幂等键。
  - 网页来源强制标记为 `manual-upload` 与 `unknown-manual`，绝不伪造自动报告或兼容 passed。

## [0.0.1] - 2026-11-12

### 新增功能 (feat)
- **组件资产目录列表 (T07)**:
  - 交付 `/components` 发现页面，提供多框架（Vue 3 / React 19 / 全部）筛选器与关键字即时搜索。
  - 组件卡片网格展示中文名称、逻辑标识、分类、支持框架标签、Ready 状态与版本号。
  - 遵循公开/私有渲染边界：服务端未就绪或无数据时优雅降级为空状态，包含友好的建设中提示及官方预置资产规范浏览入口。
- **组件详情与双框架切换 (T07)**:
  - 交付 `/components/[slug]` 动态详情路由，全面覆盖折线图 (`line`)、柱状图 (`bar`)、饼图 (`pie`) 与散点图 (`scatter`)。
  - 提供 Vue 3 与 React 19 双框架选项卡即时切换，无缝联动更新包名、引入语句、API 参数与预览容器。
  - 未知或未获准公开组件路径返回 404（`notFound()`）。
- **状态看板与合规凭证 (T07)**:
  - 独立展示可用状态 (`Ready`)、检查报告来源 (`local-automatic`)、视觉基线 (`accepted`)、检索索引 (`indexed`)、精确发布包版本与 ECharts 引擎版本。
  - 严格保持状态正交分离，不混淆可用性与检查来源。
- **沙箱隔离预览 iframe (T07)**:
  - 交付自适应沙箱 `<iframe ... sandbox="allow-scripts allow-same-origin" />`，支持实时运行指示、重新加载与尺寸指引。
  - 严格保持隔离网关边界，预览页面运行于独立域名，禁止访问平台管理 API 或读取平台认证凭证。
- **API 规范与代码集成指引 (T07)**:
  - 提供依赖安装命令一键复制与标准 ESM 导入范式。
  - 渲染 Props 属性与 Events 事件的标准化结构表格，附带全链路验证凭证。
