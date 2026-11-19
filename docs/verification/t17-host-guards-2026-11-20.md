# T17 临时宿主封存与清理守卫补充

本记录仅证明验收设施的定向回归，不将临时 synthetic 工程等同历史真实业务试点，也不声明完整 T17 已通过。

- `prepareInstallDelivery` 在 apply 前捕获自有项目原安装树、父目录和空备份区的身份与完整字节。执行后只凭绑定 projectRoot、operationId、planDigest、importer、targets 的真实 install-delivery journal，复验原树 inode/字节和父目录变化，才登记产品 quarantine。目录名前缀本身不能授予所有权。
- receipt 回读完整 verify-out 清单、文件实际字节及路径身份，并将 spec baseline、repair backupRef、备份内容与 beforeHashes 绑定。增加删改基线、备份、未知新增文件、junction/hardlink 和目录替换的真实 RED/GREEN。
- npm 下载 cache 外移到每次独占的工程外 evidence area，保留工程内空配置的身份与字节守卫；真实大于 4 MiB 文件回归 RED→GREEN，未调宽产品源码快照预算。
- cache inventory 安全拒绝前先保存有界 stdout/stderr。新回归 RED 1 failed（缺失输出）；修复后完整 `exec vitest run --config tests/acceptance/t17-host/vitest.config.ts` 为 9 文件、111/111、exit 0、15.75 秒。
- 独立审查复跑 host/chain/runtime/chain-failure 为 88/88、exit 0、9.46 秒；未发现 confirmed Critical/Important。审查记录位于仓外 `host-independent-review-5ae1c2cc/review-summary.json`。
- 集成全图 `exec turbo run build typecheck --force` 为 20/20、0 cached、exit 0；根 tsc exit 0。原始日志位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/workspace-0.0.20-8d4edd6643ed45c2ac85c3a8ac6c123f`。

完整产品入口为 `tests/acceptance/t17-host/local-product.vitest.config.ts`，需独立记录双框架通过及已知模板故障实际 failed→repair→passed；上述单元配置不替代该验收。
