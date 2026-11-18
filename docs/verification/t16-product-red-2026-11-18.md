# T16 B 产品失败测试交接验证

日期：2026-11-18。本记录追加在 [P0 恢复同步记录](t16-recovery-sync-2026-11-18.md) 之后，不改写已完成的验证历史。当前仅交付产品 RED；未授权产品 GREEN，完整 T16/T17 保持未完成。

## 基线与文件所有权

- 基线提交：`41a88e764059fea267f91451b4923290676f7d7f`，前置 P0 为 `2594f2776fb4b2de4a684fc3e50317ccc1d758dd`。
- 唯一实施目录：`C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`。原 worktree 被外部移除后，用户明确授权恢复；主仓库不作为测试编写目录。
- B 为实际 Claude 桌面端，会话名 **T16 B 安装隔离测试**，会话 `local_bb7d37e6-a0da-4459-85ce-990c70dceedd`；保留用户已有 `step-5-preview High` 设置。通过 computer-use 插件操作 UI，不以 Codex 审查代理冒充 Claude。
- 授权依据：[安装隔离 brief](../superpowers/plans/2026-11-18-t16-b-install-isolation-brief.md)。B 仅编写三个 `project-*.test.ts` 与 `tests/integration/t16-support/*`，不改产品源码、exports、stub、公共契约/fixtures、配置、依赖、锁或版本；B 不提交。C 执行 Windows 验证并收口提交。

## 停写预检与复审

固定 Windows Node 26.13.0 / pnpm 12.18.0；命令通过 `scripts/pnpm.ps1` 执行。以下是修订前的预检，不作为最终 RED 验收：

| 检查 | 实际结果 |
| --- | --- |
| `exec vitest run tests/integration/project-apply.test.ts` | 27 collected / 0 passed / 27 failed；缺 applyIntegration 的结果断言失败 |
| `exec vitest run tests/integration/project-rollback.test.ts` | 17 collected / 0 passed / 17 failed；真实 apply 备份前置因缺 applyIntegration 失败 |
| `exec vitest run tests/integration/project-install-isolation.test.ts` | 16 collected / 0 passed / 16 failed；15 例缺 applyIntegration，1 例 npm fixture 的 MATCH_CONTEXT_MISMATCH，不计产品 RED |
| `exec tsc --project tsconfig.json --noEmit` | exit 1：sync 必填字段、unknown 展开、rollback 类型来源及可变 union 闭包收窄问题 |
| `exec vitest run tests/contracts/integration-apply.test.ts`（11:56:43） | 85/85，exit 0；恢复契约基线无回退 |

预检原始日志和 JSON 位于 ignored `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/`：`claude-preflight-apply`、`claude-preflight-rollback`、`claude-preflight-isolation` 的 `.log/.json`，以及 `claude-preflight-typecheck-three.log`。

C 和独立只读代理复审还识别了会误拒绝合规实现或空过的断言：提交故障持续阻断补偿、备份第二个原始写操作冒充 installStarted 阶段、npm launcher 比较错误、workspace 无安装意图、scoped tarball URL 错误、转义字符串与表达式文本断言冲突、清理后才检查 staging、认证空集合、宿主环境未无条件恢复、链接外部树基线不匹配和自动恢复后仍要求 restored。统一反馈已通过实际 Claude UI 发送，修订完成后另列最终验证。

特别边界：原地篡改不可变备份后重新算 SHA 不能证明最新引用可达。空字节恢复正例及字段篡改测试需使用一致的测试私有读视图，并观测同 operation 的最新指针读取；不能迫使产品放宽可信校验。真实产品存储尚不存在时，读边界接入必须作为后续 GREEN 前待办明确记录，磁盘扫描不替代这一证据。

## C 停写收口与最终实测

实际 Claude 已在上述会话停止写入；此后修订由 C 在唯一实施 worktree 完成。本轮没有再次启动 Claude，也没有修改产品实现、exports、公共契约、配置、依赖、锁或版本。

C 撤除了五个依赖伪造备份读视图的活动用例（空字节正例、originalBase64 篡改/缺失、projectRoot/planDigest 篡改），以及一个把备份原始写操作当 installStarted 日志提交的活动用例。未使用 skip/todo 占位；这些要求保留在 brief 并列入下方 GREEN 前待办。上文关于“一致的测试私有读视图”是预检阶段说明，最终交付不含 overlay，也不自行推进 latest 指针。

收口修订包括：首/次目标提交的一次性故障与独立 ordinal 证据；named/default 共用的 fs/child_process mocks；真实备份与 before 字节复核后才武装提交故障；固定 npm launcher 与 pnpm argv；完整环境键白名单；启动时暂存字节及隔离凭据快照；pnpm 八项设置强制存在；严格 manifest/YAML 错误记录；根/成员 importer 与受控成员链接；物化故障必须实际命中；外链目标启动前 baseline；双框架各七项危险字符串矩阵；Babel/Vue AST 解析与完整静态字符串追踪。

固定 Windows 工具链实测结果如下，均由 C 执行：

| 命令 | 最终实际结果 |
| --- | --- |
| `scripts/pnpm.ps1 --filter @company/component-cli build` | exit 0；内联契约同步、编译、package probe 73/73 文件，缺失/清单外/污染/链接/改动均 0 |
| `scripts/pnpm.ps1 typecheck` | exit 0；先 build:services，子包任务经 Turbo（14/14 缓存），最后根测试 `tsc -p tsconfig.json --noEmit` 实际执行且通过；缓存日志不作为新代码的独立类型证据 |
| `scripts/pnpm.ps1 exec vitest run tests/contracts/integration-apply.test.ts`（12:26:07） | 85 collected / 85 passed，exit 0 |
| 临时 `exec vitest run tests/integration/t16-support/helper-probe.test.ts`（12:25:20） | 13/13 passed，exit 0；探针源与日志保留在 ignored 证据目录，临时测试已从正式收集范围移除 |
| `scripts/pnpm.ps1 exec vitest run tests/integration/project-apply.test.ts tests/integration/project-rollback.test.ts tests/integration/project-install-isolation.test.ts --reporter=default --reporter=json --outputFile.json=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/final-product-red.json`（CLI build 后 12:26:41） | 3 文件完整收集；62 collected / 0 passed / 62 failed / 0 pending，exit 1 为预期 RED |

正式 JSON 逐例核对：apply **34**、rollback **12**、安装隔离 **16**。全部 failureMessages 都是缺少 `applyIntegration` 产品结果的 undefined 断言；rollback 在创建真实 apply 备份前置处失败。无 collect/import/typecheck/fixture 错误；不能据此声称后续恢复与安装分支已被执行。日志为 `final-product-red.log/.json`、`final-typecheck.log`、`final-cli-build.log`、`final-contract-green.log`、`helper-probe-final.log`，位于同一 ignored 证据目录。

13 项临时探针独立执行了：React/Vue 可解析正例；前置 SFC 注释与开头 JSX；真实 prop/返回型 callback 字符串；未使用字面量、IIFE 未返回字面量与拼接子串拒绝；模板插值执行原语拒绝；损坏 TSX/SFC 拒绝；真实备份武装故障、补偿放行和第二提交 ordinal；callback/promise 错误通道；暂存快照和外部配置留存、junction 拒绝；workspace 根/成员 importer 与成员链接；未知依赖/坏 YAML 及缺冻结锁错误不吞掉。初次文件 symlink 探针因 Windows 权限 EPERM 失败，改用项目既有 junction helper 后通过，没有将权限错误算作产品 RED。

独立只读复审代理 `review_t16_sync` 对最终测试与 helpers 静态复核：未发现本轮新增 RED 阻断，保留下方绑定目标适配和真实产品边界待办。该代理未编辑、运行测试或提交，运行结果以 C 的上述实测为准。

原始架构 SHA-256 再次核验为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`；主仓库与原架构内容保持不变。本轮测试交接不触发产品版本升级。

## GREEN 前必须接入的测试边界

1. 真实备份存储存在后，按产品读取边界构造有效空字节备份及独立 originalBase64/root/plan/id 字段破坏；必须证明同 operation 的最新引用可达，不伪造 latest、不放宽可信校验。现有磁盘扫描仅证明引用摘要对应真实文件字节。
2. 接入真实 journal/latest 原子持久化点，验证 installStarted=true 及最终摘要更新失败时绝不启动冻结物化；过时 installStarted=false 引用不能洗掉副作用。恢复前/期间的并发 hash 变化也需接入对应读取边界。
3. 依据最终实现的写入 API 调整测试私有 fs 故障接点。当前覆盖 node:fs named/default、sync/callback 和 fs.promises 包装；不声称独立 node:fs/promises 导入或 FileHandle 写入已被拦截。继续要求故障一次性、补偿放行及真实提交 ordinal。
4. 根据真实生成器明确 Vue/React，并按 **LineChart 的实际 prop/event** 分别检查绑定；source/handler 使用不同值。现有 AST 汇总来自组件属性的静态值/键，不能排除无关组件或属性充当证据，也不能全面证明动态 helper 的数据流；必须在生成器 GREEN 前补齐专属断言，不把全局 Set.has 当完整绑定验收。
5. synthetic workspace 成员链接只验证受控场景，尚未证明 npm/pnpm 的完整依赖图、传递依赖、真实目录重定位与多个 node_modules 交付/并发替换。固定版本配置兼容、真实锁/包身份及 SDK 摘要要求保留在安装隔离 brief。

## 验收限制

synthetic tarball 字节只支持受控摘要/HTTP 夹具；测试私有进程 mock 物化受控目录，不能据此证明真实 npm/pnpm 安装或执行隔离。真实 Vue/React × npm/pnpm × standalone/workspace、冻结 SDK/CLI 消费、配置生效、目录重定位、业务项目和独立 D 黑盒仍待后续验收。不得把产品 RED 或现有 85 条契约 GREEN 当作完整 T16 完成。
