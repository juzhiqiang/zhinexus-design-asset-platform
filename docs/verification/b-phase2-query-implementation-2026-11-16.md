# 二期 P1 组件精确查询 GET 与 Gallery 查询入口（2026-11-16）

- 日期：2026-11-16
- 执行人：B（Claude 桌面端）
- Worktree：`C:\Users\10208\.codex\worktrees\phase2-b-query\zhinexus-design-asset-platform`
- 分支：`feat/phase2-b-query-api`
- 基线契约提交：`531173793fbbc23819874cbb7909dd7e8f789884`（`feat: 定义二期组件精确查询契约`）
- 规格：`docs/superpowers/specs/2026-11-16-phase2-query-completion-design.md`
- 计划：`docs/superpowers/plans/2026-11-16-phase2-query-completion.md` 的 P1

## 0-A. 修订记录（2026-11-16，C 初审后）

C 初审提出 5 项已复现/待确认缺陷。B **只新增了失败测试并暂停实现**，未改任何产品代码、未 stash、未 commit、未删文件。本节列出每项的复现方式与 RED 预期，供 C 宿主取证。

| # | C 的发现 | 复现方式 | RED 预期 |
| --- | --- | --- | --- |
| 1 | `queryComponentMatch` 的 `target` 直接 `...current.candidate`，把 `gaps` 等 `SearchCandidate` 字段带进 `MatchTarget`，严格 `additionalProperties:false` 会拒 | 集成用例「正常 matched 响应必须通过公开运行时校验」跑 `validateComponentMatchResponse(result)` | 当前实现末尾自校验即失败并抛 `INTERNAL_ERROR`，用例拿不到 `matched` |
| 2 | `readApi` 返回 null 时直接 `API_UNSUPPORTED`，缺最终 find/权限复查；撤权 + 读失败会泄漏存在性 | 集成用例「材料读取失败叠加撤权」：`artifact` 抛 `PlatformError('NOT_FOUND')` 同时把 `canRead` 置 false | 当前返回 `API_UNSUPPORTED`，应为同形 `TARGET_UNAVAILABLE` |
| 3 | `parseComponentMatchQuery` 先赋值普通 `{}` 再 `Object.keys` 白名单，`__proto__` 走原型 setter 被丢掉 | 集成/平台用例：`&__proto__=x`、`&%5F%5Fproto%5F%5F=x`、`&__proto__={"polluted":true}` | 当前 `result.ok === true`（键被静默丢弃），应 400 |
| 4 | 计划约定 `requestComponentMatch(query,{token,signal?,apiUrl?}): Promise<ComponentMatchResponseV1>`，B 之前给的是 outcome 包装 | Gallery 用例整体按新契约重写：直接 `await` 得到响应、失败 `rejects` 且带固定文案 | 当前返回 `{ok:...}` 对象、失败不抛错，全部相关用例失败 |
| 5 | `buildQuery` 对 `packageName`/`reactDomVersion` 做 `trim`，输入必须精确 | Gallery 用例 `buildComponentMatchQuery` 传带空格值；浏览器用例填 `'  @company/charts-vue  '` 期望本地拒绝且零请求 | 当前实现（`ComponentQuery.tsx` 内联 `buildQuery`）会 trim 后发出请求 |
| 补充 | `selectTarget` 用 `resolveRelease`（含 peer/Ready 过滤）消歧，把「可读但 peer 不符」的第二包过滤掉，掩盖跨包歧义 | 集成 + 平台用例：加入第二个**当前可读、Ready、peer 不符**的同版本包 | 当前返回 `matched`（只选中第一个），应 409 `CONFLICT` |

同时修正了 B 自测的一处接线错误：`queryComponentMatch(query, store, subject)` 的 `subject` 此前在多个用例里漏传；现已全部补上，并让 harness 的 `find` 断言 `subject` 为非空字符串、在纯读用例里核对实际收到的身份集合。

浏览器侧新增两条「输入空白不被静默 trim」用例（packageName 与 reactDomVersion 各一），预期本地拒绝且零请求。

### 0-A.1 编译/导入阻塞修复（2026-11-16，C 反馈 `build:services` exit 2 后）

只修阻塞，不改行为、不动第 0-A 节列的五项行为缺陷：

1. `component-query.ts` 的 SQL 行类型原先复用 `CurrentCandidateSnapshot['variant']` / `['package']`（检索快照语义，可选），导致 `row.package_metadata.peerDependencies`、`row.metadata.exportName/api/docs/screenshots` 报 possibly undefined。已改为数据库非空类型 `VariantRef` / `PackageRef` / `AcceptedCompatibilityRecord[]`（`release-manifest.ts` 中这些字段均为必填），并加注释说明为什么不复用快照类型。
2. `tests/integration/component-query.test.ts` 的 `parseComponentMatchQuery` 原先从 `component-query.js` 导入（符号不在那里）。已拆成两句：`parseComponentMatchQuery` 从 `component-query-routes.js` 导入，`queryComponentMatch` / `ComponentQueryStore` 仍从 `component-query.js` 导入。
3. 附带一处导入阻塞防护：`component-query-routes.ts` 是带 `@Controller`/`@Get` 装饰器的模块，而 `reflect-metadata` polyfill 原先只在 `app.ts` 首行导入。集成测试现在直接加载该模块（不经 `app.ts`），模块求值阶段就会抛错。已在该文件首行补 `import 'reflect-metadata';`（与 `app.ts` 一致，幂等无害；`apps/api/package.json` 已声明该依赖）。

沙箱侧只能用全局 tsc `--noResolve` 核对：第 1、2 项无残留本地类型错误；第 3 项在沙箱报 TS2882（沙箱读不到 `.pnpm/reflect-metadata` 符号链接），属环境噪音，`app.ts` 用同样的写法已通过宿主构建。

### 0-A.2 测试自身缺陷修复（2026-11-16，C 反馈 65 过 / 46 败后）

宿主 RED 已复现三项真实产品缺陷（target 夹带 → `INTERNAL_ERROR`、撤权 + 材料失败 → `API_UNSUPPORTED`、Gallery 28 项公开签名失败），旧 POST 24 项全过。同时 C 指出 6 处**测试自身**错误，本节只修这些，产品行为一行未改：

1. `harness()` 的返回值漏了 `add`，导致「新增歧义」类用例直接 TypeError。已补回。
2. `add()` 用传入的任意 `packageName` 去反查 fixture 模板包，新包名查不到 → `undefined`。已改为**克隆同框架模板包**后再覆盖 `name` / `version`，并按 C 要求同步设置 `variant.packageName`。
3. Vue 与 React 共用同一份 API 字节，React 的 API 身份校验必然失真。已按框架拆分独立的 `api/line-<framework>.json` 与 `docs/line-<framework>.md` 材料。
4. `parseComponentMatchQuery` 接收的是**完整 URL**（内部自行截 `?` 之后的部分），测试多处传裸 query 串，于是「空 query」分支先命中——`__proto__` 反例也因此假失败。已统一加 `?` 前缀（新增 `url()` 辅助），并单列一条「URL 完全没有 query 串」的真反例。
5. 材料摘要类用例原先直接改 `variant.api.sha256` / `docs.bytes`，而 `candidate.evidence` 没同步，资格复读先失败，结果本就是 `TARGET_UNAVAILABLE`，根本测不到材料层。已改为**保持 metadata 与 evidence 一致，只篡改 store 读出的字节**：API 走「evidence 同步指向一个 store 报 `NOT_FOUND` 的路径」，API 走「长度不符」，docs 走「同长度改末字节」专打 digest。
6. `exactDependencies` 的顺序契约未约定，原先用 `toEqual([...])` 钉死顺序。已改为 `toHaveLength` + `arrayContaining`（集成 2 处、平台 2 处）。

安全断言未做任何放宽：`__proto__` 三条、撤权 + 材料失败同形、可读但 peer 不符的第二包 409、跨包歧义、纯读与身份传递等断言全部保留。

### 0-A.3 最小实现修复（2026-11-16，宿主 RED 确认后）

宿主 RED：`112 项 = 72 过 / 40 失败`（query 60 中 12 失败、Gallery 28 全失败、旧 POST 24 全过），日志 `.tools/phase2-b-corrected-red.log`。三项真实缺陷复现确认：target 夹带 → `INTERNAL_ERROR`、撤权 + 材料失败 → `API_UNSUPPORTED`、Gallery 28 项公开签名失败。据此完成最小修复，**未动根/版本/契约**：

1. **target 逐字段构造，不 spread candidate**（`component-query.ts`）。`current.candidate` 上的 `gaps`、带 `source` 的截图 evidence 都不是 `MatchTarget` 成员，`matchTargetSchema` 是 `additionalProperties:false`，带进去必被拒。现在只取 12 个 `MatchTarget` 字段，`evidence` 只放 api/docs 两条（从 `variant` 取 path/sha256），`compatibility.recordIds` 拷贝为新数组。
2. **最终复查先于任何材料结论**。原顺序是「读材料 → `!api` 就返回 `API_UNSUPPORTED` → 再复查」，于是「读材料期间被撤权且材料恰好读失败」会先看到 `API_UNSUPPORTED`，等价于泄露目标存在性。现在复查（`find` + `selectTarget` + revision/variantReleaseId 比对）整体前移到材料读取之后、`!api` 判定之前。
3. **白名单落到解码后的 pairs 上**（`component-query-routes.ts`）。原先先建普通 `{}` 再 `Object.keys`，`record['__proto__']=v` 走原型 setter，键被静默丢弃。现在在 `pairs` 循环里先查白名单再查重复，之后才建对象；`__proto__` 因此稳定落到「未知查询参数」。
4. **歧义判定先于资格过滤**（`selectTarget`）。歧义集改为「`canRead` 为真的快照」，按 `packageName` 分组；跨包或同一包名多条记录即 409。peer / Ready / 废弃 / 状态只在唯一目标确定后用于判定该目标是否可用（不可用即同形 `TARGET_UNAVAILABLE`）。**这是一个需要 C 确认的判读**：字面规格是「同选择条件匹配多个**当前可读**发布 → 409」，所以可读但非 Ready/已废弃/peer 不符的第二包也计为歧义；若 C 认为非 Ready 应排除在歧义集之外，改一处 `if (!snapshot.canRead) continue;` 即可，但那样「peer 不符的第二包」反例就会重新变成 matched。
5. **客户端公开签名回到计划约定**（`component-match-client.ts`）：`requestComponentMatch(query, { token, signal?, apiUrl? }): Promise<ComponentMatchResponseV1>`，失败抛 `ComponentMatchRequestError`（带 `reason` / 安全 `issues` / 固定 `message`）；`requestComponentMatchWithOutcome(query, options)` 作为 UI helper 返回 `{ok:...}`，取消仍原样上抛；新增纯函数 `buildComponentMatchQuery(fields)`，**不 trim**，可选字段只在「键存在」时写入（空串与空白都算提供了值，交给校验拒绝）。
6. **`ComponentQuery.tsx` 改用新签名与不 trim 构造**；可选字段空串时不写入键（保持「缺省不出现」语义），纯空白则写入并由本地校验拒绝。

### 0-A.4 真实 HTTP「读取期间状态变更」回归（新增长级，**本轮未执行**）

按 C 要求补了 5 条真实 HTTP 回归，手法是 patch `h.platform().store!.read`，在**真实材料读取进行中**通过 `h.db` 改变状态，然后照常用 `h.request` 发 GET；不用 `new ComponentQueryService(...)` 直调冒充 HTTP：

- 材料读取期间撤权（`component_permissions` 三列置 false）→ 同形 `TARGET_UNAVAILABLE`，无 target/api/依赖；
- 材料读取期间插入 `disabled_subjects` → 同形 `TARGET_UNAVAILABLE`；
- 材料读取期间 `variant_releases.availability='DEPRECATED'` → 同形 `TARGET_UNAVAILABLE`；
- 材料读取期间新增同版本可读 `package_releases` → 409 `CONFLICT`；
- **未发生任何变更时同一手法必须仍 matched**（证明手法本身不制造失败，避免「怎么改都红」的假 RED）。

**这 5 条 B 侧未执行**（沙箱无隔离 PG/MinIO/Verdaccio/JWT+JWK），需 C 在宿主实跑；若第 5 条失败而前 4 条红，说明是 patch 手法或实现问题，需回报 B 而不是先改实现。

**实现侧的修复方向（C 返回 RED 证据后再动手，本轮不动）：** ① 按 POST 既有口径剥离 candidate，只保留 `MatchTarget` 字段；② 把「最终 find + 权限复查」挪到材料结果判定之前，材料错误只能在复查通过后才给出；③ 先对**解码后的 pairs** 做白名单校验，再构造对象；④ `requestComponentMatch` 改为计划签名直接返回响应、失败抛带 `reason`/固定文案的错误，新增 `requestComponentMatchWithOutcome` 作为 UI helper；⑤ `buildComponentMatchQuery` 提取为公开纯函数且不 trim；⑥ `selectTarget` 改为先按 `canRead` + 可读状态判定歧义，再把资格过滤用于唯一目标的有效性。

> **段落覆盖关系（重要，避免误读旧记录）**：本节（0-A.3）记录的「最小实现修复」是**当前生效**的实现口径。
> 第 0、1、2、5、6 节中与 0-A.3 冲突的描述（例如「`buildQuery` 会 trim」「歧义用资格过滤消除」
> 「返回前复查在材料结论之后」）均以 0-A.3 为准；旧文字保留仅为记录演化过程，不再代表现状。
> 第 0 节「B 未能在宿主实跑任何验证命令」同样已被后续各轮宿主实跑证据覆盖（见 0-A.5、0-A.6）。

### 0-A.5 宿主实跑证据与测试样例修订（2026-11-16 晚，C 逐轮回传）

本节只记录**宿主真实执行结果**与**测试自身修订**，不改写上文任何旧记录。产品代码在 0-A.5 期间**零改动**。

| 轮次 | 命令（宿主固定工具链） | 结果 | 日志 |
| --- | --- | --- | --- |
| GREEN 首轮 | `.\scripts\pnpm.ps1 build:services` | exit 0 | — |
| GREEN 首轮 | `.\scripts\pnpm.ps1 exec vitest run tests/integration/component-query.test.ts tests/integration/match-plan.test.ts tests/gallery/component-match-client.test.ts` | 112 项 = 107 过 / 5 败 | `.tools/phase2-b-green.log` |
| 平台专项 | `.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/component-query.test.ts tests/platform/matching.test.ts` | 32 项 = 30 过 / 2 败 | `.tools/phase2-b-platform-green.log` |
| 全图构建 | `.\scripts\pnpm.ps1 exec turbo run build typecheck --force` | 20/20 通过（无缓存） | `.tools/phase2-b-graph.log` |
| 浏览器 | `.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts tests/browser/phase2-component-query.spec.ts tests/browser/phase2-design-match.spec.ts` | 51 项 = 50 过 / 1 败 | `.tools/phase2-b-browser.log` |
| 根 tsc | `.\scripts\pnpm.ps1 exec tsc -p tsconfig.json --noEmit` | 15 处**测试文件**类型错误 | `.tools/phase2-b-root-tsc.log` |

首轮 5 个失败经核对全部是**测试样例缺陷**（产品行为已由 107 项覆盖），逐条修订如下，**未降低任何安全断言**：

1. **集成「不存在组件」是空函数却查询现存 `vueQuery`**，必然得到 `matched` 而不是 gap——是假通过。已改为真正删掉目标行（`h.rows.splice(0, h.rows.length)`）让 `find` 返回空集合；`it.each` 回调签名从 `(s: Snapshot) => void` 改为接收整个 harness，其余 8 类不可用原因不变。
2. **Gallery scoped 用例**发送了带 `packageName` 的 query，但 mock 响应的 `query` 没有回显该字段，客户端按契约判 `stale`。已让响应逐字段回显请求（含 `packageName`），并先用 `validateComponentMatchResponse` 证明该响应自洽。
3. **两条 stale 用例只改 `query`**，造成响应内部身份/依赖不一致，运行时会先以 `invalid-response` 拒绝，根本走不到 stale 分支。已改用**结构自洽的合法 gap 响应**（能通过 `validateComponentMatchResponse`）再断言 `stale`，**未调整安全校验顺序**。
4. **HTTP 400 分类**：按现实现与第 3 节口径，非 2xx（除 401/403/409）一律 `unavailable`，已把该单条预期从 `invalid-response` 改为 `unavailable`（400/500 两行同表）。
5. **平台「同形 gap」用例**对 `componentId=nope` 与 `componentId=line` 两个响应做整体 `toEqual`，query 不同必然失败。已改为分别断言各自 `query` 等于各自输入，再对**去掉 query 的完整剩余响应**做同形比对；并**补上「非 Ready」用例**（`package_releases.state='PENDING'`），原标题承诺但从未真正测过。
6. **平台「新增歧义」用例**此前只插 `package_releases` 一行（漏 `variant_releases`），且 `baseParams` 自带 `packageName` 本应消歧。已去掉 `packageName`、完整插入 package + variant 两行、元数据身份同步为新包名，并断言 mid-read 钩子确实 `fired`。
7. **既有跨包歧义夹具的元数据身份**已同步：`resolveRelease` 会核对 `pkg.name === candidate.packageName` 与 `variant.packageName === candidate.packageName`，原先直接克隆原包元数据，即使命中 409 也只是「同名多条发布」而非真正的跨包歧义。
8. **浏览器禁词用例误伤否定句**：产品文案「Ready **不代表**兼容性已确认」被裸子串 `兼容性已确认` 判成成功承诺。已删除该误伤子串，改为**正向断言** `unverified`、`COMPATIBILITY_UNVERIFIED` 与否定式提示确实存在，另禁「兼容性已通过」等肯定结论；**产品文案一行未改**。
9. **根 tsc 的 15 处测试类型错误**（不涉产品）：浏览器 `expectedParams` 改返回必填字段的具体类型（`QueryFields`）而非 `Record<string, string>`；Gallery 的 `buildComponentMatchQuery` / `requestComponentMatchWithOutcome` 改为静态导入，去掉动态 `import` 的宽强转；集成非法 DTO 反例显式按 `unknown` 收集后在调用点断言；`evidence` 条目改用 `find(...)!` 显式确认非空；docs 同长度改字节处显式确认索引非空；平台 `releaseRow` 增加真实数据库行类型（`ReleaseRow`，`name`/`version`/`pkg`/`metadata` 必填），未使用 `as any`。
10. **附带收窄（B 自查，静态导入后新暴露）**：`requestComponentMatchWithOutcome` 的真实返回类型是可辨识联合 `ComponentMatchOutcome`，`reason`/`issues`/`message` 只存在于失败分支、`value` 只存在于成功分支。原先靠动态导入的宽强转掩盖了这一点；改为静态导入后新增 `failedOutcome()` 辅助函数显式收窄，避免在联合类型上访问不存在分支的字段。

### 0-A.6 新增 RED：静态材料读取的存储层错误未归一（**产品待修，本轮只补测试**）

独立 Codex 审查确认两处**新的产品缺陷**，C 与审查方均已只读代码 + 只读探针复现：

- 真实 `ArtifactStore.read` 遇到 S3 404 抛 `UPLOAD_INCOMPLETE`（HTTP 409），对象大于 `expectedBytes` 抛 `LIMIT_EXCEEDED`（HTTP 413）；
- 而 `apps/api/src/matching/materials.ts` 的 `readApi` 只吞 `NOT_FOUND` / `DIGEST_MISMATCH`。

后果有两条，都比单看状态码更严重：① 这两类**静态材料不可用**不会被归一成 `API_UNSUPPORTED`，调用方看到的是 409/413 而不是同形 200 gap；② 异常在「返回前复查」**之前**就抛出，等于跳过复查——与 0-A.3 第 2 条修的存在性泄漏是同一类问题。

已在 `tests/platform/component-query.test.ts` 新增真实 HTTP 用例（**B 侧未执行，待 C 宿主跑 RED**）。手法是改写 patch 里转发给 `original` 的 key / `expectedBytes`，让**真实的** `ArtifactStore.read` 真正走完 S3 交互后抛出上述错误，不用假 error 冒充：

| 用例 | 手法 | 期望 | 当前行为（预期 RED） |
| --- | --- | --- | --- |
| 真实 S3 404 | key 改为确定不存在的对象键 | 200 gap `API_UNSUPPORTED`，无 target/api/依赖 | 409 `UPLOAD_INCOMPLETE` |
| 真实超长 | `expectedBytes - 1` | 200 gap `API_UNSUPPORTED` | 413 `LIMIT_EXCEEDED` |
| 404 叠加读取期间撤权 | 上述 key + mid-read 撤权 | 200 gap `TARGET_UNAVAILABLE`，无 target/api/依赖 | 409 `UPLOAD_INCOMPLETE`（跳过复查） |
| `INFRA_UNAVAILABLE` | seam 上抛同一错误对象 | 503，**不得**伪装成 gap | 503（该条预期通过，作为回归护栏） |

**修复方向（已与 C 冻结，B 待 RED 证据后实施）**：为 GET 增设**专用读取 seam**，把这两类静态材料错误规范化为「材料不可用」（返回 null，走 `API_UNSUPPORTED`），并确保最终复查一定执行；**不改变共享 POST 的既有语义**，**不改 `ArtifactStore` 的全局行为**。S3→`INFRA_UNAVAILABLE` 的映射本身由 artifact-store 自己的测试覆盖，本文件不重复推导。

**RED 证据（C 宿主实跑，`.tools/phase2-b-storage-red.log`）**：平台 36 项 = 32 过 / 4 败；其中 3 项确认为产品缺陷——S3 缺失返回 409 `UPLOAD_INCOMPLETE`、超长返回 413 `LIMIT_EXCEEDED`、缺失叠加撤权返回 409（跳过末次复查）；`INFRA_UNAVAILABLE` 仍 503 的控制项通过。第 4 项失败是测试自身作用域错误（`paramsFor` 定义在新 describe 内、却在中间的 mid-read 用例里引用），与产品无关。

**已按冻结方案完成最小修复（B，本轮）**：只改 `ComponentQueryService.query` 里 GET 自己的 `artifact` seam——把 `UPLOAD_INCOMPLETE` / `LIMIT_EXCEEDED` 规范化为 `NOT_FOUND`（共享 `readApi` 既有的「材料不可用」口径），于是 `readApi` 返回 null、末次复查照旧先执行，最终给出 `API_UNSUPPORTED`；撤权叠加时因同形归一而落到 `TARGET_UNAVAILABLE`。**未改共享 `readApi`、未改 POST 语义、未改 `ArtifactStore` 全局行为**；`INFRA_UNAVAILABLE` 等基础设施故障仍原样上抛为 503。同时修掉那处测试作用域错误（恢复从 `baseParams` 解构出 `ambiguous`）与集成测试漏导入的 `ComponentMatchQueryV1`；宿主窄测已报 112/112 通过。

## 0. 必读：本轮的验证状态（重要）

**B 未能在宿主实跑任何验证命令，因此 RED 也未在实现之前取得宿主证据。** 这是本轮与计划 TDD 顺序的实质偏离，必须由 C 先补做 RED 复核。

原因（均为环境事实，非借口）：

1. 任务派发时说明「依赖安装正在 `.tools/phase2-install.log` 完成」，B 开始时该安装仍未结束；
2. 沙箱 Linux 无法执行 Windows 固定工具链（Node `26.13.0` / pnpm `12.18.0`）；
3. 沙箱内 pnpm 的 `node_modules` 符号链接/junction 不可读（`ls` 报 `Input/output error`），`.pnpm` 下的 `typescript@7.0.2` 又缺 `@typescript/typescript-linux-x64` 平台包，仓库自带 tsc 无法启动；
4. 平台命令需要的本地隔离 PostgreSQL / MinIO / Verdaccio / OIDC JWT+JWK 在沙箱完全不存在。

因此 B 只做了：只读审计、RED 测试编写、最小实现编写，以及用**全局 tsc 7.0.2**（`--ignoreConfig --noResolve`）对新增/修改文件做过语法与局部类型核对。**这些检查不能替代 Windows 固定工具链的 build/typecheck/vitest/playwright，也不构成 RED 或 GREEN 证据。**

C 需要按第 4 节的顺序补跑：先用「仅测试文件」确认 RED（路由 404 / 服务测试失败），再恢复实现确认 GREEN。

### 一处需要 C 知晓的副作用

为做类型核对，B 在沙箱构建过一次 `packages/contracts/dist`（用全局 tsc 7.0.2，与仓库锁定版本一致）。该目录被 `.gitignore` 忽略、不会入库；`build:services` 会重新生成。若担心 Turbo 缓存命中旧产物，C 可对该任务加 `--force`。B 尝试清空该目录时沙箱拒绝删除（连接文件夹禁 unlink），故原样保留。

## 1. 实现范围（严格在授权列表内）

| 文件 | 归属 | 内容 |
| --- | --- | --- |
| `apps/api/src/matching/component-query.ts` | 新增 | 权威 SQL 查询、可读歧义判定、材料校验、返回前复查、缺口/409 语义 |
| `apps/api/src/matching/component-query-routes.ts` | 新增 | 原始 query 串解析（`parseComponentMatchQuery`）+ `ComponentQueryController` |
| `apps/api/src/matching/materials.ts` | 新增 | 从 `matching/service.ts` 提取的共享资格/材料 helper |
| `apps/api/src/matching/service.ts` | 修改 | 改调共享 helper，**行为不变**；净减 20 行 |
| `apps/api/src/app.ts` | 修改 | 注册 `ComponentQueryController` |
| `apps/gallery/app/lib/component-match-client.ts` | 新增 | `requestComponentMatch` |
| `apps/gallery/app/(console)/match/ComponentQuery.tsx` | 新增 | 查询表单与结果展示 |
| `apps/gallery/app/(console)/match/page.tsx` | 修改 | 挂载 `ComponentQuery`，更新文件头边界注释 |
| `tests/integration/component-query.test.ts` | 新增 | 纯逻辑 + 原始 query 串解析 |
| `tests/platform/component-query.test.ts` | 新增 | 真实隔离 Nest HTTP/PG/MinIO/Verdaccio |
| `tests/gallery/component-match-client.test.ts` | 新增 | 客户端构造/校验/对齐/取消 |
| `tests/browser/phase2-component-query.spec.ts` | 新增 | 表单行为、窄屏、不持久化 |
| `docs/verification/b-phase2-query-implementation-2026-11-16.md` | 新增 | 本文件 |

未触碰：`packages/contracts`、根配置与锁文件、版本号、`CHANGELOG.md`、SDK、CLI、其他模块。

## 2. 服务端关键决策

### 2.1 原始 query 串解析（不依赖框架 query 对象）

`parseComponentMatchQuery(url)` 只吃原始 URL，顺序固定：**分段 → 单次解码 → 解码后重复键检查 → 未知键检查 → 结构/条件校验**。

- 解码用 `decodeURIComponent(raw.replace(/\+/g,' '))`：`+` 视为空格、`%XX` 只解码一次、畸形序列抛 `URIError` 归一为 400；
- 因此 `?a=1&a=2`（重复原始键）与 `?a=1&a%49d=2`（重复解码后键）都报「查询参数重复」，
  不会被任何解析器静默收敛成一个值；`%2525` 之类二次编码也不会被再次解释；
- 拒绝：空片段、无等号片段、空键、未知键（含 `componentId[]`、`filter[framework]` 这类数组/嵌套写法）、空值、范围/不完整版本；
- 控制器读 `request.originalUrl ?? request.url`，全程不使用 Nest/Express 的 query 对象。

### 2.2 权威查询与歧义判定

单条参数化 SQL 定位 `components → variants → package_releases → variant_releases → release_jobs`，条件为 `c.id=$1 AND v.framework=$2 AND p.version=$3 AND ($5::text IS NULL OR p.name=$5)`，并同语句取 `catalog_can_read(c.id,$4)`。

- **先应用 `catalog_can_read` 再判断歧义**：`selectTarget` 只用 `resolveRelease`（内部复用 `eligibleRelease`）筛出的可读目标按 `packageName` 去重；
- 0 个可读 → 同形 `TARGET_UNAVAILABLE`；>1 个可读 → 409 `CONFLICT`（固定文案，不泄露其他发布详情）；恰好 1 个 → 继续；
- 因此「两个都不可读」不会退化成 409 泄露歧义，「一个可读一个私有」也不会泄露私有目标的存在；
- 不读文本索引、不依赖 `search_documents`、不按组件命名拼接。

### 2.3 返回前复查与撤权清理

材料读取前后各做一次 `store.find` + `selectTarget`；`revision` 用与 `search/current.ts` 同一构造（`searchRevision`），任一元数据变化都会让复查失败关闭。材料读取本身走 `CatalogService.artifact`，它内部会再次复核权限、对象键与逐字节摘要。撤权/禁用/废弃/新增歧义一律清空 `target`/`api`/`exactDependencies`。

### 2.4 精确依赖与缺口

`exactDependencies` = 目标包 + 框架 + echarts + （React）react-dom + 目标包自身 `dependencies`，按名合并；同名版本不一致即 `DEPENDENCY_CONFLICT`。缺已接受兼容证据时仍返回 `matched`，保留 `compatibility.status='unverified'` 与 `COMPATIBILITY_UNVERIFIED`。GET 不产出任何设计绑定缺口，最终响应再过一次公开的 `validateComponentMatchResponse`，不过则抛 `INTERNAL_ERROR`（不返回半成品）。

### 2.5 共享 helper 提取

`materials.ts` 承载 `resolveRelease` 与 `readApi`，`matching/service.ts` 改为调用它们。**这是纯搬移，未改行为**：`POST /v1/matching/plans` 的回归由第 4 节命令 3 的 `tests/integration/match-plan.test.ts` 与命令 4 的 `tests/platform/matching.test.ts` 覆盖。

## 3. 前端关键决策

- `requestComponentMatch` 只做 `GET`，用 `URLSearchParams` 构造查询串（可选字段缺省时不出现对应键），无 body；
- 本地先 `validateComponentMatchQuery`，非法即拒绝且**不发起网络请求**，只回安全字段路径；
- 响应用公开的 `validateComponentMatchResponse` 解析，并逐字段比对 `query`，不一致即 `stale`；
- 409 → 独立 `conflict` 分类（提示补 `packageName`），401/403 → `unauthorized`，其余非 2xx → `unavailable`；一律固定文案，不回显服务端原文或 token；
- 取消检查点三处（fetch 前 / await fetch 后 / await json 后），已取消一律 AbortError 上抛；
- `ComponentQuery` 沿用页面既有的「请求代次 + AbortController + token/subject 身份快照」模式：任何输入变化、退出登录、身份切换、卸载都取消并清结果；提交前与落地前都复核身份；
- React 才渲染 `reactDomVersion` 输入，切回 Vue 时清空该字段，避免把禁止字段发出去。

## 4. 交 C 宿主执行的命令（按顺序）

统一使用 `.\scripts\pnpm.ps1`（固定 Node 26.13.0 / pnpm 12.18.0）。

```powershell
# 4.1 先确认依赖安装已完成
Get-Content .tools\phase2-install.log -Tail 20

# 4.2 构建服务（ contracts dist + Nest 编译产物）
.\scripts\pnpm.ps1 build:services

# 4.3 【补做 RED】只保留测试文件、暂存实现文件后重跑，确认因缺路由/缺实现而失败
#     建议做法：git stash push -- apps/api/src/matching/component-query.ts apps/api/src/matching/component-query-routes.ts
#              apps/api/src/matching/materials.ts apps/api/src/app.ts apps/api/src/matching/service.ts
#              apps/gallery/app/lib/component-match-client.ts "apps/gallery/app/(console)/match/ComponentQuery.tsx"
#              "apps/gallery/app/(console)/match/page.tsx"
#     然后跑 4.4/4.5 的新测试文件，记录退出码与失败原因；再 git stash pop。
.\scripts\pnpm.ps1 exec vitest run tests/integration/component-query.test.ts tests/gallery/component-match-client.test.ts

# 4.4 本轮 GREEN：新集成测试 + 客户端 + 既有装配回归
.\scripts\pnpm.ps1 exec vitest run tests/integration/component-query.test.ts tests/integration/match-plan.test.ts tests/gallery/component-match-client.test.ts

# 4.5 平台真实服务专项（必须真实启动隔离 PG/MinIO/Verdaccio/JWT+JWK，缺环境必须失败，不得静默 skip）
.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/component-query.test.ts tests/platform/matching.test.ts

# 4.6 类型与构建
.\scripts\pnpm.ps1 exec turbo run typecheck --force
.\scripts\pnpm.ps1 exec tsc -p tsconfig.json --noEmit
.\scripts\pnpm.ps1 --filter @company/platform-api typecheck
.\scripts\pnpm.ps1 --filter @company/preview-gateway build

# 4.7 工作区结构边界
.\scripts\pnpm.ps1 verify:workspace

# 4.8 浏览器（C 统一排期，先检查 3000/5173–5176 端口所有者）
.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts tests/browser/phase2-component-query.spec.ts tests/browser/phase2-design-match.spec.ts

# 4.9 【0-A.6 新增 RED】存储层 404/超长未归一：只跑平台文件即可复现
#     预期 3 败（真实 404 / 真实超长 / 404 叠加撤权）+ 1 过（INFRA_UNAVAILABLE 仍 503）
.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/component-query.test.ts
```

命令 4.4 与 4.5 中的 `tests/integration/match-plan.test.ts`、`tests/platform/matching.test.ts` 覆盖既有 `POST /v1/matching/plans`，用于验证 `materials.ts` 提取未改变装配行为。

## 5. 测试覆盖矩阵

### 5.1 `tests/integration/component-query.test.ts`

- Vue / React 精确匹配：`target` / `api` / `exactDependencies` / `COMPATIBILITY_UNVERIFIED`；
- 11 类非法 query → 400 `INVALID_SCHEMA`，且**不发起权威查询**；
- 9 类不可用原因（无权/不存在/非 Ready/作业未完成/已废弃/peer 不符/跨框架/包摘要被改/元数据身份被改）与「未知组件」**逐字段同形**，且响应 JSON 不含 `@company`；
- 私有目标不参与歧义；两个都不可读不退化成 409；跨包同版本 409 + `packageName` 消歧；
- API 缺失/摘要不符/docs 字节不符/API 身份不符 → `API_UNSUPPORTED`；
- 包自身依赖与宿主版本冲突 → `DEPENDENCY_CONFLICT`；
- 材料读取期间撤权 / 废弃 / 新增同版本可读发布 → 分别得到同形 gap 或 409，材料与依赖被清空；
- 基础设施故障原样上抛，不伪装成 gap；
- 纯读：不出现任何写入语义的 store 方法；
- 原始 query 串解析：合法 scoped packageName、URLSearchParams 语义、12 类拒绝、二次编码不被再解释、`%3D` 不当分隔符、重复键不取首值/末值。

### 5.2 `tests/platform/component-query.test.ts`

真实 HTTP：路由存在与 200、`no-store`/`noindex`、双框架匹配、401/403、9 类非法 query 400、重复原始键/重复解码后键/数组化参数 400、合法单次编码与二次编码对照、无权/不存在/**非 Ready**/废弃同形（分别断言各自 `query`，再对去掉 `query` 的剩余响应整体比对）、peer 不符、跨包歧义 409 与消歧（元数据身份已同步为新包名）、材料损坏 `API_UNSUPPORTED`、材料读取期间撤权/禁用/废弃/新增歧义/无变更对照（均带 mid-read 钩子 `fired` 断言）、材料读取期间撤权（patch `db.query` 在第二次 `can_read` 读取时撤权）、**存储层 404/超长归一与叠加撤权（0-A.6，待 RED）**、`INFRA_UNAVAILABLE` 仍 503、以及发布/映射/索引/上传表行数前后一致的纯读断言。

### 5.3 `tests/gallery/component-match-client.test.ts`

请求构造（GET/无 body/Bearer/scoped 单次编码/可选键不出现）、7 类非法输入本地拒绝且零网络调用、合法 matched/gap 通过公开校验、6 类响应未通过校验即拒、`query` 不一致即 stale、409/400/401/403 固定文案不回显原文、网络失败与非 JSON、四组取消/迟到响应场景、signal 透传。

### 5.4 `tests/browser/phase2-component-query.spec.ts`

与既有三块表单并存且页面 200、React 条件字段显隐、只显式点击才 GET（含 URL 与 body 断言）、matched/gap 展示、401 不回显原文、输入变化取消并清结果、退出登录取消并回退登录门、切换身份（有/无 focus 两条）不回显旧身份、非法输入与 React 缺 DOM 版本本地拒绝零请求、375px 不横向溢出、不持久化且不回写设计规则、不出现模型/OCR/「兼容已确认」等表述。

## 6. 未覆盖项与需 C 决策的事项

1. ~~**RED 未在实现前取得宿主证据**（见第 0 节）~~ —— **已由 C 补做并回传**：`.tools/phase2-b-corrected-red.log`（112 项 = 72 过 / 40 败），三项真实缺陷复现确认；第 0 节相关表述仅作历史记录。
2. ~~**第 0-A 节的 5 项发现已补失败测试但实现未改**~~ —— **已按 0-A.3 完成最小修复并经宿主 GREEN 复跑**（`.tools/phase2-b-green.log`，112 项 = 107 过 / 5 败，5 败均为测试样例缺陷，已按 0-A.5 修订）。
3. **平台与浏览器命令 B 始终无法执行**；0-A.5 表中的平台 32 项、浏览器 51 项、全图 20/20 均为 **C 宿主实跑**结果，B 未复现也不对其负责。
4. `--latest` / `--registry` 一类候选发现选项不在 P1 范围内（GET 只用精确版本），本轮未实现也未测试。
5. 探针式大规模性能测量（如 200/1000 发布下的查询耗时）未做；如需，建议由 C 或 D 另开任务，避免与 P1 混淆。
6. 真实冻结 SDK bundle 的 14 实现逐项 GET 验收属 P4（C），需在 A 的 `expectedSdkComponents` 就绪后进行。
7. `packages/contracts/dist` 有 B 的沙箱构建残留（gitignored），见第 0 节副作用说明。
8. 版本升级与 `CHANGELOG.md` 由 C 收口；B 未改任何版本号。
9. ~~**0-A.6 的 4 条存储层错误归一用例待 C 跑 RED**~~ —— **RED 已由 C 实跑并确认（`.tools/phase2-b-storage-red.log`，36 项 = 32 过 / 4 败，3 项产品缺陷 + 1 项测试作用域错误）**；B 已按冻结方案完成最小修复，待 C 复跑 GREEN。
10. 平台测试中「`INFRA_UNAVAILABLE` 仍 503」一条是 seam 级断言（复现同一 `PlatformError` 对象），不是从真实 S3 非 404 失败推导出来的；该映射由 artifact-store 自己的测试覆盖。

## 7. 提交建议

计划要求拆成后端与 Gallery 两个中文聚焦提交。建议：

```powershell
git add apps/api/src/matching/component-query.ts apps/api/src/matching/component-query-routes.ts `
        apps/api/src/matching/materials.ts apps/api/src/matching/service.ts apps/api/src/app.ts `
        tests/integration/component-query.test.ts tests/platform/component-query.test.ts
git commit -m "feat: 实现组件标识精确查询 GET 接口与权威目录校验"

git add apps/gallery/app/lib/component-match-client.ts "apps/gallery/app/(console)/match/ComponentQuery.tsx" `
        "apps/gallery/app/(console)/match/page.tsx" tests/gallery/component-match-client.test.ts `
        tests/browser/phase2-component-query.spec.ts docs/verification/b-phase2-query-implementation-2026-11-16.md
git commit -m "feat: 新增组件精确查询表单与查询客户端"
```

B 未执行任何 `git` 写操作（未 add / commit / stash / push / merge / reset / 清理）。提交由 C 或经 C 确认后执行；`.tools/`、`node_modules/`、`dist/`、`test-results/` 不得入库。

## 8. C 宿主最终复验与交接（2026-11-16）

B 已停止写入，由 C 在 Windows 固定工具链上接管测试收口、提交和集成。前述 RED、失败及待办保留为历史过程；本节为 P1 最终结果。C 修正存储测试辅助函数的跨 describe 作用域，并将 JSON 取消测试改为真正进入并挂起 `response.json()`，随后取消并释放有效响应；没有改动产品语义。

- `build:services`：exit 0（`.tools/phase2-b-build-final.log`）。
- `exec vitest run tests/integration/component-query.test.ts tests/integration/match-plan.test.ts tests/gallery/component-match-client.test.ts`：112/112 通过，0 跳过，exit 0（`.tools/phase2-b-narrow-final.log`）。
- `exec vitest run --config tests/platform/vitest.config.ts tests/platform/component-query.test.ts tests/platform/matching.test.ts`：36/36 通过，0 跳过，exit 0（`.tools/phase2-b-platform-green.log`）。真实 S3 缺失对象、超长对象及缺失叠加撤权回归均通过；`INFRA_UNAVAILABLE` 保持 503。旧 POST 回归通过。
- 已有全图强制构建 20/20 后，`exec playwright test --config tests/playwright.config.ts tests/browser/phase2-component-query.spec.ts tests/browser/phase2-design-match.spec.ts`：51/51 通过，exit 0（`.tools/phase2-b-browser-final.log`）。最终集成与升版后由 C 再强制构建并运行完整二期浏览器组。
- `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`：exit 0（`.tools/phase2-b-tsc-final.log`）。

执行者为 C 宿主；不将上述结果归为 Claude 桌面端自行执行。P4 的 14 实现及真实 Gallery 联调尚待集成验证，生产 OIDC / G2 / 真实业务试点独立记账。
