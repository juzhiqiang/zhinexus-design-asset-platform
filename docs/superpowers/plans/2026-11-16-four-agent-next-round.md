# 四方下一轮：T10 分发验收与集成准备

> 执行方式：沿用用户指定的 Antigravity（A）、Claude 桌面端（B）、Claude Code（D）和 Codex（C）；按既有计划执行，新增行为修复遵循 RED→GREEN。日期：2026-11-16。

**目标：** 补齐上一轮已明确遗漏的冻结产物与已安装 CLI 验证，并准备可审查的跨分支集成清单和真实 ID 评估交接。

**依据：** `2026-11-11-component-platform-implementation.md` 的 T10/T13/T14、三人分工文档、`2026-11-16-four-agent-acceptance.md`、`docs/verification/t10-windows-local-procedure.md`。沿用现有协议和固定 Windows 工具链，不扩大产品范围。

## 基线与所有权

| 角色 | 分支 / 起始提交 | 本轮唯一范围 |
| --- | --- | --- |
| A / Antigravity | `feat/t13-a-eval` / `135a0b9c` | SDK、examples、`tests/acceptance/t10-sdk` 探针与其测试；新增 A 验证文档。evaluation 仍仅允许自己的 id-matching 测试 |
| B / Claude 桌面端 | `feat/b-release-acceptance-20261116` / `42e837c6` | CLI 命令/分发接线及专属测试；新增 B 安装探针执行说明。不得修改 A 探针源文件 |
| D / Claude Code | `feat/t13-d-eval-pipeline` / `f2759206` | runner/scoring 与专属测试、设计案例及缺口文档；本轮先做真实观测交接审计 |
| C / Codex | `feat/t13-c-matching` / `a2036ba9` | contracts/API/gateway/infra/根配置和锁文件；跨分支只读检查、Windows 宿主验证、集成清单 |

使用既有四个独立工作树，最多四个在途任务。所有原始架构文件与已冻结包保持字节不变。禁止自动 merge、push、重置或清理工作区；A/B/D 不修改版本号及根配置。若发现契约冲突，停止该部分交 C。

## A：T10 冻结策略回归

- [x] 读取 T10 探针与上一轮 SDK 0.0.11 证据，核对实际冻结输入。
- [x] 显式设置 `A10_FROZEN_BUNDLE`，运行 `.\scripts\pnpm.ps1 test:t10`；先前 7 项冻结策略测试全部执行通过，最终 168 passed / 0 failed / 0 skipped。
- [x] 审查新版 SDK 与分发探针模板接口；修复多包独立版本限制，再经独立审查修复非法语义化版本放行，保留逐包 SHA/bytes 与 core 精确依赖约束。
- [x] 新增冻结策略、严格副本复验、版本正则修复三份 A 验证记录；提交 `ce34c390`、`8f4ab033`、`60a02373`，真实矩阵/回退仍开放。

冻结 SDK 输入为共享 `.tools/operations/current-sdk/6d567b22-6c72-4e7a-a254-ade94b104df1`（core 0.0.10、Vue/React 0.0.11）。原目录含未在 manifest 声明的诊断 `acceptance.json`，严格发布目录校验应拒绝；不得删除诊断、重打包或放宽校验。需要严格输入时，由 C 提供逐文件 SHA/bytes 核对的声明材料副本。A 此阶段不启动固定端口浏览器服务。

## B：已安装 CLI 的实际探针验收

- [x] 审计 CLI 0.0.10 已冻结 tarball 的默认分发探针入口及其参数，确认其独立版本阻塞；未以源码入口替代已安装入口。
- [x] 形成 Windows 失败边界复现材料和后续验收要求，复用既有 CLI tarball SHA `0261b846c6c738e509a99afeb2c8089902538856d42a6609f85484cb629063e9` 和 A 的冻结 SDK，不重新 pack。
- [ ] 交 C 宿主顺序执行：新外部消费者安装→ECharts 6.1.0 双框架 56 组合首轮→截图审查与 hold 审计→新消费者使用已审查报告复验→adopt 审计。无基线首轮 hold 是预期，其他错误不能算通过。
- [x] 依照现有 T10 Windows 步骤准备 6.0.0 strict 拒绝、显式 legacy 测量及原消费者锁文件回退要求；发现 C 回退脚本固定旧版本的问题，实际执行保持开放。
- [x] 新增 `docs/verification/b-installed-probe-next-2026-11-16.md`，B 停写后由 C 审校、宿主复现并提交 `cb7406c2`。本轮发现的 CLI 产品修复与新候选另列后续，不改旧 tarball。

本轮已安装 CLI 的 check/verify 均在探针前 exit 1 / `INVALID_BUNDLE_MANIFEST`；直接调用包内探针也拒绝独立版本。56 组合、hold/adopt、6.0.0 与回退均未执行。下一候选必须整合 A 最新探针和 examples，B 修复 CLI 独立版本与顶层报告版本绑定，C 完成回退适配后重新升版冻结；不能补丁修改 0.0.10。

B 的桌面端环境缺 Windows 固定运行时，不能把 Linux 沙箱检查报告成 Windows 实测。C 运行前 B 须交接并停止相关文件写入。浏览器统一由 C 排队，不能与 A/C 同时占用 5173–5175。

## D：真实 ID 观测交接审计

- [x] 对照 C API、contracts 与 D runner/CLI，明确真实 API 响应如何成为 `{caseId, plan}` 观测。
- [x] 新增 `docs/phase2/id-observation-handoff-2026-11-16.md`：列出必需输入、独立人工 expected、来源与摘要、规则版本、请求/响应关联、归档和精确运行命令。Claude Code 输出草稿，C 审校落盘并提交 `7bbb7698`。
- [x] C 固定工具链演练得到预期 exit 1：real=0 / N/A / false，synthetic=1 / passed，`productionAcceptance: false`；输入摘要核对通过，未覆盖历史报告。
- [x] 列出当前工具无法证明的来源真实性边界及外部材料关闭证据；真实规则、导出与独立业务标注仍待外部交付。

本任务先交审计文档。Claude Code 若再次发生工具解析错误，使用同一 CLI 文本模式输出审计，由 C 明确记录落盘与验证，不改模型配置。没有新外部输入时不重复生成虚假的“真实通过”报告。

## C：集成准备与宿主验收

- [x] 固定四方提交，记录 merge-base、ahead/behind、文件重叠、contracts/根配置/版本差异；完成只读集成准备，未执行源码合并。
- [x] 生成并校验严格冻结 SDK 声明材料副本，核对原 manifest、199 文件和三包摘要；原额外诊断保持原样。
- [x] 记录 `tests/platform/current-sdk.test.ts` 将诊断写入冻结目录的问题及修复范围：新诊断写为旁置证据，绑定 manifest 与逐包摘要，不改旧冻结产物、不放宽校验。
- [ ] B 产出真实 adopt 报告后，使用该报告和同一 SDK 运行现有 `test:installed-compatibility`，验证持久化/重启/隐私与篡改拒绝；依赖未满足前不宣称完成。
- [x] 新增 `docs/verification/c-next-round-integration-2026-11-16.md`，汇总各方交付、验证边界和拟议 A→B→D 集成顺序；实际合并仍须用户明确授权。

## 下一阶段依赖顺序

1. 审批具体集成清单：以 C `a2036ba9` 及本轮文档提交为基础，依次集成 A `60a02373`、B `cb7406c2`、D `7bbb7698`；逐项处理 README/CHANGELOG 与 design-cases 差异，保留 A 评估器与 D runner 匹配的案例结构。
2. B 对 CLI 独立版本、与 A 一致的 manifest 顺序 `bundle.version` 绑定补 RED/GREEN，并补 help 缺项；C 对回退脚本版本来源、失败时保留消费者及旁置诊断补 RED/GREEN。
3. 集成后运行窄范围回归、类型检查/构建及完整必需门禁。C 独立升级 CLI 版本、更新 CHANGELOG，再创建新 tarball 与新的工作区外消费者；原 SDK tarball 和 CLI 0.0.10 留存不变。
4. C 顺序完成 6.1.0 的 56 组合 hold→截图审查→全新消费者 baseline/adopt；继而做 6.0.0 strict/legacy 与首轮 owned 消费者回退。回退 ownership 要求不扩大到 adopt 审计。
5. 真实 adopt 报告到位后运行 installed-compatibility；D 仅在取得真实规则、导出和独立标注后采集/评分真实 API 观测。G2 外部接入并行追踪。

## 验收边界

- 冻结策略单测通过不代表 56 组合真实探针或双消费者回退通过。
- 同一冻结产物跨分支验证不代表源码已集成；C 基线 1041 项结果不能覆盖 A/B/D 后续提交。
- 公司 OIDC、独立预览域、生产配置和真实业务 ID/导出/标注仍缺；G2、T13/T14 完整验收保持开放。G2 文档目标为 2026-11-18，实际接入责任人的实名和交付尚待确认。
- 每次子任务验证通过后聚焦中文提交；对外包行为修复达到发布条件时，C 独立升版并更新 CHANGELOG。
