# 内网管理端功能闭环补齐验证记录

计划：`docs/plans/2026-11-26-admin-feature-completion.md`  
分支：`feat/admin-complete-features`（基于 `main` `17b3a114` 创建）  
日期：2026-11-27（Asia/Shanghai）

## 1. 基线与核心约束核查

- **原始架构文档字节保护**：`component-platform-architecture.md` SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723` 不变。
- **工作区与依赖边界**：保持 11 个固定成员、零新增外部依赖；`@company/platform-api` 与 `@company/preview-gateway` 依赖闭包仅包含自身与 `@company/contracts`；服务端零构建、零组件代码执行、零无头浏览器启动。
- **公网与内网入口隔离**：新增管理接口 `POST /v1/publishing/components/:id/visibility` 与 `GET /v1/publishing/components/:id/releases` 挂载于既有内网门控前缀 `/v1/publishing/...`，经 `tests/infra/gallery-admin-ingress.test.ts` 静态审计与真实 Docker Nginx 双容器代理验证，公网非可信来源访问一律拒绝（`403`），内网可信来源正常放行。

## 2. 实施内容与 TDD 轨迹

1. **阻塞门禁与既有交互缺陷修复**
   - 先运行 `tests/admin` 复现基线 6 项失败，并补充 `tests/unit/release-list.test.ts` 与 `tests/admin/console-render.test.ts` 的 RED 断言（5 项预期失败）。
   - 修复 `ReleaseService.list` 与 `/jobs` 状态过滤枚举对齐 `RELEASE_STATES`（替换错误的 `RUNNING` 为 `PUBLISHING` 等完整状态）；`/jobs/[jobId]` 仅在 `RETRY_WAIT` 渲染重试按钮，在 `READY` 展示 `baselineCandidates` 与跳转 `/assets` 入口；`/users` 接入服务端分页、空结果兼容、不确定密码状态（`uncertain`）锁定提示；`ZnShell` 顶栏快速搜索支持 UUID 直达 `/jobs/[jobId]` 与关键词跳转 `/assets?q=`，并新增原生 `<dialog>` 自助修改密码（`POST /identity/password`）；补齐 `globals.css` 缺失类名与模态滚动隔离，转 GREEN。
2. **核心权限与资产运维闭环**
   - 补充 `tests/contracts/{managed-accounts,categories,api-schema}.test.ts` 与 `tests/unit/admin-governance.test.ts` 的 6 项 RED 用例。
   - 新增向前迁移 `017_managed_account_read_grants.sql` 扩展 `managed_account_component_grants.can_read`，保持“先本地收紧撤权、远端确认后再扩展授权”顺序同步至 `component_permissions`；`CategoryService` 新增受管理员或 `maintainer + can_maintain` 保护的 `updateComponentVisibility`（写 `COMPONENT_VISIBILITY_UPDATED` 审计）与按 `catalog_can_read` 校验的 `componentReleaseHistory`；`CatalogService.detail` 仅在受认证 `/v1/me/...` 路径附加 `isPublic`、`deprecatedReason` 与 `baselineHeads`（公开匿名路径不泄漏内部修订）；重生成契约 JSON Schema 并同步 CLI 内联契约，转 GREEN。
3. **资产详情体验补齐（`/assets`）**
   - 新增 `tests/admin/assets-client.test.ts` 与 `/assets` 检查器渲染 RED 用例（3 项预期失败）。
   - 补齐分类过滤、列表分页、历史与 `DEPRECATED` 版本切换器、组件公开/私有可见性切换、自动携带 `expectedRevision` 的视觉基线二次更新、完整 Tarball SHA-256 复制、严格校验独立源 HTTPS 的 `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer">` 在线预览、受保护截图 Blob 读取与自动释放、组件文档与结构化 `ComponentApiV1` 参数/事件表、`CheckReportV1` 检查报告明细以及 `a-t10-sdk-probe` ECharts 兼容实测证据导入提交，转 GREEN。

## 3. 实际执行的验证命令与结果

固定使用 `.tools/node-v26.13.0-win-x64`（Node `v26.13.0`）与 `pnpm 12.18.0`，浏览器缓存指向系统已安装的 `C:/Users/10208/AppData/Local/ms-playwright`：

| 验证命令 | 结果 |
| --- | --- |
| `pnpm verify:workspace` | 通过（11 个成员、无循环依赖、安全服务闭包有效） |
| `pnpm --filter @company/contracts schemas:generate` | 通过（JSON Schema 与运行时契约零漂移） |
| `pnpm exec turbo run build --force` | 11/11 包全部真实构建通过（0 缓存命中） |
| `pnpm exec turbo run typecheck --force` 与 `pnpm typecheck` | 15/15 任务 + 根 `tsconfig.json` + `tests/admin/tsconfig.json` 零错误通过 |
| `pnpm test:t10` | 通过 |
| `pnpm exec vitest run tests/contracts tests/admin tests/unit tests/infra` | 87/87 文件通过，1224/1224 用例通过（含 Docker Nginx 真实双入口代理验证） |
| `pnpm exec vitest run tests/gallery tests/integration` | 55/55 文件通过，1049/1049 用例通过 |
| `pnpm exec vitest run tests/acceptance tests/evaluation` | 34/34 文件通过，414 通过、2 既有跳过（全仓共 176 个 Vitest 文件 2687 通过、0 失败） |
| `pnpm exec playwright test --config tests/browser/categories.config.ts` | 16/16 通过（9.7s，真实 `next start` 生产产物运行，覆盖可见性切换、基线 `expectedRevision` 更新、沙箱预览、`canRead` 只读授权、分类 CAS 与 401/403 会话清理） |

## 4. 未覆盖边界与诚实说明

- 本机 `5173` 端口存在用户运行中的服务进程，按规则不擅自终止用户进程，因此未直接运行占用 `5173–5177` 五端口的根 `pnpm test:browser`，改为通过仓库专用的隔离端口配置 `tests/browser/categories.config.ts`（端口 `5278`）对 `@company/admin` 生产构建产物执行完整 Playwright 浏览器验证。
- 本轮未启动共享 PostgreSQL / MinIO / Verdaccio 基础设施栈运行 `pnpm test:platform`（迁移 `017_managed_account_read_grants.sql` 与服务 SQL 已通过契约测试、服务编译产物单测验证；真实数据库迁移与三存储端到端持久化仍需在连接 PostgreSQL 栈后按 `pnpm test:platform` 独立验收）。
- 正式生产环境 OIDC / TLS / VPN 网络边界仍按 G2 与上线门禁独立记账，不由本机测试替代。
