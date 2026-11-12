# T11 C 本地故障预演

2026-11-12，Windows x64，隔离 Node 26.13.0 / pnpm 12.18.0。

`scripts/pnpm.ps1 rehearse:recovery` 实测19项通过（7项故障预演 + 12项预览授权回归），Vitest 16.55秒。PG/MinIO/Verdaccio沿用本地固定版本；合成协议包每次唯一版本身份，不冒充当前SDK真实渲染或业务项目。

| 情况 | 注入及恢复证据 |
| --- | --- |
| PG/MinIO/Verdaccio暂不可用 | loopback TCP代理断路与连接销毁，不停止共享G2；恢复代理后用正常retry API/新worker完成Ready |
| 上传中断 | HTTP请求发送部分字节后断开；缺件不能完成；原签名URL重传后冻结摘要相同 |
| worker重启 | 子进程在包已写入、检查点登记后被SIGKILL；等待租约自然过期，新进程语义恢复，attempt=2、3条实现无重复 |
| 发布响应丢失 | 代理等待Verdaccio接收包成功后丢弃HTTP响应；逐包仅一次PUT，读取同名同版本摘要恢复 |
| 索引失败 | 独立outbox标记failed，目录仍Ready且明确返回indexStatus=failed；未实现的搜索服务不算本轮验收 |
| 权限撤销 | 停用身份后详情拒绝；另12项真实预览grant/资源/到期/撤权回归通过 |

`taskId/requestId/stage/attempt` 白名单JSON日志与持久化阶段统计已接入；原始凭证、URL、业务内容不记录。指标仅以枚举作标签。PG不可用时指标返回错误，不返回虚假零值。

未完成：两个真实Vue/React业务项目、当前SDK完整材料、100MiB/容量/p95目标、公司OIDC及生产域/浏览器策略。完整T11仍开放。备份恢复与本轮最终回归在独立验证记录中追加，不改写此前证据。
