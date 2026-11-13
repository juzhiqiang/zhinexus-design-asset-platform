# @company/gallery 更新日志

所有对本工作区包的重要实质性修改均记录于此文件。

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
