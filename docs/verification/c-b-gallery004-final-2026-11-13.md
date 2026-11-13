# B gallery 0.0.4：C 最终固定提交独立验收

日期：2026-11-13。B 修复提交为 `d2f1fa715da0a0682e174f3abe1d40baee2da53b`；独立升版提交及本次最终验收基线为 `1624fa3282c517738ef4e94780f32a1f63e2a2a4`（gallery `0.0.4`）。升版提交只修改 `apps/gallery/package.json` 和 `apps/gallery/CHANGELOG.md`。C 未修改 B 工作区，没有合并或 push。

本记录接续 [中途快照、RED/GREEN 与原网页 fixture 预跑](c-web-upload-independent-snapshots-2026-11-13.md)，保留此前的失败和中途结果。本次结论绑定最终 Git 提交，不以旧构建或中途文件快照替代。

## 独立来源与测试支撑

C 用 `git archive` 从最终 hash 导出全新 `.tools/operations/b-final-1624fa3/source`，归档 tar SHA-256 为 `eca1f1452b50a60e3d0325dddaec6d4201fd617fb5ab4a1041b1b8040d6773bd`。除新增 C 验收测试外，产品及原测试文件都来自该提交，没有覆盖产品文件。C 测试支撑来自 `9253223deaf9f3476f25eb3bdcd6b2f5c8cdaec3`。

原 `manual-release.spec.ts` 与 `web-upload-real-e2e.spec.ts` 均保留。C 在 `tests/acceptance` 新建测试副本，只将画廊端口从 5173 改为 5183，将既有 SDK 批次、版本及三包精确摘要改为已冻结的 SDK 0.0.10；没有修改产品或放宽断言。

| 测试文件 | 最终提交原文件 SHA-256 | 适配副本 SHA-256 |
| --- | --- | --- |
| manual 8 项 | `b4cf8bf721471415d8d9596e0aedeee7e60a13a9afe6dbbe25642d6600242d9d` | `d3838a06d7560958df35a5bdb5687587c650c59786575c964a195a73a247efc0` |
| real 6 项 | `a0ce36c1d922cabd750d46095921f6a0f76966b988f054a09693b0bf1dd196de` | `5bf9876384aca52ea69e2c21aa989cc4e3d6a06c5d913064dc1a9a7df66617af` |

上述副本摘要与此前预跑副本完全一致，但本次重新在最终 Git 归档实际运行。C 额外使用 `prepare-sdk0010-web-harness.mjs` 生成真实生命周期/普通重试测试；生成文件 SHA-256 为 `baa1c4b2b1c422016e5821cbc001b987498aaf4e78d43561f4e608d321fa6329`。生成器仅写 C 自有忽略归档，不写 B 产品目录。

## 最终源码的实际执行结果

全部命令通过项目 `scripts/pnpm.ps1` 调用固定 Windows Node `26.13.0` / pnpm `12.18.0`。构建设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`；网页验收使用 5183 和 `WEB_UPLOAD_FROZEN_BUNDLE` 指向既有 SDK 0.0.10 权威批次。

| 实际命令 / 检查 | 结果 |
| --- | --- |
| `install --offline --frozen-lockfile --ignore-scripts` | 退出 0，7.794 秒 |
| `exec turbo run build typecheck --force` | 20/20，零缓存；Turbo 6.929 秒，命令 7.084 秒，退出 0 |
| `exec node tests/acceptance/prepare-sdk0010-web-harness.mjs <最终归档>` | 退出 0，生成上述固定摘要的补充测试 |
| `exec tsc --project tsconfig.json --noEmit` | 退出 0；生成的补充 `.ts` 同时纳入检查，不声称覆盖所有 `.mts/.mjs` |
| `verify:workspace` | 10 成员、无环、四公开包、安全服务依赖图，退出 0 |
| `exec vitest run tests/unit/web-upload-workflow.test.ts tests/unit/api-cors.test.ts` | 2 文件 / 32 项通过，Vitest 1.68 秒，退出 0 |
| `exec tsx tests/acceptance/web-upload-workflow.mts <最终归档>` | 14/14，退出 0；显式 mock 网络工作流诊断，不冒充浏览器或存储证据 |
| `exec playwright test --config tests/acceptance/playwright.web-upload.config.ts --reporter=line` | C 独立 UI 12/12，13.6 秒，退出 0 |
| `exec playwright test --config tests/acceptance/playwright.c-original.config.ts --reporter=line` | 原 manual 8 + real 6，共 14/14，55.8 秒，退出 0 |
| `exec playwright test --config tests/acceptance/playwright.c-web-real.config.ts --grep '真实三存储全链路\|C独立普通提交重试' --reporter=line` | C 真实补充 2/2，49.6 秒，退出 0 |

原 6 项真实用例为：真实发布至 READY（含注册表读取）、逐实现缺图、框架错配、MinIO PUT 中断、真实丢 202 后刷新并以原 key 取回同 job/数据库唯一，以及坏 tarball 期望摘要不变。没有把第一项中的看板或注册表断言另算成独立用例。原恢复例没有直接比较两次 session；C 补充测试另有直接请求体/session 断言。

C 的两项真实补充具体确认：

- 首次真实上传 201、complete 200、release 202 的 session 一致；四个本地键清空。刷新后观察 2100ms，没有新的 release POST，数据库全表仅一作业，worker 到 READY，Registry 三包可读。随后再次发布取得不同的真实 session，故意中断 PUT 后只保留新的活跃会话。
- 丢弃服务端已落库的真实 202 后，不刷新、不点恢复卡，再次点击普通提交。已有 pending 直接重放 release，零新增 create / PUT / complete，第二次取得真实 202；原请求体、session、幂等键和 job 均一致，数据库全表仅一作业，worker 到 READY，成功后四键清空。测试只把浏览器持久化 plan 的过期元数据改成过去，并拦截后续 PUT；**不是等待真实预签名 URL 自然过期**。

### 根测试的独立范围

`scripts/pnpm.ps1 test` 实际完成：**32 文件 / 620 项通过，1 文件 / 1 项失败，共 33 文件 / 621 项**；Vitest 91.17 秒，整条命令 91.683 秒，退出 1。前置 `build:services` 的 5 项命中缓存，随后 Vitest 实际执行，测试未进入 Turbo 缓存。不能用 C 分支此前的 600 项通过代替此结果，也不将本次根套件记作通过。

唯一失败为 `tests/integration/cli-release.test.ts`：`platformHarness → localServices → localCredentials` 因共享 `.tools/g2-local/credentials.json` 缺失而抛出 `Run infra:up before test:platform; real storage is required`，发生在冻结材料准备之前。本轮没有按该错误提示初始化、重启或轮换共享设施。C 分支已经提交的独立隔离 CLI 测试属于另一份源码组合，见 [CLI 隔离复验](c-cli-release-isolation-2026-11-13.md)；未经授权没有将其合入或覆盖 B 的测试。

## 已知限制与独立审查处置

固定修复提交的只读复审确认：`page.tsx`、`manifest-form.ts` 与已审查 17:23 产品快照一致；pending 在网络副作用前校验/重放、API/subject/digest 隔离、普通与恢复成功四键清理、摘要竞态取消和提交前当前文件重验均无额外漂移。原 fixture 的合法正例及错配、500、刷新恢复断言未弱化。该审查没有运行构建、测试或服务，不代替上表实际执行。

复审指出 B 新验证记录没有明确列出两项已知前端限制。本记录作为新增交接补充，明确保留它们，不修改 B 已提交的历史记录，也不把现有 GREEN 当作已覆盖：

1. `handleSubmitRelease` 最终 `validateUploadFiles` 的 await 位于后续 try/finally 外。极端底层 WebCrypto reject 可能令 `isSubmitting` 保持 busy；本轮未注入并验收该异常路径。
2. localStorage 使用单 pending/active/draft 模型，不是多个 API、subject、digest 上下文并存的草稿库。异上下文新流程后续可能替换旧 pending；已通过的三元组隔离并不证明多上下文草稿留存。

公司 OIDC/PKCE/撤权、生产独立可注册域/TLS/真实浏览器 Cookie 政策、两个真实 Vue/React 业务试点、上游视觉与完整兼容矩阵仍未验收。完整 G2/M2/T10/T11/T12 和生产上线保持未完成。本地 T08 专项不替代这些门槛。

## 冻结材料与协作交接

本次网页流程使用 A 固定 SDK 产品 `190b60bfc583fc68611a21d270784017b7f91f11` 对应的权威冻结批次 `.tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583`，没有重新打包。

| 包 0.0.10 | SHA-256 |
| --- | --- |
| core | `2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752` |
| vue | `b01aeec7604b2c399a6cb1efa7b4ba1ac3092f12ea92322c682a188045e8c01b` |
| react | `cd625741f37a95f81b395b45bce6a34d439135dcaa1df3ea5989c73159ab8e5c` |

A 另交付只读交叉审查文档提交 `2768d8fd8ac9124add8042046ccbbd538d7464b4`；C 的摘要核对与 SDK 交接稿六组严格消费者证据已分别记入前序记录。B 本轮交付上述 fix 与独立 0.0.4 升版；C 交付独立测试、归档复验与本记录。各自保留所属工作区，不互相覆盖产品代码。

最终再次核对 C、B 和独立归档的原架构文档 SHA-256，均为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`；三包冻结摘要仍为上表值。离线安装后的锁文件 Git blob 与最终提交一致，四个产品/单测文件的摘要与归档来源记录一致。本次共享三存储没有初始化、重启或轮换凭据；真实网页测试仅使用自有随机端口、带所有权标签的 RecoveryStack。

2026-11-13 18:23（Asia/Shanghai）检查：带 `org.zhinexus.recovery` 标签的容器（包含已停止容器）和卷均为零，5183 无监听。B 保持最终 hash 和干净工作区。

完整命令、退出码、耗时、日志摘要、来源文件摘要、根套件失败与清理结果见 [机器证据](c-b-gallery004-final-2026-11-13.evidence.json)。原始日志保存在本地 `.tools/operations/b-final-1624fa3/`，不提交测试容器凭据或大日志。根 tsc 成功但没有 stdout/stderr，`Tee-Object` 未生成 `root-tsc.log`；机器证据明确保留退出 0 和空输出说明，没有伪造日志文件。

最终只读复审已确认本记录明确补足两项已知限制，未发现新的 Critical/Important；升版 diff 仅版本/CHANGELOG。网页本地专项通过、根套件未全绿及外部门槛未完成分别保留，不相互替代。
