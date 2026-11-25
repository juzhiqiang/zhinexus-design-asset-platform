# G2 五项外部接入验收计划汇编（g2-access-acceptance）

> 本文件由 4 篇计划/清单按时间序合并而成（2026-11-26，`chore/docs-slim-round3` 分支）。合并范围：`2026-11-12-g1-review-g2-access.md`、`2026-11-12-g2-local-infra.md`、`2026-11-22-g2-access-settings.md`、`2026-11-22-g2-five-item-acceptance.md`。每篇以 `### <原文件名>` 为标题**完整保留原文**（标题降两级），git 历史可追溯，信息不灭失。
>
> 四篇的关系：第一篇同时管 G1 契约评审交接与 G2 五项外部接入清单（含 2026-11-22 G1 放行决定，**该决定只针对 G1**）；第二篇交付隔离本地三存储与接入检查工具；第三篇把「接入设置」这项能力本身落地；第四篇是五项接入的实测与证据补充。引用 G2 现状时以第四篇与 [`../verification/gates-infra.md`](../verification/gates-infra.md) 的终态结论为准，前三篇的日期与「待确认」表述是当时状态。
>
> 接入设置与访问控制的规格见 [`../specs/2026-11-22-g2-access-settings-design.md`](../specs/2026-11-22-g2-access-settings-design.md)，部署与恢复见 [`../guides/access-settings.md`](../guides/access-settings.md)。

## 逐条合并记录

### 2026-11-12-g1-review-g2-access.md

日期：2026-11-12；所有时点使用 Asia/Shanghai。C：平台为本清单总责。本文落实本次“2026-11-13 前完成 A/B 契约评审”的执行目标；具体时点为建议安排，尚未得到 A/B 或外部交付方确认。

**2026-11-22 更新（G1 放行决定）**：经人工决定，G1 不再要求 A/B 业务回执，也不再以两位人类评审人签字为前置，G1 确定放行。技术侧依据为第 1 节 G1 条所列验证结果与第 4 节核对记录。该决定只针对 G1：不改变第 3 节 G2 五项外部接入的未完成状态，不免除 T05/T06/T07/T12 对真实外部设施的验收，也不把 11-12/11-13 的原始措辞判为失效——凡与本段及第 1 节 G1 条冲突的旧措辞，均以放行决定为准，原文保留作历史记录。

#### 1. 当前状态与交接入口

- **G1：2026-11-22 经人工决定放行，A/B 业务回执与人类签字不再作为前置。** 历史状态（11-12 至 11-21）：代码候选已验证、独立代码评审及修正复核完成，曾因“A/B 无实际回执”保持待人工通过；期间 C 补齐 `packages/contracts` 运行时校验、错误码和合成 fixtures，独立审查四项 P2 已修正。技术侧结论为契约 145/145、根测试 162/162、浏览器 11/11、全图实际构建与类型检查通过，修正提交 `0a2a3d6`，详见新增验证记录；放行不改变这些未覆盖边界：真实鉴权、文件头/MIME/图片尺寸、注册表与存储一致性仍须后续 T05/T06/T07 验收，合成 fixtures 不替代真实产物与外部消费者记录。后续若发现关键字段或示例语义未对齐、必需反例被错误放行、摘要/来源/报告关联存在绕过、校验测试/类型/构建失败，回退本条放行结论并按“G1 阻断条件”处理。
- **G2：本地三存储已实测，完整接入仍未完成，目标仍为 2026-11-18。** 初次核对时只有 infra README；本轮按用户确认新增隔离 Compose、真实 `test:infra` 与接入检查，见 [本轮记录](docs/verification/gates-infra.md)。OIDC 和独立预览域暂无资源，检查返回未配置；真实登录、wildcard DNS/TLS 和沙箱授权仍待后续验收。
- **T01：未完成。** G1 已于 2026-11-22 获人工放行，不再是 T01 的前置；T01 仍待 G2 真实外部设施验证，工程健康检查不作为 G2 通过依据。
- A/B 与运维真实联系人、联系渠道和可用时间待确认。本文没有发出通知、联系运维或取得签字的记录；后续须据真实反馈填写。2026-11-22 起 G1 不再要求 A/B 业务回执，但第 3 节 G2 五项的外部联系人、参数与资源仍待确认，不因 G1 放行而视为已解决。
- 用户回复“评审就行”，本轮按角色完成代码评审与修正复核，不追加实名收集；下列 A/B 建议时点保留。原文“未收到的业务回执仍明确待完成”自 2026-11-22 放行决定起不再适用于 G1；第 4 节代理会话核对记录继续有效。

| 评审材料 | 路径 | 用途 |
| --- | --- | --- |
| 契约入口与调用说明 | `packages/contracts/README.md` | 运行时入口、错误码、字段和校验边界 |
| 正常与失败 fixtures | `tests/fixtures/releases/g1/` | 合成 manifest/报告/文件样本及预期失败；不是实际截图或兼容性证据 |
| 本次命令与边界记录 | `docs/verification/gates-infra.md` | C 收录实际 RED/GREEN、构建、类型和测试结果后交接 |
| 实施任务清单 | `docs/plans/2026-11-12-g1-contracts-platform.md` | 本次代码范围、约束及执行进度 |
| 原验收基线 | `docs/plans/2026-11-11-component-platform-implementation.md` 第 2.2–2.3 节、T01 | 字段、关联、来源、API 与验收依据 |

#### 2. A/B 评审分工与建议时点

| 负责人 | 必须核对的内容 | 建议交付时点 | 当前状态 |
| --- | --- | --- | --- |
| C：平台 | 交付同一版本的 README、schema、错误码、fixtures 和真实验证记录；列出接口与尚未验证边界 | 2026-11-12 完成候选材料整理 | 已完成代码验证、独立审查与四项 P2 修正复核；材料可交接 |
| A：SDK | `ready: Promise<void>`、`runState(name): Promise<void>`、`getChecks(): CheckResult[]`；示例状态/就绪语义、Vue/React 对等、renderer/theme/尺寸/fixture 摘要；一个框架通过不能推断另一框架通过 | 2026-11-13 12:00 前反馈问题或明确回执 | 待联系人确认、待实际评审 |
| B：CLI/画廊 | build→pack 一次→冻结→干净消费者安装→截图→报告→上传同一 tarball；逐实现截图及框架/版本/示例/状态关联、环境键、报告证据、web 手动来源；API 请求响应和失败 fixtures 是否可由 CLI/画廊消费 | 2026-11-13 12:00 前反馈问题或明确回执 | 待联系人确认、待实际评审 |
| C：平台 | 汇总 A/B 反馈，修正契约及 fixtures，重跑受影响验证；登记接受/拒绝理由、遗留项和回执所对应提交 | 2026-11-13 17:00 前建议收口 | 2026-11-22 已放行，A/B 回执不作前置；后续发现阻断项再按“G1 阻断条件”收口 |

以上 12:00/17:00 仅为协调建议，不冒充已确认会期。若无法按该时点安排，C 当天记录实际截止时间、原因和影响；不得静默恢复为原 11-16 目标或自动把未回复视为同意。

##### 评审检查清单

- [ ] 正常 fixtures 可通过运行时结构与关联校验；调用方输入保持 `unknown` 直到校验成功。
- [ ] 缺图、跨框架借图、错 variant/包版本/示例、错摘要、伪造来源和路径穿越反例按预期拒绝，错误码与字段路径可定位。
- [ ] 自动截图/兼容性 `passed` 只能关联匹配报告；web 提交使用 `manual-upload` / `unknown-manual`，没有本地报告不能伪造自动检查通过。
- [ ] A 确认示例协议及双框架语义，B 确认冻结产物、截图/报告/API 和失败样本可用。
- [x] C 记录真实验证命令与退出结果、评审提交版本和未覆盖边界后提请 G1 人工通过。2026-11-22 已放行；其中“非作者回执”一项经人工决定豁免，A/B 侧以第 4 节代理会话核对记录代替，不作为 G1 阻断条件。

##### 可填写回执模板

```text
角色：A / B / C
实际评审人：待填写
联系渠道或评审记录链接：待填写
评审日期时间（Asia/Shanghai）：待填写
评审分支与提交：待填写
已检查材料与用例：待填写
实际运行命令及结果/证据路径：待填写（未执行须直写未执行）
结论：待评审 / 阻断 / 通过（仅由实际评审人填写）
阻断问题、错误码或字段路径：待填写
修正责任人、建议期限与复核结果：待填写
未覆盖边界：待填写
```

##### G1 阻断条件

关键字段或示例语义未对齐、必需反例错误放行、摘要/来源/报告关联存在绕过、校验测试/类型/构建失败，任一项均使 G1 回到不通过，并回退 2026-11-22 的放行结论。原列首项“A/B 无实际回执”经 2026-11-22 人工决定豁免，不再是 G1 阻断条件；该决定只针对 G1，不影响第 3 节 G2。API 契约样例只用于开工，真实鉴权、文件头/MIME/图片尺寸、注册表与存储一致性仍须后续 T05/T06/T07 验收；合成 fixtures 不替代真实产物与外部消费者记录。契约冲突由 C 统一收口，先改契约和 fixtures，再由各责任人修改调用方。

#### 3. G2 五项接入责任、日期与证据

**每项唯一接入总责均为 C：平台。** 外部角色负责资源或权限交付，实名全部待项目方确认，不把兼职运维虚构为已到位人员。以下日期均为计划、待外部交付方确认；总目标 2026-11-18 不变。

| 接入项 | 接入总责 / 外部交付角色 | 必须确认的参数或资源 | 计划交付与验证日期 | 必须保留的实际证据 |
| --- | --- | --- | --- | --- |
| OIDC | C / 身份系统管理员，实名待确认 | issuer；网页与 CLI 客户端；网页回调和 CLI PKCE/本机回环；测试账号；reader/publisher/maintainer 与组件授权映射 | 11-13 确认联系人/参数；11-16 交付客户端和测试身份；11-17 首轮鉴权验证；11-18 汇总复核 | 脱敏配置与实际登录/PKCE/回调结果、身份 subject 一致性、角色拒绝与撤销验证；未具备业务授权接口的项明确保留给 T05 |
| PostgreSQL | C / 数据库运维，实名待确认 | 固定版本、镜像摘要、开发实例、连接/权限注入方式、持久卷、迁移与恢复入口 | 11-13 确认联系人/资源；11-16 交付实例；11-17 实际写读；11-18 重启/恢复复核 | 版本/digest、迁移与约束核对、写读及进程重启后的持久化/恢复记录；T06 作业唯一约束与租约另行验收 |
| Verdaccio | C / 制品库运维，实名待确认 | 固定版本、独立持久卷、registry/npm scope、平台发布专用写账号、开发者只读消费凭证 | 11-13 确认联系人/权限；11-16 交付 registry/账号；11-17 隔离测试包发包与精确安装；11-18 重启/权限复核 | 实际 publish/install、包版本和 tarball 摘要、同版本不可变行为、只读账号禁止写入、重启后可获取；不删除重发已发布版本 |
| MinIO | C / 对象存储运维及维护负责人，实名待确认 | 正式 Release 源码 commit、可复现自构建镜像 digest、维护/漏洞处置责任、私有 bucket/prefix、服务端权限与密钥注入、持久卷/备份 | 11-13 确认维护责任与来源；11-16 交付隔离实例/镜像；11-17 S3 写读及摘要；11-18 重启/恢复复核 | 源码/构建与镜像摘要记录、S3 put/get 及字节摘要、私有访问拒绝、持久化和备份恢复结果；不使用浮动旧镜像代替维护方案 |
| 独立预览域 | C / DNS/TLS 管理员，实名待确认 | 与主平台不同的注册域、逐 variant release origin、wildcard DNS/TLS、网关路由和只读静态资源授权方案 | 11-13 确认域所有权/联系人；11-16 交付 DNS/TLS；11-17 解析与证书验证；11-18 方案复核 | 解析与证书链记录、独立注册域/origin 核对、短期 preview grant 和撤销的测试方案；真实网关资源隔离与浏览器攻击用例仍由 T07 验收 |

所有日期年份均为 2026，时区为 Asia/Shanghai。三存储验证只使用隔离开发实例/测试资源。密码、token、client secret、Cookie 和存储写密钥通过环境或密钥管理注入，不进入本表、回执、仓库或验证日志。

##### 接入回执与阻塞登记

```text
接入项：OIDC / PostgreSQL / Verdaccio / MinIO / 独立预览域
接入总责：C
外部交付人实名及渠道：待确认
计划日期 / 对方实际确认日期：待填写 / 未确认
已提供参数与权限（只记名称，不记秘密值）：待填写
验证环境、固定版本或摘要：待填写
实际命令、执行日期与证据路径：待填写
状态：待联系人确认 / 待资源 / 待验证 / 阻断 / 已有证据待审
阻塞、影响任务、解决责任与下一日期：待填写
```

截至本清单建立，五项均为“待联系人确认/待验证”，没有已确认接入日期或实测结果。2026-11-13 仍无联系人或必要参数、任一计划交付延迟、验证失败时，C 当天暴露阻塞并更新影响任务（T05/T06/T07/T12）；不能把适配器、stub 或健康检查等价为 G2 验收。设施就绪后再添加执行真实操作的 `test:infra`，缺命令期间不填假通过。11-18 只对有完整实测记录的项目发起验收，其余保留未完成。

#### 4. A 侧核对记录（2026-11-13，SDK 代理会话提交；原待 A 的实际评审人签字，2026-11-22 经人工决定不作为 G1 前置）

本节由 A 侧代理会话按上文模板填写，记录**实际完成的核对与证据**，不代替人类评审。2026-11-22 之前按 G1 阻断条件，结论栏仅由实际评审人（人类）填写，本节因此不标记「通过」；自 2026-11-22 人工放行决定起，人类签字不再是 G1 前置，本节结论以 4.1–4.3 的协议层面核对结果为准，未覆盖边界仍按 4.3 保留。

```text
角色：A（SDK）
实际评审人：待 A 侧人类评审人填写（本节为 A 侧代理会话提交的核对记录）
联系渠道或评审记录链接：待填写
评审日期时间（Asia/Shanghai）：2026-11-13
评审分支与提交：feat/t10-sdk-compatibility，基线 main 885792b；
  本轮提交 383d165（T09 展示矩阵证据）、6ba03e7（T10 兼容策略）
  收尾追加 96b9cd4（文档：证据核对/兼容验证/回退/G1 回执）、
    afa92ad（test：SDK 兼容策略测试更名 sdk-compatibility.test.ts + 两处类型声明修正）、
    bf0bfa1（chore：版本号升至 0.0.7）、f35ebc9（docs：版本边界与测试归属说明）、
    1920b24（docs：0.0.7 回归实测与 packed-consumer 超时说明）、
    a9fba5e（docs：test:browser 全量计数修正为 185）
已检查材料与用例：
  - packages/contracts/src/examples.ts：ComponentExample / CheckResult / ExampleRef / ScreenshotRef
  - examples/{vue,react}/src/example/runtime.ts 两份就绪协议实现
  - 14 个组件示例页（7 Vue SFC + 7 React TSX）的协议挂载点
  - tests/contracts/example-capabilities.test.ts
  - tests/browser/capture-ready.spec.ts（CLI 侧 captureExample 驱动）
实际运行命令及结果/证据路径：
  - pnpm exec playwright test --config tests/playwright.config.ts capture-ready
    → 3 passed（ready→runState→getChecks 全流程、page_error 阻断、ready_timeout 抛错）
  - pnpm exec playwright test --config tests/playwright.config.ts component-matrix
    → 96 passed（含每组件的 click_payload 与双框架交叉比对）
  - pnpm exec playwright test --config tests/playwright.config.ts framework-lifecycle
    → 4 passed（同点击载荷、StrictMode、KeepAlive、SSR 导入无 DOM 访问）
  - pnpm exec playwright test --config tests/playwright.config.ts presentation-matrix
    → 56 passed（本轮新增，light/dark × canvas/svg × 14 实现）
  - pnpm exec vitest run tests/contracts/example-capabilities.test.ts → 通过
  - 证据：docs/verification/sdk-charts.md、
          docs/verification/sdk-release.md
结论：协议层面未发现阻断项（见 4.1）；代理会话不代替人类评审，人类签字按 2026-11-22 决定已非 G1 前置
```

##### 4.1 核对结论（协议层面未发现阻断项）

- **协议形状与契约一致**：`ready: Promise<void>`、`readonly states?: readonly string[]`、`runState(name): Promise<void>`、`getChecks(): CheckResult[]` 四项在 14 个示例页全部齐备，挂载点为 `window.__COMPONENT_EXAMPLE__`，未做 DOM 全局增强，与契约注释一致。
- **`states` 只作发现，不作执行清单**：runtime 用 `states` 渲染状态按钮与枚举可选状态，真正驱动截图的是调用方传入的 `requiredStates`；`runState` 对未知状态名抛错。与契约中「Optional discovery only; ExampleRef.requiredStates remains the execution checklist」一致。
- **`getChecks()` 返回四项**：`single-instance`、`no-page-error`、`series-match`、`renderer-match`，`status` 取值只有 `'passed' | 'failed'`，与 `CheckResult` 一致；`message` 携带可定位信息（实例/画布数量、期望与实际系列 id、声明渲染器与实际 DOM）。
- **就绪判定不用固定 sleep**：`arm()` 等 `document.fonts.ready` + 系列快照变化 + 控制器 `whenRendered()`，超时 10s 抛错。同一状态重复应用时复用当前就绪 Promise，避免等待永不出现的变化。
- **双框架对等有实证**：两份 runtime 除导入源一行（`@company/charts-vue` / `@company/charts-react`）外逐字节相同；14 个示例页的协议挂载、状态枚举与自检项完全一致。点击载荷在两框架上经 `*_click_payload_matches_in_both_frameworks` 交叉比对通过。

##### 4.2 提请 C 关注的契约观察（不阻断，建议收口时裁定）

1. **`ExampleRef.theme` 是自由字符串**，而 `charts-core` 只接受 `'light' | 'dark'`；同结构的 `renderer` 已约束为 `'canvas' | 'svg'`。建议要么把 theme 也约束为联合，要么在契约中写明允许值集合。本轮起示例页的主题可由 URL 查询参数切换，`ExampleRef.theme` 必须记录**实际使用**的主题而不是常量，否则截图与记录的主题会不一致。
2. **`Renderer` 有两个定义源**：`packages/contracts/src/examples.ts` 与 `packages/charts-core/src/types.ts` 各自声明 `'canvas' | 'svg'`。公开包不能依赖私有 `@company/contracts`，因此无法单向复用；建议在契约或规则中明确「两边取值集合必须一致，变更时同步」，避免漂移。
3. **`ready` 超时会转成页面错误**：`installPageErrorCollector` 把未处理的 rejection 计入 `no-page-error`，因此就绪超时的表现是自检失败而非挂起。这是合理设计，但建议在契约 README 中写明，便于 B 侧 runner 区分「超时」与「渲染错误」两类失败。

##### 4.3 A 侧未覆盖边界

- 真实截图与报告上传链路未执行：需要 B 的 CLI 冻结产物、C 的 API 与真实三存储；`ExampleRef.fixtureDigest` 与 `ScreenshotRef.packageSha256` / `environmentKey` 的端到端关联未实测。
- 人工目视检查未执行（深色主题对比度、标签裁切、两框架并排比对）。
- Windows 开发机原生验证未执行；本节全部结果来自 Linux 复现环境。
- `manual-upload` / `unknown-manual` 的来源边界只在契约与 CLI 单测层核对，未经网页提交路径实测（属 B/C 范围）。

### 2026-11-12-g2-local-infra.md

> **For agentic workers:** 使用 executing-plans 串行实施，行为变更先 RED 再 GREEN，最后独立审查。

**Goal:** 交付可实际运行的本地 PostgreSQL/Verdaccio/MinIO、真实非缓存验收及 OIDC/预览域接入检查工具，收口示例状态契约。

**Architecture:** 开发设施采用独立 `zhinexus-g2` Compose 项目和命名数据卷，只绑定本机回环地址；不复用其他项目容器。验证工具在开发机执行，使用真实数据库/注册表/S3 操作并重启本项目服务后复核。服务端应用不引入构建/截图能力。

**Tech Stack:** 现有固定 Node/pnpm；Docker Desktop Linux amd64；PostgreSQL 18.6、Verdaccio 7.1.0；MinIO RELEASE.2025-10-15T17-29-55Z 从固定 commit 构建。新测试客户端仅加根 devDependencies，精确版本与镜像摘要记录于 infra/versions.json。

**Spec:** 本次用户明确授权执行 C 的任务，并确认“暂时没有，先完成本地三存储和接入检查工具”；原实施计划 T01/G2、三人分工和 rules/security.md 为约束。

#### Global Constraints

- C 仅修改 contracts、infra、根配置及所属测试/文档，不修改 SDK/CLI/画廊实现。
- OIDC/独立注册域没有现成资源；缺参数必须返回未配置/非零状态，发现文档或 TLS 成功不冒充真实登录或沙箱验收。
- 示例以 ExampleRef.requiredStates 为执行清单；ComponentExample.states 为可选枚举，不改变既有必需方法，不以单框架结果推断另一框架通过。
- 三存储只使用本项目隔离开发资源，测试包使用每次唯一名称，禁止删除重发；重启仅操作本 Compose 的服务，不删除卷。
- 凭证随机生成到被忽略的 .tools/g2-local，使用 Compose secrets/环境注入；不打印、不提交密码和 token。
- 不修改原始架构；不覆盖历史验证记录；不推送、不合并。G1 人工回执和完整 G2/T01 保持独立。

#### Review Focus

1. 新契约仍接受没有 states 的既有示例；必需状态不从可选枚举推断。
2. 本机已存在其他 PG/MinIO，端口、卷、Compose 项目和重启范围必须隔离。
3. 每次测试执行实际写读、精确安装和摘要校验；失败/未配置不能返回成功。
4. 注册表 reader 不得发布、匿名请求不得读取私有资源；已发布包字节重启前后一致。
5. 预览域按注册域判断，拒绝同一注册域的不同子域；OIDC 检查不能误称登录已通过。

##### Task 1：契约收口

**Files:** contracts/src/examples.ts、index.ts、contracts README、tests/contracts/example-capabilities.test.ts、评估/实施计划补充。

**Interfaces:** `ComponentExample.states?: readonly string[]`、`COMPONENT_EXAMPLE_GLOBAL`；既有 ready/runState/getChecks 保持不变。

- [x] 增加类型兼容测试：旧示例、只读枚举、错误成员类型；类型检查 RED 后增加可选字段/常量。
- [x] 文档确定 requiredStates 为权威清单、未知状态 reject、每个状态等待就绪后检查。
- [x] contracts 构建/类型与契约测试通过后聚焦提交。

##### Task 2：设施启动与真实验收

**Files:** infra/compose.yaml、minio/Dockerfile、verdaccio/config.yaml、versions.json、scripts/{local,check,access,access-config}.ts；根 package/lock/tsconfig；tests/infra/*.test.ts。

**Interfaces:** `infra:up` 初始化本地随机凭证并构建固定 MinIO、启动服务；`infra:stop` 停止但保留卷；`test:infra` 执行三存储写读/权限/重启持久化与备份恢复探针，输出脱敏报告；`infra:check-access` 检查可选 OIDC/域名配置，未配置退出 2。

- [x] 接入配置/元数据反例先 RED：缺字段、HTTP/带凭证 URL、同注册域、issuer 不匹配、缺 PKCE S256。
- [x] 固定所有镜像/source 摘要，生成独立配置与 Compose secrets；先运行 compose config 验证模型。
- [x] 实现真实 PostgreSQL、npm publish/install 和 S3 探针，重启后验证同一数据；隔离备份恢复目标，不删除原数据。
- [x] 启动并运行 test:infra 两次，确认每次真实执行；记录镜像 ID、数据摘要和结果。
- [x] 缺少外部配置时实测 access 命令非零，增加可供后续接入的无秘密配置示例。
- [x] 全图 build/typecheck/test/browser、workspace 检查与独立审查；新增验证记录并提交。

#### Execution record

- 起点 main 471ae8e，工作区干净；开发分支 feat/g2-local-infra。
- 本机 Docker Engine 29.8.2 / Compose 5.5.1 可用；现有 5432、5433、9000 等属其他项目，使用 15432/14873/19000。
- 基线 contracts 145/145 通过。用户已确认无现成 OIDC/独立预览域，本轮只交付对应接入检查工具。
- Task 1 已提交 d18ce0e；Task 2 独立审查两项 P2（S3 超时、管理 API 注册域）均已 RED→GREEN 修复。最终独立工作树全图 build10/type14 无缓存、根198、浏览器15、设施17 测试通过，修复后真实三存储再次两轮通过；证据见 docs/verification/gates-infra.md。
- 共享目录被 CLI 工作切换分支后，C 在独立工作树 feat/g2-local-infra 提交，保留源目录已有修改；最终代码以 C 分支为准。不合并、不推送，完整 G1/G2/T01 状态不变。

### 2026-11-22-g2-access-settings.md

依据 [已批准设计](docs/specs/2026-11-22-g2-access-settings-design.md)。本轮交付配置能力和本地验证。真实公司账号、撤权时限和独立域名的证据仍按 G2 验收。

1. C 冻结 contracts 的接入配置、版本、证据、审计和预览隔离字段。先测非法端点和额外正文键，再实现解析器。维护 PostgreSQL 草稿和活动指针，保存、验证和启用均校验期望版本。启用和回退使用新的活动代数，防止旧会话或预览授权复活。管理端点在事务写入前检查独立管理员授权。
2. C 实现 OIDC Discovery/JWKS、服务端 Web PKCE 回调与会话、候选 Web/CLI 实测证据、活动 issuer 与角色映射。使用部署注册的管理员身份和受限的个人迁移映射；每次受保护访问核对停用和角色限制。测试 nonce、错误客户端、候选权限隔离与配置切换。B 实现 CLI 回环授权与显式令牌兼容。
3. C 实现受限 HTTPS 出站、多个逐发布 host 的 DNS/TLS/网关检查、API 与网关共读活动版本。测试 IP SAN、错入口、切换和回退后的旧授权拒绝。B 根据授权内的 mode 选择 iframe 沙箱。
4. B 实现画廊「接入设置」、正常公司登录、字段编辑、验证、启用或回退和审计展示。管理 API 拒绝普通用户直接调用。用画廊与 CLI 测试验证正常入口和错误提示。
5. C 写运维接入和恢复说明，以及本地验证报告。跑结构检查、全图类型检查、测试、构建、浏览器及有环境的服务验证。记录命令、退出和外部待验项，再进行代码审查与独立版本提交。

接口以 `packages/contracts/src/access-settings.ts` 为共同边界。HTTP 配置位于 `/v1/access-settings` 下，OIDC 授权位于 `/v1/auth/oidc` 下。API、网关查询同一活动指针；浏览器与 CLI 只消费 HTTP 契约。

#### 2026-11-22 本地执行结果

本计划 1–5 项本地实现已完成，并完成一轮独立审查处置、强制全图构建/类型检查、根回归、148 项真实平台回归、画廊域名/IP 浏览器验证和冻结 CLI 安装产物补验。条件跳过的冻结 SDK 用例已单独补齐。根版本升至 0.0.9，相关包独立升级并记录 CHANGELOG；所有提交保留在 `feat/g2-access-settings`。

实际命令、失败与 RED → GREEN、最终退出码、冻结摘要和提交列表见 [新增验证记录](docs/verification/gates-infra.md)，部署与恢复见 [操作说明](docs/guides/access-settings.md)。真实公司账号、撤权目标与时延、生产 DNS/TLS/凭据及双业务试点仍为 G2 外部待验，G2/T01 不因本地实现而关闭。

### 2026-11-22-g2-five-item-acceptance.md

日期：2026-11-22（Asia/Shanghai）；负责人 C / Codex；基线 `6511ba77`；分支 `chore/g2-five-item-acceptance`。

用户明确要求完整 G2 为五项接入验收，每项留下实测记录。沿用[同汇编内的 G2 接入清单](#2026-11-12-g1-review-g2-accessmd)，本轮只补充验收测试与记录，不修改业务实现、公共契约、原架构或已有历史验证记录。用户工作区中的 README 修改保留且不纳入提交。

| 接入项 | 本轮执行与验收条件 | 状态 |
| --- | --- | --- |
| PostgreSQL | 真实载荷写读、唯一约束、实际进程重启后的载荷摘要、备份到另一个数据库的真实恢复 | 隔离本机实测通过；公司部署实例仍待接入 |
| Verdaccio | 一次打包冻结、专用写账号发包、工作区外新缓存消费者精确安装、只读写入拒绝、匿名读取拒绝、重复发布 E409、重启后同一 tarball 摘要 | 隔离本机实测通过；公司部署实例与凭证交付仍待接入 |
| MinIO | 私有对象真实 put/get、SHA-256、匿名 403、进程重启持久化、备份恢复到新对象且原对象不变、固定 release/commit/image ID | 隔离本机实测通过；生产最小权限与维护责任仍待接入 |
| OIDC | 真实网页与 CLI PKCE/回调、客户端注册、角色拒绝与撤销；元数据检查不能替代真实登录 | 接入工具实测未配置，退出 2；真实验收未完成 |
| 预览接入 | 目标入口解析/证书链、逐发布授权与撤销、真实浏览器隔离；默认正式门槛为独立域，已授权 IP 分 HTTPS 端口用于试用 | 接入工具实测未配置，退出 2；目标环境验收未完成 |

#### 执行范围与方法

- 原共享 Compose 三存储仍运行，但当前工作区缺少其凭证；`test:infra` 实测在 preflight 退出 1。不得重生成凭证、改动共享持久卷或从其他项目借用服务。
- 复用仓库现有 `RecoveryStack` 创建唯一标签、回环随机端口与自有命名卷。增加 `tests/platform/g2-storage-acceptance.test.ts`，每轮实际操作服务并分别记录三项检查，清理仅作用于本轮所有权资源。
- 本轮是已有行为的接入验收，不新增产品行为。前四轮验收脚本失败保留原报告；分别适配 npm UUID 输出脱敏、项目 registry 配置优先级、Windows 跨盘路径、Docker 重启随机端口。第五、六、七轮完整实测通过。不得把脚本失败改写为通过。
- 独立审查指出消费者目录删除失败可能跳过栈清理，以及取得栈之后的初始化不在清理边界内；已用独立 `finally` 和外层资源保护修正，将两种清理结果分开记入报告。第六、第七轮分别真实复验通过。
- 不等待 OIDC/目标预览资源即可完成三存储实测，但不得由此勾选完整 G2/T01。

#### 验证与记录

- [x] 固定工具链、真实服务镜像与原架构摘要核对。
- [x] 强制服务构建及类型检查、根 TypeScript、工作区边界、19 项设施单测。
- [x] 三存储完整真实探针三轮通过，各 9 条分项检查；保留失败及修复过程。
- [x] 默认接入配置与两个真实命令的非零退出实测；分别记录 OIDC 和预览阻塞。
- [x] 独立审查、逐文件证据 SHA-256 复读、敏感字段检查及聚焦提交。
- [ ] 公司 OIDC 登录、CLI PKCE、角色与撤销接入验收。
- [ ] 目标预览入口证书/解析、授权撤销与浏览器隔离接入验收。
- [ ] 正式部署实例、账号最小权限、责任人与五项接入回执齐全后的完整 G2。

实际命令、报告、摘要及未覆盖边界见 [本轮验证记录](docs/verification/gates-infra.md)。原 2026-11-18 接入目标已过去，本轮不填未经确认的新交付日期。
