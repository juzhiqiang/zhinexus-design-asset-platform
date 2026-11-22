# T17 本地验证、有限修复与 MCP 设计

日期：2026-11-19（Asia/Shanghai）。起点 main@7e10ba19，C 集成分支 feat/t17-integration。本文细化既有 T17，不改变原始架构。用户已授权继续三期既定工作，并调整为实际 Antigravity 主开发、Codex 协调；本轮不增加例行审批停顿。用户进一步授权临时创建 Vue/React 工程用于端到端验收，完成后清除临时工程、保留证据。

## 目标与既有边界

消费 T15 IntegrationPlanV1 和 T16 实际 IntegrationApplyResultV1，在开发者本机运行原生命令、关键交互和固定环境视觉核对，输出报告；只对已知生成模板问题作最多两次确定性修复，每轮重新验证。通过现有 CLI 包的本地 stdio MCP 暴露四个既定工具。

T15 executionAuthorized:false 和 plan.commands 预览语义不变。T16 不执行 typecheck/build，也不自动接入业务路由；T17 不修改路由、业务接口、鉴权、依赖或用户配置。服务端不新增构建、执行项目代码或浏览器功能，工作区保持十个成员。发布 CheckReportV1 与接入报告分别建模，接入通过不自动登记平台兼容记录或接受视觉基线。

本轮范围使用明确标注 temporary/synthetic 的仓外 Vue/React 工程端到端验收，依据用户授权创建并在保留证据后清理，不重复请求真实项目目录。临时项目不是已有业务项目；历史计划中两个真实业务试点的门槛单独保留，并在 assessment/总计划记录本轮范围决定，不能冒称该历史门槛已经完成。

## 本轮作者与文件所有权

| 作者 | 唯一写入范围 | 交付 |
| --- | --- | --- |
| C / Codex | packages/contracts、公共契约 fixtures、根配置/依赖/锁、Schema、CLI 契约同步清单、版本/CHANGELOG、README、设计/计划/验收编排与收口 | 冻结接口、真实环境、独立接收/集成与门禁 |
| A / 实际 Antigravity | CLI integration/verify.ts、repair.ts、report.ts 及必要同目录 helper，mcp/server.ts，CLI 接线/导出与产品测试 | 本轮主要产品实现、RED→GREEN |
| B / 实际 Claude 客户端 | tests/acceptance/t17-matrix、tests/fixtures/t17-matrix 和独立记录 | 预声明双框架场景、独立预期、真实浏览器矩阵 |
| D / 实际 Claude Code | tests/acceptance/t17-blackbox 和独立说明/记录 | 仓外安装冻结 CLI 的独立进程黑盒及 CLI/MCP 一致性 |

该表覆盖旧轮次对本轮产品的默认分配，历史作者/记录保持。产品与独立断言由被指派的实际客户端产出，Codex 子代理不冒称这些客户端。公共契约先冻结再并行，最多四项 in_progress；CLI 接线由 A 一人串行收口。C 不代写 A 产品或 D 断言；接口冲突先由 C 更新契约/fixtures，不能互相覆盖。

## 产品接口与新增契约

    verifyIntegration(root, plan, { applyResult, spec, authorization, artifactRoot, ...adapters }): Promise<IntegrationVerificationReportV1>
    repairIntegration(root, plan, report, { applyResult, spec, authorization, maxAttempts, artifactRoot, ...adapters }): Promise<IntegrationRepairResultV1>

maxAttempts 默认 2，只接受 0、1、2。adapters 是受信程序调用边界的依赖注入，不成为 JSON、CLI 或 MCP 的自由执行参数。C 在 packages/contracts/src/integration-verification.ts 与 integration-repair.ts 冻结纯环境无关类型、Schema、固定 issue code/message、上下文验证器与 fixtures；Schema 只证明结构及交叉引用，真实授权、realpath、字节、安装、进程和浏览器结果仍由本地产品验证。

所有摘要为小写 SHA-256；对象摘要基于 canonicalJson，文件摘要基于原始字节。报告自身摘要放外部证据索引，禁止自引用。

### IntegrationVerificationSpecV1

共同身份：schemaVersion:1、projectRoot、planDigest、applyResultDigest。projectRoot 沿用规范 Windows 绝对路径语义。

- commands[]：{kind:type|build,script,manifestPath,manifestSha256,timeoutMs,outputDirectories:string[]}。路径相对项目根，cwd 从计划 workspace 重新派生，script 必须为对应清单的真实脚本。不接受自由 executable/shell/argv 或错误文本命令。
- browser?：{url,readySelector,timeoutMs,viewport:{width,height},renderer:canvas|svg,theme,actions,assertions,visual?}。url 只接纳本次边界明确提供的精确 loopback URL，无 userinfo/凭据/非本地重定向。actions 仅 {kind:click|fill,selector,value?}；assertions 仅 {kind:visible|text|count,selector,value?,count?}，各 kind 的必填/禁用字段由 C 固定。不接受 evaluate、JS、测试脚本路径或自动导入模块。
- visual?：{baseline:{image:ArtifactRef,environment:EnvironmentV1},pixelThreshold,maxDiffPixelRatio}。复核已有基线的实际 bytes/hash/尺寸与环境，既定验收阈值为 pixelThreshold=0.1、maxDiffPixelRatio=0.001；spec 含 visual 时必须显式提供两个字段，环境不同时不得 PASS。
- businessGaps：C 冻结的缺失业务信息枚举数组。缺业务源、handler、宿主页/挂载、交互预期或视觉基线时保留明确缺口，不编造连接。

首批 browser 消费可信调用方明确提供的既有本地宿主页，synthetic 宿主由独立验收 harness 启动；产品不自动写 route 或启动远程服务。正确启动并加载本轮生成模块是可信调用边界的前置条件，loopback 地址本身不是服务或模块来源证明。passed 只表示本次显式声明的宿主页、动作、断言及视觉检查通过，不自动证明业务已接入；首批不实现恶意宿主的机器证明。B/D 矩阵与业务验收必须另记宿主 entry 对生成路径的真实 import、构建与资源加载证据，C 审查错宿主页案例，不能以静态假页计入真实接入成功。

### IntegrationExecutionAuthorizationV1

包含共同身份与 operation:verify|repair、specDigest、allowProjectScripts、allowBrowser、scriptNames、allowedRepairPaths、maxAttempts、sourceReportDigest?。verify 禁 repair 路径/次数；repair 必须绑定源报告摘要，精确路径只能为原计划 generated-component 文件子集，最多两次。

授权由本次显式 CLI 调用或已配置权限的 MCP 宿主边界在内存构造；磁盘 plan/spec/report 或请求 JSON 自报 true 不是人类批准。边界重新派生脚本/路径/摘要，跨 root、plan、apply、spec 或报告重放均拒绝。

### IntegrationVerificationReportV1

包含共同身份和 specDigest、operation:verify、id、toolVersion、verifiedAt、status:passed|failed|blocked，以及：

- checks[]：{id,category,status,issues,evidence:ArtifactRef[]}；category 为 type|build|behavior|visual|missing-business-info，status 为 passed|failed|blocked|not-run；issue 为固定 code+message，可附合法相对 path。
- changedFiles、snapshots:{before,after}：验证前后源文件快照和变化；发现用户新增文件与删除，不只保护原计划写集。
- installedVersions[]：{name,version,manifestSha256}，从真实安装树读包清单字节。依赖/lock/发布身份复核作为 behavior 的必需额外 guard，不能被页面 PASS 覆盖。
- visualResult:PASS|DIFF|NEW|INCOMPATIBLE|not-run、environment?、artifacts:ArtifactRef[]、pendingItems:Issue[]。

passed 必须五类完整通过，具有真实 installed proof、视觉 PASS、匹配环境/截图证据。类型通过但点击失败、画面通过但版本不兼容、NEW/DIFF/环境不兼容、业务缺口、not-run 均不通过。运行前信任/授权/输入不足为 blocked；运行后真实检查失败为 failed，后续未执行项保持 not-run。原始子进程/页面报错是不可信诊断，不直接成为固定 message。

### IntegrationRepairResultV1

包含共同身份与 specDigest、operation:repair、id、sourceReportDigest、maxAttempts、attempts、status、stopReason、finalReport、changedFiles、pendingItems。status 为 repaired|stopped|blocked|recovery-required。

attempts[]：{attempt,recipeId,beforeReportDigest,afterReportDigest,changedFiles,beforeHashes,afterHashes,backupRef}。连续从 1 开始且不超授权上限，摘要链连接真实报告。初始 verify 不算修复次数；maxAttempts=0 只交接问题。repaired 必须 finalReport 真正 passed；无 recipe/预算耗尽为 stopped；写前越权/用户变化为 blocked；部分写入无法恢复为 recovery-required。

## 验证执行与证据

1. 校验 root、plan、apply result 同根同计划，apply 必须真正 applied。守卫从 apply.afterHashes 出发，再形成当前全部相关源文件快照；不能用 apply 前的 baseFileHashes 拒绝正常生成文件，不能重跑 plan 把现有生成文件误判为 OUTPUT_EXISTS。
2. 保留 T16 无安装场景 installedVersions=[] 的语义。verify 独立读取真实安装树、lock、精确依赖，不能从 apply 数组/计划/目录存在推断已安装。共享 apply context 验证器与无安装产品分支的既有差异，由 C 先用 RED 对齐，禁止通过伪造 installedVersions 绕过。
3. 核验 commands 对应清单原字节与脚本，使用固定工具链绝对路径及固定 argv 跑真实 native type/build。C 先核验 npm/pnpm 脚本与 lifecycle 语义给出命令表，真实 poison sentinel 证明未授权 pre/post 不运行。shell:false 保护外层启动参数，不把 native script 变成 OS 沙箱。
4. native script 属于另行显式授权的可信项目代码执行，可能写声明构建输出；allowedRepairPaths 只约束工具主动修复写入。不能凭快照探测宣称恶意脚本绝无工程外副作用。清除 API/registry 凭据、NODE_OPTIONS 与配置覆盖变量，环境保留固定工具链/必要系统键；进程、时间、输出有界。禁止隐式安装、npx、下载工具链或执行报错建议。
5. outputDirectories 只接纳目标 workspace 内传统 build output/cache，如 dist/build/.next；拒绝根、src、业务源码目录、通配符、路径别名及链接到源码的目录。源快照仅排除 .git、node_modules 与已核验输出，其余 dirty/untracked 仍参与检查。默认单源文件 4 MiB、最多 10000 文件、合计 256 MiB；超限/I/O 不确定失败关闭，不漏扫后声称完整。
6. browser 用无用户 profile/cookie/storage 的新 Chromium context。限制导航/重定向/资源 origin，拒绝外部网络、文件协议、下载和弹窗。等待 readySelector、字体、有效尺寸，执行有限动作和可观察断言；pageerror、超时、零尺寸或断言失败均失败。不能以截图或示例 getChecks 自报代替关键交互。
7. 用实际截图与确定环境比较基线，可复用 environment/compare 工具；禁止沿用 captureExample 的空自检 fallback 填成功。NEW 不自动接受、DIFF 不自动更新，unknown-manual 不作为自动基线。
8. 结束复读源快照，变化即报告，不自动还原用户现场。只关闭本次拥有的进程/浏览器，不按端口杀其他服务。超时/取消/启动失败/证据写入失败都有诚实结构化结果。

artifactRoot 由 CLI --out 或 MCP server 启动参数绑定，位于目标工程外，不能从任意 JSON 导出文件。baseline.image 相对 artifactRoot 读取，检查普通文件和真实 bytes/hash；每次输出使用独占 run 子目录，不覆盖基线或旧证据。日志、截图、报告和摘要索引互相追溯；token、Cookie、原始敏感环境与未清洗错误文本不进入记录。

## 有限修复

只运行有明确识别条件及独立 RED 的已知生成模板 recipe，使用现有生成器重建可识别形式。A 产品 RED 固定实际 recipeId、精确可匹配字节形式及修正效果。至少一个 recipe 必须在真实文件/浏览器场景修复成功，不能以恒定 stopped/no-op 交付；故障夹具标 synthetic，不谎称是已发布 SDK 缺陷。

每轮先复核源报告/spec/digest、apply 后守卫与前轮快照，新增用户文件、编辑、删除、链接替换立即停止。只改计划生成文件，不改 package/lock、业务路由/接口/鉴权、tsconfig 或基线；依赖/API 变化和业务缺口交人工或新计划。

先向外部备份根持久化本轮原字节和可信摘要，再使用普通路径/晚 hash 守卫写入。初轮守卫必须与原 apply.afterHashes 及源报告 snapshots.after 一致。写入后，以上一份完整可信快照为基底，只替换本轮合法写入且已经复读确认的路径哈希；这份仅在本次 repair 运行内可用的快照用于本轮完整重验。保存本轮 attempt.afterHashes 与重验的 afterReportDigest，再由下一轮绑定复核。原 applyResultDigest、planDigest、specDigest 始终不变，不能改写 apply 结果或允许外部 JSON/普通 verify 调用传入替代 hash。普通 verify 仍从原 apply 基线开始；修复后的 finalReport 必须连同 repair envelope、逐轮摘要/快照/备份解释，首批不提供跨运行续跑。每轮重验包含全源快照、真实依赖、原生命令、行为与视觉，不能只复测失败项。写失败按 afterHash 恢复自身仍匹配的改动，保留用户后续编辑，无法恢复如实报告。不得承诺 node_modules 回滚，不得由 MCP/spec/错误文本扩张两次硬上限。

## CLI 与 MCP

新增 component integrate verify/repair，显式提供 project、plan、apply-result、spec、out；脚本/browser 布尔 scope 显式选择。repair 另带 report、max-attempts，备份在 out 独占子目录绑定本轮操作。C P0 fixture 固定精确 flags 后交 A。stdout 单 JSON，诊断 stderr；0 仅 verify passed/repair repaired，2 为结构化失败/阻断/停止/恢复待处理，1 为参数/输入或无法形成可信结果的执行错误。既有 T15/T16 语义保留。

component mcp serve 使用本地 stdio，只暴露 inspect_project、plan_integration、apply_integration、verify_integration。没有 HTTP server、远程执行集群或第五个 repair 工具，verify 不隐式修复。四工具与 CLI 共用产品函数/Schema/授权/路径判断。

C 当前已用固定 Node 补验精确 server/client 2.4.0、zod 4.6.7 的导出与类型，真实 stdio 产品测试覆盖握手、工具列举/调用和严格输入；见 [当前本机证据](docs/verification/phase3-t17.md) 与 [官方来源更正](docs/verification/phase3-t17.md)。原 P0 独立日志、最初 RED 顺序与原始 stderr 空字节尚未追溯，不追认历史探针。server 启动时绑定允许根目录/artifactRoot，由宿主可信配置控制 apply/verify；工具 JSON/annotations 不代替批准，verify 不能标只读。stdout 仅 MCP 协议，日志 stderr。用实际 SDK stdio client 验证握手、四工具 schema、错误、取消和退出。

## 技术与业务验收

B 在产品运行前冻结场景 manifest/expected，至少十 Vue+十 React 支持域有效接入；每例预声明包管理器、workspace、冻结包身份、宿主/业务数据/事件、就绪/交互和基线，跑完不能改分母。建议二十个正向案例，两框架分别实际运行：

| 序号 | Vue | React |
| --- | --- | --- |
| 01 | npm standalone 折线+事件 | npm standalone 折线+事件 |
| 02 | pnpm standalone 柱状 | pnpm standalone 柱状 |
| 03 | npm workspace 饼/环图 | npm workspace 饼/环图 |
| 04 | pnpm workspace 散点 | pnpm workspace 散点 |
| 05 | 趋势卡/排名/占比多实例 | 趋势卡/排名/占比多实例 |
| 06 | 空数据到业务数据更新 | 空数据到业务数据更新 |
| 07 | 隐藏/零尺寸后显示 | 隐藏/零尺寸后显示 |
| 08 | KeepAlive 激活/resize | StrictMode 挂载/清理 |
| 09 | 系列删减、主题/renderer | 系列删减、主题/renderer |
| 10 | 已知模板 recipe 修复后通过 | 已知模板 recipe 修复后通过 |

成功率=预声明支持域内全部必检通过数/实际承诺案例数，要求至少 80%，分别报告双框架结果；跳过、未运行、blocked/失败不计成功。peer 冲突、脏目标/中途编辑、无候选、缺业务接口、类型过点击失败、画面过版本不符、NEW/DIFF/环境不兼容、两次后仍失败、路径链接、敏感输出、MCP 越权/协议污染另立强制拒绝回归；拒绝成功不能进入正向成功分子。所有实际失败都有报告。

C 在同一新冻结 CLI tarball 上仓外安装，接真实本地 API/Registry、双框架矩阵、D 黑盒及真实 MCP stdio client；不得用源码 import/workspace 链接冒充消费者。最后运行强制全图、根测试、受影响浏览器/平台及 T15/T16 冻结回归，独立审查无未解决 Critical/Important 后才技术收口。兼容 CLI 新能力按 0.x 规则独立升至 0.0.15；并行版本已占用则取实际下一 PATCH。不改冻结 SDK，不 push/tag/生产发布。

本轮临时 Vue/React 端到端项目必须形成 diff、原生命令、关键交互、视觉、独立安装身份和未覆盖边界证据。C 为每个临时根保存本轮随机 runId 标记、规范真实路径和创建清单；清理前先向外部证据根持久化文件清单/hash、报告和必要截图，确认进程已退出，再仅清除清单中本轮独占创建且标记匹配的目录。不得删除工作树、用户已有项目、共享目录或旧运行证据；路径/标记不确定时停止该清理并报告保留路径。历史真实业务试点保持单独未完成，不把临时工程改名为真实项目。原架构 SHA-256 保持 E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723。分批任务见 [实施计划](docs/plans/2026-11-19-phase3-t17-completion.md)。
