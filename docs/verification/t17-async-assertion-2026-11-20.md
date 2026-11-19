# T17 异步浏览器断言修复验证（2026-11-20）

## 范围与前置证据

本记录为 `feat/t17-integration`、基点 `01aaddb7` 的独立补充记录，不重写 `.22` 原始验收。修复只涉及 `packages/component-cli/src/integration/verify.ts` 的断言阶段、新增直接产品测试 `tests/integration/project-verify-browser-assertions.test.ts` 与本记录。版本、CHANGELOG、新冻结包和完整技术验收由集成负责人另行收口。

前置公开入口诊断保存在 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/r08-async-assertion-probe-20261120-0635-valid/`。该诊断已证明冻结 CLI `0.0.22` 的 250ms 延迟更新会在 `timeoutMs=1500` 下过早失败。原 R08 失败瞬间的实际文本未留存，本记录不补推该文本，也不将新 synthetic 夹具称作原 R08 重跑。

已读当前 AGENTS、T17 专项计划、总计划 T17 与分工段、contracts 验证/授权定义，以及 platform、testing-release、code-review、security 规则。工具链实测为 Node `v26.13.0`、pnpm `12.18.0`；命令均经 `scripts/pnpm.ps1`，浏览器来自固定本地 Playwright Chromium。

## RED：先于生产修改的真实 Chromium 用例

```powershell
$env:T17_ASSERTION_EVIDENCE_ROOT = Join-Path (Get-Location) '.tools/t17-async-assertion/red-valid-artifacts'
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-verify-browser-assertions.test.ts','--reporter','verbose')
```

实际退出 `1`，`8 failed | 4 passed (12)`，耗时 `10.17s`。12 例均经公开 `verifyIntegration` 入口、实际 loopback HTML 与真实 Chromium，dependency-guard 通过，工程源快照无变化。最小包清单、锁和安装元数据为 synthetic fixture，用来隔离浏览器断言；这不是仓外冻结包或完整 apply 验收。

- 延迟 250ms 的既有元素精确文本更新失败，报告 `BEHAVIOR_FAILED`。
- 延迟新增和移除到零的两例精确 count 均失败。
- missing、hidden、zero-size 转为非零可见的三例均失败。
- 三条永久不匹配只在动作后 `94ms` 返回，未使用声明的 `600ms` 等待预算。
- 等待中取消例在计划的 250ms abort 之前已返回，`abortedAt=0`。
- 已有语义的四个负例通过：只认第一个文本匹配、内部空白精确比较、精确数量、只认第一个可见性匹配。

首次夹具遗漏生成文件，导致 precondition `INVALID_INPUT`；日志 `red.log` 与 `red-artifacts/` 保留，但不计产品 RED。补齐夹具后才生成上述 `red-valid.log` 和有效产品证据，随后才修改生产源码。

## 修复行为与语义边界

- 断言阶段建立一个 `Date.now() + browser.timeoutMs` 截止时间，所有断言共享；不修改 goto、ready 或 actions 原有超时协议，也不为每条失败断言重开完整预算。
- 依次等待每条声明条件，成功立即继续；失败按至多 25ms 的短间隔重采样，至共享期限耗尽。轮询检查真实条件，不以固定等待后直接放行。
- 保留 Playwright selector、`first()`、`textContent().trim()`、精确 count，以及 `isVisible()` 加正宽高 bounding box 的原语义。未引入唯一匹配要求、内部空白规范化或任意匹配放行。
- 可能等待元素的 textContent/boundingBox 查询受剩余预算限制；只将 `TimeoutError` 保留为对应条件不匹配，其他运行异常仍交给原失败关闭分类。
- 每次采样检查 AbortSignal，并沿用 abort 关闭浏览器的原机制。永久不匹配保留 `BEHAVIOR_FAILED` 与各条失败分类；取消保留 `CANCELLED`；没有增加执行或联网权限。
- 未提供视觉基线的正向浏览器例仍是 `visualResult=NEW`、总报告 `failed`，不会伪造完整验证通过。

## GREEN 与相关回归

| 实际命令（均通过 `scripts/pnpm.ps1 -PnpmArgs`） | 结果 / 退出码 | 日志 |
| --- | --- | --- |
| `exec vitest run tests/integration/project-verify-browser-assertions.test.ts --reporter verbose` | 首轮 12/12，11.23s / 0 | `green.log` |
| `exec vitest run tests/integration/project-verify.test.ts tests/integration/project-verify-cli.test.ts tests/integration/integration-repair.test.ts --reporter verbose` | 40/40，36.85s / 0 | `existing-vitest.log` |
| `build` | 10/10，8 cached；CLI 与 gallery 实际构建 / 0 | `build.log` |
| `--filter @company/component-cli typecheck` | 通过 / 0 | `typecheck.log` |
| `test:browser generated-page.spec.ts` | 完整 1/1，用例 53.8s、总计 59.9s / 0 | `generated-page.log` |
| `exec tsc -p tsconfig.json --noEmit` | 最终通过 / 0 | `root-tsc-final.log` |
| `exec vitest run tests/integration/project-verify-browser-assertions.test.ts tests/integration/project-verify.test.ts tests/integration/integration-repair.test.ts tests/integration/project-verify-cli.test.ts --reporter verbose` | 最终 52/52，43.70s / 0 | `final-focused.log` |

根 tsc 首次发现新测试的 `snapshots.exists` 被推宽为 boolean；给该测试夹具标注现有 `IntegrationPlanV1['baseFileHashes']` 后通过，原失败输出保留在 `root-tsc.log`。后续最终 52 项使用已修正测试；文本正例还额外覆盖多匹配 `.status` 与 Playwright `>> nth=0` 选择器。

运行 generated-page 前已完成 build，并读取确认 `5173–5176` 无监听；没有关闭其他进程。既有永久负例真实消耗预算后，完整用例仍在自身 `120s` 上限内完成。输出存在既有 `NO_COLOR` / `FORCE_COLOR` 环境警告，不影响退出码。

最终新增 12 项证据在 `green-verified-artifacts/`：六个延迟成功例动作至返回为 `345–379ms`；永久三条件共享 `600ms` 后在动作至返回 `691ms` 内失败；取消例在 abort 后 `5ms` 返回 `CANCELLED`。这些观测包含截图、环境采集和关闭开销，不是对部署机器延迟的保证。

## 证据、摘要与自审

本次证据根为仓内忽略目录 `.tools/t17-async-assertion/`。`evidence-manifest.json` 列出有效 RED、最终 GREEN 产品文件与相关日志共 `273` 项；重新核对 93 个产品 artifact 引用，文件字节数与 SHA-256 全部一致。已复读延迟文本成功截图（显示 done/unused）与永久失败截图（显示 pending）；隐藏 span 仍只参与 textContent 精确判断。

| 文件 | SHA-256 |
| --- | --- |
| `red-valid.log` | `62776f1df2e718f0f8868222be9d8dde01c35b1f06f77a6152e080b476d99ff7` |
| `final-focused.log` | `813fc2a3a0f54b69e6d4b2e28e579c8a0220ce42fadb77adb7ce4d62eecdeec9` |
| `generated-page.log` | `b91c05e8ae6e47989dc7776cb40cdb15d1af8b70cfc16c3ce29a89bb801d0bea` |
| `evidence-manifest.json` | `adb5fe739a0d2c9163de00bdd0ca5284d1388f5f511a48871fbacb18bfdf712d` |

自审覆盖共享截止时间、等待成功即返回、first/trim/精确数量/尺寸、超时与取消分类、选择器兼容、证据摘要、源写集和失败关闭；本次范围未发现待处理 Critical/Important。`git diff --check` 通过，原架构 SHA-256 仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。

本次没有改版本、pack、覆盖冻结 `.22` tarball、修改矩阵预期、push、merge 或尝试受阻清理。完整根测试、平台与浏览器全量回归、新版本冻结安装、双框架矩阵与独立审查由集成负责人另行执行；本记录不单独声明完整 T17、真实业务试点或生产 G2 完成。
