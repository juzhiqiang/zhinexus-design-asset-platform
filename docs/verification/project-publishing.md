# 真实项目与 juz 简化发布验证汇编（project-publishing）

> 本文件由 3 篇逐次验证记录按时间序合并而成（2026-11-26，`chore/docs-slim-round3` 分支）。合并范围：`2026-11-24-project-publishing.md`、`2026-11-24-project-publishing-final-fix.md`、`2026-11-25-juz-simple-publishing.md`。每篇原记录以 `### <原文件名>` 为标题**完整保留原文**（标题降两级），git 历史可追溯，信息不灭失。
>
> 三篇的关系：第二篇是第一篇「最终整分支审查修复补录」所指的独立补录，开篇即声明「补充前一篇、不改写此前验证历史」；第三篇是 2026-11-25 在 `feat/juz-simple-publishing` 上的简化命令入口验证，与前两篇共用同一套冻结/消费者/截图流程。阅读时按时间序看，不要跳读第三篇的全仓阻塞当作前两篇的结论。
>
> 一条贯穿三篇的不变事实：**原始架构文档 `component-platform-architecture.md` 的 SHA-256 始终为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`**（多数记录写作全大写 `E59BB77...`，同一值），每一次验证前后核对均未变化。

## 逐条合并记录

### 2026-11-24-project-publishing.md

#### 验证范围

本轮验证真实项目 CLI、稳定分类、后台发布选择和现有发布状态机的集成结果。验证对象包括：

- CLI 登记已有组件子包，在工作区外安装同一冻结 tarball，以 Vite 消费者构建、逐实现截图、上传和恢复发布；
- 共享 Vue/React 包必须提交完整 JavaScript 实现子路径，Vue-only 与 React-only 独立包可单独发布；
- 分类创建、更新、启停、修订 CAS、发布快照及管理入口可信网络边界；
- Nest HTTP、PostgreSQL、MinIO、Verdaccio 的本地真实发布链，以及 worker/API 跨进程恢复；
- 旧 SDK/Bundle 发布路径、后台真实 API/数据库联调和浏览器交互回归。

验证在 Windows 工作树中使用 Node.js 26.13.0、pnpm 12.18.0 和已有 Playwright Chromium revision 1254 执行。未修改系统全局工具链，也未重新下载浏览器。

#### RED / GREEN 记录

以下行为先由失败用例复现，再实施最小修复：

1. 分类名称含 NUL 时，契约校验曾接受输入，真实 HTTP 写入 PostgreSQL 返回 503。修复后 create、update 和响应契约均在存储前拒绝，真实 HTTP 返回 400，已有分类不变。
2. 可信网络入口中的 `/v1/categories` 与 `/v1/publishing/options` 曾返回 404。补入既有管理路由族后，公网伪造来源返回 403 且不转发，可信入口转发成功。
3. 双框架共享冻结包选择单一框架曾继续构建并生成材料。修复后读取实际安装包的 `exports`，在消费者构建、截图、manifest 和上传之前返回 `PACKAGE_IMPLEMENTATIONS_INCOMPLETE`，并提示使用 `--framework all` 或拆分独立框架包。
4. CLI 的 bootstrap 测试仍把已实现的 `init`、`dev` 当作未来命令。测试改为检查真实参数和配置错误，同时保留未知命令拒绝。

两次历史环境失败不计为产品失败：一次为子进程 PATH 缺少原生 pnpm，结果 29/30；一次未设置已有 Playwright 浏览器缓存，结果 23/30。补齐进程级工具链与浏览器环境后，同一覆盖集为 30/30。

#### 执行结果

所有命令均在本工作树根目录执行，退出码均为 0。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --lockfile-only` | `Already up to date`，`pnpm-lock.yaml` 无变化 |
| `pnpm verify:workspace` | 11 个工作区成员、公开/私有包和服务端依赖边界通过 |
| `pnpm build --force` | 11/11 成功，0 个缓存命中 |
| `pnpm typecheck` | 服务构建/类型检查 5/5；工作区任务 15/15；根 TypeScript 检查通过 |
| `pnpm test` | Node T10：161 passed、7 skipped；Vitest：146 files、2468 passed、2 skipped；最终进程退出码 0 |
| `pnpm exec vitest run tests/unit/project-cli.test.ts tests/integration/project-publish.test.ts` | 2 个文件、30/30 通过 |
| `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/categories.test.ts tests/platform/admin-categories-browser.test.ts tests/platform/release-sdk.test.ts` | 3 个文件、9/9 通过 |
| `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/project-publishing.test.ts` | 1/1 通过；真实四服务链到达 Ready |
| `pnpm exec playwright test --config tests/browser/categories.config.ts` | 11/11 通过，使用独立 5278 端口验证构建后的后台 |

#### 独立审查与平台仓库路径探针

独立 scoped review 覆盖 `c7d2137c..c758508d`，结论为 **Spec Compliant / Quality Approved**。审查未发现阻断项；仅记录既有根测试的 `DEP0190` 与 `localStorage` 警告为 Minor。审查没有覆盖生产 OIDC/TLS、独立域名部署、G2 生产基础设施接入和两个真实业务项目试点，这些边界仍按下文保持未完成。

主控另在平台仓库根目录使用固定进程级 Node.js 26.13.0 与 pnpm 12.18.0 执行仓库路径探针：

```text
pnpm component init --project . --config <项目内临时配置> --package packages/charts-react --component line --export LineChart --export-path ./line --framework react --category charts
```

命令退出码为 0；解析结果确认 `packageDir` 为 `packages/charts-react`、框架为 `react`、导出子路径为 `./line`，执行后 Git 工作树保持干净。该探针只证明从仓库根调用 CLI 时能够选择指定子包并解析初始化参数，不证明当前 SDK 新版本已经通过 Ready 全链路验收。

根测试保留两类非失败警告：`DEP0190` 来自既有测试以 `shell: true` 启动子进程；`localStorage` 实验性警告来自 Node 未指定持久化文件。两者均未产生失败或改变本轮验收结论。

未设置 `A10_FROZEN_BUNDLE` 时，T10 明确跳过以下 7 个必须读取真实冻结 SDK 策略的用例，本轮未用合成策略替代，也未把跳过计为通过：

1. 候选低于基线且 peer 不满足时保持 `hold`；
2. 四维全过但 peer 不满足时仍不得 `adopt`；
3. 候选等于唯一基线且 Vue/React 均有实测时才 `adopt`；
4. 只验证单一框架时不构成双框架覆盖；
5. 任一维为 `not-run` 时不得 `adopt`；
6. 存在视觉差异时不得 `adopt`；
7. 候选版本与 supported 唯一基线不一致时保持 `hold`。

同一环境条件还使 Vitest 跳过 2 个只读冻结包用例：`tests/evaluation/component-query-sdk.test.ts` 的“核对 manifest.files 全部 199 项、reports 引用与 14 变体”，以及 `tests/acceptance/t16-a/t16-a-api-cases.test.ts` 的“核对冻结 manifest SHA-256 与 0.0.11/0.0.12 版本”。

#### 真实 Ready 证据

`tests/platform/project-publishing.test.ts` 先打包并在工作区外安装 `@company/component-cli@0.0.28`，确认分发包不依赖私有 `@company/contracts`，再分别发布共享双框架包、Vue-only 包和 React-only 包。每个用例均核对 bundle 中全部文件摘要、逐实现截图/报告、数据库 manifest digest、Verdaccio 包摘要和干净 registry 消费者安装。

- CLI tarball SHA-256：`f836347e5c3d6d99d03ddc2a431ad6ad9344ccd655b6dedab6826538911d1125`
- 共享 Vue + React 包：tarball `4919c290136d9332032d5aea58947aa249cdc073fff1f93116b2a92392f850a5`；manifest `83bccbfa73eeb56fdbb8f4c707dbf2bb51c8de20016cb1207a876186083ef31e`；Ready；第 2 次 attempt 成功，并验证 worker 故障、显式 retry 和不同进程恢复。
- Vue-only 包：tarball `b0a5c841c76e70f3a6fce118d7c93f731d2639dd0c3504e11e9ec022442bea77`；manifest `45319b07d4fcfbcec2cea324afd7790c5d181581b3cd716f9c9eb56c7a504b23`；Ready；attempt 1。
- React-only 包：tarball `2cddb629e71a57c7f2bec547c3b3aea6b650e0d239c9d5e34e10eb85e3cfde57`；manifest `4485c7abc571989888d363470b283663fbf019683a607d51ef7b8151f563aa56`；Ready；attempt 1。

三个用例均为 build 1 次、upload session 1 个、release job 1 个；恢复时首次 idempotency key 保持不变。分类停用和 API 重启后重放仍返回原成功作业，不改写历史分类快照；新作业继续按当前启用分类校验。

#### 本分支提交

以下提交来自 `git log 4da55dcb..HEAD`，按实施顺序排列：

| 提交 | 目的 |
| --- | --- |
| `ab3b8cfc` | 明确真实项目 CLI 发布与分类实施范围 |
| `c3430303` | 明确普通组件发布与自动装配资格边界 |
| `5cd33345` | 新增持久化组件分类与授权发布选项 |
| `5493ec1e` | 支持真实项目配置与冻结消费者发布编排 |
| `421b0194` | 明确冻结包预览的受控 Vite 验收边界 |
| `9ce33d39` | 绑定冻结实现预览并保留首次发布幂等键 |
| `1e902a15` | 校验冻结导出代理的真实加载入口 |
| `6a28e65c` | 明确冻结包的完整实现选择边界 |
| `96b9b140` | 增加后台分类管理与冻结实现发布选择 |
| `c7d2137c` | 防止旧身份分类请求回写并清理失效发布授权 |
| `5784da36` | 补齐真实项目发布入口与共享包完整性校验 |
| `94f4a0b0` | 补充真实项目发布指南与验证记录 |
| `c4600d7e` | 记录根测试条件跳过项 |
| `c758508d` | 升级版本号至 0.1.2 |

#### 边界与未完成项

- 本地身份由测试签名器提供，未完成生产 OIDC、TLS、独立域名和真实入口部署验收。
- 本地 PostgreSQL、MinIO、Verdaccio 是隔离技术验收，不等于 G2 生产接入完成。
- 尚未取得两个真实业务项目回执，T11 业务试点保持未完成。
- CLI 的本地 Vite 配置和插件属于开发者本机信任边界；不同浏览器条件入口与已核对 Node ESM 入口不一致时失败关闭。其他编译器适配器尚未验收。
- 上传签名过期且仍有未传文件时，CLI 保留冻结材料和原会话并失败关闭；平台尚未提供同一会话续签接口，CLI 不创建替代会话。
- `Ready` 只表示包与预览资源可达，不推断视觉基线、检查来源或检索索引状态。

原始架构文档只读核验 SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，字节未改变。

#### 最终整分支审查修复补录

整分支审查在上述历史记录之后发现两项重要问题：旧格式上传会话可能在没有服务端完成证明时提交发布作业；消费者可能只调用选中导出，却没有让它进入 Vue/React 的真实挂载生命周期。修复提交 `0ac96519` 已使旧会话先核验原 `POST /v1/uploads/:id/complete`，并要求选中导出真实进入 Vue mount 或 React commit 后才允许生成发布材料。完成证明无效时以 `UPLOAD_COMPLETION_UNPROVEN` 失败关闭，保留原会话身份、首次幂等键、manifest 摘要与冻结文件；已有 jobId 的旧会话继续轮询原作业。

最终专项结果为：旧会话修复用例 3/3、项目发布集 21/21、相关回归 51/51、真实平台发布与旧 SDK 发布 2/2。最终真实平台证据重新打包并在工作区外安装 CLI tarball，其 SHA-256 为 `7f26d0fa01a35f772c759c3ba387a45f7649e4865335bb3406f79e174f9b8bb0`；共享、Vue-only、React-only 三组作业均达到 Ready，具体 job、tarball 与 manifest 摘要见[独立最终修复验证补录](#2026-11-24-project-publishing-final-fixmd)。

精确 `pnpm build --force` 因根脚本展开的 `--cache=local:rw` 与 Turborepo 2.11.10 的 `--force` 互斥而退出 1，本轮没有改写根脚本，也不把该命令记为通过。等价直接命令 `pnpm exec turbo run build --force` 实际强制构建 11/11 成功、0 缓存。首次根测试因未设置专用 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH` 而有 14 个 T17 环境失败；设置通用和专用变量均指向现有 Chromium 缓存后，focused T17 为 22/22，最终根测试退出 0：T10 为 161 passed、7 skipped，Vitest 为 146/146 文件、2473 passed、2 skipped。失败与成功日志均保留，未覆盖边界仍以上文和独立补录为准。

### 2026-11-24-project-publishing-final-fix.md

本记录补充[同汇编内的 `2026-11-24-project-publishing.md` 小节](#2026-11-24-project-publishingmd)，不改写此前验证历史。最终整分支审查指出两项重要问题：旧格式上传会话可能在没有完成证明时提交发布作业；消费者可能只调用选中导出，却没有让它进入 Vue/React 的真实挂载生命周期。修复提交为 `0ac96519`。

#### 行为结论

- Vue 与 React 的选中导出必须分别进入实际 `app.mount(...)` 或 React root render/commit 生命周期，随后才能绑定 readiness。只 import、手工调用导出或渲染无关内容均返回 `PREVIEW_IMPLEMENTATION_UNUSED`，不会生成最终 manifest。
- 只有 `uploadSessionId` 的旧会话先调用原 `POST /v1/uploads/:id/complete`。符合契约的完成证明写入 `uploadComplete:true` 后才提交发布作业。
- 完成端点拒绝、缺少字节或响应无效时返回 `UPLOAD_COMPLETION_UNPROVEN`；原 uploadSessionId、首次 idempotencyKey、manifest 摘要和冻结文件保持不变，不创建替代会话。
- 已经持有 `jobId` 的旧会话直接继续轮询原发布作业，不重新要求上传证明。

#### RED / GREEN 与相关回归

I1 的原缺陷测试在修复前退出码为 1，实际结果为 **2 failed、1 passed、18 skipped/filtered**。两个失败分别证明：实现没有请求原会话的完成端点，以及实现会在取得原会话的有效完成证明前拒绝。修复后的同组用例退出码为 0，结果为 3/3 通过、18 个按名称过滤。

I2 在原实现过程中没有单独保存测试先行的 RED 产物，本记录不把后补验证冒充为原始 TDD 时间线。为补足回归证明，本轮随后使用 `8d66df2a` 的历史 `vite-consumer.ts` 实现隔离运行当前两个 Vue/React 生命周期拒绝用例，确认两者都会捕获缺陷；再恢复 `0ac96519` 当前实现并用完全相同的命令确认 GREEN。具体结果见下文“I2 追加历史实现回归验证”。

最终结果文件已归档到忽略目录 `test-results/project-publishing-final-fix/final-fix-evidence/`；这些文件是运行时原始证据，不随 Git 发布。以下表格在持久文档中保留完整命令、退出码和摘要：

| 证据 | 命令 | 退出码与结果 |
| --- | --- | --- |
| `i1-red.json` | `pnpm exec vitest run tests/integration/project-publish.test.ts -t "legacy upload session\|proves completion on the original legacy\|existing release job"` | 1；2 failed、1 passed、18 skipped/filtered |
| `i1-green-3.json` | 同上 | 0；3 passed、18 filtered |
| `project-publish-green-21.json` | `pnpm exec vitest run tests/integration/project-publish.test.ts` | 0；1 个文件、21/21 通过 |
| `related-green-51.json` | `pnpm exec vitest run tests/integration/cli-release.test.ts tests/integration/project-plan-consumer.test.ts tests/unit/cli-release-response.test.ts tests/unit/project-cli.test.ts` | 0；4 个文件、10 个 suite、51/51 通过 |
| `platform-real-green-2.json` | `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/project-publishing.test.ts tests/platform/release-sdk.test.ts` | 0；2 个文件、2/2 通过 |

`i1-red.json` 保存了当时捕获的精确命令。其余专项命令按结果文件中的测试路径整理为可复现命令；结果摘要来自对应 JSON，不把整理后的命令冒充为原始 shell 逐字记录。

#### I2 追加历史实现回归验证

本验证只针对已经存在的两个参数化负例，不改测试或产品逻辑，不重跑宽套件。运行环境先设置：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\project\zhinexus-design-asset-platform\.tools\playwright'
$env:T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH = $env:PLAYWRIGHT_BROWSERS_PATH
```

两轮使用的精确 focused 命令相同：

```text
pnpm exec vitest run tests/integration/project-publish.test.ts -t "rejects a manually invoked"
```

历史轮仅把工作树中的 `packages/component-cli/src/project/vite-consumer.ts` 临时写入 `8d66df2a` 对应内容，不修改 index、HEAD 或其他源文件，并在 `finally` 中恢复原字节。历史轮退出码为 1：1 个文件失败，2 failed、19 skipped；Vue 与 React 两个用例都期望 CLI 退出 1，实际收到 0，证明旧实现会把手工调用并丢弃所选导出错误视为真实框架渲染。日志为 `i2-historical-red.log`。

恢复 `0ac96519` 当前实现后，同一命令退出码为 0：1 个文件通过，2 passed、19 skipped，日志为 `i2-current-green.log`。恢复前后 `vite-consumer.ts` SHA-256 均为 `A0D0239A3A5AB03C6D9493BD7B7EE30674BEB4FEA92954A30ABCD1F3D956F616`，该路径恢复后 `git status --porcelain -- packages/component-cli/src/project/vite-consumer.ts` 无输出。结构化摘要保存在忽略目录的 `i2-historical-regression.json`。

这项结果是实现完成后的历史版本回归验证，只证明现有测试能够捕获 `8d66df2a` 的缺陷并由 `0ac96519` 修复；它不是原始的“先写失败测试再实现”证据。

CLI 类型检查与构建通过，`pnpm verify:workspace` 通过。根 `pnpm typecheck` 结果为 15/15，其中 14 项复用缓存，`@company/component-cli:typecheck` 在本次修改后实际重新执行。以下命令按工作区脚本整理为可复现命令：

| 工作区命令 | 退出码与结果 |
| --- | --- |
| `pnpm --filter @company/component-cli typecheck` | 0；CLI 类型检查通过 |
| `pnpm --filter @company/component-cli build` | 0；CLI 构建通过 |
| `pnpm verify:workspace` | 0；11 个成员、公开/私有包与服务依赖边界通过 |

#### 构建命令限制

精确命令 `pnpm build --force` 退出码为 1。根脚本展开为 `turbo run build --cache=local:rw --force`，当前 Turborepo 2.11.10 明确拒绝同时使用 `--cache` 与 `--force`。本轮未修改根脚本，也不把该命令记为通过。

使用等价的直接命令 `pnpm exec turbo run build --force` 验证实际强制构建，结果为 11/11 成功、0 个缓存命中。失败原文与等价命令完整日志分别保存在 `root-build-force.log`、`root-build-force-equivalent.log`。

| 构建/类型检查命令 | 退出码与结果 |
| --- | --- |
| `pnpm build --force` | 1；根脚本的 `--cache=local:rw` 与 `--force` 互斥 |
| `pnpm exec turbo run build --force` | 0；11/11 成功、0 cached |
| `pnpm typecheck` | 0；15/15 成功、14 cached，CLI typecheck 实际重跑 |

#### 最新真实 Ready 证据

最终修复后重新运行 `tests/platform/project-publishing.test.ts` 与 `tests/platform/release-sdk.test.ts`，2/2 通过。前者重新打包 CLI，在工作区外安装并通过 Nest HTTP、PostgreSQL、MinIO、Verdaccio 发布到 Ready。最新证据生成于 2026-11-24 23:16（Asia/Shanghai），位于忽略目录 `test-results/project-ready/evidence.json`。

- 独立安装的 CLI `@company/component-cli@0.0.28` tarball SHA-256：`7f26d0fa01a35f772c759c3ba387a45f7649e4865335bb3406f79e174f9b8bb0`。
- 共享 Vue + React 作业 `e5585796-59e0-4bff-a3d9-f8af65cb58fe`：Ready；tarball `1ac41057d7ab1b2feed9194f9172ef2e70c93947505f35b5552a75de94963e8f`；manifest `17c72ddcabf892775c1100430c906ed5fee74bb3196c1e05ae8607c3ea8502df`；第 2 次 attempt 成功。
- Vue-only 作业 `ee4ab0ad-d6b2-461f-a178-ad5eb19bd17a`：Ready；tarball `11064db7581db66f2b0ab8c215d15f0852bcaa9c2e41b539626057221ec78ddd`；manifest `d3517fad8213d97c591a9598135f0c8965ce66ac389218da7572ceaa5073573a`；attempt 1。
- React-only 作业 `a5a0d660-5664-481e-a800-2c162c9d644f`：Ready；tarball `470578bc5132e460bd63119328bb59b3c05d4bd7e5aa3b2d2d76aed2bc78d4b8`；manifest `1c8c41ef3c9bef2a2f8fe98922ce670f43a62620802a49675097452fe6f49131`；attempt 1。

三组证据均记录 build 1 次、upload session 1 个、release job 1 个，并核对 registry 摘要与干净 registry 消费者安装。

#### 根测试

首次 `pnpm test` 保留为失败证据：145/146 个文件通过，2459 个测试通过、2 个跳过、14 个失败。14 个失败全部来自 `tests/acceptance/t17-matrix/browser.ts:361`，原因是该套件读取专用 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH`，只设置通用 `PLAYWRIGHT_BROWSERS_PATH` 不会生效。失败日志保存在 `root-test.log`。

设置 `PLAYWRIGHT_BROWSERS_PATH` 与 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH` 均指向只读使用的 `D:\project\zhinexus-design-asset-platform\.tools\playwright` 后，可复现专项命令 `pnpm exec vitest run tests/acceptance/t17-matrix/browser.test.ts` 退出码为 0，1/1 文件、22/22 测试通过，日志为 `t17-focused-final.log`。随后同一环境中的 `pnpm test` 退出码为 0：T10 为 161 passed、7 skipped；Vitest 为 146/146 个文件、2473 passed、2 skipped。完整日志为 `root-test-final.log`。保留的非失败警告为既有 `DEP0190` 子进程警告和 Node `localStorage` 实验性警告。

| 根测试命令 | 退出码与结果 |
| --- | --- |
| `pnpm test`（首次，未设置专用 T17 浏览器变量） | 1；145/146 文件、2459 passed、2 skipped、14 failed，失败全部位于 T17 固定 Chromium 目录守卫 |
| `pnpm exec vitest run tests/acceptance/t17-matrix/browser.test.ts`（两个浏览器变量均已设置） | 0；1/1 文件、22/22 通过 |
| `pnpm test`（两个浏览器变量均已设置） | 0；T10 161 passed、7 skipped；Vitest 146/146 文件、2473 passed、2 skipped |

#### 复审状态

最终定向复审覆盖 `8d66df2a..03f19fc6` 中的 I1/I2 产品控制流、对应回归测试、验证证据及修复 diff 是否引入新破坏，不把本轮范围扩大为对原分支全部功能的重新审查。

- I1 **ADDRESSED**：`packages/component-cli/src/local/release.ts:140-166` 对只有旧 `uploadSessionId`、没有 `jobId`/`uploadPlan` 且尚无完成证明的会话，先向原会话调用完成端点；网络失败、非 2xx 或不合约响应均以 `UPLOAD_COMPLETION_UNPROVEN` 失败关闭。只有有效证明持久化后，`:251-264` 才使用原会话、首次幂等键与原摘要提交发布。`tests/integration/project-publish.test.ts:204-295` 覆盖失败关闭、原会话完成后发布和已有 `jobId` 仅继续轮询。
- I2 **ADDRESSED**：`packages/component-cli/src/project/vite-consumer.ts:43-77` 只在所选冻结 React 导出完成 `useLayoutEffect` commit 或所选冻结 Vue 导出完成 `onMounted` 后触发绑定；`packages/component-cli/src/local/capture.ts:92-93,235` 在截图前拒绝未触发生命周期的页面。`tests/integration/project-publish.test.ts:127-173` 同时覆盖手工调用后丢弃的 Vue/React 负例和真实 mount/commit 正例。
- 新破坏：没有 Critical/Important。唯一 Minor 是本节此前把复审范围错写成“仅覆盖持久验证文档”；本次补录已按真实范围修正。
- 规格结论：**PASS（仅限本次 scoped findings）**。原整分支审查的两项 Important 均已关闭。
- 质量结论：**PASS WITH MINOR DOCUMENTATION NOTE**。产品修复失败关闭，相关负例、顺序、身份保持、正常框架语义和真实平台回归均有证据；上述 Minor 文案已修正。

复审实际核对了 `project-publish-green-21.json`（21/21）、`related-green-51.json`（4 文件、10 suites、51/51）、`platform-real-green-2.json`（2/2）、强制构建等价命令（11/11、0 cached）、最终根测试（146/146 文件、2473 passed、2 skipped）和类型检查（15/15）。复审未重跑产品门禁，也未审查修复 diff 未触及的产品代码。

I2 的历史 RED 是实现完成后的隔离历史版本回归。本轮能核对保留日志、结构化摘要、当前源码哈希和恢复后的干净状态，但无法仅凭静态产物逐步重建当时每一次临时替换动作；这不改变当前负例与完整目标集的 GREEN 结论。生产 OIDC/TLS、独立预览域名、G2/T11、两个真实业务项目试点及其他明确保留范围仍未验收，不能由本地 Ready 或本报告推断完成。

完整复审原文已复制到本地忽略证据目录 `test-results/project-publishing-final-fix/final-fix-scoped-review.md`。该目录用于保留运行生成证据，不随 Git 提交发布。

#### 提交范围

`8d66df2a..03f19fc6` 新增提交如下；本次 docs-only 收尾提交的哈希应在提交完成后通过 `git log` 查询，不在提交自身内容中预填。

| 提交 | 目的 |
| --- | --- |
| `0ac96519` | 收紧真实框架生命周期证明，并要求旧上传会话先取得原会话完成证明。 |
| `1f738cd1` | 补录最终修复验证、根测试、构建限制与最新 Ready 证据。 |
| `03f19fc6` | 补录 I2 历史实现回归，明确其为事后证据而非原始 TDD 时间线。 |

本轮版本保持 CLI `0.0.28`、根 API `0.1.2`、Admin `0.0.2`；docs-only 收尾不触发版本升级。

#### 决策账本

以下 23 项按本地归档 `test-results/project-publishing-final-fix/progress.md` 中 `Ruling:` 的出现顺序逐字保留，包含每项原因与错误代价，不新增或合并决策：

1. Execute implementers sequentially with fresh task reviewers — subagent-driven-development requires this and shared contracts must be reviewed first — cost if wrong: longer turnaround than safe independent parallel work.
2. Optional ECharts/styleExport/readyMethod fields for ordinary components, strict if present — real project support must not invent chart capabilities — cost if wrong: downstream consumers need guards around optional fields; full graph verification required.
3. Use apps/admin/app/lib for admin clients — actual repository structure differs from plan shorthand — cost if wrong: path-only rework.
4. Permit migration registry/rollback and narrow stale historical migration test updates in Task 1 — a new migration must register safely and existing migration 013 already invalidates old assumptions — cost if wrong: migration tests could miss regressions; retain rollback intent and record baseline.
5. Use existing isolated Node 26.13.0 with pnpm 12.18.0 — Node 24.6.0 failed the frozen @angular-devkit/core 22.2.6 engine check — cost if wrong: validation differs from global Node; no dependency rollback or global environment mutation.
6. implement short network interruption recovery via persisted validated upload plan/file checkpoints/uploadComplete; expired URLs fail closed while preserving frozen materials and original session, no unapproved C API change — frozen interfaces only support this recovery boundary — cost if wrong: longer interruptions need a later same-session renewal API; Task4 must report precise recovery limitation and assess any existing safe renewal path.
7. Restrict publication consumers to CLI-controlled Vite adapter with actual installed exact Vite/config, real module provenance and selected export execution marker; keep arbitrary component build/dev — arbitrary opaque consumer commands cannot prove screenshot provenance and reviewer reproduced wrong framework/outside alias — cost if wrong: developers using other consumer compilers need a dedicated Vite consumer or later adapter. Temporary wrappers must preserve Props/events/ref/ready API and not modify installed package/tarball. Config must clearly represent this adapter; no silently ignored consumer.build command.
8. Ordinary components publish with optional API fields, while existing chart assembly returns API_UNSUPPORTED when it lacks required style/ready metadata — low-code/automatic generic integration is a later delivery, and current MatchTarget must remain valid — cost if wrong: some ordinary components need future assembly compatibility work before automatic insertion.
9. Keep Vite/config plugins inside the developer local execution trust boundary and fail closed for browser-conditional entry differing from the checked Node ESM entry; document both limits rather than adding an unapproved compiler plugin whitelist — legitimate compilation requires developer adapters and this feature is provenance validation, not a malicious-local-process sandbox — cost if wrong: more consumer adapters/transform controls will be needed before claiming stronger attestation or supporting alternate browser entries.
10. Task4 C may fix the already-confirmed category-name NUL validation gap with contract+realHTTP RED/GREEN and schema/vendor sync — PostgreSQL cannot store NUL names and current503 misclassifies client input — cost if wrong: stricter name validation rejects previously syntactically accepted but unstorable inputs; verify create/update and inline CLI contracts stay aligned.
11. Preserve existing package-completeness contract and link admin selections by package; separate Vue/React publication uses separate packages, dual-framework shared package submits all implementations — published npm version is atomic and cannot be repacked after screenshots — cost if wrong: developers must split packages or supply all implementation materials when they want independent framework releases.
12. Continue Task4 with fresh higher-capability implementer because original provider quota prevents its next request — preserve all edits/results and recover pending checks, no restart of completed tasks — cost if wrong: replacement needs context reconciliation and may repeat narrow checks.
13. C may update stale bootstrap future-command expectation and establish independent worktree-local exact toolchain for existing path-bound acceptance — newCLI commands invalidate old placeholder and existing tests demand local executables — cost if wrong: test expectation could hide CLI regression; retain semantic argument checks and actual installed-bin evidence, original toolchain untouched.
14. Accept declined review boundary: malicious local Vite config/plugin process sandbox remains outside this iteration — local developer trust boundary is explicitly documented — cost if wrong: hostile local transforms require a separate stronger attestation design.
15. Accept declined review boundary: other compilers and differing browser/Node conditional exports remain unsupported — only current controlled Vite adapter is verified — cost if wrong: affected projects need dedicated adapters.
16. Accept declined review boundary: no automatic same-session URL renewal — platform has no such interface and original session must remain preserved — cost if wrong: expired partial uploads require a later platform endpoint.
17. Accept declined review boundary: Zip upload remains follow-up — approved spec explicitly defers it — cost if wrong: developers still prepare individual frozen materials.
18. Accept declined review boundary: complete history download/page-version binding remains follow-up — current precise consumer support is not a download UI — cost if wrong: users need a later version-download feature.
19. Accept declined review boundary: generic low-code adapter/editor metadata remains follow-up — ordinary npm imports are independent of chart assembly qualification — cost if wrong: generic automatic insertion requires later adapters.
20. Accept declined review boundary: productionOIDC/TLS/independent domain/G2/T11 remain unaccepted — local signatures and isolated stores cannot prove external deployment — cost if wrong: production launch still needs those acceptance gates.
21. Accept declined review boundary: arbitrary business projects are not universally validated — fixture and clean consumer evidence cover measured routes — cost if wrong: real projects may need compatibility fixes during pilots.
22. Use the equivalent direct Turbo forced-build command for final fix verification and preserve the pnpm build --force failure — current root build script explicitly supplies --cache=local:rw which conflicts with --force — cost if wrong: equivalence omits the explicit cache-mode option; require complete11/11 zero-cache evidence and do not alter root script or rewrite prior verification. Controller confirmed platform-real2/2, rootbuild11/11zerocached and typecheck15/15(14cached); root test pending.
23. Record a late isolated historical-implementation I2 RED/GREEN probe as regression evidence, not as original TDD chronology — the original I2 RED artifact is unavailable and evidence must not be invented — cost if wrong: the first test-before-implementation execution order remains unauditable; the appended probe must still prove both regressions and restore identical product bytes.

#### 原始证据本地归档

`final-fix-evidence/` 的 15 个原始结果文件，以及 `final-review.md`、`final-fix-scoped-review.md`、`final-fix-report.md`、`progress.md`，均复制到本地忽略目录 `test-results/project-publishing-final-fix/`。复制后 19/19 个文件的源/目标 SHA-256 一致，并生成 `SHA256SUMS.txt`；该清单 SHA-256 为 `51EC2D3FD023D0CCF68BB8A8DA2372AF0D9E52EB830AB70999DDD7EEC4F86BFC`。这些运行生成文件不会随 Git 发布；即使后续清理计划 scratch，本地归档仍保留本轮原始输出。

#### 保留边界

本轮仍未完成生产 OIDC/TLS、独立域名、G2 生产基础设施和两个真实业务项目试点。`Ready` 仅表示包与预览资源可达，不推断视觉基线、检查来源或检索索引状态。原始架构文档 SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

### 2026-11-25-juz-simple-publishing.md

日期：2026-11-25。分支：`feat/juz-simple-publishing`；开工基线：`728135ae451aa8055a1f98396bad4e0fa7cb6987`。

#### 范围与环境

- 简化 `juz init/login/dev/package/publish`，交互框架/分类、Token 登录及保存 API origin；本地 ZIP、独立 `juz-cli` npm 分发包。
- 真实项目构建、冻结 tarball、外部消费者安装/截图及原会话恢复继续使用已有流程；服务端不执行组件代码。
- 本机 Windows，系统 Node `24.6.0`、pnpm `12.18.0`。CLI 指南已移除固定 Node `26.13.0` 的要求；没有修改旧 T17 验收工具链。
- 独立 npm 全局安装使用临时 prefix 与临时凭据文件；没有发布 npm，没有推送 Git。

#### 实际执行结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @company/component-cli build` | 通过；契约内联、probe 分发清单复核通过 |
| `pnpm --filter @company/component-cli typecheck` | 通过 |
| `pnpm verify:workspace` | 通过；11 个成员，无循环依赖，公开包及服务端依赖边界通过 |
| 下列 11 文件窄范围 Vitest | 100/100 通过 |
| `pnpm exec vitest run tests/integration/project-publish.test.ts -t "installs juz-cli globally"` | 1 通过，21 未选择；真实独立安装及发布链路通过 |
| `git diff --check` | 通过 |
| `pnpm --filter @company/component-cli pack:juz` | 升版后通过，生成 `juz-cli-0.0.29.tgz` |
| 最终 tgz 的 npm 全局 prefix 安装、`juz --version` 与 `juz --help` | 通过，实际 shim 输出 `0.0.29` 及五个常用命令 |
| `pnpm test` | 未通过；详见全仓阻塞 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 未通过；56 条既有后台相关诊断，本轮新增测试类型错误修复后已消除 |

最终窄范围命令：

```powershell
pnpm exec vitest run tests/unit/component-cli-onboarding.test.ts tests/unit/project-init-package-ignore.test.ts tests/unit/project-cli.test.ts tests/unit/project-archive.test.ts tests/unit/juz-distribution.test.ts tests/unit/bootstrap.test.ts tests/unit/access-cli.test.ts tests/unit/access-credentials.test.ts tests/unit/echarts-cli.test.ts tests/unit/release-fingerprint.test.ts tests/integration/project-plan-consumer.test.ts
```

##### 行为证据

- 独立分发 tarball 通过 npm `--global --prefix <临时目录>` 安装，真实 PowerShell `juz` shim 能读取版本；分发包不运行时依赖内部 CLI 或私有 contracts。
- 无平台登录运行 `package`，之后 Token 登录并运行无参数 `publish`、再次 `publish`；本地只构建一次，HTTP 上传字节逐文件等于冻结材料。另一全新项目直接 `publish` 也只构建一次。
- 上述集成测试真实运行本地组件构建、工作区外消费者依赖安装、Vue/React 预览构建和 Chromium 截图；平台 HTTP 接口使用测试服务器，不能代替真实 PostgreSQL/Verdaccio/MinIO/OIDC 验收。
- ZIP 在 Windows 上真实解压，含 Unicode 路径，原始 manifest 与所有声明文件字节一致；未声明目录和会话不入包，篡改及链接越界被拒绝。
- 初始化保留 `.npmignore` 或 `.gitignore` 语义，避免发布目录进入下一次组件打包；`files` 绕过忽略规则时，在消费者导入组件前拦截。
- 新材料输出在包内时，只接受 `.component-releases/` 严格子目录；包外目录允许，保护目录本身、路径折返及 junction 绕行被拒绝。合法路径单测只证明实际 build 被执行，完整发布证据由独立安装集成测试提供。
- 自定义旧目录中的合法冻结材料仍能恢复到真实 HTTP 上传请求，测试以受控 401 结束；未重建组件、未改写清单。
- 重复打包分发包时，旧版本 tgz 与当前版本共存，返回当前版本的路径和真实摘要。回归测试先观察错误，再修复为空临时目录内打包。
- 最后只读审查确认自定义输出目录递归夹带问题已消除，无新的实质问题。

#### 全仓阻塞

`pnpm test` 的前置 Node 测试报告 168 项，161 通过、7 跳过、0 失败。随后 Vitest 报告 146 文件通过、5 文件失败；2517 项通过、7 失败、2 跳过，另有 2 个 worker 错误，整个命令退出 1。

1. `tests/admin/console-render.test.ts` 无法从根测试解析 `react`，收集失败。根 tsc 还报告后台页面 NodeNext 相对导入扩展名、Next 模块解析与页面 props 类型等问题。
2. T17 的 `product-executor`、`chain`、`chain-failure`、`runner` 共 7 项测试仍要求固定 Windows Node `26.13.0` / 仓库 `.tools` 路径；其中一个清理阶段还报告目录 inventory 不一致。这些文件及后台目录与开工 HEAD 一致。
3. `project-inspect.test.ts` 与 `project-plan.test.ts` 的 worker 以 `3221226505` 异常退出。单独复跑两文件仍得到 91 项通过及 2 个 worker 错误，原因未解决，不能将这两组标为通过。

本机日志保存在忽略目录 `.release/juz-test.log`、`.release/juz-root-typecheck.log`、`.release/juz-recheck-project.log`、`.release/juz-focused-tests.log`、`.release/juz-installed-publish.log`。未将这些日志作为分发包内容。

#### 交付边界及工作区情况

- 本轮 CLI 可本地安装测试，尚未执行 npm 发布。后台当前需解压 ZIP，再导入 manifest 与材料目录；直接 ZIP 入口不属于本次 CLI 实现。
- 最终安装包位于 `packages/component-cli/.release/juz-cli-0.0.29.tgz`，510507 字节，SHA-256 为 `a1115e9386c768db3a8d6fedad2bc90f1e520ca6e961d03ce7b0296cdb0bf61d`。最终安装验证保留在忽略目录 `.release/juz-0.0.29-validation`；带清理步骤的验证命令曾被策略整体拒绝，随后只执行安装与读取验证，未重试删除。
- 初次接入仍需真实项目维护组件代码、API/docs、消费者示例和就绪协议；CLI 不生成虚假业务代码或验证结果。
- 测试 RED 阶段暴露旧登录未遵守自定义凭据路径，合成测试凭据曾写入默认登录文件。确认该文件匹配本轮测试值后已移除，并修复路径统一及测试用户目录隔离；此前登录状态是否被覆盖无法确认，已有登录的用户需重新 `juz login`。
- RED 阶段误走旧 SDK 路径产生未跟踪 `.release-bundle/`。自动审批拒绝清理，目录保留且排除提交；没有绕过拒绝再次删除。
- 原始架构文件保持不变：Git blob 与 HEAD 相同；SHA-256 为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
