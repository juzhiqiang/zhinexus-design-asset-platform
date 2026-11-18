# T16 冻结产物技术验收

日期：2026-11-19（Asia/Shanghai）。本记录新增于 B26 产品 GREEN、CLI 0.0.14 升版之后，保留此前失败和修复记录。实际 Claude 桌面 GLM-5.3 High 为 B 产品作者；实际 Claude Code GLM-5.3 为 D 独立黑盒作者；C 负责测试环境、机械接收、公共契约、集成和文档。

## 当前收口状态

产品与冻结消费者已通过下列检查。根完整复跑及平台专项已得到最终通过结果；D 安装恢复和字段篡改待原作者交付与验证，尚未合 main。缺少真实授权 Vue/React 业务项目，完整 T16/T17 与公司生产验收保持开放。

## 单一冻结材料

- CLI：`company-component-cli-0.0.14.tgz`，389203 bytes，SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`。
- 冻结提交：`2fca59cf3a0e4f5cf2500e8d1bba74010796b1ec`；冻结 UTC 时间 `2026-11-18T19:35:01.7156793Z`；pack exit 0。
- 冻结 SDK：core `0.0.11`、Vue/React `0.0.12`；manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。
- 真实安装兼容证据 SHA-256 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`。
- 原架构 SHA-256 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。

原始日志及 receipt 保存在本轮 B/C worktree 的 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/`。CLI 唯一 tarball 位于其 `cli-0014-frozen/`，SDK 位于主仓库 `.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3/`。pack 后全图构建没有重新 pack；所有消费者、T15 和 D 冻结黑盒使用上述相同 tarball。

## 已完成验证

命令均通过 `scripts/pnpm.ps1 -PnpmArgs @(...)` 使用固定 Node 26.13.0/pnpm 12.18.0，D Node 黑盒使用同一固定 Node 的绝对路径。冻结 SDK 输入设置为上述 bundle；消费者另设置 `PHASE3_CLI_TARBALL` 和 `INSTALLED_CLI_EVIDENCE`。

| 检查 | 实际命令或范围 | 结果 | 日志 |
| --- | --- | --- | --- |
| B26 产品 | `tests/integration/project-{apply,rollback,install-isolation}.test.ts` 三文件 | 141/141，零失败/pending，exit 0 | `b26-product-full.json/.log` |
| 契约与镜像 | integration-apply、Schema/CLI 同步三文件 | 166/166，零失败/pending，exit 0 | B25/C25 独立记录 |
| CLI 构建与工作区 | CLI build/probe、verify:workspace | probe 73 文件，exit 0 | `cli-0014-build.log`、`cli-0014-workspace.log` |
| 强制全图 | `exec turbo run build typecheck --force` | 20/20，0 cached，exit 0 | `cli-0014-force-build-typecheck.log` |
| 冻结安装矩阵 | `exec vitest run --config tests/acceptance/t16-installed.config.ts -t 'T16 real isolated services'` | 14 collected / 13 passed / 0 failed / 1 unselected，exit 0 | `cli-0014-consumers-02.json/.log` |
| 契约浏览器修复 | contracts-runtime 的真实 Chromium 测试 | 1/1，exit 0 | `cli-0014-contracts-browser-green.log` |
| 完整浏览器 | `test:browser`，设置同一 `ZHINEXUS_SDK_BUNDLE_DIR` | 287/287，exit 0 | `cli-0014-browser-02.log` |
| 冻结 T15 | T15 真实隔离消费者专项 | 25/25，零失败/pending，exit 0 | `cli-0014-t15.json/.log` |
| D26 冻结黑盒 | `node --test` 三份既有 D 文件，entry 为仓外实际安装 bin | 5/5，零失败/skipped/todo，exit 0 | `d26-frozen-blackbox.log` |
| 根失败相关复核 | `exec vitest run tests/tooling/verify.test.ts tests/unit/sdk-lifecycle.test.ts --maxWorkers=1` | 2 文件/10 测试通过，exit 0 | `cli-0014-root-timeout-recheck.log` |
| 根完整复跑 | `test --maxWorkers=2`，同一冻结 T10 输入 | Vitest 89 文件/1753 测试，T10 168 测试全部通过，零失败/skipped/todo，exit 0 | `cli-0014-root-test-02.log` |
| 平台专项 | `test:platform` | 33 文件/135 测试通过，2 文件/2 测试因缺画廊 origin 跳过，exit 0 | `cli-0014-platform.log` |
| 两项真实画廊补验 | 启动已构建 gallery preview，设置 `PHASE2_GALLERY_ORIGIN` 后运行 `exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching-gallery.test.ts tests/platform/search-gallery.test.ts` | 2 文件/2 测试全部通过，零跳过，exit 0 | `cli-0014-platform-gallery.log` |

13 项消费者覆盖 Vue/React × npm/pnpm × standalone/workspace 的八组实际安装、类型/构建与迁移，四组 hostile 配置拒绝，以及 Next Server Page 控制。顶层 D 桥接刻意被筛选排除，不能将该报告写成 14/14。该轮随机隔离服务 ID `6372fbed-97be-4908-9d8d-0eb7e018f27d`；仓外证据目录后缀 `zhinexus-t16-installed-HYtFn4`，其中 `frozen-cli.json` 核对安装版本和 tarball 摘要；测试通过仓外 `node_modules/@company/component-cli/dist/bin.js` 启动真实 CLI 证明安装入口。T15 隔离服务 ID `29be1321-3975-4edf-8588-2ef5aace2023`。所有本机真实服务证据均为 `productionAcceptance: false`。

D26 五个顶层测试包含无安装 apply/rollback、原 manifest 字节变化拒绝、用户编辑保护、参数/坏 JSON 拒绝；未知字段、路径穿越、大小写路径别名和额外安装参数四个篡改控制位于一个顶层测试内，不额外增加测试计数。平台首轮跳过的两项是历史独立画廊测试；补验启动相同已构建画廊，使用随机三存储 ID `237a9918-1920-4940-9732-95d1c161e3f1`，两项真实浏览器/API控制通过。两轮合计覆盖 137 项，不将首轮报告改写为 137/137。

## 保留的失败与纠正

1. 消费者首轮未设置 `INSTALLED_CLI_EVIDENCE`，14 collected / 0 passed / 14 pending、suite failed、exit 1；这是环境前置失败，不计产品 RED。
2. 浏览器首轮 287 collected / 280 passed / 3 failed / 4 未运行、exit 1。其中两项缺冻结 SDK 环境；契约测试显式模块路由漏 `integration-apply`。C 仅补测试路由允许项并设置正确冻结输入，真实契约窄测与完整浏览器随后 GREEN。
3. CLI 0.0.14 根首轮 Vitest 89 文件中 87 passed / 2 failed，1751 passed / 2 failed，总 1753；T10 168/168；exit 1。两项为 5000ms timeout（SDK Vue 生命周期、工具链 bootstrap 失败控制），并发运行消费者和浏览器时发生。未修改产品或放宽 timeout；相关两文件窄复跑 10/10 后，以 `test --maxWorkers=2` 完整复跑，1753/1753 和 T10 168/168 全部通过，exit 0。
4. D27 达 20 分钟上限，没有完整 assistant text 源码，未接收或执行。raw SHA-256 `668fac2a4e10cef7ab165f050b5d709991f156d6498804f820075684db9009aa`；thinking 不是代码交付。D28 缩为一个真实 npm 安装/恢复控制，保持原作者。
5. D28 进程 exit 0 不代表测试交付通过。raw SHA-256 `d523ef7d860c29f66660e6b62e17aea6faa6d5e68558cc0f0d993053ff1036b6`，返回源码因 URL 误用绝对路径检查、基线 npm 合并进程凭据、配置文件建成目录、毒脚本未传 marker、源码快照未排除根 node_modules、数组使用 Object.keys 及占位断言等问题静态拒收，未执行。D29 缩为独立辅助文件，随后由同一实际原作者交主测试；C 不改写其断言。
6. D29 exit 1、`api_error:max_output_tokens`，只有 thinking 与错误文本，无完整源码，未接收。raw SHA-256 `dca4ce64e95ace77d0bd1e2547d044c3f3d131eb9d25ed5f09ce255a2f0595d3`。D30 使用同一 prompt，仅提高当前子进程输出上限至 32000，待实际交付，不修改全局配置。

公开冷无效备份 CLI 应 exit 1，单 JSON `status: error` / `error.code: EXECUTION_FAILED`，固定脱敏且无写入；不能要求库私有异常的 exit 2/recovery-required。备份字段是 `before.sha256`。字段篡改测试须同步真实版本文件、摘要引用及 latest journal 以到达字段校验；仅更改文档摘要而没有可达版本/journal 不证明原字节、root 或 id 校验。

## 独立审查与交付边界

B26 原始交付 SHA-256 `3fa689e38c56e1676808ac7d4df13d62fc800b800b71c6b2a92241e3bdbce014`；机械补丁 SHA-256 `a83a5c1035b4e268e321a1b7c3e1a1265550d08e30c054170cbd9ee526cde0a9`。只读终审 `b26-overall-readonly-review-2026-11-19.md` SHA-256 `0075020d5e2b9d23739025bd0662610aa89fbff082d7ce22714225ac15b95757`，无新增 Critical/Important。C 测试和最终 D 增量仍需合并前审查。

C 浏览器路由及 D 桥接增量只读审查为 Critical/Important/Minor 均 0；桥接未执行，不计验收通过。当前文档两项 Minor（五份当前状态及 frozen-cli.json 入口证据措辞）修正后复核关闭；限定复核无新增问题。记录 `c-frozen-docs-readonly-review-2026-11-19.md` SHA-256 `6de3dda91192fb4c8d057bf7d75ee39925ce2923bc557bda38b57ca129dca01b`。最终 D 增量与 main 仍待后续验收和审查。

本轮不 push、不 tag、不生产发布，保留全部 worktrees 与原始证据。真实授权业务项目、公司 OIDC/独立预览域及完整生产 G2 不由 synthetic 消费者结果替代。
