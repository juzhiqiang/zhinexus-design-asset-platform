# C：四方下一轮交付与集成准备

日期：2026-11-16。执行入口为 Antigravity（A）、Claude 桌面端（B）、Claude Code CLI（D）及 Codex（C）。本记录是新增证据，不替换历史验证。任务安排见 `docs/superpowers/plans/2026-11-16-four-agent-next-round.md`。

## 本轮结论

A 完成冻结探针的独立版本与严格版本格式修复，最终 168 passed / 0 failed / 0 skipped。B 完成已安装 CLI 的入口审计；C 在 Windows 固定工具链上确认 CLI 0.0.10 在探针启动前拒绝 core 0.0.10 + Vue/React 0.0.11。D 完成真实 ID 观测交接，C 演练验证 real 空集不能通过。完整 T10、G2 与 T13/T14 验收仍未完成。

本轮没有源码合并或推送，没有修改旧 tarball。B、D 文档由原指定客户端产出后交 C 审校、执行宿主验证与提交；A 自行提交修复。C 本轮受版本控制的变更仅为计划和本记录。

## 固定提交与所有权

| 角色 | 工作树 | 固定 HEAD |
| --- | --- | --- |
| C | `D:/project/zhinexus-design-asset-platform` | 审计基线 `a2036ba93c86983bd67bd3ea6971a9b2ad51d7b9`；本轮两份文档另行提交 |
| A | `C:/Users/10208/.codex/worktrees/t13-a-eval/zhinexus-design-asset-platform` | `60a023737c2a08c269a4539f70b0a6f06d14520d` |
| B | `C:/Users/10208/.codex/worktrees/t13-b-match-ui/zhinexus-design-asset-platform` | `cb7406c2a9396877089499d2880f4522f836cb53` |
| D | `C:/Users/10208/.codex/worktrees/t13-d-eval-pipeline/zhinexus-design-asset-platform` | `7bbb769805c104ffc415a9965180adbcd40d15d4` |

本轮聚焦提交：

| 提交 | 目的 | 验证 |
| --- | --- | --- |
| A `ce34c390` | 允许冻结 SDK 各包独立精确版本，保留 core 依赖及摘要校验 | 显式冻结输入，167/0/0，workspace 通过 |
| A `8f4ab033` | 严格声明材料副本复验及旧 CLI 分发阻塞记录 | 严格副本 167/0/0 |
| A `60a02373` | 对齐 contracts exactVersion 正则和 1..2048 长度限制 | 最终 168/0/0，workspace 通过；独立审查关闭原 P2 |
| B `cb7406c2` | 记录已安装 CLI 探针阻塞与新候选前置 | C 实际安装入口拒绝证据、文档独立复核及 diff 检查 |
| D `7bbb7698` | 明确真实 ID 观测交接与空集验收边界 | C 演练预期 exit 1、输入摘要匹配及 diff 检查 |

A 的最终命令在 A 工作树运行，`A10_FROZEN_BUNDLE` 显式指向下述严格副本：`.\scripts\pnpm.ps1 test:t10` 和 `.\scripts\pnpm.ps1 verify:workspace`。C 与独立审查者均读取原始 GREEN 日志 `C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-703.log`，实际为 25 suites、168 pass、0 fail、0 skipped、21024.7889 ms，随后 workspace verified。

三个非法值为 `01.0.11`、`0.0.11-01`、`0.0.11-rc..1`。A 文档及客户端记录 RED 为 6 pass / 1 fail，在首个非法值触发；独立复核未找到该次 RED 的独立原始日志，但直接比较新旧规则确认三项旧规则放行、新规则拒绝，合法版本仍通过。不得将这项证据限制省略为完整原始 RED 日志已归档。

## 严格冻结交接与 Windows 实测

原 SDK：`.tools/operations/current-sdk/6d567b22-6c72-4e7a-a254-ade94b104df1`。严格副本：`.tools/operations/next-sdk-handoff-zQIRda`。两者位于 C 仓库共享的 ignored `.tools` 中。

C 使用 `.\scripts\pnpm.ps1 exec node .tools/c-next-freeze-handoff.mjs`，实际 exit 0。原目录因额外 `acceptance.json` 被已安装 CLI 的严格 `verifyReleaseBundle` 以 `UNEXPECTED_FILE` 拒绝；副本仅复制 manifest 与声明的 199 个文件，逐项检查路径、文件类型、SHA/bytes 后严格校验通过。原 manifest、诊断文件和声明文件均未变，没有重新打包。

旁置证据 `.tools/operations/next-sdk-handoff-zQIRda.evidence.json`，时间 `2026-11-16T05:54:40.271Z`。manifest SHA-256 为 `917f195aaa1deb12c30ad55a482241cbfd1182173777f4757edfbeff523c997d`。

| 冻结包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| charts-core 0.0.10 | 53524 | `2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752` |
| charts-vue 0.0.11 | 6682 | `5880c22a446074a8e68c2b898406ba76eaf658d8614965426a76c95328b2cf49` |
| charts-react 0.0.11 | 12220 | `0443b89f386300f756138913d7ce34721e2d9ada9b035694354c9b0faffa26fb` |
| component-cli 0.0.10 | 218759 | `0261b846c6c738e509a99afeb2c8089902538856d42a6609f85484cb629063e9` |

CLI tarball 为 `.tools/b-cli0010-distribution-KJhUCm/company-component-cli-0.0.10.tgz`。既有工作区外安装消费者为 `C:/Users/10208/AppData/Local/Temp/zhinexus-cli0010-consumer-xRMZib`，实际 bin 在其 `node_modules/.pnpm/@company+component-cli@file_3c39797316c51dfdb2c6b3baf2eecce0/node_modules/@company/component-cli/dist/bin.js`。

C 使用固定 Node v26.13.0 运行该实际 bin，分别执行 `echarts check --bundle <严格副本> --registry offline --json` 与 `echarts verify --bundle <严格副本> --registry offline --json --version 6.1.0`，两者实际 exit 1，错误码 `INVALID_BUNDLE_MANIFEST`，原文为“三个包版本必须一致，当前为: 0.0.10, 0.0.11”。直接用 `pathToFileURL(...).href` 导入安装包的 `dist/probe/bundle.mjs` 后，`readFrozenBundle` 也抛出 `PROBE_INPUT 版本不一致`。

复现命令 `.\scripts\pnpm.ps1 exec node .tools/c-cli0010-preflight-evidence.mjs` 实际 exit 0，表示成功捕获预期拒绝。证据 `.tools/c-cli0010-preflight-evidence-20261116.json`（`2026-11-16T06:09:00.524Z`）包含完整参数、stdout/stderr、执行前后摘要和字节数；冻结输入未变。先前真实 verify 没有创建消费者或输出报告，浏览器矩阵未启动。

## 必须修复的后续前置

1. **B：CLI 接线。** `packages/component-cli/src/commands/echarts.ts:317` 拒绝独立版本，`:333` 仅取首版本。应允许各包精确版本，并按 A 相同 manifest 顺序复算 `bundle.version`：全同为单值；混合为各项 `name@version` 以逗号加空格连接。保留 `:942` 的顶层相等检查及逐包 name/version/SHA/bytes 绑定。顶层错绑是源码推导出的后续阻塞，本轮没有绕过第一道门禁实跑它。
2. **A→集成构建：新版探针。** 构建 CLI 的分支须包含 A 最新 `bundle.mjs`、相关测试、Vue/React examples 生命周期控件，再由 `package-probe.mjs` 生成新清单。源码通过不能证明旧 CLI 0.0.10 已更新。
3. **C：回退脚本。** `scripts/verify-t10-rollback.mjs:70` 写死框架包 0.0.10，会拒绝正确恢复的 0.0.11；`:89` 在已记录失败后仍调用清理。后续从绑定的冻结包/证据取期望版本，并验证失败时保留消费者和诊断。本轮未运行旧回退脚本。
4. **C：旁置诊断。** `tests/platform/current-sdk.test.ts:224` 将 `acceptance.json` 写入冻结目录。后续改为目录旁置证据，绑定 manifest 和逐包摘要；保留严格清单外文件拒绝，不修改历史冻结目录。本轮只记录修复范围。
5. **B：help 与耗时。** help 漏列已接受的 consumer-root/keep/timeout/skip-browser，作为独立小修复。600 s 默认值是否足够仍待真实矩阵测量，不能从每组合线性外推宣称必然超时。

首轮若用于后续回退，需 owned consumer-root 恰好出现一次、含 `--keep` 并保留 ownerFile。这个要求来自 `validateOwnedConsumers`；`audit-t10-evidence.mjs` 本身没有该约束。baseline/adopt 复验可以让探针创建新的临时消费者，也可另建 owned root，必须与首轮分离。C 曾将 ownership 要求扩大到复验，现已纠正文档并同步 B。

## D 交接的实际边界

Claude Code 通过 `--print --tools '' --output-format json` 输出草稿并 exit 0；C 落盘时补齐 mapping.schemaVersion、失败 HTTP case 不能丢弃、评分器验证 plan 内容，以及原始/脱敏响应摘要分开记录等要求。runner 不验证调用者声明的来源真实性、HTTP 状态或版本血缘。

C 在 D 工作树执行：

```powershell
.\scripts\pnpm.ps1 exec tsx tests/evaluation/runner-id-cli.ts --cases tests/evaluation/design-cases.json --observations tests/evaluation/runner-id-observations.example.json --output .tools/id-handoff-synthetic-20261116.json --mapping-version synthetic-example-v1 --runner-version id-runner-v1
```

实际 exit 1，`runner-id: FAIL real=0 synthetic=1 hardViolations=0`。新报告 real=0、精确匹配率 null/N/A、passed=false；synthetic 1/1、passed=true；productionAcceptance=false。`Get-FileHash -Algorithm SHA256` 对 cases 与 observations 的结果分别匹配报告 inputSha256、observationSha256。只运行合成交接演练，没有真实业务通过结论。

## 只读集成审计

审计相对固定 C `a2036ba9`，命令为 `git merge-base`、`git rev-list --left-right --count`、`git diff --name-only <merge-base> <head>`、`git rev-parse <head>:<file>`。起始快照保留，最终快照新增为 `.tools/next-round-final-integration-audit.json`。

| 分支 | merge-base | C 独有 / 分支独有提交数 | 分支变更文件数 | 与 C 独有变更的路径交集 |
| --- | --- | --- | ---: | --- |
| A feat/t13-a-eval | `b13cc2d7c96aa744834c0a49cdfbfa46a84fc9b0` | 2 / 8 | 24 | 空 |
| B feat/b-release-acceptance-20261116 | `c273f1e58b446df494289ea9583eff3a6c93ca64` | 1 / 10 | 18 | 空 |
| D feat/t13-d-eval-pipeline | `b13cc2d7c96aa744834c0a49cdfbfa46a84fc9b0` | 2 / 3 | 12 | 空 |

三方之间存在差异，不能据上表声称合并无冲突：

- A/B：README.md、CHANGELOG.md 内容不同；A ID 边界测试和其验证文档为相同 blob。
- A/D：README.md 内容不同。
- B/D：README.md、design-cases.json 内容不同；D 缺口文档为相同 blob。D 案例已适配 runner，集成时保留其与 runner 匹配的结构，并保留 A 的 id-matching 测试。
- 本轮没有公共契约或根锁文件改动。A 分支已有 Vue/React 0.0.11、B 分支已有 CLI 0.0.10 的前轮独立升版提交，后续由 C 统一检查版本/CHANGELOG。

拟议集成清单：在 C 分支含本轮文档提交的基础上，依次集成 A `60a02373`、B `cb7406c2`、D `7bbb7698`，检查上述差异与历史共有提交，保持原始架构字节不变。实际 merge 依 AGENTS.md 需要用户明确授权；本轮未执行。集成后先修复 B/C 前置并运行相应 RED/GREEN、类型检查、构建及全图检查，再独立升级 CLI、冻结新 tarball、在新外部消费者安装，完整复跑分发自检和真实矩阵。

## 收口检查与未完成项

2026-11-16 实际检查四个工作树：A/B/D 干净，C 仅新增本轮计划及本记录；`git diff --check`、`git diff --cached --check` 无错误。四处原始架构文件 SHA-256 均为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。最终暂存/提交仅包含 C 两份文档，不提交 ignored 产物。

本轮未执行：已安装 CLI 56 组合 hold/adopt、6.0.0 strict/legacy、真实消费者回退、依赖 adopt 的 installed-compatibility。A 的 168 项测试不能代替这些项目，也不能证明四分支源码已集成。C 本轮仅文档收口，没有将旧基线完整测试结果冒充本轮全图结果。

公司 OIDC、独立预览域、生产配置、真实设计 ID 规则/导出/独立标注仍需外部交付；G2 与 T13/T14 完整验收保持开放。G2 文档目标日期 2026-11-18 不是完成承诺，实名负责人和实际接入证据仍待确认。
