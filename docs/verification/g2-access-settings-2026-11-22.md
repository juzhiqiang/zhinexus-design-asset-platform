# G2 接入设置本地交付与审查复验

执行位置：`C:/Users/10208/.codex/worktrees/g2-access-settings/zhinexus-design-asset-platform`，分支 `feat/g2-access-settings`。依据 [实施计划](../superpowers/plans/2026-11-22-g2-access-settings.md) 与 [已批准设计](../superpowers/specs/2026-11-22-g2-access-settings-design.md)。本记录为新增证据，不修改历史验收记录。

本轮由 C 收口 contracts、迁移、API、网关、根配置与运维；B 范围的 CLI 和画廊按顺序实施。实现五项计划的配置能力和本地闭环。真实公司账号、组织认可的撤权时限、生产 DNS/TLS、生产凭据和双业务试点仍是外部 G2 输入，G2/T01 不因此关闭。

## 交付范围

- PostgreSQL 独立管理 OIDC/预览草稿、不可变配置正文与启用历史、活动代数、逐项证据和审计。保存、验证、启用、恢复均执行正文 CAS 和独立部署管理员检查。
- Web 服务端 PKCE、浏览器绑定、state/nonce/issuer/audience/client/签名验证；CLI S256 与固定 `127.0.0.1` 回环。候选 Web/CLI 只记录证据；普通会话和权限主体隔离。
- 每次受保护访问核验活动 OIDC 代数、停用与角色；业务写入在事务内复查。配置切换使旧 Web 会话和预览 grant/session 失效，回退使用新代数。
- 受限 HTTPS 核验所有 DNS 地址并固定连接地址，限制主机、端口、CIDR、响应大小、超时和重定向，支持公司 CA 与 IP SAN。预览检查真实 Ready 实现的至少两个域名主机，并确认网关代数。
- 画廊提供公司登录、接入设置、编辑状态、验证、启用、历史 Web/CLI 复验、恢复、比较和审计。Cookie 会话优先于旧手动令牌；CLI 发布/恢复/状态/基线消费同 origin 的有效私有登录文件。
- 部署命令支持个人身份绑定、停用、角色限制与经验证恢复，无 HTTP 管理后门。域名/IP Nginx 模板提供探针路径与凭据过滤；网关数据库授权按列限制写入。

接入和恢复步骤见 [操作说明](../access-settings.md)。当前迁移 001–011；迁移 010 不把旧状态升级成新证据，迁移 011 让缺少角色来源的旧预览授权失败关闭。

## RED → GREEN

实际失败测试包括非法配置/额外正文键、普通用户管理拒绝、缺失 Web/CLI 入口、伪造检查结果、过期证据、身份切换期间写入、失败启用审计、候选角色过滤、旧预览角色授权、旧手动凭证遮蔽 Cookie 会话，以及回调/会话/跨站 Cookie 拒绝审计。对应实现后复验。

本轮审查专项已通过：四个单元/契约文件 10 项；真实 OIDC/预览切换两项；最终 Cookie/监控/配置专项三文件 9 项；原生脚本取消整文件 20 项。Nginx 使用已安装镜像解析出的不可变 image ID，在自有临时容器执行 `nginx -t` 并实际 HTTPS 转发，验证域名仅保留唯一有效预览 Cookie、重复 Cookie 拒绝、其他 Cookie/Authorization 过滤、Host 端口保留、IP Set-Cookie 过滤及两种探针路径。

监控测试改为健康启动后终止自身 PostgreSQL 连接并令后续连接不可达，实测返回 503；未放宽启动时的配置失败关闭检查。前两次根完整回归均有原生脚本取消失败；单项及整文件重跑通过不能替代完整回归。诊断确认同步工具链检查期间到期的取消先于脚本启动，但原执行器没有先处理该计时器。新增启动标记的 RED 实测失败后，在启动前让事件循环处理取消；21 项 GREEN 包括启动前无副作用，以及原生脚本实际运行后取消并等待 1600 ms，确认进程树没有延迟写入。没有放宽原 sentinel 的 1500 ms 或跳过原断言。诊断输出仅保留在忽略目录，产品代码没有诊断开关。

手动令牌的作业重试浏览器 RED 还复现了无关 Cookie 被发送；改成仅公司会话携带 Cookie 并禁止重定向后，接入设置与网页发布 14 项 GREEN。首次平台完整回归有旧监控启动夹具失败；已更新夹具后专项通过。失败记录保留，最终完整复验结果追加如下。

## 验证命令与结果

Windows x64，固定 Node `26.13.0` / pnpm `12.18.0`；均通过 `.\scripts\pnpm.ps1`。原始日志保留在工作树忽略目录 `.superpowers/sdd/2026-11-22-g2-access-settings/`，不提交构建产物或凭据。

| 命令 | 实际结果 | 证据 |
| --- | --- | --- |
| `--filter @company/contracts schemas:generate` | exit 0，生成契约 Schema | `review-schemas.log` |
| `exec turbo run build --force` | exit 0，10/10 实际执行，0 缓存 | `closure-build.log` |
| `exec turbo run typecheck --force` | exit 0，14/14 实际执行，0 缓存 | `review-typecheck.log` |
| `typecheck` | exit 0，包含服务构建、全图与根 TypeScript | `closure-typecheck.log` |
| `exec tsc -p tsconfig.json --noEmit`（通过 `-PnpmArgs`） | exit 0 | `observability-tsc.log` |
| `verify:workspace` | exit 0，10 成员、无环、四公开包、服务依赖安全 | `accepted-workspace.log` |
| `verify:deployment` | exit 0，templateValidated=true，environmentValidated=false，productionAcceptance=false | `accepted-deployment.log` |
| `test:browser`，提供原冻结 SDK | exit 0，316 通过，1 个 IP 构建模式用例跳过；另行补验 | `accepted-browser.log` |
| `test:browser tests/browser/access-settings.spec.ts tests/browser/manual-release.spec.ts` | exit 0，14/14 通过，含手动重试 Cookie RED → GREEN | `job-cookie-green.log` |
| `exec vitest run tests/integration/project-verify.test.ts` | exit 0，21/21 通过，含两类真实取消边界 | `cancel-preflight-green.log` |
| `--filter @company/component-cli typecheck` | exit 0 | `cancel-cli-typecheck.log` |
| 升版后 `exec turbo run build --force` | exit 0，10/10 实际执行，0 缓存，恢复正常画廊模式 | `final-version-build.log` |
| 升版后 `exec turbo run typecheck --force` + `exec tsc -p tsconfig.json --noEmit` | 均 exit 0，14/14 实际执行、0 缓存，根 TS 通过 | `final-version-typecheck.log`、`final-version-tsc.log` |
| `test:platform`，提供原冻结 SDK 和 `PHASE2_GALLERY_ORIGIN=http://127.0.0.1:5173` | exit 0，41 文件、148/148 通过，零跳过；真实画廊查询、ID 匹配及撤权补验通过 | `complete-platform.log` |
| `test:browser tests/browser/gallery-preview-grants.spec.ts`，先按 `NEXT_PUBLIC_PLATFORM_PREVIEW_MODE=ip-port` 构建画廊 | exit 0，4 通过、1 个域名模式用例跳过；含失败授权不回退用例 | `complete-ip-build.log`、`complete-ip-browser.log` |
| 升版后正常模式 `test:browser`，提供原冻结 SDK | exit 0，317 通过、1 个 IP 构建模式用例跳过；两模式共同覆盖该分支 | `final-browser.log` |
| `install --lockfile-only` + `install --frozen-lockfile` | 均 exit 0；固定 pnpm 重新验证锁文件，无依赖或锁字节变化 | `version-lockfile.log`、`version-frozen-install.log` |
| `verify:workspace` + `verify:deployment` | 均 exit 0；10 成员、安全依赖图，templateValidated=true，environmentValidated=false，productionAcceptance=false | `final-workspace.log`、`final-deployment.log` |
| `exec node .superpowers/sdd/2026-11-22-g2-access-settings/installed-cli.mjs`，指定保留的 CLI tarball | exit 0，仓外实际安装 CLI 0.0.26，同 origin 凭据消费、跨 origin 拒绝和 SHA 不变均通过 | `final-installed-cli-green.log` |
| 升版后 `test`，独占运行，提供真实 T17 浏览器目录 | exit 0；Vitest 134 文件、2306 通过、2 个冻结输入条件跳过（总 2308）；T10 161 通过、7 个冻结输入条件跳过（总 168） | `final-root-test.log` |
| `test:t10`，提供原 `A10_FROZEN_BUNDLE` | exit 0，168/168 通过、零跳过，补齐根脚本中的 7 项条件跳过 | `final-frozen-t10.log` |
| `exec vitest run tests/evaluation/component-query-sdk.test.ts tests/acceptance/t16-a/t16-a-api-cases.test.ts`，提供原 `A10_FROZEN_BUNDLE` | exit 0，27/27 通过、零跳过，补齐根 Vitest 中的 2 项条件跳过；只读核验 199 个文件、14 个实现与原 manifest 摘要 | `final-frozen-guards.log` |

根 `build` 固定 `--cache`，Turbo 拒绝同时追加 `--force`，故强制构建使用等效 `exec turbo run build --force`。这是执行命令适配，没有修改缓存策略。根测试的 T17 浏览器目录指向 `.tools/playwright` 的真实目录，保留执行器拒绝符号链接的检查。

## 独立审查处置

只读审查以 `8f880c5e` 为基线，覆盖全部实现。Critical 0 项，Important 9 项；完成一轮修复与复验，没有重新组织第二轮审查。

| 审查问题 | 处理与证据 |
| --- | --- |
| 验签/网络等待期间切换 OIDC 后旧身份仍可使用 | 验签结束复查代数，业务事务再锁定并检查；generation 单元、stale upload 平台测试 |
| 启用后漏部署接入配置会恢复旧环境认证 | 启动及 fallback 前后读取活动指针，已有活动配置拒绝 legacy；真实漏配置测试 |
| bootstrap JWKS 绕过受限 HTTPS | 初始 JWKS 也使用同 CA/CIDR/固定地址；真实 TLS 允许及白名单拒绝测试 |
| publisher-only 预览旧授权不随角色撤销失效 | 记录签发有效 read_roles，兑换和资源读取核对；已有会话、待兑换 grant、新申请均拒绝 |
| 候选忽略过滤后的角色 | 候选 Web/CLI 用有效角色记录证据；全部角色撤销时 roles=failed |
| 手动管理员链接不能携带 Bearer | 鉴权 POST 换取 60 秒一次性票据，再进入标准跳转；API 与浏览器实测 |
| CLI 保存凭据缺少消费者 | 发布/恢复/状态/基线共用解析器，精确 origin、到期与显式优先级；单元及安装产物验证 |
| 旧手动凭据遮蔽新 Cookie 登录 | 先查询 Cookie session；浏览器回归及真实网页上传通过 |
| 回调/会话等鉴权拒绝缺审计 | 固定 target + code 的脱敏 AUTH_DENIED，包含跨站 Cookie；不记录凭据 |

Minor 的历史 CLI 复验入口、旧/过期证据显示、实际 Nginx 探针过滤均已补齐。

审查未能判断的范围逐项裁定：公司同步来源、撤权目标时限、生产 DNS/TLS/续期归外部 G2；网关数据库授权已在真实受限角色下补验，生产登录凭据和 MinIO 只读策略仍需部署验收；第二次跨 issuer 迁移保持设计的唯一绑定约束并失败关闭，替换协议后续另行设计；本契约使用固定回环端口且禁止 offline_access，不承诺 refresh token 或动态回环；tarball 与完整回归由执行方补实际证据。

## 冻结输入与保留边界

原 SDK 输入来自 `D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`，manifest SHA-256：`04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。

| 包 | 冻结 tarball SHA-256 |
| --- | --- |
| charts-core 0.0.11 | `393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb` |
| charts-vue 0.0.12 | `51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9` |
| charts-react 0.0.12 | `bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28` |

原 SDK 未重新打包。完整平台套件另建候选和隔离三存储，不覆盖已发布版本。API/网关不构建、不执行上传组件，不启动浏览器；测试、消费者安装和截图全部在 Windows 本机。

CLI 0.0.26 单独构建并 `pack` 一次，冻结 tarball 为 `C:/Users/10208/AppData/Local/Temp/zh-installed-access-NCZ5gf/frozen/company-component-cli-0.0.26.tgz`，SHA-256 `2c51fdfe799644977e3efbcf9642ad69e51636aecc0b4012f6114b81820cca3a`。最初 pnpm 离线安装因缺少 `@modelcontextprotocol/server@2.4.0` 元数据而失败，记录在 `final-installed-cli.log`；继续使用同一份 tarball，以固定 Node 附带 npm 的现有缓存完成离线 `--ignore-scripts --no-audit --no-fund` 安装，没有改变依赖版本或重新打包。消费者路径为 `C:/Users/10208/AppData/Local/Temp/zh-installed-access-gxcEcd/consumer`，使用安装后的真实 bin 请求本机测试 API；该验证证明冻结产物的凭据消费者行为，不作为真实公司 IdP 验收。安装产物和 tarball 保留在自有临时目录。

独立升版：根 0.0.8→0.0.9、API 0.0.10→0.0.11、画廊 0.0.11→0.0.12、网关 0.0.3→0.0.4、CLI 0.0.25→0.0.26；私有 contracts 维持 0.0.0。根及四个包的 CHANGELOG 同步更新，已有历史保持原样。版本提交为 `c5131ba3`。

## 实现提交

| 提交 | 目的与对应验证 |
| --- | --- |
| `8dc608dc` | 接入配置契约、管理员草稿版本校验；契约与真实 PostgreSQL 草稿测试 |
| `4de78be7` | 公司 OIDC、CLI 回环登录、候选权限隔离；真实隔离 IdP 与 Web/CLI 测试 |
| `aa56a1af` | 预览入口检查、活动切换与回退；真实 TLS、网关和旧授权拒绝 |
| `8fb7abd6` | 工具链检查期间到期的取消阻止脚本启动；21 项原生/浏览器验证文件及 CLI typecheck |
| `93606a10` | 接入设置页面、公司会话与候选验证；全图构建/类型检查及接入/网页发布 14 项 |
| `e16a6d94` | 发布、状态与基线消费匹配 origin 的本机登录；凭据单元与类型检查，安装产物补验 |
| `3edf3c3e` | 认证代数、候选证据、角色撤销及运维恢复；完整平台 148 项、契约/单元 10 项 |
| `89786076` | 部署恢复说明、Nginx 入口过滤模板与真实入口测试；完整平台 148 项包含 ingress |
| `c5131ba3` | 独立语义化升版与 CHANGELOG；frozen install、强制全图 build/typecheck、根 TS 和浏览器回归 |

原始架构文件 SHA-256 仍为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。保持当前分支/工作树；用户没有授权 push、合并或创建 tag。技能的集成选项不阻塞已授权实现，按现有授权只做本地聚焦提交。

## 本地完成状态

本计划五项本地实现、审查处置、安装产物验证与回归已完成。最终根回归没有失败，条件跳过通过单独传入原冻结目录全部补验；浏览器域名/IP 两种构建共同覆盖模式条件用例。失败运行和专项 RED 保留在原日志，未将旧失败记录改写成成功。

G2/T01 仍未完成外部验收：真实公司 Web/CLI 账号、公司同步与专用账号停用/角色移除、既有 token/Web session/preview grant 拒绝时延及公司认可的目标时限、生产逐发布 DNS/TLS/续期、生产数据库身份与 MinIO 只读策略，以及双业务试点的双框架回执。本轮部署检查仅证明模板有效，不能代替这些外部证据。

默认仓库 `D:/project/zhinexus-design-asset-platform` 的用户 README 修改保持原样；所有本轮编辑和提交位于 `g2-access-settings` 工作树。自有画廊进程已关闭，测试隔离服务按其自身所有权清理；冻结 SDK、CLI tarball 与消费者证据保持保留。
