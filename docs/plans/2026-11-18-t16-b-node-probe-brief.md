# T16 B 固定 Node 版本探针补修

日期：2026-11-18。沿用已批准安装隔离设计、B 产品文件范围与 C 测试所有权。

当前 `resolveToolchain` 仅校验 npm 与 pnpm 版本；路径包含 Node 版本不证明真实二进制版本。必须用同一固定绝对路径和隔离环境、`shell:false` 调用裸 `node.exe --version`，精确要求 `v26.13.0`，在 npm/pnpm 探针和任何候选锁/物化启动之前拒绝版本不符或进程失败。禁止从 PATH 获取、自动切换或下载工具链。

C 已新增三个独立产品测试：错误 Node 版本、Node 探针非零退出、固定正确 Node 版本。只通过测试私有进程拦截修改裸 Node 探针结果，不给产品增加公开 runner。三项均因未执行裸 Node 探针得到 RED。整文件实际命令：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-install-isolation.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/node-probe-full-red.json')
```

退出 1，19 collected / 11 passed / 8 failed / 0 pending；其中 5 项为已交接 pnpm12 兼容 RED，3 项为本轮 Node 探针 RED。JSON 与同名日志保留在当前工作树。此前筛选 `-t Node` 的运行仅验证这 3 项，另外 16 项未选择，不能作为全套验证。

B 只修产品 `integration/install.ts` 的真实工具链接点；C 独占所有 project 测试、helpers、契约、版本和记录。保留其他隔离与恢复要求，不放宽断言，不提交/pack/升版/merge/push。完成停写交 C 宿主复验。
