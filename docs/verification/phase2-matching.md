# 二期组件匹配与检索验证汇编（phase2）

> 本文件由 `docs/verification/` 下 45 篇逐次验证记录合并而成（2026-11-22，`chore/docs-consolidation` 分支）。原件已按主题合并删除，git 历史可追溯，信息不灭失。每篇原记录以 `### <原文件名>` 为标题完整保留于「逐条合并记录」。总索引见 `docs/README.md`。
>
> 覆盖范围：ProjectContext、组件画像、评分与评测 runner、候选展示、文本搜索、ID 匹配、查询 API。角色缩写：A = SDK（Antigravity / Claude 桌面端）、B = CLI/画廊、C = 平台（Codex）、D = 消费者黑盒、综合 = 多方集成/收口。

## 终态结论

#### 推进顺序与合入 commit

二期（phase2）组件匹配与检索在 2026-11-15 至 2026-11-16 两天内按七个阶段推进，每阶段都以「C 冻结契约 → A/B/D 并行实现 → 独立审查 → C 宿主验收 → 合入 main」的节奏进行：

| 阶段 | 时间 | 契约冻结 commit | 实现/接入 commit | 合入 main |
|---|---|---|---|---|
| kickoff 与只读审计 | 2026-11-15 | —（B 只读审计 `fa24ab52`） | — | — |
| ProjectContext 契约 | 2026-11-15 | `e8248fb3`（C） | B1 表单 `35dcc2e1`（C 原样合入） | `d4bb8791`（C 分支 `feat/c-phase2-search` → main） |
| 组件画像 + 评分/评测 runner | 2026-11-15 | —（文档草案，非公共 DTO） | A 档案/协议 `9cdc4eb8`（A 分支 `feat/a-phase2-profiles` → main）；评分 `2bea0082` | `9cdc4eb8` |
| 候选契约 + 资格过滤 + B2 展示 | 2026-11-15 | `e0a7f5ee`（C，27 项新契约测试） | B 原样接入 `dcb4d52e`（12 文件 blob 一致） | `cba7b022`（B 分支 `feat/b-phase2-matching` 最终集成提交） |
| 文本搜索（请求契约 + PG 索引 + B3 页面） | 2026-11-15 | `95ec3726`（C，请求契约） | B 接入 `f7a81712`（六文件 blob 一致） | `cba7b022` |
| ID 匹配（设计 ID 规则，不接大模型） | 2026-11-15 → 11-16 | `487d1ad9`（范围）、`f8639d4c`（输入契约）、`01e95e16`（装配 + 组件 API 契约）、`e6e9a639`（确定性 API 服务）（均 C） | A `840fd5eb`/`4eee8872` → C 集成 `1e6b8c8e`；B 交付配置/元素/绑定/客户端/浏览器测试 | `feat/phase2-id-mapping` 分支成果（基线 `e5f7e7ef`） |
| 组件查询 API（GET /v1/matching/components） | 2026-11-16 | `531173793fbbc23819874cbb7909dd7e8f789884`（C，P0） | A `b12f34ac`/`16741369`；B `b96db90e`/`160de0ef`；D `66c59f4d`；A→B→D 合并入 C 为 `18c3f8ae`/`56628a35`/`547d4f46`；C P4 `d05d3e93` | main 从 `53117379` 快进到收口证据提交 `a89b3676`；产品提交 `19c4289789613bbfacf0c7b7359530efdda4998e` |

版本收口：`@company/gallery` 从 `0.0.6`（B1 `/match` 表单）→ `0.0.7`（B3 文本检索对外可见功能）；查询 API 收口时平台 `0.0.6`、API/Gallery `0.0.9`；`@company/contracts` 为 private `0.0.0`；CLI 仍为 `0.0.11`；平台服务沿用既有 `0.0.5`（ID 阶段）。

#### 四方交付物

A（SDK，Antigravity IDE / Claude 桌面端）交付：

- 组件档案与评估协议：`docs/phases/phase2/component-profiles.md`、`docs/phases/phase2/evaluation-protocol.md`（含 7 组件 × 14 实现的导出名/配置/硬约束清单与 4 项指标 + 5 类陷阱规范）。
- 离线评分与 runner：`tests/evaluation/scoring.ts`（8 → 12 项测试）、`tests/evaluation/runner.ts`（5 → 6 项测试，18 项合计）、`docs/phases/phase2/evaluation-runner.md`。
- ID 规则评估器与组件 API 材料：`tests/evaluation/id-matching.ts`（+ `id-matching-boundary.test.ts` 4 项，16/16）、`packages/component-cli/src/local/{component-api.ts,manifest.ts}`。
- 查询 SDK 矩阵：`tests/fixtures/component-query-sdk.ts`（`expectedSdkComponents` 14 项）+ `tests/evaluation/component-query-sdk.test.ts`（默认 8 项 / 冻结输入 9 项）、`docs/phases/phase2/component-query-sdk-matrix.md`。
- 大量独立只读审查（`a-review-*` 8 篇），全部结论为无阻断项（B3 初审曾列 2 处待修阻断 + 1 处遗漏，复查关闭）。

B（CLI/画廊，Claude 桌面端）交付：

- B1 `/match` 项目上下文本地校验表单（`project-context-form.ts` + `match/page.tsx` + 导航 + 样式）。
- B2 候选响应解析与纯展示组件（`candidate-results.ts` + `CandidateResults.tsx`，24 项测试）。
- B3 文本检索客户端与 `/match` 检索交互（`search-client.ts` 15 项 + `phase2-search.spec.ts` 18 项），确立「请求代次 + AbortController + token/subject 身份快照」三层守卫与 `invalidateSession()` 统一清理。
- 设计 ID 匹配 UI（`design-id-input.ts` 18 项 + `match-plan-client.ts` 20 项 + `DesignIdMatch.tsx` + `phase2-design-match.spec.ts` 31 项）。
- P1 组件查询 GET 后端与 Gallery 入口（`component-query.ts`、`component-query-routes.ts`、`materials.ts`、`component-match-client.ts`、`ComponentQuery.tsx`；112 窄测 + 36 平台 + 51 浏览器）。

C（平台，Codex）交付：全部公共契约与 Schema（`project-context`、`search`、`search-request`、`design-id`、`match-plan`、`component-api`、`component-match`）、`apps/api` 资格过滤/文本检索/ID 装配/精确查询实现、`008_search.sql` 迁移、CLI 内联同步、Windows 宿主全部测试执行与提交、版本收口、真实联调（透明代理 + 隔离 PG/MinIO/Verdaccio/Nest + 签名 JWT/JWK）、收口与归档。

D（消费者黑盒，Claude Code CLI）交付：`tests/evaluation/id-matching.ts` 之外的 ID runner（`runner-id-cli.ts` + 测试，5 文件 67 项、两份 runner 测试 37/37）、`tests/platform/component-query-consumer.test.ts`（5/5）、`tests/evaluation/component-query-examples.test.ts`（3/3）、`docs/phases/phase2/component-query-api.md`、`docs/phases/phase2/id-evaluation-runner.md`、`docs/phases/phase2/id-observation-handoff-2026-11-16.md`。D 的输出多次出现截断/语法错误，由 C 修正后实测，未将宿主执行记为 CLI 自行执行。

#### 契约链

契约链按阶段依次冻结并向下游传递：

- `e8248fb3`（C）：`ProjectContext` 契约（`project-context-v1` schema、`validateProjectContext`），B 原样合入为 `35dcc2e1`，A 侧对齐修订、B1 表单消费。
- `e0a7f5ee`（C）：二期候选响应及证据评分校验契约（`validateSearchCandidatesResponse`、`candidateSchema`、`DUPLICATE_ID` 等），B 原样接入为 `dcb4d52e`，B2 展示组件与资格过滤消费。
- `95ec3726`（C）：文本检索请求契约（`query`/`context`/`reactDomVersion` 三字段、`validateSearchCandidatesRequest`），B 接入为 `f7a81712`，B3 检索页面消费。
- `487d1ad9`（范围）/`f8639d4c`（输入契约）/`01e95e16`（装配 + 组件 API 契约）/`e6e9a639`（确定性 API 服务）（均 C）：`design-id`、`match-plan`、`component-api` 契约，`POST /v1/matching/plans` 装配协议冻结；A 的 ID 评估器、B 的配置 UI 与 D 的 runner 均以此为基线。
- `531173793fbbc23819874cbb7909dd7e8f789884`（C，P0）：`ComponentMatchQueryV1`/`ComponentMatchResponseV1` 与两个公开运行时校验器，`GET /v1/matching/components` 契约冻结；A（P2 矩阵）、B（P1 实现）、D（P3 消费者）、C（P4 集成）依次承接，最终由 `phase2-query-completion-2026-11-16.md` 收口。

#### 最终验证基线（对应产品提交 `19c42897`）

- 强制全图 `turbo run build typecheck --force`：20/20，0 缓存，exit 0。
- 根 `tsc -p tsconfig.json --noEmit`：exit 0。
- `verify:workspace`：10 成员、安全服务依赖图，exit 0。
- 根 `test`（设置 `A10_FROZEN_BUNDLE`）：T10 168/168 + Vitest 75 文件 / 1249 测试，0 跳过，exit 0。
- 真实服务综合回归（matching + search + component-query + component-query-consumer）：45/45，0 跳过。
- 二期浏览器（contracts-runtime + phase2-search + phase2-design-match + phase2-component-query）：70/70。
- 冻结 SDK + 真实 Gallery 联调（`tests/acceptance/phase2-query.config.ts`）：15/15，0 跳过。
- 独立使用侧：D HTTP 5/5 + 文档示例 3/3。
- 冻结 bundle `881238b3-2214-4ec8-bf0c-af5238b7fcd3`：manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`，199 文件 + 14 报告逐项字节/SHA 验证；core `0.0.11`、Vue/React `0.0.12`。
- 原架构文档 SHA-256 全程保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

#### 仍开放的问题

- **真实标注集为 0 条**：`origin: "real"` 样本 0 条（`d-t13-eval-gaps-2026-11-16.md`、`id-evaluation-report.example.json`）；协议要求 ≥30 条真实样本、其中陷阱/无匹配/缺约束 ≥10 条。`scoring.ts` real 组 6 条门槛（≥30 real、≥10 trap、hardViolations=0、top5≥0.8、gapRecall≥0.9、noMatchRejection≥0.9）在零样本时恒 `passed: false`；合成样本（`design-cases.json` 2 条）不可计入验收基数。**T13/T14 业务验收保持开放**。
- **真实设计 ID 规则未确定**：命名/命名空间、规则维护方、设计平台导出格式与连接器均未提供；`design-id.ts` 只校验结构，不硬编码前缀或分隔符；文本候选选择后由用户显式编辑规则 JSON，无自动回写 UI（Task 3 的「手动选候选必须显式更新配置」交互未测）。
- **外部依赖未就绪**：公司 OIDC/PKCE/撤权未配置（身份团队）；独立预览域 wildcard DNS/TLS 未配置（运维/DNS 团队）；真实业务试点未启动（业务方）；G2 外部服务验收未完成。
- **react-dom 解析阻塞（测试环境问题，非 SDK 缺陷）**：B2 首轮「根目录无法解析 React」是测试环境失败，不计功能 RED；由 C 从 gallery 声明边界经 `createRequire(new URL('../../apps/gallery/package.json', import.meta.url))` 解析，并在根 `vitest.config.ts` 增加 `oxc: { jsx: { runtime: 'automatic' } }`、根 `tsconfig.json` 增加 `jsx: react-jsx`（Next 保留 `jsx: preserve`）解决。这是二期反复出现的根因模式，后续引用「React 解析失败」类失败时须先区分测试环境与产品缺陷。
- **沙箱与宿主工具链错配**：B/D 在 Linux 沙箱均无法运行 Windows 固定工具链（Node `26.13.0` / pnpm `12.18.0`）；`a-phase2-id-evaluation-2026-11-15.md` 因 `.tools`/`node_modules` 未链接而三条命令未实跑；`b-phase2-query-implementation-2026-11-16.md` 第 0 节因此 RED 未在实现前取得宿主证据（后由 C 补做 `.tools/phase2-b-corrected-red.log`，112 项 = 72 过 / 40 败）；`b-phase2-design-id-match-2026-11-15.md` 沙箱零执行仅语法核对。凡引用「RED/GREEN 已通过」须确认执行者是 C 宿主。
- **PowerShell 包装脚本参数绑定**：`exec tsc -p tsconfig.json --noEmit` 直传被 wrapper 拒绝，须改用 `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`；多篇记录明确「不将拒绝命令计为成功」。
- **GET 存储错误归一**（已修）：真实 `ArtifactStore.read` 的 S3 404（`UPLOAD_INCOMPLETE`/409）与超长（`LIMIT_EXCEEDED`/413）原先未被归一，会跳过返回前复查；B 按冻结方案只改 GET 自己的 `artifact` seam 将其规范化为 `NOT_FOUND`，宿主复跑 36/36 通过；`INFRA_UNAVAILABLE` 仍 503。
- **歧义判定口径需 C 确认的判读**：`selectTarget` 把「可读但非 Ready/已废弃/peer 不符」的第二包也计为歧义（409 `CONFLICT`）；若 C 认为非 Ready 应排除在歧义集之外，改一处 `if (!snapshot.canRead) continue;`，但那样「peer 不符的第二包」反例会重新变成 matched。
- **未做项**：`--latest`/`--registry` 候选发现选项不在 P1；探针式大规模性能测量（200/1000 发布下 ID 409ms/1796ms、文本 33ms/25ms 仅为本机单次样本，非并发基准/p95/SLA）；完整可访问性审计；多环境 `NEXT_PUBLIC_PLATFORM_API_URL` 切换；`AbortController` 降级；三期项目安装/代码写入。
- **工作区残留**：`packages/contracts/dist` 有 B 沙箱构建残留（gitignored，`build:services` 会重新生成，沙箱拒绝删除故保留）；B worktree 存在未跟踪 `.tools` 目录（宿主 RED 日志所在）；`feat/phase2-b-query-api` 对应的 B checkout 因原生工具拒绝移除（`The task's primary checkout cannot be removed.`）而保留为 detached HEAD；归档时工具沿 junction 清空了共享的 Node/pnpm/Playwright 缓存，已从原 ZIP/tgz 恢复并复验通过。
- **计划文档与现状偏差**：T14/计划中的 `apps/gallery/src/pages/DesignMatch.vue` 与 `apps/gallery/src/` 是迁移前旧路径，实际为 `apps/gallery/app/`；已记录交由计划维护方校正（`phase2-id-integration-2026-11-16.md`、`b-phase2-design-id-match-2026-11-15.md`）。

#### 各阶段测试计数演进（便于核对引用）

- ProjectContext 契约：18 项新测试；契约总计 9 文件 171 项。
- 评分器：8 项 → 12 项（`a2-scoring-fix`）；runner：5 项 → 6 项；evaluation 合计 17 → 18 项。
- 候选契约：27 项新测试；契约总计 10 文件 198 项。
- 资格过滤：`search-eligibility.test.ts` 32 项。
- 检索请求契约：12 项新测试；契约总计 11 文件 210 项。
- 文本检索平台：`search.test.ts` + `database.test.ts` 6 项。
- design-id 契约：36 项新测试；契约总计 12 文件 246 项。
- ID 匹配契约与服务：`design-id` + `match-plan` 55/55；`match-plan` + `search-eligibility` 56/56；`matching` + `search` 平台 9/9。
- ID 评估器：`id-matching` + `id-matching-boundary` 16/16；ID runner 家族最终 5 文件 67 项，两份 runner 测试 37/37。
- Gallery 侧单测：候选展示 24、上下文 9、检索客户端 15、design-id 输入 18、match-plan 客户端 20；`b-t13-match-ui` 4 文件 89/89；`c-b2` 三文件 60 项；`c-b3` 三文件 51 项。
- 浏览器：`phase2-context` 10、`phase2-search` 18、`phase2-design-match` 31 → 34、`phase2-component-query` 属 51 组；B1+B3 28/28；ID 阶段 53/53；二期最终 70/70。
- P1 窄测 112/112、平台 36/36、浏览器 51/51；P4 验收 15/15；D 消费者 5/5 + 示例 3/3。
- 根 `test` 演进：47 文件 758 项 → 49 文件 817 项 → 50 文件 818 项 → 50 文件 829 项 → 52 文件 845 项 → 56 文件 931 项 → 62 文件 1041 项 → 75 文件 1249 项（T10 node:test 159 → 166 → 168 通过，恒定 7 跳过）。
- 根浏览器用例总数演进：223 个（`phase2-main-merge` 时点，未声称单次 223/223）→ 70/70 二期浏览器组（收口时点）。

#### docs/phases/phase2/ 规范文档去向

`docs/phases/phase2/` 下 8 篇文档（`component-profiles.md`、`component-query-api.md`、`component-query-sdk-matrix.md`、`evaluation-protocol.md`、`evaluation-runner.md`、`id-evaluation-runner.md`、`id-observation-handoff-2026-11-16.md`、`id-evaluation-report.example.json`）不属于本次合并范围：它们是二期契约/工具文档，被保留并移动到 `docs/phases/phase2/` 下，其内容不在本文重复。本文引用的这些文档名均指向新路径 `docs/phases/phase2/`。

## 逐条合并记录

### a-phase2-context-alignment-2026-11-15.md

- 日期／角色／主题：2026-11-15／A／ProjectContext 契约对齐修订与澄清。
- 目的：把 A 的评估协议草案对齐到 C 已交付的 ProjectContext 契约，并澄清上一份审查记录中的一处技术表述。
- 承重事实：
  - 隔离工作区 `C:\Users\10208\.codex\worktrees\a-phase2-profiles\zhinexus-design-asset-platform`；分支 `feat/a-phase2-profiles`，基于 `f172dbacb075c6c4ef91d41cc90b7fc8a5a3686f`，新建聚焦提交，未 amend。
  - 变更文件：`docs/phases/phase2/evaluation-protocol.md`、本记录。
  - 对齐对象：C 已交付 `e8248fb3` ProjectContext 契约。
  - 将 `DesignEvalCaseV1` 草案第 2 节与第 5 节 `SYNTH-MATCH-001` 中的 `projectContext.reactDomVersion` 移出，改置独立 `evalEnvironment` 字段（`{ "reactDomVersion": "19.3.1" }`），避免与 `@company/contracts` `projectContextSchema` 的 `additionalProperties: false` 冲突。
  - 明确 `projectContext` 只使用 `framework`、`frameworkVersion`、`echartsVersion?`、`packageManager`、`requirements` 5 个字段，不扩展 `@company/contracts`。
  - 澄清：`null` 本身是合法 JSON 值，`packages/contracts/src/schema.ts` 的 `assertJson` 会放行 `null`（`assertJson` L42）；`validateProjectContext(null)` 返回 `{ ok: false }` 是因 `projectContextSchema` 声明 `type: 'object'`，在 `validateSchema` 的 `visit` 阶段（`schema.ts` L75-76）检测到 `actual === 'null' !== 'object'` 而拒绝（报错 `Expected object`）；`assertJson` 拒绝的是 `new Date()`、循环引用、accessor、稀疏数组等非普通 JSON 值。
  - 命令与结果：PowerShell `-Encoding UTF8` 解析 `evaluation-protocol.md` 第 5 节 JSON 示例 → 通过，`SYNTH-MATCH-001` 与 `SYNTH-TRAP-002` 均 `extra=`（无多余字段）；`.\scripts\pnpm.ps1 verify:workspace` → exit 0（`Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`）；`git diff --check` → exit 0。
  - 历史记录 `a-phase2-profiles-2026-11-15.md`、`a-phase2-profiles-review-2026-11-15.md`、`a-review-project-context-2026-11-15.md` 均保持原样未修改。
- 结论与状态：完成（仅文档修订）。未改动 `packages/contracts`、`packages/charts-*` 或测试代码；尚未运行全量 Vitest / 浏览器套件。其 top5Recall 与 reactDomVersion 口径被后续评估协议定型采用。
- 交叉引用：`a-phase2-profiles-2026-11-15.md`、`a-phase2-profiles-review-2026-11-15.md`、`a-review-project-context-2026-11-15.md`、`docs/phases/phase2/evaluation-protocol.md`、`packages/contracts/src/schema.ts`、`packages/contracts/src/project-context.ts`。
- 过时或矛盾点：无。

---

### a-phase2-id-evaluation-2026-11-15.md

- 日期／角色／主题：2026-11-15／A／确定性组件 API 材料与 ID 规则评估器交付。
- 目的：交付 CLI 的组件 API 材料生成片段，以及不依赖大模型的确定性 ID 规则匹配评估器。
- 承重事实：
  - 工作区 `C:\Users\10208\.codex\worktrees\a-phase2-evaluation\zhinexus-design-asset-platform`；分支 `feat/phase2-id-evaluation`，基线 `01e95e16`。
  - 批 1（`840fd5eb`）：`packages/component-cli/src/local/component-api.ts`、`packages/component-cli/src/local/manifest.ts`、`tests/unit/component-api.test.ts`。
  - 批 2：`tests/evaluation/id-matching.ts`、`tests/evaluation/id-matching.test.ts`、本记录。
  - 14 个真实实现源码审计对象：`packages/charts-vue/src/*.types.ts`、`packages/charts-react/src/*.types.ts`、`packages/charts-{vue,react}/package.json`；确认 7 组件（`line`/`bar`/`pie`/`scatter`/`trend-card`/`ranking`/`proportion`）× 2 框架的导出名、导出路径 `./<component>`、样式导出 `./style.css`、就绪句柄 `whenRendered` 一致。
  - `manifest.ts` 修正：补 `schemaVersion: 1` 及 `ComponentApiV1` 数组结构的 `props`/`events`；`optionOverrides` 类型由编造的 `EChartsOption` 修正为真实 `SupportedOptionOverrides`（`pie` 在 `notes` 说明仅支持 `tooltip`/`legend`/`title`）；`ranking`/`proportion` 的 `config` 类型修正为 `RankingChartConfig`/`ProportionChartConfig`；区分事件命名：React 为 `onPointClick`（含 `className`/`style`/`ref`），Vue 为 `point-click`。
  - `evaluateIdMatching` 直接复用 `@company/contracts` 的 `validateMatchPlan`；严格隔离 `real`/`synthetic`，总体 `passed` 仅以 `real.passed` 为准。
  - 失败判定条件：空集（`mappedExpectedInstances === 0`）、未通过 `validateMatchPlan`、越权/未映射误装配、错框架、目标版本/release 不符、React/Vue 跨框架事件混用（React 下 `point-click` 或 Vue 下 `onPointClick`）、多实例缺失任一实例。
  - 不预设任何业务 ID 命名规则；不修改已冻结的旧包历史产物。
  - **未运行**：隔离 worktree 根目录未链接/安装 `.tools`（`Test-Path .tools` 为 `False`）与 `node_modules`（`Test-Path node_modules` 为 `False`）；未绕过 `.\scripts\pnpm.ps1` 或擅自触发网络下载，故 `vitest run tests/unit/component-api.test.ts tests/evaluation/id-matching.test.ts`、`tsc -p tsconfig.json --noEmit`、`verify:workspace` 三条命令**尚未实跑**。
- 结论与状态：阻塞（待 C 链接工具链并在宿主复跑确认 RED/GREEN）。被 `c-t13-matching-baseline-2026-11-16.md`、`a-t13-id-eval-2026-11-16.md`、`phase2-id-integration-2026-11-16.md` 以 C 宿主实跑结果覆盖。
- 交叉引用：`c-t13-matching-baseline-2026-11-16.md`、`a-t13-id-eval-2026-11-16.md`、`phase2-id-integration-2026-11-16.md`、`d-id-runner-2026-11-16.md`、`docs/phases/phase2/id-evaluation-runner.md`、`b-phase2-design-id-match-2026-11-15.md`。
- 过时或矛盾点：本篇「未实跑」状态已被后续 C 宿主实跑覆盖（见 `phase2-id-integration-2026-11-16.md` 明确记载「A 原工作区未实际执行测试，不能倒推为 A 自身完成了原始 TDD」）。

---

### a-phase2-profiles-2026-11-15.md

- 日期／角色／主题：2026-11-15／A／组件档案审计与离线评估准备。
- 目的：交付二期组件档案与评估协议文档，并对 SDK 源码做只读自审。
- 承重事实：
  - 隔离工作区 `C:\Users\10208\.codex\worktrees\a-phase2-profiles\zhinexus-design-asset-platform`；分支 `feat/a-phase2-profiles`，基于 `fa24ab525e5945e7096ed816a83f11962ba5f000`。
  - 交付：`docs/phases/phase2/component-profiles.md`、`docs/phases/phase2/evaluation-protocol.md`、本记录。
  - 包版本与 peer 精确依赖（源码核对）：`@company/charts-core` `0.0.10`（peer `echarts: 6.1.0`）；`@company/charts-vue` `0.0.10`（peer `vue: 3.5.45`、`echarts: 6.1.0`）；`@company/charts-react` `0.0.10`（peer `react: 19.3.1`、`react-dom: 19.3.1`、`echarts: 6.1.0`）。明确不把 `c-sdk14-acceptance-2026-11-13.md` 的历史 `0.0.6` 验收结果作为 `0.0.10` 新验证。
  - 7 个逻辑组件 14 个实现导出名：`LineChart`、`BarChart`、`PieChart`、`ScatterChart`、`TrendCard`、`Ranking`、`Proportion`；显式标注 `RankingChart.*` / `ProportionChart.*` 文件名与真实导出名 `Ranking`/`Proportion` 的差异。
  - 缺失信息如实标 `unknown`：工作区 `0.0.10` 缺失独立 `api.json`/`docs.md` 产物、在线 `variantReleaseId`、视觉特征向量。
  - 明确声明尚未具备 30 个真实标注样本；`evaluation-protocol.md` 格式示例全部标 `"origin": "synthetic"`。
  - 命令与结果（`.tools` 固定 Node `26.13.0` / pnpm `12.18.0`）：`install --frozen-lockfile` exit 0（344 packages，锁文件无变更）；`verify:workspace` exit 0；`--filter @company/charts-core build` exit 0；`--filter @company/charts-core typecheck` exit 0；`--filter @company/charts-vue typecheck`（vue-tsc）exit 0；`--filter @company/charts-react typecheck` exit 0；`git status --short` / `git diff --check` 通过。
- 结论与状态：完成（文档规范 + 只读审计）。未新增/修改 SDK 运行时代码、Vitest 单测或 Playwright 测试；未运行全量 `test`/`test:browser`/`test:platform`。被 `a-phase2-profiles-review-2026-11-15.md` 与 `a-phase2-context-alignment-2026-11-15.md` 修订。
- 交叉引用：`a-phase2-profiles-review-2026-11-15.md`、`a-phase2-context-alignment-2026-11-15.md`、`docs/phases/phase2/component-profiles.md`、`docs/phases/phase2/evaluation-protocol.md`、`c-sdk14-acceptance-2026-11-13.md`。
- 过时或矛盾点：包版本 `0.0.10` 为审计时点事实；后续二期查询阶段冻结 bundle 为 core `0.0.11` + Vue/React `0.0.12`（见 `a-phase2-query-sdk-2026-11-16.md`、`component-query-sdk-matrix.md`），两处版本口径不同属时点差异而非矛盾。

---

### a-phase2-profiles-review-2026-11-15.md

- 日期／角色／主题：2026-11-15／A／组件档案与评估协议独立审查修订。
- 目的：按独立审查意见修订档案与协议文档。
- 承重事实：
  - 工作区 `a-phase2-profiles`；分支 `feat/a-phase2-profiles`，基于前次提交 `a527acc6623f6a70d6ccf3d44b6669e21b2442f3`，新建聚焦提交未 amend。
  - 变更：`docs/phases/phase2/component-profiles.md`、`docs/phases/phase2/evaluation-protocol.md`、本记录。历史记录 `a-phase2-profiles-2026-11-15.md` 未修改。
  - 源码证据路径扩展名修正：14 处 brace 写法由 `{index,line,LineChart.vue,line-chart.types}.ts`（会错误展开成 `.vue.ts`/`.tsx.ts`）改为每项含真实扩展名。
  - 脚本展开核对：14 组 brace 路径共展开 56 个源码文件，全部真实存在（`BraceGroups=14 ExpandedFiles=56 Missing=0`）；引用的 21 个 `examples/` 路径亦全部存在（`ExamplePaths=21 ExampleMissing=0`）。
  - Top-5 召回率分母修正：`top5Recall` 适用范围由 `category === 'matchable'` 修为**所有 `origin === 'real'` 且 `acceptableCandidates.length > 0` 的真实样本**。
  - 统计隔离：`real` 与 `synthetic` 分开统计、禁止混算；任一指标分母为 `0` 必须输出 `N/A` 并判定未达标/不可判定，严禁视为通过。
  - 契约草案边界：`DesignEvalCaseV1` 与 `MatchPlanV1` 仅为二期文档草案，不是 `packages/contracts` 已冻结公共 DTO。
  - 命令：PowerShell brace 路径展开存在性校验通过；`verify:workspace` exit 0；`git diff --check` exit 0。
- 结论与状态：完成。其 top5Recall 口径与 real/synthetic 隔离规则被 `a-phase2-scoring-2026-11-15.md`、`evaluation-protocol.md` 落实为代码。尚未采集 30 个真实样本，未执行 T13/T14 检索/匹配代码或全量测试。
- 交叉引用：`a-phase2-profiles-2026-11-15.md`、`a-phase2-context-alignment-2026-11-15.md`、`docs/phases/phase2/component-profiles.md`、`docs/phases/phase2/evaluation-protocol.md`。
- 过时或矛盾点：无（top5Recall 口径后续由 `a-phase2-context-alignment-2026-11-15.md` 补充 reactDomVersion 处理，非冲突）。

---

### a-phase2-query-sdk-2026-11-16.md

- 日期／角色／主题：2026-11-16／A（Antigravity）／二期组件查询双框架 SDK 验收矩阵（P2）。
- 目的：以源码类型与冻结 bundle 为基准建立 14 项独立预期矩阵，供 P3/P4 验收 `GET /v1/matching/components`。
- 承重事实：
  - 工作树 `C:/Users/10208/.codex/worktrees/phase2-a-sdk/zhinexus-design-asset-platform`；分支 `chore/phase2-a-sdk-matrix`，基线 `981ba7a529d5d75587d4d1b4606d22cd754401c5`。
  - 冻结 bundle 输入：`D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`。
  - RED：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/component-query-sdk.test.ts` → 退出码 `1`（`Cannot find module '../fixtures/component-query-sdk.js'`）。
  - GREEN：同命令 → 退出码 `0`，`8 passed`，43ms。
  - 8 项覆盖：7 类 × 2 框架共 14 项独立预期矩阵且字段完整（含 `Ranking`/`Proportion` 导出核对）；独立核对 `packages/charts-vue`/`charts-react` 源码导出、事件类型（`point-click`/`onPointClick`）、样式导出 `./style.css`、`whenRendered` 与 `data` 必填；反例：遗漏框架实现（缺 `ranking:react`）、重复 `(componentId, framework)` 键、错误事件名、错误导出名（`RankingChart`）/导出路径（`./proportion-chart`）、混用 `charts-core` `0.0.11` 与框架包 `0.0.12` 版本或错误 SHA-256。
  - 冻结材料核对：bundle 共 200 个文件 = `manifest.json` 1 + 199 个（185 个 manifest 引用文件全量 SHA-256/字节数 + 14 个 `reports/*.json`），另有 14 个 `api/*.json`。
  - 逐包版本与 SHA-256：`@company/charts-core` `0.0.11` `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb`；`@company/charts-vue` `0.0.12` `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9`；`@company/charts-react` `0.0.12` `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28`。
  - 复核纠正（针对 `b12f34ac`，2026-11-16）：`verifyFrozenBundleFiles` 改为以 `manifest.files` 为权威清单（199 项，含 14 份 `reports/*.json`），核对 `manifest.reports`/`packages`/`variants` 引用一致性与无未引用文件；新增临时副本篡改 `reports/line-vue.json` 字节的 TDD 反例（`os.tmpdir()` 合成副本，`finally` 清理，不触碰真实冻结目录）；移除默认测试硬编码 `D:` 路径，真实冻结 bundle 校验改为仅在显式设置 `A10_FROZEN_BUNDLE` 时执行。
  - 纠正后验证：RED 退出码 `1`（`1 failed | 7 passed | 1 skipped (9)`，`manifestFilesCount` 为 `undefined`）；GREEN 无环境变量退出码 `0`（`8 passed | 1 skipped (9)`）；GREEN 显式 `A10_FROZEN_BUNDLE` 退出码 `0`（`9 passed (9)`，`manifestFilesCount === 199`、`reportFilesCount === 14`、`mismatches === []`、14 变体全通过）。
  - 类型检查命令：`.\scripts\pnpm.ps1 --% exec tsc --noEmit --ignoreConfig --target es2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck --types node tests/fixtures/component-query-sdk.ts tests/evaluation/component-query-sdk.test.ts` → 退出码 `0`。
  - P0 已冻结提交 `531173793fbbc23819874cbb7909dd7e8f789884`，留待 C 集成时完整合入，本分支未修改 `contracts`。
- 结论与状态：完成。未对接 P0 冻结后的 `ComponentMatchQueryV1`/`ComponentMatchResponseV1` DTO；真实 HTTP `GET /v1/matching/components`、隔离 PG/MinIO/Verdaccio 与 Gallery 联调不在 P2 范围，留待 P1(B)/P3(D)/P4(C)。其矩阵被 `phase2-query-completion-2026-11-16.md` 收口引用。
- 交叉引用：`c-phase2-query-contracts-2026-11-16.md`、`b-phase2-query-implementation-2026-11-16.md`、`d-phase2-query-consumer-2026-11-16.md`、`c-phase2-query-integration-2026-11-16.md`、`phase2-query-completion-2026-11-16.md`、`docs/phases/phase2/component-query-sdk-matrix.md`。
- 过时或矛盾点：无。

---

### a-phase2-scoring-2026-11-15.md

- 日期／角色／主题：2026-11-15／A／二期离线评分器实现与验证（A2）。
- 目的：实现文件型离线评分器 `scoreEvaluation`，作为 T14 评估门禁。
- 承重事实：
  - 工作区 `a-phase2-profiles`；分支 `feat/a-phase2-profiles`，基于 `5a81a43b79d8d50eff1553cccc960470a72c5e79`。
  - 参考计划：`docs/plans/2026-11-15-phase2-candidates.md`（A2）及 `docs/phases/phase2/evaluation-protocol.md`。
  - 新增：`tests/evaluation/scoring.ts`、`tests/evaluation/scoring.test.ts`、本记录。
  - 内部测试工具类型（非公共 DTO），仅在 `tests/evaluation/scoring.ts` 内导出，不进入 `@company/contracts`。
  - 指标与隔离规则：严格按 `origin`（`real`/`synthetic`）隔离，顶层 `passed` 仅由 `real` 组决定，`synthetic` 组 `passed` 恒为 `false`；任一比率指标分母为 `0` 返回 `value: null`、`display: 'N/A'` 且 `passed: false`；`Top-5` 仅取 `top5VariantIds.slice(0, 5)`，分母覆盖组内所有 `acceptableVariantIds` 非空案例（不限 `category`）；`gapRecall` 按所需字段集合去重计分，观测重复上报不重复加分；硬违规按案例计数（`hardViolations.length > 0`），硬违规案例不计入有效 Top-5 命中或无匹配拒绝命中；缺 `observation` 计入 `missingObservations` 与失败明细，不静默忽略；重复 `caseId`、未知 `observation`、重复 `observation` 及非法字段抛 `EvaluationInputError`。
  - `real` 组 `passed: true` 门槛（6 条同时满足）：`totalCases >= 30`、`trapCases >= 10`、`missingObservations === 0`、`hardViolationCases === 0`、`top5 >= 0.8`、`gapRecall >= 0.9`。
  - TDD：RED `.\scripts\pnpm.ps1 exec vitest run tests/evaluation/scoring.test.ts` 退出码 `1`（`Cannot find module './scoring.js'`）；GREEN 同命令退出码 `0`（1 file / 8 passed）。
  - `.\scripts\pnpm.ps1 build:services` exit 0（5 tasks）；`-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`verify:workspace` exit 0。
- 结论与状态：完成。被 `a2-scoring-fix-2026-11-15.md` 修订（新增 `noMatchRejection` 门禁 + 稀疏数组防御，测试增至 12 项）。未运行全量 `test`/`test:browser`/`test:platform`；测试夹具为 synthetic，不代表仓库已具备 30 个真实标注样本。
- 交叉引用：`a2-scoring-fix-2026-11-15.md`、`a3-evaluation-runner-2026-11-15.md`、`c-review-a3-evaluation-2026-11-15.md`、`docs/phases/phase2/evaluation-protocol.md`、`docs/phases/phase2/evaluation-runner.md`、`d-t13-eval-gaps-2026-11-16.md`。
- 过时或矛盾点：本篇 `real` 组门槛缺 `noMatchRejection >= 0.9` 一条，由 `a2-scoring-fix-2026-11-15.md` 补齐；引用时应以修订版为准。

---

### a-review-b-context-2026-11-15.md

- 日期／角色／主题：2026-11-15／A（独立只读审查）／B 二期 `/match` 项目上下文表单审查。
- 目的：对 B 的 B1 实现做非作者只读审查。
- 承重事实：
  - 被审查工作区 `C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`，相对基准 `35dcc2e1`；未运行 B 构建/测试，未编辑或提交 B 任何文件。
  - 审查依据：`docs/plans/2026-11-15-phase2-kickoff.md`（B1）、`rules/code-review.md`、`b-phase2-context-implementation-2026-11-15.md`、`b-phase2-context-implementation-revision-2026-11-15.md`。
  - 结论：**无阻断项。**
  - `buildProjectContext`（`app/lib/project-context-form.ts:1-43`）直接复用 `@company/contracts` 的 `validateProjectContext`，仅做白名单构造与 `echartsVersion.trim()` 空白省略，未自定义公共校验规则；表单初始值全部为空，不猜测默认框架或版本号。
  - `app/(console)/match/page.tsx:11-15, 86-96, 150-152, 253-259`：无 `fetch`、无检索/匹配端点调用，不将项目需求写入 `localStorage`/`sessionStorage`（仅沿用既有 `auth.ts` 会话存储）；横幅与成功区明确标注「匹配服务尚未接入：以上仅为项目上下文形状校验结果，尚未生成匹配候选」；`tests/gallery/phase2-context.test.ts:105-128` 覆盖成功结果不含 `compatibility`/`compatibilityStatus`。
  - `(console)/layout.tsx:1-24` 保持 `robots: { index: false, follow: false }` 并新增 `/match` 导航链接；`page.tsx:98-124` 未登录时仅展示登录门与 `#token-input`，不渲染上下文表单；注释明确客户端会话门仅作展示用途，真实安全边界由服务端 Bearer 鉴权强制。
  - 字段诊断：`page.tsx:126-135, 162-244` 各字段通过 `fieldError` 匹配 JSON Pointer 并绑定 `aria-invalid`、`aria-describedby` 与 `role="alert"`；`globals.css:592-775` 补充 `≤640px` 响应式、`word-break: break-word` 与 `max-width: 100%`，配合 `phase2-context.spec.ts:183-198` 1280/360 视口无横向溢出断言。
  - 两项回归修复复核：`onRequirementInput`（L68）调用 `clearOutcome()` 同步清理 `result` 与 `statusMessage`；`handleValidate`（L88-92）在存在非空未添加草稿时阻止校验、保留草稿并提示「请先添加当前需求」；`handleLogout`（L48-60）重置 `tokenInput`、全部项目字段、`requirements`、`requirementInput`、`result` 与 `statusMessage`。
  - B 工作区 `component-platform-architecture.md` SHA-256 实测 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，保持未变。
  - 非阻断备注：`tests/gallery/phase2-context.test.ts:5` 与 `tests/browser/phase2-context.spec.ts:4` 顶部注释仍保留「RED 基线测试（尚未实现）」历史描述。
- 结论与状态：完成，无阻断项。未在 B 工作区运行 `typecheck`/Vitest/`next build`/Playwright；修订后 9 项浏览器用例及 `@company/gallery` 独立升版 `0.0.6` 待 C 宿主复跑收口。A 侧审查提交为 `5a81a43b`（见 `c-b-phase2-context-acceptance-2026-11-15.md`）。
- 交叉引用：`b-phase2-context-implementation-2026-11-15.md`、`b-phase2-context-implementation-revision-2026-11-15.md`、`c-b-phase2-context-acceptance-2026-11-15.md`、`docs/plans/2026-11-15-phase2-kickoff.md`。
- 过时或矛盾点：无。

---

### a-review-b2-candidates-2026-11-15.md

- 日期／角色／主题：2026-11-15／A（独立只读审查）／B2 候选展示与解析审查。
- 目的：对 B 的候选展示组件与解析层做非作者只读审查。
- 承重事实：
  - 被审查工作区 `b-phase2-matching`，基线 `dcb4d52e`（`feat: 原样接入 C 二期候选响应公共契约`）；未修改 B 任何文件，未在 B 工作区运行构建或测试。
  - 结论：**无阻断项。**
  - 未挂载：`CandidateResults` 与 `parseCandidateResults` 仅存在于各自定义文件（`CandidateResults.tsx:103`、`candidate-results.ts:16`），未被 `(console)/match/page.tsx` 或其他页面导入挂载。
  - `candidate-results.ts:1-18` 仅调用 `@company/contracts` 的 `validateSearchCandidatesResponse(input)` 返回 `ValidationResult<SearchCandidatesResponse>`，无 `fetch`、无浏览器存储、无异常抛出风险。
  - `CandidateResults.tsx:1-130` 为纯展示组件，无 `'use client'`、无副作用钩子、无网络请求或存储 API。
  - 框架版本：`L44-46` 渲染 `{candidate.framework === 'vue' ? 'Vue' : 'React'}`，未硬编码 `React 19`/`Vue 3`（回归测试 `tests/gallery/candidate-results.test.ts:207-213`）。
  - 证据路径：`L68-75` 仅用 `<span>` 纯文本输出 `item.kind`、`item.path` 及可选 `item.source`，不构造 `<a>`、`href` 或任何存储/预览链接（测试 `L296-309`）。
  - 评分分栏：`L79-87` 分别渲染「文本评分」、条件渲染「用途评分」（`usage !== undefined`）、条件渲染「视觉评分」（缺省显示「未提供视觉评分」），不补 `0`、不合并为单一相似度；`L186-195` 验证解析层也不推导缺省分数。
  - HTML 转义：`L37-130` 全部字段经 React JSX 文本节点渲染；`L286-294` 验证 `<script>` 与 `<img src=x>` 等输入不会以原始标签输出。
  - 诚实空态与缺口：`L106-109` 在 `response.candidates.length === 0` 时渲染 `#candidate-empty`（「暂无候选」），`L89-98` 与 `L118-127` 分别渲染候选级与响应级 `gaps`。
  - 兼容与来源独立：`L55-64` 仅依据契约 `compatibility.status` 展示「已验证」（附 `recordIds`）或「未验证」；`L73` 仅在证据自带 `item.source` 时展示来源。
  - 根配置变更（C 维护）：`tsconfig.json:4` 新增 `"jsx": "react-jsx"`；`vitest.config.ts:4-5` 新增 `oxc: { jsx: { runtime: 'automatic' } }`，未改动 Next 编译边界。
  - 未覆盖边界引用：C 宿主实跑 60 项相关测试通过（候选展示 24 + 上下文 9 + 候选契约 27）及 B 全仓强制构建 10/10；`CandidateResults` 尚未接入真实 `/match` 检索链路与分页/交互状态。
- 结论与状态：完成，无阻断项。审查提交为 `a102d711`（见 `c-b2-candidates-acceptance-2026-11-15.md`）。
- 交叉引用：`b-phase2-candidate-results-2026-11-15.md`、`c-b2-candidates-acceptance-2026-11-15.md`、`c-phase2-candidate-contract-2026-11-15.md`。
- 过时或矛盾点：无。

---

### a-review-b3-recheck-2026-11-15.md

- 日期／角色／主题：2026-11-15／A（独立只读复查）／B3 文本检索最终代码复查。
- 目的：对 `a-review-b3-search-2026-11-15.md` 指出的三项问题做修复后复查。
- 承重事实：
  - 保留历史审查记录 `a-review-b3-search-2026-11-15.md` 未修改；未运行 B 工作区。
  - 结论：**无阻断项，三项已识别问题均已修复到位。**
  - ① `page.tsx:225-230`：`handleSearch` 发起请求前读取 `getStoredSession()` 并比对 `current.token !== session?.token || current.subject !== session?.subject`，任一不一致或空会话即调用 `invalidateSession()` 并返回，不发出检索请求；`L238, 244` 使用复核后的 `current.token`/`current.subject` 锁定快照。回归测试 `tests/browser/phase2-search.spec.ts:394-416`。
  - ② `page.tsx:252-253`（正常响应路径）与 `L266-268`（异常路径）：确认 `generation === requestGeneration.current` 后，若 `!isSessionStillCurrent()` 均调用 `invalidateSession()`（内部执行 `cancelInFlight()`、`resetFormState()`、`setSession(null)`）再返回，不再残留 `loading` 或旧表单输入。回归测试 `L366-392`、`L418-439`。
  - ③ `phase2-search.spec.ts:323-328`：`const other = await context.newPage()` 后先执行 `await other.goto(MATCH_URL);` 再写入 `window.localStorage`，修复 `about:blank` 下的 `SecurityError`。
  - 沿用实跑结果：C 宿主真实浏览器测试 28 项全部通过（B1 10 项 + B3 18 项），并完成本机真实端到端联调（B 构建页面 → 本地透明代理 → 隔离真实 API/PG/MinIO/Verdaccio，展示已发布 `line` 候选，禁用 `alice` 后返回 401/403 并清理候选）。
  - 既有低优先级观察（`handleLogout` 与 `resetFormState` 状态重置代码重复）按约定暂不扩展重构。
- 结论与状态：完成，无阻断项。B3 最终代码口径以本篇为准。
- 交叉引用：`a-review-b3-search-2026-11-15.md`、`b3-search-page-2026-11-15.md`、`c-b3-search-acceptance-2026-11-15.md`、`c3-live-gallery-2026-11-15.md`。
- 过时或矛盾点：无。

---

### a-review-b3-search-2026-11-15.md

- 日期／角色／主题：2026-11-15／A（独立只读审查）／B3 文本检索页面与客户端初审。
- 目的：对 B3 的检索客户端与页面做非作者只读审查。
- 承重事实：
  - 被审查工作区 `b-phase2-matching`，基线 `f7a81712`（`feat: 同步 C 冻结的文本检索请求契约`）之上的未提交变更：`apps/gallery/app/lib/search-client.ts`、`apps/gallery/app/(console)/match/page.tsx`、`tests/gallery/search-client.test.ts`、`tests/browser/phase2-search.spec.ts`。
  - 结论：**存在已定位的 2 处待修阻断项（C 已定位待修），另发现 1 处发起请求前会话复核遗漏（建议一并修复）。**
  - 待修 1：`page.tsx:249`、`L262` — `handleSearch` 在 `await searchCandidates(...)` 返回或捕获异常后，若 `generation !== requestGeneration.current || !isSessionStillCurrent()` 仅直接 `return`；外部同页改写 `localStorage` 且未触发 `focus`/`storage` 事件时，响应虽被忽略，但页面仍停留在 `searchState = { kind: 'loading' }` 且未回退登录门，导致 `phase2-search.spec.ts:389`（`#search-loading` 数量为 0）失败。修复方向：调用 `invalidateSession()`。
  - 待修 2：`phase2-search.spec.ts:322-325` — `other` 位于 `about:blank` 源时 `evaluate` 写 `window.localStorage` 抛 `SecurityError`；修复：先 `await other.goto(MATCH_URL)`。
  - 额外遗漏【中】：`page.tsx:210-213, 241` — `handleSearch` 仅在入口检查 `if (!session?.token)`，直到 `await` 返回后的 `L249` 才调用 `isSessionStillCurrent()`；若点击前 localStorage 会话已被清空/切换且未触发回调，`L241` 仍会把旧 `session.token` 作为 `Bearer` 发出请求。建议发起前先读 `getStoredSession()` 比对 token/subject。
  - 额外【低】：`handleLogout`（L89-102）与 `resetFormState`（L145-161）存在重复状态重置代码。
  - 其余核对通过项：`page.tsx:450-488` 使用独立 `type="button"`（`#search-submit`）触发 `handleSearch`，表单输入与「校验项目上下文」均不触发检索请求；`search-client.ts:76-86` 本地先调用 `validateSearchCandidatesRequest`，非法输入或空白 `query` 不发网络请求（`search-client.test.ts:55-132`）；`onFramework`/`onFrameworkVersion`/`onEchartsVersion`/`onPackageManager`/`onRequirementInput`/`addRequirement`/`removeRequirement` 均通过 `clearOutcome()` 调用 `cancelInFlight()` 与 `setSearchState({ kind: 'idle' })`（`page.tsx:165-191`）；`onSearchQuery`/`onReactDomVersion` 亦调用 `cancelInFlight()`（`L206-207`）；组件卸载清理 `AbortController` 并递增 `requestGeneration`（`L72-78`）；`search-client.ts:62-68, 91, 102, 116` 在请求前、`await fetch` 后、`await response.json()` 后均检查 `signal?.aborted` 并上抛 `AbortError`（`search-client.test.ts:228-338`）；`search-client.ts:22-27, 49-51, 109-125` 对 401/403、500、非 JSON、契约校验失败均返回固定中文文案，不回显服务端原文、token 或 schema 字段路径（`search-client.test.ts:363-380`）。
- 结论与状态：完成（初审），三项问题由 B 修复后经 `a-review-b3-recheck-2026-11-15.md` 复查关闭。严格只读，未执行测试/构建。
- 交叉引用：`a-review-b3-recheck-2026-11-15.md`、`b3-search-page-2026-11-15.md`、`c-b3-search-acceptance-2026-11-15.md`。
- 过时或矛盾点：本篇列出的 2 处阻断与 1 处遗漏在最终代码中均已修复，引用现状时应以复查篇为准。

---

### a-review-c2-search-2026-11-15.md

- 日期／角色／主题：2026-11-15／A（独立只读审查）／C2 候选契约与资格过滤审查。
- 目的：对 C 的候选契约与 `filterEligibleCandidates` 做非作者只读审查。
- 承重事实：
  - 被审查工作区 `c-phase2-search`；已提交 `e0a7f5ee`（`feat: 定义二期候选响应及证据评分校验契约`，父提交 `d4162065`）；未提交 `apps/api/src/search/eligibility.ts`、`tests/integration/search-eligibility.test.ts`。
  - 结论：**无阻断项。**
  - `eligibility.ts:41` 强制 `current.canRead === true && current.availability === 'Ready' && current.packageState === 'READY' && current.jobState === 'READY'`，拦截 `canRead=false`、`DEPRECATED` 及非 `READY` 状态；`L73-82` 对去重后命中项先执行首轮 `loadCurrent` + `buildEligible` 过滤，返回前再执行第二轮 `loadCurrent` + `buildEligible` 复读。测试：`search-eligibility.test.ts:32-53`（权限/废弃/状态拦截及过滤 ID 不泄露）、`77-95`（复读撤销与 revision 过期）。
  - `L43-46` 校验 `candidate.variantReleaseId === hit.variantReleaseId`、`candidate.framework === context.framework`、`index.state === 'ready'`、`current.revision`/`current.activeProviderVersion` 非空，且 `hit.revision === current.revision`、`index.revision === current.revision`、`hit.providerVersion === current.activeProviderVersion`、`index.providerVersion === current.activeProviderVersion`。
  - `L22-24` 经 `exactVersion` 委托 `validateProjectContext` 拒绝语义化范围（如 `^19.0.0`）；`L26-37`（`peersSatisfied`）校验 `Object.hasOwn(required, context.framework)`，禁止 `hostPeers` 覆盖 `context.framework`/`context.echartsVersion`，要求 `required` 每个 `[name, version]` 通过 `exactVersion(version)` 且在 `known` 精确相等；缺 `echarts` 或 `react-dom` 不猜测直接拒绝。测试 `L32-64`。
  - `L48-57` 对每条 `acceptedCompatibility` 调用 `validateApiMessage('variantCompatibilityResponse', ...)`，逐项校验 `record.status === 'passed'`、`variantReleaseId`、`packageName`、`packageVersion`、`packageSha256`、`framework`、`frameworkVersion` 及 `context.echartsVersion !== undefined && record.echartsVersion === context.echartsVersion`，`Set<string>` 去重 `recordIds`。测试 `L65-76`（9 类不匹配或非法记录拒绝与重复 ID 去重）。
  - `packages/contracts/src/search.ts:16-46`：`candidateSchema` 使用 `object(...)`（`additionalProperties: false`），`candidateIssues` 强制校验 `(status === 'verified') !== (recordIds.length > 0)`、去重 `recordIds`、同时含 `'api'` 与 `'docs'` 证据、`(e.kind === 'screenshot') !== (e.source !== undefined)`、`candidate.ranking.visual !== undefined` 时必须存在 `'screenshot'` 证据（`L42-44`）；`L55-67` `validateSearchCandidatesResponse` 逐个校验候选并拒绝重复 `variantReleaseId`（`DUPLICATE_ID`，`L63`）。
  - `eligibility.ts:58-61` 对组装后候选调用 `validateCandidate`，不满足契约（如无截图却带 `ranking.visual`）时丢弃；测试 `L24-31` 与 `L96-100` 验证人工截图保持 `compatibility.status === 'unverified'` 且可省略 `ranking.visual`。
  - 服务端零执行：`eligibility.ts` 仅依赖 `@company/contracts` 与 `docs/errors.js`，无 `child_process`、`fs`、组件构建执行或 Playwright/浏览器逻辑；`L67-68` 对非法 `ProjectContext` 抛 `PlatformError('INVALID_SCHEMA', checked.issues)`；测试 `L101-104` 覆盖 `INVALID_SCHEMA` 与 `loadCurrent` 异常透传（无部分成功伪结果）。
  - 非阻断观察：跨命中项的事务一致性依赖后续数据库适配器实现（`eligibility.ts:78` 说明）。
- 结论与状态：完成，无阻断项。A 侧审查提交为 `15511ec9`（见 `c-phase2-eligibility-2026-11-15.md`）。当时尚未接入真实 HTTP 路由与 PostgreSQL/索引持久化适配器。
- 交叉引用：`c-phase2-eligibility-2026-11-15.md`、`c-phase2-candidate-contract-2026-11-15.md`、`c3-text-search-2026-11-15.md`、`a-review-c3-search-2026-11-15.md`。
- 过时或矛盾点：无。

---

### a-review-c3-search-2026-11-15.md

- 日期／角色／主题：2026-11-15／A（独立只读审查）／C3 文本检索接入与索引审查。
- 目的：对 C 的 PostgreSQL 文本检索索引与鉴权 HTTP 做非作者只读审查。
- 承重事实：
  - 被审查工作区 `c-phase2-search`，基线 `95ec3726`（`feat: 增加明确查询与宿主版本的检索请求契约`）之上未提交变更：`apps/api/migrations/008_search.sql`、`apps/api/src/db/{migrate.ts,migration-files.ts,app.ts}`、`apps/api/src/search/{current.ts,service.ts,routes.ts}`、`apps/api/src/index/{search-indexer.ts,search-runner.ts}`、`tests/platform/search.test.ts`。
  - 结论：**无阻断项。**
  - `routes.ts:8-13`：`POST /v1/search/candidates` 设置 `Cache-Control: no-store` 与 `X-Robots-Tag: noindex, nofollow`，通过 `this.platform.run(auth, 'read', ...)` 强制 Bearer 鉴权、`read` 角色与禁用主体拦截（测试 `search.test.ts:23-24, 30-31, 51-52`）。
  - `service.ts:23-28`：先执行首轮 `loadCurrentCandidates` + `filterEligibleCandidates`，随后对 `eligibleIds` 执行第二轮 `loadCurrentCandidates(this.db, [...eligibleIds], subject)` + `filterEligibleCandidates`；单条 SQL（`current.ts:25-37`）对全部候选共享同一语句快照，拦截检索期间提交的撤权或元数据变更（测试 `L98-113`）。
  - `current.ts:6, 18-22`：`SEARCH_PROVIDER = 'metadata-text-v1'`；`searchRevision` 基于 `id, variantId, componentId, framework, category, name, version, sha256, variant, package` 的 `canonicalJson` 计算 SHA-256。
  - `service.ts:17-20` SQL `WHERE`：`p.state='READY' AND j.state='READY' AND vr.availability='Ready' AND catalog_can_read(c.id,$2) AND v.framework=$3 AND o.state='indexed' AND d.provider_version=$4`。
  - `current.ts:39-41` 映射 `o.state`（`'indexed'` → `'ready'`、`'failed'` → `'failed'`、其余 → `'pending'`）、`d.revision` 与 `d.provider_version`。
  - `migrations/008_search.sql:1-10`：`search_documents` 以 `variant_release_id` 为主键并约束 `revision` 为 64 位小写 hex，带 GIN `tsvector('simple', body)` 生成列；`release_outbox` 新增 `search_attempted_at timestamptz`（与 `release_jobs` Ready 状态解耦）；`migration-files.ts:4` 与 `migrate.ts:8` 已同步登记。
  - `search-indexer.ts:10-15`：事务中使用 `FOR UPDATE OF o SKIP LOCKED` 抢占 `j.state='READY'` 且 `(o.state IN ('pending','failed') OR $2)` 的任务，按 `o.search_attempted_at NULLS FIRST, o.created_at, o.job_id` 排序（测试 `L61-63`）。
  - `search-indexer.ts:16-36`：通过 `SAVEPOINT search_build` 保护整批 `search_documents` 写入；任一校验失败 `ROLLBACK TO SAVEPOINT search_build`，`release_outbox.state` 置 `'failed'`、`search_attempted_at=now()`（测试 `L69-82`）。
  - `search-runner.ts:20-22`：异常仅输出固定提示 `Search worker failed; inspect index state without exposing credentials.`
  - 非阻断观察：`service.ts:27-28` 在 `eligibleIds.size === 0` 时仍会发起一次空数组查询。
  - 未覆盖：只读未执行构建与 PostgreSQL 集成测试；真实线上部署环境与大规模语料 GIN/子串查询性能待后续验证。
- 结论与状态：完成，无阻断项。A 侧审查提交为 `627f9dd9`（见 `c3-text-search-2026-11-15.md`）。
- 交叉引用：`c3-text-search-2026-11-15.md`、`c3-search-request-2026-11-15.md`、`c3-live-gallery-2026-11-15.md`、`c-phase2-eligibility-2026-11-15.md`、`a-review-c2-search-2026-11-15.md`。
- 过时或矛盾点：无。

---

### a-review-project-context-2026-11-15.md

- 日期／角色／主题：2026-11-15／A（独立只读审查）／C 二期 ProjectContext 契约变更审查。
- 目的：对 C 的 ProjectContext 契约与 CLI 传播做非作者审查。
- 承重事实：
  - 被审查工作区 `C:\Users\10208\.codex\worktrees\c-phase2-search\zhinexus-design-asset-platform`（未提交变更，相对基准 `9ea600c0`）；只读核查，未编辑或提交 C 工作区任何文件。
  - 审查依据：`docs/plans/2026-11-15-phase2-kickoff.md`、`rules/code-review.md`、`c-phase2-project-context-2026-11-15.md`。
  - 结论：**无阻断项。**
  - `packages/contracts/src/project-context.ts:5-23`：`framework` 限定 `choice('vue', 'react')`、`packageManager` 限定 `choice('npm', 'pnpm')`、`frameworkVersion` 必填 `exactVersion`、`echartsVersion` 可选 `exactVersion`（`optional: ['echartsVersion']`）、`requirements` 必填 `array(text)`（`minItems: 0`，单项要求非空白字符且最长 2048）；`object(..., ['echartsVersion'])`，`additionalProperties: false` 拒绝未知字段。
  - `schema.ts:15-16, 38-72`：沿用现有 `exactVersion` 正则，允许精确 `x.y.z` 及 SemVer prerelease，拒绝 `^`、`~`、`*`、短版本及 `+build` 元数据；`validateSchema` 前置 `assertJson` 拒绝 `null`、`new Date()` 等非 JSON 值并返回 JSON Pointer 诊断；prerelease（如 `19.4.0-rc.1`）在形状层允许，与 `packages/contracts/README.md:134` 一致。
  - 无兼容性伪证：`project-context.ts:4`、`README.md:139`、`tests/contracts/project-context.test.ts:26` 均明确 `ProjectContext` 校验只证明输入形状，不构成兼容性或安装证据；测试显式拒绝携带 `compatibility: 'passed'` 的输入。
  - Schema 注册：`src/index.ts:16`、`src/schemas.ts:1,39-43`、`schemas/project-context-v1.schema.json:1-50`；`project-context-v1` 已在 `CONTRACT_SCHEMAS` 注册，生成 JSON Schema 与运行时一致；`tests/contracts/api-schema.test.ts:35-40` 磁盘一致性校验随 171 项契约测试通过。
  - `tests/contracts/project-context.test.ts:1-46` 18 项覆盖：3 组有效输入、13 组非法输入（非法框架/包管理器、范围/短/build 版本、空白/非字符串/超长需求、伪造 `compatibility`、缺必填项、`null`、`new Date()`）、1 项 `/frameworkVersion` JSON Pointer 诊断、1 项 `CONTRACT_SCHEMAS['project-context-v1']` 断言。
  - `packages/component-cli/scripts/sync-contracts.mjs:24` 已补齐 `'project-context.ts'`；实测核对 `packages/contracts/src/{index.ts,schemas.ts,project-context.ts}` 与 `packages/component-cli/src/contracts/` 对应镜像文件 SHA-256 完全一致；`component-cli` 的 `build` 脚本先同步契约再执行 `tsc` 与 `package-probe.mjs --check`，且 `dependencies` 不含私有 `@company/contracts`。
  - C 工作区 `component-platform-architecture.md` SHA-256 实测 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
  - 作者记录数字：18 项新契约测试、9 文件 171 项契约测试、10 任务强制构建、14 任务强制类型检查、根 47 文件 758 项 Vitest 全通过（A 本轮仅只读核查，未重复运行）。
  - A 侧审查提交为 `f172dbac`，位于 A 分支 `docs/verification/phase2-matching.md`。
- 结论与状态：完成，无阻断项。未涵盖后续 `Candidate`/`MatchPlan` 契约、后端检索/兼容过滤或前端表单浏览器交互验收。
- 交叉引用：`c-phase2-project-context-2026-11-15.md`、`a-phase2-context-alignment-2026-11-15.md`、`docs/plans/2026-11-15-phase2-kickoff.md`。
- 过时或矛盾点：本篇对 `validateProjectContext(null)` 的表述（`assertJson` 拒绝 `null`）被 `a-phase2-context-alignment-2026-11-15.md` 第 2 节澄清修正为：`assertJson` 放行 `null`，真正拒绝来自 `projectContextSchema` 的 `type: 'object'`。

---

### a2-scoring-fix-2026-11-15.md

- 日期／角色／主题：2026-11-15／A／离线评分器边界修复。
- 目的：补齐 `noMatchRejection` 门禁、防御稀疏数组空洞，并补充边界测试。
- 承重事实：
  - 工作区 `a-phase2-profiles`；分支 `feat/a-phase2-profiles`，基于 `988db80ebad1113b72ac304872783ddd23e3a9c7`。
  - 变更：`tests/evaluation/scoring.ts`、`tests/evaluation/scoring.test.ts`、本记录；历史记录 `a-phase2-scoring-2026-11-15.md` 未修改。
  - 修复 1：对齐 `docs/phases/phase2/evaluation-protocol.md`，在 `real` 组 `passed` 条件中增加 `noMatchRejection.value !== null && noMatchRejection.value >= 0.9`。
  - 修复 2：`assertStringArray` 从 `Array.prototype.map` 改为 `for (let idx = 0; idx < value.length; idx += 1)` 并校验 `Object.hasOwn(value, idx)`，拒绝 `new Array(1)` 等稀疏数组空洞，防止 `undefined` 在 `Set` 中产生伪命中。
  - 修复 3：新增 4 项测试（`noMatchRejection` 零分母、`< 90%`、`= 90%`，`Top5 80%` 与 `gapRecall 90%` 精确边界，稀疏数组空洞拒绝），总计 12 项。
  - TDD：RED 退出码 `1`（12 tests: 9 passed / 3 failed：`noMatchRejection` 零分母、`< 90%`、稀疏数组空洞）；GREEN 退出码 `0`（1 file / 12 passed）。
  - `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`verify:workspace` exit 0。
- 结论与状态：完成。C 独立复跑 A 修订后 12 项评分测试通过，门槛补齐与稀疏数组修复 commit 为 `2bea0082`（见 `c-phase2-eligibility-2026-11-15.md`）。全部测试为 synthetic，不代表已具备 30 个真实样本；未运行全量套件。
- 交叉引用：`a-phase2-scoring-2026-11-15.md`、`c-phase2-eligibility-2026-11-15.md`、`c-review-a3-evaluation-2026-11-15.md`、`docs/phases/phase2/evaluation-protocol.md`。
- 过时或矛盾点：无（是对 `a-phase2-scoring-2026-11-15.md` 的增补，不冲突）。

---

### a3-evaluation-runner-2026-11-15.md

- 日期／角色／主题：2026-11-15／A／文件型离线评估 Runner（A3）。
- 目的：实现把 cases/observations 文件跑成评分报告的 CLI runner。
- 承重事实：
  - 工作区 `a-phase2-profiles`；分支 `feat/a-phase2-profiles`。
  - 任务范围：仅 `tests/evaluation/runner.ts`、`tests/evaluation/runner.test.ts`、`docs/phases/phase2/evaluation-runner.md`、本记录。
  - 复用 `tests/evaluation/scoring.ts`，未修改评分规则、公共契约、根配置、锁文件、版本号或他人工作区。
  - RED：`.\scripts\pnpm.ps1 exec vitest run tests/evaluation/runner.test.ts` 退出码 `1`（`Cannot find module './runner.js'`）。
  - GREEN：`vitest run tests/evaluation/scoring.test.ts tests/evaluation/runner.test.ts` 退出码 `0`，2 个文件共 `17 passed`（`runner.test.ts` 5 项 + `scoring.test.ts` 12 项）。
  - 覆盖要点：达标时写入报告并返回退出码 `0`，含原文件字节 `casesSha256`/`observationsSha256`、版本标识、`now` 注入 `generatedAt` 及 `real`/`synthetic` 分组，且 stdout 不泄露原始数据；合法但未达标（仅 `synthetic` 样本）时写入报告并返回退出码 `2`；缺失/重复/未知/位置参数返回退出码 `1`；`schemaVersion !== 1`、顶层及条目未知字段、`split: 'train'`、未知 `caseId` 返回退出码 `1`；独占创建 `wx`：输出已存在或与输入文件相同时拒绝覆盖并返回退出码 `1`。
  - `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`verify:workspace` exit 0。
- 结论与状态：完成。被 `a3-runner-error-redaction-2026-11-15.md` 修订（错误脱敏，测试增至 18 项）与 `c-review-a3-evaluation-2026-11-15.md` 验收。仓库尚无真实人工标注 30+ 样本集与线上搜索观测输出，**T14 仍未完成**；`tsx tests/evaluation/runner.ts` 的端到端进程集成待真实样本就绪后验证（核心入口 `runEvaluationCli` 已在 Vitest 全覆盖）。
- 交叉引用：`a3-runner-error-redaction-2026-11-15.md`、`c-review-a3-evaluation-2026-11-15.md`、`a-phase2-scoring-2026-11-15.md`、`docs/phases/phase2/evaluation-runner.md`、`d-id-runner-2026-11-16.md`。
- 过时或矛盾点：本篇 17 项计数被脱敏修订后的 18 项取代；`docs/phases/phase2/id-evaluation-runner.md` 明确「不能把当前 ID 数组交给旧 runner」。

---

### a3-runner-error-redaction-2026-11-15.md

- 日期／角色／主题：2026-11-15／A／Runner 失败错误分类脱敏。
- 目的：避免 CLI 失败时把用户输入值回显到 stderr。
- 承重事实：
  - 工作区 `a-phase2-profiles`；分支 `feat/a-phase2-profiles`。
  - 修改文件：`tests/evaluation/runner.ts`、`tests/evaluation/runner.test.ts`；不修改历史记录 `a3-evaluation-runner-2026-11-15.md`。
  - 修订原因：原 `runEvaluationCli` 的 `catch` 分支直接将 `error.message` 输出至 `stderr`，会把未知参数、未知字段、非法 `split` 取值、重复 `caseId` 及 IO 文件路径等用户输入值回显到控制台。
  - RED：在 `runner.test.ts` 新增包含 `SECRET` 标记的 6 类回归场景（非法 `split`、未知字段、重复 `caseId`、不存在的 IO 路径、位置参数、未知参数）；`vitest run tests/evaluation/runner.test.ts` 退出码 `1`（5 passed / 1 failed），确认 `stderr` 回显 `SECRET_SPLIT_TOKEN`。
  - GREEN：按阶段/错误类型仅输出固定安全错误分类：`evaluation failed: invalid arguments`、`evaluation failed: invalid input`、`evaluation failed: io error`、`evaluation failed: unexpected error`。
  - `vitest run tests/evaluation/scoring.test.ts tests/evaluation/runner.test.ts` 退出码 `0`，共 `18 passed`（`runner.test.ts` 6 项 + `scoring.test.ts` 12 项）。
  - 根 `tsc -p tsconfig.json --noEmit` exit 0；`verify:workspace` exit 0。
- 结论与状态：完成，被 `c-review-a3-evaluation-2026-11-15.md` 独立验收（审查提交 `bbb0bf7f` 与修订 `f092f240`，无阻断项）。
- 交叉引用：`a3-evaluation-runner-2026-11-15.md`、`c-review-a3-evaluation-2026-11-15.md`、`docs/phases/phase2/evaluation-runner.md`。
- 过时或矛盾点：无。

---

### a-t13-id-eval-2026-11-16.md

- 日期／角色／主题：2026-11-16（Asia/Shanghai）／A／T13 ID 规则评估器补充边界验证。
- 目的：为确定性 ID 评估器补充 4 项硬违规边界测试。
- 承重事实：
  - 分支 `feat/t13-a-eval`，基线 `b13cc2d7`；只补充本轮边界测试，不改写历史记录。
  - `tests/evaluation/id-matching-boundary.test.ts` 新增 4 项：① `forbiddenVariantReleaseIds` 命中时判定硬违规；② 方案包含预期之外的实例时判定硬违规；③ 数据语义违规以缺口码表达时，缺缺口即失败；④ `ranking`/`proportion` 导出名必须精确为 `Ranking`/`Proportion`，评估器以精确 `variantReleaseId` 对齐。
  - 命令：`--filter @company/contracts build` 通过；`exec vitest run tests/evaluation/id-matching.test.ts tests/evaluation/id-matching-boundary.test.ts` 2 文件 `16/16` 通过，607ms；`build:services` 通过；`-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`verify:workspace` 10 成员、无循环、4 公开包、服务端依赖边界安全。
  - 原架构 SHA-256 未变。
- 结论与状态：完成。真实 30+ 标注集仍未提供，T13/T14 总体验收保持开放；`component-api.ts` 本轮未改动（现有实现已在 main 通过历史验证）。
- 交叉引用：`a-phase2-id-evaluation-2026-11-15.md`、`c-t13-matching-baseline-2026-11-16.md`、`b-t13-match-ui-2026-11-16.md`、`phase2-id-integration-2026-11-16.md`、`d-id-runner-2026-11-16.md`。
- 过时或矛盾点：无。

---

### b-phase2-candidate-results-2026-11-15.md

- 日期／角色／主题：2026-11-15／B／候选响应解析与纯展示组件实现与验证交接（B2）。
- 目的：实现候选响应解析层与纯展示组件。
- 承重事实：
  - Worktree `C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`；分支 `feat/b-phase2-matching`。
  - 契约基线 `dcb4d52e`（`feat: 原样接入 C 二期候选响应公共契约`；C 原提交 `e0a7f5ee`，12 文件逐 blob 相等）。
  - 性质：B2 GREEN 实现（严格限定 4 个文件）；未做 Git 操作；Windows 验证与提交由 C 负责。
  - 交付：`apps/gallery/app/lib/candidate-results.ts`（`parseCandidateResults`）、`apps/gallery/app/(console)/match/CandidateResults.tsx`、`tests/gallery/candidate-results.test.ts`（23 例）、本记录。
  - C 在测试内的两项修正已保留未覆盖：以 `createRequire(new URL('../../apps/gallery/package.json', import.meta.url))` 从 gallery 声明边界加载 `react`/`react-dom/server`；HTML 转义用例改为断言「无真实 `<img` 标签且存在 `&lt;img` 文本」。
  - `parseCandidateResults` 直接返回 `validateSearchCandidatesResponse(input)`，对外承诺「不抛原始异常」。
  - `CandidateResults` 行为：根 `#candidate-results`；`candidates` 为空渲染 `#candidate-empty`「暂无候选」且不输出任何 `.candidate-card`；每候选一张 `.candidate-card`（`exportName`、`packageName@packageVersion`、框架标签、`componentId`/`variantId`/`variantReleaseId`）；`verified` → 「已验证」并列出 `recordIds`，`unverified` → 「未验证」；证据 `kind`/`path` 纯文本、截图附 `source`，不生成链接、不拼存储地址；评分分栏「文本评分」必显，「用途评分」「视觉评分」仅在有值时显，缺 `visual` 显「未提供视觉评分」，不补 `0`、不合并为单一相似度；候选级与响应级 `gaps` 均展示；全部文本经 React 转义。
  - 组件**未挂载**到在线 `/match`，不发请求、不持久化、不构造证据 URL。
  - 框架标签修订（宿主复跑回归）：原 23 项测试全部通过（C 已在 `vitest.config.ts` 补 oxc JSX runtime，解决 Next `jsx: preserve` 下根 Vitest 不编译 TSX 的问题）；C 新增第 24 项回归「框架标签只展示响应提供的框架，不猜测框架主版本」并实跑 RED——`Candidate` 契约只含 `framework`、不含 `frameworkVersion`，而组件原先把可见标签写死「Vue 3」/「React 19」；修订为 `Vue`/`React`。
  - 样式：B2 允许改动范围不含 `globals.css`，沿用语义类名 + 控制台既有行内样式约定；样式细化留待接入批。
  - 版本：未对外接入的组件不触发重复 Gallery 升版，本批**不升版**、不改 `CHANGELOG.md`。
  - 建议提交：`git add apps/gallery/app/lib/candidate-results.ts "apps/gallery/app/(console)/match/CandidateResults.tsx"` + `git commit -m "feat: 实现候选响应解析与纯展示组件"`；再单独提交文档。Git 身份 `juzhiqiang <1020814597@qq.com>`。
- 结论与状态：完成（GREEN 实现交接）；宿主验收数字见 `c-b2-candidates-acceptance-2026-11-15.md`（24 项通过）。未接入 `/match`；「无请求」仅由静态渲染输出不含 `<a `/`href=`/`http` 佐证，不等于运行期网络审计；未做运行期浏览器验证；`tests/fixtures/search.ts` 为合成 fixture。
- 交叉引用：`c-b2-candidates-acceptance-2026-11-15.md`、`a-review-b2-candidates-2026-11-15.md`、`c-phase2-candidate-contract-2026-11-15.md`、`b3-search-page-2026-11-15.md`、`b-phase2-context-implementation-2026-11-15.md`。
- 过时或矛盾点：无。

---

### b-phase2-context-implementation-2026-11-15.md

- 日期／角色／主题：2026-11-15／B／项目上下文本表单实现与验证交接（B1）。
- 目的：在画廊实现 `/match` 项目上下文本地校验表单。
- 承重事实：
  - Worktree `C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`；分支 `feat/b-phase2-matching`。
  - 基线：C 契约提交 `35dcc2e1`（`packages/contracts/src/project-context.ts`，contract `e8248fb3`）。
  - 性质：B1 GREEN 实现（仅 `apps/gallery` 内新增/局部改动 + 两个测试 + 本记录）；不接检索/匹配，不伪造 API/匹配结果。
  - 交付表：`apps/gallery/app/lib/project-context-form.ts`（新增，`buildProjectContext` 纯转换）；`apps/gallery/app/(console)/match/page.tsx`（新增，`'use client'`）；`apps/gallery/app/(console)/layout.tsx`（改，控制台导航新增 `/match` 入口）；`apps/gallery/app/globals.css`（改，追加 `.console-nav*` 与 `.match-*` 局部样式，含 `≤640px` 响应式）；`tests/gallery/phase2-context.test.ts`（新增，上轮 RED）；`tests/browser/phase2-context.spec.ts`（新增，上轮 RED 本轮修）；本记录。
  - 未触碰：`packages/contracts`、根配置/锁/版本、`auth`、README、其他 worktree/主仓库；无 merge/push/发布/凭证操作。
  - `buildProjectContext` 设计：仅纳入已提供（非 `undefined`）字段；缺必填字段时不塞 `undefined`（避免 `assertJson` 以根路径报错），让 `validateProjectContext` 返回对应字段路径的「必填缺失」；`echartsVersion` `trim` 后为空则省略、非空才纳入；`requirements` 原样纳入，空白单项由契约 `text` 规则拒绝、空数组允许；返回 `ValidationResult<ProjectContext>`。
  - `/match` 页面行为：复用控制台既有会话门（`getStoredSession`/`saveSession`，仅展示）；原生 `select`/输入；需求增删；任意字段/草稿/增删编辑即清理校验结果与提示；校验时存在非空未添加草稿则阻止并提示「请先添加当前需求」且保留草稿；登出重置全部项目字段/草稿/列表/结果与 `tokenInput`；字段错误经 `aria-invalid` + `aria-describedby` 绑定；持久展示「匹配服务尚未接入」；无 `fetch`，不写项目需求，既有登录仍写会话；框架/版本初始为空、不猜测默认版本。
  - 浏览器测试修正（宿主 RED 反馈）：单测因缺 `project-context-form` 模块失败；Playwright 页面 404，1 失败 / 1 中断 / 4 未跑；「noindex」用例被 404 页面自带 noindex 误判通过；修正为每个 `/match` 用例补 `expect(response?.status()).toBe(200)`（登录门用例同样 200）。
  - 验证命令（C 宿主执行）：`--filter @company/gallery typecheck`；`exec vitest run tests/gallery/phase2-context.test.ts`；`--filter @company/gallery build`；`test:browser tests/browser/phase2-context.spec.ts`。预期单测 9 例全绿、浏览器 7 例全绿。
  - 版本：`/match` 为对外可见新增功能，达到升版条件，由 C 在功能验收通过后将 `@company/gallery` **独立**升至 `0.0.6`（`chore: 升级版本号至 0.0.6` + `CHANGELOG.md`），不与本实现提交混列。
  - 建议提交：`git add apps/gallery/app/lib/project-context-form.ts "apps/gallery/app/(console)/match/page.tsx" "apps/gallery/app/(console)/layout.tsx" apps/gallery/app/globals.css` + `git commit -m "feat: 实现 /match 项目上下文本地校验表单"`；测试与记录由 C 一并提交。Git 身份 `juzhiqiang <1020814597@qq.com>`。
- 结论与状态：完成；被 `b-phase2-context-implementation-revision-2026-11-15.md` 修订（第 6 节版本口径 + 「无 localStorage 写入」表述），经 `a-review-b-context-2026-11-15.md` 审查（无阻断）与 `c-b-phase2-context-acceptance-2026-11-15.md` 宿主验收（上下文 10 项通过，Gallery 0.0.6）。
- 交叉引用：`b-phase2-context-implementation-revision-2026-11-15.md`、`a-review-b-context-2026-11-15.md`、`c-b-phase2-context-acceptance-2026-11-15.md`、`b-phase2-matching-2026-11-15.md`、`b3-search-page-2026-11-15.md`、`b-phase2-design-id-match-2026-11-15.md`、`b-phase2-query-implementation-2026-11-16.md`。
- 过时或矛盾点：第 6 节原始版本口径「纯实现不单独升版」与「无 localStorage 写入」两处表述被修订篇修正，引用时应以修订篇为准。

---

### b-phase2-context-implementation-revision-2026-11-15.md

- 日期／角色／主题：2026-11-15／B／B1 表单修订记录（过期提示与身份残留修复）。
- 目的：修复宿主 RED 反馈的 2 项回归，并修正交接文档口径。
- 承重事实：
  - Worktree/分支同上；性质：仅修 `apps/gallery` 页面与文档口径；**不改测试**（`tests/browser/phase2-context.spec.ts` 由 C 维护，含其新增 2 项独立回归）；不运行 Git、不改其他范围。
  - 宿主首轮验证背景：27 项表单 + 契约单测通过；gallery 构建通过；原 7 项浏览器全通过。C 追加 2 项独立回归并实跑 RED（共 9 项，7 过 2 失败）：① 输入需求草稿后仍残留 2 处「本地校验通过」旧提示；② 退出再换身份后，上一身份的需求列表仍残留 1 条。
  - 根因与修复（仅 `app/(console)/match/page.tsx`）：① 草稿输入框 `onChange` 只 `setRequirementInput`，未清理 `result` 与 `statusMessage` → 引入 `clearOutcome()`（同时清两者），草稿输入改走 `onRequirementInput`，所有字段/草稿/增删编辑统一调用 `clearOutcome`；② `handleLogout` 未重置表单状态 → 重置全部项目字段、需求草稿、需求列表、`result`、`statusMessage` 及 `tokenInput`。
  - 新增行为：校验时若存在非空未添加草稿，`handleValidate` 阻止校验并提示「请先添加当前需求」，**保留草稿**。
  - 原有 7 项浏览器用例与 27 项单测不受影响。
  - 文档口径修正：第 6 节改为「功能验收通过后由 C 将 `@company/gallery` 独立升至 `0.0.6`，不混入本实现提交」；「无 localStorage 写入」改为「不写项目需求，既有登录仍写会话」。
  - 未运行 Windows 工具链；请 C 宿主复跑 `test:browser tests/browser/phase2-context.spec.ts`（预期 9 项全绿）与 `--filter @company/gallery typecheck`。
- 结论与状态：完成。宿主复跑结果见 `c-b-phase2-context-acceptance-2026-11-15.md`（组合 25 项通过）。
- 交叉引用：`b-phase2-context-implementation-2026-11-15.md`、`c-b-phase2-context-acceptance-2026-11-15.md`、`a-review-b-context-2026-11-15.md`。
- 过时或矛盾点：无。

---

### b-phase2-design-id-match-2026-11-15.md

- 日期／角色／主题：2026-11-15／B／设计 ID 配置输入与装配方案界面实现与验证交接。
- 目的：实现画廊侧设计 ID 规则配置输入与 `POST /v1/matching/plans` 装配方案展示。
- 承重事实：
  - Worktree `C:\Users\10208\.codex\worktrees\b-phase2-design\zhinexus-design-asset-platform`；分支 `feat/phase2-id-gallery`。
  - 契约基线 `01e95e16`（`feat: 定义确定性装配方案与版本化组件 API 契约`；C 冻结 `POST /v1/matching/plans` 协议）。
  - 性质：GREEN 实现（3 个实现文件 + 3 个测试文件 + 本记录）；**未做任何 Git 操作**；Windows 固定工具链验证、审查、提交与版本收口由 C 负责。
  - 交付：`apps/gallery/app/(console)/match/design-id-input.ts`、`apps/gallery/app/lib/match-plan-client.ts`、`apps/gallery/app/(console)/match/DesignIdMatch.tsx`、`apps/gallery/app/(console)/match/page.tsx`（改，memo 化上下文本地校验结果并挂载 `DesignIdMatch`，+21/-2）、`tests/gallery/design-id-input.test.ts`（18 项）、`tests/gallery/match-plan-client.test.ts`（20 项）、`tests/browser/phase2-design-match.spec.ts`（31 项）、本记录。
  - 未改：`packages/contracts`、根配置（`vitest.config.ts`/`tsconfig.json`/`tsconfig.base.json`）、锁文件、版本号、`auth`、`globals.css`、既有测试、`apps/api`、`packages/component-cli`。
  - `design-id-input.ts`（纯本地零网络）：`parseMappingJson` 语法失败只返回单条固定文案 `MAPPING_JSON_SYNTAX_ERROR`，不带解析器原文；`buildDesignIdInput({mapping, elements})` 白名单组装 `{schemaVersion:1, mapping, elements}` 后交 `validateDesignIdInput`，重复映射/实例、未知字段、空白或超长 ID 以 `/mapping/...`、`/elements/...` 前缀路径返回；`groupElementsByDesignId(design)` **必须用 `Map`**（designId 是不透明字符串，可能是 `__proto__`/`constructor` 等原型键形状，用普通对象累加会污染原型或触发原型链遍历）；`buildDesignForm({mappingText, elements, bindingsText})` 顺序为「规则 JSON 语法 → 完整输入校验 → 绑定 JSON 语法」，空绑定（空文本或空数组）按**省略**处理；ID 一律原值：不 trim、不转大小写、不切分、不按正则或路径解释。
  - `match-plan-client.ts`：`POST {apiUrl}/v1/matching/plans`，`authorization: Bearer <token>`、`content-type`/`accept: application/json`；白名单构造请求体，`reactDomVersion` 仅非空白时出现，`bindings` 仅非空数组时出现（空键会同时破坏载荷键集合与 `inputDigest`）；请求体先过 `validateMatchPlanRequest`，非法本地即拒不发请求；响应用 `validateMatchPlan` 解析并**先核对 `inputDigest`**（必须等于本地对完整请求计算的 `manifestDigest`，不一致返回 `reason: 'stale'` 并丢弃，先于 schema 判断）；取消语义 fetch 前、`await fetch` 后、`await json` 后三处检查，已取消一律 `AbortError` 原样上抛；失败分类 `invalid-input`/`unauthorized`/`unavailable`/`invalid-response`/`stale`，仅 `invalid-input` 附带契约 issues（安全字段路径，不含用户输入值），其余一律固定文案；无任何 `localStorage`/`sessionStorage` 写入。
  - `DesignIdMatch.tsx` + `/match/page.tsx`：输入面 `#design-mapping-input`、`#design-instance-input` + `#design-design-id-input` + 「添加元素」/`#design-elements-list`、`#design-bindings-input`（可选）、`#design-submit`；**只有显式点击「生成装配方案」才 POST**；沿用 B3 已验证的「请求代次 + `AbortController` + token/subject 身份快照」三层守卫，覆盖规则 JSON 编辑、元素增删、绑定编辑、项目上下文变化、退出登录、身份切换、组件卸载；提交前从 `getStoredSession()` 复核 token/subject，失效则不发请求并交父级 `invalidateSession()` 回退登录门；方案展示只呈现服务端返回的真实内容，不生成任何链接、不编造结论；`mapped` 明确标注「仅表示目标发布材料可映射，不等于可自动接入或完成业务验证」；空设计走 `EMPTY_DESIGN` 缺口而不是成功态；全程不使用图片识别或大模型，不把文本需求自动标为满足，不做三期代码安装；父级仅新增 memo 化的 `contextCheck` 与挂载点。
  - 测试覆盖要点：单元 38 项（不透明 ID 原值往返含 `' ID '`、`'id'`/`'ID'`、`'../line'`、`'a.*'`、`'__proto__`、`'constructor'`；`line`/`line:1`/`line/1`/`line-1`/`line.1`/`Line` 视为六个不同设计；重复映射即使目标相同拒绝；重复实例拒绝；同 designId 多实例复用；未知 designId 放行；空配置放行；`/mapping` 前缀口径；原型键不污染；载荷键集合恰好 `{design, context}`；本地校验失败零请求；`inputDigest` 一致/不一致；401/403；5xx；非 JSON；schema 不符；空设计缺 `EMPTY_DESIGN`；三处取消检查点）；浏览器 31 项。
  - **沙箱内未运行** vitest/playwright/tsc/next build；RED 由 C 宿主实跑确认（`.tools/b-red.log`）；沙箱仅用全局 `tsc` 做语法与内部类型核对（`@company/contracts` 映射到源码，屏蔽 `react`/`vitest`/`@playwright/test` 缺失）。
  - 自测发现并已修正的两处测试缺陷（非实现缺陷）：① `design-id-input.test.ts` 的「`/mapping` 前缀口径」一例原先在失败结果上取 `value`，运行期恒为 `undefined`；② `phase2-design-match.spec.ts` 有三例（未知 designId、多实例复用、HTML 转义）用单元素请求的摘要给多元素/异 designId 的响应签名，会被 `inputDigest` 校验正确判为 stale。
  - 需 C 注意：工作区存在未跟踪目录 `.tools`（宿主 RED 日志所在）；若希望空 `bindings` 数组显式发送需同步修改 `buildRequestBody` 与对应测试；计划 Task 3 描述中 `apps/gallery/src/` 与实际 `apps/gallery/app/` 不一致。
- 结论与状态：完成（实现交接）。宿主 GREEN 数字见 `phase2-id-integration-2026-11-16.md`（浏览器 53/53）与 `b-t13-match-ui-2026-11-16.md`（单测 89/89、浏览器 34/34）。未联调真实 Nest `apps/api/matching`；未测「手动选候选必须显式更新配置」（Task 3，需 C 先冻结候选选择回写协议）；未做三期代码安装/写入；真实设计 ID 命名规范、设计平台导出格式与真实样本仍未到位；gallery 版本升版（当时 `0.0.7`）与 CHANGELOG 由 C 收口。
- 交叉引用：`phase2-id-integration-2026-11-16.md`、`b-t13-match-ui-2026-11-16.md`、`c-t13-matching-baseline-2026-11-16.md`、`phase2-id-contracts-2026-11-15.md`、`b3-search-page-2026-11-15.md`、`docs/phases/phase2/id-evaluation-runner.md`、`docs/phases/phase2/id-observation-handoff-2026-11-16.md`。
- 过时或矛盾点：本篇浏览器 31 项、单测 18+20=38 项为 B 交接时点数；宿主最终实跑为浏览器 34 项（`b-t13-match-ui-2026-11-16.md`）与 4 文件 89 项，差异源于 C 集成补充。

---

### b-phase2-matching-2026-11-15.md

- 日期／角色／主题：2026-11-15／B（只读审计代理）／画廊/控制台/表单/测试只读审计与上下文表单接入边界。
- 目的：为二期「设计稿匹配 / 上下文表单」在画廊侧落地做边界盘点，并交付实施清单。
- 承重事实：
  - Worktree `C:\Users\10208\.codex\worktrees\b-phase2-matching\zhinexus-design-asset-platform`；分支 `feat/b-phase2-matching`；审计基点 HEAD `fa24ab525e5945e7096ed816a83f11962ba5f000`。
  - 性质：只读审计 + 单一文档交付；未写页面、未自定义公共 DTO、未伪造 API/匹配结果；未执行 merge/push/发布/凭证。
  - 交接更新：C 已交付 `ProjectContext` 公共契约（contract `e8248fb3`，原样合入 B 为 `35dcc2e1`，13 文件 blob 一致）；本批据此转入 B1（先写两个 RED 测试、不写实现）。
  - 沙箱路径限制：worktree `.git` 内容为 `gitdir: D:/project/zhinexus-design-asset-platform/.git/worktrees/zhinexus-design-asset-platform5`，admin dir 内 `gitdir` 回指针为 Windows 路径 `C:/Users/10208/.codex/worktrees/b-phase2-matching/...`；只读 git 需 `git --git-dir="$GD" --work-tree="$WT" -c safe.directory='*' --no-optional-locks <cmd>`。
  - 沙箱删除限制：挂载目录内 `unlink`（`rm`）返回 `Operation not permitted`，但 `touch`/`write` 成功；故不在沙箱内 commit，改由 C 宿主代验与提交。
  - 三个临时文件已删除：B worktree 根 `.__wtest`、主仓库对象 `.__wtest`、陈旧 `index.lock`（`D:\project\zhinexus-design-asset-platform\.git\worktrees\zhinexus-design-asset-platform5\index.lock`）。
  - Gallery 结构：`apps/gallery`（`@company/gallery`，`private: true`，端口 `5173`）Next.js `16.4.6` App Router，`next.config.ts` 设 `distDir: 'dist'`；公开组 `app/(public)/`（`page.tsx`、`components/page.tsx`、`components/[slug]/page.tsx`），私有组 `app/(console)/`（`layout.tsx` 仅 `robots: { index: false, follow: false }`、`upload/page.tsx`、`jobs/[jobId]/page.tsx`）。
  - 详情页预览 iframe `src` 取 `effectivePreviewUrl = grantUrl || activeVariant.previewUrl`（`ComponentDetailViewer.tsx` 第 42 行），优先 `requestPreviewGrant(variantId)` 短期授权 `bootstrapUrl`，回退 `activeVariant.previewUrl`；`sandbox="allow-scripts allow-same-origin"`；`previewUrl` 里的 `127.0.0.1:5174`/`5175` 只是本地示例 dev server，并非生产独立注册域验收路径。
  - 爬虫边界：`app/robots.ts`、`app/sitemap.ts`；sitemap 仅列公开首页与 `/components`，控制台路径被排除。
  - Console 保护为「占位式保护」，尚无真实 OIDC：无 Next middleware、无服务端会话；`app/lib/auth.ts` 的 `parseTokenPayload` 仅 JWT payload 解码用于展示（安全性由服务端 Bearer 鉴权强制校验，`auth.ts` 第 8–11 行）；会话存 `localStorage`（键 `zhinexus_console_auth`）；API 基址支持 `?apiUrl=` 与 `localStorage('zhinexus_api_url')`，默认 `http://127.0.0.1:3000`。
  - 表单样板 `app/(console)/upload/page.tsx`（约 950 行，`'use client'`）：四个 `useEffect`；`app/lib/uploads/manifest-form.ts` 提供 `computeBrowserSha256`、`sanitizeWebManifest`（强制 `channel: 'web'`、截图 `source: 'manual-upload'` + `environmentKey: 'unknown-manual'`、剥离 `reportId`、清空 `reports`、`compatibility.status` 降为 `candidate`）、`parseAndValidateImportedManifest`、`createUploadSession`/`uploadFileBytes`/`uploadPartBytes`/`completeUploadSession`/`submitReleaseJob`/`fetchReleaseJob`（统一 `authorization: Bearer <token>`，失败抛错不吞错）、`validateUploadFiles`（图片 10MB / tarball 50MB / 总计 500MB）、`executeWebUploadWorkflow`（DI `options.api`/`options.storage` + `createMemoryStorage`）。
  - `app/lib/uploads/screenshot-validation.ts`：`validateVariantScreenshots`（`SCREENSHOT_REQUIRED`/`SCREENSHOT_VARIANT_MISMATCH`/`DIGEST_MISMATCH`/`SOURCE_FORBIDDEN`）、`createManualScreenshotRef`。
  - DTO 边界：画廊从不自定义公共 DTO，全部从 `@company/contracts` 导入；`app/lib/types.ts` 只定义展示层视图模型；`app/lib/catalog.ts` 的 `OFFICIAL_COMPONENTS`（line/bar/pie/scatter `@0.0.4`）仅展示回退，`getCatalogComponents` 以 API 为先（`GET /v1/components`，1.5s 超时、`cache: 'no-store'`），不可达返回 `[]`。
  - 测试入口：`apps/gallery/package.json` **没有 `test` 脚本**（仅 `build`/`typecheck`/`dev`/`preview`）；逻辑测试在仓库级 `tests/unit/web-upload-workflow.test.ts`；浏览器 `tests/browser/gallery-rendering.spec.ts`；缓存回归 `tests/integration/gallery-cache.mjs`。
  - 未接入边界盘点：`apps/api/src` 无 `search`/`matching` 目录；全仓 grep `parseDesign|createMatchPlan|searchCandidates|MatchPlan` 无命中；画廊无任何 match/design 页面；T14 计划写的 `apps/gallery/src/pages/DesignMatch.vue` 是**迁移前旧路径**（当前为 Next App Router，无 `src/pages`、无 `.vue`）；OIDC 未接入；G2 外部条件未就绪。
  - 提交交接：唯一改动文件 `docs/verification/phase2-matching.md`；不在沙箱执行 commit；`git commit -m "docs: 记录二期画廊/控制台/表单/测试只读审计与上下文表单接入边界"`；纯文档不升版。Git 身份 `juzhiqiang <1020814597@qq.com>`。
- 结论与状态：完成（只读审计）。本审计的「契约缺失」开工门槛在 C 交付 `35dcc2e1` 后消除；其 B1 范围由 `b-phase2-context-implementation-2026-11-15.md` 实现。
- 交叉引用：`b-phase2-context-implementation-2026-11-15.md`、`c-phase2-project-context-2026-11-15.md`、`a-review-project-context-2026-11-15.md`、`docs/plans/2026-11-15-phase2-kickoff.md`、`rules/{architecture,platform,security,testing-release,code-review}.md`。
- 过时或矛盾点：本篇「契约缺失」开工门槛与「检索/匹配服务未交付」状态已被后续 C 交付（`e0a7f5ee`/`95ec3726`/`01e95e16`/`53117379`）与 B 接入（B2/B3/design-id/query）覆盖；文中「OIDC 未接入」口径在 `c-b-phase2-context-acceptance-2026-11-15.md` 被限定修正为「画廊登录流程与公司真实 OIDC 验收」。

---

### b-phase2-query-implementation-2026-11-16.md

- 日期／角色／主题：2026-11-16／B（Claude 桌面端）／组件精确查询 GET 与 Gallery 查询入口（P1）。
- 目的：实现 `GET /v1/matching/components` 权威查询、材料校验与画廊查询表单。
- 承重事实：
  - Worktree `C:\Users\10208\.codex\worktrees\phase2-b-query\zhinexus-design-asset-platform`；分支 `feat/phase2-b-query-api`。
  - 基线契约提交 `531173793fbbc23819874cbb7909dd7e8f789884`（`feat: 定义二期组件精确查询契约`）。
  - 规格 `docs/specs/2026-11-16-phase2-query-completion-design.md`；计划 `docs/plans/2026-11-16-phase2-query-completion.md` 的 P1。
  - 实现范围（14 个文件）：`apps/api/src/matching/component-query.ts`（新增）、`component-query-routes.ts`（新增）、`materials.ts`（新增，从 `matching/service.ts` 提取共享 helper）、`matching/service.ts`（改，行为不变，净减 20 行）、`apps/api/src/app.ts`（改，注册 `ComponentQueryController`）、`apps/gallery/app/lib/component-match-client.ts`（新增）、`apps/gallery/app/(console)/match/ComponentQuery.tsx`（新增）、`apps/gallery/app/(console)/match/page.tsx`（改）、`tests/integration/component-query.test.ts`（新增）、`tests/platform/component-query.test.ts`（新增）、`tests/gallery/component-match-client.test.ts`（新增）、`tests/browser/phase2-component-query.spec.ts`（新增）、本记录。未触碰 `packages/contracts`、根配置与锁文件、版本号、`CHANGELOG.md`、SDK、CLI。
  - C 初审 5 项缺陷 + 1 项补充（B 只新增失败测试并暂停实现）：① `queryComponentMatch` 的 `target` 直接 `...current.candidate`，把 `gaps` 等 `SearchCandidate` 字段带进 `MatchTarget`，严格 `additionalProperties:false` 会拒 → `INTERNAL_ERROR`；② `readApi` 返回 null 时直接 `API_UNSUPPORTED`，缺最终 find/权限复查，撤权 + 读失败会泄漏存在性 → 应为同形 `TARGET_UNAVAILABLE`；③ `parseComponentMatchQuery` 先赋值普通 `{}` 再 `Object.keys` 白名单，`__proto__` 走原型 setter 被丢掉 → 应 400；④ 计划约定 `requestComponentMatch(query,{token,signal?,apiUrl?}): Promise<ComponentMatchResponseV1>`，B 之前给的是 outcome 包装；⑤ `buildQuery` 对 `packageName`/`reactDomVersion` 做 `trim`，输入必须精确；补充：`selectTarget` 用 `resolveRelease`（含 peer/Ready 过滤）消歧，把「可读但 peer 不符」的第二包过滤掉，掩盖跨包歧义 → 应 409 `CONFLICT`。
  - 编译/导入阻塞修复（0-A.1）：SQL 行类型改用 `VariantRef`/`PackageRef`/`AcceptedCompatibilityRecord[]`；`parseComponentMatchQuery` 从 `component-query-routes.js` 导入；`component-query-routes.ts` 首行补 `import 'reflect-metadata';`。
  - 测试自身缺陷修复 6 处（0-A.2）：`harness()` 返回值漏 `add`；`add()` 改为克隆同框架模板包再覆盖 `name`/`version` 并同步 `variant.packageName`；Vue/React 拆分 `api/line-<framework>.json` 与 `docs/line-<framework>.md`；`parseComponentMatchQuery` 接收完整 URL 需加 `?` 前缀（新增 `url()` 辅助）；材料摘要类用例保持 metadata 与 evidence 一致、只篡改 store 读出的字节；`exactDependencies` 顺序改用 `toHaveLength` + `arrayContaining`。安全断言未做任何放宽。
  - 最小实现修复（0-A.3，宿主 RED 确认后）：宿主 RED `112 项 = 72 过 / 40 失败`（query 60 中 12 失败、Gallery 28 全失败、旧 POST 24 全过），日志 `.tools/phase2-b-corrected-red.log`。修复：① target 逐字段构造只取 12 个 `MatchTarget` 字段，`evidence` 只放 api/docs 两条；② 最终复查前移到材料读取之后、`!api` 判定之前；③ 白名单落到解码后的 `pairs` 上；④ 歧义判定先于资格过滤（歧义集改为 `canRead` 为真的快照按 `packageName` 分组，跨包或同一包名多条即 409）；⑤ `requestComponentMatch` 签名回到计划约定 + 新增 `requestComponentMatchWithOutcome` UI helper + `buildComponentMatchQuery` 不 trim；⑥ `ComponentQuery.tsx` 改用新签名。**段落覆盖关系：0-A.3 为当前生效口径，第 0/1/2/5/6 节与之冲突的描述以 0-A.3 为准。**
  - 真实 HTTP「读取期间状态变更」回归 5 条（0-A.4，B 侧未执行）：材料读取期间撤权（`component_permissions` 三列置 false）/插入 `disabled_subjects`/`availability='DEPRECATED'` → 同形 `TARGET_UNAVAILABLE`；新增同版本可读 `package_releases` → 409 `CONFLICT`；无变更对照必须仍 `matched`。
  - 宿主实跑证据（0-A.5）：`build:services` exit 0；`vitest run tests/integration/component-query.test.ts tests/integration/match-plan.test.ts tests/gallery/component-match-client.test.ts` `112 项 = 107 过 / 5 败`（`.tools/phase2-b-green.log`）；平台 `tests/platform/component-query.test.ts + matching.test.ts` `32 项 = 30 过 / 2 败`（`.tools/phase2-b-platform-green.log`）；全图 `turbo run build typecheck --force` `20/20`（`.tools/phase2-b-graph.log`）；浏览器 `51 项 = 50 过 / 1 败`（`.tools/phase2-b-browser.log`）；根 tsc `15 处测试文件类型错误`（`.tools/phase2-b-root-tsc.log`）。首轮 5 个失败经核对全部是测试样例缺陷，逐条修订 10 项（含「浏览器禁词用例误伤否定句」改为正向断言 `unverified`/`COMPATIBILITY_UNVERIFIED`，产品文案一行未改）。
  - 0-A.6 新增 RED：真实 `ArtifactStore.read` 遇 S3 404 抛 `UPLOAD_INCOMPLETE`（HTTP 409），对象大于 `expectedBytes` 抛 `LIMIT_EXCEEDED`（HTTP 413），而 `readApi` 只吞 `NOT_FOUND`/`DIGEST_MISMATCH`。RED 证据 `.tools/phase2-b-storage-red.log`：平台 `36 项 = 32 过 / 4 败`（3 项产品缺陷 + 1 项测试作用域错误）。最小修复：只改 `ComponentQueryService.query` 里 GET 自己的 `artifact` seam，把 `UPLOAD_INCOMPLETE`/`LIMIT_EXCEEDED` 规范化为 `NOT_FOUND`；未改共享 `readApi`、未改 POST 语义、未改 `ArtifactStore` 全局行为；`INFRA_UNAVAILABLE` 仍原样上抛 503。
  - 第 0 节：B 未能在宿主实跑任何验证命令（原因：依赖安装未结束；沙箱 Linux 无法执行 Windows 固定工具链 Node `26.13.0`/pnpm `12.18.0`；沙箱内 pnpm `node_modules` 符号链接/junction 不可读（`ls` 报 `Input/output error`），`.pnpm` 下 `typescript@7.0.2` 缺 `@typescript/typescript-linux-x64`；隔离 PG/MinIO/Verdaccio/OIDC JWT+JWK 在沙箱完全不存在）。副作用：沙箱构建过一次 `packages/contracts/dist`（gitignored），沙箱拒绝删除故原样保留。
  - 服务端关键决策：`parseComponentMatchQuery(url)` 只吃原始 URL，顺序「分段 → 单次解码 → 解码后重复键检查 → 未知键检查 → 结构/条件校验」；解码 `decodeURIComponent(raw.replace(/\+/g,' '))`；拒绝空片段、无等号片段、空键、未知键（含 `componentId[]`、`filter[framework]`）、空值、范围/不完整版本；控制器读 `request.originalUrl ?? request.url`，不使用 Nest/Express query 对象；单条参数化 SQL `c.id=$1 AND v.framework=$2 AND p.version=$3 AND ($5::text IS NULL OR p.name=$5)`，同语句取 `catalog_can_read(c.id,$4)`；0 个可读 → 同形 `TARGET_UNAVAILABLE`，>1 → 409 `CONFLICT`，恰好 1 → 继续；不读文本索引、不依赖 `search_documents`、不按组件命名拼接；`exactDependencies` = 目标包 + 框架 + echarts + （React）react-dom + 目标包自身 `dependencies`，同名版本不一致即 `DEPENDENCY_CONFLICT`；缺已接受兼容证据仍返回 `matched` 保留 `compatibility.status='unverified'` 与 `COMPATIBILITY_UNVERIFIED`；最终响应过 `validateComponentMatchResponse`，不过则抛 `INTERNAL_ERROR`。
  - 前端关键决策：只做 `GET`，`URLSearchParams` 构造查询串，无 body；本地先 `validateComponentMatchQuery`；409 → `conflict`、401/403 → `unauthorized`、其余非 2xx → `unavailable`；取消三处检查点；React 才渲染 `reactDomVersion` 输入，切回 Vue 清空该字段。
  - C 宿主最终复验（第 8 节）：`build:services` exit 0（`.tools/phase2-b-build-final.log`）；窄测 `112/112` 通过 0 跳过 exit 0（`.tools/phase2-b-narrow-final.log`）；平台 `36/36` 通过 0 跳过 exit 0（`.tools/phase2-b-platform-green.log`，真实 S3 缺失/超长/缺失叠加撤权回归均通过，`INFRA_UNAVAILABLE` 保持 503）；浏览器 `51/51` 通过 exit 0（`.tools/phase2-b-browser-final.log`）；根 tsc exit 0（`.tools/phase2-b-tsc-final.log`）。
  - 未覆盖：`--latest`/`--registry` 候选发现选项不在 P1；探针式大规模性能测量未做；真实冻结 SDK bundle 的 14 实现逐项 GET 验收属 P4(C)；`packages/contracts/dist` 有沙箱构建残留；版本升级与 CHANGELOG 由 C 收口。
  - 提交建议：后端一个提交（`feat: 实现组件标识精确查询 GET 接口与权威目录校验`），Gallery 一个提交（`feat: 新增组件精确查询表单与查询客户端`）。B 未执行任何 git 写操作。
- 结论与状态：完成（P1 最终由 C 宿主收口：112/112、36/36、51/51、根 tsc 0）。被 `phase2-query-completion-2026-11-16.md` 收口引用（B 提交 `b96db90e`、`160de0ef`）。P4 的 14 实现及真实 Gallery 联调尚待集成验证；生产 OIDC/G2/真实业务试点独立记账。
- 交叉引用：`c-phase2-query-contracts-2026-11-16.md`、`c-phase2-query-integration-2026-11-16.md`、`d-phase2-query-consumer-2026-11-16.md`、`phase2-query-completion-2026-11-16.md`、`a-phase2-query-sdk-2026-11-16.md`、`docs/phases/phase2/component-query-api.md`。
- 过时或矛盾点：第 0 节「B 未能在宿主实跑任何验证命令」与第 0-A 节「5 项发现已补失败测试但实现未改」均为历史过程记录，已被 0-A.5/0-A.6 与第 8 节的宿主实跑证据覆盖；引用现状应读 0-A.3、0-A.5、0-A.6 与第 8 节。

---

### b-t13-match-ui-2026-11-16.md

- 日期／角色／主题：2026-11-16（Asia/Shanghai）／B／`/match` 端到端交互验证（T13）。
- 目的：验证 `/match` 挂载设计 ID 配置后的完整交互行为。
- 承重事实：
  - 分支 `feat/t13-b-match-ui`，基线 `b13cc2d7`；只补充本轮验证，不改写历史记录。
  - `/match` 已挂载设计 ID 配置、元素清单、可选绑定输入、装配方案展示，并保留人工文本检索。
  - 验证范围（22 项）：登录门与未登录不暴露配置；空配置显示尚未配置不称匹配成功；规则 JSON 语法/未知字段/重复映射/重复实例本地拒绝不发请求；未知 designId 交服务端报缺口；只有显式点击才 POST，请求体只含冻结契约字段，Bearer 取当前会话；绑定 JSON 合法随请求发送，非法或引用不存在实例本地拒绝；同一 designId 多实例独立成行；mapped 元素展示真实目标/证据/兼容状态/依赖；`inputDigest` 一致展示方案、不一致忽略旧响应；空设计响应带 `EMPTY_DESIGN` 缺口；401/403/5xx/非法响应只显示固定文案；编辑规则/元素/上下文/绑定取消在途请求并清理结果；React DOM 精确版本随装配请求发送；退出登录与换 token/storage 事件取消并清理；designId 仅按文本转义呈现；窄屏 375px 不横向溢出；界面不使用模型/OCR/视觉匹配表述，不持久化设计配置。
  - 命令：`--filter @company/contracts build` 通过；`--filter @company/charts-core --filter @company/charts-vue --filter @company/charts-react build` 通过；`--filter @company/gallery build` 通过（Next `16.4.6`）；`--filter @company/example-vue --filter @company/example-react build` 通过；`exec playwright install chromium` 通过；`exec vitest run tests/gallery/match-plan-client.test.ts tests/gallery/candidate-results.test.ts tests/gallery/design-id-input.test.ts tests/gallery/search-client.test.ts` 4 文件 `89/89` 通过；`exec playwright test --config tests/playwright.config.ts tests/browser/phase2-design-match.spec.ts` `34/34` 通过，9.7s。
  - 原架构 SHA-256 未变。
- 结论与状态：完成。真实 API 联调沿用 `phase2-id-integration-2026-11-16.md` 历史结果，本轮未重跑真实隔离 Nest API；真实 30+ 标注集仍未提供，T13/T14 总体验收保持开放。
- 交叉引用：`b-phase2-design-id-match-2026-11-15.md`、`phase2-id-integration-2026-11-16.md`、`c-t13-matching-baseline-2026-11-16.md`、`a-t13-id-eval-2026-11-16.md`、`d-t13-eval-gaps-2026-11-16.md`、`b3-search-page-2026-11-15.md`。
- 过时或矛盾点：无。

---

### b3-search-page-2026-11-15.md

- 日期／角色／主题：2026-11-15／B／文本检索接入实现与验证交接（B3）。
- 目的：在画廊接入文本检索客户端与 `/match` 检索交互。
- 承重事实：
  - Worktree/分支 `feat/b-phase2-matching`。
  - 契约基线 `f7a81712`（`feat: 同步 C 冻结的文本检索请求契约`；C 原提交 `95ec3726`，六文件逐 blob 相等）。
  - 性质：B3 GREEN 实现（仅 `search-client.ts` + `/match/page.tsx` + 本记录）；未做 Git 操作。
  - 未改：契约、根配置（含 C 的 `vitest.config.ts`/`tsconfig.json`）、锁、版本、auth、CSS、既有测试。
  - `search-client.ts`：`POST {apiUrl}/v1/search/candidates`，`authorization: Bearer <token>`、`content-type`/`accept: application/json`；请求体先经 `validateSearchCandidatesRequest` 校验，非法输入**本地即拒**不发请求；`reactDomVersion` 仅在提供且非空白时发送且为精确版本，不能由 React 版本推断；响应经 `validateSearchCandidatesResponse` 解析；取消语义传入 `signal` 时以 `AbortError` 原样上抛，**绝不**降级为业务结果；错误固定文案 `INVALID_INPUT`/`UNAUTHORIZED`/`NETWORK`/`INVALID_RESPONSE`，不回显服务端原文或 token；无任何 `localStorage`/`sessionStorage` 写入。
  - `/match/page.tsx`（保留 B1 全部行为）：新增 `#search-query-input`、`#react-dom-version-input`、`#search-submit`；B1 的 `#context-submit` 与本地校验行为原样保留；**只有显式点击「搜索候选」才 POST**；`requirements` 存在未添加草稿时拒绝检索提交，提示「请先添加当前需求」并**保留草稿**；上下文未通过本地校验时拒绝检索；结果态 `#search-loading`/`#search-empty`（「暂无候选」）/`#search-error`/命中后挂载 B2 `CandidateResults`；「请求代次 + `AbortController`」双重守卫取消并忽略旧响应；卸载清理代次 +1 并 abort；退出登录重置全部项目字段/需求草稿/列表/检索输入与结果态；页面顶部提示改为「文本检索仅覆盖已发布元数据，不提供用途/视觉评分；结果不构成兼容性证明」。
  - 测试覆盖：`tests/gallery/search-client.test.ts`（15 例）、`tests/browser/phase2-search.spec.ts`（18 例）。
  - 取消语义与身份变化修订（3.1，宿主复跑回归）：宿主首次复跑 48 项中 47 通过 1 失败（`search-client.test.ts` 取消用例延迟 fetch 仍返回结果，`outcome.aborted === false`）；根因是原实现只在 fetch 自身 reject 时才识别取消；修订新增 `throwIfAborted` 三处检查点（发起请求前、`await fetch` 之后、`await json` 之后）；响应 schema 错误统一固定 `INVALID_RESPONSE` 文案；`clearOutcome` 补齐取消语义；新增 `storage` 事件 + `focus` 复核监听；单测新增 3 例、浏览器新增 5 例。
  - 测试类型与会话复核加固（3.2，根 tsc 回归）：`release?.()`/`releaseJson?.()` 被 TS 推断为 `never`，改为初始空函数声明（`let release: () => void = () => {};`、`let releaseJson: () => void = () => {};`）；会话复核加固为 **token 与 subject 双重比对**，提交前直接复核当前会话，响应及异常落地前通过 `isSessionStillCurrent()` 再次复核，请求发起时锁定身份快照 `searchIdentity`。
  - 失效会话统一清理（3.3，宿主浏览器回归）：宿主浏览器 26 项中 24 通过 2 失败——① 另一标签页 `other` 尚未导航到同源，`localStorage` 抛 `SecurityError`（改为先 `other.goto(MATCH_URL)` 再 `evaluate`，不用 `addInitScript` 以免覆盖期望写入的身份）；② 同页改写会话且未触发 focus 用例响应处 `isSessionStillCurrent()` 为 false 时仅 `return` 未清理，`#search-loading` 仍为 1。修订：提取 `invalidateSession()` 在三处统一调用（提交前/响应落地/错误落地），`storage`/`focus` 复核改复用 `invalidateSession()`；新增 2 例浏览器 RED（同页改写 token 后再点击不发请求回退登录门；同 subject 换 token focus 复核清理结果与字段）。
  - 最终范围：客户端单测 15 例、B3 浏览器 18 例。
  - 版本：B3 为对外可见功能，Gallery `0.0.6` → `0.0.7`，升版由 C 在验收通过后独立执行（`chore: 升级版本号至 0.0.7` + `CHANGELOG.md`），不混入本实现提交。
  - 未覆盖：检索服务端（eligibility、PG 索引/outbox、权限复读）由 C3 负责；未做真实并发/竞态压力测试；未做 `AbortController` 在不支持环境的降级；未覆盖 `NEXT_PUBLIC_PLATFORM_API_URL` 多环境切换（默认 `http://127.0.0.1:3000`）；检索结果可访问性细节（焦点管理、live region announcing）仅用 `role` 标注，未做完整 a11y 审计。
- 结论与状态：完成。宿主验收见 `c-b3-search-acceptance-2026-11-15.md`（51 项单元、28/28 浏览器、845 项 Vitest 全通过，Gallery 0.0.7）；真实联调见 `c3-live-gallery-2026-11-15.md`。
- 交叉引用：`c-b3-search-acceptance-2026-11-15.md`、`c3-live-gallery-2026-11-15.md`、`a-review-b3-search-2026-11-15.md`、`a-review-b3-recheck-2026-11-15.md`、`b-phase2-candidate-results-2026-11-15.md`、`b-phase2-context-implementation-2026-11-15.md`。
- 过时或矛盾点：无。

---

### c-b-phase2-context-acceptance-2026-11-15.md

- 日期／角色／主题：2026-11-15／C / Codex（宿主验收）／B1 项目上下文表单 Windows 宿主验收。
- 目的：在 Windows 固定工具链上验收 B 交付的 `/match` 表单。
- 承重事实：
  - 分支 `feat/b-phase2-matching`，业务基线 `35dcc2e1`；B 由 Claude 桌面端交付页面与纯转换，C 运行固定 Windows 工具链、补回归测试与手机导航样式，A 在独立工作区只读审查。无 merge、push 或发布。
  - 交付与边界：`/match` 继承控制台 noindex 并由控制台导航进入；初始框架/版本/包管理器为空；需求可增删；未添加的非空草稿阻止校验并保留输入；所有编辑清除旧结果和旧提示；退出清除项目状态，换身份不保留旧需求；不发送匹配请求、不写项目需求到 `localStorage`/`sessionStorage`；登录仍调用原有 auth 会话存储；页面明确匹配服务尚未接入；未改服务端、公共契约、依赖或锁文件。
  - RED 与修订 3 步：① 初始纯函数测试缺实现模块失败；初始浏览器实测页面 404，1 失败/1 中断/4 未运行；原 noindex 用例被 404 自带 noindex 误判通过，随后每个原用例增加 HTTP 200 断言；② 首版通过 27 项表单/契约单测与构建，C 新增草稿编辑与退出换身份测试后实跑 9 项浏览器 7 通过 2 失败；③ Claude 修复后两项回归转绿，C 扩展网络/存储检查、字段错误关联与 1280/360 视口截图；手机全局导航改为允许整组换行，避免汉字挤压折行。
  - 实际命令与结果：`exec vitest run tests/gallery/phase2-context.test.ts tests/contracts/project-context.test.ts tests/unit/web-upload-workflow.test.ts` exit 0，3 文件 53 测试通过（表单 9、ProjectContext 18、上传工作流 26）；`--filter @company/gallery build` exit 0（Next 编译及生成页面成功，包含 `/match`）；`--filter @company/gallery typecheck` exit 0（直接执行 tsc，非 Turbo 缓存结论）；`build:services` exit 0（5 任务成功，其中 3 缓存）；根 `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`exec playwright test tests/browser/phase2-context.spec.ts tests/browser/gallery-rendering.spec.ts tests/browser/manual-release.spec.ts --config tests/playwright.config.ts --workers=2` exit 0，25 测试通过（上下文 10、画廊 6、手动发布 9）；`verify:workspace` exit 0（10 成员、无环、4 公开包及服务依赖边界通过）。
  - 截图保存于忽略目录 `test-results/phase2-context-二期-match-项目上下文本地表单-桌面与手机入口和字段错误可读，页面不横向溢出/context-{1280,360}.png`，C 已逐张查看。
  - A 独立审查提交 `5a81a43b`，无阻断项。
  - 审计文档口径补充：原审计中「OIDC 未接入 / T05 未完成」应限定为画廊登录流程与公司真实 OIDC 验收；仓库现有 API 已有 Bearer/OIDC 服务端校验实现；早期「唯一新增文件」和 RED 状态只反映对应审计时点。
  - 版本由 C 单独收口为 Gallery `0.0.6` 并更新 CHANGELOG；根平台、SDK、CLI 和服务版本不随此页面功能变化。
- 结论与状态：完成。未重跑全部 SDK 浏览器、真实网页三存储 E2E、全量平台测试或真实 OIDC/生产域名验收；已有上传浏览器测试部分使用模拟服务，不能替代真实发布链路；T13/T14、多模态检索、30 真实标注样本、真实候选与装配仍未完成。
- 交叉引用：`b-phase2-context-implementation-2026-11-15.md`、`b-phase2-context-implementation-revision-2026-11-15.md`、`a-review-b-context-2026-11-15.md`、`c-phase2-project-context-2026-11-15.md`。
- 过时或矛盾点：无。

---

### c-b2-candidates-acceptance-2026-11-15.md

- 日期／角色／主题：2026-11-15／C（宿主验收）／B2 候选展示宿主验收。
- 目的：在 Windows 固定工具链上验收 B 的候选展示组件。
- 承重事实：
  - 契约交接 `dcb4d52e`（C 原提交 `e0a7f5ee`，12 文件 blob 一致）。
  - TDD 与工程修订 4 步：① B 先交 23 项测试没有实现文件，首次运行根目录无法解析 React，是测试环境失败不能计为功能 RED；② C 将运行时 React 从 gallery 的 package.json 依赖边界解析，并修正 HTML 转义断言（普通转义文本仍允许含 `onerror` 字符，必须拒绝真实标签而非普通字符串），再次运行因缺失 `candidate-results.js` 失败确认功能 RED；③ Next 的 `jsx: preserve` 导致初次 TSX 渲染测试无法执行，C 在根 Vitest 增加 `oxc.jsx.runtime: automatic`，根 `tsconfig.json` 加 `jsx: react-jsx`，未修改 Next 配置或新增依赖；④ 原 23 项通过，C 新增框架标签回归出现 23 通过 1 失败，Claude 将标签改为 `Vue`/`React` 后 24 项通过。
  - 实际命令与结果：`exec vitest run tests/gallery/candidate-results.test.ts tests/gallery/phase2-context.test.ts tests/contracts/search.test.ts` 3 文件 60 项通过（24 + 9 + 27）；`--filter @company/gallery typecheck` 与根 `tsc -p tsconfig.json --noEmit` exit 0；`exec turbo run build --force` 10/10 成功 0 缓存命中；`exec turbo run typecheck --force` 14/14 成功 0 缓存；串行 `.\scripts\pnpm.ps1 test` 50 文件、818 项 Vitest 通过，node:test 166 项中 159 通过、7 跳过、0 失败，完整命令 exit 0；`git diff --check` 通过；原架构 SHA256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
  - A 独立只读审查提交 `a102d711`（记录于 A 分支 `a-review-b2-candidates-2026-11-15.md`），无阻断项。
  - 验收边界：组件未接入 `/match`，无 HTTP 请求、浏览器存储或真实候选来源；只验证静态渲染和响应校验，不代表在线检索、视觉匹配或浏览器交互验收；未新增公开行为，本批不重复升级 Gallery `0.0.6`；T13/T14 真实检索、数据库索引、模型和真实评估集仍未完成；所有合成 fixture 不算真实资产或标注样本；未 merge、push 或发布。
- 结论与状态：完成。
- 交叉引用：`b-phase2-candidate-results-2026-11-15.md`、`a-review-b2-candidates-2026-11-15.md`、`c-phase2-candidate-contract-2026-11-15.md`、`c-b3-search-acceptance-2026-11-15.md`。
- 过时或矛盾点：无。

---

### c-b3-search-acceptance-2026-11-15.md

- 日期／角色／主题：2026-11-15／C（宿主验收）／B3 文本检索页面独立验收。
- 目的：在 Windows 固定工具链上验收 B 的文本检索接入。
- 承重事实：
  - 请求契约来自 C `95ec3726`，B `f7a81712` 六文件逐 blob 一致。
  - 实际失败与修复：首轮相关单元 48 项中 47 通过 1 失败（被取消的延迟 fetch 仍返回结果）；根 tsc 揭示测试闭包赋值函数被推断为 `never`；首轮 B1+B3 浏览器 26 项中 24 通过 2 失败（新标签页未同源导航导致 `localStorage` `SecurityError`；同页身份变化晚响应留下 loading）；最终 `test:browser tests/browser/phase2-context.spec.ts tests/browser/phase2-search.spec.ts` `28/28` 通过（B1 10、B3 18）；最终客户端 15、Candidate 24、请求契约 12 共 51 项通过。
  - C 将「只有显式点击搜索才 POST」改为 route 控制响应完成时机，先等待 POST 再断言 loading，释放后断言空态；`test:browser tests/browser/phase2-search.spec.ts --grep '只有显式点击搜索才 POST'` 1/1 通过 exit 0。
  - 构建与回归：`exec turbo run build --force` 10/10 成功 0 缓存；`exec turbo run typecheck --force` 14/14 成功 0 缓存；根 `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`.\scripts\pnpm.ps1 test` 52 文件、845 项 Vitest 全通过，node:test 159 通过、7 跳过、0 失败，整体 exit 0；`verify:workspace` 10 成员与依赖边界通过。
  - 独立审查与真实联调：Antigravity 初审 `bb86815d` 的三项问题均已修复，最终只读复查 `9045bec4` 无阻断项；重复 reset 的低优先级意见暂不扩展重构；C `426f9c16` 新增 `tests/platform/search-gallery.test.ts`，在显式 `PHASE2_GALLERY_ORIGIN` 下 1/1 通过。
  - 边界：服务输入为合成协议 fixture；未覆盖完整可访问性审计与多环境切换；仅发布元数据文本检索，无设计稿解析、多模态、用途/视觉评分或需求语义评估；无真实 30+ 标注集，T13/T14 不标记完整完成；Gallery `0.0.6`→`0.0.7` 与 CHANGELOG 单独提交；未合并、推送或发布，不改原始架构文件。
- 结论与状态：完成。B3 最终口径以本篇与 `a-review-b3-recheck-2026-11-15.md` 为准。
- 交叉引用：`b3-search-page-2026-11-15.md`、`a-review-b3-search-2026-11-15.md`、`a-review-b3-recheck-2026-11-15.md`、`c3-live-gallery-2026-11-15.md`、`c3-search-request-2026-11-15.md`、`c3-text-search-2026-11-15.md`。
- 过时或矛盾点：无。

---

### c-phase2-candidate-contract-2026-11-15.md

- 日期／角色／主题：2026-11-15／C／候选公共契约验证（C2）。
- 目的：定义并验收二期候选响应及证据评分校验契约。
- 承重事实：
  - 执行计划：`docs/plans/2026-11-15-phase2-candidates.md`。
  - RED：`exec vitest run tests/contracts/search.test.ts` 27 项失败（新校验器和 schema 尚不存在）。
  - GREEN：`--filter @company/contracts schemas:generate` 通过；`exec node packages/component-cli/scripts/sync-contracts.mjs` 同步通过；`exec vitest run tests/contracts` 10 文件、198 项通过（含 27 项新测试和生成 schema 精确一致性）。
  - `exec turbo run build --force` 10/10 成功、0 缓存命中；根 `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`verify:workspace` 10 成员、无循环、公开包及服务端依赖边界通过。
  - 契约语义：候选必须同时提供 API 和文档证据；截图来源、兼容证据和评分各自独立；JSON Schema 描述形状，跨字段约束由运行时校验器执行；形状通过不证明证据真实或兼容记录被服务器接受；私有未接入契约不触发公开功能升版。
  - 本记录仅验收公共契约，不代表 T13 检索服务或 T14 评估完成；无 HTTP/PG 检索、外部模型和真实标注集验证。
- 结论与状态：完成。后续过滤与 A/B 验证另行记录（`c-phase2-eligibility-2026-11-15.md`、`b-phase2-candidate-results-2026-11-15.md`），不覆盖历史记录。
- 交叉引用：`c-phase2-eligibility-2026-11-15.md`、`a-review-c2-search-2026-11-15.md`、`a-review-b2-candidates-2026-11-15.md`、`c-b2-candidates-acceptance-2026-11-15.md`。
- 过时或矛盾点：无。

---

### c-phase2-eligibility-2026-11-15.md

- 日期／角色／主题：2026-11-15／C／当前资格过滤与三方交接验证（C2）。
- 目的：实现 `filterEligibleCandidates` 并在宿主验证。
- 承重事实：
  - 公共契约提交 `e0a7f5ee`；B 原样接入 `dcb4d52e`，12 个文件逐 blob 核对一致。
  - `filterEligibleCandidates` 接收内部索引命中及当前快照读取接口，先过滤并在返回前复读权限、Ready/废弃、包和作业状态、内容与索引 revision、当前 provider、框架与精确 peer；没有宿主 ReactDOM 事实时拒绝需要它的候选，范围 peer 不做猜测；索引仅提供命中与评分，候选身份和证据由当前快照提供。
  - 兼容状态只由服务器接受记录与发布 ID、包名、版本、摘要、框架/引擎精确组合匹配产生；截图来源不提升兼容可信度；缺用途/视觉评分不补零；重复命中去重；过滤诊断不暴露被拒绝的发布 ID；读取异常不返回部分成功；输出复制为独立快照。
  - 尚未接路由的内部模块，无数据库/网络/组件执行/截图浏览器依赖；读取适配器必须绑定已认证 subject，并提供真实当前元数据与接受记录；双轮读取不保证跨候选事务一致性，后续 PG 接入需实现该策略；本批不升级 API 版本；T13/T14 均未完成。
  - RED：`exec vitest run tests/integration/search-eligibility.test.ts` 退出 1（新 `dist/search/eligibility.js` 尚不存在）；GREEN：`build:services` 后同命令 32 项通过；测试导入真实 Nest 编译 `dist`，快照源为显式注入的合成数据，不冒充 HTTP/PG 集成。
  - `exec turbo run typecheck --force` 14/14 任务成功 0 缓存；根 `tsc -p tsconfig.json --noEmit` exit 0。
  - 首次根 `test`：816 通过、1 个 Vue 外部消费者失败（日志显示无法加载 Vue 包导出；当时另一个类型检查进程也重建 SDK，存在产物竞争，不能将此运行计为通过）；待所有重建结束后串行重跑 `test`：49 文件、817 项 Vitest 全通过；node:test 166 项中 159 通过、7 跳过、0 失败，完整命令 exit 0。
  - `verify:workspace` 10 成员、无循环与服务边界通过；原架构 SHA256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723` 未改动。
  - A 在 `15511ec9` 提交独立审查（`a-review-c2-search-2026-11-15.md`），无阻断项；C 独立复跑 A 修订后 12 项评分测试通过，门槛补齐与稀疏数组修复为 `2bea0082`；30 真实样本仍缺失。
  - 为了让 B 的静态组件测试进入根类型检查，C 维护根 `tsconfig.json` 增加 `jsx: react-jsx`；B 的 Vitest 另显式执行 JSX 转换，保留 Next 的 `jsx: preserve`；测试从 gallery 声明的依赖加载 React，未增加根 React 依赖或修改锁文件。
- 结论与状态：完成。全图构建 10/10 与 198 契约测试证据见 `c-phase2-candidate-contract-2026-11-15.md`。
- 交叉引用：`c-phase2-candidate-contract-2026-11-15.md`、`a-review-c2-search-2026-11-15.md`、`a2-scoring-fix-2026-11-15.md`、`b-phase2-candidate-results-2026-11-15.md`。
- 过时或矛盾点：无。

---

### c-phase2-project-context-2026-11-15.md

- 日期／角色／主题：2026-11-15／C／二期 ProjectContext 首批验证（T13 契约）。
- 目的：实现 ProjectContext 类型、运行时校验与独立 JSON Schema。
- 承重事实：
  - 工作区 `c-phase2-search`，分支 `feat/c-phase2-search`，基准 `fa24ab525e5945e7096ed816a83f11962ba5f000`。
  - 实现 T13 的首批 `ProjectContext` 类型、运行时校验及独立 JSON Schema，导出 `validateProjectContext` 并注册 `project-context-v1`。字段沿用实施计划；版本沿用已有 `exactVersion` 校验策略。未知字段、可变/不完整版本、空白需求、非 JSON 输入失败关闭，错误沿用 JSON Pointer。
  - CLI 使用固定文件清单内联 contracts；补齐 `project-context.ts` 清单和生成镜像，防止新增根导出导致 CLI 构建失败。未新增 CLI 命令、HTTP API、页面或兼容性判断。contracts 为 private `0.0.0`，本批无对外实质功能发布，不升级公开包/平台版本。
  - RED：新增 `tests/contracts/project-context.test.ts`，18 项因缺少 `validateProjectContext` 导出及 schema 注册如预期失败；GREEN：最小实现复用 `schema.ts`，同一文件 18 项通过。
  - 首次根 build --force 失败：根脚本自带 `--cache`，Turbo 拒绝两者同时使用；强制验收改直接调用 Turbo，根脚本不改。首次直接强制全图 build 失败：CLI 已复制 index/schemas，但固定清单缺少新增模块；补齐同步脚本后完整强制构建通过。首次根 tsc 参数传递因 PowerShell 包装脚本参数绑定失败，未计通过；显式 `-PnpmArgs` 数组重跑通过。
  - 实际验证（Windows worktree，`.tools` 固定 Node `26.13.0` / pnpm `12.18.0`）：`--filter @company/contracts schemas:generate` exit 0；`exec vitest run tests/contracts/project-context.test.ts` exit 0（18 项通过）；`verify:workspace` exit 0（10 成员、公开包和服务依赖边界通过）；`exec vitest run tests/contracts` exit 0（9 文件 / 171 项通过，含所有注册 schema 的磁盘内容一致性检查）；`exec turbo run build --force` exit 0（10 任务通过 / 0 缓存命中；含 CLI 随包 probe 材料检查及 Next 构建）；`build:services` exit 0；`exec turbo run typecheck --force` exit 0（14 任务通过 / 0 缓存命中）；`-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`test` exit 0（T10 node:test 159 通过 / 7 跳过 / 0 失败；Vitest 47 文件 / 758 项通过）；`git diff --check` exit 0；`Get-FileHash component-platform-architecture.md -Algorithm SHA256` = `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与基准一致。
  - 未覆盖边界：未新增浏览器可见行为，未运行新表单浏览器验收或完整 `test:browser`；根测试的隔离设施验证不等于公司 OIDC、生产预览独立域、真实业务试点或多模态匹配验收；尚未提供 `Candidate`/`MatchPlan`、索引/outbox、权限重检、peer 硬过滤、设计稿解析或真实评估集。本批不标 T13/T14 完成；ProjectContext 校验成功仅证明形状，不构成兼容性证据。
  - B 在正式交付前仍只读审计；后续由 C 原样提供契约并记录来源，不让 B 自定义公共 DTO。未 merge、push 或发布。
  - A/Antigravity 非作者审查提交 `f172dbac`，无阻断项。
- 结论与状态：完成。被 `a-review-project-context-2026-11-15.md` 审查、`a-phase2-context-alignment-2026-11-15.md` 对齐、`b-phase2-matching-2026-11-15.md`/`b-phase2-context-implementation-2026-11-15.md` 消费，最终由 `phase2-main-merge-2026-11-15.md` 合入 main（`d4bb8791`）。
- 交叉引用：`a-review-project-context-2026-11-15.md`、`a-phase2-context-alignment-2026-11-15.md`、`b-phase2-matching-2026-11-15.md`、`c-phase2-candidate-contract-2026-11-15.md`、`c3-search-request-2026-11-15.md`、`phase2-main-merge-2026-11-15.md`。
- 过时或矛盾点：无。

---

### c-phase2-query-contracts-2026-11-16.md

- 日期／角色／主题：2026-11-16／C／二期组件 GET 契约冻结验证（P0）。
- 目的：定义 `ComponentMatchQueryV1`/`ComponentMatchResponseV1` 及两个公开运行时校验器。
- 承重事实：
  - 实现基线 `981ba7a529d5d75587d4d1b4606d22cd754401c5`；只覆盖收口计划 P0，不证明 GET 路由、真实 SDK 联调或二期整体验收完成。
  - 交付：新增 `ComponentMatchQueryV1`、`ComponentMatchResponseV1` 和两个公开运行时校验器；复用 `MatchTarget` 与 `ComponentApiV1`。
  - 查询只接收精确版本和原始大小写 ID；React 必须含 `reactDomVersion`，Vue 禁止该字段；未知/数组/对象字段失败关闭。
  - `matched` 要求 query、target、API 身份和样式/就绪方法一致，包含目标包与宿主精确依赖；`gap` 禁止暴露 target/API/依赖；兼容状态与证据、缺口保持一致。
  - 生成两个 JSON Schema，并同步 CLI 内联源码及浏览器模块白名单；Schema 仅保证结构，框架条件、结果状态、动态身份和依赖一致性必须额外运行校验器；未扩展通用 Schema 引擎。
  - 公共 fixtures 标为 synthetic，不代表真实设计样本或兼容性证据。
  - 命令（固定 Windows x64 Node `26.13.0`、pnpm `12.18.0`，均通过 `scripts/pnpm.ps1`）：`install --frozen-lockfile` exit 0；`--filter @company/contracts build` 后 `exec vitest run tests/contracts/component-match.test.ts` RED exit 1（36 项因缺少新导出/Schema 失败）；`--filter @company/contracts schemas:generate` exit 0；GREEN `exec vitest run tests/contracts/component-match.test.ts tests/contracts/api-schema.test.ts tests/contracts/match-plan.test.ts` 3 文件 83 项通过 exit 0；`exec turbo run build typecheck --force` exit 0（20/20 任务成功，0 缓存，含 CLI 同步和构建）；`-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`verify:workspace` exit 0（10 成员、无环、4 公开包、服务端依赖图安全）；`exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts` exit 0（Chromium 1/1）。
  - 原架构 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与保护值一致。
  - 后续边界：原始 URL 单次解码、重复参数、权限复查、跨包歧义属于 P1 的 HTTP/服务实现；真实冻结 14 实现、Gallery 联调和独立调用侧测试由 P2–P4 验收；P0 不新增 CLI 命令或改变其已有外部行为；最终 API/Gallery 等受影响包升版由 P5 统一执行。
- 结论与状态：完成。被 `b-phase2-query-implementation-2026-11-16.md`（P1）、`a-phase2-query-sdk-2026-11-16.md`（P2）、`d-phase2-query-consumer-2026-11-16.md`（P3）、`c-phase2-query-integration-2026-11-16.md`（P4）与 `phase2-query-completion-2026-11-16.md`（收口）承接。
- 交叉引用：`b-phase2-query-implementation-2026-11-16.md`、`c-phase2-query-integration-2026-11-16.md`、`d-phase2-query-consumer-2026-11-16.md`、`phase2-query-completion-2026-11-16.md`、`docs/phases/phase2/component-query-api.md`。
- 过时或矛盾点：无。

---

### c-phase2-query-integration-2026-11-16.md

- 日期／角色／主题：2026-11-16／C／二期 GET 真实服务集成记录（P4）。
- 目的：用冻结 SDK 与真实 Gallery 对 GET 查询做端到端验收。
- 承重事实：
  - P0 基线 `531173793fbbc23819874cbb7909dd7e8f789884`。
  - 冻结材料：复用已接受的 `current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3` bundle，通过 `A10_FROZEN_BUNDLE` 显式传入；manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`；未重新 pack，未修改旧包。
  - 逐包 tarball SHA-256：`@company/charts-core` `0.0.11` `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb`；`@company/charts-vue` `0.0.12` `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9`；`@company/charts-react` `0.0.12` `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28`。
  - C 逐项核对 199 个 manifest 文件的字节数和 SHA；A 修正后的矩阵测试在相同输入下实际 9/9 通过、0 跳过。A 提交 `b12f34ac`、`16741369` 已合入 C：`18c3f8ae`。
  - 独立专项入口：`tests/acceptance/phase2-query.config.ts` 只包含两个专项 spec，复用隔离真实 PG/MinIO/Verdaccio global setup；缺少 `A10_FROZEN_BUNDLE` 或 `PHASE2_GALLERY_ORIGIN` 时显式失败，不在默认根测试中加入环境前置。
  - SDK 专项：验证冻结清单，上传原始字节，发布到隔离存储，核对注册表包摘要，然后对 14 实现逐项 GET；预期来自 A 独立源码审计矩阵与冻结 API；两框架 line 再把返回发布 ID 转成合成 design ID 的 POST 装配输入。
  - Gallery 专项：已构建 Gallery，真实登录与 GET，通过本地 3000 透明代理转发到隔离 Nest；不伪造 API 响应；检查输入变化、撤权、退出后的材料清空和 375px 页面。
  - 实际 RED：`build:services` exit 0；首次 SDK 测试错误引用未公开的校验函数（该错误不算行为 RED）；设置 `A10_FROZEN_BUNDLE` 后 `exec vitest run --config tests/acceptance/phase2-query.config.ts tests/acceptance/component-query-sdk.spec.ts`——真实冻结包上传和发布 Ready 成功、注册表摘要核对成功，14 项全部因 P0 无 GET 路由得到 404 而失败，exit 1（`.tools/phase2-c-sdk-red.log`）；设置 `PHASE2_GALLERY_ORIGIN=http://127.0.0.1:5173` 运行 `component-query-gallery.spec.ts`——真实登录成功，缺少查询输入 `#cq-component-id`，1 项预期失败 exit 1（`.tools/phase2-c-gallery-red.log`）；根 `exec tsc -p tsconfig.json --noEmit` exit 0。
  - 集成 GREEN（2026-11-16）：C 已按 A→B→D 合并，提交为 `18c3f8ae`、`56628a35`、`547d4f46`；`build`/`build:services` exit 0；设置冻结输入与 `PHASE2_GALLERY_ORIGIN` 启动已构建 Gallery 后 `exec vitest run --config tests/acceptance/phase2-query.config.ts` 2 文件 15/15 通过、0 跳过 exit 0（`.tools/phase2-c-acceptance-green.log`，隔离服务 ID `0d2f3b6a-e5bd-407e-9031-34ec478b3b5d`）。
  - 14 个 SDK 查询包含逐项冻结字节/API/身份/依赖核对，Vue/React line 均继续完成 POST 身份一致性；GET 包含宿主 peers，POST 保持既有包与运行时依赖语义；校验完整 target 一致、POST 精确运行时依赖为 GET 依赖子集，且 GET 宿主版本独立断言。
  - 真实 Gallery HTTP 测试通过 Vue/React 事件及 DOM 依赖、输入修改清空、撤权后材料/依赖清空、恢复读取、375px 无横向溢出及退出登录；截图在 `test-results/phase2-query-acceptance/`，由本机浏览器生成；测试代理、浏览器和 C preview 会话已关闭。
  - 独立 D HTTP 5/5、文档示例 3/3、根 tsc 均通过；使用侧文档补全审查要求的动态规则。
  - 集成前独立审查补充：Codex 独立审查发现 GET 的材料读取错误分类尚未覆盖真实存储的 `UPLOAD_INCOMPLETE`（缺失对象，409）和 `LIMIT_EXCEEDED`（对象超过声明长度，413）；只读探针经真实 `ArtifactStore.read` 实现与 `readApi` 证实错误直接上抛；B 正补真实 HTTP 回归，随后只在 GET 读取路径规范化，保留共享 POST 语义。审查还要求补齐使用侧文档中的条件与动态一致性规则，并让 JSON 解析期间取消用例真正进入 `response.json()` 后再取消。
  - 边界：本地签名 JWT/JWK 仅为真实 HTTP 测试身份设施；没有完成公司 OIDC 接入、生产部署或真实业务试点；合成 design ID 不作为真实业务评分；SDK 专项不执行上传组件，不在服务端运行浏览器；冻结 SDK 原有消费者安装与截图证据继续引用原验收记录。
- 结论与状态：完成（GREEN）。最终全图、根测试与完整二期浏览器组见 `phase2-query-completion-2026-11-16.md`。
- 交叉引用：`c-phase2-query-contracts-2026-11-16.md`、`b-phase2-query-implementation-2026-11-16.md`、`d-phase2-query-consumer-2026-11-16.md`、`a-phase2-query-sdk-2026-11-16.md`、`phase2-query-completion-2026-11-16.md`、`docs/phases/phase2/component-query-api.md`、`docs/phases/phase2/component-query-sdk-matrix.md`。
- 过时或矛盾点：本篇开头「当前记录先保存实际 RED 和准备证据，最终 GREEN 另行追加」已被文末「集成 GREEN（2026-11-16）」小节覆盖，引用时应读 GREEN 节。

---

### c-review-a3-evaluation-2026-11-15.md

- 日期／角色／主题：2026-11-15／C（独立验收）／A3 文件评估入口。
- 目的：对 A 的评估 runner 做独立验收。
- 承重事实：
  - 审查提交 `bbb0bf7f` 与修订 `f092f240`；复用既有评分器，原始输入字节摘要、eval split、real/synthetic 隔离、独占写入与 0/2/1 退出语义均保留。
  - C 发现原始异常可回显非法输入或路径，交 A 新增 SECRET 回归后修复为固定错误分类（即 `a3-runner-error-redaction-2026-11-15.md`）。
  - 实际独立运行：`scripts/pnpm.ps1 exec vitest run tests/evaluation` 2 文件、18 项通过；`scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` 退出 0；`scripts/pnpm.ps1 verify:workspace` 10 成员、无循环、服务依赖边界通过。
  - 最初直接传 `exec tsc -p` 被 PowerShell wrapper 参数绑定拒绝，改用已约定 `PnpmArgs` 后通过；不将拒绝命令计为成功。
  - 结论：无阻断项。测试中的 real 标注为模拟测试数据，仓库没有 30+ 真实标注集及真实检索观察，不能据此宣称 T14 通过。
- 结论与状态：完成（A3 收口）。A3 的最终实现口径以 `a3-runner-error-redaction-2026-11-15.md` + 本篇为准。
- 交叉引用：`a3-evaluation-runner-2026-11-15.md`、`a3-runner-error-redaction-2026-11-15.md`、`docs/phases/phase2/evaluation-runner.md`、`d-t13-eval-gaps-2026-11-16.md`。
- 过时或矛盾点：无。

---

### c-t13-matching-baseline-2026-11-16.md

- 日期／角色／主题：2026-11-16（Asia/Shanghai）／C／T13/T14 匹配服务基线验证。
- 目的：确认 C 在 T13/T14 的工程层交付可在固定工具链下复现，并为 B 的 `/match` 接入提供稳定契约导出。
- 承重事实：
  - 分支 `feat/t13-c-matching`，基线 `b13cc2d7`（main，版本 `0.0.5`）。
  - C 在 T13/T14 阶段的工程层交付已在 main 上完成：`packages/contracts/src/{match-plan,design-id,component-api}.ts`、`apps/api/src/{matching,search,index}`、`apps/api/migrations/008_search.sql`。
  - 命令（`.tools` 固定 Node `26.13.0` / pnpm `12.18.0`，通过 `scripts/pnpm.ps1`）：`verify:workspace` 10 成员、无循环、4 公开包、服务端依赖边界安全；`--filter @company/contracts build` 通过；`--filter @company/charts-core --filter @company/charts-vue --filter @company/charts-react build` 通过；`--filter @company/platform-api typecheck` 通过；`exec vitest run tests/contracts/design-id.test.ts tests/contracts/match-plan.test.ts` 2 文件 55/55 通过（236ms）；`exec vitest run tests/integration/match-plan.test.ts tests/integration/search-eligibility.test.ts` 2 文件 56/56 通过（431ms）；`exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching.test.ts tests/platform/search.test.ts` 2 文件 9/9 通过（20.47s；真实隔离 PG/MinIO/Verdaccio/OIDC）。
  - 契约导出确认：`packages/contracts/src/index.ts` 已导出 `match-plan.js` 全部内容——类型 `MatchPlanRequest`、`MatchPlanV1`、`MatchElement`、`MatchTarget`、`MatchGap`、`MATCH_GAP_CODES`；验证器 `validateMatchPlanRequest`、`validateMatchPlan`；JSON Schema `match-plan-request-v1`、`match-plan-v1`（`CONTRACT_SCHEMAS`）。B 的 `match-plan-client.ts` 可直接使用这些导出，不需要自定义 HTTP 形状。
  - 原架构 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
- 结论与状态：完成。真实 30+ 标注集仍未提供，T13/T14 总体验收保持开放；公司 OIDC、独立预览域、真实业务试点不在本分支范围；本次未重跑全量根 `test` 与 `test:browser`，相关验证沿用 `phase2-id-integration-2026-11-16.md` 的历史结果，后续合并前由 C 统一补跑。
- 交叉引用：`phase2-id-integration-2026-11-16.md`、`b-phase2-design-id-match-2026-11-15.md`、`b-t13-match-ui-2026-11-16.md`、`a-t13-id-eval-2026-11-16.md`、`phase2-id-contracts-2026-11-15.md`。
- 过时或矛盾点：无。

---

### c3-live-gallery-2026-11-15.md

- 日期／角色／主题：2026-11-15／C（+B）／真实页面与检索服务联调。
- 目的：用真实隔离服务 + 真实构建画廊做浏览器联调。
- 承重事实：
  - B：固定工具链强制 build 10/10 成功，后续页面修订再次执行 Gallery build 成功。
  - B：`scripts/pnpm.ps1 exec playwright test --config tests/playwright.config.ts tests/browser/phase2-context.spec.ts tests/browser/phase2-search.spec.ts`，修订后 **28/28 通过**。该组使用显式 route fixtures，证明本地校验不发请求、显式搜索、编辑/退出/换身份取消、提交前及响应落地前会话复核和空态/错误展示；不冒充真实后端。
  - B：`scripts/pnpm.ps1 --filter @company/gallery preview`，监听本机 5173。
  - C：设置非敏感 `PHASE2_GALLERY_ORIGIN=http://127.0.0.1:5173`，执行 `scripts/pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/search-gallery.test.ts`，**1/1 通过**，8.74 秒。
  - 真实启动随机隔离 PostgreSQL/MinIO/Verdaccio，签名 JWT、上传合成双框架包、发布至 READY、消费索引后，用开发机 Chromium 打开 B 页面；3000 端口透明本地转发器仅转发至随机端口真实 API，保留 Origin/Authorization 和 API 原响应，未伪造候选；断言填写不发检索、点击后显示真实本轮包名的 Vue line 候选、响应包含元数据降级提示；随后禁用 alice，再次查询显示登录失效且候选清空。
  - 截图 `test-results/c3-live-gallery.png` 已人工查看：表单、单独搜索区、候选身份/证据/来源与缺口可见；截图为本地临时证据，不提交 test-results。预览进程和临时代理已关闭，隔离栈由 harness 清理。
  - 边界：全部组件输入为合成协议 fixture；本测试不证明真实 SDK 视觉表现或公司生产 OIDC；浏览器在开发机测试进程执行，API 运行时无 Playwright/组件代码依赖；默认 platform 命令跳过此需 B 预览服务的专项入口，本次显式设置环境后实跑通过；没有真实设计稿、多模态模型和真实标注集，T13/T14 保持未完整验收。
- 结论与状态：完成。同族真实联调在 `c-b3-search-acceptance-2026-11-15.md`、`phase2-id-integration-2026-11-16.md`（`matching-gallery.test.ts` 1/1，8.47s）、`c-phase2-query-integration-2026-11-16.md` 中继续。
- 交叉引用：`c-b3-search-acceptance-2026-11-15.md`、`b3-search-page-2026-11-15.md`、`c3-text-search-2026-11-15.md`、`phase2-id-integration-2026-11-16.md`。
- 过时或矛盾点：无。

---

### c3-search-request-2026-11-15.md

- 日期／角色／主题：2026-11-15／C／检索请求契约验证（C3）。
- 目的：冻结文本检索请求契约三字段。
- 承重事实：
  - RED：`scripts/pnpm.ps1 exec vitest run tests/contracts/search-request.test.ts`，12 项失败，缺失 `validateSearchCandidatesRequest`。
  - GREEN：schema 生成、CLI 镜像同步后 `scripts/pnpm.ps1 exec vitest run tests/contracts`，11 文件 210 项全部通过。
  - 冻结 `query`/`context`/`reactDomVersion` 三字段，复用 `ProjectContext` 与精确版本 schema；拒绝空白、超长查询、未知字段及版本范围。
  - 本记录仅证明请求形状边界，HTTP 鉴权、检索与浏览器行为另行验证。
- 结论与状态：完成。请求契约提交为 `95ec3726`，B 原样接入为 `f7a81712`（六文件逐 blob 相等），由 `b3-search-page-2026-11-15.md` 消费。
- 交叉引用：`c3-text-search-2026-11-15.md`、`b3-search-page-2026-11-15.md`、`c-b3-search-acceptance-2026-11-15.md`、`c-phase2-project-context-2026-11-15.md`。
- 过时或矛盾点：无。

---

### c3-text-search-2026-11-15.md

- 日期／角色／主题：2026-11-15／C／PostgreSQL 文本检索与鉴权 HTTP 验证（C3）。
- 目的：交付发布元数据索引、outbox 消费与鉴权候选接口。
- 承重事实：
  - 本批交付 `metadata-text-v1` 发布元数据索引、独立 outbox 消费/失败重试/指定作业重建、鉴权候选接口；不执行上传代码，不提供语义/用途/视觉评分，不宣称 T13/T14 完成。
  - RED：`exec vitest run --config tests/platform/vitest.config.ts tests/platform/search.test.ts` 首次因缺 `dist/index/search-indexer.js` 失败。
  - 首次服务构建发现空 `hostPeers` 对象的联合类型不能赋给 `Record<string,string>`；显式标注后构建通过。
  - 首轮真实平台测试中权限测试引用不存在的 `visibility` 列；按实际 `components.public` 修正，保留权限断言。
  - 追加失败索引原子回滚/恢复、精确 React DOM、旧摘要接受记录拒绝及最终批次撤权测试。
  - `exec vitest run --config tests/platform/vitest.config.ts tests/platform/search.test.ts tests/platform/database.test.ts`：2 文件 6 项通过；真实随机隔离 PostgreSQL、MinIO、Verdaccio、签名 JWT 和 HTTP，输入为明确的合成发布 fixture。
  - `test` 首轮：node:test 159 通过/7 跳过；Vitest 827 通过/2 失败，均因部署测试夹具遗漏新迁移；夹具改为统一 migration 清单，新增缺 search-runner 部署入口拒绝断言，确认 RED 后实现；相关 staging+eligibility 44 项通过。
  - 最终重跑 `test`：50 文件、829 项 Vitest 全通过；node:test 159 通过、7 跳过、0 失败。
  - `exec turbo run build --force` 10/10 任务、0 缓存成功；`exec turbo run typecheck --force` 14/14 任务、0 缓存成功；根 tsc 退出 0；`verify:workspace` 10 成员、无循环与服务依赖边界通过。
  - A 在 `627f9dd9` 提交只读审查（`a-review-c3-search-2026-11-15.md`），无阻断项。
  - 最终候选批次通过单条 SQL 共享当前快照，拒绝在检索与最终读取间提交的撤权；不能撤回最终读取之后已发送的响应；最多检查前 50 文本命中，达到上限时 `response.gaps` 明示可能不完整；没有大规模语料性能或生产公司 OIDC 验收。
  - `tests/platform/search-gallery.test.ts` 是独立的本机浏览器真实联调入口，仅在设置 `PHASE2_GALLERY_ORIGIN` 时执行；普通平台测试默认跳过，浏览器真实结果另行记录，不能把此跳过记为成功。
- 结论与状态：完成。检索契约由 `c3-search-request-2026-11-15.md` 冻结，Gallery 侧由 `b3-search-page-2026-11-15.md` 接入，联调见 `c3-live-gallery-2026-11-15.md`；最终根测试数字被 `phase2-main-merge-2026-11-15.md`（895 项）与后续 `phase2-id-integration-2026-11-16.md`（1041 项）、`phase2-query-completion-2026-11-16.md`（1249 项）覆盖。
- 交叉引用：`c3-search-request-2026-11-15.md`、`c3-live-gallery-2026-11-15.md`、`a-review-c3-search-2026-11-15.md`、`c-phase2-eligibility-2026-11-15.md`、`phase2-main-merge-2026-11-15.md`。
- 过时或矛盾点：无。

---

### d-id-runner-2026-11-16.md

- 日期／角色／主题：2026-11-16／D／确定性 ID Runner 补充验证。
- 目的：为 ID 评估新增 runner-id 函数、CLI、测试与观测样例。
- 承重事实：
  - 分支 `feat/t13-d-eval-pipeline`，基线 `e4c86581`；Claude Code 实际生成实现和测试，C 宿主落盘、修正并执行固定 Windows 工具链；Claude Code 工具调用两次发生解析失败后，使用同一客户端文本输出模式；未变更其模型或权限配置。
  - 范围：新增 runner-id 函数、CLI、专属测试和观测样例；`design-cases` 改成明确 synthetic 的 ID 标注数组；复用 A 的 id-matching 评分器，没有修改 `id-matching.ts` 或 `id-matching-*.test.ts`；旧评分工具保留；C 同步 README 入口；没有新增公共包或外部依赖，内部评估工具不触发包版本升级。
  - RED/GREEN 证据表（均通过 `.\scripts\pnpm.ps1`，Node `26.13.0` / pnpm `12.18.0`，日志在忽略的 `.tools/`）：
    - `exec vitest run tests/evaluation/runner-id.test.ts` RED：入口缺失导致失败（`d-id-runner-red-20261116.log`）。
    - 首次函数 GREEN：15 通过/1 失败，暴露缺失观测未拒绝；补校验后 16/16（`d-id-runner-green-attempt-20261116.log` / `d-id-runner-green-20261116.log`）。
    - `exec vitest run tests/evaluation/runner-id-cli.test.ts` RED：CLI 缺失，20/20 失败（`d-id-cli-red-20261116.log`）。
    - 首次完整 CLI GREEN：5 失败/31 通过，暴露 `--flag` 前缀解析错误；修正后 36/36（`d-id-cli-green-attempt-20261116.log` / `d-id-cli-green-20261116.log`）。
    - 既有报告保护 RED：1 失败/20 通过，原实现覆盖已有输出；改 `wx` 独占创建（`d-id-report-preservation-red-20261116.log`）。
    - `exec vitest run tests/evaluation` 最终 exit 0，5 文件/67 项，3.18s；含 A 评估器与历史 runner/scoring（`d-id-final-evaluation-20261116.log`）。
    - `exec tsc --noEmit` exit 0；`verify:workspace` exit 0（10 成员、4 公开包、无环与安全服务图）。
  - 独立审查确认输入/观测分离、字段白名单、real/synthetic 与空集边界、UTF-8 摘要、真实进程退出码与输入保护；审查发现的覆盖报告 P2 已修复并复核关闭，审查者独立运行最终两份 runner 测试 37/37 通过，无剩余代码阻断。
  - 实际样例执行：`.\scripts\pnpm.ps1 exec tsx tests/evaluation/runner-id-cli.ts --cases tests/evaluation/design-cases.json --observations tests/evaluation/runner-id-observations.example.json --output docs/phases/phase2/id-evaluation-report.example.json --mapping-version synthetic-example-v1 --runner-version id-runner-v1`；实际 exit 1（预期）：real=0 / N/A / false，synthetic=1 / 100% / true，硬违规 0，顶层 passed=false、productionAcceptance=false。
  - 报告摘要与输入文件字节一致：cases SHA-256 `1419d32f74a57a97dc3fa3a79f4c4561399c1491766a87d32b1e676f66549596`；observations SHA-256 `8c307dc7655bb51a29c8af2c29d4d9de3e2d1a77b9c6159feff2d89e56f9c719`。
  - 正式 ID 规范、设计平台导出和真实业务样本尚未提供，T13/T14 业务验收未完成；没有将改 origin 的单测或 synthetic 示例作为真实样本，也没有以模型接入作为阻塞。
- 结论与状态：完成。规范文档为 `docs/phases/phase2/id-evaluation-runner.md`，观测交接为 `docs/phases/phase2/id-observation-handoff-2026-11-16.md`，报告模板为 `docs/phases/phase2/id-evaluation-report.example.json`。
- 交叉引用：`a-phase2-id-evaluation-2026-11-15.md`、`a-t13-id-eval-2026-11-16.md`、`d-t13-eval-gaps-2026-11-16.md`、`docs/phases/phase2/id-evaluation-runner.md`、`docs/phases/phase2/id-observation-handoff-2026-11-16.md`、`phase2-id-integration-2026-11-16.md`。
- 过时或矛盾点：无。

---

### d-phase2-query-consumer-2026-11-16.md

- 日期／角色／主题：2026-11-16／D（Claude Code CLI）／二期查询验收（P3，独立消费者侧）。
- 目的：以独立消费者视角写 HTTP 测试、可校验示例与使用说明。
- 承重事实：
  - Claude Code 会话 `ae4a896e-7cd3-4601-bacb-2e0987ea4b6e` 读取了仓库内 AGENTS.md、rules、P3 计划、spec、contracts 与既有测试设施。
  - 工具解析连续失败两次（exit 1）；随后在禁用工具、以 `--print` 续跑时，输出使用同一已配置模型；未调整模型设置。该输出生成了消费者测试、使用说明与示例校验候选，但输出多次出现截断或语法错误；**CLI 本身未编辑文件，也未运行测试。**
  - 宿主（C）修正了：React 事件名、无 token 调用、完整撤权、`__proto__` 直传、行类型，以及示例的导入与错字、文档末句截断。
  - 验证：宿主 `build:services` exit 0；宿主运行 `tests/platform/component-query-consumer.test.ts` 5 项失败，均为预期 404（因未含 P1 路由）；实际使用隔离 PG/MinIO/Verdaccio/Nest 与本地签名 JWT，属正确 RED，不是设施未启动。
  - 本分支文件：`tests/platform/component-query-consumer.test.ts`、`tests/evaluation/component-query-examples.test.ts`、`docs/phases/phase2/component-query-api.md`、本记录。
  - 边界：合成数据，非真实业务样本；不代表 OIDC 外部接入或生产验收完成。
  - C 宿主补充（生成内容修正后）：`exec vitest run tests/evaluation/component-query-examples.test.ts` 3/3 通过 exit 0；独立工作树根 tsc 暂因 charts-core 与框架 dist 尚未构建而失败，新文件未报错；C 后续先构建 charts-core/vue/react 再执行根 tsc exit 0。
  - C 集成后 GREEN（2026-11-16）：B 的两个实现提交 `b96db90e` / `160de0ef` 与 D 提交 `66c59f4d` 已按计划合入 C（集成 HEAD `547d4f46`）；`build`、`build:services` exit 0；`exec vitest run --config tests/platform/vitest.config.ts tests/platform/component-query-consumer.test.ts` 5/5 真实 HTTP 通过，0 跳过（`.tools/phase2-c-consumer-green.log`）；`exec vitest run tests/evaluation/component-query-examples.test.ts` 3/3 通过（`.tools/phase2-c-examples-green.log`）；根 `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0。
  - 独立审查后，C 补齐使用侧等价运行时规则表，明确可选键、响应内部一致性与本次请求绑定、私有 contracts 包边界，以及权限/存储真实性无法仅由离线 Schema 证明；所有 GREEN 由 C 宿主执行；生产范围未改变。
- 结论与状态：完成。其交付（`docs/phases/phase2/component-query-api.md`）由 `phase2-query-completion-2026-11-16.md` 收口引用；最终 5/5 + 3/3 通过。
- 交叉引用：`b-phase2-query-implementation-2026-11-16.md`、`c-phase2-query-integration-2026-11-16.md`、`phase2-query-completion-2026-11-16.md`、`docs/phases/phase2/component-query-api.md`。
- 过时或矛盾点：本篇「HTTP GREEN 待 B 集成」与「5 项失败为 RED」状态已被文末「C 集成后 GREEN」小节覆盖。

---

### d-t13-eval-gaps-2026-11-16.md

- 日期／角色／主题：2026-11-16（Asia/Shanghai）／D／T13/T14 评估缺口与真实标注集状态。
- 目的：追踪二期业务验收边界与外部依赖缺口。
- 承重事实：
  - 分支 `feat/t13-d-eval-pipeline`，基线 `b13cc2d7`；追踪二期业务验收边界，不修改历史验证记录。
  - 评估集状态：真实标注集 **0 条** `origin: "real"` 样本；评估协议要求不少于 30 条真实样本，其中陷阱/无匹配/缺约束不少于 10 条。
  - 合成样本：`tests/evaluation/design-cases.json` 已提供 2 条明确标记 `origin: "synthetic"` 的格式示例（missing-constraint 趋势卡 + data-semantic-trap 饼图负值）。
  - 合成样本**不可计入** T14 真实标注集验收基数；`scoring.ts` 的 `real` 组门槛（`>=30 real`、`>=10 trap`、`hardViolations=0`、`top5>=0.8`、`gapRecall>=0.9`、`noMatchRejection>=0.9`）在真实样本为零时保持 `passed: false`。
  - 设计 ID 规则状态：真实设计 ID 命名/命名空间、规则维护方尚未确定；`design-id.ts` 只校验结构（两框架唯一映射、实例唯一、同设计多实例复用），不硬编码前缀或分隔符；设计导出连接器未实施；文本候选选择后由用户显式编辑规则 JSON，无自动回写。
  - 外部对接检查点表：真实 30+ 设计标注样本（未提供／业务方）；真实设计 ID 规则（未确定／业务方/设计团队）；设计导出格式与连接器（未提供／业务方）；公司 OIDC / PKCE / 撤权（未配置／身份团队）；独立预览域 wildcard DNS / TLS（未配置／运维/DNS 团队）；真实业务试点项目（未启动／业务方）。
  - 当前工程侧可复现命令：`exec vitest run tests/evaluation/runner.test.ts tests/evaluation/scoring.test.ts`；`exec tsc -p tsconfig.json --noEmit`；`verify:workspace`。
- 结论与状态：完成（状态追踪，长期开放）。与 `docs/phases/phase2/id-observation-handoff-2026-11-16.md` 的缺口表互为印证；`phase2-query-completion-2026-11-16.md` 确认二期按协议范围交付但不等待设计平台连接器或真实设计标注。
- 交叉引用：`a-phase2-scoring-2026-11-15.md`、`a2-scoring-fix-2026-11-15.md`、`a3-evaluation-runner-2026-11-15.md`、`d-id-runner-2026-11-16.md`、`phase2-id-contracts-2026-11-15.md`、`phase2-id-integration-2026-11-16.md`、`docs/phases/phase2/id-observation-handoff-2026-11-16.md`、`docs/phases/phase2/id-evaluation-runner.md`。
- 过时或矛盾点：无。

---

### phase2-id-contracts-2026-11-15.md

- 日期／角色／主题：2026-11-15／C／二期 ID 配置契约与范围调整验证。
- 目的：确认二期不接大模型、改设计 ID 规则匹配，并实现 Task 1 配置/输入契约。
- 承重事实：
  - 基线 `e5f7e7ef`，分支 `feat/phase2-id-mapping`；范围文档提交 `487d1ad9`。
  - 范围与决策：用户明确二期不接大模型，改用设计 ID 规则匹配；规则暂未确定。本次同步实施评估、T13/T14 计划、分工和 README；新增独立规格/执行计划。原架构与历史验证记录未改。无需模型 endpoint/key、视觉 30 样本或模型质量验收。
  - 实现 Task 1：显式映射配置、设计实例输入、运行时校验和 JSON Schema。`designId`/`framework` 必须唯一，实例 ID 必须唯一，不同实例可复用 designId；未知 ID 和空配置可通过结构校验，留给后续流程报告缺口；ID 原值精确比较，不设业务命名规范；配置不充当权限/Ready/兼容证据。
  - 命令（Node `26.13.0` / pnpm `12.18.0`）：`install --frozen-lockfile --offline` 通过（344 包从缓存安装，锁文件无修改）；`--filter @company/contracts build` 后 `exec vitest run tests/contracts/project-context.test.ts tests/contracts/search.test.ts` 基线 45/45 通过；`exec vitest run tests/contracts/design-id.test.ts`（实现前）RED 36/36 失败；`--filter @company/contracts schemas:generate` 通过（新增 mapping/input 两份 Schema）；`exec vitest run tests/contracts` GREEN 12 文件 246/246 通过；`exec turbo run build --force` 10/10；`exec turbo run typecheck --force` 14/14；`-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` 通过；`verify:workspace` 通过（10 成员、无环、4 公开包、服务依赖边界安全）；`test` 通过（node:test 159 通过/7 skip；Vitest 56 文件、931/931 通过）；`exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts` Chromium 1/1 通过；`git diff --check` 通过；contracts 与 CLI 内联 design-id/index/schemas SHA-256 三份副本一致。
  - 日志保存在本 worktree 的 `.tools/design-id-{red,build,types,test,browser}.log`，不入库；根 test 的 7 项跳过为未显式提供外部冻结 SDK 材料的既有边界，不计为通过。本轮未重跑完整浏览器套件或真实三存储专项。
  - 独立规格审查补清 `ruleSetId`/`revision` 字符串和未知 ID 非格式错误；独立代码审查无阻断，另运行 27 组只读边界断言（非 JSON、循环、getter 不触发、原型键、唯一性、100 错误上限及预算），全部通过。
  - 原架构 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与基线一致。
  - 未覆盖与后续：当前只交付配置/输入契约；HTTP 精确发布解析、`MatchPlan`/真实 API 映射、前端配置入口、旧响应失效、真实 ID 规则/设计导出对接与规模量测仍未完成；本轮不能宣称 T13/T14 验收通过；后续 Task 2 必须先冻结具体 HTTP/`MatchPlan`，不依赖文本 Top-50 或索引状态代替精确 ID 定位；内部契约和 CLI 内联同步没有新增公开命令/API/UI 行为，本次不单独升版；没有 push 或发布。
- 结论与状态：完成。被 `phase2-id-integration-2026-11-16.md`（Task 2/3 与集成）与 `c-t13-matching-baseline-2026-11-16.md`（55/55、56/56、9/9）覆盖推进。
- 交叉引用：`phase2-id-integration-2026-11-16.md`、`a-phase2-id-evaluation-2026-11-15.md`、`b-phase2-design-id-match-2026-11-15.md`、`c-t13-matching-baseline-2026-11-16.md`、`d-id-runner-2026-11-16.md`、`docs/phases/phase2/id-evaluation-runner.md`。
- 过时或矛盾点：无。

---

### phase2-id-integration-2026-11-16.md

- 日期／角色／主题：2026-11-15 至 2026-11-16（Asia/Shanghai）／综合（C 为主）／设计 ID 确定性匹配集成验证。
- 目的：把 A/B/D 的 ID 匹配交付集成到 C 分支并做全量验证。
- 承重事实：
  - C 工作区分支 `feat/phase2-id-mapping`，基线 `e5f7e7ef`；用户已确认本期不接大模型，真实设计 ID 规则尚未确定；本记录补充历史证据，不改写 A/B 或此前契约验证记录。
  - 交付与协作：C `487d1ad9` 调整范围、`f8639d4c` 输入契约、`01e95e16` 装配/组件 API 契约、`e6e9a639` 确定性 API 服务；A（Antigravity 桌面）独立工作区交付 `840fd5eb`、`4eee8872`，C 按指定文件集成并补强评估校验与组件约束说明，形成 `1e6b8c8e`；B（Claude 桌面端）交付配置、元素清单、绑定输入、HTTP 客户端和浏览器测试，C 集成后补齐 React DOM 传递、未添加草稿拦截、参数/事件/布局/样式/notes 展示及响应语义核对。
  - 两位独立审查者分别检查后端/contracts、A API 与评估器，并补查前端；阻断问题均已覆盖失败测试并修正；没有待处理的阻断审查项。
  - 后端最初 22 项失败、HTTP 缺路由返回 404；C 在复制 A 实现之前执行缺实现测试确认 RED；A 原工作区未实际执行测试，不能倒推为 A 自身完成了原始 TDD；B 也由 C 宿主先确认缺模块 RED 再集成实现；A/B 原始记录保留其实际限制。
  - 关键修正：请求规范化摘要绑定完整输入；最终资格批量复读后撤权清除材料和依赖；不支持的历史 API 返回显式缺口；未知 ID 不通过文本评分替代；依赖冲突不任意选版本；大响应以 `LIMIT_EXCEEDED`/413 拒绝而非裁剪；客户端不能将服务端自报的 `inputDigest` 当作内容签名，另行核对规则修订、上下文、实例集合、designId、指定目标及用户声明的绑定；编辑和会话变化取消在途结果。
  - 过程中的一次根测试与审查 RED 用例新增时间重叠，出现 13 失败/977 通过，不作为成功证据；一次浏览器测试把删除两元素之一误断言为零，修正为剩余 node-2 并限定删除按钮范围；根 tsc 的一次命令受 PowerShell `-p` 参数绑定影响未执行，改用显式 `-PnpmArgs` 数组后正常完成。
  - 实际验证（Node `26.13.0` / pnpm `12.18.0`，通过 `scripts/pnpm.ps1`，不使用 Turbo 缓存）：`exec turbo run build typecheck --force` 全图 20/20、0 缓存命中；`-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0；`test` Vitest 62 文件、1041/1041；Node 159 通过、7 跳过、0 失败；`exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching.test.ts tests/platform/search.test.ts` 最终 9/9（20.77s；真实隔离 PG/MinIO/Verdaccio/OIDC 测试设施）；`exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching-gallery.test.ts` 1/1（8.47s；设置 `PHASE2_GALLERY_ORIGIN` 并启动真实 Gallery preview）；`exec playwright test --config tests/playwright.config.ts tests/browser/phase2-design-match.spec.ts tests/browser/phase2-search.spec.ts tests/browser/contracts-runtime.spec.ts` 53/53（12.8s；包含 375px 布局、旧响应/身份变化、草稿和绑定展示）；`verify:workspace` 10 成员、无循环、4 公开包与服务端依赖边界通过。
  - 真实页面联调通过透明代理访问隔离 Nest API，不编造匹配响应；从已发布测试材料显示 `ChartData`、`sales`、`onPointClick`、`showDetail`、布局、`whenRendered` 和样式入口，撤权后无目标/依赖残留；截图保存在忽略目录 `test-results/phase2-id-live-gallery.png`，已目视检查；测试用包是协议合成包，不是实际业务设计资产。
  - 本地完整日志保存在忽略目录 `.tools/phase2-final-root.log`、`phase2-force-graph.log`、`phase2-final-browser.log`、`phase2-final-platform.log`、`phase2-live-gallery.log`；不提交依赖、构建产物、密钥和日志目录。
  - 实际 API 评估与规模量测：`tests/platform/matching.test.ts` 将真实 API 方案交给 `evaluateIdMatching`，而不是只评估手写成功响应；10 个 synthetic 案例包括 Vue、React、多实例、未知 ID、缺框架映射、错框架目标、错 peer、缺失/未知绑定、撤权和损坏材料；另有重复同目标与冲突目标 2 个输入返回 400。
    - synthetic：精确命中 5/5（100%），硬违规 0，缺口遗漏 0，`passed=true`。
    - real：0 案例，正确率 N/A，`passed=false`；总体 `passed=false`。评估器单测中的 `origin:'real'` 是分类逻辑 fixture，不能作为真实业务样本。
    - 逐例 ID 与汇总 JSON：`.tools/id-matching-evaluation.json`。总体字段按既有定义只表示 real 门槛，工程门槛须另外检查 `synthetic.passed`；本次两者明确分离。
  - 规模量测表（本机单次样本，JSON 位于 `.tools/id-matching-scale.json`，不是并发基准、p95 或生产 SLA）：200 条合成新增发布记录 → ID HTTP 响应 409ms、200/200 精确命中；文本索引总记录 203；文本 HTTP 响应（返回 Top-50）33ms。1000 条 → ID HTTP 1796ms、1000/1000；文本索引总记录 1003；文本 HTTP 25ms。种子发布记录分批加入真实 PG，复用同一作业冻结 API/docs，另有 3 条基础记录；不代表完成了 1000 次注册表真实发布。ID 批次引用同包不同版本，正确返回 `DEPENDENCY_CONFLICT` 并清空依赖；命中正确不等于可安装。
  - 执行判断与未覆盖边界：计划的 `apps/gallery/src` 修正为实际 `apps/gallery/app`，不改变功能范围；文本候选选择后由用户显式编辑规则 JSON，本轮没有自动回写候选 UI；不会隐式覆盖未知 ID；API、画廊、CLI 按各自版本升级，平台根本轮未新增独立运维行为，沿用既有 `0.0.5`；SDK 源码与版本不变；正式 ID 命名/命名空间、导出格式、规则维护方、真实业务样本均未提供；T14 真实业务验收保持开放，不再将模型或模型密钥列为阻塞；绑定 source/handler/layout 是用户声明，不执行、不证明业务类型正确，本期不包含三期的项目安装或代码写入；旧冻结材料不会自动迁移，需新版本材料才能使用新装配能力；生产部署、公司真实 OIDC 与真实项目验收不能用本机隔离服务测试替代；原架构 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
- 结论与状态：完成（ID 匹配集成终态之一）。后续查询 API 收口见 `phase2-query-completion-2026-11-16.md`；`b-t13-match-ui-2026-11-16.md`、`a-t13-id-eval-2026-11-16.md`、`c-t13-matching-baseline-2026-11-16.md`、`d-t13-eval-gaps-2026-11-16.md` 为其分支基线/边界补充。
- 交叉引用：`phase2-id-contracts-2026-11-15.md`、`a-phase2-id-evaluation-2026-11-15.md`、`b-phase2-design-id-match-2026-11-15.md`、`c-t13-matching-baseline-2026-11-16.md`、`b-t13-match-ui-2026-11-16.md`、`a-t13-id-eval-2026-11-16.md`、`d-t13-eval-gaps-2026-11-16.md`、`d-id-runner-2026-11-16.md`、`phase2-main-merge-2026-11-15.md`。
- 过时或矛盾点：无。

---

### phase2-main-merge-2026-11-15.md

- 日期／角色／主题：2026-11-15／综合（C）／二期三方主分支集成复验。
- 目的：把 A/B/C 三个二期分支合入 main 并做全量回归。
- 承重事实：
  - 用户明确授权本地合并并提交；未执行 push 或发布。
  - 合并结果：C 分支 `feat/c-phase2-search` → `main`：`d4bb8791`；A 分支 `feat/a-phase2-profiles` → `main`：`9cdc4eb8`；B 分支 `feat/b-phase2-matching` → `main`：最终集成提交 `cba7b022`。
  - B 合并产生 CHANGELOG、README、首批计划和 contracts README 四份文档冲突，已保留双方有效内容；业务源码与公共契约未做冲突改写。
  - `main` 当前包含 A/B/C 三个分支的所有提交；未修改 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、根 `package.json`、`turbo.json` 或原始架构文档。
  - 合并后强制构建 `scripts/pnpm.ps1 exec turbo run build --force`：10/10 成功。
  - 合并后强制类型检查 `scripts/pnpm.ps1 exec turbo run typecheck --force`：14/14 成功；根 `tsc --noEmit` 退出 0。
  - 首次全量测试因主工作区缺少项目固定 Playwright Chromium 启动文件而失败，9 项均为浏览器可执行文件缺失；未修改业务代码；补齐 `.tools/playwright` 的 Chromium 后重跑：55 文件、895 项通过，node:test 159 通过、7 跳过、0 失败。
  - `scripts/pnpm.ps1 verify:workspace`：10 成员、无循环依赖、服务依赖边界通过。
  - `scripts/pnpm.ps1 test:browser` 首轮：216 通过、3 失败、4 未运行；契约运行时测试的模块白名单遗漏新增 `project-context`、`search`，导致动态导入失败；补齐白名单后，契约与二期两份页面测试合计 29/29 通过（此为测试适配，不修改业务逻辑，不触发额外升版）。
  - 其余浏览器失败来自未指定 `ZHINEXUS_SDK_BUNDLE_DIR`；第一次补值误指向 current-sdk 父目录，明确报缺 manifest；随后采用历史已验收冻结批次 `.tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583`，未重 pack，真实网页三存储文件 6/6 通过；首轮未运行的 4 项包含在这次 6 项中；所有 223 个浏览器用例已通过首轮或修订后定向复验覆盖，但未声称整套单次 223/223。
  - `scripts/pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/search.test.ts tests/platform/database.test.ts`：隔离真实服务 6/6 通过。
  - 原始架构文档 SHA-256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
  - 边界：本次只完成本地合并与回归，不代表远程推送、发布或 T13/T14 总体验收完成；多模态检索、真实 30+ 标注集、生产 OIDC、真实消费者试点和生产独立预览域仍按计划保持未完成；三方 worktree 为桌面应用管理的现有协作工作区，本次保留供后续继续开发；临时浏览器预览服务已由测试清理，没有归档或删除工作区。
- 结论与状态：完成（二期第一批合入 main）。其后由 `phase2-id-integration-2026-11-16.md`（ID 匹配）与 `phase2-query-completion-2026-11-16.md`（查询 API）继续推进；main 最终快进到 `a89b3676`。
- 交叉引用：`c-phase2-project-context-2026-11-15.md`、`c-phase2-candidate-contract-2026-11-15.md`、`c3-text-search-2026-11-15.md`、`b-phase2-matching-2026-11-15.md`、`b-phase2-context-implementation-2026-11-15.md`、`a-phase2-profiles-2026-11-15.md`、`phase2-id-integration-2026-11-16.md`、`phase2-query-completion-2026-11-16.md`。
- 过时或矛盾点：本篇根测试 895 项 / 浏览器 223 个用例为 2026-11-15 时点，被后续 1041 项（ID 集成）、1249 项（查询收口）覆盖。

---

### phase2-query-completion-2026-11-16.md

- 日期／角色／主题：2026-11-16／综合（C 收口）／二期 GET 查询交付收口。
- 目的：收口 P0–P5 的组件精确查询交付并给出最终验证。
- 承重事实：
  - 已验收产品提交 `19c4289789613bbfacf0c7b7359530efdda4998e`；T13/T14 已按用户确认的二期协议范围完成：标识规范、GET 查询和使用侧验收交付，不等待设计平台连接器或真实设计标注；全部技术门槛已通过，成果已合入 main，五个本轮开发分支已安全删除。
  - 实际分工与提交：C/Codex 请求响应契约、Schema、运行时校验与 CLI 内联 `53117379`；A/Antigravity IDE 14 实现独立 API 矩阵、199 文件字节及摘要验证 `b12f34ac`、`16741369`；B/Claude 桌面端 GET 权威查询、材料校验、Gallery 入口及测试 `b96db90e`、`160de0ef`；D/Claude Code CLI 独立 HTTP、可校验示例及使用说明候选 `66c59f4d`；C/Codex 冻结 SDK、真实 Gallery 联调、补齐规范附加规则 `d05d3e93`；C/Codex 平台 `0.0.6`，API/Gallery `0.0.9` `19c42897`。
  - A→B→D 合入 C 的合并提交分别为 `18c3f8ae`、`56628a35`、`547d4f46`，无冲突。Claude 桌面端承担本轮主要产品开发；Windows 宿主测试与提交由 C 完成；Claude Code 出现工具解析与生成截断问题，以同一已配置客户端生成候选，再由 C 修正语法和测试设施并实测；不将宿主执行归为 CLI 自行执行。
  - 对外交付：`GET /v1/matching/components`——组件 ID、框架、精确包版本，以及宿主框架/ECharts/React DOM 精确版本；可选包名用于消歧；ID 区分大小写、按原值比较，不做 trim 或模糊推断；服务从权威目录读取当前资格与权限，不依赖搜索索引；读取材料后再次检查权限、禁用、废弃、revision 与新增歧义，不可用时清空 target、API 与依赖；静态材料缺失、超长、摘要或格式不符返回缺口，基础设施错误仍为 503；原 POST 装配语义保留，GET 发布 ID 可继续构造设计映射；`/match` 提供 Vue/React 查询入口，输入和身份变化时取消请求、清除旧结果；Ready、matched、兼容证据状态独立。文档：`docs/phases/phase2/component-query-api.md`（使用侧接口规范）、`docs/phases/phase2/component-query-sdk-matrix.md`（SDK 对照矩阵，覆盖 7 类 × 2 框架）。
  - 最终验证（Windows 本机 `scripts/pnpm.ps1`，固定 Node `26.13.0` / pnpm `12.18.0`；最终全图与综合回归对应 `19c42897`，P4 对应 `d05d3e93`）：
    - `exec turbo run build typecheck --force` 20/20、0 缓存、exit 0（`phase2-final-graph.log`）。
    - `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` exit 0（`phase2-final-tsc.log`）。
    - `verify:workspace` 10 成员、安全服务依赖图通过、exit 0（`phase2-final-workspace.log`）。
    - 设置 `A10_FROZEN_BUNDLE` 后 `test`：T10 168/168 + Vitest 75 文件 / 1249 测试通过，0 跳过，exit 0（`phase2-final-root-test.log`）。
    - `exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching.test.ts tests/platform/search.test.ts tests/platform/component-query.test.ts tests/platform/component-query-consumer.test.ts` 45/45、0 跳过、exit 0（`phase2-final-platform.log`）。
    - `exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts tests/browser/phase2-search.spec.ts tests/browser/phase2-design-match.spec.ts tests/browser/phase2-component-query.spec.ts` 70/70、exit 0（`phase2-final-browser.log`）。
    - 设置冻结输入及 `PHASE2_GALLERY_ORIGIN`、启动已构建 Gallery 后 `exec vitest run --config tests/acceptance/phase2-query.config.ts` 15/15、0 跳过、exit 0（`phase2-c-acceptance-green.log`）。
    - 独立使用侧 D 的 HTTP 与文档示例测试 5/5 + 3/3、exit 0（`phase2-c-consumer-green.log` / `phase2-c-examples-green.log`）。
  - B 的 RED→GREEN 另有 112/112 窄测、36/36 平台与 51/51 浏览器通过，详见 B 记录，不与最终组重复累计；真实服务使用隔离 PostgreSQL / MinIO / Verdaccio / Nest 与本地签名 JWT/JWK；P4 缺少冻结输入或 Gallery origin 会显式失败，不静默跳过；未运行会重新打包的 `tests/platform/current-sdk.test.ts`。
  - 冻结与独立审查：复用已接受 bundle `current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`：manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`，199 文件、14 报告逐项字节与 SHA 验证；core `0.0.11`、Vue/React `0.0.12`；没有重新 pack 或修改旧产物，CLI 仍为 `0.0.11`；SDK 原消费者/截图证据见 `sdk-label-adopt-acceptance-2026-11-16.md`。独立 Codex 审查对 `19c42897` 无剩余 Critical/Important 阻断；审查发现并关闭：GET 存储错误归一、使用侧动态规则说明、GET/POST 不同依赖语义的断言，以及真正进入 JSON 解析后的取消测试。
  - 原架构文件 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`；服务端未增加构建组件、执行上传代码或启动浏览器的能力。
  - 合并、证据与未覆盖范围：收口证据提交 `a89b3676` 后，main 从 `53117379` 快进到该提交；`git diff --exit-code HEAD <集成分支>` 证明树一致，main `verify:workspace` 通过；main 重新构建并运行 P4 真实 SDK + Gallery：15/15、0 跳过、exit 0（`phase2-main-acceptance.log`，隔离服务 ID `643eba31-c180-4c1b-876a-eb600550b796`）。
  - 日志、最终截图、CLI 候选记录和执行账本共 214 文件已保存至主工作区忽略目录 `.tools/operations/phase2-query-completion-2026-11-16/`，逐项 bytes/SHA 记录于 `evidence-manifest.json`；主工作区截图在 `main/test-results/phase2-query-acceptance/`。
  - 分支删除：在逐个确认分支尖端属于 main 后，使用 `git branch -d` 删除 `chore/phase2-a-sdk-matrix`、`feat/phase2-b-query-api`、`chore/phase2-c-query-integration`、`chore/phase2-d-query-acceptance`、`feat/phase2-c-contracts`；A/C/D 已通过 Codex 原生工具可恢复归档；B 是本任务当前主 checkout，原生工具明确拒绝：`The task's primary checkout cannot be removed.`，因此保留该目录，已切为指向 main 合入提交的 detached HEAD；Git 分支仅余 main。
  - 归档异常记录：预先解除 junction 的 shell 清理命令被自动策略拒绝，未执行；改用原生可恢复归档时，工具在 Windows 上沿 junction 清空了共享的 Node/pnpm/Playwright 生成缓存；立即核对源码干净、架构 SHA 和冻结 manifest SHA 未改变；其余归档只在缓存目录已确认为空时执行；Node/pnpm 从主工作区保留的原 ZIP/tgz 恢复，版本仍为 `26.13.0` / `12.18.0`；浏览器按当前锁定 Playwright 重建，安装 exit 0；恢复后 `verify:workspace` 通过、显式冻结输入的矩阵/199 文件校验 9/9、Chromium 契约浏览器 1/1 全部 exit 0（`phase2-restored-workspace.log`、`phase2-restored-frozen.log`、`phase2-restored-browser.log`）；此异常已恢复，不影响产品验收与冻结产物。
  - 公司 OIDC / G2、独立生产域名、部署发布、真实 Vue/React 业务试点及三期自动接入继续独立验收；合成 design ID、真实 SDK 技术验收和本地 JWT 不改变旧 real 评分，也不冒充生产验收；本轮不 push、不创建 tag、不发布生产包。
- 结论与状态：完成（二期协议范围收口，main 已含全部成果）。
- 交叉引用：`c-phase2-query-contracts-2026-11-16.md`、`a-phase2-query-sdk-2026-11-16.md`、`b-phase2-query-implementation-2026-11-16.md`、`d-phase2-query-consumer-2026-11-16.md`、`c-phase2-query-integration-2026-11-16.md`、`docs/phases/phase2/component-query-api.md`、`docs/phases/phase2/component-query-sdk-matrix.md`、`phase2-id-integration-2026-11-16.md`、`phase2-main-merge-2026-11-15.md`。
- 过时或矛盾点：无。

---

## 历史脉络

2026-11-15，二期开工。B 先在 `b-phase2-matching` worktree（基点 `fa24ab52`）做只读审计，盘清画廊/控制台/表单/测试结构与接入边界：`apps/gallery` 为 Next.js `16.4.6` App Router，控制台无真实 OIDC、DTO 全部来自 `@company/contracts`，`apps/api/src` 尚无 `search`/`matching` 目录，并指出 T14 计划里的 `apps/gallery/src/pages/DesignMatch.vue` 是迁移前旧路径。审计同时确认沙箱内 `rm` 被禁、只能由宿主提交的协作约束。C 随即冻结 `ProjectContext` 契约（`e8248fb3`）：新增 `validateProjectContext` 与 `project-context-v1` schema、18 项契约测试、补齐 CLI 固定清单内联，A 的非作者审查提交 `f172dbac` 判定无阻断。A 同期在 `feat/a-phase2-profiles` 交付组件档案 `component-profiles.md` 与评估协议 `evaluation-protocol.md`（7 组件 × 14 实现导出名、4 项指标、5 类陷阱、包版本 `0.0.10` 与 peer 基线），并经独立审查修订源码证据路径（56 文件 Missing=0）、把 `top5Recall` 分母修为所有真实样本、确立 real/synthetic 隔离与零分母 N/A 规则，最后把 `reactDomVersion` 从 `projectContext` 移入独立 `evalEnvironment`，同时澄清 `assertJson` 放行 `null`、真正拒绝来自 `type: 'object'`。

契约就绪后三方并行落地。A 实现离线评分器 `scoreEvaluation`（8 项测试起步，real 组 6 条门槛）与文件型 runner `runEvaluationCli`（退出码 0/2/1 语义），再修订出 `noMatchRejection >= 0.9` 门禁与稀疏数组防御（12 项）和错误分类脱敏（18 项），C 以 `bbb0bf7f`/`f092f240` 独立验收通过。B 在 `/match` 落地 B1 项目上下文本地校验表单（纯转换 + 白名单，不接检索、不伪造结果），首轮浏览器实测页面 404、noindex 用例被误判，修订为每个用例补 HTTP 200 断言；宿主复跑又暴露草稿残留提示与换身份残留需求两项回归，B 引入 `clearOutcome()` 并补齐 `handleLogout` 重置后关闭。C 在 Windows 固定工具链上验收：3 文件 53 项单测、浏览器 25 项（上下文 10）全绿，Gallery 独立升 `0.0.6`。

接着 C 冻结候选契约 `e0a7f5ee`（27 项新契约测试、契约总计 198 项）并实现 `filterEligibleCandidates`：首轮过滤 + 返回前复读权限/Ready/废弃/revision/provider、peer 精确匹配不猜测、兼容记录逐项 `validateApiMessage`、A 审查提交 `15511ec9` 无阻断。B 原样接入（`dcb4d52e`）交付解析层与纯展示组件，并因「框架标签写死 Vue 3/React 19」被 C 的新增回归抓住，改为 `Vue`/`React` 后 24 项通过；C 宿主 3 文件 60 项、全图 build 10/10、根 test 818 项验收。同批 C 又冻结检索请求契约 `95ec3726`（三字段、12 项新测试）并交付 PostgreSQL 文本检索：`008_search.sql` 迁移、GIN tsvector、outbox `SKIP LOCKED` + SAVEPOINT 原子回滚、鉴权 HTTP 单条 SQL 共享快照；B 接入 B3 检索页面，经历取消语义（`throwIfAborted` 三处检查点）、token/subject 双重身份快照与 `invalidateSession()` 统一清理三轮修订，最终 51 项单测、B1+B3 浏览器 28/28、根 test 845 项，Gallery 升 `0.0.7`。C 还完成真实联调：随机隔离 PG/MinIO/Verdaccio + 签名 JWT + 已构建 Gallery 经 3000 端口透明代理，点击后显示真实 Vue line 候选，禁用 alice 后登录失效且候选清空。三方成果由 `phase2-main-merge-2026-11-15.md` 合入 main：`d4bb8791`/`9cdc4eb8`/`cba7b022`，根 test 55 文件 895 项、浏览器 223 个用例经首轮或定向复验全覆盖，main 后续快进到 `a89b3676`。

2026-11-15 起二期范围被用户明确调整为「不接大模型、改用设计 ID 规则匹配」。C 以 `487d1ad9` 调整范围，`f8639d4c` 冻结输入契约（design-id 36 项新测试、契约总计 246 项），`01e95e16` 冻结装配 + 组件 API 契约，`e6e9a639` 交付确定性 API 服务。A 交付组件 API 材料与 `evaluateIdMatching`（复用 `validateMatchPlan`、严格 real/synthetic 隔离），因 worktree 未链接工具链三条命令未实跑，改由 C 宿主确认 RED 后集成；A 又补 4 项硬违规边界测试（16/16）。B 交付设计 ID 配置输入、`match-plan-client.ts`（先核对 `inputDigest`、三处取消检查点、失败分类固定文案）与 `DesignIdMatch.tsx`，强调「只有显式点击才 POST」与「不生成链接、不编造结论」，并修正两处自测测试缺陷。D 交付 `runner-id-cli.ts` 与观测交接规范，样例实跑 exit 1（real=0、synthetic=1、`productionAcceptance: false`）。C 集成后全量验证：全图 20/20、根 test 62 文件 1041 项、平台真实隔离 9/9、`matching-gallery` 1/1、浏览器 53/53；API 评估 synthetic 精确命中 5/5、real 0 条 N/A，规模量测 200/1000 条下 ID 409ms/1796ms、文本 33ms/25ms（本机单次样本，非 SLA）。

2026-11-16 二期进入组件查询 API 收口。C 以 `53117379` 冻结 `ComponentMatchQueryV1`/`ComponentMatchResponseV1`（P0，36 项 RED、83 项 GREEN）；A 建 14 项 SDK 预期矩阵（P2，默认 8 项/冻结输入 9 项，`manifest.files` 199 项为权威清单）；B 实现 GET 权威查询与 Gallery 查询入口（P1），先补失败测试、经宿主 RED 112 项 = 72 过 / 40 败后做最小修复，包括 target 逐字段构造、白名单落到解码后 `pairs`、歧义判定先于资格过滤、`readApi` 复查前移、存储错误归一（`UPLOAD_INCOMPLETE`/`LIMIT_EXCEEDED` → `NOT_FOUND`，`INFRA_UNAVAILABLE` 仍 503），最终宿主复跑 112/112、36/36、51/51、根 tsc 0；D 以独立消费者视角写 HTTP 测试、可校验示例与使用说明（P3，5/5 + 3/3）；C 用冻结 bundle `881238b3-2214-4ec8-bf0c-af5238b7fcd3`（manifest SHA-256 `04a7c4fb...`，core `0.0.11`、Vue/React `0.0.12`）完成 P4 真实 SDK + Gallery 联调 15/15。最终收口于产品提交 `19c4289789613bbfacf0c7b7359530efdda4998e`：全图 20/20、根 test T10 168/168 + Vitest 75 文件 1249 项、平台 45/45、二期浏览器 70/70、P4 15/15、D 5/5 + 3/3，五个开发分支安全删除，main 经 `a89b3676` 含全部成果；归档时 junction 清理误伤共享 Node/pnpm/Playwright 缓存，已从原 ZIP/tgz 恢复并复验通过。全程仍未跨过的门槛是：真实标注集 0 条、真实设计 ID 规则未定、公司 OIDC/独立预览域/真实业务试点等外部条件未就绪，故 T13/T14 业务验收保持开放。
