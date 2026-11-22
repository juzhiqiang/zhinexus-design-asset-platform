# T16 A 独立生成绑定断言返工

延续已批准 A API 案例任务。唯一写入目录仍为 `C:/Users/10208/.codex/worktrees/t16-api-cases/zhinexus-design-asset-platform`；仅写 `tests/acceptance/t16-a/**`，并新增独立验证记录，不覆盖先前记录。不得读取 B 产品实现来计算 expected，不改 B/C 测试辅助器、契约、依赖、锁、版本，不提交、pack、merge 或 push。

C Windows 已实测原 A 测试 5/5 及类型检查通过。但独立只读审查在固定 Node 26 中加载原 assertions helper，证实如下反例被错误接受。原 5/5 不能作为真实生成绑定验收：

1. 真实 SDK/style import + 无关 `const keys = ['sales', 'onSelect']` + `<LineChart data={[]} />`，无 callback，React/Vue 均错误返回 ok:true。
2. data 读取 handlerKey `onSelect`、callback 读取 sourceKey `sales`，互换绑定仍返回 ok:true。
3. SDK JSX 仅放未调用函数，导出函数实际 return `<div />`，仍返回 ok:true。
4. `export function Bad(LineChart: any) { return <LineChart data={[]} /> }` 参数遮蔽 import 仍返回 ok:true。
5. 合法单引号键 `'sales'` / `'onSelect'` 的真实绑定反被判 MISSING_REQUIRED_BINDING。

当前 `validateSafeStringKeys` 仅凭全文 includes(JSON.stringify(key))；全 AST JSX 扫描不代表导出组件实际渲染；仅检测 data 名称不代表 source 与 handler 分别正确绑定。请先新增真实失败测试，确认 RED，再合理修复独立断言。接受 AST 解码后的字符串值及可追溯局部绑定；必须关联真实 SDK import、实际渲染路径与每个 required prop/callback 的正确 sourceKey/handlerKey，不以无关字面量或常量值冒充。继续覆盖原 brief 的伪 import、跨组件属性、未渲染、遮蔽、spread 覆盖、未知必需绑定与恶意字符串输入。

不要为了通过测试拒绝合法单双引号、改 expected 为产品输出或放宽缺 callback。不要声称 AST 检查替代仓外真实 SFC/TSX 类型/构建验收。

Windows 固定工具可通过当前 A scripts/pnpm.ps1 调用；依赖已安装。新增记录实际 RED/GREEN 命令、计数与未覆盖边界，完成后停写，交 C 原样同步并复验。
