# T16 D 冻结安装恢复独立验收

本记录追加于 `t16-technical-acceptance-2026-11-19.md`，保留 D27–D29 原始失败与未交付记录。实际 Claude Code GLM-5.3 为 D 唯一黑盒作者；C 只提供公共契约、真实服务、冻结材料、机械接收与执行，不改写 D 断言。B26 产品作者已停写。

## D30 辅助文件接收

- D30 使用 D29 同一 prompt，仅将当前子进程 `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 提高到 32000；不修改全局模型配置。
- UTC `2026-11-18T20:04:26.469Z`–`2026-11-18T20:10:46.600Z`，exit 0、success、1 turn，实际模型 GLM-5.3。
- 原始 NDJSON SHA-256 `2ac5e3027b9d9cdc48e3d5b6eb2e16e9a0cbedb33288c272fa98cc26da057501`；唯一完整 fenced 源码 96 行。只接收正文并补最终 LF，源码 SHA-256 `bad91a6ff41b8989638bbeae74e4a9c68f349ee4b164849830312a5dfb7ff045`。
- 作者明确授权接收 `tests/acceptance/t16-d/installed-support.mjs`，无工具子进程已退出。未提取 thinking 为源码。
- 独立静态审查 Critical 0 / Important 0 / Minor 1。baseline npm 使用白名单环境、两个普通空配置与独立 cache，凭据仅进入 CLI；三个生命周期脚本实际传入本轮绝对 marker；快照包含根目录和全部条目，拒链接、硬链接及非常规文件，仅 SOURCE 排除根 node_modules。
- Minor：超时或启动失败直接 reject，已捕获输出不会进入扫描、脱敏和证据持久化路径；没有直接输出原文，但诊断证据不完整。保留为非阻断问题，由 D 后续修正，C 不代改。
- 固定 Node 26.13.0 `--check tests/acceptance/t16-d/installed-support.mjs` exit 0。该结果只证明语法有效，尚不证明真实安装或恢复通过。

## D31 主控制待交付

D31 于 UTC `2026-11-18T20:15:16.711Z` 启动，实际 Claude Code GLM-5.3、无工具文本模式，7015 bytes 公共上下文；仅交 `cli-installed-recovery.test.mjs`。目标为真实 baseline npm、plan 零写、显式 apply 实际 SDK 安装、报告与磁盘摘要独立核对、冷 wrong-SHA 零写拒绝及有效 rollback 原字节恢复，并诚实保留 `reinstall-required` 与仍存在的 node_modules。

C 在发送前依据公开 help/契约纠正 brief：MatchPlan 使用 `context.framework` 和 elements，不存在顶层 matched 状态；公开 rollback 参数为 `--backup-id` / `--backup-sha256`；冷无效备份的单 JSON `EXECUTION_FAILED` 固定消息为 `受控应用执行失败`。C 初始启动器使用 Windows 绝对路径动态 import 失败，作者子进程尚未启动；随后直接执行已生成 runner，只有一次实际 D31 启动，失败日志保留。

真实安装主控制、可达的原字节/root/id/stale-ref 篡改控制、D 增量终审、本地 main 合并及 main 复验仍待完成。使用冻结 CLI 0.0.14 SHA-256 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`，严禁重 pack。完整 T16/T17 和真实授权业务项目仍开放。

## D31 超时与小文件拆分

D31 于 UTC `2026-11-18T20:25:16.840Z` 到达 600 秒上限，exitCode null、timedOut true、无 result。raw NDJSON 13965905 bytes，SHA-256 `89c900dca8f119531ffb9c8bc1a8fadac17bcfa7c4744d8deeb291b7bfb4c9a1`。两份完整 assistant message 均只有 thinking，另有未结束的 thinking 流；没有 fenced 测试正文，未接收、未执行。原始 evidence 和 receipt 保留。

D32 于 UTC `2026-11-18T20:26:26.866Z` 启动同一实际 Claude Code GLM-5.3，只交独立 `installed-start.mjs`（plan/apply/磁盘报告控制），后续备份与恢复由实际 D 另交模块。prompt 3162 bytes，本子进程输出上限 16000；不改全局配置、冻结产物或产品。C brief 明确真实变更枚举为 `lockfile-regeneration`，不采用上轮口语 `lockfile`。文件拆分只改变交付粒度，保留完整主控制与字段门槛。

已提交区间 `c067c81d..5d9961d2` 的独立全分支只读审查新增 Critical / Important / Minor 均 0。记录 `c-premerge-overall-readonly-review-2026-11-19.md` SHA-256 `b599cf46ea90c50df16ee05c1593474839e661d17065f8ea087e0a038308d0be`；未提交 D 增量、桥接实际 GREEN 及 main 复验不在该结论内。

## D32 brief 纠错与 D33

C 复读实际公共契约时发现 D32 brief 把 `installedVersions` 误写为 Record；真实字段为 `IntegrationDependency[]`，每项 `{name,version}`。C 于 UTC `2026-11-18T20:27:47.797Z` 主动停止尚无交付的 D32（exit 4294967295、无 result），未接收或改写测试源码。原 raw SHA-256 `6bd0fe0d17d17ad79d2baf75a68ac097f17c653b30b41372844b9f5c7317bf31`；不把 brief 错误计作产品 RED。

D33 于 UTC `2026-11-18T20:27:48.254Z` 启动，同一实际 Claude Code GLM-5.3，只纠正公共数组结构后继续 `installed-start.mjs` 小文件任务，prompt 3198 bytes；此进程是当前唯一 D 作者任务。C 已请求 reviewer 对当前可选指定测试路径桥接、文档和字段控制 brief 作增量只读复核。

## D33 输出上限诊断与 D34

D33 的会话证据显示两次完整 assistant message 都以 `max_tokens` 停止，均只有 thinking（66351 / 64833 chars），没有源码。C 于 UTC `2026-11-18T20:31:52.271Z` 停止重复消耗输出预算的进程；exit 4294967295、无 result，raw SHA-256 `95c26a1d1237c05c0b2ec78fb230bf8d1a41f9be16ade3644312342b5b2b8c18`。该结果不是产品测试失败。

依据实际 Claude Code `--help` 支持的 `--system-prompt`，D34 于 UTC `2026-11-18T20:31:52.714Z` 使用同一 GLM-5.3、同一已纠正 brief，以仅本子进程的简短作者 system prompt 替换默认长提示，输出上限 32000。所有 public 规范和职责约束仍在用户 brief 内；无工具模式、不改全局模型设置、不降低验收断言。D34 当前只交 start 模块；桥接 override 仅用于最终实际 D 的 `cli-installed-recovery.test.mjs` 主 runner，绝不把导出函数模块直接运行的 exit 0 当作安装恢复 GREEN。

## D34 仍仅 thinking 与 D35 拆分

D34 简短 per-run system prompt 没有解决 GLM 输出问题：UTC 20:36:31.771 完整 assistant 以 max_tokens 结束，仅 thinking 128786 chars；未交源码。C 于 UTC 2026-11-18T20:39:48.316Z 主动停止仍重复输出的实际子进程。exit 4294967295、无 result；raw SHA-256 f5bc4d68ea06926c75ba0c61664ba202f9fdf4fd949855124b4c5594428b2ba7，8348621 bytes。没有接收或执行 D34，不计产品 RED。

D35 保持同一实际 Claude Code GLM-5.3、无工具文本模式和单进程设置，只交约 35 行 installed-plan.mjs；安装 apply、报告、备份恢复与字段控制将由同一 D 后续独立模块承担。只改变交付粒度，未删减验收门槛，C 不代写任何黑盒断言。当前所有 D 辅助模块语法检查均不能代表真实安装恢复 GREEN；最终主 runner 必须实际调用各控制并执行通过后才可合 main。

## D35/D36 plan 原作者修正接收与 D37

D35 UTC 2026-11-18T20:40:21.073Z–20:44:31.084Z，exit 0、success、1 turn；raw SHA-256 6f297ebeed7ff0172ac5821548aeae16c4487d7bb760664310908d1fe6325adb。完整正文在静态核对发现 SOURCE 快照漏 excludeRootNodeModules:true 后先保留为 candidate，未执行。D36 UTC 20:46:09.764Z–20:46:49.732Z，exit 0、success、1 turn，原作者只更正唯一行；raw SHA-256 3e3880cd3586282e0c1c0f64683fe0b430fab40795337d37b80e7af0e0c739bf。

C 按两次唯一文件授权，将 D35 正文与 D36 唯一删/增行机械接收为 tests/acceptance/t16-d/installed-plan.mjs；source SHA-256 5be9c61b8f2de5834354a2864d076be3c33bbef1c4f2ac1fd26c25d77c328ad5。固定 Node --check exit 0，只证明语法。独立增量 reviewer 已接收检查请求。D37 于 UTC 20:47:50.660Z 启动，只交磁盘报告与实际安装版本检查模块；start 将调用 prepare/report，最终主 runner 调用 start 并执行备份恢复。所有真实 GREEN 与 main 合并门槛仍待完成。

## D37 超时与 D38–D41 继续细分

D37 于 UTC 2026-11-18T20:57:50.788Z 达到 600 秒上限，exitCode null、timedOut true、无 result。raw 5147460 bytes，SHA-256 `89e13d05f0b29b7b2a4fc464b56291f7dbfb62292ccdfa23c007f213744a2937`。未接收或执行，也不计为产品 RED。

D38 于 UTC 2026-11-18T20:58:23.032Z 启动，仅交约30行 start 模块。原 report 交付进一步分成真实磁盘差异、实际manifest版本与薄封装三个文件；所有断言仍由实际 D 编写，C只编制公共验收 brief，最终主 runner 必须实际调用完整链路。当前仅一个实际 D 子进程，不改全局模型配置或冻结产物。

## D38 路径修正与实际 MCP 隔离诊断

D38 UTC 20:58:23.032Z–21:02:47.023Z，exit0、success、1turn，raw SHA-256 `179626b1a0915d746b868bc88de54b5f733983f587ba491feeca4f6d3488d767`。完整正文在静态核对发现 Windows 归一行错误：字符串字面量匹配连续两个反斜杠，不能转换单个反斜杠。未执行候选，交原作者作唯一行修正。

D38a UTC 21:04:20.782Z–21:04:54.234Z，CLI exit0/success 但正文仅230chars且 ADD 行与代码围栏截断，没有完整授权；raw SHA-256 `922908ce240e667073b344ae012b0e669ba64552c80648b156a3c81074260ebd`。D38b UTC 21:05:48.904Z–21:08:47.937Z，exit1/error_max_turns，无 result 正文；raw SHA-256 `ed897f23ef15f1f76412a0d23da163cc0470149d90564413951a2944f56a0f0f`。均未接收，不计产品 RED。

D38b 的实际 assistant 记录含无参数的 `mcp__playwright__browser_run_code_unsafe` tool_use。C核对本机 Claude Code help：`--tools ""` 只关闭 built-in tools；必须使用 `--strict-mcp-config` 配合空 `--mcp-config` 才会忽略其他 MCP 配置。C保留原 runner，另建纯编排 `d-text-runner-strict-39plus.mjs`，D38c UTC21:09:58.130Z 使用相同GLM-5.3与同一短修正 brief启动；init 实证 `tools: []`。仅本子进程隔离，不改全局配置、不编写D断言。后续将使用此已验证的真正无工具编排继续原门槛。

独立 reviewer 对 D39–D41/D42–D44 brief 复核新增 C/I/M 均0；primary brief 的字段/摘要对象歧义已澄清，D30非阻断诊断持久化Minor1仍保留。当前还未运行完整安装恢复。

## D38 转义误诊更正与等价表达接收

上节“原字符串匹配连续两个反斜杠”的判断错误，原因是 C 将工具输出 JSON 转义误当作源码字节。独立读取原 result 并计算字符确认：字面量源码为两个反斜杠字符（92,92），运行时为一个反斜杠。D38 原行本来可以归一 Windows 路径；不是 D 缺陷，也不是产品 RED。本节追加纠正，保留全部原始尝试与前述历史诊断。

D38c 真正隔离 MCP 后 exit0/success，但 115chars 正文截断且变量错误，未接收；raw SHA-256 `8bc8633944881500fefa915bb043d1396095d663e8bd6eb4c4d32c1b6ea8faac`。D38d exit0/success，完整模块末尾仍截断，仅保留 final result 中完整唯一 projectRoot 断言行；raw SHA-256 `b11933c8cb11fdf9204a43194e3f88b11913d17c09f570f962be2674e3194df2`。D38e exit0/success，实际 D 明确授权将 D38d 唯一完整行拼回 D38 完整正文，其余原行不变；raw SHA-256 `c81d421e9f9ae1866e1bfd93df6f7240d42c22f7e38bbfe7fd55ea402076ac32`。

C 机械接收 `tests/acceptance/t16-d/installed-start.mjs`，1491 bytes、29 行，源码 SHA-256 `2fa93b7c2a8272c6aa694c9829dc4f5f1f1aa01f51300097f2d818cc117810c5`；receipt `d38-d38d-d38e-received.json`。新 charCode 表达与原行等价。固定 Node 26.13.0 --check exit0，仅证明语法，不代表安装恢复 GREEN。独立 reviewer 确认唯一行及授权逐字一致，新增 C/I/M0；追加原审查记录 SHA-256 `01904d1daef8efdfadd0d3849062bd32d2027d511c1df77e1e2a6cf4454821b3`。

D39 UTC `2026-11-18T21:17:47.408Z` 启动，实际 Claude Code GLM-5.3、严格空 MCP 配置，init `tools: []`；仅交磁盘报告差异模块。完整真实验收与 main 合并仍待完成。

## D39 完整正文接收与 D40

D39 于 UTC `2026-11-18T21:24:24.285Z` 结束，exit0/success、2 turns，raw 3288623 bytes、SHA-256 `c7a94a10b9eed991c7961682fd91b22a53615be7242706c30f301f7251579a28`。final result 的边界说明末尾截断，但唯一 fenced 模块和开头接收/未执行/停写声明完整，C 只接收该正文模块。`installed-report-files.mjs` 2210 bytes、源码 SHA-256 `148c0d8811568109c0034a9b6d0037895d4d46e835699c42c4cc00d436ceca60`，receipt `d-glm-installed-report-files-39-received.json`。固定 Node --check exit0；SOURCE/BACKUP 快照及独立真实字节差异断言已交增量审查，尚未运行真实安装。

D40 UTC `2026-11-18T21:24:52.783Z` 启动，同一实际 D、严格空 MCP 配置，init tools为空，只交真实 manifest/生成 Vue 文件核验。完整主 runner 与四字段控制仍待交付。

## D39 独立审查返修与 D40 接收

独立静态审查发现 D39 Important1：期望 hashes 由已排序 diff 生成，但报告 beforeHashes/afterHashes 未排序即按索引比较；公共契约不承诺字典顺序，B 真实写入顺序先组件后 manifest/lockfile。另 Minor1：只挑 path/exists/sha256 字段并使用 sha256??null，不能拒绝不存在条目带 null 摘要或额外字段。未运行该模块，不计产品 RED；两项均交原 D 修正，C 不代写断言。D30 原诊断证据持久化 Minor1 保留。

D40 UTC `2026-11-18T21:24:52.783Z`–`2026-11-18T21:26:30.724Z`，exit0/success、1turn，raw SHA-256 `26dabb9bc98cb2dd47a37be5994c9844480f5338a53f32167c91c1ea1ce700ed`。边界说明末尾截断，但完整唯一 fenced 模块及开头接收/未执行/停写授权成立。源码 2069 bytes，SHA-256 `d37badaf03d5a898df4b5f7d08059df74a0dfdd4734ea7e64beebbb97afebb9f`；receipt `d-glm-installed-report-versions-40-received.json`。固定 Node --check exit0，reviewer 新增 C/I/M0，尚未执行安装验收。

D42 UTC `2026-11-18T21:27:25.341Z` 启动，实际 D 继续备份磁盘文档校验。C 将原 D41/D44/D48 薄封装合为一个作者批次，并携 D39 原源码作排序/完整深等返修上下文。最终主 runner 顺序调用 start→backup→四字段→recovery，全部原门槛保留；原单文件 briefs 不删除。新增批次 brief `d41w-three-wrappers-brief.txt` SHA-256 `9347f1aa0f11cb10442d5fc1cf6353936e66f9948880c6bf8a5f159dffd6f058`。

## D42 候选返修与 D41w 批次

D42 于 UTC `2026-11-18T21:31:19.962Z` 结束，exit0/success、1turn，raw SHA-256 `5023dc16acf19284242b200e4cfa1e645bccba85d0ed5129103625cc5f6614dc`。完整正文与接收授权成立，但未接收或执行。C 与独立 reviewer 确认 Important2：版本文件名漏 `backup-` 前缀；仅排序 doc.files 路径，直接比较未约定排序的 plan.allowedPaths。两项均违反原公共 brief，会误拒绝正常 fixture；交原作者作两行返修，不计产品 RED。其余备份断言新增问题 0。

D41w 于 UTC `2026-11-18T21:33:37.206Z` 启动，唯一实际 D 作者、GLM-5.3，init `tools: []`。此批只交 report/fields/主 runner 三个薄封装以及 D39 原作者排序与完整对象深等修正。批次 runner SHA-256 `367bc4d95421bef4923950890486d1e4a1916c5087977f115bf7dd8b5d06c1e9`，独立审查新增 C/I/M0。C 为四个完整 final-result 围栏编制两阶段机械接收器：先保留原 D39 和候选，人工及独立审查后才接收；只归一 CRLF 与最终 LF，不改写断言。尚未完成最终真实安装恢复或本地 main 合并。

## D41w 实收与 D42a 两行修正

D41w 于 UTC `2026-11-18T21:36:26.298Z` 结束，exit0/success、1turn，raw SHA-256 `0e984fa4263620bb5ff24f08eb92e12d4fdb36b1318bc275fdc1c0507cc8c8b9`。完整 final result 四个围栏与接收授权成立；C 先 stage、独立审查后再原字节接收。四文件固定 Node 26.13.0 `--check` 均 exit0，仅证明语法。

| 实收文件 | 源码 SHA-256 |
| --- | --- |
| installed-report.mjs | b2987d6ef3d97837b2dc384e774dceb532379f830a54c7cb412fcaddf9c80472 |
| installed-fields.mjs | 9a04ac98aa3100afaedd6e95520c0900fe9cd464d8974ed4c9d3059a2f15388a |
| cli-installed-recovery.test.mjs | 8ceaf3afe3b829f10664dc4007b33b573466d36480b2ea3d9505f6aa383f79e5 |
| installed-report-files.mjs | c98da9425d43901c1f655c371854e298b11e7268bce7b168d941e4727ef4598f |

D39 Important1/Minor1 已在实收关闭：原作者只增加 deepStrictEqual 导入及按 path 排序的完整报告对象深等。新 runner Minor1 为日志输出源码路径，未输出真实临时 area/evidence；保留为非阻断诊断问题，不能据其推断安装通过。D30 诊断持久化 Minor1 仍开放。

D42a UTC `2026-11-18T21:36:51.142Z`–`2026-11-18T21:38:28.583Z`，exit0/success、1turn，raw SHA-256 `96149100b2eb29fe03eba81dfe72ad2f38a565452fac317509cdb884112b755b`。C 从原 D42 完整正文与 D42a 两组唯一 REMOVE/ADD 原作者补丁 stage；reviewer 确认仅替换第16/30行，新增 C/I/M0，原两项 Important 关闭。审定候选已机械接收 `installed-backup.mjs`，3160 bytes，SHA-256 `5721e738ab1f0dbcdc803603ba1e0bfa6592f139d18bee0912cee2c84204e302`；固定 Node `--check` exit0，仅证明语法。

## D43 与最后字段交付批次

D43 UTC `2026-11-18T21:38:54.355Z` 启动，同一实际 Claude Code GLM-5.3、严格空 MCP 配置，init `tools: []`；唯一作者进程，只交 wrong-SHA 冷拒绝与有效 rollback 原字节恢复模块。记录时尚未交付。

最后字段批次 brief `d45f-field-batch-brief.txt` SHA-256 `b32e4a66d16911536e669fed7bde388253cb7fe080d370c60fe05bf033c01a11`，6189 bytes，逐字保留原45/46/47三份全文，只合并交付批次；独立审查新增 C/I/M0。必须由实际 D 交 tamper/cases/stale 三模块，保持真实 SHA 命名 version/latest、单字段独立深等、SOURCE/整个 BACKUP/foreignRoot 零写、精确恢复 latest 与 move 自建版本、真实旧不可变 version stale gate。记录时尚未启动，真实安装 GREEN 与本地 main 合并仍待完成。

本轮增量审查沿用 `c-d-bridge-current-review-2026-11-19.md`，UTC 本轮结论文件76914 bytes、LF/无BOM，SHA-256 `4694d72006ecb7d6a517a836cb5e9b921884084d096408030c48dd7c247c82aa`。该摘要仅对应本次读回边界，后续追加保留旧结论。完整 T16/T17 和真实业务 G2 仍开放。

## D43 超时、D45f 拒收与单文件继续

D43 UTC `2026-11-18T21:48:54.437Z` 达到600秒上限，exitCode null/timedOut true/无 result，raw 5929952 bytes，SHA-256 `ea072f7230b37719795091b9286eeed00996498c6e25f17cd6ed435a3efa9c65`。完整 assistant 仅 thinking，没有测试正文，未接收或执行；不计产品 RED。

D45f UTC `2026-11-18T21:49:16.345Z`–`2026-11-18T21:49:34.574Z`，exit0/success、1turn、init tools为空；raw SHA-256 `fb6503f57d79355056b23df2822f99217987352788d971397dce1bfc0bf9c35f`。final result 只有676 chars的六个 PowerShell 查找命令，无任何指定模块和接收授权，未接收且没有执行这些命令。进程 exit0 不是测试交付或 GREEN。

D45 UTC `2026-11-18T21:51:39.394Z` 使用原已审单文件 brief 启动，同一实际 D、同一 GLM-5.3和严格空MCP配置，只交 `installed-field-tamper.mjs`，为当前唯一作者进程。恢复43原门槛将分为 cold/result/source及实际D薄wrapper四文件，公共 brief 待独立复核；C不代写断言、不改变冻结材料或全局模型。

## D45 无源码拒收与 D46 直接文本交付

D45 于 UTC `2026-11-18T21:59:00.983Z` 结束，exit0/success、3 turns、init `tools: []`，raw SHA-256 `82ff50a9251dbb699ff01a1adc3f5a64161cd8910ca38cf2204d085ba1adcd4f`。final result 只有38字符的仓库发现说明，没有任何 JavaScript 模块或接收授权；C 未 stage、接收或执行，不能计作产品 RED 或 GREEN。

原43拆为 cold/result/source/wrapper 四份公共 brief 已独立审查通过，全部原门槛保留；新增纯编排 `d-text-runner-strict-direct-49.mjs` 也已独立审查通过，SHA-256 `3575fcaa372d07d4c80b8e1aa1cfadfc3997a324c23bcf05a67adc0836def2ee`。唯一改动是强调全部公开输入已提供、直接返回源码、禁止返回发现命令；模型、空工具、严格空 MCP、局部 settings 与证据流程不变。

D46 于 UTC `2026-11-18T22:01:24.957Z` 使用 direct49 和原已审 `d46-field-cases-brief.txt` 启动，为本轮唯一实际 D 作者进程。尚未得到最终交付，冻结安装、恢复 GREEN 和本地 main 合并继续保持待完成。

## D46 完整候选与 D50 局部 safe-mode

D46 于 UTC `2026-11-18T22:05:58.711Z` 结束，exit0/success、1 turn、init `tools: []`，raw 3613823 bytes，SHA-256 `e8ed5d744f69efa8f979df25047c893ebc0a5c3c9562b0f787a6872ef00272a2`。完整唯一 JavaScript 围栏及接收/未执行/停写授权已读，C 两阶段接收器仅 stage `installed-field-cases.mjs`，2658 bytes，源码 SHA-256 `b9fc8aed83b96da6ed228b2bcc1834c83d1608c59e484a1b464cc2969d7e5da6`；独立审查进行中，尚未接收或运行。

C 只读核对实际 Claude Code `--help` 支持 `--safe-mode`，并保留原 runner，新增已独立静态审查的 `d-text-runner-strict-safe-50.mjs`（SHA-256 `d4541818aff7b91137c8b92eb6afe2b35f2511b70fa5cd3916e24e956b76be49`）：严格仅在 direct49 参数首位增加该开关；模型、指定 cwd、空工具、严格空 MCP、局部 settings、证据流程不变。六份 safe briefs 只加共同约束前缀，原门槛全文保留。该局部模式用于排除定制入口与无工具文本作者流程的张力；尚不能证明仓库入口曾自动加载或构成失败原因。

D50 于 UTC `2026-11-18T22:08:29.109Z` 启动，为当前唯一实际 Claude Code GLM-5.3 作者，init 实证 `tools: []`；仅交 tamper helper。源码及后续真实安装/恢复验收仍待完成，进程成功或语法检查不计 GREEN。保留全部失败记录、冻结 tarball 与 worktree，完整 T16/T17 和生产 G2 保持开放。

## D46 接收与 D50 候选返修

D46 独立审查新增 C/I/M0，审查记录本次 SHA-256 `8233b428f959b7e4fe6df5cf88b4067b6b38250920b1fd2b29bd8974ef528016`。C 原字节接收上述候选，固定 Node 26.13.0 `--check` exit0，仅语法通过；helper 的 verify 回调必须取得深拷贝，避免回调还原用于实际篡改的文档。

D50 UTC `2026-11-18T22:08:29.109Z`–`2026-11-18T22:10:51.727Z`，exit0/success、1 turn、init tools为空；raw SHA-256 `c6f1af8e03c524321fb2e66bb5a6b541a42ba69ba49dd0bbaa37f89f4181d1bc`。完整候选 3313 bytes、SHA-256 `24154df17dd0bf7b802b4fc0fd6fe049e3126381a7098e1b717a52298d01b893`，仅 stage，未接收或执行。C 静态发现两个 Important：async 快照与 CLI 调用缺 await；第一次 verify 会还原 mod，撤销即将写盘的篡改。两项交原作者修正，不计产品 RED。

修正 brief `d51-tamper-repair-brief.txt` 保留 D50 完整正文及原 public brief，仅前附上述诊断和原作者修正范围，SHA-256 `7f4460e13838d93c4241e83c69acc9caacf98b3c8bebdfab9b973fd11cbc1e7b`，待独立审查。D47 使用此前已审 stale safe brief 接续唯一实际 D 作者，真实旧不可变版本与 SOURCE/整个 BACKUP 冷拒绝零写门槛不变。

## D47 接收拒绝与原作者返修

D47 UTC `2026-11-18T22:12:20.416Z`–`2026-11-18T22:19:29.285Z`，exit0/success、实际2 turns、init tools为空；raw SHA-256 `5661e07558070f54815cc848c2bb465dec2246093a0daac6bd344d7cc9453ab2`。完整围栏存在，但接收器因声明缺完整授权拒绝 stage，未接收或执行。C 静态发现实际 public 接口错误：把 active version 文件路径当作目录遍历；SOURCE 快照使用不支持的 exclude 选项；CLI 结果读取不存在的 fullJSON 字段；receipt 写入源码侧 evidence 而非 s.evidence。全部交同一 D 原作者修正，不计产品 RED。

D51 于 UTC `2026-11-18T22:20:16.140Z` 使用独立审定返修 brief 启动，唯一实际 D 作者。原43四模块另备完整批次 brief 和专用四围栏 runner 待独立审查；原 cold/result/source/wrapper 门槛全文保留，尚未执行最终真实恢复验收。

## D51 完整返修与 D52/D53 编排

D51 UTC `2026-11-18T22:20:16.140Z`–`2026-11-18T22:22:49.318Z`，exit0/success、1 turn；raw SHA-256 `f37850962c3b2405673a460de96526d88a5849489024ecd94c9691a50263ff2a`。完整 final 及授权成立，先 stage `installed-field-tamper.mjs`，3645 bytes、SHA-256 `e44d419c74afcf781deccd469f0bbbd78b6668a494efd00d1703ca0371075b83`，独立审查中，尚未接收或执行。

D52 四模块批次 brief 和专用 runner 均已独立审查，新增 C/I/M0；分别 SHA-256 `ba36d403560989612bc3baf64ddf212d9bd7da95654dc1503dd66663f1c6f2f9` / `18fa692b3a4f9b5933553e930ddea56f7a7c5fbfbed0a93ccecba1d80fa64353`。UTC `2026-11-18T22:24:02.887Z` 启动唯一实际 D GLM-5.3 作者进程，init `tools: []`。四份 public briefs 原门槛全文保留；尚未交付或运行。

D53 返修 brief SHA-256 `0dd33d20ed914418de05d37aa71de4abf92a3d232159d3a9fbcfa2baa5d77fd8`，仅前附 D47 四项 public 接口诊断及授权要求，原作者 final 和原 brief 全文保留。独立 reviewer 确认编排 C/I/M0，未预批准未来源码；D53 尚未启动。

C 为两个原 detached worktree 创建保留分支 `feat/t16-safe-apply-final` 和 `chore/t16-installed-blackbox-final`，保留全部现有修改。main 仍为 clean `c067c81d2751b1d7cf9a04e7c15b6d7d276d014d`，尚未合并。
D51 已按独立审查记录 SHA-256 `757dd11dce01a41d420cffc9b891b629a4a6d4c616a401ae0557fe721e22c914` 原字节接收，固定 Node `--check` exit0。原 D50 两项 Important 在此修正版关闭。C 桥接新增文件使用 `scripts/pnpm.ps1 exec tsc -p tsconfig.json --noEmit` exit0，日志 `c-d-final-bridge-typecheck.log`；此为类型检查，不计安装 GREEN。

D52 UTC `2026-11-18T22:24:02.887Z`–`2026-11-18T22:29:08.638Z`，exit0/success、1 turn；raw SHA-256 `ef8a5672a820abf162677ed9a0f5a732f7c0f8dafd49ad8ca3c6cef221b1cea6`。四份完整 final 围栏和逐文件授权成立，cold/result/source/wrapper 候选已 stage，尚未接收或运行，独立审查中。D53 于 UTC `2026-11-18T22:29:39.544Z` 作为唯一实际作者串行启动；GLM-5.3 与指定 D worktree 不变。
## D52 接收、D53/D54 授权拒收

D52 四模块（cold/result/source/wrapper）已按实际独立审查记录 SHA-256 `a963d087ac1498f4d7590399d7d64911cded19667d93446857acda794948e830` 原字节接收，四次固定 Node 26.13.0 `--check` 均 exit 0；此时仍未执行真实安装恢复黑盒。

D53 UTC `2026-11-18T22:29:39.544Z`–`2026-11-18T22:31:39.233Z`，exit 0/success、1 turn、init tools为空；raw SHA-256 `490cfce8a143c1044446e00a84620d791b6ebdf3552343ad77cbe286a9d08365`。完整原源码 4071 bytes、SHA-256 `e3ea534a71c240d67aeda03877d19a8d7935e17ef3be00f9d82b2537e3fb605e`，四项 public 接口返修通过独立静态 C/I/M0；final 缺显式“授权”，接收器拒绝 stage，没有写入候选或目标。

D54 仅补原 D53 摘要绑定收据，编排经独立审查 C/I/M0。实际 UTC `2026-11-18T22:36:56.212Z`–`2026-11-18T22:37:16.386Z`，exit 0/success、1 turn、init tools为空；raw SHA-256 `9b9fa438a380b70efa22fb4b9b8cbe12ac7ec30f60e9d8fbd1b3f513d38865bd`。final 再缺“授权”，两阶段接收器 stage exit 1，仍未写入或执行。下一份 D55 brief 仅请求一句明确绑定原源码摘要的授权；不重新生成原断言，不降低接收门槛。

## D55 拒收与 D56 原摘要授权接收

D55 raw SHA-256 `bbac56d1da026db022256a87caca554a72f90a02a1df6f486635af63f22c108c`。原 assistant text、流 delta 与 result 均缺明确授权，stage exit 1，未写候选或目标。行首文字可能由渠道丢失只是诊断假设，C 没有补造授权或测试正文。

D56 使用 receipt-only runner54，UTC `2026-11-18T22:41:42.334Z`–`2026-11-18T22:42:16.844Z`，exit 0/success、1 turn、init tools为空；brief SHA-256 `654798c69d87a945ee772f23cd8911946eab6f9293de6ca8c351ec5587f170b4`，raw SHA-256 `e42c19749b4bcd4a9fa9175d015f0397de413d10841785f8c76473d27956dd4c`。实际 final 的完整主句明确授权 C 机械接收原 D53 全文，并绑定文件、完整源码 SHA、未执行与停写声明；末尾残句不影响已完整成立的授权。

专用 `c-receive-d53-receipt56.mjs` stage/accept 均 exit 0；独立 reviewer 核对原 D53 4071 bytes、候选与目标逐字节一致，只归一 CRLF 与末 LF，新增 C/I/M0。接收时审查记录 `c-d-bridge-current-review-2026-11-19.md` 153734 bytes、SHA-256 `9d89cfb972c7291e704ce6d9a9f2fb1829a6e357a2bb22ed22b4289feee5f9f8`。receipt `d53-d56-received.json` 绑定 D53 result SHA `eb1fd5e67500456f311ace45c574b6a09e9eeea882af6c19242779d260b17b1f` 与 D56 result SHA `b08c13546fd65cb909d16ae311395f00e832dda4fd6993e3d8aa3303a79f5838`。最终 `installed-stale.mjs` 固定 Node `--check` exit 0；该步骤仅证明语法。16 个模块至此均为实际 D 交付，C 不代写断言。

## 实际冻结 CLI 安装恢复 GREEN

通过 B/C worktree 的 `scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t16-installed.config.ts','-t','D independently verifies installed frozen CLI installation and recovery','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/cli-0014-d-installed-01.json')`，设置同一 `PHASE3_CLI_TARBALL`、`A10_FROZEN_BUNDLE`、`INSTALLED_CLI_EVIDENCE`，并由 `T16_D_TEST_FILE` 指向指定 D worktree 的真实主 runner。最终进程 exit 0；Vitest 14 collected / 1 passed / 0 failed / 13 unselected。没有把未选择的消费者矩阵计作本轮通过。

随机真实 PostgreSQL/Verdaccio/MinIO 隔离服务 ID `c9692e53-c49f-4717-b2c7-58ac697c5607`。仓外 `zhinexus-t16-installed-aIvqa2` 实际安装 CLI `0.0.14`，经 `node_modules/@company/component-cli/dist/bin.js` 执行 D 的 `node --test`：1 passed / 0 failed / 0 skipped / 0 todo、code 0、stderr 空。stdout 明确完成 start → checkBackup → checkFields（fields 与 stale）→ checkRecovery 四段。

实际 D 工程与证据位于仓外 `t16-d-xdG6GV`。测试覆盖真实 npm 基线与受控安装、禁生命周期脚本、真实报告及磁盘差异、版本与备份原字节核对；originalBase64、projectRoot、operationId 的独立字段篡改，以及真实旧不可变 version 的冷 stale-ref 均受控拒绝，SOURCE、整个 BACKUP 和异项目目录保持零写。wrong-SHA 冷恢复拒绝后，有效恢复返回正确状态，源文件原字节恢复、生成文件消失，node_modules 保留并报告 reinstall-required。此控制不声称运行时竞态；用户后续编辑保护另由既有 D26 黑盒和产品回归覆盖。

| 原始证据 | SHA-256 |
| --- | --- |
| `cli-0014-d-installed-01.json` | `4f5dfb09586223cea80bc2d19d9f88ad6dba863fcfeb8ab9903bb4794b9eaf8c` |
| `zhinexus-t16-installed-aIvqa2/d-installed-recovery-process.json` | `159a7bada8f423c98ffa1493373cbc880969394b2b8015cb21ffadd55cfe60fb` |
| `t16-d-xdG6GV/evidence/installed-stale-apply-06838ca37a30a31da2eccdc0.json` | `d0427eeed0c44d19da1839db867efa730b1448cf8844930f84b9c38f6ce3f11f` |

同一冻结 CLI tarball SHA-256 实查仍为 `94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`，没有重新 pack；原架构 SHA-256 仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。本次结果为本机真实服务和 synthetic 工程技术证据，`productionAcceptance: false`。最终全树审查、本地 main 合并和 main 复验仍待后续记录；完整 T16/T17、真实授权业务项目与生产 G2 保持开放。D30 诊断持久化及主 runner 源码路径日志两项非阻断 Minor 保留，不改写历史结论。

## D 增量终审与聚焦提交

最终 D/C 增量独立审查新增 Critical/Important/Minor 均 0；16 个模块与作者来源摘要一致，11 份保留候选与目标全文一致，四段实际 await 与原始 GREEN 证据一致。审查记录此时 165094 bytes、SHA-256 `15e666bdbebf4cc6cb9fe700a5b3881c2d33dcf9f1242ee9dea249ec7ef63445`，后续新增审查不改写本时点结论。实际命令事后索引 `cli-0014-d-installed-01.command-index.json` SHA-256 `46700ca644b70890cabb5ce2cb350b2310cbfc4d88b1acc27b7d6756d7b4f13f`，明确标记 `post-run-index-of-actual-command`，不能当作原始执行 receipt。

16 模块在 D 保留分支提交 `9bca63fd`，原样 cherry-pick 到 B/C 为 `11659bca`；C 真实服务桥接单独提交 `b20921b9`。提交前固定 Node `--check` 16 次、暂存 diff check 均 exit 0；实查全部 index/worktree 均 LF，未改作者断言。最终根回归已实际通过 Vitest 1753/1753、T10 168/168；本地 main 合并与默认 D 文件路径复验另行记录。
