# T17 pnpm 固定管理器验证的补充修复（2026-11-20）

此前禁止 `verifyDepsBeforeRun` 只覆盖依赖安装；真实矩阵发现工程含 `packageManager: pnpm@12.18.0` 时，固定 pnpm 仍在授权脚本启动前引导包管理器，给冻结锁文件前置管理器 YAML 文档。不能删除工程里的合法声明掩盖该边界。

独立诊断直接调用冻结 CLI 0.0.20：真实 apply 后立即 verify，跳过矩阵自己的 type/build；type/build/dependency/browser 实际通过，末尾 source-guard 正确报告 `PROJECT_CHANGED`。唯一源码差异为 `pnpm-lock.yaml`。原始锁和真实报告逐字节保留在仓外 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/pnpm-direct-verify-0.0.20-1db238942a6b6490404ae614a6b7ee06`，245 份证据重读一致；case seal 有效，外层诊断因空缓存目录登记失败而无 top seal，明确保留 exit 1。

产品在独立校验精确 Node/npm/pnpm 身份之后，仅为 verify 的固定 pnpm argv 增加 `--pm-on-fail=ignore`，与 `--config.verifyDepsBeforeRun=false` 并用。没有修改 T16 安装暂存的 `pmOnFail: error`、manifest 身份或源码守卫。此结论来自本机原生命令对照；先前猜测的 pnpm-v12 网页地址实际为 404，不作为已读取官方材料。

回归沿用 loopback poison registry、真实脚本及全量精确依赖 manifest，参数化无声明和精确 pnpm 声明两个工程，检查 registry 请求为 0，package/lock/.modules 与依赖 manifest 原始字节不变、真实 dist 存在、类型/构建/依赖检查通过。

- RED：2026-11-20 03:14:20，1 passed / 1 failed，精确声明案例实际 changedFiles 为 `[pnpm-lock.yaml]`。
- GREEN：03:14:44，2/2、exit 0，2.38 秒。
- 完整相关回归：`./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-verify.test.ts','tests/integration/project-verify-cli.test.ts','tests/integration/integration-repair.test.ts','tests/contracts/integration-verification.test.ts','tests/contracts/integration-repair.test.ts')`，5 文件、111/111、exit 0、38.61 秒。
- CLI typecheck、根 `tsc -p tsconfig.json --noEmit` 均 exit 0；独立只读审查无确认的 Critical / Important，确认安装隔离固定配置未变。

完整相关日志位于仓外 `pnpm-manager-no-bootstrap-f9f58c3d6b1d49598192f8cd7727a712`。本修复必须另升 0.0.21、构建并一次冻结；0.0.20 不重打包、不覆盖，新版本必须重新运行真实宿主、矩阵、黑盒和 T15/T16。
