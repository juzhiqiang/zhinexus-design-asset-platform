# T17 冻结 CLI 0.0.20 回归记录（2026-11-20）

本轮复用一次冻结的 `company-component-cli-0.0.20.tgz`，451327 字节，SHA-256 `8d56d87e9cc832562c096ba8cd16504ffb5104e688ca8a3df9436447df6c4252`。SDK manifest SHA-256 为 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`，core 0.0.11、Vue/React 0.0.12；未重新 pack CLI 或 SDK。

所有命令通过 `./scripts/pnpm.ps1 -PnpmArgs @(...)` 运行固定 Node 26.13.0、pnpm 12.18.0。安装验收设置 `PHASE3_CLI_TARBALL` 为上述冻结包，设置有效 `A10_FROZEN_BUNDLE`、`ZHINEXUS_SDK_BUNDLE_DIR` 及历史 `INSTALLED_CLI_EVIDENCE`；历史探针不冒充本轮新兼容探针。

| 实际命令参数 | 结果 | 仓外证据目录（同一日期根下） |
| --- | --- | --- |
| `exec turbo run build typecheck --force`，随后根 `tsc -p tsconfig.json --noEmit` | 全图 20/20、0 cached、exit 0、18.103 秒；tsc exit 0 | `workspace-0.0.20-8d4edd6643ed45c2ac85c3a8ac6c123f` |
| `test:browser` | 288/288，exit 0、约 3.2 分钟，含六项真实三存储网页提交 | `browser-0.0.20-bbcc80e8085e4dfa881798fe345ecdf9` |
| `exec vitest run --config tests/acceptance/phase3-plan.config.ts` | T15 25/25，exit 0、58.86 秒 | `t15-t16-0.0.20-80b1dcebfc144e2291c6e29baf206932` |
| `exec vitest run --config tests/acceptance/t16-installed.config.ts` | T16 完整 14/14，exit 0、786.02 秒，含 Next App Router、无用例名过滤 | 同上 |
| `test`（首次完整） | T10 168/168、0 skipped；Vitest 2123 passed / 3 failed，120 文件，exit 1、727.53 秒 | `full-test-0.0.20-03f61ce2b451435db4756dd1fc50767d` |
| `test:platform`（首次） | 135 passed / 2 skipped，exit 0；两项真实画廊未设置环境而跳过 | 同上 |
| 设置 `PHASE2_GALLERY_ORIGIN=http://127.0.0.1:5173` 的完整 `test:platform` | 35 文件、137/137、0 skipped，exit 0、388.94 秒 | `platform-0.0.20-complete-19d6684d4b004bceb7b2245f9672fc0f` |

日期根为 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20`。完整根 test 的三项失败修正及窄测见 `t17-regression-stability-2026-11-20.md`，不得把窄测替代最终完整根回归。上述构建检查在后续 N10 夹具/评分补齐之前执行，验收代码稳定后须重新检查测试源码。

## 本轮工程与服务清理

T15 owner `e752afc5-a9ec-47a6-a00a-ecaafda6c8a2`、T16 owner `4c87b008-fa44-498c-85b2-8e613c3bb665`；测试结束后独立核对其 Docker 容器、卷均为 0。已把 T15 顶层 4 份 JSON、T16 顶层 103 份 JSON 及本轮 t16-d 的 18 份过程/恢复证据复制到上述稳定目录，全部原件和副本逐份校验字节与 SHA-256，JWT/Bearer 形态扫描未命中。原配置、缓存和 node_modules 不归档。

已核验安装 CLI 为 0.0.20，冻结摘要前后相同，三个根无活动进程；T16 内 8 个 workspace junction 的目标均在该同一临时根内，根本身无链接。以下精确本轮目录已移入 Windows 回收站，复核原路径均不存在：

- `C:/Users/10208/AppData/Local/Temp/zhinexus-t15-installed-wGOff4`
- `C:/Users/10208/AppData/Local/Temp/zhinexus-t16-installed-7KHQZw`
- `C:/Users/10208/AppData/Local/Temp/t16-d-R8a3hQ`

本轮清理记录为 `process-evidence-audit.json`、`t16-d-installed-recovery-evidence/evidence-audit.json`、`cleanup-inspection-0020.json`、`cleanup-result-0020.json`。未清空回收站，也未再次操作此前自动审批拒绝的目录。

完整平台最后一轮 owner 为 `19502af6-8df3-4b7e-a507-67b2caa47cb6`，本轮单独启动已构建 Next 画廊后执行，随后结束对应会话并确认 5173 已释放；其服务仍为本地隔离签名 fixture，`productionAcceptance=false`。以上结果均不代表历史真实业务试点或生产 G2 完成，也不替代 T17 宿主、33 格矩阵及黑盒各自的验收结论。
