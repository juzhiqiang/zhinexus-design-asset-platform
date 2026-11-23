# 2026-11-23 画廊配色与背景动效精修验证

## 用户反馈与范围

用户认为此前配色灰蒙蒙、首页纯黑单调，要求提高色彩质感并增加轻装饰动效。本轮仅处理 B 的画廊设计资产：独立 [gallery.pen](gallery.pen) 首页 `I0RAl`、相邻 [背景 shader](shaders/gallery-atmosphere.glsl)、说明及新预览。灰银试稿未保存；正式交付为第四版，临时辅助文件中的 `v5` 不是交付版本号。

保留第三版的 [验证记录](2026-11-23-gallery-chart-refinement.md) 与预览，不重写历史。没有修改应用代码、公共契约、产品版本、管理后台或原始架构文档；不改变 T07/G1/G2 状态，不触发产品版本升级。工作区中身份服务相关已有修改未纳入本轮提交。

交付：[第四版全页](previews/2026-11-23/I0RAl-v4.png)、[图表局部](previews/2026-11-23/hly06-v4.png)、[首屏局部](previews/2026-11-23/DkEmJ-v4.png)。PNG 为静态代表帧，动效在设计背景层中表达，不代表应用首页已经实现。

## 设计变更清单

- 两张图表卡片 `ZYukF`、`nq7Y5` 共 172 个原有节点中，126 个实际改变颜色：趋势卡 50 个、柱阵卡 76 个。范围包含两卡容器、环境反射、折射边、玻璃底板、光带、金属顶面/侧面/倒角、反光和投影；仅改变 `fill`、`stroke`、`effect` 中的颜色值，保留所有几何、文案、名称、尺寸和层序。
- 趋势卡采用深蓝玻璃与冰蓝光带；柱阵采用钴蓝金属，后几柱加入鸢尾紫反射，不改变用户认可的第三版造型。
- 首页根与八分区底色改为 `#080D1C` 午夜蓝。`pRusn` 标题为白至冰蓝渐变，`o6KsZ` 调整环境光。
- 禁用旧淡出矩形 `XAR4t`、`Zd0uU`，消除首屏雕塑周围的矩形接缝；节点保留而非删除。
- 更新根节点 `context` 为第四版设计说明，不改变业务文案或行为；未改动根尺寸、位置及原分区顺序。
- 新增五个全宽底层 shader 矩形，均位于对应分区 `children[0]`，不遮挡文字与图表。

| 新层 ID | 分区 | 尺寸 | `u_mode` | 装饰表达 |
| --- | --- | --- | --- | --- |
| `OCSdm` | `DkEmJ` 首屏 | 1440 × 720 | 0 | 右侧慢漂光场、稀疏微粒、双细轨道与游光 |
| `R300D` | `hly06` 资产 | 1440 × 760 | 1 | 蓝紫环境、微粒和靠下的细光轨 |
| `VlbXZ` | `PCMzl` 双框架 | 1440 × 520 | 2 | 慢漂光场与微粒，不重复画曲线 |
| `tYduq` | `T9z2vN` 流程 | 1440 × 460 | 3 | 低强度光场与微粒，保留原流程连线 |
| `y9NFa` | `s2C4PL` 行动 | 1440 × 360 | 4 | 收束光场、微粒与靠下的游光轨迹 |

Shader 使用 WebGL1 / GLSL ES 1.00，无纹理或鼠标绑定。`@time u_time` 驱动缓慢变化，所有时间项受 `u_speed` 控制；`u_speed=0` 手动冻结，`u_frame` 选择代表帧。新增层的完整填充为午夜蓝兜底及启用的 shader；所有层均引用相对路径 `shaders/gallery-atmosphere.glsl`，应与 `.pen` 一起保留。

## 实际操作与证据

1. 使用 Pencil 官方 stdio MCP 连接真实活动的 Antigravity IDE，确认登录状态及 `docs/design/gallery.pen` 活动文件。未通过 Shell 读取、解析或改写 `.pen` 原始内容；临时脚本只解析 MCP 返回快照，对 `.pen` 仅检查文件属性、摘要及 Git 元数据。
2. 在第三版完整树基础上调整配色和背景。检查全页与局部，禁用旧淡出矩形；双框架与流程分区不再重复绘制经过正文的曲线。
3. 通过 IDE 保存，确认未保存标记消失；关闭页签后从 Explorer 重开，重新读取完整树和诊断。保存前后完整树严格相等，未忽略属性或放宽比较。
4. 重开后导出全页、资产和首屏原尺寸 PNG，实际查看全页与首屏。复制为新的 `*-v4.png`，没有覆盖历史文件。
5. 收取独立只读审查后，收紧范围验证：颜色白名单由整棵 172 层子树缩为明确的 126 个实际变色 ID；其余卡片节点必须严格不变。补充根 `context` 精确值、九处底色和五层完整填充、启用状态、构图模式及全部 uniforms 的断言。
6. 再次通过 MCP 读取完整树，确认与保存前、重开后严格相等。重新执行范围脚本和本机 Playwright WebGL1 shader 检查，确认所有结果通过。

| 检查 | 实际结果 |
| --- | --- |
| 保存与再次读取 | 保存前、关闭重开后、交付前再次读取的完整 MCP 树严格相等 |
| 原画板与变量 | 原三画板 275 层和变量严格不变 |
| 首屏雕塑 | 1860 个原生路径及雕塑子树严格不变 |
| 图表范围 | 126 个明确 ID 仅材质颜色变化；其余 46 个卡片节点严格不变 |
| 既有节点 | 总计 139 个节点变化，其中图表 126 个；没有删除节点 |
| 新增层 | 仅五个指定底层矩形；尺寸、父层、顺序、兜底、启用、相对 URL 和 uniforms 符合清单 |
| 图层数 | 首页 2184，资产 186，全文件 2459，四张画板 |
| 诊断 | 无裁切、未命名或未完成占位 |
| 布局 | 首页仍为 `(-1520,0,1440,3196)`；两卡位置、尺寸、几何与层序不变 |
| PNG | 全页 1440 × 3196、资产 1440 × 760、首屏 1440 × 720；交付与选定的重开导出逐字节一致 |
| 重复导出 | 全页、首屏逐字节一致；资产第二次导出有 4 个像素不同，范围 `(747,391)`–`(751,399)`，另行查看确认无可见布局差异；不宣称所有重复导出字节一致 |
| Shader | 编译、链接和五种模式绘制均通过，无 WebGL 错误 |
| 时间与冻结 | 每种模式 t=0 与 t=10 均有像素变化；`u_speed=0,u_frame=5` 时两帧逐像素一致 |
| 保护文件 | 管理后台及原架构摘要不变，第三版预览和历史记录没有 Git 差异 |
| 文档与 Git | 本轮 Markdown 本地链接目标、PNG 尺寸、摘要、提交范围及 `git diff --check` 检查通过 |

独立本机 WebGL1 像素比较实际输出（RGB 均差为 0–255 通道尺度）：

| 模式 | 时间变化像素数 | 平均通道差 | 冻结变化像素数 |
| --- | --- | --- | --- |
| 0 | 608095 | 0.452413 | 0 |
| 1 | 692283 | 0.436223 | 0 |
| 2 | 497640 | 0.503589 | 0 |
| 3 | 348766 | 0.323407 | 0 |
| 4 | 278405 | 0.380105 | 0 |

MCP 导出仅输出单帧静态 PNG。交付前重复导出时，全页和首屏字节相同，资产局部出现上述 4 像素差异；差异原因未确认，保留原选定预览及其摘要，没有改写原导出或将比较冒充完全一致。重复导出不能作为编辑器自动播放证据。时间变化证据来自独立本机 WebGL 驱动，而非完整 Pencil 播放性能验收。

实际命令（`$p` 是工作区外临时辅助目录，`$py` 为 Codex 配套 Python；辅助文件不提交）：

```powershell
& $py "$p\mcp_client.py" antigravity get_app_state
& $py "$p\mcp_client.py" antigravity execute "$p\baseline-args.json" v5-reopened.json
& $py "$p\mcp_client.py" antigravity execute "$p\check-home-args.json" v5-reopened-diagnostics.json
& $py "$p\mcp_client.py" antigravity execute "$p\v5-delivery-args.json" v5-delivery-final.json
& $py "$p\mcp_client.py" antigravity execute "$p\baseline-args.json" v4-delivery-reverified.json
& $py "$p\mcp_client.py" antigravity execute "$p\v4-reexport-args.json" v4-delivery-reexport.json
& $py "$p\verify-v4.py" --reopened
$env:PLAYWRIGHT_BROWSERS_PATH=(Join-Path $PWD '.tools\playwright')
& '.\.tools\node-v26.13.0-win-x64\node.exe' "$p\verify-shader.cjs"
& $py "$p\check-v4-delivery.py"
git diff --check
git diff --stat
git status --short
git diff --cached --name-only
git diff --cached --check
```

完整树读取与导出通过官方 MCP 执行：

```js
const roots=Get((n,c)=>c.depth===0?n.id:undefined);
Print({roots:roots.map(id=>Get(id,{includePathGeometry:true})),variables:GetVariables(),problems:Get((n,c)=>c.problems?{id:n.id,problem:c.problems}:undefined)});
Export(["I0RAl","hly06","DkEmJ"],"png",exportDir,{scale:1});
```

## 独立只读审查与处理

审查没有发现 shader 或首屏、资产预览阅读体验的阻断问题，确认光晕、轨道和微粒未明显干扰正文，原画板、变量、雕塑、卡片非颜色属性与原层序保持不变。

审查指出两处验证缺口：颜色白名单覆盖 172 层且范围说明未明确容器、环境反射和根说明变化；新增背景断言未覆盖完整填充、启用和各模式。主代理核实后按上述清单准确记录实际 126 个变色节点，并收紧自动断言、重新执行通过；未因此修改设计或扩大业务范围。审查只读，未操作编辑器、读取 `.pen` 原文或触碰业务文件，未重演保存重开和全页动态播放。

## 文件摘要

摘要为交付时磁盘 SHA-256；Git 按现有 `.gitattributes` 正常处理文本行尾，未修改行尾规则。

| 文件 | 字节 | SHA-256 |
| --- | --- | --- |
| `gallery.pen` | 2104793 | `5DFD59249CEFE8BD51C3F47ECB67D21B6A1EDD1B257F97215F4128F211F16DCB` |
| `gallery-atmosphere.glsl` | 4037 | `39A44A392539F55751A604D5A9C02A05ED5E7F4D8FC3513E27935034CDECDBA4` |
| 第四版全页 PNG | 2059922 | `8B6E667AA7A7ED66FE8B5D52C5062C99E01F3448AA7675D5ED6765DA8EDE7232` |
| 第四版资产 PNG | 619026 | `907B37ECDDEE1ACD771076864FDBB1F41395F4FF8DAA2382F84EE49D330D35BC` |
| 第四版首屏 PNG | 591561 | `2B4DE1331F2D7A90AD2CBAA1DF025EF1CABB740F1335B07F9549EC2F011134B1` |
| `management-api.pen`（未变） | 557739 | `D442C2607D883A2815677E5C4BB46E14D6C2BBBFA087A2D1FF79E07162CD62E5` |
| 原始架构文档（未变） | 33439 | `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723` |

## 未覆盖边界

本轮为设计资产和局部 shader 技术验证，不是应用交互实现。未接入系统 `prefers-reduced-motion`，仅提供手动冻结；未验收完整编辑器播放、全页 GPU 性能、离屏暂停、移动端、应用首页路由、交互或 API 集成。首屏雕塑保留原有矢量分片细节，没有重新建模。没有上传或发布组件，图表数字仍为示意，不代表 Ready 或兼容性状态。

没有业务行为变更，未运行应用构建、单元或服务集成测试；未改写历史记录，未升级包版本，未执行 Git push。
