# T16 A 第三轮独立断言返工

仅实际 Antigravity A 写入 `C:/Users/10208/.codex/worktrees/t16-api-cases/zhinexus-design-asset-platform/tests/acceptance/t16-a/**` 与新增独立验证记录。禁止写 main/B、读取 B 实现或 C helper 算 expected、修改契约/锁/版本、提交/pack/merge/push。先逐反例 RED，最小合理 GREEN，保留全部合法回归，完成后停写。静态解析不承诺任意 JS 的运行时语义；无法证明的路径失败关闭。

独立 reviewer 实际加载 helper SHA `00D933D140678FD26C12A1EFEF7691483972E5A6253CDFA820471C147BB6BA83`，发现以下 Important 问题；7/7 现有测试不足以覆盖它们：

1. 函数 `return <div/>; return <LineChart data={dataSources['sales']} onPointClick={handlers['onSelect']}/>` 死 JSX误收；`getData(){if(false)return dataSources['sales'];return [];}` 和 `getData(){return [];return dataSources['sales'];}` 死返回值误收。遍历 return/throw 后须停止该路径，return 收集须考虑 false 分支。
2. `data={'sales'?[]:[]}` 与 `onPointClick={()=>'onSelect'?undefined:undefined}` 不能将条件字符串算作返回值；Vue同类拒绝。`data={((x)=>[])('sales')}` 与 `onPointClick={((x)=>undefined)('onSelect')}` 的丢弃参数不能算绑定。`data={(()=>{(()=> 'sales')();return [];})()}` 丢弃调用不能算数据值。未知调用失败关闭，不无条件扫描callee/args作为有效值。
3. `export function Bad(sourceKey,handlerKey){if(false){const sourceKey='sales';const handlerKey='onSelect';}return <LineChart data={dataSources[sourceKey]} onPointClick={handlers[handlerKey]}/>}` 实际使用外层参数，块内常量不能泄漏或撤销参数遮蔽。
4. 顶层 `function buildChart(){return <LineChart data={dataSources['sales']} onPointClick={handlers['onSelect']}/>}` 加 `export function Bad(buildChart){return buildChart();}` 实际调用参数，不是模块helper。getData/getHandler同名参数遮蔽也拒绝；按调用位置作用域解析函数，不按全模块名称匹配。
5. `export function Good(){if(false){const LineChart=()=>null;}return <LineChart data={dataSources['sales']} onPointClick={handlers['onSelect']}/>} ` 是合法未被块声明遮蔽的SDK导入，不应误拒。无关块不能污染renderer作用域。

定位 assertions.ts 269/278、309、399、443/459/482、620、804/829（修改后行号可变）。保留合法单引号、默认导出arrow、callback引用和真实SDK alias。分别记录每类RED，不将一条综合测试的首个失败冒称其他反例均RED。执行含 `A10_FROZEN_BUNDLE` 窄测和 TS7 窄类型检查；记录实际命令、退出码、测试数和未覆盖边界。冻结SDK路径同第二轮。旧验证记录保持不变。
