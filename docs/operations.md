# 平台运维

## 日志与指标

API每次响应输出HTTP_COMPLETED，使用服务端生成的requestId、status、durationMs。worker输出RELEASE_CLAIMED/RELEASE_STAGE/RELEASE_FAILED，包含taskId、原RELEASE_CREATED的requestId、stage、attempt及受控错误码。固定字段白名单丢弃原始错误、URL、凭证和业务字段；日志sink抛错不改变发布结果。阶段审计写入是尽力而为，PG中断期间依赖stdout日志收集，不声称零丢失。

`GET /internal/metrics` 使用独立32–256字符的 `PLATFORM_METRICS_TOKEN` Bearer凭证；不配置返回404，错误凭证401，DB不可用503。必须在TLS入口阻断 `/internal/` 的外部访问，仅允许监控网络；禁止将token放query。指标含当前各状态作业、当前错误原因、执行重试次数、缺件数、队列积压、索引与tag积压、持久化阶段count/sum。标签只有固定枚举，没有用户、任务ID或路径；阶段均值可由sum/count计算，不能由它推导p95。数据从DB读取，API/worker重启后仍保留。审计量增长后需监控查询耗时并按生产容量评估聚合策略。

## 部署准备

`infra/compose.production.yaml` 是六服务准备模板，包含API/worker/网关与三存储，不包含B负责的画廊部署。所有业务服务只运行编译产物；MinIO须使用infra/versions.json对应固定源码构建后的审查摘要。API/preview镜像由组织镜像仓库提供实际digest，不能填示例hash上线。

Linux CI以固定工具链完成 frozen install、`build:services`、服务检查后，将运行时闭包导出到独立目录：

```text
pnpm --filter @company/platform-api deploy --prod --legacy <staging>/api
pnpm --filter @company/preview-gateway deploy --prod --legacy <staging>/preview
docker build -f infra/production/Dockerfile --target api --build-arg NODE_RUNTIME_IMAGE=<node:26.13.0-bookworm-slim@sha256:审查摘要> <staging>
docker build -f infra/production/Dockerfile --target preview --build-arg NODE_RUNTIME_IMAGE=<同一摘要> <staging>
```

这些是待生产CI验证的打包步骤，本轮没有构建/发布生产镜像。staging中不能包含SDK、CLI、gallery、examples、浏览器、源码或开发依赖。模板运行在非root、只读根目录、无额外capability模式。`PLATFORM_BIND_HOST=0.0.0.0`供容器内部使用，本机默认loopback；Compose不发布裸端口。

从私有环境文件/密钥管理注入模板全部必填项，先运行 `verify:deployment --environment` 和 `docker compose -f infra/compose.production.yaml config --quiet`（不要打印完整config）。单独执行向前迁移：`docker compose -f infra/compose.production.yaml run --rm api node dist/db/migrate.js`；迁移权限由专用临时身份授予，运行身份不应拥有DDL权限。再由经过授权的发布流程启动应用。

Postgres建立API、预览、迁移三个身份；预览最小权限参考网关README。MinIO root仅初始化，API拥有私有bucket所需读写，网关仅GetObject。Verdaccio使用 `platform-publisher` 与 `platform-reader`，禁止unpublish，默认拒绝其他scope。TLS入口为S3签名上传与Registry只读消费提供受认证路由，不能把bucket设为公开。外部edge网络由平台运维提供，须正确配置Host、证书与流量限制。

预览需独立注册域、逐release origin/wildcard TLS、网关授权与CSP。`infra/gateway/preview.conf`为主机部署参考，容器时需将upstream改为preview-gateway:3001并使用实际独立域。管理API `/internal/`仅监控网络可达；网关无管理API凭证。OIDC、TLS、第三方Cookie策略、生产镜像与TLS入口仍待真实环境验收。

## 备份与恢复

建议生产RPO≤24h、RTO≤4h；这不是本地演练即可保证的SLA。生产停写窗口应停止API/worker并关闭存储入口写权限，等待发布租约和上传完成，记录一致性点。PG执行custom-format pg_dump，Verdaccio与MinIO暂停写入后对各自独立卷做一致快照；PG不能只复制正在运行的数据目录。记录镜像/迁移版本、文件长度与SHA-256、加密密钥的恢复途径。备份包含私有包/业务材料，须加密存储、限制ACL，凭证单独备份。

`rehearse:backup` 已实现真实路径：只创建并管理 `zhrec-<UUID>-*` 且带所有权label的临时容器和卷；使用真实发布服务生成合成协议包，停写后PG dump、Verdaccio卷tar、MinIO卷tar，写入摘要清单。目标必须新建、DB/S3/Registry为空，且不能与源相同；损坏清单、缺文件、符号链接及校验失败先拒绝恢复。同目标恢复失败后也必须换全新目标，不能覆盖重试。

恢复后通过真实PG、S3与npm HTTP协议核对每份发布manifest、已发布包、框架实现、冻结对象、截图与上传冻结引用的摘要。结果 `.tools/operations/backup-report.json` 仅包含计数、体积、耗时；备份保留在 `.tools/recovery/<UUID>/backup`。容器与卷只清理该次演练创建的资源；目录里的私有凭证和备份保留，由本机所有者按需要归档/清理，不删除共享 `.tools`。

实际首轮成功：2个协议包、3个框架实现、14份发布对象，备份226690字节；备份到恢复检查15.509秒，整个测试28.93秒。本地样本很小，没有模拟生产数据规模；RTO必须在生产等量隔离环境再次测量。此工具是C可重复演练，不能把生产库URL交给它覆盖恢复。对独立恢复环境可使用 `verify:consistency` 进行只读审计；没有比较源清单的空数据库检查不构成恢复证据。

共享G2使用 `test:infra --no-restart`；默认旧test:infra会重启G2。无重启模式明确报告未覆盖该项，重启持久性由独立备份演练覆盖。不要在B联调时运行默认重启探针。

## 保留与回退

`PLATFORM_UPLOAD_RETENTION_HOURS`默认24（1–720）；`PLATFORM_FAILED_RETENTION_DAYS`默认30（1–3650）。新上传会话按配置设到期时间；已有会话保持创建时的期限。签名URL仍15分钟，到期需要原有重传流程，未增加刷新接口。

`ops:retention`仅输出无release引用的过期上传、过期REJECTED/CONFLICT任务待审查清单。失败作业也可能已有不可变包，清单绝不是删除授权；先确认DB引用、Registry和S3实际状态及审计保留，再由运维制定清理。Ready/DEPRECATED、有效基线及其引用永不按时间直接删除。自动GC尚未启用。

回退应用使用前一已验证镜像digest、锁文件及SDK组合。数据库只能按已审查脚本向前迁移；回退应用不等于schema降级。灾难恢复先在新实例完成摘要核查与权限/预览回归，再安排入口切换。禁止修改原架构文档或删除已发布包来实现回退。
