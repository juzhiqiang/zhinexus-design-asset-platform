# 双框架组件视觉验收与测试准备记录

2026-11-22，Windows x64 本机执行。负责人：Codex。被测源码基线为 `b665681997ba842de6ed039652bf4f358771db6a`，分支为 `chore/component-visual-acceptance`。

本轮 **完成 QA 检查与测试材料准备，视觉验收尚未全部通过**。302 格功能检查中 300 格通过，另有窄屏布局和深色宿主可读性问题。账号后台、真实业务项目试点 T11、完整 T12 和生产 G2 没有在本轮验收。

## 执行环境与命令

固定本地工具链为 Node `26.13.0`、pnpm `12.18.0`、Playwright `1.65.0`、Chromium/headless shell `158.0.8127.18`；浏览器上下文为 `zh-CN`、`Asia/Shanghai`、deviceScaleFactor `1`。包版本为 charts-core `0.0.11`、charts-vue/charts-react `0.0.12`，运行时为 Vue `3.5.45`、React `19.3.1`、ECharts `6.1.0`。

| 实际命令 | 结果与含义 |
| --- | --- |
| `.\scripts\pnpm.ps1 install --frozen-lockfile` | exit 0，按冻结锁文件安装 |
| `.\scripts\pnpm.ps1 build --force` | exit 1，根脚本已有 `--cache`，Turbo 不允许与 `--force` 同传；保留失败尝试 |
| `.\scripts\pnpm.ps1 exec turbo run build --force` | exit 0，10/10 任务成功、0 cached，22.821 秒；全部实际构建 |
| `.\scripts\pnpm.ps1 exec playwright install chromium` | exit 0，本机安装固定 Playwright 对应浏览器 |
| `.\scripts\pnpm.ps1 verify:workspace` | exit 0，工作区成员、依赖与服务边界检查通过 |
| `.\scripts\pnpm.ps1 exec node --check tests/acceptance/chart-visual/run.mjs` | exit 0，工具语法通过 |
| `.\scripts\pnpm.ps1 exec node tests/acceptance/chart-visual/run.mjs`，首次 | exit 1，298/302；两项柱状图点击坐标误判及两项饼图自检失败 |
| 同一 QA 命令，修正点击目标后复跑 | exit 1，300/302；两项饼图协议失败继续保留 |
| `.\scripts\pnpm.ps1 exec node tests/acceptance/chart-visual/export-assets.mjs` | exit 0，14 张草案图导出，原始页面摘要核对一致 |

构建与运行日志保留在本机临时目录的 `zhinexus-visual-acceptance-*.log`；逐页截图和预览服务日志位于忽略目录 `.tools/qa/component-visual-acceptance/`。它们未提交，其他机器需构建后复跑 QA 工具生成。提交的 JSON 保存每张原始截图的路径、大小与 SHA-256；联系表和草案图可直接在仓库查看。

QA 工具只启动本轮的 `127.0.0.1:5184` Vue、`127.0.0.1:5185` React Vite preview。端口已占用时拒绝启动，不终止已有服务。运行完成后关闭本轮浏览器和预览进程；退出后的端口检查没有监听者。截图由本地浏览器执行，没有改动 API、预览网关、SDK、示例、contracts、账号后台或根配置。

## 覆盖与结果

读取示例的实际 `ready`、`runState`、`getChecks` 与测试钩子；就绪由现有协议确认，截图不依赖固定 sleep。每个额外状态都从新页面的 default 进入，防止相同空快照或连续状态隐藏重建问题。

| 检查 | 覆盖 / 实际结果 |
| --- | --- |
| default | 2 框架 × 7 组件 × 2 主题 × 2 渲染器 × 4 viewport = **224 格，功能 224/224** |
| 全部额外 fixture 状态 | 1280×720 / light / canvas，**78 格，功能 76/78** |
| 实际主题与绘制面 | 明暗主题令牌、Canvas/SVG 数量和自检；两项空实心饼图失败 |
| 真实点选 | **14/14**，每次正好一个事件，双框架载荷相同；柱状图用 single，其余用 default |
| 键盘 Enter 更新 | **14/14**，进入 updated 且自检通过；覆盖示例状态按钮，不代表完整无障碍验收 |
| Vue / React 对等 | **151 对，0 差异**；读回 data、summary、labels、presentation 和点击载荷 |
| 浏览器错误与请求 | 无 console error、pageerror 或失败网络请求；汇总 `errors` 中仅剩工具显式记录的两项自检/渲染器失败 |
| 视觉证据 | **23 张联系表均已实际打开检查**；14 张裁图导出后另抽查 line-vue、pie-react，边界完整 |

viewport 为 390×844、768×1024、1280×720、1440×900。功能通过数不包含 overflow、裁切和人工可读性判断，不能把 runner 的退出码当作完整视觉批准。

| viewport 宽度 | 检查格数 | 页面横向溢出 | 图表宿主裁切 |
| --- | --- | --- | --- |
| 390 | 56 | 56 | 48 |
| 768 | 56 | 48 | 0 |
| 1280 | 134（含额外状态） | 0 | 0 |
| 1440 | 56 | 0 | 0 |
| 合计 | 302 | 104 | 48 |

## 问题与交接

| ID / 优先级 | 复现与影响 | 证据 / 建议负责人及复验 |
| --- | --- | --- |
| V01 / 阻断小屏视觉验收 | 任一框架在 390 宽度进入七个入口，所有页面横向溢出；除趋势卡外的图表被裁切。768 宽度仍有 48 格溢出。宿主固定 720/560/360 宽度，部分 `#app` 固定 760，工具栏不换行 | [390 联系表](component-visual-acceptance-2026-11-22/default-390-light-canvas.png)、[768 联系表](component-visual-acceptance-2026-11-22/default-768-light-canvas.png)。B/示例维护人处理容器、按钮和长文本的响应式布局，复跑四种宽度；入口见 [Vue bar](../../examples/vue/bar.html)、[React styles](../../examples/react/src/styles.css) |
| V02 / 阻断深色视觉验收 | `?theme=dark` 令牌正确，但示例宿主保持白底，`#e2e8f0` 标签难以辨认；影响全部 14 个深色示例（两渲染器） | [深色联系表](component-visual-acceptance-2026-11-22/default-1280-dark-canvas.png)、[主题令牌](../../packages/charts-core/src/theme.ts)。SDK 透明背景是既有设计；B/示例维护人提供匹配的深色宿主后复验，不直接将浅色文字改为黑色 |
| V03 / 阻断该路径自检验收 | Vue/React `/pie.html?theme=light&renderer=canvas` 新页 ready 后直接 `runState('solid-empty')`：数据正确为空，但 `instance=1, canvas=0, svg=0`，`single-instance` 和 `renderer-match` 失败 | [饼图状态联系表](component-visual-acceptance-2026-11-22/states-pie.png)、汇总中两个 `*-pie-light-canvas-1280-solid-empty`。A/SDK 与 B/CLI 协调自检协议后处理；本轮保留失败，不放宽断言或绕过状态 |

V03 是已知的“空数据 + 控制器重建”限制，[饼图协议](../superpowers/specs/2026-11-12-sdk-pie-chart-protocol.md) 的“待完成/限制”已明确记录。既有 [浏览器矩阵](../../tests/browser/component-matrix.spec.ts) 先经 solid 再到 solid-empty，使最后一步不重建。放宽“一个绘制面”会同时影响 CLI 所依赖的协议，须先对齐；本轮没有修改相关判断。

另有两项视觉观察供业务确认：柱状/散点图图例落在 x 轴区域；饼图 zero-total/solid-zero-total 呈现两块等大的彩色扇形、显示数值 0 而无百分比。后者符合当前“仅数值、不出现 NaN”的约定，但“无占比”的表达可能引起误读。本轮没有将其判为已确立的契约违例。

首次柱状图失败不是产品点击故障：已有坐标钩子返回类目中心，分组柱状图的中心位于两根柱之间。QA 改用现有 single fixture 再真实点击，最终两框架各一次事件，保留 default 的数据、绘制面与截图检查。首次四项失败及当时截图摘要见 [首次失败记录](component-visual-acceptance-2026-11-22/initial-failures.json)，最终统计没有掩盖饼图失败。

## 已查看联系表与证据索引

完整路径、SHA-256、格数及逐页结果在 [最终汇总](component-visual-acceptance-2026-11-22/summary.json)。下列 23 张都已人工打开检查：

| 组别 | 已查看文件（Canvas / SVG 各一张） | 视觉结论 |
| --- | --- | --- |
| default 390 light | [Canvas](component-visual-acceptance-2026-11-22/default-390-light-canvas.png) / [SVG](component-visual-acceptance-2026-11-22/default-390-light-svg.png) | 小屏裁切、工具栏与文字溢出 |
| default 390 dark | [Canvas](component-visual-acceptance-2026-11-22/default-390-dark-canvas.png) / [SVG](component-visual-acceptance-2026-11-22/default-390-dark-svg.png) | 同上，且浅色标签与白底不匹配 |
| default 768 light | [Canvas](component-visual-acceptance-2026-11-22/default-768-light-canvas.png) / [SVG](component-visual-acceptance-2026-11-22/default-768-light-svg.png) | 图表完整，部分页面仍横向溢出 |
| default 768 dark | [Canvas](component-visual-acceptance-2026-11-22/default-768-dark-canvas.png) / [SVG](component-visual-acceptance-2026-11-22/default-768-dark-svg.png) | 图表完整，深色可读性问题保留 |
| default 1280 light | [Canvas](component-visual-acceptance-2026-11-22/default-1280-light-canvas.png) / [SVG](component-visual-acceptance-2026-11-22/default-1280-light-svg.png) | 图表完整，图例位置待评估 |
| default 1280 dark | [Canvas](component-visual-acceptance-2026-11-22/default-1280-dark-canvas.png) / [SVG](component-visual-acceptance-2026-11-22/default-1280-dark-svg.png) | 深色可读性问题保留 |
| default 1440 light | [Canvas](component-visual-acceptance-2026-11-22/default-1440-light-canvas.png) / [SVG](component-visual-acceptance-2026-11-22/default-1440-light-svg.png) | 图表完整，图例位置待评估 |
| default 1440 dark | [Canvas](component-visual-acceptance-2026-11-22/default-1440-dark-canvas.png) / [SVG](component-visual-acceptance-2026-11-22/default-1440-dark-svg.png) | 深色可读性问题保留 |
| 全部状态（7 张） | [line](component-visual-acceptance-2026-11-22/states-line.png)、[bar](component-visual-acceptance-2026-11-22/states-bar.png)、[pie](component-visual-acceptance-2026-11-22/states-pie.png)、[scatter](component-visual-acceptance-2026-11-22/states-scatter.png)、[trend-card](component-visual-acceptance-2026-11-22/states-trend-card.png)、[ranking](component-visual-acceptance-2026-11-22/states-ranking.png)、[proportion](component-visual-acceptance-2026-11-22/states-proportion.png) | 空数据、缺失、负值、更新、嵌套与排名均有图；空实心饼图自检和零总量表达保留 |

联系表缩放并截取页面左侧用于比对，溢出结论来自原始 viewport 的 DOM 实测；原始页面图没有横向扩展来隐藏裁切。联系表不是像素基线，也没有进行全分辨率逐像素回归。

## 交付边界与下一步

[首批资产清单](../acceptance/first-batch-assets-2026-11-22.md) 包含 7 逻辑资产、14 实现、字段/导出/状态与 14 张未发布草案图。[平台测试清单](../acceptance/platform-test-checklist-2026-11-22.md) 列出账号、撤权、发布、隔离预览、三存储恢复、备份和真实消费的操作及证据栏。

本轮没有创建虚构业务项目，没有冻结 tarball、注册表安装、上传或发布；截图来自工作区示例，不能充当 T03/T04 消费者证明、ScreenshotRef、ReleaseManifest 或正式自动视觉基线。没有建立 environmentKey、字体摘要或兼容记录，也未重跑完整生命周期、SSR、网络故障和生产基础设施验收。额外状态未覆盖其他主题/渲染器/viewport 组合。

账号后台交付并启动独立试用栈后，先执行测试清单 A01–A11、R01–R07，再完成一个冻结资产的 P01–P06 闭环。问题修复后追加新验证记录，不覆盖本轮历史。真实 Vue/React 业务项目和生产 DNS/TLS/撤权目标仍需各自验收。

原始架构 SHA-256 保持 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。本轮纯 QA 工具与文档，不触发产品版本升级。

## 材料完整性复核

执行 `.\scripts\pnpm.ps1 exec node .superpowers/sdd/2026-11-22-component-visual-acceptance/verify-evidence.mjs`（本轮忽略目录中的临时核对工具），exit 0：从 fixture 重算 302 个 ID，核对 302 张原图、4 张首次失败图、23 张联系表、14 张裁图的摘要；逐张重新裁切比对，核对包导出、版本、151 对数据、14 次点击/键盘更新及 54 个本地文档链接。该复核验证材料完整性，仍要求两项已知功能失败保留。原始架构和 README 摘要均与基线一致。

另执行 `.\scripts\pnpm.ps1 exec node --check tests/acceptance/chart-visual/export-assets.mjs` 与 `git diff --check`，没有语法或空白错误。临时核对工具及原图未纳入交付，公开复跑入口是本报告前述 runner 和 exporter。

## 独立审查

审查范围为 `b6656819..fe9e898d`，独立只读审查员 `qa_final_review` 按计划与工程规则核对，结论为 **QA/docs 可合并，无 Critical/Important**。审查员实际运行完整性核对、两个脚本语法检查与范围 diff 检查，并确认端口无监听、工作区干净、架构摘要不变；另查看小屏、深色、饼图状态联系表及 pie-react 草案。没有复跑工具覆盖证据。

非阻断建议：`run.mjs` 的异常清理可分别收集浏览器关闭、全部子进程终止与日志落盘结果；当前 `browser.close()` 或第一份服务日志写入抛错，可能跳过后续进程终止。本轮正常路径已确认无残留；此项保留为 Minor，后续改进需单独验证错误路径。

审查边界处理：V01/V02 示例适配、V03 SDK/CLI 协议修复及图例/零总量业务表达，均按本轮只检查交付的范围保留，不能据审查结论扩大视觉批准。完整生命周期/SSR/扩展状态矩阵、冻结 tarball/发布、后台/撤权/恢复、真实业务项目与生产 G2 均需独立真实验收；全分辨率逐像素回归仍未建立。本轮不修改这些实现或判定为通过，代价是对应后续门槛继续开放。
