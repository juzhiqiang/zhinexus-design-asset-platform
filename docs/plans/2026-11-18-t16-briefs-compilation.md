# T16 分包 brief 汇编（受控应用与恢复）

> 本文件由 `docs/plans/` 下 11 篇 T16 分包 brief 合并而成；小节标题即原文件名，内容按原貌保留，git 历史可追溯。总索引见 [docs/README.md](../README.md)。各 brief 中的 worktree 路径、基线与 `.superpowers/` 证据路径均为当时状态，不要直接复跑。

## 这些 brief 是什么

T16（`integrate apply` / `rollback` 受控应用与恢复）按 A / B / C / D 四方分工推进，每一方一份 brief 界定写入范围、所有权与完成条件。本汇编按 **A 侧三篇 → B 侧六篇 → D 侧一篇** 排列：

- **A 侧（独立 API 预期与安全案例）**：`t16-a-api-cases-brief` 立案例范围，`t16-a-assertion-review-brief` 与 `t16-a-assertion-round3-brief` 是两轮返工——审查在实际加载 assertions helper 后证实多个反例被错误接受，原 5/5 与 7/7 都不能作为真实生成绑定验收。
- **B 侧（产品实现）**：`t16-b-install-isolation-brief` 冻结产品 RED 的接口、安装隔离模型与 12 组首批 RED 清单，是后续所有 B brief 的设计基准；`t16-b-product-green-brief` 开启 GREEN 阶段；四个补修 brief（Node 探针、npm 隐藏锁元数据、React 权威 API、备份补充）与 `t16-b21-review-brief` 逐项关闭审查发现的 Important。
- **D 侧（独立黑盒）**：`t16-d-blackbox-brief` 规定黑盒必须经 `node:child_process` 调真实已安装 CLI，禁止 import 产品函数或 mock fs。

## 终态与权威记录

T16 技术交付已本地合并 main 并复验，完整 T16/T17、真实授权 Vue/React 业务项目及公司生产条件仍独立待验收。逐条 RED/GREEN 命令、实际计数与未覆盖边界以 `docs/verification/phase3-t16.md` 为唯一事实来源；本汇编只保留 brief 原文的授权范围与设计要求，不回写结果。

设计基线见 [T16 设计](../specs/2026-11-18-phase3-t16-design.md)，总计划见 [实施计划](2026-11-18-phase3-t16-safe-apply.md)。

## 逐条合并记录

### 2026-11-18-t16-a-api-cases-brief.md

本阶段 A 必须是实际 Antigravity 客户端。唯一写入目录：`C:/Users/10208/.codex/worktrees/t16-api-cases/zhinexus-design-asset-platform`，基线 `b951f43dd65fef9bd97a564455e608ce6857db42`。B 正在另一个 worktree 实现产品，A 不读 B 实现来计算 expected，不修改 main、B、contracts、SDK、根配置/锁与原架构。

先读 AGENTS.md、rules/architecture.md、rules/platform.md、rules/testing-release.md、rules/code-review.md、T16 已批准设计及计划、packages/contracts、SDK公开 exports 和实际类型/API。使用 executing-plans。既有设计已经批准，允许直接编写独立预期和测试。

仅写 `tests/acceptance/t16-a/**` 与新增 `docs/verification/phase3-t16.md`。不提交、merge、push、tag、pack、升版。无需修改产品或测试辅助器。

交付：

1. 7 逻辑组件 × Vue/React 共 14 实现的独立 API 对照：line/bar/pie/scatter/trend-card/ranking/proportion 的真实 import/exportName、必需数据 props、可选 props、事件 prop / Vue模板事件拼法、payload、style导出和 ready 方法。每项引用实际 SDK 文件/声明依据。
2. 独立 JSON fixture 描述合法 MatchPlan 输入、预期 import、prop、callback 绑定与输出文件类型。LineChart source 与 handler 必须不同；包含 `__proto__`/`constructor` 对调、引号、换行、反斜杠、HTML双引号、`</script>`、模板表达式和代码执行文本。这些值必须作为字符串键保留，不成为执行语法。
3. 不读产品的负例预期：伪SDK import、另一组件的 prop、错 prop/event、未渲染函数、局部同名遮蔽、无关字面量、后置 spread 覆盖、未知必需绑定应拒绝。提供可独立使用的断言和真实SFC/TSX类型/构建验收方案；不要用产品生成值作为 expected，不以字符串存在冒称真实绑定成功。
4. SDK0.0.11/0.0.12 冻结包只读，不重打包：冻结目录 `D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`，manifest SHA256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。无法运行的检查明确记录，不凭源码宣称消费者通过。

Windows固定工具调用可用 B worktree现存 `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform/scripts/pnpm.ps1`；A缺依赖时报告，由C安装，不改工具链。C之后在同一冻结CLI上消费A案例并运行真实8组合。没有真实业务项目，完整T16/T17仍未验收。交付后停写并报告实际文件、命令/结果与未覆盖边界。

### 2026-11-18-t16-a-assertion-review-brief.md

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

### 2026-11-18-t16-a-assertion-round3-brief.md

仅实际 Antigravity A 写入 `C:/Users/10208/.codex/worktrees/t16-api-cases/zhinexus-design-asset-platform/tests/acceptance/t16-a/**` 与新增独立验证记录。禁止写 main/B、读取 B 实现或 C helper 算 expected、修改契约/锁/版本、提交/pack/merge/push。先逐反例 RED，最小合理 GREEN，保留全部合法回归，完成后停写。静态解析不承诺任意 JS 的运行时语义；无法证明的路径失败关闭。

独立 reviewer 实际加载 helper SHA `00D933D140678FD26C12A1EFEF7691483972E5A6253CDFA820471C147BB6BA83`，发现以下 Important 问题；7/7 现有测试不足以覆盖它们：

1. 函数 `return <div/>; return <LineChart data={dataSources['sales']} onPointClick={handlers['onSelect']}/>` 死 JSX误收；`getData(){if(false)return dataSources['sales'];return [];}` 和 `getData(){return [];return dataSources['sales'];}` 死返回值误收。遍历 return/throw 后须停止该路径，return 收集须考虑 false 分支。
2. `data={'sales'?[]:[]}` 与 `onPointClick={()=>'onSelect'?undefined:undefined}` 不能将条件字符串算作返回值；Vue同类拒绝。`data={((x)=>[])('sales')}` 与 `onPointClick={((x)=>undefined)('onSelect')}` 的丢弃参数不能算绑定。`data={(()=>{(()=> 'sales')();return [];})()}` 丢弃调用不能算数据值。未知调用失败关闭，不无条件扫描callee/args作为有效值。
3. `export function Bad(sourceKey,handlerKey){if(false){const sourceKey='sales';const handlerKey='onSelect';}return <LineChart data={dataSources[sourceKey]} onPointClick={handlers[handlerKey]}/>}` 实际使用外层参数，块内常量不能泄漏或撤销参数遮蔽。
4. 顶层 `function buildChart(){return <LineChart data={dataSources['sales']} onPointClick={handlers['onSelect']}/>}` 加 `export function Bad(buildChart){return buildChart();}` 实际调用参数，不是模块helper。getData/getHandler同名参数遮蔽也拒绝；按调用位置作用域解析函数，不按全模块名称匹配。
5. `export function Good(){if(false){const LineChart=()=>null;}return <LineChart data={dataSources['sales']} onPointClick={handlers['onSelect']}/>} ` 是合法未被块声明遮蔽的SDK导入，不应误拒。无关块不能污染renderer作用域。

定位 assertions.ts 269/278、309、399、443/459/482、620、804/829（修改后行号可变）。保留合法单引号、默认导出arrow、callback引用和真实SDK alias。分别记录每类RED，不将一条综合测试的首个失败冒称其他反例均RED。执行含 `A10_FROZEN_BUNDLE` 窄测和 TS7 窄类型检查；记录实际命令、退出码、测试数和未覆盖边界。冻结SDK路径同第二轮。旧验证记录保持不变。

### 2026-11-18-t16-b-install-isolation-brief.md

日期：2026-11-18。C 冻结本 brief；B 为实际 Claude 桌面端。基线为 P0 提交 `2594f277` 加本轮恢复修正提交（以交接消息的完整 hash 为准）。工作目录为 Codex 恢复的 `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`，不得写主工作区。当前委派仅为**产品失败测试**，Windows 宿主 C 确认 RED 后才授权 GREEN。

#### 所有权与完成条件

- B 仅新增 `tests/integration/project-apply.test.ts`、`project-rollback.test.ts`、`project-install-isolation.test.ts` 及 `tests/integration/t16-support/*`。测试辅助文件不得匹配 Vitest 的 *.test.ts 模式。
- 只读 `packages/contracts`、公共 fixtures、CLI 内联 contracts、根配置/锁/版本、SDK、服务端、原始架构文档。本次不修改 CLI 产品源码、不补 stub、不改 exports、不升级依赖、不提交、不 merge/push。
- 使用已有 Vitest 和 Node 标准库。测试可 namespace 查找现有 CLI 出口并 optional 调用，缺函数必须产生行为断言失败；不能对尚不存在的文件静态 import，不能以 import/collect/typecheck 错误冒充 RED，不能用 skip/todo 隐藏缺能力。
- 每个测试保留实质性 expected（文件字节、实际 SHA、结果状态、进程边界或请求目标），不能只有“函数存在”的断言。独立本地 HTTP 服务模拟 API/registry，只使用明确的 synthetic 凭据。不要连接公司环境。
- 交付后停写，报告文件清单、用例数和预计失败原因。C 使用固定 Windows Node 26.13.0 / pnpm 12.18.0 构建现有出口后运行三文件，确认收集完整且因缺产品行为失败。

#### 固定接口

GREEN 阶段接口从 CLI 根出口导出，不接受离线任意命令、路径或 runner：

```ts
type IntegrationApplyOptions = {
  authorization?: IntegrationApplyAuthorizationV1; // 缺失必须 blocked
  apiUrl: string;
  registryUrl: string;
  apiToken?: string;       // 仅管理 API HTTP 请求
  registryToken?: string;  // 仅指定 registry origin
  backupRoot: string;      // 已检查的目标/workspace 外绝对目录
  workspace?: string;     // 与 T15 同义的选定成员
  outputDir?: string;     // 与 T15 同义，重派生后必须匹配
  requestTimeoutMs?: number;
};
type IntegrationRollbackOptions = { backupRoot: string };
applyIntegration(root, plan, options): Promise<IntegrationApplyResultV1>;
rollbackIntegration(root, backupRef: { id: string; sha256: string }, options):
  Promise<IntegrationRollbackResultV1>;
```

授权来自本次显式 apply 的调用边界；plan 的 executionAuthorized 仍恒 false。CLI 自行从通过复核的计划派生 allowedPaths 和 digest。canonical 摘要使用既有 T15 canonical JSON 规则，不用随意 JSON.stringify 的键顺序替代。重新 plan 比较权威字段和文件字节，checkedAt 时间变化不使一致计划失效。离线 commands 只是展示数据，绝不传给 shell，也不执行 run build/typecheck。

请求参数/损坏 JSON/备份无法可信读取时抛固定脱敏执行错误，由 CLI 映射 exit 1；例如 BACKUP_INVALID，不为无可信 operationId/planDigest 的备份编造合法 rollback 对象。有效操作产生 P0 结果，成功 exit 0，blocked/recovery-required exit 2，stdout 严格单 JSON。原始 stderr、URL 查询、token 不进入结果或日志。

#### 安装模型：包管理器只在外部暂存区运行

分为“候选锁生成”和“冻结依赖物化/受控交付”。目标工程从不作为包管理器 cwd/prefix/dir；不以临时更名项目 .npmrc 或删除 pnpmfile 实现隔离。

1. 只读检查目标和 workspace 的真实 root、选定包、受影响目录及 T15 base hashes；外部独占 staging/backup 目录必须与目标同卷（本版目录替换以同卷 rename 完成），且不在目标、workspace、其他源码或其链接别名内。
2. 从白名单字段重新序列化 manifests：name/version/private/type、dependencies/devDependencies/peerDependencies/optionalDependencies、受支持 engines、静态 workspaces 成员。保留原目标 manifest 全部字节用于备份和最终 patch；暂存 manifest 不带 scripts、pnpm 配置、config、packageManager 下载指令或未经支持的 overrides/resolutions。不能因删除会改变解析的配置而静默安装：影响解析且尚未支持的配置须 DEPENDENCY_CONFLICT 阻断。
3. 暂存区仅输入经解析检查的 lock v3/v9、上述 manifests 和静态 workspace 成员列表。pnpm-workspace.yaml 重新生成固定设置，不复制原 YAML 任意 keys；项目 .npmrc、pnpmfile、配置依赖、源码、.git、.env 均不复制。锁中的 registry 来源、integrity、包身份必须受校验；任意 git/file/link/portal/patch、workspace 本地依赖及动态配置本版显式阻断。静态 workspace 根和成员可支持；npm 自动生成的成员链接需按下一节受控重建。
4. 在 staging 生成候选锁；lock-only 进程不表示目标依赖安装已开始，且没有目标写入。冻结候选锁和拟写入内容，完整备份落盘，之后才按 hash 守卫写入目标允许的源码/清单/锁。
5. **冻结依赖物化进程启动前**，持久化 installStarted=true 并重新计算最终 backupRef.sha256；持久化或摘要更新失败时不启动进程。此标志保守表示依赖安装确已启动，即使暂存安装失败、尚未交付目标，也返回 reinstall-required；只生成候选锁不能设置它。备份版本按摘要不可变保存，最新日志原子指向当前摘要；恢复拒绝过时引用，不能用旧 installStarted=false 快照洗掉安装副作用。
6. 物化后检查实际依赖包版本、精确发布身份及同一 SDK 摘要，核对冻结锁未改写。不能把 plan.exactDependencies 复制成 installedVersions。通过下面的目录交付步骤安装到目标；最终从目标解析的直接依赖和实际文件重新计算证据，成功才 applied。

##### 依赖目录如何进入目标

仅把已验收的 node_modules 目录树作为显式安装副作用交付，源码和清单仍由逐文件备份/守卫管理。支持 standalone 和静态 workspace；后者明确枚举根及成员 node_modules，禁止超出这些目录。

- 暂存配置固定 pnpm nodeLinker=hoisted、packageImportMethod=copy，禁用外部全局 virtual store。目录树中普通文件不得为硬链接；links/junction 仅接受包管理器生成并经清单核验的边：内部依赖边须完全位于交付树；workspace 自动链接只允许指向已检查的成员 root，交付时按对应目标 root 重建。任何 stage 绝对路径、跨 root、未知 link 或可执行内容的自检过程均拒绝；不能执行依赖代码来验证版本。
- 在目标外建立同卷 ready 目录，复查真实父路径，检查 target node_modules 当前状态。既有目录仅可在完整安全清单和摘要守卫一致时移动到外部 quarantine；未知链接、并发变化或无法安全枚举则失败关闭，不递归清理。用同卷受控 rename 逐目录交付 ready 树，日志逐步记录已发生的目录副作用。不得直接复制覆盖现有未知树；跨卷目录布局本版显式拒绝。
- workspace 目录替换不承诺跨多个目录原子事务；部分交付或后续版本核验失败时保留恢复日志与 quarantine，不删除用户目录，不宣称恢复了 node_modules。源码恢复后仍 reinstall-required。quarantine 不计入 P0 源文件备份，不把它冒充用户可直接回滚的完整依赖快照。
- 这套设计需要真实 Windows npm/pnpm × Vue/React × standalone/workspace 验收。当前 RED 只冻结可观察要求；没有真实进程证据不得标记安装隔离完成。

#### 可执行文件、argv 和配置环境白名单

Windows 宿主使用工作区 .tools 内固定 Node 26.13.0（随附 npm **11.20.0**）和 pnpm-native **12.18.0**。先验证 executable 的绝对路径和 --version；不从项目 PATH 查找 npm/pnpm，不 corepack、不 npx、不下载其他工具链。spawn 参数数组，shell:false；npm 用 node.exe + npm-cli.js，pnpm 用 pnpm.exe。

以下 argv 由产品构造；S 是已验证的 staging cwd，U/G/C 是外部隔离的 userconfig/globalconfig/cache，R 是已验证 registry origin。占位值由可信边界生成，不能来自 plan.commands。workspace 成员由静态白名单决定，npm 不接收用户注入的 --workspace 参数。

| 阶段 | 固定 argv（cwd=S） |
| --- | --- |
| npm 候选锁 | node.exe npm-cli.js install --package-lock-only --ignore-scripts --no-audit --no-fund --registry=R --userconfig=U --globalconfig=G --cache=C |
| npm 冻结物化 | node.exe npm-cli.js ci --ignore-scripts --no-audit --no-fund --registry=R --userconfig=U --globalconfig=G --cache=C |
| pnpm 候选锁 | pnpm.exe install --lockfile-only --no-frozen-lockfile --ignore-scripts --ignore-pnpmfile --registry=R --store-dir=C |
| pnpm 冻结物化 | pnpm.exe install --frozen-lockfile --ignore-scripts --ignore-pnpmfile --registry=R --store-dir=C |

pnpm staging YAML 由产品固定：nodeLinker: hoisted、packageImportMethod: copy、enableGlobalVirtualStore: false、strictPeerDependencies: true、engineStrict: true、pmOnFail: error、ignoreScripts: true、ignorePnpmfile: true；所有动态 config dependencies / pnpmfile / hooks 被排除。版本不存在某设置或无法证明它生效时须停止该安装分支，先补版本证据，不能静默移除安全设置。

2026-11-18 固定版本兼容裁定：pnpm 12.18.0 拒绝旧 YAML `managePackageManagerVersions`。C 实际 characterization 确认上述固定 YAML 加产品内部环境 `PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false` 可生成候选锁、冻结物化且不执行脚本/pnpmfile；错误 pnpm pin 在创建锁和依赖目录前退出。内部值必须固定 false，不继承宿主同名键。不得用拼写建议 `initPackageManager` 代替安装隔离。见 [本轮版本证据](docs/verification/phase3-t16.md)。

不继承完整 process.env。仅保留 Windows 必需的 SystemRoot/WINDIR/COMSPEC/PATHEXT 及产品构造的固定工具目录 PATH，外部 TMP/TEMP、USERPROFILE/HOME/APPDATA/LOCALAPPDATA，CI=true、NO_COLOR=1。npm_config_userconfig/globalconfig 指向隔离文件，内部 PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS 固定 false；环境中 NODE_OPTIONS、NODE_PATH、PNPM_HOME、COREPACK_*、npm_config_* 的外部值、代理/自定义 CA/registry 设置、平台/API token 全部不继承。项目父目录配置也不得通过 cwd 的祖先发现：stage 放在独占隔离根，检测/阻断已有祖先 .npmrc 或包管理器工作区配置。内部正确构造的配置键不受上述“外部值”排除规则影响。

如 registry 需要认证，仅在隔离 U 中为精确 registry host/path 写入 registryToken，权限最小化，任务结束安全删除本任务创建的凭据文件；不得设置全局通用 _authToken，不把 apiToken 传子进程，不在 argv 放令牌。重定向不能携带认证到其他 origin，TLS 验证不得关闭。临时凭据文件虽可能被包管理器读取，也不进入备份、结果、公开 tarball 或可交付证据。

官方资料在 2026-11-18 实际读取，页面现行为说明依据，不单独证明固定版本实现；本机 npm package.json 实测 11.20.0，pnpm 包装器实测 12.18.0：

- [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)：冻结锁、manifest 不符拒绝、ignore-scripts。
- [npm config](https://docs.npmjs.com/cli/v11/using-npm/config/)：project/user/global 配置层和 userconfig；只指定 userconfig **不能**消除项目配置，故不在目标执行。
- [pnpm install](https://pnpm.io/cli/install)：lockfile-only、frozen-lockfile、ignore-scripts；ignore-pnpmfile 单独禁止加载 pnpmfiles（含 config dependencies）。
- [pnpm settings](https://pnpm.io/settings)：nodeLinker、packageImportMethod、全局 virtual store 与配置层。精确版本兼容及重定位仍待产品实测。

#### 恢复分类与首批 RED 清单

真实字节和 SHA 用 Node fs/crypto 独立计算；不能用公共 fixtures 的占位 a/b/e 摘要冒充文件证据。临时工程位于工作区外且每个测试独占；故障通过测试私有 module mock 或受控文件系统条件注入，不向公开 options 添加任意执行钩子。

1. 缺授权、错 root/digest/allowedPaths、allowInstall=false、旧计划命令注入：blocked、无目标 diff/备份/安装调用；API/registry 可控请求的目标和认证分别检查。
2. 重新核验发现文件/发布/API/摘要/资格变化：失败关闭；checkedAt 单独变化可继续。离线 Schema 通过不等于可执行。
3. Vue/React 生成器通过真正的字符串 prop/callback 绑定处理引号、换行、原型键、事件名与表达式文本，不 eval、new Function 或拼接业务表达式；未知必需绑定显式阻断。
4. 首个写入失败：备份已落盘，changedFiles/beforeHashes/afterHashes 为空，WRITE_FAILED、rolled-back、not-run，有可验证 backupRef；所有原始文件字节不变。
5. 第二个写入失败：只记录已提交文件的 before/after；恢复后已写文件 restored、未写候选 unchanged，不虚构完整成功或恢复动作。
6. 安装启动前日志持久化失败：没有依赖物化进程；installPlanned 不等于 installStarted。启动后失败：reinstall-required；返回 backupRef 摘要与最后磁盘 JSON 完全一致，旧引用拒绝。
7. 暂存进程 cwd、argv、环境与复制字段白名单；恶意 .npmrc、pnpmfile、环境 NODE_OPTIONS、scripts 无执行；npm API token 不在 registry/config/env，registry token 不在 API 或原始错误输出。
8. 冻结锁不符、实际安装版本不符、stage 外链接、未知目标依赖链接、并发 node_modules 变化：失败关闭，不能 applied；目录交付只落在明确安装范围，不运行项目 build。
9. 有效备份恢复：原文件（包括空字节）恢复、新文件删除、已匹配 before 的 unchanged；四组互斥并完整覆盖 candidates。
10. 用户在 apply 后编辑：preserved + 同路径 USER_EDITED，字节原样保留；恢复时 I/O 失败：unresolved + 同路径 WRITE_FAILED/RECOVERY_REQUIRED，禁止 USER_EDITED。
11. 同时有 restored/unchanged/preserved/unresolved：recovery-required，逐路径 coverage 精确；任何 installStarted=true 保留 reinstall-required。
12. 备份摘要/原字节/root/plan/id 被篡改、跨 root、链接/junction/hardlink、恢复前或期间 hash 变化：不覆盖用户文件；异常脱敏。

这些用例可先用未实现的根出口 optional 调用，期望为 undefined 对实质结果的断言失败。后续 GREEN 用于细分流程的 test-only mocks 需在实现文件存在后接入；本次禁止为了测试可运行而添加产品实现。

#### C Windows 交接门禁

运行 `scripts/pnpm.ps1 --filter @company/component-cli build`，再 `scripts/pnpm.ps1 exec vitest run tests/integration/project-apply.test.ts tests/integration/project-rollback.test.ts tests/integration/project-install-isolation.test.ts`。保留全量 RED 日志；报告 failures/passes、collect 是否成功、明确缺能力。不得在本轮 RED 后自动 GREEN。

后续真实 frozen SDK/CLI、npm/pnpm/workspace、网络资格复验和独立 D 黑盒仍是 P1/P4 门槛。synthetic 测试与 mocks 不替代真实授权业务项目；完整 T16/T17 保持未完成。

#### 2026-11-18 C 补充：依赖目录日志与清理失败的可观察约定

本段具体化前文已批准的逐目录日志，不改变公开 IntegrationBackupV1 或源码 rollback 契约。运行日志保存在工程外已核验备份操作目录 `<backupRoot>/<operationId>/install-delivery.json`，与不可变源码备份版本分开；cleanup 不删除它或 quarantine。JSON 为 `{schemaVersion:1, kind:'t16-install-delivery', operationId, projectRoot, planDigest, entries}`。每项为 `{importer, target, hadOriginal, quarantine?, state}`；target 是工程相对 node_modules 路径，quarantine 是同卷工程外绝对路径，state 为 `planned`、`quarantined`、`delivered`。entries 精确覆盖真实 ready 交付范围，不把未交付成员计入成功。

任何目标目录 rename 前，完整 planned 日志必须以独占临时文件和受控原子替换实际持久化；移动旧树后记录 quarantined、交付新树后记录 delivered。写日志失败立即停止后续目录动作，保留最后成功日志、quarantine 和实际目录现场，源码恢复且 installState 为 reinstall-required。日志与目录状态不承诺跨文件原子事务，planned/quarantined 的动作可能处于意图与完成更新之间，诊断必须复核磁盘，不能仅凭日志宣称动作未发生。备份父链、日志文件、临时文件须遵守普通路径、独占和防链接约束，不跟随并发替换。

旧树的完整安全清单与摘要必须在受控 rename 前后复核；并发改写时停止新树交付，保留真实用户字节（原目录或 quarantine），不得清理或冒称 applied。多目录第二次交付失败时，第一目录真实新树、各旧树 quarantine 与日志都保留，不伪造恢复了依赖目录。

cleanup 对 staging/env/ready 任一目录删除失败或删除后仍存在，都不得返回 applied；安装已启动则源码保守恢复并保持 reinstall-required。失败返回也尽力清除本次隔离凭据，错误对象和运行日志不得含 token。操作系统持续拒绝清理时记录未清理边界，不声称目录或凭据已删除；不删除用户目标目录。

#### 2026-11-19 C 补充：精确所有权与同次 apply 恢复

stage/env/ready 清理只删除可证明属于本次操作的树：根 `.t16-owner.json` 为普通单链接文件，精确 JSON 字节绑定固定 `kind:'t16-external-root'`、本次 `operationId` 和对应 role。目录名前缀不能授权删除未知树。测试 helper 仅允许并严格核验 stage 的此精确标记，不放宽 manifest/YAML 或凭据白名单。

日志窗口备份祖先被换为 junction 后，禁止穿链接读取或写回。正在执行的同次 apply 可从最近一次成功持久化、与 backupRef id/hash 和项目/计划/原字节绑定的不可变内存备份恢复源码；不能使用未落盘候选，第二次持久化失败保留第一次成功版本，不能伪造 installStarted。冷启动 rollback 仍从磁盘执行原完整验证，不能因此放宽祖先拒绝。

安装已启动时，干净恢复返回 `rolled-back + reinstall-required + INSTALL_FAILED`；源码用户编辑或恢复 I/O 失败返回现有 `recovery-required` 分类。保留最后成功 backupRef，但不声称被替换路径可达，不改写外部、日志或 quarantine 现场。独立三条 RED 和未覆盖边界见 [同次恢复记录](docs/verification/phase3-t16.md)。

#### 2026-11-19 C 补充：认领即时标记与备份最终双路径复核

env/stage/ready 的独占目录认领完成时立即写入精确 owner marker，不能等 context 成型或后续暂存写入才补证明。context 成型前的失败回收也必须核验当前普通目录及本次 operationId/role 对应的精确标记；原路径被替换为无标记用户树时，不认领、不删除该树，保留移走的原树和原始错误。

latest 原子替换成功并读回真实 journal 后，在返回成功 backupRef、授权任何目标源码提交前，复核 latest 与不可变 version **各自完整祖先链**及普通单链接叶文件。version 本身同字节且为普通文件，不能替代 versions 目录祖先复核；仅检查 latest 的祖先也不充分。发现任一链已被换为 junction 即失败关闭，目标源码、外部副本和移走的原备份树均保持原样。此规则收紧现有磁盘信任边界，不新增协议字段、不放宽冷启动恢复。

独立 C24 两条和 C25 的真实 Windows 文件系统安排、RED 与 B25 接收边界见 [新增验证记录](docs/verification/phase3-t16.md)。B25 已关闭 C24，C25 在 B25 仍 RED；B26 待原作者交付及实跑，不能把本段设计要求当成实现通过。

2026-11-19 B26 实跑更新：最终 version 祖先链复核已由实际 B 交付、C 机械应用；C21/C24/C25 七条回归和完整产品141/141通过，强制全图20/20零缓存及workspace通过。独立审查确认 B25 的 ensureImmutableVersion 已在版本读回后对完整链及叶文件复核；B26 正文的额外疑虑不作为扩修依据。上述历史“B26待交付”由本检查点更新，最终冻结安装验收仍待实际通过，详见[新增验证记录](docs/verification/phase3-t16.md)。

### 2026-11-18-t16-b-product-green-brief.md

日期：2026-11-18。用户在产品 RED 收口后明确选择“继续完成产品 GREEN 和验收，通过后合并”。本 brief 开启新阶段，不改写 RED 历史。

#### 身份、基线与授权

- B 仍为实际 Claude 桌面端，使用 executing-plans；C 为 Codex，负责公共契约、Windows 验证、集成与本地合并。
- 唯一实施 worktree：`C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`。当前 HEAD `b951f43dd65fef9bd97a564455e608ce6857db42`；P0 `2594f2776fb4b2de4a684fc3e50317ccc1d758dd`，恢复同步 `41a88e764059fea267f91451b4923290676f7d7f`。
- C 已实测三个产品测试完整收集：62 collected / 0 passed / 62 failed / 0 pending，缺 applyIntegration 的结果断言失败；契约85/85、CLI build及根typecheck通过。证据见 [最终 RED 记录](docs/verification/phase3-t16.md)。
- 允许 B 在下列产品范围实现 GREEN；B 不提交、不 merge/push、不 pack、不升级版本。C 在全部验收通过后提交及合 main，无 push/tag/生产发布授权。

#### 必须先读

`AGENTS.md`、相关 `rules/`、[T16 设计](docs/specs/2026-11-18-phase3-t16-design.md)、[实施计划](docs/plans/2026-11-18-phase3-t16-safe-apply.md)、安装隔离 brief（`2026-11-18-t16-b-install-isolation-brief.md` 小节） 的固定接口与安装/恢复要求、最终 RED 记录、现有三个 project 测试及 t16-support、T15 plan/inspect、SDK公开API和现有 CLI 命令边界。

旧 brief 的“仅测试/禁止 GREEN”只描述已完成的 RED 阶段；本阶段产品授权以本 brief 为准，其安装与安全契约继续有效。既有批准设计足够，无需重新等待设计确认。

#### 文件所有权

B：`packages/component-cli/src/integration/{apply,install,generate-vue,generate-react,patch,backup}.ts`（允许同职责的内部拆分）、`src/commands/integrate.ts`、CLI `src/index.ts`、help/dispatch/exports 与必要产品命令测试。遵守包 exports 边界。

C 独占：contracts及CLI契约镜像、公共fixtures、根配置/锁、package.json/CHANGELOG、README/计划/验证记录，以及最终 RED 收口的三个 `project-*.test.ts` 和 `tests/integration/t16-support/*`。B 只读这些测试；若测试接点与合理产品不匹配，报告实际写入/读取 API 与布局，由 C 接入，禁止放宽断言、恢复伪 overlay/latest、skip/todo 或逆改测试换 GREEN。SDK、平台与原架构只读。

#### 产品完成条件

1. 从CLI根导出固定 `applyIntegration(root,plan,options)` / `rollbackIntegration(root,{id,sha256},{backupRoot})`，options依安装brief，不添加公开runner。显式授权、独立replan、权威字段与base hashes复核；checkedAt变动不造成误拒绝。plan.commands永不执行。
2. Vue/React按真实SDK API生成安全字符串prop/callback。绑定文本是数据；拒绝未知必要绑定。源码/清单/锁用原字节备份和逐文件hash守卫提交，首/次提交失败按已发生动作恢复，不覆盖用户新编辑。
3. 外部同卷staging、固定工具绝对路径与版本、shell:false、argv/env/config/manifest白名单，两token独立。候选锁生成后冻结；源码备份落盘后写目标；物化启动前原子持久化installStarted=true与新摘要/latest，失败零启动。
4. immutable备份版本与最新引用；拒绝过时引用、错误root/plan/id/摘要/原字节、links/hardlinks和并发变化。无可信备份固定脱敏BACKUP_INVALID抛错。恢复四组覆盖精确；安装开始后一直reinstall-required，不能假称node_modules回退。
5. 真实锁与安装身份验证、目录枚举/摘要守卫、ready/quarantine受控同卷rename。workspace多个node_modules仅支持已检查范围；失败保存日志/未知树/用户编辑，不运行目标build/typecheck。
6. CLI严格单JSON stdout；参数/损坏输入exit1，有效成功exit0，blocked/recovery-required exit2。原始错误、URL查询、token不进入输出。

先交付产品存储/生成器接点，由 C 补最终 RED 记录五组待办：空字节及独立备份字段破坏、journal/latest真实故障及并发hash、按真实fs API适配一次性故障、LineChart专属prop/event与不同source/handler值、真实npm/pnpm传递依赖与多目录交付。已有62条不是完整验收。

#### 验证与停写交接

Windows宿主C用固定 `scripts/pnpm.ps1` 实测CLI build、三产品测试、T15回归及typecheck；B可在自己的执行环境进行可用窄测，但环境失败不得宣称产品通过。分阶段报告产品布局/接点及当前失败；完成产品后停写，给出实际文件、命令/结果和未覆盖边界。

C随后冻结新CLI一次，复用冻结SDK；A实际Antigravity给独立案例与API预期，D实际Claude Code黑盒验证，C完成仓外Vue/React × npm/pnpm × standalone/workspace与真实服务、全图/根测试/浏览器验收和独立全分支review，再本地合main及复验。没有真实业务项目，只标技术交付；完整T16/T17保持未完成。

### 2026-11-18-t16-b-node-probe-brief.md

日期：2026-11-18。沿用已批准安装隔离设计、B 产品文件范围与 C 测试所有权。

当前 `resolveToolchain` 仅校验 npm 与 pnpm 版本；路径包含 Node 版本不证明真实二进制版本。必须用同一固定绝对路径和隔离环境、`shell:false` 调用裸 `node.exe --version`，精确要求 `v26.13.0`，在 npm/pnpm 探针和任何候选锁/物化启动之前拒绝版本不符或进程失败。禁止从 PATH 获取、自动切换或下载工具链。

C 已新增三个独立产品测试：错误 Node 版本、Node 探针非零退出、固定正确 Node 版本。只通过测试私有进程拦截修改裸 Node 探针结果，不给产品增加公开 runner。三项均因未执行裸 Node 探针得到 RED。整文件实际命令：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-install-isolation.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/node-probe-full-red.json')
```

退出 1，19 collected / 11 passed / 8 failed / 0 pending；其中 5 项为已交接 pnpm12 兼容 RED，3 项为本轮 Node 探针 RED。JSON 与同名日志保留在当前工作树。此前筛选 `-t Node` 的运行仅验证这 3 项，另外 16 项未选择，不能作为全套验证。

B 只修产品 `integration/install.ts` 的真实工具链接点；C 独占所有 project 测试、helpers、契约、版本和记录。保留其他隔离与恢复要求，不放宽断言，不提交/pack/升版/merge/push。完成停写交 C 宿主复验。

### 2026-11-18-t16-b-npm-metadata-brief.md

日期：2026-11-18。沿用已批准安装隔离设计，B 独占产品源码，C 独占测试、验收配置、契约、记录及版本。

C 真实 Vue/npm/standalone 运行已穿过第三方依赖和冻结 SDK 下载：npm ci exit 0，所有相关 tarball 请求成功，staging 依赖树存在，候选锁在物化前后 SHA-256 均为 `236ae4b7788a0e49f33c95438f73eb782bffb8b06a9f61130c8025028f756cfc`。CLI 随后返回 rolled-back / INSTALL_FAILED / reinstall-required，尚未成功交付或构建。

阻断位于 `integration/install.ts` 的 `planDelivery`：npm 自动写入 `node_modules/.package-lock.json` 普通文件，根条目枚举仅接受目录，因而报 PATH_UNSAFE，再由 apply 映射到 INSTALL_FAILED。请处理这个已知 npm 元数据文件，维持链接、硬链接、树范围和交付前核验；不能简单忽略任意隐藏条目或允许任意普通文件。此元数据是否复制应由安全交付设计确定，不能将 staging 绝对路径带入目标。

C 在 `tests/integration/project-install-isolation.test.ts` 补了普通文件及同名工程外链接两条独立测试：普通文件导致合法安装回退，RED；工程外链接失败关闭、外部树字节不变、不交付 SDK，GREEN。命令：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-install-isolation.test.ts','-t','npm 隐藏锁元数据','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/npm-hidden-lock-red.json')
```

实际 exit 1，21 collected / 1 passed / 1 failed / 19 未选择，无收集错误。最新三个产品文件全跑为 84 collected / 73 passed / 11 failed / 0 pending，证据 `product-current-red-84.{json,log}`。另外 10 项对应 Node 探针、pnpm 固定 YAML/环境、React 完整 API 与 onPointClick 绑定；请同时读取已有三个补修 brief，不放宽 C 测试。

只在指定 B+C 工作树修改已有 B 产品文件。完成停写交 C，不提交、升版、pack、merge 或 push；C 后续重新构建并验证真实安装矩阵，再冻结正式产物。

### 2026-11-18-t16-b-react-authority-brief.md

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

### 2026-11-18-t16-b-backup-supplement-brief.md

本阶段延续用户已批准的产品 GREEN。唯一工作树为 `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`，继续遵循产品 GREEN brief 的文件所有权。B 仅修改产品源码；三个 project 测试、t16-support、公共契约、版本与记录仍由 C 独占。无需重新设计确认。不提交、不 pack、不升版、不 merge/push。

#### Windows 实测 RED

原产品三套测试已由 C Windows 宿主复验 62 collected / 62 passed / 0 failed / 0 pending，exit 0，证据 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/green-check-after-site-fix.json`。

C 新增 15 条备份补充测试，过滤窄测 exit 1；选中的 15 条实际 9 passed / 6 failed。其余 46 pending 仅因 testNamePattern 过滤，不是新增 skip。报告 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/backup-supplement-red.json`。

1. `project-apply.test.ts` 中四条 `installStarted 备份`（version/latest × writeFile/rename 一次性故障）均确认命中真实持久化接点，随后抛出 `IntegrationApplyError: apply 结果未通过 IntegrationApplyResult`，未返回契约要求的 rolled-back/not-run。必须恢复目标原字节，零物化启动，返回真实最新可达且 installStarted=false 的备份引用。不要把内存置 true 当作实际安装已启动。
2. `project-rollback.test.ts` 的 `恢复暂存原字节后用户改写目标`，在真实临时文件写入窗口注入新编辑后，产品覆盖了新字节。必须保留新编辑并归入 preserved + USER_EDITED，保持完整四组 coverage，不得冒称 restored。
3. `latest 的 schemaVersion 不受支持` 将真实 latest 版本号改为 999，当前仍返回恢复结果。必须 BACKUP_INVALID 脱敏抛错且目标零写。

通过的控制包括四条初始备份故障、合法派生空原字节备份、四种独立备份字段破坏。派生 fixture 基于真实版本/latest 布局和实算摘要，不冒称原 apply 的文件本来为空。合法 64hex planDigest 被替换是否可信不在这些测试中；当前缺少独立可信锚，不能通过自证字段强行宣称已解决。

#### 验证与交付

先读新增测试与真实失败 JSON，再做最小合理产品修复。不得改断言、skip/todo、伪造 latest 或放宽用户编辑保护。运行三个 project 测试和相关 CLI 类型检查；Windows 固定工具链由 C 宿主复验。若 B 的 Linux 工具不可用，明确报告，不等待无回执命令。完成后停写并报告实际改动、结果与限制。

### 2026-11-19-t16-b21-review-brief.md

负责人 B：实际 Claude 桌面 GLM-5.3 High。C 仅提供失败证据、机械接收与执行，不代写产品。基线为已接收 B20；本次只交精确 unified diff，不执行命令，不直接改文件，不改测试与公共契约。

工作目录：`C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform`。

必须先读取 AGENTS.md、相关规则和现有代码。允许产品范围：`packages/component-cli/src/integration/apply.ts`、`backup.ts`、`install.ts`。保留所有既有 B20 行为，尤其未提交候选不能被恢复、用户编辑保留、冷恢复不绕过磁盘验证。

#### 已确认 RED

固定 Node/pnpm 实跑 `project-apply.test.ts` 与 `project-install-isolation.test.ts`，过滤 `C21`：109 collected / 0 passed / 4 failed / 105 unselected，exit 1。证据 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c21-review-red-02.{json,log}`。四条均命中真实文件系统窗口，在实质行为断言失败，无收集错误。

1. `C21 首次真实提交后读回一次 EACCES：已提交源码必须恢复并纳入副作用证据`。真实目标 rename 已放行成功，紧接着一次 readFile EACCES；当前 changed 登记晚于读回，因此源码残留，原树 2 项变为 6 项。成功提交必须立即登记已提交 receipt 与 before/after 证据，再执行可能失败的读回；不能把 rename 失败或从未提交的候选登记为已提交。
2. `C21 初次 version 临时写入窗口替换 backup 祖先：阻断并保留外部树与目标`。
3. 同上 `latest`。两例均在真实 temp 已写入后、rename 前的首次 backup 下 lstat 读取窗口，克隆原 backup 树（包含真实 temp）到独占 outside，记录快照，再把原祖先移开并替换为 junction，放行读取。当前版本/latest 会修改 outside 并继续。提交前需复核原始整条祖先、temp 的普通文件形态与字节，持久化后读回版本/latest 才能返回成功 reference；路径不可信时不可沿其清理外部 temp。必须保持 outside 快照和目标树不变，blocked/BACKUP_INVALID、无 changed/无安装。
4. `C21 stage 创建窗口被未知普通树抢占：不得认领并删除用户 sentinel`。真实 stage 根 mkdir 前，夹具创建同名普通目录与用户 sentinel（无 owner marker），再放行 mkdir。当前 recursive mkdir 认领此树并最终删除 sentinel。stage/ready 根应原子独占创建，EEXIST 失败关闭，不写标记，不删除未知树。envRoot 当前在环境准备中已提前 recursive 创建 env/tmp，需要完整梳理本次目录创建和认领顺序，不能机械把全部 mkdir 改为 nonrecursive。须保留 sentinel 原字节，blocked、物化未启动。

查看测试全部断言，不删改测试，不通过放宽安全边界规避。补丁须对应当前文件精确中文上下文，旧中文逐字保留，不翻译、不省略；所有 hunk 的 context/deletion 必须唯一有序匹配。为控制交付长度，本次只返回这三个文件的必要 diff 与简短静态说明；C 将重算 hunk 行数并 git apply --check 后机械接收。若无法全部完成，明确剩余项，不能声称测试通过。

完整结尾必须为：`未执行；交付完毕，停写待C`。等待 C 实跑四条 GREEN、完整产品、构建类型和独立审查后再继续。最终冻结消费者、完整 D 黑盒、根回归与本地合 main 仍待通过。

### 2026-11-18-t16-d-blackbox-brief.md

2026-11-19 当前冻结交接：CLI `0.0.14` tarball SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`；B26 产品 141/141，D 既有三文件在仓外实际安装入口 5/5。D27 超时无源码，D28 静态错误未接收；D29 独立辅助文件、后续主测试和字段控制由实际 Claude Code GLM-5.3 原作者继续交付。当前不合 main，历史 brief 状态保留。C 提供真实 API/registry、同一冻结 SDK、固定 Node/npm 和已安装 CLI 入口；所有 D 断言仍由实际 D 编写。

纠错：`changedFiles` 是 `string[]`，`beforeHashes` / `afterHashes` 是 `{path,exists,sha256?}[]`，`installedVersions` 是 `{name,version}[]`；备份 `originalBase64` 在 files 项上，与 `before` 同级。URL 环境不能使用文件绝对路径判断；Windows 协议 root 使用规范化正斜杠，与实际路径独立归一后比较。基线 npm 不继承进程凭据或用户 npm 环境，两个空 config 必须为普通文件。源码快照只排除根 `node_modules`，备份快照不排除条目；两者 lstat 拒绝链接/硬链接。生命周期毒脚本必须实际写到传入的本轮绝对 marker。禁止占位断言或把数组索引当路径。

冷无效备份公开 CLI：exit 1、单 JSON `status:error,error.code:EXECUTION_FAILED` 和固定脱敏信息，无写入；不是 exit 2 的有效 recovery-required 报告。原字节/root/id 字段篡改须重新建立对应 SHA 命名版本文件并同步最新 journal，然后以新引用调用冷 rollback；故意篡改后的 snapshot 才是失败零写入对照。陈旧 ref 使用真实新旧合法版本/journal证明，不能以缺文件或引用失配冒充字段校验。无法稳定注入竞态时明确未覆盖交 C。

日期：2026-11-18。D 必须为实际 Claude Code，C 为 Codex。用户已授权产品 GREEN、技术验收通过后本地合 main；不 push/tag/生产发布。

唯一工作树：C:/Users/10208/.codex/worktrees/t16-blackbox-cases/zhinexus-design-asset-platform，基线 b951f43dd65fef9bd97a564455e608ce6857db42。仅写 tests/acceptance/t16-d/** 与新增 docs/verification/t16-d-blackbox-2026-11-18.md。不改 main、B、SDK、contracts、根配置/锁、产品、既有测试、原架构。不提交/pack/升版。使用 executing-plans，设计已批准。

先读 AGENTS.md、rules/architecture.md、rules/platform.md、rules/testing-release.md、rules/security.md、rules/code-review.md、docs/specs/2026-11-18-phase3-t16-design.md、docs/plans/2026-11-18-phase3-t16-safe-apply.md、安装隔离 brief、packages/contracts 公共定义和既有公开 CLI README/help 约定。不可读 B 的 integration/{apply,backup,install,patch,generate-*}.ts 计算 expected。

阶段一：先交付独立 harness/案例和执行说明。用 node:child_process shell:false 调用真实构建/已安装 CLI 单独进程，绝不 import apply/rollback 产品函数、mock fs/child_process 或伪造产品输出。CLI 路径用 T16_D_CLI_ENTRY 环境变量；冻结最终 tarball 用 PHASE3_CLI_TARBALL，未提供时清楚报不可执行，不 skip/todo 冒称通过。允许独立 loopback synthetic API/registry，不复制 B/C 的 recorder 来模拟安装成功；需要真实安装时使用冻结 SDK 同一 tarball 与真实固定 npm/pnpm。不得重pack SDK。

案例至少包括：
- 参数/坏 JSON/未知字段拒绝（exit1），有效 blocked/recovery-required exit2，成功 exit0，stdout严格一个JSON，stderr/stdout不回显synthetic令牌/查询。
- inspect/plan零写入且executionAuthorized=false，apply显式root/plan/allow-install边界，篡改计划commands永不执行。
- 成功控制 + 原始hash改变/跨root/路径穿越或Windows alias阻断，独立逐字节树快照。
- 成功apply产生真实backupRef，再独立进程rollback；新文件删除、原文件原字节恢复、用户后续编辑保留、四组互斥完整覆盖，installStarted副作用一直reinstall-required。
- 原backup摘要失配、原字节/root/id绑定破坏、stale ref保守拒绝，不能让缺索引或未建立成功fixture冒充字段检查。
- 未授权安装无进程、副作用范围/恶意目标hook或配置不执行、两token隔离；不能读取用户真实凭据配置。
- 恢复期间竞态需要可观测实际边界，不能使用sleep赌时序或改产品加公共runner；无法可靠注入时明确未覆盖交C，不编造通过。

C/B当前产品62测试为42passed/20failed，安装选址正在修复。你此阶段写harness与独立测试，最终真实CLI执行留待C提供冻结路径后再次启动D。本机依赖初始未安装，C可安装；可用B固定 scripts/pnpm.ps1，但含-p参数必须数组splat。SDK冻结目录 D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3，manifest sha256 04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1。日志不得记录凭据。仓外synthetic只证明技术验收，完整T16/T17保持未完成。

交付后停写，报告实际文件/命令/exit/未覆盖边界；不擅自宣称产品GREEN。

#### 2026-11-18 单成功控制交接纠错

C 提供的 apply/recovery 第二轮文本 brief 曾错误给出 API `/v1/integration-targets`；实际公开查询路径为 GET `/v1/matching/components`。子进程凭据使用公开 `ZHINEXUS_API_TOKEN` / `ZHINEXUS_REGISTRY_TOKEN`，不能用 harness 私有变量名代替。完整 MatchPlan 写入 match 文件，真实 plan stdout 保存到外部 plan 文件，再交 apply；plan 也必须显式传 registry。此纠错不修改产品适配测试。

无安装、只有 generated-component 的成功控制中，未变清单与锁的原字节通过完整工程快照证明。公开 IntegrationBackupV1 是 JSON，files 仅覆盖计划变更候选；不能要求未变 package.json/锁出现在备份或恢复候选中，也不能把任意 index/manifest/首文件当 backupRef 证据。递归 lstat 拒绝链接和硬链接，独立实算唯一版本文档 SHA-256 匹配真实 backupRef；核对 operation/root/plan 身份、候选 before/after 与实际字节。rollback 四组互斥完整覆盖该真实候选集。此控制未覆盖既有文件原字节恢复，须后续另立案例。

实际 D 第二轮原文完整但有 ESM 入口、端点/凭据、fixture 和证据断言错误，C 未落盘、未执行、未改写。第三轮已按上述纠错退回原作者重交完整同文件。不得据交付状态宣称黑盒成功。
