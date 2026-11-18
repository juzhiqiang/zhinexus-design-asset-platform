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

## B20 机械接收与真实 GREEN 补充

实际 Claude 桌面完整回复已确认停写并通过响应 Copy 保存为 `b20-desktop-raw.txt`（11845 bytes，SHA-256 `243cb9c7df9d2db00a7a037ed04c6d77737a611c96d3b86edae1b3328a56d003`）。末尾原文为“未执行；交付完毕，停写待C实”，保留原样；不将作者静态推演计作通过。六个 hunk 的旧上下文均唯一且有序命中，仅机械重算行号；`git apply --check` 后应用。唯一范围为 `apply.ts` 与 `expectStagingClean` helper，原有 manifest/YAML/凭据断言保留，新增精确所有权标记断言。

固定命令及实际结果：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-install-isolation.test.ts','-t','日志.*备份','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c-hot-recovery-green-01.json')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-apply.test.ts','tests/integration/project-rollback.test.ts','tests/integration/project-install-isolation.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/product-b20-full-01.json')
.\scripts\pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','build')
.\scripts\pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','typecheck')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
.\scripts\pnpm.ps1 -PnpmArgs @('verify:workspace')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','turbo','run','build','typecheck','--force')
```

三条恢复测试 **51 collected / 3 passed / 0 failed / 48 unselected，exit 0**；完整产品 **134 collected / 134 passed / 0 failed / 0 pending，exit 0**。CLI build/typecheck 和根 fixtures tsc 均 exit 0，构建内 probe73 文件零缺失、污染、链接或改动。workspace 十成员检查通过；全图强制执行 **20/20，0 cached，exit 0**。日志分别为 `b20-cli-{build,typecheck}.log`、`b20-fixtures-typecheck.log`、`b20-workspace.log`、`b20-full-graph-02.log`。首次全图命令同时传 `--force` 和 `--cache=local:rw` 被 Turbo 拒绝，保留 `b20-full-graph.log`，不计作验证；第二次仅 `--force` 完整执行。

架构原文摘要复核仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。产品最终独立审查已交回既有 reviewer，根测试和最终冻结消费者仍待完成。

D11 实际 Claude Code GLM-5.3 exit 0 / success，明确采用完整候选，但三个 diff 旧上下文中的中文注释被改写，机械匹配失败；另遗漏 `closeAllConnections`，停写声明截为“停写待”。未落 tracked、未执行、未修改 D 正文。D12 已向同一实际作者提供精确小段旧文，要求重交三个修复并完整停写。此次运行状态不证明 D 黑盒通过。

## C21 独立审查 RED 与根回归补充

既有只读 reviewer 对 B20 提出三个 Important：真实源码提交后登记晚于读回、备份 temp 写入后提交前缺少原始路径链复核、安装根 recursive mkdir 会认领窗口内出现的未知用户树。C 仅修改独立测试，不代写 B 产品。

四条 C21 通过真实文件系统注入确认：目标 rename 真实成功后首次 readFile 一次 EACCES；version/latest 的真实 temp 写入后、rename 前移动专用祖先并置换 junction；stage mkdir 前创建无标记普通树及用户 sentinel。备份两例保留 outside 的完整字节快照（包括真实 temp），禁止沿不可信路径提交或清理。首版 `c21-review-red-01` 保留作历史，最终夹具以 `-02` 的提交窗口为准。

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-apply.test.ts','tests/integration/project-install-isolation.test.ts','-t','C21','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c21-review-red-02.json')
```

实际 **109 collected / 0 passed / 4 failed / 105 unselected，exit 1**。四条均在实质断言失败，无收集错误：残留源码原树 2 项变 6 项、version/latest 改动 outside、用户 sentinel 被删除。B21 已发送实际 Claude 桌面 GLM-5.3 High，限 apply/backup/install 三文件必要精确 diff，详见 [B21 brief](../superpowers/plans/2026-11-19-t16-b21-review-brief.md)。尚未接收或修复，不撤销历史 B20 134/134 的范围证据。

根 typecheck 日志为 14/14、14 cached；缓存输出本身不代替前述强制全图 20/20 零缓存。随后根 test 实际结束 exit 1：T10 node:test **161 passed / 7 skipped / 0 failed**；普通 Vitest **89 文件（88 passed / 1 failed），1749 tests（1744 passed / 3 failed / 2 skipped）**。三失败对应新增 C21 的源码及两备份用例。根测试启动后测试文件发生 C21 补测更新，stage 新例未计入该次根结果；不得称根回归通过，B21 接收后需完整复跑。日志 `b20-root-{typecheck,test}.log` 保留。

D12 receipt 确认十分钟超时、无 parseable result，输出仅持续 thinking（未取得完整测试交付）；8,146,668 bytes 原始 NDJSON 与摘要 `171ffb4bc950ca7e9fc6c27ad8de5af98be35ff56df158e5f8408c49e98b1316` 保留。未拼接部分文本或修改 D 正文。改为同模型更小替换片段请求，单进程降低 thinking/output 上限，不改全局配置。D 完整黑盒、最终冻结消费者与本地 main 合并继续待全部门槛通过。架构原文摘要再次与基线一致。
