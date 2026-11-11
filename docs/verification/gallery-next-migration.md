# Gallery Next 迁移验证

日期：2026-11-11（Asia/Shanghai）

本记录覆盖画廊宿主从 React + Vite 迁移到 React 19.3.1 + Next.js 16.4.6 App Router 的公开/私有渲染边界。原始架构文档 `component-platform-architecture.md` 未修改；T05 OIDC、T07 真实目录/详情/预览和 G2 基础设施仍未完成。

## 实施范围

- `apps/gallery` 使用 `next build`、`next dev` 和 `next start`，端口仍为 `5173`，Next 输出目录固定为 `dist/`。
- `(public)` 路由提供首页和目录空状态；公开正文与 metadata 在初始 HTML 中可见。
- `(console)` 路由提供上传占位，并使用 `robots: noindex, nofollow`；当前没有伪造登录或授权。
- `/components/[slug]` 在真实公开目录契约和 Ready 资产接入前返回 404，避免伪造组件资料。
- sitemap 只由 `NEXT_PUBLIC_SITE_URL` 生成正式公开 URL；未配置时为空，不写入 localhost。
- Turbo 的 gallery 专用 `build` 任务传入 `NEXT_PUBLIC_SITE_URL`，暂时关闭该任务的 Turbo 输出缓存，避免恢复 Next 输出时保留旧运行时 route-cache；其他包的缓存不变。

## RED → GREEN

旧 Vite 构建先运行浏览器测试：公开正文不在初始 HTML，`/upload` 无 noindex，未知详情回退为 200；4 个画廊断言失败，Vue/React 示例 2 个断言通过。

迁移后运行：

```powershell
.\scripts\pnpm.ps1 --filter @company/gallery typecheck
$env:NEXT_PUBLIC_SITE_URL = 'https://gallery.test'
.\scripts\pnpm.ps1 --filter @company/gallery build
.\scripts\pnpm.ps1 exec playwright test tests/browser/bootstrap.spec.ts tests/browser/gallery-rendering.spec.ts --config tests/playwright.config.ts
```

结果：类型检查通过；Next build 生成静态 `/`、`/components`、`/upload`、`/robots.txt`、`/sitemap.xml`，动态 `/components/[slug]`；浏览器 6/6 通过。

## 工作区验证

```powershell
.\scripts\pnpm.ps1 verify:workspace
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 test
.\scripts\pnpm.ps1 test:browser
```

结果：工作区 10 成员、无循环依赖、安全服务图；全量 build 10/10；typecheck 14/14；Vitest 5/5；浏览器 6/6。构建输出中 React example 有一个约 504 KB 的 chunk 体积警告；构建成功且该包不在本次变更范围内。

## 未覆盖边界

- 没有真实目录 API、公开 DTO、Ready 资产、OIDC session 或角色授权，因此不能宣称 T05/T07/G2 完成。
- 私有详情字段的运行时权限和缓存策略将在 T05/T07 契约冻结后实现；本次只固定 Next 路由、metadata、sitemap 与 SSR 边界。
- 未配置正式域名、TLS、部署运行时或生产抓取验证；`NEXT_PUBLIC_SITE_URL` 只作为部署配置输入预留。

## 收尾复验与独立审查

首次统一验证发现浏览器断言写死测试域名：未设置 origin 的构建按设计输出空 sitemap，断言却要求 `gallery.test`。现已按构建和测试共享的 `NEXT_PUBLIC_SITE_URL` 检查实际 URL；未设置时断言没有 `<loc>`。`verify.ps1` 只在缺少 origin 时临时使用测试域名，并在 finally 恢复调用者值。

另以真实 build/start/HTTP 复现 A→B→A 域名切换：第三次恢复 Turbo 输出缓存时，生成的 app sitemap 是 A，但 `dist/server/route-cache` 残留 B，HTTP 返回 B。仅将 origin 纳入 task/global env 无法修复。永久回归脚本 `scripts/verify-gallery-cache.mjs` 先观察到此失败，再以 gallery 专用 `cache: false` 修复后验证 A、B、A 和未设置 origin 四轮通过。其他包仍使用缓存；代价是 gallery 每次重建，待干净恢复机制经验证后再恢复缓存。

最终验证针对 `HEAD 856379c` 加本次迁移文件的独立副本执行，排除了同期另一任务的 chart-core/Vue harness 改动：

```powershell
$env:NEXT_PUBLIC_SITE_URL = 'https://gallery.custom.test'
.\scripts\verify.ps1
if ($env:NEXT_PUBLIC_SITE_URL -ne 'https://gallery.custom.test') { throw 'Site URL was not restored' }
```

结果：退出码 0；frozen install、10 成员依赖边界、全量 build 10/10、typecheck 14/14、Vitest 5/5、浏览器 6/6、服务构建通过，自定义 origin 保留。全量 build 为 0 缓存命中。React 示例的约 504 KB chunk 警告和 Playwright 颜色环境提示不影响退出码。

清除测试进程的 origin 后，在同一独立副本执行 `.\scripts\pnpm.ps1 exec node scripts/verify-gallery-cache.mjs` 与 `.\scripts\pnpm.ps1 test:browser`：A→B→A→unset 的 HTTP sitemap 校验全部通过，浏览器 6/6 通过，验证未配置域名的普通构建路径。

共享工作区最新统一验证曾因另一任务在 `examples/vue/package.json` 新增 `@company/charts-core` 而锁文件未同步，在 frozen install 阶段失败；其新增 `removes_series_without_ghosts`、`does_not_initialize_zero_size` 也曾因当时产物未含 harness 而超时。没有修改或提交这些任务文件，不能据独立副本结果声称共享工作区的其他在途任务已通过。

原始架构文件与 HEAD 按原始字节计算的 SHA-256 均为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。暂存版本排除分工文档原有的空格修改，该修改保留在工作区。

独立只读审查确认了以上缓存与环境配置问题；修复由真实回归和完整套件验证。采用的边界决定：robots 保持可抓取以便读取 noindex；sitemap 仅列公开 URL；保留旧初始化记录另增本迁移记录；OIDC、角色与用户态缓存、公开 DTO/Ready 判定、部署/TLS/搜索效果仍属 T05/T07/G2，当前无敏感数据且不能作为已认证生产平台。审查建议的原始 HTML metadata 断言与 robots.txt 专项覆盖留待补充，目前正文检查读取原始响应，metadata 检查浏览器 DOM。

### 并行任务完成后的共享工作区复验

T02 提交到 `7a72ae1` 后，重新运行 `.\scripts\verify.ps1`：退出码 0，冻结安装与 10 成员边界检查通过，build 10/10、typecheck 14/14、Vitest 17/17、Playwright 10/10、服务构建通过。此前另一任务的安装与 harness 暂态失败已随该任务完成消失；本次不修改其代码。最终锁文件同时保留已提交 Vue harness 对 charts-core 的 workspace 引用，避免提交后锁文件与现有清单不一致。

最终回归脚本另以 `NEXT_PUBLIC_SITE_URL=https://gallery.custom.test/` 运行，A→B→A→自定义 origin 四轮通过，确认配置末尾斜杠也能正常验证。
