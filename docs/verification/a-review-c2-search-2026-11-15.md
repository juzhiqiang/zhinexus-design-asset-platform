# 独立只读审查记录：C 工作区二期候选契约与资格过滤（C2）

- 审查时间：2026-11-15
- 审查方式：只读源码与测试审查（未修改 C 工作区任何文件，未在 C 工作区运行构建或测试）
- 被审查工作区：`C:\Users\10208\.codex\worktrees\c-phase2-search\zhinexus-design-asset-platform`
- 基线与状态：
  - 已提交：`e0a7f5ee`（`feat: 定义二期候选响应及证据评分校验契约`，父提交 `d4162065`）
  - 未提交：`apps/api/src/search/eligibility.ts`、`tests/integration/search-eligibility.test.ts`
- 参考基线：`docs/superpowers/plans/2026-11-15-phase2-candidates.md`、`rules/code-review.md`

## 审查结论

**无阻断项。**

## 核对清单与源码证据

1. **权限复读、Ready 状态与废弃拦截**
   - `apps/api/src/search/eligibility.ts:41` 强制要求 `current.canRead === true && current.availability === 'Ready' && current.packageState === 'READY' && current.jobState === 'READY'`，拦截 `canRead=false`、`DEPRECATED` 及非 `READY` 状态。
   - `apps/api/src/search/eligibility.ts:73-82` 在 `filterEligibleCandidates` 中对去重后的命中项先执行首轮 `loadCurrent(hit.variantReleaseId)` + `buildEligible` 过滤，随后在返回前执行第二轮 `loadCurrent(hit.variantReleaseId)` + `buildEligible` 复读，确保权限撤销、revision 过期及最新 `gaps` 在返回前生效。
   - 对应测试覆盖：`tests/integration/search-eligibility.test.ts:32-53`（权限、废弃、状态拦截及过滤 ID 不泄露）、`tests/integration/search-eligibility.test.ts:77-95`（复读撤销与 revision 过期）。

2. **索引 revision 与 providerVersion 一致性**
   - `apps/api/src/search/eligibility.ts:43-46` 校验 `candidate.variantReleaseId === hit.variantReleaseId`、`candidate.framework === context.framework`、`index.state === 'ready'`、`current.revision` 与 `current.activeProviderVersion` 非空，且 `hit.revision === current.revision`、`index.revision === current.revision`、`hit.providerVersion === current.activeProviderVersion`、`index.providerVersion === current.activeProviderVersion`。
   - 对应测试覆盖：`tests/integration/search-eligibility.test.ts:32-53`。

3. **精确 peer 版本与不推断 ECharts / ReactDOM**
   - `apps/api/src/search/eligibility.ts:22-24` 通过 `exactVersion` 委托 `validateProjectContext` 拒绝语义化范围（如 `^19.0.0`）。
   - `apps/api/src/search/eligibility.ts:26-37`（`peersSatisfied`）校验 `Object.hasOwn(required, context.framework)`，禁止 `hostPeers` 覆盖 `context.framework` 或 `context.echartsVersion`（不一致直接返回 `false`），并要求 `required` 中每个 `[name, version]` 通过 `exactVersion(version)` 且在 `known` 中精确相等；缺失 `echarts` 或 `react-dom` 时不猜测、直接拒绝。
   - 对应测试覆盖：`tests/integration/search-eligibility.test.ts:32-64`。

4. **旧摘要与兼容记录校验**
   - `apps/api/src/search/eligibility.ts:48-57` 对每条 `acceptedCompatibility` 记录调用 `validateApiMessage('variantCompatibilityResponse', ...)`，并逐项校验 `record.status === 'passed'`、`variantReleaseId`、`packageName`、`packageVersion`、`packageSha256`、`framework`、`frameworkVersion` 以及 `context.echartsVersion !== undefined && record.echartsVersion === context.echartsVersion`，同时使用 `Set<string>` 去重 `recordIds`。
   - 对应测试覆盖：`tests/integration/search-eligibility.test.ts:65-76`（含 `packageSha256` 等 9 类不匹配或非法记录拒绝与重复 ID 去重）。

5. **人工截图、兼容状态与视觉评分约束**
   - `packages/contracts/src/search.ts:16-46`：`candidateSchema` 使用 `object(...)`（`additionalProperties: false`），`candidateIssues` 强制校验 `(status === 'verified') !== (recordIds.length > 0)`、去重 `recordIds`、同时包含 `'api'` 与 `'docs'` 证据、`(e.kind === 'screenshot') !== (e.source !== undefined)`，以及 `candidate.ranking.visual !== undefined` 时必须存在 `'screenshot'` 证据（L42-44）。
   - `packages/contracts/src/search.ts:55-67`：`validateSearchCandidatesResponse` 逐个校验候选并拒绝重复 `variantReleaseId`（`DUPLICATE_ID`，L63）。
   - `apps/api/src/search/eligibility.ts:58-61` 对组装后的候选调用 `validateCandidate`，不满足契约（例如无截图却带 `ranking.visual`）时丢弃；`tests/integration/search-eligibility.test.ts:24-31` 与 `L96-100` 验证人工截图保持 `compatibility.status === 'unverified'` 且可省略 `ranking.visual`。

6. **服务端零执行边界与失败关闭**
   - `apps/api/src/search/eligibility.ts` 仅依赖 `@company/contracts` 与 `../errors.js`，未引入 `child_process`、`fs`、组件构建执行或 Playwright/浏览器逻辑。
   - `apps/api/src/search/eligibility.ts:67-68` 对非法 `ProjectContext` 抛出 `PlatformError('INVALID_SCHEMA', checked.issues)`；`tests/integration/search-eligibility.test.ts:101-104` 覆盖 `INVALID_SCHEMA` 抛出与 `loadCurrent` 异常透传（无部分成功伪结果）。

## 非阻断观察与未覆盖边界

- **非阻断观察**：`filterEligibleCandidates`（`apps/api/src/search/eligibility.ts:73-82`）当前通过按条顺序 `loadCurrent` 做首轮过滤与二次复读，跨命中项的事务一致性依赖后续数据库适配器实现（已在 `eligibility.ts:78` 说明）。
- **测试与运行边界**：
  - 用户指令已说明 C 作者已实跑 32 项过滤测试与 198 项契约测试通过；本审查保持只读，未在 C 工作区复跑构建或测试。
  - 当前阶段尚未接入真实 HTTP 路由与 PostgreSQL / 索引持久化适配器，相关端到端联调待后续阶段验证。
