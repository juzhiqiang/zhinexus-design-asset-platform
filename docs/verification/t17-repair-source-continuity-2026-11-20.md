# T17 修复重验的完整源快照连续性（2026-11-20）

最终源码审查在冻结 CLI 0.0.21 中发现两类真实遗漏：生成文件写入后、内部重验前新增业务文件会被接纳为新基线；内部重验已经发现用户变动后，repair 仍可能继续修复另一生成文件并覆盖首次问题。旧冻结包和既有验收结果保留，不用本记录追认旧包安全。

根因是 repair 的私有基线仅从 applyResult.afterHashes 建立，未保留源报告的完整 snapshots.after；verify 只逐项检查部分守卫，不能发现新增路径；repair 消费内部失败报告后未立即停止。

## RED

在产品修改前，控制方新增以下真实文件回归并通过固定工具链亲跑：

- `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/integration-repair.test.ts','-t','修复写入后重验前')`：04:13:12 开始，5.66 秒，3 failed / 10 skipped；新增、编辑、删除三例的真实结果均为 stopped，未按源变更阻断。
- `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/integration-repair.test.ts','-t','重验中发现用户新增文件')`：04:14:05 开始，4.92 秒，1 failed / 13 skipped；预期一轮，实际两轮，第二生成文件被继续写入。

用例使用真实 apply、原生命令与文件字节。只在 fs 实际写入、复读或证据落盘边界注入并发用户改动；不 mock verify 或 repair 的结果。

## 修复与 GREEN

repair 以源报告完整 snapshots.after 为基底，仅更新本轮已安全写入并复读的生成路径。内部 verify 对私有基线与当前完整路径集合比较，覆盖新增、删除、编辑；原 plan.baseFileHashes 守卫继续生效。公共 verify 仍使用原 apply 基线，外部调用不能传入内部替代快照。

内部重验报告含 changedFiles、PROJECT_CHANGED 或 USER_EDITED 时立即停止，结果为 blocked / user-edited，保留该报告及问题，不再写第二份生成文件。已完成的本轮写入、备份、三个原始身份摘要和用户字节继续如实记录。

产品修改后实际执行：

| 命令 | 实际结果 |
| --- | --- |
| `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/integration-repair.test.ts')` | 04:19:02 开始，14.15 秒，1 文件、14/14，exit 0，无 skip |
| `./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-verify.test.ts','tests/integration/project-verify-cli.test.ts','tests/contracts/integration-verification.test.ts','tests/contracts/integration-repair.test.ts')` | 04:19:34 开始，24.17 秒，4 文件、101/101，exit 0，无 skip |

本记录仅证明该源码修复及定向回归。独立复审、新版本单次冻结、完整根测试、宿主、33 格矩阵及冻结包黑盒仍须分别运行；不据此宣告整个 T17 完成。

## 复审追加：源报告不能替换原始守卫

独立复审进一步复现：源失败报告本身已含 PROJECT_CHANGED 时仍可能启动修复；外部报告把锁文件的前后快照同时改成当前摘要，也可使私有全量快照覆盖原 plan.baseFileHashes 守卫。控制方新增三项正式回归，第一次因测试文案不符合固定 issue 消息而失败，纠正测试文案后，于 04:24:22 重新执行 `-t 源报告`：3 failed / 1 passed / 13 skipped，5.89 秒，均真实收到 stopped 而非 blocked。

随后补充两处边界：源报告已有 PROJECT_CHANGED / USER_EDITED 或 changedFiles 时零写入停止；repair 初始校验独立合并原 plan 与实际 apply 的守卫，不能被源报告替换。内部 verify 同样保留该独立守卫，只允许当前调用的生成组件路径由修复私有守卫覆盖；完整路径集合检查仍独立执行。

04:25:08 实际运行完整 repair、project-verify、project-verify-cli 和两份 verification/repair 契约套件：5 文件、118/118、无 skip、37.54 秒、exit 0。新增断言包括原始锁文件字节及未修复生成文件保持不变、源报告问题保留、源报告已变时 attempts=[]。独立复审继续核验，不用本次定向通过替代新冻结包最终回归。

独立复审随后对最新源码运行 `.tools/review-repair-snapshot-20261120-7727/vitest.config.ts`：04:26:42，6/6、exit 0。覆盖诚实源变更报告、无源变更 issue 的伪造锁快照、缺失/未知/false 快照、合法两轮摘要链及带 context 的完整契约验证；公共 verify 的额外 options/第四实参不能替换基线。复审结论无剩余 Critical / Important / 新增 Minor。该 probe 为独占、忽略的 synthetic 源码验证，不替代新冻结消费者验收。
