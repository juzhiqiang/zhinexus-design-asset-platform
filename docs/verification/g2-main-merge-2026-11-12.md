# C 本地设施合并主分支验证

2026-11-12（Asia/Shanghai），用户明确要求完成后合并回主分支。本次在 C 的独立工作树执行本地快进合并：`main` 从 `471ae8e` 前进到 `35725fb`，包含 `d18ce0e`（示例状态契约）和 `35725fb`（本地三存储与接入工具）。没有冲突，没有推送远程。

合并前 C 工作树和暂存区干净；原主目录仍为 `feat/t04-cli-check`，包含 CLI 并行开发及先前 C 副本，本次未切换、清理或提交这些修改。当前独立工作树保留在 `main`，本地容器仍需其中的设施配置，因此不归档或删除该工作树。

## 合并后实际验证

- `$env:TURBO_FORCE='true'; .\scripts\verify.ps1`：退出 0；冻结安装和 10 成员工作区检查通过；build 10/10、typecheck 14/14 及根 tsc 通过，全部 0 缓存；根测试 198/198、浏览器 15/15 通过。日志 `.tools/g2-local/main-merge-verify.log`。
- `.\scripts\pnpm.ps1 test:infra`：退出 0；真实写读、权限拒绝、精确安装、重复发布 E409、三服务重启与隔离恢复全部通过。runId 为 `db540b272cf445c796cbc96610676570`，完成于 2026-11-12 11:42:43（Asia/Shanghai）。tarball SHA-256 为 `80b9be0399ea5de502632dda9ad7e7c9d96f81299a16e60346d16ac94f014dba`，数据 SHA-256 为 `c72fb05621a7066c0c3c622bbe9f266ae589b835837e8d94214d548e58cc59aa`。日志 `.tools/g2-local/main-merge-infra.log`。
- `.\scripts\pnpm.ps1 infra:check-access`：预期退出 2，OIDC/独立预览域均未配置，`g2Ready: false`。日志 `.tools/g2-local/main-merge-access.log`。
- 原始架构 SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

本记录仅补充合并后的实际验证，不重写先前证据。G1 业务回执、OIDC、独立预览域和完整 G2/T01 仍保持原有未完成状态；合并不代表生产或业务发布验收。
