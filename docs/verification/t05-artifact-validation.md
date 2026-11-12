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
