# T05 上传产物字节校验记录

日期：2026-11-12。独立 validator 工作树，基线 `6508157`；测试依赖收口提交 `25726eb` 在本工作树为 `a60c89f`。负责人 C 的 validator 子任务。

## 实现与边界

- `validateUploadedArtifact(path, bytes)` 供上传完成使用：安全逻辑路径、真实 PNG/JPEG 解码、10 MiB/8192 边长、MIME 与扩展名一致、拒绝图片尾随数据；文本资源须为有效 UTF-8，JSON 限制 1 MiB/32 层。其他静态二进制资源返回 `application/octet-stream`，不执行其内容。
- `validatePlatformBundle(manifest, files, authenticatedChannel)` 复用 contracts 的完整字节摘要/清单/报告/环境/逐实现截图校验，按实际材料执行 50 MiB 单文件、500 MiB 总量、5000 文件上限，再验证真实图片与 npm tarball。认证客户端来源与 manifest 不符返回 `SOURCE_FORBIDDEN`，不改写客户端材料。
- gzip 输出通过 zlib `maxOutputLength` 限制为 200 MiB，随后只读内存 ustar/POSIX PAX 数据。归档计数包含目录和扩展头；拒绝绝对路径、穿越、Windows 分隔符/ADS/设备名/非法字符、NFC/大小写碰撞、文件与目录碰撞、软/硬链接、特殊项、非法校验和/填充/尾部。支持安全 Unicode PAX 路径，拒绝全局 path/size、未知覆盖字段、GNU long/sparse 特殊格式。未写出解包目录。
- 真实 `package.json` 的名称、版本、dependencies、peerDependencies 必须与 manifest 完全一致。所有 exports 目标必须留在包内并存在；逐实现 export 必须有 `.js/.mjs/.cjs` 运行时目标，受管理图表子路径不能漏报实现。仅根导出的 core 包无需伪造 VariantRef。当前对子路径通配符失败关闭。
- 报告内独立 ScreenshotRef 同样只接受 PNG/JPEG；SVG 可作为浏览器静态预览资源。PNG 在进入 pngjs 前按精确像素流长度限制解压，包括 Adam7 分支；JPEG 先检查 frame 尺寸再启用解码器内存上限。
- 服务端只核对已构建文件的字节、包元数据和声明导出存在性；不安装、不构建、不导入或运行上传的 JavaScript，不证明 exportName 的 JavaScript 语义、实际组件功能或实际浏览器视觉质量。
- 测试 helper `tests/fixtures/t05-artifacts.ts` 导出 `createValidBundle(channel = 'web')`，异步返回 `{ manifest, files, reports }`，使用实际 gzip npm 结构及有效 PNG 字节；另导出 JPEG 与负例重写 helper。材料仍是测试数据，不能冒充外部消费者或浏览器证据。

## RED → GREEN

初轮 45 项用例中 42 项预期失败，确认缺少字节校验、归档安全和协议拒绝行为。临时 RED 加载占位在实现后删除，最终测试直接导入 `apps/api/dist/uploads/validator.js`，缺少编译产物会失败。

第二轮补充回归 53 项中 4 项预期失败：报告独立 SVG、Windows `COM¹`、管道符和星号路径。修复后 53/53 通过。第三轮类型声明作为实现的导出反例预期失败，补充运行时导出要求后最终 54/54 通过。

## 实际命令与结果

全部通过命令均使用固定 Node 26.13.0 / pnpm 12.18.0 的仓库包装器：

| 命令 | 实际结果 |
| --- | --- |
| `.\scripts\pnpm.ps1 install --frozen-lockfile` | 成功；无依赖或锁文件变动 |
| `.\scripts\pnpm.ps1 --filter @company/contracts build` | 成功 |
| `.\scripts\pnpm.ps1 --filter @company/platform-api build` | 成功，最后一次包含最终运行时导出检查 |
| `.\scripts\pnpm.ps1 --filter @company/platform-api typecheck` | 成功 |
| `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 成功 |
| `.\scripts\pnpm.ps1 exec vitest run tests/integration/upload-validation.test.ts` | 最终 54/54 通过 |
| `.\scripts\pnpm.ps1 verify:workspace` | 10 个成员、无环、公开/私有和服务依赖边界通过 |
| `.\scripts\pnpm.ps1 -PnpmArgs @('exec','turbo','run','build','--force')` | 10/10 成功，0 缓存命中；既有 Vue/React 示例大 chunk 提示仍存在 |
| `.\scripts\pnpm.ps1 test` | 19 文件、280/280 通过；在最后一个运行时导出回归加入前执行。既有子进程 `shell:true` 触发 DEP0190 提示 |

首次构建发现 TypeScript 控制流缩窄错误并修正；fixture 的 tar Header/PNG 类型错误也已修正。`--force` 与 `--cache` 同时传入被 Turbo 拒绝，改为单独 `--force` 后全部实际执行成功。全仓构建同步生成了 CLI 契约副本的两处差异；确认它们由本轮构建产生后恢复其基线内容，不纳入 validator 提交。

原始架构文档 SHA-256：`e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`，未修改。

## 未覆盖的验收

本记录仅覆盖 T05 字节校验子任务。未运行公司实际 OIDC 登录、跨存储上传冻结/发布 HTTP 链路、浏览器消费者验收或 G2 外部环境验收；这些仍由 C 集成任务执行，完整 T05 状态保持未完成。未重启开发服务/基础设施，未合并或 push。平台版本/README/总体计划由 C 主代理统一收口，本子任务不修改共享文件。

## 模块审查返工记录（2026-11-12）

原实现提交 `bb6683d` 经独立模块审查后，在同一工作树新增四类回归并修改 validator；本节追加记录，不改写前述历史验证。

- **完整子路径清单**：移除固定 15 个图表名称表。所有声明的 JavaScript 运行时子路径默认要求对应 VariantRef，包括 `./custom-chart`、`./charts/line` 以及任意条件分支中的 JS 目标。根入口维持 aggregate/core 语义，CSS/JSON 等静态非 JS 导出无需伪造组件实现。当前 core 实际仅有根导出，没有用于豁免 JavaScript utils 子路径的架构依据；未来增加此类例外须先对齐架构和契约。
- **实际安装依赖**：当前 ReleaseManifestV1 没有 optional/bundled 依赖字段，因此拒绝 tarball 中出现 `optionalDependencies`、`bundledDependencies`、`bundleDependencies`，也拒绝包内任意层级隐藏的 `node_modules`。实际 dependencies 与 peerDependencies 仍逐字典匹配 manifest，并要求合法包名、精确 semver（允许合法预发布、禁止 build 元数据）、非私有工作区包；workspace/file/git/npm alias/版本范围不能因 manifest 同样声明而放行。私有包集合按当前固定 10 成员架构列出，不访问或执行上传代码。
- **条件导出有效性**：先对所有分支执行语法、包内路径、文件存在性和嵌套预算检查。再按属性顺序解析两类承诺消费者：Node ESM 条件 `node/node-addons/module-sync/import`，生产浏览器 ESM 条件 `browser/module/production/import`，各自包含 `default`。未知条件不匹配，数字条件键及嵌套子路径键拒绝；对象命中的 null 阻断后续 fallback，未匹配的嵌套对象可继续；数组跳过 null/undefined 后选择首个有效字符串。VariantRef 的两类解析结果均须是 `.js/.mjs/.cjs`，不能把类型声明或未命中的 JS 分支当作有效实现。
- **MIME 原型边界**：扩展名查询改为 Object.hasOwn；`asset.constructor`、`asset.__proto__` 返回字符串 `application/octet-stream`。

### 新增 RED 与技术依据

初次新增回归后，92 项中 28 项失败，实际复现自定义/嵌套导出漏报、optional 覆盖/隐藏依赖、冻结协议/私有依赖、条件顺序/数字键/未知条件及 MIME 原型问题。

使用固定 Node 26.13.0 的 `--experimental-import-meta-resolve --input-type=module` 纯元数据探针，每个条件组合在独立临时 package 路径验证（避免 Node package.json 缓存影响）。没有安装或导入探针包中的 JavaScript。实际结果：

| exports 目标 | Node ESM 解析结果 |
| --- | --- |
| `{ import: null, default: './line.js' }` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `{ default: './line.js', import: null }` | `line.js` |
| `{ onlyUnknown: './line.js' }` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `{ '0': './line.js', import: './line.js' }` | `ERR_INVALID_PACKAGE_CONFIG` |
| `{ import: [null, './line.js'] }` | `line.js` |
| `{ import: { unknown: './line.js' }, default: './line.js' }` | `line.js` |

最初自行添加的数组 null 负例与 Node 实际语义不符，已改为正例，并新增全 null 数组的拒绝用例；它不计作实现缺陷证据。条件对象 null 与数组 null 分别处理。修复 MIME、依赖后分别运行针对性过滤测试，再完成子路径与条件解析，最终为 93 项。

### 返工后实际验证

| 命令 | 结果 |
| --- | --- |
| `.\scripts\pnpm.ps1 --filter @company/platform-api build` | 成功，含全部返工代码 |
| `.\scripts\pnpm.ps1 exec vitest run tests/integration/upload-validation.test.ts` | 93/93 通过 |
| `.\scripts\pnpm.ps1 --filter @company/platform-api typecheck` | 成功 |
| `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 成功 |
| `.\scripts\pnpm.ps1 verify:workspace` | 成功：10 成员、无环、服务依赖安全 |
| `git diff --check` | 成功 |

本轮按 C 主代理约定执行窄范围验证，未再次运行涉及消费者/浏览器的全仓测试；此前 280 项通过只属于前述初始实现时点，最终集成全套验证由主代理执行。仍未声称 JS exportName 语义、真实浏览器兼容性或并发解析容量已验证。认证调用链为每个请求重新读取服务器冻结字节，外部可变 Map 竞态由主代理在集成层控制。
