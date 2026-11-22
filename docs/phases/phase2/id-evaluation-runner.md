# 确定性 ID 离线评估入口与报告模板

日期：2026-11-16。依据 2026-11-15 已确认的 ID 映射范围，D 负责文件输入与报告，评分复用 A 的 `tests/evaluation/id-matching.ts`。不调用模型、OCR 或网络接口。

## 执行

在仓库根目录执行，输出目录须已存在、输出文件须尚不存在：

```powershell
.\scripts\pnpm.ps1 exec tsx tests/evaluation/runner-id-cli.ts --cases tests/evaluation/design-cases.json --observations tests/evaluation/runner-id-observations.example.json --output .tools/id-evaluation-run-001.json --mapping-version synthetic-example-v1 --runner-version id-runner-v1
```

五个参数全部必填，仅支持 `--flag value`；拒绝重复、未知、空参数和等号形式。输出使用独占创建，已有报告及与输入重合的路径均拒绝。输入必须为合法 UTF-8 JSON（无 BOM）；不回显输入内容到 CLI 错误诊断。

| 退出码 | 含义 |
| --- | --- |
| 0 | real 分组满足评分门槛；仍不代表生产验收 |
| 1 | 评分未通过或 real 空集；报告已生成 |
| 2 | 参数、输入、结构或文件 I/O 错误 |

仓库样例只有一个 synthetic 用例，因此命令预期 exit 1。每轮使用新输出文件名；不要覆盖历史证据。函数入口为 `runIdEvaluation(casesJson, observationsJson, metadata)`。

## 输入分离

`design-cases.json` 是数组，每项仅包含 `caseId`、`origin` 和 `expected`。标注先由人工确定，不能从待评估输出反推。`origin` 必须显式写 `real` 或 `synthetic`，程序不推断真实性。

`expected.elements` 的字段沿用 A 评估器：`instanceId`、不透明 `designId`、`expectedStatus`、可选精确 `expectedVariantReleaseId` / `expectedFramework`、`requiredGapCodes` 及可选 `forbiddenVariantReleaseIds`；`expected.requiredPlanGapCodes` 指定计划级缺口。ID 原样比较，不解析命名规则或格式。

观测文件为独立数组，每项仅包含 `caseId` 和 `plan`，与案例一一对应。缺失、重复、多余观测和未知字段拒绝输入；有观测但其 plan 不符合 MatchPlanV1 时，作为硬违规计分，不跳过失败。

当前 `design-cases.json` 已替换为可运行的 ID 样例；之前的视觉/模型模板保留在 Git 历史。旧 `runner.ts` / `scoring.ts` 及其规范仍保留用于历史复现，不能把当前 ID 数组交给旧 runner。

## 报告与门槛

实际样例报告：[id-evaluation-report.example.json](docs/phases/phase2/id-evaluation-report.example.json)。该文件由 CLI 生成，可用作报告字段模板。

- `real` / `synthetic` 各自包含案例数、预期映射实例数、精确映射数/比率、硬违规案例数、缺失预期缺口和通过状态。
- 零分母为 `value: null` / `display: N/A`，空集不通过。沿用 A 的评分定义；顶层 `passed` 取 `real.passed`，合成分组独立报告。
- `failures` 保留失败 caseId、来源与原因。报告可能含案例标识，按输入资料访问范围归档。
- `inputSha256` / `observationSha256` 对合法 UTF-8 文件原始字节计算，不重新序列化。空白改变会改变摘要。
- `metadata.mappingVersion` / `runnerVersion` 由调用方填真实规则/运行器标识；不是系统自动背书。
- `productionAcceptance` 恒为 false。单元测试中临时设置 real 仅验证分组和退出码，不可计入真实业务验收。

## 当前缺口与交接

| 项目 | 状态 / 责任 | 关闭证据 |
| --- | --- | --- |
| 正式设计 ID 规范 | 外部待提供；C 协调业务/设计负责人 | 版本化规则、合法/冲突/未知 ID 的约定 |
| 设计平台导出格式 | 外部待提供；B/C 对接，D 消费观测 | 实际脱敏导出、实例与 designId 对应说明 |
| 真实业务标注与观测 | T13/T14 未完成；D 归档，A 对齐评分 | 独立人工 expected、真实 API MatchPlan、来源说明与摘要 |
| 真实评估报告 | 待上述输入；D 执行并回报 C | 真实分组精确映射 100%、误装配/硬违规 0 及缺口检查 |
| 模型接入 | 不属于当前确定性 ID 范围 | 不作为阻塞项 |

本轮只交付离线工具和合成示例。每次拿到新规则/导出/标注后，以新文件归档报告并同步 C；当前无新外部输入，完整 T13/T14 继续开放。
