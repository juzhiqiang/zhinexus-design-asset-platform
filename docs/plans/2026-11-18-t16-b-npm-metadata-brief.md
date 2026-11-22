# T16 B npm 隐藏锁元数据补修

日期：2026-11-18。沿用已批准安装隔离设计，B 独占产品源码，C 独占测试、验收配置、契约、记录及版本。

C 真实 Vue/npm/standalone 运行已穿过第三方依赖和冻结 SDK 下载：npm ci exit 0，所有相关 tarball 请求成功，staging 依赖树存在，候选锁在物化前后 SHA-256 均为 `236ae4b7788a0e49f33c95438f73eb782bffb8b06a9f61130c8025028f756cfc`。CLI 随后返回 rolled-back / INSTALL_FAILED / reinstall-required，尚未成功交付或构建。

阻断位于 `integration/install.ts` 的 `planDelivery`：npm 自动写入 `node_modules/.package-lock.json` 普通文件，根条目枚举仅接受目录，因而报 PATH_UNSAFE，再由 apply 映射到 INSTALL_FAILED。请处理这个已知 npm 元数据文件，维持链接、硬链接、树范围和交付前核验；不能简单忽略任意隐藏条目或允许任意普通文件。此元数据是否复制应由安全交付设计确定，不能将 staging 绝对路径带入目标。

C 在 `tests/integration/project-install-isolation.test.ts` 补了普通文件及同名工程外链接两条独立测试：普通文件导致合法安装回退，RED；工程外链接失败关闭、外部树字节不变、不交付 SDK，GREEN。命令：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-install-isolation.test.ts','-t','npm 隐藏锁元数据','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/npm-hidden-lock-red.json')
```

实际 exit 1，21 collected / 1 passed / 1 failed / 19 未选择，无收集错误。最新三个产品文件全跑为 84 collected / 73 passed / 11 failed / 0 pending，证据 `product-current-red-84.{json,log}`。另外 10 项对应 Node 探针、pnpm 固定 YAML/环境、React 完整 API 与 onPointClick 绑定；请同时读取已有三个补修 brief，不放宽 C 测试。

只在指定 B+C 工作树修改已有 B 产品文件。完成停写交 C，不提交、升版、pack、merge 或 push；C 后续重新构建并验证真实安装矩阵，再冻结正式产物。
