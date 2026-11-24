# 真实项目组件发布验证记录（2026-11-24）

## 验证范围

本轮验证真实项目 CLI、稳定分类、后台发布选择和现有发布状态机的集成结果。验证对象包括：

- CLI 登记已有组件子包，在工作区外安装同一冻结 tarball，以 Vite 消费者构建、逐实现截图、上传和恢复发布；
- 共享 Vue/React 包必须提交完整 JavaScript 实现子路径，Vue-only 与 React-only 独立包可单独发布；
- 分类创建、更新、启停、修订 CAS、发布快照及管理入口可信网络边界；
- Nest HTTP、PostgreSQL、MinIO、Verdaccio 的本地真实发布链，以及 worker/API 跨进程恢复；
- 旧 SDK/Bundle 发布路径、后台真实 API/数据库联调和浏览器交互回归。

验证在 Windows 工作树中使用 Node.js 26.13.0、pnpm 12.18.0 和已有 Playwright Chromium revision 1254 执行。未修改系统全局工具链，也未重新下载浏览器。

## RED / GREEN 记录

以下行为先由失败用例复现，再实施最小修复：

1. 分类名称含 NUL 时，契约校验曾接受输入，真实 HTTP 写入 PostgreSQL 返回 503。修复后 create、update 和响应契约均在存储前拒绝，真实 HTTP 返回 400，已有分类不变。
2. 可信网络入口中的 `/v1/categories` 与 `/v1/publishing/options` 曾返回 404。补入既有管理路由族后，公网伪造来源返回 403 且不转发，可信入口转发成功。
3. 双框架共享冻结包选择单一框架曾继续构建并生成材料。修复后读取实际安装包的 `exports`，在消费者构建、截图、manifest 和上传之前返回 `PACKAGE_IMPLEMENTATIONS_INCOMPLETE`，并提示使用 `--framework all` 或拆分独立框架包。
4. CLI 的 bootstrap 测试仍把已实现的 `init`、`dev` 当作未来命令。测试改为检查真实参数和配置错误，同时保留未知命令拒绝。

两次历史环境失败不计为产品失败：一次为子进程 PATH 缺少原生 pnpm，结果 29/30；一次未设置已有 Playwright 浏览器缓存，结果 23/30。补齐进程级工具链与浏览器环境后，同一覆盖集为 30/30。

## 执行结果

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

## 独立审查与平台仓库路径探针

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

## 真实 Ready 证据

`tests/platform/project-publishing.test.ts` 先打包并在工作区外安装 `@company/component-cli@0.0.28`，确认分发包不依赖私有 `@company/contracts`，再分别发布共享双框架包、Vue-only 包和 React-only 包。每个用例均核对 bundle 中全部文件摘要、逐实现截图/报告、数据库 manifest digest、Verdaccio 包摘要和干净 registry 消费者安装。

- CLI tarball SHA-256：`f836347e5c3d6d99d03ddc2a431ad6ad9344ccd655b6dedab6826538911d1125`
- 共享 Vue + React 包：tarball `4919c290136d9332032d5aea58947aa249cdc073fff1f93116b2a92392f850a5`；manifest `83bccbfa73eeb56fdbb8f4c707dbf2bb51c8de20016cb1207a876186083ef31e`；Ready；第 2 次 attempt 成功，并验证 worker 故障、显式 retry 和不同进程恢复。
- Vue-only 包：tarball `b0a5c841c76e70f3a6fce118d7c93f731d2639dd0c3504e11e9ec022442bea77`；manifest `45319b07d4fcfbcec2cea324afd7790c5d181581b3cd716f9c9eb56c7a504b23`；Ready；attempt 1。
- React-only 包：tarball `2cddb629e71a57c7f2bec547c3b3aea6b650e0d239c9d5e34e10eb85e3cfde57`；manifest `4485c7abc571989888d363470b283663fbf019683a607d51ef7b8151f563aa56`；Ready；attempt 1。

三个用例均为 build 1 次、upload session 1 个、release job 1 个；恢复时首次 idempotency key 保持不变。分类停用和 API 重启后重放仍返回原成功作业，不改写历史分类快照；新作业继续按当前启用分类校验。

## 本分支提交

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

## 边界与未完成项

- 本地身份由测试签名器提供，未完成生产 OIDC、TLS、独立域名和真实入口部署验收。
- 本地 PostgreSQL、MinIO、Verdaccio 是隔离技术验收，不等于 G2 生产接入完成。
- 尚未取得两个真实业务项目回执，T11 业务试点保持未完成。
- CLI 的本地 Vite 配置和插件属于开发者本机信任边界；不同浏览器条件入口与已核对 Node ESM 入口不一致时失败关闭。其他编译器适配器尚未验收。
- 上传签名过期且仍有未传文件时，CLI 保留冻结材料和原会话并失败关闭；平台尚未提供同一会话续签接口，CLI 不创建替代会话。
- `Ready` 只表示包与预览资源可达，不推断视觉基线、检查来源或检索索引状态。

原始架构文档只读核验 SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，字节未改变。
