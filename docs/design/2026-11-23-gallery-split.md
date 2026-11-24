# 2026-11-23 画廊与管理后台设计文件拆分验证

用户确认公开组件画廊应使用独立 `.pen` 文件。本轮将已有九张画板按职责拆分，不重画页面，不修改应用代码、公共契约、包版本或历史验证记录。职责属于 B 的 T07 设计交付整理，不改变 T07/G1/G2 验收状态。

## 操作与保护措施

1. 使用 Pencil 官方 MCP 的 stdio 接口连接实际展示九张画板的 Antigravity IDE 会话；`get_app_state` 确认登录及活动文件。读取完整九张画板、变量和布局诊断作为拆分基线。
2. 在 IDE 中将完整文档另存为 `gallery.pen`，MCP 全树比较确认副本与原始九张画板完全一致后，才修改副本。
3. 从画廊副本移除六张后台画板。将原 07–09 改名为 01–03，x 坐标改为 0、1520、3040，y 坐标仍为 0；子图层不变。使用 `Ctrl+S` 保存并比较完整图层树。
4. 通过 Explorer 打开 `management-api.pen`，再次由 `get_app_state` 确认活动 URI，读取全树并断言仍与九张基线完全一致，才移除原文件中的三张画廊画板。变更操作还在 MCP 内断言九个顶层 ID 及其顺序，避免修改错误文档。
5. 保存后台，分别关闭并重新打开两个文件，通过 MCP 再读全部图层并比较持久化结果。全部 `.pen` 内容均通过 MCP 读取和编辑；终端仅用于文件元数据、摘要和 Git 检查，不直接解析或改写 `.pen` 文件。

以实际活动编辑器为操作目标；不能只凭 `filePath` 参数认定当前会话已切换到目标文件。

## 实际验证结果

| 检查 | 实际结果 |
| --- | --- |
| 另存完整副本 | 原九张画板与副本的 ID、属性、子图层、变量及诊断完全一致 |
| 原后台变更前比较 | 活动文件为 `management-api.pen`，九张完整树仍与基线完全一致 |
| 后台保存后与重新打开后的比较 | 六张完整树完全一致，且严格等于基线前六张：952 个图层，所有 ID、文案、样式、顺序、位置和尺寸保留 |
| 画廊保存后与重新打开后的比较 | 三张完整树完全一致；严格等于基线后三张，仅顶层名称编号和 x 坐标变化：275 个图层，分别 19、113、143 个 |
| 布局及图层诊断 | 两个文件无裁切问题或未完成占位；画廊无未命名图层 |
| `TakeScreenshot` | 检查拆分后的三张画廊画板及后台上传画板，未发现布局变化、塌陷或溢出；画廊内部结构严格相等，沿用原 PNG |
| 文件与链接检查 | 两个 `.pen` 非空，说明与 README 的本地文件链接存在，三张预览文件存在 |
| `git diff --check` | 通过，无空白错误 |
| 原始架构文档摘要 | 与工作前基线一致，原始字节未改变 |

完整树读取使用实际执行的 MCP 表达式：

```js
const roots=Get((n,c)=>c.depth===0?n.id:undefined);
Print({roots:roots.map(id=>Get(id,{includePathGeometry:true})),variables:GetVariables(),problems:Get((n,c)=>c.problems?{id:n.id,problem:c.problems}:undefined)});
```

比较在 MCP 返回的 JSON 上执行，不读取 `.pen` 的原始内容。后台结果严格等于 `{...baseline, roots: baseline.roots.slice(0, 6)}`；画廊结果严格等于原后三张顶层名称与 x 坐标调整后的树。重新打开后的结果还须分别等于各自保存后的 MCP 快照。

本机实际执行的交付检查命令：

```powershell
Get-Item docs/design/gallery.pen, docs/design/management-api.pen
Get-FileHash docs/design/gallery.pen, docs/design/management-api.pen, component-platform-architecture.md -Algorithm SHA256
git diff --check
git status --short
```

本地 Markdown 链接另以脚本逐个解析，并用 `Test-Path` 检查目标文件；提交前核对暂存范围，不包含本机 MCP 辅助脚本或临时截图。

## 最终设计文件

| 文件 | 顶层画板 | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| `management-api.pen` | WJaJh、w2KjC、b3Z0W、O2dU5Y、HMEZO、mxSWX | 557,739 | `D442C2607D883A2815677E5C4BB46E14D6C2BBBFA087A2D1FF79E07162CD62E5` |
| `gallery.pen` | oBjp6、BTiJR、VyIbV | 138,392 | `309FCF7786CE7AB314F5472F5628C9C926E2C63AB0E8665648A0C202CE9610C0` |

原始 `component-platform-architecture.md` SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 未覆盖边界

本轮仅验证静态设计资产的完整迁移与保存。未修改业务行为，因此未运行应用构建、单元、浏览器或 API 集成测试，未进行浏览器截图逐像素比较，未上传或发布组件。设计中的版本及状态仍为示例，不作为真实发布、Ready、授权、视觉基线或兼容性验收证据。React 独立详情和移动端画板不在本轮范围内。
