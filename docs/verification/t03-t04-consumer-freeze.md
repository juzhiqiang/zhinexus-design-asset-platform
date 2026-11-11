# T03 工作区外消费者验证与 T04 摘要冻结基础验证记录

日期：2026-11-12，Windows 11 x64。
执行角色：B（CLI / 本地验证 / 消费者测试）。
依据约束：`rules/testing-release.md`、`rules/architecture.md`、`rules/security.md` 与 `docs/superpowers/plans/2026-11-11-component-platform-implementation.md`（T03 / T04）。

---

## 1. 实施内容与架构边界

### T03 工作区外消费者验证 (`tests/integration/packed-consumer.test.ts`)
- **真实候选包打包与冻结**：
  - 针对 A 交付的候选包 `@company/charts-core`（当前版本 `0.0.1`），通过 `packPackage` 执行 `pnpm pack` 生成真实 tarball（`company-charts-core-0.0.1.tgz`）；
  - 全链路计算并记录小写 64 位 SHA-256 摘要与文件尺寸。
- **工作区外干净临时目录安装**：
  - 在操作系统临时目录（`os.tmpdir()`）中创建独立消费者项目，写入独立 `package.json`（依赖 `file:<tarballPath>` 与 peer `echarts: 6.1.0`）；
  - 验证安装后路径：`fs.realpathSync` 确认解析于消费者自身虚拟存储，严格禁止 `workspace:*` 内部链接与源码路径 alias。
- **导出与严格类型校验**：
  - 编写消费者 TypeScript 文件，导入全部核心命名导出（`createChartController`、`buildLineOption`、`normalizeChartData`、`formatValue`、`resolveTheme`、`getCoreRuntimeInfo`、`MISSING_VALUE_DISPLAY`、`lightTheme`、`darkTheme`、`ChartDataError`）与类型定义；
  - 运行 `tsc -p tsconfig.json --noEmit`，验证类型声明完整通过；
  - 反例类型测试：引入虚构方法 `NonExistentChartMethod` 触发 `tsc` 编译失败，确保类型检查真实有效。
- **SSR / Node 导入安全测试**：
  - 在纯 Node 环境（无 `window`/`document` 全局对象）中执行脚本；
  - 验证 `getCoreRuntimeInfo` 返回 `{ stage: 'bootstrap', echartsVersion: '6.1.0' }`，数据规范化与 option 构建均安全完成，无 DOM 引用异常。
- **浏览器真实渲染与交互事件**：
  - 启动轻量 Vite 服务托管消费者目录，通过 Playwright Chromium 打开页面；
  - 在有尺寸的容器中通过 `createChartController` 挂载实例，`whenRendered()` 解析后断言生成 1 个 Canvas 画布；
  - 注册 `onPointClick`，模拟数据点点击，断言收到标准 `ChartEvent` 载荷 `{ seriesId, dataIndex, value: ['周二', 200], nativeType: 'pointerdown' }`；
  - 调用 `dispose()`，验证画布正确清理（canvas count 归零）。

### T04 摘要计算与产物冻结基础 (`packages/component-cli/src/local/`)
- **摘要计算模块 (`digest.ts`)**：
  - `computeBufferSha256` / `computeFileSha256`：计算 64 位小写 SHA-256 十六进制摘要；
  - `createArtifactRef`：生成规范化 `ArtifactRef`（`{ path, sha256, bytes }`）；
  - `computeSourceDigest`：确定性源码摘要，规范化正斜杠相对路径排序，统一 LF 换行，严格忽略 `.git`、`node_modules`、`dist`、`.turbo`、`*.log`、`*.tgz` 等瞬态文件。
- **打包与冻结模块 (`pack.ts` & `freeze.ts`)**：
  - `packPackage`：调用工作区 `.tools` 中的固定 pnpm 执行打包并输出到指定暂存目录；
  - `freezePackageRelease`：生成候选 tarball，计算 SHA-256 与 `sourceDigest`，产出 `fingerprint.json`；
  - `verifyFrozenTarball`：完整性校验器，当 tarball 被篡改哪怕 1 个字节时，立即返回 `TARBALL_MUTATION_DETECTED` 并阻断流程。
- **消费者基础设施 (`consumer.ts`)**：
  - `setupCleanConsumer`：自动化搭建工作区外消费者项目并执行真实安装；
  - `verifyConsumerTypes`：驱动 `tsc --noEmit` 校验消费者源码；
  - `verifyConsumerRuntime`：在隔离环境中执行 SSR 运行时脚本。
- **消费者模板 (`tests/consumers/core/`)**：
  - 包含 `package.json.tmpl`、`tsconfig.json`、`verify-exports.ts`、`verify-render.ts` 与 `index.html`。

---

## 2. 实际验证结果与执行证据

| 检查项 | 命令 | 结果 |
|---|---|---|
| 工作区边界与闭包白名单 | `.\scripts\pnpm.ps1 verify:workspace` | 10 个成员固定、无循环依赖、服务依赖闭包安全通过 |
| 产物冻结与指纹单测 | `.\scripts\pnpm.ps1 exec vitest run tests/unit/release-fingerprint.test.ts` | 4/4 通过（含单字节篡改阻断验证） |
| 工作区外干净消费者全链路集成 | `.\scripts\pnpm.ps1 exec vitest run tests/integration/packed-consumer.test.ts` | 1/1 通过（真实 tarball、安装、类型、SSR、浏览器渲染与点击事件） |
| 全量工作区单元/集成测试 | `.\scripts\pnpm.ps1 test` | 4 个测试套件，22/22 个用例全部通过 |
| 浏览器端冒烟与核心生命周期 | `.\scripts\pnpm.ps1 test:browser` | 10/10 通过（画廊、双框架示例、T02 生命周期） |
| 工作区构建与类型检查 | `.\scripts\pnpm.ps1 build && .\scripts\pnpm.ps1 typecheck` | 10 包构建成功，14 个 Turbo 任务与根 tsc 无报错 |
| 全链路基础验证脚本 | `.\scripts\verify.ps1` | 全部串行通过（退出码 0，未发生超时或异常） |

---

## 3. 未覆盖边界与后续任务说明

1. **双框架适配器（Vue 3 / React 19 组件库）消费验收**：
   - 本次完成了 A 交付的 `@company/charts-core` 候选包的完整安装、类型、SSR 与渲染验收；
   - 后续当 A 交付 `@company/charts-vue` 和 `@company/charts-react` 真实实现后，将复用本任务沉淀的 `setupCleanConsumer` 与 `verifyConsumerTypes` 对框架包进行工作区外 tarball 消费验证（验证临时 `overrides` 指向候选 `charts-core`）。
2. **确定性视觉基线与截图对比**：
   - 本次验证覆盖了 Playwright 真实渲染与画布 DOM 状态；像素级视觉对比（`compareBaseline`）、截图环境签名（`environmentKey`）与基线确认命令（`component baseline accept`）属于 T04 的下一阶段工作。
