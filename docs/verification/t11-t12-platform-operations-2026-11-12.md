# T11/T12 C 平台运维准备验证

环境：2026-11-12，Windows x64，项目隔离 Node26.13.0 / pnpm12.18.0；Docker Desktop Linux容器。分支 `feat/t11-t12-platform-operations`，从T07合并后的main `617e967`开始。所有检查由本机运行，未在服务端执行组件构建或浏览器。

## 合并与范围

用户授权先合并 `feat/t07-catalog-preview`、新开分支实现C准备任务、再合回main。T07在 `617e967` 完成本地合并，合并前后均实际运行普通test：25文件/521项通过，合并树与原T07树一致。复用当前独立工作区，未进入B脏工作区切分支或覆盖文件，也未清理A的worktree。

本轮提供：API/worker白名单结构化日志、独立运维token保护的持久化指标、真实传输故障与进程中断恢复、真实PG/Verdaccio/MinIO隔离备份恢复、只读一致性检查、部署准备模板、保留清单及运维文档。完整G2/M2/T11/T12和生产部署仍未验收。

## 实际验证

| 命令/检查 | 本轮实际结果 |
| --- | --- |
| `scripts/pnpm.ps1 install --frozen-lockfile` | 通过，未新增第三方依赖 |
| `scripts/pnpm.ps1 verify:workspace` | 10成员、依赖无环、安全服务闭包通过 |
| `scripts/pnpm.ps1 exec turbo run build --force` | 10/10，0 cached |
| `scripts/pnpm.ps1 exec turbo run typecheck --force` | 14/14，0 cached |
| `scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 通过 |
| `scripts/pnpm.ps1 test` | 29文件/528项通过；既有Node DEP0190警告保留 |
| `scripts/pnpm.ps1 rehearse:recovery` | 19项通过；7项真实故障场景及12项预览授权回归 |
| `scripts/pnpm.ps1 rehearse:backup` | 1项真实恢复通过，整个测试28.93秒，见下表 |
| `scripts/pnpm.ps1 test:infra --no-restart` | PG读写唯一约束、S3私有读写、Registry只读/匿名拒绝、精确安装、不可变与局部恢复通过；明确没有重启共享G2 |
| `scripts/pnpm.ps1 verify:deployment` | 模板静态检查通过，environmentValidated=false、productionAcceptance=false |
| `docker compose --file infra/compose.production.yaml config --quiet` | 使用非敏感占位环境，仅语法解析通过；未启动、未拉取或发布生产镜像 |
| 观测/保留HTTP追加测试 | 3项通过；无token配置404、错误token401、DB断连503、持久化阶段统计及48小时新会话/Ready引用排除 |

完整platform/browser结果在完成后追加；不使用未结束输出作为成功证据。

| 首轮成功备份指标 | 数值 |
| --- | --- |
| 真实协议包/框架实现 | 2 / 3 |
| 发布对象引用 | 14 |
| 备份体积（PG custom dump + Verdaccio卷tar + MinIO卷tar） | 226690字节 |
| 从备份开始到目标恢复摘要检查 | 15509毫秒 |
| 整个测试（含源栈创建、seed、清理） | 28.93秒 |

每次测试会生成新的协议包身份，dump体积/耗时会小幅变化；首轮实测不重写，后续结果见本机`.tools/operations/backup-report.json`。备份保留于忽略目录`.tools/recovery/<UUID>/backup`，其中私有材料及相邻凭证需按operations说明保护。已创建的临时容器/卷仅按所有权label清理；共享G2保持运行。

## RED→GREEN 与问题定位

- 初始观测测试因模块缺失失败；增加白名单日志与受保护HTTP后通过。阶段指标改从audit_events读取，支持worker/API进程分离，持久化回归通过。
- 真实故障预演初始缺少故障代理失败；代理和真实子进程补齐后PG/S3/Registry断路、上传中断、SIGKILL+自然租约到期、丢弃Verdaccio成功响应、索引失败与停用身份全部通过。恢复不写release_jobs强改状态。
- 备份清单与路径/损坏测试初始失败；工具补齐后2项单元测试通过。真实恢复先后捕获：Verdaccio需Basic身份头、PG初始化临时socket被误认就绪、Docker停止/启动后动态端口重分配。采用已验证认证协议、TCP就绪检查、启动后重读实际端口解决，真实恢复通过。
- 部署/保留测试初始缺模块失败；YAML合并键需显式merge选项，环境变量名正则需允许S3中的数字，修复后测试与Compose真实语法解析通过。
- 原test:infra默认重启共享G2；新增显式 `--no-restart` 参数并在报告里移除重启通过声明，实际运行通过。独立恢复测试承担本轮重启验证。

## 限制与验收

当前备份是隔离栈合成协议样本。没有完成生产等量数据、生产RPO/RTO、200组件/400实现/20并发/p95、100MiB续传容量验收。阶段count/sum不能声称提供p95。审计在PG不可用期间尽力写入，需由stdout收集器补充，非零丢失承诺。

生产API/网关镜像digest、Node Linux runtime审查digest、公司OIDC/PKCE、TLS独立域/第三方Cookie策略、真实业务项目与当前SDK完整CLI/画廊材料缺失。部署模板与Dockerfile是准备产物，未声称真实生产镜像已构建/部署；运行时最小权限/TLS入口需目标环境验证。保留工具只输出review-only清单，不启用自动GC。

原架构SHA-256实测保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。未push，未生产部署；历史T05–T07验证记录保留原样。

## 聚焦提交

- `617e967`：按用户授权合并T07。
- `fa3cd88`：C运维准备执行计划。
- `ab4798b`：脱敏事件与持久化运维指标。
- `0cd7504`：真实故障与中断恢复演练。
- `f01f558`：三存储备份、隔离恢复与引用检查。
- `f4f355b`：部署核验、保留策略及运维交付。

独立审查、版本和最终合并复验结果在本文件后续追加。

## 独立审查修复

fresh-context reviewer只读审查 `617e967..f4f355b`，发现1项Important：一致性检查缺少对截图/报告登记完整性的核对；另外提出部署安全检查未覆盖root、运行目录挂载及网络归属。按实际运维风险将后者也纳入本轮修复，未留下延后的小问题。

真实隔离DB的4类破坏（删截图、删报告、改报告内容、错配实现）先全部复现旧工具误报通过，修复后4项通过，并再次通过真实三存储恢复（合计5项）。部署root/运行目录挂载/网络反例先失败后通过；根tsc通过。修复提交 `5d6cc24`。

生产身份/TLS、生产镜像及Linux打包、真实项目/当前SDK材料和容量目标维持未验收；真实搜索服务不在本轮，只有outbox正交验证；自动GC按批准范围保持review-only。若需要变更这些范围，必须另做目标环境验证，不能依据当前静态或本地结果上线。

`verify:deployment` 静态退出0；缺公司配置的 `--environment` 实测退出1，未虚报环境验证成功。审查前完整平台73项、浏览器71项均通过；修复后完整回归继续单独记录。

## 修复后的最终回归与版本

- `scripts/pnpm.ps1 test`：29文件/528项通过，66.64秒。
- `scripts/pnpm.ps1 test:platform`：23文件/77项通过，117.27秒，含4项证据登记破坏反例和完整三存储恢复。
- `scripts/pnpm.ps1 test:browser`：71项通过，11.0秒。严格在platform完成后运行，无SDK dist重建竞争。
- 版本独立提交 `7a53751`：根/API0.0.4、网关0.0.2及CHANGELOG；SDK/CLI不变。升版后frozen install与verify:workspace再次通过，无锁文件变更。
- 修复后的部署静态验证通过；缺外部环境的environment模式按预期退出1。无延期审查问题；不重复派审查代理，以RED→GREEN及整套回归验证修复。

新生产拓扑若与本次严格部署检查不一致，需同步审查并修改检查器；不能用静态检查通过替代身份/TLS/镜像内容的目标环境验收。
