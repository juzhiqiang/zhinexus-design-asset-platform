# 三期 T17 当前交付与验收汇总（2026-11-20）

当前结论：本轮三期 T15–T17 工具技术交付与临时工程验收通过。0.0.22 的 R08 异步 DOM 断言缺陷经 `10ca2957` 修复和独立批准后，CLI `0.0.23` 单次冻结并完成同包完整工程、黑盒、双框架宿主及33格矩阵重验；控制方原件评分和字节归档复读通过。0.0.22 的失败与通过原样保留，历史过程缺口、业务/生产开放项和清理保留目录均在下文单列。本文不替换 [追加式集成记录](t17-integration-2026-11-20.md) 或任何历史失败记录。

## 授权范围与已交付能力

用户已授权继续完成三期、创建临时 Vue/React 工程并在保留验收证据后清理；本轮工程明确为 temporary/synthetic，productionAcceptance=false。用户再次确认无安装语义：本次没有执行安装时，apply 如实返回 installedVersions=[]；verify 独立检查实际安装树、锁文件和包清单。此决定与 [契约修正及 RED/GREEN](t17-no-install-2026-11-20.md) 一致。

三期工具链包含 T15 inspect/plan、T16 授权安装/代码生成/备份恢复，以及 T17 integrate verify/repair 和四工具本地 stdio MCP。T17 运行显式授权的项目 type/build 脚本、有限浏览器行为和视觉检查，提供结构化报告；已知生成模板最多修复两轮，每轮完整重验。用户文件变化、依赖/身份不符、缺失业务信息和未知错误按守卫停止，不能由错误文本扩张执行或写入权限。

用法见 [本地验证、有限修复与 MCP](../phase3/local-project-verification.md)，实现范围和可信宿主边界见 [T17 设计](../superpowers/specs/2026-11-19-phase3-t17-design.md)。passed 只覆盖本次显式提供的宿主与检查，不自动发布、接纳视觉基线或证明未知业务已接入。

## 唯一冻结输入

| 输入 | 冻结身份 |
| --- | --- |
| CLI | 0.0.23；source HEAD edb985ec0f9ee1b79a5882e935832f8caa9f0daf；2026-11-20 05:51:34 +08:00；packCount=1 |
| tarball | D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.23-edb985ec-b8f572a9/company-component-cli-0.0.23.tgz |
| CLI 原字节 | 454155 bytes；SHA-256 93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab |
| 既有 SDK | core 0.0.11、Vue/React 0.0.12；manifest SHA-256 04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1；199 unique files / 398 refs；未重包 |
| 历史兼容输入 | SHA-256 c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7；historical-real-installed-cli-probe-replay，不是当前 CLI 新探针 |
| 工具链 | Windows x64；项目 .tools 固定 Node 26.13.0、pnpm 12.18.0、本发行版 npm 11.20.0 与本机 Playwright Chromium |

当前产品、公共契约和根依赖配置相对冻结来源的差异检查为空；冻结后仅有文档变动。控制方独立重开 tarball 的全部306个dist文件，与实际构建字节一致，包名/版本/运行时私有依赖边界通过。各独立消费者须实际安装这一 tarball，完整验收结果不能从旧版移用。详细命令、启动环境、日志摘要和冻结清单在分项记录中。

## 当前验收结果

| 门槛 | 实际结果 | 证据 |
| --- | --- | --- |
| 工作区与强制全图 | 10 members；build/typecheck 20/20、0 cached；根 tsc exit 0 | [0.0.23 工程回归](t17-cli-0023-regressions-2026-11-20.md) |
| 完整根测试 | T10 168/168，0 skipped；Vitest 124 files、2210/2210，0 skipped；自然 exit 0 | 同上 |
| 真实平台 | 35 files、137/137，完整入口自然 exit 0 | 同上 |
| 完整浏览器 | 288/288，平台释放端口后执行，自然 exit 0 | 同上 |
| T15 / T16 与 CLI / MCP 黑盒 | 四个完整配置 25/25、14/14、5/5、5/5，合计49/49；独立 installed timing probe 另列 | [本轮黑盒](t17-blackbox-0023-2026-11-20.md) |
| 独立双框架宿主 | 完整入口1/1，1235.87s，自然exit0；Vue/React正向与各一次真实repair四链各6/6、visual PASS | [本轮宿主](t17-host-0023-2026-11-20.md) |
| 固定支持矩阵 | 完整33格自然exit0、3481.91s；正向20/20，Vue/React各10/10；13项强制拒绝均符合各自预期；控制方正式评分matrixAccepted=true | [本轮矩阵](t17-matrix-0023-2026-11-20.md)，固定分母、无筛选或补跑替分 |
| 独立审查与修复 | 既有重点代码审查及异步断言修复 Spec compliant / Approved，未解决Critical 0、Important 0；本轮最终记录独立Approved，Critical/Important/Minor均0 | [重点代码审查](t17-final-review-2026-11-20.md)、[修复独审](t17-async-assertion-2026-11-20.md)、[最终记录终审](t17-final-delivery-review-0023-2026-11-20.md) |

0.0.22 历史完整工程、黑盒与宿主结果见 [该版回归](t17-cli-0022-regressions-2026-11-20.md)。其正式矩阵最终正向19/20、拒绝13/13，3340.98s、自然exit0；R08 failed保留，不因旧聚合80%门槛满足而忽略Important缺陷。原59根/23162文件/493332540字节已独立复读，59个owned parent已不存在；见 [该版矩阵](t17-matrix-0022-2026-11-20.md)。

真实本地 PostgreSQL、Verdaccio、MinIO 与编译后的 Nest API 为隔离验收服务；OIDC 为本地签名 fixture。组件构建、示例、截图和浏览器均在开发者电脑执行，服务端没有执行上传组件或启动截图浏览器。

## 控制方独立复核

0.0.23 已独立重开唯一冻结包、清单、306个dist文件和原架构，failures=[]，`root-initial-frozen-byte-reopen.json` SHA-256 `026fdbca973273343b51346e53ccf14bdcf736dff15232f08323a6153069f173`。收尾时再次实际执行冻结字节复核，307条目/306个dist文件、产品及公共配置相对冻结来源差异为空、原架构摘要一致；`root-final-frozen-byte-reopen.json` SHA-256 `37f334c9e9268a1f6b1231d02ce950c464a21e2737848dda8beaaaf002190e82`，failures=[]。本轮当前完成的控制方独立复核如下：

- 工程：17 份原日志/结果/summary/清单重新读取，完整计数、自然退出、时序和冻结摘要一致；`root-engineering-regression-reopen.json` SHA-256 `dc7e44d4f8dbd2a478d69aa9b0bfea4513bdc8a7eaa4b5e098e2438b8b0cc9ea`。审计 helper 首次语法检查失败、零产品测试的原记录保留，不覆盖。
- 黑盒：正式五组归档336文件及补充74文件合计410文件、3332628字节、135目录，原件/副本逐字节及完整文件集合一致；`root-all-original-copy-byte-reopen.json` SHA-256 `5ee88fccfc0e64ff1756cda485bfdb590c06b3bba4a869b70540d26695a4cee6`。四条产品链 canonical 与28个artifact refs 独立重算通过，installed timing 原报告/授权/spec及两个独立参考复读一致；`root-canonical-business-and-timing-reopen.json` SHA-256 `51d1c4a668fcb4e31c8afb92c00bb550036871764272acc6492caa83e6e9eb59`。同步和两次延迟案例仅 browser passed，overall failed/visual NEW；永久负例 browser failed、visual not-run，不能将其冒称完整业务通过。
- 宿主：完整清理前归档34681文件、2586567819字节与1754份保留原evidence再次读取，`root-full-archive-byte-reopen.json` SHA-256 `2f514f63571cde29a0f790a853ccf54abb60085df18d35ab5e0a84c14cdf1dfb`。三个原seal、原inventory、两receipt、冻结输入和精确owner资源再次核对通过，`root-second-original-complete-audit.json` SHA-256 `02fd1351f472ff595a4f686695ee888e4ee494af6a2aabdd40d00a546af680c5`。
- 宿主四链与四张800×400 PNG独立重算/解码一致，RGBA差异0，`root-host-chain-and-png-reopen.json` SHA-256 `5e5eb0b55f6f33ead7555a6c6a436924c7999c478a37f9ecdc7addcddb5f7cbd`。控制方直接看图，图表与tooltip可读，顶部标题裁切限制保留。
- 矩阵：控制方从原top seal实际调用正式`loadT17MatrixInput/evaluateT17Matrix`，20/20、Vue/React各10/10、13/13，matrixAccepted=true、failures/errors=[]。`root-original-matrix-score-reopen.json` SHA-256为`bfd8a0da7d1c99b659033f07367acff3511e6e4ba901f4ce5b324416d0162c94`，原seal SHA-256为`3fdf1427a0fe97e9d12966764d7de9bb642747f73355021877e6cd6207e33457`。随后另行复读59根/23162文件/493327325字节的全部封存evidence原件及副本，文件集合、seal和原日志一致，59个parent均已不存在；`root-all-original-copy-byte-reopen.json` SHA-256为`13e50a60be57e03a34f5b24d4a2a0b4e02175f5291cffd5cee090950118f7d8b`，failures=[]。该归档覆盖seal所列evidence集合，不冒称保留全部消费者依赖、build和map原字节。
- 矩阵另由只读专项审查直接复读20个正向的24个生成模块、实际source-map正文、已加载JS与40条type/build命令摘要；N10两轮真实写入、两份原字节备份和第三文件不变均吻合，未发现Critical/Important/Minor。N13是独立验收支架在真实build成功后的`entry-import-missing`拒绝，没有调用产品verify。其完整map正文已随原parent清理，当前仅能复读清理前native inventory的hash/size和运行时封存extraction，不能冒称重新打开已删除map。该审查及其首个正则转义helper语法失败只保留于工具会话，零产品测试、零写入，不虚构独立审计文件。

以下0.0.22历史复核保持原版本边界，不抵充本轮任何计数：

在下列结果之外，控制方没有以代理的“通过”口头报告替代原件复读：

- 工程：16 份原日志/退出码/冻结清单复读，failures=[]；root-engineering-regression-reopen.json SHA-256 e6cfad6859fccfa0b34a77522a92429a222a091a4104f9795852c5efa283344e。
- 黑盒/T15/T16：336 files / 3188592 bytes / 17 receipts / 28 report-baseline refs；原件与副本、canonical 链及备份文件摘要经独立复读通过。归档只保证索引文件集合，空目录保留在原 inventory，不声称复制所有消费者依赖字节。两份控制方结果 SHA-256 为 baf454603ca8fb93aa741fe7a10c297a724c536614932be488a78097144ff7e0、a5e421ba8fe1284834d778597660d6386f59e1768f7aa18f69af988388c2e00e。
- 宿主：清理前完整封存 34681 files / 2586571483 bytes，控制方另读 1754 个原 evidence 文件；root-full-archive-byte-reopen.json SHA-256 6fc6bf67254768a08d1273b9fe4cae4ae0048511b096225907f439539b1dff02。删除后的 parent 原身份由清理前 manifest 证明，后读副本不冒称再次观察到该 inode。
- 宿主四链摘要及四张 800×400 PNG 独立解码比较，RGBA 差异 0；root-host-chain-and-png-reopen.json SHA-256 6033503f2a6899fd87e986b5b2799e1824b36a63c42b57af6deb487967e8f08f。直接查看 Vue/React 实图，图表、数据与 tooltip 可读；标题顶部有少量裁切，与独立参考一致，保留为固定构图限制，不声称真实业务 UI 已验收。
- 异步断言诊断：控制方独立重开 56 文件 / 187652 bytes、四份实际产品结果和冻结 CLI，摘要均一致。同步 control 通过，250ms 更新且 timeoutMs=1500 的两个案例均 BEHAVIOR_FAILED；独立 Chromium 等待后正常变为 done，永久不匹配 control 仍失败。root-original-byte-reopen.json SHA-256 19da3a13fa01cc3b115e97b6966824d7f3a14c4b0e11a92407d3053ca4409f2b。此为 synthetic 最小产品路径诊断，不是完整安装验收或原 R08 重跑，不计正式矩阵分数。

## 清理结果与保留目录

0.0.23 宿主三个owned parent在清理前全字节封存后由原fixture删除；控制方另查其不存在，本轮owner容器/卷为0、秘密目录不存在。黑盒在410份原件/副本独立复读及12根/82840 entries新鲜身份清单核验后，单次原生PowerShell批次自然exit0，精确删除12个新根，remaining=[]；控制方独立Test-Path确认12根全不存在。`native-cleanup-result.json` SHA-256为 `08caebc73a7898631c6bb8541988969ff282f5d0c30e7f533db815d7991bd36c`。矩阵原fixture清理的59个owned parent亦由原seal及控制方独立复读确认为不存在，原evidence根和外置归档保留。宿主3、黑盒12与矩阵59是各自独立范围，不扩大成全局临时目录清空；新lane scaffold和忽略的取证helper保留。

完整工程平台的精确owner服务与Gallery已停止，当前该owner容器/卷/精确路径匹配进程均为0。`D:/project/zhinexus-design-asset-platform/.tools/recovery/f8074e4f-541a-4e83-939e-ddd69bb03e95` 仍保留四个普通凭证配置文件；原事件可关联owner，但缺创建时marker/首见native身份，未发删除命令，也未打开或哈希凭证内容。浏览器原日志没有可确证的recovery owner/路径，不按请求UUID或时间戳猜测共享目录的归属。边界审计 `root-engineering-cleanup-boundary-audit.json` SHA-256为 `726ac0548317e28b199c8e2772ef303a5a5170273c5025aa31e9bc331b02a6c1`；保留原因是归属证据不足，不是缺少用户清理授权。下列0.0.22与更早的历史保留项不重试：

历史 0.0.22 宿主三个 owned parent 已删除，owner 5ed1785b-3995-4b96-ba87-964055abe102 的容器/卷均为 0，秘密目录不存在。工程平台 owner 的服务与 Next 已关闭。该版黑盒五个 exact owner 的容器/卷亦均为 0，精确路径活动进程扫描为空。

黑盒的八个已确认归属目录在保存原始 marker、BigInt identity、全树 inventory 与所需结果副本后，原生 PowerShell 清理批次被自动审批以 CreateProcess rejected: blocked by policy 拒绝。命令未启动，未执行删除；没有换 API 或拆分重试。这八根仍保留：

| 范围 | 绝对路径 |
| --- | --- |
| 最终 live | C:/Users/10208/AppData/Local/Temp/t17-d-live-C94XDQ |
| 最终 installed | C:/Users/10208/AppData/Local/Temp/t17-d-blackbox-dL4Teo |
| 最终 T15 | C:/Users/10208/AppData/Local/Temp/zhinexus-t15-installed-QQY7Hr |
| 最终 T16 | C:/Users/10208/AppData/Local/Temp/zhinexus-t16-installed-VF79Eb |
| 最终 T16 D recovery | C:/Users/10208/AppData/Local/Temp/t16-d-AqrLQT |
| SDK 错误探针 | C:/Users/10208/AppData/Local/Temp/t17-d-0022-redaction-AQSE8T |
| T15 服务配置 | D:/project/zhinexus-design-asset-platform/.tools/recovery/76181669-7754-4a5b-b831-d554a85cf8fb |
| T16 服务配置 | D:/project/zhinexus-design-asset-platform/.tools/recovery/ff069d9c-b890-487d-8dc3-3af7ff39662c |

本轮三处较早诊断目录及历史 0.0.21/T16/浏览器/pnpm 探针受阻现场继续保留，精确索引见 [黑盒保留项](t17-blackbox-0022-2026-11-20.md)、[0.0.21 回归](t17-cli-0021-regressions-2026-11-20.md)、[0.0.21 宿主](t17-host-0021-2026-11-20.md) 和 [集成记录](t17-integration-2026-11-20.md)。未重试历史被拒绝路径，也未删除旧失败证据；不能声称全部临时目录已经清除。

## 历史过程与独立开放事项

- 0.0.21 完整矩阵为正向 20/20、拒绝 12/13、exit 1。N10 请求夹具问题的原日志、seal 和归档保留，0.0.22 N10 独立诊断不用于补它的分数。
- 首次缺失 SDK 的根测/浏览器跳过或失败、此前工具链定位/冷代理超时、宿主证据留存与采集器失误，均在原日期记录保留；上述当前完整回归不改写旧结果。
- 原 P0 独立日志、最初实现 RED 的完整顺序和原始 stderr 空字节尚未追溯。[当前 C0](t17-c0-current-evidence-2026-11-20.md) 与 [官方访问更正](t17-c0-official-correction-2026-11-20.md) 仅补本日事实，不追认历史过程。最新修复的真实 RED/GREEN 独立记录于 [源快照](t17-repair-source-continuity-2026-11-20.md) 与 [SDK 错误脱敏](t17-mcp-sdk-redaction-2026-11-20.md)。
- 两个真实业务试点、T11/T12、公司 OIDC、生产独立预览域和完整生产 G2 仍单独开放，不属于本轮 temporary/synthetic 技术验收。
- 实际 Antigravity 先承担主开发，其 Gemini/Claude 渠道额度耗尽后由 Codex 接续，未开启付费 overages；各原始交付身份保留。

## 本轮关键聚焦提交

| 提交 | 目的与验证 |
| --- | --- |
| `10ca2957` | 异步DOM断言等待最小修复；有效真实Chromium RED后，聚焦52/52及既有browser case 1/1通过，独立Approved |
| `edb985ec` | 独立升级CLI至0.0.23并更新CHANGELOG；单次冻结后完成本文全部同包验收 |
| `7ec3a665` | 记录0.0.23双框架宿主、四条实际正向/修复链及清理前归档；完整入口1/1通过 |
| `33e5e13c` | 记录完整工程回归、零跳过与原日志独立复读；2210/2210、168/168、137/137、288/288通过 |
| `cc494f21` | 记录0.0.23独立CLI/MCP黑盒、T15/T16及十二新根清理；四配置49/49通过 |
| `011694e5` | 记录完整矩阵20/20+13/13、原件正式评分、59根字节归档与清理审计 |

当前分支为 feat/t17-integration；本轮没有执行 push、tag、合并或生产发布。原架构文件 SHA-256 保持 e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723。本轮“完成”仅指用户授权临时工程范围内的三期工具技术交付，不推断历史过程、真实业务试点或公司生产验收完成。
