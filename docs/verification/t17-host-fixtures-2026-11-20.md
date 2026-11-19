# T17 冻结产品宿主夹具修正（2026-11-20）

本记录补充完整宿主真实失败后的夹具修复，不改写既有失败结果，不修改 CLI 产品，也不重新 pack 0.0.20。

- Vite 构建图插件在没有 `T17_BUILD_GRAPH_OUT` 时原先把 undefined 交给 writeFileSync，冻结产品正确清洗额外环境变量后构建失败。插件改为仅在显式提供输出路径时写构建图；独立预构建仍必须生成真实模块证明。Vue/React 缺环境两例 RED，四例回归 GREEN。
- 原 TEMP/TMP 指向消费者源码树内，原生编译缓存正确触发产品源码变更守卫。缓存迁入本轮自有的工程外证据区，正常与失败路径均登记原有内容、封存和清理身份；真实 OwnedRun 的失败清理回归先 RED 后 GREEN，未放宽源码守卫。
- 原冻结子进程未取得项目包装器设置的本地 Playwright 路径，完整宿主第二轮 type/build/dependency 通过后浏览器启动失败。真实最小 probe 使用相同环境失败，单独增加项目 `.tools/playwright` 后启动 Chromium 158.0.8127.18 成功。chain 通过现有 extraEnv 传入已验证 toolchain.repositoryRoot 下的固定缓存目录；未扩 runtime 白名单或采用全局浏览器。新增路径期望先 RED 后 GREEN。

作者完整 host 支架为 10 文件、118/118，根 TypeScript exit 0。集成方独立执行：

```powershell
./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-host/vitest.config.ts')
```

2026-11-20 03:06 实际 10 文件、118/118，exit 0、20.53 秒。集成方同步全根 TypeScript 检查撞到并行 N10 评分接口未完成窗口，不能据此声称最终全根检查通过，待接口完成后统一复验。

第二轮完整宿主仍如实为失败（218.49 秒），1077 份失败证据已逐份核对摘要后保留，JWT 形态扫描 0 命中；本轮正向、参考、recovery 目录已按所有权守卫清理，所属容器/卷为 0。第三轮使用同一 0.0.20 tarball SHA-256 `8d56d87e9cc832562c096ba8cd16504ffb5104e688ca8a3df9436447df6c4252` 重新运行，结果另记；本记录不将支架通过等同完整双框架及 repair 验收通过。
