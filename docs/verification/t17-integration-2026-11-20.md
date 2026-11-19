# T17 集成与验收续接记录（2026-11-20）

本记录追加本轮实际运行结果，不替代既有验证记录。日期按 Asia/Shanghai。当前仍在完成冻结产物的真实宿主、矩阵与黑盒验收，T17 和三期尚未据此标为完成。用户已授权本轮创建临时 Vue / React 工程，验收后清理；此类工程标记为 temporary/synthetic，不替代历史真实业务试点或生产 G2。

## 已运行验证

以下命令在 `feat/t17-integration` 集成工作树内使用 `.tools` 固定 Node 26.13.0、pnpm 12.18.0。

| 命令 | 实际结果 | 边界 |
| --- | --- | --- |
| `scripts/pnpm.ps1 -PnpmArgs @('exec','turbo','run','build','typecheck','--force')` | 20/20，0 cached，exit 0 | 冻结前工程全图，后续产品修复仍需复验 |
| `scripts/pnpm.ps1 -PnpmArgs @('test')` | T10 161 passed / 7 skipped；Vitest 109 文件、1996 passed / 2 skipped，exit 0 | 首次未注入冻结 SDK，跳过项另行补跑 |
| 带 `A10_FROZEN_BUNDLE` 与 `ZHINEXUS_SDK_BUNDLE_DIR` 的 `test:t10` | 168/168，0 skipped，exit 0 | 使用下列既有 SDK 原字节 |
| 带 `A10_FROZEN_BUNDLE` 的 `exec vitest run tests/evaluation/component-query-sdk.test.ts tests/acceptance/t16-a/t16-a-api-cases.test.ts` | 2 文件、27/27，exit 0 | 补跑根套件的两个环境跳过项 |
| `test:browser` | 282 passed / 2 failed / 4 did not run，exit 1 | 失败原因为未设置 `ZHINEXUS_SDK_BUNDLE_DIR`；保留首次失败事实 |
| 带冻结 SDK 路径的 `test:browser tests/browser/web-upload-real-e2e.spec.ts` | 6/6，exit 0 | 补跑三存储发布、缺图/错框架、故障阻断、丢响应恢复和摘要篡改 |
| `exec vitest run tests/integration/project-mcp.test.ts tests/integration/project-verify.test.ts tests/integration/integration-repair.test.ts tests/integration/project-verify-cli.test.ts` | 4 文件、35/35，exit 0 | 修复后窄测；包含真实 stdio |
| `verify:workspace` | 10 members，无环，公开包与服务端依赖边界通过，exit 0 | 升版至 0.0.18 后运行 |
| host 支架套件 | 6 文件、62/62；根 `tsc --noEmit` 通过 | 包含新 local-services 的 5 个单测，不计产品矩阵 |
| matrix 支架套件 | 9 文件、75/75；根 `tsc --noEmit` 通过 | 修复真实 plan/apply 契约误判，不计 20 场景实跑 |
| 带冻结 SDK 与独立 Next 5173 的 `test:platform` | 35 文件、137/137，exit 0，331.38 秒 | 本次 owner 三存储；真实 Next 服务由本轮启动并在测试后关闭，5173 已释放 |
| 环境指纹修复后四文件窄测（browser-environment / project-verify / integration-repair / project-mcp） | 37/37，exit 0，42.78 秒 | 含真实 FontFace、实际 CDP revision、Playwright 组合 selector 与字体超时失败关闭 |
| `--filter @company/component-cli build` 与 `typecheck` | 均 exit 0；打包 probe 清单 73 文件、0 缺失/额外/污染/链接/改动 | 冻结 0.0.18 前执行 |
| 新 repair 评分回归后的完整 matrix 支架套件 | 10 文件、94/94，exit 0；根 `tsc --noEmit` exit 0 | RED 首轮 2 failed / 12 passed；修复场景、空输出与磁盘加载回归，不计产品实跑 |

## 冻结 SDK 与隔离服务

- 复用已有冻结 SDK，未重打包：core 0.0.11、Vue/React 0.0.12；manifest SHA-256 为 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`，199 个文件。
- `prepareT17LocalServices()` 为本轮创建带随机 owner 标签的 PostgreSQL / Verdaccio / MinIO 和编译后的 Nest API；不重启、不修改现有 G2 容器。凭据只在内存和自有临时秘密目录内使用，返回的令牌字段不可枚举。
- 最终真实 smoke：1/1（38.88 秒），14 个实现 Ready；私有 API `/v1/me/variant-releases/:id` 与私有 Registry reader 可读，Registry 匿名访问被拒绝，公共 npm 依赖由本次 Verdaccio 代理。此为本地签名 OIDC fixture，不是生产 OIDC 验收。
- smoke owner `0b73526b-1d9c-4734-89a1-b08ce557d3a5` 收尾：自有容器 0、自有卷 0、自有凭据目录已删除。已有 Docker 资源未操作。
- smoke 结果位于忽略目录 `.tools/operations/t17-local-services-smoke/t17-local-services-1cXUSf/smoke-result.json`。

## 聚焦提交

- `3cecc0cc`：固定 MCP 证据物理目录并拒绝运行目录链接；独占写保护既有证据。窄测 35/35、diff check 通过，独立审查无确认的 Critical / Important 回归。
- `c901d5d3`：CLI 升级至 0.0.18，并同步 CHANGELOG；工作区检查通过。当前尚未冻结该版本候选。
  - 该提交时尚未冻结；随后在下述环境指纹修复提交后一次性冻结。
- `b46ef834`：从实际 Chromium CDP、页面字体与已安装依赖采集环境指纹；窄测 37/37、CLI build/typecheck 与 diff check 通过。

## 0.0.18 单次冻结

- 来源提交：`b46ef8343949bb3ea06d7839404377f1ab4d4b70`；冻结时 `packages/component-cli` 无未提交源码修改。
- tarball：`company-component-cli-0.0.18.tgz`，451148 字节，SHA-256 `08d201fa8bf469dac373499c976cf66ae90809ac098895a4b591ab321c5c88d0`。
- 仓外冻结目录：`D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.18-bac1c036-dd27-43c4-a160-ace38fc6c415`，同目录 `freeze-manifest.json` 保存来源、时间、大小与摘要。
- 反重力宿主、Codex 矩阵与黑盒，以及 T15/T16 回归均已收到同一冻结输入；后续不重打包该候选。

## 冻结前发现与未完成范围

- 独立矩阵实现发现 T17 浏览器报告仍回退到默认字体摘要和 browser revision。此缺陷按 TDD 修复、独立复验并提交后，才冻结上列候选。
- 实际 Antigravity 已恢复，主责真实双框架宿主 browser/visual 链；Codex 辅助环境、独立审查与复验。实际 Claude Code 本轮调用约 15 分钟仍无文件交付，模型渠道告警后仅终止该次自有进程；无可计入的 RED 交付。Root 已接手并复现评分缺口，保留原有测试修改。
- V10/R10 的 `requiresRepairFault` 此前未被评分器读取；新增 seal 绑定的 initial failed report / repair result，要求合法非零尝试、连续报告与源码保护摘要、最终 passed 报告及生成文件字节一致。成功命令的真实空 stdout/stderr 可按空字节 SHA 封存，其他实质证据继续要求非空。
- 当前矩阵支架、host 支架和冻结包的少量命令回归均不证明 20 个正向场景、13 个强制拒绝及完整 CLI/MCP 成功与取消链已验收。
- 还需：修复实测环境签名、构建并一次冻结最终 CLI、同 SHA 的真实安装与宿主/矩阵/黑盒、T15/T16 冻结回归、最终全图与平台验证、证据封存和本轮临时工程清理。
- 原架构文件保持只读；本轮已核对 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 01:18 续接：冻结回归与新问题

- `c14ab932` 已聚焦提交 repair 评分与真实空输出证据修复。完整矩阵支架为 10 文件、94/94；独立评分复验 23/23。上述结果仍不计为产品矩阵通过。
- 同一 0.0.18 冻结 tarball 的 T15 回归：`exec vitest run --config tests/acceptance/phase3-plan.config.ts`，25/25、exit 0、51.42 秒。结果与 Vue/React last/match JSON 已保留于仓外 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/t15-regression-EuEuPg`。仅本轮 `zhinexus-t15-installed-EuEuPg` 临时根核验安装版本与摘要、无 reparse point 后移入系统回收站，原路径已不存在；没有永久删除或清空回收站。
- T16 0.0.18 冻结回归：设置同一 `PHASE3_CLI_TARBALL`、有效 `A10_FROZEN_BUNDLE` 与历史 `INSTALLED_CLI_EVIDENCE`，执行 `exec vitest run --config tests/acceptance/t16-installed.config.ts`，实际 13 passed / 1 failed、exit 1、674.33 秒。失败为 `Next App Router Server Page directly consumes the installed generated React client component`：apply 返回 `rolled-back`、`INSTALL_FAILED`、`reinstall-required`。证据暂留本轮 `C:/Users/10208/AppData/Local/Temp/zhinexus-t16-installed-eDXabl`，待诊断与仓外归档后再清理；不得记为 T16 全绿。
- 独立黑盒从仓外已安装 CLI、仓外工程 cwd 启动时发现另一明确产品缺陷：`install.ts` 只从模块目录和 cwd 祖先查找固定工具链，未从实际固定 Node 的 `process.execPath` 查找，因此在执行安装前即 `INSTALL_FAILED` / `not-run`。修复仅在最后增加真实执行 Node 的路径来源，保留原优先级、固定绝对路径与三项精确版本校验；无 PATH 降级。专用真实外部模块/外部 cwd 测试 RED 为 2 failed / 1 passed，作者 GREEN 为 3/3、安装隔离合计 56/56；控制方复验与 0.0.19 新冻结尚待完成。
- 黑盒以仓库 cwd 继续的 0.0.18 诊断已越过上述工具链定位，但在真实安装后回滚；该诊断不能替代外部 cwd 验收。正在保留完整去敏输出定位安装失败，不能仅据 CLI exit 0 判成功。
- 产品矩阵 V01 的独立参考安装曾出现 Vite 构建缺少 `@rolldown/binding-win32-x64-msvc`；确认为当前 rolldown 1.2.18 声明的精确可选依赖，但具体漏装原因尚未确认。下一轮 fixture 将其设为精确显式依赖并在清理前封存 npm 诊断日志，不冒称产品链已运行。
- V05/R05 的冻结 readySelector 明确匹配三个组件，而矩阵执行器误要求唯一。控制方新增真实 Chromium 回归，RED 1 failed / 13 passed；修复为至少一个匹配、逐个可见且尺寸非零、共用有界时间和稳定数量检查，GREEN 14/14。预声明动作、数量和三个 canvas 门槛均未改变。
- 实际 Antigravity 已收到新的工具链问题与新包计划，继续主责双框架宿主及受控 failed → repair → passed；0.0.18 仅供失败保留与诊断，最终验收须转用修复后单次冻结的新版本。

## 0.0.19 冻结与复验

- `388c75e5`：支持仓外安装 CLI 从实际 Node 定位固定工具链。控制方复验 `project-install-toolchain.test.ts` 与 `project-install-isolation.test.ts` 为 2 文件、56/56、exit 0；CLI typecheck/build 均 exit 0，probe 清单 73/73。
- `1615dfc5`：独立升级 CLI 至 0.0.19，补齐 CHANGELOG；`verify:workspace` 为 10 成员、无环、安全服务依赖图，exit 0。
- 新包仅打包一次：`D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.19-43934935-59c2-4569-8b7e-009f07721519/company-component-cli-0.0.19.tgz`。451225 字节，SHA-256 `45a514e9c18e532f7777d57581d7e5879deb1a6997b25009e3d2aad5e3a2500a`；来源 `1615dfc5c6761aa8ccde76708893d5b8e48e797c`，同目录有 `freeze-manifest.json`。0.0.18 原包未修改、未覆盖。
- 新包 T15：正确配置 `tests/acceptance/phase3-plan.config.ts` 实跑 25/25、exit 0、60.20 秒。最初一次误写不存在的 `t15-installed.config.ts`，仅配置启动失败，没有执行测试；随后按实际文件名纠正。仓外结果位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/t15-regression-508m5k`，四个 JSON 原始证据逐文件摘要已核对。仅本轮临时根 `zhinexus-t15-installed-508m5k` 已移入系统回收站，原路径不存在。
- 旧 T16 0.0.18 根的 101 个顶层 JSON 已核对凭据与摘要后归档至 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/t16-regression-eDXabl`；未复制 config/cache/node_modules。独立诊断方完成只读取证后，仅本轮旧根 `zhinexus-t16-installed-eDXabl` 已移入系统回收站，旧 owner 容器和卷均无残留。
- 新包后的工程强制全图：`exec turbo run build typecheck --force`，20/20、0 cached、exit 0、22.51 秒；随后完整根 test 和带有效 SDK 的完整 browser 已启动，结果待收取。
- 控制方最新完整 matrix 支架复验：10 文件、100/100、exit 0；随后根 `tsc --project tsconfig.json --noEmit` exit 0。此时 B 的新 rolldown 测试已 GREEN；先前并行开发窗口的 99 passed / 1 failed 是该新增回归的 RED，保留失败事实。
- 新包 Next-only 诊断已真实捕获 `npm ci` 的 `ECONNRESET / Error: aborted`，阶段为 materialization；候选锁生成 exit 0。主轮与低层独立诊断均保留去敏 npm 日志。该证据确认传输失败，不证明工具链问题重现；原约定要求私有 registry 单来源与鉴权槽绑定，未擅自改为绕过注册表下载。正以新 owner 环境采集上游传输日志。
- 新包黑盒阶段性结果：仓外 cwd Vue CLI 与 Vue MCP 完整成功链均已通过；MCP 无 apply/verify grant 拒绝且源不变。React 与取消链仍在运行，尚不能记为四链全部通过。

## 01:39 续接：完整回归与四链黑盒

- 同一冻结 0.0.19 的完整根 `test` 已自然结束：T10 为 168/168、0 skipped；Vitest 为 116 文件、2049/2049、0 skipped，exit 0，638.91 秒。带有效 `A10_FROZEN_BUNDLE` 与 `ZHINEXUS_SDK_BUNDLE_DIR`，没有用环境缺失跳过代替验收。后续新增验收测试须另行复验。
- 带有效冻结 SDK 的完整 `test:browser` 已结束：288/288，exit 0，约 3.3 分钟，包括六项真实三存储网页提交验收；不是仅补跑失败子集。
- 真实黑盒 `tests/acceptance/t17-blackbox/live.spec.ts`：5/5、exit 0、607.06 秒。覆盖 Vue/React × CLI/MCP 四条真实安装、plan/apply/type/build/click/visual 成功链及 CLI/MCP 语义等价，四项无 grant 拒绝且项目不变，双框架 failed verify 后无配方 repair 明确停止，以及真实 MCP SDK 取消通知和三层子孙进程在 server 关闭前退出（取消后 server 仍响应）。此处的 repair 停止不能替代另一路受控故障修复成功验收。
- 黑盒稳定证据：`D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/blackbox-live-0.0.19-ff3e14e7-d6b6-46bd-93cf-c26971fb6a89/retained-evidence-audit.json`。12 份原始与复制 receipt SHA-256 逐项一致，CLI tarball 摘要未变，SDK 199 文件字节/摘要复核通过；145 份保留文本 JWT 形态扫描零命中。自有临时项目、外装 CLI、自有 recovery 目录已清理，final cleanup `passed: true`。
- Next-only 诊断进一步确认测试基础设施超时：同配置 Verdaccio 冷代理下载四个大包时均在约 30 秒中断，去敏 debug 日志明确为 `ETIMEDOUT` / `Timeout awaiting 'request' for 30000ms`，实际 `options.timeout.request=30000`。顺序重试 next/swc 仍在 30 秒失败，echarts 与 rolldown 分别在 27.9 秒、11.6 秒完整成功；公网探针也较慢。正仅提高隔离测试 registry 的有界 upstream timeout，保持产品固定 registry、SDK provenance 与精确鉴权槽约定不变，修正前的失败不改写。
- Antigravity Gemini 任务在 quota reached 后暂停模型执行，宿主编排仍有待复验改动；已在同一实际客户端切换已列出的 Claude 模型接续，不开启付费 overages。完整宿主双框架及 failed → repair → passed 仍待最终结果。
- 矩阵独立参考的 V01 已通过真实固定点击 0→1、1 canvas、零 pageerror；后续 apply 因 fixture 中项目级 `.npmrc` / overrides 被现有安全配置约定拒绝，已交原作者纠正 fixture，不扩大产品支持面。完整 20 正向 + 13 拒绝与封存评分仍未完成。

## 02:18 续接：完整 T16 与宿主证据纠正

- `abfcba8b` 完善矩阵多 ready 元素与失败请求保留；真实 Chromium RED 2 failed，GREEN 16/16。其后补异步 count/text/visible 原精确断言的有界等待，新增真实 Chromium RED 3 failed / 3 passed，GREEN 6/6；完整浏览器及通用执行链 6 文件、69/69，测试源码 tsc、diff check 均 exit 0。没有更改场景动作、期望、分母或超时失败要求。
- `10cfb5fd` 仅将隔离验收 Verdaccio 的 upstream request timeout 提高至有界 5 分钟，保留单一 registry 与精确鉴权槽。固定镜像解析为 300000ms；此前日志的 30000ms 截断保留。完整 0.0.19 T16 现为 **14/14、exit 0、657.24 秒**，无测试名过滤，覆盖 Next App Router。前后 tarball SHA-256 均为 `45a514e9c18e532f7777d57581d7e5879deb1a6997b25009e3d2aad5e3a2500a`。稳定证据 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/t16-full-0.0.19-timeout5m-5d3483a5fdb94f75a0dd1c3ead1574de`，归档 103 份进程 JSON、10 份去敏 npm 日志及汇总，138 份归档文件已重读摘要；本轮 owner 容器、卷均为 0。
- Antigravity 实际客户端的 Gemini、Claude 渠道均遇额度耗尽，未开启付费 overages。Codex 已接手余下实现与验收；保留此前真实交付来源，不把 Codex 子代理称为其他模型客户端。
- 首轮固定 33 格产品矩阵均已执行并封存，但实得 **0/20 正向、6/13 拒绝**，不能标为通过。seal `2a8acbd3c97f9224607ee5392c90828a683a8cc3d8a26515a302cdfac6b86d5b`，908/908 文件字节与摘要已复核，该轮 parentRoot 已清理。正在修正初始预装 SDK、公开 config.chart、React 属性/事件和 Vue KeepAlive 等验收 fixture 问题；不改冻结分母或预期。
- 宿主完整实跑先后真实失败：首轮为构建图包含 Vite 虚拟模块；新轮为源码扫描遇工程内 npm 大包缓存，随后未登记的产品 `.t16-quarantine-*` 掩盖了原始 blocked 报告。新轮日志位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/host-live-0.0.19-rerun-9654403098c7437eba1328bd6bccb1ff`，1 failed、exit 1、182.98 秒，冻结摘要未变。独立 SDK 双框架点击先导只证明参考页真实事件通过，不能替代完整宿主/repair 成功链。
- 失败早退清理补充真实 OwnedRun/scaffold 回归：RED 2 failed，登记本轮已创建 evidence area 的现有条目后 GREEN（chain 相关）11/11；仍由原生身份、owner marker 和旧内容清单拒绝未知替换。报告 artifact 的封存后篡改/删除曾 RED 1 failed，补逐路径、类型、realpath、nlink、封存 inventory/摘要/大小重读后宿主 9 文件80/80。独立审查再发现 spec 基线与 repair 备份不在 report.artifacts 中，正补完整回读与专门 RED，不能据80/80宣称全部证据闭环。
- npm 下载 cache 外移至每次独占的工程外 evidence area，保留配置空字节/身份守卫；物理大文件回归 RED 1 failed，GREEN runtime 17/17。该项仅修临时宿主，不修改产品源码检查预算。产品保留的 quarantine 须用本轮真实交付 journal、原 node_modules inode/字节和 parent 快照证明后才可纳入本轮清理，不能只按名称前缀接管。

## 既定 no-install 语义的遗漏与补齐

- 先前认为须另问语义决策，补查后确认已提交的 `8def5ad1993b9bd8fa1643279041135ef82bf1ce`（2026-11-19）已明确：设计第70行、实施计划第17/49–51行要求保留 T16 `not-run + installedVersions=[]`，由 T17 verify 独立读取实际安装树、lock 与清单；因此按已确认范围补齐，不重复等待用户决策。
- 原共享 apply context 无条件要求全量安装版本，与产品 no-install 分支不符。新增四例，真实 RED **2 failed / 87 passed**；最小修复为 no-install 不可伪造列表、计划需要安装时仍必须 succeeded 和精确全量列表，GREEN 六套契约/产品回归 **254/254、exit 0、49.73 秒**。
- 矩阵旧合成 fixture 也伪造了 not-run 的非空安装列表。改为诚实空列表，并仅在 apply 实际 succeeded 时核其安装列表；verify 报告仍必须有全量实际版本及清单摘要，相关错版本反例不变。修正前矩阵18项失败保留，修正后矩阵23/23（与 runtime 合计40/40）通过。未降低正向门槛、强制拒绝或真实安装 proof 要求。
- 真实固定 pnpm 12.18.0 先导确认默认 verifyDepsBeforeRun 可在 run 前自动安装，甚至安装失败后脚本仍 exit 0。产品需显式禁该隐式安装并补原生 RED/GREEN；最终将独立升版、另立一次冻结并复验，0.0.19 原包/证据不覆盖、不重打包。

## 清理受限的保留项

- 自动审批拒绝了完整 T16 本轮两个工程及 recovery 目录的回收/删除，原因仅为 `blocked by policy`，该整条命令未启动。`zhinexus-t16-installed-HR0pbo`、`t16-d-lUzHbo` 与 owner `ff6b32e0-1d1a-465b-92b9-df1cf7c2e0ff` recovery 目录仍保留；精确规范路径与形态见外置 `cleanup-inspection.json`。没有更换删除 API 重试规避。
- 早期浏览器审查 fixture、最小 pnpm probe 亦有自动审批拒绝的保留现场，相关进程已停。宿主失败与新矩阵先导的未封存工程保留，待归档与所有权复核；不能声称本轮所有临时目录已清除。
- 本轮重核原架构 SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 03:32 续接：0.0.21 冻结与最终回归

- `805c7341` 修复固定 pnpm 在合法精确 packageManager 声明下重新引导管理器、向 pnpm-lock.yaml 追加管理器 YAML 文档的问题。保留项目声明，以真实 RED/GREEN 确定 `--pm-on-fail=ignore` 与 `--config.verifyDepsBeforeRun=false` 的组合；五套产品回归 111/111、CLI typecheck 与根 tsc 通过。详见 [补充记录](t17-pnpm-manager-bootstrap-2026-11-20.md)。此前 0.0.20 的失败现场和原始字节保留，不改写为通过。
- `3fbcfa9b66900c55e254f15e73f318055c6a104f` 独立升级 CLI 0.0.21。产品/契约源码干净时 build 与 73/73 打包清单 probe 通过，03:17:48.0927238+08:00 仅 pack 一次。冻结目录为 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.21-432a7805-4921-4c7d-a07d-029bbf7ed010`，tarball 451414 字节，SHA-256 `7dd4874f0e6c98caddb2de959b942d7bde463c35a04ba82fe31ec67140f5f7cd`；freeze-manifest.json 保存来源 HEAD 和冻结时间。旧版本均未覆盖，冻结 SDK 199 文件及 manifest 摘要保持原样。
- 该候选的强制全图 build/typecheck 为 20/20、0 cached、exit 0，18.389 秒；根 tsc exit 0。外置证据 `workspace-0.0.21-665539951682462c8ab6222590ab3fe8`。升版时 verify:workspace 10 成员检查通过。
- 同包完整 T15 为 25/25、exit 0，63.22 秒。真实黑盒 live 为 5/5、exit 0，543.99 秒，覆盖 Vue/React CLI/MCP 四链及取消；legacy 安装/拒绝入口为 5/5、exit 0，30.60 秒。证据归档及清理仍在进行，不能仅凭这些结果称完整三期通过。
- 矩阵评分和执行器最新完整单元入口为 12 文件、185/185，独立只读审查未见 Critical/Important。`ef835de6` 聚焦提交诚实失败计分与真实 N10 两轮耗尽证据校验，见 [评分记录](t17-matrix-scoring-2026-11-20.md)。完整产品 33 格仍需以 0.0.21 同 SHA 最终实跑评估。
- 0.0.20 完整宿主历史成功证据由控制方独立重读归档：3916 文件、688779060 字节，SHA/大小逐项一致，无额外文件、链接或 JWT 形态，外置 `host-live-0.0.20-browserfix-40e54445/root-independent-byte-archive-audit.json`。这是原始字节归档复核，不能替代清理前 filesystem identity receipt，也不能替代 0.0.21 宿主验收。
- 本时点 0.0.21 完整根 test、平台、T16、双框架宿主受控修复链与正式矩阵仍在执行；完整 browser 须待平台释放 5173 后再运行。所有最终结论以随后新增记录为准。

## 04:54 续接：审查修复与 0.0.22 单次冻结

- 0.0.21 随后完整根测、平台、浏览器、T15/T16、黑盒和双框架宿主均已自然通过，实际计数见 [该版回归](t17-cli-0021-regressions-2026-11-20.md) 与 [该版宿主](t17-host-0021-2026-11-20.md)。正式矩阵却为正向 20/20、拒绝 12/13、exit 1，唯一 N10 在 MatchPlan 请求阶段因重复设计映射被真实 API 拒绝，不判为产品预算检查通过。该轮 2975.21 秒的原日志、57 个证据根与 22739 个归档文件保持原结论。
- 最终独立审查发现两个 Important 缺口。`672582ba` 保持 repair 的完整源报告快照，仅更新确认写入的生成路径，并独立保留原 plan/apply 的清单、锁等守卫；发现用户变化立即停止后续轮次。新增回归先真实 RED，五套 118/118 与独立 6/6 通过，见 [源快照记录](t17-repair-source-continuity-2026-11-20.md)。`b193406c` 在 stdio 序列化前清洗 SDK 自动校验错误，保留 JSON-RPC 关联字段与错误码；真实双进程两例先 RED，MCP 8/8 与独立协议探针通过，见 [脱敏记录](t17-mcp-sdk-redaction-2026-11-20.md)。
- `43aa9bbf` 单独升级 CLI 0.0.22；`f96af5ee` 只修正回归测试的判别类型。CLI 产品与公共契约源码干净时，于 04:39:01+08:00 仅 pack 一次，453485 字节、SHA-256 `d3da08748faa4c18a19a8b757caf817dae032e82b9405521a87dd8f877c179ef`，来源 `f96af5ee59cfbd007ba4ff50aad3de60cebafb60`。既有冻结 SDK 与历史兼容输入未重包或替换。
- `bf65180a` 修正独立 N10 请求夹具，仅去重相同设计目标，保留三个实例、绑定与 API 映射；不同目标提前拒绝。2 RED→2 GREEN，矩阵支架 13 文件、187/187，根 tsc 与 diff check exit 0。随后同包 N10 诊断 1/1、278.67 秒、exit 0，实际写入两轮后停止且第三文件不变；其 3 根、429 文件、17487244 字节归档由控制方独立逐字节复读通过，3 个 parent 不存在。诊断不计入正式评分。
- 当前正式完整 33 格于 04:45:27+08:00 启动，固定 20 正向、13 强制拒绝，未过滤场景；宿主与独立黑盒、T15/T16、根测和浏览器均以同一冻结 SHA 复验。平台已 35 文件、137/137、exit 0，570.34 秒；其自有 Next、容器及卷退出后才启动完整浏览器。最终结果追加于 [0.0.22 回归](t17-cli-0022-regressions-2026-11-20.md) 及其关联记录。
- 先前官方来源访问范围的不实记录已独立更正并逐页补验，见 [更正](t17-c0-official-correction-2026-11-20.md)。当前证据不追认原 P0 独立日志、最初 RED 顺序与原始 stderr 空字节。用户本轮补充确认的 no-install 语义与已实施修正一致，见 [无安装契约](t17-no-install-2026-11-20.md)。

## 05:15 续接：完整回归与独立原件复核

- 0.0.22 完整根测自然退出 0：T10 168/168、零跳过；Vitest 123 文件、2198/2198。真实平台为 35 文件、137/137；完整浏览器为 288/288，均 exit 0。控制方已重新读取 16 份原日志/结果，核对完整计数、冻结包及原架构摘要，见 [工程回归](t17-cli-0022-regressions-2026-11-20.md)。
- 同一冻结包的四个独立配置合计 49/49，均无筛选、无跳过、自然 exit 0：live 黑盒 5/5、installed 黑盒 5/5、T15 25/25、含 Next 的 T16 14/14。控制方分别重新读取原件与副本，共 336 份文件、3188592 字节、17 份 receipt；追加的实际安装 SDK 错误脱敏探针另列，不增加测试分母。记录已提交为 `2da99161`，见 [0.0.22 黑盒](t17-blackbox-0022-2026-11-20.md)。
- 完整宿主自然 exit 0、1/1，含 Vue/React 各一条正向和一条失败→单次修复→完整通过链。控制方独立复读清理前封存的 34681 份文件、2586571483 字节，以及 1754 份保留原 evidence；重算四链 canonical 摘要和四张 PNG 均一致。800×400 实图与独立参考 RGBA 差异为 0，标题顶部少量裁切如实列为构图限制。记录提交 `e7c9a6b6`，见 [宿主与封存](t17-host-0022-2026-11-20.md)。
- 宿主三个临时 parent 已清理，其 owner 容器/卷为 0，秘密目录不存在。黑盒本轮八个已确认归属目录的单次原生 PowerShell 清理请求，被自动审批在进程启动前以 `blocked by policy` 拒绝；八根仍保留，精确路径、身份与 inventory 已持久化。没有换 API、拆分重试或再次清理历史受阻目录，不能报告全部临时目录已清除。
- 正式矩阵此时仅确认 Vue 10/10，React 与 13 个强制拒绝仍在执行；最终审查亦在收取。未把 N10 单独诊断、宿主或黑盒的成功计入矩阵分子，不提前宣布三期验收完成。CLI/公共契约及根依赖配置相对冻结来源 `f96af5ee` 的只读差异检查为空。

## 05:28 续接：正式 R08 行为失败

- 固定正向 20 格已实际执行，当前为 19/20：Vue 10/10、React 9/10。唯一 R08（React StrictMode/pnpm）产品 verify exit 2，type/build/dependency/business-gaps 通过，browser 为 BEHAVIOR_FAILED，visual 未运行。原 behavior 只有 text_mismatch:[data-testid="mounts"]，没有保存失败瞬间实际文本，因此不据后续截图补推该值。
- 控制方重新读取原 receipt/report，直接查看实际 PNG；稍后的产品截图与独立矩阵截图、基线同 SHA-256，图中 mounts=2、cleanups=1。正在用真实产品路径最小复现是否存在异步断言过早的缺陷，未凭截图直接认定根因。原消费者已经按原生清理移除，其真实 App 字节仍在加载 sourcemap 与 source inventory 中可追溯。
- 正式 33 格继续自然执行，当前已进入 13 个强制拒绝；不干预该轮、不补跑替换 R08、不缩减分母。若确认产品缺陷，将独立 RED/GREEN、升版、新冻结并重新验收，而不是以整体超过 80% 掩盖已知问题。

## 05:36 续接：真实产品确认异步断言缺陷

- 独立 synthetic 最小宿主通过真实公开 verifyIntegration 和固定 Chromium 复现两次：点击后 250ms 更新文本、browser.timeoutMs=1500，均提前返回 BEHAVIOR_FAILED/text_mismatch；同步 control 通过，永久不更新 control 仍失败。type/build/dependency/business 四类均通过。独立 Chromium 对相同宿主立即读到 pending，在条件等待后读到 done，实际更新约 252ms。未提供视觉基线的 control 仍为 NEW，不能称整体通过。
- 原冻结 tarball 的 306 个 dist 条目均与探针实际导入字节一致。诊断位于仓外 r08-async-assertion-probe-20261120-0635-valid，目录标签不是执行时间；result.createdAt 为 2026-11-20 05:30:01+08:00。控制方再次逐一复读 manifest 的 56 文件 / 187652 bytes 和冻结包，failures=[]，root-original-byte-reopen.json SHA-256 为 19da3a13fa01cc3b115e97b6966824d7f3a14c4b0e11a92407d3053ca4409f2b。该诊断不是完整安装验收，不替代原 R08 或正式评分。
- 缺陷归为 Important/P1。新独占产品任务先补真实 Chromium RED，覆盖 delayed text/count/visible、永久负例的有界失败及等待中取消，再做最小修复；保留 first/textContent.trim/精确数量/非零尺寸语义，不放宽断言或增大超时。完成后由另一代理独立审查，控制方另升 0.0.23、只 pack 一次并全量复验。此时修复尚未完成，0.0.22 全矩阵继续自然执行并保留真实 R08 失败。

## 06:02 续接：异步断言修复、独立批准与 0.0.23 冻结

- 0.0.22 正式完整矩阵已自然 exit 0，3340.98 秒；正向 19/20（Vue 10/10、React 9/10）、强制拒绝 13/13。R08 failed 原样保留；聚合门槛通过不能掩盖 Important/P1。59 roots / 23162 files / 493332540 bytes 经控制方原件与副本独立复读通过；59 owned parents 已删除。独立记录提交 `9fb5f215`，见 [0.0.22 矩阵](t17-matrix-0022-2026-11-20.md)。
- `10ca2957` 最小修复动作后的异步断言等待，共享原有 browser.timeoutMs；没有扩大导航/就绪/动作时限，保留精确断言、取消及失败分类。有效真实 Chromium RED 为 8 failed / 4 passed，最终聚焦52/52、既有完整 browser case 1/1。控制方独立重开273项原证据；另一 reviewer 给出 Spec compliant / Approved，Critical 0、Important 0。RED 的先后顺序依赖当时收取的 pre-edit handoff，不用事后日志冒称独立证明；原R08失败瞬间actual依旧未知。详见 [异步断言记录](t17-async-assertion-2026-11-20.md)。
- `edb985ec0f9ee1b79a5882e935832f8caa9f0daf` 独立升版 CLI 0.0.23。冻结前 verify:workspace 10 members、force build/typecheck 20/20（0 cached，14.435s）及完整根 tsc 均 exit 0；于 05:51:34.8465368+08:00 仅 pack 一次。tarball为454155 bytes、SHA-256 `93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab`，清单路径见 [0.0.23 工程记录](t17-cli-0023-regressions-2026-11-20.md)。SDK与历史兼容输入保持原始冻结字节，不重包。
- 控制方另行解开新tarball，逐字节核对全部306个dist文件、包名/版本/运行时私有包边界、相对冻结来源的产品/公共配置零差异及原架构摘要；failures=[]。`root-initial-frozen-byte-reopen.json` SHA-256为 `026fdbca973273343b51346e53ccf14bdcf736dff15232f08323a6153069f173`。
- 同一新冻结包的完整根测试、真实平台、双框架完整宿主、49项黑盒/T15/T16及完整33格矩阵正在运行；浏览器全量回归等待平台释放端口。未借用0.0.22的通过数，未宣布三期技术验收完成。
