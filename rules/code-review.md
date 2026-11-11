# 代码审查规则

按风险从高到低检查：

1. **服务端零执行与静态预览隔离**：`apps/api` 与 `apps/preview-gateway` 是否混入组件构建、执行上传代码、运行 npm 脚本或启动截图浏览器的逻辑；静态预览是否保证独立注册域名 origin、短期 `preview-grant` 鉴权、路径穿越拦截、CSP 与沙箱 `iframe` 隔离，预览代码是否可能获取平台凭证。
2. **产物可追溯与逐实现截图校验**：是否存在截图后重新 `pnpm pack`、用工作区内 `workspace:*` 链接或源码 alias 冒充工作区外真实 tarball 消费验收、一包多组件部分实现缺图放行、跨框架混用截图（如 Vue 截图算作 React），或允许网页端伪造 `'local-automatic'` 来源与 `'passed'` 兼容记录。
3. **三存储发布一致性与幂等恢复**：Verdaccio 发布超时、MinIO 上传中断、PostgreSQL 登记失败或多 worker 并发抢占同一任务时，是否正确通过租约、`fencing_token` 和 SHA-256 摘要核对进行幂等恢复；是否存在覆盖或删除已发布 npm 包与不可变对象的风险。
4. **双框架与 ECharts 生命周期安全**：Vue 3 与 React 19 组件在零尺寸/隐藏容器、`ResizeObserver`、React `StrictMode` 重复挂载、Vue `KeepAlive` 激活、系列删减（残留系列）、主题/渲染器切换重建及卸载 `dispose()` 时是否存在实例或监听泄漏，或模块顶层访问 DOM 破坏 SSR 安全导入。
5. **工作区边界、编译器与缓存规则**：是否违反 `scripts/verify-workspace.ts` 约束（未登记目录、循环依赖、外部依赖未锁精确版本、公开包依赖私有 `@company/contracts`、画廊直接导入 Nest 模块、服务端依赖图表/画廊包）；是否误将测试、截图、消费者安装或发布任务放入 Turbo 缓存；是否破坏 Nest TS `6.0.3`（decorator metadata）与根 TS `7.0.2` 编译器分层。
6. **测试真实性与验收诚实度**：测试是否先执行 `build:services` / `build` 并验证真实编译产物、真实 HTTP 响应与浏览器可见行为，而非只验证 mock 被调用；文档与状态报告是否诚实区分 `G0` 工程骨架通过与 `G1/G2` 及业务任务完成验收。
7. **敏感信息与基线文档保护**：日志、配置、测试 fixtures 和提交内容是否包含数据库密码、MinIO 密钥、Verdaccio Token、OIDC 凭据或本机隐私路径；原始架构文档 `component-platform-architecture.md` 的 SHA-256 是否保持未变。

审查结论先按严重程度列出明确问题，附文件和行号；没有发现问题时说明覆盖范围、实际运行的验证命令及未完成的后续验收门槛，不用格式性建议掩盖风险。
