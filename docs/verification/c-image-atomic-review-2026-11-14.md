# C：镜像登记并发审查补充

基线：`fd03185732fadad04e3fe913d99f9b9f4df0456d`；分支 `chore/c-local-acceptance`。2026-11-14，Windows x64，Node 26.13.0 / pnpm 12.18.0。此记录补充独立审查与返工，不改写已完成的验证记录。

## 审查发现与处理

独立审查指出 P2：`writeFileSync(images.json, ..., { flag: 'wx' })` 虽然不覆盖已有文件，但创建与写入并非完整内容的原子发布。另一首次登记进程可能在 open 与 write 之间把空文件判为坏登记；写入方中断也会留下坏登记。

新增确定性交错测试：仅拦截文件写入边界，真实打开文件后、写入内容前调用第二次 `imageId()`。RED 为 8 通过、1 失败，第二次调用实际返回 `Invalid local MinIO image identity record`，首进程结束后 JSON 却完整，确认根因。

实现改为同目录建立唯一暂存目录，写完 JSON，再通过硬链接以无覆盖方式原子发布完整文件。目标已存在时重新核验胜出的登记；正常或异常路径均清理自身暂存目录。现有坏登记仍失败关闭，不用重试或覆盖掩盖坏记录。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/unit/local-images.test.ts')`（修复前） | RED：1 failed / 8 passed，失败为第二进程读到空登记 |
| 两个新增 unit 文件（修复后） | GREEN：2 文件、10/10；交错调用成功，最终登记完整且无暂存残留 |
| `scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 通过；首次检查发现测试桩未兼容数字文件描述符，补齐转发后通过 |
| `scripts/pnpm.ps1 test` | **38 文件，693/693**，退出 0；行为测试实际执行，183.67 秒 |
| `scripts/pnpm.ps1 verify:workspace` | 10 members、无环、4 个公开包、服务端依赖闭包安全 |
| `git diff --check` | 通过 |
| 原架构 SHA-256 | `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，未变 |

根测试日志：当前 C 工作树忽略目录 `.tools/c-review-fix-root-test.log`。服务前置构建命中 Turbo 缓存，未将其作为全图零缓存构建证据。既有 Node `DEP0190` 警告仍存在。

原平台 88 项、备份与恢复专项结果仍绑定前一记录；本次没有把它们称为再次运行。A/B 分支、生产 OIDC/独立域、真实业务试点和强制终止进程后的完整清理仍不包含在此结论内。该修改仅涉及本地验证设施，不触发产品版本递增。
