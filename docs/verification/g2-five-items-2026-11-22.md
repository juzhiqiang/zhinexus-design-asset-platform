# G2 五项接入实测记录（2026-11-22）

本轮于 2026-11-22 在 Windows x64 本机执行，时区 Asia/Shanghai；报告内部时间为 UTC。基线 `6511ba77`，分支 `chore/g2-five-item-acceptance`，负责人 C / Codex。完整 G2 为五项，当前三存储已有新增的隔离本机实测证据，OIDC 与目标预览接入未配置，完整 G2/T01 未完成。原 [2026-11-12 记录](g2-local-infra-2026-11-12.md) 保留不变。

## 五项逐项结论

| 项目 | 本轮实际验证 | 当前结论与缺口 |
| --- | --- | --- |
| PostgreSQL | 18.6，插入 256 字节载荷后复读内容与摘要；重复主键返回 23505；真实 Docker 进程重启后同一行与摘要不变；pg_dump/psql 恢复到新数据库后复读 | 隔离本机实测通过。未验收公司部署实例与权限，不将探针表等同业务迁移 |
| Verdaccio | 专用 publisher 发包一次；reader 从新缓存、仓外临时目录安装精确 `1.0.0` 并核对安装名、版本、README 与 lockfile SHA-512；匿名 401、reader 写入 403、重复发布 E409；重启后 tarball SHA-256 不变 | 隔离本机实测通过。每轮包名唯一、不删除重发；公司 registry/账号交付与正式接入回执未完成 |
| MinIO | 固定 release/commit/image ID；私有对象 put/get 与 SHA-256 一致；匿名 403；进程重启后复读；从本轮备份恢复到新 key，原/新对象摘要均一致 | 隔离本机实测通过。使用本机管理凭证；公司最小权限、维护责任及空目标全卷灾备未由本轮验证 |
| OIDC | `infra:check-access` 与直接 access.ts 两次真实执行；配置项为 null，返回 `oidc: unconfigured`，退出码 2 | 未完成。没有执行真实网页登录、CLI PKCE/回调、角色或撤销，discovery/工具测试不能替代这些操作 |
| 预览接入 | 同两次命令独立返回 `preview: unconfigured`，退出码 2 | 未完成。没有目标环境的解析/证书链、授权/撤销及浏览器隔离实测；既有本机 IP 模式测试不等同目标环境验收 |

两次接入检查都保持 `g2Ready: false`。默认正式独立域门槛及经授权的 IP 分 HTTPS 端口试用模式沿用当前规则，未修改范围。

## 固定环境与重启证据

本机实测 Node `v26.13.0`、pnpm `12.18.0`、Docker Engine `29.8.2`。三存储从 `infra/versions.json` 的固定镜像/源码配置启动，MinIO 同时实际执行 `/minio --version` 核对 release 与 commit。未重新构建或发现最新版依赖。

| 服务 | 实际运行 image ID |
| --- | --- |
| PostgreSQL | `sha256:8bca9649e52d948114ccc8164b55b7ab26b64e729893e420114bb5c87bf7c7cc` |
| Verdaccio | `sha256:1d014b80fafa1419c2a098aeb5f9508b310cfabac97743491cb835993ae37d38` |
| MinIO | `sha256:8cddf933628349b40111a4f03c04408d4f653803dc27a0d19786af7df6b6b8c0` |

MinIO 为 `RELEASE.2025-10-15T17-29-55Z` / `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`；源码摘要及 builder 固定值沿用 `infra/versions.json`。本轮证明运行时身份与字节操作，不将 image ID 当供应链签名或跨机器可复现构建证明。

每轮先读 Docker inspect 的实际 `StartedAt` 与卷名，执行本轮三个自有容器的 `docker restart`，再核对 `StartedAt` 已变化、原卷名保持、端口仍仅绑定 `127.0.0.1`。Docker 随机端口可重新分配，因此从 inspect 重新取址后连接同一容器/卷复读，不以客户端或健康检查重启代替数据进程重启。

第六轮 PostgreSQL 的进程时间从 `2026-11-21T19:13:16.244543001Z` 变为 `2026-11-21T19:13:21.901316318Z`；本地时间分别为 2026-11-22 03:13:16 和 03:13:21。三轮的进程时间与端口分别保存在本轮 JSON 报告中。

## 三轮完整实测摘要

| 轮次 | runId | 本地完成时间 | 检查结果 | 探针载荷 SHA-256 | 冻结 tarball SHA-256 |
| --- | --- | --- | --- | --- | --- |
| 第五轮 | `47427631-52f1-4a54-b0e0-9f1963e13da6` | 2026-11-22 03:12:08 | 9 条检查通过；自有容器/卷清理完成 | `c9850124ca654616665d9ef988a3342f51e994142772015f176fff492a8153d6` | `51edd12275a507190de31b649a8959ce93326dd84b00b429ecd5cbdc45a8fdba` |
| 第六轮，清理顺序修正后 | `b95f1b8f-fd2d-4a19-993d-ca3dbc92e8e6` | 2026-11-22 03:13:28 | 9 条检查通过；消费者与自有容器/卷清理完成 | `5db0c7a0c92226fc86ae137122e18cc666b6eab28faf3785aeff424689dbdcef` | `6b40695bacda6ab3c0ad830a02bd7f383f0210e07607e1bfc07d73ba42371be5` |
| 第七轮，初始化清理边界补充后 | `2ce653ee-ac1c-4611-a94a-f2798cb30511` | 2026-11-22 03:16:59 | 9 条检查通过；消费者与自有容器/卷清理完成 | `434ee111dc7c29369909525dcfb5fd5c38c36ff68fd3f2fee34de6a3699ee513` | `9b3f05d7dfa6e4809a6029742cae78fd569cfa199611b39a8907efffc9e38710` |

每轮 9 条检查分为 PostgreSQL 3 条、Verdaccio 3 条、MinIO 3 条。Verdaccio 包名分别由 runId 去连字符生成，版本均为 `1.0.0`，打包只有一次。重复发布同一冻结文件要求注册表实际返回 E409，之后下载摘要不变；不会覆盖已有字节。测试包只含 package.json 与 README，不执行组件或生命周期脚本。

## 实际命令与返回结果

所有 pnpm 命令通过仓库固定包装器执行。原始命令开始/结束时间、退出码及同名日志保存在 `.tools/operations/g2-acceptance/2026-11-22/`；脱敏索引与逐轮报告归档在 [机器可读证据](g2-five-items-2026-11-22.evidence.json)。

| 命令 | 实测结果 |
| --- | --- |
| `test:infra` | 退出 1，在 preflight 检出共享凭证缺失。没有启动、重启或改动共享 Compose 数据 |
| `exec vitest run --config tests/platform/vitest.config.ts tests/platform/g2-storage-acceptance.test.ts` | 七轮真实执行；前四轮失败原件保留；第五、第六、第七轮各 1/1 通过、退出 0、完整 9 条检查 |
| `infra:check-access` | 退出 2；OIDC/preview 未配置，g2Ready false |
| `exec tsx infra/scripts/access.ts` | 退出 2；同样明确未配置 |
| 设置 `TURBO_FORCE=true` 后 `build:services` | 5/5 构建与服务类型检查，0 cached，退出 0 |
| `exec tsc -p tsconfig.json --noEmit`（包装器使用 `-PnpmArgs` 数组传参） | 根 TypeScript 检查退出 0 |
| `verify:workspace` | 固定 10 成员与安全依赖边界通过，退出 0 |
| `exec vitest run tests/infra tests/unit/infra-options.test.ts` | 4 文件、19/19 通过，退出 0 |

未改产品行为，未运行全量 SDK 构建/截图或公司服务验收；本轮窄范围检查不替代那些任务。

## 保留的失败与审查修正

共享环境预检失败之外，新增验收脚本前四轮均确实失败，原日志和 `status: failed` 报告保留：

1. `0e1698e6-a695-4be2-a5d9-18448e4c3ae8`：npm 在 JSON 输出中将带连字符 UUID 文件名替换为 `***`，磁盘 tarball 正常存在。包名改为去连字符 runId；没有重新打包本轮产物。
2. `ea0aa51b-797b-4e42-9a5a-c173eb074171`：仓库 `.npmrc` 优先于 userconfig，publish 未显式指定 registry 而失败。实际 `npm config get registry` 确认有效 host 为 `registry.npmjs.org`；后续所有 registry 操作显式绑定隔离本机 origin。该轮未发布成功。
3. `3784f993-5be6-451e-b469-ec917474476b`：Windows `path.relative` 在 D/C 跨盘时返回绝对路径，消费者目录检查失败。改为同时接受位于另一盘的绝对路径，并保留临时目录清理边界。
4. `0d37251b-9c8a-42db-a144-dc422edc8b54`：真实容器重启后随机端口发生变化，旧“端口必须不变”的断言失败。改为 inspect 重新取址，继续验证同一进程实例与卷的数据。

独立代理按 requesting-code-review 技能只读审查新增测试与证据，指出消费者删除异常可能跳过栈清理、取得栈后的报告目录/客户端初始化缺少资源保护。已改为独立 `finally` 清理栈及外层资源保护，分别记录 `consumerCleanup` 和 `cleanup`，任一 pending 时报告 failed；第六、第七轮复验通过。未对初始化异常或 EPERM/EBUSY 路径额外做故障注入，因此不声称这些异常分支已有实测。

收尾时曾将根类型检查与服务构建并行执行，类型检查因 `dist` 正在重建而退出 1，失败原件为 `final-root-types.*`。服务构建完成后顺序复跑 `final-root-types-after-build.*`，退出 0；工作区检查同样退出 0。没有把失败输出隐藏或作为通过证据。

最终独立审查覆盖新增测试、验证记录、JSON、子计划与设施说明，未发现未解决的 Critical、Important 或 Minor。审查者复读实际命令日志，核对 60 个索引文件与测试源码共 61 个文件的字节数/SHA-256，均相符，证据中未发现敏感凭证。机器可读证据 SHA-256 为 `76b966f951587af71d0c3f6d9ed5f9423da0dde082fa77b32d04b0019afcce7c`。

## 证据、保密与未完成项

逐文件 SHA-256 索引仅包含报告、冻结 tarball、探针载荷备份、SQL 和命令日志，不包含凭证、`.npmrc` 或任何密钥。原件位于 `.tools/operations/g2-acceptance/`，每个自有栈的凭证留在 `.tools/recovery/<id>/`，两者均被 Git 忽略。分享材料使用提交的脱敏 JSON，不能整体拷贝这些本机目录。

用户已有 README 修改的 SHA-256 保持 `3d8a1373b1cfa4e4961b818850fa2bf1ae384a26ace31d5acad6bdd651e49cd7`，不纳入本轮提交。原始架构 SHA-256 保持 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。本轮只有测试与记录，无产品功能或缺陷修复，不单独升版。

待接入信息为公司 OIDC 非敏感配置路径/issuer/客户端 ID/回调及目标预览 origin/证书信任配置；秘密继续由环境或被忽略文件注入。正式实例的最小权限、维护责任人与接入回执仍待确认。已有本机三存储证据可审阅，剩余两项保持未完成，完整 G2 未放行。未 merge、push 或改动其他 G2 工作树。
