# 2026-11-23 画廊介绍首页设计与验证

## 用户确认与交付范围

用户要求 gallery 先有介绍首页，只交付 pen.dev / Pencil 设计稿，不沿用现有管理后台风格，采用高端、美观的科技朋克方向。确认后的视觉为深黑背景、电光青与紫、精细网格、悬浮图表和大字号主视觉。

本轮只在独立的 [gallery.pen](gallery.pen) 新增首页；不修改管理后台、既有画廊画板、应用源码、契约、包版本或历史验证记录。属于 B 的 T07 设计资产整理，不改变 T07/G1/G2 验收状态，也不触发产品版本升级。

## 设计结构

首页画板 `I0RAl`，名称「00 介绍首页 · 科技朋克 · /」，位于 `(-1520, 0)`，实际尺寸 1440 × 3002，273 个命名图层。

| 分区 | 内容 | y / 高度 |
| --- | --- | --- |
| 顶部导航 | ZHINEXUS 字标、首页、组件画廊、接入文档与浏览入口 | 0 / 96 |
| 首屏主视觉 | 「将灵感，编译成未来。」、青紫光场、悬浮柱状图、占比卡与安装示意 | 96 / 660 |
| 技术生态 | Vue 3、React 19、ECharts 6、TypeScript | 756 / 104 |
| 资产展示 | 趋势卡与排行示意、发现资产、沙箱预览、精确接入 | 860 / 759 |
| 双框架介绍 | Vue/React 原生实现、独立检查记录、共享核心能力 | 1619 / 467 |
| 接入流程 | 发现资产 → 沙箱预览 → 精确接入 → 本地验证 | 2086 / 437 |
| 最终行动 | 「你的下一个作品，从这里开始。」与探索入口 | 2523 / 343 |
| 页脚 | 品牌、文档、组件画廊及管理控制台入口 | 2866 / 136 |

文字、图表、网格、卡片和装饰均为可编辑原生图层，无位图背景依赖。主要配色为 `#06080E`、`#5EEBFC`、`#9A80FF`、`#96A6B9`、`#F1F5FA`；流程分区使用浅冷青 `#C7DCDD`，形成长页节奏。预览：[首页 PNG](previews/2026-11-23/I0RAl.png)。

## 实际操作与验证

1. 使用 Pencil 官方 stdio MCP 连接实际活动的 Antigravity IDE 会话；`get_app_state` 确认已登录及活动 URI 为 `docs/design/gallery.pen`，不只依赖 `filePath` 参数。
2. 新增前读取三张画板全树、变量和诊断，与上一轮拆分后的 MCP 基线严格比较一致。新增首页位于原画板左侧，原三张画板不移动、不改名、不改子图层。
3. 使用 MCP 创建与检查首页，逐分区及全页 `TakeScreenshot` 检查，并以 `Export`、`scale: 1` 导出 1440 × 3002 预览，视觉检查未见布局塌陷、裁切或溢出。
4. 通过 IDE 文件菜单保存 `gallery.pen`，确认未保存标记消失；关闭该设计页签并从 Explorer 重新打开，MCP 再次确认活动 URI 和四个顶层 ID。
5. 在 MCP 返回的 JSON 上比较新增前、保存前及重开后的完整树；终端不读取、解析或改写 `.pen` 原始内容。终端仅处理 MCP 返回数据、文件摘要、PNG 和 Git/文档检查。

| 检查 | 实际结果 |
| --- | --- |
| 顶层顺序 | `I0RAl`、`oBjp6`、`BTiJR`、`VyIbV` |
| 原三张画板 | 275 个图层的 ID、名称、文案、样式、顺序、位置和尺寸严格等于新增前基线；变量不变 |
| 保存与重开 | 所有原画板严格相等；首页仅四个流程编号文本的默认字重从未显式定义规范化为 `fontWeight: "normal"`，其余全部属性严格相等 |
| 默认字重差异 | 仅 `DhiHg`、`R3zxRZ`、`u6axn`、`IJQv1`；逐节点断言其余属性相等，不放宽其他比较 |
| 图层诊断 | 首页 273 个命名图层，全文件 548 个图层；无裁切、未命名或未完成占位问题 |
| 持久化渲染 | 重开后再次导出到临时目录，PNG 与交付预览字节完全一致，均为 1440 × 3002 |
| 后台与原始架构文档 | SHA-256 与新增前基线一致 |
| 文档与交付检查 | 本地 Markdown 链接目标均存在，旧三张 PNG 无 Git 差异；`git diff --check` 通过 |

实际完整树读取表达式：

```js
const roots=Get((n,c)=>c.depth===0?n.id:undefined);
Print({roots:roots.map(id=>Get(id,{includePathGeometry:true})),variables:GetVariables(),problems:Get((n,c)=>c.problems?{id:n.id,problem:c.problems}:undefined)});
```

实际首页诊断表达式：

```js
Print({bounds:Get("I0RAl",(n,c)=>c.depth<2?{id:n.id,name:n.name,bounds:c.bounds}:undefined),problems:Get("I0RAl",(n,c)=>c.problems?{id:n.id,name:n.name,problem:c.problems}:undefined),unnamed:Get("I0RAl",n=>!n.name?n.id:undefined),layers:Get("I0RAl",n=>n.id).length});
```

MCP 返回数据的本机 Python 断言输出：

```text
PASS: saved/reopened trees equal except 4 explicit default fontWeight normal values; original 3 roots/275 layers strictly unchanged; variables unchanged
PASS: homepage 273 named editable layers; total 548; 0 clipping/unnamed/placeholder problems
PASS: homepage bounds (-1520,0,1440,3002), PNG 1440x3002; saved/reopened export byte-identical; protected hashes unchanged
```

交付检查命令：

```powershell
Get-Item docs/design/gallery.pen, docs/design/previews/2026-11-23/I0RAl.png
Get-FileHash docs/design/gallery.pen, docs/design/management-api.pen, component-platform-architecture.md -Algorithm SHA256
git diff --check
git diff --name-only
git status --short
```

本地 Markdown 链接另由脚本逐个解析并调用 `Test-Path` 检查；提交前只暂存本轮五个交付文件，不包含本机 MCP 辅助脚本或临时截图。

## 最终摘要

| 文件 | SHA-256 |
| --- | --- |
| `gallery.pen`（267,943 字节） | `F77B27D139D8E66C321321E475B0113F16E002AA0018D02AA1AD65A3B66CA8E3` |
| 首页 PNG（350,577 字节） | `D6ECC9C0E00D7E62E81FC75E21DA7EBE9ADCBCE1F71D69A46FDA7ECACDA19805` |
| `management-api.pen`（未变） | `D442C2607D883A2815677E5C4BB46E14D6C2BBBFA087A2D1FF79E07162CD62E5` |
| `component-platform-architecture.md`（未变） | `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723` |

## 未覆盖边界

首页是静态概念设计，不代表现有 `/` 路由已实现。导航、筛选、按钮和沙箱为视觉表达；未增加移动端画板、React 独立详情、动画或交互原型。图表数据为示意，不宣称真实资产数量、发布状态、Ready、检查通过或兼容性验收。

终端展示的 `@company/charts-react@<version>` 是精确版本命令的设计占位，需选择资产并替换，不可直接复制执行。接入流程强调本地构建与检查，不将任何组件构建或截图浏览器引入服务端。

没有业务行为变更，因此未运行应用构建、单元、浏览器或 API 集成测试，未修改或重标实施任务、门槛及历史验证结果；未上传、发布组件或推送 Git。
