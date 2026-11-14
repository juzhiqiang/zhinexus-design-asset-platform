# B1 / B2 独立分发与候选兼容证据闭环验证记录（2026-11-14）

- **角色与分支**：B（`feat/b-cli-compatibility`，工作树 `C:/Users/10208/.codex/worktrees/b-cli-compatibility/zhinexus-design-asset-platform`，基线 `main` `bea8d3f912115791a322a3448e13797dcf4e92ad`）
- **范围与约束**：
  - 未修改主仓库、`packages/contracts`、根 `package.json`、`pnpm-lock.yaml`、冻结 SDK `0.0.10` 及 A/C 文件。
  - `@company/component-cli` 版本沿用未发布的 `0.0.8`（未执行 `push` / 合并 `main` / 删除工作树或分支）。

---

## 一、提交记录（固定 SHA）

- **B1**：`49057af6840ae74a0aa2541c3cd9591f56591715` — `feat(cli): 默认使用包内 dist/probe/probe.mjs 并声明外部安装运行时依赖`
- **B2**：`e76ab66933209c7d7624cd821eea1a66cf51f892` — `feat(api): 新增候选兼容证据提交、零信任校验、持久化与查询闭环`

---

## 二、任务 B1 交付与外部安装说明

1. **默认包内探针解析（不依赖仓库 `cwd` / `node_modules`）**：
   - 在 `packages/component-cli/src/commands/echarts.ts` 中新增 `resolveDefaultProbeEntry()`：基于 `import.meta.url` 解析包内 `dist/probe/probe.mjs`（源码 Vitest 运行时对应 `../../dist/probe/probe.mjs`），不再回退至 `process.cwd()/tests/acceptance/t10-sdk/probe.mjs`。
   - 保留 `--probe-entry <path>` 与环境变量 `ZHINEXUS_ECHARTS_PROBE_ENTRY` 显式覆盖；缺失探针入口或缺少浏览器依赖时明确报 `PROBE_ENTRY_NOT_FOUND` / `PROBE_FAILED` 并提示环境准备要求。
2. **CLI 入口隔离与打包配置**：
   - 新增独立 CLI 入口 `packages/component-cli/src/bin.ts`（`package.json` `"bin": { "component": "./dist/bin.js" }`），并将 `cli.ts` 子命令改为按需动态 `import`，确保外部仅运行 `echarts check/verify` 时不预加载 `vite` / `@playwright/test`。
   - `packages/component-cli/package.json` 保留 `"files": ["dist"]`，声明精确运行时依赖 `"@playwright/test": "1.65.0"` 与 `"vite": "8.3.8"`；`build` 脚本在完成 `sync-contracts` 与 `tsc -p tsconfig.build.json` 后，若存在 `scripts/package-probe.mjs`（A 侧交付）则自动执行打包生成 `dist/probe/probe.mjs`。
3. **浏览器准备要求**：
   - 外部安装执行真实浏览器探针需具备 `@playwright/test@1.65.0` 及 Chromium 浏览器（执行 `npx playwright install chromium` 或配置 `PLAYWRIGHT_BROWSERS_PATH` 指向可用浏览器目录）。

---

## 三、任务 B2 接口说明与 contracts 建议（给 C）

1. **数据库迁移（`apps/api/migrations/007_compatibility.sql` + `apps/api/src/db/migrate.ts`）**：
   - 新增 `compatibility_evidences` 表，绑定 `variant_release_id`、`package_release_id`、`package_name`、`package_version`、`package_sha256`、`framework`、`framework_version`、`echarts_version`、`candidate_integrity`、`candidate_source`、`status`（仅 `'passed'`）、`evidence`（jsonb）、`evidence_sha256`、`reason`、`subject`、`created_at`。
   - 唯一约束 `UNIQUE (variant_release_id, echarts_version)`，防止重复覆盖。
2. **HTTP 接口（`apps/api/src/compatibility/controller.ts` & `service.ts`）**：
   - `POST /v1/variant-releases/:id/compatibility`（`201`）：
     - 仅允许具备 `maintainer` 角色且对目标组件具备 `can_maintain = true` 的主体调用（`401` / `403`）。
     - 服务端零信任校验：复核 `packageSha256`、`evidence.bundle` 摘要/版本、`candidate.version/integrity/source`（拒绝 `'offline'`）、`integrityVerified` 标志、对应框架四维全 `'passed'`、`failures` 与 `uncovered` 为空、`policy` 全部满足且 `recommendation === 'adopt'`；任何 `hold`/失败/缺维度均返回 `400 COMPATIBILITY_EVIDENCE_REQUIRED`；重复提交或同版本冲突返回 `409 CONFLICT`；严禁服务端执行组件代码。
     - 成功持久化后写入 `audit_events` (`COMPATIBILITY_ACCEPTED`)。
   - `GET /v1/variant-releases/:id/compatibility` 与 `GET /v1/me/variant-releases/:id/compatibility`（`200`）：
     - 沿用 `CatalogController` 公开/私有 `catalog_can_read` 访问边界。
3. **建议 C 后续同步至 `packages/contracts/src/api.ts`**：
   - 在 `ApiMessages` 与 `schemas` 中补充 `createCompatibilityRequest`、`createCompatibilityResponse` 与 `variantCompatibilityResponse` 契约定义（当前 B2 严格按现有 `packages/contracts/src/errors.ts` 错误码运行，未改动 `packages/contracts`）。

---

## 四、TDD RED → GREEN 与实测验证结果

1. **B1（`tests/unit/echarts-cli.test.ts`）**：
   - **RED**：新增 `B1` 回归用例 → `.\scripts\pnpm.ps1 vitest run tests/unit/echarts-cli.test.ts` 失败（缺失 `@playwright/test@1.65.0` 依赖、外部无源码目录打包运行加载 `vite`/`@playwright/test` 报错）。
   - **GREEN**：`.\scripts\pnpm.ps1 vitest run tests/unit/echarts-cli.test.ts tests/unit/baseline-compare.test.ts tests/unit/baseline-cli.test.ts` → **3 files passed, 26/26 passed**（含无源码外部打包解压安装、缺失 `dist/probe/probe.mjs` 报错及环境变量覆盖验证）。
2. **B2（`tests/integration/compatibility-api.test.ts`）**：
   - **RED**：运行 `.\scripts\pnpm.ps1 vitest run tests/integration/compatibility-api.test.ts`（真实 PostgreSQL + MinIO + Verdaccio + Nest API）→ 未实现接口返回 `404` 失败。
   - **GREEN**：`.\scripts\pnpm.ps1 build:services` + `.\scripts\pnpm.ps1 vitest run tests/integration/compatibility-api.test.ts` → **1/1 passed**（覆盖 `401`/`403`/`404`、错摘要 `DIGEST_MISMATCH`、畸形证据 `INVALID_SCHEMA`、`hold` 及伪造 `adopt` 缺维度 `COMPATIBILITY_EVIDENCE_REQUIRED`、首次 `201` 持久化、重复提交 `409 CONFLICT` 与公开/私有查询边界）。
3. **构建、工作区与类型检查**：
   - `.\scripts\pnpm.ps1 --filter @company/component-cli build` → **passed**。
   - `.\scripts\pnpm.ps1 verify:workspace` → **passed**（`10 members, no cycles, four publishable shells, safe service graph`）。
   - `.\scripts\pnpm.ps1 typecheck` → **14 successful, 14 total** + 根 `tsc --noEmit` 通过。

---

## 五、未覆盖边界与待后续集成项

- A 侧 `packages/component-cli/scripts/package-probe.mjs` 与真实打包探针产物 `dist/probe/probe.mjs` 尚未合入本分支，因此**真实 `dist/probe/probe.mjs` 驱动 Playwright Chromium 在无源码外部安装的端到端实测**待 A 交付并与 C 集成后统一验证；
- 因未改 `pnpm-lock.yaml`，修改 `packages/component-cli/package.json` 新增运行时依赖后的锁文件更新待 C 统一 `pnpm install` 收口；
- 公司 OIDC、生产域名、真实业务试点项目仍保持未覆盖开放状态。
