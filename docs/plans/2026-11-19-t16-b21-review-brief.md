# T16 B21：四条独立 C21 RED 修复

负责人 B：实际 Claude 桌面 GLM-5.3 High。C 仅提供失败证据、机械接收与执行，不代写产品。基线为已接收 B20；本次只交精确 unified diff，不执行命令，不直接改文件，不改测试与公共契约。

工作目录：`C:\Users\10208\.codex\worktrees\t16-safe-apply-0026\zhinexus-design-asset-platform`。

必须先读取 AGENTS.md、相关规则和现有代码。允许产品范围：`packages/component-cli/src/integration/apply.ts`、`backup.ts`、`install.ts`。保留所有既有 B20 行为，尤其未提交候选不能被恢复、用户编辑保留、冷恢复不绕过磁盘验证。

## 已确认 RED

固定 Node/pnpm 实跑 `project-apply.test.ts` 与 `project-install-isolation.test.ts`，过滤 `C21`：109 collected / 0 passed / 4 failed / 105 unselected，exit 1。证据 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c21-review-red-02.{json,log}`。四条均命中真实文件系统窗口，在实质行为断言失败，无收集错误。

1. `C21 首次真实提交后读回一次 EACCES：已提交源码必须恢复并纳入副作用证据`。真实目标 rename 已放行成功，紧接着一次 readFile EACCES；当前 changed 登记晚于读回，因此源码残留，原树 2 项变为 6 项。成功提交必须立即登记已提交 receipt 与 before/after 证据，再执行可能失败的读回；不能把 rename 失败或从未提交的候选登记为已提交。
2. `C21 初次 version 临时写入窗口替换 backup 祖先：阻断并保留外部树与目标`。
3. 同上 `latest`。两例均在真实 temp 已写入后、rename 前的首次 backup 下 lstat 读取窗口，克隆原 backup 树（包含真实 temp）到独占 outside，记录快照，再把原祖先移开并替换为 junction，放行读取。当前版本/latest 会修改 outside 并继续。提交前需复核原始整条祖先、temp 的普通文件形态与字节，持久化后读回版本/latest 才能返回成功 reference；路径不可信时不可沿其清理外部 temp。必须保持 outside 快照和目标树不变，blocked/BACKUP_INVALID、无 changed/无安装。
4. `C21 stage 创建窗口被未知普通树抢占：不得认领并删除用户 sentinel`。真实 stage 根 mkdir 前，夹具创建同名普通目录与用户 sentinel（无 owner marker），再放行 mkdir。当前 recursive mkdir 认领此树并最终删除 sentinel。stage/ready 根应原子独占创建，EEXIST 失败关闭，不写标记，不删除未知树。envRoot 当前在环境准备中已提前 recursive 创建 env/tmp，需要完整梳理本次目录创建和认领顺序，不能机械把全部 mkdir 改为 nonrecursive。须保留 sentinel 原字节，blocked、物化未启动。

查看测试全部断言，不删改测试，不通过放宽安全边界规避。补丁须对应当前文件精确中文上下文，旧中文逐字保留，不翻译、不省略；所有 hunk 的 context/deletion 必须唯一有序匹配。为控制交付长度，本次只返回这三个文件的必要 diff 与简短静态说明；C 将重算 hunk 行数并 git apply --check 后机械接收。若无法全部完成，明确剩余项，不能声称测试通过。

完整结尾必须为：`未执行；交付完毕，停写待C`。等待 C 实跑四条 GREEN、完整产品、构建类型和独立审查后再继续。最终冻结消费者、完整 D 黑盒、根回归与本地合 main 仍待通过。
