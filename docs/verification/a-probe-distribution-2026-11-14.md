# A 侧交付：T10 探针随 CLI 分发的完整运行材料

日期：2026-11-14。负责人：A（SDK）。分支：`feat/a-probe-distribution`，基线 `bea8d3f912115791a322a3448e13797dcf4e92ad`。

本文是 A 本轮「把 T10 探针做成可随 CLI 发布的完整运行材料」的**接口契约、资源清单、调用方式与实测证据**。
探针本身的四维口径、`environmentKey` 定义与兼容判据见
[a-t10-probes-next-2026-11-13.md](./a-t10-probes-next-2026-11-13.md)，本文不重复。

## 一、本轮要解决什么问题

探针原先只活在源码仓库里：`probe.mjs` 里写死 `REPO_ROOT = HERE/../../..`，
`examples/`、`tsconfig.base.json`、默认输出目录全部按仓库布局推导。这意味着

- 用户装了 `@company/component-cli` 之后**没有办法在自己机器上跑兼容探针**；
- 探针不可能进入任何分发链路（本地 CLI 命令、CI、双项目试点验收）。

本轮把探针连同它需要的模板与配置打成一份**白名单明确的运行材料**，装到
`packages/component-cli/dist/probe/`，并让同一份 `probe.mjs` 在仓库内与安装后都能跑。

## 二、产物布局与资源清单

```
packages/component-cli/dist/probe/
├── probe.mjs               ← 入口（B 侧默认入口接线指向这里）
├── environment.mjs         环境投影与 environmentKey 参考实现
├── bundle.mjs              冻结 bundle 只读读取与摘要校验
├── policy.mjs              从冻结 tarball 动态加载兼容策略
├── consumer.mjs            工作区外干净消费者（复制/改写/安装/类型/构建/SSR）
├── browser.mjs             固定环境浏览器探针
├── evidence.mjs            四维结论装配与未覆盖项收集
├── probe.test.mjs          探针单测（随包分发，安装后也能自检）
├── probe-manifest.json     逐文件 sha256 + 字节数 + 入口 + 资源根
└── resources/
    ├── examples/vue/       ← examples/vue 全量源码（html/src/tsconfig/vite.config/package.json）
    ├── examples/react/     ← examples/react 全量源码
    ├── examples/fixtures/  ← 7 个组件的 fixtures JSON
    └── tsconfig.base.json  ← 各示例 tsconfig 的 extends 目标
```

**为什么必须保留 `resources/examples/<framework>` 与 `resources/examples/fixtures` 这对兄弟关系**：
示例源码里写死了两条相对路径——`src/App.vue` 用 `../../fixtures/line.json`，
各示例 `tsconfig.json` extends `../../tsconfig.base.json`。因此打包时不能把 fixtures
单独挪去别处，也不能把 tsconfig.base.json 放到 `resources/examples/` 之外，
否则复制到工作区外之后这两条路径立刻断链。

打包脚本按白名单逐项复制，实测 **73 个文件 / 385,391 字节**。

## 三、调用契约

### 3.1 打包（在仓库根执行，A 侧脚本）

```bash
node packages/component-cli/scripts/package-probe.mjs              # 打包
node packages/component-cli/scripts/package-probe.mjs --check      # 只复核已有产物
node packages/component-cli/scripts/package-probe.mjs --out <dir>  # 指定输出目录
```

`--check` 输出五项判据：清单文件数、缺失、清单外、污染、**被改动**。任一项非零即退出码 1。
建议 B 侧把它接进 CLI 的构建后自检与 CI。

### 3.2 运行（安装后，任意 cwd）

```bash
node <安装目录>/dist/probe/probe.mjs --bundle <冻结 bundle 目录> [选项]
```

完整选项见 `--help`。与仓库形态**完全一致**，没有第二个入口、第二套参数。
相对仓库形态唯二的行为差异：

| 项 | 仓库形态 | 安装形态 |
| --- | --- | --- |
| 资源根 | 仓库根 | `<安装目录>/dist/probe/resources` |
| 默认输出 | 调用者 cwd 下 `test-results/t10-sdk-probes/<UTC 时间戳>` | 同左（**不写安装包目录**） |

证据 JSON 的 `probe` 块新增四个字段用于区分形态，便于审核方复核「这证据到底是谁产出的」：
`entry`（相对安装根的入口路径）、`resourceRoot`、`installRoot`、`packaged`。

### 3.3 给 B 的接线约定

B 负责 `packages/component-cli` 的 `package.json` / `build` / `files` / `bin` 与默认入口。
A 侧需要 B 满足的约定：

1. `files` 必须包含 `dist`（已含 `dist/probe`）；打包脚本产物不另出新目录。
2. **运行依赖 `@playwright/test` 精确 `1.65.0`**（已约定）。探针用 `await import('@playwright/test')`
   惰性加载，`--skip-browser` 时完全不碰它；但缺它时**明确失败**，不静默降级。
3. 若 B 想提供 `component probe` 之类的默认入口，请转调
   `dist/probe/probe.mjs` 并原样透传参数，不要在 CLI 里再造一套参数解析。
4. 建议在 CLI `build` 之后追加 `node scripts/package-probe.mjs`，并在发布前跑一次
   `--check`（摘要核对能发现 dist 被污染或篡改）。

## 四、缺少依赖/浏览器时的诊断

两种形态给不同处方——安装形态下根本没有仓库，让用户"去仓库根 pnpm install"是错的方向：

| 形态 | 诊断文案要点 |
| --- | --- |
| 仓库形态 | 请在仓库根执行 `pnpm install`（`@playwright/test` 是根 devDependency，精确 1.65.0） |
| 安装形态 | 确认 `@company/component-cli` 依赖闭包含 `@playwright/test@1.65.0`；执行 `npx playwright install chromium` 或设置 `PLAYWRIGHT_BROWSERS_PATH`；只想跑类型/构建/SSR 请显式 `--skip-browser` |

另外：资源缺失（打包漏了 `resources/`）时 `resolveProbeLayout()` 抛
`PROBE_INPUT` 并直接指出 `resources/` 与重新打包的命令，不会崩在半路。

## 五、硬排除项（污染防护）

按相对路径的**任一段**匹配，因此嵌套在任何层级的本地状态都会被挡住：

```
目录：node_modules  dist  .turbo  .git  coverage  test-results
      playwright-report  .release  .cache  .vite  .pnpm-store
文件：.env / .env.*   *.tsbuildinfo   *.pem   *.key   id_rsa   id_ed25519
      *.pfx  *.p12  *.jks  *.keystore   .npmrc
```

打包完成后 `packageProbe()` 会**自己复核一遍**（缺失 / 清单外 / 污染 / 摘要），
任一不过就抛错，不产出"看起来正常"的脏包。

## 六、实测证据（隔离 Linux 工具链，Node 26.13.0）

> 沙箱在本次会话中途被重置，隔离 Node / Playwright 浏览器 / `libXdamage` 全部丢失，
> 已按原方式重建（Node 26.13.0 官方 tarball 核对版本、`playwright-core` 官方安装器装
> chromium 1254 与 headless shell、从 Ubuntu jammy 取 `libXdamage1` 解出 `.so` 用
> `LD_LIBRARY_PATH` 指向）。环境差异见第九节。

### 6.1 单测

| 命令 | 结果 |
| --- | --- |
| `A10_FROZEN_BUNDLE=<冻结目录> node --test tests/acceptance/t10-sdk/probe.test.mjs` | **117 / 117 过，0 败，0 skip** |
| 同上但不配 `A10_FROZEN_BUNDLE` | 110 过 / 0 败 / 7 skip（6 例需冻结 bundle，1 例需充足磁盘） |
| `node --test tests/acceptance/t10-sdk/package-probe.test.mjs` | **8 / 8 过，0 败，0 skip** |

新增 8 例全部先红后绿：写测试时打包脚本与 `resolveProbeLayout` 尚不存在，6 例全败；
补齐实现后转绿。其中「改动安装包任何一个字节都必须被抓到」一例，是把
`consumer.mjs` 末尾加一行注释（文件照样能跑）后确认复核失败、恢复后重新通过。

### 6.2 真正的打包材料外部启动

把 `dist/probe` 复制到仓库外、模拟已安装的 CLI 包
（`/tmp/a-t10-install-sim/node_modules/@company/component-cli/dist/probe/`，
连同 B 约定的 `@playwright/test@1.65.0` 运行依赖），从**任意 cwd** 启动：

```
cd /tmp/a-t10-cwd
node /tmp/a-t10-install-sim/node_modules/@company/component-cli/dist/probe/probe.mjs \
  --bundle <冻结目录> --echarts 6.1.0 --frameworks vue,react \
  --components bar,line --presentations light-canvas \
  --consumer-root "/tmp/a-t10-cwd/consumers/not yet created" \
  --out /tmp/a-t10-cwd/out --label install-external
```

实测输出（两个框架各自完整跑完四维）：

```
vue：  typecheck Bundler 0 / NodeNext 0 / build 0 / SSR 0（window=false document=false）
       浏览器 2 次运行，生命周期=passed，字体指纹实测 154d9215f759c969…（measured）
       四维 {"typecheck":"passed","runtime":"passed","interaction":"passed","visual":"not-run"}
react：typecheck Bundler 0 / NodeNext 0 / build 0 / SSR 0（window=false document=false）
       浏览器 2 次运行，生命周期=passed
       四维同上
```

`recommendation=hold dualFrameworkCoverage=false` —— **因为只跑了 2 个组件的窄矩阵**，
不是缺陷。视觉维度 `not-run` 是因为没有基线，同样如实记录。
两个框架算出**同一个** `environmentKey`（`4db8e7266ec56e5e…`），
符合「被测框架版本与 ECharts 版本不计入 environmentKey」的契约。

### 6.3 安装包只读（摘要级证明）

| 时点 | 缺失 | 清单外 | 污染 | 被改动 |
| --- | --- | --- | --- | --- |
| 外部运行前 | 0 | 0 | 0 | 0 |
| 外部运行后 | 0 | 0 | 0 | 0 |

即：真实双框架安装 + 类型 + 构建 + SSR + 浏览器跑完之后，安装目录里 73 个文件
**一个字节都没变**。默认输出落在调用者 cwd 的 `test-results/` 下，消费者建在
`--consumer-root` 指定的外部目录，两者都不进安装包。

### 6.4 消费者仍从同一冻结 tarball 安装

外部运行日志：`候选来源核对通过：echarts@6.1.0 ← https://registry.npmjs.org/echarts/-/echarts-6.1.0.tgz`。
三个 `@company/charts-*` 包由 `rewriteConsumerManifest` 从冻结 tarball 的 `file:` 路径装入，
不是工作区链接。上一轮修掉的脏源排除（`node_modules`/`dist`/`.turbo`/`.git`）继续生效，
打包脚本与消费者复制用的是同一套排除名单。

## 七、未验收项（诚实清单，均标 `pending`）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| Windows 原生全链路 | `pending` | 本轮只在隔离 Linux 工具链上跑过。**不把 Linux 证据宣称 Windows 验证。** C 将在 Windows 做独立安装 CLI 全链路 |
| B 侧接线 | `pending` | `package.json` / `build` / `files` / `bin` / 默认入口归 B，本文只给约定 |
| 完整 56 组合视觉 adopt | `pending` | 本轮只跑 2 组件窄矩阵；完整矩阵与基线比对沿用上一轮命令 |
| 候选差异与回退 | `pending` | 需新候选只能新目录新批次 |
| `compatibility_records` 落库 | `pending` | 真实三存储与 OIDC 不在本机可用范围 |
| 升版 | **未做** | `@company/component-cli` 版本号归 B/C 收口；A 不单独升版，避免与 B 的发布节奏冲突 |

## 八、改动范围

```
packages/component-cli/scripts/package-probe.mjs        新增
tests/acceptance/t10-sdk/package-probe.test.mjs         新增
tests/acceptance/t10-sdk/probe.mjs                      资源根/默认输出/证据留痕/诊断
tests/acceptance/t10-sdk/consumer.mjs                   fixturesDir/baseTsconfig 可覆盖
tests/acceptance/t10-sdk/browser.mjs                    形态化诊断 + 生成器提纯（沿用）
docs/verification/a-probe-distribution-2026-11-14.md    本文
```

**未触碰**：根 `package.json` / `pnpm-lock.yaml` / `packages/contracts` / `packages/charts-*` /
`examples/*` / `apps/*` / CLI 的 `src/` 与 `package.json`。
`tests/acceptance/t10-sdk/*.mjs` 与 `packages/component-cli/scripts/*.mjs` 都不在根
`tsconfig.json` 的 `include`（只收 `tests/**/*.ts`、`scripts/**/*.ts` 等），
因此不影响根 typecheck 门禁；该门禁由 C 实跑。

`packages/component-cli/dist/` 被 `.gitignore` 忽略，**不提交**，由构建时重新生成。

## 九、环境差异说明（隔离 Linux 工具链）

| 差异 | 处置 |
| --- | --- |
| 沙箱 Node 为 v22.23.4，仓库锁定 26.13.0 | 下载 Node 26.13.0 官方 tarball 解包到 `/tmp/t10tools/isolated/`，`PATH` 前置 |
| pnpm 不在锁定版本 | 干净消费者用 `npm install`（工作区外消费者，不参与仓库 pnpm 工作树）；npm 入口同时试 Windows 与 Linux 布局 |
| Playwright 浏览器未预装 | 用 `playwright-core/cli.js install` 官方安装器装 chromium 1254 与 headless shell（`PLAYWRIGHT_BROWSERS_PATH` 指向 `/tmp/t10tools/ms-playwright`） |
| 缺 `libXdamage.so.1` 且无 root/apt 权限 | 从 Ubuntu jammy 取 `libxdamage1` 的 `.deb`，用 Node 解 ar + `tar --zstd` 取出 `.so`，`LD_LIBRARY_PATH` 指向 |
| `/sessions` 剩余空间极小 | 所有重活放 `/tmp`；消费者暂存根命名 `a-t10-staging-*`，`removeConsumer` 只删这个前缀 |
| `TMPDIR` 指向小分区导致 ENOSPC | 显式设 `TMPDIR=/tmp` 与 `A10_CONSUMER_ROOT` |

**以上差异只影响「在哪里跑」，不影响「测的是什么」**：被测物始终是同一份冻结 tarball，
环境差异全部进 `environmentKey`，跨环境不判视觉通过。
