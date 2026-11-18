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
