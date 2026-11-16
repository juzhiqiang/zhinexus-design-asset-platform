# 二期设计 ID 确定性匹配集成验证

日期：2026-11-15 至 2026-11-16（Asia/Shanghai）。C 工作区分支 `feat/phase2-id-mapping`，基线 `e5f7e7ef`。用户已确认本期不接大模型，真实设计 ID 规则尚未确定。本记录补充历史证据，不改写 A/B 或此前契约验证记录。

## 交付与协作

- C：`487d1ad9` 调整范围、`f8639d4c` 输入契约、`01e95e16` 装配/组件 API 契约、`e6e9a639` 确定性 API 服务。
- A（Antigravity 桌面）：独立工作区交付 `840fd5eb`、`4eee8872`，C 按指定文件集成并补强评估校验与组件约束说明，形成 `1e6b8c8e`。审计 7 类图表 × Vue/React 的真实源码类型，生成新的 ComponentApiV1 材料；不改写历史冻结产物。
- B（Claude 桌面端）：交付配置、元素清单、绑定输入、HTTP 客户端和浏览器测试；交接原文见 [B 记录](b-phase2-design-id-match-2026-11-15.md)。C 集成后补齐 React DOM 传递、未添加草稿拦截、参数/事件/布局/样式/notes 展示及响应语义核对。
- 两位独立审查者分别检查后端/contracts、A API 与评估器，并补查前端。阻断问题均已覆盖失败测试并修正；没有待处理的阻断审查项。

## 测试过程与审查修正

后端最初 22 项失败、HTTP 缺路由返回 404；实现后对应套件通过。后续审查新增失败用例覆盖缺口约束、精确预期目标、错误 designId、最长 API 字段、响应预算等。C 在复制 A 实现之前执行缺实现测试确认 RED；A 原工作区未实际执行测试，不能倒推为 A 自身完成了原始 TDD。B 也由 C 宿主先确认缺模块 RED，再集成实现；A/B 原始记录保留其实际限制。

关键修正包括：请求规范化摘要绑定完整输入；最终资格批量复读后撤权清除材料和依赖；不支持的历史 API 返回显式缺口；未知 ID 不通过文本评分替代；依赖冲突不任意选版本；大响应以 LIMIT_EXCEEDED/413 拒绝而非裁剪。客户端不能将服务端自报的 inputDigest 当作内容签名，另行核对规则修订、上下文、实例集合、designId、指定目标及用户声明的绑定；编辑和会话变化取消在途结果。

过程中的一次根测试与审查 RED 用例新增时间重叠，出现 13 失败/977 通过，不作为成功证据；最终在源码固定后重跑。一次浏览器测试把删除两元素之一误断言为零，修正为剩余 node-2 并限定删除按钮范围。根 tsc 的一次命令受 PowerShell `-p` 参数绑定影响未执行；改用显式 `-PnpmArgs` 数组后正常完成。

## 实际验证

均使用仓库 `.tools` 中 Node 26.13.0 / pnpm 12.18.0，通过 `scripts/pnpm.ps1`；测试不使用 Turbo 缓存。

| 命令（省略 `.\scripts\pnpm.ps1` 前缀） | 实际结果 |
| --- | --- |
| `exec turbo run build typecheck --force` | 全图 20/20，0 缓存命中 |
| `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | exit 0，含最终真实联调/评估测试 |
| `test` | Vitest 62 文件、1041/1041；Node 159 通过、7 跳过、0 失败 |
| `exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching.test.ts tests/platform/search.test.ts` | 最终 9/9，20.77s；真实隔离 PG/MinIO/Verdaccio/OIDC 测试设施 |
| `exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching-gallery.test.ts` | 1/1，8.47s；设置 PHASE2_GALLERY_ORIGIN 并启动真实 Gallery preview |
| `exec playwright test --config tests/playwright.config.ts tests/browser/phase2-design-match.spec.ts tests/browser/phase2-search.spec.ts tests/browser/contracts-runtime.spec.ts` | 53/53，12.8s；包含 375px 布局、旧响应/身份变化、草稿和绑定展示 |
| `verify:workspace` | 10 成员、无循环、4 公开包与服务端依赖边界通过 |

真实页面联调通过透明代理访问隔离 Nest API，不编造匹配响应；从已发布测试材料显示 ChartData、sales、onPointClick、showDetail、布局、whenRendered 和样式入口，撤权后无目标/依赖残留。截图保存在忽略目录 `test-results/phase2-id-live-gallery.png`，已目视检查。测试用包是协议合成包，不是实际业务设计资产。

本地完整日志保存在忽略目录 `.tools/phase2-final-root.log`、`phase2-force-graph.log`、`phase2-final-browser.log`、`phase2-final-platform.log`、`phase2-live-gallery.log`；不提交依赖、构建产物、密钥和日志目录。

## 实际 API 评估与规模量测

`tests/platform/matching.test.ts` 将真实 API 方案交给 `evaluateIdMatching`，而不是只评估手写成功响应。10 个 synthetic 案例包括 Vue、React、多实例、未知 ID、缺框架映射、错框架目标、错 peer、缺失/未知绑定、撤权和损坏材料；另有重复同目标与冲突目标 2 个输入返回 400。

- synthetic：精确命中 5/5（100%），硬违规 0，缺口遗漏 0，passed=true。
- real：0 案例，正确率 N/A，passed=false；总体 passed=false。评估器单测中的 `origin:'real'` 是分类逻辑 fixture，不能作为真实业务样本。
- 逐例 ID 与汇总 JSON：`.tools/id-matching-evaluation.json`。总体字段按既有定义只表示 real 门槛，工程门槛须另外检查 synthetic.passed；本次两者明确分离。

| 合成新增发布记录 | ID HTTP 响应（全部精确命中） | 文本索引总记录 | 文本 HTTP 响应（返回 Top-50） |
| --- | --- | --- | --- |
| 200 | 409ms，200/200 | 203 | 33ms |
| 1000 | 1796ms，1000/1000 | 1003 | 25ms |

种子发布记录分批加入真实 PG，复用同一作业冻结 API/docs，另有 3 条基础记录；不代表完成了 1000 次注册表真实发布。ID 批次引用同包不同版本，正确返回 DEPENDENCY_CONFLICT 并清空依赖；命中正确不等于可安装。文本检索重建索引后量测，Top-50 截断显式报告。本表为本机单次样本（JSON 位于 `.tools/id-matching-scale.json`），不是并发基准、p95 或生产 SLA。

## 执行判断与未覆盖边界

- 计划的 `apps/gallery/src` 修正为实际 `apps/gallery/app`；不改变功能范围。
- 文本候选选择后由用户显式编辑规则 JSON，本轮没有自动回写候选 UI。不会隐式覆盖未知 ID；具体设计导出连接器等真实格式确认后实施。
- API、画廊、CLI 按各自版本升级；平台根本轮未新增独立运维行为，沿用既有 0.0.5；SDK 源码与版本不变。
- 正式 ID 命名/命名空间、导出格式、规则维护方、真实业务样本均未提供。T14 真实业务验收保持开放，不再将模型或模型密钥列为阻塞。
- 绑定 source/handler/layout 是用户声明，不执行、不证明业务类型正确；本期不包含三期的项目安装或代码写入。
- 旧冻结材料不会自动迁移；需新版本材料才能使用新装配能力。生产部署、公司真实 OIDC 与真实项目验收不能用本机隔离服务测试替代。
- 原架构 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
