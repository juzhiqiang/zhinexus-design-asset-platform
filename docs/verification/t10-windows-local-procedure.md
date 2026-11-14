# T10 Windows 本地证据与双消费者锁文件回退步骤

此步骤只在开发者 Windows 电脑运行。所有组件来自既有冻结 tarball，不重新打包，不更新 SDK peer，不写线上兼容记录，也不替代 OIDC、独立预览域或真实业务项目验收。

## 工具与前置条件

- 经 `scripts/bootstrap.ps1` 安装项目固定工具链；工作区依赖、服务声明和 CLI 已构建，Playwright Chromium 已安装。
- 通过 `scripts/pnpm.ps1` 执行命令，或在当前进程将 `.tools/bin`、`.tools/node-v26.13.0-win-x64` 放到 PATH 最前，并设置 `PLAYWRIGHT_BROWSERS_PATH=<仓库>/.tools/playwright`。npm 的子进程也必须使用固定 Node。
- `component echarts verify --registry` 接受候选发现与来源审计的 **ECharts 包元数据端点**（官方值为 `https://registry.npmjs.org/echarts`），npm 安装仍继承进程的下载源配置。使用官方元数据时，在当前验收 PowerShell 进程设置 `$env:npm_config_registry='https://registry.npmjs.org'`，使新消费者锁文件的下载来源与审计源一致；不修改用户全局 npm 配置。官方元数据与镜像 lock 主机不一致时应安全拒绝，不能绕过来源校验。不要将 registry 根地址误作包元数据端点。
- 权威冻结目录包含 manifest、14 个实现及三个 SDK 0.0.10 tarball；不得覆盖或重新 pack。候选 ECharts 采用明确的精确版本。
- `scripts/audit-t10-evidence.mjs` 是本轮 **Windows / Node 26.13.0 / Chromium revision 1254 / 实测字体** 的独立审计器，默认检查双框架共 56 个组合。它重算 contracts 环境键、字体摘要和截图 SHA，不接受操作者覆盖字体摘要来替代本轮实测。

## 首轮与视觉复验

1. 通过 `scripts/t10-consumer-ownership.mjs` 的 `createOwnedRoot(ownerFile, repoRoot)` 创建专属根。`ownerFile` 放在 ignored `.tools/` 下且必须是新文件；函数以随机 32 位十六进制 ID 在系统 TEMP 独占创建目录、写入两份一致的 ownership marker，并返回尚不存在且带空格的 `consumerRoot`。不能用已有用户目录或其它工作树代替。
2. 用真实 CLI 首轮运行：`component echarts verify --bundle <冻结目录> --version 6.1.0 --consumer-root <consumerRoot> --keep --out <首轮输出> --label <唯一标签> --json`。首轮没有视觉基线时，应有两框架各 28 次实测，三个行为维度通过、视觉 not-run，CLI 以 `PROBE_HOLD` 拒绝采用。候选来源未核对、依赖不干净等其它拒绝原因不能混称为预期视觉 hold。
3. 执行 `node scripts/audit-t10-evidence.mjs <首轮报告.json> hold 56`，人工查看真实截图，确认图形、文字、主题和渲染器。审计失败或截图异常时保留原记录，修正原因后使用新标签和新消费者重新运行，不能改原报告。
4. 显式传入上一份已审查报告：`component echarts verify --bundle <同一冻结目录> --version 6.1.0 --baseline <首轮报告.json> --out <复验输出> --label <另一唯一标签> --json`。复验必须从全新的工作区外消费者安装同一 tarball；不得复用第一轮 node_modules。预期四维全部 passed、uncovered 空且 recommendation 为 adopt。
5. 执行 `node scripts/audit-t10-evidence.mjs <复验报告.json> adopt 56`，同时核对 CLI 自身 exit 0、冻结包与候选 source/integrity 的绑定。此 adopt 是本地兼容建议，不是线上发布或基线 CAS 确认。

## 差异候选与真实锁文件回退

- 对 ECharts 6.0.0 分别以默认 strict 和 strict-only 安装：与冻结 peer 不符时必须失败且不自动重试 legacy。另以显式 legacy 跑双框架矩阵，仅测量候选行为与差异，结论不得采用，也不扩大支持范围。
- 第一轮保留的两个消费者用于真正回退，不用另建两个恢复消费者冒充：

```text
node scripts/verify-t10-rollback.mjs <首轮报告.json> <回退证据目录> <ownership文件.json>
```

该脚本在任何安装或清理前验证随机运行 ID、双份 marker、真实路径、直接父子关系、完整双消费者集合、无 Git 标记与无额外 staging 条目。逐消费者保存原 `package.json` / `package-lock.json` 字节和 SHA，临时改到 6.0.0 并显式 legacy 安装和构建；finally 中恢复两份原文件、严格 `npm ci`，核对恢复后的真实版本，重跑 Bundler / NodeNext 类型、构建与 SSR，确认清单和锁 SHA 完全一致。

只有两消费者全部成功、恢复与清理完成，`rollback-evidence.json` 才能记 `passed: true`。清理只针对本次已验证的两份 staging 和其空父目录；专属根中的 marker 留作本地所有权依据。失败报告必须保留，恢复失败时不能宣称回退完成。

Node 回归与审计器的控制/畸形证据/路径反例通过根 `test:t10` 执行；该入口先构建 contracts，再执行 A 探针与 C 审计工具的 Node 测试。不能以这些 mock 或 fixture 通过代替上面的真实消费者演练。
