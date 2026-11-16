# 三期 T15 四方开发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans in each assigned client. Preserve the user's four-client execution method; Codex review subagents do not replace Antigravity, Claude desktop, or Claude Code. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `component integrate inspect/plan`，在目标项目零写入的前提下输出有版本、摘要、路径和冲突证据的本地接入计划。

**Architecture:** 扩展现有 component-cli 包，新增本地 inspection 和 IntegrationPlan 契约，复用二期 GET/MatchPlan。C 先冻结接口，B 负责主要 CLI 产品开发，A 提供独立样例预期，D 做黑盒验收，最后由 C 在同一候选上真实联调和收口。

**Tech Stack:** Windows x64、Node 26.13.0、pnpm 12.18.0、TypeScript 7.0.2、现有 Vitest/Nest/PostgreSQL/MinIO/Verdaccio；目标 npm lock v3 / pnpm lock v9、Vue 3 / React 19。新增解析依赖实施时查官方资料并精确锁定。

**Spec:** [三期 T15 设计](../specs/2026-11-16-phase3-t15-design.md)。上位依据：[T15–T17](2026-11-11-component-platform-implementation.md)、[当前二期收口](../../verification/phase2-query-completion-2026-11-16.md)。规划基线 `b35498ac9bddcfcc63ff4fdd85c7befaf29e6c0f`；实际开发从包含本规划的 main 开始。

## Global Constraints

- 本轮只交付 T15；T16 安装/代码生成和 T17 验证修复/MCP 分轮接续，三期总范围保留。
- 四方使用实际客户端；主要产品开发优先 Claude 桌面端。最多 4 个 in_progress，每项唯一负责人。
- 遵守 AGENTS.md 和 architecture/platform/security/testing-release/code-review 相关规则；C 独占 contracts、公共 fixtures、根配置/锁文件及版本收口。
- 服务端不构建组件、不执行上传代码、不启动浏览器；固定 10 个 workspace 成员，公开 CLI 不依赖私有 contracts 运行时。
- 所有计划命令零目标文件写入、零项目脚本执行；只输出 JSON，冲突 exit 2、执行错误 exit 1、无已知阻塞 exit 0。
- 框架/ECharts 版本来自目标锁及声明约束，已存在宿主版本不自动升级；缺项、歧义、兼容未验证、业务信息缺失均保留冲突。
- 源码/安装/截图/上传相关冻结链保持不变；本轮真实 SDK 验收复用同一冻结产物，不为方便测试重新 pack。
- 原架构文件 SHA-256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
- 用户已授权本轮任务完成后的本地合并和删除开发分支；没有 git push、生产发布或修改任意真实业务项目的授权。

## Review Focus

1. Windows junction/大小写/相对路径穿越：输出和读取不得绕过目标根，符号链接逃逸必须拒绝。P0 规则、P1 路径实现、P3 黑盒反例。
2. packageManager 与锁、workspace importer 不一致：不按扫描顺序猜目标，不偷偷改变框架。P1/P2/P3。
3. GET matched 但 unverified，或 MatchPlan 缺 props/event/layout：计划必须 conflicted，不能当作可接入成功。P0/P1/P4。
4. 规划期间目标文件或远端权限/材料变动：返回冲突或错误；旧离线计划不能成为未来 apply 授权。P1/P3/P4。
5. API/registry 令牌串用、跨 origin 下载跳转、恶意项目脚本：不得泄露凭据或执行脚本，失败输出保持脱敏。P1/P3/P4。

## 分支、文件所有权与依赖

下列分支均为实施时创建，目前未创建。每个客户端使用独立 worktree；C 创建后提供绝对路径和基线提交，客户端不得在同一 checkout 来回切分支。

| 角色 | 分支 | 唯一文件范围 | 开工 / 验收依赖 |
| --- | --- | --- | --- |
| C / Codex | `feat/t15-c-contracts` | contracts、公共最小 fixtures、CLI 契约同步、必要根依赖 | 规划已交付 / P0 所列检查 |
| B / Claude 桌面端 | `feat/t15-b-integration-plan` | CLI integration 产品源码、integrate 命令、CLI 接线、P1 白盒测试 | P0 完整提交 / A 矩阵、D 黑盒、C 真实服务 |
| A / Antigravity | `chore/t15-a-project-matrix` | `tests/fixtures/phase3-projects/**`、独立预期及 P2 测试/说明 | P0；只读 SDK 审计可先开始 / 真工具生成的锁、独立预期完整 |
| D / Claude Code | `chore/t15-d-plan-acceptance` | P3 独立进程测试、`docs/phase3/integration-plan.md` | P0 即可写 RED / C 集成 B/A 后运行 GREEN |
| C / Codex | `chore/t15-c-integration` | P4 专项 config/服务验收、README/计划/验收记录/版本 | P0 后准备 / P1–P3 冻结提交 |

P0 验证后合入 main，A/B/D 和 C 集成分支从同一完整 P0 hash 起步。合并次序 A → B → D → C 最终验收；D 不自行把 B 未冻结改动拖入开发分支。公共接口变动先由 C 更新 P0 后统一同步，不能局部复制 DTO。

## P0：C 冻结本地项目与计划契约

**Files:**
- Create: `packages/contracts/src/integration-plan.ts`、`tests/contracts/integration-plan.test.ts`、`tests/fixtures/integration-plan.ts`。
- Modify: `packages/contracts/src/index.ts`、`packages/contracts/src/schemas.ts`、`packages/component-cli/scripts/sync-contracts.mjs`；生成 `packages/contracts/schemas/local-project-inspection-v1.schema.json`、`integration-plan-v1.schema.json` 及 CLI 内联副本。
- C 按必要性修改 package.json/lockfile 中的解析依赖；不修改现有二期 DTO 必填字段。
- Record: `docs/verification/c-t15-contracts-2026-11-16.md`（实际日期变化时新增当天文件）。

**Interfaces:** 导出 `LocalProjectInspectionV1`、`IntegrationPlanV1`、`IntegrationConflict`，以及 `validateLocalProjectInspection(input:unknown)`、`validateIntegrationPlan(input:unknown)`，返回现有 `ValidationResult<T>`。冻结 spec 列出的字段、冲突枚举、planned/conflicted 动态规则、相对路径与文件存在性/hash 规则。公共 fixture 导出 `validInspectionFixture()`、`validIntegrationPlanFixture()`，每次返回独立对象，不读取业务工作区。

- [ ] **RED**：写 `rejects authorization or missing file guards`、`keeps compatibility and binding gaps blocking`、`rejects duplicate dependency/path and absolute command cwd`；断言执行授权恒 false、conflicts 与 status 一致、未来新增文件无伪造旧 hash、命令只能为结构化预览。
- [ ] 运行 `.\scripts\pnpm.ps1 exec vitest run tests/contracts/integration-plan.test.ts`，确认失败原因是缺少新契约/规则，而非设施错误。
- [ ] 实现新协议和运行时交叉约束；路径允许真实项目常见空格与中文，不能直接套用禁止空格的上传 artifactPath。补 JSON Schema 与 CLI 同步清单；版本语义/锁解析库由 C 验证后锁精确版本。
- [ ] 运行 `.\scripts\pnpm.ps1 --filter @company/contracts schemas:generate`、`.\scripts\pnpm.ps1 --filter @company/component-cli build`，再运行 `exec vitest run tests/contracts/integration-plan.test.ts tests/contracts/project-context.test.ts tests/contracts/match-plan.test.ts tests/contracts/api-schema.test.ts`、`verify:workspace`；核对生成副本一致。
- [ ] 写明 schema 与运行时附加保证、依赖版本/兼容证据、合法与非法 fixture；提交 `feat: 定义本地项目识别与接入计划契约`。共享包改动由 C 运行 `exec turbo run build typecheck --force`、根 tsc、设置已核对 `A10_FROZEN_BUNDLE` 后运行根 `test`，通过后合 main，发布完整 P0 hash 作为四方开工门槛。

## P1：B 实现主要 CLI 产品能力

**Files:**
- Create: `packages/component-cli/src/integration/{workspace,inspect,locks,resolve,registry,plan}.ts`、`packages/component-cli/src/commands/integrate.ts`。
- Modify: `packages/component-cli/src/cli.ts`、`packages/component-cli/src/index.ts`。
- Test: `tests/integration/project-inspect.test.ts`、`tests/integration/project-plan.test.ts`、`tests/integration/project-plan-network.test.ts`。
- Record: `docs/verification/b-t15-integration-plan-2026-11-16.md`。

**Interfaces:** 本地模块导出 `inspectProject(root:string, options?:{workspace?:string}):Promise<LocalProjectInspectionV1>`；`planIntegration(root:string, matchPlan:MatchPlanV1, options:PlanOptions):Promise<IntegrationPlanV1>`。`PlanOptions` 含 workspace?、outputDir?、apiUrl、registryUrl、apiToken?、registryToken?、requestTimeoutMs?；令牌仅用于内存请求，不写结果。默认超时 30 秒，50 MiB 下载限额；测试可用同语义 loopback HTTP。C 已有 DTO/validators 通过 CLI 内联副本导入，B 不改 contracts。

- [ ] **RED / 项目识别**：覆盖 Vue/npm、React/pnpm、显式 workspace；断言多锁、缺锁、错 importer、两个框架未明确、范围无精确解析、React DOM 缺失、目标 realpath 逃逸分别 conflicted。确认 JSON/动态配置均不被执行。
- [ ] 运行 `exec vitest run tests/integration/project-inspect.test.ts` 确认预期 RED；实现 workspace/locks/inspect，读取 package.json、锁、Git 状态和原生脚本名，提供原始字节快照。Git 仅固定 argv/cwd，禁用 optional locks、fsmonitor、外部 diff/textconv，清理影响目标解析的 Git 环境覆盖；GREEN 后聚焦提交 `feat: 实现本地项目与锁文件只读识别`。
- [ ] **RED / 计划与远端**：覆盖完整 MatchPlan、同包多实例、GET 请求身份不符、目标被废弃/撤权、包摘要损坏、同名不同精确依赖、unverified、缺数据/事件/布局、下载超限/超时/重定向；另将 required prop/全部 events 从离线 plan 删除而保持其结构合法，断言新 GET 权威 API 交叉核对仍能发现遗漏；额外成员/过期类型同样拒绝。全部错误不产生文件变化。
- [ ] 运行 `exec vitest run tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts` 确认 RED；实现 resolve/registry/plan：比对本地宿主与 MatchPlan，GET 复验，检查精确版本 tarball 摘要，保留缺口，计算路径/改动/命令预览；网络检查结束后再次 GET 复读全部唯一目标的资格/身份/摘要/API，最后复读本地关键文件 hash。测试暂停 tarball 响应期间撤权，必须产生冲突/错误；报告仅代表最后复读时点。
- [ ] 接线两个 CLI 子命令，默认 stdout JSON；拒绝未知/重复参数、缺参数、输入 JSON 无效。`--output-dir` 不创建目录；新增目标已存在则冲突。使用 env 提供两个独立令牌，不从项目配置读取凭据。扩展 help 和包 exports。
- [ ] 运行三组 P1 测试、`--filter @company/component-cli build` / `typecheck`，记录 RED/GREEN 和未覆盖范围；提交 `feat: 生成可审查的只读项目接入计划`。交接完整 hash、停止写入；版本由 C 统一收口。

## P2：A 提供独立项目矩阵与 SDK 预期

**Files:** Create `tests/fixtures/phase3-projects/{cases,expected}.ts`、该目录下静态项目模板/真实工具生成的锁快照、`tests/evaluation/phase3-project-matrix.test.ts`、`docs/phase3/project-support-matrix.md`、`docs/verification/a-t15-project-matrix-2026-11-16.md`。P0 最小 fixtures、既有 SDK 发布包与 B 产品文件不归 A 修改。

**Interfaces:** `createProjectCase(caseId:string,tempRoot:string):Promise<{projectRoot:string;workspace?:string;expected:ExpectedInspection}>` 负责仅在调用者提供的临时根创建合成工程；`projectCases` 列出 caseId、framework、包管理器、锁类型、预期冲突。ExpectedInspection 是 A 测试本地类型，不能修改公共契约。预期来源为包声明、锁与真实 SDK API，不能复制 B 输出。

- [ ] 至少准备 12 个案例：npm Vue、npm React、pnpm Vue、pnpm React 四个正常；npm workspace、pnpm workspace；多锁、缺锁、缺 React DOM、错误 importer、框架歧义、缺 ECharts 八类专项。额外覆盖空格/中文路径及 unrelated dirty 文件。
- [ ] 用实际 npm/pnpm 工具在隔离目录生成正常锁，记录版本与命令；异常由其明确变体构造。保持 workspace 固定 10 成员，模板不纳入 workspace，原始源码模板用 `.tmpl` 避免根 tsc 隐式编译。
- [ ] **RED→GREEN**：矩阵校验测试先拒绝缺一框架/包管理器、重复 caseId、预期版本与锁不符，再实现验证；运行 `exec vitest run tests/evaluation/phase3-project-matrix.test.ts`，不导入 B inspection 作为预期计算器。
- [ ] 审计 14 实现的导出、事件和精确框架包/core 依赖，复用已有 `tests/fixtures/component-query-sdk.ts` 独立矩阵；提供 T16 生成器需要保留的双框架差异，发现 SDK 缺陷先交 C 重新划分文件。
- [ ] 提交 `test: 建立三期项目识别与双框架预期矩阵`，交案例清单、工具实测版本和 hash；所有工程标为 synthetic，不能记成两个真实业务试点。

## P3：D 独立 CLI 黑盒与只读验收

**Files:** Create `tests/integration/project-plan-consumer.test.ts`、`tests/integration/project-plan-readonly.test.ts`、`tests/fixtures/phase3-cli-harness.ts`、`docs/phase3/integration-plan.md`、`docs/verification/d-t15-plan-consumer-2026-11-16.md`。只读使用 P0/A fixture，禁止改 B 实现来迁就测试。

**Interfaces:** 通过子进程执行构建后的 `packages/component-cli/dist/bin.js`，只用参数、环境变量、exit/stdout/stderr 观察结果；本地 HTTP stub 标为协议测试，真实服务另由 C 验收。临时项目清单/锁/源码/未跟踪文件做递归 bytes/SHA 快照，覆盖执行前后相同文件集合与内容。

- [ ] **RED**：P0 基线上调用 inspect/plan 因命令缺失失败；运行 `exec vitest run tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts` 并记录预期失败。
- [ ] 补 stdout JSON/退出码/帮助、未知重复参数、malformed MatchPlan、删去 required prop/事件列表、网络故障、matched+unverified、多锁/多框架、跨项目路径、敏感输出等黑盒用例。以项目恶意脚本和 Git fsmonitor helper 写 marker 验证从未执行；确认仅受控只读 Git 子进程被调用，测试整个目标树无新增/删除/修改，不仅检查 git diff。
- [ ] 增加 deferred HTTP 响应屏障：网络请求等待期间修改关键文件，再放行响应，断言 `PROJECT_CHANGED` 且保留修改；tarball 响应暂停期间将 API 切换为撤权/废弃状态，放行后必须再次 GET 并拒绝 planned。junction 逃逸测试在 Windows 实际创建，不可用时报告未覆盖，不能静默当作通过。
- [ ] 写用户说明：识别 vs 规划，输入/退出码、凭据注入、冲突解释、输出重定向到项目之外，以及 plan 不构成 apply 授权。示例经过运行时校验，不写真实 token/部署地址。
- [ ] C 集成 P1/P2 后运行 GREEN；B 修复产品缺陷，D 保持独立断言。提交 `test: 验收接入计划命令与目标项目只读边界`，交完整报告及未覆盖项。

## P4：C 真实联调、已安装 CLI 与收口

**Files:** Create `tests/acceptance/phase3-plan.config.ts`、`tests/acceptance/phase3-plan.spec.ts`、`docs/verification/c-t15-plan-integration-2026-11-16.md`；更新 README、实施评估、总体计划、分工计划与 CHANGELOG/实际受影响 package.json。必要真实服务 helper 位于 `tests/platform/`，由 C 独占分配。

**Interfaces:** 新 config 只 include `phase3-plan.spec.ts`，复用既有 global-setup/setup-services，不混进默认根 test。显式要求 `A10_FROZEN_BUNDLE` 和 `PHASE3_CLI_TARBALL`；缺任一输入即失败，不能跳过。SDK 从已接受 bundle 复用；CLI 产品变化必须新版本冻结并真实安装。

- [ ] P0 后、合入 B 之前先写专项测试，以旧 CLI 0.0.11 实际已安装产物记录命令尚未实现的行为 RED；缺环境变量、服务未启动或 tarball 缺失不能算行为 RED。测试定义为：工作区外安装 CLI tarball，只读访问隔离真实 Nest/PG/MinIO/Verdaccio；登记同一 SDK bundle 后获取真实 MatchPlan，对 Vue/React 分别执行 plan，核对包版本、SHA、API、精确依赖与兼容缺口。没有已接受兼容记录应是 conflicted；正常 planned 场景须通过真实兼容记录接收流程采纳同一冻结包的实测证据，不能插入虚假 passed。实际新候选 GREEN 按下方顺序执行。
- [ ] 核对 A/B/D 每个冻结提交、工作区状态和文件所有权，按 A → B → D 合入 C 集成分支；无关改动保持原样，冲突按负责人处理。
- [ ] 真实权限撤销、废弃、材料损坏、registry 包摘要不符和基础设施失败均有独立结果；目标项目全树字节保持不变，输出无凭据。合成绑定/布局仅做技术验收，不改成业务验收。
- [ ] 先做候选代码审查并关闭阻断，再按当前版本递增 CLI PATCH、更新 CHANGELOG，独立提交 `chore: 升级版本号至 x.y.z`；不预写死下一个版本号。其他包只在实际对外变更且触发条件时升级，纯测试/文档不升级 SDK。
- [ ] 构建并 pack 新 CLI 一次，记录 SHA 后冻结，在工作区外安装同一 tarball；运行 `exec vitest run --config tests/acceptance/phase3-plan.config.ts`，关键测试 0 跳过。其后若产品代码变动，则废弃候选并重新走新候选验证，不冒用旧冻结结果。
- [ ] 最终运行 `install --frozen-lockfile`、`exec turbo run build typecheck --force`、`-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`、`verify:workspace`；设置真实 `A10_FROZEN_BUNDLE` 后运行根 `test`，运行 `exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching.test.ts tests/platform/component-query.test.ts tests/platform/component-query-consumer.test.ts`。记录实际 exit、失败/跳过及日志路径，不把缓存命中当作本轮证据。
- [ ] 本轮无 UI 改动不新增浏览器场景；contracts 公共变更在全图 build 后运行 `exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts tests/browser/phase2-component-query.spec.ts`，顺序占用端口。若扩大了受影响面，再按实际变更补回归。
- [ ] 核对五项 Review Focus、原架构 SHA、冻结 SDK SHA、npm 包无私有运行时依赖及工作区外可用；新增验收记录，不改写历史。仅所有 T15 门槛通过才标记 T15 完成，T16/T17、G2 和真实业务试点保持各自状态。
- [ ] 验证后的集成分支合入 main，在 main 复核树/构建与 installed CLI 专项；逐一确认来源 branch tip 是 main 祖先、客户端停写、工作树干净、需要的日志/忽略文件有独立备份后，安全删除本轮已合并分支。
- [ ] managed worktree 优先原生可恢复归档；删除/归档前检查 Windows junction 与共享 `.tools`/node_modules 目标。不得递归清理指向主目录的链接，避免重演二期缓存清空。主 checkout 被工具保护时保留并报告；不强制 remove、不用 `branch -D`、不 push。
- [ ] 报告 commit/merge hash、实际验证、残留 worktree/分支及原因，并发布 T16 开工交接。

## 接续两轮

| 轮次 | Claude 桌面端主开发 | Antigravity | Claude Code | Codex | 开工门槛 |
| --- | --- | --- | --- | --- | --- |
| T16 | install/apply/patch/backup/rollback，Vue SFC 与 React TSX 生成 | 14 实现生成用例、数据/事件与生命周期核验 | 安装失败恢复、文件变动竞争、已有修改保护、独立构建 | ApplyResult/回退契约、依赖收口、真实项目集成 | T15 已验收；具体宿主/路由/写入路径与授权明确 |
| T17 | 本地验证、报告、最多 2 次有限修复、4 个 MCP 工具 | 双框架交互/视觉期望及 SDK 专项 | 至少 10 Vue + 10 React 场景、失败分类、真实项目验收 | 协议/SDK 精确版本、CLI/MCP 一致性、总体门禁 | T16 有可审查变更和安全恢复证据 |

后续详细文件分配分别在对应轮次开工前冻结，开发量大的独立修复继续优先交 Claude 桌面端。没有首轮实测耗时前，不将 8–12 人日或四客户端数量换算为确定完成日期。

## 派发内容与当前状态

每次实际派发必须包含：本 spec 与计划绝对路径、角色/P 编号、独立 worktree 绝对路径、完整基线 hash、唯一文件范围、所需 fixture/契约、验证命令、记录路径、停写条件。客户端无法接收任务或不能执行固定 Windows 工具链时如实登记；宿主补跑命令注明由 C 执行。

当前 P0–P4 均为 planned；本轮交付是设计与执行计划。没有启动四个客户端开发，也没有安装依赖、修改产品源码或标记 T15 完成。
