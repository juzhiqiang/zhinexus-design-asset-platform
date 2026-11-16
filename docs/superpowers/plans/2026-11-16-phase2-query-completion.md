# 二期 GET 查询与协议交付收口执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 executing-plans 逐项执行。按用户指定的 Antigravity、Claude 桌面端、Claude Code、Codex 四个实际客户端分工；Codex 审查代理只承担明确标注的独立审查。步骤以复选框追踪，新增行为执行 RED→GREEN。

**Goal:** 完成二期组件标识规范、GET 精确查询、双框架真实 SDK 及调用侧验收，并合并和删除本轮开发分支。

**Architecture:** contracts 冻结 GET DTO；Nest 直接查询权威目录并复用资格/静态材料校验；Gallery 和外部使用侧通过 HTTP 查询，按返回的精确发布 ID 消费或构造既有装配输入。

**Tech Stack:** 当前 pnpm workspace/Turborepo、NestJS、React/Next、PostgreSQL、MinIO、Verdaccio、Vitest/本地 Playwright；固定 Windows Node 26.13.0 / pnpm 12.18.0。

**Spec:** [二期收口设计](../specs/2026-11-16-phase2-query-completion-design.md)。该文记录 2026-11-16 用户对验收边界的新决定，优先于历史记录中的设计导出/真实标注阻塞。

## Global Constraints

- 原架构字节只读，SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
- contracts、公共 fixtures、根配置、pnpm-lock、所有升版和 CHANGELOG 由 C 统一维护。B 本轮取得指定 API 匹配文件所有权，避免 C/B 交叉编辑。
- `GET /v1/matching/components` 使用精确版本和 Bearer read，no-store/noindex；ID 不 trim、不转大小写、不以文本搜索替代。
- 服务端不执行组件；截图、构建和浏览器只在开发机。真实 SDK 使用同一冻结 tarball 与已审计材料，不改旧包。
- 设计平台格式和真实设计标注不作为二期协议交付门槛；G2 生产接入和真实试点维持独立状态。
- 最多 4 个 in_progress；各自独立分支/worktree，中文聚焦提交。本轮已获本地合并及删除完成分支授权；push、tag、生产发布仍需单独授权。

## Review Focus

1. B/D：重复 query 键、数组化输入、未知参数、畸形 URL 编码和不完整版本必须拒绝；合法单次编码必须支持，解码后重复键不得被框架解析器静默覆盖。
2. B/D：同组件框架版本跨包歧义必须报 CONFLICT；不可读目标不能通过歧义或错误详情泄露。
3. B/D：材料读取期间撤权、禁用、废弃或新增歧义，返回前复查，不残留 API/依赖。
4. A/C：SDK 独立包版本和 React/Vue 事件名按真实冻结材料比较；缺兼容记录保持 unverified，Ready 不证明兼容。
5. B/D/C：GET 纯查询不能改变发布状态；旧 POST、输入失效和隔离边界回归；真实 HTTP 测试不得因缺环境静默 skip。

## 当前基线与任务状态

基线 `main@9253f2e9` 已有 POST 装配、文本发现、ComponentApiV1、精确资格复读和 ID runner。本轮不重复开发这些能力。当前只有 main 分支/主工作树；下列开发分支待执行时创建。计划编制不等于已派发或已实现。

| 任务 | 客户端 / 分支 | 开工依赖 | 验收依赖 | 初始状态 |
| --- | --- | --- | --- | --- |
| P0 协议冻结 | C / `feat/phase2-c-query-contracts` | 本规格 | 契约/Schema/CLI 内联验证 | 待开始 |
| P1 GET 与调用入口（最重） | B / `feat/phase2-b-query-api` | P0 冻结提交 | 真实服务、A 矩阵、浏览器 | 待 P0 |
| P2 SDK 预期矩阵 | A / `chore/phase2-a-sdk-matrix` | 当前 SDK；P0 字段可后续对齐 | 冻结材料摘要核对 | 可先审计 |
| P3 独立验收及使用说明 | D / `chore/phase2-d-query-acceptance` | P0，可先写失败测试/文档 | P1 真实 HTTP | 待 P0 |
| P4 14 实现与服务集成 | C / `chore/phase2-c-query-integration` | P0、P2 可准备 | P1/P2/P3 最终提交 | 待 P0 |
| P5 合并、升版与二期收口 | C / 上述集成分支 | 各方停写交接 | 最终全图检查与审查 | 待 P4 |

顺序：P0 与 A 审计并行 → 冻结 P0 并合入 main → B/A/D/C 各取同一协议基线并行 → A→B→D 汇入 C 集成分支 → 最终验证/升版 → main → 删除本轮已合并分支。浏览器由 C 统一排队，检查 3000、5173–5176 端口所有者后使用；不终止无关用户服务。

## P0：C 冻结规范与公共契约

**Files:** 新增 `packages/contracts/src/component-match.ts`、`tests/contracts/component-match.test.ts`、`tests/fixtures/component-match.ts`；修改 `packages/contracts/src/{index,schemas}.ts`、生成 `packages/contracts/schemas/component-match-{query,response}-v1.schema.json`；同步 `packages/component-cli/scripts/sync-contracts.mjs` 与生成内联文件、`tests/browser/contracts-runtime.spec.ts` 白名单。

**Interfaces:** 导出 `ComponentMatchQueryV1`、`ComponentMatchResponseV1`、`validateComponentMatchQuery(input: unknown): ValidationResult<ComponentMatchQueryV1>`、`validateComponentMatchResponse(input: unknown): ValidationResult<ComponentMatchResponseV1>`；字段和语义严格照 spec。JSON Schema 只承担现有引擎可表达的结构约束；条件字段与动态身份一致性由两个 runtime validator 强制，D 的文档明确列出附加规则，不宣称 Schema 单独等价于运行时验收。公共 fixture 为纯函数，不含 DB、网络、密钥；合成来源明确。

- [x] RED：`reactRequiresDomVersion` 拒绝 React 缺 DOM；`vueRejectsDomVersion` 拒绝 Vue 多余字段；`rejectsFloatingVersionAndUnknownKey` 拒绝 latest/^/未知字段；`gapCannotExposeMaterials` 拒绝 gap 带 target/api/依赖；`responseMustBindRequestedIdentity` 拒绝 query/target/api 任一身份不一致；`unverifiedRequiresGap` 拒绝缺兼容缺口。
- [x] 运行 `.\scripts\pnpm.ps1 exec vitest run tests/contracts/component-match.test.ts`，确认因缺导出/行为得到预期 RED。
- [x] 实现 DTO/schema/跨字段验证及上述两个 schema 注册，复用现有 MatchTarget/ComponentApiV1 定义。
- [x] 校验生成 Schema 与源定义完全一致，静态反例覆盖类型/必填/枚举/版本/未知键；条件字段、gap 物料和动态身份反例单独验证 runtime validator，文档清楚区分两层保证。
- [x] 运行 `--filter @company/contracts schemas:generate`、上述契约测试、CLI build、`verify:workspace`；公共包冻结前运行 `exec turbo run build typecheck --force` 和根 tsc，记录全图结果。
- [x] 聚焦提交 `feat: 定义二期组件精确查询契约`；独立审查后将完整提交 hash 交给 B/A/D。P0 合入 main 后，各方从该提交开工作树，不挑拣一部分契约文件。

## P1：B / Claude 桌面端完成主要开发

**Files:** 新增 `apps/api/src/matching/component-query.ts`、`component-query-routes.ts`；按需提取 `matching/materials.ts` 并修改 `matching/service.ts`；修改 `apps/api/src/app.ts` 注册 controller。新增 `tests/integration/component-query.test.ts`、`tests/platform/component-query.test.ts`。Gallery 新增 `apps/gallery/app/lib/component-match-client.ts`、`apps/gallery/app/(console)/match/ComponentQuery.tsx`，只在同目录 `page.tsx` 挂载；新增 `tests/gallery/component-match-client.test.ts`、`tests/browser/phase2-component-query.spec.ts`。不改 contracts、根配置和版本文件。

**Interfaces:** 消费 P0 DTO/校验器。实现 `ComponentQueryService.query(input: unknown, subject: string): Promise<ComponentMatchResponseV1>`；`ComponentQueryController` 暴露 GET。前端实现 `requestComponentMatch(query: ComponentMatchQueryV1, options: {token:string; signal?:AbortSignal; apiUrl?:string}): Promise<ComponentMatchResponseV1>`，响应经运行时校验并与本次 query 对齐。错误使用现有前端固定文案机制，不回显服务端原文。

- [x] RED：HTTP 缺路由 404；合法 Vue/React 精确匹配；缺字段/重复原始或解码后 query/非法版本 400；合法 URLSearchParams 编码的 scoped packageName 可查询，畸形编码 400，二次编码不被再次解释；无 token 401、无角色 403；未知/私有/非 Ready/废弃/peer 不符同形 gap；跨包同版本歧义 409，指定 packageName 后唯一命中。
- [x] 先运行 `build:services`，再运行新 integration/platform 套件确认失败原因，不能以旧 dist 或设施启动失败充当 RED。
- [x] 实现权威 SQL 查询、同包精确版本、资格/材料复用、返回前二次集合和权限检查；查询不依赖索引。新增共享 helper 必须保持已有 POST 回归。
- [x] RED→GREEN 补充材料损坏、请求中撤权/禁用/废弃、并发歧义、unverified、无发布写入，以及 SQL 特殊值和未知参数失败关闭。
- [x] RED→GREEN 完成 Gallery 的精确查询表单/结果展示与无凭证调用示例；仅显式点击 GET，输入/身份变化中止并清除结果。与原设计配置表单并存，不自动回写设计规则；375px 可用。
- [x] 验证命令：`build:services`；`exec vitest run tests/integration/component-query.test.ts tests/integration/match-plan.test.ts tests/gallery/component-match-client.test.ts`；`exec vitest run --config tests/platform/vitest.config.ts tests/platform/component-query.test.ts tests/platform/matching.test.ts`；完成 build 后由 C 排期运行 `exec playwright test --config tests/playwright.config.ts tests/browser/phase2-component-query.spec.ts tests/browser/phase2-design-match.spec.ts`。
- [x] 分别提交后端与前端两个明确子任务，新增 `docs/verification/b-phase2-query-implementation-2026-11-16.md`，列出 RED/GREEN、实际运行环境和 C 需补跑项。B 停写后交接 hash；C 不把 B 无法执行的 Windows 检查记成已通过。

## P2：A / Antigravity 建立真实 SDK 对照矩阵

**Files:** 新增 `tests/fixtures/component-query-sdk.ts`、`tests/evaluation/component-query-sdk.test.ts`、`docs/phase2/component-query-sdk-matrix.md`、`docs/verification/a-phase2-query-sdk-2026-11-16.md`。只读 `packages/charts-*`、`examples/*`、CLI API 生成器及已冻结 bundle；如需改产品另交 C 明确分配。

**Interfaces:** 导出 `expectedSdkComponents`，每项明确 `{componentId, framework, packageName, exportName, exportPath, styleExport, readyMethod, eventNames}`；7 × 2 共 14 项。packageVersion/sha 由实际冻结 manifest 读取，不写成统一 SDK 版本；预期 API 名称由源码类型审计独立确定，不能由 GET 响应反推。

- [x] 审计 7 类双框架的真实导出和 API；核对 Ranking 导出、React onPointClick/Vue point-click、样式、required props 和公共类型。
- [x] RED→GREEN 编写矩阵校验，证明遗漏框架、重复键、错误事件/导出及混用包版本会被拒绝；预期 14 项完整且无重复。
- [x] 运行 `.\scripts\pnpm.ps1 exec vitest run tests/evaluation/component-query-sdk.test.ts`；实际冻结材料核对单独记录输入 SHA/版本与适用提交。
- [x] 提交 `test: 建立二期组件查询双框架验收矩阵`，交 C/D 使用；没有 SDK 缺陷则不重新打包、不重复升版。

## P3：D / Claude Code 独立黑盒验收和调用说明

**Files:** 新增 `tests/platform/component-query-consumer.test.ts`、`tests/evaluation/component-query-examples.test.ts`、`docs/phase2/component-query-api.md`、`docs/verification/d-phase2-query-consumer-2026-11-16.md`。不改已有 id runner/scoring 的真实样本判定。

**Interfaces:** 只经公开 GET 调用；复用 P0 runtime validator 和公共 fixture。文档示例用 URLSearchParams、Authorization header、精确版本；明确由组件 ID 查询到 variantReleaseId 后构造 DesignIdMappingV1 的步骤。错误示例独立于 B 实现。

- [x] 在 P0 基线上先写黑盒失败测试：真实 HTTP 路由尚未实现时失败；覆盖两框架、完整必填参数、未知/重复 query、CONFLICT/无权同形、no-store/noindex；合成命名保持 synthetic。
- [x] 编写使用侧规范和可校验请求/响应示例；用 `component-query-examples.test.ts` 校验示例 DTO 与失败条件，禁止复制虚假部署 URL、令牌或“已经生产可用”的文字。
- [x] 待 B 提交可审查后，在 D 分支合入该冻结 B 提交或由 C 集成工作区运行 D 测试；执行 `build:services`、`exec vitest run --config tests/platform/vitest.config.ts tests/platform/component-query-consumer.test.ts` 和示例测试。
- [x] 返回逐条验收结果、运行命令/退出码、未覆盖项、发现缺陷。产品缺陷退回 B 修复，D 不绕过断言适配错误行为。提交独立验收和文档。

## P4：C 真实冻结 SDK 与真实 Gallery 联调

**Files:** 新增 `tests/acceptance/component-query-sdk.spec.ts`、`tests/acceptance/component-query-gallery.spec.ts`、`tests/acceptance/phase2-query.config.ts`、`docs/verification/c-phase2-query-integration-2026-11-16.md`；复用既有 harness/registry/上传发布 helpers。此阶段不修改 B 的实现文件。

**Interfaces:** SDK 专项要求 `A10_FROZEN_BUNDLE` 指向已经冻结的 bundle，缺失即明确失败；禁止调用会重新 prepare/pack 的 current-sdk 测试充当同包复验。Gallery 专项要求 `PHASE2_GALLERY_ORIGIN`，显式调用该专项缺环境必须失败。消费 A 的 expectedSdkComponents 与 P0 响应 validator。新 config 只 include 上述两个 `.spec.ts`，复用 `tests/platform/global-setup.ts` / `setup-services.ts` 的隔离服务；它不进入根 Vitest 或默认 platform include，避免给既有测试命令隐式增加必填环境变量。

- [x] 各方交接停止写入，核对 `git status`、完整 diff、merge-base、文件所有权和提交。只集成本轮范围，保留无关用户修改。
- [x] A→B→D 顺序 merge 至 C 集成分支，每步检查契约、fixtures 和根文件差异。若发生冲突按所有权协调解决，不互相覆盖。以下 P4 验收在这些代码候选已集成后执行，P5 不再负责准备它们。
- [x] 核对最新已接受冻结 SDK 的 199 文件/manifest/逐包 SHA 与历史证据；当前记录指向 `.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`，执行前须检查实际存在且未改变。
- [x] RED→GREEN 增加真实 bundle 验收测试：隔离上传同包→发布 Ready→逐项 GET 14 实现→比较组件/框架/包版本/摘要/API/导出/事件/依赖。允许无兼容记录返回 unverified，不造 passed。
- [x] 对匹配返回的 variantReleaseId 构造一组 Vue/React POST 装配请求，验证 GET 与既有 POST 对同一身份一致；合成 designId 不改称真实业务样本。
- [x] 新增 Gallery→真实 Nest GET 联调，透明代理只转发，不拦截伪造响应；登录、输入变更、撤权后材料清空，截图检查。C 顺序占用浏览器端口。
- [x] 按两个测试要求设置环境后运行 `build:services` 与 `exec vitest run --config tests/acceptance/phase2-query.config.ts`；记录完整执行数，0 失败且关键测试 0 跳过；真实系统资源由测试自身隔离生命周期管理。鉴权使用现有本地签名 JWT/JWK 设施，报告不写成公司 OIDC 外部接入通过。

## P5：C 集成、升版与删除开发分支

- [x] 最终产品修改达到版本条件后，由 C 递增 API/Gallery 等实际受影响包的 PATCH 并更新 CHANGELOG，独立 `chore: 升级版本号至 x.y.z` 提交；不提前锁死版本、不因纯文档/测试升级 SDK。
- [x] 在最终代码与版本上运行 `exec turbo run build typecheck --force`、`-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`、`verify:workspace`。完整记录实际执行/失败/跳过，缓存命中不替代强制构建证据。
- [x] 设置已核对的 `A10_FROZEN_BUNDLE` 后执行根 `test`，确保相关冻结策略不因缺输入跳过；SDK/CLI 若无产品变化复用历史冻结材料，若有变化必须重新走新版本冻结链。
- [x] 全图 build 后排期运行 contracts runtime、原 phase2-search/design-match、新 component-query 浏览器套件；运行 matching/search、新 GET/consumer/SDK/Gallery 的真实服务专项。不得把未设置 PHASE2_GALLERY_ORIGIN 导致的跳过写成通过。
- [x] 独立审查覆盖 spec 的五项 Review Focus；核对架构 SHA。新增 `docs/verification/phase2-query-completion-2026-11-16.md`，列出证据 hash、版本、提交、命令及生产边界。
- [x] 更新 README、实施评估和当前 T13/T14 状态：只在全部二期协议门槛通过后标记完成。G2/真实试点及旧 real 评分结论保持独立。
- [x] 将验证后的集成分支合入 main。用户已授权本轮完成后的合并和删分支，不重复询问。核对每个分支尖端都是 main 祖先，再退出对应客户端的工作树，检查并归档未跟踪/忽略文件中需要保留的证据。
- [x] 已登记 Codex managed worktree 按原生工具归档；其他 worktree 用安全的 git worktree remove。只删除本轮已合并分支（`git branch -d`），不用 -D/强制清理，不删除无关或有未保存工作的目录。若工具拒绝，报告具体残留及原因。
- [x] 报告所有 commit/merge hash、验证结果和剩余生产事项。本轮不 push。

## 派发口径

每个客户端任务消息必须附本计划、spec、P0 完整 hash、唯一文件范围、验证命令、交付记录路径和停写交接条件。Claude 桌面端优先接 P1；若 P1 发现独立的大型修复，也优先继续安排给它，先由 C 划清新的文件所有权。

本次只是规划交付；实际开发启动以新状态记录为准。二期完成需要 P0–P5 全部验收，不能以规范已写好、客户端已收到消息或单元测试通过代替。

## 本次规划校验（2026-11-16）

- 已核对当前目录 GET、POST 装配、DB 唯一性、资格读取、JSON Schema 引擎、CLI 内联、测试配置和固定工具链，未修改产品源码。
- `git diff --check` 通过；本次修改的 6 份文档相对链接目标均存在。
- `.\scripts\pnpm.ps1 verify:workspace` 实际 exit 0：10 成员、无环、4 公开包和安全服务图通过。
- `Get-FileHash component-platform-architecture.md -Algorithm SHA256` 与本计划保护值相同。
- Codex 独立规划审查提出的合法 URL 编码、Schema/运行时保证区分、JWT 测试设施表述和 P4/P5 依赖顺序均已修正；复核无剩余实质阻断。审查未运行产品测试。
- 本次不重跑产品行为测试，也未向四个开发客户端派发实现任务；不据此宣称 GET 或二期验收完成。

## 执行进展（2026-11-16）

P0–P4 与 P5 技术门槛均通过，产品候选 `19c42897`。实际使用 Claude 桌面端、Antigravity、Claude Code CLI 与 Codex；客户端执行限制、宿主协助和全部测试见 [收口记录](../../verification/phase2-query-completion-2026-11-16.md)。上方初始分工表与规划校验保留其编制时状态。已快进合入 main（`a89b3676`），214 份证据已保存并校验，五个开发分支均用 `git branch -d` 删除。A/C/D 已原生归档；B 因当前主 checkout 保护保留为 detached HEAD。归档缓存异常已恢复并复验，详见收口记录。P0–P5 现已完成。
