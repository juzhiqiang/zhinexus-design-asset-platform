# 代码审查规则

按风险从高到低检查：

1. **服务端执行边界与预览隔离**：`apps/api` 与 `apps/preview-gateway` 是否混入了组件构建、动态执行上传代码、运行 npm 脚本或启动截图浏览器的逻辑；静态预览是否保证了独立域名 origin、短期授权校验、路径穿越防护与沙箱 `iframe` 隔离，预览脚本是否可能获取平台 Token。
2. **产物可追溯与逐实现截图校验**：是否存在截图后重新 `pack`、用工作区内 `workspace:*` 链接或源码 alias 冒充工作区外真实 tarball 消费验收、一包多组件部分实现缺图被放行、将 Vue 截图混用给 React 实现，或允许客户端伪造 `cli-auto` 检查来源。
3. **三存储发布一致性与幂等恢复**：Verdaccio 发布超时、MinIO 上传中断、PostgreSQL 登记失败或多 worker 竞争同一任务时，是否正确通过租约、fencing token 与 SHA-256 摘要核对进行幂等恢复；是否存在覆盖/删除已发布 npm 包或不可变对象的风险。
4. **双框架与 ECharts 生命周期安全**：Vue 3 与 React 19 组件在零尺寸/隐藏容器、`ResizeObserver`、React `StrictMode` 重复执行、Vue `KeepAlive` 激活恢复、系列删减（残留系列）、主题/渲染器切换重建及卸载 `dispose()` 时是否存在内存/实例泄漏，或存在模块顶层访问 DOM 破坏 SSR 安全导入的问题。
5. **工作区依赖、编译器与 Turbo 缓存边界**：是否违反 `scripts/verify-workspace.ts` 约束（未登记目录、循环依赖、外部依赖未锁精确版本、公开包依赖私有 `@company/contracts`、前端直接导入 Nest 模块、服务端依赖图表/画廊包）；是否误将测试、截图、消费者安装或发布操作放入 Turbo 缓存；是否破坏了 Nest TS 6.0.3（含 decorator metadata）与根 TS 7.0.2 的编译器配置。
6. **测试真实性与验收诚实度**：测试是否先执行 `build:services` / `build` 并验证真实编译产物、真实 HTTP 响应与浏览器可见渲染，而非只断言 mock 被调用；文档或状态汇报是否诚实区分“工程骨架 G0 / stub 已就绪”与“G1/G2 及业务任务已完成验收”。
7. **敏感信息与基线文档保护**：代码、配置、测试日志或提交内容是否包含 PostgreSQL / MinIO / Verdaccio / OIDC 密钥、Token 或本机隐私路径；原始架构文档 `component-platform-architecture.md` 是否保持字节级未修改。

审查结论先按严重程度（`Critical` / `Important` / `Minor`）列出明确问题，附文件路径和行号；没有发现问题时说明实际审查的提交/文件范围、已运行的验证命令，以及尚未覆盖的后续验收门槛，不用格式性建议掩盖架构与一致性风险。
