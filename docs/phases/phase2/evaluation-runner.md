# 二期 A3 离线评估 Runner 规范

> 对应实现：[runner.ts](file:///C:/Users/10208/.codex/worktrees/a-phase2-profiles/zhinexus-design-asset-platform/tests/evaluation/runner.ts)、[scoring.ts](file:///C:/Users/10208/.codex/worktrees/a-phase2-profiles/zhinexus-design-asset-platform/tests/evaluation/scoring.ts)。
> 本 runner 仅用于离线评估执行与报告归档，不定义公共 `@company/contracts` DTO，也不代表已具备真实 30+ 标注集（T14 仍未完成）。

## 命令接口

```powershell
.\scripts\pnpm.ps1 exec tsx tests/evaluation/runner.ts `
  --cases <path> `
  --observations <path> `
  --output <path> `
  --retrieval-version <version> `
  --model-version <version-or-none>
```

### 参数约束

- 5 个参数全部必填：`--cases`、`--observations`、`--output`、`--retrieval-version`、`--model-version`。
- 支持 `--flag value` 与 `--flag=value` 形式；`--model-version` 可显式传入 `none`。
- 拒绝缺失参数、空值、重复参数、未知参数以及位置参数。
- 函数入口 `runEvaluationCli(argv, deps)` 支持注入 `now`、`stdout`、`stderr`，便于确定性复现。

## 输入文件契约（严格校验，拒绝未知字段）

### `cases` JSON

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "caseId": "case-001",
      "origin": "real",
      "category": "matchable",
      "acceptableVariantIds": ["var-1"],
      "requiredGapFields": ["peer:react-dom"],
      "split": "eval"
    }
  ]
}
```

- 顶层仅允许 `schemaVersion`（必须为 `1`）与 `cases`（数组）。
- 每个条目仅允许 `caseId`、`origin`、`category`、`acceptableVariantIds`、`requiredGapFields`、`split`。
- `split` 必须严格为 `'eval'`，拒绝 `'train'` 或其他值。
- `origin` 仅允许 `'real'` 或 `'synthetic'`，保留分组且不推断真实样本。

### `observations` JSON

```json
{
  "schemaVersion": 1,
  "observations": [
    {
      "caseId": "case-001",
      "top5VariantIds": ["var-1"],
      "gapFields": ["peer:react-dom"],
      "hardViolations": []
    }
  ]
}
```

- 顶层仅允许 `schemaVersion`（必须为 `1`）与 `observations`（数组）。
- 每个条目仅允许 `caseId`、`top5VariantIds`、`gapFields`、`hardViolations`。
- 拒绝未知或重复 `caseId`（复用 `scoreEvaluation` 校验）。

## 输出报告与写保护

- 输出采用独占创建 `wx`（`flag: 'wx'`），拒绝覆盖已有文件或输入文件。
- 报告包含：
  - `schemaVersion`: `1`
  - `inputs`: `{ casesSha256, observationsSha256 }`（按原始文件字节计算 SHA-256）
  - `versions`: `{ retrievalVersion, modelVersion }`
  - `generatedAt`: ISO 8601 时间戳
  - `score`: `scoreEvaluation(cases, observations)` 完整结果（含 `real`、`synthetic`、`passed`、`failures`）
- 控制台输出仅打印简短汇总或失败原因，不打印原始案例/观测数据或环境变量凭据。

## 退出码语义

- `0`：输入合法、报告写入成功且 `score.passed === true`（满足 `real` 组全部门槛）。
- `2`：输入合法且报告写入成功，但 `score.passed === false`（未达标）。
- `1`：参数错误、JSON/Schema 校验失败或文件读写 IO 错误（含输出文件已存在）。
