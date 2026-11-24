# 真实项目发布最终修复验证补录（2026-11-24）

本记录补充 `docs/verification/2026-11-24-project-publishing.md`，不改写此前验证历史。最终整分支审查指出两项重要问题：旧格式上传会话可能在没有完成证明时提交发布作业；消费者可能只调用选中导出，却没有让它进入 Vue/React 的真实挂载生命周期。修复提交为 `0ac96519`。

## 行为结论

- Vue 与 React 的选中导出必须分别进入实际 `app.mount(...)` 或 React root render/commit 生命周期，随后才能绑定 readiness。只 import、手工调用导出或渲染无关内容均返回 `PREVIEW_IMPLEMENTATION_UNUSED`，不会生成最终 manifest。
- 只有 `uploadSessionId` 的旧会话先调用原 `POST /v1/uploads/:id/complete`。符合契约的完成证明写入 `uploadComplete:true` 后才提交发布作业。
- 完成端点拒绝、缺少字节或响应无效时返回 `UPLOAD_COMPLETION_UNPROVEN`；原 uploadSessionId、首次 idempotencyKey、manifest 摘要和冻结文件保持不变，不创建替代会话。
- 已经持有 `jobId` 的旧会话直接继续轮询原发布作业，不重新要求上传证明。

## RED / GREEN 与相关回归

I1 的原缺陷测试在修复前退出码为 1，实际结果为 **2 failed、1 passed、18 skipped/filtered**。两个失败分别证明：实现没有请求原会话的完成端点，以及实现会在取得原会话的有效完成证明前拒绝。修复后的同组用例退出码为 0，结果为 3/3 通过、18 个按名称过滤。

I2 在原实现过程中没有单独保存测试先行的 RED 产物，本记录不把后补验证冒充为原始 TDD 时间线。为补足回归证明，本轮随后使用 `8d66df2a` 的历史 `vite-consumer.ts` 实现隔离运行当前两个 Vue/React 生命周期拒绝用例，确认两者都会捕获缺陷；再恢复 `0ac96519` 当前实现并用完全相同的命令确认 GREEN。具体结果见下文“I2 追加历史实现回归验证”。

最终结果文件已归档到忽略目录 `test-results/project-publishing-final-fix/final-fix-evidence/`；这些文件是运行时原始证据，不随 Git 发布。以下表格在持久文档中保留完整命令、退出码和摘要：

| 证据 | 命令 | 退出码与结果 |
| --- | --- | --- |
| `i1-red.json` | `pnpm exec vitest run tests/integration/project-publish.test.ts -t "legacy upload session\|proves completion on the original legacy\|existing release job"` | 1；2 failed、1 passed、18 skipped/filtered |
| `i1-green-3.json` | 同上 | 0；3 passed、18 filtered |
| `project-publish-green-21.json` | `pnpm exec vitest run tests/integration/project-publish.test.ts` | 0；1 个文件、21/21 通过 |
| `related-green-51.json` | `pnpm exec vitest run tests/integration/cli-release.test.ts tests/integration/project-plan-consumer.test.ts tests/unit/cli-release-response.test.ts tests/unit/project-cli.test.ts` | 0；4 个文件、10 个 suite、51/51 通过 |
| `platform-real-green-2.json` | `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/project-publishing.test.ts tests/platform/release-sdk.test.ts` | 0；2 个文件、2/2 通过 |

`i1-red.json` 保存了当时捕获的精确命令。其余专项命令按结果文件中的测试路径整理为可复现命令；结果摘要来自对应 JSON，不把整理后的命令冒充为原始 shell 逐字记录。

## I2 追加历史实现回归验证

本验证只针对已经存在的两个参数化负例，不改测试或产品逻辑，不重跑宽套件。运行环境先设置：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\project\zhinexus-design-asset-platform\.tools\playwright'
$env:T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH = $env:PLAYWRIGHT_BROWSERS_PATH
```

两轮使用的精确 focused 命令相同：

```text
pnpm exec vitest run tests/integration/project-publish.test.ts -t "rejects a manually invoked"
```

历史轮仅把工作树中的 `packages/component-cli/src/project/vite-consumer.ts` 临时写入 `8d66df2a` 对应内容，不修改 index、HEAD 或其他源文件，并在 `finally` 中恢复原字节。历史轮退出码为 1：1 个文件失败，2 failed、19 skipped；Vue 与 React 两个用例都期望 CLI 退出 1，实际收到 0，证明旧实现会把手工调用并丢弃所选导出错误视为真实框架渲染。日志为 `i2-historical-red.log`。

恢复 `0ac96519` 当前实现后，同一命令退出码为 0：1 个文件通过，2 passed、19 skipped，日志为 `i2-current-green.log`。恢复前后 `vite-consumer.ts` SHA-256 均为 `A0D0239A3A5AB03C6D9493BD7B7EE30674BEB4FEA92954A30ABCD1F3D956F616`，该路径恢复后 `git status --porcelain -- packages/component-cli/src/project/vite-consumer.ts` 无输出。结构化摘要保存在忽略目录的 `i2-historical-regression.json`。

这项结果是实现完成后的历史版本回归验证，只证明现有测试能够捕获 `8d66df2a` 的缺陷并由 `0ac96519` 修复；它不是原始的“先写失败测试再实现”证据。

CLI 类型检查与构建通过，`pnpm verify:workspace` 通过。根 `pnpm typecheck` 结果为 15/15，其中 14 项复用缓存，`@company/component-cli:typecheck` 在本次修改后实际重新执行。以下命令按工作区脚本整理为可复现命令：

| 工作区命令 | 退出码与结果 |
| --- | --- |
| `pnpm --filter @company/component-cli typecheck` | 0；CLI 类型检查通过 |
| `pnpm --filter @company/component-cli build` | 0；CLI 构建通过 |
| `pnpm verify:workspace` | 0；11 个成员、公开/私有包与服务依赖边界通过 |

## 构建命令限制

精确命令 `pnpm build --force` 退出码为 1。根脚本展开为 `turbo run build --cache=local:rw --force`，当前 Turborepo 2.11.10 明确拒绝同时使用 `--cache` 与 `--force`。本轮未修改根脚本，也不把该命令记为通过。

使用等价的直接命令 `pnpm exec turbo run build --force` 验证实际强制构建，结果为 11/11 成功、0 个缓存命中。失败原文与等价命令完整日志分别保存在 `root-build-force.log`、`root-build-force-equivalent.log`。

| 构建/类型检查命令 | 退出码与结果 |
| --- | --- |
| `pnpm build --force` | 1；根脚本的 `--cache=local:rw` 与 `--force` 互斥 |
| `pnpm exec turbo run build --force` | 0；11/11 成功、0 cached |
| `pnpm typecheck` | 0；15/15 成功、14 cached，CLI typecheck 实际重跑 |

## 最新真实 Ready 证据

最终修复后重新运行 `tests/platform/project-publishing.test.ts` 与 `tests/platform/release-sdk.test.ts`，2/2 通过。前者重新打包 CLI，在工作区外安装并通过 Nest HTTP、PostgreSQL、MinIO、Verdaccio 发布到 Ready。最新证据生成于 2026-11-24 23:16（Asia/Shanghai），位于忽略目录 `test-results/project-ready/evidence.json`。

- 独立安装的 CLI `@company/component-cli@0.0.28` tarball SHA-256：`7f26d0fa01a35f772c759c3ba387a45f7649e4865335bb3406f79e174f9b8bb0`。
- 共享 Vue + React 作业 `e5585796-59e0-4bff-a3d9-f8af65cb58fe`：Ready；tarball `1ac41057d7ab1b2feed9194f9172ef2e70c93947505f35b5552a75de94963e8f`；manifest `17c72ddcabf892775c1100430c906ed5fee74bb3196c1e05ae8607c3ea8502df`；第 2 次 attempt 成功。
- Vue-only 作业 `ee4ab0ad-d6b2-461f-a178-ad5eb19bd17a`：Ready；tarball `11064db7581db66f2b0ab8c215d15f0852bcaa9c2e41b539626057221ec78ddd`；manifest `d3517fad8213d97c591a9598135f0c8965ce66ac389218da7572ceaa5073573a`；attempt 1。
- React-only 作业 `a5a0d660-5664-481e-a800-2c162c9d644f`：Ready；tarball `470578bc5132e460bd63119328bb59b3c05d4bd7e5aa3b2d2d76aed2bc78d4b8`；manifest `1c8c41ef3c9bef2a2f8fe98922ce670f43a62620802a49675097452fe6f49131`；attempt 1。

三组证据均记录 build 1 次、upload session 1 个、release job 1 个，并核对 registry 摘要与干净 registry 消费者安装。

## 根测试

首次 `pnpm test` 保留为失败证据：145/146 个文件通过，2459 个测试通过、2 个跳过、14 个失败。14 个失败全部来自 `tests/acceptance/t17-matrix/browser.ts:361`，原因是该套件读取专用 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH`，只设置通用 `PLAYWRIGHT_BROWSERS_PATH` 不会生效。失败日志保存在 `root-test.log`。

设置 `PLAYWRIGHT_BROWSERS_PATH` 与 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH` 均指向只读使用的 `D:\project\zhinexus-design-asset-platform\.tools\playwright` 后，可复现专项命令 `pnpm exec vitest run tests/acceptance/t17-matrix/browser.test.ts` 退出码为 0，1/1 文件、22/22 测试通过，日志为 `t17-focused-final.log`。随后同一环境中的 `pnpm test` 退出码为 0：T10 为 161 passed、7 skipped；Vitest 为 146/146 个文件、2473 passed、2 skipped。完整日志为 `root-test-final.log`。保留的非失败警告为既有 `DEP0190` 子进程警告和 Node `localStorage` 实验性警告。

| 根测试命令 | 退出码与结果 |
| --- | --- |
| `pnpm test`（首次，未设置专用 T17 浏览器变量） | 1；145/146 文件、2459 passed、2 skipped、14 failed，失败全部位于 T17 固定 Chromium 目录守卫 |
| `pnpm exec vitest run tests/acceptance/t17-matrix/browser.test.ts`（两个浏览器变量均已设置） | 0；1/1 文件、22/22 通过 |
| `pnpm test`（两个浏览器变量均已设置） | 0；T10 161 passed、7 skipped；Vitest 146/146 文件、2473 passed、2 skipped |

## 复审状态

最终定向复审覆盖 `8d66df2a..03f19fc6` 中的 I1/I2 产品控制流、对应回归测试、验证证据及修复 diff 是否引入新破坏，不把本轮范围扩大为对原分支全部功能的重新审查。

- I1 **ADDRESSED**：`packages/component-cli/src/local/release.ts:140-166` 对只有旧 `uploadSessionId`、没有 `jobId`/`uploadPlan` 且尚无完成证明的会话，先向原会话调用完成端点；网络失败、非 2xx 或不合约响应均以 `UPLOAD_COMPLETION_UNPROVEN` 失败关闭。只有有效证明持久化后，`:251-264` 才使用原会话、首次幂等键与原摘要提交发布。`tests/integration/project-publish.test.ts:204-295` 覆盖失败关闭、原会话完成后发布和已有 `jobId` 仅继续轮询。
- I2 **ADDRESSED**：`packages/component-cli/src/project/vite-consumer.ts:43-77` 只在所选冻结 React 导出完成 `useLayoutEffect` commit 或所选冻结 Vue 导出完成 `onMounted` 后触发绑定；`packages/component-cli/src/local/capture.ts:92-93,235` 在截图前拒绝未触发生命周期的页面。`tests/integration/project-publish.test.ts:127-173` 同时覆盖手工调用后丢弃的 Vue/React 负例和真实 mount/commit 正例。
- 新破坏：没有 Critical/Important。唯一 Minor 是本节此前把复审范围错写成“仅覆盖持久验证文档”；本次补录已按真实范围修正。
- 规格结论：**PASS（仅限本次 scoped findings）**。原整分支审查的两项 Important 均已关闭。
- 质量结论：**PASS WITH MINOR DOCUMENTATION NOTE**。产品修复失败关闭，相关负例、顺序、身份保持、正常框架语义和真实平台回归均有证据；上述 Minor 文案已修正。

复审实际核对了 `project-publish-green-21.json`（21/21）、`related-green-51.json`（4 文件、10 suites、51/51）、`platform-real-green-2.json`（2/2）、强制构建等价命令（11/11、0 cached）、最终根测试（146/146 文件、2473 passed、2 skipped）和类型检查（15/15）。复审未重跑产品门禁，也未审查修复 diff 未触及的产品代码。

I2 的历史 RED 是实现完成后的隔离历史版本回归。本轮能核对保留日志、结构化摘要、当前源码哈希和恢复后的干净状态，但无法仅凭静态产物逐步重建当时每一次临时替换动作；这不改变当前负例与完整目标集的 GREEN 结论。生产 OIDC/TLS、独立预览域名、G2/T11、两个真实业务项目试点及其他明确保留范围仍未验收，不能由本地 Ready 或本报告推断完成。

完整复审原文已复制到本地忽略证据目录 `test-results/project-publishing-final-fix/final-fix-scoped-review.md`。该目录用于保留运行生成证据，不随 Git 提交发布。

## 提交范围

`8d66df2a..03f19fc6` 新增提交如下；本次 docs-only 收尾提交的哈希应在提交完成后通过 `git log` 查询，不在提交自身内容中预填。

| 提交 | 目的 |
| --- | --- |
| `0ac96519` | 收紧真实框架生命周期证明，并要求旧上传会话先取得原会话完成证明。 |
| `1f738cd1` | 补录最终修复验证、根测试、构建限制与最新 Ready 证据。 |
| `03f19fc6` | 补录 I2 历史实现回归，明确其为事后证据而非原始 TDD 时间线。 |

本轮版本保持 CLI `0.0.28`、根 API `0.1.2`、Admin `0.0.2`；docs-only 收尾不触发版本升级。

## 决策账本

以下 23 项按本地归档 `test-results/project-publishing-final-fix/progress.md` 中 `Ruling:` 的出现顺序逐字保留，包含每项原因与错误代价，不新增或合并决策：

1. Execute implementers sequentially with fresh task reviewers — subagent-driven-development requires this and shared contracts must be reviewed first — cost if wrong: longer turnaround than safe independent parallel work.
2. Optional ECharts/styleExport/readyMethod fields for ordinary components, strict if present — real project support must not invent chart capabilities — cost if wrong: downstream consumers need guards around optional fields; full graph verification required.
3. Use apps/admin/app/lib for admin clients — actual repository structure differs from plan shorthand — cost if wrong: path-only rework.
4. Permit migration registry/rollback and narrow stale historical migration test updates in Task 1 — a new migration must register safely and existing migration 013 already invalidates old assumptions — cost if wrong: migration tests could miss regressions; retain rollback intent and record baseline.
5. Use existing isolated Node 26.13.0 with pnpm 12.18.0 — Node 24.6.0 failed the frozen @angular-devkit/core 22.2.6 engine check — cost if wrong: validation differs from global Node; no dependency rollback or global environment mutation.
6. implement short network interruption recovery via persisted validated upload plan/file checkpoints/uploadComplete; expired URLs fail closed while preserving frozen materials and original session, no unapproved C API change — frozen interfaces only support this recovery boundary — cost if wrong: longer interruptions need a later same-session renewal API; Task4 must report precise recovery limitation and assess any existing safe renewal path.
7. Restrict publication consumers to CLI-controlled Vite adapter with actual installed exact Vite/config, real module provenance and selected export execution marker; keep arbitrary component build/dev — arbitrary opaque consumer commands cannot prove screenshot provenance and reviewer reproduced wrong framework/outside alias — cost if wrong: developers using other consumer compilers need a dedicated Vite consumer or later adapter. Temporary wrappers must preserve Props/events/ref/ready API and not modify installed package/tarball. Config must clearly represent this adapter; no silently ignored consumer.build command.
8. Ordinary components publish with optional API fields, while existing chart assembly returns API_UNSUPPORTED when it lacks required style/ready metadata — low-code/automatic generic integration is a later delivery, and current MatchTarget must remain valid — cost if wrong: some ordinary components need future assembly compatibility work before automatic insertion.
9. Keep Vite/config plugins inside the developer local execution trust boundary and fail closed for browser-conditional entry differing from the checked Node ESM entry; document both limits rather than adding an unapproved compiler plugin whitelist — legitimate compilation requires developer adapters and this feature is provenance validation, not a malicious-local-process sandbox — cost if wrong: more consumer adapters/transform controls will be needed before claiming stronger attestation or supporting alternate browser entries.
10. Task4 C may fix the already-confirmed category-name NUL validation gap with contract+realHTTP RED/GREEN and schema/vendor sync — PostgreSQL cannot store NUL names and current503 misclassifies client input — cost if wrong: stricter name validation rejects previously syntactically accepted but unstorable inputs; verify create/update and inline CLI contracts stay aligned.
11. Preserve existing package-completeness contract and link admin selections by package; separate Vue/React publication uses separate packages, dual-framework shared package submits all implementations — published npm version is atomic and cannot be repacked after screenshots — cost if wrong: developers must split packages or supply all implementation materials when they want independent framework releases.
12. Continue Task4 with fresh higher-capability implementer because original provider quota prevents its next request — preserve all edits/results and recover pending checks, no restart of completed tasks — cost if wrong: replacement needs context reconciliation and may repeat narrow checks.
13. C may update stale bootstrap future-command expectation and establish independent worktree-local exact toolchain for existing path-bound acceptance — newCLI commands invalidate old placeholder and existing tests demand local executables — cost if wrong: test expectation could hide CLI regression; retain semantic argument checks and actual installed-bin evidence, original toolchain untouched.
14. Accept declined review boundary: malicious local Vite config/plugin process sandbox remains outside this iteration — local developer trust boundary is explicitly documented — cost if wrong: hostile local transforms require a separate stronger attestation design.
15. Accept declined review boundary: other compilers and differing browser/Node conditional exports remain unsupported — only current controlled Vite adapter is verified — cost if wrong: affected projects need dedicated adapters.
16. Accept declined review boundary: no automatic same-session URL renewal — platform has no such interface and original session must remain preserved — cost if wrong: expired partial uploads require a later platform endpoint.
17. Accept declined review boundary: Zip upload remains follow-up — approved spec explicitly defers it — cost if wrong: developers still prepare individual frozen materials.
18. Accept declined review boundary: complete history download/page-version binding remains follow-up — current precise consumer support is not a download UI — cost if wrong: users need a later version-download feature.
19. Accept declined review boundary: generic low-code adapter/editor metadata remains follow-up — ordinary npm imports are independent of chart assembly qualification — cost if wrong: generic automatic insertion requires later adapters.
20. Accept declined review boundary: productionOIDC/TLS/independent domain/G2/T11 remain unaccepted — local signatures and isolated stores cannot prove external deployment — cost if wrong: production launch still needs those acceptance gates.
21. Accept declined review boundary: arbitrary business projects are not universally validated — fixture and clean consumer evidence cover measured routes — cost if wrong: real projects may need compatibility fixes during pilots.
22. Use the equivalent direct Turbo forced-build command for final fix verification and preserve the pnpm build --force failure — current root build script explicitly supplies --cache=local:rw which conflicts with --force — cost if wrong: equivalence omits the explicit cache-mode option; require complete11/11 zero-cache evidence and do not alter root script or rewrite prior verification. Controller confirmed platform-real2/2, rootbuild11/11zerocached and typecheck15/15(14cached); root test pending.
23. Record a late isolated historical-implementation I2 RED/GREEN probe as regression evidence, not as original TDD chronology — the original I2 RED artifact is unavailable and evidence must not be invented — cost if wrong: the first test-before-implementation execution order remains unauditable; the appended probe must still prove both regressions and restore identical product bytes.

## 原始证据本地归档

`final-fix-evidence/` 的 15 个原始结果文件，以及 `final-review.md`、`final-fix-scoped-review.md`、`final-fix-report.md`、`progress.md`，均复制到本地忽略目录 `test-results/project-publishing-final-fix/`。复制后 19/19 个文件的源/目标 SHA-256 一致，并生成 `SHA256SUMS.txt`；该清单 SHA-256 为 `51EC2D3FD023D0CCF68BB8A8DA2372AF0D9E52EB830AB70999DDD7EEC4F86BFC`。这些运行生成文件不会随 Git 发布；即使后续清理计划 scratch，本地归档仍保留本轮原始输出。

## 保留边界

本轮仍未完成生产 OIDC/TLS、独立域名、G2 生产基础设施和两个真实业务项目试点。`Ready` 仅表示包与预览资源可达，不推断视觉基线、检查来源或检索索引状态。原始架构文档 SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
