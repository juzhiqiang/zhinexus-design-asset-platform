# C3 PostgreSQL 文本检索与鉴权 HTTP 验证

本批交付 metadata-text-v1 发布元数据索引、独立 outbox 消费/失败重试/指定作业重建、鉴权候选接口；不执行上传代码，不提供语义/用途/视觉评分，不宣称 T13/T14 完成。

## 实际 RED / GREEN

- `scripts/pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/search.test.ts`：首次因缺 dist/index/search-indexer.js 失败。
- 首次服务构建发现空 hostPeers 对象的联合类型不能赋给 Record<string,string>；显式标注后构建通过。
- 首轮真实平台测试中权限测试引用不存在的 visibility 列；按实际 components.public 修正，保留权限断言。
- 追加失败索引原子回滚/恢复、精确 React DOM、旧摘要接受记录拒绝及最终批次撤权测试。
- `scripts/pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/search.test.ts tests/platform/database.test.ts`：2 文件 6 项通过；真实随机隔离 PostgreSQL、MinIO、Verdaccio、签名 JWT 和 HTTP，输入为明确的合成发布 fixture。
- `scripts/pnpm.ps1 test` 首轮：node:test 159 通过/7 跳过；Vitest 827 通过/2 失败，均因部署测试夹具遗漏新迁移。夹具改为统一 migration 清单，新增缺 search-runner 部署入口拒绝断言，确认 RED 后实现；相关 staging+eligibility 44 项通过。
- 最终重跑 `scripts/pnpm.ps1 test`：50 文件、829 项 Vitest 全通过；node:test 159 通过、7 跳过、0 失败。
- `scripts/pnpm.ps1 exec turbo run build --force`：10/10 任务、0 缓存成功。
- `scripts/pnpm.ps1 exec turbo run typecheck --force`：14/14 任务、0 缓存成功；根 tsc 退出 0。
- `scripts/pnpm.ps1 verify:workspace`：10 成员、无循环与服务依赖边界通过。

## 审查及边界

A 在 627f9dd9 提交只读审查，无阻断项。最终候选批次通过单条 SQL 共享当前快照，拒绝在检索与最终读取间提交的撤权；不能撤回最终读取之后已发送的响应。最多检查前 50 文本命中，达到上限时 response.gaps 明示可能不完整。没有大规模语料性能或生产公司 OIDC 验收。

`tests/platform/search-gallery.test.ts` 是独立的本机浏览器真实联调入口，仅在设置 PHASE2_GALLERY_ORIGIN 时执行；普通平台测试默认跳过，浏览器真实结果另行记录，不能把此跳过记为成功。
