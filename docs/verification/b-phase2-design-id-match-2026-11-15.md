# 二期 ID 规则匹配：设计 ID 配置输入与装配方案界面实现与验证交接

- 日期：2026-11-15
- 执行人：B（apps/gallery 负责人）
- Worktree：`C:\Users\10208\.codex\worktrees\b-phase2-design\zhinexus-design-asset-platform`
- 分支：`feat/phase2-id-gallery`
- 契约基线：`01e95e16 feat: 定义确定性装配方案与版本化组件 API 契约`（C 冻结 `POST /v1/matching/plans` 协议）
- 性质：GREEN 实现（3 个实现文件 + 3 个测试文件 + 本记录）。**未做任何 Git 操作**；Windows 固定工具链验证、审查、提交与版本收口由 C 负责。

## 1. 交付物

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/gallery/app/(console)/match/design-id-input.ts` | 新增 | 规则 JSON 解析、元素清单组装、按 designId 分组、界面提交入口（纯本地，无网络） |
| `apps/gallery/app/lib/match-plan-client.ts` | 新增 | `requestMatchPlan` 装配方案 HTTP 客户端（含 inputDigest 核对） |
| `apps/gallery/app/(console)/match/DesignIdMatch.tsx` | 新增 | 设计 ID 配置输入 + 装配方案展示子组件 |
| `apps/gallery/app/(console)/match/page.tsx` | 改 | memo 化上下文本地校验结果并挂载 `DesignIdMatch`（+21/-2） |
| `tests/gallery/design-id-input.test.ts` | 新增 | 18 项输入构造单测 |
| `tests/gallery/match-plan-client.test.ts` | 新增 | 20 项客户端单测 |
| `tests/browser/phase2-design-match.spec.ts` | 新增 | 31 项浏览器测试 |
| `docs/verification/b-phase2-design-id-match-2026-11-15.md` | 新增 | 本记录 |

未改：`packages/contracts`、根配置（`vitest.config.ts` / `tsconfig.json` / `tsconfig.base.json`）、锁文件、版本号、`auth`、`globals.css`、既有测试、`apps/api`、`packages/component-cli`。

## 2. 实现要点

### 2.1 `design-id-input.ts`（纯本地，零网络）

- `parseMappingJson(raw)`：JSON 解析 + 契约 `validateDesignIdMapping`；语法失败只返回**单条固定文案**（`MAPPING_JSON_SYNTAX_ERROR`），不带解析器原文；
- `buildDesignIdInput({mapping, elements})`：白名单组装 `{schemaVersion:1, mapping, elements}` 后交 `validateDesignIdInput`，重复映射/实例、未知字段、空白或超长 ID 都以 `/mapping/...`、`/elements/...` 前缀路径返回；
- `groupElementsByDesignId(design)`：**必须用 `Map`**——designId 是不透明字符串，可能是 `__proto__` / `constructor` 等原型键形状，用普通对象累加会污染原型或触发原型链遍历；
- `buildDesignForm({mappingText, elements, bindingsText})`：界面提交入口，顺序为「规则 JSON 语法 → 完整输入校验 → 绑定 JSON 语法」；空绑定（空文本或空数组）按**省略**处理；
- ID 一律原值：不 trim、不转大小写、不切分、不按正则或路径解释。

### 2.2 `match-plan-client.ts`

- `POST {apiUrl}/v1/matching/plans`，`authorization: Bearer <token>`、`content-type`/`accept: application/json`；
- 白名单构造请求体：`reactDomVersion` 仅非空白时出现，`bindings` 仅非空数组时出现——**空键会同时破坏载荷键集合与 inputDigest**；
- 请求体先过 `validateMatchPlanRequest`，非法输入本地即拒、不发请求；
- 响应用 `validateMatchPlan` 解析，并**先核对 `inputDigest`**：必须等于本地对完整请求计算的 `manifestDigest`，不一致返回 `reason: 'stale'` 并丢弃（先于 schema 判断，避免把不符输入的响应当成本次结果）；
- 取消语义：fetch 前、`await fetch` 后、`await json` 后三处检查，已取消一律 `AbortError` 原样上抛，不依赖 fetch 实现是否配合 `signal`；
- 失败分类 `invalid-input` / `unauthorized` / `unavailable` / `invalid-response` / `stale`；仅 `invalid-input` 附带契约 issues（安全字段路径，不含用户输入值），其余一律固定文案，不回显服务端原文、token 或 schema 原文；
- 无任何 `localStorage` / `sessionStorage` 写入。

### 2.3 `DesignIdMatch.tsx` + `/match/page.tsx`

- 输入面：`#design-mapping-input`（显式规则 JSON）、`#design-instance-input` + `#design-design-id-input` + 「添加元素」/`#design-elements-list`、`#design-bindings-input`（可选绑定 JSON）、`#design-submit`；
- **只有显式点击「生成装配方案」才 POST**；编辑规则/元素/绑定、本地校验、切换检索均不触发；
- 旧结果失效：沿用 B3 已验证的「请求代次 + `AbortController` + token/subject 身份快照」三层守卫，覆盖规则 JSON 编辑、元素增删、绑定编辑、项目上下文变化（父级 memo 引用变化即触发）、退出登录、身份切换、组件卸载；
- 提交前从 `getStoredSession()` 复核 token/subject，失效则不发请求并交父级 `invalidateSession()` 回退登录门；响应落地与错误落地同样复核，**绝不残留 loading 或旧身份数据**；
- 方案展示只呈现服务端返回的真实内容：`packageName@packageVersion`、导出名/路径、兼容状态与 recordIds、api/docs 证据、示例、精确依赖、缺口 code/message；不生成任何链接，不编造结论；
- `mapped` 明确标注「仅表示目标发布材料可映射，不等于可自动接入或完成业务验证」；空设计走 `EMPTY_DESIGN` 缺口而不是成功态；
- 全程不使用图片识别或大模型，不把文本需求自动标为满足，不做三期代码安装；
- 父级仅新增 memo 化的 `contextCheck` 与挂载点，B1 本地校验与 B2/B3 文本检索行为原样保留。

## 3. 测试覆盖对应

单元（38 项）：不透明 ID 原值往返（含 `' ID '`、`'id'`/`'ID'`、`'../line'`、`'a.*'`、`'__proto__`、`'constructor'`）、分隔符与大小写不假设（`line` / `line:1` / `line/1` / `line-1` / `line.1` / `Line` 视为六个不同设计）、重复映射（即使目标相同）与重复实例拒绝、同 designId 多实例复用、未知 designId 放行、空配置放行、`/mapping` 前缀口径锁定、原型键不污染、载荷键集合恰好 `{design, context}`、本地校验失败零请求、`inputDigest` 一致/不一致、401/403、5xx、非 JSON 响应、schema 不符、空设计缺 `EMPTY_DESIGN`、三处取消检查点。

浏览器（31 项）：登录门与输入面、未登录不暴露、空配置不称为成功、规则 JSON 语法/未知字段/重复映射/重复实例本地拒绝且零请求、未知 designId 交服务端、只有显式点击才 POST、载荷无模型/OCR 键、可选绑定发送与非法/引用不存在本地拒绝、多实例三行不合并、mapped 目标与证据展示且无链接、`inputDigest` 一致/不一致、`EMPTY_DESIGN` 诚实空态、401/403、5xx 与非法响应固定文案、规则/元素/上下文/绑定编辑取消在途并清结果、退出登录、同页改 token 不发请求、同 subject 换 token 清理、storage 事件清理、HTML 转义、375px 无横向溢出、无模型/OCR 表述、不持久化设计配置。

## 4. 实际运行情况（如实记录）

**沙箱内未运行 vitest / playwright / tsc / next build。** 本沙箱无 `node_modules`、无 Windows 固定工具链，因此：

- 单测与浏览器测试的 RED 由 C 宿主实跑确认（`.tools/b-red.log`：两个 suite 因实现缺失失败）；
- GREEN 后的 38 项单测与 31 项浏览器测试、gallery 构建、根 typecheck/tsc、全图验证**均需 C 宿主执行**，本记录不代为宣称通过；
- 沙箱内仅用全局 `tsc` 做了语法与内部类型检查（把 `@company/contracts` 映射到源码、屏蔽 `react`/`vitest`/`@playwright/test` 缺失后）：新增/修改文件无真实类型错误；同时按此方式发现并修正了两处**我自己的测试缺陷**（见第 5 节）。

## 5. 自测发现并已修正的测试缺陷（非实现缺陷）

1. `design-id-input.test.ts` 的「`/mapping` 前缀口径」一例原先在失败结果上取 `value`，运行期恒为 `undefined`，即使实现正确也必然失败。已改为显式构造重复条目对象，并同时锁定顶层 `/entries/...` 与嵌套 `/mapping/entries/...` 两种路径。
2. `phase2-design-match.spec.ts` 有三例（未知 designId、多实例复用、HTML 转义）用**单元素**请求的摘要给多元素/异 designId 的响应签名，会被 `inputDigest` 校验正确判为 stale 而失败。已改为按当次元素清单计算摘要。

## 6. 未覆盖边界

- 真实服务端（Nest `apps/api/matching`）尚未联调：协议一致性、真实发布定位、撤权、材料读取后再校验均未验证；
- 未测「手动选候选必须显式更新配置」的交互（Task 3 要求，需 C 先冻结候选选择回写协议）；
- 未做三期代码安装/写入；
- 真实设计 ID 命名规范、设计平台导出格式与真实样本仍未到位，业务级正确率评测保持开放；
- gallery 版本升版（当前 `0.0.7`）与 CHANGELOG 由 C 收口。

## 7. 需 C 注意

- 工作区存在未跟踪目录 `.tools`（宿主 RED 日志所在），B 未创建也未触碰，请 C 核实清理或纳入忽略规则；
- 若希望空 `bindings` 数组也显式发送（当前按省略处理），需同步修改 `match-plan-client.ts` 的 `buildRequestBody` 与对应测试；
- 计划 Task 3 描述中的 `apps/gallery/src/` 与实际 `apps/gallery/app/` 不一致，建议修正计划措辞。
