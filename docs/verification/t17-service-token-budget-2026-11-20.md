# T17 隔离服务凭证覆盖完整矩阵预算（2026-11-20）

旧完整 33 格运行超过一小时后，N09–N13 收到真实 401，旧轮仍保留失败状态。检查隔离服务夹具发现其 API token 固定为 1h，而矩阵外层允许运行 2h；测试设施会在合法验收流程结束前使凭证过期。

修正只将 `tests/acceptance/t17-host/local-services.ts` 的本地临时签名 OIDC fixture 寿命改为有界 3h，覆盖两小时矩阵及准备、封存和清理余量。subject、roles、audience、原 API 鉴权、生产凭证策略和产品代码均未改变，也未刷新或修改旧运行的凭证/报告。新 owner 才使用新寿命。

## 真实 RED/GREEN

新增独立实跑入口：

```powershell
./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-host/local-services-token.vitest.config.ts')
```

提供 `A10_FROZEN_BUNDLE` 与工程外 `T17_TOKEN_BUDGET_EVIDENCE`。测试启动本轮 owner 三存储和真实 API，以返回的同一个 API token 完成 SDK 上传、发布与 READY，再从该 token 的签名 payload 读取寿命；不另造 token。始终 finally close，凭证仅在内存，落盘只有数值元数据。

- RED：03:39:00，1 failed、exit 1、25.65 秒；旧 1h 凭证只有约 3600 秒，低于 8100 秒要求。原数值 3604 包含准备前时间锚点，故仅用于证明旧寿命不足；随后按独立审查修正为 READY 后的实际当前时间。目录 `token-budget-red-8c1a829c6f624e1d88edde3227c6f897`。
- 初次 GREEN：改 3h 后 1/1、exit 0、23.87 秒。
- 最终 GREEN：采用 READY 后时间锚点，严格要求 `8100 <= remainingSeconds <= 10800`，03:43:31 为 1/1、exit 0、30.10 秒。真实 issuedLifetimeSeconds=10800、remainingSeconds=10782。目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/token-budget-final-91c33968ea6f4184a1982a2f4b609840` 保存原日志、退出码与 lifetime-observed.json。
- 根 tsc 与 diff check exit 0；独立只读审查无 Critical/Important，确认 token 不落盘、权限及 READY 流程不变。

这是隔离验收夹具修正，不是生产 OIDC 验收；正式 33 格仍须新 owner 从头实跑。CLI 0.0.21 与 SDK 原冻结字节保持不变。
