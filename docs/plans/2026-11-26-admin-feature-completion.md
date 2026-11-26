# 内网管理端（Admin）三项功能补齐实施计划

**Goal:** 在独立开发分支 `feat/admin-complete-features` 完成用户确认的三组后台补齐任务：修复后台渲染门禁与发布作业/成员列表缺陷、打通组件公开可见性/成员只读授权/视觉基线修订更新闭环、补齐资产管理页的隔离预览/材料报告查看/历史与废弃版本切换/兼容实测证据登记。

**Architecture:** 严格保持现有 11 个工作区成员、服务端零执行边界（`apps/api` 与 `apps/preview-gateway` 不构建或执行上传组件代码）、公开/内网路由隔离（新增管理路由挂载于既有内网门控前缀 `/v1/publishing/...`）及不可变发布原则；`component-platform-architecture.md` 保持原始字节不变。公共契约改动采用可选字段向后兼容演进，数据库通过新增向前迁移 `017_managed_account_read_grants.sql` 扩展组件只读授权。

**Tech Stack:** 沿用 React 19.3.1、Next.js 16.4.6、NestJS 12.4.2、PostgreSQL、Node 26.13.0、pnpm 12.18.0；不新增外部依赖。

## 确认范围

### 1. 阻塞门禁修复与既有页面缺陷修正
- 同步更新 `tests/admin/console-render.test.ts`：补充 `next/navigation` 测试上下文，对齐重构后的上传工作台（默认空态与演示草稿 14 实现校验双态）、`ZnShell` 登录门、接入与配置、成员与权限，并新增 `/assets`、`/jobs`、`/categories` 三个页面的渲染与样式完整性覆盖。
- 发布作业列表与详情（`/jobs`、`/jobs/[jobId]`、`ReleaseService.list`）：将状态过滤与 `RELEASE_STATES` 对齐（修正 `RUNNING` 为 `PUBLISHING` 及完整状态枚举）；详情页仅在 `RETRY_WAIT` 状态下开放重试操作，终态 `CONFLICT` / `REJECTED` 不再误导显示重试按钮；展示 `baselineCandidates` 并在 `READY` 时提供前往 `/assets` 的直达入口。
- 顶栏快速搜索（`ZnShell`）：输入 UUID 时直达 `/jobs/[jobId]`，否则跳转 `/assets?q=` 预填资产检索（保留 `/match?q=` 兼容）。
- 成员与权限（`/users`）及自助改密：接入服务端分页（`page`、`pageSize`、`total`）并兼容空筛选结果；补充 `credentialState === 'uncertain'` 与 `syncState === 'failed'` 的运维锁定提示；为组件与包授权输入提供已登记候选提示；在顶栏提供自管账号自助修改密码弹窗（调用 `POST /identity/password`）。

### 2. 核心权限与资产运维闭环
- **组件公开/内部可见性切换**：在详情响应与发布选项中兼容返回组件 `public` 状态；在 `/v1/publishing/components/:componentId/visibility` 提供受管理员或组件维护者（`maintainer` + `can_maintain`）保护的可见性切换接口并写入 `COMPONENT_VISIBILITY_UPDATED` 审计；在 `/assets` 提供可见性切换表单。
- **成员组件级只读授权（`can_read`）**：新增迁移 `017_managed_account_read_grants.sql`，为 `managed_account_component_grants` 增加 `can_read` 并更新检查约束为 `can_read OR can_publish OR can_maintain`；在 `ManagedAccountComponentGrant` 契约中兼容支持可选 `canRead`；`ManagedAccountsService` 保持“先本地收紧撤权、远端确认后再扩展授权”顺序同步 `component_permissions.can_read`；`/users` 授权编辑器新增「读取」勾选项。
- **视觉基线二次更新（`expectedRevision`）**：`CatalogService.detail` 兼容返回当前 `baselineHeads`（各 `exampleId + environmentKey` 的活动 `revisionId` 与 `screenshotId`）；`/assets` 确认或更新基线时自动携带对应 `expectedRevision`，打通已有基线的受控 CAS 更新。

### 3. 资产详情体验补齐（`/assets`）
- **历史与已废弃（`DEPRECATED`）版本列表**：新增 `GET /v1/publishing/components/:componentId/releases`，按 `catalog_can_read` 返回该逻辑组件下全部已就绪作业的 `Ready` 与 `DEPRECATED` 实现版本（含废弃原因），支持在 `/assets` 切换查看任意历史或已废弃版本。
- **分类筛选与列表分页**：`/assets` 增加分类下拉过滤与服务端分页控件，支持 URL `?q=` 搜索词同步。
- **隔离沙箱在线预览与材料查看**：`/assets` 右侧检查器按无障碍标签页组织，支持申请短期 `POST /v1/preview-grants` 在 `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer">` 中隔离预览（切换账号/版本或 401/403 时立即销毁）、受认证读取展示截图 Blob（自动释放 Object URL）、查看组件文档与结构化 API 参数/事件 Schema、查看 `CheckReportV1` 明细及完整 Tarball SHA-256 一键复制。
- **ECharts 兼容实测证据登记**：在 `/assets` 支持导入或粘贴 T10 探测证据 JSON 并提交 `POST /v1/variant-releases/:id/compatibility`。

## 执行与验证清单

- [x] 任务 1（RED → GREEN）：修复 `tests/admin/console-render.test.ts`、作业状态筛选与 `RETRY_WAIT` 重试、顶栏搜索、`/users` 分页与自助改密，提交独立聚焦 commit。
- [x] 任务 2（RED → GREEN）：更新 `@company/contracts` 并重生成 JSON Schema，新增迁移 `017`、组件可见性接口、`can_read` 授权同步与基线 `expectedRevision` 更新，补齐契约与服务单测，提交独立聚焦 commit。
- [x] 任务 3（RED → GREEN）：实现历史/废弃版本查询接口，补齐 `/assets` 分类分页、沙箱预览、截图/文档/API/报告查看与兼容实测证据提交，补齐单测与渲染测试，提交独立聚焦 commit。
- [x] 任务 4（验收与升版）：运行 `pnpm verify:workspace`、`pnpm --filter @company/contracts schemas:generate`、`pnpm build`、`pnpm typecheck`、`pnpm test`（及隔离端口 Playwright 浏览器测试），核对 `component-platform-architecture.md` SHA-256，记录验证报告，并独立提交语义化版本号升级与 `CHANGELOG.md`。
