# 从真实项目发布组件

日常只需 `juz dev` 开发、`juz publish` 发布。第一次接入时登录并初始化一次，CLI 根据配置自动构建、校验、冻结、打包和上传。

## 开发测试安装

在平台仓库根目录生成并安装本地 CLI：

```powershell
pnpm --filter @company/component-cli pack:juz
npm install -g .\packages\component-cli\.release\juz-cli-0.0.30.tgz
juz --version
```

`pack:juz` 输出实际 tarball 路径。内部 workspace 包仍叫 `@company/component-cli`，生成的独立分发包叫 `juz-cli`，内置契约和运行材料，无需另外安装内部包。

本次没有执行 npm 发布。只有管理员将该分发包发布到目标 registry 后，其他开发者才能直接运行 `npm install juz-cli -g`。

本机需 Node >=24.6.0 与 pnpm 12.18.0；CLI 使用 pnpm 冻结组件包、安装外部消费者。从 `0.0.30` 起，正常 `npm install -g` 安装 `juz-cli` 或本地 tgz 时会自动准备匹配的 Chromium，已有缓存直接复用，无需额外执行浏览器安装命令。

下载失败会让安装失败并给出补装命令；修复网络后重新安装即可。需要暂时跳过时可在 PowerShell 设置 `$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'`，测试结束后用 `Remove-Item Env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` 恢复默认。使用 `--ignore-scripts` 也会跳过自动下载。跳过后，恢复脚本执行和下载设置，再运行 `npm rebuild -g juz-cli --foreground-scripts` 为已全局安装的 CLI 补装 Chromium；此命令也适用于 `PLAYWRIGHT_BROWSERS_PATH=0` 的包内缓存。代理、下载源与缓存目录沿用 Playwright 环境配置。

平台仓库内部包没有安装钩子，仓库开发仍按需运行 `pnpm exec playwright install chromium`。Linux 如缺少浏览器系统库，需额外按 Playwright 提示安装系统依赖；CLI 不自动提权安装系统软件。

## 首次接入

进入开发者自己的组件项目：

```powershell
# 本地测试 API；部署后替换为平台 API origin
juz login --api-url http://127.0.0.1:3000
juz init
juz dev
```

首次登录记住服务器地址，后续 `juz login`、`juz publish` 自动复用。login 打开平台登录页，也可用 `juz login --api-url <平台地址> --token <token>`。不从 token 猜测服务器；平台 API 地址由首次登录显式选择。`--api-url`、环境 `PLATFORM_API_URL` / `ZHINEXUS_API_URL` 优先于保存的地址，凭据只用于完全匹配的 origin。

`juz init` 引导填写已有组件包目录（默认当前目录）、组件 ID、导出名称、Vue/React 框架及管理员维护的启用分类，创建 `component.config.json`。分类列表需要登录，所以首次推荐先 login 再 init。已知稳定分类 ID 时可用 `--category <id>` 先初始化。

现有 build/dev 脚本作为本地命令，按项目 packageManager 或锁文件选择 npm/pnpm；没有声明时默认 npm。业务工程可以是私有项目，但必须选择其中可发布的组件子包，例如 `juz init --package packages/button`。目标包必须有准确的 name/version 和 build 脚本。已有配置不会被覆盖。

组件包就是当前目录时，init 会保留现有 `.npmignore` 规则并追加发布材料排除项；没有 `.npmignore` 时先继承 `.gitignore`。组件包建议用 `package.json` 的 `files` 明确声明 `dist` 等需要分发的产物。若打出的包仍夹带发布记录，CLI 会在消费者导入组件前拒绝继续。

## 一键发布或本地打包

开发者首次补齐下一节的资料后，日常直接：

```powershell
juz publish
```

自动完成配置、账号、分类和权限检查 → 本地构建 → 打包冻结 → 外部消费者安装与验证、截图 → 上传 → 发布。单框架自动选择；同时配置 Vue/React 时发布全部实现。进度输出到 stderr，结果写 stdout。`juz dev` 在单框架时自动选择，双框架时交互选择，也可显式 `--framework vue|react`。

只生成本地发布材料时：

```powershell
juz package
```

返回冻结目录 `bundleDir` 和 ZIP 文件 `archivePath`。此操作不需要平台登录，但安装消费者依赖仍可能访问 npm registry。ZIP 只包含清单及声明产物，不包含凭证、上传会话或项目源码目录。之后 `juz publish` 复用这份冻结材料。

默认材料放在项目 `.component-releases/<版本-时间>/`，ZIP 与该版本目录并列。自定义 `--bundle-dir` 时请放在组件包外；若放在组件包内，必须位于该包 `.component-releases/` 的子目录，避免下一次打包包含先前的发布包。

**当前后台操作：解压 ZIP → 导入 manifest.json → 批量导入解压后的材料目录。** 后台暂不直接读取 ZIP；网页提交按既有规则标记为 manual-upload，不继承 CLI 自动验证来源。

上传中断后重复 `juz publish` 恢复同一份材料与任务。版本不可覆盖；修改组件后升级组件包版本再发布。只修改源码但保留相同版本时，重试仍发布原冻结材料。配置发生变化时 CLI 提示重新准备材料；显式 `--bundle-dir <项目内原目录>` 可恢复原版本。

## 首次需要开发者提供的资料

init 创建接入配置，组件代码、API、文档和消费示例仍由真实项目维护。可以按现有目录修改配置中的路径：

| 配置 | 内容 |
| --- | --- |
| packageDir、build、dev | 现有组件包及本地脚本 |
| componentId、framework、category | 平台组件 ID、真实框架及稳定分类 ID |
| exportName、exportPath | 实际 ESM 命名导出与子路径，例如 Button / ./button |
| api、docs | API JSON 与非空 Markdown 文档 |
| consumer.templateDir | 安装真实组件包的 Vite 示例目录 |
| readiness | 截图元素、需要验证的状态与尺寸 |

API JSON 例子（按实际组件补充 props/events/notes）：

```json
{
  "schemaVersion": 1,
  "componentId": "button",
  "framework": "react",
  "exportName": "Button",
  "exportPath": "./button",
  "props": [],
  "events": [],
  "notes": []
}
```

消费者目录包含 package.json、index.html 与框架挂载代码，以包名和真实 export subpath 导入组件。框架与 Vite 依赖使用精确版本；不能通过源码 alias、workspace/file/link 依赖代替安装包。CLI 复制到工作区外并以 --ignore-scripts 安装同一份冻结 tarball。

示例需提供 `window.__COMPONENT_EXAMPLE__`：ready 是数据、字体、有效尺寸及挂载完成的 Promise；runState(name) 切换到配置状态并等待完成；getChecks() 返回非空实际检查数组 `{name,status:'passed'|'failed',message?}`。每个状态都需要真实运行通过。普通组件可省略图表相关 API 字段及 ECharts 版本。

管理员在后台维护分类和组件/包发布授权；选择分类不会自动增加权限。一个 npm 包同时包含多个 JavaScript 实现时须登记全部实现，需要独立发布则先拆成独立组件包。

## 排障

`juz --help` 显示常用流程，`juz --help-all` 显示底层诊断、恢复和已有 component 兼容命令。检查失败按输出修改项目，再运行 package/publish；不要修改冻结 tarball 或上传后重新打包。

凭据保存于用户目录，自定义路径可用 ZHINEXUS_CREDENTIAL_FILE。过期后重新登录；不要将 token、Cookie 或签名 URL 复制进配置、发布包或问题单。完整恢复边界见[发布与恢复](publishing.md)，本轮结果见[验证记录](../verification/2026-11-25-juz-simple-publishing.md)。
