# C：干净工作树平台专项复现

分支：`chore/c-local-acceptance`。基线 `4dc93fec1c0c702fb615b0709f8f7a9816bc3ec9`；计划提交 `b51f63c`。执行于 Windows x64，固定 Node 26.13.0 / pnpm 12.18.0，2026-11-13 深夜至 2026-11-14。此为新增记录，不改写此前验收。

## 根因与变更

1. 原 `imageId()` 无条件读取 `images.json`，干净工作树无法使用本机已有锁定 MinIO 镜像。现在缺登记时核对本地镜像 source/revision/release 与 linux/amd64 后原子登记不可变 ID；非法已有登记不回退或覆盖。
2. 原平台 support 读取共享凭据并固定连接 15432/19000/14873。现由 Vitest global setup 自建 `RecoveryStack`，通过内存 provide/inject 注入独立凭据和动态端口。故障代理、进程重启 worker、注册表安装与 tag 验收均改用注入配置。默认未注入即拒绝。
3. 本轮只改本地开发/验证设施，不新增产品 API 或改变 SDK 对外行为，不触发独立产品升版。

## 实际验证

| 命令/动作 | 结果 |
| --- | --- |
| `scripts/pnpm.ps1 install --frozen-lockfile` | 344 个依赖冻结安装通过，未修改锁文件 |
| `exec vitest run tests/unit/local-images.test.ts`（实现前） | RED：8 项失败，复现无条件读取缺失登记 |
| 同上（实现后） | GREEN：8/8；涵盖缺登记、已登记、来源/revision/release/架构不匹配、坏登记和脱敏错误 |
| `exec vitest run tests/unit/platform-isolation.test.ts`（实现前） | RED：仍尝试读取共享凭据 |
| `exec vitest run --config tests/platform/vitest.config.ts tests/platform/isolated-environment.test.ts`（实现前） | RED：共享凭据缺失，未建立独立设施 |
| 两个 unit 文件（实现后） | GREEN：9/9 |
| 独立设施真实探针（实现后） | GREEN：1/1，真实 PostgreSQL 临时数据库、S3/registry 健康请求通过 |
| `test:platform` | **28 文件，88/88**；含冻结当前 SDK 14 实现、上传、基线 CAS、并发、传输故障、worker 被杀恢复、备份恢复与引用一致性 |
| `test` | **38 文件，692/692**，含根 CLI 自有三存储发布集成 |
| `rehearse:backup` | **1/1**；真实三存储备份恢复到独立新栈，检查已发布引用 |
| `rehearse:recovery` | **2 文件，19/19**；passed=true、productionAcceptance=false |
| `verify:workspace` | 10 members、无环、4 个公开包、服务端依赖闭包安全 |
| `exec tsc -p tsconfig.json --noEmit` | 通过；PowerShell 使用 `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` 传参 |
| `verify:deployment` | templateValidated=true；environmentValidated=false；productionAcceptance=false |
| `infra:check-access` | OIDC/preview 均 unconfigured，g2Ready=false，脚本退出 2（pnpm 转为失败退出） |
| 架构 SHA-256 | `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，未变 |

日志位于当前 C 工作树被忽略的 `.tools/platform-isolated.log`、`.tools/c-root-test.log`。首次服务构建可能从 Turbo 恢复编译产物；本表行为套件全部实际执行，未以构建缓存替代测试。命令调用中的两次 PowerShell/tsc 参数格式错误已用上表数组形式修正，不计为通过验证。

专项结束后检查 `docker ps` 与 `docker volume ls` 的 `org.zhinexus.recovery` 标签筛选均无残留。测试保留自身忽略目录内的本地材料，不打印或提交凭据。SDK 0.0.10 既有权威 Bundle 另经 199 个文件的字节数与 SHA-256 逐项核对，14 实现，0 不匹配；本次未修改它。

## 保留边界

- 本机镜像标签核对不是镜像签名/供应链证明；首次仍需按锁定源码构建。
- 协议 OIDC fixtures 与本机 TLS/测试域只证明本地行为；真实公司身份、生产域/DNS/TLS、真实双框架业务试点仍未接入。
- B 的新基线 CLI 和 A 的兼容探针不包含于本表 C 分支的结果；待合并后另建集成记录。
- Node 的既有 `DEP0190` 警告仍出现于本地消费者命令路径；测试通过不能解释为已消除该警告。

## 历史引用勘误

旧 C 归档对 A 文档提交的引用存在字符串笔误。正确可解析提交为 `2768d8fd8ae9124add8042046cebbd538d7464b4`；本记录补充勘误，保留原历史记录字节。
