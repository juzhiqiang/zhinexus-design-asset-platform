# V1 公共契约（G1 评审候选）

本包是私有、环境无关的协议包，不依赖 NestJS、Node 模块、DOM、Vue/React 或 ECharts。运行时校验可用于浏览器与服务端；摘要函数使用标准 Web Crypto / UTF-8。schemaVersion=1 沿用实施计划 2.2–2.3；**C 代码候选已形成，G1 仍待 A/B 非作者评审回执，不能视为已冻结通过**。

## 入口与信任边界

```ts
import {
  validateManifest, validateCheckReport, validateEnvironment,
  validateReleaseBundle, validateApiMessage, manifestDigest, environmentKey,
} from '@company/contracts';

const input: unknown = JSON.parse(receivedJson);
// 同步声明校验；自动截图需要已解析报告，以 manifest.reports 的逻辑路径为 key。
const result = validateManifest(input, { reports: parsedReportsByPath });
if (!result.ok) showIssues(result.issues); // {code, path: JSON Pointer, message}

// 上传适配器使用从受限安全存储读取的实际 Map<string, Uint8Array>，不信任输入摘要。
const bundle = await validateReleaseBundle(input, verifiedUploadBytes);
if (bundle.ok) {
  const digest = await manifestDigest(bundle.value);
  // 交给 T05/T06 的鉴权、tarball 内容/图片核验与持久化作业。
}
```

公共校验器接收 unknown，返回 ValidationResult<T>；失败不修改输入，不把 web 伪造来源静默洗成合法值。字段路径使用 JSON Pointer，根为 `""`。结构失败时不执行领域关联校验；最多返回 100 条错误，JSON 深度限制 64、节点限制 100,000。不得用类型断言代替校验。

validateManifest 只核对结构、引用和来源，不能证明报告对象来自已上传字节，也不重算环境键。validateReleaseBundle 额外验证完整文件清单、逐文件 byteLength/SHA-256，解析同一报告字节，重算环境键，再校验关联。调用方须保证文件在校验和存储之间不可变，并实施总量/单文件限制。本包不承担安全解包、实际 MIME/图片尺寸、tarball exports、依赖可达性、权限、跨存储一致性或浏览器运行证明（T05/T06/T07）。

## 领域规则

- 包名+版本唯一；同名同版本不同摘要返回 CONFLICT。core-only 包不虚构框架 variants；包内受管理导出完整性由 T05 核对真实 tarball。
- 每个 VariantRef 至少一张截图；逐项匹配 variantId/framework/packageVersion/exampleId/state/packageSha256。一包多组件逐实现检查，Vue 通过不代表 React 通过。
- previewEntry 属于本示例 previewFiles；API、文档、预览、图片、报告与 evidence 均在 manifest.files 中有完全相同的路径、摘要、字节数。
- 路径为 POSIX 相对路径；拒绝穿越、绝对/盘符/反斜杠、编码路径、ADS、Windows 通配符/设备名（含 COM/LPT 的 ¹²³ 别名）、空段、末尾点/空格；完整清单采用 NFC + Unicode 大写的保守碰撞策略，包含 Σ/ς、s/ſ。此策略可能拒绝目标文件系统本可区分的名称，不声称完整模拟 Windows 文件系统。真实符号链接与解包目录限制归 T05。
- web 图片只能 manual-upload / unknown-manual；无报告时 compatibility 只能为空或 candidate，不能伪造 passed/failed。API 入库时同样必须强制来源，不信任调用方选择的 channel。
- 自动截图有完全匹配的报告和截图记录，覆盖所有示例的每个 requiredStates；手动展示图不要求伪造全套自动状态覆盖。
- React 兼容记录必填精确 reactDomVersion；passed 需匹配本 variant、包摘要、框架/ECharts 精确版本的报告及有效 UTC verifiedAt；检查全部 passed、视觉结果 PASS 或 NEW、全部必需状态有成功证据，所有贡献报告的 createdAt 均不得晚于 verifiedAt。NEW 不表示基线已被接受。V1 环境不单独记录 ReactDOM 运行版本，字段存在不等于已证明运行版本（由 T03/T04 消费者证据补足）。
- 手动展示图可引用同实现/示例/包的独立本地报告；报告保留自己的自动截图，不把手动图升级为自动图。
- Ready 可达性、来源、基线、索引状态分开建模，不能相互推导。

## 确定性编码与环境键

canonicalJson：有限、无环 JSON；对象键按 JS UTF-16 字符序递归排列，数组保留顺序，标准 JSON 字符串/数字编码，无额外空白；UTF-8 后计算 SHA-256。manifestDigest 使用此编码，不另行排序数组或重写路径。拒绝 undefined、BigInt、非有限数、稀疏数组、accessor、class 实例等非 JSON 输入；数组只接受普通可枚举 data descriptor 索引和原生 length，不读取 getter，不允许额外属性、Symbol 或数组子类。

精确版本采用 SemVer 语法且不含构建元数据；纯数字预发布标识不允许前导零，含字母或连字符的标识允许数字前缀。语法层不把主/次/修订号转为 JS number，也不添加 npm 实现的安全整数上限；仍受字符串长度预算约束。真实 npm 包版本的可安装性与工具实现限制须由 T04/T05 核对，语法通过不等于 npm 可发布。

environmentKey：取 os、arch、browserVersion、browserRevision、fontDigest、locale、timezone、deviceScaleFactor、renderer、width、height、theme；字符串 trim+NFC，os/arch 额外小写，再按上述编码算 64 位小写 SHA-256。frameworkVersion、echartsVersion、包版本和 exampleId 不进入键；外层以 variant/example 隔离基线。unknown-manual 不用于基线接受。尺寸为 1–8192 正整数、scale 为正数；日期为真实 UTC ISO-8601（Z，可带三位毫秒）。

sourceDigest 是 CLI 规范化源码集合摘要，集合与排除规则由 B 的 T04 实现并核对；不能用 Git commit 冒充工作区源码证明。

## 示例协议（A 评审）

导出 ComponentExample / CheckResult；示例自行在浏览器暴露 window.__COMPONENT_EXAMPLE__：

```ts
type CheckResult = { name: string; status: 'passed' | 'failed'; message?: string };
type ComponentExample = {
  ready: Promise<void>;
  runState(name: string): Promise<void>;
  getChecks(): CheckResult[];
};
```

ready 在数据、fonts.ready、非零尺寸和 ECharts finished 后完成，失败 reject，不靠固定 sleep。runState 只接受声明状态，更新/渲染就绪后 resolve，未知状态 reject；getChecks 返回当前快照。超时诊断与默认 30 秒属于 CLI runner；contracts 只定义协议，不启动浏览器。

2026-11-21 G1 评审澄清（字段及 Schema 保持兼容）：

- `ExampleRef.theme` 与环境中的 `theme` 保持字符串字段；当前 SDK 内置支持 `light`、`dark`。示例与 runner 必须记录实际解析并应用的主题；未知查询值回退默认主题时，记录也使用回退后的值。其他主题须独立验证，不能由字符串类型推导支持范围。
- contracts 与 charts-core 分别声明 `Renderer = 'canvas' | 'svg'`，这是公开 SDK 不依赖私有 contracts 的包边界要求。允许值变更须同步契约、SDK、生成 Schema、fixtures 和调用方验证。
- `ready` 拒绝始终表示验证失败。SDK 示例有自身的状态就绪期限；CLI 默认 30 秒，可通过 `timeoutMs` 调整，并对初始就绪和每状态的 `runState`、更新后的 `ready` 设置超时。CLI 自身超时报 `READY_TIMEOUT`；已等待的底层 rejection 按失败处理，未处理的 rejection 才由页面错误收集器计入 `no-page-error`。每状态就绪后必须读取真实、非空且合法的 `CheckResult[]`，不得补造 `passed`。
- 同一状态内检查名唯一。多个状态可使用相同的检查名，CLI 汇入报告时保留默认状态或首次出现的原名，给其余同名检查加上状态标签并避开原有名称。

## API 消息（B/C 评审）

T05 补充（2026-11-12）：createUploadResponse 的每个文件可带 multipart={uploadId,partSize,parts:[{partNumber,uploadUrl,expiresAt}]}；旧单 PUT 响应不变。multipart 存在时客户端使用逐片 URL，complete 提交对应 path/partNumber/etag。UPLOAD_LIMITS 导出客户端/API 共用的初始字节、图片尺寸和分片限制；API 仍核对实际字节、聚合总量并冻结内容。来源由认证客户端身份映射，不能由 manifest.channel 升级权限。

ApiMessages 与 validateApiMessage(name,input,{reports?}) 覆盖以下 V1 消息。createReleaseRequest 还执行 manifest 领域校验；其余为 wire 结构校验，不证明服务已实现或状态合法。HTTP query 由适配器先解析页码数字，不隐式转换类型。

| HTTP 接口（均 /v1） | 请求 / 响应消息 |
| --- | --- |
| POST /uploads | createUploadRequest / createUploadResponse |
| POST /uploads/:id/complete | completeUploadRequest / completeUploadResponse |
| POST /releases | createReleaseRequest / createReleaseResponse；HTTP 层检查 Idempotency-Key |
| GET /releases/:jobId | releaseJobResponse |
| POST /releases/:jobId/retry | retryReleaseResponse（无新增请求字段） |
| GET /components | componentsQuery / componentsResponse；API 只返回公开 Ready 目录 |
| GET /variants/:id/releases/:version | variantReleaseResponse |
| POST /baselines | createBaselineRequest / createBaselineResponse |
| POST /variant-releases/:id/deprecate | deprecateRequest / deprecateResponse |
| POST /preview-grants | previewGrantRequest / previewGrantResponse |
| 结构化错误 | error：code / message / details / requestId |

本次补充约定：parts 为 {path,partNumber,etag}（非分片可空数组）；无错误的 job 省略 lastError；首次基线省略 expectedRevision，更新须由 API 检查已有 revision；目录分页为 page/pageSize/total。subject 不在请求体，未知字段拒绝。grant URL 只校验 HTTP(S) 结构，独立域/授权/撤销归 T07。补充字段仍待评审，不擅自实施业务端点。

T05 接入补充（2026-11-12）：releaseJobResponse 可选 baselineCandidates 给出服务端 screenshotId、冻结材料 sourceScreenshotId 与 variantId/exampleId/environmentKey。客户端 report/screenshot ID 只在单份 Bundle 内唯一，不能直接作数据库全局主键。基线操作优先使用候选服务端 ID，旧引用歧义返回 CONFLICT；不修改冻结 manifest 或报告。完整接口实现与认证边界见 [API 接入](../../apps/api/README.md)。

## 稳定错误码

| code | 含义 |
| --- | --- |
| INVALID_SCHEMA / INVALID_PATH | 结构、字段值、版本、日期或路径非法 |
| DUPLICATE_ID / CONFLICT | 标识/路径重复；同版本不同摘要冲突 |
| REFERENCE_NOT_FOUND / ARTIFACT_MISMATCH | 缺文件/关联或文件元数据不一致 |
| DIGEST_MISMATCH | 包摘要或实际字节与冻结声明不同 |
| SCREENSHOT_REQUIRED / SCREENSHOT_VARIANT_MISMATCH | 逐实现缺图或框架/版本/示例/状态错配 |
| SOURCE_FORBIDDEN | 来源或手动环境违规 |
| REPORT_REQUIRED / REPORT_MISMATCH | 缺报告或证据错配 |
| COMPATIBILITY_EVIDENCE_REQUIRED | 缺精确组合/报告/时间/状态覆盖 |
| FILE_REQUIRED / UNEXPECTED_FILE | bundle 缺文件或夹带未声明文件 |

API 另有 UNAUTHENTICATED、FORBIDDEN、NOT_FOUND、UPLOAD_INCOMPLETE、LIMIT_EXCEEDED、LEASE_LOST、INFRA_UNAVAILABLE、INTERNAL_ERROR。按稳定 code 分类，不根据 message 决定重试；错误内容不放凭证、signed URL 或原始输入。

## JSON Schema、fixtures 与验证

示例协议收口（2026-11-12）：`COMPONENT_EXAMPLE_GLOBAL` 固定为 `__COMPONENT_EXAMPLE__`；`ComponentExample.states` 是可选只读状态名枚举，既有只提供 ready/runState/getChecks 的示例仍有效。截图必须按 `ExampleRef.requiredStates` 执行，不能因枚举缺省或遗漏而跳过必需状态；存在枚举时应预检查必需状态是否全部包含，未知状态由 runState 拒绝。每个状态等待就绪后读取 getChecks，Vue/React 分别验证。此项是 C 的兼容性收口，不代替 A/B 的实际业务回执。

src/schemas.ts 和 src/api.ts 的结构定义生成 schemas/*.schema.json（2020-12）。校验器只解释本包声明的词汇，不承诺通用 JSON Schema 引擎。JSON Schema 仅结构层，跨资源关联、来源、环境键与摘要必须使用运行时校验，不能只跑通用 schema 就放行。

```powershell
.\scripts\pnpm.ps1 --filter @company/contracts build
.\scripts\pnpm.ps1 exec tsx tests/fixtures/releases/g1/generate.ts --check
.\scripts\pnpm.ps1 exec vitest run tests/contracts
```

普通契约测试同时检查提交的 Schema 内容与格式是否和运行时定义精确一致。需要重新生成时，在仓库根运行 `.\scripts\pnpm.ps1 --filter @company/contracts schemas:generate`；命令先构建本包，再运行 `packages/contracts/scripts/generate-schemas.ts`。生成脚本不再承担检查模式。

T16 受控应用契约（2026-11-18）新增 apply authorization、apply result、backup 与 rollback result 四份 v1 Schema。它们只校验 JSON 结构和显式上下文交叉引用，不证明人类授权、realpath 安全、计划新鲜度、真实字节摘要或安装结果。备份以 projectRoot + planDigest 绑定项目，区分 installPlanned 与启动前持久化的 installStarted；恢复结果用 restoredPaths、unchangedPaths、preservedPaths、必填 unresolvedPaths 四组互斥覆盖全部备份候选，分别表达恢复成功、原字节已匹配、保留用户编辑及恢复 I/O 失败。备份日志字节变化后必须重新计算 backupRef.sha256，真实执行仍须在 CLI 本地边界完成链接、并发、摘要、凭据隔离和后续用户编辑保护。

apply result 采用显式状态/证据矩阵：applied 必须有完整写入、无 issue，并与计划的安装状态一致；blocked 只能表达写入和安装前的守卫失败，不得带 changedFiles、backupRef、安装副作用或写后错误码；rolled-back 必须有 backupRef，首写失败时允许空 changedFiles/beforeHashes/afterHashes、not-run 和 WRITE_FAILED，不虚构已提交文件；recovery-required 必须带 backupRef，并至少证明发生过写入或安装副作用。issue message 由 code 映射到固定脱敏文本，任意 stderr、URL、凭证或错配消息均拒绝。rollback 中 preserved 与同路径 USER_EDITED 双向绑定，unresolved 与同路径 WRITE_FAILED/RECOVERY_REQUIRED 双向绑定；rolled-back 不得有 preserved、unresolved 或 issues。畸形 backup 上下文返回 ValidationResult 失败，不得抛出运行时异常。

修改先补失败测试，使用上述命令重生 schema；fixtures 则在构建后去掉其生成命令的 --check，连同失败样本一起评审。入口：tests/fixtures/releases/g1/README.md、docs/verification/gates-infra.md、docs/plans/2026-11-12-g1-review-g2-access.md。

V1 评审通过后冻结字段/错误码；兼容可选字段明确同步调用方，不兼容修改升级 schemaVersion 并保留旧版解析策略。本包 private=true，版本仍 0.0.0；本次无对外业务端点/组件/CLI 功能发布，不触发公开包或平台升版。CLI 将来使用本包须内联运行时代码，不保留私有运行时依赖，并验证干净消费者。

T07 兼容扩展（2026-11-12）：新增 variantReportsResponse，返回指定发布记录的检查报告；原有详情 DTO 保持不变。纯配置/路径策略通过独立 `@company/contracts/preview` 子路径提供 validatePreviewConfig、previewOriginFor、isArtifactPath，避免 CLI 固定内联根契约时引入预览部署逻辑。CLI 的 src/contracts/api.ts 由既有构建脚本同步，内容与契约源保持一致。

## 二期 ProjectContext 首批契约

`ProjectContext`、`validateProjectContext(input)` 与 `CONTRACT_SCHEMAS['project-context-v1']` 提供项目上下文类型、运行时校验及独立 JSON Schema。字段固定为：

|字段|要求|
|---|---|
|framework|`vue` 或 `react`|
|frameworkVersion|精确 semver，允许 prerelease，不接受范围、短版本或 build metadata；沿用现有 exactVersion 策略|
|echartsVersion|可选，填写时遵守同一精确版本规则|
|packageManager|`npm` 或 `pnpm`|
|requirements|必填字符串数组，可为空；每项含非空白字符且最多 2048 字符|

拒绝未知字段及非 JSON 对象，错误使用现有 `ValidationResult` 与 JSON Pointer 路径。合法值保留原输入，不做版本推断、兼容证明或需求补全。用户填写的上下文不代表任何候选已通过 peer 硬过滤、真实安装或截图验证；Ready、来源、兼容、索引状态继续独立。

本批没有新增 HTTP 消息、检索接口或 MatchPlan。CLI 构建按现有机制同步并内联同一契约，不引入私有运行时依赖。计划与实际验证见 `docs/plans/2026-11-15-phase2-kickoff.md`、`docs/verification/phase2-matching.md`（仓库根路径）。

## 二期第三批文本候选检索契约

后续第三批已增加 `SearchCandidatesRequest`、`SearchCandidatesResponse`、`Candidate` 及对应 `validateSearchCandidatesRequest` / `validateSearchCandidatesResponse` / `validateCandidate` 校验器。独立生成的 `search-candidates-request-v1` Schema 与 CLI 内联镜像同步；前述“没有检索接口”仅指首批。

`POST /v1/search/candidates` 请求为 `{ query, context, reactDomVersion? }`：query 非空白且最长 2048 字符，context 复用 ProjectContext，reactDomVersion 可选但必须为精确版本，不能从 React 版本推断。拒绝未知字段。HTTP 层强制 Bearer 与 read 权限、no-store/noindex，权限并非由结构校验证明。

响应为 `{ candidates: Candidate[], gaps: string[] }`。Candidate 绑定实现发布 ID、包版本/摘要、框架与导出，含 API/文档证据、可选截图及来源、兼容记录、排名和缺口；拒绝重复实现发布 ID。verified 要求非空且唯一的记录 ID，unverified 无记录；这只检查结构，记录真实性、精确宿主组合及摘要由服务端复核。

本批 provider 为 `metadata-text-v1`，仅提供 0–1 的 text 排名，不填 usage/visual 分数；响应明确说明不提供用途、视觉或需求语义评估。Ready、当前权限、索引 revision/provider、兼容可信度分别判断。契约通过不证明可安装或真实兼容，不提供 MatchPlan。实施与验收见仓库根 `docs/plans/2026-11-15-phase2-text-search.md`。
