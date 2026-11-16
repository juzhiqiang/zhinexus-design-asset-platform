# B CLI / 手动提交验收补充（2026-11-16）

本轮基线为 `feat/b-release-acceptance-20261116` / `36b9cfbd`。B 使用实际 Claude 桌面端完成审计、测试和实现；其沙箱缺少 Windows 固定工具链与 node_modules，C 在 B 的独立 worktree 执行验证、审查和提交。所有工作区命令均经 `.\scripts\pnpm.ps1` 使用 Node 26.13.0、pnpm 12.18.0；下表省略该前缀。日志保留在忽略目录 `.tools/`。

## 本轮修复与 RED / GREEN

- `runCheckCommand` 原先只在安装前验证冻结包，安装/截图期间改变 tarball 后仍可能生成成功报告。新增截图后、基线/报告前的 core 与当前框架 tarball 验证；错误进入原有失败返回，当前框架不写成功报告。
- `prepareReleaseBundle` 先将冻结包复制到 bundle，但消费者安装 staging 源。复制后只改变 staging 时，最终校验仍可验证原样的 bundle 副本与报告，未能发现消费者来源错绑。修复在复制后比较目标 SHA-256/bytes 与冻结身份，在安装后和每次截图后复核 core 与当前框架 staging。失败直接抛错，CLI 返回非零退出码；不重新打包。
- 最终 `validateReleaseBundle` 原本确实绑定报告摘要和包引用，不能表述为“仅做内部自洽”。本轮缺口是被核验的 bundle 副本与消费者 staging 来源分离。
- 手动截图来源维持 `manual-upload`，逐框架必填校验保持前端/API 双端执行。不同框架截图可以具有相同 PNG 字节，本轮未引入 SHA 唯一性规则。

| 阶段 | 宿主实际证据 |
| --- | --- |
| check RED（12:50） | 2 failed / 5 passed；`.tools/b-tamper-red-20261116.log` |
| staging 来源审查探针（12:56:54） | Vue/React × 对照/core/framework 共 6 项探针断言通过：篡改场景的实际 file: 读取 SHA 与 bundle SHA 不同，旧编排仍返回成功。探针用于复现缺陷，不是验收通过 |
| bundle RED（13:04:09） | 1 passed / 8 failed；安装/截图 × core/framework × Vue/React 的篡改场景均未被阻断；`.tools/b-bundle-tamper-red-20261116.log` |
| 最终 GREEN（13:12:20） | 7 文件 / 70 项通过，2.54s；`.tools/b-final-green-unit-20261116.log` |
| 停写后断言补强（13:14:31） | C 按独立审查意见为四处 SHA 差异断言先验证两侧均为 64 位小写十六进制，排除 undefined 误通过；bundle 测试 10/10 通过，741ms，根 tsc exit 0；`.tools/b-final-bundle-assertions-20261116.log` |

新增 bundle 测试包含 8 个篡改场景和 Vue/React 两个正常对照。保持冻结、磁盘摘要、报告、清单验证真实运行；pnpm pack、npm 安装/构建、Vite 和 Playwright 使用替身。安装场景从消费者 package.json 的 file: 路径读取真实磁盘 SHA；截图场景记录变异 SHA。异常使用 rejects 断言，首个组件失败时 reports 为空且 manifest 不存在。check 编排测试包含 Vue 对照和安装/截图 × core/framework 四个场景；React 的同一 check 分支由下述两次真实 all 检查覆盖。

这些测试没有模拟篡改后立即恢复原字节的敌对并发写入，也未直接注入 bundle copy 阶段篡改；复制身份校验经代码审查及正常真实链路验证。多组件晚期失败可能保留较早生成的报告，但本次不会生成完整成功 manifest；不能把剩余局部文件当作成功发布材料。

## 实际验证命令

| 命令 / 范围 | 实际结果 | 日志 |
| --- | --- | --- |
| `exec vitest run tests/integration/cli-bundle-tamper-orchestration.test.ts tests/integration/cli-check-tamper-orchestration.test.ts tests/unit/release-acceptance-chain.test.ts tests/unit/release-fingerprint.test.ts tests/unit/baseline-cli.test.ts tests/unit/baseline-compare.test.ts tests/unit/web-upload-workflow.test.ts` | 最终 7 文件 / 70 项通过 | `b-final-green-unit-20261116.log` |
| `exec turbo run build --force` | check 修复后 10/10，0 缓存 | `b-root-build-forced-20261116.log` |
| `exec turbo run typecheck --force` | check 修复后 14/14，0 缓存 | `b-typecheck-20261116.log` |
| `exec turbo run build typecheck --filter=@company/component-cli --force` | manifest 最终实现 3/3，0 缓存，2.148s | `b-final-cli-build-20261116.log` |
| `exec tsc --noEmit` / `verify:workspace` | 最终均 exit 0；10 成员与服务闭包通过 | `b-final-root-tsc-20261116.log` / `b-final-workspace-20261116.log` |
| `exec vitest run tests/integration/cli-check.test.ts tests/integration/cli-bundle.test.ts tests/integration/cli-baseline.test.ts tests/integration/cli-release.test.ts` | check 修复后 4 文件 / 11 项通过，130.71s | `b-integration-20261116.log` |
| `exec vitest run tests/integration/cli-bundle.test.ts tests/integration/cli-release.test.ts` | manifest 最终实现 2 文件 / 4 项通过，97.24s | `b-final-bundle-release-20261116.log` |
| `component check --framework all --staging-dir .tools/b-check-run1-20261116`，随后使用 run2 目录重复一次 | 两次 exit 0；四份报告各 5 项检查 passed、基线 NEW，落盘摘要复核一致；B SDK 基线 0.0.10 | `b-check-run1-20261116.log` / `b-check-run2-20261116.log` / `b-check-evidence-20261116.json` |

真实 CLI 集成在工作区外安装冻结 tarball，实际运行浏览器截图，并通过隔离 PostgreSQL / MinIO / Verdaccio 发布 14 个实现到 Ready，再从 Registry 安装；覆盖 release/status/resume。运行 Node 输出 DEP0190 告警，未导致失败。最终复验前后确认 check.ts 与 manifest.ts 字节未变。

## 浏览器与跨角色产物交接

全构建完成并释放 5173–5176 后，执行 `test:browser`：初轮 251 passed / 2 failed / 4 did not run（43.9s）。失败原因是未设置真实上传套件要求的冻结目录。随后设置：

```powershell
$env:ZHINEXUS_SDK_BUNDLE_DIR = '<C工作树>/.tools/operations/current-sdk/6d567b22-6c72-4e7a-a254-ade94b104df1'
.\scripts\pnpm.ps1 exec playwright test --config tests/playwright.config.ts tests/browser/web-upload-real-e2e.spec.ts
```

重跑 6/6 通过（43.0s）。总计 257 个唯一测试跨两轮通过，不是一次全绿执行。日志为 `b-browser-20261116.log` 与 `b-browser-real-20261116.log`。重跑使用 A 本轮冻结的 core 0.0.10、Vue/React 0.0.11，未重新打包：

| 包 | tarball SHA-256 |
| --- | --- |
| core 0.0.10 | `2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752` |
| vue 0.0.11 | `5880c22a446074a8e68c2b898406ba76eaf658d8614965426a76c95328b2cf49` |
| react 0.0.11 | `0443b89f386300f756138913d7ce34721e2d9ada9b035694354c9b0faffa26fb` |

真实浏览器上传覆盖 14 个实现的手动截图、缺图/错框架/错摘要拒绝、失败与响应丢失后的幂等恢复。它证明跨角色冻结产物交接，不证明独立源码分支已合并。manifest 修复后只重跑受影响 CLI 链路，未无理由重跑未改变的浏览器功能。

## 边界与交付

本轮只变更 CLI 两处编排与三个专属测试，画廊/API/contracts/SDK 未改。C 另行将 CLI 从 0.0.9 升至 0.0.10 并提供冻结分发包验收记录；修复提交与版本提交分开。

终审已确认 staging 来源错绑和测试摘要断言缺口关闭，未发现本轮范围内剩余阻塞；生产代码在最终真实 bundle/release 复验后未变化。B 停写交接后，C 仅补强上述断言、整理证据并收口提交。

公司 OIDC、生产预览注册域名/DNS/TLS、真实业务试点仍缺接入证据；本地真实存储配本地测试身份，`productionAcceptance: false`。G2 与完整 T05/T07/T11 继续开放。本轮未 merge、push 或发布生产包。
