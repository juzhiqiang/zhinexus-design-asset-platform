# juz CLI 缺陷与常规组件开发验证记录

日期：2026-11-26（Asia/Shanghai）。本记录独立于原工作台交付，不改写历史验收。

## 范围与基线

- 基线 `407b1628`，分支 `fix/juz-component-development`。工作目录为 `C:/Users/10208/.codex/worktrees/juz-cli-fixes/zhinexus-design-asset-platform`。
- 修复并发调参、项目编译配置、Vue SFC 类型及声明、有效数据绑定校验、启动包选择五项问题；将业务源码改成普通 TSX / SFC，消费者桥接收进 `.juz/`。
- 独立审查补充了插件钩子覆盖文件访问策略及普通 SFC 的本地类型声明引用两项，均先补失败测试再修正。
- 没有共享契约、Schema、工作区成员、服务端发布协议变化。原架构 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
- 实施期间其他任务将 main 升到 `0.2.3`；本分支根版本顺延为 `0.2.4`、CLI 为 `0.1.1`。未自动合并 main 的新提交，主工作区 tracked 文件未修改。

## 工具链

固定使用 bootstrap 校验的 Node `26.13.0` 与 pnpm `12.18.0`，没有放宽 engines。系统 Node 24.6.0 不能安装基线中既有 Angular 依赖的工具链组合。

以下命令在本分支工作目录执行。为避免全局命令漂移，实际 PowerShell 前置如下；表内 `pnpm` 表示该可执行文件：

```powershell
$env:PATH="$PWD/.tools/node-v26.13.0-win-x64;$env:PATH"
$pnpm = "$PWD/.tools/pnpm-native-12.18.0/package/pnpm.exe"
```

详细输出保留在本机 ignored `test-results/cli-fixes/`。浏览器和独立安装证据保留在 `test-results/workbench/`，没有将临时目录或凭据加入 Git。

## RED → GREEN

| 问题 | 实际 RED | 最终 GREEN |
| --- | --- | --- |
| 并发控件编辑 | 挂起两个验证响应，label/value 编辑互相覆盖 | 每个实现累积待验证输入并用 revision 拒绝过期响应；框架切换、保存竞态通过浏览器验证 |
| Vite 项目配置 | alias / 虚拟插件 / CSS 模块无法显示；常规 resolve('src') 的 cwd 错误 | 清除平台凭证的项目编译子进程加载配置；真实 alias、插件、CSS 样式与源码热更新通过 |
| Vue SFC 与声明 | tsc 无法检查普通 SFC；本地 Props 文件/目录引用产生 NodeNext 错误 | vue-tsc 检查正常 SFC；错误类型产生 TS2322；真实 tarball 安装后 NodeNext 正确类型通过、错误 Props 失败 |
| dataProp | 无效标量/数组及越界值经绑定绕过 API / 控件校验 | 校验最终有效 Props、基础数组和全部保存状态；失败保存不改写文件摘要 |
| dev 包选择 | 错误选择仍启动监听；目录与配置路径语义不一致 | 启动前复用共享包选择；错误选择退出且端口未占；实际安装 CLI 的包名、目录、配置路径均选择 Vue |
| 插件策略覆盖 | config / configResolved / configureServer 各自放宽 fs 后，越界 @fs 请求均返回 200 | 三个钩子反例均返回 404，保留组件渲染及框架生命周期；HTTP 外层还校验 realpath |
| 声明引用遗漏 | 普通 SFC import type './props'，其中转导出 './types'，最终 NodeNext 失败 | AST 仅整理模块引用，支持文件与目录声明、转导出及 import() 类型；普通字符串字面量保持原值 |

安全修复迭代中曾将原始 `publicDir:false` 和 Windows 路径覆盖 Vite 已解析配置，导致浏览器失败；已分开配置阶段和 resolved 阶段，保留 Vite 正规化路径、禁用目录表示与客户端目录，再取得下面的最终通过结果。未把该次失败算成通过。

## 实际执行结果

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm --filter @company/component-cli typecheck` | 通过 | 终端输出、root typecheck 日志 |
| `pnpm --filter @company/component-cli build` | 通过，契约内联与探针检查通过 | cli-final-build.log |
| `pnpm exec vitest run tests/unit/workbench-state.test.ts tests/unit/workbench-server.test.ts tests/unit/workbench-project.test.ts tests/unit/workbench-lifecycle.test.ts` | 4 文件，16 项通过 | unit-final.log |
| `pnpm exec playwright test --config tests/workbench/playwright.config.ts` | 11 项通过，57.0s | browser-final.log |
| `pnpm exec vitest run tests/integration/workbench-installed.test.ts tests/integration/workbench-freeze.test.ts tests/integration/workbench-templates.test.ts` | 3 文件，3 项通过，30.35s | integration-final.log |
| `pnpm verify:workspace` | 11 成员、安全服务依赖图通过 | workspace-final.log |
| `pnpm typecheck` | 15 任务通过；CLI 实际执行，14 个缓存；根 tsc 退出成功 | typecheck-final.log |
| `pnpm exec turbo run typecheck --force --only` | 11 任务通过，0 缓存，2.705s | force-types-final.log |
| `pnpm exec turbo run build --force` | 11 任务通过，0 缓存，21.354s | build-final.log |
| `pnpm test` | **未全绿**：T10 为 161 通过、7 skipped；Vitest 为 165 文件通过、2 文件失败，2619 通过、20 失败、2 skipped | all-tests.log |
| `$env:T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH="$env:LOCALAPPDATA/ms-playwright"; pnpm exec vitest run tests/acceptance/t17-matrix/browser.test.ts` | 指定已安装浏览器的实际目录后，22 项全部通过 | t17-browser-environment.log |
| `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/workbench-publishing.test.ts` | 真实 PostgreSQL、MinIO、Verdaccio、Nest HTTP，1 项通过，21.79s | real-platform-retry.log |
| `pnpm exec vitest run tests/integration/workbench-installed.test.ts` | 最终 README 与构建产物打包后的仓外安装，1 项通过，15.16s；摘要与交付 tgz 完全一致 | installed-final.log |

全仓首次 20 项失败中，14 项来自 T17 默认 `.tools/playwright` 目录不存在；上表通过显式环境变量复测该文件，未修改测试或降低断言。剩余 6 项属于 `tests/admin/console-render.test.ts`：上传页 mock 值形状不匹配、页面文案断言与当前页面不匹配、match 页缺少 App Router 测试上下文等。通过 `git diff --name-only 407b1628 -- apps/admin tests/admin vitest.config.ts` 确认相关源码、测试与配置未在本分支修改。未将各轮结果相加冒充一次全仓通过，也未修改后台来消除本任务范围外失败。

曾尝试直接在主工作区复测后台文件，但该工作区缺少 root React 依赖，止于导入失败；该尝试不作为“main 已复现同样六项失败”的证据。当前结论仅限基线文件未变、此分支的实际失败输出。

最后一次真实平台测试初试与强制构建并发，API dist 正被重建，runner.js 暂时不存在，故失败（real-platform-final.log）。待强制构建完成后串行重跑通过（real-platform-retry.log）；先前失败保留，不算作通过。

真实平台验收使用隔离服务与测试签名的 OIDC CLI 身份，不代表生产 OIDC、TLS、公司网络入口或线上部署通过。mock HTTP 的仓外闭环另有 `mockHttp:true` 标记，不与真实存储结果混用。

## 交付物与摘要

生成命令：`node packages/component-cli/scripts/pack-juz.mjs --out .release/juz-cli-fixes-20261126`。

- CLI：`juz-cli 0.1.1`，570325 字节。
- SHA-256：`066692603b0f4dd401870145ffaf577847d697d6b8600771024915e79594fa78`。
- 工作分支产物：`.release/juz-cli-fixes-20261126/juz-cli-0.1.1.tgz`。
- 为便于本机安装，同摘要副本放在 `D:/project/zhinexus-design-asset-platform/.release/juz-cli-fixes-20261126/juz-cli-0.1.1.tgz`。该目录被 Git 忽略。
- `test-results/workbench/independent-cli.json` 与 `real-platform.json` 均记录上述最终 CLI tgz 摘要；没有仅验证源码后交付不同 tgz。
- 架构文件再次核对为本记录开头的原始摘要。

## 开发方式和未覆盖边界

- 默认先建单框架包；`all` 明确是两个独立发布包，不是强制每个组件开发两遍。
- 日常只写 `src/Demo.tsx` / `src/Demo.vue` 和普通导出，使用框架 Props、回调/Emits、生命周期。桥接由生成消费者承担。
- `playground.json`、API、文档和配置仍是调试/发布元数据，总工程文件仍比单一最小组件模板多；不宣称完全无配置。
- 原有项目不会自动迁移为新模板；自定义 Provider、插槽和初始化仍通过已有消费者适配。项目插件是可信本地 Node 代码，不是操作系统沙箱，不能据浏览器隔离推断其无本机文件权限。
- 类型整理覆盖已发射的相对本地文件/目录引用，不承诺替自定义 TypeScript 路径别名、任意声明打包器或复杂跨包类型做迁移。
- 独立 CSS 仍按普通组件库的导出和消费者引入约定处理；本轮不新增自动样式发布协议。默认模板内联样式和源码 CSS 模块配置已实际验证。
- 未执行整个平台的 `test:browser`、生产身份/TLS验收、Git push、npm 发布或部署；没有合并本分支。

## 聚焦提交

- `5d1c6af1`：范围与计划。
- `d7105b30`：有效绑定与全部状态校验。
- `6f2e487d`：启动前统一包选择与框架校验。
- `ddba9de8`：并发草稿、项目编译配置与常规组件模板。
- `b58d300e`：项目插件钩子安全策略与真实路径授权。
- `c1a14c74`：Vue 本地类型发布声明整理。

独立审查最终限定复核未发现新的阻断问题；审查者未代替本记录的浏览器、仓外安装与真实平台执行结果。全仓六项后台测试仍是后续集成门禁的未完成项。
