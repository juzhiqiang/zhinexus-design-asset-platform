# T05 登记引用与隐藏权限审计修正（2026-11-12）

基线 `f549341`，独立分支 `fix/t05-registry-references`，负责人 C。本文为审查后的新增验证记录，不改写 T05 首轮结果。

## 修正内容

- `check_reports.id`、`screenshots.id` 改为服务端 UUID；原 bundle 引用保存在 `client_ref`，按 `(job_id, client_ref)` 唯一。新的 `003_evidence_references.sql` 在迁移事务内转换存量外键，保留报告、截图元数据和 manifest 原内容；001/002 不变。转换 baseline 外键时仅在事务内临时禁用其不可变触发器，完成后恢复。
- 发布新版本可以复用客户端 report/screenshot ID；服务器映射外键，不改冻结文件或摘要。GET 作业返回可选 `baselineCandidates` 映射，仅包含 local-automatic 来源，手动发布返回空列表。候选列表不代表报告检查已通过；接受基线时仍严格验证报告、环境和摘要。
- 基线优先解析服务端截图 ID；旧引用仅在已经授权的 variant/example/environment 中唯一时接受，多条匹配返回 409 CONFLICT。旧引用跨 variant 无匹配返回 404，显式服务端 ID 的 variant 不匹配保持 400。手动截图仍返回 400 SOURCE_FORBIDDEN。revision 和审计记录保存解析后的服务器 ID。
- 上传 subject/client/channel 不匹配，以及作业访问者不满足读取权限时，对外继续 404；内部附带授权拒绝标记，由 `Platform.run` 统一登记 AUTH_DENIED。不存在的 ID 不伪造授权拒绝审计。

## RED 证据

新增真实 PostgreSQL / MinIO / Nest HTTP 回归，先构建 contracts 和 API，再运行：

```powershell
.\scripts\pnpm.ps1 exec vitest run --config tests/platform/vitest.config.ts tests/platform/registry-references.test.ts tests/platform/ownership-audit.test.ts tests/platform/database.test.ts
```

结果：3 文件、5 失败 / 1 通过。失败分别为：升级版本复用引用意外返回 409；作业响应没有 baselineCandidates；上传隐藏权限拒绝没有审计；作业隐藏权限拒绝没有审计；存量迁移后缺少 client_ref 列。

## GREEN 与类型检查

所有 pnpm 命令均经 `scripts/pnpm.ps1` 使用固定 Node 26.13.0 / pnpm 12.18.0 执行。

| 命令 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，没有依赖或锁文件变更 |
| `pnpm --filter @company/contracts build` | 通过 |
| `pnpm --filter @company/platform-api build` | Nest 实际编译通过 |
| `pnpm --filter @company/platform-api typecheck` | 通过 |
| `pnpm exec vitest run --config tests/platform/vitest.config.ts` | 7 文件 / 16 用例通过，真实 PG/MinIO，无 skip |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 首轮发现公共契约测试的 TS2698；合入主代理独立修复 `c7d96ac` 后通过 |
| `git diff --check` | 通过 |

Windows 根类型检查使用显式数组调用 `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`，避免 PowerShell 将 `-p` 解释为脚本参数。

存量测试从真实 001/002 创建旧数据，包含 report→screenshot→baseline revision→head 关系，再通过 migrateRegistry 应用 003 并重复迁移。验证原内容与理由保留、UUID/FK 有效、删除被引用记录被拒绝、重复 job/client_ref 被拒绝、baseline UPDATE 仍被不可变触发器拒绝。空数据库三轮迁移/回滚仍通过。

回归还验证：同 ID 新版本的六条截图/报告均独立；冻结 manifest/report JSON 不改写；原始 ID 在单份证据时兼容、产生歧义后拒绝、显式服务器 ID 可接受；现有并发 CAS、分片、上传 fencing 与原签名 URL 再写冻结不变用例保持通过。

## 边界

本子任务不运行浏览器或整仓测试；主代理负责整合后的全量验收、实际 SDK 材料与独立审查。公司 OIDC、独立预览域和完整 G2/T05 外部验收仍未完成；本次测试不替代这些证据。非阻断的 complete parts 输入复杂度优化留待后续处理。

根/API 仍为 `0.0.0` 骨架阶段，本次子任务不升版。未 push，未修改原始架构文档；当前 SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
