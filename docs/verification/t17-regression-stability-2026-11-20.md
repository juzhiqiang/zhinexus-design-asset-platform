# T17 完整回归中的测试稳定性修正（2026-11-20）

冻结 CLI 0.0.20 的首次完整根 `test` 实得 Vitest 2123 passed / 3 failed，120 文件，exit 1、727.53 秒。原始结果保留在仓外 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/full-test-0.0.20-03f61ce2b451435db4756dd1fc50767d`，不改写为通过。

两项失败是测试外层总预算不足：Vue npm inspect 运行真实子进程，原默认 5 秒；双框架独立基线负例包含两次各 2 秒的预期失败及真实浏览器启动，原总预算同样只有 5 秒。分别明确为 30 秒和 20 秒；内部失败期限、操作与断言不变。

第三项为浏览器断言采样：最后一次 locator 读取超时前，轮询错误地清空了已经完成的上一份观测。移除该清空操作，保留最后完成采样；最新读取异常仍使断言失败并保留 detail，不把超时转为通过。相关完整矩阵支架先观察到 128 passed / 1 failed，修正后 129/129。

集成方于 2026-11-20 03:00 执行：

```powershell
./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/acceptance/t17-host/consumer.test.ts','tests/acceptance/t17-host/chain.test.ts','tests/acceptance/t17-host/host.test.ts','tests/acceptance/t17-host/baseline-reference.test.ts','tests/acceptance/t17-matrix/browser.test.ts','tests/integration/project-plan-consumer.test.ts')
```

实际 6 文件、117/117，exit 0、45.58 秒。该结果只证明窄范围回归；完整根 `test` 仍须在验收代码稳定后重新执行。本次仅修改测试，不变更冻结产品或重新打包。
