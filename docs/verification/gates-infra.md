# 门禁与工程基建验证汇编（G1/G2、bootstrap、turbo、迁移与运维）

> 本文件由 `docs/verification/` 下 16 篇逐次验证记录合并而成（2026-11-22，`chore/docs-consolidation` 分支）。合并范围：`bootstrap.md`、`bootstrap-review.md`、`g1-contracts-2026-11-12.md`、`g1-t10-closeout-2026-11-21.md`、`g2-access-settings-2026-11-22.md`、`g2-example-contract-2026-11-12.md`、`g2-five-items-2026-11-22.md`、`g2-local-infra-2026-11-12.md`、`g2-main-merge-2026-11-12.md`、`gallery-next-migration.md`、`nest-react-bootstrap.md`、`preview-ip-port-2026-11-21.md`、`scripts-maintenance-2026-11-12.md`、`self-managed-accounts-2026-11-22.md`、`turbo-baseline.md`、`t11-pilot-rehearsal-2026-11-21.md`。原件已按主题合并删除，git 历史可追溯，信息不灭失。每篇原记录以 `### <原文件名>` 为标题完整保留于「逐条合并记录」。总索引见 `docs/README.md`。
>
> 一条贯穿全部 16 篇原记录的不变事实：**原始架构文档 `component-platform-architecture.md` 的 SHA-256 始终为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`**（多数记录写作全大写 `E59BB77...`，同一值），每一次验证前后核对均未变化。
>
> 原始记录中的命令、路径、hash、分支名、退出码一律按当时原貌保留；早期记录里的旧入口命令（如 `scripts/verify-bootstrap.ps1`、`scripts/generate-contract-schemas.ts`）已被 `scripts-maintenance-2026-11-12.md` 的入口映射表取代，阅读早期记录时不要直接复跑其中的命令。

## 终态结论

**G0 工程基建**

已完成，并被两次技术栈调整覆盖。2026-11-11 一天之内完成三件事：首次 bootstrap（`bootstrap.md` + `bootstrap-review.md` + `turbo-baseline.md`）、NestJS 化（`nest-react-bootstrap.md`）、画廊 Next 化（`gallery-next-migration.md`）。固定 Node 26.13.0 / pnpm 12.18.0 / Turbo 2.11.10 到项目 `.tools`；workspace 10 成员、4 个公开包壳、服务依赖边界通过；build 10/10；typecheck 14 个 Turbo 任务 + 根 tsc。`turbo-baseline.md` 的任务图（API/网关为 `tsc -p tsconfig.build.json`）与 `bootstrap.md` 的 Fastify/React+Vite 叙事均已过时，`nest-react-bootstrap.md` 与 `gallery-next-migration.md` 是权威。

**G1（契约 + 人工放行）**

**G1 已获人工放行**：2026-11-22 决定，A/B 业务回执不作前置。在此之前，G1 的措辞逐轮演变——`g1-contracts-2026-11-12.md` 阶段为「代码候选验证通过；G1 人工门槛仍未通过」「没有替 A/B 伪造业务签字」；`g1-t10-closeout-2026-11-21.md` 阶段为「A/B 技术审查及修正复核已完成，实际评审人的业务回执和人工通过结论待签署」，并规定「缺任一实际回执时保持待人工通过」。技术侧数据：契约 **522/522**（18 文件）、根 Vitest **2271/2271**、`test:browser` **306/306**、CLI 0.0.25、SDK 0.0.11/0.0.12。

**G1 已获人工放行不得外推为 G2 放行。G2 仍不通过**——缺真实外部资源（公司 OIDC issuer/clients/回调、生产 DNS/TLS、生产凭据、真实业务试点），不是签字问题。

**G2（五项外部接入）**

完整 G2 为五项：PostgreSQL / Verdaccio / MinIO / OIDC / 预览接入。最新且最权威的结论来自 `g2-five-items-2026-11-22.md`（基线 `6511ba77`）：前三项 `local-measured-passed`（隔离本机实测通过），OIDC 与预览接入 `unconfigured`，`infra:check-access` 与 `access.ts` 均退出码 2，两次接入检查都保持 `g2Ready: false`，`productionAcceptance: false`。引用 G2 状态时必须写「五项中三项本机实测通过、两项未配置、完整 G2/T01 未完成」，**不得写「G2 已通过」**。

`g2-access-settings-2026-11-22.md` 把「接入设置」这项能力本身完整落地（9 个实现提交、独立审查 Critical 0 / Important 9 全修、`test:platform` 148/148、根 `test` 2306 通过 + 2 跳过共 2308、`test:t10` 168/168、`test:browser` 域名模式 317 通过 + IP 模式 4 通过、仓外安装 CLI 0.0.26 凭据消费通过），`verify:deployment` 输出 `templateValidated=true / environmentValidated=false / productionAcceptance=false`——证明模板有效，**不能读作部署已就绪**。真实公司账号、撤权时限、生产 DNS/TLS、生产凭据、双业务试点仍是外部输入，G2/T01 不因此关闭。

迁移线：接入设置线为 **001–011**（迁移 010 不把旧状态升级成新证据，迁移 011 让缺少角色来源的旧预览授权失败关闭）；自管账号线另新增 `012_managed_accounts.sql`。引用「当前迁移号」时须说明是哪一条线。

**turbo / scripts**

缓存语义已用三个日志固化：不修改输入 10/10 命中（`build-repeat.log`）、core 加临时注释后 core/两框架/两示例共 5 项失效而其余 5 项命中（`build-core-change.log`）、字节级恢复后 10/10 再命中（`build-restored.log`）。`scripts-maintenance-2026-11-12.md` 把根 scripts 从 8 个文件减为 5 个，确立四组入口迁移，是全主题「命令口径」的权威对照表。一条贯穿全主题的 Turbo 纪律：根 `build` 固定 `--cache`，Turbo 拒绝同时追加 `--force`（`pnpm build --force` 退出 1），强制构建一律改用等效 `exec turbo run build --force`（`g1-contracts-2026-11-12.md` 首次记录该退出码 1，`g2-access-settings-2026-11-22.md` 复述为执行适配而非缓存策略修改）。基础测试与浏览器测试直接调用 Vitest/Playwright，**没有进入 Turbo 缓存**。

**Next 迁移与公开/私有渲染边界**

`apps/gallery` 使用 `next build` / `next dev` / `next start`，端口仍为 5173，Next 输出目录固定为 `dist/`。`(public)` 路由提供首页和目录空状态，公开正文与 metadata 在初始 HTML 中可见；`(console)` 路由提供上传占位并使用 `robots: noindex, nofollow`；`/components/[slug]` 在真实公开目录契约和 Ready 资产接入前返回 404；sitemap 只由 `NEXT_PUBLIC_SITE_URL` 生成正式公开 URL，未配置时为空，**不写入 localhost**。A→B→A 域名切换缓存缺陷导致 gallery 专用 `build` 任务**暂时关闭 Turbo 输出缓存**（代价是每次重建），待干净恢复机制经验证后再恢复缓存。robots 保持可抓取以便读取 noindex；sitemap 仅列公开 URL；OIDC、角色与用户态缓存、公开 DTO/Ready 判定、部署/TLS/搜索效果仍属 T05/T07/G2。

**预览 IP 端口试用模式**

**经授权的试用模式，不是 G2 验收替代。** 同一 IPv4 分 HTTPS 端口：`PLATFORM_PREVIEW_MODE=ip-port`，画廊 `https://IP`、API `:8444`、预览 `:8443`，`infra/gateway/preview-ip.conf` 监听专用端口并清除 Cookie 与 Authorization，IP 入口禁止返回 Set-Cookie，预览授权五分钟且不签发预览 Cookie。正式默认门槛仍是独立注册域，未修改范围；既有本机 IP 模式测试不等同目标环境验收。

**自管账号后台**

代码与沙箱测试已合入 `main`（合并提交 `8ce44290`，未 push）；真实 Keycloak 与平台集成、浏览器验收、撤权时限、正式部署验收零实跑。版本升至根 **0.0.10** / API **0.0.12** / 画廊 **0.0.13** / 预览网关 **0.0.5** / CLI **0.0.27**，是本主题中版本号最新的一轮（取代 `g2-access-settings-2026-11-22.md` 的 0.0.9/0.0.11/0.0.12/0.0.4/0.0.26）。`main` 领先 `origin/main` 8 个提交，尚未 push；`feat/self-managed-accounts-impl` 与 `feat/self-managed-accounts` 两个分支保留未删。

**T11 试点演练**

合成演练已交付，标准项保持开放。`satisfiesRealBusinessPilot` 恒为 `false`。T11 五项标准项：第 1、5 项未完成；第 2 项（7 项故障预演 + 12 项预览授权回归，合计 19 项）与第 3 项（结构化日志与脱敏）2026-11-12 已通过；第 4 项仅 C 本地预演验证、非生产 SLA。

**文档去向（不在本汇编范围）**

docs 顶层的 5 篇操作手册——`access-settings.md`、`operations.md`、`preview-ip-port.md`、`quickstart.md`、`publishing.md`——被保留并移至 `docs/guides/`，本汇编不复述其内容；`docs/versions.discovery.json` 原地保留（版本候选发现记录，`status: "official-discovery-only"`，不改 package.json 或 lockfile，不证明兼容性）。运维准备、部署模板、容量/备份/保留回退等操作细节请直接查 `docs/guides/`。

**仍开放问题**

1. **G1 人工回执**：A（SDK）与 B（CLI/画廊）实际评审人、日期、所审提交、通过/阻断结论均待签署；规定「缺任一实际回执时保持待人工通过」。
2. **G2 OIDC 与预览接入**：公司 issuer/clients/Web 回调/CLI 回环/roleClaim 映射、`PLATFORM_ACCESS_ADMINISTRATORS`、`PLATFORM_ACCESS_OUTBOUND` 白名单、`PLATFORM_ACCESS_INITIAL_OIDC`、`PLATFORM_OIDC_SECRET_*`、`PLATFORM_ACCESS_CA_FILE` 均未由公司提供；`infra:check-access` 退出码 2。
3. **撤权时限**：提交时刻、各路径首次拒绝时刻、请求结果均未实测；公司认可的目标时限待部署负责人确认。
4. **生产部署**：Linux CI 与生产镜像构建/发布未验收；API/preview 镜像 digest 必须由组织镜像仓库提供（不得填示例 hash）；迁移身份不应拥有 DDL 权限；MinIO root 仅初始化。
5. **自管账号真实集成**：Keycloak access token 声明、首次改密 `auth_time`、Keycloak 镜像 digest、`tests/platform/managed-accounts.test.ts`、本机浏览器验收、撤权时限实测全部未做。
6. **T11/T12 与真实业务试点**：用户未提供真实业务项目访问范围；验收测试虽已补建但未执行。
7. **未 push 的合并**：`main` 领先 `origin/main` 8 个提交（自管账号 `8ce44290`），push 需用户明确授权；两个自管账号分支保留未删。
8. **gallery Turbo 输出缓存**：因 A→B→A route-cache 残留仍为 `cache: false`（每次重建），待干净恢复机制经验证后再恢复。
9. **遗留告警未治理**：React 示例约 504 kB chunk 超 Vite 500 kB 阈值、Node DEP0190、NO_COLOR/FORCE_COLOR 提示，均未导致失败也未扩大为治理任务。
10. **已知未覆盖边界**（跨主题）：CLI 上传未完成的中断恢复、异常代理回执后继续执行、浏览器 JS 跨域读取 multipart ETag 的生产配置、画廊查询超过单页 100 条明确不可用、截图报告浏览器修订默认填 1000（实测环境为 Chromium 安装修订 1254）、真实 npm 包/图片文件头/MIME/尺寸/受限解包/符号链接/真实消费者安装/源码集合摘要算法/浏览器 ready 信号实现/冻结后重打包流程、容量数字非生产 SLA、`Σ.md`/`ς.md` 本机覆盖风险未证实、SemVer 任意位数主/次/修订号不虚构安全整数上限、npm 工具可安装性留 T04/T05。

## 逐条合并记录

### bootstrap.md

- 日期／角色／主题：2026-11-11，Windows x64。角色：综合（工程初始化）。主题：技术栈调整为 NestJS/React **之前**的首次工程初始化验证。范围为 `docs/plans/2026-11-11-bootstrap-execution.md`，**不是整个 T01 的验收**。文件开头自带「历史记录」横幅，指向 Nest/React 记录为准。
- 目的：验证 `scripts/bootstrap.ps1` / `scripts/verify-bootstrap.ps1` 及 pnpm 全量初始化在 Windows x64 上真实可跑。
- 承重事实：
  - `scripts/bootstrap.ps1`：官方 Node SHA-256、pnpm 平台包 SHA-512 校验；项目本地版本探测通过。
  - `scripts/verify-bootstrap.ps1`：Windows PowerShell `5.1.26100.9444` 非交互、干净目录首次下载与缓存重跑均通过；**修复前观察到确认提示导致失败**。
  - `pnpm install --frozen-lockfile` 成功，无锁文件更新。
  - `pnpm peers check` → `No peer dependency issues found`。
  - `pnpm verify:workspace` → **10 个成员、依赖无环、4 个公开包壳、平台依赖边界通过**。
  - `pnpm build` → **10/10 构建成功**。
  - `pnpm typecheck` → 10 包类型检查 + 根 `scripts/tests` 类型检查通过（含 4 个依赖 build，共 **14 个 Turbo 任务**）。
  - `pnpm test` → **5/5 基础测试通过**；实现前观察到「CLI 未实现 + healthz 404」导致的 5 项失败。
  - `pnpm test:browser` → **3/3 通过**（画廊、Vue 示例、React 示例）；Chromium headless **158.0.8127.18 / revision 1254**。
  - `component --version` / `--help` → `0.0.0`、骨架帮助正确；`component release` 返回**退出码 1**。
  - `pnpm build:services` → 仅 contracts/API/preview-gateway，**5/5 任务**通过。
  - `pnpm dev` → 修正持久任务并发上限后 10 任务可启动；3000/3001 健康检查、5173/5174/5175 均 HTTP 200。
  - 缓存：重复构建 10 命中；core 变化 5 失效/5 命中；恢复后 10 命中（详见 `turbo-baseline.md`）。
  - 实际安装工具链：Node **26.13.0**、pnpm **12.18.0**、Turbo **2.11.10**、TypeScript **7.0.2**、Vite **8.3.8**、Vue **3.5.45**、React/React DOM **19.3.1**、ECharts **6.1.0**、Fastify **5.12.8**、Vitest **5.1.0**、Playwright **1.65.0**。
  - 四项工具链适配：
    1. pnpm 12 使用原生平台可执行文件，旧 `bin/pnpm.cjs` 入口不存在；bootstrap 按官方 `@pnpm/exe.win32-x64@12.18.0` 元数据下载并校验，启动真实 `pnpm.exe`；**不修改系统 Node 24.6.0 / pnpm 10.25.0**。
    2. pnpm 12 将安装设置放在 workspace YAML，旧 `onlyBuiltDependencies` 被 `allowBuilds` 替代；只允许 esbuild 构建，显式指定官方 registry、精确依赖、严格 peer/engine 检查；保留安装器为固定 Vite 8.3.8 生成的 release-age 例外。
    3. `vue-tsc` **3.3.14** 的 Volar 依赖要求 TypeScript `<7`，直接运行报 `ERR_PACKAGE_PATH_NOT_EXPORTED: typescript/lib/tsc`；根 TS 保持 7.0.2，仅 gallery/Vue example 的 SFC 类型检查隔离使用官方稳定 **6.0.3**（元数据见 `vue-typescript-exception.json`）。
    4. 独立审查发现 Windows PowerShell 5.1 的 `Invoke-WebRequest` 首次请求需确认，统一加 `-UseBasicParsing`；新增隔离回归先失败再通过，证据 `bootstrap-ps51-red.log` / `bootstrap-ps51-green.log`；修复后重跑完整验证见 `final-checks.log`。
  - React 示例构建约 **504 kB**，触发 Vite 500 kB 警告；按需注册/分包与体积验收留 T02/T03，不掩盖该警告。
  - 官方核对入口：`registry.npmjs.org` 的包/version 与 latest、`nodejs.org/dist/index.json` 与对应 SHASUMS256、`pnpm.io/settings/build` 的 allowBuilds。
- 结论与状态：完成（初始化子集）。**已被 `nest-react-bootstrap.md` 更新**（当前 NestJS 服务、React 画廊和编译器范围以后者为准）；缓存实验部分与 `turbo-baseline.md` 互相印证。
- 交叉引用：`nest-react-bootstrap.md`、`turbo-baseline.md`、`bootstrap-review.md`、`vue-typescript-exception.json`、`bootstrap-ps51-red.log`、`bootstrap-ps51-green.log`、`final-checks.log`、`docs/versions.discovery.json`、`docs/plans/2026-11-11-bootstrap-execution.md`、`docs/plans/2026-11-11-three-person-allocation.md`。
- 过时或矛盾点：**本文范围已过时**（Fastify 后端、React+Vite 画廊、根 TS7 单编译器叙事均被后续记录取代）。其「尚未完成」清单（G1 schema/运行时 manifest 校验、G2 三存储/OIDC/独立域、T02–T12）此后逐项被本主题其他记录部分覆盖，但**没有任何一项因此文而关闭**。

### bootstrap-review.md

- 日期／角色／主题：2026-11-11。角色：综合（独立审查）。主题：对 `fbbddd8..90015e8` 的工程初始化与三人计划的独立只读审查。文件开头自带「历史记录」横幅（审查发生于 Nest/React 调整前）。
- 目的：独立上下文只读审查，不代写实现。
- 承重事实：
  - 结论：**Critical 0；Important 1；Minor 0**，无延后小问题。
  - 唯一 Important：Windows PowerShell 5.1 首次下载时原 `Invoke-WebRequest` 会进入确认流程，非交互执行失败；已有 `.tools` 的检查覆盖不到该分支。修复统一使用 `-UseBasicParsing`，并新增 `scripts/verify-bootstrap.ps1`（从干净隔离目录调用真实 Windows PowerShell，检查首次下载、摘要、固定版本、第二次缓存运行）。
  - 回归先在原脚本上失败，错误为 `Windows PowerShell is in NonInteractive mode. Read and Prompt functionality is not available.`。
  - 实施决定表（6 项）：①在用户指定目录初始化 Git（代价：任务共用该目录，未来功能开发需各自分支/工作区）；②Node/pnpm 固定版本安装到项目 `.tools`；③只交付初始化子集，完整 T01 保持开放；④pnpm 12 原生 Windows 包与 YAML 设置（代价：需维护平台相关引导脚本）；⑤根 TS7、Vue SFC 检查隔离 TS6（代价：暂时维护两种编译器）；⑥**manifest、lockfile、`.node-version` 作为版本固定来源，避免再维护一份重复的 `versions.lock.json`**（代价：版本发现与实际安装证据需分别核对）。
  - 「审查员未验收的范围及处置」表 9 行，明确列出：G1 schema/运行时/跨文件校验、G2 三存储/重启/OIDC/域名/TLS/镜像、T02/T03、T04、T05/T06、T07/T08、T09–T12、T13–T17、非 Windows x64 运行保证（README 明示未验证）、实际出勤与兼职测试/运维到位（按三人 80% 容量估算，每周重估）。
- 结论与状态：完成（审查轮次）。**已被 `nest-react-bootstrap.md` 的独立审查（`09742a0..8e72a87`）与后续 G1/G2 各轮审查更新**。
- 交叉引用：`bootstrap.md`、`nest-react-bootstrap.md`、`docs/plans/2026-11-11-three-person-allocation.md`。
- 过时或矛盾点：本文「G1/G2 未验收」的措辞在当时正确，但**后续 `g1-t10-closeout-2026-11-21.md`、`g2-five-items-2026-11-22.md` 与 `g2-access-settings-2026-11-22.md` 已把技术侧大幅推进**；引用本文时不得再表述为「G1/G2 完全没有任何实测证据」，应表述为「人工/外部接入门槛仍未关闭」。

### g1-contracts-2026-11-12.md

- 日期／角色／主题：2026-11-12（Asia/Shanghai）。角色：C（平台）。主题：G1 V1 契约候选验证。基线提交 `8304bff`，分支 `feat/g1-platform-contracts`，使用**独立原生 worktree**。原工作区检查期间有其他工作流新增 CLI 测试且缺实现导致收集失败，未改动/收录这些文件。
- 目的：落地 contracts 运行时校验、Schema、fixtures，并做 RED→GREEN 与独立审查。
- 承重事实：
  - 交付：manifest / report / environment / example / screenshot / API 运行时校验、稳定错误码、确定性 JSON/SHA-256/环境键、实际冻结文件字节校验；导出 **23 份 JSON Schema（5 类材料 + 18 类 API 消息）**；生成器提供 `--check` 防漂移；示例接口定义 `ready`/`runState`/`getChecks`，**不执行示例**。
  - 合成 fixtures：正常 web/cli、一包多组件/双框架、缺图/错框架/错摘要/伪造来源/包冲突/路径穿越及 API/报告/字节样本。
  - **代码候选验证通过；G1 人工门槛仍未通过。** A/B 身份/联系渠道及真实回执未具备。
  - RED→GREEN 阶梯：①契约结构/关联/摘要/报告 **78 例中 71 失败、7 通过** → GREEN **78/78**；②API/schema 测试 **26/26 失败** → GREEN **104/104**；③路径/关联加固 **15 例中 10 失败、5 通过** → GREEN **120/120**；④可审查 JSON snapshots 测试 **4/4 失败** → GREEN **124/124**。
  - 补 root devDependency `@company/contracts: workspace:*`（由固定 pnpm 更新 lockfile 并冻结安装），未增加私有包的公开运行时依赖。
  - 独立审查（候选 `2b51b25`）报告 **4 项 P2，无已确认 P0/P1**；审查有一次限流中断，恢复后完成最终结论与窄范围复核。四项缺陷：①数组 getter/额外属性被接受（改为先核对普通稠密数组及 data descriptor，拒绝 accessor/额外属性/Symbol/非枚举索引/数组子类；getter 调用数为 0）；②Windows 通配符/部分设备别名放行（`*` 与 COM/LPT 的 `¹²³` 别名）；③数字预发布前导零放行（拒绝 `01`、`alpha.01`、`00.beta`，保留 `0`、`alpha.1`、`01a`）；④`passed` 聚合证据可晚于 `verifiedAt`（改为所有贡献报告均满足 `createdAt <= verifiedAt`）。
  - 补充 TDD：第一轮 hardening **12 失败 / 20 通过** → 契约 **140/140**；第二轮 hardening **4 失败 / 33 通过** → 契约 **145/145**，连续重跑两次均退出 0。
  - standalone report 返回最多 100 条错误；路径碰撞改为 NFC + Unicode 大写的保守策略。主代理实际写入 `Σ.md` 后查询 `ς.md` 不存在，因此**不记录为本机已证实的文件覆盖漏洞**。
  - 命令与退出码（均通过项目固定 Node 26.13.0 / pnpm 12.18.0 入口 `.\scripts\pnpm.ps1`，不经 Turbo 缓存）：
    - `install --frozen-lockfile` 退出 0
    - `--filter @company/contracts build` 退出 0
    - `verify:workspace` 退出 0（10 成员）
    - `exec tsx scripts/generate-contract-schemas.ts --check` 退出 0（23 份 schema 一致）
    - `exec tsx tests/fixtures/releases/g1/generate.ts --check` 退出 0
    - `exec vitest run tests/contracts` 连续两次均退出 0，5 文件、**124/124**（修正后为 5 文件、**145/145**）
    - `exec turbo run build --cache=local:w` 退出 0，**10/10 实际执行、0 cache hit**
    - `typecheck` 退出 0（服务前置 + 全图 14/14 + 根 tests/scripts）
    - `test` 退出 0（Vitest **7 文件、141/141**；修正后 **7 文件、162/162**）
    - `test:browser` 退出 0，**11/11**（新增 Chromium 直接加载 contracts 真实 ESM，验证同一 bundle 与 Web Crypto 摘要）；运行前确认 5173–5175 无占用
    - 服务筛选 `exec turbo run build typecheck --filter=@company/platform-api --filter=@company/preview-gateway --dry=json` 退出 0，实际图仅 contracts#build + 两个服务各 build/typecheck，共 **5 任务**
    - `git diff --check` 退出 0
    - `Get-FileHash -Algorithm SHA256 component-platform-architecture.md` → 基线值不变
    - **一次尝试 `pnpm build --force` 退出 1**（当前 Turbo 不允许显式 `--cache` 与 `--force` 同用）；改用等价 `--cache=local:w`。
- 结论与状态：完成（代码候选）。**被 `g1-t10-closeout-2026-11-21.md` 更新**（契约计数从 145/145 增至 **522/522**）。G1 人工门槛在该篇记录时点仍未通过；2026-11-22 已决定 G1 获人工放行（A/B 业务回执不作前置）。
- 交叉引用：`g2-example-contract-2026-11-12.md`、`g2-local-infra-2026-11-12.md`、`g1-t10-closeout-2026-11-21.md`、`docs/plans/2026-11-12-g1-review-g2-access.md`。
- 过时或矛盾点：**测试计数已过时**（145/145 → 522/522，见 G1/T10 收口篇）。「G1 人工门槛仍未通过」措辞在两篇中均成立于各自时点，收口篇进一步明确「A/B 技术审查及修正复核已完成，实际评审人的业务回执和人工通过结论待签署」；引用时须用最新表述。

### g1-t10-closeout-2026-11-21.md

- 日期／角色／主题：2026-11-21（Asia/Shanghai）。角色：C（平台），A/B 两侧材料由 Codex 代理提供技术审查，C 核对提交与命令结果。主题：G1 业务回执材料 + T10 技术验收收口。开发分支 `chore/g1-t10-acceptance-closeout`，基线 `d289cc88`，技术验收提交 `2bf96932`。
- 目的：依 G1 交接清单逐项核对，并完成 T10 五项技术验收。
- 承重事实：
  - 证据根 `D:/project/zhinexus-g1-t10-acceptance-evidence/2026-11-21/run-c97b181b0a33`；每个 `commands/<记录名>.json` 保存实际命令、开始/结束时间及退出码，同名 `.log` 保存原始输出。`evidence-index.json` 索引 **743 个文件**，SHA-256 `57c28e58437310a967c1203f47d2ede991bfc7f3b87d46586acd69b1a713f363`。
  - SDK 冻结目录：仓库 `.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`，**199 个清单文件连同 manifest 共 200 个文件**；manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。
  - 冻结 tarball（版本 / SHA-256）：charts-core **0.0.11** `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb`；charts-vue **0.0.12** `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9`；charts-react **0.0.12** `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28`；component-cli 初验 **0.0.24**（`e1630aeb`，455517 字节）`4f31d2a834a9f97abe9dff0e60ba32f2997947ce2adaee5344aae6cf84ce6fa5`；component-cli 收口 **0.0.25**（`2bf96932`，456343 字节）`317305cb9af876f5168ed59c58066347a16e5c4d18bf384c681a7f1912987f63`。
  - 两个 CLI 版本各成功 pack 一次，各通过仓外安装的 **307 文件**原始字节对照。0.0.24 独立审查在公开截图接口复现「多个状态返回同名检查时报告校验失败」，修正后升至 0.0.25 重新冻结。
  - A 侧（SDK）：协议浏览器用例 **15/15**；真实冻结 SDK 生命周期 **11/11**；T10 新消费者各自四维通过。B 侧（CLI/画廊）：网页逐实现必检，手动来源为 `manual-upload` / `unknown-manual`。C 侧（平台）：契约 **522/522**，fixture 快照一致，真实三存储 **14 实现**记录验证，全量工程和浏览器退出均为 0。
  - T10 五项验收要点：候选发现（官方 npm 当天返回稳定版 **6.1.0**，安装 CLI 退出 0；受控陈旧代理返回 **6.0.0** 标记非官方来源，实际退出 **1** `PEER_UNSATISFIED`；Vue/React × strict/strict-only 四组实退 **1** `PROBE_PEER_REJECTED`；两框架 Bundler 与 NodeNext 类型检查均失败 → 建议 **hold**）；隔离矩阵（6.1.0 首轮 CLI 退出 **1** `PROBE_HOLD`，**56 图标**为新基线；adopt 0.0.24 与 0.0.25 均退出 0；每轮独立复算 **56 个环境键**）；生命周期（仓外冻结消费者 **11/11**，18 张截图摘要一致）；两个原消费者回退（6.0.0 → 逐字节恢复 6.1.0 与冻结 SDK，四份清单与锁文件原件摘要已独立重算）；画廊与真实实测（**154 个 Gallery 测试**、6 个兼容分区浏览器用例、4 个视觉场景；桌面 1440px、手机 390px）。
  - 6.1.0 hold 报告 SHA-256 `b055b887380c1d408b1f0a942c7d50659cff3f27a2f6da24938c8544f7204afa`；收口版 adopt 报告 SHA-256 `f90a20db0a43454683ce661789bb0ffba683ddb5e6f1886905b2e74a4617a040`。
  - 工程门禁（固定 Node 26.13.0 / pnpm 12.18.0，命令通过 `scripts/pnpm.ps1`；本机截图浏览器 Chromium 158.0.8127.18，安装修订 1254）：
    - `verify:workspace` 退出 0（10 成员）
    - `--filter @company/contracts build` + `exec vitest run tests/contracts` + `exec tsx tests/fixtures/releases/g1/generate.ts --check` → 契约 **18 文件 522/522**，快照一致
    - `exec turbo run build typecheck --force` + `exec tsc --project tsconfig.json --noEmit` → **20/20、0 缓存**，根 tsc 退出 0
    - `test` → T10 Node **168/168** 和根 Vitest **127 文件、2271/2271**，退出 0
    - `test:browser` → **306/306**，退出 0（启动前检查 5173–5176，`ZHINEXUS_SDK_BUNDLE_DIR` 指向冻结 SDK）
    - `test:installed-compatibility` → 1 个真实独立服务测试通过（内部覆盖十四实现）
    - `node --test tests/unit/t10-frozen-lifecycle.test.mjs` → 生命周期 runner **15/15**；`exec playwright test --config .tools/g1-capture.config.ts` → 截图协议 **15/15**
  - 网页响应及工作流 **39/39**；CLI 响应、真实发布和基线相关 **28/28**。
  - 保留的失败：fixtures 漂移、截图协议首轮 **3 通过/9 失败**、生命周期浏览器加载失败、遗漏冻结路径导致的浏览器失败、Windows C/D 盘之间相对路径测试失败（修正后在测试临时根生成真正相对输入，**10/10** 通过）。0.0.25 的三项新增浏览器回归在修复前均失败。收口版安装探针首轮误把瞬时检查的 `message` 放进报告，改用生产调用点的 name/status 映射后复验退出 0。
  - 清理：两个原消费者及 staging 已清理，复核的九个验收端口均已释放；`cleanup.json` 记录保留的两个仓外 CLI 安装、两个失败的 MCP 测试临时目录和自动审批拒绝删除其中一个复现目录的结果；两个 Vite 缓存目录未纳入证据索引。
  - 未覆盖边界：画廊实测查询超过单页 100 条时明确不可用；CLI 上传未完成的中断恢复、异常代理回执之后的继续执行、浏览器 JavaScript 跨域读取 multipart ETag 的生产配置仍需专项实测；本轮真实分片字节与 ETag 验证使用本地隔离 MinIO；截图报告中的浏览器修订由现有 CLI 实现默认填为 **1000**，实测环境证据另记 Chromium 安装修订 **1254**。
  - 原架构文档 SHA-256 与基线一致。
- 结论与状态：完成（T10 技术验收）。**G1 A/B 签署、公司 OIDC 和正式预览域、T11 真实业务试点及 T12 生产验收仍开放**（其中 G1 签署已于 2026-11-22 决定人工放行，A/B 业务回执不作前置）。是 `t11-pilot-rehearsal-2026-11-21.md` 的基线来源（`7eb5e521`）。
- 交叉引用：`g1-contracts-2026-11-12.md`、`g2-access-settings-2026-11-22.md`、`t11-pilot-rehearsal-2026-11-21.md`、`docs/plans/2026-11-12-g1-review-g2-access.md`、`audit-final/discovery-review.md`、`sdk-freeze.json`、`cli-freeze.json`、`installed-cli.json`、`cli-0.0.25/freeze.json`、`cli-0.0.25/installed.json`、`b-release-acceptance-2026-11-16.md`、`t08-real-web-upload-2026-11-13.md`、`c-sdk14-acceptance-2026-11-13.evidence.json`。
- 过时或矛盾点：**G1 状态措辞易被误读。** 原文明确「A/B 实际评审及外部交付方实名待确认，G1/G2 不勾选通过」「没有替 A/B 伪造业务签字」。同时 0.0.24/0.0.25 CLI 版本号、522/522 契约计数、2271/2271 与 306/306 浏览器计数**取代**了 `g1-contracts-2026-11-12.md` 的 145/145、162/162、11/11。

### g2-access-settings-2026-11-22.md

- 日期／角色／主题：2026-11-22。角色：C 收口 contracts/迁移/API/网关/根配置/运维；B 范围的 CLI 和画廊按顺序实施。主题：G2 接入设置（公司登录 OIDC + 预览入口）本地交付与审查复验。执行位置 `C:/Users/10208/.codex/worktrees/g2-access-settings/zhinexus-design-asset-platform`，分支 `feat/g2-access-settings`。依据 `docs/plans/2026-11-22-g2-access-settings.md` 与 `docs/specs/2026-11-22-g2-access-settings-design.md`。
- 目的：实现五项计划的配置能力与本地闭环；真实公司账号、撤权时限、生产 DNS/TLS、生产凭据、双业务试点仍是外部 G2 输入。
- 承重事实：
  - 交付范围：PostgreSQL 独立管理 OIDC/预览草稿、不可变配置正文与启用历史、活动代数、逐项证据与审计；保存/验证/启用/恢复均执行正文 CAS 和独立部署管理员检查。Web 服务端 PKCE、浏览器绑定、state/nonce/issuer/audience/client/签名验证；CLI S256 与固定 `127.0.0.1` 回环。每次受保护访问核验活动 OIDC 代数、停用与角色；业务写入在事务内复查。受限 HTTPS 核验所有 DNS 地址并固定连接地址，限制主机/端口/CIDR/响应大小/超时/重定向，支持公司 CA 与 IP SAN。画廊提供公司登录、接入设置、编辑/验证/启用/历史/复验/恢复/比较/审计；Cookie 会话优先于旧手动令牌；CLI 发布/恢复/状态/基线消费同 origin 有效私有登录文件。部署命令支持个人身份绑定、停用、角色限制与经验证恢复，无 HTTP 管理后门；域名/IP Nginx 模板提供探针路径与凭据过滤；网关数据库授权按列限制写入。
  - 迁移 **001–011**；迁移 010 不把旧状态升级成新证据，迁移 011 让缺少角色来源的旧预览授权失败关闭。
  - RED 项：非法配置/额外正文键、普通用户管理拒绝、缺失 Web/CLI 入口、伪造检查结果、过期证据、身份切换期间写入、失败启用审计、候选角色过滤、旧预览角色授权、旧手动凭证遮蔽 Cookie 会话、回调/会话/跨站 Cookie 拒绝审计。
  - 审查专项已通过：四个单元/契约文件 **10 项**；真实 OIDC/预览切换 **两项**；最终 Cookie/监控/配置专项三文件 **9 项**；原生脚本取消整文件 **20 项**。Nginx 使用已安装镜像解析出的不可变 image ID，在自有临时容器执行 `nginx -t` 并实际 HTTPS 转发。
  - 监控测试改为健康启动后终止自身 PostgreSQL 连接并令后续连接不可达，实测返回 **503**；未放宽启动时的配置失败关闭检查。原生脚本取消：新增启动标记的 RED 实测失败后，在启动前让事件循环处理取消；**21 项 GREEN**，含「原生脚本实际运行后取消并等待 1600 ms，确认进程树没有延迟写入」；**没有放宽原 sentinel 的 1500 ms 或跳过原断言**。
  - 手动令牌的作业重试浏览器 RED 还复现了无关 Cookie 被发送；改成仅公司会话携带 Cookie 并禁止重定向后，接入设置与网页发布 **14 项 GREEN**。
  - 验证命令（Windows x64，固定 Node `26.13.0` / pnpm `12.18.0`，均通过 `.\scripts\pnpm.ps1`；原始日志保留在工作树忽略目录 `.superpowers/sdd/2026-11-22-g2-access-settings/`）：
    - `--filter @company/contracts schemas:generate` exit 0
    - `exec turbo run build --force` exit 0，**10/10 实际执行、0 缓存**
    - `exec turbo run typecheck --force` exit 0，**14/14 实际执行、0 缓存**
    - `typecheck` exit 0
    - `exec tsc -p tsconfig.json --noEmit`（通过 `-PnpmArgs`）exit 0
    - `verify:workspace` exit 0（10 成员、无环、四公开包、服务依赖安全）
    - `verify:deployment` exit 0，**`templateValidated=true`、`environmentValidated=false`、`productionAcceptance=false`**
    - `test:browser`（提供原冻结 SDK）exit 0，**316 通过，1 个 IP 构建模式用例跳过**
    - `test:browser tests/browser/access-settings.spec.ts tests/browser/manual-release.spec.ts` exit 0，**14/14**
    - `exec vitest run tests/integration/project-verify.test.ts` exit 0，**21/21**
    - `--filter @company/component-cli typecheck` exit 0
    - 升版后 `exec turbo run build --force` exit 0，10/10；升版后 `exec turbo run typecheck --force` + `exec tsc -p tsconfig.json --noEmit` 均 exit 0，14/14
    - `test:platform`（原冻结 SDK + `PHASE2_GALLERY_ORIGIN=http://127.0.0.1:5173`）exit 0，**41 文件、148/148 通过，零跳过**
    - `test:browser tests/browser/gallery-preview-grants.spec.ts`（先按 `NEXT_PUBLIC_PLATFORM_PREVIEW_MODE=ip-port` 构建画廊）exit 0，**4 通过、1 个域名模式用例跳过**
    - 升版后正常模式 `test:browser` exit 0，**317 通过、1 个 IP 构建模式用例跳过**
    - `install --lockfile-only` + `install --frozen-lockfile` 均 exit 0，无依赖或锁字节变化
    - 升版后 `verify:workspace` + `verify:deployment` 均 exit 0
    - `exec node .superpowers/sdd/2026-11-22-g2-access-settings/installed-cli.mjs`（指定保留的 CLI tarball）exit 0，仓外实际安装 **CLI 0.0.26**，同 origin 凭据消费、跨 origin 拒绝和 SHA 不变均通过
    - 升版后 `test`（独占运行，提供真实 T17 浏览器目录）exit 0；Vitest **134 文件、2306 通过、2 个冻结输入条件跳过（总 2308）**；T10 **161 通过、7 个冻结输入条件跳过（总 168）**
    - `test:t10`（提供原 `A10_FROZEN_BUNDLE`）exit 0，**168/168 通过、零跳过**
    - `exec vitest run tests/evaluation/component-query-sdk.test.ts tests/acceptance/t16-a/t16-a-api-cases.test.ts` exit 0，**27/27 通过、零跳过**；只读核验 **199 个文件、14 个实现**与原 manifest 摘要
  - 根 `build` 固定 `--cache`，Turbo 拒绝同时追加 `--force`，故强制构建使用等效 `exec turbo run build --force`（执行命令适配，未修改缓存策略）。根测试的 T17 浏览器目录指向 `.tools/playwright` 的真实目录，保留执行器拒绝符号链接的检查。
  - 独立审查（只读，基线 `8f880c5e`）：**Critical 0 项，Important 9 项**；完成一轮修复与复验，没有重新组织第二轮审查。9 项：①验签/网络等待期间切换 OIDC 后旧身份仍可使用；②启用后漏部署接入配置会恢复旧环境认证；③bootstrap JWKS 绕过受限 HTTPS；④publisher-only 预览旧授权不随角色撤销失效；⑤候选忽略过滤后的角色；⑥手动管理员链接不能携带 Bearer（改为鉴权 POST 换取 **60 秒一次性票据**）；⑦CLI 保存凭据缺少消费者；⑧旧手动凭据遮蔽新 Cookie 登录；⑨回调/会话等鉴权拒绝缺审计（固定 target + code 的脱敏 `AUTH_DENIED`，不记录凭据）。Minor 的历史 CLI 复验入口、旧/过期证据显示、实际 Nginx 探针过滤均已补齐。
  - 冻结输入：原 SDK 来自 `.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`，manifest SHA-256 `04a7c4fb...`；charts-core 0.0.11 `393effb7...`、charts-vue 0.0.12 `51f19262...`、charts-react 0.0.12 `bbc6a1ad...`（原 SDK 未重新打包）。
  - CLI 0.0.26 tarball：`C:/Users/10208/AppData/Local/Temp/zh-installed-access-NCZ5gf/frozen/company-component-cli-0.0.26.tgz`，SHA-256 `2c51fdfe799644977e3efbcf9642ad69e51636aecc0b4012f6114b81820cca3a`。最初 pnpm 离线安装因缺少 `@modelcontextprotocol/server@2.4.0` 元数据而失败（记录在 `final-installed-cli.log`）；继续使用同一份 tarball，以固定 Node 附带 npm 的现有缓存完成离线 `--ignore-scripts --no-audit --no-fund` 安装。消费者路径 `C:/Users/10208/AppData/Local/Temp/zh-installed-access-gxcEcd/consumer`。
  - 独立升版：根 **0.0.8→0.0.9**、API **0.0.10→0.0.11**、画廊 **0.0.11→0.0.12**、网关 **0.0.3→0.0.4**、CLI **0.0.25→0.0.26**；私有 contracts 维持 **0.0.0**。版本提交 **`c5131ba3`**。
  - 实现提交 9 个：`8dc608dc`（接入配置契约、管理员草稿版本校验）、`4de78be7`（公司 OIDC、CLI 回环登录、候选权限隔离）、`aa56a1af`（预览入口检查、活动切换与回退）、`8fb7abd6`（工具链检查期间到期的取消阻止脚本启动；21 项原生/浏览器验证文件及 CLI typecheck）、`93606a10`（接入设置页面、公司会话与候选验证）、`e16a6d94`（发布/状态/基线消费匹配 origin 的本机登录）、`3edf3c3e`（认证代数、候选证据、角色撤销及运维恢复；完整平台 148 项、契约/单元 10 项）、`89786076`（部署恢复说明、Nginx 入口过滤模板与真实入口测试）、`c5131ba3`（独立语义化升版与 CHANGELOG）。
  - 原架构文件 SHA-256 不变。**保持当前分支/工作树；用户没有授权 push、合并或创建 tag。**
- 结论与状态：完成（本计划五项本地实现、审查处置、安装产物验证与回归）。**G2/T01 仍未完成外部验收**：真实公司 Web/CLI 账号、公司同步与专用账号停用/角色移除、既有 token/Web session/preview grant 拒绝时延及公司认可的目标时限、生产逐发布 DNS/TLS/续期、生产数据库身份与 MinIO 只读策略、双业务试点的双框架回执。本轮部署检查仅证明模板有效。
- 交叉引用：`docs/guides/access-settings.md`、`g2-five-items-2026-11-22.md`、`preview-ip-port-2026-11-21.md`、`docs/guides/preview-ip-port.md`、`docs/plans/2026-11-22-g2-access-settings.md`、`docs/specs/2026-11-22-g2-access-settings-design.md`、`self-managed-accounts-2026-11-22.md`、`infra/gateway/preview.conf`、`infra/gateway/preview-ip.conf`、`infra/gateway/preview-role.sql`。
- 过时或矛盾点：**`verify:deployment` 的 `productionAcceptance=false` 与 G1「人工放行」是两件事，必须分开陈述**——本文证明模板有效、`templateValidated=true`，但 `environmentValidated=false`、`productionAcceptance=false`，不能读作部署已就绪。另注意本文的版本号（根 0.0.9 / API 0.0.11 / 画廊 0.0.12 / 网关 0.0.4 / CLI 0.0.26）**被 `self-managed-accounts-2026-11-22.md` 的下一轮升版取代**（根 0.0.10 / API 0.0.12 / 画廊 0.0.13 / 网关 0.0.5 / CLI 0.0.27）。

### g2-example-contract-2026-11-12.md

- 日期／角色／主题：2026-11-12。角色：C（平台）。主题：示例状态契约收口（G2 本地子计划先收口示例接口）。
- 目的：把 `ComponentExample.states` 定为可选只读枚举，`requiredStates` 继续作为必需执行清单；三个既有方法不变。
- 承重事实：
  - 新增全局名称常量直接放在 `contracts/index`，保持类型文件无运行时依赖；**不修改 SDK/CLI 示例实现或 wire JSON Schema**，不代替 A/B 业务评审。
  - 基线契约 **145/145** 通过。
  - `scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` **RED**：原类型没有 `states`，出现 `TS2353`/`TS2339`；同命令在构建新 contracts 后 **GREEN**。
  - `exec vitest run tests/contracts` → **146/146** 通过。
  - `TURBO_FORCE=true` 下 `scripts/verify.ps1`：冻结安装、workspace、**10 个构建、14 个类型任务及根 tsc**、**181 项单元/集成测试**通过；浏览器首次 **14/15**，原因是新增常量从 `examples.js` 重导出触发测试静态模块白名单拦截。
  - 将常量直接定义在公共 index（避免为常量增加运行时模块边）并重新构建 contracts；使用与构建一致的 `NEXT_PUBLIC_SITE_URL=https://gallery.test` 执行 `test:browser` → **15/15** 通过。
  - 原始架构 SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。**此项为私有契约的兼容补充，未触发公开包/平台业务发布升版**；不声明 G2/T01 完成。
- 结论与状态：完成。被 `g1-contracts-2026-11-12.md`（145/145 上一轮）与 `g1-t10-closeout-2026-11-21.md`（522/522）在计数上更新。
- 交叉引用：`g1-contracts-2026-11-12.md`、`g2-local-infra-2026-11-12.md`、`gallery-next-migration.md`（同用 `NEXT_PUBLIC_SITE_URL=https://gallery.test`）。
- 过时或矛盾点：契约计数 146/146 已过时（→ 522/522）。「不修改 wire JSON Schema」的边界在后续 G2 接入设置轮次中已扩展。

### g2-five-items-2026-11-22.md

- 日期／角色／主题：2026-11-22，Windows x64，Asia/Shanghai（报告内部时间为 UTC）。角色：C / Codex。主题：G2 五项接入实测。基线 `6511ba77`，分支 `chore/g2-five-item-acceptance`。原 `g2-local-infra-2026-11-12.md` 保留不变。
- 目的：对完整 G2 的五项（PostgreSQL / Verdaccio / MinIO / OIDC / 预览接入）逐项给出本机实测证据。
- 承重事实：
  - **完整 G2 为五项，当前三存储已有新增的隔离本机实测证据，OIDC 与目标预览接入未配置，完整 G2/T01 未完成。**
  - 五项逐项结论：

    | 项目 | 本轮实际验证 | 结论与缺口 |
    | --- | --- | --- |
    | PostgreSQL | **18.6**，插入 **256 字节**载荷后复读内容与摘要；重复主键返回 **23505**；真实 Docker 进程重启后同一行与摘要不变；pg_dump/psql 恢复到新数据库后复读 | 隔离本机实测通过；未验收公司部署实例与权限，不将探针表等同业务迁移 |
    | Verdaccio | 专用 publisher 发包一次；reader 从新缓存、仓外临时目录安装精确 `1.0.0` 并核对安装名/版本/README/lockfile SHA-512；匿名 **401**、reader 写入 **403**、重复发布 **E409**；重启后 tarball SHA-256 不变 | 隔离本机实测通过；公司 registry/账号交付与正式接入回执未完成 |
    | MinIO | 固定 release/commit/image ID；私有对象 put/get 与 SHA-256 一致；匿名 **403**；进程重启后复读；从本轮备份恢复到新 key，原/新对象摘要均一致 | 隔离本机实测通过；公司最小权限、维护责任及空目标全卷灾备未由本轮验证 |
    | OIDC | `infra:check-access` 与直接 `access.ts` 两次真实执行；配置项为 `null`，返回 `oidc: unconfigured`，**退出码 2** | 未完成 |
    | 预览接入 | 同两次命令独立返回 `preview: unconfigured`，**退出码 2** | 未完成；既有本机 IP 模式测试不等同目标环境验收 |
  - 两次接入检查都保持 **`g2Ready: false`**。默认正式独立域门槛及经授权的 IP 分 HTTPS 端口试用模式沿用当前规则，未修改范围。
  - 固定环境：Node `v26.13.0`、pnpm `12.18.0`、Docker Engine `29.8.2`。三存储从 `infra/versions.json` 的固定镜像/源码配置启动，MinIO 同时实际执行 `/minio --version` 核对 release 与 commit。
  - 实际运行 image ID：PostgreSQL `sha256:8bca9649e52d948114ccc8164b55b7ab26b64e729893e420114bb5c87bf7c7cc`；Verdaccio `sha256:1d014b80fafa1419c2a098aeb5f9508b310cfabac97743491cb835993ae37d38`；MinIO `sha256:8cddf933628349b40111a4f03c04408d4f653803dc27a0d19786af7df6b6b8c0`。MinIO 为 `RELEASE.2025-10-15T17-29-55Z` / `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`。
  - 每轮先读 Docker inspect 的实际 `StartedAt` 与卷名，执行本轮三个自有容器的 `docker restart`，再核对 `StartedAt` 已变化、原卷名保持、端口仍仅绑定 `127.0.0.1`。**不以客户端或健康检查重启代替数据进程重启。**
  - 第六轮 PostgreSQL 进程时间从 `2026-11-21T19:13:16.244543001Z` 变为 `2026-11-21T19:13:21.901316318Z`（本地 2026-11-22 03:13:16 / 03:13:21）。
  - 三轮完整实测摘要：

    | 轮次 | runId | 本地完成时间 | 检查结果 | 探针载荷 SHA-256 | 冻结 tarball SHA-256 |
    | --- | --- | --- | --- | --- | --- |
    | 第五轮 | `47427631-52f1-4a54-b0e0-9f1963e13da6` | 2026-11-22 03:12:08 | 9 条检查通过 | `c9850124ca654616665d9ef988a3342f51e994142772015f176fff492a8153d6` | `51edd12275a507190de31b649a8959ce93326dd84b00b429ecd5cbdc45a8fdba` |
    | 第六轮（清理顺序修正后） | `b95f1b8f-fd2d-4a19-993d-ca3dbc92e8e6` | 2026-11-22 03:13:28 | 9 条检查通过 | `5db0c7a0c92226fc86ae137122e18cc666b6eab28faf3785aeff424689dbdcef` | `6b40695bacda6ab3c0ad830a02bd7f383f0210e07607e1bfc07d73ba42371be5` |
    | 第七轮（初始化清理边界补充后） | `2ce653ee-ac1c-4611-a94a-f2798cb30511` | 2026-11-22 03:16:59 | 9 条检查通过 | `434ee111dc7c29369909525dcfb5fd5c38c36ff68fd3f2fee34de6a3699ee513` | `9b3f05d7dfa6e4809a6029742cae78fd569cfa199611b39a8907efffc9e38710` |
  - 每轮 **9 条检查**（PG 3 / Verdaccio 3 / MinIO 3）；Verdaccio 包名由 runId 去连字符生成，版本均为 `1.0.0`，打包只有一次；重复发布要求注册表实际返回 E409。测试包只含 package.json 与 README，不执行组件或生命周期脚本。
  - 命令与结果：`test:infra` **退出 1**（preflight 检出共享凭证缺失，没有启动/重启/改动共享 Compose 数据）；`exec vitest run --config tests/platform/vitest.config.ts tests/platform/g2-storage-acceptance.test.ts` **七轮真实执行，前四轮失败原件保留**，第五/六/七轮各 **1/1 通过、退出 0**；`infra:check-access` 退出 **2**；`exec tsx infra/scripts/access.ts` 退出 **2**；`TURBO_FORCE=true` 后 `build:services` **5/5、0 cached**、退出 0；`exec tsc -p tsconfig.json --noEmit` 退出 0；`verify:workspace` 退出 0（10 成员）；`exec vitest run tests/infra tests/unit/infra-options.test.ts` **4 文件、19/19**、退出 0。
  - 保留的四轮失败：①`0e1698e6-a695-4be2-a5d9-18448e4c3ae8` npm 在 JSON 输出中将带连字符 UUID 文件名替换为 `***`（磁盘 tarball 正常存在）；②`ea0aa51b-797b-4e42-9a5a-c173eb074171` 仓库 `.npmrc` 优先于 userconfig，publish 未显式指定 registry 而失败（`npm config get registry` 确认有效 host 为 `registry.npmjs.org`）；③`3784f993-5be6-451e-b469-ec917474476b` Windows `path.relative` 在 D/C 跨盘时返回绝对路径；④`0d37251b-9c8a-42db-a144-dc422edc8b54` 真实容器重启后随机端口变化，旧「端口必须不变」断言失败。
  - 独立只读审查（requesting-code-review 技能）指出消费者删除异常可能跳过栈清理、取得栈后的报告目录/客户端初始化缺少资源保护；已改为独立 `finally` 清理栈及外层资源保护，分别记录 `consumerCleanup` 和 `cleanup`。**未对初始化异常或 EPERM/EBUSY 路径额外做故障注入，因此不声称这些异常分支已有实测。**
  - 收尾时曾将根类型检查与服务构建并行执行，类型检查因 `dist` 正在重建而**退出 1**，失败原件 `final-root-types.*`；顺序复跑 `final-root-types-after-build.*` 退出 0。**没有把失败输出隐藏或作为通过证据。**
  - 最终独立审查核对 **60 个索引文件与测试源码共 61 个文件**的字节数/SHA-256，均相符；机器可读证据 SHA-256 `76b966f951587af71d0c3f6d9ed5f9423da0dde082fa77b32d04b0019afcce7c`。
  - 逐文件 SHA-256 索引仅包含报告、冻结 tarball、探针载荷备份、SQL 和命令日志，**不包含凭证、`.npmrc` 或任何密钥**；原件在 `.tools/operations/g2-acceptance/`，每个自有栈的凭证留在 `.tools/recovery/<id>/`，两者均被 Git 忽略。
  - 用户已有 README 修改 SHA-256 `3d8a1373b1cfa4e4961b818850fa2bf1ae384a26ace31d5acad6bdd651e49cd7`，不纳入本轮提交。本轮只有测试与记录，**无产品功能或缺陷修复，不单独升版**。未 merge、push 或改动其他 G2 工作树。
- 结论与状态：**三存储项隔离本机实测通过；OIDC 与预览接入未完成；完整 G2 未放行。** 更新 `g2-local-infra-2026-11-12.md` 与 `g2-main-merge-2026-11-12.md` 的三存储证据。
- 交叉引用：`g2-local-infra-2026-11-12.md`、`g2-access-settings-2026-11-22.md`、`g2-five-items-2026-11-22.evidence.json`、`docs/guides/operations.md`、`docs/guides/quickstart.md`、`infra/versions.json`、`infra/README.md`。
- 过时或矛盾点：**这是本主题中最新、最权威的 G2 结论来源。** 早前 `g2-local-infra-2026-11-12.md` 与 `g2-main-merge-2026-11-12.md` 中「三存储两轮通过」的结论被本篇第七轮证据取代（且前两篇的 `g2Ready: false` 结论不变）。引用 G2 状态时必须写「五项中三项本机实测通过、两项未配置、完整 G2/T01 未完成」，**不得写「G2 已通过」**。

### g2-local-infra-2026-11-12.md

- 日期／角色／主题：2026-11-12，Windows x64 / Docker Desktop Linux amd64。角色：C（平台）。主题：本地三存储与接入检查。起点 main `471ae8e`，开发分支 `feat/g2-local-infra`。用户确认暂无 OIDC 和独立预览域。
- 目的：先完成本地 PostgreSQL / 私有 S3 / 注册表与接入检查工具。
- 承重事实：
  - `d18ce0e`：可选只读 `ComponentExample.states`、`COMPONENT_EXAMPLE_GLOBAL` 与 requiredStates 权威语义（验证见 `g2-example-contract-2026-11-12.md`）。
  - 独立 Compose `zhinexus-g2`，回环端口 **15432 / 14873 / 19000**，不复用已有 5432 / 5433 / 9000。
  - 固定设施：PostgreSQL **18.6**（`postgres:18.6@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42`）；Verdaccio **7.1.0**（`verdaccio/verdaccio:7.1.0@sha256:c1b1b86154b43a4e1861bc7a4496d4977aa43c8bdb5db49b68445f8a9273729f`）；MinIO `RELEASE.2025-10-15T17-29-55Z` / `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`，源码归档 SHA-256 `45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841`；Go builder `golang:1.27.3-bookworm@sha256:dc0963f32053e4bc451d24d87e3892d42d01021b61f093e98eb95c0352bb84b0`；实际 MinIO image ID `sha256:8cddf933628349b40111a4f03c04408d4f653803dc27a0d19786af7df6b6b8c0`。
  - 本地客户端：`@aws-sdk/client-s3 3.1167.0`、`pg 8.23.1`、`@types/pg 8.23.1`、`tldts 7.4.22`。为新发布依赖写入 `minimumReleaseAgeExclude`：`@aws-sdk/client-s3@3.1167.0`、`@aws-sdk/credential-provider-ini@3.973.30`、`@aws-sdk/credential-provider-login@3.972.92`、`@aws-sdk/credential-provider-node@3.972.97`、`tldts-core@7.4.22`、`tldts@7.4.22`（均限精确版本）。
  - 本项目卷：`zhinexus-g2_postgres_data`、`zhinexus-g2_verdaccio_data`、`zhinexus-g2_minio_data`。容器内 `/minio --version` 实测为上述 release/commit、`go1.27.3 linux/amd64`。
  - RED/GREEN：`tests/infra/access-config.test.ts` 先因实现缺失失败再通过；`test:infra` 未启动服务时 preflight **退出 1**（不返回空成功）；首轮真实服务 Verdaccio 登录返回 409（根因请求缺少 Basic 认证头）；加强重复发布判定时发现 npm 会本地预检已存在版本，仅对同一冻结探针 tarball 使用 `--force --json` 绕过客户端预检，必须从注册表得到 `E409`；`tests/infra/local.test.ts` 先 RED 后 GREEN，基础设施配置与本地工具测试共 **13/13**；`infra:up` 固定源码 MinIO 构建和 Compose 启动通过，`infra:stop` 后重新 `infra:up` 通过。
  - `infra:check-access`：未配置实际退出 **2**；HTTP issuer 错误配置退出 **1** 且覆盖旧报告为 failed/false；最后恢复默认未配置报告。
  - `$env:TURBO_FORCE='true'; .\scripts\verify.ps1`：冻结安装、工作区 **10 成员**、build **10/10（0 缓存）**、typecheck **14/14（0 缓存）** 及根 tsc、根测试 **194/194**、浏览器 **15/15** 全通过。日志 `.tools/g2-local/final-full.log`。
  - 两轮真实设施证据（runId / 完成时间 UTC / tarball SHA-256 / 探针数据 SHA-256）：①`e5d415dd51a64239bd280f792d9ad0d8` / 2026-11-12 03:08:41 / `226d882fad69bf509f8a4daa335e83f46a48f19ba7ee557151c470bf23b57ff3` / `dbc88c6cc3be7da22f5a3828fa7521433927f4bfd21b8ddb68a26ec30bd16760`；②`a44fcde57dda4171a11d99a3061613f7`（停止/启动之后）/ 2026-11-12 03:09:52 / `5d52e31386dbc965e2d3b9f072590757fb5001a78cdbf744a1767216d0d2abff` / `5a2439f9b4102b5558a75084decba8d7f7d4ea7c91bbf4dccf00f76cf8eb6629`。包名 `@g2-probe/probe-<runId>@1.0.0`。
  - 修复后两轮探针：`8989ab0754224452b0a5f9fcddd965d6` / 2026-11-12 03:26:21 / tarball `86ab2298b4f17c0c085f6c7c007e93684446ec74cfe635955b9ece34a72b58ac` / 数据 `fbe0547b93ebdd561c73247e104833cb0bdc1f8c70117151b1988de6e79e7cfd`；`ed0d93e55d0e4f15a8ce2cc656e20813` / 2026-11-12 03:26:30 / tarball `7546a99e48c1a0d0bfb099f5a1ea55bb3537c880534e19f91078b151a63abfb2` / 数据 `ef7335732ad14ab4ec730b0b1afa9bc81f82f40170422da061041110583a7150`。
  - 最终独立工作树复验：build 10/10、typecheck 14/14 及根 tsc（**0 缓存**）、根测试 **198/198**、浏览器 **15/15**；设施单测 **17/17**，默认接入检查仍退出 **2**。日志 `.tools/g2-local/worktree-final-full.log`、`review-green.log`、`worktree-access.log`。
  - 独立只读审查发现 **2 项 P2，无 Critical/Minor**：①S3 请求/响应体可能无限等待（新增 `withS3Deadline` 和 `readS3Object`，全部操作含响应体读取共用 **15 秒**上限，取消后关闭流）；②预览注册域漏核对管理 API（配置新增必需 `apiOrigin`，预览须同时与画廊/API 的注册域分离；三处 origin 都做 DNS/TLS 前置检查）。
  - 共享目录被并行 CLI 工作切换到 `feat/t04-cli-check` 后，C 创建独立工作树并沿用 `feat/g2-local-infra`；新工作树通过被忽略的 `.tools` junction 复用同一固定本机工具链/浏览器/开发凭证。
  - 根与公开包仍为 **0.0.0** 工程阶段，本轮不发布公开包，不触发升版。
- 结论与状态：完成（本地子集）。**三存储证据被 `g2-five-items-2026-11-22.md` 以七轮方式取代/扩充**；OIDC/独立预览域/G2/T01 结论不变。
- 交叉引用：`g2-example-contract-2026-11-12.md`、`g2-main-merge-2026-11-12.md`、`g2-five-items-2026-11-22.md`、`turbo-baseline.md`、`infra/versions.json`、`docs/guides/quickstart.md`。
- 过时或矛盾点：①「三存储两轮通过」应改为引用第七轮（`2ce653ee-...`）证据；②本文记录的 `infra:check-access` 退出码语义（未配置 2 / 错误配置 1）在 `docs/guides/operations.md` 中被正式化为 preflight 退出码规范，可对照；③本文的 PG/Verdaccio image digest 与 `g2-five-items-2026-11-22.md` 的 image ID 是不同粒度的标识（digest vs 本地 image ID），不要混用。

### g2-main-merge-2026-11-12.md

- 日期／角色／主题：2026-11-12（Asia/Shanghai）。角色：C（平台）。主题：本地设施合并主分支后的验证。用户明确要求完成后合并回主分支。
- 目的：在 C 独立工作树执行本地快进合并并复验。
- 承重事实：
  - `main` 从 `471ae8e` **快进到 `35725fb`**，包含 `d18ce0e`（示例状态契约）和 `35725fb`（本地三存储与接入工具）；**没有冲突，没有推送远程**。
  - 合并前 C 工作树和暂存区干净；原主目录仍为 `feat/t04-cli-check`（含 CLI 并行开发及先前 C 副本），本次未切换/清理/提交。当前独立工作树保留在 `main`，本地容器仍需其中的设施配置，**因此不归档或删除该工作树**。
  - 合并后 `$env:TURBO_FORCE='true'; .\scripts\verify.ps1` 退出 0：冻结安装、10 成员、build 10/10、typecheck 14/14 及根 tsc（全部 0 缓存）、根测试 **198/198**、浏览器 **15/15**。日志 `.tools/g2-local/main-merge-verify.log`。
  - `test:infra` 退出 0；真实写读、权限拒绝、精确安装、重复发布 E409、三服务重启与隔离恢复全部通过。runId `db540b272cf445c796cbc96610676570`，完成于 **2026-11-12 11:42:43（Asia/Shanghai）**；tarball SHA-256 `80b9be0399ea5de502632dda9ad7e7c9d96f81299a16e60346d16ac94f014dba`，数据 SHA-256 `c72fb05621a7066c0c3c622bbe9f266ae589b835837e8d94214d548e58cc59aa`。日志 `.tools/g2-local/main-merge-infra.log`。
  - `infra:check-access` 预期退出 **2**，OIDC/独立预览域均未配置，`g2Ready: false`。日志 `.tools/g2-local/main-merge-access.log`。
  - 原始架构 SHA-256 不变。
  - **合并不代表生产或业务发布验收。**
- 结论与状态：完成。被 `g2-five-items-2026-11-22.md` 的三存储七轮证据取代；`main` 指针此后已多次前移（`6511ba77` → 自管账号合并 `8ce44290` 等）。
- 交叉引用：`g2-local-infra-2026-11-12.md`、`g2-example-contract-2026-11-12.md`、`g2-five-items-2026-11-22.md`、`self-managed-accounts-2026-11-22.md`。
- 过时或矛盾点：`main` 位置（`35725fb`）已完全过时。文中「根测试 198/198、浏览器 15/15、build 10/10」等计数是 2026-11-12 时点值，此后增长到 2306+/317 等，不得当作当前套件规模。

### gallery-next-migration.md

- 日期／角色／主题：2026-11-11（Asia/Shanghai）。角色：B/C（画廊宿主前端 + 工程）。主题：画廊宿主从 React + Vite 迁移到 **React 19.3.1 + Next.js 16.4.6 App Router** 的公开/私有渲染边界。原始架构文档未修改。
- 目的：固定 Next 路由、metadata、sitemap 与 SSR 边界，避免伪造组件资料。
- 承重事实：
  - `apps/gallery` 使用 `next build` / `next dev` / `next start`，端口仍为 **5173**，Next 输出目录固定为 `dist/`。
  - `(public)` 路由提供首页和目录空状态，公开正文与 metadata 在初始 HTML 中可见；`(console)` 路由提供上传占位并使用 `robots: noindex, nofollow`；`/components/[slug]` 在真实公开目录契约和 Ready 资产接入前返回 **404**；sitemap 只由 `NEXT_PUBLIC_SITE_URL` 生成正式公开 URL，未配置时为空，**不写入 localhost**。
  - Turbo 的 gallery 专用 `build` 任务传入 `NEXT_PUBLIC_SITE_URL`，**暂时关闭该任务的 Turbo 输出缓存**，避免恢复 Next 输出时保留旧运行时 route-cache；其他包缓存不变。
  - RED：旧 Vite 构建下公开正文不在初始 HTML、`/upload` 无 noindex、未知详情回退为 200；**4 个画廊断言失败**，Vue/React 示例 2 个断言通过。
  - 迁移后命令：`--filter @company/gallery typecheck`；`$env:NEXT_PUBLIC_SITE_URL='https://gallery.test'` + `--filter @company/gallery build`；`exec playwright test tests/browser/bootstrap.spec.ts tests/browser/gallery-rendering.spec.ts --config tests/playwright.config.ts`。Next build 生成静态 `/`、`/components`、`/upload`、`/robots.txt`、`/sitemap.xml` 与动态 `/components/[slug]`；浏览器 **6/6** 通过。
  - 工作区验证：`verify:workspace` 10 成员无环安全服务图；全量 build **10/10**；typecheck **14/14**；Vitest **5/5**；浏览器 **6/6**。React example 有约 **504 KB** chunk 体积警告。
  - 收尾复验：发现浏览器断言写死测试域名（未设置 origin 的构建按设计输出空 sitemap，断言却要求 `gallery.test`）；改为按构建和测试共享的 `NEXT_PUBLIC_SITE_URL` 检查实际 URL，未设置时断言没有 `<loc>`；`verify.ps1` 只在缺少 origin 时临时使用测试域名，并在 `finally` 恢复调用者值。
  - **A→B→A 域名切换缓存缺陷**：第三次恢复 Turbo 输出缓存时生成的 app sitemap 是 A，但 `dist/server/route-cache` 残留 B，HTTP 返回 B；仅将 origin 纳入 task/global env 无法修复。永久回归脚本 **`scripts/verify-gallery-cache.mjs`** 先观察到此失败，再以 gallery 专用 `cache: false` 修复后验证 A、B、A 和未设置 origin 四轮通过。代价是 gallery 每次重建。
  - 最终验证（`HEAD 856379c` + 本次迁移文件的独立副本，排除同期另一任务的 chart-core/Vue harness 改动）：`$env:NEXT_PUBLIC_SITE_URL='https://gallery.custom.test'; .\scripts\verify.ps1` 退出码 0，frozen install、10 成员、build 10/10、typecheck 14/14、Vitest 5/5、浏览器 6/6、服务构建通过，自定义 origin 保留，全量 build 为 **0 缓存命中**。
  - 同副本 `exec node scripts/verify-gallery-cache.mjs` 与 `test:browser`：A→B→A→unset 的 HTTP sitemap 校验全部通过，浏览器 6/6。最终回归脚本另以 `https://gallery.custom.test/`（末尾斜杠）运行，四轮通过。
  - 并行任务：T02 提交到 `7a72ae1` 后重新运行 `.\scripts\verify.ps1` 退出码 0，build 10/10、typecheck 14/14、Vitest **17/17**、Playwright **10/10**、服务构建通过；最终锁文件同时保留已提交 Vue harness 对 charts-core 的 workspace 引用。此前另一任务因 `examples/vue/package.json` 新增 `@company/charts-core` 而锁文件未同步，在 frozen install 阶段失败；`removes_series_without_ghosts`、`does_not_initialize_zero_size` 曾因当时产物未含 harness 而超时——**不能据独立副本结果声称共享工作区的其他在途任务已通过**。
  - 独立只读审查确认缓存与环境配置问题；边界决定：robots 保持可抓取以便读取 noindex；sitemap 仅列公开 URL；保留旧初始化记录另增本迁移记录；OIDC、角色与用户态缓存、公开 DTO/Ready 判定、部署/TLS/搜索效果仍属 T05/T07/G2。审查建议的原始 HTML metadata 断言与 robots.txt 专项覆盖**留待补充**（目前正文检查读取原始响应，metadata 检查浏览器 DOM）。
- 结论与状态：完成（迁移与缓存回归）。被 `g2-access-settings-2026-11-22.md` 的画廊双模式（域名/IP）与 `preview-ip-port-2026-11-21.md` 的 IP 构建模式用例更新。
- 交叉引用：`bootstrap.md`、`turbo-baseline.md`、`g2-example-contract-2026-11-12.md`、`scripts-maintenance-2026-11-12.md`（`verify-gallery-cache.mjs` 迁至 `tests/integration/gallery-cache.mjs`）、`preview-ip-port-2026-11-21.md`、`g2-access-settings-2026-11-22.md`、`docs/guides/preview-ip-port.md`、`infra/gateway/preview.conf`。
- 过时或矛盾点：**`scripts/verify-gallery-cache.mjs` 的路径已变更**——`scripts-maintenance-2026-11-12.md` 记录它迁到 `tests/integration/gallery-cache.mjs`，通过 `scripts/pnpm.ps1 test:gallery-cache` 独立执行。另 Vitest 5/5、浏览器 6/6 是迁移时点值。gallery 的 Turbo `cache: false` 决定是**有代价的临时决定**（每次重建），原文明确「待干净恢复机制经验证后再恢复缓存」。

### nest-react-bootstrap.md

- 日期／角色／主题：2026-11-11，Windows x64。角色：C（平台工程）。主题：按用户明确要求将平台 API 与预览网关改为 **NestJS**，平台前端改为最新稳定 React；保持 Monorepo + pnpm workspace + Turborepo。此记录覆盖初始化修正，**完整 T01 和业务任务继续开放**。
- 目的：落地 NestJS 双服务 + React 画廊并全量验证。
- 承重事实：
  - 结构：`apps/api` NestJS module/controller/service、`GET /healthz`、**3000**；`apps/preview-gateway` 独立 NestJS、`GET /healthz`、**3001**；`apps/gallery` React + Vite、createRoot/StrictMode、TSX、独立 CSS、**5173**；SDK 与 examples Vue/React 双框架，示例 **5174/5175**；test/typecheck 均先 `build:services`，HTTP 测试加载已编译 Nest 应用。
  - 两个后端使用 **Nest 默认 Express 适配器**，尚未实现静态文件代理、上传、鉴权、发布与作业；`POST /v1/releases` 仍返回 **404**；健康响应保持 `status=ok`、`stage=bootstrap`，**不作为生产 readiness**。
  - 官方版本（从 npm latest 查询并精确锁定）：React/React DOM **19.3.1**、React 类型 **19.3.0**、NestJS common/core/platform-express **12.4.2**、Nest CLI **12.0.12**、reflect-metadata **0.2.2**、RxJS **7.8.2**。
  - Nest CLI 官方 TypeScript 依赖为 `~6.0.2`，因此两个后端显式固定 **TypeScript 6.0.3**，build/dev 用 Nest CLI，typecheck 用相同本地编译器，启用 `experimentalDecorators` 与 `emitDecoratorMetadata`；根、React 画廊与 SDK 保持 **7.0.2**；仅 Vue example 继续用 vue-tsc/TS6 例外。证据 `nest-typescript-compatibility.json`。
  - 验证表：官方版本发现 **24 个候选包**；冻结安装/peers 锁文件未更新、无 peer 问题；workspace 10 成员、无环、4 公开包壳；全量 build **10/10**；typecheck 先 5 个服务任务再 **14 个 Turbo 类型检查**及根脚本/测试类型检查；单元与服务 HTTP **5/5**（CLI 3 项 + 两个已编译 Nest 服务各 1 项；实际 DI、health 200、发布 404）；浏览器 **3/3**；缺 dist 的测试启动（把 API/网关/contracts dist 移至隔离备份并强制绕过 Turbo 缓存）→ 根 test 自动完成 5 个服务任务再 5/5；缺 dist 的类型检查（修复前根 typecheck 因 **两项 TS2307** 失败）；后端 start/dev 各 2 个真实命令、**4 次 health 200**，各次仅结束本次测试进程树；服务任务图 **5 项**；重复 build **10/10 命中**本地缓存，测试本身未进入 Turbo 缓存。
  - 证据文件：`nest-react-checks.log`、`nest-clean-test.log`、`nest-service-smoke.json`、`nest-services-graph.json`、`nest-react-build-repeat.log`、`nest-clean-typecheck-red.log`、`nest-clean-typecheck-green.log`、`nest-typescript-compatibility.json`。
  - 服务 HTTP 测试先在原 Fastify 工厂上失败（**2 failed / 3 passed**，`TypeError: Cannot create property 'host' on number '0'`，fastify 5.12.8 `lib/server.js:72:26`，`nest-services-red.log` 保留此次基线）；迁移后同一测试通过。
  - Windows 服务入口冒烟使用 `taskkill /T /F` 清理本次拥有的进程树，验证的是端口释放，**不声称验证了优雅信号关闭**；应用已启用 Nest shutdown hooks，目标部署系统的信号处理与在途请求排空仍需部署验收实测。
  - 独立审查范围 `09742a0..8e72a87`：**0 Critical、1 Important/P2、0 Minor**；唯一问题为 HTTP 测试改为导入 Nest dist 后根 typecheck 未生成两个服务自身的声明（干净工作区 TS2307，已有 dist 也可能造成过期接口参与检查）。修复：根 typecheck 现与 test 一样先执行 `build:services`；修复后直接强制绕过缓存运行 typecheck，通过 5 个服务前置任务、14 个原任务及根 tsc。
  - 实施决定：在当前 checkout 的 `chore/nest-react-bootstrap` 分支修正；Nest 使用 Express 适配器与独立模块；保留 Vue SDK/example；两个 Nest 应用固定 TS 6.0.3。
  - **工程基线 G0 已完成。** G1 schema/运行时校验、G2 三存储/OIDC/独立预览域及 T02–T17 仍按原验收门槛推进，**不能将本次健康检查与空页面称为业务平台完成**。
- 结论与状态：完成（G0 工程基线）。取代 `bootstrap.md` 与 `turbo-baseline.md` 的服务图与构建验证部分；其「G1/G2 未完成」结论被后续 G1/G2 记录逐项推进但未关闭。
- 交叉引用：`bootstrap.md`、`bootstrap-review.md`、`turbo-baseline.md`、`docs/versions.discovery.json`、`nest-typescript-compatibility.json`、`vue-typescript-exception.json`、`docs/plans/2026-11-11-three-person-allocation.md`、`g2-local-infra-2026-11-12.md`。
- 过时或矛盾点：①React 画廊已由 `gallery-next-migration.md` 改为 Next.js 16.4.6（本文的 React+Vite 5173 结构过时）；②「单元 5/5、浏览器 3/3」是 2026-11-11 时点值；③Fastify 5.12.8 叙事仅存于 RED 日志，现网后端是 NestJS。

### preview-ip-port-2026-11-21.md

- 日期／角色／主题：2026-11-21。角色：B（预览/部署侧）。主题：同 IPv4 分 HTTPS 端口预览。分支 `feat/preview-ip-port`，基线 `2cd035ff`。部署和迁回独立域的步骤见 `docs/guides/preview-ip-port.md`。
- 目的：在只有 IPv4 时，用同一台服务器 + 专用 HTTPS 端口提供组件预览的试用模式验证。
- 承重事实：
  - `verify:workspace` → 10 个成员、4 个公开包、服务端依赖边界通过。
  - `pnpm exec turbo run build typecheck --force` 与 `pnpm exec tsc -p tsconfig.json --noEmit` → 全图 **20/20、0 缓存**，根类型检查退出 0；网关路由整理后 `build:services` 及专项平台复验退出 0。
  - `pnpm test` → Vitest **2292 通过、2 跳过**；T10 **161 通过、7 跳过**，退出 0。
  - `exec vitest run tests/unit/preview-policy.test.ts tests/unit/production-preflight.test.ts tests/infra/access-config.test.ts` → **54 项通过**，覆盖域名默认值、IP/端口规则和部署环境配置。
  - `test:browser`（设 `ZHINEXUS_SDK_BUNDLE_DIR` 为冻结目录）→ **312 通过**，默认构建跳过 1 项 IP 模式专属用例，退出 0；显式 IP 模式画廊构建和专项 Chromium **4 项**另行通过，画廊授权接口使用测试替身。
  - `exec vitest run --config tests/platform/vitest.config.ts tests/platform/preview.test.ts tests/platform/preview-browser.test.ts tests/platform/preview-ip-port.test.ts`（设 `A10_FROZEN_BUNDLE`）→ **14 项通过**，退出 0；覆盖域名模式、一次性授权、Cookie 行为与本机 IP 模式的真实发布到 Chromium 渲染。
  - `exec tsx scripts/verify-deployment.ts`、`exec tsx scripts/production-preflight.ts` → 模板检查通过；缺公司参数的离线预检**退出 2**，`productionAcceptance=false`。
  - 独立 **Nginx 1.27.4** 容器的 `nginx -t` 和本机 TLS 转发：使用本机 SAN 证书，实测保留 Host 和端口、过滤 Cookie 与 Authorization、过滤响应 Set-Cookie，并拒绝预览入口以外的路径。
  - 专项使用原冻结 SDK Bundle `.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`，`manifest.json` SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。真实 API、网关、PostgreSQL、MinIO 与 Verdaccio 在隔离测试环境中发布和读取同一份字节。
  - Chromium 在 `127.0.0.2` 的两个 HTTPS 端口以测试证书加载 **14 个 Vue/React 实现**，覆盖不透明源、无预览 Cookie、多标签页、跨版本拒绝、错误端口、摘要不符、过期、撤销授权和撤销组件权限。
  - 首次浏览器全套运行缺少冻结目录变量，两项报缺配置并中止了同组测试，补齐变量后全套复跑通过。
  - **目标服务器的 IP SAN 证书、入口可达性、公司身份提供方和正式独立预览域 G2 门槛待现场验收。**
- 结论与状态：完成（IP 端口试用模式本地验证）。被 `g2-access-settings-2026-11-22.md` 的「IP 模式画廊构建 + 4 通过 / 1 域名模式用例跳过」与「双模式共同覆盖」更新。
- 交叉引用：`docs/guides/preview-ip-port.md`、`docs/guides/operations.md`、`g2-access-settings-2026-11-22.md`、`g2-five-items-2026-11-22.md`、`infra/gateway/preview-ip.conf`、`g1-t10-closeout-2026-11-21.md`（同用 `881238b3-...` 冻结 SDK）。
- 过时或矛盾点：测试计数（2292/2、312、14）为 2026-11-21 时点值，`g2-access-settings-2026-11-22.md` 已更新为 2306+2（总 2308）、317 通过。**IP 端口模式是试用模式，不是 G2 验收替代**——原文与 `g2-five-items-2026-11-22.md` 均明确「既有本机 IP 模式测试不等同目标环境验收」。

### scripts-maintenance-2026-11-12.md

- 日期／角色／主题：2026-11-12。角色：C（工程入口整理）。主题：根 scripts 整理。依据 `docs/plans/2026-11-12-simplify-project-scripts.md`。**根 scripts 从 8 个文件减为 5 个**；不改变业务协议、依赖版本、包版本或 G1/G2/T01 验收状态。
- 目的：收敛工程入口，消除重复服务构建。
- 承重事实（入口对应关系）：

  | 原入口 | 当前入口与职责 |
  | --- | --- |
  | `scripts/verify-bootstrap.ps1` | `scripts/verify.ps1 -Bootstrap`（只验证首次下载和缓存重跑） |
  | `scripts/verify-gallery-cache.mjs` | `tests/integration/gallery-cache.mjs`，通过 `scripts/pnpm.ps1 test:gallery-cache` 独立执行 |
  | `scripts/generate-contract-schemas.ts` | `packages/contracts/scripts/generate-schemas.ts`，通过 `scripts/pnpm.ps1 --filter @company/contracts schemas:generate` 先构建后生成 |
  | Schema 生成脚本 `--check` | 普通契约测试 `tests/contracts/api-schema.test.ts` 检查内容、缩进和末尾换行精确一致 |
  | 日常验证末尾的 `build:services` | 删除该次重复调用；根 `typecheck` 和 `test` 的服务构建前置保持不变 |
- 历史计划和验证记录中的旧命令**保留当时原貌**；复跑应使用上表。版本发现脚本仍保留，只刷新候选记录，不升级依赖。
- 所有工作区命令通过项目固定工具链：Windows x64、Node 26.13.0、pnpm 12.18.0；PowerShell 专项通过 Windows 自带 `powershell.exe -NoProfile -NonInteractive` 执行。
- 承重事实（续）：
  - `exec vitest run tests/contracts/api-schema.test.ts`（改动前）退出 0，**26/26**。
  - `exec vitest run tests/tooling/verify.test.ts` **RED** 退出 1，**3 失败 / 1 通过**（捕获末尾重复服务构建及缺少 Bootstrap 独立模式）。
  - 同两个文件 **GREEN** 退出 0，**30/30**（覆盖默认流程、失败停止、环境/目录恢复及专项成功/失败后的清理）。
  - `--filter @company/contracts schemas:generate` 退出 0；重新生成的 **23 份 Schema 无 Git 差异**。
  - `scripts/verify.ps1 -Bootstrap` 退出 0；真实首次下载、摘要与固定版本校验、缓存重跑通过；结束后无 bootstrap-check 临时目录残留。
  - `exec playwright install chromium` 退出 0；项目 `.tools/playwright` 安装 Chromium/headless shell **v1254（158.0.8127.18）**及配套工具。
  - `$env:TURBO_FORCE='true'; scripts/verify.ps1` 退出 0：冻结安装、10 成员、构建 **10/10**、类型任务 **14/14** 与根 tsc、服务前置任务均通过，各 Turbo 阶段 **0 cached**；Vitest **11 文件 / 180 测试**，Playwright **15/15**。
  - `test:gallery-cache` 退出 0；A→B→A→unset 四轮真实构建/start/HTTP sitemap 通过。
  - `git diff --check` 退出 0；受保护文件 `pnpm-lock.yaml`、全部 Schema、原始架构文档均无差异；`verify.ps1` 工作区行尾 **CRLF**。
  - 窄测试开发中发现测试夹具将 PowerShell 未设置变量与空字符串混为一谈；Bootstrap 模式实际没有修改该变量。调整夹具为显式 origin，**未为迎合断言修改生产代码**。
  - 原架构 SHA-256 前后相同。
  - 独立只读代码审查覆盖全部差异及新增文件：**无 Critical、Important 或 Minor 发现**。完整日志保存在本地被忽略的 `.tools/scripts-maintenance/`。
  - 运行中有 Vite chunk 大小提示、Node **DEP0190** 和 NO_COLOR/FORCE_COLOR 警告，均未导致失败；**没有扩大为这些提示的治理任务**。新 PowerShell 单元测试仅在 Windows 运行。**没有执行真实 PostgreSQL、Verdaccio、MinIO、OIDC 或发布验收，不据此关闭 G2/T01；本次也不触发业务包升版。**
- 结论与状态：完成。其入口映射表**取代**了 `gallery-next-migration.md`、`g1-contracts-2026-11-12.md`、`bootstrap.md` 中的旧命令写法（后者按「保留当时原貌」原则仍写旧命令）。
- 交叉引用：`gallery-next-migration.md`、`g1-contracts-2026-11-12.md`、`bootstrap.md`、`turbo-baseline.md`、`docs/plans/2026-11-12-simplify-project-scripts.md`。
- 过时或矛盾点：**这是全主题「命令口径」的权威对照表。** 早期记录里的 `scripts/generate-contract-schemas.ts --check`、`scripts/verify-gallery-cache.mjs`、`scripts/verify-bootstrap.ps1` 均已被新入口取代，但历史记录按原貌保留——阅读早期记录时不要直接复跑其中的命令。

### self-managed-accounts-2026-11-22.md

- 日期／角色／主题：2026-11-22，Asia/Shanghai。角色：综合（C 为主，自管账号后台）。主题：自主管理账号与权限后台本地验证。分支 `feat/self-managed-accounts-impl`，基线 `d700802d`。设计见 `docs/specs/2026-11-22-self-managed-accounts-design.md`，实施计划见 `docs/plans/2026-11-22-self-managed-accounts-implementation.md`，部署与恢复见 `docs/guides/self-managed-accounts.md`。
- 目的：交付自管账号（Keycloak 承载）契约、API 与网关实现并做本地/沙箱验证。
- 承重事实：
  - 版本升至根 **0.0.10** / API **0.0.12** / 画廊 **0.0.13** / 预览网关 **0.0.5** / CLI **0.0.27**。
  - **沙箱环境：Linux，Node 22.23.5，无 Docker、无 PostgreSQL、无 MinIO；Windows 侧 `node_modules` 符号链接在挂载下不可读。** 因此本轮在沙箱内自建轻量验证环境（npm 平铺 `node_modules` + 源码 tar 副本 + 手编 `dist`）执行命令，**未使用 Turbo 缓存命中代替结果**。
  - 命令与结果：`tsc -p packages/contracts/tsconfig.build.json` 0 错误；`tsc -p apps/api/tsconfig.json --noEmit` 0 错误；`tsc -p apps/api/tsconfig.build.json` 产出 `dist/`；`tsc -p apps/preview-gateway/tsconfig.json --noEmit` 与 build 均 0 错误；`tsc -p apps/gallery/tsconfig.json --noEmit` 0 错误；`tsx scripts/verify-workspace.ts` → `Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`；`vitest run tests/contracts` → **20 文件 550 测试全部通过（新增 21 项自管账号契约反例）**；`vitest run tests/unit` → **22 文件通过、10 文件因沙箱缺 `pnpm` / `@playwright/test` / `vite` / charts 未构建而失败，均为环境限制而非回归**（基线为 13 个失败；补齐 `yaml` 依赖后其中 3 个转为通过，净失败数下降）；`vitest run tests/gallery` 通过。
  - 逐个核对的失败原因：`spawn pnpm ENOENT`、`Cannot find package '@playwright/test'`、`Cannot find package 'vite'`、charts-vue `dist` 未构建。
  - RED→GREEN：`tests/contracts/managed-accounts.test.ts` 先写测试运行，**21 项因 `normalizeManagedAccountUsername is not a function` 等失败（RED）**；实现 `packages/contracts/src/managed-accounts.ts` 后 **21 项全部通过（GREEN）**。`tests/unit/managed-accounts-auth.test.ts` 实现后新增，**15 项一次通过**（覆盖账号版本、`auth_time`/`iat` 边界、管理员强制与队列约束）。`tests/platform/managed-accounts.test.ts` 按真实 PostgreSQL + MinIO 编写，**本轮未执行**（沙箱无 Docker）。
  - 期间发现并修复的 4 个实现缺陷：①`ManagedAccountsService.verifiedAccount` 原先按 `accountVersion`/`authTime` 读取声明，而认证链路传入的是原始 JWT 声明 `platform_account_version` / `auth_time` / `iat`，会导致所有自管令牌被拒绝；②`packages/component-cli/src/contracts/` 的契约内联镜像缺少 `managed-accounts.ts`，`tests/unit/access-credentials.test.ts` 因此无法加载，已同步镜像并登记到 `scripts/sync-contracts.mjs`；③`CompanyOidc.authenticate` 在「未激活任何接入配置」的分支原先完全跳过自管声明核验，已改为同样核验签名账号版本与认证时间，失败关闭；④`tests/unit/access-generation.test.ts` 的 fallback 替身只提供 `verify`，`OidcVerifier` 新增 `verifyWithClaims` 后已同步该替身，并补一项「无激活配置仍核验自管声明」用例。
  - 未覆盖边界（不得据本记录声称已完成）：真实 Keycloak 集成（`platform_account_version` 与 `auth_time` 是否出现在 access token）**未验证**，realm 模板已声明 mapper，`infra/self-managed-versions.json` 记录为待实测；首次改密（`UPDATE_PASSWORD`）后的登录与 `auth_time` 变化 **未验证**；Keycloak 版本与镜像 digest **未固定**，compose 通过 `${SELF_MANAGED_KEYCLOAK_IMAGE:?...}` 失败关闭，不拉取 `latest`；`tests/platform/managed-accounts.test.ts` 真实 PostgreSQL 集成（含 HTTP/网关并发、故障恢复）**未执行**；`pnpm test` 根回归（2292+ 用例）、`pnpm build` 全图、`test:browser` **未执行**；本机浏览器验收（管理员完整成员管理、非管理员拒绝、首次改密回跳、Vue/React 预览、旧授权撤销）**未执行**；撤权时限实测 **未实测**，设计第 5 节的生产目标时限仍待部署负责人确认；正式部署验收、公司部署责任与双业务试点 **未开始**。
  - 合并：2026-11-22 以 `--no-ff` 合并入 `main`，**合并提交 `8ce44290`（父提交 `b6656819` + `b4ea3cdf`），62 个文件、约 3600 行新增**。合并前重查：`main` 仍停在 `b6656819`、主工作树干净、`main` 未被其他 worktree 检出；合并后核对 `git diff --name-only b6656819 8ce44290` 为 **62 个文件（非空）**。
  - 合并后在合并结果上重跑：contracts/api/gateway/gallery 四项 typecheck 0 错误、`verify:workspace` 通过、`tests/contracts` + `tests/unit` + `tests/gallery` **52 文件通过（950 项断言通过）**、10 文件因沙箱缺 `pnpm` / `@playwright/test` / `vite` / charts 构建失败。与合并前分支结果逐项一致。
  - `main` 领先 `origin/main` **8 个提交，尚未 push**（push 需用户明确授权）。分支 `feat/self-managed-accounts-impl` 与 `feat/self-managed-accounts` **保留未删**，是否清理由用户决定。
  - 边界与安全自查：迁移 `012_managed_accounts.sql` 不存储任何密码材料，`identity_operations` 的 CHECK 约束不含密码类操作，密码设置只能走瞬时受保护请求；账号视图契约（`managed-account-summary/detail/list-response/audit-response`）一律 `additionalProperties: false`，单测覆盖拒绝 `password`、`remoteUserId`、`token`、`secretRef` 等字段；身份管理出站复用 `RestrictedHttps` 的部署白名单、地址固定与平台信任库，服务账号取 realm 内 `manage-users`、`view-users`、`query-users`、`query-groups`、`view-realm`，缺失任一即拒绝授权；`infra/gateway/preview-role.sql` 仅新增 `managed_accounts` 的 `SELECT`，网关不获得写权限；本机身份栈凭据、CA 私钥与 TLS 私钥只写入 `.tools/self-managed/`（`.gitignore` 已覆盖 `.tools/`），初始超管密码仅在 bootstrap 控制台打印一次。
- 结论与状态：**代码与沙箱测试已合入 `main`（`8ce44290`，未 push）；真实 Keycloak/平台集成、浏览器验收、撤权时限、正式部署验收均未执行。** 是本主题中版本号最新的一轮（取代 `g2-access-settings-2026-11-22.md` 的 0.0.9/0.0.11/0.0.12/0.0.4/0.0.26）。
- 交叉引用：`g2-access-settings-2026-11-22.md`、`docs/guides/access-settings.md`、`docs/guides/self-managed-accounts.md`、`docs/specs/2026-11-22-self-managed-accounts-design.md`、`docs/plans/2026-11-22-self-managed-accounts-implementation.md`、`t11-pilot-rehearsal-2026-11-21.md`、`infra/self-managed-versions.json`、`infra/gateway/preview-role.sql`、`scripts/sync-contracts.mjs`。
- 过时或矛盾点：**沙箱零实跑，不得据此声称全图回归通过。** 文中 550/950/52 文件等计数只在沙箱轻量环境下成立，且 10 个 tests/unit 文件失败是环境限制。另注意本记录的合并提交 `8ce44290` 与 `g2-five-items-2026-11-22.md` 的基线 `6511ba77`、`g1-t10-closeout-2026-11-21.md` 的 `d289cc88` 是同一 `main` 线上的不同时点。

### turbo-baseline.md

- 日期／角色／主题：2026-11-11；Windows x64，Node 26.13.0 / pnpm 12.18.0 / Turbo 2.11.10，仅使用本地缓存。角色：综合（工程基建）。文件开头自带「历史记录」横幅，指向 Nest/React 记录为准。
- 目的：首次初始化的任务图与缓存实验基线。
- 承重事实：
  - 完整 build/typecheck dry run → **10 包、20 任务**；框架依赖 core，示例依赖对应框架，平台依赖 contracts（`turbo-full-graph.json`，仅保留任务字段）。
  - 服务白名单 dry run → **5 任务**：contracts build，API 和网关各 build/typecheck（`turbo-services-graph.json`）。
  - 第一次全量构建 **10/10 成功，0 缓存**；不修改输入再次 build → **10/10 命中**（`build-repeat.log`）；core 源文件追加临时注释后 build → **core、两框架、两示例共 5 项失效；contracts、CLI、gallery、两服务共 5 项命中**（`build-core-change.log`）；字节级恢复 core 后 build → **10/10 再次命中**（`build-restored.log`）；`build:services` **5/5**，未调度图表/示例。
  - `dev` → **10 个持久任务以 concurrency=12 启动；5 个 HTTP 入口返回 200**；本机首次 Ctrl+C 停在 shutting down，第二次结束子任务。
  - 可重新运行命令：`pnpm exec turbo run build typecheck --dry=json`；`pnpm exec turbo run build typecheck --filter=@company/platform-api --filter=@company/preview-gateway --dry=json`；`pnpm build`；`pnpm build`。
  - 缓存失效实验应在没有其他构建/编辑操作时进行，保存源码原始字节，临时修改 core，再构建，最后通过 `finally` 恢复并构建；**不要提交探针注释**。
  - 根 package.json/lockfile 与 Turbo 默认输入共同跟踪版本；全局输入另含 `.node-version`、workspace 与共享 TS 配置。**原计划提及的 `versions.lock.json` 不重复维护。**
  - 基础测试与浏览器测试直接调用 Vitest/Playwright，**没有进入 Turbo 缓存**。正式 tarball 消费、截图、基线接受和发布尚未实现。
- 结论与状态：完成（基线实验）。**服务图与构建验证已被 `nest-react-bootstrap.md` 取代**；缓存行为结论仍有效。
- 交叉引用：`bootstrap.md`、`nest-react-bootstrap.md`、`turbo-full-graph.json`、`turbo-services-graph.json`、`build-repeat.log`、`build-core-change.log`、`build-restored.log`、`nest-react-build-repeat.log`。
- 过时或矛盾点：**Fastify 时代的任务图（API/网关为 `tsc -p tsconfig.build.json`）已过时**——`nest-react-bootstrap.md` 起改为 `nest build`。`turbo-full-graph.json` 中 `@company/platform-api#build` 的 hash `802b430e5627d7c9` 与 `nest-react-build-repeat.log` 中同名任务的 hash 一致（同一缓存条目），但 `nest-clean-typecheck-green.log` 中 API build hash 为 `a4a76444cfde777d`（不同命令），引用 hash 时须注明出处文件。

### t11-pilot-rehearsal-2026-11-21.md

- 日期／角色／主题：2026-11-21（Asia/Shanghai）。角色：综合（T11 试点流程演练）。主题：合成双框架试点演练。分支 `feat/t11-pilot-rehearsal`，基线 `7eb5e521`（= `chore/g1-t10-acceptance-closeout`，即 `main` `d289cc88` 之上的 G1/T10 收尾提交）。
- 目的：以合成 Vue/React 工程完成 T11 试点流程演练并承载它的验收测试。
- 承重事实：
  - **本轮结论：T11「两个真实业务项目」标准项仍未完成，本记录不将其标记为完成。** 本轮交付的是该流程的合成演练与承载它的验收测试，`satisfiesRealBusinessPilot` 恒为 `false`。
  - 授权与口径：用户本轮授权新建开发分支、以合成工程完成 T11 试点流程、验收后清理临时工程；经确认口径为**记为预演、标准项保持开放**——不修改 T11 验收标准，也不把合成工程冒称真实业务项目。
  - 该口径与 T11 第 1 项原文一致：「用真实 Vue 和 React 项目（用户提供访问范围）安装精确发布版本；只读识别项目后创建可审查变更，完成类型/构建、点击/更新交互和页面核对，记录框架/引擎版本。**合成消费者不能替代这一步。**」
  - 基线选择原因：本机 worktree 从 `7eb5e521` 切到 `d289cc88` 需要删除收尾提交新增的文件，而沙箱 `unlink` 被禁，切换会失败；两者同 commit 使切回无需改动任何文件。**这不是对基线的技术评价。**
  - 已交付文件：`tests/integration/t11-support/pilot-harness.ts`（T11 试点可复用机械部分：只读识别、可审查变更清单、命令结果记录、receipt 组装与判定护栏；**非 Vitest 用例**）；`tests/integration/platform-acceptance.test.ts`（T11 Files 指定的集成验收测试，此前不存在）；`tests/browser/platform-acceptance.spec.ts`（T11 Files 指定的浏览器验收测试，此前不存在）。
  - harness 行为约束：只读识别不写工程；字节证据全部由本进程 `fs` + `crypto` 实算，不读任何 fixture 占位摘要；临时目录只在系统临时根、带 `t11-pilot-` 前缀、每例独占，清理前 `lstat` 复核登记且只对 `nlink===1` 的普通文件 `chmod`，不跟随符号链接；`synthetic` / `productionAcceptance` / `satisfiesRealBusinessPilot` 三字段由调用方强制提供，`synthetic: true` 配 `satisfiesRealBusinessPilot: true` 或 `productionAcceptance: true` **直接抛错**。
  - 浏览器断言语义沿用已冻结的 T17 契约（CLI 0.0.23）：动作后断言共用同一等待预算、文本取首个匹配元素 `textContent().trim()`、数量精确相等、可见性须非零宽高、pageerror 与非 loopback 外发请求均失败。
  - 未执行项（阻塞）：沙箱内**无法运行**本仓库锁定的 Windows 工具链（可用 Node 为 `v22.23.5`，项目固定 26.13.0；无 `pnpm`；`node_modules` 不完整，缺 `@esbuild` 平台包与 `vitest`）。因此 `vitest run`（含新增集成测试）、`playwright test`（含新增浏览器测试）、合成工程的 typecheck/build/依赖安装、根 `tsc --noEmit`、`verify:workspace`、全图 build/typecheck **全部未执行，且未用退出码 0 冒充**。
  - 已执行的唯一验证是全局 `tsc --noResolve --target es2022 --module esnext --moduleResolution bundler --strict` 对三个新文件的**语法**核对（无 `TS1xxx`）。`--noResolve` 不解析导入，导入路径只经人工核对（`./t11-support/pilot-harness.js`、`docs/integration/t11-support/pilot-harness.js` 均对应真实文件，`.js` 后缀与仓库 NodeNext 约定一致）。
  - 引 AGENTS.md：「不得基于假设、Turbo 缓存命中或部分输出报告成功」「如果必需的外部检查无法运行，记录阻塞原因，并保持对应任务状态为未完成」。
  - T11 五项标准项当前状态：

    | 标准项 | 状态 |
    | --- | --- |
    | 1. 两个真实 Vue/React 业务项目安装精确发布版本并完成识别/变更/类型构建/交互/页面核对 | **未完成**（用户未提供真实业务项目访问范围） |
    | 2. 故障注入（PG/MinIO/Verdaccio 暂不可用、上传中断、worker 重启、发布响应丢失、索引失败、权限撤销） | 2026-11-12 已实测通过（**7 项故障预演 + 12 项预览授权回归，合计 19 项**），见 `docs/acceptance/pilot-report.md`，本轮未重跑 |
    | 3. 结构化日志与脱敏 | 2026-11-12 已接入（`taskId/requestId/stage/attempt` 白名单 JSON，原始凭证/URL/业务内容不记录），本轮未改动 |
    | 4. 容量验收输入（200 组件/400 实现/20 并发/p95≤500ms；100MiB 续传；元数据发布 p95≤30s） | 仅 C 本地预演已验证、**非生产 SLA**；`scripts/rehearse-capacity.ts` 存在，本轮未重跑 |
    | 5. 运行验收测试与两个真实项目的原生命令，逐项保存实测结果 | **未完成**（验收测试本轮才补建且未执行；真实项目原生命令无从运行） |
  - `apps/api/src/observability/{events,metrics}.ts`、`scripts/rehearse-recovery.ts`、`docs/acceptance/pilot-report.md` 本轮之前已存在，未修改。T11 Interfaces 提到的 `recordUsage(event:{type,variantReleaseId?,projectId?,timestamp})` 在全仓库不存在（已 grep 确认），本轮未实现。
  - 收尾：临时工程全部位于系统临时根并由 harness 登记，`releasePilotDirs()` 在 `afterAll`/`afterEach` 释放；未创建工程内临时目录，未触碰 `.tools/`、锁文件、契约或版本号；未执行 `git push`、`tag`、合并或生产发布。
- 结论与状态：**阻塞/未完成（T11 标准项 1 与 5 未完成）。** 依赖 `g1-t10-closeout-2026-11-21.md` 的基线与冻结产物。
- 交叉引用：`g1-t10-closeout-2026-11-21.md`、`docs/acceptance/pilot-report.md`、`docs/guides/operations.md`、`docs/guides/quickstart.md`、`docs/AGENTS.md`。
- 过时或矛盾点：**最容易误读的一篇。** 文中「本轮完成」仅指合成演练范围内的交付，不推断 T11/T12、公司 OIDC、生产独立预览域、完整生产 G2、真实业务试点任何一项。另「容量验收输入仅 C 本地预演验证」与 `docs/guides/operations.md` 中的 `rehearse:capacity` 描述一致（p95 初始目标 500ms / 30s，nearest-rank），但两者都不是生产 SLA。

## 历史脉络

**2026-11-11：一天之内的三重奠基。** 上午先做首次工程初始化（`bootstrap.md`、`bootstrap-review.md`、`turbo-baseline.md`）：把 Node 26.13.0 / pnpm 12.18.0 / Turbo 2.11.10 固定到项目 `.tools`，处理 pnpm 12 原生平台包、workspace YAML `allowBuilds`、Windows PowerShell 5.1 `-UseBasicParsing` 三项适配，得到 workspace 10 成员 / 4 公开包壳 / build 10/10 / typecheck 14 个 Turbo 任务 / test 5/5 / browser 3/3；独立审查（`fbbddd8..90015e8`）给出 Critical 0 / Important 1 / Minor 0，唯一 Important 即 PowerShell 首次下载需确认，并留下「审查员未验收范围」9 行清单（G1 schema/运行时、G2 三存储/OIDC/域名/TLS/镜像、T02–T17、非 Windows x64 保证、人员容量）。同日随后按用户要求把 API 与预览网关改为 NestJS（`nest-react-bootstrap.md`，端口 3000/3001，Express 适配器 + TS 6.0.3，独立审查 `09742a0..8e72a87` 仅 1 项 Important 并已修），确立 G0 工程基线完成；同日又把画廊宿主迁到 React 19.3.1 + Next.js 16.4.6 App Router（`gallery-next-migration.md`，端口仍 5173），固定 `(public)`/`(console)` 渲染边界与 sitemap 语义，并因 A→B→A 域名切换的 route-cache 残留给 gallery 单独关掉 Turbo 输出缓存。此时后端仍是 Fastify 叙事、画廊仍是 React+Vite，二者随后分别被上述两篇取代。

**2026-11-12：G1 契约候选与 G2 本地三存储同日落地，随后合并与入口收敛。** C 在 `feat/g1-platform-contracts`（基线 `8304bff`）落地 23 份 JSON Schema、合成 fixtures 与 RED→GREEN 阶梯，契约经两轮 hardening 从 124/124 到 145/145，独立审查（`2b51b25`）揪出 4 项 P2 并全修；同篇明确「代码候选验证通过；G1 人工门槛仍未通过」「没有替 A/B 伪造业务签字」。同日 `g2-example-contract-2026-11-12.md` 把 `ComponentExample.states` 定为可选只读枚举（146/146），`g2-local-infra-2026-11-12.md` 建独立 Compose `zhinexus-g2`（回环 15432/14873/19000）跑通两轮真实设施探针，`infra:check-access` 未配置退出 2、`g2Ready: false`；独立审查 2 项 P2（S3 15 秒 deadline、预览域需核对管理 API）均修。`g2-main-merge-2026-11-12.md` 把 main 从 `471ae8e` 快进到 `35725fb` 并复验（198/198、15/15、10/10、14/14），**合并不代表生产或业务发布验收**。同日 `scripts-maintenance-2026-11-12.md` 把根 scripts 从 8 个文件减为 5 个，确立四组入口迁移，并规定历史记录中的旧命令保留当时原貌——这一条成为此后阅读全部早期记录的前提。

**2026-11-13：A/B/C 三侧 Windows 真实证据。** 该批 `.evidence.json` 原件（SDK 0.0.7 的十四实现发布、SDK 0.0.10 的 Windows 全链路与 strict/ Bundler 矩阵、画廊 0.0.4 真实网页上传终局复验、C 侧十四实现三存储全链路验收）构成本主题 G1/T10 收口的素材基础，也记录了同一天的两个反复出现失败模式：共享 `.tools/g2-local/credentials.json` 缺失导致 `tests/integration/cli-release.test.ts` 失败，以及「不要并行执行 platform/browser」的并发约束。

**2026-11-21：G1/T10 技术收口与预览 IP 端口、T11 合成演练。** `g1-t10-closeout-2026-11-21.md`（基线 `d289cc88`，提交 `2bf96932`）把契约推到 18 文件 522/522，T10 五项技术验收全过（6.1.0 hold 56 图标、CLI 0.0.24→0.0.25 冻结重做、仓外冻结消费者生命周期 11/11、画廊 154 测试、真实三存储 14 实现），工程门禁 2271/2271 与 306/306；结论仍是「A/B 技术审查及修正复核已完成，实际评审人的业务回执和人工通过结论待签署」。同日 `preview-ip-port-2026-11-21.md`（基线 `2cd035ff`）验证同 IPv4 分 HTTPS 端口试用模式，并明确它是试用模式而非 G2 替代。同日 `t11-pilot-rehearsal-2026-11-21.md`（基线 `7eb5e521`）交付合成演练与承载它的验收测试，`satisfiesRealBusinessPilot` 恒为 `false`，标准项 1 与 5 未完成。

**2026-11-22：G2 五项实测、接入设置落地、自管账号合入与 G1 人工放行。** `g2-five-items-2026-11-22.md`（基线 `6511ba77`）给出本主题最权威的 G2 结论：七轮真实三存储实测，第五/六/七轮各 9 条检查通过，前四轮失败原件保留，PostgreSQL/Verdaccio/MinIO 三项 `local-measured-passed`，OIDC 与预览接入 `unconfigured`、退出码 2、`g2Ready: false`；收尾还因并行执行根类型检查与服务构建导致退出 1，顺序复跑才通过，失败原件未被隐藏。同日 `g2-access-settings-2026-11-22.md`（分支 `feat/g2-access-settings`）用 9 个实现提交把接入设置能力完整落地，独立审查 Critical 0 / Important 9 全修，`test:platform` 148/148、根 test 2306+2（总 2308）、`test:t10` 168/168、双模式浏览器 317 + 4，`verify:deployment` 给出 `templateValidated=true / environmentValidated=false / productionAcceptance=false`。同日 `self-managed-accounts-2026-11-22.md`（基线 `d700802d`）在 Linux 沙箱自建轻量环境跑出 contracts 20 文件 550 测试、合并后 52 文件 950 断言，修 4 个实现缺陷，以 `--no-ff` 合入 main（`8ce44290`，父 `b6656819` + `b4ea3cdf`，62 文件约 3600 行），版本升至根 0.0.10 / API 0.0.12 / 画廊 0.0.13 / 网关 0.0.5 / CLI 0.0.27，main 领先 origin/main 8 个提交未 push。**同日做出 G1 人工放行决定（A/B 业务回执不作前置）**——该决定只覆盖 G1，不涉及 G2：G2 仍缺真实外部资源。

## 证据文件

以下 `.log` / `.json` 证据文件均由本次整理移至 `docs/verification/evidence/` 目录，按文件名列出用途与关键数字。

- `bootstrap-ps51-green.log` — Windows PowerShell 5.1 bootstrap 修复后的 GREEN 证据 — 8 行：`Checking Windows PowerShell 5.1 bootstrap: fresh download` / `Downloading Node 26.13.0 to project-local .tools` / `Downloading pnpm 12.18.0 to project-local .tools` / `Project toolchain ready: Node 26.13.0 / pnpm 12.18.0` / `cached rerun` 同样 ready / 末行 `Windows PowerShell bootstrap passed: clean download, checksums, pinned executable versions, cached rerun.`
- `bootstrap-ps51-red.log` — 修复前的 RED 证据 — 10 行：同样先下载 Node/pnpm，随后 `Invoke-WebRequest : Windows PowerShell is in NonInteractive mode. Read and Prompt functionality is not available.`，出错位置 `.tools\bootstrap-check-06dc6c0a9a784daca5c1462d9414b3cc\scripts\bootstrap.ps1:18 char:12`，语句 `$sums = (Invoke-WebRequest -Uri "$baseUri/SHASUMS256.txt").Content`，`FullyQualifiedErrorId : InvalidOperation,Microsoft.PowerShell.Commands.InvokeWebRequestCommand`。
- `build-core-change.log` — Turbo 缓存失效实验（core 加临时注释）— `turbo run build --cache=local:rw`，turbo 2.11.10，10 packages；charts-core `cache miss, executing e9d870a4f3f4685f`，charts-react `cache miss a67f043ca4800c47`，charts-vue `cache miss e114a3798c11d62d`，example-react `cache miss 3eeb99c7037fc9a0`，example-vue `cache miss 3af55dad1091d6d7`；contracts/component-cli/platform-api/gallery/preview-gateway 5 项 `cache hit`；React 示例 chunk **504.26 kB / gzip 163.84 kB**（>500 kB 警告），Vue 示例 347.34 kB / 120.15 kB。
- `build-repeat.log` — 不修改输入的重复构建（10/10 命中）— 10 个包全部 `cache hit`；各 hash：core `988cbf5cce571fe3`、contracts `33f4e6c6d6a7cb47`、charts-react `72e26b255d6cc9e5`、charts-vue `61706faedb61d2be`、preview-gateway `5fdf6c2e7cad6a10`、gallery `85522caaa5ed17ba`、component-cli `6cd16280e5ff60a0`、platform-api `802b430e5627d7c9`、example-react `7ce958a410a08cf8`、example-vue `b01a8b5a1bebcb35`。
- `build-restored.log` — 字节级恢复 core 后的构建（10/10 再次命中）— 与 `build-repeat.log` 同样的 10 个 hash 全部 `cache hit`。
- `final-checks.log` — bootstrap 修复后的完整验证 — 开头 `Scope: all 11 workspace projects`、`✓ Lockfile passes supply-chain policies (verified 23m ago)`、`Done in 42ms using pnpm v12.18.0`、`tsx scripts/verify-workspace.ts` → `Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`；随后 10 包 build 全部 cache hit（同 `build-repeat.log` hash 集合）。
- `nest-clean-test.log` — 缺 dist 时的测试启动验证 — 命令 `pnpm build:services && vitest run` + `turbo run build typecheck --filter=@company/platform-api --filter=@company/preview-gateway --cache=local:rw`；5 个任务 `cache bypass, force executing`（contracts `33f4e6c6d6a7cb47`、preview-gateway typecheck `7a66d112fa611bd0`、platform-api build `a4a76444cfde777d`、platform-api typecheck `df30500e08e6ac82`、preview-gateway build `d8e5dca631069ee1`）；`Tasks: 5 successful, 5 total` / `Cached: 0 cached, 5 total` / `Time: 1.727s`；Vitest v5.1.0 → `Test Files 1 passed (1)`、`Tests 5 passed (5)`、Duration 499ms。
- `nest-clean-typecheck-green.log` — 缺 dist 时修复后的 typecheck GREEN — 命令 `pnpm build:services && turbo run typecheck --cache=local:rw && tsc -p tsconfig.json --noEmit`；先 5 个服务任务 `cache bypass`（`Tasks: 5 successful` / `Cached: 0 cached` / `1.701s`），再 10 包全图 typecheck 全部 `cache bypass, force executing`（含 example-vue `vue-tsc --noEmit`、example-react `tsc --noEmit`）；`Tasks: 14 successful, 14 total` / `Cached: 0 cached, 14 total`。
- `nest-clean-typecheck-red.log` — 修复前的 typecheck RED — `turbo run typecheck --cache=local:rw` 14 任务全部 `cache hit`（`Time: 19ms >>> FULL TURBO`），随后根 tsc 报 **两条 TS2307**：`tests/unit/bootstrap.test.ts(3,29): error TS2307: Cannot find module '../../apps/api/dist/app.js'`、`tests/unit/bootstrap.test.ts(4,51): error TS2307: Cannot find module '../../apps/preview-gateway/dist/app.js'`，`[ELIFECYCLE] Command failed with exit code 1.`
- `nest-react-build-repeat.log` — Nest/React 调整后的重复构建（10/10 命中）— 10 包全部 cache hit；gallery hash 变为 `7b6ee63ba246e816`（chunk 219.80 kB / 68.87 kB，17 modules），platform-api `a4a76444cfde777d`、preview-gateway `d8e5dca631069ee1`（命令为 `nest build`）；React 示例 504.26 kB 警告仍在。
- `nest-react-checks.log` — Nest/React 调整后的完整验证 — `Scope: all 11 workspace projects`、`✓ Lockfile passes supply-chain policies (verified 11m ago)`、`Done in 49ms using pnpm v12.18.0`、`Workspace verified: 10 members, no cycles, four publishable shells, safe service graph.`；build 10 包全 cache hit（含 `nest build` × 2、gallery `7b6ee63ba246e816` 219.80 kB）。
- `nest-services-red.log` — 服务 HTTP 测试在 Fastify 工厂上的 RED — Vitest v5.1.0；`tests/unit/bootstrap.test.ts (5 tests | 2 failed)`；两条失败：`api exposes liveness without claiming production readiness`、`preview-gateway exposes liveness without claiming production readiness`；`TypeError: Cannot create property 'host' on number '0'`，栈为 `node_modules/.pnpm/fastify@5.12.8/node_modules/fastify/lib/server.js:72:26` 与 `tests/unit/bootstrap.test.ts:25:22`（`await server.listen(0, '127.0.0.1')`）；`Tests 2 failed | 3 passed (5)`；`[ELIFECYCLE] Test failed.`
- `nest-service-smoke.json` — Windows 服务入口冒烟（start/dev × 2 服务）— `verifiedAt: 2026-11-11T10:30:19.834Z`、`platform: win32`、`stopMethod: "taskkill /T /F of each test-owned parent PID; not a graceful signal verification"`；4 条 results（api start / api dev / preview-gateway start / preview-gateway dev），每条 `health: {status:"ok", service:"api"|"preview-gateway", stage:"bootstrap"}`、`status: 200`、`portReleased: true`。
- `nest-services-graph.json` — 服务任务图 dry run（5 任务）— 数组 5 项：`@company/contracts#build`（`tsc -p tsconfig.build.json`，无依赖，outputs `dist/**`）、`@company/platform-api#build`（`nest build`，依赖 contracts#build）、`@company/platform-api#typecheck`（`tsc -p tsconfig.json --noEmit`，outputs null）、`@company/preview-gateway#build`、`@company/preview-gateway#typecheck`；**没有图表/画廊/CLI/示例/浏览器任务**。
- `nest-typescript-compatibility.json` — Nest 编译器选择依据 — `queriedAt: 2026-11-11T10:33:54.7060762Z`、`source: https://registry.npmjs.org/@nestjs%2fcli/12.0.12`、`version: 12.0.12`、`engines.node: ">= 20.11"`、`typescriptDependency: "~6.0.2"`、`selectedServiceTypeScript: "6.0.3"`、`rationale: "Align Nest CLI watch/build and application typecheck compilers; root and React gallery stay on 7.0.2."`
- `turbo-full-graph.json` — 完整 build/typecheck dry run（10 包 20 任务）— `capturedAt: 2026-11-11T17:37:13.7884950+08:00`、`turboVersion: 2.11.10`；20 个 taskId 各带 hash/dependencies/outputs；依赖关系：charts-react/charts-vue 依赖 `charts-core#build`，example-react 依赖 `charts-react#build`，example-vue 依赖 `charts-vue#build`，component-cli/gallery/platform-api/preview-gateway 依赖 `contracts#build`；charts-core 与 contracts 无依赖。**注意：API/网关 build 的命令在此文件中写作 `tsc -p tsconfig.build.json`（Nest 化之前）。**
- `turbo-services-graph.json` — 服务白名单 dry run — 同 `capturedAt`、同 turboVersion；5 个任务（contracts#build + 两服务 build/typecheck），与 `nest-services-graph.json` 结构一致。
- `vue-typescript-exception.json` — Vue SFC 类型检查的 TS6 例外 — `name: "typescript"`、`version: "6.0.3"`、`engines.node: ">=14.17"`、`integrity: sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==`、`source: https://registry.npmjs.org/typescript/6.0.3`、`reason: "Vue SFC type checking only; vue-tsc/volar require the pre-7 JavaScript compiler API. Root stays on 7.0.2."`
- `c-a-sdk0010-windows-2026-11-13.evidence.json` — A 侧 SDK 0.0.10 在 Windows 的真实发布与消费者证据（C 复核）— `verifiedAt: 2026-11-13T07:34:39.752Z`、`sdkSourceCommit: 190b60bfc583fc68611a21d270784017b7f91f11`、`cSupportCommit: 6dcf6fa`、`archive: .tools/operations/a-sdk-native-190b60b/source`；4 个 supportFiles 各带 SHA-256；`validation`：frozenOfflineInstall `downloaded: 0, packages: 344`；buildAndTypecheck `20/20 successful, 0 cached, 6.584s`；unitAndContracts `20 files, 379 passed, 7.14s`；rootTypecheck/workspace true；platformCurrentSdk `1 passed, 63.14s`。`publication`（`verifiedAt: 2026-11-13T06:58:18.623Z`，win32/x64）：7 个组件（line/bar/pie/scatter/trend-card/ranking/proportion）；charts-core 0.0.10 `2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752`、charts-vue 0.0.10 `b01aeec7604b2c399a6cb1efa7b4ba1ac3092f12ea92322c682a188045e8c01b`、charts-react 0.0.10 `cd625741f37a95f81b395b45bce6a34d439135dcaa1df3ea5989c73159ab8e5c`；`implementationCount: 14`；registryConsumers vue/react 各 `version 0.0.10, exports 7`；`state: READY`、`previewFilesMatch: true`；14 个 browserPreviews（7 组件 × 2 框架），每项 5 个检查全 `passed`（fonts-ready / no-page-error / series-rendered / single-instance / valid-dimensions），入口形如 `https://r-<uuid>.preview.assets.test:57819/preview/<variant>/index.html`；14 个 `variants` 各含 api/docs/reports/screenshots 摘要。`strictConsumer`：red（`verifiedAt 2026-11-13T07:26:48.025Z`，bundle `.tools\operations\current-sdk\4414e01c-2220-4940-8c93-979250c83259`，包为 **0.0.7**，`importCount: 17`，`installExitCode: 0`，4 组类型检查中 **typescript6/NodeNext 退出 2、typescript7/NodeNext 退出 1**，错误均为 `charts-vue/dist/*.d.ts ... TS2307: Cannot find module './*Chart.vue'`；typescript6/Bundler 与 typescript7/Bundler 退出 0；6 条 policy 中 **3 条 passed=false**：`measured version differs from candidate`、`report cannot rewrite supported baseline`、`Vue only matrix`、`React only matrix`（actual 均为 `adopt`，expected `hold`））；green（`verifiedAt 2026-11-13T07:33:49.960Z`，bundle `.tools\operations\current-sdk\dcc49e73-37c6-4579-a814-713e780ae583`，包为 **0.0.10**，`expectedExitCode: 0`）。`inputGuardRegression`：`exitCode: 0, passed: 8`（TAP 8 项：拒绝未约定的 schema 版本、拒绝 core-only 输入、拒绝 parent escape、拒绝 absolute escape、拒绝 junction escape、拒绝缺公开入口的打包框架、拒绝 null style export、拒绝安装包中缺失的 style target）；`observedRed: {passed: 0, failed: 8, falseSuccesses: 7, absolutePathFailure: "ENOENT rather than explicit input validation", styleCases: ...}`。`cRootChecks`：typecheck/workspace/nodeSyntax/diffCheck 均 true；`fullTest: exitCode 1, filesPassed 32, filesFailed 1, testsPassed 599, testsFailed 1, durationSeconds 108.89`，失败测试 `tests/integration/cli-release.test.ts`，原因 `Missing shared .tools/g2-local/credentials.json; no shared credentials were initialized or rotated.`。`limitations` 4 条：本地签名 OIDC fixtures 与测试用自签名 TLS，无公司登录或生产 TLS 验证；消费者捕获仅默认状态；公司 OIDC 与生产独立注册域/TLS 仍未验证；T10 上游 6.0.0 视觉矩阵与 B CLI 升级 runner 仍未验收；完整 G2/M2/T11/T12 与真实业务试点验收仍开放；平台发布使用 A 产品源码加四个显式复制的 C 测试支持文件。
- `c-a-sdk007-windows-2026-11-13.evidence.json` — A 侧 SDK **0.0.7** 在 Windows 的十四实现发布证据 — `verifiedAt: 2026-11-13T05:31:58.594Z`、os win32 / arch x64；7 个组件；charts-core 0.0.7 `70232cd9e90b8afc4e63b64645060b3b01bbd2eb21de3f17bcfa38d9df49a513`、charts-vue 0.0.7 `861d4ee9ce99807eb204dedea81cd6bcab7ab350f3bd71fc1cdac0bbf1fd4f28`、charts-react 0.0.7 `e4630ba239fda6e47d5f4cba2e7d3efb1f2f76dce78a28130d19fa45f0fdf30c`；`implementationCount: 14`；registryConsumers vue/react 各 0.0.7 / exports 7；`state: READY`、`previewFilesMatch: true`；14 个 browserPreviews，入口端口 **57700**（如 `https://r-7346db10-....preview.assets.test:57700/preview/line-vue/index.html`），每项 5 项检查全 passed；14 个 variants 带 api/docs/reports/screenshots 摘要；`limitations` 2 条（同上前两条）。**本文件与 0.0.10 版是同一流程的两个版本快照，引用时须区分端口 57700 vs 57819 与包版本。**
- `c-b-gallery004-final-2026-11-13.evidence.json` — B 侧画廊 0.0.4 真实网页上传的最终 C 复验证据 — `date: 2026-11-13`、`finalCommit: 1624fa3282c517738ef4e94780f32a1f63e2a2a4`、`fixCommit: d2f1fa715da0a0682e174f3abe1d40baee2da53b`、`galleryVersion: 0.0.4`、`sourceArchive: .tools/operations/b-final-1624fa3/source`（archiveSha256 `eca1f1452b50a60e3d0325dddaec6d4201fd617fb5ab4a1041b1b8040d6773bd`）、`cTestSupportCommit: 9253223deaf9f3476f25eb3bdcd6b2f5c8cdaec3`；originalAndAdaptedFixtures 2 组（manual / real，各带 original 与 adapted SHA-256）；4 个 productFiles 带 SHA-256；`generatedSupplementSha256: baa1c4b2b1c422016e5821cbc001b987498aaf4e78d43561f4e608d321fa6329`；7 个 checks 全部 exit 0：install（`install --offline --frozen-lockfile --ignore-scripts`，7.794s）、force-build-typecheck（`exec turbo run build typecheck --force`，7.084s）、generate-real-harness（0.107s）、root-tsc（0.451s，**无 stdout/stderr，Tee-Object 未创建日志文件**）、workspace（0.353s）、upload-unit（`vitest run tests/unit/web-upload-workflow.test.ts tests/unit/api-cors.test.ts`，2.028s）、workflow（`exec tsx tests/acceptance/web-upload-workflow.mts ...`，0.289s）、c-ui（`playwright test --config tests/acceptance/playwright.web-upload.config.ts --reporter=line`，14.091s）、b-original-web（`playwright.c-original.config.ts`，56.22s）、real-lifecycle-retry（`playwright.c-web-real.config.ts --grep 真实三存储全链路|C独立普通提交重试`，50.043s）、**b-root-test（`scripts/pnpm.ps1 test`，91.683s，exitCode 1）**。`counts`：unitFiles 2、unitPassed 32、workflowPassed 14、cUiPassed 12、originalWebPassed 14、realSupplementPassed 2、rootFilesPassed 32、rootFilesFailed 1、**rootTestsPassed 620、rootTestsFailed 1**。`rootFailure`：文件 `tests/integration/cli-release.test.ts`，原因 `Shared .tools/g2-local/credentials.json is missing; platformHarness/localCredentials fails before release preparation`，消息 `Run infra:up before test:platform; real storage is required`，`sharedInfraInitialized: false`，`rootSuitePassed: false`。`integrity`：architectureSha256 三处（c/b/archive）均为基线值；`frozenSdkVersion: 0.0.10`；frozenSdkSha256 core/vue/react 与 0.0.10 证据一致；`lockGitBlob: b8339e49a2419683ccb2dd76fd30cfcb9497699d`；`productsMatchArchiveProvenance: true`。`cleanup`：recoveryContainers 0、recoveryVolumes 0、port5183Listeners 0，`checkedAt: 2026-11-13T18:23:25.9546777+08:00`。
- `c-sdk14-acceptance-2026-11-13.evidence.json` — C 侧十四实现真实三存储全链路验收证据（SDK **0.0.6**）— `verifiedAt: 2026-11-13T04:33:03.815Z`、os win32 / arch x64；7 个组件；charts-core 0.0.6 `7af91861c7ddb4786d1f98669a819625504ce5ad2a00bfee2b311a6f47e4e4eb`、charts-vue 0.0.6 `aa20d821f9a6369c5ec0968049a2eb056f4ea2fd78c62bc1c5b046f55759955f`、charts-react 0.0.6 `91a2f9de25927e062f0f6205d16d4ab881981f9365af41a321ffb04f2f5ffdc4`；`implementationCount: 14`；registryConsumers vue/react 各 0.0.6 / exports 7；`state: READY`、`previewFilesMatch: true`；14 个 browserPreviews，入口端口 **51427**，每项 5 项检查全 passed；14 个 variants 带摘要；`limitations` 2 条（本地签名 OIDC fixtures 与测试用自签名 TLS；消费者捕获仅默认状态）。
- `g2-five-items-2026-11-22.evidence.json` — G2 五项接入实测的机器可读脱敏证据 — `schemaVersion: 1`、`generatedAt: 2026-11-21T19:19:34.500Z`、`localDate: 2026-11-22`、`timezone: Asia/Shanghai`、`baselineCommit: 6511ba772b77ddc055966289ac65aef148f71a37`、`branch: chore/g2-five-item-acceptance`、`owner: C / Codex`；`environment`：Windows/x64、node `v26.13.0`、pnpm `12.18.0`、dockerEngine `29.8.2`；`testSourceAtArchive`：`tests/platform/g2-storage-acceptance.test.ts`，16801 字节，SHA-256 `ad0164e7a98783804b40bd71e63a5c199dcac3248ab48cae58d2281295785878`；architectureSha256 基线值；`preservedReadmeSha256: 3d8a1373b1cfa4e4961b818850fa2bf1ae384a26ace31d5acad6bdd651e49cd7`；`selectedRunId: 2ce653ee-ac1c-4611-a94a-f2798cb30511`；`gate`：`itemCount: 5, g2Ready: false, productionAcceptance: false, status: "incomplete", localMeasuredStorageItems: 3, unconfiguredItems: 2`；5 个 items：postgres（local-measured-passed，3 项检查，version `18.6 (Debian 18.6-1.pgdg13+2)`，payloadSha256 `434ee111...`，duplicateSqlState `23505`，备份 SHA-256 `313c72ab0254c524c6e194a5909d5a72a80696653bd1ca78851a61768bb22268`，恢复库 `g2_restore`）、verdaccio（local-measured-passed，3 项检查，包名 `@g2-probe/probe-2ce653eeac1c4611a94af2798cb30511@1.0.0`，tarballSha256 `9b3f05d7...`，anonymousStatus 401、readerWriteStatus 403、duplicatePublish `E409`）、minio（local-measured-passed，3 项检查）、oidc（**unconfigured**，commands `access-script`/`access-direct`，missing 4 项：company issuer and clients / web login and callback / CLI PKCE and callback / roles and revocation）、preview（**unconfigured**，missing 4 项：target origin and certificate trust / formal domain DNS and certificate chain / release grant and revocation / target browser isolation）；`access`：`checkedAt: 2026-11-21T19:08:18.536Z`、oidc/preview 均 unconfigured、g2Ready false；`commandRecords` 多条，含 `access-direct`（`exec tsx infra/scripts/access.ts`，exit 2，日志 83 字节 SHA-256 `9f658c40...`）、`access-script`（`infra:check-access`，exit 2，configurationSource `infra/access.example.json; G2_ACCESS_CONFIG unset`，日志 233 字节 SHA-256 `8246c692...`）、`final-build-services`（`TURBO_FORCE=true; build:services`，exit 0，约 4.7s）、`final-infra-unit`（exit 0，约 2.5s）、`final-root-types-after-build`（exit 0）、**`final-root-types`（exit 1）**、`final-workspace`（exit 0）、`isolated-storage-fifth/fourth/second/seventh` 等多轮记录（fifth exit 0，fourth/second exit 1）。
