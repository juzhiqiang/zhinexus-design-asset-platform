# 冻结 CLI 0.0.23 回归与证据复读（2026-11-20）

当前状态：唯一冻结候选的完整工程回归已自然退出通过，并完成原日志独立复读；双框架宿主、黑盒/T15/T16 和固定 33 格矩阵见各自独立记录，本记录不代替整体最终结论。使用用户授权的仓外临时 Vue/React 工程，`productionAcceptance=false`。[0.0.22 结果](t17-cli-0022-regressions-2026-11-20.md) 和 R08 失败不被覆盖。

## 冻结输入与修复

- `10ca2957` 修复原有超时内的异步 DOM 断言等待，保留 first、trim、精确 count、非零可见尺寸、取消和错误分类；所有断言共享一个原有预算。真实 Chromium 有效 RED 为 `8 failed / 4 passed`，最终定向 `52/52`、既有浏览器 `1/1`，独立审查 Critical 0、Important 0。详见 [异步断言独立记录](t17-async-assertion-2026-11-20.md)。
- 独立升版提交 `edb985ec0f9ee1b79a5882e935832f8caa9f0daf`。CLI `0.0.23` 于 `2026-11-20T05:51:34.8465368+08:00` 仅 pack 一次，绝对目录 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.23-edb985ec-b8f572a9`。tarball `company-component-cli-0.0.23.tgz`，`454155` bytes，SHA-256 `93c901245b95c06ccc6a2a5bd476decf7ce9512b476316e1b65e789459b594ab`；`freeze-manifest.json`、`pack-command.json` 与 `pack.log` 同目录保留。
- SDK 继续使用 core `0.0.11`、Vue/React `0.0.12` 的原始冻结 bundle，manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`；未重包。历史兼容输入 SHA-256 `c61820814884126a3b8869b69079c7b3c286afd5e26acdd282b94f749c159cc7` 仅为 historical installed-CLI replay，不冒称当前新兼容或生产验收。
- Windows x64 固定 Node `26.13.0`、pnpm `12.18.0`；命令均经 `./scripts/pnpm.ps1 -PnpmArgs @(...)`。下述证据目录以 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20` 为根。

## 工程检查

| 命令 | 实际结果 | 证据目录 |
| --- | --- | --- |
| `verify:workspace` | 10 members，exit 0 | `cli-0.0.23-workspace-edb985ec` |
| `exec turbo run build typecheck --force` | 20/20，0 cached，14.435s，exit 0 | 同上 `build-typecheck.log` 和结果 JSON |
| `exec tsc --project tsconfig.json --noEmit` | exit 0 | 同上 `root-tsc.log` 和结果 JSON |
| `test`（含 `build:services` 前置） | T10 `168/168`、0 skipped；Vitest `124 files / 2210/2210`、0 skipped；Vitest 895.76s，包装器 927.63s，自然 exit 0 | `cli-0.0.23-full-test-edb985ec/test.log`、`test-result.json`、`summary.json` |
| `test:platform`（含 `build:services` 前置） | `35 files / 137/137`；Vitest 711.83s，包装器 719.17s，自然 exit 0 | `cli-0.0.23-platform-edb985ec/platform.log`、`platform-result.json`、`summary.json` |
| `test:browser` | `288/288`，3.2min，包装器 192.84s，自然 exit 0 | `cli-0.0.23-browser-edb985ec/browser.log`、`browser-result.json`、`summary.json` |

强制构建在冻结之前执行，随后只 pack 一次；外部安装、截图和报告均使用该冻结文件。完整根 `test` 与真实 `test:platform` 于冻结后启动。上述完整入口没有名称筛选、人工中止或将旧版本结果并入计数；外部消费者安装、截图和测试没有进入 Turbo 缓存。

## 独立原日志与冻结复读

控制方在自然退出后独立复读冻结清单、四组原日志/结果 JSON/summary，共 17 份文件；实际计数、退出码、启动与结束时序、CLI 原摘要均相符，`failures=[]`。结果为 `cli-0.0.23-full-test-edb985ec/root-engineering-regression-reopen.json`，SHA-256 `dc7e44d4f8dbd2a478d69aa9b0bfea4513bdc8a7eaa4b5e098e2438b8b0cc9ea`。

本次独立日志审计 helper 的第一次语法检查因生成字符串中的正则反斜杠丢失而 exit 1；没有运行任何产品测试，也没有写出成功审计文件。该诊断保留于同目录 `root-audit-helper-first-parse.log` 和 `root-audit-helper-first-parse.json`。读取源码、改为明确字符串检查后，语法检查与完整 17 文件审计均通过；不将 helper 失误记作产品失败，也不覆盖首次输出。

冻结原字节另由控制方独立拆包复读，包内全部 306 个 dist 文件与本次实际构建逐字节一致，307 个包条目、运行时私有依赖边界、产品及公共配置相对 `edb985ec` 零差异、原架构摘要均符合。结果为冻结目录 `root-initial-frozen-byte-reopen.json`，SHA-256 `026fdbca973273343b51346e53ccf14bdcf736dff15232f08323a6153069f173`。本轮后续只改文档，没有重包。

## 资源释放与未覆盖范围

完整平台本轮 owner 为 `f8074e4f-541a-4e83-939e-ddd69bb03e95`。控制方于 `2026-11-20T06:05:08.4041118+08:00` 实查其容器 0、卷 0、owned Gallery 已停止，`5173–5176` 无监听，随后才运行完整浏览器入口。原结果保留于 `cli-0.0.23-platform-edb985ec/root-owned-resources-after.json`。关闭恢复服务不等于删除 ignored 配置目录；后续清理只按精确归属清单进行，不扩大到共享 `.tools/recovery`。

收尾只读审计确认 `D:/project/zhinexus-design-asset-platform/.tools/recovery/f8074e4f-541a-4e83-939e-ddd69bb03e95` 仍保留四个普通凭证配置文件。原 `platform.log` 的 `PLATFORM_ISOLATED_SERVICES` 事件与原资源记录可精确关联该 owner，当前读取时容器、卷、精确路径匹配进程均为 0；但没有创建时 marker/首见 native 身份，不把事后身份冒充原始所有权证据，因此没有发出删除命令。配置内容未打开、未哈希、未写入证据。浏览器原日志仅含请求/作业 UUID，没有可确认的 recovery owner/路径，未扫描共享目录或按时间戳推断其残留。`root-engineering-cleanup-boundary-audit.json` 为 11785 bytes，SHA-256 `726ac0548317e28b199c8e2772ef303a5a5170273c5025aa31e9bc331b02a6c1`。本轮普通测试清理边界不等于所有本机临时目录已经清空。

本记录仅证明本轮隔离技术环境的工程门槛。真实业务试点、公司 OIDC、生产独立预览域与完整生产 G2 保持开放；本地签名 OIDC fixture 不冒称公司认证服务。新矩阵和黑盒/宿主结果各自验收，不能从上述工程测试推断通过。
