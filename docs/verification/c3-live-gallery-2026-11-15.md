# C3 / B3 真实页面与检索服务联调

日期：2026-11-15。B 构建页面与 C 服务使用各自 worktree，未 merge 或 push。

## 实际执行

1. B：固定工具链强制 build 10/10 成功，后续页面修订再次执行 Gallery build 成功。
2. B：`scripts/pnpm.ps1 exec playwright test --config tests/playwright.config.ts tests/browser/phase2-context.spec.ts tests/browser/phase2-search.spec.ts`，修订后 **28/28 通过**。该组使用显式 route fixtures，证明本地校验不发请求、显式搜索、编辑/退出/换身份取消、提交前及响应落地前会话复核和空态/错误展示；不冒充真实后端。
3. B：`scripts/pnpm.ps1 --filter @company/gallery preview`，监听本机 5173。
4. C：设置非敏感 `PHASE2_GALLERY_ORIGIN=http://127.0.0.1:5173`，执行 `scripts/pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/search-gallery.test.ts`，**1/1 通过**，8.74 秒。

第 4 项真实启动随机隔离 PostgreSQL/MinIO/Verdaccio，签名 JWT、上传合成双框架包、发布至 READY、消费索引后，用开发机 Chromium 打开 B 页面。3000 端口透明本地转发器仅转发至随机端口真实 API，保留 Origin/Authorization 和 API 原响应，未伪造候选。断言填写不发检索、点击后显示真实本轮包名的 Vue line 候选、响应包含元数据降级提示；随后禁用 alice，再次查询显示登录失效且候选清空。

截图 `test-results/c3-live-gallery.png` 已人工查看：表单、单独搜索区、候选身份/证据/来源与缺口可见；截图为本地临时证据，不提交 test-results。预览进程和临时代理已关闭，隔离栈由 harness 清理。

## 边界

全部组件输入为合成协议 fixture；本测试不证明真实 SDK 视觉表现或公司生产 OIDC。浏览器在开发机测试进程执行，API 运行时无 Playwright/组件代码依赖。默认 platform 命令跳过此需 B 预览服务的专项入口，本次显式设置环境后实跑通过。没有真实设计稿、多模态模型和真实标注集，T13/T14 保持未完整验收。
