# T16 客户端恢复与 D 工作树依赖准备

日期：2026-11-18。本记录追加于 cc8630b6 检查点之后，不改写先前验证记录。

用户已在 Claude 桌面完成指定目录 Allow。恢复观察时先显示工具调用解析失败，随后新窗口显示 B 原补修任务使用 GLM 5.3 High，处于文件查找阶段；C 未重复发送该任务。核对 install.ts 与 generate-react.ts 的文件字节长度和修改时间尚无变化，不能以客户端正在执行代替产品交付。先前产品 84 collected / 73 passed / 11 failed 的结果仍为最近完整产品证据，本次没有重新运行或宣称 GREEN。

D 在指定 t16-blackbox-cases 工作树按当前默认配置启动真实 Claude Code，未传 --model，未改全局配置。使用 Read/Write/Edit/Glob/Grep 文件工具重试，实际 init 模型为 DeepSeek-V4.1-Flash-1017；最终 3 轮、exit 1、is_error=true，api_error 为 malformed_tool_use_exhausted，返回工具调用无法解析。tests/acceptance/t16-d 尚未交付。原始重试日志独立保留于 ignored .superpowers/sdd/2026-11-18-phase3-t16-safe-apply/d-default-channel-recovery-20261118.log，不覆盖历史日志。B 桌面显示的模型与本次 D 实际启动模型不同，不能推断 D 默认渠道已经切换或恢复。

C 使用 B+C 工作树的固定工具链 wrapper，为 D 工作树执行一次实际依赖安装：

```powershell
& '<B+C>/scripts/pnpm.ps1' -PnpmArgs @('--dir','<D>','install','--frozen-lockfile')
```

<B+C> 为 C:/Users/10208/.codex/worktrees/t16-safe-apply-0026/zhinexus-design-asset-platform；<D> 为 C:/Users/10208/.codex/worktrees/t16-blackbox-cases/zhinexus-design-asset-platform。实际 exit 0，pnpm 12.18.0；同一固定 Node 裸探针实际返回 v26.13.0。D pnpm-lock.yaml 安装前后摘要相同：250aa048a33c481e0cb64993008ed0553e7b8bf682b8299d43516b37d4c84fae。安装后 D 的 Git 状态仍仅含原有未跟踪 blackbox brief；没有新增产品或黑盒测试文件。安装日志独立保存为 d-worktree-dependencies-20261118.log。此检查只准备测试依赖，不证明 D 黑盒或产品通过。

原架构文档 SHA-256 实际核对仍为 e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723。B 产品未提交修改保留；main 未修改。B GREEN、8 项真实安装/重定位、4 项恶意配置、D 冻结 CLI 黑盒、全图与浏览器、升版及单次 pack、授权的本地 main 合并仍未完成。没有真实业务项目时完整 T16/T17 保持未完成。不 push、tag、生产发布或清理工作树/原始证据。
