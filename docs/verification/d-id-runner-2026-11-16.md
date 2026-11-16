# D 确定性 ID Runner 补充验证

日期：2026-11-16；分支 `feat/t13-d-eval-pipeline`，基线 `e4c86581`。Claude Code 实际生成实现和测试，C 宿主落盘、修正并执行固定 Windows 工具链。Claude Code 工具调用两次发生解析失败后，使用同一客户端文本输出模式；未变更其模型或权限配置。

## 范围

新增 runner-id 函数、CLI、专属测试和观测样例；design-cases 改成明确 synthetic 的 ID 标注数组。复用 A 的 id-matching 评分器，没有修改 `id-matching.ts` 或 `id-matching-*.test.ts`。旧评分工具保留。工具使用和缺口状态见 [ID 评估规范](../phase2/id-evaluation-runner.md)。C 同步 README 入口；没有新增公共包或外部依赖，内部评估工具不触发包版本升级。

## RED / GREEN 实际证据

下列命令均通过 `.\scripts\pnpm.ps1`（Node 26.13.0 / pnpm 12.18.0）执行。日志在忽略的 `.tools/`。

| 命令或阶段 | 结果 | 日志 |
| --- | --- | --- |
| `exec vitest run tests/evaluation/runner-id.test.ts` RED | 入口缺失导致失败 | `d-id-runner-red-20261116.log` |
| 首次函数 GREEN | 15 通过/1 失败，暴露缺失观测未拒绝；补校验后 16/16 | `d-id-runner-green-attempt-20261116.log` / `d-id-runner-green-20261116.log` |
| `exec vitest run tests/evaluation/runner-id-cli.test.ts` RED | CLI 缺失，20/20 失败 | `d-id-cli-red-20261116.log` |
| 首次完整 CLI GREEN | 5 失败/31 通过，暴露 --flag 前缀解析错误；修正后 36/36 | `d-id-cli-green-attempt-20261116.log` / `d-id-cli-green-20261116.log` |
| 既有报告保护 RED | 1 失败/20 通过，原实现覆盖已有输出；改 wx 独占创建 | `d-id-report-preservation-red-20261116.log` |
| `exec vitest run tests/evaluation` 最终 | exit 0，5 文件/67 项，3.18s；含 A 评估器与历史 runner/scoring | `d-id-final-evaluation-20261116.log` |
| `exec tsc --noEmit` | exit 0 | 宿主命令结果 |
| `verify:workspace` | exit 0，10 成员、4 公开包、无环与安全服务图 | 宿主命令结果 |

独立审查确认输入/观测分离、字段白名单、real/synthetic 与空集边界、UTF-8 摘要、真实进程退出码与输入保护。审查发现的覆盖报告 P2 已修复并复核关闭，审查者独立运行最终两份 runner 测试 37/37 通过，无剩余代码阻断。

## 实际样例执行

```powershell
.\scripts\pnpm.ps1 exec tsx tests/evaluation/runner-id-cli.ts --cases tests/evaluation/design-cases.json --observations tests/evaluation/runner-id-observations.example.json --output docs/phase2/id-evaluation-report.example.json --mapping-version synthetic-example-v1 --runner-version id-runner-v1
```

实际 exit 1（预期）：real=0 / N/A / false，synthetic=1 / 100% / true，硬违规 0，顶层 passed=false、productionAcceptance=false。独立审查核对报告摘要与输入文件字节一致：

- cases：`1419d32f74a57a97dc3fa3a79f4c4561399c1491766a87d32b1e676f66549596`
- observations：`8c307dc7655bb51a29c8af2c29d4d9de3e2d1a77b9c6159feff2d89e56f9c719`

正式 ID 规范、设计平台导出和真实业务样本尚未提供，T13/T14 业务验收未完成。没有将改 origin 的单测或 synthetic 示例作为真实样本，也没有以模型接入作为阻塞。
