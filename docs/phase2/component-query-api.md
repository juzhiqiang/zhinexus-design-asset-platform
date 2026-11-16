# 组件精确查询接口使用说明（GET /v1/matching/components）

状态：二期协议说明。以下示例均为合成协议数据，版本号与 ID 仅用于说明格式，不代表真实业务样本，也不能证明接口已经在任何环境部署或通过公司 OIDC 接入。

## 标识与版本

- `componentId`：逻辑组件 ID，长度为 1–128 个字符，格式为 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`；区分大小写，不执行 trim 或转换，且不是组件导出名。
- `framework`：只允许 `vue` 或 `react`；同一个逻辑组件的两个框架实现必须分别查询。
- `packageVersion`：目标框架包的精确版本，拒绝 `latest`、`^`/`~` 范围、空值及不完整版本。
- `packageName`：可选，按传入值精确比较。如果同一条件下存在多个可读目标，且调用方未提供此字段，则返回 409，不会随意选择其中一个包。
- `variantReleaseId`：平台环境内的精确发布 ID；跨环境时需重新查询。

## 请求字段

| 字段 | 必填 | 说明 |
|---|---|---|
| componentId | 是 | 精确组件 ID |
| framework | 是 | vue / react |
| packageVersion | 是 | 包精确版本 |
| packageName | 否 | 用于消除歧义的包名 |
| frameworkVersion | 是 | 宿主框架精确版本 |
| echartsVersion | 是 | 宿主 ECharts 精确版本 |
| reactDomVersion | React 必填 / Vue 禁止携带 | 宿主 react-dom 精确版本 |

服务端只接受白名单中的单值字符串。出现未知键、重复键（包括百分号编码解码后重复的键）、数组或嵌套形式、`__proto__`、空值或畸形编码时，请求会被拒绝，服务端也不会二次解码。令牌只放在 `Authorization` header 中，并要求具备 read 权限。响应固定为 `Cache-Control: no-store`、`X-Robots-Tag: noindex, nofollow`；查询不会改变发布状态。

调用时使用 `URLSearchParams` 编码，地址与令牌由调用方安全注入，本文不提供任何实际地址或凭证：

```js
const query = new URLSearchParams({ componentId, framework, packageVersion, frameworkVersion, echartsVersion, ...(reactDomVersion ? { reactDomVersion } : {}) });
const response = await fetch(`${apiOrigin}/v1/matching/components?${query}`, { headers: { authorization: `Bearer ${token}` } });
```

<!-- example: vue-query -->
```json
{"componentId":"line","framework":"vue","packageVersion":"0.0.12","frameworkVersion":"3.5.45","echartsVersion":"6.1.0"}
```

<!-- example: react-query -->
```json
{"componentId":"line","framework":"react","packageVersion":"0.0.12","frameworkVersion":"19.3.1","echartsVersion":"6.1.0","reactDomVersion":"19.3.1"}
```

## 结果与错误

查询结果为 `matched` 时，必定包含 `target`、`api` 和 `exactDependencies`，但这只表示目标已定位且材料可读，并不表示接入验证通过；缺少兼容证据时，`compatibility.status` 保持 `unverified`，并带有 `COMPATIBILITY_UNVERIFIED`。结果为 `gap` 时，不包含 `target` 和 `api`，`exactDependencies` 为空，且 `gaps` 非空。

| 条件 | 响应 |
|---|---|
| 非法输入 | 400 INVALID_SCHEMA |
| 未认证 / 无 read | 401 UNAUTHENTICATED / 403 FORBIDDEN |
| 多个可读发布 | 409 CONFLICT，不泄露细节 |
| 不存在、无权、非 Ready、废弃、peer 不符 | 200 gap TARGET_UNAVAILABLE（同构） |
| 材料缺失或摘要不符 | 200 gap API_UNSUPPORTED |
| 精确依赖冲突 | 200 gap DEPENDENCY_CONFLICT |
| 基础设施故障 | 503 INFRA_UNAVAILABLE |

<!-- example: unavailable-response -->
```json
{"schemaVersion":1,"query":{"componentId":"line","framework":"vue","packageVersion":"0.0.99","frameworkVersion":"3.5.45","echartsVersion":"6.1.0"},"status":"gap","exactDependencies":[],"gaps":[{"code":"TARGET_UNAVAILABLE","message":"目标当前不可用"}]}
```

JSON Schema 只验证结构（类型、必填、枚举、格式、未知键）。React/Vue 条件字段、matched/gap 材料约束、query/target/api 身份一致性、精确依赖及兼容状态与缺口一致性，必须由公开运行时校验器（`validateComponentMatchResponse`）或等价规则强制；只运行 Schema 不足以证明通过。

使用侧实现等价校验时，需在 Schema 结构校验之外逐项检查以下规则。仓库内校验器由私有工作区包 `@company/contracts` 提供；外部使用侧可依据本规范实现，不要求从公共 npm 安装该私有包。

| 对象 | 附加规则 |
| --- | --- |
| `response.query` | 遵守与请求相同的条件：React 必须提供精确 `reactDomVersion`，Vue 必须没有此键。 |
| `status='gap'` | `target` / `api` 键缺席，`exactDependencies` 为空，`gaps` 非空，且不能含 `COMPATIBILITY_UNVERIFIED`。 |
| `status='matched'` | `target` / `api` 必须存在；`gaps` 只允许 `COMPATIBILITY_UNVERIFIED`。 |
| 目标身份 | `target.componentId`、`framework`、`packageVersion` 与 query 原值一致；query 若含 `packageName`，则必须与 target 一致。 |
| 证据 | `target.evidence` 至少包含一个 `api` 和一个 `docs`；不要求恰好两项，也不额外要求证据唯一。 |
| 兼容记录 | `recordIds` 不重复；`verified` 时非空，`unverified` 时为空。`unverified` 当且仅当存在兼容性未验证缺口；运行时未额外禁止重复 gap。 |
| 精确依赖 | 按包名唯一，包含目标包及其精确版本、query 指定的框架和 ECharts 版本；React 另包含指定的 react-dom 版本。允许额外的精确运行时依赖。 |
| API 身份 | `api.componentId`、`framework`、`exportName`、`exportPath`、`styleExport`、`readyMethod` 与 target 一致；props 和 events 的名称各自唯一，二者之间也不得重名。 |

调用方还必须将**整个** `response.query` 与本次原始请求逐字段核对，包括可选键是否存在；内部响应校验只能证明响应自洽，不能证明它属于本次请求。请求取消、输入修改或登录身份改变后，应忽略迟到结果并清除旧材料。权限和存储摘要的真实性由服务端检查，离线响应校验本身不能证明这些事实。

## 转为设计 ID 装配

当 GET 返回 `matched` 时，记录 `target.variantReleaseId` 与 `target.framework`，在使用侧配置的 `DesignIdMappingV1.entries` 中新增一条 `{ designId, framework, variantReleaseId }`（同一 `designId + framework` 只允许一条），再按既有 `DesignIdInputV1` 调用 `POST /v1/matching/plans`。POST 仍会重新校验资格，因此 GET 结果不能代替 POST 返回前的权限与资格复查。
