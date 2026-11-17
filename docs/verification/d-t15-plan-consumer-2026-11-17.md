# D / T15 黑盒验收准备与 RED

日期：2026-11-17。工作分支 `chore/t15-d-plan-acceptance`，P0 基线 `31ae120a270e84ab7c100d3ad77919b233d1d48b`。本记录仅证明验收准备和行为 RED，P3 GREEN 与 T15 完成尚未达成。

## 实际客户端与宿主配合

测试和文档通过实际 Claude Code 会话 `bae14ee4-36a8-48f8-b530-6520d076b6c0` 生成。客户端曾出现工具参数解析错误；已写出的文件保留，后续由同一会话输出文件内容，C Windows 宿主保存、校对契约、执行固定工具链及 Git。未将客户端故障视为测试通过。

独立 Codex 只读审查发现三处误通过风险，C 按审查修正：所有通用调用前后比较项目全树；inspect 结果执行完整 inspection 校验及必需快照断言；API 500 反例要求实际 GET 和正确平台令牌。审查没有替代用户指定的实际开发客户端。

## 验收内容

- 子进程只执行构建后的 `packages/component-cli/dist/bin.js`；不导入 CLI 产品模块。只观察参数、环境、退出码、stdout/stderr 及文件副作用。
- synthetic 项目在工作区外临时目录创建；完整目录集合、文件原始字节 SHA 和链接目标逐项比较。参数、输入 JSON 和网络失败分支也检查零写入。
- inspection 校验 Vue/npm、React/pnpm、精确锁版本、快照和 Git 脏路径。计划校验结构、来源摘要、依赖及生成意图；缺 prop/event、unverified、撤权均必须阻塞。
- 恶意生命周期/配置及真实 Git fsmonitor marker control；Git 环境覆盖反例要求实际目标和诱饵仓库均保持不变。
- Windows 实际创建 junction，检查目标根外字节不变；创建不可用时报环境失败，不能冒充覆盖。
- tarball 响应暂停期间分别修改关键文件、撤权和废弃。恢复响应后要求重新读取并阻塞；用户编辑后的完整快照必须保留。
- API 与 registry 使用不同 loopback origin，逐请求校验令牌分离；跨 origin tarball redirect 目标必须零请求。错误响应主动回显两个 synthetic 令牌，输出仍须脱敏。

HTTP stub 仅证明协议边界，synthetic tarball 仅提供固定下载字节及摘要，不作为真实发布或兼容证据。真实 Nest/PostgreSQL/MinIO/Verdaccio 和冻结消费者由 C P4 专项验收。

## 实际验证

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','--noEmit','--ignoreConfig','--target','es2022','--module','nodenext','--moduleResolution','nodenext','--strict','--skipLibCheck','--types','node','tests/fixtures/phase3-cli-harness.ts','tests/integration/project-plan-consumer.test.ts','tests/integration/project-plan-readonly.test.ts')
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan-consumer.test.ts tests/integration/project-plan-readonly.test.ts
```

- 窄 TypeScript 检查：exit 0。
- 初始宿主 RED：30/30 行为失败；加入 redirect 及审查修正后最终 **31/31 行为失败、0 跳过、exit 1**。命令尚未实现导致退出码、输出及请求屏障反例失败；未出现夹具、junction 或 Git marker 环境准备失败。
- 日志依次保留于 `.superpowers/t15/p3-red-host2.log`、`p3-red-host3.log`、`p3-red-host4.log`，不改写此前失败记录。
- 根 TypeScript 与 `git diff --check` 的提交前结果由宿主追加；只提交 RED 准备子任务，不宣称完整根测试通过。

### 宿主提交前补充验证

首次根 TypeScript 检查因独立工作树尚无 Nest/SDK 构建声明而失败，属于环境前置缺失，不计行为 RED。随后 C 在 D 工作树执行：

```powershell
.\scripts\pnpm.ps1 exec turbo run build typecheck --force
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
git diff --check
```

全图构建和类型检查实际 **20/20 成功、0 cached、exit 0**；补建后根 TypeScript **exit 0**；diff 检查 **exit 0**。日志保存于 `.superpowers/t15/p3-graph-build-2026-11-17.log` 与 `p3-root-tsc-final-2026-11-17.log`。此次提交仍只完成 RED 验收准备；31 项产品行为尚未 GREEN，不标记 P3 或 T15 完成。

## 后续门槛

B 冻结产品后按 A → B → D 次序集成，在同一候选运行 P3 GREEN、C 真实安装专项及完整回归。使用说明当前为草案，示例将在 GREEN 时实际复核。T16/T17、下载限额和超时的完整覆盖、14 案例消费及真实业务试点仍有各自验收门槛。
