# 三期 T16 安全应用验证汇编（phase3）

> 本文件由 `docs/verification/` 下 23 篇逐次验证记录合并而成（2026-11-22，`chore/docs-consolidation` 分支）；原件已按主题合并删除，git 历史仍可追溯，信息不灭失。每篇原记录以 `### <原文件名>` 为标题完整保留于「逐条合并记录」。总索引见 `docs/README.md`。

## 终态结论

T16 的技术推进从基线 `main@c067c81d2751b1d7cf9a04e7c15b6d7d276d014d` 开始，最终在 2026-11-19 本地快进合入 main：来源分支 `feat/t16-safe-apply-final`（B/C worktree）执行本地 `merge --ff-only` 后，main 与来源 HEAD 均为 `40910dc46db7bef0db0d17dee0d31b94a8f2ea6d`，合并后树 `c51c1932af4a445e7e00514f223ea3435481ca70`，main 与 B/C 全树一致且 clean。

本轮聚焦提交为：`654accdf`（B26 产品 GREEN 收口）、`2fca59cf`（CLI 升至 0.0.14 并同步 CHANGELOG）、`a6e7dc3d`（C 浏览器契约模块路由修正）、`11659bca`（原样 cherry-pick D 16 模块，原作者提交 `9bca63fd`）、`b20921b9`（C 桥接，17 行环境及进程编排）、`1f1566af`（D 交付与最终回归独立记录）、`40910dc4`（区分 D 接收前后行尾证据，补充集成根 tsc）。

最终验收计数（主线数字，全部 exit 0）：

- 产品三文件完整回归 141/141、零 failed/pending。
- 契约与镜像同步窄测 166/166。
- 根 Vitest 89 文件 / 1753/1753 测试通过，T10 Node 168/168，零失败、零跳过。
- 完整冻结 T16 14/14、零 failed/pending/todo（八组 Vue/React × npm/pnpm × standalone/workspace 安装、类型/构建与迁移，四组 hostile 拒绝，Next Server Page 一项，D 默认入口冻结安装恢复一项）。
- 完整浏览器 `test:browser` 287/287；冻结 T15 25/25；D 既有黑盒 5/5；D 冻结安装恢复 1/1（process code 0、stderr 空）；契约浏览器 1/1。
- 强制全图 20/20、0 cached。
- CLI `0.0.14` 唯一冻结 tarball `company-component-cli-0.0.14.tgz`，389203 bytes，SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`；冻结提交 `2fca59cf3a0e4f5cf2500e8d1bba74010796b1ec`，冻结 UTC 时间 `2026-11-18T19:35:01.7156793Z`，pack exit 0 后不重新 pack。
- 原架构文件 SHA-256 全程未变：`e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`（部分早期记录写作大写 `E59BB77E...`，为同一值）。
- 独立全树审查新增 Critical 0 / Important 0 / Minor 2，两项 Minor 均为非阻断（D30 超时/启动失败诊断的持久化范围、D41w 早期主 runner 的路径日志）。

仍开放的问题：

- 真实业务试点未做：全部安装、构建与恢复验收都在明确标注 synthetic 的仓外临时 Vue/React 工程与随机隔离 PostgreSQL/Verdaccio/MinIO 三存储上进行，所有本机真实服务证据均为 `productionAcceptance: false`。上位 T16 最后一项（两个真实授权 Vue/React 业务项目的可审查 diff、项目原生命令与业务接入验收）与全部 T17 保持未勾选。
- 生产 G2 未过：公司 OIDC、独立预览域与完整生产 G2 不由 synthetic 消费者结果替代。
- 未 push、未 tag、未生产发布；分支、worktrees 与全部原始证据保留，未清理。
- 运行时竞态未声称：冷 stale-ref 控制不声称运行时竞态，并发不能完全由字符串校验证明。
- 静态 AST 断言不承诺任意 JavaScript 运行时语义，也不替代仓外真实 `vue-tsc`/`tsc`/`vite build`；备份临时文件独占、rename 前后父链置换与更宽并发窗口尚未形成完整独立 RED。

T16 的设计与计划来源另有两篇文档，不在本汇编合并范围内（被保留并移至新路径），本文不重复其内容：设计 `2026-11-18-phase3-t16-design.md` 新路径为 `docs/specs/2026-11-18-phase3-t16-design.md`，实施计划 `2026-11-18-phase3-t16-safe-apply.md` 新路径为 `docs/plans/2026-11-18-phase3-t16-safe-apply.md`。两篇原位于 `docs/specs/` 与 `docs/plans/`（设计文档实际在 specs/ 而非任务清单所写 plans/）。

## 逐条合并记录

### t16-a-api-cases-2026-11-18.md

- **日期／角色／主题**：2026-11-18／A（Antigravity，SDK 侧）／T16 A/P2 独立 API 预期与安全案例验证记录。
- **目的**：交付不依赖 B 产品的独立 API 对照矩阵、安全绑定案例与静态断言。
- **承重事实**：
  - 唯一工作树 `C:/Users/10208/.codex/worktrees/t16-api-cases/zhinexus-design-asset-platform`；基线提交 `b951f43dd65fef9bd97a564455e608ce6857db42`；按要求未提交、未 pack、未修改 main、B 工作树、contracts、SDK 源码或根配置/锁文件。
  - 交付四文件：`tests/acceptance/t16-a/sdk-api-matrix.ts`（7 逻辑组件 line/bar/pie/scatter/trend-card/ranking/proportion × Vue 3 / React 19 共 14 实现的独立 API 对照；真实 importSpecifier、exportName 含 Ranking/Proportion/TrendCard、requiredProps `data: ChartData`、optionalProps（Vue 含 config、optionOverrides；React 另含 className、style、ref）、事件名 Vue `point-click`/`@point-click` 与 React `onPointClick`、styleImport `./style.css`、readyMethod `whenRendered`、`@company/charts-core@0.0.11` 与框架包 `0.0.12`）；`tests/acceptance/t16-a/security-and-binding-cases.json`（origin: "synthetic"；4 组合法 MatchPlanV1 形态，LineChart Vue/React 用例 `source !== handler`；覆盖 `__proto__`/`constructor` 对调、单双引号、换行、反斜杠、HTML 双引号、`</script>`、`{{...}}`、`${...}`、`eval(...)`/`require(...)` 等危险文本要求作为字符串键保留；8 类负例：伪 SDK import、跨组件 prop、错事件名、未渲染函数、局部同名遮蔽、无关字面量、后置 spread 覆盖、未知必需绑定）；`tests/acceptance/t16-a/assertions.ts`（导出 `assertGeneratedComponentMatchesExpected` 与只读冻结 manifest 核对 `verifyFrozenSdkManifestReadOnly`，核对 manifest.json SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1` 及 0.0.11/0.0.12 版本）；`tests/acceptance/t16-a/t16-a-api-cases.test.ts`。
  - SFC/TSX 真实类型与构建验收方案（供 C 在 P4 消费）：在仓外隔离临时 Vue/React 工程中消费同一冻结 CLI 与冻结 SDK tarball `D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`；先 AST 断言，再 Vue 工程 `vue-tsc --noEmit -p tsconfig.json` 与 `vite build`（实测 vue@3.5.45、echarts@6.1.0），React 工程 `tsc --noEmit -p tsconfig.json` 与 `vite build`（实测 react@19.3.1、react-dom@19.3.1、echarts@6.1.0）；不得以字符串存在冒充真实消费者类型/构建通过。
  - 首次执行命令经 `C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\...\scripts\pnpm.ps1` exec vitest run，退出码 1，阻塞 `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` / `Command "vitest" not found`；`t16-api-cases` 工作树无 node_modules。
  - 返工三项：补齐 expected 中 componentId 与 framework；把旧版 TypeScript AST API 替换为 `@babel/parser@7.29.13` + `@vue/compiler-sfc@3.5.45`（兼容 TypeScript 7.0.2，未修改/降级任何依赖）；对齐公共 `MatchPlanV1` 并接入真实 `validateMatchPlan` 校验。
  - 返工后实测（工作树 `t16-safe-apply-0026`）：contracts build exit 0；默认窄 Vitest exit 0（Test Files 1 passed、Tests 4 passed | 1 skipped (5)）；显式 `A10_FROZEN_BUNDLE` 窄 Vitest exit 0（Tests 5 passed (5)）；窄 tsc（TypeScript 7.0.2，target es2022、module nodenext、strict、skipLibCheck、types node，三个文件）exit 0；`git diff --check` exit 0。
- **结论与状态**：完成。被 `t16-a-assertion-review-2026-11-18.md`（round1）、round2、round3 与 `t16-a-host-review-2026-11-18.md` 更新。
- **交叉引用**：`t16-a-assertion-review-2026-11-18.md`、`t16-a-assertion-review-round2-2026-11-18.md`、`t16-a-assertion-review-round3-2026-11-18.md`、`t16-a-host-review-2026-11-18.md`、`t16-c-binding-review-2026-11-18.md`。
- **过时或矛盾点**：本文第 1–4 节按约定不随返工改写，故其中的阻塞记录与第 5 节返工后结果并存。

### t16-a-assertion-review-2026-11-18.md

- **日期／角色／主题**：2026-11-18／A（Antigravity）／T16 A 独立生成绑定断言返工验证记录（round1）。
- **目的**：按独立只读审查指出的 5 项误收/误拒问题完成 AST 级修复并 RED→GREEN 实测。
- **承重事实**：
  - 工作树 `t16-api-cases`；基线 `b951f43dd65fef9bd97a564455e608ce6857db42`；未提交、未 pack、未 merge、未 push；未改写历史记录 `t16-a-api-cases-2026-11-18.md`。
  - 5 项修复：(1) 禁止无关常量 + `data=[]` + 缺 callback 误过，取消全文 `includes(JSON.stringify(key))`，改为追踪渲染组件属性/事件表达式 AST 字面量及可追溯局部常量，强制 expected.propBindings 与 callbackBindings 均在渲染节点实际绑定且键名匹配；(2) 拒绝 source 与 handler 互换，分别校验 data 属性含 propBindings[].sourceKey、事件属性/指令含 callbackBindings[].handlerKey；(3) `collectExportedRenderRoots` 从 ExportNamed/ExportDefault 出发沿 CallExpression 追踪可达局部函数，排除死 JSX；(4) FunctionDeclaration 纳入函数参数列表递归检查（含 `export function Bad(LineChart: any)`）；(5) 通过 `@babel/parser` 解码 StringLiteral.value 与无插值 TemplateLiteral，Vue 模板指令用 `parseExpression` 解析 `:data` 与 `@point-click`。
  - RED：新增 5 项审查测试用例，退出码 1，`1 failed | 4 passed | 1 skipped (6)`（未调用函数 JSX 用例未触发 COMPONENT_NOT_RENDERED）。
  - GREEN：默认自包含 Vitest exit 0（Test Files 1 passed、Tests 5 passed | 1 skipped (6)）；显式 A10_FROZEN_BUNDLE exit 0（Tests 6 passed (6)）；窄 tsc（TS 7.0.2）exit 0；`git diff --check` exit 0。
  - 未覆盖边界：静态 AST 断言不能替代仓外真实 Vue/React 工程 vue-tsc、tsc 与 vite build；尚未在同一冻结 CLI 上运行真实 8 组合；无真实业务项目试点，完整 T16 与 T17 仍未验收。
- **结论与状态**：完成（round1）。被 round2、round3 更新。
- **交叉引用**：`t16-a-api-cases-2026-11-18.md`、`t16-a-assertion-review-round2-2026-11-18.md`、`t16-a-assertion-review-round3-2026-11-18.md`、`t16-a-host-review-2026-11-18.md`。
- **过时或矛盾点**：无（本文为 round1，其结论被后续轮次取代）。

### t16-a-assertion-review-round2-2026-11-18.md

- **日期／角色／主题**：2026-11-18／A（Antigravity）／T16 A 第二轮独立断言返工验证记录。
- **目的**：修复序列表达式/丢弃语句误收、渲染可达性、作用域遮蔽三类问题。
- **承重事实**：
  - 审查前快照 SHA-256（`assertions.ts`）：`9E4BEBC8A725D16F55A54609E21BE084286DFD0DB4A37FBD513EC8FC25E8E700`。
  - 5 项修复：(1) `SequenceExpression` 仅追踪最后一个元素，拒绝 `data={("sales", [])}`、`onPointClick={() => ("onSelect", undefined)}` 与 Vue 对应写法；`CallExpression` 仅追踪被调用本地函数 ReturnStatement.argument，忽略 `0; "sales"; return [];` 中丢弃字面量；(2) React TSX 仅从导出组件返回 JSX 路径追踪，跳过未调用内嵌 function/arrow、静态 false 条件/逻辑分支、`(JSX, null)` 非末项、返回值被丢弃的 helper() 调用；Vue SFC 递归跳过静态 `v-if="false"` 节点及子树；(3) `deriveChildScope` 将函数参数标识符（含解构/默认值）加入 shadowed 集合并移除同名外层常量映射；(4) `LOCAL_SYMBOL_SHADOWING` 仅检查模块顶层同名声明与导出组件可达渲染调用链内参数/局部声明，不因无关未调用函数 `function unrelated(LineChart: any)` 误拒；(5) 支持 `const Good = () => <LineChart ... />; export default Good;`、`const cb = (ev) => handlers?.['onSelect']?.(ev)` 与真实 SDK 别名导入 `import { LineChart as MyLine } from '@company/charts-{vue,react}/line'`。
  - RED：退出码 1，`1 failed | 5 passed | 1 skipped (7)`（`data={("sales", [])}` 序列表达式被旧实现误收为 ok: true）。
  - GREEN：默认自包含 Vitest exit 0（Tests 6 passed | 1 skipped (7)）；显式 A10_FROZEN_BUNDLE exit 0（Tests 7 passed (7)）；窄 tsc（TS 7.0.2）exit 0；`git diff --check` exit 0。
  - 未覆盖边界与 round1 相同。
- **结论与状态**：完成（round2）。被 round3 更新。
- **交叉引用**：`t16-a-assertion-review-2026-11-18.md`、`t16-a-assertion-review-round3-2026-11-18.md`、`t16-a-host-review-2026-11-18.md`。
- **过时或矛盾点**：无。

### t16-a-assertion-review-round3-2026-11-18.md

- **日期／角色／主题**：2026-11-18／A（Antigravity）／T16 A 第三轮独立断言返工验证记录。
- **目的**：修复控制流终止、条件测试/丢弃调用、块级作用域泄漏、调用位置遮蔽四类问题。
- **承重事实**：
  - 按要求未提交、未 pack、未升版、未 merge、未 push；保留旧历史验证记录原文不改写。
  - 5 项修复：(1) `collectReachableReturnsFromStatements` 遇 ReturnStatement/ThrowStatement 或必终止分支立即停止，拒绝第二个不可达 `return <LineChart .../>` 与 `return []; return dataSources['sales'];`，并跳过静态 `if (false)` 分支；(2) `ConditionalExpression` 仅评估 consequent/alternate，绝不把 test 条件字符串当有效绑定；已知本地函数与 IIFE 仅追踪可达 return 表达式，忽略丢弃实参 `((x)=>[])('sales')` 与丢弃内嵌调用；未知调用直接失败关闭（仅保留 `hasOwnProperty.call` 与成员回调 `handlers?.[key]?.(ev)`）；(3) `cloneScope` 每次进入 BlockStatement 或 IfStatement 分支克隆独立作用域，阻止 `if (false) { const sourceKey = 'sales'; }` 泄漏并撤销外层参数遮蔽，同时阻止 `if (false) { const LineChart = () => null; }` 误拒；(4) 本地函数表 `fns` 纳入 `BindingScope`（随参数遮蔽删除同名映射），拒绝 `export function Bad(buildChart) { return buildChart(); }` 与 `export function Bad(getData, getHandler)` 借用顶层同名 helper；(5) 保留合法单引号、`const Good = () => ...; export default Good;`、`const cb = ...; onPointClick={cb}` 与 `import { LineChart as MyLine }` 别名导入。
  - RED：新增 11 个独立 `it`，退出码 1，`11 failed | 7 passed (18)`；失败编号 1a/1b/1c（死 JSX、if(false) 死 return、return [] 后死 return）、2a/2b/2c/2d（React 条件测试字符串、Vue 条件测试字符串、丢弃参数、丢弃 IIFE）、3（块内 const 泄漏撤销参数遮蔽）、4a/4b（buildChart、getData/getHandler 参数遮蔽）、5（无关 if(false) 块内 const LineChart 误拒合法例）。
  - GREEN：显式 A10_FROZEN_BUNDLE Vitest exit 0（Test Files 1 passed、Tests 18 passed (18)，0 pending / 0 skipped）；窄 tsc（TS 7.0.2）exit 0；`git diff --check` exit 0。
  - 未覆盖边界：静态 AST 解析不承诺任意 JS 运行时语义，无法静态证明的路径按失败关闭处理；不替代仓外真实 vue-tsc/tsc/vite build；尚未运行真实 8 组合；无真实业务项目试点。
- **结论与状态**：完成（round3，A 侧断言返工终点）。由 `t16-a-host-review-2026-11-18.md` 在 C 宿主复验确认。
- **交叉引用**：`t16-a-assertion-review-2026-11-18.md`、`t16-a-assertion-review-round2-2026-11-18.md`、`t16-a-host-review-2026-11-18.md`。
- **过时或矛盾点**：无。

### t16-a-host-review-2026-11-18.md

- **日期／角色／主题**：2026-11-18／A 交付 + C 宿主复验／T16 A 第三轮 C 宿主复验。
- **目的**：在 T16 收口工作树由 C Windows 宿主复跑 A 第三轮交付。
- **承重事实**：
  - A 实际 Antigravity 交付的四个测试文件与第三轮记录已同步到 T16 收口工作树；`assertions.ts` SHA-256 `2daf953d4e64e1d9bd33bffd398356030acbe1dff7238b980fb01e0303b5875e`。
  - C 宿主命令：设置 `A10_FROZEN_BUNDLE='D:\project\zhinexus-design-asset-platform\.tools\operations\current-sdk\881238b3-2214-4ec8-bf0c-af5238b7fcd3'` 后 `.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/acceptance/t16-a/t16-a-api-cases.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/a-round3-precommit.json')`；退出 0，**18 collected / 18 passed / 0 failed / 0 pending**。
  - 此前 `a-round3-host.json` 同为 18/18；`a-round3-host-typecheck.log` 的 TS 7.0.2 窄类型检查退出 0。
  - 独立 Codex 复审仅作审查、未代替实际 A：13 个原探针中 10 个负例拒绝、3 个合法例通过；额外默认导出箭头与 Vue alias/callback 合法例通过。
  - 死返回路径、条件测试/丢弃调用、块级 key 泄漏、helper 参数遮蔽、无关块 SDK 声明误拒五类既有 Important 均关闭；限定复审范围无剩余阻断。
  - 边界：静态断言无法证明任意 JavaScript 运行时语义；真实八组合安装、构建与迁移、冻结 CLI 黑盒及业务试点尚未完成，本记录不将完整 T16/T17 标记为验收。
- **结论与状态**：完成（A 侧 18/18 宿主确认）。A 侧结论被 `2026-11-18-phase3-t16-safe-apply.md` 的「三轮 18/18、窄 TS7 exit 0，收口于 0504d599」总结。
- **交叉引用**：`t16-a-assertion-review-round3-2026-11-18.md`、`2026-11-18-phase3-t16-safe-apply.md`、`t16-c-binding-review-2026-11-18.md`。
- **过时或矛盾点**：本文说明「本记录补充 A 原有记录，不改写前两轮证据」。

### t16-acceptance-token-2026-11-18.md

- **日期／角色／主题**：2026-11-18／C（平台）／T16 验收令牌与 C 检查点。
- **目的**：修复安装矩阵 API token 期限掩盖产品结果的问题，并记录阶段门槛。
- **承重事实**：
  - 问题：安装矩阵原先只签发一次 5 分钟 API token，各 CLI 进程可运行 15 分钟、全测试可运行 20 分钟；后续操作可能因凭据过期返回 401。
  - 新增 `tests/platform/http-token.test.ts`，使用真实隔离 PostgreSQL/MinIO 和平台签名 helper，独立解码签出令牌并验证签名、issuer、audience、subject 与 CLI client。
  - RED：长任务令牌断言 `300 != 1200`；2 collected / 1 passed / 1 failed / 0 pending，exit 1。GREEN：2/2，exit 0；未传参数仍固定为 5 分钟。
  - T16 安装验收在每次 CLI、匹配、上传、发布、状态查询与兼容请求前重新签发 20 分钟 API token；全部历次 API token 保留于内存 Set，与 registry token 一起检查所有进程原始输出；证据保存前逐个替换为 `[REDACTED]`；泄漏断言只比较布尔值。
  - 未改变生产鉴权、共享默认期限或产品代码。
  - 命令：`build:services` 首次 exit 0 但 5 项均缓存命中，不作为重新构建证据；强制 `turbo run build typecheck --filter=@company/platform-api --filter=@company/preview-gateway --force` 5/5、0 cached、exit 0；窄 TS7 exit 0（module NodeNext、moduleResolution NodeNext、target ES2023、strict、skipLibCheck、esModuleInterop，四个文件）。
  - 强制构建后令牌与 harness 清理回归 3/3、0 failed、0 pending，exit 0；提交前将窄 TS7 增加三个 `tests/integration/project-{apply,rollback,install-isolation}.test.ts` 后 exit 0，证据 `c-checkpoint-typecheck.log`。
  - 此前三文件完整产品结果 84 collected / 73 passed / 11 failed / 0 pending，exit 1，保存于 `product-current-red-84.json`；本轮未重跑真实安装矩阵。失败覆盖 React 权威类型/事件 2 项、固定裸 Node 探针 3 项、pnpm 设置/内部环境 5 项、普通 npm hidden lock 1 项。
  - B 实际 Claude 桌面已收到补修任务，重新挂接指定目录时弹出 Allow 权限窗口，尚未继续产品补修。D 按用户要求恢复默认模型且未使用 `--model` override，文件工具限定重试 3 轮后 exit 1，返回工具调用无法解析，未生成黑盒测试。
  - 原架构文档 SHA-256 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723` 字节未变。
  - 本检查点只提交 C 拥有的测试、harness、brief 与记录，保留 B 产品未提交源码。
- **结论与状态**：完成（令牌基础设施 RED→GREEN）。其中「84/73/11」产品口径为历史值，被后续轮次更新。
- **交叉引用**：`t16-npm-installed-delivery-2026-11-18.md`、`t16-client-resume-2026-11-18.md`、`t16-client-text-delivery-2026-11-18.md`、`2026-11-18-phase3-t16-safe-apply.md`。
- **过时或矛盾点**：本篇同时记载「D 恢复默认模型重试」与 `t16-client-text-delivery-2026-11-18.md` 记载的「用户已授权 D 本次 GLM-5.3」两个时点，后者为更新。

### t16-b23-c24-d20-2026-11-19.md

- **日期／角色／主题**：2026-11-19／C（平台）＋实际 Claude 桌面 B ＋实际 Claude Code D／T16 B23 回归、C24 独立 RED 与 D20 黑盒补充。
- **目的**：接收 B23 产品补丁并回归，新增 C24 两条真实文件系统 RED，收取 D20 黑盒。
- **承重事实**：
  - B/C 工作树 `t16-safe-apply-0026/zhinexus-design-asset-platform`，本轮基线 `ddd2322bd819537339bd0d20727de7b1d03c0109`；D 工作树 `t16-blackbox-cases/zhinexus-design-asset-platform`，基线 `b951f43dd65fef9bd97a564455e608ce6857db42`。实际 Claude 桌面 B 为产品作者，实际 Claude Code D 为独立黑盒作者；C 只机械接收、编写独立 C 测试、验证及维护记录。
  - B22/B23 原始文本 SHA-256 分别 `ea46bceb141ac3cc9620489a001da4734e158db5f249308c93c3bc8faff1a954`、`6b03847ae5a6be4f29b722b80c5f2ffda1b4de1ccd68e70a480fe70ec7018440`；B23 明确采用 B22 九个 hunk，仅修正 apply hunk 两处错误提示与当前文件的差字；补丁 SHA-256 `157c02a6aa9f8f9aa258d887325b1d196ce8a474f3456dde9238241f8fb0cc28`；作者末尾文字截为「未执行；交付完毕，」，保留原样。
  - 固定 Windows Node 26.13.0 / pnpm 12.18.0。
  - C21 窄测（project-apply + project-install-isolation，`-t C21`）：**109 collected / 4 passed / 0 failed / 105 unselected，exit 0**。
  - 完整产品（project-apply + project-rollback + project-install-isolation）：**138/138，0 pending，exit 0**。
  - CLI build/typecheck exit 0；根 fixtures tsc exit 0；十成员检查 exit 0；CLI probe 73 文件零缺失、污染、链接或改动。
  - 根 test 先完成服务构建；T10 node:test **168/168，0 failed/skipped**；Vitest **89 文件 / 1750 测试全部通过，exit 0**；日志 `c24-b23-root-test.log`；存在既有 DEP0190 警告，不声称零 warning。
  - C24 两个新增测试：(1) env 已真实独占创建后、stage mkdir 前移走原 env，在原路径放置无 owner marker 的普通用户树与明确 sentinel 字节，对 stage mkdir 一次 EACCES；完整替换树、移走原树、目标项目都必须保留，零包管理器调用；实际失败于 sentinel 被删除。(2) latest 已真实 rename 成功后，首次 readFile 确认 journal 及真实不可变版本摘要，再把专用祖先移走并置 junction 至同字节 outside 副本；返回 blocked/BACKUP_INVALID；实际失败于目标工程从 2 项变为 6 项。
  - C24 RED：**111 collected / 0 passed / 2 failed / 109 unselected，exit 1**；fixtures tsc exit 0，日志 `c24-red-fixtures-typecheck.log`。
  - D20 为实际 Claude Code GLM-5.3，进程 exit 0 / success / 2 turns；原始 NDJSON SHA-256 `a078784c0ca50fe3718ae796a541f84a2440899140d0e1f42396826ce0aac9a8`；原候选 SHA-256 `512c3380306c8041b48e45708e226ccc219a7d0c852628f388158a07e6ec0176`；接收后 `c03ffe06f790a769902149385d9b9d738e62d6f5f389ef06d1f5e9a9fcee62d6`，新增 8237 bytes；receipt 的 `codeAuthoredByC` 为 false。
  - D20 黑盒命令（设 `T16_D_CLI_ENTRY = '<B/C 工作树>/packages/component-cli/dist/bin.js'`，用 `<B/C 工作树>/.tools/node-v26.13.0-win-x64/node.exe --test`）：**1/1 GREEN、0 skipped，exit 0**，日志 `d20-blackbox-user-edit-02.log`；包含原成功 plan→apply(no install)→rollback，以及再次真实 apply、新 backupRef、明确用户编辑后独立进程 rollback 返回 exit 2 / recovery-required / not-run；四组严格为 restored=[]、unchanged=[]、preserved=[生成路径]、unresolved=[]。第一次错误选择 dist/cli.js 的日志 `d20-blackbox-user-edit-01.log` 保留，不计产品失败。
  - D 三文件全量（cli-required-arguments、cli-input-rejection、cli-apply-recovery）：**5/5，0 failed/skipped，exit 0**，日志 `d20-all-current-blackbox.log`。
  - B24 原文 SHA-256 `4662dec40af0c0c2b68b601b4d55704376d7bb423cdeef639fb73fc57211352e`；九个 hunk 中 install 第一、第六个 hunk 的 old 注释与当前真实文件不符，其余七个唯一匹配；机械接收脚本 exit 1，未修改任何产品文件。
  - B25 已发送同一实际 Claude 桌面 GLM-5.3 High，要求原作者只返修两个完整 diff、明确采用 B24 其余七个 hunk，禁止执行或声称 GREEN。
  - 契约同步窄测（integration-apply、integration-plan、api-schema）：**166/166，0 failed/pending，success true，exit 0**（`c25-contract-sync.json`）。
  - D21 于 `2026-11-18T18:30:49.043Z` 启动，`18:50:49.214Z` 达 runner 20 分钟上限；receipt `timedOut:true`、`exitCode:null`、`parseableResult:false`；原始 NDJSON 18524429 bytes，SHA-256 `bd6c8ef2b98d06c8fb885e777ae35de3e9d07a5f69f99df9c2c04a65faa0925e`；assistant text 和 text_delta 都为零。
  - D22 缩至 28880 bytes 公共上下文，输出上限仅本次为 8192 tokens；要求原摘要变化 exit 2、未知字段/穿越/Windows alias/非法 commands 的输入拒绝与完整真实树零副作用。
  - 架构基线 SHA-256 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
  - 当前验收门槛：B24 GREEN、完整产品回归、独立终审、D 完整黑盒及全图验收通过后，执行 CLI 0.0.14 独立升版提交、一次 pack 冻结、同一 tarball 的真实消费者与平台/浏览器验收；不 push/tag/生产发布，不清理 worktrees。
- **结论与状态**：完成（B23 138/138 + C24 RED + D20 5/5）。被 `t16-b25-c25-d22-2026-11-19.md` 更新（B25/B26 至 141/141、C24/C25 转 GREEN）。
- **交叉引用**：`t16-hot-recovery-2026-11-19.md`、`t16-b25-c25-d22-2026-11-19.md`、`t16-d-blackbox-2026-11-19.md`、`t16-technical-acceptance-2026-11-19.md`。
- **过时或矛盾点**：「根 test 结束后才落 C24 新测试，以上 GREEN 严格对应 B23 与 138 条产品测试的状态」；尚未执行 B23 最终强制全图，历史 B20 结果不能替代。

### t16-b25-c25-d22-2026-11-19.md

- **日期／角色／主题**：2026-11-19（Asia/Shanghai）／C（平台）＋实际 Claude 桌面 B ＋实际 Claude Code D／T16 B25 接收、C25 真实 RED 与 D22 输出失败。
- **目的**：接收 B25/B26 产品补丁、取证 C25 RED，并处理 D22–D27 黑盒交付波折。
- **承重事实**：
  - B/C 工作树 `t16-safe-apply-0026`，HEAD `b779620078854d58235432d6e28a3a115a10b43e`；D 工作树 `t16-blackbox-cases`。
  - B25 原文 SHA-256 `d5fc1d4854db0f653029bbc3a541a46fb8f8f172189aa590b81b75e1026f271f`；采用 B24 原文 SHA-256 `4662dec40af0c0c2b68b601b4d55704376d7bb423cdeef639fb73fc57211352e`；`receive-b25.mjs` 校验双原文摘要、唯一旧上下文和两文件九个 hunk；补丁 SHA-256 `e6e707ca486228b37b88f017b7cf882f2a130ab0ca4fd901e15b549b3561f314`；install 接收后 `59edd2cf4eda923f8fe613334d07196f22eaf8022ba5985561074da6a4044fcd`，backup 接收后 `89cc7de413ef3098dbfbb4e3dd96392850662807665b6b14381cb29d73531a4b`；`codeAuthoredByC:false`。
  - C25 测试：latest 真实 rename 成功后首次 readFile(latest) 窗口，先用真实 fs 读取 journal/version 并核对 schemaVersion、operationId 和版本摘要，然后仅将 operation/versions 复制到独立 outside、移走原 versions 至独立 saved，再在原位置放真实 Windows junction；要求返回 blocked/BACKUP_INVALID、空写入证据、not-run，零包管理器调用。
  - B23 C25：**59 collected / 0 passed / 1 failed / 58 unselected，exit 1**；B25 C24/C25：**112 collected / 2 passed / 1 failed / 109 unselected，exit 1**；两条 C24 GREEN，C25 仍失败于目标完整树从 2 项变为 6 项。
  - 首次 tsc 误用不存在的 `tsconfig.fixtures.json`，`c25-fixtures-tsc.log` 为 TS5058/exit 1；以根 `tsconfig.json` 重跑 `c25-fixtures-tsc-02.log` exit 0。
  - 契约副本（integration-apply、integration-plan、api-schema）**166/166，0 failed/pending，success true，exit 0**。
  - D22 运行 `2026-11-18T18:52:24.942Z`–`19:03:35.208Z`，exit 1、timedOut false、is_error true；原始 NDJSON 5762308 bytes，SHA-256 `0d88941b3547208ea5e1ff69e6b5b2daf8650be48e26c8436edb84a0c6a5645c`；最终 text 为 156 字符的输出超过 8192 token 上限错误。D23 公共上下文缩至 6533 bytes，单次 32000 输出上限。
  - B26 原文 2195 bytes，SHA-256 `3fa689e38c56e1676808ac7d4df13d62fc800b800b71c6b2a92241e3bdbce014`，末尾「未执行；交付完毕」；`receive-b26.mjs` 只接收 backup.ts 一个 hunk，补丁 SHA-256 `a83a5c1035b4e268e321a1b7c3e1a1265550d08e30c054170cbd9ee526cde0a9`，源码接收后 `c9f56d9717139a13685170862a2b1e1719c734ace53e03736e2ccd15e6e1d8a0`。
  - B26 GREEN 检查点：窄回归 **112 collected / 7 passed / 0 failed / 105 unselected，exit 0**；完整产品 **141/141，零 failed/pending，success true，exit 0**；根 fixtures tsc、CLI typecheck、workspace exit 0；强制全图 **20 successful / 20 total，0 cached，exit 0**；完整产品保留 B23 原 138 条，新增 C24 两条及 C25 一条。
  - 独立 reviewer 未发现本轮新增 Critical/Important；version 最终祖先链复核覆盖 versions junction；B26 正文关于 ensureImmutableVersion 未闭合的判断与当前 B25 源码不符（实际 203–212 已在版本读回后复核完整祖先链及叶文件）。
  - 根 test（设 A10_FROZEN_BUNDLE 后 `test`）：exec session 99544 退出回执 exit 0；`b26-root-test.log` 为 **89/89 Vitest 文件、1753/1753 测试通过，357.84s**；T10 独立 Node 子套件 **168 tests / 0 fail / 0 skipped / 0 todo**。
  - 总体只读审查 `b26-overall-readonly-review-2026-11-19.md` SHA-256 `0075020d5e2b9d23739025bd0662610aa89fbff082d7ce22714225ac15b95757`，未建立新的 Critical/Important。
  - D23 运行 `19:06:33.315Z`–`19:08:31.552Z`，exit 0、is_error false；正文 SHA-256 `5540456d5d847169f64a3cf2801c31b4eff01e32e4fae7b955c0dd0c4196a353`；未插入候选（空集合断言容许空对象、issues 子串匹配过宽），退 D24。
  - D24 运行 `2026-11-18T19:13:46.711Z`–`19:17:59.964Z`，exit 0、is_error false；assistant 正文 SHA-256 `082738299cc816b51344fcaf33ad55704e9d102db1520e0c0f01ad3ccfe4ab30`；apply 测试 SHA-256 从 `c03ffe06...` 到 `046defdd63cceb3f1021cafd2adc08893a9604b6a83c9fbcf0a41b2218a5311`。
  - D 三文件固定 Node 运行 `d24-current-blackbox.log`：**5/5、0 failed/skipped/todo，exit 0**。
  - D25 因 commandPreviews 不是公开计划字段、精确重复路径未覆盖大小写别名未接收；D26 原作者返修。
  - 产品聚焦提交 `654accdf`（feat: 实现显式授权接入与可信备份恢复并验证安装隔离），15 文件；版本仍为 0.0.13。
  - D26 运行 `2026-11-18T19:25:59.042Z`–`19:27:37.364Z`，exit 0、is_error false、1 turn；正文摘要 `05ea3cb15076c31cb1f5bdf49042f5657e672cd06461dcc947a2cacb9a894aa1`；新增四类计划控制（未知字段、路径穿越、大小写别名、额外安装参数）使用公开 commands 和 allowedPaths，嵌在一个顶层测试中，总数保持 5；`d26-current-blackbox-03.log` **5/5、0 failed/skipped/todo，exit 0**（第一次 D 工作树无相对固定 Node；第二次错设 T16_CLI_ENTRY 5 项失败于环境要求，`d26-current-blackbox-02.log` 不计产品 RED）。
  - D 文件与独立记录聚焦提交 `4fa6c74a`，随后按原文件集成到 B/C。
  - C 新增服务桥接首次 tsc 写成 `.scripts/pnpm.ps1`，shell 返回 0 但输出明确未找到脚本，不计通过；正确重跑 `.\scripts\pnpm.ps1 exec tsc -p tsconfig.json --noEmit`，`c-d-bridge-tsc-02.log` exit 0。
- **结论与状态**：完成（B26 产品 141/141 + 根 1753/1753 + D24/D26 黑盒 5/5）。被 `t16-technical-acceptance-2026-11-19.md`、`t16-d-blackbox-2026-11-19.md`、`t16-d-installed-recovery-2026-11-19.md`、`t16-main-completion-2026-11-19.md` 更新（升 0.0.14、D27–D56 安装恢复、合 main）。
- **交叉引用**：`t16-b23-c24-d20-2026-11-19.md`、`t16-d-blackbox-2026-11-19.md`、`t16-d-installed-recovery-2026-11-19.md`、`t16-technical-acceptance-2026-11-19.md`、`t16-main-completion-2026-11-19.md`。
- **过时或矛盾点**：本文「上方 B26 尚未接收 / D23 运行中」描述由同文档后续小节更新为当前状态；D27 安装恢复仍开放。

### t16-backup-ancestor-2026-11-19.md

- **日期／角色／主题**：2026-11-19／C（平台）／T16 备份祖先路径独立验证。
- **目的**：用真实 Windows junction 验证备份根上层父目录被替换时的恢复授权边界。
- **承重事实**：
  - 工作树 `t16-safe-apply-0026/zhinexus-design-asset-platform`；基线提交 `b2588db46becf6f93ae8c82bb558a174b1b9fccd`；产品仍为实际 B 的 B12，B15 尚未完整交付。
  - 两个真实 RED（`tests/integration/project-rollback.test.ts`，调用真实 CLI 根出口，用真实 Windows junction、目录快照和 SHA-256 检查副作用）：
    1. 备份根上层父目录为 junction：普通子目录与有效摘要不能授权恢复。当前 rollback 返回结果并删除目标生成文件；预期固定脱敏 `BACKUP_INVALID`，目标与外部备份均零变化。
    2. 创建备份前拒绝上层 junction：缺失的普通子目录不得先在外部创建。当前 apply 返回 `applied`、写入目标，并在 junction 指向的外部目录新建备份目录及文件；预期在任何备份创建或目标写入前拒绝。
  - 固定 Windows Node 26.13.0 / pnpm 12.18.0；证据目录 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/`。
  - 祖先路径窄测：29 collected / 0 passed / 2 failed / 27 unselected，exit 1；`c-backup-ancestor-red-01.{json,log}`。
  - 新增测试根类型检查 exit 0（`c-backup-ancestor-ts7-01.log`）。
  - 三个完整产品文件 **128 collected / 119 passed / 9 failed / 0 pending，exit 1**（`product-b12-c7-full-01.{json,log}`）；原七条安装交付、日志及清理失败仍在，另加两个祖先路径失败。
  - 2026-11-19 本轮差异检查 exit 0；架构 SHA-256 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
  - 根因：当前 apply 先 `mkdirSync(backupRoot, { recursive: true })` 再 realpath；persistBackup 同样先递归创建根；loadBackup 只核验 root、operation、versions 和文件，没有检查 root 上方祖先。
  - B17 brief 已准备，限定 `backup.ts` 与必要的 `apply.ts`；备份临时文件独占、rename 前后父链置换和更宽并发窗口尚未形成完整独立 RED。
- **结论与状态**：完成（两条 RED 取证）。被 `t16-hot-recovery-2026-11-19.md` 的 B17/B18/B19/B20 与后续 B23–B26 更新。
- **交叉引用**：`t16-hot-recovery-2026-11-19.md`、`t16-product-review-2026-11-18.md`、`t16-technical-acceptance-2026-11-19.md`。
- **过时或矛盾点**：128 collected 为当时口径（B12 产品 + 两条新 RED），随后增长至 141。

### t16-c-binding-review-2026-11-18.md

- **日期／角色／主题**：2026-11-18／C（平台）／T16 C 生成绑定辅助器独立审查补充。
- **目的**：对 C 自有的 `tests/integration/t16-support/source-scan.ts` 及其反例测试做独立审查返工。
- **承重事实**：
  - 范围仅为 C 的 source-scan.ts 与独立反例测试，不是产品或完整 T16 验收。
  - 独立只读审查用固定 Node 26.13.0 内存加载实际 helper，发现三类问题：不可达 JSX/逗号表达式被误认为渲染；被丢弃调用返回值被误认为 data；无关函数参数/局部声明污染全局遮蔽判断。
  - RED：`vitest run tests/integration/t16-support/source-scan.test.ts`，15 collected / 12 passed / 3 failed / 0 pending，exit 1；三个失败分别为不可达/丢弃渲染、data 丢弃调用返回值、无关作用域污染。
  - 修复：声明解析限定到引用所在词法作用域；渲染路径排除确定未选中布尔分支及逗号表达式非最终元素；data 值追踪不再包含丢弃调用，callback 调用证据独立处理。
  - GREEN：同命令输出 `helper-final-review-green.json`，15/15 passed / 0 failed / 0 pending，exit 0。
  - 独立类型检查 exit 0（target es2022、module nodenext、strict、skipLibCheck、types node，两个文件）。
  - 恢复本轮后 C 再次执行完整 15 条窄测（输出 `helper-review-resume-green.json`）15 passed / 0 failed / 0 pending / success true、exit 0；`git diff --check` 通过。
  - 历史口径澄清：本轮在 A 返工前宿主曾运行 A 5 条 + 本 helper 原 11 条共 16/16，不是 29 条；早先 24 条日志含临时 helper 检查，当前文件树已无该临时文件。
  - A 的原 5/5 仍有独立断言漏洞，已交实际 Antigravity 返工，不能作为生成绑定验收通过证据。
  - 限制：静态 AST 断言不替代真实安装后 SFC/TSX 类型与构建；产品备份补充 GREEN、真实 8 组合、D 黑盒、最终冻结 CLI 和主分支验收尚未完成。
- **结论与状态**：完成（C 侧 helper 15/15）。
- **交叉引用**：`t16-a-api-cases-2026-11-18.md`、`t16-a-assertion-review-2026-11-18.md`。
- **过时或矛盾点**：本文明确纠正了「16/16 不是 29 条」与「24 条日志含已删除临时文件」两处易误读口径。

### t16-client-resume-2026-11-18.md

- **日期／角色／主题**：2026-11-18／C（平台）／T16 客户端恢复与 D 工作树依赖准备。
- **目的**：记录桌面 Allow 恢复观察、D 默认渠道失败，以及为 D 工作树安装依赖。
- **承重事实**：
  - 本记录追加于 `cc8630b6` 检查点之后。
  - 用户已在 Claude 桌面完成指定目录 Allow；恢复观察时先显示工具调用解析失败，随后新窗口显示 B 原补修任务使用 GLM 5.3 High，处于文件查找阶段；C 未重复发送。install.ts 与 generate-react.ts 文件字节长度和修改时间尚无变化。
  - 先前产品 84 collected / 73 passed / 11 failed 仍为最近完整产品证据。
  - D 在 `t16-blackbox-cases` 工作树按当前默认配置启动真实 Claude Code，未传 `--model`，未改全局配置；实际 init 模型为 `DeepSeek-V4.1-Flash-1017`；最终 3 轮、exit 1、is_error=true，api_error 为 `malformed_tool_use_exhausted`；`tests/acceptance/t16-d` 尚未交付。日志 `d-default-channel-recovery-20261118.log`。
  - B 桌面显示的模型与本次 D 实际启动模型不同，不能推断 D 默认渠道已切换或恢复。
  - C 使用 B+C 工作树固定工具链 wrapper 为 D 工作树执行一次依赖安装：`& '<B+C>/scripts/pnpm.ps1' -PnpmArgs @('--dir','<D>','install','--frozen-lockfile')`，exit 0，pnpm 12.18.0；同一固定 Node 裸探针返回 v26.13.0。
  - D pnpm-lock.yaml 安装前后摘要相同：`250aa048a33c481e0cb64993008ed0553e7b8bf682b8299d43516b37d4c84fae`；安装后 D Git 状态仍仅含原有未跟踪 blackbox brief。日志 `d-worktree-dependencies-20261118.log`。
  - `<B+C>` = `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`；`<D>` = `C:/Users/10208/.codex/worktrees/t16-blackbox-cases/zhinexus-design-asset-platform`。
  - 架构 SHA-256 仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
- **结论与状态**：完成（依赖准备）。其「D 默认模型失败」时点被 `t16-client-text-delivery-2026-11-18.md` 的 GLM-5.3 授权更新。
- **交叉引用**：`t16-client-text-delivery-2026-11-18.md`、`t16-acceptance-token-2026-11-18.md`。
- **过时或矛盾点**：本篇记载 D 默认模型为 DeepSeek-V4.1-Flash-1017 且失败；后续用户授权 GLM-5.3 后作者模型变更，两时点需分别保留。

### t16-client-text-delivery-2026-11-18.md

- **日期／角色／主题**：2026-11-18（含 2026-11-19 追加）／C（平台）＋实际 Claude 桌面 B ＋实际 Claude Code D／T16 实际客户端文本交付恢复记录。
- **目的**：在文件工具持续失败的情况下，以文本 unified diff 方式机械接收 B 产品补丁与 D 黑盒测试，并记录各轮实测。
- **承重事实**：
  - 角色：B 为实际 Claude 桌面作者，D 为实际 Claude Code 作者，C 为 Codex 接收及验收方；不把配置或凭据提交到 Git。
  - D 恢复任务启动参数 `--print --output-format json --tools "" --max-turns 4`，不传模型覆盖、不改全局配置；最终冻结 CLI 尚不存在。
  - B 首份原文 SHA-256 `78788e94aabe841a7d7e093f87fbf9b5036f323234faf64a742141e70c23403d`；install.ts/bindings.ts 两份 diff 用 `git apply --recount --check` 后 `--recount` 应用；CLI build exit 0、probe 73 文件、`git diff --check` 通过；产品三窄测 84 collected / 83 passed / 1 failed / 0 pending，exit 1，唯一失败为 `project-apply.test.ts:740` React 完整 SDK API 内建类型、样式与可选 ref 透传（实际 blocked / BINDING_UNSUPPORTED，预期 applied）。
  - B 第二份整文件回复只收到 11705 字符，截断在 bindings.ts layout regex，SHA-256 `b7e2e1b2923b6a0a839de6da333ca0a6fa90cba44010d1ddaffdabbdd723dbab`，未应用。
  - B 第三份小 diff 8207 字符，SHA-256 `fe27fccbcc0fda94761a5b766d66729fd5705c755aa284fcb067647e14361685`，`git apply --recount --check` exit 1（首 hunk 句号误记为分号），未应用。
  - 仓外安装诊断：`vitest run --config tests/acceptance/t16-installed.config.ts -t vue-npm-standalone` 1 passed / 0 failed / 11 未选择 exit 0；第二轮 `-t hostile|vue-(npm-workspace|pnpm-standalone|pnpm-workspace)` 4 passed / 3 failed / 5 未选择 exit 1；Vue/npm workspace、Vue/pnpm standalone 和 workspace 均返回 `rolled-back / INSTALL_FAILED`。
  - C 独立诊断 `exec tsx .superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c-install-stage-diagnosis.ts` 进程 exit 0；三个案例均在成功生成候选锁和物化之后被 `planDelivery` 拒绝，错误码 `PATH_UNSAFE`，目标逐文件摘要快照未变。
  - 无跟随链接枚举结论：npm workspace 的 `node_modules/@diagnosis/client`、`@diagnosis/peer` 是分别指向已检查 `apps/client`、`apps/peer` 的成员链接；pnpm 两案例根目录均含单链接普通文件 `.modules.yaml` 与 `.pnpm-workspace-state-v1.json`；pnpm workspace 也含同样作用域成员链接；两份 pnpm 元数据包含 stage/cache 绝对路径。证据 `c-install-stage-{diagnosis,entry-diagnosis}.json`。
  - D GLM 文件工具任务 `2026-11-18T11:33:34.991Z`–`11:42:24.398Z`，子进程 exit 1、`error_max_turns / 41 turns`，模型标识 `GLM-5.3`，stdout SHA-256 `5f046844cb57946f8c6bca0cb8a9c31a42ad5804212f25ed93e325d7e1ed7634`，未交付测试。
  - 新会话 `--print --output-format json --tools "" --max-turns 2 --model GLM-5.3`，第一阶段仅请求 `tests/acceptance/t16-d/cli-boundaries.test.mjs`。
  - B 第四份原文 SHA-256 `8e317bef0f894cc47bb1338a50110293014f23ee291c1a727857c708a3fbb863`；作者授权把更正首 hunk 拼回第三份其余八个不变 hunk 并交付 generate-react.ts 小 diff；两份补丁 `git apply --recount --check` exit 0 后原样应用。
  - 第四轮实测：CLI build/typecheck exit 0、probe 73 文件；产品三窄测 **84 collected / 84 passed / 0 failed / 0 pending，exit 0**；证据 `b-glm-patch-04-{build,typecheck}.log`、`product-b-glm-patch-04.{json,log}`。
  - B 第五份原文 `b-glm-original-reply-05.md`，SHA-256 `c28eaa7883d61fc632d87a775396c8c72b12f599e6e48d17891f2d32cb7454d9`；补丁使用 `--- a/...` / `+++ b/...` 无 `diff --git`；C 提取为 `b-glm-diff-05-install.patch`，仅统一 CRLF 为 LF，`git apply --recount --check` exit 0 后应用。
  - 第五份补丁内容：顶层与作用域 workspace junction 收敛到同一成员资格检查（realpath 必须精确匹配已检查成员，未知链接、暂存普通包目标和无法解析的链接失败关闭）；普通包仍执行全树链接/硬链接检查；pnpm `.modules.yaml` 与 `.pnpm-workspace-state-v1.json` 仅在确认为普通、非硬链接文件后省略；未知根条目仍拒绝；交付依赖树不承诺可续用的包管理器增量状态。
  - 第五轮实测：CLI build/typecheck exit 0、probe 73 文件、产品窄测 84/84/0/0；另一个第四轮 React/npm standalone 单例通过（`installed-b-glm-patch-04-react.{json,log}`：1 selected / 1 passed、11 未选择、exit 0）。
  - 第五轮完整真实安装矩阵命令（设 `T16_CLI_ENTRY`、`A10_FROZEN_BUNDLE`、`INSTALLED_CLI_EVIDENCE='D:\project\zhinexus-design-asset-platform\.tools\sdk-label-acceptance-8929ffb81fcf4c90b98352c5f8afbed1\adopt\probe-evidence-adopt.json'`）：最终 **12 collected / 12 passed / 0 failed / 0 pending，exit 0**；四个 hostile 拒绝通过，八组 Vue/React × npm/pnpm × standalone/workspace 均完成真实安装、SDK 精确版本与路径复核、实际生成源码类型检查及 Vite 构建、工程目录迁移后再次类型检查和构建通过；含 Vite .bin 检查、workspace peer 独立 yaml 版本、npm scope 成员链接检查；脚本 poison 未执行。
  - 真实消费者证据 `C:/Users/10208/AppData/Local/Temp/zhinexus-t16-installed-of4jeA`；隔离服务 ID `eaa63104-12fa-44ec-a638-5982836139a6`。
  - D 无工具 GLM-5.3 文本任务（209510 bytes prompt）从 12:18:08.664Z 等到 12:46:22.994Z，28 分 14 秒仍无 stdout；child exit 4294967295、stdout 0 bytes、SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；receipt `d-glm-text-stage1-receipt.json`。随后 12:47:28.327Z 以 GLM-5.3、`--tools ""`、`--max-turns 2` 和 8658 bytes 小上下文重试，前缀 `d-glm-text-stage1-small`。
  - B05 快照独立审查发现 13 项 Important；B06/B07/B08 完整产品依次 97 collected/91 passed/6 failed/0 pending、115/93/22/0、117/97/20/0，均 exit 1；B08 固定 CLI build/typecheck exit 0、probe 73 文件；安装配置清理/name 四条窄测 4 passed / 0 failed / 35 未选择、exit 0。
  - B06/B07/B08 原文 SHA-256 分别 `4e1792f90b1cc64e6021308bd600f77e3e5c74340dae5ab2809bb06b7f49c84e`、`0403bf1a0f36290baaffa112a6ac7671832b26246660cf43fb0226495092c240`、`a468741ce4a0d4d1eab37379a1b985355b85c7401ada1a813f5bc1fbe917251a`；B08 两份补丁用 `git apply --unidiff-zero --check` 后应用。
  - D 首份完整修正版会话 `2026-11-18T13:43:05.668Z`–`13:46:50.079Z`，child exit 0、success、num_turns 1；stdout SHA-256 `2cd98932432d0428cb4ce7ef91eca780caae185d5489898b22c5bc4eef05369d`；落盘 `tests/acceptance/t16-d/cli-required-arguments.test.mjs`，源码 SHA-256 `63824ed39fa0aff40c9668ee9cbfe4f0c227b718fbef3a6b2ddc960ae3e6064b`；Node 26.13.0 `node --check` exit 0；`node --test` **1 passed / 0 failed / 0 skipped / 0 todo，exit 0**；证据 `d-required-arguments-dev-green-01.log`、`d-single-repair-source-receipt.json`；临时目录 `t16-d-cli-required-bBnezt`。
  - D 三条输入拒绝任务 `2026-11-18T13:52:33.230Z` 启动（`d-glm-input-matrix-01`，7078 bytes prompt，GLM-5.3、tools 空、max-turns 1）。
  - B09 原文 SHA-256 `80d1b03e742bb42ed26d6850898cbd43e0be530bd0f08fc978a611b000b679a0`；完整产品 120/100/20/0、四窄测 3 passed/1 failed，均 exit 1。C 纠正首写并发测试期望：零产品写入不得返回 recovery-required，应 rolled-back、空写入证据、not-run、有效 backupRef 与 WRITE_FAILED；纠正测试先 RED，再由 B10 转 GREEN。
  - B10 原文 `b-glm-original-reply-10.md`，SHA-256 `a96859a13830837666d5433956117792e2863e5e1e33a51ec77207e09c1ed0cf`；`receive-b-text.mjs 10` 只提取完整 fenced diff；CLI build/typecheck/probe 73 文件通过；完整产品 **120 collected / 106 passed / 14 failed / 0 pending，exit 1**；五条真实 backup 链接拒绝和首次零提交恢复转 GREEN。
  - D02 运行 `2026-11-18T14:04:52.978Z`–`14:07:24.771Z`，exit 0、success、num_turns 1；stdout SHA-256 `bbb7ceb8299ef003a83f649eca825ab3ea9e46673e434ff8e2180ba560345289`，完整源码 SHA-256 `4115e201f3c8dd4dafd38b343bb668297c06b86b16aead70a029989461edce81`；作者 BEGIN_D_FILE 标记误发成 _FILE；正文范围仅四处 INVALID_PLAN→INVALID_MATCH_PLAN、一处 MatchPlanV1→IntegrationPlanV1；落盘 `cli-input-rejection.test.mjs`。
  - D 两文件真实运行：`node --test tests/acceptance/t16-d/cli-required-arguments.test.mjs tests/acceptance/t16-d/cli-input-rejection.test.mjs`，**4 passed / 0 failed / 0 skipped / 0 todo，exit 0**（`d-input-rejection-dev-03.log`）；02 曾误用 dist/cli.js 不计有效产品失败。
  - D 六案例第一轮 `2026-11-18T14:21:24.644Z`–`14:39:18.948Z`，child exit 1、error_max_turns、实际 num_turns 2（args max-turns 1），stdout SHA-256 `8e107d4ff86ead989e7daac820011970265b3eba7a4c37231ee3513b129861f9`；第二轮 `14:43:16.571Z`–`14:51:43.031Z`，exit 0、success、实际 num_turns 4，prompt 7899 字符 SHA-256 `9e358e147289214f56d25102e20ecff3c7c2a1f8d4ccc4ba4d83225c437d2d9a`，stdout 18796 字符 SHA-256 `05ef80dc00186913b5dcdf96c8c0ec6f2792de17a5635c9ddd04556e29c7c0bf`，result 16766 字符，因多处错误静态拒收；第三轮 `14:56:31.664Z` 启动，prompt 32865 字符。
  - B11 原文 SHA-256 `40fa2df8d6778cc8852b83d878bc53ff72b341bda2cb417e20d112e108c27e63`；`receive-b-text.mjs 11` 机械接收 bindings.ts/apply.ts；CLI build/typecheck/probe 通过，五窄测 5/5，完整 120/111/9/0 exit 1；B12 提示 90123 字符已发送。
  - B12 原文 SHA-256 `06a10b8df6ac3565a6d4e9b03f58e0c705fbce36efb21a462ce90346553a7adc`；八窄测通过，完整 120/119/1/0 exit 1；C 追加四条目录 journal/rename 窗口/stage 与 ready 清理 RED，完整实跑 124/119/5/0 exit 1（`product-b12-c4-full-01`）。
  - B13 原文 `b-glm-original-reply-13.md` 21246 bytes，SHA-256 `b99e89a3a3e9a8e61492fa991a649e0481a247761726bccc1f6aa4bbdaaec536`；接收器因 apply hunks 倒序 exit 1，未应用；B14 提示 162915 bytes 已发送。
  - D03 十分钟超时 stdout 0；D04 十分钟后 exit 1，明确响应超过本次 14000 output token，stdout SHA-256 `38aa8eb11d8ec9466e69816e97c2171374c5100c6f433359455ca0d26d837def`，无源码交付；D05 于 15:23:15.808Z 启动，单子进程上限 32000。
  - B14 原文 `b-glm-original-reply-14.md` 25056 bytes，SHA-256 `13c9e33416139f2ab9a75be41bc41c67ee739f63c1acca798c41f01f2bd2cecb`；`receive-b-text-blocks.mjs 14` exit 1、scope rejected；B15 已发送，提示 `b15-prompt.txt`。
  - D05 `2026-11-18T15:23:15.808Z`–`15:31:42.073Z`，exit 0、is_error false、GLM-5.3、num_turns 2；stdout 28484 bytes，SHA-256 `d737136d16737c2f9558cb87a724b18c477d607a1265229e742c44215e830c7b`，result 25429 字符；静态拒收。D06 `15:40:17.601Z` 启动，公开类型重建提示 9615 bytes，只要求一个真实无安装 plan→apply→rollback 控制。
  - `c-journal-persistence-red-01.{json,log}`：`project-install-isolation.test.ts` 两条日志 I/O 用例，45 collected、2 failed、43 skipped，exit 1。
  - Next 消费者第三轮 `c-next-consumer-red-03.{json,log}`：13 collected、1 failed、12 skipped，exit 1；隔离服务 ID `3a6bd922-45b3-4bfa-8211-fdfefb2c7ca4`；消费者固定 Next 16.4.6、Node 26.13.0、`@types/node` 26.6.6；CLI apply 为 applied/succeeded；预渲染报 `TypeError: (0 , ad.useRef) is not a function`；生成原文件 SHA-256 `2e116db9104be35571a6ffeef12ef89717995c9164598cea34dbf2357b91f66a`。
  - B12 未接收 B15 时完整产品 `product-b12-c6-full-01.{json,log}`：126 collected / 119 passed / 7 failed / 0 pending，exit 1。
  - D06 原进程最终 `2026-11-18T16:00:17.708Z` 结束（started 15:40:17.601Z），timedOut true、exitCode null、stdout 0 bytes；D07 于 16:02:34.190Z 启动，提示 30844 bytes。
- **结论与状态**：完成（B01–B15、D01–D07 各轮接收与实测记录）。其计数被 `t16-product-review-2026-11-18.md`、`t16-hot-recovery-2026-11-19.md`、`t16-b23-c24-d20-2026-11-19.md`、`t16-b25-c25-d22-2026-11-19.md` 持续更新至 141/141。
- **交叉引用**：`t16-acceptance-token-2026-11-18.md`、`t16-client-resume-2026-11-18.md`、`t16-product-review-2026-11-18.md`、`t16-npm-installed-delivery-2026-11-18.md`、`t16-d-blackbox-2026-11-19.md`、`t16-d-installed-recovery-2026-11-19.md`。
- **过时或矛盾点**：本文为多时点追加记录，早期检查点（如 84/73/11、84/83/1）保留为历史，由后续轮次更新；文中明确「早先 24 条日志含临时 helper 检查」等口径需按各自时点读。

### t16-d-blackbox-2026-11-19.md

- **日期／角色／主题**：2026-11-19（Asia/Shanghai）／C（平台）＋实际 Claude Code D（GLM-5.3）／T16 D 独立 CLI 黑盒接收记录。
- **目的**：按完整原文和唯一锚点机械接收 D 三份黑盒测试并实跑，含冻结 CLI 补验。
- **承重事实**：
  - 测试由实际 Claude Code GLM-5.3 编写，C 仅机械接收，没有代写 D 断言。
  - 参数文件 SHA-256 `63824ed39fa0aff40c9668ee9cbfe4f0c227b718fbef3a6b2ddc960ae3e6064b`；输入拒绝文件 `4115e201f3c8dd4dafd38b343bb668297c06b86b16aead70a029989461edce81`；apply/recovery 文件 D24 原文摘要 `082738299cc816b51344fcaf33ad55704e9d102db1520e0c0f01ad3ccfe4ab30`、D26 原文摘要 `05ea3cb15076c31cb1f5bdf49042f5657e672cd06461dcc947a2cacb9a894aa1`、D26 插入块摘要 `6bd08f7eb541bf31186aed4c4b3808fbbbc0e0bf6d3e495c8e8f96606de69127`、最终文件摘要 `56d7e1f68350882b2a3899eef9f3cf54dbdbb5b42d8853f439669369d9da5a17`。
  - D25 使用非公开 commandPreviews 字段且未真正建立大小写路径别名，未接收；D26 使用公开根 commands/allowedPaths，建立未知字段、路径穿越、大小写别名和额外安装参数四类拒绝控制；每项来自真实成功计划，并检查 exit 1、单 JSON INVALID_MATCH_PLAN、完整工程/备份树及计划原字节不变。
  - B26 开发构建实跑（固定 Node 26.13.0，`T16_D_CLI_ENTRY` 指向 `packages/component-cli/dist/bin.js`）：`d26-current-blackbox-03.log` **5 tests / 5 pass / 0 fail / 0 skipped / 0 todo，exit 0**。
  - 冻结 CLI 补验：三份既有 D 文件用仓外真实安装的 CLI `0.0.14` 入口执行相同 `node --test`，**5 tests / 5 pass / 0 fail / 0 skipped / 0 todo，exit 0**；tarball SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`；日志 `d26-frozen-blackbox.log`。
  - D27 超时 20 分钟且无完整 assistant text 源码，raw SHA-256 `668fac2a4e10cef7ab165f050b5d709991f156d6498804f820075684db9009aa`，未接收。
  - D28 进程 exit 0、8 分 30 秒返回源码，raw SHA-256 `d523ef7d860c29f66660e6b62e17aea6faa6d5e68558cc0f0d993053ff1036b6`；因 URL/路径混淆、基线 npm 凭据继承、配置路径为目录、毒脚本无实际 marker、源码快照含 node_modules、数组读作对象及占位断言静态拒收，未运行测试。
  - 冷无效备份公开 CLI 契约为 exit 1、单 JSON error/EXECUTION_FAILED、固定脱敏和零写入，不要求虚构 recovery-required 报告。
  - 字段篡改控制必须建立可达的真实引用与 journal，不能以引用摘要失配冒充字段校验。
  - 后续 D29 输出上限失败、D30 提高上限重试；实际安装恢复黑盒由 `t16-d-installed-recovery-2026-11-19.md` 续记至 D56 并 GREEN。
- **结论与状态**：完成（D26 开发构建与冻结 CLI 均 5/5）。安装恢复部分由 D27–D56 承接，最终在 `t16-d-installed-recovery-2026-11-19.md` 与 `t16-main-completion-2026-11-19.md` 收口。
- **交叉引用**：`t16-b25-c25-d22-2026-11-19.md`、`t16-d-installed-recovery-2026-11-19.md`、`t16-technical-acceptance-2026-11-19.md`、`t16-main-completion-2026-11-19.md`。
- **过时或矛盾点**：本文 2026-11-19 补验节中「main 未合并」在技术验收与 main 收口记录后已更新为已合并（`40910dc4`）。

### t16-d-installed-recovery-2026-11-19.md

- **日期／角色／主题**：2026-11-19（Asia/Shanghai）／C（平台）＋实际 Claude Code D（GLM-5.3）／T16 D 冻结安装恢复独立验收。
- **目的**：把 D 安装恢复黑盒拆分为多模块由原作者交付、机械接收并最终在冻结 CLI 上实跑 GREEN。
- **承重事实**：
  - 追加于 `t16-technical-acceptance-2026-11-19.md` 之后，保留 D27–D29 原始失败与未交付记录；B26 产品作者已停写。
  - D30：同一 prompt，仅将子进程 `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 提高到 32000；UTC `2026-11-18T20:04:26.469Z`–`20:10:46.600Z`，exit 0、success、1 turn，GLM-5.3；原始 NDJSON SHA-256 `2ac5e3027b9d9cdc48e3d5b6eb2e16e9a0cbedb33288c272fa98cc26da057501`；唯一完整 fenced 源码 96 行；`tests/acceptance/t16-d/installed-support.mjs` 源码 SHA-256 `bad91a6ff41b8989638bbeae74e4a9c68f349ee4b164849830312a5dfb7ff045`；独立静态审查 Critical 0 / Important 0 / Minor 1；Node 26.13.0 `--check` exit 0。
  - D31 超时（UTC `20:25:16.840Z` 达 600 秒上限，exitCode null、timedOut true、无 result；raw 13965905 bytes，SHA-256 `89c900dca8f119531ffb9c8bc1a8fadac17bcfa7c4744d8deeb291b7bfb4c9a1`）。
  - D32 brief 纠错：`installedVersions` 不是 Record 而是 `IntegrationDependency[]`，每项 `{name,version}`；C 于 UTC `20:27:47.797Z` 主动停止尚无交付的 D32（exit 4294967295），不把 brief 错误计作产品 RED。
  - D33/D34 均仅 thinking（66351 / 64833 / 128786 chars）无源码，raw SHA-256 分别 `95c26a1d1237c05c0b2ec78fb230bf8d1a41f9be16ade3644312342b5b2b8c18`、`f5bc4d68ea06926c75ba0c61664ba202f9fdf4fd949855124b4c5594428b2ba7`（8348621 bytes）。
  - 隔离手段演进：`--tools ""` 只关闭 built-in tools，必须 `--strict-mcp-config` 配合空 `--mcp-config`（D38b 出现无参数 `mcp__playwright__browser_run_code_unsafe` tool_use）；后续加 `--safe-mode`（D50）与简短 per-run system prompt（D34）。
  - 已提交区间 `c067c81d..5d9961d2` 独立全分支只读审查新增 Critical/Important/Minor 均 0；记录 `c-premerge-overall-readonly-review-2026-11-19.md` SHA-256 `b599cf46ea90c50df16ee05c1593474839e661d17065f8ea087e0a038308d0be`。
  - D35/D36：D35 UTC `20:40:21.073Z`–`20:44:31.084Z` exit 0、raw SHA-256 `6f297ebeed7ff0172ac5821548aeae16c4487d7bb760664310908d1fe6325adb`（SOURCE 快照漏 excludeRootNodeModules:true，未执行）；D36 UTC `20:46:09.764Z`–`20:46:49.732Z` exit 0、raw SHA-256 `3e3880cd3586282e0c1c0f64683fe0b430fab40795337d37b80e7af0e0c739bf`；机械接收为 `installed-plan.mjs`，源码 SHA-256 `5be9c61b8f2de5834354a2864d076be3c33bbef1c4f2ac1fd26c25d77c328ad5`。
  - D38/D38a/D38b/D38c/D38d/D38e：D38 UTC `20:58:23.032Z`–`21:02:47.023Z` exit 0、raw SHA-256 `179626b1a0915d746b868bc88de54b5f733983f587ba491feeca4f6d3488d767`；后补「转义误诊更正」：C 曾把工具输出 JSON 转义误当作源码字节，实际字面量为两个反斜杠字符（92,92），D38 原行本来可以归一 Windows 路径，不是 D 缺陷也不是产品 RED。最终接收 `installed-start.mjs`，1491 bytes、29 行，源码 SHA-256 `2fa93b7c2a8272c6aa694c9829dc4f5f1f1aa01f51300097f2d818cc117810c5`；receipt `d38-d38d-d38e-received.json`。
  - D39：UTC `21:24:24.285Z` 结束，exit 0/success、2 turns，raw 3288623 bytes，SHA-256 `c7a94a10b9eed991c7961682fd91b22a53615be7242706c30f301f7251579a28`；接收 `installed-report-files.mjs` 2210 bytes，SHA-256 `148c0d8811568109c0034a9b6d0037895d4d46e835699c42c4cc00d436ceca60`。独立审查发现 Important1（期望 hashes 由已排序 diff 生成但报告 beforeHashes/afterHashes 未排序即按索引比较）与 Minor1（只挑 path/exists/sha256 字段）。
  - D40：UTC `21:24:52.783Z`–`21:26:30.724Z`，exit 0/success、1 turn，raw SHA-256 `26dabb9bc98cb2dd47a37be5994c9844480f5338a53f32167c91c1ea1ce700ed`；源码 2069 bytes，SHA-256 `d37badaf03d5a898df4b5f7d08059df74a0dfdd4734ea7e64beebbb97afebb9f`。
  - D41w 批次 brief `d41w-three-wrappers-brief.txt` SHA-256 `9347f1aa0f11cb10442d5fc1cf6353936e66f9948880c6bf8a5f159dffd6f058`；UTC `21:36:26.298Z` 结束，raw SHA-256 `0e984fa4263620bb5ff24f08eb92e12d4fdb36b1318bc275fdc1c0507cc8c8b9`。实收四文件：`installed-report.mjs` `b2987d6ef3d97837b2dc384e774dceb532379f830a54c7cb412fcaddf9c80472`、`installed-fields.mjs` `9a04ac98aa3100afaedd6e95520c0900fe9cd464d8974ed4c9d3059a2f15388a`、`cli-installed-recovery.test.mjs` `8ceaf3afe3b829f10664dc4007b33b573466d36480b2ea3d9505f6aa383f79e5`、`installed-report-files.mjs` `c98da9425d43901c1f655c371854e298b11e7268bce7b168d941e4727ef4598f`。
  - D42/D42a：D42 有 Important2（版本文件名漏 `backup-` 前缀；仅排序 doc.files 路径却直接比较未约定排序的 plan.allowedPaths）；D42a UTC `21:36:51.142Z`–`21:38:28.583Z` exit 0/success、raw SHA-256 `96149100b2eb29fe03eba81dfe72ad2f38a565452fac317509cdb884112b755b`；接收 `installed-backup.mjs` 3160 bytes，SHA-256 `5721e738ab1f0dbcdc803603ba1e0bfa6592f139d18bee0912cee2c84204e302`。
  - 最后字段批次 brief `d45f-field-batch-brief.txt` SHA-256 `b32e4a66d16911536e669fed7bde388253cb7fe080d370c60fe05bf033c01a11`，6189 bytes。
  - D43 超时（UTC `21:48:54.437Z` 达 600 秒，raw 5929952 bytes，SHA-256 `ea072f7230b37719795091b9286eeed00996498c6e25f17cd6ed435a3efa9c65`）。
  - D45f 只有 676 chars 六个 PowerShell 查找命令，未接收；D45 final result 只有 38 字符仓库发现说明，未接收。
  - direct49 编排 SHA-256 `3575fcaa372d07d4c80b8e1aa1cfadfc3997a324c23bcf05a67adc0836def2ee`；safe50 编排 SHA-256 `d4541818aff7b91137c8b92eb6afe2b35f2511b70fa5cd3916e24e956b76be49`。
  - D46 候选 `installed-field-cases.mjs` 2658 bytes，SHA-256 `b9fc8aed83b96da6ed228b2bcc1834c83d1608c59e484a1b464cc2969d7e5da6`；helper 的 verify 回调必须取得深拷贝，避免回调还原用于实际篡改的文档。
  - D50 候选 3313 bytes，SHA-256 `24154df17dd0bf7b802b4fc0fd6fe049e3126381a7098e1b717a52298d01b893`，两个 Important（async 快照与 CLI 调用缺 await；第一次 verify 会还原 mod）。返修 brief `d51-tamper-repair-brief.txt` SHA-256 `7f4460e13838d93c4241e83c69acc9caacf98b3c8bebdfab9b973fd11cbc1e7b`。
  - D51 候选 `installed-field-tamper.mjs` 3645 bytes，SHA-256 `e44d419c74afcf781deccd469f0bbbd78b6668a494efd00d1703ca0371075b83`，按独立审查记录 SHA-256 `757dd11dce01a41d420cffc9b891b629a4a6d4c616a401ae0557fe721e22c914` 原字节接收。
  - D52 四模块批次 brief/runner SHA-256 分别 `ba36d403560989612bc3baf64ddf212d9bd7da95654dc1503dd66663f1c6f2f9` / `18fa692b3a4f9b5933553e930ddea56f7a7c5fbfbed0a93ccecba1d80fa64353`；按审查记录 `a963d087ac1498f4d7590399d7d64911cded19667d93446857acda794948e830` 原字节接收。
  - D53 原源码 4071 bytes，SHA-256 `e3ea534a71c240d67aeda03877d19a8d7935e17ef3be00f9d82b2537e3fb605e`；D54 补授权收据；D55 仍缺明确授权；D56 使用 receipt-only runner54，UTC `22:41:42.334Z`–`22:42:16.844Z`，exit 0/success、1 turn，brief SHA-256 `654798c69d87a945ee772f23cd8911946eab6f9293de6ca8c351ec5587f170b4`，raw SHA-256 `e42c19749b4bcd4a9fa9175d015f0397de413d10841785f8c76473d27956dd4c`；receipt `d53-d56-received.json` 绑定 D53 result SHA `eb1fd5e67500456f311ace45c574b6a09e9eeea882af6c19242779d260b17b1f` 与 D56 result SHA `b08c13546fd65cb909d16ae311395f00e832dda4fd6993e3d8aa3303a79f5838`；最终 `installed-stale.mjs` 固定 Node `--check` exit 0。16 个模块至此均为实际 D 交付。
  - C 为两个原 detached worktree 创建保留分支 `feat/t16-safe-apply-final` 和 `chore/t16-installed-blackbox-final`；main 仍为 clean `c067c81d2751b1d7cf9a04e7c15b6d7d276d014d`，尚未合并。
  - **实际冻结 CLI 安装恢复 GREEN**：通过 `scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t16-installed.config.ts','-t','D independently verifies installed frozen CLI installation and recovery','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/cli-0014-d-installed-01.json')`，设同一 `PHASE3_CLI_TARBALL`、`A10_FROZEN_BUNDLE`、`INSTALLED_CLI_EVIDENCE`，`T16_D_TEST_FILE` 指向 D 主 runner；最终进程 exit 0；Vitest 14 collected / 1 passed / 0 failed / 13 unselected。
  - 随机真实 PostgreSQL/Verdaccio/MinIO 隔离服务 ID `c9692e53-c49f-4717-b2c7-58ac697c5607`；仓外 `zhinexus-t16-installed-aIvqa2` 实际安装 CLI `0.0.14`，经 `node_modules/@company/component-cli/dist/bin.js` 执行 D 的 `node --test`：1 passed / 0 failed / 0 skipped / 0 todo、code 0、stderr 空；stdout 明确完成 start → checkBackup → checkFields（fields 与 stale）→ checkRecovery 四段。实际 D 工程与证据位于仓外 `t16-d-xdG6GV`。
  - 覆盖：真实 npm 基线与受控安装、禁生命周期脚本、真实报告及磁盘差异、版本与备份原字节核对；originalBase64、projectRoot、operationId 独立字段篡改；真实旧不可变 version 的冷 stale-ref 均受控拒绝，SOURCE、整个 BACKUP 和异项目目录保持零写；wrong-SHA 冷恢复拒绝后有效恢复返回正确状态，源文件原字节恢复、生成文件消失，node_modules 保留并报告 reinstall-required。不声称运行时竞态。
  - 原始证据 SHA-256：`cli-0014-d-installed-01.json` `4f5dfb09586223cea80bc2d19d9f88ad6dba863fcfeb8ab9903bb4794b9eaf8c`；`zhinexus-t16-installed-aIvqa2/d-installed-recovery-process.json` `159a7bada8f423c98ffa1493373cbc880969394b2b8015cb21ffadd55cfe60fb`；`t16-d-xdG6GV/evidence/installed-stale-apply-06838ca37a30a31da2eccdc0.json` `d0427eeed0c44d19da1839db867efa730b1448cf8844930f84b9c38f6ce3f11f`。
  - 冻结 CLI tarball SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207` 未重新 pack；架构 SHA-256 `e59bb77e...` 未变；`productionAcceptance: false`。
  - 最终 D/C 增量独立审查新增 Critical/Important/Minor 均 0；16 个模块与作者来源摘要一致，11 份保留候选与目标全文一致；审查记录此时 165094 bytes，SHA-256 `15e666bdbebf4cc6cb9fe700a5b3881c2d33dcf9f1242ee9dea249ec7ef63445`；命令事后索引 `cli-0014-d-installed-01.command-index.json` SHA-256 `46700ca644b70890cabb5ce2cb350b2310cbfc4d88b1acc27b7d6756d7b4f13f`。
  - 16 模块在 D 保留分支提交 `9bca63fd`，原样 cherry-pick 到 B/C 为 `11659bca`；C 真实服务桥接单独提交 `b20921b9`；提交前固定 Node `--check` 16 次、暂存 diff check 均 exit 0；D 提交前 16 文件为 index LF / worktree LF，B/C cherry-pick 后为 index LF / worktree CRLF，归一 CRLF 后 16/16 正文逐字一致。根回归已实际通过 Vitest 1753/1753、T10 168/168。
  - main 默认入口复验：本地快进合 main 至 `40910dc46db7bef0db0d17dee0d31b94a8f2ea6d` 后移除 D 文件路径 override，完整冻结 T16 实际运行 14/14、零 failed/pending/todo、exit 0；D 默认 main 模块四段真实安装恢复控制 1/1、零 failed/cancelled/skipped/todo，process code 0、stderr 为空；随机隔离服务 ID `4caec703-11f5-483c-aeeb-aa1437cd37c0`；仓外消费者 `zhinexus-t16-installed-yKUag3`，D 工程 `t16-d-r8odcu`，ref `apply-7573988ebf1eadf2919575a3`；process 记录 SHA-256 `3ac76983979c2ec46b602bbb169857ca617687ea14b72d2a46bcaea21500a9e7`。
  - 保留两项非阻断 Minor：D30 超时/启动失败诊断的持久化范围；D41w 早期主 runner 的路径日志。
- **结论与状态**：完成（D 安装恢复 1/1 GREEN，含 main 默认入口复验）。
- **交叉引用**：`t16-technical-acceptance-2026-11-19.md`、`t16-d-blackbox-2026-11-19.md`、`t16-main-completion-2026-11-19.md`、`t16-b25-c25-d22-2026-11-19.md`。
- **过时或矛盾点**：本文内「main 仍为 clean c067c81d，尚未合并」在同一文档末尾已被合入 `40910dc4` 更新；D38 转义判断的自我更正已显式记录。

### t16-hot-recovery-2026-11-19.md

- **日期／角色／主题**：2026-11-19／C（平台）＋实际 Claude 桌面 B ＋实际 Claude Code D／T16 同次 apply 恢复与目录所有权补测。
- **目的**：验证同次 apply 内从可信内存备份恢复源码、stage/ready 精确所有权标记与三条真实故障注入 RED。
- **承重事实**：
  - 工作树 `t16-safe-apply-0026/zhinexus-design-asset-platform`；基线 `7797c3c14b477f167bced9f09e9a4c50b05bd646`；产品源码来自实际 Claude 桌面 B18/B17/B19。
  - B19 完整三个产品文件 **132 collected / 127 passed / 5 failed / 0 pending，exit 1**（`product-b19-full-01.{json,log}`）；四条失败来自 stage 所有权标记与原测试 helper 白名单不一致；另一条来自日志写入窗口 backupRoot 被真实 junction 替换后同次 apply 的源码恢复仍读取已不可信磁盘备份路径，`BackupError` 上抛。
  - B19 固定 CLI build 与 typecheck exit 0，probe 73 文件复核通过；开发 CLI 的 Next App Router 普通 Server Page 真实消费者复跑 13 collected / 1 passed / 0 failed / 12 unselected、exit 0（`c-next-install-diagnosis-01.{json,log}`）；控制构建与生成 React 客户端组件的消费构建均完成 Next 16.4.6 webpack、类型与预渲染。
  - C 三条 RED（`project-install-isolation.test.ts`）：(1) 必须真实恢复源码至故障前快照，返回 `rolled-back + reinstall-required + INSTALL_FAILED`；(2) 用户改写已生成源码后再替换备份祖先，原编辑字节必须保留，返回 `recovery-required` 与同路径 `USER_EDITED`；(3) 备份祖先替换后对生成文件删除注入真实 `EACCES`，文件保留，返回 `recovery-required` 与同路径 `WRITE_FAILED`，不得冒称用户编辑。
  - 三条 RED 窄测 **51 collected / 0 passed / 3 failed / 48 unselected，exit 1**，均失败于 `BackupError: 备份根不是普通目录` 上抛；根 fixtures 类型检查 exit 0（`c-fixtures-typecheck-03.log`）；`-02` 为显式 `-PnpmArgs` 复跑的 RED。
  - Ruling 1：stage/env/ready 的精确内部所有权标记是安全清理依据；只允许本次操作、固定 role 与 kind 的精确普通单链接文件；helper 必须验证字节和操作身份，不扩大任意隐藏文件白名单。
  - Ruling 2：同次 apply 可使用最近一次成功 persistBackup 的可信不可变内存版本恢复源码，必须绑定 reference id/hash、项目、计划及原字节；未成功持久化的候选不能作为恢复依据；磁盘路径被替换后不得读写它；冷启动 rollback 仍须完整验证磁盘备份与祖先路径。
  - B20 原文 `b20-desktop-raw.txt` 11845 bytes，SHA-256 `243cb9c7df9d2db00a7a037ed04c6d77737a611c96d3b86edae1b3328a56d003`；末尾原文「未执行；交付完毕，停写待C实」；六个 hunk 唯一有序命中；范围为 apply.ts 与 expectStagingClean helper。
  - B20 GREEN：三条恢复测试 51 collected / 3 passed / 0 failed / 48 unselected、exit 0；完整产品 **134 collected / 134 passed / 0 failed / 0 pending，exit 0**；CLI build/typecheck、根 fixtures tsc exit 0，probe 73 文件；workspace 十成员通过；强制全图 **20/20、0 cached、exit 0**。日志 `b20-cli-{build,typecheck}.log`、`b20-fixtures-typecheck.log`、`b20-workspace.log`、`b20-full-graph-02.log`；首次全图命令同时传 `--force` 与 `--cache=local:rw` 被 Turbo 拒绝，`b20-full-graph.log` 不计作验证。
  - C21 三条 Important：真实源码提交后登记晚于读回；备份 temp 写入后提交前缺少原始路径链复核；安装根 recursive mkdir 会认领窗口内出现的未知用户树。
  - C21 四条真实文件系统注入 RED `c21-review-red-02`：**109 collected / 0 passed / 4 failed / 105 unselected，exit 1**（残留源码原树 2 项变 6 项、version/latest 改动 outside、用户 sentinel 被删除）；首版 `c21-review-red-01` 保留作历史。
  - B20 根 typecheck 14/14、14 cached；根 test 实际 exit 1：T10 node:test **161 passed / 7 skipped / 0 failed**；普通 Vitest **89 文件（88 passed / 1 failed）、1749 tests（1744 passed / 3 failed / 2 skipped）**；三失败对应新增 C21；日志 `b20-root-{typecheck,test}.log`。
  - B21 四次 Read 均报 `required parameter file_path is missing`，无产品 diff；B22 发送自包含文本，prompt 189761 bytes，SHA-256 `04203827cc668e82b4b3bf6f28d0d32d6b51b61684854ddc2d2d50671d9fec2e`。
  - D12 十分钟超时、无 parseable result，输出仅持续 thinking；8,146,668 bytes 原始 NDJSON，SHA-256 `171ffb4bc950ca7e9fc6c27ad8de5af98be35ff56df158e5f8408c49e98b1316`。
  - D13/D14 均 exit 0 / success 但未接收（D13 引用不存在的 stderr 字段；D14 规范编码将 primitive 再次转字符串后 JSON.stringify，摘要不符合公共完整规范 JSON 契约，且末尾 sentinel 截断）；D14 原始 NDJSON 62139 bytes，SHA-256 `fc304ef1f59f94759704bc9681a12ddd86563e2fb3f5a9c13089906585f62e76`；D15 exit 1、明确报超过 4096 output token 上限，2,446,318 bytes 输出 SHA-256 `9169168af75de6b5dc2d2637341cc91a28d2635732e148eb8e767d1dead1763b`。
  - 公共契约与 Schema 复核 `c22-contract-schema-01.json`：**113 collected / 113 passed / 0 failed / 0 pending，exit 0**。
  - Docker 引擎只读预检可用；后续验收创建独占随机端口服务栈，不能使用共享现存容器冒充验收。
- **结论与状态**：完成（B20 首个 134/134 全绿 + C21 RED 取证）。被 `t16-b23-c24-d20-2026-11-19.md`、`t16-b25-c25-d22-2026-11-19.md` 更新至 141/141。
- **交叉引用**：`t16-backup-ancestor-2026-11-19.md`、`t16-product-review-2026-11-18.md`、`t16-b23-c24-d20-2026-11-19.md`、`2026-11-19-t16-b21-review-brief.md`（汇编小节）。
- **过时或矛盾点**：B20 根 test exit 1（1744/3/2）为当时真实状态，不得称根回归通过；B21 接收后需完整复跑（后续 B26 阶段根 1753/1753 全通过）。

### t16-main-completion-2026-11-19.md

- **日期／角色／主题**：2026-11-19（Asia/Shanghai）／C（平台）＋实际 Claude 桌面 B ＋实际 Claude Code D ＋ A／T16 技术交付本地 main 收口与复验。
- **目的**：把 T16 技术交付本地快进合 main 并在 main HEAD 上完整复验。
- **承重事实**：
  - main 合并前 `c067c81d2751b1d7cf9a04e7c15b6d7d276d014d`；来源分支 `feat/t16-safe-apply-final`（B/C worktree）；本地 `merge --ff-only` 后 main 与来源 HEAD 均为 `40910dc46db7bef0db0d17dee0d31b94a8f2ea6d`；合并后树 `c51c1932af4a445e7e00514f223ea3435481ca70`，main 与 B/C 全树一致且 clean。
  - 聚焦提交：`654accdf`（B26 产品 GREEN 收口）、`2fca59cf`（CLI 升至 0.0.14 并同步 CHANGELOG）、`a6e7dc3d`（C 浏览器契约模块路由修正）、`11659bca`（原样 cherry-pick D 16 模块，原作者提交 `9bca63fd`）、`b20921b9`（C 桥接，17 行环境及进程编排）、`1f1566af`（D 交付与最终回归独立记录）、`40910dc4`（区分 D 接收前后行尾证据，补充集成根 tsc）。
  - 固定 Node 26.13.0 / pnpm 12.18.0；冻结 SDK 同时设置为 `A10_FROZEN_BUNDLE` 与 `ZHINEXUS_SDK_BUNDLE_DIR`；消费者使用同一 `PHASE3_CLI_TARBALL` 与 `INSTALLED_CLI_EVIDENCE`；`T16_D_TEST_FILE` override 已移除，原始 receipt 的 `dTestFileOverride` 为 `null`。
  - main 原始证据根 `D:/project/zhinexus-design-asset-platform/.superpowers/sdd/2026-11-19-t16-main/`；每项保留开始前 receipt、结束后 exit/日志摘要和独立 `.exit.txt`。
  - 七项 main 验证：`main-install`（install --frozen-lockfile）exit 0；`main-workspace`（verify:workspace）10 成员、无环、服务依赖闭包合规 exit 0；`main-force-build-typecheck`（exec turbo run build typecheck --force）20/20、0 cached exit 0；`main-root-tsc-02` exit 0 空日志；`main-root-test`（test --maxWorkers=2）先 build:services，Vitest 89 文件/1753/1753、T10 168/168、零失败/跳过 exit 0；`main-frozen-t16` 14/14、零 failed/pending/todo exit 0；`main-contracts-browser`（exec playwright test --config tests/playwright.config.ts contracts-runtime.spec.ts）真实 Chromium 1/1 exit 0。
  - T16 JSON 全部 14 个 assertion 逐一核对：Vue/React × npm/pnpm × standalone/workspace 八组安装、类型/构建与迁移；两种包管理器 × hostile `.npmrc`/`.pnpmfile.cjs` 四组拒绝；Next Server Page 一项；D 默认入口冻结安装恢复一项，全部 passed。
  - 此前 B/C 实际完整浏览器 287/287、冻结 T15 25/25、D26 既有黑盒 5/5 已通过；平台首轮 135 项通过/2 项跳过，随后真实画廊独立补验 2/2；不改写首轮为 137/137。
  - main 日志 SHA-256：`main-install.log` `e68c70e53da46840d04242cdabe1b7a759496549257e2a4d456696ab043dc0af`、`main-workspace.log` `6937eb8c08c6db032212b3ac8189bd2d5ae43801e6e3641c8ff956a7d3161732`、`main-force-build-typecheck.log` `522a1367dfb113c4a3bc13fcbd30a4882a64af05efc9fa3be4bd7067d2918e64`、`main-root-tsc-02.log` `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`、`main-root-test.log` `496a5ee370144838bc3a673135593b793719909f93f38d0a2220c0c35151e22b`、`main-frozen-t16.log` `ad172e3bac8c01720d677b843842b2cf442193a4e6b2f78d07815b02694d78f7`、`main-contracts-browser.log` `65124141b9128e4973756f3fbc91ac93c47883853476ce67f496e0a2236b3127`。
  - `main-frozen-t16.json` SHA-256 `ec0990c07ec94bb28ccc00e17c6ad05998cb3a3a7dc90f864e0e55917a8f95dd`；`main-verified-results-index.json` SHA-256 `8bf1bff08a2e56cefee1f8f4bca4dc89eca372b8bd4706b96fefd92763d4a8b1`（含七份 receipt SHA，明确标记 `post-run-verification-index`）；`main-post-merge-tree-identity.json` SHA-256 `ee33d397f97224d488c1aaa189051176a0b82b8f1d3c5cd0a51fa978f7924c50`。
  - main D 默认入口真实执行：随机隔离服务 ID `4caec703-11f5-483c-aeeb-aa1437cd37c0`；消费者仓外 `zhinexus-t16-installed-yKUag3`；D 临时工程 `t16-d-r8odcu`；备份 ref `apply-7573988ebf1eadf2919575a3`；`node_modules/@company/component-cli/dist/bin.js` 运行冻结 CLI 0.0.14；D 来源为 main 默认 `tests/acceptance/t16-d/cli-installed-recovery.test.mjs` 及其 15 个辅助模块；`d-installed-recovery-process.json` code 0、stderr 空，stdout 记录 start、backup、fields、recovery 四段均实际完成；`node --test` 1/1、零 failed/cancelled/skipped/todo；进程记录 SHA-256 `3ac76983979c2ec46b602bbb169857ca617687ea14b72d2a46bcaea21500a9e7`。
  - 字段篡改与旧不可变版本冷拒绝后，有效恢复核对原 package/lock 字节并删除本次生成文件；node_modules 保留，结果如实报告 `reinstall-required`；冷 stale 控制不声称运行时竞态；用户后续编辑保护由既有 D26 5/5 和产品回归覆盖。
  - 行尾：D 提交前 16 模块 index LF/worktree LF，B/C 与 main checkout index LF/worktree CRLF；原 `.gitattributes` 对 `.mjs` 仅 `text=auto`，`core.autocrlf=true`；归一 CRLF 后 16/16 全文一致；未修改行尾规则或 D 断言；比较证据 `c-final-eol-comparison-2026-11-19.json` SHA-256 `54e71a5e979156e9d955e57082ad482429540871f88162995804c5b2dcc9fa9c`。
  - C 证据脚本中断与恢复：main 首个验证脚本 session `17682` exit 1（安装、工作区、强制全图已通过；首次根 tsc exit 0 且无 stdout，`Tee-Object` 没有输入，未创建日志，后续 `Get-FileHash` 抛错）；中断记录 `main-root-tsc-harness-interruption.json` SHA-256 `051646539973fe0a6f182230af9a9d5b8d649130e3ec0cfd0d217af851715da7`；恢复脚本 session `18008` exit 0，输出 `MAIN_VERIFICATION_COMPLETE`；原始脚本 SHA-256 `9219b3b0f653635096d0de564b2be3345a4b0269bc3f477a720241b3e47d29e4`；修正脚本 SHA-256 `4fe2d756c9a0950f1ff9b12725fcf8293adf473fc40618e541cf282893bd5128`。
  - 冻结材料再核验：CLI 唯一 `company-component-cli-0.0.14.tgz` SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`；SDK manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`；真实兼容证据 SHA-256 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`；架构 SHA-256 `e59bb77e...`。
  - 独立审查：复用 `/root/review_t16_sync`；合并前范围到 `40910dc4`，新增未解决 Critical/Important/Minor 均 0，保留两项非阻断 Minor（D30 诊断持久化范围、D41w 早期主 runner 路径日志）；合并前 ignored 审查记录 `c-d-bridge-current-review-2026-11-19.md` 175538 bytes，SHA-256 `246f64e0fc412113f541edc43c5ea4cba10fb5b35da89f626d71d9457e841c51`（合并前快照）；main 七项证据及九份纯文档增量 01 复核完成，整体 Critical 0 / Important 0 / Minor 2；此时快照 195658 bytes，SHA-256 `62463d1086dabe0d624d55d486b78f2b9d5b8991a4ad6b5d1c92923588aa7991`；文档只读检查 `c-final-main-docs-check-01.json` 确认链接、文档范围、冻结摘要及 T16/T17 开放状态均通过。
  - 收口提交只更新记录和当前状态文档；该文档提交的最终 HEAD 以 Git 历史为准，不冒称它是下列测试的实测 HEAD；产品、契约、测试、锁文件与构建配置须与实测 `40910dc4` 保持一致。
- **结论与状态**：完成（T16 技术交付本地合 main 并复验通过）。完整 T16/T17、真实授权业务项目与生产 G2 仍开放。
- **交叉引用**：`t16-technical-acceptance-2026-11-19.md`、`t16-d-installed-recovery-2026-11-19.md`、`t16-d-blackbox-2026-11-19.md`、`t16-b25-c25-d22-2026-11-19.md`、`2026-11-18-phase3-t16-safe-apply.md`。
- **过时或矛盾点**：本文明确「main 运行的是契约浏览器专项，未把此前 287 项冒称为 main 再执行结果」「两份脚本仅存 ignored 原始证据，不进入产品提交」。

### t16-npm-installed-delivery-2026-11-18.md

- **日期／角色／主题**：2026-11-18／C（平台）／T16 真实 npm 安装与交付阻断记录。
- **目的**：以真实 npm 与真实隔离三存储定位安装交付阶段阻断原因。
- **承重事实**：
  - 旧测试栈 Verdaccio `uplinks: {}` 拒绝第三方 Vue/ECharts 请求，不能据此认定产品包管理器进程有缺陷。
  - C 新增 `tests/acceptance/t16-registry.yaml` 与 `t16-installed-global-setup.ts`：仅替换独占栈只读配置挂载，第三方包走真实 npmjs，私有 `@company/*` 不代理；共享及生产配置未修改；生命周期、资源归属、凭据与 teardown 复用 RecoveryStack。
  - 环境变量：`A10_FROZEN_BUNDLE`、`INSTALLED_CLI_EVIDENCE`、`T16_CLI_ENTRY`、`T16_DIAGNOSE_CANDIDATE=true`。
  - `vitest run --config tests/acceptance/t16-installed.config.ts -t vue-npm-standalone`：exit 1；12 collected / 0 passed / 1 failed / 11 未选择；真实 CLI exit 0 但业务结果 `rolled-back / INSTALL_FAILED / reinstall-required`。
  - 仓外临时目录 `zhinexus-t16-installed-XJqIDR`：真实 npm ci 日志 exit 0，第三方及冻结 SDK tarball 请求成功，staging node_modules 已物化；候选 package-lock 物化前后 SHA-256 均为 `236ae4b7788a0e49f33c95438f73eb782bffb8b06a9f61130c8025028f756cfc`。
  - 失败根因：B `planDelivery` 枚举 npm 自动生成的 `node_modules/.package-lock.json` 普通文件时拒绝；不是候选锁变化或 npm 安装进程失败。
  - 三产品完整命令 `product-current-red-84.json`：exit 1；84 collected / 73 passed / 11 failed / 0 pending。
  - C 新增测试与三个验收 TS 文件窄 TS7 检查 exit 0，日志 `c-install-evidence-typecheck.log`。
  - 原始临时配置可能含测试凭据，禁止提交或对外交付。
- **结论与状态**：完成（根因定位 + RED 交接）。84/73/11 为当时口径，被 `t16-acceptance-token-2026-11-18.md` 与 `t16-client-text-delivery-2026-11-18.md` 的后续轮次更新。
- **交叉引用**：`t16-acceptance-token-2026-11-18.md`、`t16-client-text-delivery-2026-11-18.md`、`2026-11-18-t16-b-npm-metadata-brief.md`（汇编小节）。
- **过时或矛盾点**：「CLI 来自开发构建，尚非最终冻结 CLI 验收」；84 条产品口径后被逐轮替换。

### t16-p0-safe-apply-contracts-2026-11-18.md

- **日期／角色／主题**：2026-11-18（Asia/Shanghai）／C（平台）／T16 Task 1 / C / P0 受控应用与安全恢复契约验证。
- **目的**：验收 P0 synthetic 契约交付（四类 v1 类型、validator、JSON Schema、fixtures、CLI 内联镜像）。
- **承重事实**：
  - 隔离 worktree `feat/t16-safe-apply`；固定 Node 26.13.0 / pnpm 12.18.0。
  - 交付：apply authorization / apply result / backup / rollback result 四类 v1 类型、运行时 validator 与 JSON Schema；同步到 component-cli 内联契约镜像；CLI 仍不依赖私有 `@company/contracts` 运行时。
  - issue message 采用固定脱敏 code→message 映射；畸形 backup 上下文返回验证失败而不抛异常。
  - 独立审查发现四项阻断：preserved path 未强制 USER_EDITED、apply 状态可携带伪造证据、issue message 可携带敏感任意文本、畸形 backup 触发运行时异常。
  - 最终 RED：81 项中 7 failed / 74 passed；日志 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/task-1-review-red-final.log`。修复后专项测试 81/81；重新生成 Schema、构建 CLI 并同步镜像后再跑仍 81/81。最终独立复审 Critical 0 / Important 0 / Minor 0。
  - 命令与结果：`--filter @company/contracts schemas:generate` exit 0；`--filter @company/component-cli build` exit 0（73 文件打包探针无缺失/污染/链接/改动）；`exec vitest run tests/contracts/integration-apply.test.ts` 81/81 exit 0；`exec vitest run tests/contracts` 16 files、435/435 exit 0；`verify:workspace` 10 成员、无环、四个公开包骨架及安全服务依赖图通过；`exec turbo run build typecheck --force` 20/20 tasks、0 cached、exit 0；`exec tsc -p tsconfig.json --noEmit` exit 0；根 `test`：T10 Node tests 168 total（161 passed / 7 skipped），Vitest 84 files、1574 passed / 1 skipped，exit 0，Vitest 286.89s。
  - 保留既有 Node `DEP0190` 警告。
  - 派生物一致性：contracts 与 component-cli 中 `integration-apply.ts`、`index.ts`、`schemas.ts` 分别逐字节一致；四份提交 JSON Schema 与 `CONTRACT_SCHEMAS` 按生成格式逐字节一致；`git diff --check` 通过，暂存区为空，无 dist/ 或 build/ 产物。
  - 架构文件未修改，SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`；不重新 pack 冻结 SDK，不升产品版本。
- **结论与状态**：完成（P0 契约验收）。其 81/81 计数被 `t16-recovery-sync-2026-11-18.md` 的 83/83、85/85 与 437/439/84 files/1577-1579 更新。
- **交叉引用**：`t16-recovery-sync-2026-11-18.md`、`t16-product-red-2026-11-18.md`。
- **过时或矛盾点**：契约测试计数（81/81）与全 contracts 计数（435/435）均为当时值，随后续记录更新为 83/85 与 437/439；根 Vitest 计数由 84 files/1574 递增至后续记录的 84 files/1579。

### t16-pnpm12-isolation-2026-11-18.md

- **日期／角色／主题**：2026-11-18／C（平台）／T16 固定 pnpm 12.18.0 安装隔离兼容证据。
- **目的**：以固定原生二进制实测 pnpm 12 版本策略与 YAML 设置兼容性。
- **承重事实**：
  - 命令 `.\.tools\node-v26.13.0-win-x64\node.exe scripts/verification/t16-pnpm12-characterization.mjs`，退出码 0；输出 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/pnpm12-characterization.json`。
  - 固定原生二进制 `--version` 12.18.0 exit 0。
  - 固定 staging YAML、`pmOnFail:error`、内部环境版本切换=false：候选锁 exit 0；冻结物化 exit 0；yaml 2.9.1 实际安装。
  - preinstall/install/postinstall 与 pnpmfile poison：标记文件不存在。
  - pnpm pin=12.17.0 而实际 12.18.0：`ERR_PNPM_BAD_PM_VERSION`，exit 1，未创建锁或 node_modules。
  - 旧 YAML `managePackageManagerVersions:false`：`ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`，exit 1，未创建锁。
  - 裁定：保留固定工具链边界；旧 YAML 改为 `pmOnFail:error`，禁止自动版本切换由产品内部环境 `PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false` 强制实现；`initPackageManager` 是初始化设置，不能作为安全替代项。
  - 精确上游 v12.18.0 commit `018ce5ebba2174c566f730e4f3786adb4b151d43`：实际读取 `pnpm/crates/cli/src/cli_args/package_manager.rs`、`pnpm/crates/cli/tests/suite/package_manager_check.rs`、`pnpm/crates/config/src/known_settings.rs`、`pnpm/crates/cli/src/cli_args/pre_command/load_config.rs`。
  - 更新 expected 后 `project-install-isolation.test.ts` 实跑：16 collected，11 passed / 5 failed / 0 pending，exit 1；新增失败对应固定 YAML 与内部环境缺失，未修改 B 产品。
  - 成功矩阵删除不支持的项目动态配置，保留生命周期 poison；恶意配置单独核验 blocked 与零写入。
- **结论与状态**：完成（兼容证据 + 产品 RED 定位）。
- **交叉引用**：`t16-npm-installed-delivery-2026-11-18.md`、`t16-product-red-2026-11-18.md`、`2026-11-18-t16-b-npm-metadata-brief.md`（汇编小节）。
- **过时或矛盾点**：16 collected 为当时口径，随后随产品轮次增长；「真实八组合首轮的配置拒绝与夹具锁生成错误不冒称产品 RED」为阶段性措辞。

### t16-product-red-2026-11-18.md

- **日期／角色／主题**：2026-11-18／C（平台）＋实际 Claude 桌面 B／T16 B 产品失败测试交接验证。
- **目的**：交付产品 RED（三个 project 测试文件）并确认完整收集与行为失败。
- **承重事实**：
  - 基线提交 `41a88e764059fea267f91451b4923290676f7d7f`，前置 P0 为 `2594f2776fb4b2de4a684fc3e50317ccc1d758dd`。
  - 唯一实施目录 `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`。
  - B 为实际 Claude 桌面端，会话名「T16 B 安装隔离测试」，会话 `local_bb7d37e6-a0da-4459-85ce-990c70dceedd`；保留用户已有 `step-5-preview High` 设置；通过 computer-use 插件操作 UI，不以 Codex 审查代理冒充 Claude。
  - 授权依据 `2026-11-18-t16-b-install-isolation-brief.md`（汇编小节）；B 只编写三个 `project-*.test.ts` 与 `tests/integration/t16-support/*`，不改产品源码/exports/stub/公共契约/fixtures/配置/依赖/锁/版本；B 不提交。
  - 修订前预检：project-apply 27 collected / 0 passed / 27 failed；project-rollback 17 / 0 / 17；project-install-isolation 16 / 0 / 16（15 例缺 applyIntegration，1 例 npm fixture 的 MATCH_CONTEXT_MISMATCH 不计产品 RED）；`tsc --project tsconfig.json --noEmit` exit 1（sync 必填字段、unknown 展开、rollback 类型来源及可变 union 闭包收窄）；`vitest run tests/contracts/integration-apply.test.ts` 85/85 exit 0。
  - 预检日志 `claude-preflight-apply/rollback/isolation` 的 .log/.json 及 `claude-preflight-typecheck-three.log`。
  - C 撤除五个依赖伪造备份读视图的活动用例（空字节正例、originalBase64 篡改/缺失、projectRoot/planDigest 篡改）与一个把备份原始写操作当 installStarted 日志提交的活动用例；未用 skip/todo 占位。
  - 最终实测：CLI build exit 0（内联契约同步、编译、package probe 73/73 文件）；`typecheck` exit 0（14/14 缓存）；`vitest run tests/contracts/integration-apply.test.ts` 85/85 exit 0；临时 `helper-probe.test.ts` 13/13 exit 0（已从正式收集范围移除）；三文件完整 **62 collected / 0 passed / 62 failed / 0 pending，exit 1**（apply 34、rollback 12、安装隔离 16）；全部 failureMessages 为缺少 `applyIntegration` 的 undefined 断言。
  - 日志 `final-product-red.log/.json`、`final-typecheck.log`、`final-cli-build.log`、`final-contract-green.log`、`helper-probe-final.log`。
  - 13 项临时探针覆盖：React/Vue 可解析正例、前置 SFC 注释与开头 JSX、真实 prop/返回型 callback 字符串、未使用字面量/IIFE 未返回字面量/拼接子串拒绝、模板插值执行原语拒绝、损坏 TSX/SFC 拒绝、真实备份武装故障/补偿放行/第二提交 ordinal、callback/promise 错误通道、暂存快照与外部配置留存/junction 拒绝、workspace 根/成员 importer 与成员链接、未知依赖/坏 YAML 及缺冻结锁错误不吞掉。初次文件 symlink 探针因 Windows EPERM 失败，改用既有 junction helper 后通过，未计产品 RED。
  - 独立只读复审代理 `review_t16_sync` 未发现本轮新增 RED 阻断。
  - 架构 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`；不触发产品版本升级。
  - GREEN 前五项待办：(1) 真实备份存储的字段破坏与同 operation 最新引用可达；(2) 接入真实 journal/latest 原子持久化点与 installStarted=true 断言；(3) 按真实写入 API 调整 fs 故障接点（当前覆盖 node:fs named/default、sync/callback 与 fs.promises 包装，不声称独立 node:fs/promises 导入或 FileHandle 写入被拦截）；(4) 按 LineChart 实际 prop/event 分别检查 Vue/React 绑定，source/handler 用不同值，不把全局 Set.has 当完整绑定验收；(5) synthetic workspace 成员链接只验证受控场景。
  - 验收限制：synthetic tarball 字节只支持受控摘要/HTTP 夹具；测试私有进程 mock 物化受控目录，不能证明真实 npm/pnpm 安装或执行隔离。
- **结论与状态**：完成（产品 RED 交付）。被后续 B01–B26 产品轮次与 `t16-product-review-2026-11-18.md`、`t16-client-text-delivery-2026-11-18.md` 持续更新。
- **交叉引用**：`t16-recovery-sync-2026-11-18.md`、`2026-11-18-t16-b-install-isolation-brief.md`（汇编小节）、`t16-product-review-2026-11-18.md`。
- **过时或矛盾点**：62 collected 为最初 RED 总数，随后随 C 审查用例增加逐轮增长至 141；「一致的测试私有读视图」为预检阶段说明，最终交付不含 overlay。

### t16-product-review-2026-11-18.md

- **日期／角色／主题**：2026-11-18（末次追加同日内）／C（平台）＋独立 reviewer `/root/review_t16_sync`／T16 产品独立审查与修复验收补充。
- **目的**：对 B05 起的产品源码做独立只读审查，逐项列出 13 项 Important 并跟踪 B06–B12 的 RED→GREEN 状态。
- **承重事实**：
  - 审查对象：`dec2f45bfea49058f8b05c231e6eee71a341a11f` 上 B05 的十个未提交 CLI 源文件；排序摘要清单 SHA-256 `a988e6828cc795cb8c14f78ad59f22e7fbd8ebdbe0cb343508ac6b7c2fa0d172`；这是 B05 快照标识，不能作为 B06–B08 或最终产品的审查证明。
  - 结论：没有已证实 Critical；13 项 Important 阻断合并；没有单独 Minor。
  - 13 项 Important 逐项状态（截至 B08/B10/B11/B12）：(1) 非目标 workspace 成员及父链未经真实身份复核——B07 两条 junction RED 转 GREEN；(2) 安装未绑定已核验 SDK 身份/integrity/origin——package name RED B08 GREEN，候选 integrity/origin 两条仍 RED；(3) 安装失败遗留含 registry token 配置——三条 RED B08 GREEN；(4) apply 临时写后覆盖新文件、rollback 分类后删除用户新编辑——两条真实窗口 RED 仍失败，交 B09；(5) 不可信参数/计划未知字段/文件名进入 stdout/stderr——B06 GREEN；(6) Vue layout 中关闭 script 标签截断 SFC——B06 修复并通过真实 Vue 编译器断言；(7) 安装成功前未复核目标源码、清单和锁摘要——三条 RED 仍失败；(8) sibling 清单六类禁止依赖协议仍进入安装——六条 RED（file/git+https/link/portal/patch/workspace）仍失败；(9) 备份 root/operation/versions/latest 缺普通路径、链接/硬链接、独占边界——version hardlink 与 versions 父 junction 两条 RED 仍失败；(10) 安全旧 node_modules 的 quarantine、树守卫和逐目录副作用日志未实现——RED 仍失败；(11) React 生成器缺客户端 directive，冻结 SDK 使用 hooks——真实 Next/RSC 消费者验证尚未补齐；(12) lstat EACCES/EIO 被当作 missing——两条 RED 仍失败；(13) 合法可选 chart-color 透传生成非法 TSX/SFC——双框架 RED，产品 applied 后编译失败。
  - B08 完整产品 **117 collected / 97 passed / 20 failed / 0 pending，exit 1**；四窄测 4 passed / 0 failed / 35 未选择、exit 0。
  - C RED 证据：`c-review-safety-red-01`、`c-review-write-recovery-red-02`、`c-review-install-end-red-01`、`c-review-install-input-backup-red-02`、`c-review-optional-prop-red-01`；C 审查测试窄 TS7 exit 0（`c-review-tests-ts7-01.log`）。
  - D 首个完整修正版黑盒 1 passed / 0 failed / 0 skipped / 0 todo、exit 0。
  - B09 完整 120/100/20/0、四窄测 3 passed / 1 failed / 77 未选择；C 纠正恢复期望后 RED 1 failed / 53 未选择 exit 1（`product-c-apply-late-create-corrected-red-01`），B10 完整运行该例 GREEN。
  - B10 完整 **120 collected / 106 passed / 14 failed / 0 pending，exit 1**；六条 RED 转 GREEN（首写零提交合法恢复、latest-hardlink、operation-junction、root-junction、version-hardlink、versions-parent-junction）。
  - B10 后仍 14 条失败：React/Vue 可选 chart-color 生成不可编译 2；物化期间改组件/清单/锁后仍 applied 3；非目标成员六类禁止协议 6；SDK 候选锁 integrity/origin 偏离 2；安全既有 node_modules 未实施 quarantine 1。
  - B11 完整 **120 collected / 111 passed / 9 failed / 0 pending，exit 1**；聚焦 `-t '可选 chart-color|物化期间用户修改'` 5 passed / 0 failed / 88 未选择、exit 0。
  - B12 原文 17889 bytes；八条依赖协议/候选锁身份窄测 8 passed / 0 failed / 31 未选择、exit 0；原 120 条 119 passed / 1 failed / 0 pending、exit 1。
  - C4 四条目录交付/清理 RED `c-directory-cleanup-red-01`：43 collected / 0 passed / 4 failed / 39 未选择、exit 1；完整 `product-b12-c4-full-01` **124 collected / 119 passed / 5 failed / 0 pending，exit 1**。
  - B13 机械接收阻断（apply hunks 倒序 + 九项静态阻断：保留重复旧函数、cleanupInstallBestEffort 缺导入、journal 父目录计算错误且检查前 recursive mkdir、禁止已存在目标使状态更新必拒绝、planned 未记录真实 hadOriginal、旧树检查使用无关 stage 边界、树摘要只有路径/大小、strict 清理未记本次 rm 异常）；B14 162915-byte 精确返修提示已发送。
  - D03 超时（14:56:31.664Z–15:06:31.706Z，stdout 0、exit null）；D04 `15:09:36.938Z`–`15:19:50.004Z`，child exit 1、timedOut false、is_error true、实际 num_turns 4，超过 14000 输出 token；D05 `15:23:15.808Z` 启动（PID 4112）。
  - 日志持久化两例 `c-journal-persistence-red-01`：45 collected、2 failed、43 skipped、exit 1。
  - Next 第三轮 13 collected、1 failed、12 skipped、exit 1；React API 的 data 是唯一必需 prop；Server Page/layout 无 client wrapper，事件使用合法 inline Server Action。
  - `tests/contracts/integration-apply.test.ts` 与 `api-schema.test.ts` 复核 **113 collected / 113 passed / 0 failed / 0 pending，exit 0**（`c-contract-schema-recheck-01`）。
  - C 六条补测后完整产品 `product-b12-c6-full-01`：**126 collected / 119 passed / 7 failed / 0 pending，exit 1**；七条失败为安全旧 node_modules 交付、首份日志提交失败、旧树移出后日志更新失败、workspace 第二目录交付失败、quarantine rename 窗口编辑保护、stage 持续清理失败、ready 持续清理失败。
  - 架构 SHA-256 多次实查仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
- **结论与状态**：完成（13 项 Important 跟踪至 B12）。其中 B08–B12 计数被 `t16-hot-recovery-2026-11-19.md` 与 `t16-b23-c24-d20-2026-11-19.md` 更新至 141/141。
- **交叉引用**：`t16-product-red-2026-11-18.md`、`t16-client-text-delivery-2026-11-18.md`、`t16-hot-recovery-2026-11-19.md`、`t16-backup-ancestor-2026-11-19.md`、`t16-b23-c24-d20-2026-11-19.md`、`t16-b25-c25-d22-2026-11-19.md`、`t16-technical-acceptance-2026-11-19.md`。
- **过时或矛盾点**：本文明确「不同 collected 口径不混算」「不能把新增测试当回归」；B05 审查结论不可外推到 B06 以后。

### t16-recovery-sync-2026-11-18.md

- **日期／角色／主题**：2026-11-18／C（平台）／T16 P0 恢复状态补充与安装隔离交接。
- **目的**：从外部移除的 worktree 恢复 P0 提交，重新 RED→GREEN 验证两项修正，并交接安装隔离 brief。
- **承重事实**：
  - 原 T16 worktree 被外部移除，用户确认没有迁移并授权恢复；从保留分支 `feat/t16-safe-apply` 的 P0 提交 `2594f2776fb4b2de4a684fc3e50317ccc1d758dd` 恢复到 `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`；主工作区 `main@c067c81d2751b1d7cf9a04e7c15b6d7d276d014d` 未编辑。
  - Node 26.13.0 / pnpm 12.18.0；Node 随附 npm package.json 实测 11.20.0。
  - 两项修正：首写失败保留真实备份并允许空提交证据；恢复 I/O 失败用必填 unresolvedPaths 表达，与保留用户编辑分开。
  - 命令与结果：`exec vitest run tests/contracts/integration-apply.test.ts` 修正前 RED 81 passed / 2 failed / 83 collected exit 1；修正后 GREEN 83/83 exit 0；`--filter @company/contracts schemas:generate` exit 0；`exec vitest run tests/contracts` 16 files、437/437 exit 0；CLI build exit 0、pack probe 73 文件；`verify:workspace` exit 0；`exec turbo run build typecheck --force` 20/20、0 cached、16.965s exit 0；根 `test`（浏览器恢复前）exit 1：77 files passed / 7 failed、1568 passed / 9 failed，其中 6 个浏览器启动错误为缺 Chromium headless shell。
  - Playwright 补齐官方 chromium/headless-shell v1254 exit 0；浏览器目录通过 junction 指向主仓库 `.tools/playwright`，不共享 node_modules。
  - 冻结 SDK 输入 `A10_FROZEN_BUNDLE=D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`、`NEXT_PUBLIC_SITE_URL=https://gallery.test`；输入摘要 core 0.0.11 `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb`、Vue 0.0.12 `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9`、React 0.0.12 `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28`。
  - 补齐浏览器后根 `test`：T10 168/168、Vitest 84 files、1577/1577、exit 0、323.53s；日志 `root-test-browser-restored.log`。
  - 独立只读审查发现 P2：无路径的 WRITE_FAILED / RECOVERY_REQUIRED 可借 preserved + USER_EDITED 绕过 unresolved 反向绑定；新增两个行为反例 RED 83 passed / 2 failed / 85 collected exit 1；修正后 85/85 GREEN；未重建 dist 的窄测读旧产物，记录 `review-green.log` 不作 GREEN 证据，有效为 `review-green-built.log`。
  - 修正后全 contracts 16 files、439/439 exit 0；forced graph 20/20、0 cached、15.278s；PowerShell 把裸 `-p` 误绑定到包装器参数的 tsc 调用未执行编译器，改用 `exec tsc --project tsconfig.json --noEmit` 后 exit 0。
  - 最终根 `test`：T10 168/168、Vitest 84 files、1579/1579、exit 0、309.18s、无 skip/todo；日志 `root-test-review-final.log`；保留既有 DEP0190 警告，T16 安装必须按 brief 用 `shell:false` 实现。
  - 关键决定：包管理器进程只在工程外 staging 运行；候选锁在备份前生成；冻结依赖物化启动前持久化 installStarted=true 并重新摘要；备份版本不可变；依赖树经链接/硬链接/摘要与并发守卫后从同卷外部 ready/quarantine 受控交付；暂不支持的解析配置和 local/git/file/link/portal/patch 依赖显式阻断。
- **结论与状态**：完成（P0 收口 + 安装隔离交接）。
- **交叉引用**：`t16-p0-safe-apply-contracts-2026-11-18.md`、`2026-11-18-t16-b-install-isolation-brief.md`（汇编小节）、`t16-product-red-2026-11-18.md`。
- **过时或矛盾点**：根 Vitest 计数 1577→1579 为本文内两次更新；架构 SHA 在本篇中为小写 `e59bb77e...`，与 P0 记录的大写形式为同一值。

### t16-technical-acceptance-2026-11-19.md

- **日期／角色／主题**：2026-11-19（Asia/Shanghai）／C（平台）＋实际 Claude 桌面 B ＋实际 Claude Code D／T16 冻结产物技术验收。
- **目的**：在 B26 产品 GREEN 与 CLI 0.0.14 升版后，用唯一冻结 tarball 完成全部门槛。
- **承重事实**：
  - B 产品作者为实际 Claude 桌面 GLM-5.3 High；D 独立黑盒作者为实际 Claude Code GLM-5.3；C 负责测试环境、机械接收、公共契约、集成和文档。
  - 单一冻结材料：CLI `company-component-cli-0.0.14.tgz`，389203 bytes，SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`；冻结提交 `2fca59cf3a0e4f5cf2500e8d1bba74010796b1ec`；冻结 UTC 时间 `2026-11-18T19:35:01.7156793Z`；pack exit 0；冻结 SDK core `0.0.11`、Vue/React `0.0.12`，manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`；真实安装兼容证据 SHA-256 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`；架构 SHA-256 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
  - tarball 位于 B/C worktree `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/cli-0014-frozen/`；SDK 位于主仓库 `.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3/`；pack 后全图构建没有重新 pack。
  - 固定 Node 26.13.0 / pnpm 12.18.0。
  - 已完成验证表：B26 产品 141/141 零失败/pending exit 0；契约与镜像 166/166 exit 0；CLI build/probe 73 文件 exit 0；强制全图 20/20、0 cached exit 0；冻结安装矩阵 14 collected / 13 passed / 0 failed / 1 unselected exit 0（`cli-0014-consumers-02.json/.log`）；契约浏览器修复 1/1 exit 0；完整浏览器 `test:browser` 287/287 exit 0；冻结 T15 25/25 exit 0；D26 冻结黑盒 5/5 exit 0；根失败相关复核 2 文件/10 测试 exit 0；根完整复跑 `test --maxWorkers=2` Vitest 89 文件/1753 测试、T10 168 测试全部通过 exit 0（`cli-0014-root-test-02.log`）；平台专项 `test:platform` 33 文件/135 测试通过、2 文件/2 测试因缺画廊 origin 跳过 exit 0；两项真实画廊补验 2 文件/2 测试全部通过 exit 0。
  - D 新增冻结安装恢复：Vitest 14 collected / 1 passed / 0 failed / 13 unselected；实际 D 子进程 1/1、零 skipped/todo、exit 0；随机隔离服务 ID `6372fbed-97be-4908-9d8d-0eb7e018f27d`；仓外证据目录 `zhinexus-t16-installed-HYtFn4`；T15 隔离服务 ID `29be1321-3975-4edf-8588-2ef5aace2023`。所有本机真实服务证据均为 `productionAcceptance: false`。
  - 13 项消费者覆盖八组安装/类型/构建/迁移、四组 hostile 拒绝、Next Server Page 控制；顶层 D 桥接刻意被筛选排除，不能把该报告写成 14/14。两轮平台合计覆盖 137 项，不将首轮报告改写为 137/137。
  - 保留失败与纠正：(1) 消费者首轮未设 `INSTALLED_CLI_EVIDENCE`，14 collected / 0 passed / 14 pending、suite failed、exit 1（环境前置，不计产品 RED）；(2) 浏览器首轮 287 collected / 280 passed / 3 failed / 4 未运行、exit 1（两项缺冻结 SDK 环境；契约测试显式模块路由漏 integration-apply）；(3) CLI 0.0.14 根首轮 Vitest 89 文件中 87 passed / 2 failed、1751 passed / 2 failed，总 1753，T10 168/168，exit 1，两项为 5000ms timeout；窄复跑 10/10 后以 `--maxWorkers=2` 完整复跑 1753/1753；(4) D27 20 分钟上限无完整 assistant text，raw SHA-256 `668fac2a...`；(5) D28 静态拒收，raw SHA-256 `d523ef7d...`；(6) D29 exit 1、`api_error:max_output_tokens`，raw SHA-256 `dca4ce64...`。
  - 公开冷无效备份 CLI 应 exit 1、单 JSON `status: error` / `error.code: EXECUTION_FAILED`、固定脱敏且无写入；不能要求库私有异常的 exit 2/recovery-required；备份字段是 `before.sha256`。
  - 独立审查：`b26-overall-readonly-review-2026-11-19.md` SHA-256 `0075020d5e2b9d23739025bd0662610aa89fbff082d7ce22714225ac15b95757`；C 浏览器路由及 D 桥接增量审查 Critical/Important/Minor 均 0；`c-frozen-docs-readonly-review-2026-11-19.md` SHA-256 `6de3dda91192fb4c8d057bf7d75ee39925ce2923bc557bda38b57ca129dca01b`。
  - 最终 D 增量审查 `c-d-bridge-current-review-2026-11-19.md` 165094 bytes，SHA-256 `15e666bdbebf4cc6cb9fe700a5b3881c2d33dcf9f1242ee9dea249ec7ef63445`；保留两项非阻断 Minor。
  - 实际 D 分支提交 `9bca63fd`（16 文件/563 新增行），B/C cherry-pick `11659bca`；C 桥接提交 `b20921b9`（17 行）；`.gitattributes` 的 `.mjs` 为 `text=auto` 且 `core.autocrlf=true`；行尾比较证据 `c-final-eol-comparison-2026-11-19.json` SHA-256 `54e71a5e979156e9d955e57082ad482429540871f88162995804c5b2dcc9fa9c`。
  - 合并前最终树检查四项 exit 0；最终检查日志 SHA-256：`final-install.log` `ae4a603ff2e917e8e8eb2a7685725033b745d004f1b726ca08f758fcd51c0c64`、`final-workspace.log` `6937eb8c08c6db032212b3ac8189bd2d5ae43801e6e3641c8ff956a7d3161732`、`final-force-build-typecheck.log` `326294787f5e15e0a85a5a659dcbeb02ef49a94b53f4be63d93774d601825b88`、`final-root-test.log` `244bfde5ea7c68b803b8d7346b20ae16c3bf8ed353f9cf1dc2eaa873bfea33f6`。
  - 提交 `1f1566af` 后补充集成根 tsc exit 0，`final-integrated-root-tsc.log` 为空，SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
  - main 合并与完整复验补充：2026-11-19 本地快进合 main 至 `40910dc46db7bef0db0d17dee0d31b94a8f2ea6d`；main frozen install、workspace、强制全图 20/20（0 cached）、根 tsc、根 Vitest 1753/1753 与 T10 168/168、完整冻结 T16 14/14、契约浏览器 1/1 均 exit 0。
  - 本轮不 push、不 tag、不生产发布，保留全部 worktrees 与原始证据；真实授权业务项目、公司 OIDC/独立预览域及完整生产 G2 不由 synthetic 消费者结果替代。
- **结论与状态**：完成（冻结技术验收）。其「main 合并与完整复验补充」节由 `t16-main-completion-2026-11-19.md` 提供完整细节。
- **交叉引用**：`t16-b25-c25-d22-2026-11-19.md`、`t16-d-blackbox-2026-11-19.md`、`t16-d-installed-recovery-2026-11-19.md`、`t16-main-completion-2026-11-19.md`、`2026-11-18-phase3-t16-safe-apply.md`。
- **过时或矛盾点**：本文较早时点称「D 桥接未执行、D 增量待验收」，由同文档「最终 D 新增黑盒补验」节更新为已执行通过；「main 尚未合并」由末节更新为已合并。

## 历史脉络

**契约先行（2026-11-18，C / P0）。** T16 从设计文档与实施计划定稿开始，两者即上文指向的 `docs/specs/2026-11-18-phase3-t16-design.md` 与 `docs/plans/2026-11-18-phase3-t16-safe-apply.md`；计划把工作切成 C/P0 契约、B/P1 产品、A/P2 与 D/P3 独立验收、C/P4 集成四个 Task，并冻结原架构 SHA-256 与「冻结 SDK 不重新 pack」两条不可变基线。C 的 P0 交付经历三轮 RED→GREEN：`t16-p0-safe-apply-contracts-2026-11-18.md` 记录独立审查发现四项阻断后，专项测试从 81 项中 7 failed 修到 81/81，全 contracts 16 files / 435/435；`t16-recovery-sync-2026-11-18.md` 在被外部移除的 worktree 从 P0 提交 `2594f277` 恢复后，补两项修正（首写失败可空提交返回 rolled-back；恢复 I/O 失败必填 unresolvedPaths），把计数推到 83/83、全 contracts 437/439，又修掉一个「无路径 WRITE_FAILED 借 preserved + USER_EDITED 绕过反向绑定」的 P2 缺陷后达到 85/85、全 contracts 439/439、根 Vitest 84 files / 1579。根测试曾因缺 Playwright Chromium headless shell 出现 9 项假失败（77 files passed / 7 failed、1568 passed / 9 failed），补齐官方 chromium/headless-shell v1254 后全部消失——这是本轮最早一条「失败不等于产品缺陷」的判据。

**产品 RED 与 B 侧多轮补修（2026-11-18 → 2026-11-19）。** `t16-product-red-2026-11-18.md` 记录实际 Claude 桌面 B（会话「T16 B 安装隔离测试」）交付三个 `project-*.test.ts` 的预期 RED：62 collected / 62 failed，全部因产品缺 `applyIntegration`。此后产品计数随 C 审查用例增加逐轮攀升，全程可见的轨迹是：B05 快照（`dec2f45b`）被独立 reviewer 审查出 13 项 Important（`t16-product-review-2026-11-18.md` 逐项列明并跟踪，覆盖 workspace 身份、SDK integrity/origin、凭据清理、写窗口竞态、stdout 泄漏、SFC 截断、安装前摘要、六类禁止依赖协议、备份链接/独占边界、旧 node_modules quarantine、React 客户端 directive、lstat EACCES 误判、chart-color 生成不可编译）；随后 B06 97/91/6 → B07 115/93/22 → B08 117/97/20 → B09 120/100/20 → B10 120/106/14 → B11 120/111/9 → B12 120/119/1。C 持续补真实文件系统 RED：C4 四条（124/119/5）、六条补测（126/119/7）、两条备份祖先路径 junction（128/119/9，`t16-backup-ancestor-2026-11-19.md`）、B19 三条同窗口恢复 RED（132/127/5）、C21 四条（`c21-review-red-02` 109/0/4/105）。B20 是产品侧第一个全绿：134 collected / 134 passed / 0 failed / 0 pending，exit 0，同时 CLI build/typecheck、probe 73 文件、根 fixtures tsc、workspace 十成员、强制全图 20/20（0 cached）全部 exit 0（`t16-hot-recovery-2026-11-19.md`）。B23 达 138/138（`t16-b23-c24-d20-2026-11-19.md`），C24 两条 RED（111 collected / 0 passed / 2 failed / 109 unselected）后由 B25/B26 修掉，B26 达到最终 141/141（B23 原 138 条 + C24 两条 + C25 一条），对应根 test 89 文件 / 1753 测试 + T10 168/168 全通过。

产品侧还确立了两条重要 Ruling：stage/env/ready 只能信任本次操作、固定 role 与 kind 的精确普通单链接所有权标记；同次 apply 可从最近一次成功 persistBackup 的可信不可变内存备份恢复源码，但磁盘路径被替换后不得读写，冷启动 rollback 仍须完整验证磁盘备份与祖先路径。

真实安装交付层另有两条独立攻坚：`t16-npm-installed-delivery-2026-11-18.md` 定位 npm 自动生成的 `node_modules/.package-lock.json` 被 `planDelivery` 误拒（`PATH_UNSAFE`，候选锁 SHA-256 物化前后均为 `236ae4b7788a0e49f33c95438f73eb782bffb8b06a9f61130c8025028f756cfc`）；`t16-pnpm12-isolation-2026-11-18.md` 用固定原生二进制实测 pnpm 12.18.0 行为（pin 12.17.0 触发 `ERR_PNPM_BAD_PM_VERSION`；旧 YAML `managePackageManagerVersions:false` 触发 `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`），裁定改用 `pmOnFail:error` + 内部环境 `PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false`。B 第五份补丁把 workspace junction 收敛到同一成员资格检查、对 pnpm 两份根元数据做普通/非硬链接检查后省略，最终开发 CLI 八组合矩阵 12/12 exit 0（含 hostile 四组拒绝、Vite .bin、peer yaml、scope 成员链接）。

**A 侧断言审查三轮与 C 侧 helper 返工。** `t16-a-api-cases-2026-11-18.md` 由 A（Antigravity）交付 14 实现（7 组件 × Vue 3 / React 19）的独立 API 矩阵、synthetic 安全案例（`__proto__`/`constructor` 对调、`</script>`、`{{...}}`、`${...}`、`eval(...)` 等必须作为字符串键）与 8 类负例。首次运行因工作树无 node_modules 退出码 1 阻塞，返工改用 `@babel/parser@7.29.13` + `@vue/compiler-sfc@3.5.45` 后达到默认 4 passed | 1 skipped、显式 `A10_FROZEN_BUNDLE` 5 passed。随后 A 被独立审查打了三轮返工（`t16-a-assertion-review-2026-11-18.md`、round2、round3），每轮都是先加反例跑 RED 再修 `assertions.ts` 跑 GREEN：round1 修全文 `includes(JSON.stringify(key))` 误收、source/handler 互换、死 JSX、参数遮蔽、引号/模板字面量解码，达 5 passed | 1 skipped (6)、显式 bundle 6 passed (6)；round2 的 RED 是 `data={("sales", [])}` 序列表达式被误收（`1 failed | 5 passed | 1 skipped (7)`），修序列表达式、丢弃语句、导出渲染可达性、作用域感知遮蔽、合法写法与真实 import alias，达 6 passed | 1 skipped (7)、显式 7 passed (7)；round3 的 RED 是 `11 failed | 7 passed (18)`，修 return/throw 控制流终止、`if (false)` 裁剪、条件测试字符串、丢弃参数/IIFE、块级作用域 `cloneScope`、调用位置函数解析，最终 18 passed (18)，0 pending / 0 skipped。`t16-a-host-review-2026-11-18.md` 由 C 在 T16 收口工作树复跑确认 18 collected / 18 passed / 0 failed / 0 pending，`assertions.ts` SHA-256 `2daf953d4e64e1d9bd33bffd398356030acbe1dff7238b980fb01e0303b5875e`，五类既有 Important 全部关闭，A 侧最终收口于 `0504d599`。与之平行，`t16-c-binding-review-2026-11-18.md` 对 C 自有的 `tests/integration/t16-support/source-scan.ts` 做同类返工：RED 15 collected / 12 passed / 3 failed → GREEN 15/15，并澄清了「16/16 不是 29 条」「24 条日志含已删除临时文件」两处易误读口径。

**D 侧黑盒交付：从文本交付到 16 模块安装恢复。** D 侧是本主题最曲折的一段。`t16-client-resume-2026-11-18.md` 与 `t16-client-text-delivery-2026-11-18.md` 记录默认渠道失败（DeepSeek-V4.1-Flash-1017，`malformed_tool_use_exhausted`）后用户授权 GLM-5.3，转为「实际客户端直接返回 unified diff 原文 + C 只机械接收」的模式，并确立「文本是可追踪代码产物，可替代故障文件工具的落盘步骤，但不能替代作者或验收」。D 的黑盒从两份文件起步：`cli-required-arguments.test.mjs`（SHA-256 `63824ed39fa0aff40c9668ee9cbfe4f0c227b718fbef3a6b2ddc960ae3e6064b`）与 `cli-input-rejection.test.mjs`（SHA-256 `4115e201f3c8dd4dafd38b343bb668297c06b86b16aead70a029989461edce81`），开发 CLI 上 `node --test` 4/4，加 `cli-apply-recovery.test.mjs` 后 5/5。D20/D24/D26 逐轮补充：用户编辑后独立进程 rollback 返回 exit 2 / recovery-required / not-run、preserved=[生成路径]、四组严格为空；D26 用公开根 commands/allowedPaths 建立未知字段、路径穿越、大小写别名、额外安装参数四类拒绝（嵌在一个顶层测试内，总数保持 5）。

真正困难的是安装恢复黑盒。D27 超时、D28 静态拒收、D29 触 `max_output_tokens`，C 把任务拆成 16 个模块（installed-support/plan/start/report-files/report/fields/backup/tamper/cases/stale/cli-installed-recovery.test.mjs 等），并逐步发现隔离手段不够：`--tools ""` 只关 built-in tools，必须 `--strict-mcp-config` + 空 `--mcp-config`（D38b 出现了无参数 `mcp__playwright__browser_run_code_unsafe` tool_use），后来又加 `--safe-mode` 与简短 per-run system prompt。D31/D33/D34/D43 多次只产出 thinking 无源码；D45f/D45 只返回查找命令或仓库发现说明；D50/D53/D55 因接口误用或缺显式授权被拒，D56 用 receipt-only runner 补上绑定原 D53 源码摘要的明确授权后才完成 `installed-stale.mjs` 接收。最终在冻结 CLI `0.0.14` 上，D 安装恢复黑盒 1 passed / 0 failed / 0 skipped / 0 todo、exit 0，stdout 明确完成 start → checkBackup → checkFields（fields 与 stale）→ checkRecovery 四段，隔离服务 ID `c9692e53-c49f-4717-b2c7-58ac697c5607`，仓外 `zhinexus-t16-installed-aIvqa2` 安装同一 tarball（SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`，未重新 pack），D 工程 `t16-d-xdG6GV`。16 模块在 D 保留分支提交 `9bca63fd`，原样 cherry-pick 到 B/C 为 `11659bca`，C 桥接单独提交 `b20921b9`（17 行）。这里还有一条重要的自我更正：C 曾把工具输出 JSON 转义误当作源码字节，误判 D38 的 Windows 路径归一行有缺陷，独立读取原始字节（92,92）后确认那不是 D 缺陷也不是产品 RED。

**验收令牌、冻结产物与 main 收口。** `t16-acceptance-token-2026-11-18.md` 修掉一个会掩盖产品结果的基础设施缺陷：安装矩阵原只签发一次 5 分钟 API token，而 CLI 进程可跑 15 分钟、全测试 20 分钟，后续 401 会伪装成产品失败。新增 `tests/platform/http-token.test.ts` 后 RED 为 `300 != 1200`（2 collected / 1 passed / 1 failed），GREEN 2/2，T16 验收改为每次请求前重签 20 分钟 token，全部历史 token 入内存 Set 并在保存证据前逐个替换为 `[REDACTED]`。

`t16-technical-acceptance-2026-11-19.md` 是技术验收总账：CLI 升 0.0.14（提交 `2fca59cf3a0e4f5cf2500e8d1bba74010796b1ec`，冻结 UTC `2026-11-18T19:35:01.7156793Z`，tarball 389203 bytes），一次 pack 后不重新 pack，所有消费者、T15 与 D 黑盒共用同一 tarball。结果：B26 产品 141/141、契约与镜像 166/166、CLI probe 73 文件、强制全图 20/20（0 cached）、冻结安装矩阵 14 collected / 13 passed / 0 failed / 1 unselected（D 桥接被刻意筛选排除，不写成 14/14）、契约浏览器 1/1、完整浏览器 287/287、冻结 T15 25/25、D26 冻结黑盒 5/5、平台专项 135 通过 / 2 跳过 + 画廊补验 2/2（合计 137，首轮报告不改写）、根 `test --maxWorkers=2` Vitest 89 文件 / 1753 + T10 168/168 全通过、D 新增安装恢复 1/1。

`t16-main-completion-2026-11-19.md` 收口：来源分支 `feat/t16-safe-apply-final` 本地 `merge --ff-only` 到 `40910dc46db7bef0db0d17dee0d31b94a8f2ea6d`（合并后树 `c51c1932af4a445e7e00514f223ea3435481ca70`，main 与 B/C 全树一致且 clean），七项 main 验证全部 exit 0，其中完整冻结 T16 14/14（八组安装 + 四组 hostile + Next Server Page + D 默认入口），且此时移除了 `T16_D_TEST_FILE` override，D 默认 main 路径四段安装恢复控制 1/1、process code 0、stderr 为空（服务 ID `4caec703-11f5-483c-aeeb-aa1437cd37c0`，消费者 `zhinexus-t16-installed-yKUag3`，D 工程 `t16-d-r8odcu`，ref `apply-7573988ebf1eadf2919575a3`）。行尾差异（D 提交前 LF、main checkout CRLF）经归一后 16/16 逐字一致，未改规则或断言。C 自己的验证脚本曾因 `Tee-Object` 无输入而 session 17682 exit 1，明确记为 C 证据脚本故障、不计产品失败，恢复脚本 session 18008 exit 0。

**最终验收结论。** 技术侧 T16 工具技术交付已完成并按用户授权本地合入 main（`40910dc4`），独立全树审查 Critical 0 / Important 0 / Minor 2（两项均为非阻断：D30 超时/启动失败诊断的持久化范围、D41w 早期主 runner 的路径日志）。主线数字为：产品 141/141、契约与镜像 166/166、根 Vitest 1753/1753 + T10 168/168、完整浏览器 287/287、冻结 T15 25/25、D 既有黑盒 5/5、D 安装恢复 1/1、完整冻结 T16 14/14、强制全图 20/20（0 cached）、CLI 0.0.14 单一 tarball SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`。仍开放的问题见「终态结论」：真实业务试点未做（全部验收在明确标注 synthetic 的仓外临时工程与隔离三存储上进行，所有本机真实服务证据均为 `productionAcceptance: false`）、生产 G2 未过、未 push/未 tag/未生产发布、运行时竞态未声称，以及静态 AST 断言与真实构建、备份并发窗口、逐目录 journal、部分交付与 cleanup 自身失败、Next/RSC 客户端边界在最终冻结产物上的复验、跨目录原子事务（明确不要求）等边界。
