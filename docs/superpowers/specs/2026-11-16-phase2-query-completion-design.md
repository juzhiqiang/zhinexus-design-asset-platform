# 二期收口：组件标识规范与 GET 查询接口

日期：2026-11-16（Asia/Shanghai）。规划基线：`main@9253f2e99e279b68fd696f85e7622db5d7eb60ec`。状态：设计与执行规划，GET 接口尚未实现。

## 用户本轮决策

用户要求推进二期完成，允许 Antigravity、Claude 桌面端、Claude Code、Codex 各自在独立分支开发，完成后合并并删除开发分支；开发量大的任务优先给 Claude 桌面端。

用户进一步明确：“这个你不需要考虑，你只要规范是对，并且提供一个 get 查询接口，到时候使用侧就可以正确匹配。”据此，设计平台格式、真实设计导出和真实业务标注不再是本轮二期交付的前置条件。二期以可供使用侧正确调用的标识规范、GET 接口、真实 SDK 材料及确定性验收收口。该决定不等于公司环境、生产部署或真实业务试点已验收；旧记录保持当时结论。

## 目标与实施选择

平台已有目录 GET、`POST /v1/matching/plans`、真实 API 材料、资格复读和 `/match` 页面。本轮补齐使用侧按平台组件标识直接查询的入口。现有目录列表会选最新版本，不适合作为精确版本匹配的替代品。

以下是本方案的实施选择，业务方没有指定这些字段名：使用侧维护自己的 `designId → 平台组件引用`，平台按 `componentId + framework + packageVersion` 查询；需要消除同版本跨包歧义时同时传 `packageName`。最终响应的 `variantReleaseId` 固定一次精确发布。使用侧可直接消费组件材料，也可将发布 ID 填入现有 `DesignIdMappingV1`，继续调用装配 POST。

不新增服务端设计规则仓库、设计平台连接器、模型或向量检索。无需为了 GET 引入一套映射写入/发布系统。三期安装和代码写入继续按独立范围实施。

## 标识与版本规范

- `componentId` 是平台逻辑组件 ID；沿用已有发布契约：1–128 字符，`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`，大小写敏感、不 trim、不转换。当前 7 个值由真实 manifest 审计确认，不能把组件导出名当作 ID。
- `framework` 只允许 `vue` / `react`，同一逻辑组件的两个实现分别定位和校验。
- `packageVersion` 是目标框架包的精确版本，不是 core 版本、平台版本或设计规则修订。沿用 `exactVersion`，拒绝 latest、范围和不完整版本；合法精确预发布版本保持既有语义。
- `packageName` 可选，沿用既有 npm 包名规则，查询时原值比较。未提供且存在多个可读目标时返回 `409 CONFLICT`，不任意选包；提供时必须精确命中。
- `variantReleaseId` 是平台环境内的精确发布标识；跨环境迁移时用组件/框架/包名/版本重新查询，不假设数据库 UUID 在环境间一致。
- `designId` 与 `instanceId` 沿用原有不透明字符串规范。GET 不将任意设计图层 ID 猜测成 componentId；使用侧显式保存对应关系。

## GET V1 协议

新增 `GET /v1/matching/components`，沿用 Bearer `read` 权限。请求无 body；令牌只放 Authorization header。响应设置 `Cache-Control: no-store`、`X-Robots-Tag: noindex, nofollow`。

```ts
type ComponentMatchQueryV1 = {
  componentId: string;
  framework: 'vue' | 'react';
  packageVersion: string;
  packageName?: string;
  frameworkVersion: string;
  echartsVersion: string;
  reactDomVersion?: string;
};

type ComponentMatchResponseV1 = {
  schemaVersion: 1;
  query: ComponentMatchQueryV1;
  status: 'matched' | 'gap';
  target?: MatchTarget;
  api?: ComponentApiV1;
  exactDependencies: { name: string; version: string }[];
  gaps: MatchGap[];
};
```

除了两个可选字段，其余 query 字段均必填。React 必须提供精确 `reactDomVersion`；Vue 提供该字段视为无效输入。框架、React DOM、ECharts 都是使用侧宿主的精确版本。客户端通过 URLSearchParams 编码；服务端接受合法的一次百分号解码（包括 scoped packageName），拒绝畸形编码，不进行二次解码。解析原始查询串时保留全部键值，并在解码后检查重复键，不依赖可能丢弃重复值的框架 query 对象。只接受白名单单值字符串，拒绝重复键、未知键、数组、嵌套对象、空值和非法版本，不使用首值/末值覆盖。

示意调用（地址和版本对应的部署数据需由实际环境提供）：

```http
GET /v1/matching/components?componentId=line&framework=react&packageVersion=0.0.12&frameworkVersion=19.3.1&reactDomVersion=19.3.1&echartsVersion=6.1.0
Authorization: Bearer <由调用侧安全注入>
```

`matched` 必须含 target、api、精确依赖。target 的 componentId/framework/packageVersion 以及可选 packageName 必须与 query 一致；api 的 componentId/framework/exportName/exportPath 必须与 target 一致；API/docs 证据来自相同冻结发布清单，摘要与字节数都已校验。复用 `MatchTarget` 的导出、样式、示例、readyMethod、兼容性字段，不另造同义 DTO。

`matched` 表示定位且材料可读，不代表真实业务绑定或自动接入通过。缺少已接受的精确组合兼容报告时，保留 `compatibility.status='unverified'` 和 `COMPATIBILITY_UNVERIFIED`。GET 不承接业务 props source、事件 handler、布局、requirements，所以不凭空生成这些绑定，也不为本次未请求的绑定输出 MISSING_PROP/MISSING_EVENT/LAYOUT_UNKNOWN。

`gap` 必须缺少 target/api，exactDependencies 为空且 gaps 非空。错误/缺口语义如下：

| 条件 | 响应 |
| --- | --- |
| 非法 query、重复参数、版本范围、React 缺 DOM 版本 | 400 / INVALID_SCHEMA |
| 未认证 / 无 read 角色 | 401 / UNAUTHENTICATED；403 / FORBIDDEN |
| 同选择条件匹配多个当前可读发布 | 409 / CONFLICT，固定文案，不泄露其他发布详情 |
| 不存在、无组件读取权限、非 Ready、已废弃、peer 不满足 | 200 / gap / TARGET_UNAVAILABLE，同形响应 |
| 已有资格但 API/docs 缺失、旧格式或摘要不符 | 200 / gap / API_UNSUPPORTED |
| 精确依赖无法形成一致方案 | 200 / gap / DEPENDENCY_CONFLICT |
| 合格且材料一致，但缺兼容接受证据 | 200 / matched / COMPATIBILITY_UNVERIFIED |
| 基础设施故障 | 沿用 503 / INFRA_UNAVAILABLE，不伪装成无匹配 |

最终冻结以 C 的公共运行时校验器、JSON Schema 和 fixtures 为准。JSON Schema 沿用仓库已有词汇，覆盖字段类型、必填字段、枚举、ID/版本格式和未知字段；React/Vue 条件字段、matched/gap 条件以及 query/target/api 的动态身份一致性由运行时验证器补充强制校验，并在接口规范列出。外部使用侧只跑 JSON Schema 不足以证明这些条件通过，应使用公开运行时校验器或实现规范列出的附加规则。此轮不为条件规则扩大整个 Schema 引擎。保持既有 POST 与目录 GET 向后兼容。

## 服务端实现边界

查询使用参数化 SQL，读取 components/variants/package_releases/variant_releases 及当前权限；不依赖文本 Top-50、索引状态或组件命名拼接。应用 `catalog_can_read` 后才判断可读目标歧义，不能因另一个私有目标的存在泄露信息。

复用 `eligibleRelease`、当前候选读取与冻结材料摘要校验。必要时将 `matching/service.ts` 的资格/材料逻辑提取成共享内部 helper，POST 的既有回归必须继续通过。首次选择后、材料读取后均复查当前目标集合、权限、禁用状态、Ready/废弃和版本；中途撤权清空 target、api 和依赖。新增同条件发布导致歧义也必须失败关闭，不凭首次结果返回。

仅返回已验证静态 JSON/文档元数据，服务端不加载 SDK 运行时代码、不构建、不启动截图浏览器。正常 GET 不创建发布、映射配置或索引任务；沿用既有请求观测与鉴权审计。

## 四方分工

| 角色 | 唯一主责 | 并行边界 |
| --- | --- | --- |
| C / Codex | contracts、根配置/锁/版本、公共 fixtures、验收协调与合并 | 先冻结协议，再统一 Windows 验证和版本收口 |
| B / Claude 桌面端 | 本轮最重任务：GET 服务、精确查询、共享材料校验、HTTP 接线及 Gallery 查询入口 | 本轮明确授权 B 修改指定 API 匹配目录和 app.ts，C 不同时编辑这些文件 |
| A / Antigravity | 7 类 × 2 框架真实 API/导出审计、独立预期矩阵和反例 | 审计 SDK；若发现产品缺陷，先列出并由 C 分配修复文件，不顺带改版本 |
| D / Claude Code | 独立黑盒 HTTP 验收、使用侧调用说明、接口实例校验和证据清单 | 不修改 B 服务、C contracts 或 A 的预期矩阵 |

必须使用用户指定的实际客户端，不能把 Codex 子代理称为 Claude 或 Antigravity。独立审查可使用 Codex 审查代理，但应明确身份。客户端未运行、未接收任务、无法写仓库或未执行 Windows 命令时如实记录。

## 完成标准

1. 规范、公共 DTO、运行时校验和生成 Schema 的结构约束一致；Schema 无法表达的条件/动态约束明确列出且有运行时反例验证。使用侧无需了解平台内部代码即可构造正确 GET。
2. GET 在真实隔离 Nest HTTP/PG/MinIO/Verdaccio 设施中完成验收，鉴权使用现有本地签名 JWT 和本地 JWK 校验测试设施；包括权限撤销、禁用、版本/框架错误、歧义、材料损坏和索引故障。这不是公司 OIDC/JWKS 外部接入验收。
3. 复用一份已冻结的真实 SDK bundle，在隔离服务登记并验证 7 类 × Vue/React 的 14 个精确目标及 API/导出/事件/依赖；不将合成 ID 命名标为真实业务样本。
4. Gallery 的 GET 查询入口通过单元、浏览器和真实 HTTP 联调；已有 POST 装配、文本发现与状态失效行为保持通过。
5. C 完成最终集成代码的构建、类型、测试、workspace 边界与架构 SHA 检查，记录实际执行/跳过/未覆盖项；审查阻断关闭。
6. 更新 README、当前计划和新增验证记录；触发版本条件的包分别升版；任务分支合并、确认无独有提交和未保存修改后删除。

完成标准不再要求设计平台连接器或真实设计标注。旧 ID 评估器仍保持真实空集不通过和 productionAcceptance=false，不为本轮改口径而伪造真实评分。生产 G2、T11 真实业务试点的未完成项单独保留，不影响上述二期协议交付判定，也不会因此自动完成。
