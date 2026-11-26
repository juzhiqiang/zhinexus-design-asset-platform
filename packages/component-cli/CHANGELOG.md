# CHANGELOG

本文件记录 `@company/component-cli` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

## [0.1.1] - 2026-11-26

### 修复

- 工作台并发编辑保留累积输入，过期验证不会覆盖当前实现或稍后的编辑；验证未完成时禁止保存/准备。
- 源码预览复用项目 Vite 解析、插件及 CSS 编译配置，编译进程使用包目录并继续隔离平台凭证与网络控制策略。
- 项目配置钩子处理前后恢复 CLI 文件和网络策略，绝对文件请求增加真实路径校验；保留 Vite 正规化结果与框架 HMR 生命周期。
- 普通 TSX / Vue SFC 模板、SFC 类型检查及 NodeNext 声明消费；默认消费者桥接置于 .juz，示例只维护 playground.json。
- dataProp 的有效值、基础数组和全部示例状态通过 API/控件校验；dev 与 package/publish 共用包选择规则。

## [0.0.30] - 2026-11-25

### 新增

- 独立 `juz-cli` 分发包在正常 npm 安装时自动下载匹配 Chromium，支持缓存复用和显式跳过，省去首次截图前的手动安装命令。
- 下载失败返回非零并提示重装；已全局安装包可通过 `npm rebuild -g juz-cli --foreground-scripts` 补装，兼容包内浏览器缓存。Linux 系统库仍需按提示准备。

## [0.0.28] - 2026-11-24

### 新增

- 使用项目 JSON 配置执行已有组件包的 init/dev/doctor/prepare-release/release，显式选择框架与分类，检查当前身份和组件/包 ACL。
- 冻结 tarball 后在工作区外实际安装，以 Vite 适配器验证所选导出的真实渲染来源并生成逐实现截图；保留旧 SDK/Bundle 命令。

### 修复

- 共享包的 JavaScript 导出子路径须完整选择，缺失时提示 --framework all 或拆分独立框架包；根聚合入口与静态导出保持兼容。
- 冻结恢复保留首次幂等键和原上传会话，不重新打包；拒绝错框架、源码/二次入口 alias、仅 import 未渲染与产物篡改。

## [0.0.27] - 2026-11-22

### Fixed

- 契约内联镜像同步列表补充自管账号契约模块，构建产物与 `@company/contracts` 保持一致。


## [0.0.26] - 2026-11-22

### Added

- 公司 OIDC S256 回环登录、候选登录验证与用户私有凭据保存。重复正常登录原子替换本机文件。
- 发布、恢复、作业状态和基线消费同一 API origin 的未过期登录，保留显式与环境凭据优先级，并拒绝 API 重定向。

### Fixed

- 原生验证启动前先处理工具链同步检查期间到期的取消，阻止已取消脚本的副作用；运行中的脚本取消继续终止进程树并跳过后续构建。

## [0.0.25] - 2026-11-21

### Fixed

- 多状态截图保留每个状态的检查证据。跨状态同名时生成唯一的报告名称，维持默认状态原名，并明确拒绝单个状态内的重复检查。

## [0.0.17] - 2026-11-19

### Fixed

- 取消本地浏览器验证时立即关闭 Chromium，并将验证结果标记为取消，阻止页面继续产生副作用。

## [0.0.13] - 2026-11-17

### Fixed

- 接入计划按精确包去重注册表证据，保留每个组件实现的发布证据；远端缺口文案使用固定措辞，避免凭据进入输出。
- 权威依赖与本地锁版本不同、MatchPlan 省略已锁 ECharts 上下文时，返回结构化冲突并保留原始输入，不静默升级或输出非法计划。
- 拟生成路径沿多跳链接和 Windows junction 核对真实落点；无法证明安全、链接环或项目外路径均失败关闭，不读取外部文件。

## [0.0.12] - 2026-11-17

### Added

- 新增 `component integrate inspect` 与 `component integrate plan`，只读识别本地项目并生成可审查的组件接入计划。

### Fixed

- 已存在的生成目标同时属于 Git 未提交路径时，同时报告 `OUTPUT_EXISTS` 与同路径 `DIRTY_TARGET`，保持计划符合契约并保留用户文件。

## [0.0.11] - 2026-11-16

### Fixed

- ECharts 检查与默认分发探针支持 core、Vue、React 独立精确版本，按 manifest 顺序绑定聚合版本，保留逐包名称、版本、SHA-256 与字节数校验。
- 帮助补齐 consumer-root、keep、timeout、skip-browser 参数。新候选必须独立安装并重新完成矩阵验收，不复用旧 CLI 证据。

## [0.0.10] - 2026-11-16

### Fixed

- `component check` 在截图后、基线与报告生成前重新核验 core 和当前框架冻结 tarball，期间产物变化时拒绝成功报告。
- `prepareReleaseBundle` 比较 bundle 副本与冻结包的 SHA-256 和字节数，并在消费者安装后及每次截图后核验 staging 源，阻断消费者来源与报告摘要错绑；失败后需重新验证产物。

## [0.0.9] - 2026-11-16

### Added

- ComponentApiV1 材料生成覆盖 line/bar/pie/scatter/trend-card/ranking/proportion 七组件 x Vue/React 的真实导出名、路径、参数、事件、样式与就绪句柄；React 事件为 onPointClick，Vue 为 point-click，optionOverrides 改为真实 SupportedOptionOverrides。
- 新增确定性 ID 规则评估器与规则反例（跨框架事件、错误目标、缺失约束等）；空集与硬违规判定失败。

## [0.0.8] - 2026-11-14

### Added

- `component echarts check` 查询冻结支持矩阵与注册表候选，支持 `--version`、`--latest` 和 `--echarts` 别名，记录候选 integrity 与来源差异。
- `component echarts verify` 编排工作区本地探针并校验冻结三包、候选、双框架及四维证据；缺证据、hold、旧报告复用或非法结果均失败关闭。独立安装 CLI 的探针分发仍未验收。

### Fixed

- 视觉基线对比重新计算环境签名，并在读取 `baseline.json` 时执行运行时契约校验；环境不兼容时保持 `INCOMPATIBLE`。
- PNG 解码校验 CRC、关键块顺序、尺寸和解压上限，支持合法调色板与透明块，拒绝 IDAT 后的 PLTE/tRNS 和未知关键块。
- 基线接受命令校验 API 成功响应，限制 URL、重定向与超时；非 2xx 的 null、数组或标量错误体稳定返回结构化错误。
- 支持 `--job-id` 按服务端 `baselineCandidates` 消歧截图 ID，保留权限校验与 `expectedRevision` CAS。

## [0.0.7] - 2026-11-13

### Added

- 本地 PNG 视觉基线对比，输出 `PASS` / `DIFF` / `NEW` / `INCOMPATIBLE` 与差异图；`component check --baseline-dir` 可复用已有基线。
- `component baseline accept --report <path> --reason <text>`，调用真实基线 API；拒绝手动上传截图、失败报告及不兼容环境。

## [0.0.6] - 2026-11-13

### Added

- `prepareReleaseBundle` 支持排行榜（ranking）与占比（proportion）组件：`ComponentName` 增加 `'ranking'` / `'proportion'`，默认 `components` 覆盖 line / bar / pie / scatter / trend-card / ranking / proportion 七项，为每个组件生成确定截图、CheckReportV1 报告、API 元数据与文档 Markdown，共 14 个变体（T09 第五批）。SDK 0.0.6 导出 `./ranking` 与 `./proportion` 子路径后，平台逐导出覆盖校验会以 `ARTIFACT_MISMATCH` 拒绝未声明这两个子路径的 Bundle。

### Changed

- `COMPONENT_ENTRY_HTML` 与 `COMPONENT_EXPORT` 两张查表补 ranking / proportion 两项（`Ranking`「排行榜」/ `Proportion`「占比」，入口分别为 `ranking.html` / `proportion.html`）。
- `captureExample` 的容器尺寸探测选择器链补 `.charts-ranking` 与 `.charts-proportion`。

## [0.0.5] - 2026-11-13

### Added

- `prepareReleaseBundle` 支持趋势卡片（trend-card）组件：`ComponentName` 增加 `'trend-card'`，默认 `components` 覆盖 line / bar / pie / scatter / trend-card 五项，为每个组件生成确定截图、CheckReportV1 报告、API 元数据与文档 Markdown，共 10 个变体。此前 SDK 0.0.5 导出 `./trend-card` 子路径后，平台逐导出覆盖校验会以 `ARTIFACT_MISMATCH` 拒绝未声明该子路径的 Bundle（T09 第四批）。

### Changed

- 入口文件名、命名导出与中文描述由嵌套三元改为查表 `COMPONENT_ENTRY_HTML` / `COMPONENT_EXPORT`；新增图表时只需扩展两张表。
- `captureExample` 的容器尺寸探测选择器链补 `.charts-trend-card`。

## [0.0.4] - 2026-11-12

### Added

- 补齐六实现完整发布材料：`prepareReleaseBundle` 全面支持 line、bar、pie 三组件在 Vue 与 React 双框架下的 6 份确定性截图、CheckReportV1 报告、规范化 API 元数据及文档 Markdown（T04）。
- 隔离消费者真实静态预览构建：在工作区外干净消费者安装冻结产物后调用 Vite 构建真实静态资源，生成自包含的 `bundle/preview/${variantId}` 页面供沙箱 iframe 隔离运行，纳入材料文件清单（T04）。
- 客户端发布全链路与状态断点恢复命令：新增 `component release`、`component status`、`component resume` 命令入口；实现基于 `.release-session.json` 的本地会话持久化与状态机跟踪，支持大文件切片上传、摘要核验、发布提交、轮询等待与断点恢复（T04/T06）。

## [0.0.3] - 2026-11-12

### Added

- `component prepare-release` 与 `component release --prepare-only` 命令：支持 `--bundle-dir`、`--framework vue|react|all` 与 `--timeout`，自动化完成全流程发布材料准备与冻结 Bundle 产物生成（T04）。
- 发布材料生成与完整文件清单组织 (`prepareReleaseBundle`)：覆盖折线（LineChart）与柱状（BarChart）双组件及其双框架实现（共 4 个变体），生成并冻结 3 个 npm 包候选 tarball、真实截图、NEW 基线报告、API 元数据、组件说明文档与隔离静态预览入口；自动组装无冗余的 `ReleaseManifestV1` 与完整文件清单（T04）。
- Bundle 磁盘读取与契约全量自检 (`loadReleaseBundle`, `verifyReleaseBundle`)：基于不可变字节映射（`filesMap`）严格执行 `validateReleaseBundle`，对缺图（`SCREENSHOT_REQUIRED`）、错配框架（`SCREENSHOT_VARIANT_MISMATCH`）、产物篡改（`DIGEST_MISMATCH`）、清单外未登记文件（`UNEXPECTED_FILE`）及清单内文件丢失（`FILE_REQUIRED`）强制阻断（T04）。

## [0.0.2] - 2026-11-12

### Added

- `component check` 本地验证命令：支持 `--framework vue|react|all` 与 `--staging-dir`，完整执行打包、冻结、干净消费者隔离安装、本地服务启动、Playwright 就绪协议驱动截图与报告生成闭环（T04）。
- 环境指纹探测与签名 (`detectEnvironment`, `computeEnvironmentKey`)：归一化收集 OS、架构、浏览器版本、字体签名、区域与视图配置，生成 64 位 SHA-256 环境签名（T04）。
- 确定性截图捕获 (`captureExample`)：通过 `ready` → `runState` → `getChecks` 协议驱动，等待字体、有效容器尺寸和 ECharts 渲染完成；任何页面运行错误（`pageerror`）或就绪超时均阻断退出（T04）。
- 契约内联与 CheckReportV1 报告生成 (`buildCheckReport`, `validateCheckReport`)：首轮记录 NEW 基线结果，关联同一冻结 tarball SHA-256，所有契约校验完全内联于构建产物，无私有运行时依赖（T04）。

## [0.0.1] - 2026-11-12

### Added

- 摘要计算模块 (`computeBufferSha256`, `computeFileSha256`, `createArtifactRef`, `computeSourceDigest`)：支持内存与文件的 64 位小写 SHA-256 计算，以及排除瞬态产物、统一 LF 换行、正斜杠归一化排序的确定性源码摘要（T04）。
- 打包与冻结基础 (`packPackage`, `freezePackageRelease`, `verifyFrozenTarball`)：支持调用本地工具链 pnpm 执行打包并输出到暂存目录，生成 `fingerprint.json` 固化产物与源码摘要；提供篡改检测，tarball 字节被修改时阻断发布流程（T04）。
- 工作区外消费者验证设施 (`setupCleanConsumer`, `verifyConsumerTypes`, `verifyConsumerRuntime`)：支持在操作系统临时目录构建独立消费者环境，安装真实候选 tarball，验证非软链隔离、无 `workspace:*` 协议、TypeScript 类型声明与 SSR / Node 安全导入（T03）。
- 消费者验证模板目录 (`tests/consumers/core/`)：提供标准消费者测试脚手架（package.json 模板、tsconfig、导出校验与渲染验证入口）。
