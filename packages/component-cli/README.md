# juz-cli

新建或接入 Vue / React 组件，在统一工作台中预览、调试、保存示例、打包和发布。完整实操、配置与桥接协议见仓库 `docs/guides/juz-workbench.md`。

发布到 npm 后安装：`npm install -g juz-cli`。开发测试可全局安装构建得到的 `juz-cli-<version>.tgz`。

正常安装会自动下载匹配的 Chromium，已有缓存直接复用。下载失败会给出补装命令；处理网络问题后重试安装即可。`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 或 npm `--ignore-scripts` 可跳过，之后需手动补装浏览器才能截图。Linux 系统库仍按 Playwright 提示准备，不自动提权安装。

```sh
juz create my-card --framework react
cd my-card
pnpm install
juz dev
```

只开发 Vue 时改为 `--framework vue`；确定需要两个独立发布包时再用 `--framework all`，日常源码分别位于 `packages/react/src` 和 `packages/vue/src`。

首次登录配置 API 地址，后续自动复用。自动化可用 `juz login --api-url <origin> --token <token>`；token 保存在用户目录，不进入项目或发布包。

日常像普通组件一样编辑 `src/Demo.tsx` 或 `src/Demo.vue`，使用 Props、回调 / Emits 与框架生命周期。`juz dev` 热更新源码；在对应包中运行 `pnpm typecheck` / `pnpm build`。模板的 `pnpm dev` 是构建导出监听。默认消费者桥接与 Vue 声明整理工具放在 `.juz/`，通常无需编辑，应纳入版本管理；它们不会进入组件 npm 包。`playground.json` 是唯一示例输入，可通过工作台保存。

源码预览复用包内 Vite 的 alias、插件与 CSS 编译设置；项目配置修改后重新选择实现或重启。CLI 保留自己的回环、env 和文件隔离策略。`juz dev --package packages/vue --framework vue` 与包名、配置路径选择等价，选错包或框架在服务启动前报错。Vue SFC 使用固定兼容的 vue-tsc / TypeScript，生成可供 NodeNext 消费的声明。

本地开发无需登录。`juz init` 接入已有包，可用 `--source <项目内入口>` 登记源码；只补充缺失材料，不覆盖已有源码、API、文档和非空消费者。私有业务工程应选择其中可发布的组件子包。分类可以暂不分配，冻结前再在工作台或通过 `--category <后台分类 ID>` 选择。

`juz dev` 默认在 `127.0.0.1:1111` 打开三栏工作台，支持 React/Vue 切换、真实画布尺寸、参数/JSON 数据、状态、事件、API/文档及发布面板。支持 `--port`、`--no-open`、首次选择的 `--package` / `--framework`。源码模式使用项目 Vite/插件热更新，无源码入口时读取真实构建导出并启动配置中的开发脚本；旧终端脚本入口为 `juz dev --script`。自定义消费者未接入桥接时明确显示受限。

参数草稿按实现独立保留，点击保存才写入指定示例文件；冲突时拒绝覆盖。`juz preview --bundle-dir <目录>` 只读预览冻结材料，不构建、不重新安装、不改写原材料。Ctrl+C 关闭本次启动的服务和子进程。

`juz publish` 自动构建、冻结 tarball、在外部消费者校验和截图，然后上传到当前登录服务器。多包项目必须选择 `--package <包名>`；工作台使用当前包，上传前核对账号、API、全部实现/分类和摘要并明确确认。中断后重复同一命令恢复同一份材料；输入已变时需重新准备，明确恢复原材料可用 `--bundle-dir <原目录>`。已发布版本不可覆盖。平台凭据保留在 CLI 侧，不进入页面存储、组件子进程环境或材料。

只打本地包：`juz package`，输出 ZIP 和冻结目录，不要求平台登录（消费者依赖安装可能访问 npm）。当前后台需先解压 ZIP，再导入 manifest.json 和材料目录。

运行环境：Node >=24.6.0，pnpm 12.18.0（供冻结包与干净消费者安装使用），与 CLI Playwright 版本匹配的 Chromium。`juz --help` 查看常用命令，`juz --help-all` 查看详细诊断/恢复命令。
