# Zhinexus 设计资产平台 — 文档索引

本文件是 `docs/` 的总索引与阅读入口。

2026-11-22（分支 `chore/docs-consolidation`）对 `docs/` 做了一次合并整理：`docs/verification/` 下 216 篇逐次验证记录按主题合并为 8 篇汇编文档，原件已从工作树删除，但**全部内容以小节形式完整保留在汇编内**，git 历史亦可追溯（如 `git show b2d4066f:docs/verification/t09-bar.md`）。实施计划、契约设计、使用指南、阶段文档**一篇未删**，仅按主题迁入子目录，仓库内约 120 个文件中的路径引用已同步更新。

2026-11-24 又做了一轮精简：`component-platform-implementation-assessment.md` 开头倒序堆叠的 5 段日期进展收敛为「当前状态速览」表（验证计数改以验证汇编为唯一来源）；`docs/design/` 下 6 篇当天画廊设计验证合并为 `gallery-iteration-2026-11-23.md`；`docs/plans/` 下 11 篇 T16 分包 brief 合并为 `2026-11-18-t16-briefs-compilation.md`。两处合并同样**完整保留原文**（小节标题即原文件名），git 历史可追溯；原件与引用已一并处理。

2026-11-26 第三轮（分支 `chore/docs-slim-round3`）继续合并 2026-11-24 之后新写的同主题散篇：真实项目发布 5 篇 → 2 篇、后台账号与本地身份 4 篇 → 2 篇、画廊/管理端拆分 2 篇 → 1 篇、G2 接入 4 篇 → 1 篇、CLI Chromium 自动下载 2 篇 → 1 篇。做法与前两轮相同：**原文逐字保留**（小节标题即原文件名，标题降两级），仅把篇间交叉引用改成本汇编内锚点；git 历史可追溯。这一轮的代价也与前两轮相同——**文件数降 10 篇，总字节反而上升约 1 万**，因为每篇新汇编都要加导读段说明「这几篇是什么关系、该看哪篇」。若某次精简的目标是纯字节下降，应改做单文件内联精简，不要用合并。

2026-11-26 第四轮（同分支收尾）删掉了 8 篇大汇编各自的「历史脉络」一节——那是按时间序把各原记录的过程再叙述一遍的段落，与「终态结论 + 逐条合并记录」内容大幅重叠。**删除的是叙述，不是事实**：每篇里未在别处出现的硬事实（角色约定、固定工具链与架构 SHA、测试计数演进、CLI 各轮冻结链与 seal/archive-map、pnpm 隔离判例等）已压成终态结论末尾的「历史脉络硬事实」小节，逐条合并记录则一字未动（已逐文件核对非空行完全一致、小节数不变）。8 篇合计由 888,991 字符降至 843,658 字符，**净省 45,333 字符（5.10%）**；其中删掉叙述 53,201 字符、新增硬事实与恢复说明 7,868 字符。原文可经 `git show 789addf7:docs/verification/<汇编>.md` 恢复。

## 目录结构

```
docs/
├── README.md                     本文件：总索引、事实来源速查、过期表述清单
├── versions.discovery.json       版本发现证据（scripts/resolve-versions.mjs 读取，勿移动）
├── guides/                       使用与运维指南（10 篇）
├── foundation/                   工程基线验证（2 篇，AGENTS.md 指定的事实来源）
├── design/                       pen.dev 设计稿说明与当天迭代汇编（3 篇 + .pen/预览素材）
├── plans/                        实施计划与分工（38 篇，原 superpowers/plans/）
├── specs/                        契约与设计（15 篇，原 superpowers/specs/）
├── phases/
│   ├── phase2/                   二期契约与工具文档（7 篇 + 1 个报告样例）
│   └── phase3/                   三期接入文档（4 篇）
├── acceptance/                   验收材料（3 篇 + 首批资产截图素材）
└── verification/
    ├── *.md                      15 篇：8 篇主题汇编 + 7 篇 2026-11-24 之后的当日记录/新汇编
    └── evidence/                 历史日志、JSON 证据与视觉验收截图素材（勿修改）
```

## 三类文档，三种读法

**指南（`guides/`）**回答「现在怎么做」——面向操作者，随现状更新。**计划与设计（`plans/`、`specs/`）**回答「要做什么、契约是什么」——按日期存档，含当轮范围与验收标准。**验证汇编（`verification/`）**回答「做过什么、结论是什么、还差什么」——每篇由若干原记录小节组成，小节标题即原记录文件名，历史命令、路径、hash 按当时原貌保留，阅读早期小节时不要直接复跑其中的命令。8 篇主题汇编内部固定为三段：**终态结论**（权威现状，以此为准）、**逐条合并记录**（按原文件名堆叠的原始证据，一字未动）、**历史脉络硬事实**（2026-11-26 从被删的叙述段里提取的独有事实，如角色约定、计数演进、CLI 各轮冻结链）。

## 当前事实来源速查

| 问题 | 应查文档 |
|---|---|
| 整体技术栈与工程基线 | `foundation/nest-react-bootstrap.md`、`foundation/gallery-next-migration.md` |
| 任务拆解 T01–T17 与验收标准 | `plans/2026-11-11-component-platform-implementation.md` |
| 三人分工与并行依赖 | `plans/2026-11-11-three-person-allocation.md` |
| 图表组件公共接口（七种图表） | `specs/2026-11-12-sdk-*-protocol.md`、`specs/2026-11-13-sdk-ranking-proportion-protocol.md` |
| SDK 兼容性策略与 ECharts 升级 | `guides/echarts-upgrade.md` + `verification/sdk-release.md` |
| 平台上传/发布/预览行为 | `verification/platform-services.md` + `guides/operations.md` |
| 二期匹配与查询接口用法 | `phases/phase2/component-query-api.md` + `verification/phase2-matching.md` |
| 三期本地接入（inspect/plan/apply/verify） | `phases/phase3/` 四篇 + `verification/phase3-t15.md`～`phase3-t17.md` |
| 门槛状态（G0/G1/G2） | `verification/gates-infra.md`（G1 已放行、G2 未通过的权威记述） |
| 上线还差什么 | `guides/release-acceptance.md` + `verification/gates-infra.md` 的终态结论 |
| 自管账号后台 | `guides/self-managed-accounts.md` + `guides/access-settings.md` |

## 分类导航

### 指南 `docs/guides/`

| 文件 | 标题 | 说明 |
|---|---|---|
| `quickstart.md` | 本地开发与运维准备 | 固定工具链引导、三存储本机启动、凭证存放边界 |
| `publishing.md` | 发布与恢复操作边界 | 发布链与恢复操作的允许/禁止范围 |
| `operations.md` | 平台运维 | 部署准备、故障与备份命令、指标令牌 |
| `release-acceptance.md` | 一期上线验收状态 | 上线验收清单；2026-11-13 表格为历史快照，后续补充见文中链接 |
| `preview-ip-port.md` | 同一台服务器按 HTTPS 端口提供组件预览 | 无域名时的 IP 分端口试用模式（2026-11-21 用户授权） |
| `access-settings.md` | 公司登录与预览接入设置 | OIDC 与预览入口的后台配置、Cookie/凭证过滤规则 |
| `self-managed-accounts.md` | 自主管理账号栈与本机试用 | 自管账号的身份栈、本机隔离 IdP 试用方法与未验证边界 |
| `echarts-upgrade.md` | ECharts 升级、兼容矩阵与回退 | 6.1.0 基线、6.0.0 候选 hold 结论与回退交接 |

### 工程基线 `docs/foundation/`

| 文件 | 标题 | 说明 |
|---|---|---|
| `nest-react-bootstrap.md` | NestJS / React 工程调整验证 | 技术栈调整（NestJS 12.4.2 + React 19.3.1 + Next 16.4.6）的实测证据，AGENTS.md 指定事实来源 |
| `gallery-next-migration.md` | Gallery Next 迁移验证 | 画廊 Next 迁移与公开/私有渲染边界，AGENTS.md 指定事实来源 |

### 设计稿 `docs/design/`

| 文件 | 标题 | 说明 |
|---|---|---|
| `gallery.md` | 组件画廊设计稿 | 画廊 `gallery.pen` 四张画板说明、预览与当前终态 |
| `management-api.md` | 管理控制台设计稿 | 管理后台 `management-api.pen` 六张画板说明 |
| `gallery-iteration-2026-11-23.md` | 画廊设计稿迭代汇编 | 当天六篇设计验证记录合并而成，小节标题即原文件名；含拆分、第一至第四版首页的完整过程与 SHA-256 |

设计稿本体是 `.pen` 文件与 `previews/`、`shaders/` 素材，用 pen.dev / Pencil 打开；全部为 B 的 T07 静态设计资产，不构成业务验收证据。

### 实施计划 `docs/plans/`

工程基线：`2026-11-11-bootstrap-execution.md`（初始化执行范围）、`2026-11-11-nest-react-bootstrap.md`（技术栈调整）、`2026-11-11-gallery-next-public-private.md`（画廊迁移）、`2026-11-12-simplify-project-scripts.md`（脚本整理）、`2026-11-11-component-platform-implementation.md`（**总计划 T01–T17，最高频引用**）、`2026-11-11-three-person-allocation.md`（分工排期）。

门禁：`2026-11-12-g1-contracts-platform.md`、`2026-11-22-g2-access-acceptance.md`（**G1/G2 清单汇编**，合并了 2026-11-12 G1 评审与 G2 五项接入清单（含 2026-11-22 G1 放行回写）、2026-11-12 本地三存储、2026-11-22 接入设置、2026-11-22 五项实测四篇，小节标题即原文件名）、`2026-11-21-g1-t10-acceptance-closeout.md`。

平台任务：`2026-11-12-t05-platform.md`、`2026-11-12-t06-release-worker.md`、`2026-11-12-t07-catalog-preview.md`、`2026-11-12-t11-t12-platform-operations.md`、`2026-11-13-c-gallery-cors.md`、`2026-11-13-c-platform-acceptance.md`、`2026-11-13-c-sdk14-acceptance.md`、`2026-11-13-next-round-execution.md`、`2026-11-14-distribution-production-preparation.md`。

SDK/CLI：`2026-11-16-sdk-lifecycle-acceptance.md`、`2026-11-16-b-cli-release-acceptance.md`、`2026-11-16-four-agent-acceptance.md`、`2026-11-16-four-agent-next-round.md`。

二期（phase2）：`2026-11-15-phase2-kickoff.md`、`2026-11-15-phase2-candidates.md`、`2026-11-15-phase2-id-matching.md`、`2026-11-15-phase2-match-plan-http.md`、`2026-11-15-phase2-text-search.md`、`2026-11-16-phase2-query-completion.md`。

三期（phase3）：`2026-11-16-phase3-t15-kickoff.md`、`2026-11-18-phase3-t16-safe-apply.md`、`2026-11-19-phase3-t17-completion.md`、`2026-11-21-preview-ip-port.md`、`2026-11-22-component-visual-acceptance.md`。

2026-11-24 之后新增：`2026-11-22-self-managed-accounts.md`（自主管理账号 + 平台自研身份服务两篇计划汇编）、`2026-11-24-gallery-admin-split.md`（拆分计划）、`2026-11-24-project-publishing.md`（真实项目 CLI 发布 + juz 简化发布两篇计划汇编）、`2026-11-25-juz-browser-install.md`（安装时自动下载 Chromium）。

T16 分包 brief（A/B/C/D 四方，11 篇）：已合并为 `2026-11-18-t16-briefs-compilation.md`，小节标题即原文件名（A 侧 API 案例与两轮断言返工、B 侧安装隔离与产品 GREEN 及四个补修和 B21、D 侧黑盒）。

### 契约与设计 `docs/specs/`

图表公共接口（七种图表 × 双框架）：`2026-11-12-sdk-framework-example-protocol.md`（折线/T03 基线）、`2026-11-12-sdk-bar-chart-protocol.md`、`2026-11-12-sdk-pie-chart-protocol.md`、`2026-11-12-sdk-scatter-chart-protocol.md`、`2026-11-12-sdk-trend-card-protocol.md`、`2026-11-13-sdk-ranking-proportion-protocol.md`。

其他：`2026-11-11-gallery-next-public-private-rendering.md`、`2026-11-15-phase2-id-matching-design.md`、`2026-11-16-phase2-query-completion-design.md`、`2026-11-16-phase3-t15-design.md`、`2026-11-18-phase3-t16-design.md`、`2026-11-19-phase3-t17-design.md`、`2026-11-22-g2-access-settings-design.md`、`2026-11-22-self-managed-accounts-design.md`。

### 二期 `docs/phases/phase2/`

`component-profiles.md`（组件档案审计）、`component-query-api.md`（**GET /v1/matching/components 用法，测试直接读取其中的 example**）、`component-query-sdk-matrix.md`（双框架真实 SDK 预期矩阵）、`evaluation-protocol.md`（离线评估协议与标注规范）、`evaluation-runner.md`（A3 Runner 规范）、`id-evaluation-runner.md`（ID 离线评估入口与报告模板）、`id-observation-handoff-2026-11-16.md`（ID 观测交接）、`id-evaluation-report.example.json`（报告样例）。

### 三期 `docs/phases/phase3/`

`integration-plan.md`（T15 识别与接入计划）、`local-project-apply.md`（T16 受控应用与恢复）、`local-project-verification.md`（本地验证、有限修复与 MCP）、`project-support-matrix.md`（T15 项目识别矩阵与 SDK 审计）。

### 验收材料 `docs/acceptance/`

`pilot-report.md`（T11 C 本地故障预演）、`first-batch-assets-2026-11-22.md`（首批组件资产与素材草案，附截图目录）、`platform-test-checklist-2026-11-22.md`（平台试用与验收测试清单）。

### 验证汇编 `docs/verification/`

| 汇编 | 合并篇数 | 内容与终态要点 |
|---|---|---|
| `sdk-charts.md` | 19 | T02/T03 核心与适配、T09 六种图表的交付、合入 commit 与计数演进；Windows 原生复验清单全部未执行 |
| `sdk-release.md` | 30 | T10 兼容性九条纪律、混合版本三闸门、探针体系与分发合同、SDK/CLI 各版本发布验收、画廊 Next 基线与 ECharts 记录 |
| `platform-services.md` | 33 | T04–T08 平台能力、T11/T12 运维与试点、C 侧集成/隔离/分发/生产准备、rollback-sidecar 与四方收尾 |
| `phase2-matching.md` | 45 | 二期 context/profiles/scoring/候选/检索/ID 匹配/查询 API 的四方记录与合入链 |
| `phase3-t15.md` | 14 | T15 项目导入与矩阵、CLI 0.0.13 验收、2026-11-22 视觉验收 300/302 |
| `phase3-t16.md` | 23 | T16 契约、A 侧三轮断言审查、B/C/D 编号用例、产品红与技术验收、CLI 0.0.14 冻结 |
| `phase3-t17.md` | 38 | T17 矩阵执行器、CLI 0020–0023 回归、宿主链、黑盒 0021–0023、CLI 0.0.23 唯一交付候选 |
| `gates-infra.md` | 16 | G0 bootstrap、G1（已放行）、G2（未通过）、turbo/scripts、Next 迁移、预览 IP 端口、自管账号、T11 演练 |
| `project-publishing.md` | 3 | 2026-11-26 新增。真实项目 CLI 发布 + 最终修复补录 + juz 简化发布；真实四服务链 Ready 证据 |
| `self-managed-accounts.md` | 2 | 2026-11-26 新增。后台创建账号核查与本地管理员播种、令牌 `sub`/`id_token` 修复、后台登录页 |
| `gallery-admin-split.md` | 2 | 2026-11-26 新增。画廊/管理端拆分集成验证 + 集成前的只读安全边界审查（P0-1～P2-16） |
| `cli-chromium-autodownload.md` | 2 | 2026-11-26 新增。juz-cli `postinstall` 自动下载 Chromium + 合并 main 复验 |

尚未并入汇编的当日单篇记录：`2026-11-24-admin-pen-restore.md`（管理端按 `management-api.pen` 还原的验证与已知取舍）、`2026-11-24-dev-startup.md`（开发启动与端口冲突排查）、`2026-11-26-juz-workbench.md`（本地工作台交付与独立验证边界）。

### 证据文件 `docs/verification/evidence/`

历史 `.log` / `.json`（bootstrap、Nest、turbo、SDK 验收 evidence）与 `component-visual-acceptance-2026-11-22/` 截图素材目录。用途与关键数字见 `gates-infra.md` 的「证据文件」一节；这些文件是历史运行的原始输出，不要修改。

## 原记录文件名怎么查

每篇汇编的「逐条合并记录」中，小节标题即原记录文件名（如 `### t09-bar.md`）。**原文件名与汇编的对应关系只维护在汇编内**，本索引不再重复抄录那 200 多个文件名——手抄清单必然过期，而汇编内的小节标题不会。查某个旧文件名属于哪篇汇编：

```bash
grep -rl '^### <原文件名>' docs/verification/
```

汇编的完整性用篇数核对：上表「合并篇数」应等于该汇编中以原文件名（含 `.md`）命名的 `###` 小节数量。核对命令：

```bash
grep -c '^### .*\.md' docs/verification/<汇编>.md
```

（2026-11-26 新增的四篇汇编里，个别原记录自带文中小标题，降级后也是 `###`，因此不能简单数所有 `###`；上面这条命令只数以原文件名命名的小节。）各汇编的原记录命名规律（便于猜测与批量检索）：`sdk-charts.md` 收 `t02-`/`t03-`/`t09-`；`sdk-release.md` 收 `a-`/`b-`/`c-`/`t10-`/`t11-t12-` 与 `sdk-label-`；`platform-services.md` 收 `t04`–`t08`、`c-`、`cli-`、`four-agent-`、`next-round-`、`rollback-sidecar-`；`phase2-matching.md` 收 `a-`/`b-`/`c-`/`d-`、`phase2-` 与 `a2-`/`a3-`/`b3-`/`c3-`；`phase3-t15.md` 收 `t15-` 与 `component-visual-acceptance-`；`phase3-t16.md` 收 `t16-`；`phase3-t17.md` 收 `t17-`；`gates-infra.md` 收 `bootstrap`、`g1-`、`g2-`、`gallery-next-migration.md`、`nest-react-bootstrap.md`、`scripts-maintenance-`、`turbo-baseline.md`、`t11-pilot-rehearsal-`、`self-managed-accounts-2026-11-22.md`、`preview-ip-port-2026-11-21.md`。

## 已过期或需注意的表述

阅读历史文档时，以下表述已发生时点变化，不要据此判断现状：

- **G1 已放行**：2026-11-22 用户决定 G1 放行，A/B 实际业务回执不作为前置条件；该决定已提交进 main（`6511ba77`）并回写 `plans/2026-11-22-g2-access-acceptance.md` 中「2026-11-12-g1-review-g2-access.md」小节。因此 `verification/gates-infra.md` 中 `### g1-contracts-2026-11-12.md` 等早期小节里「G1 人工门槛仍未通过」「不能用代理自查冒充签字」的措辞是该时点记录，**不是当前状态**。仓库根 `README.md` 与 `tests/fixtures/releases/g1/README.md` 中类似旧措辞尚未回写，需用户拍板后再改。
- **G1 放行不外推到 G2**：G2 五项外部接入（公司 OIDC 登录与撤权、生产独立预览域 DNS/TLS、生产镜像 digest、生产容量与等量备份、两个真实业务试点）一项都未达到证据标准；`infra:check-access` 在缺少配置时退出码为 2，报告恒为 `g2Ready: false`。
- **`guides/release-acceptance.md`**：文中 2026-11-13 表格是历史快照，部分行的本地缺口已被 2026-11-15／11-16／11-21 的记录推进，逐行现状以文中链接与 `verification/gates-infra.md` 为准。
- **ECharts 6.0.0 仍为 hold**：候选 6.0.0 的严格安装被拒、显式 legacy 测量中双框架类型检查失败，peer 保持 6.1.0 未扩大；不要依据任何历史记录升级。
- **T09 Windows 原生复验未执行**：四份 Windows 原生清单（bar／scatter／trend-card／ranking-proportion）全部标注「阻塞（非失败）」且回填为空；本主题唯一的 Windows 全绿记录是 B 侧 `### t03-t04-consumer-freeze.md`，覆盖范围仅 charts-core 折线。
- **2026-11-22 视觉验收不能宣布全部通过**：功能 300/302，V01 小屏横向溢出、V02 深色宿主、V03 饼图 solid-empty 自检失败三项阻断未关闭，详见 `verification/phase3-t15.md`。
- **自管账号后台未验证真实 IdP**：实现已合入本地 main 但未 push，沙箱零实跑，真实 Keycloak 的 mapper、首次改密、登录与撤权时限均未验证。
- **本地 main 有未推送提交**：按仓库规则，任何 `git push` 都需用户明确授权。
- **旧路径**：整理后 `docs/verification/<原记录>.md`、`docs/superpowers/`、`docs/phase2/`、`docs/phase3/` 与 docs 根下的 8 篇指南路径均已不存在；2026-11-26 又一批 2026-11-24 之后的当日散篇按主题并入汇编（见「原记录文件名怎么查」）。引用已批量更新，若发现遗漏的旧路径请报告修正。

## 尚未关闭的事项

技术与工具链已在本地收口，未关闭项集中在仓库之外：

- 两个真实授权的 Vue / React 业务项目试点（同时是 T11 标准项、T16/T17 最后一项勾选与 T12 最终验收的前置）。
- 公司 OIDC：真实 Web/CLI 登录、专用账号实际停用与角色移除、既有 token／Web session／预览 grant 的拒绝时延、公司管理员认可的目标时限。
- 生产独立预览域：逐发布 DNS/TLS、双框架浏览器隔离证据。
- 生产镜像：`infra/compose.production.yaml` 中 API／preview／MinIO 的 digest 占位需组织镜像仓库提供；Linux CI 与镜像构建发布未验收。
- 生产等量备份 RPO/RTO 与发布容量 SLA、告警送达、metrics token、最小权限。
- 完整生产 G2 五项接入实测。
- 视觉验收三项阻断（V01/V02/V03）与 ECharts 6.0.0 评估。
- 自管账号真实 IdP 验证与推送授权。
