# 2026-11-26 juz 工作台独立验证记录

本记录只覆盖本轮新增实现及实际执行结果，不替代生产 OIDC、TLS、业务项目或历史 G1/G2 回执。功能范围见 [实施计划](../plans/2026-11-26-juz-workbench.md)，操作见 [使用指南](../guides/juz-workbench.md)。

## 基线、工具与材料

- 基线 `6cc88f15`，独立分支 `feat/juz-workbench`。原工作区的两份 `next-env.d.ts` 修改保留，未合并、推送、远程 npm 发布或部署。
- Windows / Node `26.13.0` / pnpm `12.18.0` / Playwright `1.65.0` Chromium / Docker `29.8.2`。系统 Node `24.6.0` 未满足仓库既有 Angular 传递依赖的 engine 要求，未降低版本约束。
- 独立工作区通过本地忽略的工具目录映射使用既有固定工具链；T17 浏览器检查使用实际普通目录 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH`，没有放宽其符号链接或版本校验。
- 原架构 `component-platform-architecture.md` SHA-256 仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。工作区仍为 11 个成员，API / preview-gateway 无组件执行路径。
- 最终根版本 `0.2.0`，CLI `0.1.0`；分发名 `juz-cli`，二进制 `juz` / `component`。
- 本地材料 `packages/component-cli/.release/juz-cli-0.1.0.tgz`，562875 字节，SHA-256 `4b30174865a64a91bf8aa59cad689963be3e51bdc1df3c01e2a121516e21f2dd`。该摘要与独立安装测试、真实平台测试所安装的 CLI tgz 一致。
- 同字节安装包另复制到原工作区 `.release/juz-workbench-20261126/juz-cli-0.1.0.tgz`，便于本地试用；该目录被 Git 忽略。

## RED → GREEN 与浏览器覆盖

| 子任务 | 实际反例与结果 |
| --- | --- |
| 新建与接入 | 离线 React / Vue / 双包模板、已有文件保留、重复实现、分类冲突、真实路径去重、越界与示例校验先失败后通过；兼容既有项目命令 |
| 冻结一致性 | 每配置指针归属、锁互斥、源码 / 文档 / 示例变化、冻结只读均有行为测试；真实外部消费者安装候选 tarball，保存值出现在实际预览 / 截图材料，摘要保持不变 |
| 控制与编译隔离 | 错 Host / Origin / token、错误 iframe、旧端口、敏感文件、错误 WebSocket 路径 / Origin 被拒；真实项目编译插件读取合成 token / DATABASE_URL 的泄漏用例先失败，迁移清理环境的子进程后通过 |
| 工作台 | 真实 React / Vue 挂载与切换、独立草稿、HMR、控件约束、非法 JSON 保留上次有效值、实际事件、拖动尺寸、保存后重启、冻结状态只读、自定义消费者受限提示、旧构建 watcher 及子进程树清理 |
| 审查修正 1 | 人为延迟实际保存响应，保存 React 后切换 Vue：Vue 输入错误变为 React 值，RED；绑定请求实现并单独更新保存基线后 GREEN，同时验证保存期间的新编辑不丢失 |
| 审查修正 2 | 入口引用根共享源码，修改共享文件摘要不变，RED；保守覆盖项目根输入后 GREEN，同时覆盖共享构建配置 |

六项专用 Playwright 均通过（40.3 秒）。截图 `test-results/workbench/workbench-desktop.png` 已人工目视检查三栏布局、参数与数据控件、框架按钮、真实尺寸画布和状态展示；布局验证未以截图文件存在代替实际观察。

## 最终命令

下表均为实际运行。完整输出保存在本机临时目录的 `juz-final-*.log`；测试证据位于忽略的 `test-results/workbench/`，不把生成物提交进 Git。

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @company/component-cli typecheck` | 通过 |
| `pnpm --filter @company/component-cli build` | 通过，包含 UI 白名单资源和分发探针完整性检查 |
| `pnpm --filter @company/contracts schemas:generate` | 通过，生成 PlaygroundV1 Schema，CLI 继续内联契约 |
| `pnpm exec vitest run tests/contracts/api-schema.test.ts tests/unit/workbench-project.test.ts tests/unit/workbench-state.test.ts tests/unit/workbench-server.test.ts tests/unit/workbench-lifecycle.test.ts tests/unit/project-cli.test.ts tests/unit/component-cli-onboarding.test.ts tests/integration/workbench-freeze.test.ts` | 8 文件、84 项通过，12.67 秒 |
| `pnpm exec playwright test --config tests/workbench/playwright.config.ts` | 6 项通过，40.3 秒 |
| `pnpm verify:workspace` | 通过：11 成员、无循环、安全服务依赖闭包 |
| `pnpm typecheck` | 通过，15 个编排任务及根 / 前端测试 tsc 均完成 |
| `pnpm exec turbo run build --force` | 11 / 11 成功，0 缓存，13.215 秒 |
| `pnpm exec vitest run tests/integration/workbench-installed.test.ts` | 真实 CLI tgz 仓外安装通过，13.44 秒；上传端为明确标注的 mock HTTP |
| `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/workbench-publishing.test.ts` | 真实 PostgreSQL / MinIO / Verdaccio / Nest HTTP 通过，26.23 秒；使用测试签名 OIDC CLI 身份 |
| `pnpm --filter @company/component-cli pack:juz` | 通过，产物版本、大小及摘要见上文 |
| `pnpm test` | 退出 1；前置服务构建 5 / 5 成功、0 缓存；T10 为 161 通过、7 跳过、0 失败；Vitest 为 164 文件通过、1 文件失败，2632 项通过、2 跳过、1 失败（共 2635 项），633.90 秒。唯一失败为下述已在基线复现的后台样式检查 |

## 独立安装与真实平台的区别

`workbench-installed.test.ts` 在仓库外安装真正的 CLI tgz，运行 create all、init、默认 dev 选 Vue、明确选择 React 包打包、冻结预览、登录 token、上传中断与恢复；发布 HTTP 是受控测试替身，不证明三存储。证据 `independent-cli.json` 明确写入 `mockHttp: true`、CLI 摘要与原幂等键复用。

`workbench-publishing.test.ts` 另建隔离真实 Docker 服务及测试身份，使用同摘要已安装 CLI 创建两个独立包、安装项目依赖、本地构建与截图、上传、触发真实发布 worker；CLI 以短超时中断后，使用原 manifest / tarball / 截图 / 幂等键恢复。分别核验 Verdaccio 包、MinIO 与 manifest 文件摘要、数据库两项 Ready，实现 API 重启后仍恢复原作业。测试自行清理本轮隔离设施。

本轮真实平台证据 `real-platform.json`：

| 实现 | manifest 摘要 | 组件 tarball SHA-256 | 结果 |
| --- | --- | --- | --- |
| React | `17ab410ca15b8e675c05248bfdb548be4682a7bc3ecb89c15f8322a5bf075b70` | `aa89f24c2ee50872163fd807149dfe75e6c8d65a17dbb22e1fad636441013733` | READY，原幂等键保留 |
| Vue | `6cb443cccd1428dd7d6a1beda425ac179a638114f20427798445900cda8fc162` | `a7170085a3ca40bc91e89e2ae1d9cd06c67798e9b8daf6c05ed4bfb6c82bdd8e` | READY，原幂等键保留 |

测试签名身份不能替代公司生产 OIDC / PKCE、撤权、DNS / TLS 和正式业务数据验收，这些仍未完成。没有对生产平台上传或远程包注册表发布。

## 全仓问题的独立定位

初次全仓检查没有以部分日志冒称通过。已逐项定位：

1. 根 NodeNext tsc 把 Next Bundler 页面及 Nest 装饰器源码作为测试依赖编译。使用 `6cc88f15` 临时归档实际复现 93 条类型错误；新增前端测试 Bundler 配置、根范围分离，并让 Nest 测试读取真实 dist 后，完整 `pnpm typecheck` 通过。
2. 后台测试直接导入 / mock React、React DOM、Next，但根未声明这些测试依赖，导致原生 `importOriginal` 或路由 mock 解析失败。通过 pnpm 增加仓库既有精确版本的根开发依赖，登录渲染 16 项通过；不修改应用行为。
3. 首轮安装隔离 / T17 固定工具检查因工作区工具路径不同失败；补齐忽略的本地工具路径和实际 Chromium 路径后，安装隔离及 API 登录测试 76 项通过，T17 四文件 80 项通过。未改断言、未弱化安全检查。
4. 最终完整 `pnpm test` 唯一失败为 `tests/admin/console-render.test.ts` 的“全部画板的类名与 CSS 变量都在 globals.css 中有定义”，报告 `catalog-toolbar` / `search-box` 未定义；在基线 `6cc88f15` 临时归档运行 `pnpm exec vitest run --root <基线归档目录> tests/admin/console-render.test.ts` 同样 1 失败、6 通过。最终完整日志为 `%TEMP%/juz-final-tests.log`，基线复现日志为 `%TEMP%/juz-baseline-admin-render.log`。此后台样式缺口不属于本轮工作台，保留原状，全仓 test 门禁不能标为通过。

## 审查与实施裁定

一次独立整分支审查无 Critical，2 项 Important 已 RED → GREEN 修正；未追加功能性 Minor。尾空白清理后 `git diff --check` 无错误。审查模型首次不可用，未执行审查即失败；随后由可用模型独立完成，没有重复审查席位。

- 原生 worktree 注册未成功，但 Git 独立分支 / 路径已实际验证；继续显式使用该隔离目录，代价是 app 内没有可靠的原生附件注册。
- 固定 Node 26.13.0 用于满足既有引擎约束，未降低依赖；复验者应使用同工具链。
- 前端测试与 Nest 编译边界修正只改变验证配置，风险由完整类型与渲染回归检查约束。
- 为避免共享源码遗漏，指纹保守覆盖项目根；修改同项目的其他包也可能要求重新准备，代价是额外本地验证。
- 本地可信编译器仍拥有开发者操作系统文件权限，清理凭据环境不构成 OS 沙箱。
- 不同 npm 包独立发布；某包成功时另一包仍可能失败，不提供跨包原子事务。
- 每次 CLI 启动一个活动预览；同会话多标签会相互切换活动实现，独立并行预览须分别启动不同端口。

保留的验收缺口为上述后台既有 test 失败，以及生产身份 / TLS / 业务验收。没有把 mock HTTP、缓存命中或测试签名身份写成生产发布完成。

## 聚焦提交

| 提交 | 内容与验证 |
| --- | --- |
| `3e01e4c3` | 离线模板 / 多包配置 / Playground 契约；6 个新行为 RED → GREEN，68 项基础 / 兼容检查通过 |
| `32ccab08` | 包级恢复 / 输入摘要 / 保存示例冻结；单元和真实干净消费者集成通过 |
| `be4605e6` | 双框架工作台 / 控制与编译隔离 / 冻结预览 / 发布闭环；83 项专项、最初 5 项浏览器、仓外安装与真实平台通过 |
| `b0d7be11` | 前后端测试编译边界；根及前端 tsc、76 项安装隔离 / API 登录检查通过 |
| `7b1e863a` | 根 0.2.0 / CLI 0.1.0 / CHANGELOG 独立升版；CLI 类型与分发构建通过 |
| `5ef9680c` | 声明根渲染测试的精确框架依赖；登录页 16 项、完整类型检查通过 |
| `40ad72b1` | 两项审查问题修正；3 项指纹单元 / 延迟保存浏览器 RED → GREEN，最终 84 项专项、6 项浏览器及两类独立安装验证通过 |
