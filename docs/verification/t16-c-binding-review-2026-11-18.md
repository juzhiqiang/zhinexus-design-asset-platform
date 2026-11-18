# T16 C 生成绑定辅助器独立审查补充

日期：2026-11-18。本记录新增补充验证，不重写已有产品 RED 或历史 helper 记录。范围仅为 C 的 `tests/integration/t16-support/source-scan.ts` 与其独立反例测试；不是产品或完整 T16 验收。

独立只读审查用固定 Node 26.13.0 内存加载实际 helper，发现三类问题：不可达 JSX/逗号表达式被误认为渲染；被丢弃的调用返回值被误认为 data；无关函数参数/局部声明污染全局遮蔽判断。C 新增反例与有效控制，在修改辅助器前实际运行失败。

固定 Windows 工具命令：

```powershell
& .\scripts\pnpm.ps1 @('exec','vitest','run','tests/integration/t16-support/source-scan.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/helper-final-review-red.json')
```

实际 RED：15 collected / 12 passed / 3 failed / 0 pending，exit 1。三个失败分别为不可达/丢弃渲染、data 丢弃调用返回值、无关作用域污染；没有收集、导入或 fixture 失败。

修复将声明解析限定到引用所在词法作用域；渲染路径排除确定未选中的布尔分支及逗号表达式非最终元素；data 值追踪不再包含丢弃调用，callback 调用证据独立处理。既有 SDK import、错组件/错属性、spread 覆盖、Vue 事件、用户字符串与实际回调控制继续覆盖。

相同命令仅输出路径改为 `helper-final-review-green.json`，实际 GREEN：15/15 passed / 0 failed / 0 pending，exit 0。报告与完整日志保留于本计划 ignored 证据目录。独立类型检查如下，exit 0：

```powershell
& .\scripts\pnpm.ps1 @('exec','tsc','--noEmit','--ignoreConfig','--target','es2022','--module','nodenext','--moduleResolution','nodenext','--strict','--skipLibCheck','--types','node','tests/integration/t16-support/source-scan.ts','tests/integration/t16-support/source-scan.test.ts')
```

本轮在 A 返工前宿主曾运行 A 5 条 + 本 helper 原 11 条共 16/16；不是 29 条。早先 24 条日志含临时 helper 检查，当前文件树已无该临时文件，本轮未声称重跑 24 条。A 的原 5/5 仍有独立断言漏洞，已交实际 Antigravity 按新增反例返工，不能作为生成绑定验收通过证据。

限制：静态 AST 断言不替代真实安装后 SFC/TSX 类型与构建；产品备份补充 GREEN、真实 8 组合、D 黑盒、最终冻结 CLI 和主分支验收尚未完成；无真实业务项目，完整 T16/T17 保持未完成。

恢复本轮后，C 再次执行上述完整 15 条窄测（输出 `helper-review-resume-green.json`）及相同类型检查，分别为 15 passed / 0 failed / 0 pending / success true、exit 0；`git diff --check` 通过。仅收口辅助器、其反例测试与本记录。
