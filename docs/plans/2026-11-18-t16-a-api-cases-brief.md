# T16 A 独立 API 预期与安全案例交接

本阶段 A 必须是实际 Antigravity 客户端。唯一写入目录：`C:/Users/10208/.codex/worktrees/t16-api-cases/zhinexus-design-asset-platform`，基线 `b951f43dd65fef9bd97a564455e608ce6857db42`。B 正在另一个 worktree 实现产品，A 不读 B 实现来计算 expected，不修改 main、B、contracts、SDK、根配置/锁与原架构。

先读 AGENTS.md、rules/architecture.md、rules/platform.md、rules/testing-release.md、rules/code-review.md、T16 已批准设计及计划、packages/contracts、SDK公开 exports 和实际类型/API。使用 executing-plans。既有设计已经批准，允许直接编写独立预期和测试。

仅写 `tests/acceptance/t16-a/**` 与新增 `docs/verification/phase3-t16.md`。不提交、merge、push、tag、pack、升版。无需修改产品或测试辅助器。

交付：

1. 7 逻辑组件 × Vue/React 共 14 实现的独立 API 对照：line/bar/pie/scatter/trend-card/ranking/proportion 的真实 import/exportName、必需数据 props、可选 props、事件 prop / Vue模板事件拼法、payload、style导出和 ready 方法。每项引用实际 SDK 文件/声明依据。
2. 独立 JSON fixture 描述合法 MatchPlan 输入、预期 import、prop、callback 绑定与输出文件类型。LineChart source 与 handler 必须不同；包含 `__proto__`/`constructor` 对调、引号、换行、反斜杠、HTML双引号、`</script>`、模板表达式和代码执行文本。这些值必须作为字符串键保留，不成为执行语法。
3. 不读产品的负例预期：伪SDK import、另一组件的 prop、错 prop/event、未渲染函数、局部同名遮蔽、无关字面量、后置 spread 覆盖、未知必需绑定应拒绝。提供可独立使用的断言和真实SFC/TSX类型/构建验收方案；不要用产品生成值作为 expected，不以字符串存在冒称真实绑定成功。
4. SDK0.0.11/0.0.12 冻结包只读，不重打包：冻结目录 `D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`，manifest SHA256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。无法运行的检查明确记录，不凭源码宣称消费者通过。

Windows固定工具调用可用 B worktree现存 `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform/scripts/pnpm.ps1`；A缺依赖时报告，由C安装，不改工具链。C之后在同一冻结CLI上消费A案例并运行真实8组合。没有真实业务项目，完整T16/T17仍未验收。交付后停写并报告实际文件、命令/结果与未覆盖边界。
