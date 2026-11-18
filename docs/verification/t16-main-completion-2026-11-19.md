# T16 技术交付本地 main 收口与复验

日期：2026-11-19（Asia/Shanghai）。本记录独立追加，保留此前 RED、拒收、筛选运行、环境失败和修复证据。T16 技术交付已按用户授权本地合并 main 并完成复验；完整 T16/T17、真实授权 Vue/React 业务项目及生产 G2 保持开放。

## 合并范围与实测提交

- main 合并前：`c067c81d2751b1d7cf9a04e7c15b6d7d276d014d`。
- 来源分支：`feat/t16-safe-apply-final`，B/C worktree；本地 `merge --ff-only` 后 main 与来源 HEAD 均为 `40910dc46db7bef0db0d17dee0d31b94a8f2ea6d`。
- 下列七项命令全部在 main 的上述 HEAD 执行。合并后树 `c51c1932af4a445e7e00514f223ea3435481ca70`，main 与 B/C 全树一致且 clean。
- 随后的收口提交只更新本记录和当前状态文档；该文档提交的最终 HEAD 以 Git 历史为准，不冒称它是下列测试的实测 HEAD。产品、契约、测试、锁文件与构建配置须与实测 `40910dc4` 保持一致。

B 产品作者为实际 Claude 桌面 GLM-5.3 High；D 独立黑盒作者为实际 Claude Code GLM-5.3；A 独立预期已集成。C/Codex 维护契约、真实环境、机械接收、执行验证、文档和集成，没有改写 B 产品或 D 断言。D 分支及全部 worktrees、原始证据保留。

| 聚焦提交 | 内容 |
| --- | --- |
| `654accdf` | B26 产品 GREEN 收口 |
| `2fca59cf` | CLI 升至 `0.0.14` 并同步 CHANGELOG |
| `a6e7dc3d` | C 浏览器契约模块路由修正 |
| `11659bca` | 原样 cherry-pick D 16 模块，原作者提交 `9bca63fd` |
| `b20921b9` | C 桥接，17 行环境及进程编排 |
| `1f1566af` | D 交付与最终回归独立记录 |
| `40910dc4` | 区分 D 接收前后行尾证据，补充集成根 tsc |

## main 实际验证

使用 `scripts/pnpm.ps1 -PnpmArgs @(...)` 的固定 Node `26.13.0`、pnpm `12.18.0`。表内给出实际 argv；冻结 SDK 同时设置为 `A10_FROZEN_BUNDLE` 与 `ZHINEXUS_SDK_BUNDLE_DIR`，冻结消费者使用同一 `PHASE3_CLI_TARBALL` 与 `INSTALLED_CLI_EVIDENCE`。`T16_D_TEST_FILE` override 已移除，原始 receipt 的 `dTestFileOverride` 为 `null`。

main 原始证据根：`D:/project/zhinexus-design-asset-platform/.superpowers/sdd/2026-11-19-t16-main/`。每项保留开始前 receipt、结束后 exit/日志摘要和独立 `.exit.txt`，七项的 HEAD、exit、receipt SHA 与日志 SHA 已逐一核对。

| 标签 | 实际 argv | 实际结果 |
| --- | --- | --- |
| `main-install` | `install --frozen-lockfile` | exit 0 |
| `main-workspace` | `verify:workspace` | 10 成员、无环、服务依赖闭包合规，exit 0 |
| `main-force-build-typecheck` | `exec turbo run build typecheck --force` | 20/20，0 cached，exit 0 |
| `main-root-tsc-02` | `exec tsc -p tsconfig.json --noEmit` | exit 0，空日志 |
| `main-root-test` | `test --maxWorkers=2` | 先 build:services；Vitest 89 文件/1753/1753，T10 168/168，零失败/跳过，exit 0 |
| `main-frozen-t16` | `exec vitest run --config tests/acceptance/t16-installed.config.ts --reporter=json --outputFile=.superpowers/sdd/2026-11-19-t16-main/main-frozen-t16.json` | 14/14，零 failed/pending/todo，exit 0 |
| `main-contracts-browser` | `exec playwright test --config tests/playwright.config.ts contracts-runtime.spec.ts` | 真实 Chromium 1/1，exit 0 |

完整读取 T16 JSON 的全部 14 个 assertion：Vue/React × npm/pnpm × standalone/workspace 八组安装、类型/构建与迁移；两种包管理器 × hostile `.npmrc`/`.pnpmfile.cjs` 四组拒绝；Next Server Page 一项；D 默认入口冻结安装恢复一项，全部 `passed`。没有测试名筛选或未选用例计成功。此前独立 13 项消费者运行及 1 项 D 筛选运行仍按各自原始计数保留，见 [冻结技术验收](t16-technical-acceptance-2026-11-19.md)。

此前 B/C 实际完整浏览器 287/287、冻结 T15 25/25、D26 既有黑盒 5/5 已通过。平台首轮 135 项通过/2 项跳过，随后真实画廊独立补验 2/2；不改写首轮为 137/137。main 运行的是上述契约浏览器专项，未把此前 287 项冒称为 main 再执行结果。

| main 日志 | SHA-256 |
| --- | --- |
| `main-install.log` | `e68c70e53da46840d04242cdabe1b7a759496549257e2a4d456696ab043dc0af` |
| `main-workspace.log` | `6937eb8c08c6db032212b3ac8189bd2d5ae43801e6e3641c8ff956a7d3161732` |
| `main-force-build-typecheck.log` | `522a1367dfb113c4a3bc13fcbd30a4882a64af05efc9fa3be4bd7067d2918e64` |
| `main-root-tsc-02.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `main-root-test.log` | `496a5ee370144838bc3a673135593b793719909f93f38d0a2220c0c35151e22b` |
| `main-frozen-t16.log` | `ad172e3bac8c01720d677b843842b2cf442193a4e6b2f78d07815b02694d78f7` |
| `main-contracts-browser.log` | `65124141b9128e4973756f3fbc91ac93c47883853476ce67f496e0a2236b3127` |

`main-frozen-t16.json` SHA-256：`ec0990c07ec94bb28ccc00e17c6ad05998cb3a3a7dc90f864e0e55917a8f95dd`。`main-verified-results-index.json` SHA-256：`8bf1bff08a2e56cefee1f8f4bca4dc89eca372b8bd4706b96fefd92763d4a8b1`，其中包含七份 receipt SHA；这是明确标记 `post-run-verification-index` 的事后核对索引，不是原始命令收据。`main-post-merge-tree-identity.json` SHA-256：`ee33d397f97224d488c1aaa189051176a0b82b8f1d3c5cd0a51fa978f7924c50`。

## D 默认入口的真实执行

main 随机隔离 PostgreSQL/Verdaccio/MinIO 服务 ID：`4caec703-11f5-483c-aeeb-aa1437cd37c0`。消费者为仓外 `zhinexus-t16-installed-yKUag3`，D 临时工程为 `t16-d-r8odcu`，备份 ref 为 `apply-7573988ebf1eadf2919575a3`。完整本机路径保存在原始证据，仓库记录只保留定位后缀。

消费者实际 `node_modules/@company/component-cli/dist/bin.js` 运行冻结 CLI `0.0.14`；`frozen-cli.json` 与 receipt 绑定唯一 tarball 摘要。D 来源是 main 默认 `tests/acceptance/t16-d/cli-installed-recovery.test.mjs` 及其 15 个辅助模块。`d-installed-recovery-process.json` 的 code 为 0、stderr 为空，stdout 明确记录 start、backup、fields、recovery 四段均实际完成；`node --test` 1/1，零 failed/cancelled/skipped/todo。该进程记录 SHA-256：`3ac76983979c2ec46b602bbb169857ca617687ea14b72d2a46bcaea21500a9e7`。

字段篡改与旧不可变版本冷拒绝后，有效恢复核对原 package/lock 字节，并删除本次生成文件；node_modules 保留，结果如实报告 `reinstall-required`。冷 stale 控制不声称运行时竞态；用户后续编辑保护由既有 D26 5/5 和产品回归覆盖。原作者正文、机械接收及拒收历史见 [D 独立记录](t16-d-installed-recovery-2026-11-19.md)。

D 提交前 16 模块为 index LF/worktree LF，B/C 与 main checkout 为 index LF/worktree CRLF；原 `.gitattributes` 对 `.mjs` 仅 `text=auto`，`core.autocrlf=true`。当前 B/C raw bytes SHA 不等同 D 的 LF 来源 SHA；归一 CRLF 后 16/16 全文一致。未修改行尾规则或 D 断言。比较证据 `c-final-eol-comparison-2026-11-19.json` SHA-256：`54e71a5e979156e9d955e57082ad482429540871f88162995804c5b2dcc9fa9c`。

## 保留的 C 证据脚本中断与恢复

main 首个验证脚本进程 session `17682` exit 1：安装、工作区和强制全图已经通过；首次根 tsc 实际 exit 0 且无 stdout，`Tee-Object` 没有输入，未创建日志，后续 `Get-FileHash` 因日志缺失抛错。该故障属于 C 的证据脚本，不计产品测试失败。

原 `main-root-tsc.receipt.json` 保持未完成状态，独立 `.exit.txt` 保留 0，没有事后回填冒充完整原始 receipt。中断记录 `main-root-tsc-harness-interruption.json` SHA-256：`051646539973fe0a6f182230af9a9d5b8d649130e3ec0cfd0d217af851715da7`。

恢复脚本预创建空日志，只从根 tsc 以新标签 `main-root-tsc-02` 重跑，再顺序执行根测试、完整 T16 和契约浏览器；没有重复前三项。恢复进程 session `18008` exit 0，输出 `MAIN_VERIFICATION_COMPLETE`。两份脚本仅存 ignored 原始证据，不进入产品提交：原始脚本 SHA-256 `9219b3b0f653635096d0de564b2be3345a4b0269bc3f477a720241b3e47d29e4`；修正脚本 SHA-256 `4fe2d756c9a0950f1ff9b12725fcf8293adf473fc40618e541cf282893bd5128`。

## 冻结材料与独立审查

没有重新 pack。CLI 唯一 `company-component-cli-0.0.14.tgz` SHA-256：`94ecf07ebd1f3bb10bb78e0b35cb01e7b7bb851ba1ebf2884b0047a244f24207`；冻结 SDK manifest SHA-256：`04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`；真实兼容证据 SHA-256：`c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7`；原架构 SHA-256：`e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。main 复验后冻结 CLI、SDK manifest 与原架构再次核对一致。

复用独立 reviewer `/root/review_t16_sync`，只读核对实际作者、接收全文、契约、17 行 C 桥接、全树和原始证据。合并前范围到 `40910dc4`，新增未解决 Critical/Important/Minor 均 0，保留两项非阻断 Minor：D30 超时/启动失败诊断的持久化范围，以及 D41w 早期主 runner 的路径日志。行尾证据文档问题已关闭。

合并前 ignored 审查记录 `c-d-bridge-current-review-2026-11-19.md` 为 175538 bytes，SHA-256 `246f64e0fc412113f541edc43c5ea4cba10fb5b35da89f626d71d9457e841c51`；这是合并前快照，后续追加会改变摘要。main 七项证据与本次纯文档增量复核独立追加在同一记录，最终审查快照另行记录。

main 七项证据及九份纯文档增量 01 的独立复核已完成：实际九文件与完整 diff/identity 一致，八份既有文档逐 hunk 重建全文相等，两份历史验证原文前缀完整保留；七项 argv/摘要、T16 全部 14 项、默认 D 入口、证据脚本中断及实测 HEAD 边界核对通过。新增 Critical/Important/Minor 均 0，整体 Critical 0 / Important 0 / Minor 2。此时原审查记录快照为 195658 bytes，SHA-256 `62463d1086dabe0d624d55d486b78f2b9d5b8991a4ad6b5d1c92923588aa7991`；后续对本快照引用段的复核另行追加，不把此摘要冒称为追加后的最新文件摘要。文档只读检查 `c-final-main-docs-check-01.json` 确认链接、文档范围、冻结摘要及 T16/T17 开放状态均通过。

## 尚未完成的验收范围

仅完成 T16 工具技术交付。仍缺真实授权 Vue 与 React 业务项目中的可审查 diff、项目原生命令及业务接入验收；上位 T16 最后一项和全部 T17 保持未勾选。隔离三存储与 synthetic 消费者全部为 `productionAcceptance: false`，不替代公司 OIDC、独立预览域和完整生产 G2。纯文档收口不单独升版；未 push、未 tag、未生产发布，保留分支、worktrees 和原始证据。
