# A 独立只读审查：C 二期 ProjectContext 契约变更（2026-11-15）

审查日期：2026-11-15  
被审查工作区：`C:\Users\10208\.codex\worktrees\c-phase2-search\zhinexus-design-asset-platform`（未提交变更，相对基准 `9ea600c0`；只读核查，未编辑或提交 C 工作区任何文件）  
审查依据：`docs/superpowers/plans/2026-11-15-phase2-kickoff.md`、`rules/code-review.md`、`docs/verification/c-phase2-project-context-2026-11-15.md`

---

## 审查结论

**无阻断项。** C 侧 `ProjectContext` 契约类型、运行时校验、独立 JSON Schema、18 项契约边界测试及 CLI `sync-contracts` 镜像传播均与 `2026-11-15-phase2-kickoff.md` 及 `rules/code-review.md` 一致，未发现兼容性伪证、私有依赖泄漏或契约漂移问题。

---

## 逐项核对证据（均基于 C 工作区只读检查）

1. **T13 字段与结构边界（`packages/contracts/src/project-context.ts:5-23`）**：
   - `framework` 限定 `choice('vue', 'react')`、`packageManager` 限定 `choice('npm', 'pnpm')`、`frameworkVersion` 必填 `exactVersion`、`echartsVersion` 可选 `exactVersion`（传入 `optional: ['echartsVersion']`）、`requirements` 必填 `array(text)`（`minItems: 0`，单项要求非空白字符且最长 2048）。
   - 使用 `object(..., ['echartsVersion'])`，`additionalProperties: false` 拒绝未知字段。
2. **`exactVersion` 与非 JSON 拒绝策略（`packages/contracts/src/schema.ts:15-16,38-72`）**：
   - 沿用现有 `exactVersion` 正则，允许精确 `x.y.z` 及 SemVer prerelease，拒绝 `^`、`~`、`*`、短版本及 `+build` 元数据；`validateSchema` 前置 `assertJson` 拒绝 `null`、`new Date()` 等非 JSON 值，并返回 JSON Pointer 诊断路径。
   - 注：prerelease（如 `19.4.0-rc.1`）在 `ProjectContext` 形状层允许，与 `packages/contracts/README.md:134` 描述一致；实际 ECharts/SDK 兼容层仍由后续过滤/兼容性模块把关（非阻断）。
3. **无兼容性伪证（`packages/contracts/src/project-context.ts:4`、`packages/contracts/README.md:139`、`tests/contracts/project-context.test.ts:26`）**：
   - 代码注释与文档均明确 `ProjectContext` 校验只证明输入形状，不构成兼容性或安装证据；测试显式拒绝携带 `compatibility: 'passed'` 的输入。
4. **Schema 注册与一致性（`packages/contracts/src/index.ts:16`、`packages/contracts/src/schemas.ts:1,39-43`、`packages/contracts/schemas/project-context-v1.schema.json:1-50`）**：
   - `project-context-v1` 已在 `CONTRACT_SCHEMAS` 注册，生成的 JSON Schema 字段、`required` 与 `additionalProperties: false` 与运行时定义一致；对应 `tests/contracts/api-schema.test.ts:35-40` 的磁盘一致性校验已随 171 项契约测试通过。
5. **18 项契约测试覆盖（`tests/contracts/project-context.test.ts:1-46`）**：
   - 覆盖 3 组有效输入、13 组非法输入（含非法框架/包管理器、范围/短/build 版本、空白/非字符串/超长需求、伪造 `compatibility`、缺必填项、`null`、`new Date()`）、1 项 `/frameworkVersion` JSON Pointer 诊断及 1 项 `CONTRACT_SCHEMAS['project-context-v1']` 断言，共 18 项。
6. **CLI `sync-contracts` 清单、镜像与打包边界（`packages/component-cli/scripts/sync-contracts.mjs:24`、`packages/component-cli/package.json:10,25-31`）**：
   - `sync-contracts.mjs` 已补齐 `'project-context.ts'`；实测核对 `packages/contracts/src/{index.ts,schemas.ts,project-context.ts}` 与 `packages/component-cli/src/contracts/` 对应镜像文件的 SHA-256 完全一致。
   - `component-cli` 的 `build` 脚本先同步契约再执行 `tsc` 与 `package-probe.mjs --check`，且 `dependencies` 不含私有 `@company/contracts`。
7. **基线文档与测试证据核验**：
   - C 工作区 `component-platform-architecture.md` SHA-256 实测为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，保持未变。
   - 作者已在 `docs/verification/c-phase2-project-context-2026-11-15.md` 记录：18 项新契约测试、9 文件 171 项契约测试、10 任务强制构建、14 任务强制类型检查及根 47 文件 758 项 Vitest 测试全部通过（A 本轮仅作只读核查，未在 C 工作区重复运行或改动任何文件）。

---

## 未覆盖边界

- 本审查仅针对 C 侧 `ProjectContext` 契约与 CLI 内联传播，未涵盖后续 `Candidate` / `MatchPlan` 契约、后端检索/兼容过滤或前端表单浏览器交互验收。
