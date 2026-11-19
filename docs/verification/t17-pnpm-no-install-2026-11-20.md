# T17 pnpm 验证禁止隐式安装

本记录追加说明 2026-11-20 的产品缺陷修复，不修改既有冻结包或历史验证记录。

- 固定工具链：Node 26.13.0、pnpm 12.18.0、npm 11.20.0。
- 原因：pnpm 默认 `verifyDepsBeforeRun` 会在授权的 `run` 之前尝试安装；仅抑制 pre/post 生命周期不能满足“验证不安装”。
- 产品仅在固定 pnpm argv 增加 `--config.verifyDepsBeforeRun=false`，保留安装版本、清单摘要、锁文件及 dependency-guard 的独立实测。
- 真实 RED：完整 v9 snapshots、hoisted 安装元数据与默认 isolated 配置不一致时，loopback poison registry 实际收到 21 次请求。
- GREEN：新回归与既有 npm/pnpm pre/post sentinel 为 2/2；实际生成 dist，注册表请求为 0，manifest、lock、安装元数据和各精确依赖 manifest 原始字节保持一致。
- 作者完整回归：`exec vitest run tests/integration/project-verify.test.ts tests/integration/project-verify-cli.test.ts tests/integration/integration-repair.test.ts tests/contracts/integration-verification.test.ts tests/contracts/integration-repair.test.ts`，5 文件、110/110、exit 0、27.87 秒；根 tsc、CLI typecheck、diff check 均 exit 0。
- 集成方亲自复跑相同五套测试：110/110、exit 0、28.15 秒；CLI build（含契约内联同步与真实 package probe）exit 0，probe 73/73 文件摘要复核一致。
- 外置原始日志、RED/GREEN 摘要与逐文件 SHA-256 清单位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/pnpm-verify-no-install-7eb9899a`。

最终版本由集成方另行升版、构建并单次冻结，真实宿主、矩阵、黑盒和 T15/T16 均须使用新包复验；上述定向测试不替代最终验收。
