# C：CLI 发布集成测试的自有三存储隔离

日期：2026-11-13。负责人：C。分支：`fix/c-sdk14-acceptance`，前置提交 `d4b87a9`。

本轮只修改 C 分支的 `tests/integration/cli-release.test.ts`。B 的工作区、CLI 产品代码与共享三存储未修改；未初始化或轮换共享 `.tools/g2-local/credentials.json`，未合并、push 或改写历史证据。

## 已复现问题与局部修复

根 `test` 实跑先完成服务构建，随后 599 项通过、1 项失败（108.89 秒）。唯一失败是该 CLI 发布集成测试无参数调用共享 `platformHarness()`，因本机共享凭据缺失而在准备阶段失败。此 RED 记录保留于 [SDK 0.0.10 原生验证](c-a-sdk0010-windows-2026-11-13.md)，不回写为成功。

测试现用随机命名、带所有权标签、随机回环端口的 `createRecoveryStack()`，将同一组连接显式传给 API harness、MinIO、worker、Registry 鉴权及 npm 消费者。消除固定 `14873` 端口依赖；隔离数据库精确断言 14 个 Ready 实现与 3 个 Ready 包，原 status/resume 验证保持同一 job 和幂等键。

工作区外消费者经固定 Node 自带的 `npm-cli.js` 安装精确 Vue 包，使用 `shell:false`、`--ignore-scripts` 与 120 秒超时，再真实导入全部七个 Vue 子路径。这里不冒充 React 专项：双框架精确消费已有上述 SDK 独立证据。

清理覆盖启动、创建 harness、生成 bundle 和安装失败：嵌套 `finally` 关闭自有 harness/RecoveryStack；临时消费者与 bundle 只允许位于系统临时目录直属、匹配本次创建的前缀。已按这些路径逐项只读审查，未发现阻断。

## 本次实际命令与结果

全部通过项目 `.\scripts\pnpm.ps1` wrapper 使用固定 Node `26.13.0`、pnpm `12.18.0`。

| 命令 | 实际结果 |
| --- | --- |
| `exec vitest run tests/integration/cli-release.test.ts` | 1 文件、1 项通过，48.71 秒；真实隔离三存储发布、状态查询、恢复与 Registry 安装 |
| `test` | 服务前置构建完成；33 文件、600 项全部通过，127.00 秒；测试实际执行，未进入 Turbo 缓存 |
| `exec tsc --project tsconfig.json --noEmit` | 退出 0 |
| `git diff --check` | 退出 0 |
| `docker ps --filter label=org.zhinexus.recovery --format '{{.Names}}'` | 专项结束后无自有恢复容器残留 |

服务构建在第二次根 test 使用本地 Turbo 缓存（5 项命中），不把缓存当新增构建证据。根 test、CLI 构建/冻结/截图/安装/发布等副作用任务仍实际运行。过程中依赖的既有子进程路径输出 `DEP0190`（`shell:true`）弃用警告，本次消费者调用已移除该选项，未声称所有旧调用已修复。

本次为测试基础设施修复，不改变对外产品行为，无需产品升版。公司 OIDC、生产独立域/TLS、真实业务试点、完整 G2/M2/T10/T11/T12 继续开放；根 600 项通过不替代这些验收。

原架构 SHA-256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，字节未变。
