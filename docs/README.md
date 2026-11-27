# Zhinexus 设计资产平台 — 文档索引

本文件是 `docs/` 的总索引与阅读入口。2026-11-26 第五轮精简后，`docs/` 只保留**现行有效**的 68 篇文档（另有本索引，共 69 篇）：面向操作者的指南、仍然成立的契约与边界、当前功能的用法文档、验证汇编、AGENTS.md 指定的基线文档，以及索引本身。已完成任务的过程稿（35 篇历史实施计划、6 篇 phase2/3 设计稿、4 篇当日验证记录、T11 合成预演、画廊首页四版迭代记录、二期观测交接）已从工作树移除，全部可经 git 历史恢复。2026-11-26 晚些时候合入 `fix/juz-component-development`（juz CLI 工作台修复）时又带入 2 篇，已计入下列篇数。

## 目录结构

```
docs/
├── README.md                     本文件：总索引、事实来源速查、阅读约定
├── versions.discovery.json       版本发现证据（status 为 official-discovery-only，勿移动）
├── guides/                       使用与运维指南（12 篇）——「现在怎么做」
├── foundation/                   工程基线验证（2 篇，AGENTS.md 指定的事实来源）
├── specs/                        仍然成立的契约与边界（9 篇）
├── phases/
│   ├── phase2/                   二期用法与评估规范（6 篇）
│   └── phase3/                   三期本地接入用法（4 篇）
├── plans/                        实施计划（11 篇，其中 3 篇 AGENTS.md 指定为准）
├── design/                       .pen 设计稿说明（2 篇，设计稿本体在同目录）
├── acceptance/                   验收材料（2 篇）
└── verification/
    ├── *.md                      20 篇：8 篇主题汇编 + 3 篇专题汇编 + 当日修复记录
    └── evidence/                 历史日志、JSON 证据与视觉验收截图素材（勿修改）
```

## 三类文档，三种读法

**指南（`guides/`）**回答「现在怎么做」——面向操作者，随现状更新，是操作时的第一入口。**契约与用法（`specs/`、`phases/`）**回答「接口是什么、现在怎么用」——按主题归档，描述当前仍然成立的接口、边界与命令。**验证汇编（`verification/`）**回答「做过什么、结论是什么、还差什么」——每篇由若干原记录小节组成，小节标题即原记录文件名，历史命令、路径、hash 按当时原貌保留，阅读早期小节时不要直接复跑其中的命令。

8 篇主题汇编内部固定为三段：**终态结论**（权威现状，以此为准）、**逐条合并记录**（按原文件名堆叠的原始证据，一字未动）、**历史脉络硬事实**（2026-11-26 从被删的叙述段里提取的独有事实，如角色约定、计数演进、CLI 各轮冻结链）。

## 当前事实来源速查

| 问题 | 应查文档 |
|---|---|
| 整体技术栈与工程基线 | `foundation/nest-react-bootstrap.md`、`foundation/gallery-next-migration.md` |
| 任务拆解 T01–T17 与验收标准 | `plans/2026-11-11-component-platform-implementation.md` |
| 三人分工与并行依赖 | `plans/2026-11-11-three-person-allocation.md` |
| 图表组件公共接口（七种图表） | `specs/2026-11-12-sdk-*-protocol.md`、`specs/2026-11-13-sdk-ranking-proportion-protocol.md` |
| 画廊公开/私有渲染边界 | `specs/2026-11-11-gallery-next-public-private-rendering.md` |
| SDK 兼容性策略与 ECharts 升级 | `guides/echarts-upgrade.md` + `verification/sdk-release.md` |
| 平台上传/发布/预览行为 | `verification/platform-services.md` + `guides/operations.md` |
| 从真实项目发布组件 | `guides/project-publishing.md` + `verification/project-publishing.md` |
| juz 本地工作台 | `guides/juz-workbench.md` |
| juz CLI 缺陷修正与常规组件开发 | `plans/2026-11-26-juz-cli-fixes.md` + `verification/2026-11-26-juz-cli-fixes.md` |
| 二期匹配与查询接口用法 | `phases/phase2/component-query-api.md` + `verification/phase2-matching.md` |
| 二期离线评估 | `phases/phase2/evaluation-protocol.md` + `evaluation-runner.md` / `id-evaluation-runner.md` |
| 三期本地接入（inspect/plan/apply/verify） | `phases/phase3/` 四篇 + `verification/phase3-t15.md`～`phase3-t17.md` |
| 门槛状态（G0/G1/G2） | `verification/gates-infra.md`（G1 已放行、G2 未通过的权威记述） |
| 上线还差什么 | `guides/release-acceptance.md` + `verification/gates-infra.md` 的终态结论 |
| 自管账号后台 | `guides/self-managed-accounts.md` + `specs/2026-11-22-self-managed-accounts-design.md` |
| 公司登录与预览接入设置 | `guides/access-settings.md` + `specs/2026-11-22-g2-access-settings-design.md` |

## 分类导航

### 指南 `docs/guides/`

| 文件 | 标题 | 说明 |
|---|---|---|
| `quickstart.md` | 本地开发与运维准备 | 固定工具链引导、三存储本机启动、凭证存放边界 |
| `publishing.md` | 发布与恢复操作边界 | 发布链与恢复操作的允许/禁止范围 |
| `operations.md` | 平台运维 | 部署准备、故障与备份命令、指标令牌 |
| `release-acceptance.md` | 一期上线验收状态 | 上线验收清单；2026-11-13 表格为历史快照，逐行现状以 `verification/gates-infra.md` 为准 |
| `preview-ip-port.md` | 同一台服务器按 HTTPS 端口提供组件预览 | 无域名时的 IP 分端口试用模式（2026-11-21 用户授权） |
| `access-settings.md` | 公司登录与预览接入设置 | OIDC 与预览入口的后台配置、Cookie/凭证过滤规则 |
| `self-managed-accounts.md` | 自主管理账号栈与本机试用 | 自管账号的身份栈、本机隔离 IdP 试用方法与未验证边界 |
| `gallery-admin-deployment.md` | 画廊与内网管理端部署 | 公开画廊与内网后台的部署边界 |
| `echarts-upgrade.md` | ECharts 升级、兼容矩阵与回退 | 6.1.0 基线、6.0.0 候选 hold 结论与回退交接 |
| `project-publishing.md` | 从真实项目发布组件 | 真实项目 CLI 发布与后台发布选择 |
| `juz-workbench.md` | juz 本地工作台实操指南 | 本地工作台的创建、开发与冻结预览 |

### 工程基线 `docs/foundation/`（AGENTS.md 指定事实来源）

| 文件 | 标题 | 说明 |
|---|---|---|
| `nest-react-bootstrap.md` | NestJS / React 工程调整验证 | 技术栈调整（NestJS 12.4.2 + React 19.3.1 + Next 16.4.6）的实测证据 |
| `gallery-next-migration.md` | Gallery Next 迁移验证 | 画廊 Next 迁移与公开/私有渲染边界 |

### 契约与设计 `docs/specs/`

图表公共接口（七种图表 × 双框架）：`2026-11-12-sdk-framework-example-protocol.md`（折线/T03 基线）、`2026-11-12-sdk-bar-chart-protocol.md`、`2026-11-12-sdk-pie-chart-protocol.md`、`2026-11-12-sdk-scatter-chart-protocol.md`、`2026-11-12-sdk-trend-card-protocol.md`、`2026-11-13-sdk-ranking-proportion-protocol.md`。

其他仍然有效的契约与边界：`2026-11-11-gallery-next-public-private-rendering.md`（渲染边界）、`2026-11-22-self-managed-accounts-design.md`（自管账号与权限后台）、`2026-11-22-g2-access-settings-design.md`（公司 OIDC 与预览入口后台配置）。

### 实施计划 `docs/plans/`

`2026-11-11-component-platform-implementation.md`（**总计划 T01–T17，最高频引用，AGENTS.md 指定为准**）、`2026-11-11-three-person-allocation.md`（分工排期，AGENTS.md 指定为准）、`2026-11-11-bootstrap-execution.md`（首次初始化执行范围，AGENTS.md 注明仅供历史追溯）、`2026-11-24-gallery-admin-split.md`（画廊与内网管理端拆分边界，AGENTS.md 指定为准）、`2026-11-26-juz-cli-fixes.md`（juz 工作台五项缺陷修正与常规组件开发的范围裁定）。

### 二期 `docs/phases/phase2/`

`component-query-api.md`（**GET /v1/matching/components 用法，测试直接读取其中的 example**）、`component-profiles.md`（组件档案审计）、`component-query-sdk-matrix.md`（双框架真实 SDK 预期矩阵）、`evaluation-protocol.md`（离线评估协议与标注规范）、`evaluation-runner.md`（A3 Runner 规范）、`id-evaluation-runner.md`（ID 离线评估入口与报告模板），另有报告样例 `id-evaluation-report.example.json`。

### 三期 `docs/phases/phase3/`

`integration-plan.md`（T15 识别与接入计划）、`local-project-apply.md`（T16 受控应用与恢复）、`local-project-verification.md`（本地验证、有限修复与 MCP）、`project-support-matrix.md`（T15 项目识别矩阵与 SDK 审计）。

### 设计稿 `docs/design/`

`gallery.md`（组件画廊 `gallery.pen` 说明与当前终态）、`management-api.md`（管理后台 `management-api.pen` 说明）。设计稿本体是同目录下的 `.pen` 文件与 `previews/`、`shaders/` 素材，用 pen.dev / Pencil 打开；全部为静态设计资产，不构成业务验收证据。

### 验收材料 `docs/acceptance/`

`platform-test-checklist-2026-11-22.md`（平台试用与验收测试清单）、`first-batch-assets-2026-11-22.md`（首批组件资产与素材草案，附截图目录）。

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
| `project-publishing.md` | 3 | 真实项目 CLI 发布 + 最终修复补录 + juz 简化发布；真实四服务链 Ready 证据 |
| `self-managed-accounts.md` | 2 | 后台创建账号核查与本地管理员播种、令牌 `sub`/`id_token` 修复、后台登录页 |
| `gallery-admin-split.md` | 2 | 画廊/管理端拆分集成验证 + 集成前的只读安全边界审查（P0-1～P2-16） |
| `2026-11-26-juz-cli-fixes.md` | 当日单篇 | juz CLI 工作台五项缺陷修正与常规组件开发方式的独立验证；2026-11-26 合入 `fix/juz-component-development` 时带入，非汇编故无原文件名小节 |
| `2026-11-27-cli-token-renewal-merge.md` | 当日单篇 | 两小时 JWT 与 CLI 活跃续签修复的本地主分支合并验收，含全量回归结果及未覆盖边界 |

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

（个别原记录自带文中小标题，降级后也是 `###`，因此不能简单数所有 `###`；上面这条命令只数以原文件名命名的小节。）

## 2026-11-26 精简说明（第五轮）

本轮把 `docs/` 从 100 篇降到 52 篇，删除 279,177 字符，标准是**只留现行有效**：被现行测试/脚本读取、被 AGENTS.md 指定为准、描述当前仍成立的契约与边界、当前功能的用法与运维文档、审计轨迹与索引。被删的是已完成任务的过程稿。

三点需要知道：

- **AGENTS.md 指定的文档一篇未删**，包括 `docs/plans/` 下的 4 篇（总计划、分工、bootstrap 执行范围、画廊/后台拆分）、`docs/foundation/` 2 篇与 `docs/verification/gates-infra.md`。删除这些会违反项目规则。
- **验证汇编里指向已删计划/设计稿的纯文本路径提法保持原样**（约 57 处）。AGENTS.md 规定不得重写已完成任务的历史验证记录，这些提法是历史档案的一部分；它们在正文里是纯文本而非链接，不影响阅读。被删文件可经 `git show <精简前的提交>:<路径>` 恢复。
- **指向已删文件的 40 处 markdown 链接已全部改指**到对应的验证汇编或保留指南；无对应可指的 7 处降为纯文本。改指后语义从「当时的计划」变为「当前的结论记录」，阅读时请注意这一区别。

前四轮的历史（2026-11-22 合并 216 篇为 8 篇汇编、2026-11-24 收敛状态日志、2026-11-26 合并 19 篇散篇、2026-11-26 删除 8 篇汇编的历史脉络叙述段）均可经 git 历史追溯。

## 已过期或需注意的表述

阅读历史文档时，以下表述已发生时点变化，不要据此判断现状：

- **G1 已放行**：2026-11-22 用户决定 G1 放行，A/B 实际业务回执不作为前置条件。因此早期小节里「G1 人工门槛仍未通过」「不能用代理自查冒充签字」的措辞是该时点记录，**不是当前状态**。
- **G1 放行不外推到 G2**：G2 五项外部接入（公司 OIDC 登录与撤权、生产独立预览域 DNS/TLS、生产镜像 digest、生产容量与等量备份、两个真实业务试点）一项都未达到证据标准；`infra:check-access` 在缺少配置时退出码为 2，报告恒为 `g2Ready: false`。
- **ECharts 6.0.0 仍为 hold**：候选 6.0.0 的严格安装被拒、显式 legacy 测量中双框架类型检查失败，peer 保持 6.1.0 未扩大；不要依据任何历史记录升级。
- **T09 Windows 原生复验未执行**：四份 Windows 原生清单（bar／scatter／trend-card／ranking-proportion）全部标注「阻塞（非失败）」且回填为空；本主题唯一的 Windows 全绿记录覆盖范围仅 charts-core 折线。
- **2026-11-22 视觉验收不能宣布全部通过**：功能 300/302，V01 小屏横向溢出、V02 深色宿主、V03 饼图 solid-empty 自检失败三项阻断未关闭，详见 `verification/phase3-t15.md`。
- **自管账号后台未验证真实 IdP**：实现已合入本地 main 但未 push，沙箱零实跑，真实 Keycloak 的 mapper、首次改密、登录与撤权时限均未验证。
- **本地 main 有未推送提交**：按仓库规则，任何 `git push` 都需用户明确授权。
- **旧路径**：整理后 `docs/verification/<原记录>.md`、`docs/superpowers/`、`docs/phase2/`、`docs/phase3/` 与 docs 根下的 8 篇指南路径均已不存在；2026-11-26 又移除了 35 篇历史实施计划、6 篇 phase2/3 设计稿、4 篇当日验证记录及其他过程稿。引用已批量更新，若发现遗漏的旧路径请报告修正。

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
