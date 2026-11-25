# juz-cli

在已有 Vue / React 组件项目里初始化、开发、打包和发布。组件代码及 API、文档、消费者示例由开发者维护。

发布到 npm 后安装：`npm install -g juz-cli`。开发测试可全局安装构建得到的 `juz-cli-<version>.tgz`。

正常安装会自动下载匹配的 Chromium，已有缓存直接复用。下载失败会给出补装命令；处理网络问题后重试安装即可。`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 或 npm `--ignore-scripts` 可跳过，之后需手动补装浏览器才能截图。Linux 系统库仍按 Playwright 提示准备，不自动提权安装。

```sh
juz login --api-url https://你的平台API域名
juz init
juz dev
juz publish
```

首次登录配置 API 地址，后续自动复用。自动化可用 `juz login --api-url <origin> --token <token>`；token 保存在用户目录，不进入项目或发布包。

`juz init` 交互选择已有包、组件 ID、导出、框架和管理员维护的分类，创建 `component.config.json`。按输出提示填写 API/docs/消费者就绪协议后即可发布。私有业务工程应选择其中可发布的组件子包。

`juz publish` 自动构建、冻结 tarball、在外部消费者校验和截图，然后上传到当前登录服务器。中断后重复同一命令恢复同一份材料；修改内容须升级组件版本。

只打本地包：`juz package`，输出 ZIP 和冻结目录，不要求平台登录（消费者依赖安装可能访问 npm）。当前后台需先解压 ZIP，再导入 manifest.json 和材料目录。

运行环境：Node >=24.6.0，pnpm 12.18.0（供冻结包与干净消费者安装使用），与 CLI Playwright 版本匹配的 Chromium。`juz --help` 查看常用命令，`juz --help-all` 查看详细诊断/恢复命令。
