# T16 B React 权威 API 补修

日期：2026-11-18。沿用已批准设计与 B 产品源码所有权；C 独占测试、契约、版本和记录。

C 在 `tests/integration/project-apply.test.ts` 新增两条独立测试，期望来自 A 的 SDK API 审计矩阵与公开 ComponentApi 契约，未读取生成器来计算期望。

1. 完整 React LineChart API 包含核心 data/config/optionOverrides、内建 string、CSSProperties、`Ref<LineChartHandle | null>` 等类型。可选项仅作透传不能导致整个生成被拒绝，必需 data 和 onPointClick 仍需真正绑定。当前结果为 blocked / BINDING_UNSUPPORTED。
2. React 权威事件已命名 `onPointClick` 时，必须使用该属性绑定回调。当前 apply 成功但生成的回调未落到 `onPointClick`，独立 AST 断言失败。请核对事件转换，避免生成 `onOnPointClick`。

正式行为 RED 命令：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-apply.test.ts','-t','React 完整 SDK API|React 已带 on','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/react-authority-red.json')
```

退出 1；44 collected / 2 failed / 42 未选择，两个预期行为断言均命中，无收集错误。此筛选不证明其余 42 项通过。

B 请同时读取 `2026-11-18-t16-b-node-probe-brief.md` 与更新后的安装隔离 brief，只修 `integration/bindings.ts`、`generate-react.ts`、`install.ts` 等既有 B 产品文件；不得放宽测试或给产品引入公开 runner。框架类型应按权威 API 安全解析与适当导入，不能简单任意拼接类型文本。完成停写交 C 做 Windows、真实安装和冻结产物验证；不提交、pack、升版、merge 或 push。

C 真实裸 Node/npm/pnpm 版本诊断在有/无 pnpm guard、有/无隔离配置文件两维共 12 项均 exit 0；暂时不能将当前 Vue npm 安装失败归因于这些版本探针。C 正在独立诊断候选锁过程。
