# T16 B / P1 产品 RED 与安装隔离 brief

日期：2026-11-18。C 冻结本 brief；B 为实际 Claude 桌面端。基线为 P0 提交 `2594f277` 加本轮恢复修正提交（以交接消息的完整 hash 为准）。工作目录为 Codex 恢复的 `C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform`，不得写主工作区。当前委派仅为**产品失败测试**，Windows 宿主 C 确认 RED 后才授权 GREEN。

## 所有权与完成条件

- B 仅新增 `tests/integration/project-apply.test.ts`、`project-rollback.test.ts`、`project-install-isolation.test.ts` 及 `tests/integration/t16-support/*`。测试辅助文件不得匹配 Vitest 的 *.test.ts 模式。
- 只读 `packages/contracts`、公共 fixtures、CLI 内联 contracts、根配置/锁/版本、SDK、服务端、原始架构文档。本次不修改 CLI 产品源码、不补 stub、不改 exports、不升级依赖、不提交、不 merge/push。
- 使用已有 Vitest 和 Node 标准库。测试可 namespace 查找现有 CLI 出口并 optional 调用，缺函数必须产生行为断言失败；不能对尚不存在的文件静态 import，不能以 import/collect/typecheck 错误冒充 RED，不能用 skip/todo 隐藏缺能力。
- 每个测试保留实质性 expected（文件字节、实际 SHA、结果状态、进程边界或请求目标），不能只有“函数存在”的断言。独立本地 HTTP 服务模拟 API/registry，只使用明确的 synthetic 凭据。不要连接公司环境。
- 交付后停写，报告文件清单、用例数和预计失败原因。C 使用固定 Windows Node 26.13.0 / pnpm 12.18.0 构建现有出口后运行三文件，确认收集完整且因缺产品行为失败。

## 固定接口

GREEN 阶段接口从 CLI 根出口导出，不接受离线任意命令、路径或 runner：

```ts
type IntegrationApplyOptions = {
  authorization?: IntegrationApplyAuthorizationV1; // 缺失必须 blocked
  apiUrl: string;
  registryUrl: string;
  apiToken?: string;       // 仅管理 API HTTP 请求
  registryToken?: string;  // 仅指定 registry origin
  backupRoot: string;      // 已检查的目标/workspace 外绝对目录
  workspace?: string;     // 与 T15 同义的选定成员
  outputDir?: string;     // 与 T15 同义，重派生后必须匹配
  requestTimeoutMs?: number;
};
type IntegrationRollbackOptions = { backupRoot: string };
applyIntegration(root, plan, options): Promise<IntegrationApplyResultV1>;
rollbackIntegration(root, backupRef: { id: string; sha256: string }, options):
  Promise<IntegrationRollbackResultV1>;
```

授权来自本次显式 apply 的调用边界；plan 的 executionAuthorized 仍恒 false。CLI 自行从通过复核的计划派生 allowedPaths 和 digest。canonical 摘要使用既有 T15 canonical JSON 规则，不用随意 JSON.stringify 的键顺序替代。重新 plan 比较权威字段和文件字节，checkedAt 时间变化不使一致计划失效。离线 commands 只是展示数据，绝不传给 shell，也不执行 run build/typecheck。

请求参数/损坏 JSON/备份无法可信读取时抛固定脱敏执行错误，由 CLI 映射 exit 1；例如 BACKUP_INVALID，不为无可信 operationId/planDigest 的备份编造合法 rollback 对象。有效操作产生 P0 结果，成功 exit 0，blocked/recovery-required exit 2，stdout 严格单 JSON。原始 stderr、URL 查询、token 不进入结果或日志。

## 安装模型：包管理器只在外部暂存区运行

分为“候选锁生成”和“冻结依赖物化/受控交付”。目标工程从不作为包管理器 cwd/prefix/dir；不以临时更名项目 .npmrc 或删除 pnpmfile 实现隔离。

1. 只读检查目标和 workspace 的真实 root、选定包、受影响目录及 T15 base hashes；外部独占 staging/backup 目录必须与目标同卷（本版目录替换以同卷 rename 完成），且不在目标、workspace、其他源码或其链接别名内。
2. 从白名单字段重新序列化 manifests：name/version/private/type、dependencies/devDependencies/peerDependencies/optionalDependencies、受支持 engines、静态 workspaces 成员。保留原目标 manifest 全部字节用于备份和最终 patch；暂存 manifest 不带 scripts、pnpm 配置、config、packageManager 下载指令或未经支持的 overrides/resolutions。不能因删除会改变解析的配置而静默安装：影响解析且尚未支持的配置须 DEPENDENCY_CONFLICT 阻断。
3. 暂存区仅输入经解析检查的 lock v3/v9、上述 manifests 和静态 workspace 成员列表。pnpm-workspace.yaml 重新生成固定设置，不复制原 YAML 任意 keys；项目 .npmrc、pnpmfile、配置依赖、源码、.git、.env 均不复制。锁中的 registry 来源、integrity、包身份必须受校验；任意 git/file/link/portal/patch、workspace 本地依赖及动态配置本版显式阻断。静态 workspace 根和成员可支持；npm 自动生成的成员链接需按下一节受控重建。
4. 在 staging 生成候选锁；lock-only 进程不表示目标依赖安装已开始，且没有目标写入。冻结候选锁和拟写入内容，完整备份落盘，之后才按 hash 守卫写入目标允许的源码/清单/锁。
5. **冻结依赖物化进程启动前**，持久化 installStarted=true 并重新计算最终 backupRef.sha256；持久化或摘要更新失败时不启动进程。此标志保守表示依赖安装确已启动，即使暂存安装失败、尚未交付目标，也返回 reinstall-required；只生成候选锁不能设置它。备份版本按摘要不可变保存，最新日志原子指向当前摘要；恢复拒绝过时引用，不能用旧 installStarted=false 快照洗掉安装副作用。
6. 物化后检查实际依赖包版本、精确发布身份及同一 SDK 摘要，核对冻结锁未改写。不能把 plan.exactDependencies 复制成 installedVersions。通过下面的目录交付步骤安装到目标；最终从目标解析的直接依赖和实际文件重新计算证据，成功才 applied。

### 依赖目录如何进入目标

仅把已验收的 node_modules 目录树作为显式安装副作用交付，源码和清单仍由逐文件备份/守卫管理。支持 standalone 和静态 workspace；后者明确枚举根及成员 node_modules，禁止超出这些目录。

- 暂存配置固定 pnpm nodeLinker=hoisted、packageImportMethod=copy，禁用外部全局 virtual store。目录树中普通文件不得为硬链接；links/junction 仅接受包管理器生成并经清单核验的边：内部依赖边须完全位于交付树；workspace 自动链接只允许指向已检查的成员 root，交付时按对应目标 root 重建。任何 stage 绝对路径、跨 root、未知 link 或可执行内容的自检过程均拒绝；不能执行依赖代码来验证版本。
- 在目标外建立同卷 ready 目录，复查真实父路径，检查 target node_modules 当前状态。既有目录仅可在完整安全清单和摘要守卫一致时移动到外部 quarantine；未知链接、并发变化或无法安全枚举则失败关闭，不递归清理。用同卷受控 rename 逐目录交付 ready 树，日志逐步记录已发生的目录副作用。不得直接复制覆盖现有未知树；跨卷目录布局本版显式拒绝。
- workspace 目录替换不承诺跨多个目录原子事务；部分交付或后续版本核验失败时保留恢复日志与 quarantine，不删除用户目录，不宣称恢复了 node_modules。源码恢复后仍 reinstall-required。quarantine 不计入 P0 源文件备份，不把它冒充用户可直接回滚的完整依赖快照。
- 这套设计需要真实 Windows npm/pnpm × Vue/React × standalone/workspace 验收。当前 RED 只冻结可观察要求；没有真实进程证据不得标记安装隔离完成。

## 可执行文件、argv 和配置环境白名单

Windows 宿主使用工作区 .tools 内固定 Node 26.13.0（随附 npm **11.20.0**）和 pnpm-native **12.18.0**。先验证 executable 的绝对路径和 --version；不从项目 PATH 查找 npm/pnpm，不 corepack、不 npx、不下载其他工具链。spawn 参数数组，shell:false；npm 用 node.exe + npm-cli.js，pnpm 用 pnpm.exe。

以下 argv 由产品构造；S 是已验证的 staging cwd，U/G/C 是外部隔离的 userconfig/globalconfig/cache，R 是已验证 registry origin。占位值由可信边界生成，不能来自 plan.commands。workspace 成员由静态白名单决定，npm 不接收用户注入的 --workspace 参数。

| 阶段 | 固定 argv（cwd=S） |
| --- | --- |
| npm 候选锁 | node.exe npm-cli.js install --package-lock-only --ignore-scripts --no-audit --no-fund --registry=R --userconfig=U --globalconfig=G --cache=C |
| npm 冻结物化 | node.exe npm-cli.js ci --ignore-scripts --no-audit --no-fund --registry=R --userconfig=U --globalconfig=G --cache=C |
| pnpm 候选锁 | pnpm.exe install --lockfile-only --no-frozen-lockfile --ignore-scripts --ignore-pnpmfile --registry=R --store-dir=C |
| pnpm 冻结物化 | pnpm.exe install --frozen-lockfile --ignore-scripts --ignore-pnpmfile --registry=R --store-dir=C |

pnpm staging YAML 由产品固定：nodeLinker: hoisted、packageImportMethod: copy、enableGlobalVirtualStore: false、strictPeerDependencies: true、engineStrict: true、pmOnFail: error、ignoreScripts: true、ignorePnpmfile: true；所有动态 config dependencies / pnpmfile / hooks 被排除。版本不存在某设置或无法证明它生效时须停止该安装分支，先补版本证据，不能静默移除安全设置。

2026-11-18 固定版本兼容裁定：pnpm 12.18.0 拒绝旧 YAML `managePackageManagerVersions`。C 实际 characterization 确认上述固定 YAML 加产品内部环境 `PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false` 可生成候选锁、冻结物化且不执行脚本/pnpmfile；错误 pnpm pin 在创建锁和依赖目录前退出。内部值必须固定 false，不继承宿主同名键。不得用拼写建议 `initPackageManager` 代替安装隔离。见 [本轮版本证据](../../verification/t16-pnpm12-isolation-2026-11-18.md)。

不继承完整 process.env。仅保留 Windows 必需的 SystemRoot/WINDIR/COMSPEC/PATHEXT 及产品构造的固定工具目录 PATH，外部 TMP/TEMP、USERPROFILE/HOME/APPDATA/LOCALAPPDATA，CI=true、NO_COLOR=1。npm_config_userconfig/globalconfig 指向隔离文件，内部 PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS 固定 false；环境中 NODE_OPTIONS、NODE_PATH、PNPM_HOME、COREPACK_*、npm_config_* 的外部值、代理/自定义 CA/registry 设置、平台/API token 全部不继承。项目父目录配置也不得通过 cwd 的祖先发现：stage 放在独占隔离根，检测/阻断已有祖先 .npmrc 或包管理器工作区配置。内部正确构造的配置键不受上述“外部值”排除规则影响。

如 registry 需要认证，仅在隔离 U 中为精确 registry host/path 写入 registryToken，权限最小化，任务结束安全删除本任务创建的凭据文件；不得设置全局通用 _authToken，不把 apiToken 传子进程，不在 argv 放令牌。重定向不能携带认证到其他 origin，TLS 验证不得关闭。临时凭据文件虽可能被包管理器读取，也不进入备份、结果、公开 tarball 或可交付证据。

官方资料在 2026-11-18 实际读取，页面现行为说明依据，不单独证明固定版本实现；本机 npm package.json 实测 11.20.0，pnpm 包装器实测 12.18.0：

- [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)：冻结锁、manifest 不符拒绝、ignore-scripts。
- [npm config](https://docs.npmjs.com/cli/v11/using-npm/config/)：project/user/global 配置层和 userconfig；只指定 userconfig **不能**消除项目配置，故不在目标执行。
- [pnpm install](https://pnpm.io/cli/install)：lockfile-only、frozen-lockfile、ignore-scripts；ignore-pnpmfile 单独禁止加载 pnpmfiles（含 config dependencies）。
- [pnpm settings](https://pnpm.io/settings)：nodeLinker、packageImportMethod、全局 virtual store 与配置层。精确版本兼容及重定位仍待产品实测。

## 恢复分类与首批 RED 清单

真实字节和 SHA 用 Node fs/crypto 独立计算；不能用公共 fixtures 的占位 a/b/e 摘要冒充文件证据。临时工程位于工作区外且每个测试独占；故障通过测试私有 module mock 或受控文件系统条件注入，不向公开 options 添加任意执行钩子。

1. 缺授权、错 root/digest/allowedPaths、allowInstall=false、旧计划命令注入：blocked、无目标 diff/备份/安装调用；API/registry 可控请求的目标和认证分别检查。
2. 重新核验发现文件/发布/API/摘要/资格变化：失败关闭；checkedAt 单独变化可继续。离线 Schema 通过不等于可执行。
3. Vue/React 生成器通过真正的字符串 prop/callback 绑定处理引号、换行、原型键、事件名与表达式文本，不 eval、new Function 或拼接业务表达式；未知必需绑定显式阻断。
4. 首个写入失败：备份已落盘，changedFiles/beforeHashes/afterHashes 为空，WRITE_FAILED、rolled-back、not-run，有可验证 backupRef；所有原始文件字节不变。
5. 第二个写入失败：只记录已提交文件的 before/after；恢复后已写文件 restored、未写候选 unchanged，不虚构完整成功或恢复动作。
6. 安装启动前日志持久化失败：没有依赖物化进程；installPlanned 不等于 installStarted。启动后失败：reinstall-required；返回 backupRef 摘要与最后磁盘 JSON 完全一致，旧引用拒绝。
7. 暂存进程 cwd、argv、环境与复制字段白名单；恶意 .npmrc、pnpmfile、环境 NODE_OPTIONS、scripts 无执行；npm API token 不在 registry/config/env，registry token 不在 API 或原始错误输出。
8. 冻结锁不符、实际安装版本不符、stage 外链接、未知目标依赖链接、并发 node_modules 变化：失败关闭，不能 applied；目录交付只落在明确安装范围，不运行项目 build。
9. 有效备份恢复：原文件（包括空字节）恢复、新文件删除、已匹配 before 的 unchanged；四组互斥并完整覆盖 candidates。
10. 用户在 apply 后编辑：preserved + 同路径 USER_EDITED，字节原样保留；恢复时 I/O 失败：unresolved + 同路径 WRITE_FAILED/RECOVERY_REQUIRED，禁止 USER_EDITED。
11. 同时有 restored/unchanged/preserved/unresolved：recovery-required，逐路径 coverage 精确；任何 installStarted=true 保留 reinstall-required。
12. 备份摘要/原字节/root/plan/id 被篡改、跨 root、链接/junction/hardlink、恢复前或期间 hash 变化：不覆盖用户文件；异常脱敏。

这些用例可先用未实现的根出口 optional 调用，期望为 undefined 对实质结果的断言失败。后续 GREEN 用于细分流程的 test-only mocks 需在实现文件存在后接入；本次禁止为了测试可运行而添加产品实现。

## C Windows 交接门禁

运行 `scripts/pnpm.ps1 --filter @company/component-cli build`，再 `scripts/pnpm.ps1 exec vitest run tests/integration/project-apply.test.ts tests/integration/project-rollback.test.ts tests/integration/project-install-isolation.test.ts`。保留全量 RED 日志；报告 failures/passes、collect 是否成功、明确缺能力。不得在本轮 RED 后自动 GREEN。

后续真实 frozen SDK/CLI、npm/pnpm/workspace、网络资格复验和独立 D 黑盒仍是 P1/P4 门槛。synthetic 测试与 mocks 不替代真实授权业务项目；完整 T16/T17 保持未完成。

## 2026-11-18 C 补充：依赖目录日志与清理失败的可观察约定

本段具体化前文已批准的逐目录日志，不改变公开 IntegrationBackupV1 或源码 rollback 契约。运行日志保存在工程外已核验备份操作目录 `<backupRoot>/<operationId>/install-delivery.json`，与不可变源码备份版本分开；cleanup 不删除它或 quarantine。JSON 为 `{schemaVersion:1, kind:'t16-install-delivery', operationId, projectRoot, planDigest, entries}`。每项为 `{importer, target, hadOriginal, quarantine?, state}`；target 是工程相对 node_modules 路径，quarantine 是同卷工程外绝对路径，state 为 `planned`、`quarantined`、`delivered`。entries 精确覆盖真实 ready 交付范围，不把未交付成员计入成功。

任何目标目录 rename 前，完整 planned 日志必须以独占临时文件和受控原子替换实际持久化；移动旧树后记录 quarantined、交付新树后记录 delivered。写日志失败立即停止后续目录动作，保留最后成功日志、quarantine 和实际目录现场，源码恢复且 installState 为 reinstall-required。日志与目录状态不承诺跨文件原子事务，planned/quarantined 的动作可能处于意图与完成更新之间，诊断必须复核磁盘，不能仅凭日志宣称动作未发生。备份父链、日志文件、临时文件须遵守普通路径、独占和防链接约束，不跟随并发替换。

旧树的完整安全清单与摘要必须在受控 rename 前后复核；并发改写时停止新树交付，保留真实用户字节（原目录或 quarantine），不得清理或冒称 applied。多目录第二次交付失败时，第一目录真实新树、各旧树 quarantine 与日志都保留，不伪造恢复了依赖目录。

cleanup 对 staging/env/ready 任一目录删除失败或删除后仍存在，都不得返回 applied；安装已启动则源码保守恢复并保持 reinstall-required。失败返回也尽力清除本次隔离凭据，错误对象和运行日志不得含 token。操作系统持续拒绝清理时记录未清理边界，不声称目录或凭据已删除；不删除用户目标目录。

## 2026-11-19 C 补充：精确所有权与同次 apply 恢复

stage/env/ready 清理只删除可证明属于本次操作的树：根 `.t16-owner.json` 为普通单链接文件，精确 JSON 字节绑定固定 `kind:'t16-external-root'`、本次 `operationId` 和对应 role。目录名前缀不能授权删除未知树。测试 helper 仅允许并严格核验 stage 的此精确标记，不放宽 manifest/YAML 或凭据白名单。

日志窗口备份祖先被换为 junction 后，禁止穿链接读取或写回。正在执行的同次 apply 可从最近一次成功持久化、与 backupRef id/hash 和项目/计划/原字节绑定的不可变内存备份恢复源码；不能使用未落盘候选，第二次持久化失败保留第一次成功版本，不能伪造 installStarted。冷启动 rollback 仍从磁盘执行原完整验证，不能因此放宽祖先拒绝。

安装已启动时，干净恢复返回 `rolled-back + reinstall-required + INSTALL_FAILED`；源码用户编辑或恢复 I/O 失败返回现有 `recovery-required` 分类。保留最后成功 backupRef，但不声称被替换路径可达，不改写外部、日志或 quarantine 现场。独立三条 RED 和未覆盖边界见 [同次恢复记录](../../verification/t16-hot-recovery-2026-11-19.md)。
