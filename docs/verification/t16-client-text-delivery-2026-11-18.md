# T16 实际客户端文本交付恢复记录

## 早期历史快照

以下保留首份文本补丁接收前的阶段记录；其中“最近”“当前”“本次”均指该早期检查点。实际最新结果与用户后续 GLM 授权见下方新增记录。

本记录补充已有恢复记录，不重写历史验证。B 仍为实际 Claude 桌面作者，D 仍为实际 Claude Code 作者，C 为 Codex 接收及验收方。产品最近已验证结果仍为 84 collected / 73 passed / 11 failed / 0 pending，exit 1；尚未升版、pack 或合 main。

B 的 `file_path` 提醒已真实进入对话。实际客户端成功读取 `install.ts`、`bindings.ts`，后续多次 Read 仍因缺少 `file_path` 参数失败。C 随后真实发送文本 unified diff 交付要求；B 正在回复，尚未接收或应用补丁。未读 `generate-react.ts` 时须请求原文，不能猜测。

D 默认渠道此前因工具调用无法解析结束，没有测试交付。当前恢复任务通过原生 Claude Code 可执行文件启动，参数为 `--print --output-format json --tools "" --max-turns 4`，不传模型覆盖、不改全局配置。C 将公开规则、契约、fixtures、交接 brief 与公开 README 原文通过 stdin 提供；未提供 B integration 产品实现。最终冻结 CLI 尚不存在，本次交付必须明确未执行测试。

接收规则：保存实际客户端完整原始输出和 SHA-256；只接收分配范围；校验当前字节上下文并在原作者停写后机械应用。失败或修正均退回原作者，C 不代写 B 产品或 D 测试。应用后的 build、测试与真实验收另行记录。原始提示、stdout、stderr 与启动 receipt 保留在 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/`，不将配置或凭据提交到 Git。

当前恢复不代表技术完成；真实项目门槛仍未满足，完整 T16/T17 保持未完成。不 push/tag/生产发布，不清理工作树或原始证据。

## 第一份 B 文本补丁与实际复验

B 首份原始回复 SHA-256 为 `78788e94aabe841a7d7e093f87fbf9b5036f323234faf64a742141e70c23403d`。C 机械应用 `install.ts` 与 `bindings.ts` 的两份 diff；安装 diff 原 hunk 计数不一致，仅用 `git apply --recount --check` 后 `--recount` 应用，未改写补丁内容。固定工具链 CLI build exit 0，内联 probe 73 文件复核通过，`git diff --check` 通过。

产品三份窄测最新为 **84 collected / 83 passed / 1 failed / 0 pending，exit 1**，证据 `product-b-glm-patch-01.{json,log}`。唯一失败为 `project-apply.test.ts:740` 的 React 完整 SDK API 内建类型、样式与可选 ref 透传：实际 `blocked / BINDING_UNSUPPORTED`，预期 `applied`。该结果补充此前 73/84 检查点，不能标为 GREEN。

B 第二份整文件回复只收到 11705 字符，截断在 `bindings.ts` layout regex，原始文本摘要为 `b7e2e1b2923b6a0a839de6da333ca0a6fa90cba44010d1ddaffdabbdd723dbab`，未应用。C 已真实退回 B，要求逐文件小份 diff，纠正 React 类型来源、ref 与 SDK handle 的公开导出建模；C 不代写 generator，既有断言保持。

B 第三份小 diff 已完整收到 8207 字符，原文摘要为 `fe27fccbcc0fda94761a5b766d66729fd5705c755aa284fcb067647e14361685`，作者明确未执行检查并停写。`git apply --recount --check` exit 1：首 hunk 将当前注释的句号误记为分号，其余八段旧上下文精确匹配，仍未应用。C 已真实退 B，请作者交更正的首段及 React generator；并逐字提供其余六个 SDK 子路径的真实 Handle 导出，避免按模式推定。安装条目定位证据已同时交 B，要求在随后安装修正轮处理。

## 仓外安装与交付层诊断

使用固定 Node/pnpm、既有冻结 SDK、开发 CLI build 和真实隔离服务执行：

```powershell
# 已设置 T16_CLI_ENTRY、A10_FROZEN_BUNDLE、INSTALLED_CLI_EVIDENCE
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t16-installed.config.ts','-t','vue-npm-standalone','--reporter=json','--outputFile','.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/installed-b-glm-patch-01-vue.json')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t16-installed.config.ts','-t','hostile|vue-(npm-workspace|pnpm-standalone|pnpm-workspace)','--reporter=json','--outputFile','.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/installed-b-glm-patch-01-vue-rest.json')
```

第一轮 1 passed / 0 failed / 11 未选择，exit 0，完成 Vue/npm standalone 安装、构建及迁移。第二轮 4 passed / 3 failed / 5 未选择，exit 1；四个 hostile 配置拒绝案例通过，Vue/npm workspace、Vue/pnpm standalone 和 workspace 都返回 `rolled-back / INSTALL_FAILED`。React 四矩阵本次未选择。CLI 子进程 exit 0 不能替代 `applied` 状态断言。

C 保留仓外 stage，并以产品导出的安装函数对官方公共 yaml 两版本进行独立诊断；不改产品、不使用 token、不模拟安装。固定 wrapper 执行 `exec tsx .superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c-install-stage-diagnosis.ts`，诊断进程 exit 0；三个案例均在成功生成候选锁和物化之后被 `planDelivery` 拒绝，错误代码为 `PATH_UNSAFE`，各目标逐文件摘要快照均未改变。这是失败定位证据，不是验收通过。

随后无跟随链接枚举确认：npm workspace 的 `node_modules/@diagnosis/client`、`@diagnosis/peer` 是分别指向已检查 `apps/client`、`apps/peer` 的成员链接；当前目录递归检查拒绝作用域内部链接。pnpm 两案例根目录均含单链接普通文件 `.modules.yaml` 与 `.pnpm-workspace-state-v1.json`，当前根条目策略拒绝。pnpm workspace 也含同样的作用域成员链接。两份 pnpm 元数据包含 stage/cache 绝对路径，不能未经裁定直接交付。具体条目与原始定位保存在 `c-install-stage-{diagnosis,entry-diagnosis}.json`；修正仍交 B，任意外部链接、硬链接和未知条目须保持失败关闭。

## D GLM 文件工具与分阶段文本交付

用户已授权 D 本次 GLM-5.3，取代此前默认模型重试安排，不改全局配置。真实 Claude Code 显式 GLM 文件工具任务于 `2026-11-18T11:33:34.991Z` 启动、`11:42:24.398Z` 结束，子进程 exit 1，`error_max_turns / 41 turns`，未交付测试。真实模型用量标识为 `GLM-5.3`，原始 stdout 摘要为 `5f046844cb57946f8c6bca0cb8a9c31a42ad5804212f25ed93e325d7e1ed7634`。本次专属会话多次 Read/Glob 缺必要参数；外层 runner exit 0 仅表示证据保存成功。

C 已启动新会话 `--print --output-format json --tools "" --max-turns 2 --model GLM-5.3`，只提供公开上下文；第一阶段仅请求 `tests/acceptance/t16-d/cli-boundaries.test.mjs` 的参数、坏 JSON、未知字段及 inspect 零写入黑盒。当前尚待完整原文输出；后续成功 apply、恢复、用户编辑保护及安装独立测试仍未覆盖。无最终冻结 CLI，不声称 D 已执行或完整验收通过。

## 第四份 React 补丁与产品窄测 GREEN

B 第四份原始文本摘要为 `8e317bef0f894cc47bb1338a50110293014f23ee291c1a727857c708a3fbb863`。作者明确授权把更正首 hunk 原样拼回第三份其余八个不变 hunk，并交付 `generate-react.ts` 小份 diff，声明未执行、交付后停写。C 机械提取、换行规范化并用 `git apply --recount --check` 复核两份补丁，exit 0；随后原样应用，没有改写产品逻辑。

固定工具链实际运行：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','build')
.\scripts\pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','typecheck')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-apply.test.ts','tests/integration/project-install-isolation.test.ts','tests/integration/project-rollback.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/product-b-glm-patch-04.json')
```

构建和 CLI typecheck 均 exit 0，内联 probe 73 文件复核通过。三份产品窄测 **84 collected / 84 passed / 0 failed / 0 pending，exit 0**；原 React 完整 SDK API 案例由 RED 转 GREEN。证据为 `b-glm-patch-04-{build,typecheck}.log` 和 `product-b-glm-patch-04.{json,log}`。这些结果只证明对应产品窄测；仓外真实生成源码编译、其余安装矩阵、D 独立黑盒及最终冻结 CLI 仍需验收。

C 已真实发送第五轮安装诊断及当前 `DeliveryAction` 至 `buildReadyTree` 原文，请 B 只交 `install.ts` 小份补丁；不放宽未知链接、硬链接或隐藏条目，pnpm 内部元数据不得直接携带 stage/cache 绝对路径进入目标。D 无工具第一阶段仍在等待原始输出，没有测试交付。

## C 文档复审范围

只读审查代理已核对本记录此前阶段及计划新增记录，与指定原始证据一致：无 Critical / Important；历史状态容易误读的 Minor 已通过新增“早期历史快照”说明和本次 GLM 授权措辞修正，无剩余确认问题。审查未运行产品测试、不覆盖 B/D 完整验收。此后第四轮的新增结果以本节列出的真实命令与 JSON 为依据，不扩大前述审查结论。

## 第五份 B 安装补丁与 D 文本重试检查点

实际 Claude 桌面第五份原文保留于 `b-glm-original-reply-05.md`，SHA-256 为 `c28eaa7883d61fc632d87a775396c8c72b12f599e6e48d17891f2d32cb7454d9`。正文末尾短句截断，但完整 fenced diff 和停写声明均已观察、保存。此份补丁使用 `--- a/...` / `+++ b/...`，未带 `diff --git`；C 依实际边界机械提取为 `b-glm-diff-05-install.patch`，仅统一 CRLF 为 LF，`git apply --recount --check` exit 0 后原样应用，不改写产品逻辑。

补丁把顶层和作用域 workspace junction 收敛到同一成员资格检查：realpath 必须精确匹配已检查成员，未知链接、暂存普通包目标和无法解析的链接失败关闭。普通包仍执行全树链接/硬链接检查；已检查成员的 scope junction 重建到目标工程。pnpm 的 `.modules.yaml` 和 `.pnpm-workspace-state-v1.json` 仅在确认为普通、非硬链接文件后省略，避免暂存/store/cache 绝对路径进入交付；未知根条目仍拒绝。交付依赖树不承诺可续用的包管理器增量状态，用户后续自行 install 重建元数据。作者未裁定 `.bin` 的陈述不构成豁免：真实矩阵包含 Vite bin 并检查 `.bin`。

实际命令（固定工具链，全部 exit 0）：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','build')
.\scripts\pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','typecheck')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-apply.test.ts','tests/integration/project-install-isolation.test.ts','tests/integration/project-rollback.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/product-b-glm-patch-05.json')
git diff --check
```

构建的契约内联 probe **73 文件复核通过**；产品窄测 **84 collected / 84 passed / 0 failed / 0 pending**。证据是 `b-glm-patch-05-{build,typecheck}.log`、`product-b-glm-patch-05.{json,log}`。另一个第四轮真实 React/npm standalone 单例已通过（`installed-b-glm-patch-04-react.{json,log}`：1 selected / 1 passed，11 未选择，exit 0），包括实际生成源码类型、构建和迁移后复验，不能视为全部 React 矩阵通过。

第五轮完整真实安装矩阵已启动，涵盖 Vue/React × npm/pnpm × standalone/workspace 八组和四个 hostile 配置案例。它使用当前开发 CLI、既有冻结 SDK 和真实隔离服务，证据前缀 `installed-b-glm-patch-05-full`；本检查点尚未收取最终 JSON，不能报告矩阵完成，也不替代最终冻结 CLI 的验收。

D 的旧无工具 GLM-5.3 文本任务（209510 bytes prompt）从 12:18:08.664Z 等到 12:46:22.994Z，28 分 14 秒仍无 stdout；C 核对专属 child/runner 父子身份后只结束该 child，runner 已保存 `d-glm-text-stage1-receipt.json`。child exit 4294967295、stdout 0 bytes、SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`，没有测试交付；不能据此推断网关根因。

D 随后在同一指定 worktree 用 GLM-5.3、`--tools ""`、`--max-turns 2` 和仅公开协议的 8658 bytes 小上下文于 12:47:28.327Z 开始重试。文件前缀为 `d-glm-text-stage1-small`，本检查点仍在运行。此轮仅请求独立参数、JSON、inspect 零写入与脚本/令牌隔离边界，不冒称成功 apply/rollback/安装已覆盖。小 prompt 的 rollback 引用描述不准确；后续必须提供真实公开参数 `--backup-id` / `--backup-sha256` / `--backup-root`，任何涉及错误参数的测试交回 D 修正。

产品只读审查已交既有 reviewer，并收到有效任务确认。当前产品 GREEN 不代表最终技术交付；完整矩阵、独立 D、全图/平台/浏览器、精确升版、一次冻结 pack 和同产物消费者仍未完成。本地主分支合并保持待验收通过；保留 worktrees 与原始证据，不 push/tag/生产发布。没有真实业务项目，完整 T16/T17 保持未完成。

## 第五轮完整真实安装矩阵收取

固定工具链实际执行以下命令（环境仅本进程设置）：

```powershell
$env:T16_CLI_ENTRY=Join-Path (Get-Location) 'packages/component-cli/dist/bin.js'
$env:A10_FROZEN_BUNDLE='D:\project\zhinexus-design-asset-platform\.tools\operations\current-sdk\881238b3-2214-4ec8-bf0c-af5238b7fcd3'
$env:INSTALLED_CLI_EVIDENCE='D:\project\zhinexus-design-asset-platform\.tools\sdk-label-acceptance-8929ffb81fcf4c90b98352c5f8afbed1\adopt\probe-evidence-adopt.json'
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t16-installed.config.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/installed-b-glm-patch-05-full.json')
```

最终 **12 collected / 12 passed / 0 failed / 0 pending，exit 0**。逐条核对 JSON：四个 npm/pnpm 的 hostile .npmrc/.pnpmfile.cjs 拒绝案例通过，八个 Vue/React × npm/pnpm × standalone/workspace 组合均完成真实安装、SDK 精确版本与路径复核、实际生成源码类型检查及 Vite 构建，工程目录迁移后再次类型检查和构建通过。包含 Vite .bin 检查、workspace peer 独立 yaml 版本及 npm scope 成员链接检查；脚本 poison 未执行，计划外原文件字节保持。

真实消费者证据保留在 `C:/Users/10208/AppData/Local/Temp/zhinexus-t16-installed-of4jeA`；隔离服务 ID `eaa63104-12fa-44ec-a638-5982836139a6`，报告/日志为 `installed-b-glm-patch-05-full.{json,log}`。原架构 SHA-256 再次核对不变。此轮使用开发构建 CLI，不能替代最终精确升版后一次冻结 CLI 的相同矩阵；D、审查和全量回归仍待验收。

## B06–B08 审查修复与 D 首例交付

新增补充，保留历史结果。B05 快照独立审查发现 13 项 Important，证据类别、后续 RED 和覆盖限制见 [产品审查记录](t16-product-review-2026-11-18.md)。B05 的 84/84 产品窄测与 12/12 开发 CLI 安装矩阵不能代表新增审查用例或最终冻结产物通过。

实际 Claude 桌面 B 第六、第七、第八份原文 SHA-256 分别为 `4e1792f90b1cc64e6021308bd600f77e3e5c74340dae5ab2809bb06b7f49c84e`、`0403bf1a0f36290baaffa112a6ac7671832b26246660cf43fb0226495092c240`、`a468741ce4a0d4d1eab37379a1b985355b85c7401ada1a813f5bc1fbe917251a`。C 保留原文，只按旧文唯一精确匹配、统一行尾和重算 hunk 头机械接收，没有改写产品正文。B08 普通 apply 检查未通过，两份补丁 `git apply --unidiff-zero --check` 均 exit 0 后以相同选项应用。

完整产品结果：B06 **97 collected/91 passed/6 failed/0 pending**、B07 **115/93/22/0**、B08 **117/97/20/0**，均 exit 1；用例增加来自 C 审查 RED。证据为 `product-b06-review-full`、`product-b07-review-full`、`product-b08-review-full-01` 的 JSON/log。B08 固定 CLI build/typecheck exit 0、probe 73 文件通过；安装配置清理/name 四条窄测 **4 passed/0 failed/35 未选择，exit 0**，见 `b08-{build,typecheck}-01.log`、`product-b08-four-green-01.{json,log}`。清理本身故障及其余异常出口仍待补测。

D 实际 Claude Code GLM-5.3 修正版会话从 `2026-11-18T13:43:05.668Z` 至 `13:46:50.079Z`，child exit 0、timedOut false、is_error false、success、num_turns 1。stdout SHA-256 `2cd98932432d0428cb4ce7ef91eca780caae185d5489898b22c5bc4eef05369d`。C 仅提取完整 fenced 原文并补末尾 LF，落盘 D 指定 worktree 的 `tests/acceptance/t16-d/cli-required-arguments.test.mjs`，源码 SHA-256 `63824ed39fa0aff40c9668ee9cbfe4f0c227b718fbef3a6b2ddc960ae3e6064b`。固定 Node 26.13.0 `node --check` exit 0；设置 `T16_D_CLI_ENTRY` 为 B+C 开发 CLI 后 `node --test` **1 passed/0 failed/0 skipped/0 todo，exit 0**。缺 plan 拒绝、严格单 JSON/exit 1、synthetic tokens 零回显、工程/backup 快照零变化和 lifecycle marker 未执行均通过。证据为 `d-required-arguments-dev-green-01.log`、`d-single-repair-source-receipt.json`；临时目录 `t16-d-cli-required-bBnezt` 保留。

B09 已真实发送四条写入/恢复 RED；D 三条输入拒绝任务于 `2026-11-18T13:52:33.230Z` 启动（`d-glm-input-matrix-01`，7078 bytes prompt，GLM-5.3、tools 空、max-turns 1）。本检查点尚无新交付，不报告通过。CLI 升版、一次冻结 pack、完整技术验收和本地 main 合并待通过；缺真实授权业务项目，完整 T16/T17 保持未完成。
