# T16 B 备份补充 GREEN 交接

本阶段延续用户已批准的产品 GREEN。唯一工作树为 `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`，继续遵循产品 GREEN brief 的文件所有权。B 仅修改产品源码；三个 project 测试、t16-support、公共契约、版本与记录仍由 C 独占。无需重新设计确认。不提交、不 pack、不升版、不 merge/push。

## Windows 实测 RED

原产品三套测试已由 C Windows 宿主复验 62 collected / 62 passed / 0 failed / 0 pending，exit 0，证据 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/green-check-after-site-fix.json`。

C 新增 15 条备份补充测试，过滤窄测 exit 1；选中的 15 条实际 9 passed / 6 failed。其余 46 pending 仅因 testNamePattern 过滤，不是新增 skip。报告 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/backup-supplement-red.json`。

1. `project-apply.test.ts` 中四条 `installStarted 备份`（version/latest × writeFile/rename 一次性故障）均确认命中真实持久化接点，随后抛出 `IntegrationApplyError: apply 结果未通过 IntegrationApplyResult`，未返回契约要求的 rolled-back/not-run。必须恢复目标原字节，零物化启动，返回真实最新可达且 installStarted=false 的备份引用。不要把内存置 true 当作实际安装已启动。
2. `project-rollback.test.ts` 的 `恢复暂存原字节后用户改写目标`，在真实临时文件写入窗口注入新编辑后，产品覆盖了新字节。必须保留新编辑并归入 preserved + USER_EDITED，保持完整四组 coverage，不得冒称 restored。
3. `latest 的 schemaVersion 不受支持` 将真实 latest 版本号改为 999，当前仍返回恢复结果。必须 BACKUP_INVALID 脱敏抛错且目标零写。

通过的控制包括四条初始备份故障、合法派生空原字节备份、四种独立备份字段破坏。派生 fixture 基于真实版本/latest 布局和实算摘要，不冒称原 apply 的文件本来为空。合法 64hex planDigest 被替换是否可信不在这些测试中；当前缺少独立可信锚，不能通过自证字段强行宣称已解决。

## 验证与交付

先读新增测试与真实失败 JSON，再做最小合理产品修复。不得改断言、skip/todo、伪造 latest 或放宽用户编辑保护。运行三个 project 测试和相关 CLI 类型检查；Windows 固定工具链由 C 宿主复验。若 B 的 Linux 工具不可用，明确报告，不等待无回执命令。完成后停写并报告实际改动、结果与限制。
