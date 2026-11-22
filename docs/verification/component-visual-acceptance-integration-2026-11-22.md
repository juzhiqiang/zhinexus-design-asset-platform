# 组件验收材料合并与本机复验

2026-11-22，Windows x64，Asia/Shanghai。负责人：Codex。按用户此前“完成后合并回主分支”的授权，本轮 QA 与测试准备材料合并到本地 `main`。

## 合并范围

- 主分支原提交：`f0e8e418bbe76a638003d493bb2eaf4b48fcdf5b`，已包含其他任务的自主管理账号实现。
- 本轮验收分支提交：`ced0707c`（工具/证据）、`fe9e898d`（资产/测试表）、`6b662d13`（独立审查）、`172e7d4c`（合并前常规回归）。
- 合并提交：`3861b86e1093d4f66c1ee5ad2a16902c698f4ebc`，两个父提交为上述主分支与 `172e7d4c`；46 个文件，仅新增本轮文档、图像和 `tests/acceptance/chart-visual/` 工具。
- 未修改 SDK、示例、账号实现、API、公共契约、锁文件或根配置。原始架构摘要仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`；README 在本轮合并中没有变化。
- 合并前主工作区出现未跟踪的 `.write-test-docs`，确认不与合并路径重叠，原样保留并核对摘要；没有暂存或删除该文件。

## 合并结果上的实际命令

均通过项目固定 Node `26.13.0` / pnpm `12.18.0` 执行，日志保留在主工作区忽略目录 `.tools/qa/component-visual-integration/`。

| 命令 / 核对 | 实际结果 |
| --- | --- |
| `.\scripts\pnpm.ps1 install --frozen-lockfile` | exit 0，锁文件未变化 |
| `.\scripts\pnpm.ps1 exec turbo run build --force` | exit 0，10/10 successful、0 cached，21.462 秒 |
| `.\scripts\pnpm.ps1 verify:workspace` | exit 0，10 个成员、无循环、服务依赖边界通过 |
| 两个 QA 脚本 `node --check`，以及合并范围 `git diff --check` | exit 0 |
| 合并后的 JSON/PNG/裁切/版本/导出/本地链接核对 | exit 0，302 格、23 联系表、14 裁图、151 对数据、57 链接；原图从保留的 QA 工作区读取并核对，不复制为发布材料 |
| `.\scripts\pnpm.ps1 test`，首次 | exit 1；Vitest 127 文件通过 / 9 文件失败，2318 passed / 25 failed / 2 skipped（2345 项），331.70 秒 |
| `.\scripts\pnpm.ps1 exec vitest run tests/integration/cli-release.test.ts`，定位复现 | exit 1，1 项失败；`captureExample` 启动浏览器时报告固定目录没有 Chromium executable，尚未进入发布断言 |
| `.\scripts\pnpm.ps1 exec playwright install chromium` | exit 0，补齐主工作区 `.tools/playwright` 中的固定 Chromium/headless shell `158.0.8127.18` |
| 本机临时 launch-browser.mjs | exit 0，实际启动并关闭浏览器，读回版本 `158.0.8127.18`；前一次 Node `-e` 调用被 PowerShell 参数绑定拒绝，未运行浏览器，不算验证通过 |
| `.\scripts\pnpm.ps1 test`，补齐浏览器后完整复跑 | **exit 0**；T10 161 passed / 7 skipped；Vitest **136 文件通过、2343 passed / 2 skipped / 0 failed**（2345 项），428.59 秒 |

首次失败的 9 个文件为 cli-baseline、cli-bundle、cli-check、cli-release、compatibility-api、packed-consumer-frameworks、packed-consumer，以及 T17 matrix 的 browser/product-executor。完整错误记录均指向缺少本机截图浏览器，CLI 返回值断言也在该启动失败后中断。安装只补本地忽略目录，不修改产品代码，不删除首次失败日志。

补齐同版本浏览器后的完整复跑消除了上述 25 项失败，没有改动代码或放宽断言。测试期间 `main` 保持在 `3861b86e`；本地合并、全量无缓存构建、常规回归与材料完整性复核均完成。

## 验收边界

[原始 QA 记录](component-visual-acceptance-2026-11-22.md) 的 **300/302 与 V01–V03** 保持不变；没有在主工作区重跑该 runner 覆盖历史图片。本次常规回归和材料合并不替代小屏/深色/空实心饼图路径复验。

[首批资产草案](../acceptance/first-batch-assets-2026-11-22.md) 与 [平台测试清单](../acceptance/platform-test-checklist-2026-11-22.md) 已在主分支。后续先按清单检查真实身份栈的管理员/成员登录和撤权，再做冻结资产发布与隔离预览闭环；真实公司账号、真实 Vue/React 业务项目和生产 G2 仍待独立实际验收。

本轮只完成本地合并，没有 push；验收工作区和分支保留供查看原图、运行日志与问题复现。纯 tests/docs 不触发产品升版。
