# C 平台验收补充记录（2026-11-16）

本轮由用户授权 Codex C、Antigravity A、Claude 桌面端 B、Claude Code D 分工执行。C 在 `feat/t13-c-matching`（基线 `c273f1e5`）复验既有 T05/T06/T07 平台实现，不重写历史验收记录。

## 实际环境与命令

全部工作区命令经 `.\scripts\pnpm.ps1` 执行，使用本机 `.tools` 的 Node 26.13.0、pnpm 12.18.0 和本地 Playwright。下表省略脚本前缀；日志位于忽略目录 `.tools/`，不提交服务凭据或环境文件。

| 命令 | 实际结果 | 本机日志 |
| --- | --- | --- |
| `verify:workspace` | exit 0；10 成员、无循环、4 公开包、服务端依赖闭包安全 | 命令输出 |
| `exec turbo run build typecheck --filter=@company/platform-api --filter=@company/preview-gateway --force` | exit 0；5/5 任务实际执行、0 缓存；3.649s | `c-platform-build-20261116.log` |
| 下述隔离平台测试命令 | exit 0；13 文件、57 测试；58.01s | `c-platform-acceptance-20261116.log` |
| `test` | exit 0；Vitest 62 文件、1041 测试通过；226.43s。前置 T10 Node 测试 159 通过、7 跳过、0 失败 | `c-root-regression-20261116.log` |
| `exec tsx scripts/production-preflight.ts --environment` | exit 2；部署模板检查通过，运行环境缺少 27 个必需变量；`productionAcceptance: false` | `c-preflight-20261116.log` |
| `infra:check-access` | 检查脚本 exit 2（pnpm 对外 exit 1）；OIDC 和 preview 均 `unconfigured`，`g2Ready: false` | `.tools/g2-local/access-result.json` |

平台测试实际命令：

```powershell
.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/uploads.test.ts tests/platform/releases.test.ts tests/platform/release-concurrency.test.ts tests/platform/release-recovery.test.ts tests/platform/release-tags.test.ts tests/platform/registry-references.test.ts tests/platform/dependency-order.test.ts tests/platform/catalog.test.ts tests/platform/catalog-identity.test.ts tests/platform/catalog-reports.test.ts tests/platform/preview.test.ts tests/platform/preview-browser.test.ts tests/platform/web-handover.test.ts
```

该套件通过 `createRecoveryStack()` 启动临时隔离的真实 PostgreSQL、MinIO、Verdaccio，HTTP/预览测试使用本地签名身份测试工具；读取 Nest `dist` 构建产物。栈标识 `4a9b57a0-9499-4d8a-a769-6e0427eb242a`，启动日志明确 `productionAcceptance: false`。测试结束执行隔离栈清理，不借用共享 G2 实例。

覆盖上传与逐实现截图拒绝、发布状态机/并发租约与中断恢复、不可变包摘要核对、依赖发布顺序、目录身份和报告可信度、预览授权与浏览器隔离、网页交接。根测试同时覆盖现有契约、身份校验和组件/CLI 单元及集成测试。

## 跳过与外部边界

- 根测试的 7 项跳过来自 T10 `A10_FROZEN_BUNDLE` 未配置，涵盖候选 peer 冲突、跨版本方向、双框架覆盖不足、四维未执行/视觉差异及精确基线采用判据。没有用合成 bundle 冒充真实冻结升级证据。
- Node 输出 `DEP0190` 子进程 shell 参数弃用告警；本轮测试未因此失败。本次没有更改这些调用点。
- 公司 OIDC 登录/撤权、独立预览注册域名 DNS/TLS 与目标浏览器策略尚未接入，完整 T05/T07/G2 保持未完成。
- 生产镜像/最小权限凭据、监控投递、生产规模备份/容量和 Vue/React 真实业务试点仍需实际环境验证。隔离测试不能替代生产验收。
- 根工作树本轮不包含 A/B/D 尚在独立分支的新增修改，1041 项结果只对应 C 基线；后续集成需在合并后另行验证。
- A/B 浏览器和外部消费者验证由 C 分配端口串行执行，其结果在各自新增记录中保存。

## 保护与交付

本轮 C 未改动平台实现、公用契约或包版本；纯验证文档不触发版本升级。原架构文件 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。未执行合并或 push；各方产物由独立分支交付，最终状态见本轮四方协作计划。
