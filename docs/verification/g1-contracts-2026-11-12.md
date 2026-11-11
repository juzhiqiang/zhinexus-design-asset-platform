# G1 V1 契约候选验证记录

日期：2026-11-12（Asia/Shanghai）。责任：C：平台。基线提交 `8304bff`；分支 `feat/g1-platform-contracts`，使用独立原生 worktree。原工作区检查期间有其他工作流新增 CLI 测试且缺实现导致收集失败，未改动/收录这些文件；本记录仅针对隔离分支。

## 交付与状态

- contracts 新增 manifest / report / environment / example / screenshot / API 运行时校验、稳定错误码、确定性 JSON/SHA-256/环境键、实际冻结文件字节校验。
- 导出 23 份 JSON Schema（5 类材料、18 类 API 消息）；生成器提供 --check 防漂移。示例接口定义 ready/runState/getChecks，不执行示例。
- 合成 fixtures 包括正常 web/cli、一包多组件/双框架、缺图/错框架/错摘要/伪造来源/包冲突/路径穿越及 API/报告/字节样本。
- **代码候选验证通过；G1 人工门槛仍未通过。** A/B 身份/联系渠道及真实回执未具备，不能用代理自查或测试结果冒充签字；协调时点与 G2 接入责任/日期见 `docs/superpowers/plans/2026-11-12-g1-review-g2-access.md`。
- G2/T01 未完成：无真实 OIDC/PG/Verdaccio/MinIO/独立域接入证据，根脚本仍无 test:infra。

## RED → GREEN

1. 隔离后先运行原根 test：2 文件、17 测试通过；先执行 build:services 生成/恢复真实 Nest 编译产物。冻结安装使用现有本机 store，无新增外部依赖。
2. 初次契约测试遇到根测试环境无法按包名解析 contracts；补 root devDependency `@company/contracts: workspace:*`，由固定 pnpm 更新 lockfile 并冻结安装，未增加私有包的公开运行时依赖。
3. 结构/关联/摘要/报告测试实际 RED：78 例中 71 失败、7 通过，预期缺失 validateManifest、validateReleaseBundle 等函数；不存在导入收集错误后才计作 RED。GREEN 为 78/78。
4. API/schema 测试实际 RED：26/26 失败，缺 API 校验器及 schema 产物；实现并生成后 GREEN 104/104。
5. 路径/关联加固 RED：15 例中 10 失败、5 通过，发现 schema pattern 对小写设备名/空段的差异、大小写/NFC 路径碰撞、自动状态覆盖及 candidate 报告关联；补正常手动图+独立报告用例并修正后 GREEN 120/120。
6. 可审查 JSON snapshots 测试在文件未生成时 4/4 失败；生成后契约 GREEN 124/124。生成的 PNG/tgz 字节明确标记为合成，不是实际图像或组件产物。

## 实际执行命令与结果

均在本机通过项目固定 Node 26.13.0 / pnpm 12.18.0 入口执行，不修改全局工具链。以下记录本次候选最新一轮结果；测试和浏览器均直接实际执行，不经过 Turbo 缓存。

| 命令 | 实际结果 |
| --- | --- |
| `.\scripts\pnpm.ps1 install --frozen-lockfile` | 退出 0；隔离 worktree 安装成功；增加根 workspace 开发依赖后再次通过 |
| `.\scripts\pnpm.ps1 --filter @company/contracts build` | 退出 0，真实 tsc 构建 |
| `.\scripts\pnpm.ps1 verify:workspace` | 退出 0，10 成员、无环、公开/私有与服务依赖边界通过 |
| `.\scripts\pnpm.ps1 exec tsx scripts/generate-contract-schemas.ts --check` | 退出 0，23 份 schema 与运行时定义一致 |
| `.\scripts\pnpm.ps1 exec tsx tests/fixtures/releases/g1/generate.ts --check` | 退出 0，JSON 样本与工厂一致 |
| `.\scripts\pnpm.ps1 exec vitest run tests/contracts` 连续两次 | 两次均退出 0，5 文件、124/124，各自实际运行 |
| `.\scripts\pnpm.ps1 exec turbo run build --cache=local:w` | 退出 0，10/10 构建实际执行、0 cache hit；包括 Nest、contracts、SDK、Next 和双框架示例 |
| `.\scripts\pnpm.ps1 typecheck` | 退出 0；先 build:services，再全图 typecheck（14/14 任务）及根 tests/scripts 类型检查 |
| `.\scripts\pnpm.ps1 test` | 退出 0；先 build:services，再 Vitest 7 文件、141/141；包括原有真实 Nest HTTP 测试 |
| `.\scripts\pnpm.ps1 test:browser` | 退出 0，11/11；其中新增 Chromium 直接加载 contracts 真实 ESM，验证同一 bundle 与 Web Crypto 摘要，其余为已有回归 |
| 服务筛选 `exec turbo run build typecheck --filter=@company/platform-api --filter=@company/preview-gateway --dry=json` | 退出 0，实际图仅 contracts#build、两个服务各 build/typecheck，共5任务；没有图表/画廊/CLI/示例/浏览器 |
| `git diff --check` | 退出 0 |
| `Get-FileHash -Algorithm SHA256 component-platform-architecture.md` | `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`，与基线相同 |

一次尝试 `pnpm build --force` 因当前 Turbo 不允许显式 --cache 与 --force 同用而退出 1；没有修改根脚本或回退工具版本，改用等价任务的 --cache=local:w 禁止读取缓存，取得上述10任务真实构建结果。浏览器运行前确认 5173–5175 无占用；Playwright 自行启动并结束测试服务，没有停止其他开发进程。浏览器日志有现有 NO_COLOR/FORCE_COLOR 提示，不影响测试结果。

## 未覆盖边界与后续门槛

- validateManifest 是声明校验；只有 validateReleaseBundle 将声明与实际字节、解析报告及环境键绑定。即使 bundle 通过，也不能证明客户端真实运行过浏览器或完成兼容验证。
- 本次不验证真实 npm 包、图片文件头/MIME/尺寸、受限解包、符号链接、真实消费者安装、源码集合摘要算法、浏览器 ready 信号实现或冻结后重打包流程；分别归 T03/T04/T05。
- 时间采用有效 UTC Z 格式，parts/分页/初次基线等补充字段仍为 G1 评审候选；ReactDOM 记录存在不等于运行版本已被独立证明。
- OIDC、上传权限与来源服务端强制、PG 状态机/唯一约束/租约、MinIO/Verdaccio 不可变资源与恢复、独立预览域授权隔离仍归 G2/T05/T06/T07；没有假造 test:infra 通过结果。
- private contracts 与平台根仍属 0.0.0 候选阶段，无对外新增业务端点或公开包功能，本次不触发公开包/平台发布升版；已有 charts-core 0.0.1 不改动。
- A/B 实际评审及外部交付方实名待确认，G1/G2 不勾选通过；未推送、未合并、未创建 tag 或触发发布。

## 独立审查

以下为 2026-11-12 对候选 `2b51b25` 的独立只读审查及补充验证；保留上文原候选验证结果，不将其改写为修正后结果。

### 发现与修正

独立代理 `g1_code_review` 报告四项 P2，未发现已确认的 P0/P1；主代理补测试、复现后修正。审查有一次限流中断，恢复后完成最终结论与窄范围复核。

| 原候选缺陷 | 根因与修正 | 回归证据 |
| --- | --- | --- |
| 数组 getter/额外属性被接受 | 数组分支直接读取索引；改为先核对普通稠密数组及 data descriptor，拒绝 accessor、额外属性/Symbol、非枚举索引及数组子类 | 校验和 canonicalJson 均拒绝，getter 调用数为 0 |
| Windows 通配符/部分设备别名放行 | path pattern 未包含 `*` 和 COM/LPT 的 ¹²³ 别名；同步修正运行时与生成 schema | 无特殊 flags 的 schema 正则拒绝，样本漂移检查通过 |
| 数字预发布前导零放行 | 未区分纯数字与含字母/连字符的标识；改为逐标识精确检查 | 拒绝 `01`、`alpha.01`、`00.beta`，保留合法的 `0`、`alpha.1`、`01a` |
| passed 聚合证据可晚于 verifiedAt | 仅核对主报告时间；改为所有贡献报告均满足 createdAt <= verifiedAt | 同一真实字节 bundle 在验收时间早于必需报告时拒绝，时间推进到全部报告产生后通过；同步 manifest 同样覆盖 |

额外补齐 standalone report 返回最多 100 条错误；路径碰撞改为 NFC + Unicode 大写的保守策略，并公开其可能额外拒绝可区分名称的限制。独立审查对 Σ/ς 未确认本机覆盖风险；主代理实际写入 `Σ.md` 后查询 `ς.md` 不存在，因此不把它记录为已证实的本机文件覆盖漏洞。SemVer 语法层仍允许字符串预算内的任意位数主/次/修订号，不虚构规范的安全整数上限；npm 工具可安装性留给 T04/T05。

补充 TDD：第一轮 hardening 测试 **12 失败 / 20 通过**，锁定前三类问题及数组形状；修正后契约 140/140。第二轮 hardening **4 失败 / 33 通过**，锁定聚合时间、保守路径策略与错误数量上限；修正后契约 **145/145**，连续重跑两次均退出 0。具体失败日志仅作为本地忽略的调试材料，不提交本机路径或凭证。

### 修正后的实际全图验证

| 命令 | 修正后结果 |
| --- | --- |
| `.\scripts\pnpm.ps1 install --frozen-lockfile` | 退出 0，锁文件无需更新；pnpm 12.18.0 |
| `.\scripts\pnpm.ps1 --filter @company/contracts build` | 退出 0 |
| `.\scripts\pnpm.ps1 verify:workspace` | 退出 0，10 成员、安全服务图 |
| schema / fixture 两个生成器 `--check` | 均退出 0，无漂移 |
| `.\scripts\pnpm.ps1 exec vitest run tests/contracts` 连续两次 | 均退出 0，5 文件、145/145 |
| `.\scripts\pnpm.ps1 exec turbo run build --cache=local:w` | 退出 0，10/10 实际执行、0 缓存读取 |
| `.\scripts\pnpm.ps1 typecheck` | 退出 0，服务前置 + 全图 14/14（其中 6 项缓存）+ 根 tsc |
| `.\scripts\pnpm.ps1 test` | 退出 0，服务前置 + 实际 Vitest 7 文件、162/162 |
| `.\scripts\pnpm.ps1 test:browser` | 退出 0，实际本地 Chromium 11/11；运行前 5173–5175 无监听占用 |
| 服务筛选 `--dry=json` | 退出 0，仅 contracts#build 与两个服务各 build/typecheck，共 5 项 |
| `git diff --check` 与原架构 SHA-256 | 退出 0；SHA-256 仍为上文记录的基线值 |

独立复核实际执行契约测试 145/145、schema/fixture `--check` 与 `git diff --check`，确认四项 P2 已消除，未发现这些问题的遗留绕过。全图构建/类型/浏览器由主代理执行，不能归作独立代理实测。

用户回复“评审就行”，本轮完成代码评审与修正复核，继续按 A/B/C 角色记录交接，不再以实名/联系方式补齐阻断代码交付。没有替 A/B 伪造业务签字；G1 人工门槛、G2 外部接入及 T01 仍开放。原未覆盖边界不变。
