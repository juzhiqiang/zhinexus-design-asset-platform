# A / B / D 合并与历史工作树清理

日期：2026-11-16。负责人：C（Codex）。用户已明确授权按 A → B → D 合并，并在合并后删除历史工作分区。本记录追加本轮实际结果，不改写历史验收证据。

## 合并范围与审查

主仓库：`D:/project/zhinexus-design-asset-platform`，分支 `feat/t13-c-matching`。起点为 `b13c8aee7c248c5b4a24ae7322bb865e87e3c84c`。

| 来源 | 已批准来源 HEAD | 合并提交 |
| --- | --- | --- |
| A | `60a023737c2a08c269a4539f70b0a6f06d14520d` | `0bdc450d1c7db8dcd21b5bd6964cc0d416f7b7f3` |
| B | `cb7406c2a9396877089499d2880f4522f836cb53` | `4ff9ef8ec333839e075d3af3db3b890f299305d2` |
| D | `7bbb769805c104ffc415a9965180adbcd40d15d4` | `9bc73d42cecfe4920f5c90a93e776ad1a7e0d988` |

A 自动合并；B 的 CHANGELOG 冲突保留 SDK Vue/React 0.0.11 与 CLI 0.0.10 两节；D 的 README 冲突保留 A、D 说明及已有 B 说明。D 的 `design-cases.json` 与 runner 对齐，A 的评估器及 `id-matching-boundary.test.ts` 保留。没有变更 contracts、API、preview-gateway、根配置或锁文件。

独立只读审查逐文件核对来源 blob、合并父提交、版本记录及文件所有权，未发现本轮合并引入的阻断性问题。后续测试夹具调整亦经只读复核，范围为 test-only；原错版、摘要篡改、缺包和另一框架错版反例保留。

导入文件原有 EOF 空行保留：`a-t13-id-eval-2026-11-16.md`、`b-t13-match-ui-2026-11-16.md`、`d-t13-eval-gaps-2026-11-16.md` 及 `id-matching-boundary.test.ts`。A/B 合并暂存检查使用 `git -c core.whitespace=-blank-at-eof diff --cached --check`，未发现其他空白问题；不将普通 `git diff --check` 描述为零告警。

## 验证环境与实际执行

全部工作区命令使用 `.\scripts\pnpm.ps1`，Node 26.13.0、pnpm 12.18.0。完整构建和类型检查使用 `--force`，没有以 Turbo 缓存命中替代实际验证。原始日志保留在主仓库 `.tools/`。

T10 测试使用以下既有严格冻结目录，未重新打包它：

```powershell
$env:A10_FROZEN_BUNDLE = 'D:\project\zhinexus-design-asset-platform\.tools\operations\next-sdk-handoff-zQIRda'
$env:ZHINEXUS_SDK_BUNDLE_DIR = $env:A10_FROZEN_BUNDLE
$env:NEXT_PUBLIC_SITE_URL = 'https://gallery.test'
```

| 命令（均以 `.\scripts\pnpm.ps1` 为前缀） | 实际结果 | 日志名（`.tools/` 下） |
| --- | --- | --- |
| `install --frozen-lockfile` | 通过 | `merge-full-install-20261116.log` |
| `verify:workspace` | 通过，10 成员及服务端依赖边界 | `merge-full-workspace-20261116.log` |
| `exec turbo run build --force` | 10/10，0 cached，17.467 秒 | `merge-full-build-20261116.log` |
| `exec turbo run typecheck --force` | 14/14，0 cached，3.864 秒 | `merge-full-typecheck-20261116.log` |
| `exec tsc -p tsconfig.json --noEmit` | 合并后及夹具调整后均通过 | `merge-full-root-tsc-20261116.log`、`merge-full-root-tsc-fixture-20261116.log` |
| `test:t10`（A 合并后） | 168/168，0 skipped | `merge-a-t10-20261116.log` |
| `exec vitest run tests/unit/sdk-lifecycle.test.ts tests/evaluation/id-matching-boundary.test.ts`（串行重跑） | 2 文件、10/10 | `merge-a-vitest-serial-20261116.log` |
| B 的 CLI 防篡改、验收链、基线与网页上传专项（下列 7 文件） | 7 文件、70/70 | `merge-b-vitest-20261116.log` |
| `exec vitest run tests/evaluation` | 6 文件、71/71 | `merge-d-evaluation-20261116.log` |
| `exec vitest run tests/integration/compatibility-api.test.ts`（夹具修正） | 1/1，38.76 秒 | `merge-compat-fixture-green-20261116.log` |
| `test`（夹具修正后） | T10 168/168、0 skipped；Vitest 69 文件、1107/1107，218.89 秒 | `merge-full-test-fixture-20261116.log` |
| `test:browser` | 260/260，1.2 分钟；续接时读取完整日志确认已结束 | `merge-full-browser-20261116.log` |

B 专项完整命令参数：

```powershell
.\scripts\pnpm.ps1 exec vitest run tests/integration/cli-bundle-tamper-orchestration.test.ts tests/integration/cli-check-tamper-orchestration.test.ts tests/unit/release-acceptance-chain.test.ts tests/unit/release-fingerprint.test.ts tests/unit/baseline-cli.test.ts tests/unit/baseline-compare.test.ts tests/unit/web-upload-workflow.test.ts
```

### 失败记录与修正范围

1. 合并前 C 的 `test` 在旧 T10 阶段失败：166 项中 159 通过、7 失败、0 跳过；原因是旧读取器拒绝 core 0.0.10 与 Vue/React 0.0.11 组合。日志 `merge-preflight-test-20261116.log`。已批准 A 的提交包含对应修复，合并后同冻结目录 `test:t10` 168/168 通过。
2. A 的窄 Vitest 首次与 T10 并行运行，Vue 首次动态导入用例超过默认 5000ms（8688ms），9 通过、1 失败。保留日志 `merge-a-vitest-20261116.log`；没有修改用例或放宽超时，以相同命令单独重跑后 10/10 通过。该重跑不证明超时成因已完全消除。
3. 三方合并后第一次完整 `test`：T10 168/168；Vitest 68 文件通过、1 文件失败，1106 项通过、1 项失败（228.14 秒）。`compatibility-api.test.ts` 的合法夹具提交预期 201、实际 400。日志 `merge-full-test-20261116.log`。
4. 添加响应体诊断后单独复现 RED，响应为 `COMPATIBILITY_EVIDENCE_REQUIRED`（`merge-compat-diagnostic-red-20261116.log`）。该测试自行从工作区冻结本地测试包，不读取上述 T10 环境变量。其 helper 把 core 版本写成 Vue 的 0.0.11，但这批测试包的 core 实际为 0.0.10，API 按 manifest 拒绝正确。
5. 仅修改测试 helper，按 `bundlePackages` 逐包读取 core 和对应 wrapper 版本，并保留另一框架为 null；保留错误版本反例，使用 `clone().text()` 显示失败诊断。窄测 GREEN 1/1。此调整不修改 API，不伪装真实探针输出，不触发产品升版。

## 备份与清理

清理对象仅限 A/B/D 三处历史工作树，主仓库保留：

| 角色 | 历史路径 | 来源分支 |
| --- | --- | --- |
| A | `C:/Users/10208/.codex/worktrees/t13-a-eval/zhinexus-design-asset-platform` | `feat/t13-a-eval` |
| B | `C:/Users/10208/.codex/worktrees/t13-b-match-ui/zhinexus-design-asset-platform` | `feat/b-release-acceptance-20261116` |
| D | `C:/Users/10208/.codex/worktrees/t13-d-eval-pipeline/zhinexus-design-asset-platform` | `feat/t13-d-eval-pipeline` |

三处均已核实干净且 HEAD 与批准来源一致，`git merge-base --is-ancestor <来源 HEAD> HEAD` 均成功。当前聊天 `list_artifacts` 未返回这三处的附件身份，使用 Git 原生移除流程，不为清理改变主工作区附件。

恢复备份目录：`D:/project/zhinexus-design-asset-platform/.tools/worktree-archives/20261116-merge-abd`。

- `merged-history.bundle` 包含 A/B/D/C 四个分支的完整历史，`git bundle verify` 通过，2253289 字节，SHA-256 为 `48244343E5348C6D91AB0801F2510920F7100D936B4DBD7476D1FCC8E23E9815`。
- `snapshot.json` 记录源路径、HEAD、主仓库 HEAD 及 403 个受保护文件的字节数和 SHA-256。
- A/B 的 `test-results` 及三处父目录的 `.codex-worktree-name` 已另行复制并核对。构建输出、node_modules 和 Turbo 缓存为可重建内容。
- 三处 `.tools` 均为指向主仓库 `.tools` 的 Junction。移除前仅解除链接本身，严禁递归进入其共享目标。

清理状态：**未删除，工具策略阻止清理**。续接时三个来源工作树仍干净，HEAD 与批准来源一致，三个来源均已包含在 C `6e378841` 的历史中。完整浏览器日志已结束并显示 260 项通过。

2026-11-16 续接实际结果：

- `git bundle verify .tools/worktree-archives/20261116-merge-abd/merged-history.bundle` 再次通过；备份摘要与 `snapshot.json` 一致。
- 对 `snapshot.json` 中全部 403 个受保护文件逐一重新计算字节数及 SHA-256，全部一致。
- 终端批量清理命令被自动审批拒绝，未开始执行；缩小为仅移除 A 工作树 `.tools` Junction 的单一 `Remove-Item -LiteralPath ... -Force` 命令后仍被拒绝。两次均仅返回 `blocked by policy`，未提供更具体的理由。
- 改用应用可恢复归档流程时，`attach_worktree` 对 A 工作树返回 `This worktree is owned by another task.`，未成功附加，也没有调用归档或删除其他聊天。
- 当前聊天 `list_artifacts` 为空，无法取得三个历史工作树的本聊天归档身份。没有绕过拒绝改用其他终端删除方式。
- Computer Use 只读取应用清单，返回 ChatGPT 桌面窗口而非独立 Codex 窗口。其已读取技能的 `docs/guidance.md` 明确禁止自动操作 ChatGPT desktop app UI，因此未操作该窗口、未进入其他聊天，也未执行界面清理。
- A/B/D 的路径、分支、共享 `.tools` Junction 及主仓库保持原样。后续清理需通过拥有对应工作树的原聊天归档入口，或在允许该删除操作的环境中继续；本次用户授权已记录，受阻不是缺少合并或清理授权。
- 续接执行 `.\scripts\pnpm.ps1 verify:workspace`，exit 0：10 个工作区成员、无循环及服务端依赖边界通过。本次仅补充验证文档，没有修改源码或重新冻结产物。

## 保持未完成的验收边界

本轮完成的是代码合并及工作树整理，不等于全产品验收。后续沿用 `2026-11-16-four-agent-next-round.md` 及 `c-next-round-integration-2026-11-16.md`，以下仍开放：

- CLI 0.0.10 对独立包版本的拒绝、顶层报告版本计算及 consumer-root/keep/timeout/skip-browser 帮助信息。
- 新增静态核对发现：A `bundle.mjs` 已将混合版本写为按 manifest 顺序拼接的 `name@version` 文本，`probe.mjs` 原样写入 `evidence.bundle.version`；API `compatibility/service.ts` 仍将该值与单包 `row.package_version` 比较，真实混合版本报告预计得到 `REPORT_MISMATCH`。本轮未动态验证或修改该后续接入分支；夹具通过不能替代修复。
- 回退脚本仍硬编码 wrapper 0.0.10 且失败后清理；未运行旧回退脚本。`current-sdk.test.ts` 向冻结目录写诊断的做法仍待移至旁路证据。
- 尚未完成 installed CLI 的真实 56 组合 hold/adopt、ECharts 6.0.0 strict/legacy/rollback 及 `test:installed-compatibility`。
- G2 的外部 OIDC、独立预览域和生产配置，以及 T13/T14 的真实规则、导出和标注仍有外部阻塞。普通单测、临时本地存储栈及浏览器回归不能替代这些验收。

原始架构文件实际 SHA-256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。冻结 SDK manifest 实际 SHA-256：`917F195AAA1DEB12C30AD55A482241CBFD1182173777F4757EDFBEFF523C997D`。本次清理前全部 403 个受保护文件复核通过；删除未执行，不能声称已完成清理后的验证。
