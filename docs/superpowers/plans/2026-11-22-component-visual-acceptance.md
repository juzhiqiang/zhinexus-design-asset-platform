# 双框架组件视觉验收与测试准备计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this authorized verification plan inline. Steps use checkbox syntax for tracking.

**Goal:** 在账号后台开发期间，完成现有七类组件的双框架示例验收，交付首批资产草案和可执行测试清单。

**Architecture:** 从独立 worktree 的 main 基线启动本地 Vue / React 预览，使用已有 Playwright 和 ready/runState/getChecks 协议收集证据。仅新增验收工具与文档，问题记录后交付，不修改组件、账号后台或公共契约。

**Tech Stack:** Windows x64、Node 26.13.0、pnpm 12.18.0、Playwright 1.65.0、现有 Vue / React / ECharts 固定依赖。

**Spec:** 用户于 2026-11-22 确认没有真实业务项目并授权“你来执行”；现有范围以 `component-platform-implementation-assessment.md`、`docs/superpowers/plans/2026-11-11-component-platform-implementation.md` 和 `docs/superpowers/plans/2026-11-11-three-person-allocation.md` 为准。

## Global Constraints

- 保留原始架构文件 SHA-256 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
- 唯一负责人为当前 Codex；只写本计划、`tests/acceptance/chart-visual/`、新增的 `docs/verification/` 与 `docs/acceptance/` 文件。
- API、画廊、contracts、迁移、根配置、锁文件和基础设施由账号后台 agents 负责，本轮不修改。
- 本机示例截图只作为 QA 证据和素材草案；不是冻结 tarball 消费者、发布证明或自动视觉基线。
- T11 真实 Vue / React 业务试点、账号权限验收和生产 G2 保持未完成。
- 不创建业务试点替身，不发布、不推送、不重启共享服务。
- 使用 5184 / 5185 独立端口，退出时仅关闭本轮创建的进程。
- 本轮无产品行为变更，测试和文档不触发版本升级；若发现问题，仅记录复现条件及交付要求。

## Review Focus

- 小屏固定宽度导致图表、状态按钮和文字被裁切：收集真实 viewport 与 overflow。
- 深色主题的透明图表背景与宿主白底不匹配：同时检查实际主题令牌和截图可读性。
- 空值、零总量、实心/环形切换的相同快照：每个状态从新页面进入，不靠 sleep。
- 自检通过但点击语义或双框架数据不一致：读回实际数据、摘要、标签并触发真实点击。
- QA 素材被误认为可直接发布或正式业务试点：清单必须说明来源、版本和剩余发布材料。

### Task 1: 浏览器和视觉验收

**Files:**
- Create: `tests/acceptance/chart-visual/run.mjs`
- Create: `docs/verification/component-visual-acceptance-2026-11-22.md`
- Create: `docs/verification/component-visual-acceptance-2026-11-22/` 汇总与联系表

**Interfaces:**
- Consumes: 7 个 fixture 的 states 与 expectedSeriesIds；示例的 ready/runState/getChecks 与现有测试钩子。
- Produces: 可复跑命令、每个组合的结果与 SHA-256 截图索引、问题及已检查联系表。

- [x] 安装冻结依赖并执行全量无缓存构建。Expected: install exit 0；build 全部任务实际执行成功。实际为 10/10、0 cached；初次不兼容参数失败也保留在记录中。
- [x] 执行 default 的 2 框架 × 7 组件 × 2 主题 × 2 渲染器 × 4 viewport（390×844、768×1024、1280×720、1440×900）。Expected: 224 格均完成就绪、实例、主题、渲染器、网络、运行错误及布局检查。实际功能 224/224，布局问题单列。
- [x] 在 1280×720 / light / canvas 逐页检查全部额外 fixture 状态，并触发点击和键盘更新。Expected: 状态检查和双框架数据/事件一致性可核对；失败保持显式记录。实际 76/78；柱状图点击用 single，其余用 default；14/14 点击及键盘更新通过。
- [x] 保存并实际查看所有联系表。Expected: 证据目录、逐项视觉结论及剩余问题齐全；不把自动化通过等同于视觉通过。23 张已查看，300/302 与三个问题见独立 QA 记录。
- [x] 检查工具语法、工作区边界、diff 和架构摘要，创建聚焦中文提交。Expected: 无越界修改或敏感文件。

### Task 2: 首批资产与功能测试交接

**Files:**
- Create: `docs/acceptance/first-batch-assets-2026-11-22.md`
- Create: `docs/acceptance/platform-test-checklist-2026-11-22.md`

**Interfaces:**
- Consumes: Task 1 的运行结果、真实包版本/导出、现有 SDK 文档和批准的账号需求。
- Produces: 7 逻辑资产 / 14 实现的草案清单，以及账号后台交付后可填写的端到端验收表。

- [x] 整理每项资产名称、用途、数据字段、导出、配置、状态和证据。Expected: 全部引用可在仓库找到，保留未发布草案状态。14 张图的裁切与来源摘要已核对。
- [x] 写出账号、权限、目录、发布、隔离预览、三存储恢复、备份和真实消费的操作与预期。Expected: 每项有前置条件、结果/证据栏及是否可立即执行。后台与外部检查均保留待执行。
- [x] 独立复核范围与证据，更新本计划勾选和追加记录，再创建聚焦中文提交。Expected: 不宣称未运行的后台、生产 G2 或 T11 已通过。独立审查无 Critical/Important；异常清理建议作为非阻断项保留。

执行结果见 [QA 记录](../../verification/component-visual-acceptance-2026-11-22.md)、[资产草案](../../acceptance/first-batch-assets-2026-11-22.md) 与 [测试清单](../../acceptance/platform-test-checklist-2026-11-22.md)。计划完成表示检查和交付完成，视觉验收仍有 V01–V03 未通过。
