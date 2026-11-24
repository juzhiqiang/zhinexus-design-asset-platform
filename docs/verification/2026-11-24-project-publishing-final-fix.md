# 真实项目发布最终修复验证补录（2026-11-24）

本记录补充 `docs/verification/2026-11-24-project-publishing.md`，不改写此前验证历史。最终整分支审查指出两项重要问题：旧格式上传会话可能在没有完成证明时提交发布作业；消费者可能只调用选中导出，却没有让它进入 Vue/React 的真实挂载生命周期。修复提交为 `0ac96519`。

## 行为结论

- Vue 与 React 的选中导出必须分别进入实际 `app.mount(...)` 或 React root render/commit 生命周期，随后才能绑定 readiness。只 import、手工调用导出或渲染无关内容均返回 `PREVIEW_IMPLEMENTATION_UNUSED`，不会生成最终 manifest。
- 只有 `uploadSessionId` 的旧会话先调用原 `POST /v1/uploads/:id/complete`。符合契约的完成证明写入 `uploadComplete:true` 后才提交发布作业。
- 完成端点拒绝、缺少字节或响应无效时返回 `UPLOAD_COMPLETION_UNPROVEN`；原 uploadSessionId、首次 idempotencyKey、manifest 摘要和冻结文件保持不变，不创建替代会话。
- 已经持有 `jobId` 的旧会话直接继续轮询原发布作业，不重新要求上传证明。

## RED / GREEN 与相关回归

I1 的原缺陷测试在修复前退出码为 1，实际结果为 **2 failed、1 passed、18 skipped/filtered**。两个失败分别证明：实现没有请求原会话的完成端点，以及实现会在取得原会话的有效完成证明前拒绝。修复后的同组用例退出码为 0，结果为 3/3 通过、18 个按名称过滤。

I2 没有单独保存修复前 RED 产物，本记录不补写或推断不存在的失败次数。`project-publish-green-21.json` 中“手工调用 Vue 导出但未进入框架生命周期”和“手工调用 React 导出但未进入框架生命周期”两个拒绝用例只作为修复后的覆盖证据，均为 GREEN。

最终结果文件保存在忽略目录 `.superpowers/sdd/2026-11-24-project-cli-publishing/final-fix-evidence/`；该目录是运行时原始证据，以下表格在持久文档中保留完整命令、退出码和摘要：

| 证据 | 命令 | 退出码与结果 |
| --- | --- | --- |
| `i1-red.json` | `pnpm exec vitest run tests/integration/project-publish.test.ts -t "legacy upload session\|proves completion on the original legacy\|existing release job"` | 1；2 failed、1 passed、18 skipped/filtered |
| `i1-green-3.json` | 同上 | 0；3 passed、18 filtered |
| `project-publish-green-21.json` | `pnpm exec vitest run tests/integration/project-publish.test.ts` | 0；1 个文件、21/21 通过 |
| `related-green-51.json` | `pnpm exec vitest run tests/integration/cli-release.test.ts tests/integration/project-plan-consumer.test.ts tests/unit/cli-release-response.test.ts tests/unit/project-cli.test.ts` | 0；4 个文件、10 个 suite、51/51 通过 |
| `platform-real-green-2.json` | `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/project-publishing.test.ts tests/platform/release-sdk.test.ts` | 0；2 个文件、2/2 通过 |

`i1-red.json` 保存了当时捕获的精确命令。其余专项命令按结果文件中的测试路径整理为可复现命令；结果摘要来自对应 JSON，不把整理后的命令冒充为原始 shell 逐字记录。

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

本补录修正后仍需一次仅覆盖持久验证文档的 scoped rereview。复审结论将在取得后追加到本节；当前不提前记录“通过”。

## 保留边界

本轮仍未完成生产 OIDC/TLS、独立域名、G2 生产基础设施和两个真实业务项目试点。`Ready` 仅表示包与预览资源可达，不推断视觉基线、检查来源或检索索引状态。原始架构文档 SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
