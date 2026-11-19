# T17 隔离注册表冷下载超时补充

2026-11-20 的完整矩阵新包首格 V01 在 materialization 阶段遇到 npm `ECONNRESET / aborted`。保留该失败，不以基础设施修正改写原矩阵结果。

- T16 的隔离 YAML 已在前次设为 5 分钟；T17 `local-services.ts` 另外生成内联配置，遗漏了此配置，实际仍为 Verdaccio 默认的 30 秒。
- 从当前 owner `1bae60b0-dc24-4c1f-88cb-21ea9af6121a` 的真实容器日志提取非敏感字段：`echarts-6.1.0.tgz`、`ETIMEDOUT`、`requestTimeoutMs=30000`、`totalMs=30003`。精简原始证据在 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/t17-registry-timeout-30s-observed.json`。
- 只对新建 T17 隔离服务的 npm upstream 设置 `timeout: 5m`，保留单 registry、私有 `@company/*` 权限和禁止覆盖/删除等规则；不修改现有运行中的服务、共享/生产配置、CLI 产品或冻结 tarball。
- 新结构回归 RED 1 failed（实际 timeout 为 undefined）；最小修改后完整 `exec vitest run tests/acceptance/t17-host/local-services.test.ts` 为 7/7、exit 0、1.60 秒。同时核对私有 SDK 无 proxy、发布 ACL 与公共上游来源。

新的真实运行须重新创建 owner 环境；当前轮的失败不变更为通过。最终矩阵分母、动作和期望保持不变，是否达到门槛按完整封存结果判断。
