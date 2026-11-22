# ID 观测交接说明（2026-11-16）

状态：真实材料交接与审计准备；目前没有新增外部真实样本，G2、T13/T14 完整验收仍未完成。本文由实际 Claude Code CLI 文本模式起草，C 对照当前 routes、contracts、runner 与评分器审校并落盘；本次未修改产品行为、案例或评分代码。

## 输入与责任

| 材料 | 责任与内容 |
| --- | --- |
| 版本化设计规则、导出与业务标注 | 业务/设计负责人提供；C 协调，B 对接导出，D 归档 |
| cases | D 按 A 的评分定义整理独立人工 expected；标注人、复核人、日期和依据单独留档 |
| 请求与响应 | C 取得实际 API 观测，保留请求/响应对应关系及获取时间；不得保存 Bearer token、cookie 或其他凭证 |
| observations 与报告 | D 按精确 caseId 关联，记录原始材料摘要、运行器提交和规则标识 |

`origin: real` 和报告版本字段均为调用方声明，现有 runner 不验证来源真实性。人工 expected 必须先于待评估输出确定，不能从 MatchPlan 反推。真实接口返回合成输入的结果仍属于 synthetic。

## API 成功体如何成为观测

C 的 `POST /v1/matching/plans` 经鉴权的 `read` 操作调用 `MatchingService.plan(body, subject)`；路由成功响应为 HTTP 200，并设置 `Cache-Control: no-store` 与 `X-Robots-Tag: noindex, nofollow`。请求契约为：

```json
{
  "design": {
    "schemaVersion": 1,
    "mapping": {
      "schemaVersion": 1,
      "ruleSetId": "example-rules",
      "revision": "1",
      "entries": [{ "designId": "sales-line", "framework": "react", "variantReleaseId": "replace-with-real-release-id" }]
    },
    "elements": [{ "instanceId": "chart-1", "designId": "sales-line" }]
  },
  "context": {
    "framework": "react",
    "frameworkVersion": "19.3.1",
    "echartsVersion": "6.1.0",
    "packageManager": "pnpm",
    "requirements": []
  },
  "reactDomVersion": "19.3.1",
  "bindings": [{ "instanceId": "chart-1", "props": [], "events": [], "layout": "full-width" }]
}
```

这是结构示例；采集时替换为获准的真实规则、发布 ID、项目上下文和绑定。完整请求契约以 `packages/contracts/src/match-plan.ts` 的 `MatchPlanRequest` / `validateMatchPlanRequest` 为准，不能直接把 `DesignIdInputV1` 当作 HTTP 请求体。`design` 子结构见 `packages/contracts/src/design-id.ts`，其中 `mapping.schemaVersion` 也必填；元素 instanceId 唯一，映射中的 designId/framework 对唯一，ID 按原样精确比较，不解析格式。

`context` 必填 `framework`（vue/react）、`frameworkVersion`（精确版本）、`packageManager`（npm/pnpm）、`requirements`（字符串数组，可为空）；`echartsVersion` 可选，提供时必须为精确版本。外层 `reactDomVersion`、`bindings` 可选；绑定必须引用 design 中的 instanceId，并包含 props/events 数组，layout 可选。结构通过不代表目标可用、参数绑定完整或兼容性已验证。

每个案例在 observations 中恰有一项 `{ caseId, plan }`。`plan` 为对应成功响应的 JSON 对象，不添加 expected、HTTP 包装或来源元数据；来源材料单独归档。缺失、重复、多余观测、外层未知字段均拒绝输入（exit 2）。有 plan 但不符合 MatchPlanV1 时，由评分器作为硬违规计分，不跳过失败。

鉴权失败、4xx/5xx、超时和网络错误不得伪装为成功 MatchPlan。单独记录操作失败与响应摘要，保持该轮采集未完成；不得静默剔除失败案例后声称全量通过。保留该 case 却缺观测时 runner 会拒绝输入。若确需按子集评估，必须事先明确子集范围、遗漏清单与未覆盖边界，不能据此关闭完整验收。

## 真值、版本和摘要

cases 文件是数组，每项只含 `caseId`、`origin`、`expected`。expected 的元素字段与计划级缺口沿用 [现有 runner 指南](docs/phases/phase2/id-evaluation-runner.md)，不在 cases 内放请求、plan 或凭证。

来源清单关联 caseId、导出版本、请求文件 SHA-256、响应文件 SHA-256、调用时间和必要的非敏感请求标识。原始响应与脱敏副本分别保留自己的摘要；禁止把脱敏或重新序列化后的摘要称为原始响应摘要。受限原始材料放受控存储，仓库仅放获准的脱敏材料及证据说明。

`metadata.mappingVersion` / `runnerVersion` 由调用方填写。交接时人工核对 mappingVersion 与每条 plan 的 ruleSetId/revision 一致，并记录 API、contracts、runner/评分器的实际 Git 提交及 Node/pnpm 版本。runner 只校验元数据为非空字符串，不会自动核验版本与代码、规则的一致性；`id-runner-v1` 不能替代 Git 提交证据。

`inputSha256` / `observationSha256` 对 cases / observations 合法 UTF-8 文件的原始字节计算（无 BOM），不重新序列化；空白改变也会改变摘要。这两个摘要与原始 HTTP 请求/响应摘要分别归档。

## 精确执行命令与退出码

在 D 工作树根目录执行，输出目录先存在，输出文件使用本轮未占用的新名字：

```powershell
.\scripts\pnpm.ps1 exec tsx tests/evaluation/runner-id-cli.ts --cases tests/evaluation/design-cases.json --observations tests/evaluation/runner-id-observations.example.json --output .tools/id-handoff-synthetic-20261116.json --mapping-version synthetic-example-v1 --runner-version id-runner-v1
```

这是已有 synthetic 样例的演练命令，预期 exit 1、real 为空、synthetic 独立计分、`productionAcceptance: false`。真实轮次替换成已审核的 cases / observations、新输出路径和真实规则标识。旧报告不覆盖；五个参数必填，使用 `--flag value`。

| 退出码 | 实际含义 |
| --- | --- |
| 0 | real 分组满足评分门槛；productionAcceptance 仍为 false |
| 1 | 评分未通过或 real 空集；报告已生成 |
| 2 | 参数、输入结构/编码或文件 I/O 错误 |

评分器会验证 plan 并进行内容评分；runner 不检查 HTTP 状态、身份来源或版本血缘。real 零分母为 N/A/null，空集不通过。synthetic 不替代真实业务样本。

## 外部缺口与关闭证据

| 缺口 | 关闭证据 |
| --- | --- |
| 正式设计 ID 规则 | 业务/设计负责人确认的版本化规则、合法/冲突/未知 ID 约定 |
| 设计平台导出 | 获准脱敏导出、实例—designId 对应及来源版本 |
| 独立真实标注与 API 观测 | 独立人工 expected、完整采集范围、真实 MatchPlan、来源清单与分别计算的摘要 |
| 真实评分与生产验收 | 真实精确映射 100%、误装配/硬违规 0、缺口检查通过；另完成 G2 外部服务验收 |

责任角色已明确，外部业务/设计责任人的实名与交付材料仍待 C 协调。没有新外部材料时保留当前未完成状态，不反复制造“真实通过”报告。

## 本轮审校说明

Claude Code 以 `--print --tools '' --output-format json` 生成草稿并 exit 0；未宣称执行 Windows 测试或提交。C 补齐 mapping.schemaVersion，纠正“失败 case 本轮不计”和“runner 不校验 plan 内容”的表述，明确原始/脱敏摘要及凭证归档边界。实际命令演练和提交由 C 执行。

## C 宿主验证（2026-11-16）

在 D 工作树以固定 Node 26.13.0 / pnpm 12.18.0 执行上文 synthetic 演练命令，实际 exit 1，输出 `runner-id: FAIL real=0 synthetic=1 hardViolations=0`，符合 real 空集不通过的预期。新报告位于 ignored `.tools/id-handoff-synthetic-20261116.json`，没有覆盖旧报告。

- real：0 条，精确匹配率为 null（N/A），passed 为 false。
- synthetic：1 条，1/1 精确匹配，passed 为 true；productionAcceptance 为 false。
- 对 cases 与 observations 原文件执行 `Get-FileHash -Algorithm SHA256`，分别与报告 inputSha256、observationSha256 对比，结果均为 true。
- `git diff --check` 通过。本次只新增本文；未更改案例、runner、评分器或 A 的评估器。

这次演练仅验证交接命令和空真实集边界，不能替代真实规则、设计导出、独立标注、API 采集或 G2 外部服务验收。
