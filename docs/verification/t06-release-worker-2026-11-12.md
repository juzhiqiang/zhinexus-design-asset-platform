# T06 本地发布执行器与恢复验收

日期：2026-11-12。负责人 C；分支 `feat/t06-release-worker`，基线 `6da7e1c`。平台根/API 版本 `0.0.2`。本次范围为 T06 本地实现与真实三存储验收，不代表完整 G2/M2 或生产上线。

## 交付

- 向前迁移 004：作业重试预算/时间、缺失材料、不可变资源映射、outbox、独立 tag 待办；不改已应用 SQL。
- PostgreSQL 短事务认领、60 秒租约/20 秒续租、fencing token、五次有界自动重试与显式人工恢复；进程退出后任务仍在数据库。
- MinIO 私有资源条件写入与摘要核对；过期上传会话不影响已接受任务。注册表仅 HTTP 传输原 tarball，从不 install/build/执行脚本。
- 所有公司 dependencies/peerDependencies 的拓扑与递归可达性；包已存在或发布响应丢失时下载真实字节比较；同版本异摘要失败关闭。
- Ready、包/实现状态、审计、outbox 和 tag 目标原子登记；恢复 READY_TX 时重新核对全部文件、预览入口、包与公司依赖。
- 默认 tag 选择最高 Ready SemVer，串行协调并定期核对真实 latest；旧版本乱序完成不会下调目标。

## 实际验证

均在 Windows 固定 Node 26.13.0 / pnpm 12.18.0 下通过 `scripts/pnpm.ps1` 或 `scripts/verify.ps1` 执行。

| 命令/检查 | 结果 |
| --- | --- |
| 开工 `verify:workspace`、`test:platform` | 10 成员通过；原 8 文件/18 项通过 |
| 租约/迁移专项 | RED 缺实现；GREEN 4/4，含并发、过期 token、重试预算、空库迁移往返 |
| 注册表 HTTP 专项 | 最终 14/14；含响应丢失、实际摘要、拒绝外域/重定向/超限、peer 递归、拓扑与 SemVer |
| 新 worker 恢复与 tag 专项 | 最终 12/12；含各检查点恢复、Ready 事务回滚、过期 worker、缺资源、缺普通/peer 公司依赖、旧 tag 晚到/版本乱序 |
| `test:platform`（修复后） | 13 文件/35 项通过，55.14 秒；真实 PG/MinIO/Verdaccio，缺服务不 skip |
| `$env:TURBO_FORCE='true'; .\scripts\verify.ps1`（修复后） | 退出 0；冻结安装、workspace、无缓存 build 10/10、typecheck 14/14、Vitest 24 文件/480 项、Playwright 46 项通过 |
| `test:infra` | 三存储写读、注册表权限/精确安装、同项目重启、隔离备份恢复通过；报告 `fa2464b5fc014a97a76c227b63da0ec1` |
| `infra:check-access` | 退出 2；OIDC/preview=unconfigured，g2Ready=false，保留外部阻塞 |
| 原始架构 SHA-256 | `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，未修改 |

完整本地日志在忽略目录 `.tools/t06-platform-final.log`、`t06-full-final.log`、`t06-infra.log`、`t06-access.log`。各阶段 RED/GREEN 日志使用 `.tools/t06-*.log`；真实 SDK 验收明细在 `.tools/t06/sdk-release-*.json`，没有凭证。

## 真实材料与进程恢复证据

使用仓库既有 `tests/fixtures/releases/t05-verified-sdk/bundle`，保持三个 0.0.2 tarball、四个 Vue/React line/bar 实现的截图/报告原字节。API 真签名认证、真实上传/冻结后，第一个独立 OS worker 在对象固化后遇到不可达 registry，留下 ENSURE_PACKAGES/RETRY_WAIT；进程退出。恢复连接后另起一个 OS worker，按同一 jobId/摘要继续到 Ready。

随后从真实 Verdaccio 下载三个包核对 SHA-256，并在工作区外分别安装 `charts-vue@0.0.2`、`charts-react@0.0.2` 及精确 core 依赖。安装使用只读注册表身份、ignore-scripts/legacy-peer-deps：证明原包和公司依赖实际可安装，**不作为新一轮 peer 兼容性或浏览器复测**。截图是历史真实证据重放，没有声称重新拍摄。协议故障测试的随机命名合成包与这组真实 SDK 证据分开记录。

## 独立审查与修正

独立审查针对 `6da7e1c..5a86a3a`：无 Critical，3 项 Important，无 Minor。原结论要求修复后才能合并；没有把该结论表述为修后审查批准。

1. 公司 peer 依赖漏检：新增排序/传递 peer 两项测试先失败，再统一 dependencies/peerDependencies 校验；同名不同精确版本拒绝。
2. 超时旧 tag PUT 晚到：审查者用实际 HTTP 延迟响应复现；补真实注册表在 generation 已确认后被旧值覆盖的失败测试。修复后每 60 秒重检实际值，失败 5 秒再试。
3. 旧版本晚 Ready 降级 latest：真实两作业乱序测试先得到错误 0.0.1，再改为事务中选择最高 Ready SemVer，验证保持 0.0.2。

修复提交 `57252f6`；按 executing-plans 完成一次修正与完整回归，没有派第二轮审查。没有遗留 Minor。

## 实施决定与未覆盖边界

- 复用现有隔离工作树；共享 `.tools` 和本地服务数据卷保留，不归档。开工先将六份本地接入配置加密到 Windows 用户 LocalAppData 下的 `Zhinexus/local-state-backups`，并验证可解密；恢复需要相同 Windows 用户，未把配置内容提交。
- C 提供本轮必需的平台 registry-client，B 的 CLI/消费者实现仍归 B；本轮未扩展最新 SDK 的 pie Bundle 或真实静态预览。
- 默认 tag 无外部 CAS：即使 PG advisory lock 串行，超时请求仍可能在 registry 晚到，因此只承诺持续核对恢复，存在短暂偏离窗口；预发布按 SemVer 排序，Ready 不代表正式一期投产验收。
- 实测 Verdaccio 7.1.0 的 `@verdaccio/store/build/lib/storage-utils.mjs` 中 normalizePackage 在缺 latest 时合成最高版本 latest。平台首次请求严格只含 candidate tag，但首包默认安装仍可能早于 Ready；当前范围不提供注册表层未 Ready 读隔离，也不删除 tag/包规避。目录/推荐必须按平台 Ready 控制。
- outbox 可靠写入已完成，索引消费者、公开目录、隔离 preview gateway 为后续任务。
- 公司 OIDC 登录/PKCE/撤权、独立注册域/DNS/TLS、当前 SDK 六实现完整 CLI 发布材料仍未验收；完整 T05/G2/M2 保持开放。
- Native PowerShell 维护执行 ledger，未使用 POSIX 技能脚本；验证日志和聚焦提交构成对应证据。

## 提交

- `c01a915`：T06 执行计划。
- `0e38b34`：租约、fencing 与持久化重试。
- `705a865`：冻结对象与注册表原包幂等发布。
- `28eaaf7`：worker、Ready/outbox/tag 事务、独立进程与真实 SDK 验收。
- `5a86a3a`：部署与恢复说明。
- `cebedec`：平台根/API 独立升版至 0.0.2。
- `57252f6`：公司 peer 与默认 tag 的三项审查修正。

主分支合并与合并后复验结果将在下方追加，不改以上分支验证结果。
