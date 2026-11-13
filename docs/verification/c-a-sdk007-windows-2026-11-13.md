# C 对 A SDK 0.0.7 的 Windows 原生复验

日期：2026-11-13。执行人：C。固定产品提交为 A 的 `f35ebc992933ece96ab8bfa863d7a689629049e3`，不是随时变化的分支 HEAD。本记录独立补充证据，保留 A 的 Linux 记录和 C 的 SDK 0.0.6 历史验收。

## 执行范围与隔离方式

从固定提交用 `git archive` 导出到忽略目录 `.tools/operations/a-sdk-native-f35ebc9/source`，独立安装 node_modules；仅通过目录 junction 复用仓库固定 Node 26.13.0、pnpm 12.18.0 与 Playwright 浏览器。Windows x64，ECharts 6.1.0、Vue 3.5.45、React 19.3.1。没有切换 A/C 分支、合并 main 或推送，也没有使用源码 alias 代替外部 tarball 消费。

浏览器专项为避免与 B 冲突，仅在该忽略目录将两个测试中的示例 origin 从 5174/5175 改为 5274/5275，并创建 `tests/c-native.config.ts` 启动两个对应的 Vite preview；其余测试断言和产品代码保持固定提交内容。没有运行画廊或 StrictMode 专项，也不据此声称 A 的完整浏览器套件通过。

平台集成使用同一归档内的 A 产品代码，额外复制 C 的 `e490564` 中 `tests/platform/current-sdk.test.ts`、`support.ts`、`http-support.ts`、`t06-support.ts`，逐文件核对摘要后执行。这是 A 产品与 C 验收测试的组合验证，不是 A 原提交中的旧十实现测试。三存储由 RecoveryStack 在随机端口创建，结束时仅释放本次拥有的容器、卷、连接和临时凭据目录。

## 实际命令与结果

下列命令均在归档 source 中通过 `.\scripts\pnpm.ps1` 执行；构建时设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。

| 命令 | 实际结果 |
| --- | --- |
| `install --offline --frozen-lockfile --ignore-scripts` | 成功；344 包复用，0 下载；锁文件不变 |
| `exec turbo run build typecheck --force` | 20/20 成功，0 缓存，7.963 秒 |
| `exec vitest run tests/unit/sdk-compatibility.test.ts` | 20/20，通过；172 毫秒 |
| `exec tsc --project tsconfig.json --noEmit` | exit 0 |
| `verify:workspace` | 10 成员、无环、4 个公开包、安全服务依赖图，通过 |
| `exec vitest run tests/integration/packed-consumer.test.ts tests/integration/packed-consumer-frameworks.test.ts tests/integration/cli-bundle.test.ts` | 3 文件 13/13，通过；72.91 秒 |
| `exec playwright test tests/browser/presentation-matrix.spec.ts tests/browser/core-lifecycle.spec.ts --config tests/c-native.config.ts` | 67/67，通过；9.4 秒（56 个展示组合、11 个核心生命周期用例） |
| `exec vitest run tests/platform/current-sdk.test.ts --config tests/platform/vitest.config.ts`（C 四文件覆盖后） | 1/1，通过；60.20 秒；14 实现真实 HTTPS 预览、三存储 Ready 与两类 Registry 消费 |

第一次准备复制 C 支撑时误以归档 cwd 计算源路径，Copy-Item 拒绝复制到自身，旧测试仍被执行；它在 22.49 秒后因共享 credentials.json 缺失失败。该次不是产品行为 RED，也没有初始化共享服务。改用明确的 C 根目录复制并验证四份文件后，才取得上表的隔离平台通过结果。

## 冻结产物与发布证据

本次冻结材料位于 `.tools/operations/current-sdk/4414e01c-2220-4940-8c93-979250c83259/`，共 199 个 manifest 文件引用。`acceptance.json` 的独立持久副本为 [原始证据](c-a-sdk007-windows-2026-11-13.evidence.json)，SHA-256 为 `a5e978fca85e20855528bb54c0c8d691ff2623c2bccd33f8e6102eb970d0dc3b`，生成时间为 `2026-11-13T05:31:58.594Z`。

| 包 | 版本 | 本轮 Windows 冻结 tarball SHA-256 |
| --- | --- | --- |
| @company/charts-core | 0.0.7 | `70232cd9e90b8afc4e63b64645060b3b01bbd2eb21de3f17bcfa38d9df49a513` |
| @company/charts-vue | 0.0.7 | `861d4ee9ce99807eb204dedea81cd6bcab7ab350f3bd71fc1cdac0bbf1fd4f28` |
| @company/charts-react | 0.0.7 | `e4630ba239fda6e47d5f4cba2e7d3efb1f2f76dce78a28130d19fa45f0fdf30c` |

三包在本轮打包后冻结；安装、截图、报告、上传、发布和实际读取均绑定上述摘要，没有用 A Linux tarball 的不同摘要替代。十四个真实浏览器入口各有五项检查通过；原始证据保留实际静态资源摘要、报告与截图关联。工作区外的 Vue 和 React 消费者均安装 Registry 中的 0.0.7，并分别验证七个导出。

## 仍未关闭的门槛

以上证明固定版本的构建、运行和本机发布链路，不代表 T10 策略判定正确。独立审查对该固定提交复现了三个 Important：probe 收到基线而非候选版本、缺少某个精确支持组合仍可能 adopt、混合 ECharts 基线的 peer 判定依赖数组首项。已向 A 下发复现和修复要求，修复后的新提交须重新验证，当前兼容策略保持未验收。严格声明消费者的 Bundler/NodeNext 与 skipLibCheck=false 边界也由 A 继续核对。

B 的网页真实材料上传、逐实现手动截图、刷新及响应丢失恢复单独验收；此前夹具发布与恢复卡片显示不能替代这些证据。公司 OIDC、生产独立注册域/TLS、真实业务试点及完整 G2/M2/T11/T12 仍未完成。原始架构 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
