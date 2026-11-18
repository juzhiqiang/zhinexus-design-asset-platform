# T16 备份祖先路径独立验证（2026-11-19）

本记录追加独立证据，不改写 2026-11-18 的验证历史。产品仍为实际 B 的 B12，B15 尚未完整交付；C 只新增产品验收测试和记录，没有改写产品源码。工作树为 `t16-safe-apply-0026/zhinexus-design-asset-platform`，基线提交 `b2588db46becf6f93ae8c82bb558a174b1b9fccd`。

## 两个真实 RED

`tests/integration/project-rollback.test.ts` 新增两条测试，调用真实 CLI 根出口，并用真实 Windows junction、目录快照和 SHA-256 检查副作用：

1. `备份根上层父目录为 junction：普通子目录与有效摘要不能授权恢复`：先成功 apply，再将备份根的上层目录移到仓外并以 junction 替换。备份根自身仍为普通目录，版本字节摘要仍等于真实 backupRef。当前 rollback 返回结果并删除目标生成文件；预期固定脱敏 `BACKUP_INVALID`，目标与外部备份均零变化。
2. `创建备份前拒绝上层 junction：缺失的普通子目录不得先在外部创建`：合法无安装计划使用 junction 下尚不存在的备份子目录。当前 apply 返回 `applied`、写入目标，并在 junction 指向的外部目录新建备份目录及文件；预期在任何备份创建或目标写入前拒绝，保持目标与外部快照不变，零物化启动。

测试没有用模拟结果冒充外目录写入；合法计划、首例成功 apply、普通子目录和有效摘要前置断言均通过。软断言保留实际目标、外部目录与状态三个独立诊断。

## 实际命令与结果

固定 Windows Node `26.13.0` / pnpm `12.18.0`，证据存于本计划的 ignored 工作目录 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/`：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-rollback.test.ts','-t','上层父目录为 junction|创建备份前拒绝上层 junction','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c-backup-ancestor-red-01.json')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-apply.test.ts','tests/integration/project-install-isolation.test.ts','tests/integration/project-rollback.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/product-b12-c7-full-01.json')
git diff --check
```

- 祖先路径窄测：29 collected / 0 passed / 2 failed / 27 unselected，exit 1；`c-backup-ancestor-red-01.{json,log}`。过滤未选中的 27 条不属于新增 skip。
- 新增测试的根类型检查：exit 0；`c-backup-ancestor-ts7-01.log`。
- 三个完整产品文件：**128 collected / 119 passed / 9 failed / 0 pending，exit 1**；`product-b12-c7-full-01.{json,log}`。原七条安装交付、日志及清理失败仍在，另加两个祖先路径失败。
- 2026-11-19 本轮差异检查 exit 0；原架构 SHA-256 实查仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。

## 原因、交接与验收边界

当前 apply 先 `mkdirSync(backupRoot, { recursive: true })` 再 realpath；persistBackup 同样先递归创建根。loadBackup 只核验 root、operation、versions 和文件，没有检查 root 上方祖先。根本体的普通目录形态及正确内容摘要均不能证明祖先路径安全。

B17 brief 已准备，等待 B15/B16 停写后交实际 B，限定 `backup.ts` 与必要的 `apply.ts`。C 仍只机械接收完整原文，不补产品正文、不放宽断言。备份临时文件独占、rename 前后父链置换和更宽并发窗口尚未形成完整独立 RED，不据此声称已覆盖。原七条中日志/rename 故障尚失败于必须命中断言，不能冒称已注入真实故障。

产品 GREEN、Next 客户端边界、D 完整黑盒、全图与冻结消费者均未完成，尚未升版、pack 或合 main。全部通过后依用户授权本地合 main；不 push、不 tag、不生产发布，保留工作树及原始证据。缺真实授权 Vue/React 业务项目，完整 T16/T17 仍未验收。
