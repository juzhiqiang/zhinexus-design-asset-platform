# T17 完整回归的测试外层预算（2026-11-20）

CLI 0.0.21 首次完整根 `test` 实际失败，不能记为全绿：T10 为 168/168、零跳过；Vitest 为 121 文件、2183 passed / 4 failed、814.18 秒、exit 1。原日志位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/full-test-0.0.21-d37d6fbd53304ef18b991576cb4819a8/test.log`。四项均为外层默认 5000ms 超时：两个真实 Git 子模块 fixture、MCP 取消进程树、首次动态加载 ECharts 的 Vue 生命周期测试。没有行为断言失败。

未改代码先运行三个失败文件：

```powershell
./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-inspect.test.ts','tests/integration/project-mcp.test.ts','tests/unit/sdk-lifecycle.test.ts')
```

03:35:09 实际 105/105、exit 0、58.93 秒。结合首次日志中的 5452ms / 5944ms / 5016ms / 8460ms，以及 MCP 本身包含两段最长 10 秒条件等待和 2.3 秒哨兵观察，确认默认外层预算无法覆盖合法完整流程。

最小修正仅给上述四个 it 增加第三参数：Git 两项各 30 秒、MCP 45 秒、首次 ECharts 导入 15 秒。全局默认和其它用例未改；原内部超时、AbortController、进程终止检查、哨兵观察、nextTick 与所有断言保持原样。独立只读 diff 审查无 Critical/Important。

修正后同一三文件命令 03:41:03 为 105/105、exit 0、46.60 秒；根 tsc 与 diff check exit 0。新的完整根 test 已另立外置目录执行，必须依据其最终完整输出报告结果，窄测不能代替。该修正只涉及测试，不改变 CLI 或冻结 tarball。
