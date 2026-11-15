# C 独立验收 A3 文件评估入口

审查提交 bbb0bf7f 与修订 f092f240；复用既有评分器，原始输入字节摘要、eval split、real/synthetic 隔离、独占写入与 0/2/1 退出语义均保留。C 发现原始异常可回显非法输入或路径，交 A 新增 SECRET 回归后修复为固定错误分类。

实际独立运行：
- `scripts/pnpm.ps1 exec vitest run tests/evaluation`：2 文件、18 项通过。
- `scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`：退出 0。
- `scripts/pnpm.ps1 verify:workspace`：10 成员、无循环、服务依赖边界通过。

最初直接传 `exec tsc -p` 被 PowerShell wrapper 参数绑定拒绝，改用已约定 PnpmArgs 后通过；不将拒绝命令计为成功。

无阻断项。测试中的 real 标注为模拟测试数据，仓库没有 30+ 真实标注集及真实检索观察，不能据此宣称 T14 通过。
