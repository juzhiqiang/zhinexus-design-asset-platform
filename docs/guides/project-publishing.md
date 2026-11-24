# 从真实项目发布已有组件

开发者维护组件、API、文档与消费者示例，CLI 负责本地构建、冻结、工作区外安装/截图和上传。独立组件工程、业务项目中的组件子包、平台仓库中的公开组件包均可登记；`init` 只创建配置，不生成业务组件。

## 准备身份、包和分类

本机使用 pnpm 12.18.0 与 Node >=24.6.0。本轮固定依赖验证使用 Node 26.13.0：Node 24.6.0 不满足锁定的 Angular Devkit 引擎约束，具体环境与结果见 [验证记录](../verification/2026-11-24-project-publishing.md)。消费者安装的框架和 Vite 依赖须为精确 registry 版本；本地 Chromium 需与 CLI 的 Playwright 版本匹配。

管理员在内网后台「组件分类」创建稳定 ID 和名称，可重命名、启用或停用。更新使用 `expectedRevision`；遇到 409 保留草稿，显式刷新后再提交。分类不物理删除，旧版本保留发布时快照。管理员在「用户与权限」预登记并授权开发者对应的 component ID 与 npm 包名；分类选择不会增加发布或私有目录权限。

安装已发布 CLI 后，在项目目录运行：

```powershell
pnpm add -D @company/component-cli@0.0.28
pnpm exec component login --api-url https://api.assets.example.com
pnpm exec component init --project . --package packages/button-react --component button --export Button --export-path ./button --framework react --category general
```

CLI 登录沿用平台配置的身份体系；访问地址须经公司网络/VPN 的管理入口。显式 `--token`、环境 `PLATFORM_TOKEN`/`ZHINEXUS_API_TOKEN`、该 API origin 的已保存登录按顺序使用，不在配置或报告中写凭据。非交互调用必须明确选择框架和分类，交互调用可从当前启用分类选择。已有配置不会被覆盖。

业务项目根 `package.json` 可以是 `private:true`，`--package` 必须指向现有可发布组件子包；子包需具有精确 name/version、公开 ESM 导出及 `build` 脚本。不能发布整个私有应用。路径以真实项目根为边界，不能通过 `../` 或符号链接跨出项目。

## 完成配置和消费者

`init` 创建 `component.config.json`。开发者补齐 API、文档与消费者目录，并按实际导出调整配置，例如一个仅含 React 的包：

```json
{
  "schemaVersion": 1,
  "packageDir": "packages/button-react",
  "build": { "program": "pnpm", "args": ["run", "build"] },
  "dev": { "react": { "program": "pnpm", "args": ["run", "dev"] } },
  "variants": [{
    "componentId": "button",
    "framework": "react",
    "category": "general",
    "exportName": "Button",
    "exportPath": "./button",
    "api": "api/button-react.json",
    "docs": "docs/button-react.md",
    "consumer": {
      "adapter": "vite",
      "templateDir": "consumers/react",
      "previewDir": "dist",
      "previewEntry": "index.html"
    },
    "readiness": {
      "selector": "#app",
      "states": ["default"],
      "width": 800,
      "height": 400,
      "renderer": "canvas",
      "theme": "light"
    }
  }]
}
```

`build`/`dev` 是本地程序与参数数组，在组件包目录执行。发布消费者只支持 `adapter: "vite"`：配置中的旧 `consumer.build` 会报 `CONSUMER_ADAPTER_REQUIRED`，须移除并迁移到 Vite 消费者模板。Vite/config/plugins 属于开发者本地执行信任边界；其他编译器、不同 Node/browser 条件入口尚未验收，入口不一致时拒绝。

每个消费者模板提供 `package.json`、`index.html` 和框架挂载代码，以包名和真实 export subpath 导入所选组件。Vue、React/ReactDOM、Vite 与需要的插件使用精确 registry 版本。模板不得含 workspace/override/import alias、源码 `file:`/`link:`、越界相对导入或 `node_modules`。CLI 将复制模板到工作区外，使用 `--ignore-scripts` 安装同一冻结 tarball；不能依赖安装生命周期脚本生成产物。

API JSON 的 `componentId/framework/exportName/exportPath` 须与配置一致，提供实际 `props/events/notes`。普通组件可以省略 `styleExport`、`readyMethod` 和 ECharts 版本；未用 ECharts 时不生成图表兼容记录。

消费者须设置 `window.__COMPONENT_EXAMPLE__`：`ready` 为数据、字体、有效尺寸及框架实际挂载完成的 Promise；`runState(name)` 将页面切换到声明状态并等待完成；`getChecks()` 返回非空实际检查数组 `{name,status:'passed'|'failed',message?}`。每个配置状态都须运行并通过。组件本身是否有 ready 方法与此宿主协议独立。CLI 还核对 Vite 实际解析入口及所选导出的框架渲染使用；错框架、仅 import 未渲染、源码 alias 和完整安装入口二次 alias 都拒绝。

## 检查、冻结与发布

```powershell
pnpm exec component dev --project . --framework react
pnpm exec component doctor --project . --framework react --api-url https://api.assets.example.com
pnpm exec component prepare-release --project . --framework react --bundle-dir .component-releases/0.1.0 --api-url https://api.assets.example.com
pnpm exec component release --project . --api-url https://api.assets.example.com --idempotency-key button-react-0.1.0
```

`--config <项目内相对路径>` 可选择其他配置；`--category <稳定ID>` 覆盖本次选中实现分类，`--timeout <毫秒>` 设置超时。`release --prepare-only --framework ...` 等价于只准备材料；没有旧材料时 `release --framework ...` 会先完整准备再上传。

`doctor` 在构建前验证配置/文件、API 身份、当前登录、角色、类别及组件/包 ACL；真实包完整性在冻结安装后再次检查。`prepare-release` 构建一次、`pnpm pack` 一次，之后安装、静态构建、逐实现截图、检查报告、清单、上传与发布绑定同一份 tarball SHA-256。输出 Bundle 目录与清单；进度写 stderr。截图后不得重新打包。

Vue-only 与 React-only 的独立包可各自 `--framework vue`/`react` 发布。一个包同时包含 Vue/React 时，使用 `--framework all`，配置并提交全部实现。同一个冻结包的每个 JavaScript export subpath 均须有实现材料，根聚合入口和静态 CSS/JSON 导出除外；部分选择会在消费者构建/截图/上传之前报 `PACKAGE_IMPLEMENTATIONS_INCOMPLETE`。需要单框架发布，应先拆成实际独立组件包，再构建、冻结和验证；不能裁掉共享包的兄弟实现、改标签或在截图后重新 pack。

平台仓库使用同一配置流程，例如从仓库根执行 `pnpm component doctor --config <项目内配置> --framework all ...`。组件配置由开发者显式登记，保留旧 SDK 命令的默认路径选择；公开 SDK 框架包各自发布时仍遵守候选 core 依赖与完整实现材料约束。

## 冻结恢复与旧路径

重复运行项目 `release` 自动读取 `.component-release.json`，校验冻结清单/文件并复用 `.release-session.json` 的 uploadSessionId、jobId 和首次 idempotencyKey；后续传入的新 key 不替换原 key，也不重新 build/pack。API/worker 重启后仍沿同一持久作业继续。已创建成功的原作业重放不因分类后来停用而改写历史快照；新作业仍验证当前分类。

配置发生变化时自动恢复报 `CONFIG_CHANGED`。可显式 `--bundle-dir <原冻结目录>` 恢复原材料；新产物应升级组件版本并准备新目录。原上传签名过期且还有未传文件时失败关闭，保留材料和会话，需要平台续签同一会话授权，当前 CLI 不自动新建替代会话。

无项目配置时旧 SDK/Bundle 入口继续可用，`--bundle-dir` 可指向既有完整材料，旧 category-absent 清单保持兼容：

```powershell
pnpm component check --framework all --staging-dir .checks/current
pnpm component prepare-release --framework all --bundle-dir .release-bundle
pnpm component release --bundle-dir .release-bundle --api-url https://api.assets.example.com
pnpm component resume --bundle-dir .release-bundle --api-url https://api.assets.example.com
pnpm component status --bundle-dir .release-bundle --api-url https://api.assets.example.com
```

后台手动提交仍上传预构建材料及逐实现有效手动截图，来源强制 `manual-upload`，同包实现联动选择；不伪造 CLI 自动检查记录。`Ready` 只表示包与预览资源可达，视觉基线、报告来源和索引状态独立。具体冻结摘要、实际本地验收和生产未覆盖项见 [本轮验证记录](../verification/2026-11-24-project-publishing.md)。
