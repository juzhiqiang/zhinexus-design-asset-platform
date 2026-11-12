# C 当前SDK、网页后端交接与容量预演

日期：2026-11-13；基点main `eb1d054`；分支 `feat/c-platform-capacity-acceptance`。用户明确授权新分支实施、完成后本地合并main并删除本次分支。复用当前C独立worktree，未清理其他分支/worktree、未push。

## 执行范围与本机环境

Windows x64 10.0.26200，AMD Ryzen 9 7900X，24逻辑核、33,397,465,088字节内存；项目隔离Node26.13.0 / pnpm12.18.0。三存储运行在本机Docker Desktop，HTTP与存储走回环网络。依赖未新增、上传限制和服务端零执行边界保持不变。

普通测试基线在最新main上实际通过550项，其中CLI生成当前五组件十实现冻结包、发布真实Registry并验证恢复。额外 `current-sdk.test.ts` 独立生成一次冻结候选，逐包核对Registry摘要；全部十实现公开目录、报告、截图及网关预览资源摘要一致；两个工作区外消费者分别从Registry精确安装Vue/React 0.0.5并导入五个子路径，包括趋势卡片。没有截图后重新打包。冻结bundle与本次acceptance.json保留在忽略目录 `.tools/operations/current-sdk/<UUID>/`。

网关资源验证使用独立测试域Host路由；本机消费者负责运行及截图，服务端只提供字节。既有真实浏览器隔离回归另行执行；本记录不把测试域HTTP路由称为生产TLS或公司域验收。

## 网页入口交接（C侧完成，B页面仍待联调）

`tests/platform/web-handover.test.ts` 五项真实HTTP测试通过。验证web手动提交在API重启后重用原幂等键，另一key不能重复占用同包版本；READY后仍为manual-upload/unconfirmed/pending，无自动报告、基线或baselineCandidates。Vue缺图、React缺图、框架错配及伪造自动来源均在建立作业前拒绝。

| B调用 | C侧已验证行为 |
| --- | --- |
| POST `/v1/uploads`、POST `/v1/uploads/:id/complete` | 上传会话与web身份绑定；部分上传409；完成可幂等重试 |
| POST `/v1/releases` + `Idempotency-Key` | 必须持久化原请求、会话与key；换key重占包版本409；重启不丢任务 |
| GET `/v1/releases/:jobId` | READY与baselineCandidates独立，网页没有自动基线候选 |
| GET `/v1/me/variant-releases/:releaseId` | 须有效身份和组件权限；精确包名/版本/实现，材料与报告使用同一releaseId |
| GET `/v1/variant-releases/:releaseId`及其`/artifacts?path=`、`/reports` | 只公开可读版本，撤回公开后下一请求404/no-store |
| POST `/v1/preview-grants` | 须携带访问者身份；返回短期bootstrap URL，预览不携带平台token |

错误码按现有contracts：`SCREENSHOT_REQUIRED`、`SCREENSHOT_VARIANT_MISMATCH`、`SOURCE_FORBIDDEN`；初版测试对错误码和换key去重作了错误假设，读取契约及实现后修正测试，未改变API语义。根tsc另发现harness默认UUID推断过窄，已为幂等key显式标注string。

本轮不修改B的画廊/CLI实现；控制台真实会话、页面缺图提示、浏览器上传/恢复与真实画廊预览仍由B验收。

## 首轮容量实测

命令：`scripts/pnpm.ps1 exec tsx scripts/rehearse-capacity.ts`；3项通过，12.62秒。独立runId `f4597c22-305d-45f9-9cb4-1a0de5f6678c`；本机报告 `.tools/operations/capacity/<runId>/summary.json`。

| 场景 | 输入与核验 | 首轮结果 |
| --- | --- | --- |
| 目录 | 隔离PG合成200组件/400实现，20并发×10轮；200响应逐项校验分页、框架与总数 | 0失败，p50 58.72ms、nearest-rank p95 84.45ms、max94.70ms；初始500ms目标通过 |
| 上传恢复 | 40+40+20MiB、20个5MiB分片；3个分片已成功后中断另一PUT，重启API，原会话继续补传 | 总104,857,600字节；3个确认分片零重传；20个分片完成、冻结摘要一致、完成事件仅一次；3.45秒 |
| 发布阶段 | 5次唯一合成协议样本，每次2包/3实现，从PENDING处理到READY | 0失败，p50 488.16ms、p95/max520.35ms；初始30秒目标通过 |

统计实现先新增测试观察缺模块失败，再实现nearest-rank、失败计入分母和非法样本拒绝，两项单元通过。容量测试在实际HTTP/S3/Registry上均通过，未因已满足需求而改动生产服务代码。

目录规模样本是直接seed的合成元数据，并非400个真实SDK导出或已发布实现。100MiB指总提交，不放宽50MiB单文件限制；上传预演不把二进制静态样本冒充有效组件发布，也不覆盖15分钟URL过期后的刷新。5次发布样本不能估计生产尾延迟，且不包含构建/截图/上传/tag后处理。全部报告productionAcceptance=false。

## 最终验证与审查

基线：frozen install、verify:workspace、test:infra --no-restart均通过；无缓存build10/10，普通test30文件550项通过；无缓存typecheck14/14通过。根tsc暴露harness类型问题，修复后再次通过。未重启共享G2。

完整platform/browser、命令入口、独立审查、版本及合并后结果完成后在下方追加。不把未结束或历史输出报告为通过。

## 保持开放的外部门槛

公司OIDC/PKCE、生产独立域/TLS/Cookie策略、生产镜像与最小权限、T08真实页面、T10兼容回退、真实Vue/React业务试点和生产等量备份RPO/RTO仍未验收。C本轮完成不等于G2/M2/T11/T12整体完成。
