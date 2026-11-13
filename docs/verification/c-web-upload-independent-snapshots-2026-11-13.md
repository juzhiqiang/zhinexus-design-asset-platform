# C 网页发布中途快照与恢复顺序补充验证

日期：2026-11-13。本记录追加独立执行证据，不替代 B 最终固定提交验收，不改写先前 RED 记录。C 未修改 B 工作区的产品代码或测试。

## 快照来源

基础提交为 B `cddf54b721183c4bcedf18a6d607925fc12e7afc`。C 先 Git archive 导出独立目录 `.tools/operations/b-web-working-1653/source`，再复制 B 当时的四个未提交文件，复制前后核对摘要一致。该目录是中途快照，不能称为固定最终 Git 版本。

| 文件 | SHA-256 |
| --- | --- |
| `apps/gallery/app/(console)/upload/page.tsx` | `9ba460549508912cb45a7835d4d89aceb36d6578b16edaafb850afde4cb2d773` |
| `apps/gallery/app/lib/uploads/manifest-form.ts` | `f9aa00412fd5431db0d72d6a4cb5abe71f1128fbbec6603f3f6136d3f5bd40e7` |
| `apps/gallery/app/lib/uploads/screenshot-validation.ts` | `03fdd434404090d6497e8f75978acc783548f19cd090543e458266bbb550b8ce` |
| `tests/unit/web-upload-workflow.test.ts` | `aec6a057add15626f4e7c9a3a8938031d27d677184383dc4e3d96ff15880203d` |

离线冻结安装退出 0；`turbo run build --force` 10/10、零缓存，5.825 秒。构建设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。测试使用 C 独立的 5183 端口；B 的 5173–5176 未被占用。

## 已实际取得的中途 GREEN

- 既有显式工作流诊断 12/12 通过（当时 `58a8bef` 版本；网络为明确 mock）。
- C 恢复与摘要竞态浏览器 12/12 通过，13.3 秒；API 明确 mock，真实 Chromium 与目录字节/摘要校验。
- 新增真实三存储补充流程先通过 1 项、27.0 秒；按 A 的只读审查意见补强后再次通过 1 项、25.8 秒。

真实补充流程使用 `tests/acceptance/prepare-sdk0010-web-harness.mjs` 从归档中的 B 真实测试生成测试副本，仅修改测试文件。它将已有冻结批次替换为 SDK 0.0.10 的 `dcc49e73-37c6-4579-a814-713e780ae583`，同步三包精确摘要和 5183 端口，增加以下实际断言：

1. 初次真实上传返回 201，真实 release 返回 202，两者使用相同且非空的 `uploadSessionId`。
2. 202 后 pending、active id、active plan、draft 四键清空；保留最终 job 供轮询。
3. reload 后跨 2100ms 的多个轮询周期不出现恢复按钮，尝试发出的 release POST 仍仅一次，数据库 `release_jobs` 仅一条。
4. 真实 worker 到 READY，Verdaccio 可取得三个 0.0.10 版本。
5. 再次导入真实目录，新一次上传实际返回不同的非空 session；按该隔离 MinIO 的实际端口拦截 PUT，断言确实中断了 PUT、页面报错、没有新的 release POST、作业仍一条；上传失败后保留的是新活跃 session，没有 pending。

补强后的生成 spec SHA-256 为 `c7615ff5e2d28527e3f2478ba4bbc1dd982b99f04f694245622e999b91391e72`。辅助脚本要求目标处于本工作区 `.tools/operations` 内，不接受直接写入 B 业务工作区。三包没有重新 pack；验证前后摘要仍为 `2d9d4208…12e752`、`b01aeec7…8c01b`、`cd625741…b8e5c`。

同一补强 spec 在固定旧版 `cddf54b` 上再次真实 RED：初次 201/202 完成后，四个清理布尔值全部为 false，退出 1。旧版日志 `sdk0010-lifecycle-red-reviewed.log`；中途 GREEN 日志 `sdk0010-lifecycle-review.log`。四键断言只输出布尔值，避免失败日志打印临时签名 URL 或大清单。

## B 原浏览器用例尚未同步

C 将原有 8 项 manual 与 6 项真实三存储测试复制到独立归档（测试副本换 5183；真实补充使用 0.0.10），实跑 10 通过、4 失败、1.4 分钟，退出 1。日志 `web-suites-interim.log`。

失败用例为两个框架错配、legacy 恢复卡、上传接口 500。旧 fixture 的空 packages / 非法摘要先被当前严格 schema 拒绝，或者缺少恢复三元组而被正确拒绝；旧测试仍期待初始草稿的 blocker 或缺绑定恢复卡。已向 B 反馈：从完整合法清单只改目标字段，恢复正例补齐 API/subject/真实 digest，接口故障先到达真正可提交状态；不得为了旧 fixture 放宽生产校验。

该结果没有被记作网页最终通过。真实丢失 202 后刷新、原 key/session/同 job、数据库唯一作业和 READY 路径在本轮实际通过，但不能掩盖其余四项失败。

## 恢复顺序的新 RED

独立只读审查指出普通再次提交的 pending 校验位于 PUT/complete 之后。C 检查源码后增强 `web-upload-workflow.mts`：损坏 pending 要在网络副作用之前拒绝；新增有效 pending 与过期计划的普通重试例。

实际命令：

```powershell
.\scripts\pnpm.ps1 exec tsx tests/acceptance/web-upload-workflow.mts '<B 源码目录>'
```

结果 11 通过、2 失败，退出 1，证据 `.tools/operations/sdk-policy-audit/b-pending-order-red.json`：

- 同 session 损坏 pending 虽最终拒绝，但重复上传将计数从 59 增为 118，未在副作用之前失败。
- 有效同绑定 pending、计划已过期时，普通重试先访问过期上传地址并报 `EXPIRED_PRESIGNED_URL`，没有重放原 release。

这是明确 mock 网络的工作流诊断，不冒充真实 MinIO 过期测试。B 需在上传前校验 pending；有效 pending 重放原 session/key/manifest 并跳过已完成的上传/complete；同 session 损坏记录原样保留并提前拒绝；无关 pending 不得绕过计划过期检查。无 pending 的上传失败仍允许保留新活跃会话恢复，不能全局清空。

## C 本分支支撑验证

### 普通再次提交的真实网络 RED

随后生成器追加一个独立场景：复用 B 的真实丢 202 fixture，但不刷新、不点击恢复卡，而是再次点击普通提交。第一次 `route.fetch()` 取得真实 202、服务端已创建作业，再向浏览器丢弃响应。重试前只把浏览器持久化 plan 的过期元数据改为过去，并拦截该隔离 MinIO 实际端口的 PUT；这并非等待真实预签名 URL 自然到期。

监听器在第一次提交前安装，断言第一次 create / complete 各一、PUT 大于零，pending session 对齐真实请求；重试必须零新增 create / PUT / complete，并取得真实 202、同 job、同 key、相同原请求体，数据库全表仅一作业，成功后四键清空。复用既有 worker 推进 READY。新版生成 spec SHA-256 为 `dab34757c6db9c44bbc6fdb5163ba040d26b563fd89a9ec8d50484faf2b99a2b`。

在相同中途快照先遇到原 fixture 的 240 秒等待上限，日志 `normal-retry-real-red.log`；为明确诊断，将重试 response 等待缩至 10 秒并首先断言网络计数，再实跑退出 1：期望 PUT 185、实际 186，失败信息 `ordinary retry must not attempt another MinIO PUT`，日志 `normal-retry-real-red-bounded.log`。首轮真实 201、complete 200、release 202 均已在日志确认。没有改写前一条超时记录，也没有把该 RED 记作最终通过。

新增生成分支经独立只读审查未发现明确 Critical/Important；审查不代替执行。新版脚本 `node --check` 退出 0，独立归档中生成的 `.ts` 由该归档根 tsc 实际检查退出 0。

新增支撑脚本语法检查退出 0；在两个 C 自有独立归档成功生成相同测试副本；直接传入 B 业务工作区时按预期退出 1，没有写入 B。根 TypeScript 检查、工作区边界与 `git diff --check` 均退出 0。根 tsc 不包含全部 `.mts` / `.mjs`，不能把它称为这些辅助脚本的完整静态检查。

2026-11-13 17:10:08 启动 `.\scripts\pnpm.ps1 test`，实际 33 文件 / 600 项通过，158.03 秒、退出 0，日志为 `.tools/operations/sdk-policy-audit/c-root-after-web-acceptance.log`。服务前置构建命中已有缓存；测试由 Vitest 实际执行、没有进入 Turbo 缓存。该结果属于 C 分支，不能替代 B 最终源码的测试。

## 继续验收的边界

### 17:23 修复后独立快照 GREEN

C 再次从同一 `cddf54b` 导出全新目录 `.tools/operations/b-web-working-1723/source`，复制 B 最新四文件，逐文件复制前/后与目标摘要一致；没有覆盖 16:53 旧快照。新摘要如下：

| 文件 | SHA-256 |
| --- | --- |
| `apps/gallery/app/(console)/upload/page.tsx` | `af21838594e86db1686aecf6f01b69ea06bf2e278cd27d26868271e86f6d6111` |
| `apps/gallery/app/lib/uploads/manifest-form.ts` | `ca0cbcc4d71f7ff06a4c04e1e18c830035f9c9a4ab6f42c36e0819a0631e5867` |
| `apps/gallery/app/lib/uploads/screenshot-validation.ts` | `03fdd434404090d6497e8f75978acc783548f19cd090543e458266bbb550b8ce` |
| `tests/unit/web-upload-workflow.test.ts` | `bdb06af52b4304a187ba7536a795bdf9982a041de9540cf38452a48a919783a7` |

实际执行结果均退出 0：

- 离线冻结安装：6.8 秒。
- `turbo run build typecheck --force`：20/20，零缓存，6.57 秒；根 `tsc --project tsconfig.json --noEmit` 与 `verify:workspace` 通过。
- `vitest run tests/unit/web-upload-workflow.test.ts tests/unit/screenshot-validation.test.ts`：实际匹配 **1 文件 / 26 项**，422ms；后一个路径并未匹配独立测试文件，不将其称为第二套测试通过。
- 显式工作流诊断 13/13 通过，包括前述两项顺序 RED、同三元组重放、分别改清单/API/subject 的新会话隔离。
- C 的恢复/摘要竞态 UI 12/12，13.9 秒。
- 相同 `dab34757…99a2b` 补充 spec 的真实生命周期与普通提交重试 **2/2，52.4 秒**：202 后四键清理、刷新不重放、新发布获得新会话并在 PUT 中断后保留该新会话；真实丢失 202 后普通重试无新增 create / PUT / complete，原请求体/key/session/job 一致，真实 202 与数据库全表唯一作业、worker READY 均通过。

日志分别为该快照下 `install.log`、`force-build-typecheck.log`、`root-tsc.log`、`workspace.log`、`upload-unit.log`、`workflow.json`、`c-ui.log`、`real-lifecycle-retry.log`。C 只使用 5183，未占 B 的 5173–5176。结束后自有 RecoveryStack 无残留运行容器，5183 无监听。

这是固定文件摘要的中途 GREEN，尚未代替最终 Git hash。B 仍需同步原 manual / real 四项 fixture 并实际验证、提交修复与独立升版；C 将继续对最终提交归档验收。

固定快照两文件只读复审未发现 Critical/Important：确认 pending 在所有网络操作前验证并直接重放、过期计划不再由 pending 字符串兜底、API/subject/digest 绑定仍在、旧摘要结果取消与提交前重验仍在。非阻断边界另记：这不是多上下文草稿存储模型；最终文件校验的底层 WebCrypto 异常若直接 reject，因校验 await 位于后续 try/finally 之外，可能令页面保持提交忙碌。未把这些静态结论冒充测试执行，也未为该极端可用性边界扩大本轮修复范围。

### Claude 复核后的验收质量补强

Claude 首轮读取的是其映射中的旧文件，C 明确纠正版本后，采用其中适用的建议：新增完整合法网页清单导入正例，给创建会话及 release 都增加实际 API URL 断言，损坏 pending 的拒绝须匹配恢复错误码而非任意异常。脚本现在为 **14 项**。

在 C 自有忽略目录创建两个受控负例适配器，转发真实生产工作流而只故意破坏一个边界：

- parser 恒返回拒绝：实际 13 通过 / 1 失败，新增合法导入正例按预期 RED；日志 `sdk-policy-audit/b-workflow-reject-all-red.json`。
- 请求 adapter 把 create / release URL 写死为旧 API：实际 13 通过 / 1 失败，API 切换例明确报目标不等，按预期 RED；日志 `sdk-policy-audit/b-workflow-wrong-api-red.json`。
- 同一最新版 14 项重新对上述固定真实源码快照执行，14/14 GREEN、退出 0；日志 `sdk-policy-audit/b-workflow-14-green-reviewed.json`。没有修改固定快照产品文件或 B 工作区。

保留四键清理是本轮明确的会话生命周期要求；保留零重复 complete 是“有效 pending 直接重放 release”契约，即使服务端重复 complete 本身幂等，也不能拿它替代该前端时序验收。mock 工作流仍不宣称真实网络证据，后者已由前述两项实际执行取得。

B 恢复顺序已在上述固定文件快照中实际转为 GREEN。继续等待原浏览器 fixture 同步和 fix/独立升版固定提交；C 再从最终 hash 导出归档，执行构建、类型、工作区、单元、14 项显式工作流、12 项 UI、原 14 项网页及 0.0.10 真实补充验收。以上中途快照不能替代最终结果。

共享三存储未初始化、未重启、未轮换凭据；真实测试仅使用自有随机端口 RecoveryStack，已检查本轮容器清理和 5183 释放。公司 OIDC、生产独立域/TLS、真实 Vue/React 业务试点及完整 G2/M2/T10/T11/T12 仍未验收。
