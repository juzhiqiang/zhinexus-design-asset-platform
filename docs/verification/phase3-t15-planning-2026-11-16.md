# 三期 T15 四方规划校验

日期：2026-11-16（Asia/Shanghai）。读取基线：`b35498ac9bddcfcc63ff4fdd85c7befaf29e6c0f`。本次仅设计/计划与入口文档，产品实现尚未开始。

## 交付范围

- [T15 设计](../superpowers/specs/2026-11-16-phase3-t15-design.md)：只读项目识别、安装计划、证据和边界。
- [四方执行计划](../superpowers/plans/2026-11-16-phase3-t15-kickoff.md)：P0 契约、P1 Claude 桌面端主要开发、P2 Antigravity 独立矩阵、P3 Claude Code 黑盒、P4 Codex 真实集成与收口；附 T16/T17 接续。
- README、总体实施评估、T01–T17 计划及分工入口增加本轮指引，保留历史记录。
- 创建本轮规划分支 `chore/phase3-t15-planning`；产品开发分支尚未创建，未向实际开发客户端派发。

## 实际检查

| 检查 | 实际结果 |
| --- | --- |
| `git status --porcelain=v1` / `git branch --show-current` / `git rev-parse HEAD` | 开始时 main 干净，基线如上 |
| 现有实现与文件核对 | 阅读二期最终收口、T15–T17、contracts、CLI 命令/消费者、测试配置；确认 integration/MCP 尚未实现 |
| `git diff --check` | exit 0 |
| 六份设计/计划/入口文档的相对 Markdown 链接目标检查 | 全部目标存在，exit 0 |
| `.\scripts\pnpm.ps1 verify:workspace` | exit 0；10 成员、无循环依赖、4 公开包、安全服务依赖图通过 |
| `Get-FileHash -Algorithm SHA256 component-platform-architecture.md` | `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与受保护基线一致 |

workspace 检查由脚本先恢复本地缺失的 Node/pnpm，输出版本为 26.13.0 / 12.18.0，再完成边界校验；未修改全局工具。没有产品行为变更，未运行产品单元/浏览器/真实服务验收，不据此标记 T15 或三期完成。

## 独立规划审查

使用实际 Codex 审查子代理，仅静态阅读，不替代用户指定的 Claude/Antigravity 开发客户端。审查指出以下事项，均由 C 更新设计和执行步骤：

1. dirty/untracked 检查需要允许固定 argv/cwd 的只读 Git，并禁 optional locks、fsmonitor、外部辅助与目标环境覆盖。
2. 离线 MatchPlan 自洽不足以发现删掉必填 prop/事件；增加最新 GET 权威 API 的完整成员、类型及绑定对照。
3. tarball 下载期间可能撤权；增加网络检查结束后的 GET 资格/身份/摘要/API 复读及 deferred-response 反例。
4. P4 专项的行为 RED 放在 B 合入前；环境缺失失败不能冒充行为 RED。

审查确认文件范围和 P0→并行→集成依赖安排可执行。C 完成以上修订及计划自检；此结论属于规划审查，不代表新产品代码已通过审查或运行。
