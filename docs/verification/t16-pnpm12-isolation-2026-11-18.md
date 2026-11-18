# T16 固定 pnpm 12.18.0 安装隔离兼容证据

C 本轮独立记录，不改写旧验证结果。当前版本兼容修复与真实安装验收尚未完成，完整 T16/T17 未验收。

实际命令：`.\.tools\node-v26.13.0-win-x64\node.exe scripts/verification/t16-pnpm12-characterization.mjs`，退出码 0。隔离环境不传完整宿主配置或凭据；输出留存 `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/pnpm12-characterization.json`。

| 检查 | 实际结果 |
| --- | --- |
| 固定原生二进制 `--version` | 12.18.0，exit 0 |
| 固定 staging YAML、pmOnFail:error、内部环境版本切换=false | 候选锁 exit 0；冻结物化 exit 0；yaml 2.9.1 实际安装 |
| preinstall/install/postinstall 与 pnpmfile poison | 标记文件不存在 |
| pnpm pin=12.17.0，实际 12.18.0 | ERR_PNPM_BAD_PM_VERSION，exit 1，未创建锁或 node_modules |
| 旧 YAML managePackageManagerVersions:false | ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS，exit 1，未创建锁 |

裁定：保留固定工具链边界；旧 YAML 改为 `pmOnFail:error`，禁止自动版本切换由产品内部环境 `PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS=false` 强制实现。`initPackageManager` 是初始化设置，不能作为安全替代项。

精确上游 v12.18.0 commit `018ce5ebba2174c566f730e4f3786adb4b151d43`：`pnpm/crates/cli/src/cli_args/package_manager.rs`、`pnpm/crates/cli/tests/suite/package_manager_check.rs`、`pnpm/crates/config/src/known_settings.rs` 与 `pnpm/crates/cli/src/cli_args/pre_command/load_config.rs` 已实际读取；本机行为证据优先于当前文档和拼写建议。

C 更新独立安装隔离 expected 后实跑 `scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-install-isolation.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/pnpm12-product-red.json')`：16 collected，11 passed / 5 failed / 0 pending，exit 1。新增失败对应固定 YAML 与内部环境缺失，未修改 B 产品。真实八组合首轮的配置拒绝与夹具锁生成错误不冒称产品 RED；成功矩阵删除不支持的项目动态配置，保留生命周期 poison，恶意配置单独核验 blocked 与零写入。
