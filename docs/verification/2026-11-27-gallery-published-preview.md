# 2026-11-27 已发布组件的目录截图与本地预览修复

## 范围与根因

调查基线为 `39f5b5a2`，最初创建修复分支 `fix/gallery-published-preview`；收口时的并发分支变化见文末。用户已通过 CLI 发布 `juz-local-test-react@0.0.1`，本轮只修复公开目录卡片与本地预览联调，不重建、不重发、不修改其冻结材料或发布状态。

- 公开目录卡片未读取 `variant.screenshots`，也没有图片展示节点；实际发布的默认/空态 PNG 均可通过现有公开产物接口读取，状态 200，大小分别为 6824 / 6391 字节。
- 预览授权接口返回 201，但旧网关进程缺少后来新建的隔离 MinIO 配置，未初始化开发回环预览配置，最终返回 404 与 `frame-ancestors 'none'`，浏览器拒绝嵌入。`/healthz` 成功不代表资源链路正常。

## 最小修复

公开目录复用真实发布详情及既有 `GET /v1/variant-releases/:releaseId/artifacts?path=...`。截图必须匹配组件、发布 ID、变体、框架、版本、包摘要和有效示例状态，优先默认状态。按框架筛选时展示对应实现的截图；详情缺失或归属不符只省略截图，不隐藏目录卡片。图片使用原始产物、延迟加载及无 Referer 策略，不公开 MinIO 桶、不增加契约字段或私有数据 SSR。

本地运行环境将与 API 相同的 `PLATFORM_S3_*` 变量传入重新启动的整套开发服务，连接既有隔离存储。没有新增 `.ps1`、修改网关安全策略或放宽生产 origin。worker、容器、凭证和原数据保留。

独立只读代码审查发现默认实现缺图时可能借用另一实现的截图、却保留默认版本标签；补充失败测试后将版本和可选可用状态统一取自当前展示的实现。审查者定向复核确认问题关闭，无其余阻断问题。预览验证参考 modern-web-guidance 的安全与 origin 校验指南，检查精确嵌入来源及不透明沙箱，不降低现有 CSP。

## 实际验证

使用系统全局 pnpm 12.18.0，验证进程使用仓库已有 Node 26.13.0。完整测试设置真实的 `PLAYWRIGHT_BROWSERS_PATH` 与 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH`，构建与类型检查设置 `TURBO_FORCE=true`，未并行争抢 SDK dist。

| 命令 / 检查 | 实际结果 |
| --- | --- |
| 新增缩略图测试首次 RED | 1 失败、6 通过；失败为缩略图缺失 |
| 双框架截图与版本一致性补充 RED | 1 失败、7 通过；Vue 2.0.0 截图被错误标成默认 React 1.0.0 |
| `pnpm exec vitest run tests/gallery/catalog-thumbnails.test.ts tests/gallery/catalog.test.ts tests/gallery/preview-client.test.ts tests/unit/public-preview.test.ts` | 最终 4 文件、18 项通过 |
| `pnpm build` | 11 任务通过、0 缓存 |
| `pnpm typecheck` | 15 任务通过、0 缓存，根及后台测试类型检查通过；首次新测试直接导入 Next TSX 导致根 NodeNext 解析失败，改用运行时导入后重跑通过 |
| `pnpm verify:workspace` | 11 成员及服务端依赖边界通过 |
| `pnpm verify:docs` | 文档链接、篇数、工具链声明通过，既有历史留痕和根相对链接提示不阻断 |
| `pnpm verify:release` | 根 0.2.14 与 CHANGELOG 一致，版本提交命名与公开包检查通过 |
| 最终 `pnpm test` | 退出 0；T10 161 通过、7 既有跳过；Vitest 184 文件、2764 项通过、2 既有跳过，Vitest 耗时 655.94 秒 |

首轮完整测试为纳入独立审查发现的双框架版本标签缺陷而中断，不记为通过；修复后重新执行完整 `pnpm test` 并取得上述退出 0 结果。输出保留既有 Node 子进程 shell / localStorage 警告，未将其描述为无警告运行。原始输出保留于本机忽略目录 `test-results/gallery-published-preview-*.log`，不提交完整日志或任何凭证。

Playwright 使用独立浏览器上下文与真实本机 API / 网关，未 mock 发布数据：

- `/components` 的图片真实解码成功，尺寸为 800×400，指向管理 API 的公开产物端点；1280px 与 390px 宽度均无横向溢出。截图位于本机 `test-results/gallery-published-preview-catalog-{1280,390}.png`。
- `/components/juz-local-test` 成功渲染 `Hello juz`、`42` 与 `[12,24,36]`。页面重载及点击刷新预览均成功；两次请求序列均为 303 / 200 / 200，无控制台错误。
- iframe 保持 `sandbox=allow-scripts`，运行时 origin 为 `null`，资源位于独立回环端口 3001；没有同源回退或绕过授权。详情截图位于本机 `test-results/gallery-published-preview-detail.png`。
- 原始架构 SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 未覆盖边界

本轮浏览器实测覆盖用户已发布的 React 组件与公开画廊；没有另发 Vue 业务组件，没有对生产 OIDC / DNS / TLS、完整 `pnpm test:browser` 或 G2 门槛作通过声明。私有资产路径和认证策略未修改。本轮未主动执行合并、未 push、未发 npm 包。

版本按兼容修复递增为根 0.2.14、画廊 0.1.4，独立提交版本与 CHANGELOG；API、网关和 CLI 不升版。

## 提交与并发工作区收口

同一工作区的并发流程在本轮验证期间提交 CLI 工作台美化 `0e218b33`，随后切回 `main` 并快进该分支。本轮提交前未及时复查分支，以下两个提交实际位于 `main`，没有将其描述为本轮另行完成的合并，也不重置或重写并发历史：

- `b0308b20`：修复公开组件目录缺少发布截图，含回归测试与交付文档。
- `8e3ffd1c`：根升级至 0.2.14、画廊升级至 0.1.4，同步 CHANGELOG。

CLI 工作台文件未由本轮暂存或提交；本轮测试不替代该并发美化任务自身的验收。提交后版本守卫通过，工作区干净，开发服务保持原隔离存储配置运行；本轮没有推送远程。
