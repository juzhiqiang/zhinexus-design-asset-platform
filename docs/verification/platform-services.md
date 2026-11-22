# 平台服务与集成验证汇编（T04–T08、T11/T12）

> 本文件由 `docs/verification/` 下 33 篇逐次验证记录合并而成（2026-11-22，`chore/docs-consolidation` 分支）。原件已按主题合并删除，git 历史可追溯；每篇原记录以 `### <原文件名>` 为标题完整保留于「逐条合并记录」。总索引见 `docs/README.md`。

## 终态结论

**T04：CLI 本地校验与发布材料闭环。** `component check [--framework vue|react|all] [--staging-dir <dir>]` 入口 + 工作区外干净消费者 `window.__COMPONENT_EXAMPLE__` 协议（ready/states/runState/getChecks）+ Playwright 确定性截图（800×400、deviceScaleFactor 1、zh-CN、Asia/Shanghai，30s `READY_TIMEOUT`、`PAGE_ERROR`）+ 环境签名 `environmentKey`（规范化 JSON 的小写 64 位十六进制 SHA-256）+ `CheckReportV1` 绑定 `packageSha256`。窄测 8/8、浏览器 3/3、集成 6/6、`verify.ps1` Vitest 16 文件 208 用例 + Playwright 18 用例，`Bootstrap verification passed (not full T01 acceptance).`；CLI 升 `0.0.2`。随后 `t04-t06-release-registry` 把范围扩展到 line/bar/pie/scatter × Vue/React 共 8 变体的完整发布材料、真实 Vite 静态预览（`bundleDir/preview/${variantId}/`）、`release`/`status`/`resume` 与 `.release-session.json` 幂等续传、`SOURCE_DATE_EPOCH: '1700000000'` 确定性打包与 LF 归一化、`RegistryClient`（`already-identical`/`CONFLICT`/`candidate-<jobId>`→`latest`）与 `worker.advanceRelease`（`PENDING`→`PUBLISHING`→`READY`）；`cli-bundle` 3 用例、`cli-release` 1 长跑（`http://127.0.0.1:14873/` 精确安装 `@company/charts-vue@0.0.4`，`VERDACCIO_INSTALL_VERIFIED_SUCCESS`）、`tests/integration` 9 文件 246、`verify.ps1` 468 + 71、`test:platform` 18 文件 62，CLI 升 `0.0.4`，5 项验收标准全达成。终态：T04 交付闭环完整，但 8 变体随后被 10 实现（SDK 0.0.5）、14 实现（SDK 0.0.10）取代，固定端口 14873 后被随机端口 `createRecoveryStack()` 取代。

**T05：平台 HTTP / 认证 / 产物校验 / registry 修复。** 四个子任务并行后在 `t05-final` 收口：

- `t05-auth`：`OidcVerifier` 失败关闭（jose `6.2.17` 仅 RS256/ES256，JWKS 5s 超时/5min 缓存/30s 冷却，`redirect: manual`），角色 `requireRole` 三级；测试 1 → 37/60(97) → 97/97 → 101/101 → **103/103**，根 `test` 19 文件 330。
- `t05-artifact-validation`：`validateUploadedArtifact`/`validatePlatformBundle` 字节级 + ustar/PAX 归档安全 + 条件导出解析（Node 26.13.0 `--experimental-import-meta-resolve` 纯元数据探针实测），测试 54/54 → 93/93 → 98/98 → **107/107**；服务端不安装/不构建/不导入/不运行上传 JS。
- `t05-platform-http`：Nest 真 HTTP + OIDC、PG 摘要+advisory lock 迁移、审计与基线 revision 禁 UPDATE/DELETE、MinIO 5 MiB 分片 + complete 后条件写入冻结副本、租约/fencing、`LEASE_LOST`、真实 SDK 材料 1/1（13.67s）登记 4 个 PENDING；依赖固定 `pg 8.23.1`、`jose 6.2.17`、S3 `3.1167.0`、`tar-stream 3.2.2`、`pngjs 7.0.0`、`jpeg-js 0.4.4`。
- `t05-registry-fixes`：`003_evidence_references.sql` 把 report/screenshot ID 改服务端 UUID + `client_ref`（`(job_id, client_ref)` 唯一），`baselineCandidates` 仅 local-automatic，隐藏权限拒绝登记 `AUTH_DENIED`；RED 3 文件 5 败 1 过 → GREEN 7 文件 16。

`t05-final`：平台根/API `0.0.1`，分支 `feat/t05-platform`，合并提交 `42045c0`；`verify.ps1` 466 + 46、`test:platform` 8 文件 18、`test:infra` report `7b6790d4…`；主分支复验遇 `.tools/bin/pnpm.cmd` 缺失（457 过、9 消费者未执行）与 `.tools` 目录丢失（18 项凭据失败，轮换本地测试密码后 report `f8a89f45…`）。终态：T05 平台能力（认证/上传/冻结/发布登记/基线 CAS/审计）本地全通；公司 OIDC 登录/PKCE/撤权、独立预览域始终未验收，`infra:check-access` 恒 `oidc/preview=unconfigured`、`g2Ready=false`、退出 2。

**T06：发布 worker。** 分支 `feat/t06-release-worker`（基线 `6da7e1c`，平台根/API `0.0.2`）：迁移 004、PG 短事务认领 + 60s 租约/20s 续租 + fencing token + 5 次有界重试、MinIO 条件写入、注册表仅 HTTP 传原 tarball、公司依赖拓扑递归可达、Ready/outbox/tag 原子事务、默认 tag 取最高 Ready SemVer。验证：租约/迁移 4/4、注册表 HTTP 14/14、worker 恢复与 tag 12/12、`test:platform` 13 文件 35 项（55.14s / main 上 53.39s）、`verify.ps1` 480 + 46、`test:infra` report `fa2464b5…`。真实材料用 `t05-verified-sdk`（三个 0.0.2 tarball、四个 line/bar 实现），worker 遇不可达 registry 留 `ENSURE_PACKAGES/RETRY_WAIT` 后由新 worker 按同 jobId 到 Ready。独立审查 `6da7e1c..5a86a3a`：3 Important（peer 漏检、超时旧 tag 晚到、旧版本降级 latest）→ 修复 `57252f6`。合并提交 `4c48869`。终态：T06 可恢复三存储发布完成；已知限制：默认 tag 无外部 CAS（短暂偏离窗口）、Verdaccio 7.1.0 `normalizePackage` 在缺 latest 时合成最高版本 latest（无注册表层未 Ready 读隔离）。

**T07：目录与预览。** C 侧（`feat/t07-catalog-preview`，基于 main `3bbf687`）：公开/用户态目录、精确发布详情、材料与报告读取、持久化预览授权 + 独立 `preview-gateway`（grant 一次兑换、5 分钟期限不延长、DB 不存原始令牌、host-only Secure/HttpOnly Cookie、严格 CSP、脱敏拒绝审计）；`test` 25 文件 521、`test:platform` 18 文件 62、`test:browser` 71、build/typecheck `--force` 10/10 与 14/14 零缓存；独立审查 3 Important（Nginx 正则未引用、合法中文/扩展名资源被拒绝、variant/version 非唯一发布身份）修复后 `ca6e162`/`dae635a`/`3954a43` 复核通过；平台/API `0.0.3`、网关 `0.0.1`。B 侧（`t07-gallery-ui`）：React 19 + Next.js 16.4.6，`/components` 与 `/components/[slug]`（line/bar/pie/scatter，未公开 404）、状态看板四态正交、`sandbox="allow-scripts allow-same-origin"` iframe；`gallery-rendering.spec.ts` 6 项、`test:browser` 74、`test:platform` 18 文件 62。T07 在 main `617e967` 完成合并（`c-main-integration`，合并提交 `c737e8f`）。

**T08：网页上传（含硬化与回归）。** `t07-t08-gallery-upload`：五组件十实现 + `POST /v1/preview-grants` 授权预览 + `/upload` 未登录 noindex + 逐实现必检（`SCREENSHOT_REQUIRED`/`SCREENSHOT_VARIANT_MISMATCH`）+ 7 阶段步骤器；`manual-release` 5 项、`test:browser` 94、`web-handover` 5 项、`test:platform` 27 文件 87。`t08-real-web-upload`（工作区 `…-b`，基线 `885792b`，分支 `feat/t08-real-web-upload`）：7 组件 14 实现、废除 `dummyTarballSha`/`dummyPreviewSha`、Web Crypto SHA-256、`UPLOAD_LIMITS`（10MB 图/50MB tarball/500MB 总量/5000 文件）、六阶段时序持久化四键、multipart ETag；实测 MinIO `PutBucketCorsCommand` 501 但原生 OPTIONS 204 且暴露 `Etag`；真实 E2E 6 项（49.5s）走通 201→200→202→五阶段→READY，185 个产物文件直传，丢 202 恢复后 DB 仅 1 作业（幂等键 `web-1794551727694-xlx3hc8w`），坏 tarball `DIGEST_MISMATCH`；`web-upload-workflow` 15 项、`api-cors` 6 项、`manual-release` 8 项。`t08-web-upload-hardening`：网络副作用前 pending 重放（零新增 create/PUT/complete）、`TAMPERED_PENDING_RELEASE`、三元组 `(manifestDigest, apiUrl, subject)` 强隔离、四键彻底清理、`cancelled` 代际 + 提交前同步快照重验；`web-upload-workflow` **26 项**、E2E 6 项（39.5s）。回归侧：`c-web-upload-regressions` 用 B 旧 `cddf54b` 归档取 RED（8 恢复 UI 全败、3 handler 全败、摘要竞态 12 帧采样失败）；`c-web-upload-independent-snapshots` 逐轮取 GREEN（16:53 与 17:23 两套四文件 SHA 快照；PUT 185→186 的 RED、17:40 的 7/1、17:48 的 8/8、17:50 的 6/6、根 test 600 项）；`t08-web-upload-cross-review`（A 只读）钉死「14/14 GREEN 属 17:23 文件快照而非 Git 提交」并推动 3 项断言补强（合法导入正例、恢复错误码正则 `/(?:INVALID|CORRUPTED|TAMPERED)_PENDING_RELEASE/`、`createdApiUrls` 目标断言）。`c-b-gallery004-final` 在 B 最终 hash `1624fa3`（gallery 0.0.4，fix `d2f1fa7`）的独立归档上取终态：C UI 12/12、原 manual 8 + real 6 = 14/14、C 真实补充 2/2、`web-upload-workflow.mts` 14/14、单元 2 文件 32 项；**但根 test 为 32 文件 620 过 / 1 败（`cli-release.test.ts` 缺共享凭据），退出 1**。终态：T08 网页上传本地全通（含真实三存储与丢响应恢复），根套件那 1 项失败由 `c-cli-release-isolation` 与 `four-agent-merge-cleanup` 修复/复验；生产 OIDC SSO、独立可注册域物理隔离、多上下文草稿存储、WebCrypto reject 时 `isSubmitting` 忙等列为已知未覆盖边界。

**T11/T12：运维与试点。** `t11-t12-platform-operations`（分支 `feat/t11-t12-platform-operations`，从 main `617e967`）：白名单结构化日志、运维 token 保护的持久化指标（无 token 404 / 错 token 401 / DB 断连 503）、真实故障与进程中断恢复、三存储隔离备份恢复、只读一致性检查、部署模板、保留清单；`test` 29 文件 528、`rehearse:recovery` 19 项、`rehearse:backup` 1 项 28.93s（备份 226690 字节、恢复摘要检查 15509ms、协议包/实现 2/3、发布对象引用 14）、`test:platform` 23 文件 77、`test:browser` 71；根/API `0.0.4`、网关 `0.0.2`；独立审查 1 Important（一致性检查缺截图/报告登记完整性，4 类破坏先误报通过后修复共 5 项）+ 部署安全检查，修复 `5d6cc24`。`c-platform-capacity` 补容量首轮：目录 200 组件/400 实现 20 并发×10 轮 p95 84.45ms（复跑 72.40ms）、上传恢复 104,857,600 字节 / 20 个 5 MiB 分片 / 3.45s、发布阶段 p95 520.35ms（复跑 498.37ms）；`test:platform` 27 文件 87、`test` 31 文件 552、`test:browser` 89；根平台 `0.0.5`。`c-production-preparation` 交付 `preflight:production`（退出码 2/1/0，恒 `productionAcceptance:false`）与 `verify:service-staging`（API 8,405 文件/160 包、preview 7,966/141），窄测 29/29、根 test Node 138/138 + Vitest 733/733。终态：T11/T12 准备级交付完成，生产等量数据、RPO/RTO、200/400/20/p95 生产容量、100MiB 续传、告警送达、Linux 镜像与最小权限、真实双业务试点全部仍未验收；容量数字只代表本机合成样本。

**C 侧集成链终态。**

- `c-main-integration`（11-13）：main `89d2511` + C `dff271b` 无冲突合并 `8987f84`；build/typecheck `--force` 10/10 与 14/14 零缓存、`test` 30 文件 529、`test:platform` 23 文件 77（122.10s）、`test:browser` 74（15.6s）；合并提交 `c737e8f`；`globals.css` 未暂存状态与 SHA 全程保留。
- `c-cli-release-isolation`（11-13）：`cli-release.test.ts` 改随机 `createRecoveryStack()`，消除固定 14873 端口与共享凭据依赖；该文件 1/1（48.71s）、根 `test` 33 文件 600 项全过；根套件 620/1 的那 1 项由此关闭。
- `c-gallery-cors`（11-13）：API 读 `PLATFORM_GALLERY_ORIGIN`/platformOrigin，仅精确 HTTPS Origin（本机 localhost/127.0.0.1/[::1] 可 HTTP），方法 GET/POST/OPTIONS、头 Authorization/Content-Type/Idempotency-Key、暴露 `X-Request-Id`、不设 Allow-Credentials、预检 204、匿名发布仍 401；`api-cors` RED 4/2 → GREEN 6/6；`tests/unit tests/contracts` 20 文件 333。
- `c-image-atomic-review`（11-14）：`images.json` 由 `flag:'wx'` 改为同盘暂存 + 硬链接无覆盖原子发布；RED 1/8 → GREEN 2 文件 10/10；`test` 38 文件 693/693。
- `c-isolated-platform`（11-13~14）：平台专项改 Vitest globalSetup 内存 provide/inject 自建 `RecoveryStack`，去掉 15432/19000/14873 与共享凭据；`test:platform` 28 文件 88/88、`test` 38 文件 692/692、`rehearse:backup` 1/1、`rehearse:recovery` 2 文件 19/19、`verify:deployment` templateValidated=true；SDK 0.0.10 权威 Bundle 199 文件 14 实现 0 不匹配。
- `c-next-round-integration`（11-14）：集成 C+B 第一阶段后 `test` 38 文件 693/693、`test:platform` 28 文件 88/88（229.45s）、`test:browser` 195/195；A 探针从第二版 `CANDIDATE_INTEGRITY_UNVERIFIED`（`cp` 未排除 node_modules/dist/.turbo + npm mirror 源不一致）经第四/五版修到 `node --test` 117/117、`test:t10` 138/138；官方源真实矩阵：6.1.0 首轮 `PROBE_HOLD` → 显式 baseline 复验 `adopt`、**56/56 视觉 PASS**；6.0.0 strict/strict-only `PROBE_FAILED`、legacy 后类型失败仍 `PROBE_HOLD`；回退脚本一度 exit 1（`src/a-t10-echarts-registry.ts:9` Element/HTMLElement，TS2345/TS2740），第五版改 `element instanceof HTMLElement` 后原双消费者回退 `passed: true`、exit 0（ownership run ID `6d49c39c…`）；本地合 main 合并提交 `299f9b8393f844c2c0ddae4248b652604cabfb01`，main 复验 build/typecheck 20/20、`test` Node 138/138 + Vitest 42 文件 719/719、`test:browser` 195/195；锁文件 SHA `8001977F…`。
- `c-distribution-integration`（11-15）：真实安装包 CLI `0.0.8`（201,353 字节 / 183 文件，SHA `1f8188fc…`）自检 121/121；56 组合 hold→adopt；兼容 API `test:installed-compatibility` 1/1（201/409/400，199 个 artifact 核对）；根 test Node 166/166 + Vitest 46 文件 737/737（修复后 159+7 skip / 740/740）、`test:platform` 28 文件 88/88、`test:browser` 195/195、`pnpm deploy` API 8,422/160 与 preview 7,970/141、预检 27 变量缺失退出 2；审查七类问题全关，**Ready to merge: Yes**；main 合并 `2c3ec76e…`，主分支 test Node 166/166 + Vitest 46 文件 740/740。
- `c-next-round-integration`（11-16）：严格冻结副本 `next-sdk-handoff-zQIRda`（core 0.0.10 + Vue/React 0.0.11，manifest SHA `917f195a…`，199 文件）；已安装 CLI 0.0.10 对混合版本 **exit 1 `INVALID_BUNDLE_MANIFEST`**（「三个包版本必须一致，当前为: 0.0.10, 0.0.11」）；D 的 ID runner 合成演练 exit 1、`real=0`；只读集成审计确认 A/B/D 与 C 路径交集为空但内容有差异。
- `cli-0011-integration-repairs`（11-16）：CLI 接受独立版本、`bundle.version` 同版单值/异版按 manifest 顺序 `, ` 连接 `name@version`；API 从权威 manifest 重建聚合版本；`echarts-cli.test.ts` RED 2/9 → 11 passed，`compatibility-api.test.ts` RED 400 `REPORT_MISMATCH` → 1 passed；CLI 构建 exit 0、分发探针 73 文件。
- `rollback-sidecar-repairs`（11-16）：回退脚本从冻结包取期望版本、失败仍留双消费者与 `passed:false`；诊断移至 `${bundleDir}.acceptance.json`；`t10-rollback` RED 4 → 4 passed，`current-sdk` RED `UNEXPECTED_FILE` → 1 passed（59.80s）。
- `four-agent-merge-cleanup`（11-16）：A→B→D 合并提交 `0bdc450d`/`4ff9ef8e`/`9bc73d42`（起点 `b13c8aee`）；`test:t10` 168/168、B 专项 7 文件 70/70、`tests/evaluation` 6 文件 71/71、`test` T10 168/168 + Vitest 69 文件 **1107/1107**、`test:browser` **260/260**；失败均定位并修（旧读取器拒混合版本、Vue 动态导入 8688ms 超 5000ms 单独重跑 10/10、compat 夹具把 core 写成 0.0.11 致 400）；备份 bundle 2253289 字节（SHA `48244343…`）+ 403 个受保护文件复核一致；**工作树清理被 `blocked by policy` 两次拒绝、`attach_worktree` 返回 `This worktree is owned by another task.`，三处历史工作树未删除**。
- `next-round-final-gates`（11-16）：基线 `f9555bc1` 全图绿——build 10/10、typecheck 14/14 + 根 tsc、`test` T10 168/0/0 + Vitest 70 文件 **1113 项**、`test:browser` **260**；浏览器首跑漏 `ZHINEXUS_SDK_BUNDLE_DIR` 得 254/2/4 `MISSING_ENV`，补齐后重跑；独立审查 1 Important（ID 交接文档缺 design/context）已改为完整 JSON 并经 `validateMatchPlanRequest` 验证；升 **CLI 0.0.11、API 0.0.8**，根整体版本维持 `0.0.5`。
- `c-platform-acceptance`（11-16）：C 基线复验 `verify:workspace` exit 0、API/网关 build+typecheck 5/5 3.649s、平台 13 文件 57 测试 58.01s、`test` Vitest 62 文件 **1041 项**（前置 T10 Node 159 过 7 跳 0 败）、preflight exit 2（27 变量）、`infra:check-access` exit 2；栈标识 `4a9b57a0-9499-4d8a-a769-6e0427eb242a`。

**仍开放的生产闸门。**

1. **外部身份与域名**：公司 OIDC 登录/PKCE/撤权、真实 HTTPS JWKS、独立预览注册域 DNS/TLS、目标浏览器第三方 Cookie 策略——`infra:check-access` 恒 `oidc/preview=unconfigured`、`g2Ready=false`、退出 2；JWKS 缓存旧公钥最多 5 分钟，即时撤权未验证。
2. **生产镜像与部署**：Linux 镜像实际运行、最小权限/供应链、告警送达、生产等量容量与备份 RPO/RTO——`preflight --environment` 恒 exit 2（27 个必填变量缺失），`productionAcceptance` 恒 false；`verify:deployment` environmentValidated=false。
3. **容量**：200 组件/400 实现/20 并发/p95 与 100MiB 续传只在本机合成样本实测（p95 目录 72.40–84.45ms、发布 498.37–520.35ms），非生产承诺；阶段 count/sum 不提供 p95。
4. **T10 兼容矩阵与回退**：已安装 CLI 的真实 56 组合 hold/adopt、ECharts 6.0.0 strict/legacy/rollback、`test:installed-compatibility` 在 `next-round-final-gates` 门禁里仍未以新候选实测；静态核对提示 API `compatibility/service.ts` 与 `evidence.bundle.version`（混合版本为 `name@version` 文本）比较可能仍致 `REPORT_MISMATCH`，未动态验证。
5. **工作树清理**：A/B/D 三处历史工作树（`t13-a-eval`/`t13-b-match-ui`/`t13-d-eval-pipeline`）因工具策略 `blocked by policy` 与 `This worktree is owned by another task.` 未删除，需原聊天归档入口或允许删除的环境。
6. **T08 已知前端边界**：`handleSubmitRelease` 最终 `validateUploadFiles` 的 await 在后续 try/finally 外，极端 WebCrypto reject 可能令页面停留提交忙碌；localStorage 单 pending/active/draft 模型不支持多 API/subject/digest 上下文并存。
7. **T13/T14 与业务试点**：真实设计 ID 规则/导出/独立标注、Vue/React 双真实业务试点、上游视觉人工设计验收（56 张自动比对不等于全量人工设计验收）、完整 G2/M2 均未完成。
8. **注册表层读隔离**：Verdaccio 7.1.0 `normalizePackage` 在缺 latest 时合成最高版本 latest，平台不提供注册表层未 Ready 读隔离；目录/推荐必须按平台 Ready 控制。

## 逐条合并记录

### t04-cli-check-2026-11-12.md

- **日期／角色／主题：** 2026-11-12；角色 B（CLI / 画廊 / 本地验证）；主题 T04 第二批：`component check` 本地闭环验证。
- **目的：** 实现 `component check` 本地验证命令入口、双框架干净消费者外部安装、确定性截图采集、环境签名计算与合法 CheckReportV1 报告生成，并与同一冻结 tarball 强绑定。
- **承重事实：**
  - 命令入口：`packages/component-cli/src/commands/check.ts` 与 `cli.ts`；`component check [--framework vue|react|all] [--staging-dir <dir>]`；默认双框架全量检查；参数异常退出码 1。
  - `@company/component-cli` 脱离骨架按语义化版本升级至 `0.0.2`，同步 `CHANGELOG.md`。
  - `packages/component-cli/scripts/sync-contracts.mjs`：构建期把 contracts 校验、schema 与核心类型内联到 `src/contracts/` 并编译；公开包运行时不依赖私有 `@company/contracts`。
  - `tests/consumers/vue`、`tests/consumers/react` 实现 `window.__COMPONENT_EXAMPLE__` 协议：`ready`（等待 `document.fonts.ready`、容器 `width > 0 && height > 0`、ECharts 实例就绪）、`states`（`['default']`）、`runState(name)`、`getChecks()`（`single-instance`、`no-page-error`、`valid-dimensions`、`fonts-ready`、`series-rendered`）；监听全局 `error` / `unhandledrejection`。
  - `packages/component-cli/src/local/capture.ts`：Playwright Chromium 无头、固定配置视口 800x400、`deviceScaleFactor: 1`、`locale: zh-CN`、`timezone: Asia/Shanghai`；超时默认 30s 抛 `READY_TIMEOUT`；遇 `pageerror` 抛 `PAGE_ERROR`。
  - `src/local/environment.ts`：生成 `EnvironmentV1`；`environmentKey` = 规范化 JSON 序列化的小写 64 位十六进制 SHA-256。
  - `src/local/report.ts`：生成 `CheckReportV1`，强绑定 `packageSha256`；首轮无视觉基线时 `baselineResult` 固定为 `NEW`；产物存 `reports/<id>.json` 并通过 `validateCheckReport`。
  - `tests/unit/release-fingerprint.test.ts`：**8/8 通过**（含 `pack_mutation_invalidates_report`、`font_or_os_mismatch_is_incompatible`、`engine_upgrade_compares_existing_baseline`、`page_error_fails_even_with_screenshot`）。
  - `tests/browser/capture-ready.spec.ts`：**3/3 通过**（正常驱动就绪、页面错误强制拒绝、就绪超时失败退出）。
  - `tests/integration/cli-check.test.ts`：**6/6 通过**（参数校验、Vue/React 独立验证、`--framework all` 端到端、tarball 篡改拒绝退出）。
  - `.\scripts\verify.ps1`：`pnpm install --frozen-lockfile` 通过；`verify:workspace` 10 成员、无环、4 公开包无私有运行时依赖；Turbo build 10 包；typecheck 14 任务 + 根 tsc；**Vitest 16 文件 / 208 用例**；**Playwright 18 用例**；输出 `Bootstrap verification passed (not full T01 acceptance).`。
- **结论与状态：** 完成（T04 第二批本地闭环）；Bootstrap 通过但明确非完整 T01 验收。被 `t04-t06-release-registry-2026-11-12.md` 扩展为完整发布材料闭环。
- **交叉引用：** `t04-t06-release-registry-2026-11-12.md`（后续，覆盖 T04 完整材料）；`tests/fixtures/releases/t05-verified-sdk/`（后续固定样本，见 t05-final）。
- **过时或矛盾点：** `baselineResult` 固定 `NEW` 为占位实现（像素对比、基线接受与恢复在后续任务实施），非最终行为。

### t04-t06-release-registry-2026-11-12.md

- **日期／角色／主题：** 2026-11-12；角色 B（CLI / 画廊 / 本地验证）+ C 协助（注册表与发布适配器）；主题 T04 完整发布材料与 T06 注册表适配发布闭环。
- **目的：** 覆盖折线/柱状/饼图/散点四组件双框架全量 8 变体的实现截图、报告、API 元数据、文档与真实静态预览，并打通 release/status/resume 与 Verdaccio 注册表幂等发布。
- **承重事实：**
  - 8 个变体：`line-vue`、`line-react`、`bar-vue`、`bar-react`、`pie-vue`、`pie-react`、`scatter-vue`、`scatter-react`。
  - `packages/component-cli/src/local/manifest.ts` 生成 API JSON 元数据（`LineChartConfig`、`BarChartConfig`、`PieChartConfig`、`ScatterChartConfig`）与文档 Markdown，纳入 `ReleaseManifestV1`。
  - 真实静态预览：工作区外干净消费者安装冻结产物后执行 `npm run build`（Vite）；多页产物 `index.html`、`bar.html`、`pie.html`、`scatter.html` 及 `assets/*` 复制到 `bundleDir/preview/${variantId}/`；登记 `example.previewFiles` 与 `manifest.files`；通过 T05 `validatePlatformBundle`。
  - `src/local/release.ts` / `cli.ts` 新增 `component release` / `component status` / `component resume`；`.release-session.json` 持久化；`manifestDigest` 未变则复用 `idempotencyKey`、`uploadSessionId`、`jobId`。
  - `apps/api/src/releases/registry-client.ts` 与 `worker.ts`：`g2publisher`（发布）/`g2reader`（读取核对）凭据与动态 Token；`ensurePackage` → `already-identical` / `CONFLICT` / `candidate-<jobId>` 临时标签 `npm publish`；`promoteDistTag` → `latest`；`checkAvailability` 校验拓扑依赖（`charts-core` 必须先于 `charts-vue`、`charts-react` 就绪）；`worker.advanceRelease`：`PENDING` → `PUBLISHING`（`ENSURE_PACKAGES` → `CHECK_AVAILABILITY`）→ `READY`，租约 + fencing token 乐观并发，审计日志。
  - `src/local/pack.ts` 执行 `pnpm pack` 时注入 `SOURCE_DATE_EPOCH: '1700000000'`；`packages/charts-react/scripts/copy-style.mjs`、`packages/charts-vue/scripts/build.mjs` 复制 `style.css` 时 `replace(/\r\n/g, '\n')` 统一 LF。
  - `tests/integration/cli-bundle.test.ts`：**3 用例通过（16.6s）**（8 变体材料、自包含 Vite 静态预览、`validatePlatformBundle` 接受、缺图/错配框架报错阻断）。
  - `tests/integration/cli-release.test.ts`：**1 个综合长跑用例通过（~27s）**；`.npmrc` 作用域注册表 `@company:registry=http://127.0.0.1:14873/`；`npm install` 精确拉取 `@company/charts-vue@0.0.4`；输出 `VERDACCIO_INSTALL_VERIFIED_SUCCESS`；DB 校验 `variant_releases` 中 Availability `Ready` ≥ 8、`package_releases` 中 `READY` ≥ 3。
  - `tests/integration` 全量：**9 文件 / 246 测试通过**。
  - `.\scripts\verify.ps1`：build 10/10、typecheck 10 包、**test 24 文件 / 468 测试**、**test:browser 71 用例**；`Bootstrap verification passed`。
  - `.\scripts\pnpm.ps1 test:platform`：**18 文件 / 62 用例通过**（真实 PostgreSQL 迁移、MinIO S3 不可变上传、NestJS 会话与分片、发布作业原子持久化、基线 CAS、所有权审计、注册表适配器）。
  - `@company/component-cli` 从 `0.0.3` 升级至 `0.0.4`，`CHANGELOG.md` 记录。
  - 验收标准表 5 项全部「达成」：SDK 完整 Bundle 被 T05 接受、真实静态预览沙箱运行、上传恢复沿用原摘要与幂等键、查到 Ready、从注册表精确安装并安全运行。
- **结论与状态：** 完成。由 `c-platform-capacity-2026-11-13.md`（SDK 0.0.5 十实现）与 `t07-t08-gallery-upload-2026-11-13.md`（五组件十实现）继续扩展变体数量。
- **交叉引用：** `t04-cli-check-2026-11-12.md`（前序）；`t05-platform-http.md`、`t05-artifact-validation.md`（服务端校验）；`t06-release-worker-2026-11-12.md`（worker 落地）。
- **过时或矛盾点：** 端口 `14873` 为共享/固定端口依赖，后由 `c-cli-release-isolation-2026-11-13.md` 改为随机端口 `createRecoveryStack()`。

### t05-artifact-validation.md

- **日期／角色／主题：** 2026-11-12；角色 C 的 validator 子任务；主题 T05 上传产物字节校验（独立 validator 工作树）。
- **目的：** 在服务端对上传产物做真实字节级、归档安全与协议拒绝校验，不安装/不执行上传代码。
- **承重事实：**
  - 基线 `6508157`；测试依赖收口提交 `25726eb` 在本工作树为 `a60c89f`。
  - `validateUploadedArtifact(path, bytes)`：安全逻辑路径、真实 PNG/JPEG 解码、**10 MiB / 8192 边长**上限、MIME 与扩展名一致、拒绝图片尾随数据；文本须有效 UTF-8；JSON 限制 **1 MiB / 32 层**；其他静态二进制返回 `application/octet-stream` 且不执行内容。
  - `validatePlatformBundle(manifest, files, authenticatedChannel)`：按实际材料执行 **50 MiB 单文件 / 500 MiB 总量 / 5000 文件**上限；认证客户端来源与 manifest 不符返回 `SOURCE_FORBIDDEN`，不改写客户端材料。
  - gzip 输出经 zlib `maxOutputLength` 限制为 **200 MiB**，随后只读内存 ustar/POSIX PAX；拒绝绝对路径、穿越、Windows 分隔符/ADS/设备名/非法字符、NFC/大小写碰撞、文件与目录碰撞、软/硬链接、特殊项、非法校验和/填充/尾部；支持安全 Unicode PAX 路径，拒绝全局 path/size、未知覆盖字段、GNU long/sparse；未写出解包目录。
  - 真实 `package.json` 的名称/版本/dependencies/peerDependencies 必须与 manifest 完全一致；所有 exports 目标必须留在包内且存在；逐实现 export 必须有 `.js/.mjs/.cjs` 运行时目标；仅根导出的 core 包无需伪造 VariantRef；子路径通配符失败关闭。
  - 报告内独立 ScreenshotRef 仅接受 PNG/JPEG；SVG 可作浏览器静态预览资源；PNG 进 pngjs 前按精确像素流长度限制解压（含 Adam7 分支）；JPEG 先查 frame 尺寸再启用解码器内存上限。
  - 服务端只核对已构建文件字节、包元数据与声明导出存在性；**不安装、不构建、不导入、不运行上传的 JavaScript**。
  - 测试 helper `tests/fixtures/t05-artifacts.ts` 导出 `createValidBundle(channel = 'web')`，异步返回 `{ manifest, files, reports }`。
  - RED→GREEN：初轮 45 项中 **42 项预期失败**；第二轮 53 项中 **4 项预期失败**（报告独立 SVG、Windows `COM¹`、管道符、星号路径），修复后 **53/53**；第三轮 **54/54**。
  - 固定工具链 Node `26.13.0` / pnpm `12.18.0`。
  - 命令表：`install --frozen-lockfile` 成功；`--filter @company/contracts build` 成功；`--filter @company/platform-api build` 成功；`typecheck` 成功；`tsc -p tsconfig.json --noEmit` 成功；`exec vitest run tests/integration/upload-validation.test.ts` **54/54**；`verify:workspace` 10 成员；`turbo run build --force` **10/10、0 缓存命中**；`test` **19 文件 280/280**（在最后一个运行时导出回归加入前执行）。
  - `--force` 与 `--cache` 同时传入被 Turbo 拒绝，改为单独 `--force`。
  - 原始架构文档 SHA-256：`e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`（未修改）。
  - **模块审查返工（原实现提交 `bb6683d`）**：移除固定 15 个图表名称表，改为所有声明的 JS 运行时子路径默认要求对应 VariantRef（含 `./custom-chart`、`./charts/line` 及条件分支中的 JS 目标）；拒绝 tarball 出现 `optionalDependencies`/`bundledDependencies`/`bundleDependencies` 与任意层级隐藏 `node_modules`；私有包集合按固定 10 成员架构列出；条件导出解析（Node ESM `node/node-addons/module-sync/import`，生产浏览器 ESM `browser/module/production/import`，各自含 `default`），对象命中 null 阻断后续 fallback，数组跳过 null/undefined 后选首个有效字符串；MIME 查询改 `Object.hasOwn`，`asset.constructor`/`asset.__proto__` 返回 `application/octet-stream`。
  - 返工 RED：92 项中 **28 项失败**；使用 Node `26.13.0` `--experimental-import-meta-resolve --input-type=module` 纯元数据探针（每组独立临时 package 路径，无安装、无导入）实测 6 组 exports 目标解析结果（`{import:null,default}`→`ERR_PACKAGE_PATH_NOT_EXPORTED`；`{default,import:null}`→`line.js`；`{onlyUnknown}`→`ERR_PACKAGE_PATH_NOT_EXPORTED`；`{'0':…,import:…}`→`ERR_INVALID_PACKAGE_CONFIG`；`{import:[null,'./line.js']}`→`line.js`；`{import:{unknown},default}`→`line.js`）。返工后 **93/93**。
  - **条件数组回退与 core 根入口复审（reviewer 针对 `0ecef74`）**：再测 5 组（`{import:[],default}`→`ERR_PACKAGE_PATH_NOT_EXPORTED`；`{import:[null],default}`→同；`{import:[{onlyUnknownCondition}],default}`→`line.js`；`{import:[null,{onlyUnknown}],default}`→`ERR_PACKAGE_PATH_NOT_EXPORTED`；`{import:[{onlyUnknown},null],default}`→`ERR_PACKAGE_PATH_NOT_EXPORTED`）；数组 null/undefined 不合并；RED 为 98 项中 1 项预期失败 → GREEN **98/98**；core 根入口 8 个反例 RED 为 107 项中 8 项失败 → 最终 GREEN **107/107**。
  - 返工后命令：`platform-api build` 成功；`upload-validation.test.ts` **93/93**（数组回滚轮）/**107/107**（最终）；`typecheck`、`tsc --noEmit`、`git diff --check` 均通过。
- **结论与状态：** 完成（T05 字节校验子任务）。被 `t05-registry-fixes.md`（引用与审计）、`t05-platform-http.md`（真实 HTTP/存储链路）补充；`c-platform-acceptance-2026-11-16.md` 复验平台整体。
- **交叉引用：** `t05-auth.md`、`t05-platform-http.md`、`t05-final-2026-11-12.md`、`t05-registry-fixes.md`；`tests/integration/upload-validation.test.ts`；`tests/fixtures/t05-artifacts.ts`。
- **过时或矛盾点：** 「最终 54/54」仅对首轮范围，返工后为 107/107；引用时须说明轮次。

### t05-auth.md

- **日期／角色／主题：** 2026-11-12；角色 C 的认证子任务；主题 T05 OIDC 验证与角色授权。
- **目的：** 实现失败关闭的 OIDC JWT/JWKS 验证器与角色策略，并以真实密码学测试取证。
- **承重事实：**
  - 基线 `6508157`；主代理测试依赖提交 `25726eb` 在独立工作树应用为 `b971384`。
  - `apps/api/src/auth/oidc.ts` 导出 `Principal`、`OidcConfig`、`AuthFailure`、`OidcVerifier`；`verify(authorization)` 仅接受经签名、issuer、API audience、有效期与客户端验证的 Bearer JWT。
  - 配置 issuer/JWKS 必须 HTTPS；拒绝 user-info、query、fragment 和空/重叠/重复客户端集合；保留 issuer 原始精确值；复制配置防止调用方改授权集合。
  - jose `6.2.17` 只允许 RS256 / ES256；要求 `exp`/`sub`/`iat`；拒绝过期、未来 `nbf`/`iat`、空 subject、非有限 NumericDate、混合类型 audience；拒绝 payload 篡改、错误签名、未知客户端、冲突 `azp`/`client_id`。
  - 入口 channel 只由可信 `azp`/`client_id` 决定；角色只消费已验证 roles 数组，缺省/空数组不授权，未知/畸形角色拒绝；scope/channel 不能增权。
  - Remote JWKS：**5 秒超时、5 分钟缓存、30 秒刷新冷却期**；jose 用 `redirect: manual` 并拒绝非 200；上游错误/token/配置值不进入对外错误消息。
  - 无 OIDC 配置允许创建验证器但所有 verify 拒绝；公钥解析器注入仅作程序化测试接口，无运行时禁用签名/认证的开关。
  - `roles.ts` `requireRole`：read = reader/publisher/maintainer；upload = publisher/maintainer；baseline/deprecate = maintainer。
  - RED→GREEN：第 1 次 1 断言失败（无编译产物）；写最小接口后 **37 failed / 60 passed（97 tests）**；实现后 **97/97**；补充 NumericDate 溢出与混合 audience 后 **4 failed / 97 passed（101 tests）**；修复后 **101/101**；补 JWKS 缓存撤键与拒绝重定向回归后最终 **103/103**。
  - 命令表（均经 `scripts/pnpm.ps1`，Node 26.13.0 / pnpm 12.18.0）：`install --frozen-lockfile` 退出 0；`contracts build` 0；`platform-api build` 0；`typecheck` 0；根 `tsc` 0；`verify:workspace` 0（10 成员）；`exec vitest run tests/integration/auth.test.ts` **103 tests passed**；`test` **19 files / 330 tests passed，54.27 秒**；`git diff --check` 0。
  - 原始架构 SHA-256 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
- **结论与状态：** 完成（认证子任务）；不标记完整 T05/G2。被 `t05-platform-http.md`、`t05-final-2026-11-12.md`、`c-gallery-cors-2026-11-13.md` 扩展。
- **交叉引用：** `t05-artifact-validation.md`、`t05-platform-http.md`、`t05-final-2026-11-12.md`、`c-gallery-cors-2026-11-13.md`。
- **过时或矛盾点：** JWKS 缓存允许旧公钥最多 5 分钟，即时撤权未验证（明确列为未覆盖）。

### t05-final-2026-11-12.md

- **日期／角色／主题：** 2026-11-12；角色 C；主题 T05 本地交付与合并验证。
- **目的：** 记录 T05 平台本地开发完成范围、实施决定、提交清单与本地 main 合并及复验。
- **承重事实：**
  - 实现分支 `feat/t05-platform`；按用户授权提交并合并本地 main，不 push；平台根版本与 platform-api 为 `0.0.1`。
  - 完成范围：OIDC JWT/JWKS 认证与可信客户端来源、组件/npm 包权限、PostgreSQL **三次向前迁移**、真实 MinIO 单文件/分片上传与冻结、发布幂等登记/读取/重试、基线 CAS、Ready 版本废弃、不可变审计；合法作业只登记 PENDING。
  - `$env:TURBO_FORCE='true'; .\scripts\verify.ps1`（合入 main `c5329d3` 的 T09 后）退出 0：build 10/10、typecheck 14/14、**Vitest 23 文件 / 466 用例**、**Playwright 46 用例**。
  - `test:platform` 退出 0：真实 PG/MinIO，**8 文件 / 18 用例**（含历史真实材料重放与当前 SDK 漏 pie 拒绝）。
  - `test:infra` 退出 0，report id `7b6790d48aa241e7b4dcea9fae123cf0`。
  - `infra:check-access`：oidc/preview=unconfigured，g2Ready=false；业务脚本退出 2、pnpm 包装进程退出 1。
  - Git Windows 检出冻结样本：显式 `core.autocrlf=true` 的 `checkout-index` 后 23 个文件长度/SHA-256 全部匹配。
  - 日志：`.tools/t05/full-after-pie.log`、`platform-after-pie-final.log`、`infra-final.log`。
  - SDK 0.0.2 产物安装/截图/API 上传证据存 `tests/fixtures/releases/t05-verified-sdk/README.md`；0.0.3 漏 pie 经本地 CLI/干净消费者/Chromium 后被 API 拒绝，不产生 Ready 或作业。
  - 实施决定 7 条：无公司 OIDC 时失败关闭 + 真实签名测试；复用 `SCREENSHOT_REQUIRED`/`SOURCE_FORBIDDEN` 错误码；上传完成另存服务器独占冻结对象（失败/过期尝试留未引用对象）；T05 只持久化 PENDING；客户端证据引用按 job 唯一；暂缓 complete 的 parts Map 优化（现有 JSON 8 MiB / 100k 节点边界，无生产并发容量承诺）；保留 0.0.2 样本并新增缺材料拒绝。
  - 主要提交：`6508157`/`f549341`；`1f2dadf`/`f567789`/`fc3d71d`/`c7010c6`；`ed74095`/`fcb92e1`/`83d63a6`/`9afaf56`；`5e40d5a`；`1609148`/`1b5592c`/`775261b`/`052f68e`；`1253ad8`（平台升 0.0.1）。
  - 合并提交 `42045c0`（`merge: 合并 T05 身份上传与基线平台`），保留 T09 饼图，无 push。
  - 首次主分支复验消费者准备阶段失败：`.tools/bin/pnpm.cmd` 缺失，457 用例通过、9 个消费者用例因准备失败未执行；执行 `bootstrap.ps1` 恢复后消费者专项 **9/9**；日志 `merged-full.log`、`merged-consumer-recheck.log`。
  - 恢复入口后 main `42045c0` 无缓存 `verify.ps1` 完整通过：build 10/10、typecheck 14/14、Vitest 466、Playwright 46；日志 `merged-full-after-bootstrap.log`。
  - 收尾中共享 `.tools` 的 `bin` 与 `g2-local` 目录丢失，平台复验出现 **18 项读取凭据失败**；先用容器本地连接备份 PG，再恢复忽略目录配置并轮换 PostgreSQL / MinIO / g2publisher / g2reader 本地测试密码，重启同一 Compose 项目；未重建/删除数据卷或已发布 npm 包；新配置 `.tools/g2-local/credentials.json`。
  - 恢复后 PG 数据库列表与 Verdaccio 文件摘要一致；MinIO 全目录摘要因内部元数据/新探针变化，但已有 `t05-*` 资产修改数 0；新变更仅在 `g2-probes` 与 `.minio.sys`；三存储写读、注册表权限/精确安装、重启与隔离备份恢复全部通过，最新 report id `f8a89f45a75e42908c715668f67ce7d5`（`infra-after-local-recovery.log`）。
  - 最终在 main `42045c0` 重跑 `test:platform`：**8 文件 / 18 用例，29.35 秒**（`merged-platform-after-state-recovery.log`）。
- **结论与状态：** 完成（T05 本地实现与 main 合并）。外部身份验收仍开放。被 `t05-platform-http.md`、`t05-registry-fixes.md`、`t06-release-worker-2026-11-12.md`、`t07-catalog-preview-2026-11-12.md` 继续推进。
- **交叉引用：** `t05-auth.md`、`t05-artifact-validation.md`、`t05-platform-http.md`、`t05-registry-fixes.md`、`t06-release-worker-2026-11-12.md`；`tests/fixtures/releases/t05-verified-sdk/`；`apps/api/README.md`。
- **过时或矛盾点：** 「457 通过」与「466」两组计数口径不同（首次复验缺 9 项消费者用例）。

### t05-platform-http.md

- **日期／角色／主题：** 2026-11-12；角色 C；主题 T05 平台 API 与真实存储验证。
- **目的：** 记录 Nest 真 HTTP + OIDC、PG 迁移、MinIO 上传/冻结、发布/基线 HTTP 业务流程的首轮真实集成证据。
- **承重事实：**
  - 基线 `6993e11`，功能分支 `feat/t05-platform`。
  - 边界：Nest 真 HTTP + OIDC 签名认证，subject/client/channel 只来自已验证 token；未配置 OIDC 时业务接口 401，healthz 仅表示进程存活；PG 迁移带摘要与 advisory lock；审计与基线 revision 禁止 UPDATE/DELETE；MinIO 单 PUT / **5 MiB 分片**；complete 逐文件校验实际字节、SHA-256 与格式后创建条件写入的冻结副本；发布只读冻结对象；上传完成带租约/fencing。
  - 发布同时校验组件与 npm 包权限；主体+幂等键绑定完整请求；事务登记 PENDING；包名+版本唯一，冲突不覆盖、不留部分记录。
  - 基线只接受已登记 `local-automatic` 候选及匹配成功报告；按 variant/example/environment 执行 CAS；废弃仅适用于已有 Ready 版本。
  - 每请求随机 requestId；错误不返回凭证、原始 SQL 或异常堆栈。
  - 集成首轮：contracts RED→GREEN（multipart 2 预期失败 → **149 通过**）；PG 迁移往返/唯一/FK/不可变 **1 通过**；MinIO 单/分片/缺片/重试/冻结不可覆盖 **1 通过**；HTTP upload RED→GREEN **3 预期失败 → 3 通过**；release **2 → 2**；baseline **2 → 2**；`vitest run --config tests/platform/vitest.config.ts` **5 文件 / 9 用例**。
  - 新增依赖精确版本：`pg 8.23.1`、`jose 6.2.17`、AWS S3 client/presigner `3.1167.0`、`tar-stream 3.2.2`、`pngjs 7.0.0`、`jpeg-js 0.4.4`；`minimumReleaseAgeExclude` 仅新增该 presigner 精确版本例外。
  - 分片与并发补充：**11 MiB** 真 MinIO 分片 HTTP，缺片/错 ETag/重复片均 **409**；测试层暂停 S3 read + 独立库推进租约过期，真实 HTTP 验证 `LEASE_LOST`；`tests/platform/uploads.test.ts` **5/5**。
  - 实际 SDK 材料：同步 main `9c355ca`（B 的完整 Bundle 生成入口）后 `real-artifacts.test.ts` **1/1（13.67 秒）**；3 份包、4 个实现完整提交到真实 Nest/PG/MinIO，登记 **4 个 PENDING** 实现，无 Ready。
  - 首份机器证据 `test-results/t05-real-c6baa495-5268-4975-8356-216fc7ae3464/evidence.json`，时间 `2026-11-12T05:01:30.536Z`。
  - main `c5329d3` 后 SDK 0.0.3 含 `./pie`，现有 CLI Bundle 只生成 line/bar，被 API 按实际导出覆盖规则拒绝；正向回归保留 0.0.2 Bundle 到 `tests/fixtures/releases/t05-verified-sdk`。
  - Playwright `test-results` 清理会移除早期忽略证据，后续证据改存 `.tools/t05/real-*`。
- **结论与状态：** 完成（首轮真实 HTTP/存储链路）。被 `t05-final-2026-11-12.md`（合并复验）、`t05-registry-fixes.md`、`t06-release-worker-2026-11-12.md`、`c-platform-capacity-2026-11-13.md` 更新。
- **交叉引用：** `t05-auth.md`、`t05-artifact-validation.md`、`t05-final-2026-11-12.md`、`t05-registry-fixes.md`、`t06-release-worker-2026-11-12.md`。
- **过时或矛盾点：** B 的 preview HTML 当时仍为占位，未宣称在线预览可用。

### t05-registry-fixes.md

- **日期／角色／主题：** 2026-11-12；角色 C；主题 T05 登记引用与隐藏权限审计修正。
- **目的：** 把报告/截图 ID 改为服务端 UUID + `client_ref`，并补齐隐藏权限拒绝审计。
- **承重事实：**
  - 基线 `f549341`，独立分支 `fix/t05-registry-references`。
  - `check_reports.id`、`screenshots.id` 改为服务端 UUID；原 bundle 引用存 `client_ref`，按 `(job_id, client_ref)` 唯一；新迁移 `003_evidence_references.sql` 在迁移事务内转换存量外键；001/002 不变；转换 baseline 外键时仅在事务内临时禁用其不可变触发器，完成后恢复。
  - GET 作业返回可选 `baselineCandidates`，仅含 `local-automatic` 来源；手动发布返回空列表。
  - 基线优先解析服务端截图 ID；旧引用仅在已授权的 variant/example/environment 中唯一时接受，多条匹配 **409 CONFLICT**；跨 variant 无匹配 **404**；显式服务端 ID 的 variant 不匹配 **400**；手动截图 **400 SOURCE_FORBIDDEN**。
  - 上传 subject/client/channel 不匹配、作业访问者无读取权限时对外继续 **404**，内部附授权拒绝标记由 `Platform.run` 统一登记 `AUTH_DENIED`；不存在的 ID 不伪造授权拒绝审计。
  - RED：`registry-references.test.ts` + `ownership-audit.test.ts` + `database.test.ts` → **3 文件、5 失败 / 1 通过**（升级版本复用引用 409、无 baselineCandidates、两处隐藏权限拒绝未审计、缺 `client_ref` 列）。
  - GREEN：`vitest run --config tests/platform/vitest.config.ts` **7 文件 / 16 用例**；根 `tsc` 首轮遇公共契约测试 TS2698，合入主代理独立修复 `c7d96ac` 后通过。
  - Windows 根类型检查须用 `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`，避免 PowerShell 把 `-p` 解释为脚本参数。
  - 存量测试从真实 001/002 建旧数据，经 `migrateRegistry` 应用 003 并重复迁移；空数据库三轮迁移/回滚仍通过。
  - 根/API 仍为 `0.0.0` 骨架阶段，本子任务不升版；未 push；架构 SHA-256 `E59BB77…`。
- **结论与状态：** 完成。被 `t06-release-worker-2026-11-12.md`、`c-platform-capacity-2026-11-13.md`、`c-platform-acceptance-2026-11-16.md` 覆盖回归。
- **交叉引用：** `t05-auth.md`、`t05-artifact-validation.md`、`t05-platform-http.md`、`t05-final-2026-11-12.md`。
- **过时或矛盾点：** 根/API 版本号（0.0.0 骨架）与 `t05-final` 的 0.0.1 属不同时点，非矛盾。

### t06-release-worker-2026-11-12.md

- **日期／角色／主题：** 2026-11-12；角色 C；主题 T06 本地发布执行器与恢复验收。
- **目的：** 实现可恢复的三存储发布 worker（租约/fencing/重试/原子 Ready/tag），并用真实 PG/MinIO/Verdaccio 验收。
- **承重事实：**
  - 分支 `feat/t06-release-worker`，基线 `6da7e1c`；平台根/API 版本 `0.0.2`。
  - 交付：向前迁移 **004**（作业重试预算/时间、缺失材料、不可变资源映射、outbox、独立 tag 待办）；PG 短事务认领、**60 秒租约 / 20 秒续租**、fencing token、**五次有界自动重试**与显式人工恢复，进程退出后任务仍在数据库；MinIO 私有资源条件写入与摘要核对；注册表**仅 HTTP 传输原 tarball，从不 install/build/执行脚本**；所有公司 dependencies/peerDependencies 的拓扑与递归可达性；包已存在或发布响应丢失时下载真实字节比较，同版本异摘要失败关闭；Ready/包/实现状态/审计/outbox/tag 目标原子登记；恢复 `READY_TX` 时重新核对全部文件、预览入口、包与公司依赖；默认 tag 选最高 Ready SemVer，串行协调并定期核对真实 latest。
  - 验证表：开工 `verify:workspace` 10 成员、`test:platform` 原 8 文件 18 项通过；租约/迁移 RED→GREEN **4/4**；注册表 HTTP 专项最终 **14/14**；新 worker 恢复与 tag 专项最终 **12/12**；`test:platform` 修复后 **13 文件 / 35 项，55.14 秒**；`$env:TURBO_FORCE='true'; .\scripts\verify.ps1` 退出 0（build 10/10、typecheck 14/14、**Vitest 24 文件 / 480 项**、**Playwright 46 项**）；`test:infra` 通过，report `fa2464b5fc014a97a76c227b63da0ec1`；`infra:check-access` 退出 2。
  - 日志：`.tools/t06-platform-final.log`、`t06-full-final.log`、`t06-infra.log`、`t06-access.log`、`.tools/t06/sdk-release-*.json`。
  - 真实材料：`tests/fixtures/releases/t05-verified-sdk/bundle`（三个 0.0.2 tarball、四个 Vue/React line/bar 实现的截图/报告原字节）；第一个独立 OS worker 在对象固化后遇不可达 registry 留下 `ENSURE_PACKAGES`/`RETRY_WAIT` 后进程退出；恢复连接后另起 worker 按同一 jobId/摘要继续到 Ready；从真实 Verdaccio 下载三包核对 SHA-256，并在工作区外分别安装 `charts-vue@0.0.2`、`charts-react@0.0.2` 及精确 core 依赖（只读注册表身份、`ignore-scripts`/`legacy-peer-deps`）。
  - 独立审查 `6da7e1c..5a86a3a`：无 Critical、**3 项 Important**、无 Minor；三项修复：①公司 peer 依赖漏检（新增排序/传递 peer 两项测试先失败）；②超时旧 tag PUT 晚到（真实 HTTP 延迟响应复现；修复后每 60 秒重检，失败 5 秒再试）；③旧版本晚 Ready 降级 latest（真实两作业乱序先得错误 0.0.1，改为事务中选最高 Ready SemVer 保持 0.0.2）。修复提交 `57252f6`。
  - 提交：`c01a915`（执行计划）、`0e38b34`、`705a865`、`28eaaf7`、`5a86a3a`、`cebedec`（升 0.0.2）、`57252f6`。
  - main 期间新增 `1161e03` 历史合并，树摘要与 `6da7e1c` 相同；另一任务把主工作区切到 `feat/t04-t06-release-registry` 并有 `capture.ts` 及两个消费者 `vite.config.ts` 未提交修改。
  - 干净隔离工作树合并提交 **`4c48869`**（`merge: 合并 T06 可恢复三存储发布执行器`）；合并树与 `87e9b16` 相同；另一工作区分支与三份文件 SHA-256 合并前后一致。
  - main `4c48869` 上 `test:platform` **13 文件 / 35 项，53.39 秒**；注册表 HTTP 专项 **14/14**。
  - 开工前把六份本地接入配置加密到 Windows 用户 LocalAppData 下 `Zhinexus/local-state-backups` 并验证可解密。
  - 实测 **Verdaccio 7.1.0** 的 `@verdaccio/store/build/lib/storage-utils.mjs` 中 `normalizePackage` 在缺 latest 时合成最高版本 latest；平台首次请求严格只含 candidate tag，但首包默认安装仍可能早于 Ready；当前范围不提供注册表层未 Ready 读隔离。
- **结论与状态：** 完成（T06 C 本地实现、版本升级与本地 main 合并）；未 push、未归档共享工作树、未删除服务数据卷。被 `t07-catalog-preview-2026-11-12.md`、`c-platform-capacity-2026-11-13.md` 等沿用。
- **交叉引用：** `t04-t06-release-registry-2026-11-12.md`、`t05-final-2026-11-12.md`、`t07-catalog-preview-2026-11-12.md`、`c-isolated-platform-2026-11-14.md`。
- **过时或矛盾点：** 默认 tag 无外部 CAS，存在短暂偏离窗口（明确记为限制，非矛盾）；"3 项 Important" 未派第二轮审查（自行修正 + 完整回归）。

### t07-catalog-preview-2026-11-12.md

- **日期／角色／主题：** 2026-11-12；角色 C；主题 T07 C：目录、报告与隔离预览验证。
- **目的：** 实现公开/用户态目录、精确发布详情、材料与报告读取，以及持久化预览授权与独立静态网关。
- **承重事实：**
  - 分支 `feat/t07-catalog-preview`，基于 main `3bbf687`；Windows x64，Node 26.13.0 / pnpm 12.18.0。
  - 公开端点固定 public-only；私有端点需 OIDC 角色及组件权限；默认 private，Ready/报告来源/当前基线/索引状态分开；推荐以目录 `variantReleaseId` 读取完整档案；同实现同版本换包名产生歧义时旧别名查询返回 CONFLICT。
  - 预览仅允许当前实现声明的冻结静态文件；逐请求与存储读取后检查权限、Ready、撤销与到期；grant **一次兑换**，session 不延长 **5 分钟**期限，数据库不保存原始令牌；host-only Secure/HttpOnly Cookie、严格 CSP、路径/长度/摘要检查、脱敏拒绝审计；网关不执行上传代码。
  - 验证表：`install --frozen-lockfile` 通过；`verify:workspace` 10 成员无环；`turbo run build --force` **10/10、0 cached**；`turbo run typecheck --force` **14/14、0 cached**；根 `tsc` 通过；`test` **25 文件 / 521 项**；`test:platform` 最终 **18 文件 / 62 项**；`test:browser` 最终串行 **71 项**；`contracts schemas:generate` 通过并新增 `variantReportsResponse`。
  - 本地 Chromium + PG/MinIO/Verdaccio 攻击样本：中文 `.HTML` 入口经真实上传冻结、发布、grant 兑换和网关；父站 DOM/存储、管理 API 请求、Service Worker、顶层跳转及撤权检查通过。
  - Nginx `-t` 通过；使用已存在镜像 `sha256:53a18edff8091d5faff1e42b4d885bc5f0f897873b0b8f0ace236cd5930819b0`，无生产部署。
  - 浏览器测试通过临时 **CONNECT 代理** 只把合成测试域转发到 loopback TLS；不修改全局 DNS/证书信任；303 后重定向不再匹配的问题最终由 CONNECT 保留完整真实 HTTP 跳转解决。
  - 第一次全浏览器回归与 `test:platform` 并行时后者重建 SDK 清空 dist，导致 `ssr_import_has_no_dom_access` 失败，其余 **70 项**通过；此后按顺序执行。
  - RED→GREEN：目录端点最初 **11 项因 404 失败** → 实现后迁移/目录 **14 项通过**；grant/网关最初 **11 项失败**、独立域配置 **8 项失败**；完整报告契约及 HTTP 端点各 1 项失败后通过。
  - 全图构建发现 CLI 固定内联清单不含 preview 模块，移动到 `@company/contracts/preview` 独立入口后 **10 项构建通过**。
  - 无配置网关历史 404 被误改为 405，被既有 bootstrap 测试捕获，恢复失败关闭语义。
  - 独立审查 **3 项 Important**：Nginx 正则未引用、合法中文/扩展名资源被拒绝、variant/version 并非唯一发布身份；分别用 Nginx 实际失败、策略 9 失败、两次真实发布后旧端点错误返回 200 复现，修复后通过。最终复核 `ca6e162`、`dae635a`、`3954a43` 均通过，无遗留 Critical/Important/Minor。
  - 中文入口浏览器测试验证 URL 安全编码；编码分隔符、双编码、穿越仍拒绝。
  - 拒绝审计 `audit_events` 不含 Host 原文/路径/凭证，**13 项**网关/浏览器回归通过。
  - 聚焦提交：`7b97697`、`6400ba6`、`6dc5d8a`、`3b14910`、`8548993`、`ca6e162`、`dae635a`、`3954a43`、`8c9eb3b`（平台/API `0.0.3`、网关 `0.0.1` 及 CHANGELOG）。
  - 版本以单独 `chore: 升级版本号至 0.0.3` 提交；SDK 0.0.4 及 CLI 0.0.3 不变。
  - 架构 SHA-256 `E59BB77…` 实测不变。
- **结论与状态：** 完成（T07 C 本地实现可交接）；完整 T07/G2/M2 保持开放；未 push、未生产部署；功能分支保留供后续合并（后由 `c-main-integration-2026-11-13.md` 在 main `617e967` 完成合并）。
- **交叉引用：** `t07-gallery-ui-2026-11-12.md`、`t06-release-worker-2026-11-12.md`、`c-main-integration-2026-11-13.md`、`t11-t12-platform-operations-2026-11-12.md`；`apps/api/README.md`、`apps/preview-gateway/README.md`、`docs/plans/2026-11-12-t07-catalog-preview.md`。
- **过时或矛盾点：** 浏览器样本是合成协议与恶意 HTML，不是 SDK 0.0.4 八实现渲染材料（明确边界）。

### t07-gallery-ui-2026-11-12.md

- **日期／角色／主题：** 2026-11-12；角色 B（CLI / 画廊 / 本地验证）；主题 T07 画廊前端 UI 与隔离预览交互。
- **目的：** 实现 React 19 + Next.js 16.4.6 App Router 的组件目录、详情、双框架切换、状态看板与沙箱 iframe 预览。
- **承重事实：**
  - `/components` 响应式卡片网格：中文名、英文名、分类、框架标签（Vue 3 / React 19）、`Ready` 状态、发布版本号；框架切换（全部/Vue 3/React 19）与即时搜索；无公开资产或后端离线时友好空状态并保留「公开组件目录正在建设中」合规提示。
  - `/components/[slug]` 动态路由覆盖 `line`、`bar`、`pie`、`scatter`；未公开/未知组件严格 404（`notFound()`）。
  - 状态看板正交分离：Availability `Ready`、Report Source `local-automatic`、Baseline Status `accepted`、Index Status `indexed`；包 `@company/charts-vue@0.0.4` / `@company/charts-react@0.0.4`；Apache ECharts `6.1.0`；Vue `3.5.45` / React `19.3.1`。
  - 预览 `<iframe className="preview-frame" sandbox="allow-scripts allow-same-origin" />`；顶部工具栏：实时就绪指示灯、独立域沙箱安全标识、800×400 视口指示、沙箱重新加载。
  - `tests/browser/gallery-rendering.spec.ts`：**6 项全部通过（3.9s）**（初始 HTML 内容与 metadata、console 占位 noindex 且不进 sitemap、详情路径在无公开目录前 404、line 详情渲染状态/框架切换/代码/iframe、bar/pie/scatter 详情、目录查看与筛选）。
  - `test:gallery-cache` 通过：`sitemap.xml` 严格匹配所选构建 Origin，无泄露私有管理路由。
  - `test:browser`：**74 个用例全部通过**。
  - `.\scripts\verify.ps1`：10 members、build 10 包、typecheck 10 包、**test 24 文件 / 468 测试**、browser 74；`Bootstrap verification passed`。
  - `test:platform`：**18 文件 / 62 用例**全绿。
- **结论与状态：** 完成。被 `t07-t08-gallery-upload-2026-11-13.md`（真实 API/授权预览）与 `c-b-gallery004-final-2026-11-13.md`（gallery 0.0.4）更新。
- **交叉引用：** `t07-catalog-preview-2026-11-12.md`、`t07-t08-gallery-upload-2026-11-13.md`、`c-b-gallery004-final-2026-11-13.md`。
- **过时或矛盾点：** 版本号 `0.0.4` 与 ECharts `6.1.0` 为该时点快照。

### t07-t08-gallery-upload-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 B（CLI / 画廊 / 本地验证）；主题 T07/T08 画廊真实服务接入与网页手动发布验证。
- **目的：** 画廊接真实 API/授权预览/精确版本命令，并实现 T08 网页手动发布、逐实现截图必检与任务跟踪。
- **承重事实：**
  - 分支 `feat/t07-t08-gallery-upload`；同步 main 纳入 C 的容量验收、SDK 0.0.5 与 `web-handover` 后端契约。
  - 覆盖五组件十实现（折线、柱状、饼图、散点、趋势卡片）。
  - 状态机：`FINALIZE_OBJECTS` → `ENSURE_PACKAGES` → `REGISTER_ASSETS` → `CHECK_AVAILABILITY` → `READY_TX` → `READY`。
  - 授权预览：`POST /v1/preview-grants` 获取短期 `bootstrapUrl` 注入 `sandbox="allow-scripts allow-same-origin"` iframe，提供独立窗口打开降级；`reportSource === 'manual-upload'` 时明示无本地自动化回归签名。
  - `/upload` 未登录渲染「登录后开放」且 `meta[name="robots"]` 输出 `noindex`；逐实现必检 `blocks_submit_when_any_variant_has_no_image`，缺图 `SCREENSHOT_REQUIRED`；框架错配 `SCREENSHOT_VARIANT_MISMATCH`；来源强制 `manual-upload` 与 `unknown-manual`；`/jobs/[jobId]` **7 阶段步骤器**与状态轮询。
  - `manual-release.spec.ts`：**5 passed（3.7s）**（未登录 noindex、登录后工作区与必检清单、缺图阻断、框架错配拦截、7 阶段步骤器）。
  - `test:browser`：**94 passed（14.4s）**。
  - `cli-bundle.test.ts`：**3 passed（19.3s）**；`cli-release.test.ts`：**1 passed（33.8s）**。
  - `tests/platform/web-handover.test.ts`：**5 passed（5.8s）**（durable idempotent manual release、rejects web missing-vue/react material、rejects wrong-framework、rejects automatic-source）。
  - `test:platform`：**27 文件 / 87 用例全部通过（180.82s）**。
  - `verify.ps1`：工作区 10 成员拓扑、依赖闭包、供应链锁定、全包 build、全量测试与浏览器测试全部通过。
  - 架构 SHA-256 `E59BB77…` 绝对一致。
- **结论与状态：** 完成（T07/T08 开发完成并通过自动化验证，准备合入 main）。被 `t08-real-web-upload-2026-11-13.md`、`t08-web-upload-hardening-2026-11-13.md`、`c-b-gallery004-final-2026-11-13.md` 更新。
- **交叉引用：** `t07-gallery-ui-2026-11-12.md`、`t08-real-web-upload-2026-11-13.md`、`t08-web-upload-cross-review-2026-11-13.md`、`c-platform-capacity-2026-11-13.md`；`component-platform-architecture.md`、`docs/plans/2026-11-11-three-person-allocation.md`。
- **过时或矛盾点：** 5 项 → 8 项 manual-release 用例数在本篇与 `t08-real-web-upload`/`hardening` 之间不同（后续新增恢复/替换截图/接口失败 3 项）。

### t08-real-web-upload-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 B（CLI / 画廊）；主题 T08 网页手动发布与逐实现截图必检收口 + 真实三存储端到端。
- **目的：** 用动态 7 组件 14 实现变体废除演示数据，落地真实文件校验、分片上传、幂等恢复，并在真实 Nest/MinIO/Verdaccio 走通发布到 READY。
- **承重事实：**
  - 独立工作区 `D:\project\zhinexus-design-asset-platform-b`；基线主干 `885792b`；分支 `feat/t08-real-web-upload`；随机端口独立 `RecoveryStack` 容器，测试结束自动销毁并清理临时目录；严禁修改或重启共享 G2。
  - **7 组件 14 实现**：`line`、`bar`、`pie`、`scatter`、`trend-card`、`ranking`、`proportion` × Vue 3 / React 19；废除写死 2 组件 4 实现演示数据与假哈希 `dummyTarballSha` / `dummyPreviewSha`。
  - 逐实现截图关联：比对 `shot.variantId === variant.variantId` 与 `shot.framework === variant.framework`；缺图 `SCREENSHOT_REQUIRED`，错配 `SCREENSHOT_VARIANT_MISMATCH`。
  - 浏览器端 Web Crypto API 计算真实 SHA-256；`UPLOAD_LIMITS`：单张截图 ≤ **10MB**（`imageBytes`）、单 tarball ≤ **50MB**（`tarballBytes`）、总大小 ≤ **500MB**（`totalBytes`）、总文件数 ≤ **5000**（`maxFiles`）；超限 `SIZE_LIMIT_EXCEEDED`。
  - `parseAndValidateImportedManifest`（强制 `channel: 'web'`，过滤未声明私有字段）；`#import-manifest-input`；`attachLocalFile` + `#import-files-input`；路径映射 `mf.path === normalizedPath || normalizedPath.endsWith('/' + mf.path) || (file.name.endsWith('.tgz') && mf.path.endsWith('/' + file.name))`；自动补齐扁平导入缺失的 preview 最小 HTML 并重算 SHA-256。
  - 分片上传：处理 `plan.multipart`，收集 `partNumber` 与 `ETag` 响应头，在 `POST /v1/uploads/:id/complete` 如实传 `parts`；失败立即终止抛错。
  - 六阶段时序持久化键：`zhinexus_upload_draft`、`zhinexus_active_session_id`、`zhinexus_pending_release`；网络中断重试严格复用原 `idempotencyKey`。
  - **MinIO S3 CORS 实测**：`PutBucketCorsCommand` 返回 HTTP **501 NotImplemented**；`curl -i -X OPTIONS http://127.0.0.1:19000/test -H "Origin: http://127.0.0.1:5173" -H "Access-Control-Request-Method: PUT" -H "Access-Control-Request-Headers: content-type"` → **HTTP/1.1 204**，`Access-Control-Allow-Credentials: true`、`Access-Control-Allow-Headers: content-type`、`Access-Control-Allow-Methods: PUT`、`Access-Control-Allow-Origin: http://127.0.0.1:5173`、`Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`；PUT/GET 响应原生含 `Access-Control-Expose-Headers: … Etag … X-Amz*`。
  - C 交付文件接入：`apps/api/src/app.ts`、`apps/api/src/platform.ts`、`apps/api/package.json`（0.0.5）、`tests/unit/api-cors.test.ts`；`galleryOrigin: 'http://127.0.0.1:5173'` 精确白名单，`['GET','POST','OPTIONS']`，头 `['Authorization','Content-Type','Idempotency-Key']`，严禁 credentials 与任意源。
  - `tests/unit/web-upload-workflow.test.ts`：**15 项通过（45ms）**；新增导入已有清单时期望摘要不可篡改，`DIGEST_MISMATCH` 严格阻断。
  - `tests/unit/api-cors.test.ts`：**6 项通过（178ms / 243ms，两处记录）**。
  - `tests/browser/web-upload-real-e2e.spec.ts`（`--workers=1`）：**6 项通过（49.5s）**；各用例耗时：真实全链路 13.5s、缺图阻断 485ms、框架错配 220ms、PUT 中断 633ms、丢 202 恢复 21.1s、摘要不可篡改 2.8s。
  - Happy path：`POST /v1/uploads` **201（246ms）**；浏览器直传 3 个 tarball 与 14 变体 **185 个产物文件**至 MinIO，全部 HTTP 200 带 ETag；`POST /v1/uploads/:id/complete` **200（3663ms）**；`POST /v1/releases`（固定 Idempotency-Key）**202（618ms）**；`FINALIZE_OBJECTS` 3820ms、`ENSURE_PACKAGES` 194ms、`REGISTER_ASSETS` 7ms、`CHECK_AVAILABILITY` 501ms、`READY_TX` 607ms；`release_jobs` 原子写 `READY`；Verdaccio API 带 publisher token 读 `@company/charts-core`/`charts-vue`/`charts-react` 均 HTTP 200。
  - 丢响应恢复：首次 release HTTP 202，jobId `ec7180a8-…`；本地持久化幂等键 `web-1794551727694-xlx3hc8w`；`SELECT id, idempotency_key FROM release_jobs WHERE idempotency_key=$1` 严格仅 **1 条**。
  - 摘要不可篡改：`company-charts-core-0.0.6.tgz` 字节翻转篡改；报错 `[DIGEST_MISMATCH] packages/company-charts-core-0.0.6.tgz: 文件哈希不一致`。
  - `manual-release.spec.ts`：**8 项通过（4.5s）**。
  - `verify:workspace` 10 members；`typecheck` 10 包 + 根 0 错误；`--filter @company/gallery build` Next.js Turbopack 0 错误。
- **结论与状态：** 完成（T08 真实网页发布收口）。被 `t08-web-upload-hardening-2026-11-13.md`（时序前置重放与竞态加固）、`c-b-gallery004-final-2026-11-13.md`（最终固定提交验收）更新。
- **交叉引用：** `t07-t08-gallery-upload-2026-11-13.md`、`t08-web-upload-cross-review-2026-11-13.md`、`t08-web-upload-hardening-2026-11-13.md`、`c-web-upload-regressions-2026-11-13.md`、`c-web-upload-independent-snapshots-2026-11-13.md`、`c-b-gallery004-final-2026-11-13.md`。
- **过时或矛盾点：** 端到端用本地 RSA-256 测试 Token，非公司 OIDC；预览域独立注册域隔离由专用测试保障，本篇未覆盖。

### t08-web-upload-cross-review-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 A（SDK）；主题 T08 网页上传链路只读交叉审查（A 侧）。
- **目的：** 对 C 在 `fix/c-sdk14-acceptance` 上的网页上传工作流验收脚本做只读交叉审查，钉死归因边界。
- **承重事实：**
  - 分支 `feat/t10-sdk-compatibility`，**本文提交前 HEAD `e57a6ba`**；三包仍 `0.0.10`；A 未修改任何 B/C 文件、未启动服务、未重跑测试、未重新打包或升版。
  - 审查对象：`tests/acceptance/web-upload-workflow.mts`，三轮对应 C 提交 `58a8bef`（12 项）、`9053b85`（13 项，新增 `tests/acceptance/prepare-sdk0010-web-harness.mjs`）、`35dd9ab`（14 项）。
  - 该脚本**不能**在 `fix/c-sdk14-acceptance` 自己树上运行：`9053b85`/`35dd9ab` 的 `apps/gallery/app/lib/uploads/manifest-form.ts` 只有 **7 个导出**，而脚本第 7 行导入的 `executeWebUploadWorkflow`、`createSevenComponentsManifest`、`parseAndValidateImportedManifest` 在该文件出现次数均为 **0**（只存在于 `feat/t08-real-web-upload@cddf54b` 与 B 的未提交副本）；默认 `target = process.cwd()` 直接抛 `TypeError`，12/14 项全红。
  - 也不是 Playwright 用例：`tests/acceptance/playwright.web-upload.config.ts` 的 `testMatch` 是 `web-upload-*.spec.ts`，不匹配 `.mts`；实际执行方式为 `pnpm exec tsx tests/acceptance/web-upload-workflow.mts '<B 源码目录>'`。
  - 「14/14 GREEN」的属性是 **B 的 17:23 文件 SHA 快照**，不是任何 Git 提交；C 用四文件 SHA-256 表（`page.tsx`、`manifest-form.ts`、`screenshot-validation.ts`、`tests/unit/web-upload-workflow.test.ts`）做归因。
  - 脚本自带输出字段 `kind: 'local workflow diagnostics with mock network; not browser or storage evidence'` 应保留；真实三存储证据只由 C 的 Nest/MinIO/Verdaccio 补充承担（首轮 201、complete 200、release 202；重试 PUT **185→186** 的 RED 是全套材料里最硬的一条）。
  - 三项建议落入 `35dd9ab`：第 58 行 `accept a complete valid web manifest` 正例；第 105 行 `assert.rejects` 正则改为 `/(?:INVALID|CORRUPTED|TAMPERED)_PENDING_RELEASE/`；第 20/24 行新增 `createdApiUrls`，第 46–47 行断言 `createdApiUrls.at(-1)` 与 `submissions[1].apiUrl` 均等于 `next.apiUrl`。
  - 负对照实测：parser 恒拒绝时 **13 通过 / 1 失败**；adapter 写死旧 API 时 **13 通过 / 1 失败**。
  - 实测：同一最新版 14 项对固定真实源码快照 **14/14 GREEN、退出 0**；对旧恢复顺序快照 **12/14 RED**；真实三存储补充 **2/2**、UI **12/12**。
  - `manifestDigest` 字段：第 98 行篡改的 `pending.manifestDigest` 在 `cddf54b` 里既不被写入也不被读取（pending 记录为 `{idempotencyKey, uploadSessionId, manifest, timestamp}`，见 `manifest-form.ts:781-789`）。
  - 四键清理：`zhinexus_upload_draft` 只在 `manifest-form.ts:692` 被写（每次 execute 用新时间戳覆盖）和一处单测断言（`tests/unit/web-upload-workflow.test.ts:233`），产品代码从不读；第 163 行 `completes == 1`，服务端 `apps/api/src/uploads/service.ts:59` `if (row.state === 'COMPLETE') return null;`（紧接第 66 行直接返回成功）；`uploads == firstUploads` 是「过期计划不得阻断重放」的唯一执行机制。
  - `releases/service.ts:52` 按 `WHERE subject=$1 AND idempotency_key=$2` 查重，第 57 行比对 `request_digest`/`client_id`/`channel`，不一致即 `CONFLICT`；换新 key 则撞 `001_registry.sql:73` 的 `package_releases UNIQUE(name, version)`；`apps/api/src` 全范围 grep `DELETE FROM (package_releases|variant_releases|release_jobs)` **零命中**。
  - pending key 为 `web-${Date.now()}-${Math.random...}`（`manifest-form.ts:780`），随机且不可从 manifest 重新推导。
  - `git merge-base --is-ancestor cddf54b main` 为**否**；main 上的上传页仍是不传真实字节的 stub。
  - 相关文档：`t11-t12-sdk-consumer-handover-2026-11-13.md`、`t09-sdk-evidence-audit.md`、C 的 `c-web-upload-independent-snapshots-2026-11-13.md`（提交 `9053b85`、`3164e4d`、`35dd9ab`）。
- **结论与状态：** 完成（只读交叉审查留痕，非验收证据）。C 的记录与脚本按其建议补强后进入 `c-web-upload-independent-snapshots-2026-11-13.md` 与 `c-b-gallery004-final-2026-11-13.md`。
- **交叉引用：** `c-web-upload-independent-snapshots-2026-11-13.md`、`c-b-gallery004-final-2026-11-13.md`、`c-web-upload-regressions-2026-11-13.md`、`t08-real-web-upload-2026-11-13.md`。
- **过时或矛盾点：** 「预期 12 红而非 11 过 2 败」的第一轮 C-1/C-2 归因问题已由快照 SHA 表关闭；引用该组数字必须连带引用快照 SHA。

### t08-web-upload-hardening-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 B（CLI / 画廊）；主题 T08 时序前置重放、三元组严格隔离与前端校验竞态防篡改独立复验。
- **目的：** 在网络副作用前校验 pending、强隔离三元组、四键彻底清理，并防护提交校验竞态。
- **承重事实：**
  - 工作区分支 `feat/t08-real-web-upload`（`D:\project\zhinexus-design-asset-platform-b`）；前序基准证据 `docs/verification/platform-services.md`。
  - 前置 pending 重放：任何网络副作用（`createUploadSession`、文件分片 PUT、`completeUploadSession`）前优先核查 `zhinexus_pending_release`；属于当前三元组的有效 pending 直接以原幂等键重放 `submitReleaseJob`，**零新增 create/PUT/complete**；同会话但自身损坏/被篡改的 pending 在任何网络副作用前抛 `TAMPERED_PENDING_RELEASE`；无 pending 上传阶段若预签名 URL 已到期（`expiresAt <= now`）安全新建 session 刷新 URL。
  - 三元组 `(manifestDigest, apiUrl, subject)` 严格绑定；任一项变更视为全新会话；`executeWebUploadWorkflow` 选项中 `subject: string` 设为必填（空字符串前置抛 `SUBJECT_REQUIRED`）。
  - 提交成功四键彻底清理：`zhinexus_upload_draft`、`zhinexus_pending_release`、`zhinexus_active_session_id`、`zhinexus_active_session_plan`；仅保留 `zhinexus_web_release_session`。
  - 页面校验竞态防护：`validateUploadFiles` 在 `useEffect` 中建立 `cancelled` 代际保护标志与 `isValidatingFiles` 状态；`handleSubmitRelease` 执行前对当前 `manifest` 与 `filesMap` 做一次同步快照重新校验。
  - `tests/unit/web-upload-workflow.test.ts`：**26 passed（69ms）**，用例清单 26 条（含 4 项三元组隔离、`TAMPERED_PENDING_RELEASE`、过期重签、零新增 create/PUT/complete、500MB/5000 文件/10MB 图片/50MB tarball 超限、`DIGEST_MISMATCH`、多包多变量真实哈希、ETag 收集、pending 保留、相同 Idempotency-Key、非 202 抛错）。
  - `tests/unit/api-cors.test.ts`：**6 passed（213ms）**。
  - `$env:NEXT_PUBLIC_SITE_URL="https://gallery.test"; pnpm --filter @company/gallery build`：0 错误。
  - `manual-release.spec.ts`：**8 passed（4.5s）**。
  - `web-upload-real-e2e.spec.ts`：**6 passed（39.5s）**（覆盖 14 变体 185 文件直传、7 阶段流转、DB READY、Verdaccio 可读）。
  - `verify:workspace`：10 members、no cycles、four publishable shells、safe service graph；`typecheck`：全工作区 10 包 + 根项目 0 错误（FULL TURBO）。
- **结论与状态：** 完成。被 `c-web-upload-independent-snapshots-2026-11-13.md`（17:23 快照 GREEN）与 `c-b-gallery004-final-2026-11-13.md`（最终 Git hash 验收）确认。
- **交叉引用：** `t08-real-web-upload-2026-11-13.md`、`t08-web-upload-cross-review-2026-11-13.md`、`c-web-upload-independent-snapshots-2026-11-13.md`、`c-b-gallery004-final-2026-11-13.md`。
- **过时或矛盾点：** 三项未覆盖边界（生产 OIDC SSO、独立注册域物理隔离、跨存储最终一致性）保留至后续记录。

### t11-t12-platform-operations-2026-11-12.md

- **日期／角色／主题：** 2026-11-12；角色 C；主题 T11/T12 C 平台运维准备验证。
- **目的：** 交付白名单结构化日志、受保护持久化指标、真实故障与中断恢复、三存储隔离备份恢复、只读一致性检查、部署准备模板与运维文档。
- **承重事实：**
  - 分支 `feat/t11-t12-platform-operations`，从 T07 合并后的 main `617e967` 开始；Docker Desktop Linux 容器；所有检查本机运行，未在服务端执行组件构建或浏览器。
  - 用户授权先合并 `feat/t07-catalog-preview`、新开分支、再合回 main；T07 在 `617e967` 完成本地合并，合并前后均实际运行普通 test：**25 文件 / 521 项**通过，合并树与原 T07 树一致。
  - 验证表：`install --frozen-lockfile` 通过（未新增第三方依赖）；`verify:workspace` 10 成员无环；`turbo run build --force` **10/10、0 cached**；`turbo run typecheck --force` **14/14、0 cached**；根 `tsc` 通过；`test` **29 文件 / 528 项**；`rehearse:recovery` **19 项**（7 项真实故障场景 + 12 项预览授权回归）；`rehearse:backup` **1 项真实恢复通过，28.93 秒**；`test:infra --no-restart` 通过（明确没有重启共享 G2）；`verify:deployment` 静态通过，`environmentValidated=false`、`productionAcceptance=false`；`docker compose --file infra/compose.production.yaml config --quiet` 仅语法解析通过（未启动/未拉取/未发布生产镜像）；观测/保留 HTTP 追加测试 **3 项**（无 token 404、错误 token 401、DB 断连 503、持久化阶段统计及 48 小时新会话/Ready 引用排除）。
  - 首轮成功备份指标：真实协议包/框架实现 **2 / 3**；发布对象引用 **14**；备份体积（PG custom dump + Verdaccio 卷 tar + MinIO 卷 tar）**226690 字节**；从备份开始到目标恢复摘要检查 **15509 毫秒**；整个测试（含源栈创建、seed、清理）**28.93 秒**。
  - 备份保留于忽略目录 `.tools/recovery/<UUID>/backup`；后续结果见 `.tools/operations/backup-report.json`。
  - RED→GREEN 定位：观测测试因模块缺失失败；真实故障预演初始缺故障代理；备份清单与路径/损坏测试初始失败（Verdaccio 需 Basic 身份头、PG 初始化临时 socket 被误认就绪、Docker 停止/启动后动态端口重分配）；部署/保留测试初始缺模块（YAML 合并键需显式 merge 选项、环境变量名正则需允许 S3 中的数字）；原 `test:infra` 默认重启共享 G2，新增显式 `--no-restart`。
  - 独立审查 `617e967..f4f355b`：**1 项 Important**（一致性检查缺截图/报告登记完整性）+ 部署安全检查未覆盖 root、运行目录挂载及网络归属；真实隔离 DB 的 4 类破坏（删截图、删报告、改报告内容、错配实现）先复现旧工具误报通过，修复后 4 项通过，并再次通过真实三存储恢复（合计 5 项）；修复提交 `5d6cc24`。
  - 修复后最终回归：`test` **29 文件 / 528 项，66.64 秒**；`test:platform` **23 文件 / 77 项，117.27 秒**；`test:browser` **71 项，11.0 秒**；版本提交 `7a53751`（根/API `0.0.4`、网关 `0.0.2` 及 CHANGELOG；SDK/CLI 不变）；缺外部环境的 `--environment` 模式按预期退出 1。
  - 聚焦提交：`617e967`、`fa3cd88`、`ab4798b`、`0cd7504`、`f01f558`、`f4f355b`。
  - 升版后 `build:services` 与 bootstrap/deployment/backup 入口 **9 项**通过；尝试切 main 时 Git 报告分支已被 `D:/project/zhinexus-design-asset-platform` 占用（B 工作区有暂存及持续变化的未暂存内容），未使用强制检出/stash/reset。
  - 架构 SHA-256 `E59BB77…` 实测保持；未 push、未生产部署。
  - 未完成限制：无生产等量数据、生产 RPO/RTO、**200 组件/400 实现/20 并发/p95**、**100MiB 续传**容量验收；阶段 count/sum 不提供 p95；审计在 PG 不可用期间尽力写入，非零丢失承诺；自动 GC 保持 review-only。
- **结论与状态：** 完成（T11/T12 C 准备实现），最终合并待办后由 `c-main-integration-2026-11-13.md`（合并提交 `c737e8f`）完成。完整 G2/M2/T11/T12 与生产部署仍未验收。
- **交叉引用：** `t07-catalog-preview-2026-11-12.md`、`c-main-integration-2026-11-13.md`、`c-platform-capacity-2026-11-13.md`、`c-production-preparation-2026-11-15.md`。
- **过时或矛盾点：** 备份指标（2/3、226690 字节等）为首轮实测，不重写；容量目标（200/400/20/p95/100MiB）后由 `c-platform-capacity-2026-11-13.md` 首轮实测覆盖，但生产等量仍未验收。

### c-b-gallery004-final-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 C；主题 B gallery 0.0.4 最终固定提交独立验收。
- **目的：** 从 B 最终 Git hash 导出全新归档，用 C 独立测试复跑网页上传全套，替代中途快照结论。
- **承重事实：**
  - B 修复提交 `d2f1fa715da0a0682e174f3abe1d40baee2da53b`；独立升版提交及最终验收基线 `1624fa3282c517738ef4e94780f32a1f63e2a2a4`（gallery `0.0.4`）；升版提交只改 `apps/gallery/package.json` 与 `apps/gallery/CHANGELOG.md`；C 测试支撑提交 `9253223deaf9f3476f25eb3bdcd6b2f5c8cdaec3`。
  - `git archive` 导出 `.tools/operations/b-final-1624fa3/source`，归档 tar SHA-256 `eca1f1452b50a60e3d0325dddaec6d4201fd617fb5ab4a1041b1b8040d6773bd`。
  - C 在 `tests/acceptance` 新建测试副本，只把画廊端口 **5173 → 5183**，把 SDK 批次/版本/三包摘要改为已冻结 SDK 0.0.10；未修改产品或放宽断言。
  - 文件 SHA-256 对照：manual 8 项原 `b4cf8bf721471415d8d9596e0aedeee7e60a13a9afe6dbbe25642d6600242d9d` → 副本 `d3838a06d7560958df35a5bdb5687587c650c59786575c964a195a73a247efc0`；real 6 项原 `a0ce36c1d922cabd750d46095921f6a0f76966b988f054a09693b0bf1dd196de` → 副本 `5bf9876384aca52ea69e2c21aa989cc4e3d6a06c5d913064dc1a9a7df66617af`。
  - `prepare-sdk0010-web-harness.mjs` 生成文件 SHA-256 `baa1c4b2b1c422016e5821cbc001b987498aaf4e78d43561f4e608d321fa6329`。
  - 命令表（`NEXT_PUBLIC_SITE_URL=https://gallery.test`；端口 5183；`WEB_UPLOAD_FROZEN_BUNDLE` 指向 SDK 0.0.10 权威批次）：`install --offline --frozen-lockfile --ignore-scripts` 退出 0（7.794 秒）；`exec turbo run build typecheck --force` **20/20、0 缓存**（Turbo 6.929 秒，命令 7.084 秒）；`exec node tests/acceptance/prepare-sdk0010-web-harness.mjs` 退出 0；`exec tsc --project tsconfig.json --noEmit` 退出 0；`verify:workspace` 退出 0；`exec vitest run tests/unit/web-upload-workflow.test.ts tests/unit/api-cors.test.ts` **2 文件 / 32 项**（1.68 秒）；`exec tsx tests/acceptance/web-upload-workflow.mts <最终归档>` **14/14**；`playwright --config tests/acceptance/playwright.web-upload.config.ts` **C 独立 UI 12/12（13.6 秒）**；`playwright.c-original.config.ts` 原 manual 8 + real 6 共 **14/14（55.8 秒）**；`playwright.c-web-real.config.ts --grep '真实三存储全链路\|C独立普通提交重试'` **C 真实补充 2/2（49.6 秒）**。
  - C 两项真实补充：①首次真实上传 201、complete 200、release 202 session 一致；四键清空；刷新后观察 2100ms 无新 release POST；DB 全表仅一作业；worker 到 READY；Registry 三包可读；随后再次发布取得不同真实 session，故意中断 PUT 后只保留新的活跃会话。②丢弃真实 202 后不刷新直接再次普通提交：已有 pending 直接重放，零新增 create/PUT/complete，第二次取得真实 202，原请求体/session/幂等键/job 一致；测试只把浏览器持久化 plan 的过期元数据改成过去并拦截后续 PUT，**不是等待真实预签名 URL 自然过期**。
  - 根 `scripts/pnpm.ps1 test`：**32 文件 / 620 项通过，1 文件 / 1 项失败，共 33 文件 / 621 项**；Vitest 91.17 秒，整条命令 91.683 秒，**退出 1**。
  - 唯一失败：`tests/integration/cli-release.test.ts` 的 `platformHarness → localServices → localCredentials`，因共享 `.tools/g2-local/credentials.json` 缺失抛 `Run infra:up before test:platform; real storage is required`，发生在冻结材料准备之前。
  - 已知前端限制 2 项（C 复审要求明确列出）：①`handleSubmitRelease` 最终 `validateUploadFiles` 的 await 位于后续 try/finally 外，极端底层 WebCrypto reject 可能令 `isSubmitting` 保持 busy；②localStorage 单 pending/active/draft 模型，不支持多 API/subject/digest 上下文并存。
  - SDK 0.0.10 权威冻结批次 `.tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583`；A 固定 SDK 产品 `190b60bfc583fc68611a21d270784017b7f91f11`。
  - 三包 SHA-256：core `2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752`；vue `b01aeec7604b2c399a6cb1efa7b4ba1ac3092f12ea92322c682a188045e8c01b`；react `cd625741f37a95f81b395b45bce6a34d439135dcaa1df3ea5989c73159ab8e5c`。
  - A 只读交叉审查文档提交 `2768d8fd8ac9124add8042046cebbd538d7464b4`。
  - 2026-11-13 18:23（Asia/Shanghai）：带 `org.zhinexus.recovery` 标签的容器（含已停止）和卷均为零，5183 无监听。
  - 机器证据 `c-b-gallery004-final-2026-11-13.evidence.json`；根 tsc 成功但无 stdout/stderr，`Tee-Object` 未生成 `root-tsc.log`，明确保留退出 0 与空输出说明。
  - 四方架构文档 SHA-256 均为 `E59BB77…`；离线安装后锁文件 Git blob 与最终提交一致。
- **结论与状态：** 完成（网页本地专项通过），但根套件未全绿（620 过 1 败）与外部门槛未完成分别保留。被 `c-distribution-integration-2026-11-15.md` 与 `four-agent-merge-cleanup-2026-11-16.md` 纳入 main 后全图回归。
- **交叉引用：** `c-web-upload-independent-snapshots-2026-11-13.md`、`c-cli-release-isolation-2026-11-13.md`、`t08-real-web-upload-2026-11-13.md`、`t08-web-upload-cross-review-2026-11-13.md`、`t08-web-upload-hardening-2026-11-13.md`、`c-web-upload-regressions-2026-11-13.md`。
- **过时或矛盾点：** 根套件 1 项失败与网页专项通过并存，不得相互替代；该失败后由 `c-cli-release-isolation-2026-11-13.md` 与 `four-agent-merge-cleanup-2026-11-16.md` 修复/复验。

### c-cli-release-isolation-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 C；主题 CLI 发布集成测试的自有三存储隔离。
- **目的：** 消除 CLI 发布集成测试对共享凭据与固定端口的依赖，改为随机命名、带所有权标签、随机回环端口的隔离栈。
- **承重事实：**
  - 分支 `fix/c-sdk14-acceptance`，前置提交 `d4b87a9`；只修改 C 分支的 `tests/integration/cli-release.test.ts`；B 工作区、CLI 产品代码与共享三存储未修改；未初始化或轮换共享 `.tools/g2-local/credentials.json`；未合并/push。
  - 根 `test` 实跑：**599 项通过、1 项失败（108.89 秒）**；唯一失败为该测试无参数调用共享 `platformHarness()`，因本机共享凭据缺失在准备阶段失败；RED 记录保留于 `c-a-sdk0010-windows-2026-11-13.md`，不回写为成功。
  - 改用随机命名、带所有权标签、随机回环端口的 `createRecoveryStack()`，把同一组连接显式传给 API harness、MinIO、worker、Registry 鉴权及 npm 消费者；**消除固定 `14873` 端口依赖**；隔离数据库精确断言 **14 个 Ready 实现与 3 个 Ready 包**；原 status/resume 验证保持同一 job 和幂等键。
  - 工作区外消费者经固定 Node 自带 `npm-cli.js` 安装精确 Vue 包，`shell:false`、`--ignore-scripts`、120 秒超时，再真实导入全部七个 Vue 子路径。
  - 清理覆盖启动、创建 harness、生成 bundle 和安装失败：嵌套 `finally`；临时消费者与 bundle 只允许位于系统临时目录直属、匹配本次创建的前缀。
  - 命令表：`exec vitest run tests/integration/cli-release.test.ts` **1 文件 / 1 项通过，48.71 秒**；`test` **33 文件 / 600 项全部通过，127.00 秒**；`exec tsc --project tsconfig.json --noEmit` 退出 0；`git diff --check` 退出 0；`docker ps --filter label=org.zhinexus.recovery` 无残留。
  - 第二次根 test 服务构建命中本地 Turbo 缓存（5 项），不把缓存当新增构建证据；依赖的既有子进程路径仍输出 `DEP0190`（`shell:true`）弃用警告，本次消费者调用已移除该选项。
  - 架构 SHA-256 `E59BB77…` 字节未变。
- **结论与状态：** 完成（测试基础设施修复，不改变对外产品行为，无需产品升版）。被 `four-agent-merge-cleanup-2026-11-16.md` 的全图 `test`（1107/1107）覆盖。
- **交叉引用：** `c-a-sdk0010-windows-2026-11-13.md`、`c-b-gallery004-final-2026-11-13.md`、`c-distribution-integration-2026-11-15.md`。
- **过时或矛盾点：** 「600 项通过」为 C 分支源码组合，不能替代 B 最终源码的测试结果（后者见 `c-b-gallery004-final` 的 620/1）。

### c-distribution-integration-2026-11-15.md

- **日期／角色／主题：** 2026-11-15（Asia/Shanghai，Windows x64）；角色 C；主题 独立 CLI、兼容记录与生产准备集成验收。
- **目的：** 集成 A/B/C 交付，验证真实安装包的探针自检、56 组合 hold/adopt、兼容 API 落库，并完成预检与部署准备。
- **承重事实：**
  - 基线 `bea8d3f912115791a322a3448e13797dcf4e92ad`；集成源码 `7183f366f0dfff678348d6be3a7463faafd7949a`；最终固定源码 `d39512a26599ad825ddd3a58b56ce95d8315e8fb`；C 集成分支 `d63330ef6e8e2bf137d8a9d769148f74640451a1`；本地 main 合并提交 `2c3ec76e0634fb0d13def4f47817eb724950ab44`。
  - A 交付 `56634e81dc73c7df8bb17c9c3ef360d4ef9246ac`，r2 bundle SHA256 `f9900ef7bf9c5c1a9ae912591ff4cb618f0270c3e374d7060df402ba1d262932`；B 交付 `70e663f840ed1d6e76ec54c06ba81dfe9a9191f2`，最后代码 `d6e1de91b80581f05daa7a66dea20bfeba0157f6`（最终 `219d7bf7`，最终代码 `bedb385d`）；C 部署准备提交 `225fdf1d`、公共兼容契约提交 `b19e1535`。
  - 集成修复：安装后自检漏传 `fixtures/tsconfig`；`..output` 普通目录漏过包内边界；正常 pnpm 依赖 junction 导致源白名单构建失败；测试 helper 的 POSIX 符号链接创建改同步；打包回归 **24/24、0 skip**；CLI 构建无条件打包并检查资源，并关闭该构建任务缓存防缓存回放旧探针。
  - 真实安装包：`company-component-cli-0.0.8.tgz` **201,353 字节**；解包 **869,498 字节**；**183 文件**；SHA256 `1f8188fc6a909b9097226a07216372136e3a64eeaab35b19f14ef31541afad16`；npm integrity `sha512-nhBcZCWwPIuarChGPdxoDePNpdmylwjs6eK0Wt7i2ehrwHDSF5AdeuX2eUb87mm8xFKVrEFpTQUs/Ftn0bcPdA==`；外部 `npm install` 与 `component --version` 成功（0.0.8）。
  - 安装目录直接 `node node_modules/@company/component-cli/dist/probe/probe.test.mjs`：**121/121、0 skip**。
  - 首轮 `component echarts verify`（不提供基线）：双框架各 **7 组件 × 4 展示 = 56**；类型/运行/交互 passed；视觉 NEW；hold，CLI 非零 `PROBE_HOLD`。次轮相同候选以首轮报告为本地基线：56 组合四维 passed；adopt，CLI 退出 0。
  - `scripts/audit-t10-evidence.mjs` 分别审计 hold/adopt：各重算 **56 个环境键、字体摘要**，核对 **56 张截图**字节与 SHA256，通过；安装目录前后 183 文件摘要全部相同。
  - 候选 `echarts@6.1.0` 来源 `https://registry.npmjs.org/echarts`；Vue 3.5.45 / React 19.3.1；Windows Chromium `158.0.8127.18` / revision `1254`。
  - 人工抽看 line Vue light-canvas、ranking React dark-svg、pie React light-canvas；ranking 最大值右侧标签贴近裁切边界（冻结材料已有外观，未改动冻结 SDK）。
  - 安装后自检用直接 `node <file>` 运行；`node --test node_modules/...` 一次返回找不到文件，未记为通过。
  - 兼容 API `test:installed-compatibility`（缺 `A10_FROZEN_BUNDLE` 或 `INSTALLED_CLI_EVIDENCE` 直接失败）：核对 manifest **199 个 artifact** 字节与 SHA；仅在独占 PG/MinIO/Verdaccio 测试栈发布原始材料，worker 到 READY；两框架 line release 接受返回 **201**；重复提交 **409**；篡改消费者 ECharts 版本 **400**；重启 API 后私有组件匿名查询 404、维护者读到持久化记录及审计字段；显式公开后匿名 200；套件 **1/1、退出 0**。
  - 首次测试误把默认私有组件当公开组件（匿名 404），定位 `catalog_can_read` 后修正测试设置，未放宽产品权限。
  - 集成检查：根 build **10/10**；typecheck **14/14** + 根 tsc 退出 0；根 test **Node 166/166、0 skip；Vitest 46 文件 737/737**；`test:platform` **28 文件 88/88**；`test:browser` 首轮 **189 passed**，真实三存储 6 项缺冻结目录参数，补 `ZHINEXUS_SDK_BUNDLE_DIR` 后该文件 **6/6**；`verify:workspace` 10 成员；实际 `pnpm deploy` 两服务导出并静态检查：API **8,418 文件 / 160 包**、preview **7,970 / 141**；无公司资源预检模板 passed、**27 个必填变量缺失**、unconfigured、**退出 2**、`productionAcceptance=false`。
  - 独立审查暴露七类问题（权威包名/版本/SHA256/字节数核对、四种展示与实际 theme/renderer/canvas-SVG 计数关联、浏览器检查恰好四个唯一名 `single-instance`/`no-page-error`/`series-match`/`renderer-match`、生命周期验证 before/disposed/after/checks/pageErrors、嵌套输入结构验证返回受控 400、`canonicalJson` 证据摘要经真实 PG jsonb 往返可重算、staging 检查复用运行时七项迁移文件清单并验证依赖包声明入口）；最终审查结论 **Ready to merge: Yes**，无 Critical/Important/Minor；直接针对固定源码的 14 个场景中 2 个真实正例接受、12 个反例拒绝。
  - 修复后：`turbo run build typecheck --cache=local:w` **20/20、0 cached**；`test` **Node 159 passed / 7 skipped / 0 failed；Vitest 46 文件 740/740**；`test:browser` **195/195**；`test:installed-compatibility` **1/1**；staging **12/12**；两服务重新 deploy 后 API **8,422 文件 / 160 包**、preview **7,970 / 141**、`errors=[]`、`productionAcceptance=false`。
  - main 合并后复验：`install --frozen-lockfile` 退出 0；`build typecheck --cache=local:w` **20/20、0 cached**；根 `tsc` 退出 0；`verify:workspace` 退出 0；`test` **Node 166/166、0 skip；Vitest 46 文件 740/740**，退出 0（显式设置 `A10_FROZEN_BUNDLE` 与 `npm_config_registry=https://registry.npmjs.org`，上次跳过的七项均实际执行）。
  - 冻结目录 **199 个 manifest artifact + manifest.json/acceptance.json = 201 文件**，前后差异为零；三包 SHA 同上。
  - 原始安装目录 `C:/Users/10208/AppData/Local/Temp/zhinexus-cli-round2-4702d365c1c546c986146f1ac512a25c`；证据归档 `.tools/operations/cli-distribution-2026-11-15/`，adopt 报告 SHA256 `081b931b1e57784bc4ace096451b7002f1bbc52f952bbfcdc106e6a92a251e28`；归档最终 **163 文件**（不含清单本身），`archive-sha256.json` SHA256 `dac8c6eb20e551766952035ebff1ce85c48745a13df606991406b1c8046c9fc9`。
  - 独占 `zhrec-*` 容器/卷为零，5173–5176 无监听；共享 G2 不属于本次临时资源，保持运行。
- **结论与状态：** 完成（代码、预检、分发与部署准备）。未 push、未发布 npm 包、未部署生产。被 `c-next-round-integration-2026-11-14.md` 之后的轮次与 `four-agent-merge-cleanup-2026-11-16.md`、`next-round-final-gates-2026-11-16.md` 继续推进。
- **交叉引用：** `c-platform-capacity-2026-11-13.md`、`c-isolated-platform-2026-11-14.md`、`c-production-preparation-2026-11-15.md`、`c-b-gallery004-final-2026-11-13.md`、`c-cli-release-isolation-2026-11-13.md`、`c-next-round-integration-2026-11-14.md`。
- **过时或矛盾点：** 首次根 test 166/166 与修复后 159/7 skip/0 fail 两组计数口径不同（后者未传 `A10_FROZEN_BUNDLE`，7 项按设计跳过）；不能互相替代。

### c-gallery-cors-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 C；主题 画廊 API 跨域修复验证。
- **目的：** 修复 API 未启用 CORS 导致画廊浏览器跨域请求失败的问题。
- **承重事实：**
  - 分支 `fix/c-sdk14-acceptance`，修复基线 `e490564`；执行计划 `docs/plans/2026-11-13-c-gallery-cors.md`。
  - 根因：B 的画廊客户端直接向 apiUrl 发 JSON/Bearer/Idempotency-Key 请求，API 原本没有启用 CORS；真实 HTTP 复现中 `OPTIONS /v1/releases` 返回 **404**，没有允许来源；单元上传逻辑通过不能证明浏览器跨域可用。
  - API 独立读取既有 `PLATFORM_GALLERY_ORIGIN`，或采用已验证预览配置中的 platformOrigin；仅接受精确 HTTPS Origin，显式本机 localhost/127.0.0.1/[::1] 支持 HTTP；不接受路径、查询、片段、凭据和通配符；若同时有预览配置，两处画廊值必须相同；缺配置不开放跨域。
  - 精确来源回调只允许该画廊；预览域、相似子域、不同端口和 null 均不放行；方法仅 **GET/POST/OPTIONS**；请求头仅 **Authorization/Content-Type/Idempotency-Key**；暴露 `X-Request-Id`；不设置 Allow-Credentials；预检 **204**；实际匿名发布仍 **401**；未引入新依赖。
  - 验证表：`exec vitest run tests/unit/api-cors.test.ts`（旧 dist）**RED 4 failed / 2 passed**；`build:services` **5/5**（API build/typecheck 实际重跑）；新 dist **GREEN 6/6，1.06 秒**（真实 Nest 监听与 HTTP，不 mock 响应）；`exec vitest run tests/unit tests/contracts` **20 文件 333 测试，12.00 秒**；根 `tsc` 通过；`verify:workspace` 10 成员；`git diff --check` 通过。
  - 独立静态审查未发现 Critical/Important/Minor。
  - C 的十四实现验收支撑提交为 `e490564`；已向 B 交接 `PlatformServices` 和精确文件接入范围。
- **结论与状态：** 完成（API CORS 修复）。被 `t08-real-web-upload-2026-11-13.md` 接入并在 `t08-web-upload-hardening-2026-11-13.md`、`c-b-gallery004-final-2026-11-13.md` 复跑。
- **交叉引用：** `t08-real-web-upload-2026-11-13.md`、`t08-web-upload-hardening-2026-11-13.md`、`c-web-upload-independent-snapshots-2026-11-13.md`。
- **过时或矛盾点：** 与 `t08-real-web-upload-2026-11-13.md` 中 api-cors 6 项通过（178ms / 243ms）为同一测试的不同时点记录，非矛盾。

### c-image-atomic-review-2026-11-14.md

- **日期／角色／主题：** 2026-11-14；角色 C；主题 镜像登记并发审查补充。
- **目的：** 修复 `images.json` 登记写入非原子发布导致的坏登记风险。
- **承重事实：**
  - 基线 `fd03185732fadad04e3fe913d99f9b9f4df0456d`；分支 `chore/c-local-acceptance`。
  - 审查发现 P2：`writeFileSync(images.json, ..., { flag: 'wx' })` 虽不覆盖已有文件，但创建与写入并非完整内容的原子发布；另一首次登记进程可能在 open 与 write 之间把空文件判为坏登记；写入方中断也会留下坏登记。
  - 新增确定性交错测试（仅拦截文件写入边界，真实打开文件后、写入内容前调用第二次 `imageId()`）：**RED 8 通过 / 1 失败**，第二次调用实际返回 `Invalid local MinIO image identity record`，首进程结束后 JSON 却完整。
  - 实现改为同目录建立唯一暂存目录，写完 JSON，再通过**硬链接以无覆盖方式原子发布**完整文件；目标已存在时重新核验胜出的登记；正常或异常路径均清理自身暂存目录；现有坏登记仍失败关闭。
  - 验证表：`local-images.test.ts` 修复前 **RED 1 failed / 8 passed**；两个新增 unit 文件修复后 **GREEN 2 文件 10/10**；根 `tsc` 通过（首次发现测试桩未兼容数字文件描述符，补齐转发后通过）；`test` **38 文件 693/693，183.67 秒**，退出 0；`verify:workspace` 10 members、无环、4 公开包；`git diff --check` 通过。
  - 根测试日志 `.tools/c-review-fix-root-test.log`；服务前置构建命中 Turbo 缓存，未作为全图零缓存构建证据；既有 `DEP0190` 警告仍存在。
  - 原平台 88 项、备份与恢复专项结果仍绑定前一记录，本次没有把它们称为再次运行。
  - 原架构 SHA-256 `E59BB77…` 未变。
  - 历史引用勘误：A 文档可解析提交为 `2768d8fd8ae9124add8042046cebbd538d7464b4`（旧归档字符串笔误）。
- **结论与状态：** 完成（本地验证设施修复，不触发产品版本递增）。被 `c-isolated-platform-2026-11-14.md`、`c-next-round-integration-2026-11-14.md` 纳入回归。
- **交叉引用：** `c-isolated-platform-2026-11-14.md`、`c-next-round-integration-2026-11-14.md`、`c-b-gallery004-final-2026-11-13.md`。
- **过时或矛盾点：** 「38 文件 693/693」与 `c-isolated-platform-2026-11-14.md` 的「38 文件 692/692」为相邻时点不同计数（后者早一轮），引用需带提交。

### c-isolated-platform-2026-11-14.md

- **日期／角色／主题：** 2026-11-13 深夜至 2026-11-14；角色 C；主题 干净工作树平台专项复现。
- **目的：** 让平台专项测试不再依赖共享凭据与固定端口，改为自建隔离栈注入，使干净工作树可复现。
- **承重事实：**
  - 分支 `chore/c-local-acceptance`；基线 `4dc93fec1c0c702fb615b0709f8f7a9816bc3ec9`；计划提交 `b51f63c`；Windows x64，Node 26.13.0 / pnpm 12.18.0。
  - 变更：①原 `imageId()` 无条件读 `images.json`，现缺登记时核对本地镜像 source/revision/release 与 `linux/amd64` 后原子登记不可变 ID，非法已有登记不回退或覆盖；②原平台 support 读取共享凭据并固定连接 **15432/19000/14873**，现由 Vitest global setup 自建 `RecoveryStack`，通过内存 provide/inject 注入独立凭据和动态端口，默认未注入即拒绝；③只改本地开发/验证设施，不新增产品 API 或改变 SDK 对外行为，不触发独立产品升版。
  - 验证表：`install --frozen-lockfile` **344 个依赖**冻结安装通过，未改锁文件；`local-images.test.ts` 实现前 **RED 8 项失败** → GREEN **8/8**；`platform-isolation.test.ts` 实现前 RED（仍尝试读共享凭据）；`isolated-environment.test.ts` 实现前 RED；两个 unit 文件实现后 **9/9**；独立设施真实探针 **1/1**；`test:platform` **28 文件 88/88**；`test` **38 文件 692/692**；`rehearse:backup` **1/1**；`rehearse:recovery` **2 文件 19/19**（passed=true、productionAcceptance=false）；`verify:workspace` 10 成员；根 `tsc` 通过；`verify:deployment` templateValidated=true、environmentValidated=false、productionAcceptance=false；`infra:check-access` OIDC/preview 均 unconfigured、g2Ready=false、脚本退出 2（pnpm 转为失败退出）。
  - SDK 0.0.10 既有权威 Bundle 经 **199 个文件**字节数与 SHA-256 逐项核对，14 实现，0 不匹配。
  - 日志 `.tools/platform-isolated.log`、`.tools/c-root-test.log`；首次服务构建可能从 Turbo 恢复编译产物；命令调用中两次 PowerShell/tsc 参数格式错误已用数组形式修正，不计为通过。
  - 保留边界：本机镜像标签核对不是镜像签名/供应链证明；协议 OIDC fixtures 与本机 TLS/测试域只证明本地行为；B 的新基线 CLI 和 A 的兼容探针不包含于本表 C 分支结果；既有 `DEP0190` 警告仍出现。
  - 专项结束后 `docker ps`/`docker volume ls` 的 `org.zhinexus.recovery` 标签筛选均无残留。
- **结论与状态：** 完成。被 `c-next-round-integration-2026-11-14.md`（集成后 test:platform 28 文件 88/88 229.45s）、`c-platform-acceptance-2026-11-16.md`（13 文件 57 测试）沿用。
- **交叉引用：** `c-image-atomic-review-2026-11-14.md`、`c-next-round-integration-2026-11-14.md`、`c-platform-acceptance-2026-11-16.md`、`c-platform-capacity-2026-11-13.md`。
- **过时或矛盾点：** 固定端口 15432/19000/14873 在本篇后不再使用（改为随机端口），引用旧命令时须注意。

### c-main-integration-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 C；主题 运维分支与最新 main 集成验证。
- **目的：** 把 C 运维分支与含 CLI 发布与画廊界面的最新 main 无冲突整合并合入 main。
- **承重事实：**
  - 开始 main 为 `89d2511`，C 分支 `dff271b`；主工作区仅有未暂存的 `apps/gallery/app/globals.css`，C 提交不涉及此文件，暂存区为空；复用 C 独立 worktree 整合 main，生成无冲突合并 `8987f84`。
  - 验证表：`install --frozen-lockfile` 通过；`verify:workspace` 10 成员；`turbo run build --force` **10/10、0 cached，21.056 秒**；`turbo run typecheck --force` **14/14、0 cached，3.886 秒**；根 `tsc` 通过；`test` **30 文件 / 529 项，119.72 秒**；`verify:deployment` 静态通过（environmentValidated=false、productionAcceptance=false）。
  - 平台与浏览器按顺序运行：`test:platform` **23 文件 / 77 项，122.10 秒**（含真实三存储备份恢复）；`test:browser` **74 项，15.6 秒**（含 B 新增目录和详情界面测试）；全部退出码 0。
  - main 合并由 `c737e8f` 完成；合并后 Git 提交树与已完整验证的 C 集成树完全一致；主工作区 `globals.css` 合并前后 SHA-256 相同，暂存区保持干净；C 独立 worktree 同步到合并提交后 `verify:workspace` 通过，观测/部署/备份/bootstrap **4 文件 11 项通过（1.51 秒）**。
  - 原 2026-11-12 记录中的「最终合并待办」由本记录完成；未 push。
  - 架构 SHA-256 `E59BB77…` 仍为原值。
- **结论与状态：** 完成。被 `c-platform-capacity-2026-11-13.md`、`c-next-round-integration-2026-11-14.md`、`c-distribution-integration-2026-11-15.md` 继续推进。
- **交叉引用：** `t11-t12-platform-operations-2026-11-12.md`、`c-platform-capacity-2026-11-13.md`、`t07-t08-gallery-upload-2026-11-13.md`。
- **过时或矛盾点：** 无。

### c-next-round-integration-2026-11-14.md

- **日期／角色／主题：** 2026-11-14；角色 C；主题 A/B/C 下一轮集成与 Windows 原生复验。
- **目的：** 集成 C 平台隔离、B 第一阶段与 A 多版探针交付，完成真实 Windows 干净消费者的 56 组合 hold/adopt 与真实回退。
- **承重事实：**
  - 基线 `4dc93fec1c0c702fb615b0709f8f7a9816bc3ec9`；集成分支 `chore/c-next-round-integration`。
  - 分支与审查：C `acd9d5739291236e284fd1db1472ff00514127c2`（本地合并 `0b71cf44019f43dbbb516787b2f717a7ff14f1cd`）；B 第一阶段 `d1f61500a6f6e80e6bbd9a50749bd663ccc1fcbb`（独立复核窄测 17/17，两项 P2 已关闭；集成合并 `20d01e4`）；A 首份 `698e2321511a67be305be9996b716442e0e48cfd`（bundle 完整性验证通过，已 ff 导入 Windows A 工作树，首轮审查发现问题尚未合并）。
  - C+B 集成验证：`local-images.test.ts` + `platform-isolation.test.ts` **10/10**；`test` **38 文件 693/693，203.21s**；`test:platform` **28 文件 88/88，229.45s**（独立栈 `b2efee12-b7ca-4ba7-a51c-b6d7aa447304` 已清理）；`install --frozen-lockfile` 通过；`verify:workspace` 10 成员；`turbo run build typecheck --force` **20/20、0 cached，17.24s**；根 `tsc` exit 0（首次简写因 PowerShell 参数绑定失败，改显式数组后实跑通过）；`test:browser` **195/195，1.4m**（含 14 实现、56 项主题/渲染器展示、手动发布失败恢复与 6 项真实三存储网页 E2E；设 `ZHINEXUS_SDK_BUNDLE_DIR`）。
  - A 首份 Windows 失败：`install --frozen-lockfile --ignore-scripts` 通过（10.9s）；`node --test tests/acceptance/t10-sdk/probe.test.mjs` **51 项中 46 通过、5 失败，exit 1**（测试 fixture 用 Unix `cat`，Windows `spawnSync cat ENOENT`）；`probe.mjs --bundle <权威冻结目录> --echarts 6.1.0 --out … --label windows-baseline` exit 0，两框架各 28 次浏览器运行，`visual=not-run`、`recommendation=hold`；只读临时探针复现：两份同组合基线冲突时 `conflicts.length=1` 而比较仍返回 `PASS`；缺 SSR/生命周期/浏览器运行证据时 `runtime=passed`。
  - 追加复核（修正交付前实际失败）：A `measureFontFingerprint` 在 `page.evaluate` 引用 Node 外层常量抛 `ReferenceError: FONT_MEASUREMENT_SOURCE is not defined`；浏览器 revision 读取遇缺失 `fileURLToPath` 和 pnpm 包路径解析失败，C 从 `@playwright/test → playwright → playwright-core` 依赖链解析 `browsers.json` 读到 Chromium revision `1254`；A `nativePlatformNote` 必须进 `scopeNotes`；默认 strict 安装失败不得自动重试 legacy；消费者来源需与真实 npm lock 的版本/integrity/resolved/非链接状态核对；B `0ee149a` 独立窄测 3 文件 24/24 通过但临时反例复现四项 P2（组合实际 ECharts/框架版本未绑定、resolver integrity/source 被丢弃、畸形 `failures` 引发未捕获异常、Windows junction 可越出冻结根目录）。
  - C 根脚本接线草稿 `test:t10` 与 `probe:t10`。
  - B 第二阶段固定头 `8cbc8b7d296390b45a88a4a31ecde842d7ca80e5`（`d8433a9` 修正四类 P2 + `8cbc8b7` 追加记录）：独立复核读固定 Git 对象，**3 文件 25/25，3.22s**，四项原问题全部关闭；C 以 `30c0a88` 本地合入；合入后 `NEXT_PUBLIC_SITE_URL=https://gallery.test`，`turbo run build typecheck --force` **20/20、0 cached、5.952s**，根 `tsc` exit 0；独立逐文件复核冻结批次 **199 文件 / 14 实现，大小与 SHA-256 差异 0**（`.tools/c-final-frozen-audit-2026-11-14.json`）。
  - A 第二版固定头 `fc047103564fd8869953aa3e84afd547b7ea1a8e`，交接 bundle SHA-256 `f0b7a98f1e0d208b23621eaffbda248c47c5423cdbdc029af0cb321a16f9c4a3`；C 以 `77b95e3` 合入；显式 `A10_FROZEN_BUNDLE` 后 `node --test probe.test.mjs` **104/104、0 fail、0 skip，11.61s**；根 `test` 服务构建 + Node 104/104 + Vitest 42 文件 719/719（182.89s），exit 0。
  - 第二版真实 CLI：`echarts verify --version 6.1.0 --consumer-root <独占外部新目录> --keep --out … --label windows-final-initial --json`，两框架 56 次运行；类型/构建/SSR/运行/交互通过但消费者 lock 的 ECharts 条目无 `resolved`/`integrity`，CLI 以 `CANDIDATE_INTEGRITY_UNVERIFIED`、exit 1 拒绝，探针自身 exit 0；根因 `cp(exampleDir, ...)` 未排除 Windows 示例目录已有的 `node_modules`、`dist`、`.turbo`。
  - C 证据审计与回退工具进永久回归：`scripts/audit-t10-evidence.mjs`、`scripts/t10-consumer-ownership.mjs`、`scripts/verify-t10-rollback.mjs`、`docs/verification/sdk-release.md`；`tests/unit/t10-evidence.test.mjs` **21 项**；`test:t10` **125/125、0 fail、0 skip、11.04s**；根 `test` Node 125/125 + Vitest 42 文件 719/719（203.10s）。
  - A 第四版固定头 `faf0a6485c71d865230e98384237ab27dc2dcfcf`，bundle SHA-256 `c4ce277b4c7bacdfdb4e5a895912f22a9860d5c99d2f00a68b819b433a3b9d8a`；C 以 `bfa34f3` 合入；`node --test` **115/115、0 skip、exit 0，6.21s**。
  - 第四版首轮仍 `CANDIDATE_INTEGRITY_UNVERIFIED`：本机 npm 配置把包下载到 `registry.npmmirror.com`，候选元数据来自 `registry.npmjs.org/echarts`，来源主机不一致；后续仅对验收进程设 `npm_config_registry=https://registry.npmjs.org`；一次把 registry 根地址误传给 `--registry` 被 `UNKNOWN_VERSION` 拒绝。
  - 官方源首轮 CLI：`component echarts verify --bundle <同一冻结目录> --version 6.1.0 --registry https://registry.npmjs.org/echarts --consumer-root <随机独占外部目录> --keep --out test-results/t10-sdk-probes/windows-official-initial --label … --json`：两框架各 28 次运行，候选来源 verified，视觉 not-run，CLI exit 1 / `PROBE_HOLD`；`audit-t10-evidence.mjs <首轮报告> hold 56` exit 0。显式 `--baseline <首轮报告>` 的 `windows-official-visual`：CLI exit 0 / `adopt`、uncovered 空、四维全过、**56/56 视觉 PASS**；`audit … adopt 56` exit 0。
  - ECharts **6.0.0**：默认 strict 与显式 strict-only 均 npm ERESOLVE / `PROBE_PEER_REJECTED`，探针及 CLI exit 1，未自动 legacy；显式 `--peer legacy --baseline <首轮报告>` 才执行双框架 56 次测量：构建/SSR/运行/交互及 56 张视觉对比通过，但两框架 Bundler/NodeNext 类型均失败（TS1203、TS2305 等），CLI exit 1 / `PROBE_HOLD`。
  - 回退首轮发现生成代码类型阻断：`verify-t10-rollback.mjs <首轮报告> …` 后两消费者确实 6.1.0→6.0.0 legacy 安装/构建并恢复原 manifest/lock 字节、严格 `npm ci` 回 6.1.0；但恢复后类型复检失败：`src/a-t10-echarts-registry.ts:9` 把 `document.querySelector()` 返回的 `Element` 传入要求 `HTMLElement` 的 `getInstanceByDom`，Vue 报 TS2345、React 报 TS2740；该文件由 `browser.mjs` 注入而初轮类型检查先于注入；**回退脚本 exit 1，证据 `passed: false`，不得记回退完成**。
  - A 第五版固定头 `c42dcc7c4324c79f34a0829710c5f700f6c3a8cf`，bundle SHA-256 `faf5287b390f71ba568380e1f745695a5530223ddb432b1b0a8c10249163cce7`；C 以 `3d0dcf1` 合入；生成注册表先检查 `element instanceof HTMLElement`；`node --test` **117/117、0 fail、0 skip、35.29s**。
  - C 编译器回归收口：新增测试 helper 无条件使用 `vue-tsc` 而 React 消费者未声明该工具，`npm exec` 可能隐式下载；实测 RED `react: 编译器 vue-tsc 必须由消费者精确声明`；改为按框架选本地 `vue-tsc`/`typescript` 的 `tsc` 直接用当前 Node 执行本地 bin，禁止隐式 npx 安装；`test:t10` **138/138、0 fail、0 skip、18.17s**；根 `test` Node 138/138 + Vitest 42 文件 719/719（184.45s）。
  - r5 真实复验：6.1.0 首轮 CLI exit 1 / `PROBE_HOLD`（56 组合，类型/构建/SSR/生命周期/运行/交互通过，候选来源 verified，视觉 not-run）；6.1.0 全新消费者 `--baseline <r5 首轮报告>` CLI exit 0 / `adopt`，56/56 视觉 PASS；6.0.0 默认 strict 与 `--peer strict-only` 均 `PROBE_FAILED`、exit 1；6.0.0 显式 legacy 构建/SSR/生命周期/运行/交互与视觉通过但两框架 Bundler/NodeNext 类型失败，CLI exit 1 / `PROBE_HOLD`；回退 `verify-t10-rollback.mjs <r5 首轮报告> … .tools/c-t10-r5-owned-root.json`：两消费者 6.1.0→6.0.0 legacy→恢复 manifest/lock 字节→严格 `npm ci` 回 6.1.0，SDK 实际版本 0.0.10，4 组类型检查、构建与无 DOM SSR 导入全通过，manifest/lock SHA 完全恢复，errors 空、cleaned true、`passed: true`，脚本 exit 0。
  - 回退 ownership run ID `6d49c39cb6f8354b86e6ff768cdad16f`。
  - 最终审计 `.tools/c-r5-final-invariants-2026-11-14.json`：冻结 **199 文件 / 14 实现**，大小与 SHA 差异 0；架构 SHA `E59BB77…`；锁文件 SHA `8001977F7DC87FE10E5683B4156B9BCF716EA90F865B6904DF857A3B687BC9D7`。
  - `3480f31`：`install --frozen-lockfile`、`verify:workspace` exit 0；`turbo run build typecheck --cache=local:w` **20/20、0 cached、14.086s**；根 `tsc` exit 0；`test:browser` **195/195、1.3m**（含 6 项真实三存储网页发布/断网恢复；自有设施 teardown，5173–5176 无监听）。
  - 工程裁决 6 条（平台专项用 globalSetup 内存注入无设施即失败；镜像登记先写完整同盘临时文件再无覆盖硬链接发布；独立 `test:t10` 先构建 contracts；只对验收进程统一官方 npm 源；C 临时接管 A 新测试 helper 按消费者精确声明的本地编译器检查；平台 88/88 与应用浏览器 195/195 按未变源码覆盖范围沿用）。
  - 本地合 main：提交 `448ae7a4020dd5872dccbd89d5de63b891b4bbbb`（`test: 锁定消费者本地编译器并记录最终兼容回退验收`）；合并提交 `299f9b8393f844c2c0ddae4248b652604cabfb01`，tree `05622704b349ca7bf4750c32ce810e665c6cf210`；未推送。
  - main 复验表：`verify:workspace` 10 成员；`turbo run build typecheck --cache=local:w` **20/20、0 cached、5.528s**；根 `tsc` 通过；`test` **Node 138/138、0 fail、0 skip、25.63s；Vitest 42 文件 719/719、176.50s**；`test:browser` **195/195、1.1m**（含 6 项真实三存储网页 E2E）。
- **结论与状态：** 完成（本轮执行计划三个本地任务关闭）；不是整个平台投产验收。被 `c-next-round-integration-2026-11-16.md`、`four-agent-merge-cleanup-2026-11-16.md`、`next-round-final-gates-2026-11-16.md` 继续。
- **交叉引用：** `c-isolated-platform-2026-11-14.md`、`c-image-atomic-review-2026-11-14.md`、`c-platform-capacity-2026-11-13.md`、`c-distribution-integration-2026-11-15.md`、`b-next-echarts-p2-2026-11-14.md`、`t10-windows-local-procedure.md`。
- **过时或矛盾点：** A 第二版（fc047103）的 56 组合结果被第四/五版取代，不得作为干净消费者验收；「195/195 浏览器沿用」在 main 复跑后被覆盖。

### c-next-round-integration-2026-11-16.md

- **日期／角色／主题：** 2026-11-16；角色 C（Codex），协同 Antigravity（A）、Claude 桌面端（B）、Claude Code CLI（D）；主题 四方下一轮交付与集成准备。
- **目的：** 冻结严格 SDK 交接副本，实测已安装 CLI 对混合版本的拒绝，演练 D 的 ID runner，并完成只读集成审计。
- **承重事实：**
  - 任务安排 `docs/plans/2026-11-16-four-agent-next-round.md`；本轮无源码合并或推送，未修改旧 tarball。
  - 固定 HEAD 表：C `a2036ba93c86983bd67bd3ea6971a9b2ad51d7b9`（主仓库 `D:/project/zhinexus-design-asset-platform`）；A `60a023737c2a08c269a4539f70b0a6f06d14520d`（`C:/Users/10208/.codex/worktrees/t13-a-eval/…`）；B `cb7406c2a9396877089499d2880f4522f836cb53`（`t13-b-match-ui`）；D `7bbb769805c104ffc415a9965180adbcd40d15d4`（`t13-d-eval-pipeline`）。
  - 聚焦提交：A `ce34c390`（允许冻结 SDK 各包独立精确版本，显式冻结输入 167/0/0）、`8f4ab033`（严格声明材料副本复验及旧 CLI 分发阻塞记录，167/0/0）、`60a02373`（对齐 contracts exactVersion 正则和 1..2048 长度限制，最终 **168/0/0**，独立审查关闭原 P2）；B `cb7406c2`（已安装 CLI 探针阻塞与新候选前置）；D `7bbb7698`（真实 ID 观测交接与空集验收边界）。
  - A 原始 GREEN 日志 `C:/Users/10208/.gemini/antigravity/brain/ed60a4d8-0e2f-4992-9c0d-1f188d449d1c/.system_generated/tasks/task-703.log`：实际 **25 suites、168 pass、0 fail、0 skipped、21024.7889 ms**。
  - 三个非法版本值：`01.0.11`、`0.0.11-01`、`0.0.11-rc..1`；A 侧 RED 为 6 pass / 1 fail（首个非法值触发）；独立复核未找到该次 RED 的独立原始日志，仅直接比较新旧规则确认三项旧规则放行、新规则拒绝、合法版本仍通过。
  - 原 SDK 目录 `.tools/operations/current-sdk/6d567b22-6c72-4e7a-a254-ade94b104df1`；严格副本 `.tools/operations/next-sdk-handoff-zQIRda`；`.\scripts\pnpm.ps1 exec node .tools/c-next-freeze-handoff.mjs` exit 0；原目录因额外 `acceptance.json` 被严格 `verifyReleaseBundle` 以 `UNEXPECTED_FILE` 拒绝；副本仅复制 manifest 与声明的 **199 个文件**并逐项检查路径/文件类型/SHA/bytes。
  - 旁置证据 `.tools/operations/next-sdk-handoff-zQIRda.evidence.json`，时间 `2026-11-16T05:54:40.271Z`；manifest SHA-256 `917f195aaa1deb12c30ad55a482241cbfd1182173777f4757edfbeff523c997d`。
  - 四包表：charts-core 0.0.10 **53524** 字节 `2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752`；charts-vue 0.0.11 **6682** `5880c22a446074a8e68c2b898406ba76eaf658d8614965426a76c95328b2cf49`；charts-react 0.0.11 **12220** `0443b89f386300f756138913d7ce34721e2d9ada9b035694354c9b0faffa26fb`；component-cli 0.0.10 **218759** `0261b846c6c738e509a99afeb2c8089902538856d42a6609f85484cb629063e9`。
  - CLI tarball `.tools/b-cli0010-distribution-KJhUCm/company-component-cli-0.0.10.tgz`；既有工作区外消费者 `C:/Users/10208/AppData/Local/Temp/zhinexus-cli0010-consumer-xRMZib`，实际 bin 在其 `node_modules/.pnpm/@company+component-cli@file_3c39797316c51dfdb2c6b3baf2eecce0/node_modules/@company/component-cli/dist/bin.js`。
  - C 用固定 Node v26.13.0 运行该实际 bin：`echarts check --bundle <严格副本> --registry offline --json` 与 `echarts verify --bundle <严格副本> --registry offline --json --version 6.1.0` 均 **exit 1**，错误码 `INVALID_BUNDLE_MANIFEST`，原文「三个包版本必须一致，当前为: 0.0.10, 0.0.11」；直接 `pathToFileURL(...).href` 导入安装包 `dist/probe/bundle.mjs` 后 `readFrozenBundle` 抛 `PROBE_INPUT 版本不一致`。
  - 复现命令 `.\scripts\pnpm.ps1 exec node .tools/c-cli0010-preflight-evidence.mjs` exit 0（成功捕获预期拒绝）；证据 `.tools/c-cli0010-preflight-evidence-20261116.json`（`2026-11-16T06:09:00.524Z`）。
  - 五项必须修复前置：①B `packages/component-cli/src/commands/echarts.ts:317` 拒绝独立版本、`:333` 仅取首版本，应允许各包精确版本并按 A 相同 manifest 顺序复算 `bundle.version`（全同单值；混合为各项 `name@version` 以逗号加空格连接），保留 `:942` 顶层相等检查及逐包 name/version/SHA/bytes 绑定；②A→集成构建须包含最新 `bundle.mjs`、相关测试、Vue/React examples 生命周期控件，再由 `package-probe.mjs` 生成新清单；③C `scripts/verify-t10-rollback.mjs:70` 写死框架包 0.0.10、`:89` 在已记录失败后仍调用清理；④C `tests/platform/current-sdk.test.ts:224` 把 `acceptance.json` 写入冻结目录；⑤B `echarts verify --help` 漏列 consumer-root/keep/timeout/skip-browser，600 s 默认值是否足够仍待真实矩阵测量。
  - 回退 ownership 要求来自 `validateOwnedConsumers`：owned consumer-root 恰好出现一次、含 `--keep`、保留 ownerFile；`audit-t10-evidence.mjs` 本身无该约束；C 曾把 ownership 要求扩大到复验，已纠正文档并同步 B。
  - D 交接边界：Claude Code 通过 `--print --tools '' --output-format json` 输出草稿并 exit 0；C 落盘时补齐 mapping.schemaVersion、失败 HTTP case 不能丢弃、评分器验证 plan 内容、原始/脱敏响应摘要分开记录；runner 不验证调用者声明的来源真实性、HTTP 状态或版本血缘。
  - C 在 D 工作树执行 `.\scripts\pnpm.ps1 exec tsx tests/evaluation/runner-id-cli.ts --cases tests/evaluation/design-cases.json --observations tests/evaluation/runner-id-observations.example.json --output .tools/id-handoff-synthetic-20261116.json --mapping-version synthetic-example-v1 --runner-version id-runner-v1`：**exit 1**，`runner-id: FAIL real=0 synthetic=1 hardViolations=0`；新报告 real=0、精确匹配率 null/N/A、passed=false；synthetic 1/1、passed=true；productionAcceptance=false；cases 与 observations 的 `Get-FileHash -Algorithm SHA256` 分别匹配报告 `inputSha256`、`observationSha256`。
  - 只读集成审计（相对 C `a2036ba9`，命令 `git merge-base`、`git rev-list --left-right --count`、`git diff --name-only`、`git rev-parse`）：A `feat/t13-a-eval` merge-base `b13cc2d7c96aa744834c0a49cdfbfa46a84fc9b0`，C 独有/分支独有 **2/8**，变更文件 **24**，与 C 独有变更路径交集空；B `feat/b-release-acceptance-20261116` merge-base `c273f1e58b446df494289ea9583eff3a6c93ca64`，**1/10**，**18** 文件，交集空；D `feat/t13-d-eval-pipeline` merge-base `b13cc2d7…`，**2/3**，**12** 文件，交集空。
  - 三方差异：A/B README 与 CHANGELOG 内容不同（A ID 边界测试和其验证文档为相同 blob）；A/D README 不同；B/D README 与 `design-cases.json` 不同（D 缺口文档为相同 blob）；本轮无公共契约或根锁文件改动；A 分支已有 Vue/React 0.0.11、B 分支已有 CLI 0.0.10 的前轮独立升版提交。
  - 收口检查：四个工作树 A/B/D 干净，C 仅新增本轮计划及记录；`git diff --check`、`git diff --cached --check` 无错误；四处架构 SHA-256 均 `E59BB77…`。
  - 本轮未执行：已安装 CLI 56 组合 hold/adopt、6.0.0 strict/legacy、真实消费者回退、依赖 adopt 的 installed-compatibility。
- **结论与状态：** 完成（文档收口与前置取证）；阻塞于 CLI 混合版本拒绝，后由 `cli-0011-integration-repairs-2026-11-16.md` 修复。被 `four-agent-merge-cleanup-2026-11-16.md`、`next-round-final-gates-2026-11-16.md` 承接。
- **交叉引用：** `cli-0011-integration-repairs-2026-11-16.md`、`rollback-sidecar-repairs-2026-11-16.md`、`four-agent-merge-cleanup-2026-11-16.md`、`next-round-final-gates-2026-11-16.md`、`c-next-round-integration-2026-11-14.md`、`c-platform-acceptance-2026-11-16.md`。
- **过时或矛盾点：** A 的 RED 缺独立原始日志（明确说明不得省略该限制）；D 的 `real=0` 空集结论只证明空集不能通过，不代表真实 ID 规则已验收。

### c-platform-acceptance-2026-11-16.md

- **日期／角色／主题：** 2026-11-16；角色 C；主题 平台验收补充记录。
- **目的：** 在 `feat/t13-c-matching` 上复验既有 T05/T06/T07 平台实现（上传/发布/目录/预览/网页交接）。
- **承重事实：**
  - 分支 `feat/t13-c-matching`（基线 `c273f1e5`）；全部命令经 `.\scripts\pnpm.ps1`，本机 `.tools` 的 Node 26.13.0、pnpm 12.18.0 和本地 Playwright。
  - 命令表：`verify:workspace` exit 0（10 成员、无循环、4 公开包、服务端依赖闭包安全）；`exec turbo run build typecheck --filter=@company/platform-api --filter=@company/preview-gateway --force` exit 0，**5/5 任务、0 缓存、3.649s**；隔离平台测试 exit 0，**13 文件 / 57 测试、58.01s**；`test` exit 0，**Vitest 62 文件 / 1041 测试、226.43s**（前置 T10 Node 测试 **159 通过、7 跳过、0 失败**）；`exec tsx scripts/production-preflight.ts --environment` **exit 2**（部署模板检查通过，运行环境缺 **27 个必需变量**，`productionAcceptance: false`）；`infra:check-access` 检查脚本 exit 2（pnpm 对外 exit 1），OIDC 与 preview 均 `unconfigured`，`g2Ready: false`。
  - 平台测试实际命令（14 个文件）：`tests/platform/uploads.test.ts`、`releases.test.ts`、`release-concurrency.test.ts`、`release-recovery.test.ts`、`release-tags.test.ts`、`registry-references.test.ts`、`dependency-order.test.ts`、`catalog.test.ts`、`catalog-identity.test.ts`、`catalog-reports.test.ts`、`preview.test.ts`、`preview-browser.test.ts`、`web-handover.test.ts`（`vitest run --config tests/platform/vitest.config.ts`）。
  - 该套件通过 `createRecoveryStack()` 启动临时隔离真实 PostgreSQL、MinIO、Verdaccio；HTTP/预览测试使用本地签名身份测试工具；读取 Nest `dist` 构建产物；栈标识 `4a9b57a0-9499-4d8a-a769-6e0427eb242a`，启动日志明确 `productionAcceptance: false`；测试结束执行隔离栈清理，不借用共享 G2。
  - 覆盖：上传与逐实现截图拒绝、发布状态机/并发租约与中断恢复、不可变包摘要核对、依赖发布顺序、目录身份和报告可信度、预览授权与浏览器隔离、网页交接。
  - 根测试 **7 项跳过**来自 T10 `A10_FROZEN_BUNDLE` 未配置（候选 peer 冲突、跨版本方向、双框架覆盖不足、四维未执行/视觉差异、精确基线采用判据）。
  - Node 输出 `DEP0190` 子进程 shell 参数弃用告警，本轮测试未因此失败，未更改这些调用点。
  - 根工作树本轮不含 A/B/D 尚在独立分支的新增修改，1041 项只对应 C 基线。
  - 本轮未改平台实现、公用契约或包版本；未执行合并或 push；架构 SHA-256 `E59BB77…`。
- **结论与状态：** 完成（C 基线平台复验）。被 `four-agent-merge-cleanup-2026-11-16.md`、`next-round-final-gates-2026-11-16.md` 的合并后全图回归覆盖。
- **交叉引用：** `c-isolated-platform-2026-11-14.md`、`c-platform-capacity-2026-11-13.md`、`t05-*`/`t06-*`/`t07-*` 系列、`four-agent-merge-cleanup-2026-11-16.md`。
- **过时或矛盾点：** 13 文件/57 测试为本轮聚焦子集，与 `c-isolated-platform-2026-11-14.md` 的 28 文件/88/88 口径不同（范围不同，非矛盾）。

### c-platform-capacity-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 C；主题 当前 SDK、网页后端交接与容量预演。
- **目的：** 验收当前 SDK 0.0.5 十实现全链路、网页手动发布后端契约，并首轮实测目录/上传恢复/发布阶段容量。
- **承重事实：**
  - 基点 main `eb1d054`；分支 `feat/c-platform-capacity-acceptance`；用户明确授权新分支实施、完成后本地合并 main 并删除本次分支。
  - 环境：Windows x64 10.0.26200，AMD Ryzen 9 7900X，**24 逻辑核**，内存 **33,397,465,088 字节**；三存储运行本机 Docker Desktop，HTTP 与存储走回环。
  - 普通测试基线在最新 main 实际通过 **550 项**；额外 `current-sdk.test.ts` 独立生成一次冻结候选并逐包核对 Registry 摘要；十实现公开目录、报告、截图及网关预览资源摘要一致；两个工作区外消费者分别从 Registry 精确安装 Vue/React **0.0.5** 并导入五个子路径（含趋势卡片）；未截图后重新打包；冻结 bundle 与 acceptance.json 保留于 `.tools/operations/current-sdk/<UUID>/`。
  - 网页交接 `tests/platform/web-handover.test.ts` **5 项真实 HTTP 通过**：web 手动提交在 API 重启后重用原幂等键；另一 key 不能重复占用同包版本；READY 后仍为 manual-upload/unconfirmed/pending，无自动报告、基线或 baselineCandidates；Vue 缺图、React 缺图、框架错配、伪造自动来源均在建立作业前拒绝。
  - 调用表：`POST /v1/uploads`、`POST /v1/uploads/:id/complete`（会话与 web 身份绑定、部分上传 409、完成可幂等重试）；`POST /v1/releases` + `Idempotency-Key`（必须持久化原请求/会话/key，换 key 重占包版本 409，重启不丢任务）；`GET /v1/releases/:jobId`（READY 与 baselineCandidates 独立）；`GET /v1/me/variant-releases/:releaseId`（需身份与组件权限）；`GET /v1/variant-releases/:releaseId` 及其 `/artifacts?path=`、`/reports`（只公开可读，撤回后 404/no-store）；`POST /v1/preview-grants`（需访问者身份，返回短期 bootstrap URL，预览不携带平台 token）。
  - 错误码 `SCREENSHOT_REQUIRED`、`SCREENSHOT_VARIANT_MISMATCH`、`SOURCE_FORBIDDEN`；初版测试对错误码和换 key 去重作了错误假设，读契约及实现后修正测试，未改 API 语义；根 tsc 另发现 harness 默认 UUID 推断过窄，已为幂等 key 显式标注 string。
  - 首轮容量（`scripts/pnpm.ps1 exec tsx scripts/rehearse-capacity.ts`，3 项通过、12.62 秒；runId `f4597c22-305d-45f9-9cb4-1a0de5f6678c`）：
    - 目录：隔离 PG 合成 **200 组件 / 400 实现**，**20 并发 × 10 轮**；200 响应逐项校验分页/框架/总数；0 失败；**p50 58.72ms、nearest-rank p95 84.45ms、max 94.70ms**；初始 500ms 目标通过。
    - 上传恢复：**40+40+20 MiB**、**20 个 5 MiB 分片**；3 个分片已成功后中断另一 PUT，重启 API，原会话继续补传；总 **104,857,600 字节**；3 个确认分片零重传；20 个分片完成、冻结摘要一致、完成事件仅一次；**3.45 秒**。
    - 发布阶段：**5 次**唯一合成协议样本，每次 2 包/3 实现，从 PENDING 到 READY；0 失败；**p50 488.16ms、p95/max 520.35ms**；初始 30 秒目标通过。
  - 统计实现先新增测试观察缺模块失败，再实现 nearest-rank、失败计入分母和非法样本拒绝，两项单元通过。
  - 容量限制：目录样本是直接 seed 的合成元数据，并非 400 个真实 SDK 导出；100MiB 指总提交，不放宽 50MiB 单文件限制；上传预演不覆盖 15 分钟 URL 过期后的刷新；5 次发布样本不能估计生产尾延迟，且不含构建/截图/上传/tag 后处理；全部报告 `productionAcceptance=false`。
  - 完整回归（版本 0.0.5）：`install --frozen-lockfile`（初始与升版后）均通过；`verify:workspace` 通过；`test:infra --no-restart` 通过；`turbo run build --force` **10/10、0 缓存、21.91 秒**；`turbo run typecheck --force` **14/14、0 缓存、10.713 秒**；根 `tsc` 通过；`rehearse:capacity` **3 项通过、20.25 秒**，新 runId `c3f88f40-e22d-47ed-a52a-44c6de4a0805`，目录 **p95 72.40ms**、协议发布 **p95 498.37ms**；`test:platform` **26 文件 / 86 项、184.70 秒**；`test:browser` **89 项、29.2 秒**；`test` **31 文件 / 552 项、124.55 秒**；`verify:deployment` 模板静态通过、`environmentValidated=false`、`productionAcceptance=false`。
  - 聚焦提交：`c7e65dd`（执行范围）、`1e45608`（网页后端交接）、`720f6db`（容量工具与当前 SDK 验收）、`463a805`（仅根平台 0.0.5 及 CHANGELOG）；API `0.0.4`、网关 `0.0.2`、SDK/CLI `0.0.5` 保持各包独立版本。
  - 独立审查 `eb1d054..720f6db`：无 Critical、**1 项 Important**（测试 harness 只关 S3 client 却未移除本次 UUID 临时 bucket，100MiB 预演会积累对象与未完成 multipart）、**1 项 Minor 暂缓**（容量 runner 失败时 summary 只保留 passed=false，未细分 spawn/timeout/缺文件原因，读报告失败会丢弃已读部分）。
  - 修复：先观察 close 后 HeadBucket 仍 200 而失败；修复后 HeadBucket 404、另一测试 bucket 哨兵对象仍可读；清理只用 harness 创建时捕获的精确 bucket，先中止未完成 multipart，再分批删对象并删 bucket；修复提交 `cf50ba2`；`test:platform` **27 文件 / 87 项、184.69 秒**；`test` **31 文件 / 552 项、132.07 秒**；浏览器 89 项未重复运行。
  - 本地合并：`e70a77f` 合并，合并代码树与 `ba41427` 完全一致；合并后 `test` **31 文件 / 552 项、125.44 秒**；`verify:workspace` 与根 tsc 正常退出；确认祖先已被 main 包含后 `git branch -d feat/c-platform-capacity-acceptance` 删除本次分支并核验引用不存在；未 push。
  - 架构 SHA-256 `E59BB77…`。
- **结论与状态：** 完成。容量数字为后续容量讨论的基线；生产等量 RPO/RTO 仍未验收。被 `c-main-integration-2026-11-13.md`、`c-next-round-integration-2026-11-14.md`、`c-platform-acceptance-2026-11-16.md` 覆盖。
- **交叉引用：** `t07-t08-gallery-upload-2026-11-13.md`、`t11-t12-platform-operations-2026-11-12.md`、`c-isolated-platform-2026-11-14.md`、`c-platform-acceptance-2026-11-16.md`。
- **过时或矛盾点：** 容量首轮（12.62s、p95 84.45ms/520.35ms）与完整回归（20.25s、p95 72.40ms/498.37ms）为两次不同 runId 实测，不互相重写。

### c-production-preparation-2026-11-15.md

- **日期／角色／主题：** 始于 2026-11-14，最终复核完成于 Asia/Shanghai 2026-11-15；角色 C；主题 离线生产预检与服务发布材料检查。
- **目的：** 提供 `preflight:production` 与 `verify:service-staging` 两项只读检查，为部署准备留出可复现闸门。
- **承重事实：**
  - 基线 `bea8d3f912115791a322a3448e13797dcf4e92ad`，分支 `feat/c-production-readiness`。
  - 已实现：`preflight:production` 离线检查部署模板，显式 `--environment` 才检查注入参数；缺配置报告退出码 **2**，配置/模板错误 **1**，通过 **0**，始终 `productionAcceptance:false`；固定错误信息与变量名不含环境变量值。OIDC 使用与 API 运行时同一构造校验，拒绝重复/重叠的 web/CLI client IDs、非法 audience、伪装 HTTPS 地址；数据库检查拒绝同一角色和驱动可覆盖角色的 `?user=`。`verify:service-staging` 只读检查实际导出包，校验每个服务自己的运行依赖闭包和 contracts、服务身份、入口与非空迁移文件；拒绝另一个服务、客户端/构建包、秘密文件、越界/循环链接、链接服务根与缺失依赖。
  - 失败先行：新增部署预检 4 例、staging 4 例均先失败后实现通过；实际目录反例复现链接根、秘密别名、空/目录 SQL 和畸形 manifest；实际 pnpm 导出触发 RxJS 子路径 metadata 名称的误拒绝，加入回归后允许合法 `rxjs/ajax` 元数据。
  - 独立审查两项：PG URL query 覆盖角色、预览闭包允许 API 服务；两项新增测试均先红，修正后通过；未连接生产服务、未执行导出包脚本、未输出凭据。
  - 实测：frozen install 成功；部署/预检/staging/access 四文件窄测 **29/29**；根 `tsc -p tsconfig.json --noEmit` 退出 0；根 `pnpm test`（审查修正后、兼容契约新增前）**Node 138/138、0 skip；Vitest 733/733、44 文件**；API `pnpm deploy --prod --legacy` 实际导出 **8,405 文件 / 160 包**检查通过；preview 同上 **7,966 文件 / 141 包**通过；无资源直接 Node/tsx 预检模板 passed、**27 个必填变量缺失**、environment unconfigured、**退出 2**；pnpm 包装预检/exec 报告 `exitCode=2`、外层退出 **1**（pnpm 归一化）。
  - 根测试初次 **723 通过、8 失败**，原因是 `.tools/playwright` 无对应 Chromium；按锁定 Playwright **1.65.0** 安装 chromium/headless-shell **1254** 后复跑通过；保留 `DEP0190` 既有子进程 shell 警告。
  - 实际导出位于忽略目录 `.tools/production-staging/`；完整日志 `.tools/c-round2-final-test.log`。
  - 仍未验收：公司 OIDC 登录与撤权、生产 DNS/TLS/隔离浏览器行为、Linux CI 镜像运行与供应链/最小权限、告警送达、生产等量容量与备份恢复、真实 Vue/React 双业务试点；没有推送或发布生产镜像。
- **结论与状态：** 完成（预检与部署准备）。被 `c-distribution-integration-2026-11-15.md`（`225fdf1d` 集成）、`c-platform-acceptance-2026-11-16.md`（exit 2 复现）沿用。
- **交叉引用：** `c-distribution-integration-2026-11-15.md`、`t11-t12-platform-operations-2026-11-12.md`、`c-platform-acceptance-2026-11-16.md`。
- **过时或矛盾点：** 「733/733」为兼容契约新增前计数，`c-distribution-integration-2026-11-15.md` 同期为 737/737 与 740/740，属不同提交时点。

### c-web-upload-independent-snapshots-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 C；主题 网页发布中途快照与恢复顺序补充验证。
- **目的：** 在 B 最终 Git 提交落地前，用独立归档对中途快照做多轮 RED/GREEN，固定恢复顺序与四键清理契约。
- **承重事实：**
  - 基础提交 B `cddf54b721183c4bcedf18a6d607925fc12e7afc`；16:53 快照 `.tools/operations/b-web-working-1653/source`（Git archive 导出 + 复制 B 四个未提交文件，复制前后摘要一致），明确是中途快照，不能称为固定最终 Git 版本。
  - 16:53 四文件 SHA-256：`page.tsx` `9ba460549508912cb45a7835d4d89aceb36d6578b16edaafb850afde4cb2d773`；`manifest-form.ts` `f9aa00412fd5431db0d72d6a4cb5abe71f1128fbbec6603f3f6136d3f5bd40e7`；`screenshot-validation.ts` `03fdd434404090d6497e8f75978acc783548f19cd090543e458266bbb550b8ce`；`tests/unit/web-upload-workflow.test.ts` `aec6a057add15626f4e7c9a3a8938031d27d677184383dc4e3d96ff15880203d`。
  - 离线冻结安装退出 0；`turbo run build --force` **10/10、零缓存、5.825 秒**；`NEXT_PUBLIC_SITE_URL=https://gallery.test`；测试用 C 独立 **5183** 端口，未占 B 的 5173–5176。
  - 中途 GREEN：既有显式工作流诊断 **12/12**（当时 `58a8bef` 版本，网络明确 mock）；C 恢复与摘要竞态浏览器 **12/12、13.3 秒**；新增真实三存储补充流程先 1 项 27.0 秒，按 A 只读审查意见补强后再次 1 项 25.8 秒。
  - `prepare-sdk0010-web-harness.mjs` 从归档 B 真实测试生成副本，仅改测试文件，替换为 SDK 0.0.10 批次 `dcc49e73-37c6-4579-a814-713e780ae583`，同步三包精确摘要和 5183 端口；断言：初次真实上传 201 与 release 202 使用相同且非空 `uploadSessionId`；202 后 pending/active id/active plan/draft 四键清空并保留最终 job；reload 后跨 2100ms 多个轮询周期不出现恢复按钮、release POST 仍仅一次、DB `release_jobs` 仅一条；真实 worker 到 READY、Verdaccio 可取得三个 0.0.10 版本；再次导入真实目录新上传返回不同非空 session，按隔离 MinIO 实际端口拦截 PUT 断言确实中断、页面报错、无新 release POST、作业仍一条，上传失败后保留新活跃 session 且无 pending。
  - 补强后生成 spec SHA-256 `c7615ff5e2d28527e3f2478ba4bbc1dd982b99f04f694245622e999b91391e72`；三包未重新 pack，摘要仍为 `2d9d4208…12e752`、`b01aeec7…8c01b`、`cd625741…b8e5c`。
  - 同一补强 spec 在固定旧版 `cddf54b` 上再次真实 RED：初次 201/202 完成后四个清理布尔值全部为 false，退出 1；日志 `sdk0010-lifecycle-red-reviewed.log`、`sdk0010-lifecycle-review.log`。
  - B 原浏览器用例（8 manual + 6 real）复制到独立归档实跑 **10 通过 / 4 失败 / 1.4 分钟、退出 1**（`web-suites-interim.log`）；失败为两个框架错配、legacy 恢复卡、上传接口 500；旧 fixture 的空 packages/非法摘要先被当前严格 schema 拒绝或缺少恢复三元组而被正确拒绝；已要求 B 从完整合法清单只改目标字段、补齐恢复三元组，不得为旧 fixture 放宽生产校验。
  - 恢复顺序新 RED：`exec tsx tests/acceptance/web-upload-workflow.mts '<B 源码目录>'` **11 通过 / 2 失败、退出 1**（`.tools/operations/sdk-policy-audit/b-pending-order-red.json`）：同 session 损坏 pending 虽最终拒绝但重复上传把计数从 **59 增为 118**；有效同绑定 pending 且计划过期时普通重试先访问过期上传地址报 `EXPIRED_PRESIGNED_URL`。
  - 普通再次提交真实 RED：复用 B 真实丢 202 fixture 但不刷新、不点恢复卡，只把浏览器持久化 plan 的过期元数据改成过去并拦截 PUT；最初遇原 fixture 240 秒等待上限（`normal-retry-real-red.log`），缩短重试 response 等待至 10 秒并首先断言网络计数后实跑退出 1：期望 PUT **185**、实际 **186**，失败信息 `ordinary retry must not attempt another MinIO PUT`（`normal-retry-real-red-bounded.log`）；首轮真实 201、complete 200、release 202 均已在日志确认。
  - 新版生成 spec SHA-256 `dab34757c6db9c44bbc6fdb5163ba040d26b563fd89a9ec8d50484faf2b99a2b`；`node --check` 退出 0；直接传入 B 业务工作区时按预期退出 1，没有写入 B。
  - 根 `test`：2026-11-13 17:10:08 启动，**33 文件 / 600 项通过、158.03 秒、退出 0**（`.tools/operations/sdk-policy-audit/c-root-after-web-acceptance.log`）；服务前置构建命中缓存，测试由 Vitest 实际执行、未进 Turbo 缓存。
  - 17:23 快照 `.tools/operations/b-web-working-1723/source`（同 `cddf54b` 全新导出 + B 最新四文件，未覆盖 16:53 旧快照）：`page.tsx` `af21838594e86db1686aecf6f01b69ea06bf2e278cd27d26868271e86f6d6111`；`manifest-form.ts` `ca0cbcc4d71f7ff06a4c04e1e18c830035f9c9a4ab6f42c36e0819a0631e5867`；`screenshot-validation.ts` `03fdd434…550b8ce`（同前）；`web-upload-workflow.test.ts` `bdb06af52b4304a187ba7536a795bdf9982a041de9540cf38452a48a919783a7`。
  - 17:23 结果（均退出 0）：离线冻结安装 6.8 秒；`turbo run build typecheck --force` **20/20、零缓存、6.57 秒**；根 `tsc` 与 `verify:workspace` 通过；`vitest run tests/unit/web-upload-workflow.test.ts tests/unit/screenshot-validation.test.ts` 实际匹配 **1 文件 / 26 项、422ms**（后一个路径未匹配独立测试文件，不称为第二套测试通过）；显式工作流诊断 **13/13**；C 恢复/摘要竞态 UI **12/12、13.9 秒**；`dab34757…` 补充 spec 真实生命周期与普通提交重试 **2/2、52.4 秒**。
  - 受控负例：parser 恒返回拒绝 **13 通过 / 1 失败**（`b-workflow-reject-all-red.json`）；请求 adapter 写死旧 API **13 通过 / 1 失败**（`b-workflow-wrong-api-red.json`）；同一最新版 14 项对固定真实源码快照 **14/14 GREEN、退出 0**（`b-workflow-14-green-reviewed.json`）。
  - 17:40 原手动发布 fixture 预跑：源 fixture SHA-256 `24330346e7859d297a7676e7a0986a04cb85e5eb777faf267aa492f6f1f52a15`，副本 `993c45c888189b00cd90fd467d0d2e514e2d6206282402a3c48c64f656f7e57d`；结果 **7 通过 / 1 失败、9.0 秒、退出 1**（`manual-fixture-probe-1740.log`）；唯一失败是框架错配测试期待「导入 Manifest 校验失败」而页面实际返回「导入 Manifest 失败: Manifest 原始结构校验失败」并含 `Screenshot must belong to this variant/framework/version/example/state`。
  - 17:48 修正后：源 SHA `b4cf8bf721471415d8d9596e0aedeee7e60a13a9afe6dbbe25642d6600242d9d`，副本 `d3838a06d7560958df35a5bdb5687587c650c59786575c964a195a73a247efc0`；完整 **8/8、3.4 秒、退出 0**（`manual-fixture-probe-1748.log`）。
  - 17:50 真实三存储 fixture：源 SHA `a0ce36c1d922cabd750d46095921f6a0f76966b988f054a09693b0bf1dd196de`，副本 `5bf9876384aca52ea69e2c21aa989cc4e3d6a06c5d913064dc1a9a7df66617af`；完整原 6 项 **6/6、54.5 秒、退出 0**（`real-fixture-probe-1750.log`），含真实 201/complete/202 到 READY、缺图、从完整合法清单只改框架的错配拦截、MinIO PUT 中断、丢 202 后刷新以原 key 得同 job 且数据库唯一、损坏 tarball 期望摘要不变；原套件未直接比较两次请求的 session，此限制保留。
  - A 只读交叉审查 blob `453757d9610f70ad25401520ebfd79d73b4ad49d`（SHA-256 `9ef75b15d6935ff9d5455feca31ad2ccfb8f74ebcb8cfc3e5dde1c88e813bcbb`）；SDK handover blob `c5289a6f0fce69106effbcd7bb1151faeb363bc0`（SHA-256 `e922c85d692da0d9d8d28ff6618eff5a0524035babd3c591e7f8aed37e1aa0ef`）。
  - 冻结批次 `69443f97-8b73-4ecb-91aa-d8835a0b58dc`（SDK 0.0.6）用于 RED 阶段；损坏字节用例在带 `c-web-digest-` 前缀的系统临时目录内复制材料并按路径边界校验后清理。
  - 非阻断边界（固定快照两文件只读复审）：不是多上下文草稿存储模型；最终文件校验的底层 WebCrypto 异常若直接 reject，因校验 await 位于后续 try/finally 之外，可能令页面保持提交忙碌；未把这些静态结论冒充测试执行。
- **结论与状态：** 完成（中途快照 GREEN 系列），最终 Git hash 验收由 `c-b-gallery004-final-2026-11-13.md` 完成。
- **交叉引用：** `c-web-upload-regressions-2026-11-13.md`、`t08-web-upload-cross-review-2026-11-13.md`、`c-b-gallery004-final-2026-11-13.md`、`t08-real-web-upload-2026-11-13.md`、`t08-web-upload-hardening-2026-11-13.md`。
- **过时或矛盾点：** 全部「中途 GREEN」绑定 17:23 文件 SHA 快照，不得替代最终 Git hash；16:53/17:23 两套摘要不可混用。

### c-web-upload-regressions-2026-11-13.md

- **日期／角色／主题：** 2026-11-13；角色 C；主题 网页恢复与摘要竞态回归的 RED 记录。
- **目的：** 为 B 的恢复顺序与摘要竞态修复提供独立 RED 证据，保留失败痕迹。
- **承重事实：**
  - 三个测试入口：`tests/acceptance/web-upload-workflow.mts`（指定源码目录的 **12 项**工作流诊断，网络/上传/存储接口显式 mock）；`tests/acceptance/web-upload-recovery.spec.ts`（**11 项**真实 Chromium UI，API 显式 mock；覆盖 legacy 缺字段、API/subject/清单不一致、点击时重新检查、原请求重放/四键清理、reload 及同页切换用户）；`tests/acceptance/web-upload-validation.spec.ts`（**1 项**真实目录/真实 Web Crypto 摘要的异步竞态测试，只延后一个真实摘要结果的交付，不伪造摘要值，不提交网络发布作业）。
  - `tests/acceptance/playwright.web-upload.config.ts` 仅收集上述两份 `web-upload-*.spec.ts`；默认启动 5173 生产画廊；`WEB_UPLOAD_PORT` 可用独立端口；`WEB_UPLOAD_ORIGIN` 可指向已启动服务；工作流脚本是显式执行的独立探针，不会由 Playwright 或根 test 自动收集。
  - B 旧固定提交 `cddf54b721183c4bcedf18a6d607925fc12e7afc`；C 经 Git archive 导出 `.tools/operations/b-web-native-cddf54b/source`；离线冻结安装退出 0；`turbo run build --force` 实际 10/10、零缓存。
  - 冻结材料 `69443f97-8b73-4ecb-91aa-d8835a0b58dc`（SDK 0.0.6）只读复用，未重新 pack；浏览器用 5183。
  - 三次阶段性执行（均先设冻结目录与端口环境变量）：最初 **8 项恢复 UI 全部按预期失败**；追加 **3 项点击 handler 检查全部按预期失败**；摘要竞态用例在最终「保持禁用」断言真实失败；日志 `recovery-red.log`、`recovery-handler-red.log`、`digest-race-red-settled.log`，均退出码 1。
  - 竞态时序：合法快照 A 的一个摘要结果延后；导入同名但错字节 tarball 的快照 B，页面先显示 `DIGEST_MISMATCH` 并禁用按钮；放回 A 的真实摘要后旧空错误列表覆盖 B，提交按钮错误启用；测试等待全部摘要 promise 完成、React 刷新，并加连续 **12 帧**的禁用采样。
  - 另两个独立工作流反例先在 B 中途源码实跑 RED：同 session 损坏 pending 会换新幂等键继续 POST；无 pending 的上传失败后重试会复用过期 URL；原始诊断 `b-recovery-edge-red.json` 保留在 `.tools/operations/sdk-policy-audit/`。
  - C 测试质量检查：根 `tsc --project tsconfig.json --noEmit --pretty false`、`verify:workspace`、`git diff --check` 均退出 0；独立审查曾指出 pending 凭据保留断言与摘要 promise 完成时点不足，已补完整 pending/active id/plan 原样保留、release 使用新 session、等待全部 settled 及稳定帧采样。
- **结论与状态：** 完成（RED 留痕）。对应 GREEN 见 `c-web-upload-independent-snapshots-2026-11-13.md` 与 `c-b-gallery004-final-2026-11-13.md`。
- **交叉引用：** `c-web-upload-independent-snapshots-2026-11-13.md`、`t08-real-web-upload-2026-11-13.md`、`t08-web-upload-hardening-2026-11-13.md`、`t08-web-upload-cross-review-2026-11-13.md`。
- **过时或矛盾点：** 本篇 RED 不代表 B 最终网页版本已验收（原记录自述）。

### cli-0011-integration-repairs-2026-11-16.md

- **日期／角色／主题：** 2026-11-16；角色 C；主题 集成后的 CLI 独立版本与 API 证据绑定修复。
- **目的：** 修复 CLI 拒绝独立包版本与 API 聚合版本不匹配的问题，并补齐 help。
- **承重事实：**
  - 基线 `93022ee5`，沿用用户授权的 C 集成分支；A/B/D 已按批准顺序合并。
  - 修复：CLI 接受冻结清单中各包独立版本；同版时 `bundle.version` 为单版本，不同版时按 manifest 顺序以 `, ` 连接 `name@version`，与包内探针一致；API 从已发布的权威 manifest 重建相同聚合版本，继续逐包核对名称/版本/SHA-256/bytes；单个 wrapper 的版本不能冒充 bundle 身份；`echarts verify --help` 补齐 consumer-root、keep、timeout、skip-browser。
  - 验证表（固定 Windows Node 26.13.0 / pnpm 12.18.0）：`exec vitest run tests/unit/echarts-cli.test.ts` **RED 2 failed / 9 passed**（命中旧同版本限制与 help 缺项）→ **GREEN 11 passed**；`exec vitest run tests/integration/compatibility-api.test.ts` **RED 真实 HTTP 返回 400 REPORT_MISMATCH（预期 201）** → **GREEN 1 passed**（含单包/反序聚合拒绝、正确聚合接受及持久化）；`--filter @company/component-cli build` exit 0，分发探针 **73 文件**，清单检查通过；`--filter @company/component-cli typecheck` exit 0。
  - API 测试使用严格冻结 SDK `.tools/operations/next-sdk-handoff-zQIRda`（core 0.0.10、Vue/React 0.0.11）；manifest SHA-256 `917f195aaa1deb12c30ad55a482241cbfd1182173777f4757edfbeff523c997d`。
  - 日志：`.tools/next-cli-red.log`、`next-cli-green.log`、`next-api-red.log`、`next-api-green.log`、`next-cli-build.log`、`next-cli-typecheck.log`。
  - 边界：上述结果只覆盖本次修复；新版本号、冻结 CLI、新消费者 56 组合 hold/adopt、真实回退和 installed-compatibility 另行记录；原 SDK 和 CLI 0.0.10 tarball 保持不变。
- **结论与状态：** 完成（本次修复范围）。被 `rollback-sidecar-repairs-2026-11-16.md`、`four-agent-merge-cleanup-2026-11-16.md`、`next-round-final-gates-2026-11-16.md` 纳入全图。
- **交叉引用：** `c-next-round-integration-2026-11-16.md`、`rollback-sidecar-repairs-2026-11-16.md`、`four-agent-merge-cleanup-2026-11-16.md`、`next-round-final-gates-2026-11-16.md`。
- **过时或矛盾点：** 修复后未重新冻结 CLI/跑 56 组合，故 CLI 0.0.10 tarball 仍代表旧行为（后续 `next-round-final-gates` 才升 CLI 0.0.11）。

### four-agent-merge-cleanup-2026-11-16.md

- **日期／角色／主题：** 2026-11-16；角色 C（Codex）；主题 A/B/D 合并与历史工作树清理。
- **目的：** 按用户授权顺序合并 A→B→D，保留冲突节语义，并尝试清理三处历史工作树。
- **承重事实：**
  - 主仓库 `D:/project/zhinexus-design-asset-platform`，分支 `feat/t13-c-matching`，起点 `b13c8aee7c248c5b4a24ae7322bb865e87e3c84c`。
  - 合并表：A 来源 HEAD `60a023737c2a08c269a4539f70b0a6f06d14520d` → 合并提交 `0bdc450d1c7db8dcd21b5bd6964cc0d416f7b7f3`；B `cb7406c2a9396877089499d2880f4522f836cb53` → `4ff9ef8ec333839e075d3af3db3b890f299305d2`；D `7bbb769805c104ffc415a9965180adbcd40d15d4` → `9bc73d42cecfe4920f5c90a93e776ad1a7e0d988`。
  - A 自动合并；B 的 CHANGELOG 冲突保留 SDK Vue/React 0.0.11 与 CLI 0.0.10 两节；D 的 README 冲突保留 A、D 及已有 B 说明；D 的 `design-cases.json` 与 runner 对齐，A 的评估器及 `id-matching-boundary.test.ts` 保留；未变更 contracts、API、preview-gateway、根配置或锁文件。
  - 导入文件原有 EOF 空行保留：`a-t13-id-eval-2026-11-16.md`、`b-t13-match-ui-2026-11-16.md`、`d-t13-eval-gaps-2026-11-16.md`、`id-matching-boundary.test.ts`；A/B 合并暂存检查用 `git -c core.whitespace=-blank-at-eof diff --cached --check`，不将普通 `git diff --check` 描述为零告警。
  - 环境变量：`A10_FROZEN_BUNDLE` = `D:\project\zhinexus-design-asset-platform\.tools\operations\next-sdk-handoff-zQIRda`；`ZHINEXUS_SDK_BUNDLE_DIR` 同值；`NEXT_PUBLIC_SITE_URL=https://gallery.test`。
  - 命令表（均以 `.\scripts\pnpm.ps1` 为前缀）：`install --frozen-lockfile` 通过；`verify:workspace` 通过；`exec turbo run build --force` **10/10、0 cached、17.467 秒**；`exec turbo run typecheck --force` **14/14、0 cached、3.864 秒**；`exec tsc -p tsconfig.json --noEmit` 合并后及夹具调整后均通过；`test:t10`（A 合并后）**168/168、0 skipped**；`exec vitest run tests/unit/sdk-lifecycle.test.ts tests/evaluation/id-matching-boundary.test.ts`（串行重跑）**2 文件 10/10**；B 的 7 个专项文件（`tests/integration/cli-bundle-tamper-orchestration.test.ts`、`cli-check-tamper-orchestration.test.ts`、`tests/unit/release-acceptance-chain.test.ts`、`release-fingerprint.test.ts`、`baseline-cli.test.ts`、`baseline-compare.test.ts`、`web-upload-workflow.test.ts`）**7 文件 70/70**；`exec vitest run tests/evaluation` **6 文件 71/71**；`exec vitest run tests/integration/compatibility-api.test.ts`（夹具修正）**1/1、38.76 秒**；`test`（夹具修正后）**T10 168/168、0 skipped；Vitest 69 文件 1107/1107、218.89 秒**；`test:browser` **260/260、1.2 分钟**。
  - 失败记录：①合并前 C 的 `test` 在旧 T10 阶段失败（166 项中 159 通过、7 失败、0 跳过），因旧读取器拒绝 core 0.0.10 + Vue/React 0.0.11 组合，A 的提交含修复，合并后同冻结目录 `test:t10` 168/168；②A 窄 Vitest 首次与 T10 并行时 Vue 首次动态导入用例超过默认 5000ms（**8688ms**），9 通过 1 失败，未改用例或放宽超时，单独重跑 10/10（不证明超时成因已消除）；③三方合并后第一次完整 `test`：T10 168/168，Vitest 68 文件通过、1 文件失败，**1106 项通过、1 项失败（228.14 秒）**，`compatibility-api.test.ts` 合法夹具预期 201 实际 400；④加响应体诊断后单独复现 RED，响应 `COMPATIBILITY_EVIDENCE_REQUIRED`，其 helper 把 core 版本写成 Vue 的 0.0.11 而实际 core 为 0.0.10，API 按 manifest 拒绝正确；⑤仅改测试 helper，按 `bundlePackages` 逐包读 core 与 wrapper 版本并保留另一框架为 null，保留错误版本反例，用 `clone().text()` 显示失败诊断，窄测 GREEN 1/1；不修改 API、不伪装真实探针输出、不触发产品升版。
  - 清理对象仅限 A/B/D 三处历史工作树（路径 `C:/Users/10208/.codex/worktrees/t13-a-eval|t13-b-match-ui|t13-d-eval-pipeline/zhinexus-design-asset-platform`，来源分支 `feat/t13-a-eval`、`feat/b-release-acceptance-20261116`、`feat/t13-d-eval-pipeline`）；三处均已核实干净且 HEAD 与批准来源一致，`git merge-base --is-ancestor <来源 HEAD> HEAD` 均成功。
  - 备份目录 `D:/project/zhinexus-design-asset-platform/.tools/worktree-archives/20261116-merge-abd`：`merged-history.bundle` 含 A/B/D/C 四分支完整历史，`git bundle verify` 通过，**2253289 字节**，SHA-256 `48244343E5348C6D91AB0801F2510920F7100D936B4DBD7476D1FCC8E23E9815`；`snapshot.json` 记录源路径、HEAD、主仓库 HEAD 及 **403 个受保护文件**的字节数和 SHA-256；三处 `.tools` 均为指向主仓库 `.tools` 的 Junction，移除前仅解除链接本身。
  - 清理状态：**未删除，工具策略阻止清理**。续接时三来源工作树仍干净、HEAD 一致、均已包含在 C `6e378841` 历史中；终端批量清理命令被自动审批拒绝，缩小为仅移除 A 工作树 `.tools` Junction 的单一 `Remove-Item -LiteralPath ... -Force` 仍被拒绝，两次均仅返回 `blocked by policy`；`attach_worktree` 对 A 工作树返回 `This worktree is owned by another task.`；`list_artifacts` 为空；Computer Use 只读取应用清单并返回 ChatGPT 桌面窗口，其已读取技能的 `docs/guidance.md` 明确禁止自动操作 ChatGPT desktop app UI，因此未操作该窗口。
  - 续接执行 `verify:workspace` exit 0。
  - 新增静态核对：A `bundle.mjs` 已将混合版本写为按 manifest 顺序拼接的 `name@version` 文本，`probe.mjs` 原样写入 `evidence.bundle.version`；API `compatibility/service.ts` 仍将该值与单包 `row.package_version` 比较，真实混合版本报告预计得到 `REPORT_MISMATCH`；本轮未动态验证或修改该后续接入分支。
  - 仍未完成：CLI 0.0.10 对独立包版本的拒绝、顶层报告版本计算及 consumer-root/keep/timeout/skip-browser 帮助信息；回退脚本仍硬编码 wrapper 0.0.10 且失败后清理；`current-sdk.test.ts` 向冻结目录写诊断；installed CLI 真实 56 组合 hold/adopt、ECharts 6.0.0 strict/legacy/rollback 及 `test:installed-compatibility`；G2 外部 OIDC、独立预览域、生产配置，T13/T14 真实规则/导出/标注。
  - 架构 SHA-256 `E59BB77…`；冻结 SDK manifest SHA-256 `917F195AAA1DEB12C30AD55A482241CBFD1182173777F4757EDFBEFF523C997D`。
- **结论与状态：** 部分完成——合并与全图回归完成（test 1107/1107、browser 260/260），工作树清理被工具策略阻止未执行。被 `cli-0011-integration-repairs-2026-11-16.md`、`rollback-sidecar-repairs-2026-11-16.md`、`next-round-final-gates-2026-11-16.md` 延续。
- **交叉引用：** `c-next-round-integration-2026-11-16.md`、`cli-0011-integration-repairs-2026-11-16.md`、`rollback-sidecar-repairs-2026-11-16.md`、`next-round-final-gates-2026-11-16.md`。
- **过时或矛盾点：** 静态核对的 `REPORT_MISMATCH` 风险与 `cli-0011-integration-repairs` 的 GREEN 属同一问题的两个时点（修复后已聚合接受，但未用真实混合版本报告复跑）。

### next-round-final-gates-2026-11-16.md

- **日期／角色／主题：** 2026-11-16；角色 C；主题 集成修复全图门禁与审查。
- **目的：** 在含 A→B→D 合并、CLI/API 独立版本绑定、回退留证与旁置诊断修复的代码基线上跑完整门禁，并落实独立审查更正。
- **承重事实：**
  - 代码基线 `f9555bc1`；固定 Windows Node 26.13.0 / pnpm 12.18.0；架构 SHA-256 `E59BB77…`。
  - 进程设置 `TURBO_FORCE=true`、`NEXT_PUBLIC_SITE_URL=https://gallery.test`，`A10_FROZEN_BUNDLE` / `ZHINEXUS_SDK_BUNDLE_DIR` 均指向 `.tools/operations/next-sdk-handoff-zQIRda`。
  - 门禁表：`install --frozen-lockfile` exit 0；`verify:workspace` exit 0；`build` **10/10 成功、0 cached**；`typecheck` **14/14 成功、0 cached**，根 tsc 通过；`test` **T10 168 passed / 0 failed / 0 skipped；Vitest 70 文件、1113 项通过**；`test:browser` **260 passed**。
  - 日志：ignored `.tools/next-full-{install,verify-workspace,build,typecheck,test}.log`、`.tools/next-full-browser-green.log`、`.tools/next-full-browser.log`。
  - 浏览器首跑单独进程遗漏 `ZHINEXUS_SDK_BUNDLE_DIR`：**254 passed / 2 failed / 4 did not run**，明确报 `MISSING_ENV`；补齐同一冻结输入后完整重跑得上表结果，首跑日志保留。
  - 独立只读审查 `b13c8aee..f9555bc1` 确认 **1 项 Important**：ID 交接文档把 `DesignIdInputV1` 当成完整 POST 请求，遗漏必填 `design`/`context`，导致 `INVALID_SCHEMA`；已改为完整 JSON 示例，补 `context` 必需字段、可选 `bindings`/`reactDomVersion`，并指向 `match-plan.ts` 契约。
  - 以固定 Node 执行 `.tools/next-review-doc-check.mjs`：旧形态明确拒绝并定位 /design、/context 缺失；从更正文档提取的 JSON 通过真实 `validateMatchPlanRequest`；该修改仅文档，不增产品行为或永久测试。
  - 审查未发现其他可操作问题；未评判的实际冻结 CLI 矩阵、回退、installed API 接受继续以新候选实测记录为准，不能用本门禁代替；G2 外部服务和真实 ID 业务样本依旧未完成。
  - 执行裁定：①获授权合并后由 C 内联完成交接修复（A/B/D 已停写，改前核查干净状态）；②Windows 下按既有叙述计划维护执行台账，未重新生成任务 brief；③先完成代码审查再冻结 CLI，以免发现修复后不得重打包的候选需要废弃；④按现有独立包版本惯例将 **CLI 0.0.10 → 0.0.11、API 0.0.7 → 0.0.8**，根整体版本维持 **0.0.5**（整体平台发布门槛未完成，外部验收不因此关闭）。
- **结论与状态：** 完成（集成修复全图门禁 + 文档审查更正）。被 `rollback-sidecar-repairs-2026-11-16.md` 与后续四方/评测记录延续；本主题内最新全图绿。
- **交叉引用：** `cli-0011-integration-repairs-2026-11-16.md`、`rollback-sidecar-repairs-2026-11-16.md`、`four-agent-merge-cleanup-2026-11-16.md`、`c-next-round-integration-2026-11-16.md`。
- **过时或矛盾点：** 根整体版本 0.0.5 与 CLI 0.0.11/API 0.0.8 并存，是有意的独立包版本惯例，不是漏升。

### rollback-sidecar-repairs-2026-11-16.md

- **日期／角色／主题：** 2026-11-16；角色 C；主题 回退留证与冻结目录旁置诊断修复。
- **目的：** 让回退脚本从真实冻结包取期望版本并在失败时留证，把平台诊断从冻结目录内移到旁置文件。
- **承重事实：**
  - 在已授权的 C 集成分支接续实施，不改写旧报告与旧冻结产物。
  - 变更：①回退脚本在安装前重新读取真实冻结 manifest/tarball，将首轮报告的聚合版本、包数、唯一名称及各包 version/SHA/bytes 与其绑定；恢复 core/Vue/React 的预期版本来自冻结包，去除统一 0.0.10 假设；②候选安装失败或恢复失败时仍尝试两消费者的恢复，保留两者目录和 `passed: false` 报告，仅全部成功后执行带 ownership 校验的清理；报告增加基线报告摘要与冻结清单摘要；③新平台诊断使用 `${bundleDir}.acceptance.json` 独占写入，记录实际 manifest SHA 和三包 SHA/bytes，完成后重跑严格目录校验；旧目录内已有诊断保留，严格校验仍拒绝未声明文件；④为现有 JavaScript 运维入口补声明，使 TypeScript 回归测试无需关闭严格类型检查。
  - 命令表（前缀 `scripts/pnpm.ps1`）：`exec vitest run tests/unit/t10-rollback.test.ts` **RED 4 failed → GREEN/最终 4 passed**；`exec vitest run --config tests/platform/vitest.config.ts tests/platform/current-sdk.test.ts` **RED 1 failed（明确命中 UNEXPECTED_FILE）→ GREEN 1 passed，59.80s**；`exec tsc --project tsconfig.json --noEmit` 初次准确发现新测试缺 `.mjs` 声明，补齐后 exit 0。
  - 回退单测模拟 npm/构建行为，实际测试 ownership、冻结文件摘要、清单/锁字节恢复与失败目录留存，**不能替代真实回退**。
  - 平台专项实际完成本机三存储发布、14 个隔离浏览器预览、Vue/React 精确注册表安装和发布材料严格复核；新诊断 `.tools/operations/current-sdk/9d8cfd37-e082-49b4-991f-03ab969bd974.acceptance.json`，是专项新建材料，不替换随后 T10 使用的 `next-sdk-handoff-zQIRda`；测试只用本地签名 OIDC 夹具和测试 TLS，G2 外部接入未验收。
  - 日志：`.tools/next-rollback-{red,green,final}.log`、`.tools/next-sidecar-{red,green}.log`、`.tools/next-root-tsc{-green}.log`。
  - 待验收：CLI 新冻结候选的 56 组合与真实双消费者回退仍须单独执行；历史工作树清理仍被自动审批阻止（详见 `four-agent-merge-cleanup-2026-11-16.md`）。
- **结论与状态：** 完成（本修复范围）。是 `c-next-round-integration-2026-11-16.md` 五项前置中第 3、4 项的落地；真实 56 组合/回退仍开放。
- **交叉引用：** `c-next-round-integration-2026-11-16.md`、`four-agent-merge-cleanup-2026-11-16.md`、`cli-0011-integration-repairs-2026-11-16.md`、`next-round-final-gates-2026-11-16.md`、`c-next-round-integration-2026-11-14.md`。
- **过时或矛盾点：** 无（RED/GREEN 与边界均明示）。

## 历史脉络

**2026-11-12（T04 收口、T05 四路并进、T06/T07/T11/T12 起步）。** 当天 B 先交付 T04 第二批 `component check` 本地闭环（窄测 8/8、浏览器 3/3、集成 6/6；`verify.ps1` Vitest 16 文件 208 用例 + Playwright 18 用例；CLI 升 0.0.2），并把 T04 扩到折线/柱状/饼图/散点四组件双框架 8 变体的完整发布材料、真实 Vite 静态预览与 Verdaccio 幂等发布（`cli-bundle` 3 用例、`cli-release` 1 长跑经 `http://127.0.0.1:14873/` 精确安装 `@company/charts-vue@0.0.4` 并输出 `VERDACCIO_INSTALL_VERIFIED_SUCCESS`；`tests/integration` 9 文件 246；`verify.ps1` 468 + 71；`test:platform` 18 文件 62；CLI 升 0.0.4）。C 同日起并行推进 T05 四个子任务：认证（`OidcVerifier` 失败关闭，jose `6.2.17` 仅 RS256/ES256，JWKS 5 秒超时/5 分钟缓存/30 秒冷却，测试从 1 走到 37/60(97)、97/97、101/101 直至 **103/103**，根 `test` 19 文件 330）、产物字节校验（`validateUploadedArtifact`/`validatePlatformBundle` 上限 10 MiB/8192 边长、50 MiB/500 MiB/5000 文件、gzip 200 MiB、ustar/PAX 归档安全、条件导出解析经 Node 26.13.0 `--experimental-import-meta-resolve` 探针实测，测试 54/54 → 93/93 → 98/98 → **107/107**）、平台真实 HTTP/存储（Nest + OIDC、PG advisory lock 迁移、MinIO 5 MiB 分片、`LEASE_LOST`、真实 SDK 材料 1/1 登记 4 个 PENDING，依赖固定 `pg 8.23.1`、`jose 6.2.17`、S3 `3.1167.0`、`tar-stream 3.2.2`、`pngjs 7.0.0`、`jpeg-js 0.4.4`）、登记引用与隐藏权限审计（`003_evidence_references.sql` 改服务端 UUID + `client_ref`，RED 3 文件 5 败 1 过 → GREEN 7 文件 16）。`t05-final` 在分支 `feat/t05-platform` 收口，平台根/API 升 `0.0.1`，合并提交 `42045c0`；`verify.ps1` 466 + 46、`test:platform` 8 文件 18、`test:infra` report `7b6790d4…`，主分支复验遇 `.tools/bin/pnpm.cmd` 缺失（457 过、9 消费者未执行）与 `.tools` 目录丢失（18 项凭据失败，轮换本地密码后 report `f8a89f45…`）。C 同日交付 T06 可恢复三存储发布 worker（分支 `feat/t06-release-worker`，基线 `6da7e1c`，平台根/API `0.0.2`；迁移 004、60 秒租约/20 秒续租、fencing token、5 次有界重试；租约/迁移 4/4、注册表 HTTP 14/14、worker 恢复与 tag 12/12、`test:platform` 13 文件 35 项、`verify.ps1` 480 + 46、`test:infra` report `fa2464b5…`；独立审查 `6da7e1c..5a86a3a` 3 Important 由 `57252f6` 修复；干净隔离工作树合并提交 `4c48869`），并实测 Verdaccio 7.1.0 `normalizePackage` 在缺 latest 时合成最高版本 latest。T07 同日双线启动：C 侧 `feat/t07-catalog-preview`（基于 main `3bbf687`）交付公开/用户态目录、精确发布详情与独立预览网关（`test` 25 文件 521、`test:platform` 18 文件 62、`test:browser` 71；独立审查 3 Important 修复后 `ca6e162`/`dae635a`/`3954a43` 复核通过；平台/API `0.0.3`、网关 `0.0.1`），B 侧 `t07-gallery-ui` 用 React 19 + Next.js 16.4.6 实现 `/components` 目录、详情、状态看板与沙箱 iframe（`gallery-rendering.spec.ts` 6 项、`test:browser` 74、`test:platform` 18 文件 62）。T11/T12 运维准备同日从 main `617e967` 起步（白名单日志、受保护指标、真实故障恢复、三存储备份恢复、部署模板；`test` 29 文件 528、`rehearse:recovery` 19 项、`rehearse:backup` 1 项 28.93 秒、`test:platform` 23 文件 77、`test:browser` 71；独立审查 1 Important 由 `5d6cc24` 修复）。

**2026-11-13（T07 合并、T08 真实网页上传与回归链）。** B 的 `feat/t07-t08-gallery-upload` 把画廊接上真实 API、`POST /v1/preview-grants` 授权预览与 `/upload` 逐实现必检（`manual-release` 5 项、`test:browser` 94、`web-handover` 5 项、`test:platform` 27 文件 87），并在独立工作区 `D:\project\zhinexus-design-asset-platform-b`（基线 `885792b`，分支 `feat/t08-real-web-upload`）以 7 组件 14 实现废除演示数据，走通真实 E2E 6 项（49.5s）：201 → 185 个产物文件直传 → complete 200 → release 202 → 五阶段 → `release_jobs` 原子 `READY`，丢 202 恢复后 DB 仅 1 作业（幂等键 `web-1794551727694-xlx3hc8w`），坏 tarball 报 `DIGEST_MISMATCH`；同时实测 MinIO `PutBucketCorsCommand` 501 而原生 OPTIONS 204。硬化篇 `t08-web-upload-hardening` 增加网络副作用前 pending 重放、`TAMPERED_PENDING_RELEASE`、三元组强隔离与四键彻底清理（`web-upload-workflow` 26 项、E2E 6 项 39.5s）。C 侧当天连续落地：`c-gallery-cors` 修复 API 跨域（`OPTIONS /v1/releases` 原 404，改精确 Origin 白名单，预检 204、匿名发布仍 401；`api-cors` RED 4/2 → GREEN 6/6）；`c-main-integration` 把运维分支与 main `89d2511` 无冲突合并（`8987f84`，合并提交 `c737e8f`；`test` 30 文件 529、`test:platform` 23 文件 77、`test:browser` 74）；`c-platform-capacity` 验收 SDK 0.0.5 十实现全链路并首轮实测容量（目录 200 组件/400 实现 20 并发×10 轮 p95 84.45ms、上传恢复 104,857,600 字节/20 个 5 MiB 分片/3.45s、发布阶段 p95 520.35ms；`test:platform` 27 文件 87、`test` 31 文件 552、`test:browser` 89；修复 `cf50ba2`）；`c-cli-release-isolation` 用随机端口 `createRecoveryStack()` 消除固定 14873 端口与共享凭据依赖（该文件 1/1、根 `test` 33 文件 600 项全过）。网页上传的验收争议由 A 的只读交叉审查 `t08-web-upload-cross-review`（HEAD `e57a6ba`）钉死「14/14 GREEN 属 B 的 17:23 文件 SHA 快照而非 Git 提交」，C 随后以 `c-web-upload-regressions`（B 旧 `cddf54b` 归档 RED：8 恢复 UI 全败、3 handler 全败、摘要竞态 12 帧采样失败）、`c-web-upload-independent-snapshots`（16:53/17:23 两套四文件 SHA 快照，PUT 185→186 RED、17:40 的 7/1、17:48 的 8/8、17:50 的 6/6、根 test 600 项）逐轮取证，最终 `c-b-gallery004-final` 在 B 最终 hash `1624fa3`（gallery 0.0.4，fix `d2f1fa7`）的独立归档上取终态：C UI 12/12、原 manual 8 + real 6 = 14/14、C 真实补充 2/2、`web-upload-workflow.mts` 14/14、单元 2 文件 32 项，但根 test 为 620 过 1 败（`cli-release.test.ts` 缺共享凭据）。

**2026-11-13 深夜至 2026-11-14（隔离化与 A/B/C 下一轮集成）。** `c-isolated-platform` 把平台专项改为 Vitest globalSetup 内存注入自建 `RecoveryStack`，去掉固定端口 15432/19000/14873 与共享凭据（`test:platform` 28 文件 88/88、`test` 38 文件 692/692、SDK 0.0.10 权威 Bundle 199 文件 14 实现 0 不匹配）；`c-image-atomic-review` 把 `images.json` 登记改为同盘暂存 + 硬链接无覆盖原子发布（RED 1/8 → GREEN 2 文件 10/10、`test` 38 文件 693/693）。`c-next-round-integration-2026-11-14` 集成 C 平台隔离、B 第一阶段与 A 多版探针：A 探针从首份 Windows 失败（51 项中 46 过 5 败）经第二版 `CANDIDATE_INTEGRITY_UNVERIFIED`、第四版、第五版修到 `node --test` 117/117、`test:t10` 138/138；官方源真实矩阵 6.1.0 首轮 `PROBE_HOLD` → 显式 baseline 复验 `adopt` 且 **56/56 视觉 PASS**，6.0.0 strict/strict-only `PROBE_FAILED`、legacy 后两框架 Bundler/NodeNext 类型失败仍 `PROBE_HOLD`；回退脚本一度 exit 1（`src/a-t10-echarts-registry.ts:9` 的 Element/HTMLElement，TS2345/TS2740），第五版改 `element instanceof HTMLElement` 后双消费者回退 `passed: true`（ownership run ID `6d49c39c…`）；本地合 main 合并提交 `299f9b8393f844c2c0ddae4248b652604cabfb01`，main 复验 build/typecheck 20/20、`test` Node 138/138 + Vitest 42 文件 719/719、`test:browser` 195/195，锁文件 SHA `8001977F…`。

**2026-11-15（分发与生产准备集成）。** `c-production-preparation`（始于 11-14，最终复核于 11-15）交付 `preflight:production`（退出码 2/1/0，恒 `productionAcceptance:false`）与 `verify:service-staging`（API 8,405 文件/160 包、preview 7,966/141），窄测 29/29、根 test Node 138/138 + Vitest 733/733；期间根测试初次 723 过 8 败，按锁定 Playwright 1.65.0 安装 Chromium revision 1254 后复跑通过。`c-distribution-integration` 集成 A/B/C：真实安装包 CLI `0.0.8`（201,353 字节/183 文件，SHA `1f8188fc…`）自检 121/121，56 组合 hold→adopt，兼容 API `test:installed-compatibility` 1/1（201/409/400，199 个 artifact 核对）；根 test Node 166/166 + Vitest 46 文件 737/737（修复后 159+7 skip / 740/740）、`test:platform` 28 文件 88/88、`test:browser` 195/195、`pnpm deploy` API 8,422/160 与 preview 7,970/141、预检 27 变量缺失退出 2；独立审查七类问题全关，结论 **Ready to merge: Yes**；main 合并 `2c3ec76e…`。

**2026-11-16（四方集成、混合版本修复与全图门禁）。** `c-next-round-integration-2026-11-16` 冻结严格 SDK 交接副本 `next-sdk-handoff-zQIRda`（core 0.0.10 + Vue/React 0.0.11，manifest SHA `917f195a…`，199 文件），实测已安装 CLI 0.0.10 对混合版本 exit 1 `INVALID_BUNDLE_MANIFEST`（「三个包版本必须一致，当前为: 0.0.10, 0.0.11」），并演练 D 的 ID runner（合成 exit 1、`real=0`）；`c-platform-acceptance` 在 `feat/t13-c-matching` 复验 C 基线（平台 13 文件 57 测试、`test` Vitest 62 文件 1041 项、preflight exit 2、`infra:check-access` exit 2）。随后 `cli-0011-integration-repairs` 让 CLI 接受各包独立版本并按 manifest 顺序复算 `bundle.version`（`echarts-cli.test.ts` RED 2/9 → 11 passed；`compatibility-api.test.ts` RED 400 `REPORT_MISMATCH` → 1 passed），`rollback-sidecar-repairs` 让回退脚本从冻结包取期望版本并在失败时留证、诊断移至 `${bundleDir}.acceptance.json`（`t10-rollback` RED 4 → 4 passed、`current-sdk` RED `UNEXPECTED_FILE` → 1 passed）。`four-agent-merge-cleanup` 按 A→B→D 顺序合并（`0bdc450d`/`4ff9ef8e`/`9bc73d42`，起点 `b13c8aee`）：`test:t10` 168/168、B 专项 7 文件 70/70、`tests/evaluation` 6 文件 71/71、`test` T10 168/168 + Vitest 69 文件 **1107/1107**、`test:browser` **260/260**；失败均定位并修（旧读取器拒混合版本、Vue 动态导入 8688ms 超 5000ms 单独重跑 10/10、compat 夹具把 core 写成 0.0.11 致 400）；备份 bundle 2253289 字节（SHA `48244343…`）+ 403 个受保护文件复核一致，但三处历史工作树清理两次被 `blocked by policy` 拒绝、`attach_worktree` 返回 `This worktree is owned by another task.`，未能删除。最后 `next-round-final-gates` 在基线 `f9555bc1` 跑出全图绿（build 10/10、typecheck 14/14 + 根 tsc、`test` T10 168/0/0 + Vitest 70 文件 **1113 项**、`test:browser` **260**；浏览器首跑漏 `ZHINEXUS_SDK_BUNDLE_DIR` 得 254/2/4 `MISSING_ENV`，补齐后重跑），并落实独立审查 1 项 Important（ID 交接文档缺 `design`/`context`，改为完整 JSON 并经 `validateMatchPlanRequest` 验证）；按独立包版本惯例升 CLI 0.0.11、API 0.0.8，根整体版本维持 0.0.5。至此本主题的技术侧集成链全部走完，剩余闸门全部在仓库之外（外部 OIDC/预览域、生产镜像与容量、T10 新候选实测、工作树清理）。
