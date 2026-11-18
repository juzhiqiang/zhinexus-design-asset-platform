# T16 产品独立审查与修复验收补充

日期：2026-11-18。新增补充记录，不改写已完成任务的历史验证。用户授权产品 GREEN 和技术验收通过后本地合 main；不 push/tag/生产发布，保留工作树和证据。

## 审查对象与可信范围

独立 reviewer `/root/review_t16_sync` 审查 `dec2f45bfea49058f8b05c231e6eee71a341a11f` 上 B05 的十个未提交 CLI 源文件。排序摘要清单 SHA-256 为 `a988e6828cc795cb8c14f78ad59f22e7fbd8ebdbe0cb343508ac6b7c2fa0d172`。这是 B05 快照标识，不能作为 B06–B08 或最终产品的审查证明。

结论：没有已证实 Critical；13 项 Important 阻断合并，没有单独 Minor。依据为 T16 设计和安装隔离 brief。reviewer 没有改文件、运行服务/套件、pack、提交或合并；其证据分为真实解析器/函数实测、仅内存文件系统接点、完整调用路径静态审查。C 随后在真实临时文件系统与独立 CLI 进程补 RED，不把静态判断冒充实际外目录写入、注入代码执行或真实凭据泄漏。

## 发现与本轮状态

| 项 | 发现、初始证据 | 截至 B08 的独立验收状态 |
| --- | --- | --- |
| 1 | 非目标 workspace 成员及父链未经真实身份复核；内存接点/静态 | C 的初始 junction 与物化期间置换 junction 两条 RED 在 B07 转 GREEN；断言外目录零写入。 |
| 2 | 安装未绑定已核验 SDK 身份、integrity、origin；静态 | 实际 package.name 错误而 version 正确的 RED 在 B08 转 GREEN；候选 integrity/origin 两条仍 RED。 |
| 3 | 安装失败和 context 部分创建失败遗留含 registry token 的配置；静态 | 物化失败、错版本、globalconfig EACCES 三条 RED 在 B08 转 GREEN。清理本身失败的更广泛恢复诚实度尚待补测，不能宣称覆盖所有故障出口。 |
| 4 | apply 临时写后覆盖新文件，rollback 分类后删除用户新编辑；内存接点 | C 两条真实窗口 RED 仍失败；已交实际 B09。要求可补窗口晚检查，不要求消除 OS 最后一条指令竞态。 |
| 5 | 不可信参数、计划未知字段、文件名进入 stdout/stderr；实测 | C 独立 CLI RED 在 B06 转 GREEN；只用 synthetic token。 |
| 6 | Vue layout 中关闭 script 标签截断 SFC；真实解析器 | B06 修复并通过真实 Vue 编译器断言。只证实修复编译边界，没有证明注入代码曾成功执行。 |
| 7 | 安装成功前未复核目标源码、清单和锁摘要；静态 | C 三条物化期间修改真实文件的 RED 仍失败。不能把安装前 afterHashes 当最终文件证据。 |
| 8 | sibling 清单六类禁止依赖协议仍进入安装；实测/静态 | C 对 file/git+https/link/portal/patch/workspace 六条 RED 仍失败，断言候选锁前阻断、无安装进程。 |
| 9 | 备份 root/operation/versions/latest 缺普通路径、链接/硬链接、独占边界；静态 | 版本 hardlink 和 versions 父 junction 两条真实 RED 仍失败；其他边界未覆盖，不能据两条代表整个发现。 |
| 10 | 安全旧 node_modules 的 quarantine、树守卫和逐目录副作用日志未实现；静态/范围缺口 | C 安全既有依赖树 RED 仍失败；逐目录 journal 还需补测。已批准承诺继续有效，不收缩为仅空目标目录。 |
| 11 | React 生成器缺客户端 directive，冻结 SDK 使用 hooks；静态 | 真实 Next/RSC 消费者验证尚未补齐；Vite 成功不能证明该边界。冻结 SDK 保持原字节。 |
| 12 | lstat EACCES/EIO 被当作 missing；内存接点 | C 两条真实目标 I/O 故障 RED 仍失败；已交 B09。ENOENT 控制组须继续有效。 |
| 13 | 合法可选 chart-color 透传生成非法 TSX/SFC；真实解析器 | C 新增双框架 RED，合法 API 与真实 replan 控制成立，但产品 applied 后编译失败。允许写入前 blocked+BINDING_UNSUPPORTED 且零副作用，或真正可编译。 |

## C 实际执行与证据

证据根：B+C 工作树 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/`。全部为开发 CLI；未 pack 最终 CLI。

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','build')
.\scripts\pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','typecheck')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-install-isolation.test.ts','-t','物化结果为|创建 globalconfig|package name','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/product-b08-four-green-01.json')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-apply.test.ts','tests/integration/project-install-isolation.test.ts','tests/integration/project-rollback.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/product-b08-review-full-01.json')
```

B08 build/typecheck exit 0，probe 73 文件无缺失、清单外、污染、链接或改动。四窄测 4 passed/0 failed/35 未选择，exit 0；完整产品 **117 collected/97 passed/20 failed/0 pending，exit 1**。完整结果包含新增 optional prop 两条；B07 的 115/93/22 与此口径不同，不能简单把新增测试当回归。相关日志为 `b08-{build,typecheck}-01.log`、上述 JSON 的同名 `.log`。

C RED 证据：`c-review-safety-red-01`、`c-review-write-recovery-red-02`、`c-review-install-end-red-01`、`c-review-install-input-backup-red-02`、`c-review-optional-prop-red-01` 的 JSON/log。早期夹具错误的 red01 不作为产品失败证据。C 审查测试窄 TS7 先前 exit 0，见 `c-review-tests-ts7-01.log`；本记录不把它当最终根类型检查。

D 首个完整修正版原始 stdout SHA-256 `2cd98932432d0428cb4ce7ef91eca780caae185d5489898b22c5bc4eef05369d`，源码 SHA-256 `63824ed39fa0aff40c9668ee9cbfe4f0c227b718fbef3a6b2ddc960ae3e6064b`。C 只提取 fenced 原文并补末尾 LF，落盘在 D 指定工作树 `tests/acceptance/t16-d/cli-required-arguments.test.mjs`。实际 `node --check` exit 0；固定 Node 26.13.0 设置 `T16_D_CLI_ENTRY` 为 B+C `packages/component-cli/dist/bin.js` 后 `node --test`：**1 passed/0 failed/0 skipped/0 todo，exit 0**，见 `d-required-arguments-dev-green-01.log`。该例验证缺 plan 拒绝、严格 JSON/exit 1、两 synthetic token 不回显、工程与 backup 根 lstat 类型/路径/原字节零变化，以及恶意 lifecycle marker 未执行。保留临时证据。缺授权安装成功控制、恢复和冻结消费者黑盒仍未完成。

## 尚未达到的合并门槛

20 条实质产品失败及未补审查边界继续交原作者修复。B09 已发送四条写入/恢复 RED，D 新增三个输入拒绝案例的文本任务已启动；交付不等于验收。最终需要完整独立 D、真实安装矩阵重跑、强制全图零缓存、根 typecheck/test 和受影响平台/浏览器验收，再升 CLI 版本、一次 pack 冻结并以同一 CLI/SDK 验收。未经这些结果不得合 main。

不要求跨多个目录原子事务、不触碰冻结 SDK 或原架构。缺真实授权 Vue/React 业务项目，因此技术验收即使通过，也不将完整 T16/T17 勾为完成。
