# CHANGELOG

本文件记录 `@company/component-cli` 的对外可见变化，遵循语义化版本与 Keep a Changelog 约定。

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
