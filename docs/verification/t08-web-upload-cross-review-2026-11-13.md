# T08 网页上传链路只读交叉审查记录（A 侧）

日期：2026-11-13。负责人：A（SDK）。分支：`feat/t10-sdk-compatibility`，**本文提交前的基线 HEAD 为 `e57a6ba`**；本次只新增与修订文档，提交后 HEAD 必然变化，引用时以 `git log` 为准。

本文是 A 对 B/C 网页上传发布链路的**只读交叉审查**留痕，不是验收证据。本轮 A 未修改任何 B/C 文件、未启动服务、未重复执行测试、未重新打包或升 SDK 版本。SDK 侧零改动：三包仍为 `0.0.10`，`feat/t10-sdk-compatibility` 的 HEAD 仍为 `e57a6ba`。

审查对象是 C 在 `fix/c-sdk14-acceptance` 上的 `tests/acceptance/web-upload-workflow.mts` 及其配套记录，共三轮，分别对应 C 的提交 `58a8bef`（12 项）、`9053b85`（13 项，新增 `tests/acceptance/prepare-sdk0010-web-harness.mjs`）、`35dd9ab`（14 项）。第一轮我读到的是映射里的旧文件，C 纠正版本后切到 `9053b85` 与 `35dd9ab`，本文一律以最新版为准。

## 一、先钉归因边界

红绿数字本身不说明任何事，除非先说明它是对着什么跑的。这一节是全部分结论的前提。

该脚本**不能**在 `fix/c-sdk14-acceptance` 自己的树上运行：`9053b85` 与 `35dd9ab` 的 `apps/gallery/app/lib/uploads/manifest-form.ts` 只有 7 个导出，而脚本第 7 行导入的 `executeWebUploadWorkflow`、`createSevenComponentsManifest`、`parseAndValidateImportedManifest` 在该文件里出现次数均为 0（三者只存在于 `feat/t08-real-web-upload@cddf54b` 与 B 的未提交副本）。用默认 `target = process.cwd()` 会直接抛 `TypeError`，12/14 项全红。

它也不是 Playwright 用例：`tests/acceptance/playwright.web-upload.config.ts` 的 `testMatch` 是 `web-upload-*.spec.ts`，不匹配 `.mts`。实际执行方式是 `pnpm exec tsx tests/acceptance/web-upload-workflow.mts '<B 源码目录>'`，由人手动指定目标。

因此「14/14 GREEN」的属性是 **B 的 17:23 文件 SHA 快照**，不是任何 Git 提交。C 的记录用四文件 SHA-256 表（`page.tsx`、`manifest-form.ts`、`screenshot-validation.ts`、`tests/unit/web-upload-workflow.test.ts`）做归因，这是正确的做法；B 的 fix/独立升版固定提交落地后，必须从最终 hash 重新导出归档、按同一张表重采一次，中途快照不能替代最终结果。

该脚本自带的输出字段 `kind: 'local workflow diagnostics with mock network; not browser or storage evidence'` 应当保留。mock 网络部分只是工作流诊断；真实三存储证据只由 C 的 Nest/MinIO/Verdaccio 补充承担（首轮 201、complete 200、release 202，重试 PUT 185→186 的 RED 是全套材料里最硬的一条，因为它不是 mock 计数）。

## 二、已采纳的建议（`35dd9ab`）

我提出的三项建议全部落入 `35dd9ab`，且 C 用两个受控负对照证明了它们是承重的，不是装饰。

**合法导入正例。** 新增第 58 行 `accept a complete valid web manifest`，断言 `createSevenComponentsManifest()` 原样序列化后 `parseAndValidateImportedManifest` 返回 `ok: true`。在这之前，第 64–75 行那六项只测「必须拒绝」，把 parser 改成恒返回 `ok: false` 能六项全过；补上正例后这条退路被堵住。C 的负对照实测：parser 恒拒绝时 13 通过 / 1 失败，正是这一例按预期 RED。

**恢复错误码精确断言。** 第 105 行由 `assert.rejects(..., undefined, ...)` 改为 `/(?:INVALID|CORRUPTED|TAMPERED)_PENDING_RELEASE/`。原来的写法只断言「拒绝了」，不断言为什么；若拒绝来自缺 `subject`、`FILE_NOT_FOUND` 之类无关路径，这一例照样绿。顺带这也确认了 B 的修复确实走了恢复守卫分支，而不是碰巧在别处抛错。

**切换接口的真实请求目标断言。** 第 20、24 行新增 `createdApiUrls`，第 21 行起 `submissions` 记录 `apiUrl`，第 46–47 行断言 `createdApiUrls.at(-1)` 与 `submissions[1].apiUrl` 都等于 `next.apiUrl`。在此之前 mock 把 URL 当参数吞掉，`api` 一例根本无法分辨字节和请求发到了哪个接口。C 的负对照实测：adapter 把 create/release 的 URL 写死为旧 API 时 13 通过 / 1 失败，正是 `api` 例按预期 RED。

实测结果：同一最新版 14 项对固定真实源码快照 14/14 GREEN、退出 0；对旧恢复顺序快照 12/14 RED。真实三存储补充 2/2、UI 12/12 亦通过，但同样只覆盖文件 SHA 快照。

## 三、已被证据关闭、不需要再改的项

**`manifestDigest` 字段是否存在的问题。** 我在第二轮指出第 98 行篡改的 `pending.manifestDigest` 在我能核到的 `cddf54b` 里既不被写入也不被读取（pending 记录是 `{idempotencyKey, uploadSessionId, manifest, timestamp}`，见 `manifest-form.ts:781-789`），测试因此耦合到一个只存在于 B 未提交副本里的字段名。`35dd9ab` 之后这一项可以关闭：14/14 GREEN 加上第 105 行的错误码正则，证明 B 的修复产品里该守卫真实存在且读取被篡改的字段。残留只是一个低危耦合——若 B 日后改成从 `parsed.manifest` 重新推导摘要，这一例会失效，届时改篡改目标即可，不需要现在动。

**归因不清的问题。** 第一轮的 C-1/C-2（测试 committed 在一个跑不起来的提交上、`cddf54b` 上预期 12 红而非 11 过 2 败）已由 C 记录的快照 SHA 表与「中途快照不能称为固定最终 Git 版本」的明确措辞关闭。今后引用这组数字必须连带引用快照 SHA。

## 四、C 明确保留并给出理由的两项

我保留技术意见，但不要求再改；记在这里是为了下次讨论时不用从零开始。

**四键清理包含 `zhinexus_upload_draft`。** 第 51 行与第 166 行都要求成功后将 `zhinexus_upload_draft` 一并清空。该键在全仓库只被写（`manifest-form.ts:692`，每次 execute 都用新时间戳覆盖）和一处单测断言（`tests/unit/web-upload-workflow.test.ts:233`），产品代码从不读它，恢复卡也不看它，清不清对行为零影响。C 已把它定为本轮明确的会话生命周期要求，属于产品决策而非疏漏，可以接受。

**零重复 complete。** 第 163 行 `completes == 1`。服务端 `complete()` 对已完成会话是幂等的（`apps/api/src/uploads/service.ts:59` `if (row.state === 'COMPLETE') return null;`，紧接第 66 行直接返回成功），所以重复 complete 不会造成错误，这一条本质是效率与契约表达。C 的注释已写明「这是有效 pending 直接重放 release 的契约，即使服务端重复 complete 本身幂等，也不能拿它替代该前端时序验收」，理由成立。同一处的 `uploads == firstUploads` 则要保留，且理由比卫生更强：它是「过期计划不得阻断重放」的唯一执行机制，少了它，一个选择重新上传的实现能过 `creates == 1` 与 `deepEqual`，却会在真实过期预签名 URL 上卡死。

## 五、仍未覆盖的边界

以下均为**范围边界与未覆盖项**，不是本轮实跑缺陷，也不据此扩大本轮修复范围；B 的最终提交复验时可一并考虑。

**多上下文旧 pending 的留存是已知范围边界，记为后续设计项，不是本轮缺陷。** 第 51 行要求改变 digest/api/subject 后四键全部为 null，也就是说持有着**唯一一份**原始幂等键的 pending 记录被清掉；该键是 `web-${Date.now()}-${Math.random()...}`（`manifest-form.ts:780`），随机且不可从 manifest 重新推导。在「同一后端、相同包名版本已被首笔 job 预留」的前提下（见下一条），这会让第一次那笔发布在 UI 侧失去 reconcile 途径。14 项里没有任何一条断言原始键在被覆盖前被留存到别处（例如并入 `zhinexus_web_release_session`）。

本地单草稿存储模型不支持多上下文共存，这是 C 已注明的已知边界；是否要为多上下文保留旧 pending 属于后续设计项，本轮不据此增加功能，也不把这条静态推断当作实跑缺陷。

**digest/subject 的「必须成功」只证明客户端隔离，不证明重复版本能发布。** 我在第二轮把这条判为过度约束；看到修复产品 14/14 GREEN 后需要再次收窄表述：客户端走「新 session + 新 key」是自洽的，而 14 项全部使用 mock `submitReleaseJob`，**只验证客户端隔离，不证明端到端能发布成功**。

在**同一后端、且首笔 job 已预留相同包名与版本**这个前提下，该路径的结局是服务端拒绝：`releases/service.ts:52` 按 `WHERE subject=$1 AND idempotency_key=$2` 查重，命中后第 57 行比对 `request_digest`/`client_id`/`channel`，不一致即 `CONFLICT`；若换新 key，则撞 `001_registry.sql:73` 的 `package_releases UNIQUE(name, version)`，而我在 `apps/api/src` 全范围 grep `DELETE FROM (package_releases|variant_releases|release_jobs)` **零命中**，即没有回滚会释放该占用。

但这不是普遍必败：切换 API 可以指向另一个隔离后端（那里不存在该预留），改清单也可以改到一个合法的新版本号。因此这一条的准确定义是「端到端结局未被任何用例覆盖」，而不是「必然失败」。它属于已知范围边界，不构成本轮缺陷，也不据此扩大修复范围。

**complete 响应丢失没有正例，其行为我不做推断。** `expired-before-pending` 覆盖的是「上传失败 + 无 pending」，第 13 例覆盖「complete 成功 + release 响应丢失」；唯独「complete 的响应丢失」没有正例。按 pending 写在 complete 之后的时序（`manifest-form.ts:781-789`），它落入「无 pending」分支，但该分支在当前产品里究竟是复用活跃会话还是新建，**我没有正例、也不推断**：据 B 的说明，无 pending 且会话三元组一致、plan 未过期时复用活跃会话，仅 plan 过期才新建。要钉住它需要一条专门的正例。

**mock 的固有限权。** `completeUploadSession` 的 mock（第 90 行）永不抛错，所以「complete 先于 pending 校验」只靠计数器发现；`uploadFileBytes` 的 mock 也只在第 89 行那一个分支抛错。真实网络里 complete 会因会话过期返回 `UPLOAD_INCOMPLETE`（`uploads/service.ts` 中 `row.expires_at <= now` 分支），这一层行为没有任何 mock 或真实用例表达。

**C 自行记录的非阻断边界（转述，非 A 提出）。** 最终文件校验底层若抛 WebCrypto 异常并直接 reject，由于该校验的 `await` 位于后续 `try/finally` 之外，可能令页面停留在提交忙碌状态。C 明确未把该静态结论冒充测试执行，也未为本轮扩大修复范围。

## 六、SDK 侧状态（未动）

分支 `feat/t10-sdk-compatibility`，本文提交前 HEAD `e57a6ba`；三包 `0.0.10`；未重新打包、未升版、未改任何 `packages/` 源码。T10 兼容策略、T11/T12 消费方交接材料的结论以 [T11/T12 SDK 消费方交接材料](t11-t12-sdk-consumer-handover-2026-11-13.md) 为准，本文不重复。

T08 的真实实现只存在于 `feat/t08-real-web-upload@cddf54b`，`git merge-base --is-ancestor cddf54b main` 为否；`main` 上的上传页仍是不传真实字节的 stub。任何上传行为的复现都必须先声明在哪个提交或哪个快照上进行。

## 七、相关文档

- [T11/T12 SDK 消费方交接材料](t11-t12-sdk-consumer-handover-2026-11-13.md)：SDK 使用与回退，本文不涉及消费者导入。
- [T09 SDK 证据核对](t09-sdk-evidence-audit.md)：七组件 14 实现的证据盘点。
- C 的独立记录在 `fix/c-sdk14-acceptance`：`docs/verification/c-web-upload-independent-snapshots-2026-11-13.md`（提交 `9053b85`、`3164e4d`、`35dd9ab`）。
