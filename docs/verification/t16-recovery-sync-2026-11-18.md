# T16 P0 恢复状态补充与安装隔离交接

日期：2026-11-18。本文是独立补充记录，不改写 P0 首次验证历史。完整 T16、T17 及真实业务项目验收仍未完成。

## 恢复来源与范围

原 T16 worktree 在本轮读取后被外部移除。用户确认没有迁移并授权继续恢复。Codex native worktree 工具从保留分支 `feat/t16-safe-apply` 的 P0 提交 `2594f2776fb4b2de4a684fc3e50317ccc1d758dd` 恢复到 `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`；旧路径不再作为交接目录。原分支保留，主工作区 `main@c067c81d2751b1d7cf9a04e7c15b6d7d276d014d` 未编辑。

两个已读取但尚未提交的修正重新按 RED→GREEN 验证：首写失败保留真实备份并允许空提交证据；恢复 I/O 失败用必填 unresolvedPaths 表达，与保留用户编辑分开。恢复路径为 restored/unchanged/preserved/unresolved 四组，互斥完整覆盖备份候选；同路径问题码与 preserved/unresolved 双向绑定。

已同步运行时定义、生成的 rollback Schema、公共 fixture、CLI 内联副本、契约 README、T16 设计/实施计划、根 README 和实施评估。公开 CLI 未增加 apply/rollback 产品入口，本次不触发产品升版。

## 本轮执行证据

工作目录均为恢复后的 worktree，所有工作区命令使用 `scripts/pnpm.ps1`。工具链 Node 26.13.0、pnpm 12.18.0；Node 随附 npm package.json 实测 11.20.0。隔离 node_modules 通过 `install --frozen-lockfile` 重建，锁文件未改。

| 命令/检查 | 实际结果 |
| --- | --- |
| `exec vitest run tests/contracts/integration-apply.test.ts`（仅恢复测试，修正前） | RED：81 passed / 2 failed / 83 collected，exit 1，均为行为断言失败 |
| 同命令（修正后） | GREEN：83/83，exit 0 |
| `--filter @company/contracts schemas:generate` | exit 0，重新生成 rollback Schema |
| `exec vitest run tests/contracts` | 16 files、437/437，exit 0 |
| `--filter @company/component-cli build` | exit 0；pack probe 73 文件，无缺失/污染/链接/修改 |
| `verify:workspace` | exit 0，10 成员、无环、服务依赖白名单通过 |
| `exec turbo run build typecheck --force` | 20/20，0 cached，exit 0，16.965s |
| `exec tsc -p tsconfig.json --noEmit` | exit 0 |
| 根 `test`（浏览器恢复前） | exit 1：77 files passed / 7 failed；1568 passed / 9 failed。6 个浏览器启动错误为缺 Chromium headless shell，另 3 个 CLI check 断言需补齐浏览器后复验 |

日志位于 ignored `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/`：recovery-red.log、recovery-green.log、contracts.log、cli-build.log、graph.log、root-test.log。恢复资产缺失时通过固定项目 Playwright `exec playwright install chromium` 补齐官方 chromium/headless-shell v1254，exit 0；不改依赖版本。浏览器目录通过 junction 指向主仓库 `.tools/playwright`，不共享 node_modules。补齐后根 test 的最终结果在后续补充条目记录。

根 test 使用既有只读冻结 SDK 输入 `A10_FROZEN_BUNDLE=D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3` 和 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。输入摘要：core 0.0.11 `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb`、Vue 0.0.12 `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9`、React 0.0.12 `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28`。本轮不重新打包这些输入。

## B 产品 RED 交接与未覆盖边界

[安装隔离 brief](../superpowers/plans/2026-11-18-t16-b-install-isolation-brief.md) 冻结 test-only 文件范围、API 和恢复预期。实际 Claude 桌面端负责产品失败测试；C 在 Windows 确认完整收集与行为 RED 后再授权 GREEN。Codex 审查子代理不替代实际 Claude。

关键决定：包管理器进程只在工程外 staging 运行；候选锁在备份前生成；冻结依赖物化启动前持久化 installStarted=true 并重新摘要；备份版本不可变，旧引用不能洗掉副作用。依赖树经链接/硬链接/摘要与并发守卫后从同卷外部 ready/quarantine 受控交付。暂不支持的解析配置和 local/git/file/link/portal/patch 依赖显式阻断，不能删除安全设置后静默安装。

代价与边界：同卷限制与暂不支持依赖缩小首版兼容面；静态 workspace 多目录交付不承诺原子事务；源码回滚不恢复 node_modules，启动安装后持续 reinstall-required。固定 npm/pnpm 配置、真实目录重定位、Vue/React × npm/pnpm × standalone/workspace 矩阵、真实授权业务项目、独立 D 黑盒仍待验证。官方资料已实际读取，但页面本身不能证明固定版本设置生效。

原始架构应保持 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`；提交前核对字节与 CLI 镜像、Schema一致性。没有 push、merge 或生产发布。

## 浏览器恢复与独立审查补充

补齐浏览器后根 `test` 实际通过：T10 Node tests 168/168，Vitest 84 files、1577/1577，exit 0，323.53s。之前的 9 项失败全部消失，确认均由缺失浏览器资产引发。日志为 `root-test-browser-restored.log`。

独立只读审查发现 P2：无路径的 WRITE_FAILED / RECOVERY_REQUIRED 可以借 preserved + USER_EDITED 绕过 unresolved 的反向绑定。新增两个行为反例实际 RED（83 passed / 2 failed / 85 collected，exit 1）；修正后重建 contracts，85/85 GREEN，exit 0。首次未重建 dist 的窄测仍读旧产物，记录于 `review-green.log`，不作为 GREEN 证据；有效结果为 `review-green-built.log`。两种 rollback 恢复错误均必须关联 unresolvedPaths 内路径，不留全局摘要例外。独立复审用编译产物确认无路径错误被拒绝、合法同路径 unresolved 被接受，未发现剩余阻断项；审查者未运行测试，上述命令由 C 执行。

修正后的全 contracts 为 16 files、439/439，exit 0；CLI build/probe 73 文件通过，镜像逐字节相等；forced graph 20/20、0 cached、15.278s，exit 0。PowerShell 把裸 `-p` 误绑定到包装器参数的 tsc 调用没有执行编译器；改用实际命令 `exec tsc --project tsconfig.json --noEmit` 后 exit 0。`verify:workspace` 再次通过。原始架构 SHA 与上述值相同，锁文件无 diff。最终根测试在以下条目继续补充。

最终修正后的根 `test`：T10 168/168，Vitest 84 files、1579/1579，exit 0，309.18s；没有 skip/todo。日志为 `root-test-review-final.log`。测试仍输出既有子进程 shell:true 的 DEP0190 警告，本次未改这些产品路径；T16 安装必须按 brief 用 shell:false 实现。
