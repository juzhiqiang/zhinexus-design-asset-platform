# T17 独立矩阵 N10 请求夹具修正（2026-11-20）

0.0.21 完整产品入口实际执行 2975.21 秒、exit 1。正向 20/20（Vue 10/10、React 10/10），强制拒绝 12/13，矩阵结论为不通过。唯一执行错误为 N10：创建 N10 专用工程之前，MatchPlan 请求为同一 Vue 设计键 `matrix/line` 发送了三个相同映射，真实 API 返回 HTTP 400。由此轮结果无法判断产品是否正确停止在两轮预算。V10/R10 分别保留实际 DIFF、一次修复、最终通过的历史证据。

修正仅在独立验收夹具。`buildMatchPlan` 按 designId 和 framework 去重相同目标，为三个实例保留三份元素、绑定与实例 API；同一设计键出现不同目标时，在发送请求前失败。产品、服务、契约、预期状态和修复预算未改动。

| 验证 | 实际结果 |
| --- | --- |
| `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/acceptance/t17-matrix/platform.test.ts')` | 修正前 2 条预期断言失败，修正后 2/2 |
| `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-matrix/vitest.config.ts')` | 13 文件 187/187，18.57 秒 |
| 根 tsc 与 `git diff --check` | exit 0 |

历史矩阵证据见 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/matrix-0.0.21-failed-a739be92b7af922351a731ad17bad851/`。归档逐字节保留 57 个证据根中的 22739 个文件和清单；57 个对应临时父目录已复查移除。根 seal SHA-256 为 `4ce1ae4e14e749037ab21ae455392ff53d1421b7e626274e25c47064df7db04c`，归档映射 SHA-256 为 `74e6d337ec08b49885763fbc03b870c31770a5c49a35769ba2dcc1245aa79d89`。复评分结论仍为 20/20、12/13、未通过。临时父目录的依赖文件可由 seal 清单辨识，归档范围为证据根原件。

以上支架测试不能抵充完整产品矩阵。N10 诊断与 0.0.22 全量结果另立记录。
