# Turbo 初始化验证

验证日期：2026-11-11；Windows x64，Node 26.13.0 / pnpm 12.18.0 / Turbo 2.11.10。仅使用本地缓存。

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| 完整 build/typecheck dry run | 10 包、20 任务；框架依赖 core；示例依赖对应框架；平台依赖 contracts | turbo-full-graph.json（仅保留任务字段） |
| 服务白名单 dry run | 5 任务：contracts build，API 和网关各 build/typecheck | turbo-services-graph.json |
| 第一次全量构建 | 10/10 成功，0 缓存 | 本次执行记录 |
| 不修改输入再次 build | 10/10 命中 | build-repeat.log |
| core 源文件追加临时注释后 build | core、两框架、两示例共 5 项失效；contracts、CLI、gallery、两服务共 5 项命中 | build-core-change.log |
| 字节级恢复 core 后 build | 10/10 再次命中 | build-restored.log |
| build:services | 5/5 成功，未调度图表/示例 | 本次执行记录 |
| dev | 10 个持久任务以 concurrency=12 启动；5 个 HTTP 入口返回 200；本机首次 Ctrl+C 停在 shutting down，第二次结束子任务 | 本次执行记录 |

可重新运行（根目录，以下 `pnpm` 在本机可替换为 `.\scripts\pnpm.ps1`）：

```text
pnpm exec turbo run build typecheck --dry=json
pnpm exec turbo run build typecheck --filter=@company/platform-api --filter=@company/preview-gateway --dry=json
pnpm build
pnpm build
```

缓存失效实验应在没有其他构建/编辑操作时进行，保存源码原始字节，临时修改 core，再构建，最后通过 finally 恢复并构建。不要提交探针注释。

根 package.json/lockfile 与 Turbo 默认输入共同跟踪版本；全局输入另含 .node-version、workspace 与共享 TS 配置。原计划提及的 versions.lock.json 不重复维护，实际精确依赖以 package.json/pnpm-lock.yaml 为准。版本发现记录只用于审计，不触发无意义的全图失效。

基础测试与浏览器测试直接调用 Vitest/Playwright，没有进入 Turbo 缓存。正式 tarball 消费、截图、基线接受和发布尚未实现；连续两次实际执行的发布验证证据属于 T04 后续验收，不能从本表推断已完成。
