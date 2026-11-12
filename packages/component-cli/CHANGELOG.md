# CHANGELOG

本文件记录 `@company/component-cli` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

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
