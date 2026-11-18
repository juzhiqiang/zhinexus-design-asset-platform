# T16 同次 apply 恢复与目录所有权补测（2026-11-19）

本记录追加独立证据，不覆盖既有验证历史。实施工作树为 `t16-safe-apply-0026/zhinexus-design-asset-platform`，基线 `7797c3c14b477f167bced9f09e9a4c50b05bd646`。产品源码来自实际 Claude 桌面 B18/B17/B19；C 只机械接收原作者交付、补独立验收测试及维护记录。

## B19 实跑与剩余失败

完整三个产品文件实跑 **132 collected / 127 passed / 5 failed / 0 pending，exit 1**，证据 `product-b19-full-01.{json,log}`。四条失败来自 stage 所有权标记与原测试 helper 白名单不一致；另一条来自日志写入窗口 backupRoot 被真实 junction 替换后，同次 apply 的源码恢复仍读取已不可信的磁盘备份路径，`BackupError` 上抛。B19 已保护外部证据字节并阻止后续依赖交付，尚未形成完整恢复结果。

固定 CLI build 与 typecheck exit 0，probe 的 73 个文件复核通过。开发 CLI 的 Next App Router 普通 Server Page 真实消费者复跑 **13 collected / 1 passed / 0 failed / 12 unselected，exit 0**；控制构建与生成 React 客户端组件的消费构建均完成 Next 16.4.6 webpack、类型与预渲染。证据 `c-next-install-diagnosis-01.{json,log}`。此结果使用 B18/B17 开发 CLI，不能替代最终冻结 tarball 验收，也未定位此前消费者失败的根因；本次成功时，私有失败诊断 helper 没有执行。

## C 独立 RED

在接收 B20 前，C 加强原 junction 测试：必须真实恢复源码至故障前快照，返回 `rolled-back + reinstall-required + INSTALL_FAILED`，不能仅返回非 applied。另加两个同窗口用例：

- 用户改写已生成源码后再替换备份祖先：原编辑字节必须保留，返回 `recovery-required` 与同路径 `USER_EDITED`。
- 备份祖先替换后，对生成文件删除注入真实 `EACCES`：文件保留，返回 `recovery-required` 与同路径 `WRITE_FAILED`，不得冒称用户编辑；必须确认删除故障命中。

三个用例均检查合法计划、生成源码已提交、真实 junction 置换、外部备份副本字节不变、原备份目录保留及零新依赖树交付。固定命令：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-install-isolation.test.ts','-t','日志.*备份.*替换','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c-hot-recovery-red-02.json')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
```

窄测 **51 collected / 0 passed / 3 failed / 48 unselected，exit 1**，均失败于 `BackupError: 备份根不是普通目录` 上抛；根 fixtures 类型检查 exit 0（`c-fixtures-typecheck-03.log`）。`-02` 是以显式 `-PnpmArgs` 复跑的 RED；一次类型检查参数绑定失败保留，不能用其进程 exit 0 声称通过。

## 本轮裁定与原作者交接

Ruling：stage/env/ready 的精确内部所有权标记是安全清理依据。只允许本次操作、固定 role 与 kind 的精确普通单链接文件；helper 必须验证字节和操作身份，不扩大任意隐藏文件白名单。判断错误的成本是错误接收用户目录，需完整失败测试和消费者验收防守。

Ruling：同次 apply 可使用最近一次成功 persistBackup 的可信不可变内存版本恢复源码，必须绑定 reference id/hash、项目、计划及原字节；未成功持久化的候选不能作为恢复依据。磁盘路径被替换后不得读写它。冷启动 rollback 仍须完整验证磁盘备份与祖先路径。判断错误的成本是恢复错误字节或掩盖现场，因此独立覆盖干净恢复、用户编辑与恢复 I/O 失败，最终仍需审查。

B20 已发送实际 Claude 桌面 GLM-5.3 High，限 `apply.ts` 及 B 原测试 `expectStagingClean` helper；尚未完整接收或验证。D10 实际 Claude Code GLM-5.3 exit 0，交付重复声明删除与 JSON 备份候选过滤两处补丁；机械拼回的是未接收证据候选，D11 正返修摘要断言和部分启动服务器关闭，并须完整采用候选后才能落 tracked。未把文本交付声称为测试通过。

尚未升版、pack 或合 main。产品全 GREEN、D 完整黑盒、独立审查、全图回归及最终冻结消费者通过后，按用户已有授权本地合 main；不 push、tag 或生产发布，保留 worktree 和原始证据。没有真实授权业务项目，完整 T16/T17 保持未验收。
