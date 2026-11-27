import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectCliContext } from './commands/project.js';

export async function runCli(
  args: readonly string[],
  version: string,
  context: ProjectCliContext = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (args.length === 1 && args[0] === '--version') {
    return { exitCode: 0, stdout: `${version}\n`, stderr: '' };
  }
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
    return {
      exitCode: 0,
      stdout: `juz CLI v${version} — 组件开发与发布

  juz create <目录> --framework react|vue|all  创建离线可运行模板
  juz init      接入已有组件包；本地分类可以暂未分配
  juz login     选择账号密码、浏览器授权或 Token 登录（首次可加 --api-url <origin>）
  juz dev       启动本地工作台（127.0.0.1:1111）；旧开发脚本用 --script
  juz preview --bundle-dir <目录>  只读预览冻结材料
  juz package   本地构建、验证冻结产物，生成本地 ZIP（后台需解压导入）
  juz publish   构建并验证后发布；重试时复用已有冻结材料

在已有组件项目目录运行；子包可通过 juz init --package <相对路径> 选择。
本地开发无需登录。冻结前通过 --category <平台分类 ID> 或工作台分配分类；发布时检查身份和权限。
工作台支持 --port <端口>、--no-open、--package <包名>；多包打包和发布必须选择 --package。
账号密码：juz login --method password --username <账号>（隐藏输入密码）
浏览器授权：juz login --method browser
令牌登录：juz login --api-url <origin> --token <token>
平台地址支持 HTTP/HTTPS，建议使用 HTTPS。
更多参数与兼容命令：juz --help-all
版本：juz --version
`,
      stderr: '',
    };
  }
  if (args.length === 1 && args[0] === '--help-all') {
    return {
      exitCode: 0,
      stdout: `juz CLI v${version} — 完整命令（兼容 component）

用法:
  juz login [--api-url <origin>] [--method password|browser|token] [--username <账号> | --token <token>] [--credential-file <path>] [--ca-file <path>]
  component login --method browser --candidate <revision> [--api-url <origin>]
  component check [--framework vue|react|all] [--staging-dir <dir>]
  component init --package <relative-dir> --component <id> --export <name> --framework vue|react|all --category <id> [--project <root>]
  juz create <目录> --framework react|vue|all
  juz dev [--project <root>] [--package <name>] [--framework vue|react] [--port <port>] [--no-open]
  juz dev --script [--framework vue|react] [--project <root>]
  juz preview --bundle-dir <目录> [--port <port>] [--no-open]
  component doctor --framework vue|react|all [--project <root>] [--api-url <origin>]
  component prepare-release [--framework vue|react|all] [--project <root>] [--bundle-dir <relative-dir>]
  component package [--framework vue|react|all] [--project <root>] [--bundle-dir <relative-dir>]
  component release [--framework vue|react|all] [--project <root>] [--api-url <origin>]
  component publish [--framework vue|react|all] [--project <root>] [--api-url <origin>]
  component prepare-release [--bundle-dir <dir>] [--framework vue|react|all]
  component release --prepare-only [--bundle-dir <dir>]
  component baseline accept --report <path> --reason <text> [--api-url <url>] [--token <jwt>] [--expected-revision <rev>]
  component echarts check --bundle <dir> [--version <x.y.z> | --latest | --echarts <x.y.z>] [--registry <url|offline>] [--json]
  component echarts verify --bundle <dir> [--version <x.y.z> | --latest | --echarts <x.y.z>] [--frameworks <vue,react>] [--components <list>] [--presentations <list>] [--registry <url|offline>] [--peer <strict|legacy|strict-only>] [--baseline <files>] [--out <dir>] [--label <name>] [--consumer-root <dir>] [--keep] [--timeout <ms>] [--skip-browser] [--probe-entry <path>] [--json]
  component integrate inspect --project <path> [--workspace <relative-path>]
  component integrate plan --project <path> [--workspace <relative-path>] --match <file> --api-url <origin> --registry <origin> [--output-dir <relative-path>]
  component integrate apply --project <path> --plan <file> --api-url <origin> --registry <origin> --backup-root <outside-root> --allow-install <true|false> [--workspace <relative-path>] [--output-dir <relative-path>]
  component integrate rollback --project <path> --backup-id <id> --backup-sha256 <sha256> --backup-root <dir>
  component integrate verify --project <path> --plan <file> --apply-result <file> --spec <file> --out <external-dir> --allow-project-scripts <true|false> --allow-browser <true|false>
  component integrate repair --project <path> --plan <file> --apply-result <file> --spec <file> --out <external-dir> --allow-project-scripts <true|false> --allow-browser <true|false> --report <file> [--max-attempts <0|1|2>]
  component mcp serve --config <absolute-file>
  component --version
  component --help

可用命令:
  login            账号密码、浏览器 OIDC S256 回环授权或 Token 三选一
  check            本地构建、冻结、干净消费者验证、截图与报告生成闭环
  prepare-release  整理并生成合法的 ReleaseManifestV1 与完整冻结发布材料 Bundle
  baseline         管理与确认本地自动验证产生的视觉回归基线
  integrate        只读识别目标项目（inspect）、生成可审查的只读接入计划（plan），
                   或按显式授权执行受控应用（apply）与保留用户编辑的恢复（rollback）
  create/init/dev  离线新建、接入和开发；component.workspace.json 支持多包
  doctor           发布前检查身份/ACL/分类
  release/status   上传冻结材料与原会话恢复；项目恢复自动复用每包 .component-state 指针

交互运行 login 可选择登录方式；--username 直接选择账号密码，密码与手动输入的 Token 隐藏输入。
首次登录按提示更换临时密码；只保存通过 API 验证的 Token 和地址，不保存密码。
API 地址支持 HTTP/HTTPS，HTTP 仅提示建议使用 HTTPS；HTTPS 仍校验证书，私有 CA 用 --ca-file。
发布、状态与基线命令按 --token、环境凭证、已保存登录的顺序选择认证。
保存的凭证只用于完全匹配的 API origin，过期后需重新登录；自定义登录文件可通过
ZHINEXUS_CREDENTIAL_FILE 指定。候选登录使用 ZHINEXUS_API_TOKEN 管理员凭证，只记录验证结果。

只读边界: component integrate inspect/plan 不写入目标项目、不创建目录/缓存/备份、不执行安装/构建/
项目脚本/浏览器；apply/rollback 的写入、安装与恢复范围由产品边界决定（授权只来自本次显式调用，
plan.commands 只是展示数据，不执行项目 build/typecheck）；stdout 只有结构化 JSON，诊断走 stderr；
凭据仅从环境变量 ZHINEXUS_API_TOKEN / ZHINEXUS_REGISTRY_TOKEN 读取，不进入任何输出。
退出码: 0 无已知阻塞或操作成功；2 含 conflicts 的结构化结果或 blocked/recovery-required；
1 参数/JSON/读取/网络错误。
`,
      stderr: '',
    };
  }

  const [requestedCommand, ...rest] = args;
  if (requestedCommand === 'preview' || (requestedCommand === 'dev' && !rest.includes('--script'))) {
    const { runWorkbenchCommand } = await import('./workbench/command.js');
    return runWorkbenchCommand(requestedCommand, rest, version, context);
  }
  if (requestedCommand === 'dev' && rest.includes('--script')) rest.splice(rest.indexOf('--script'),1);
  if (requestedCommand === 'create') {
    try {
      if (rest.length !== 3 || rest[1] !== '--framework') throw new Error('ARGUMENT_INVALID: juz create <目录> --framework react|vue|all');
      const { createProject } = await import('./workbench/create.js');
      return { exitCode:0, stdout:JSON.stringify(await createProject(context.cwd ?? process.cwd(),rest[0]!,rest[2]!))+'\n',stderr:'' };
    } catch(error) {return {exitCode:1,stdout:'',stderr:String(error)+'\n'};}
  }
  const command = requestedCommand === 'publish' ? 'release' : requestedCommand;
  if (['init', 'dev', 'doctor', 'package', 'prepare-release', 'release'].includes(command ?? '') &&
    (['init', 'dev', 'doctor', 'package', 'publish'].includes(requestedCommand ?? '') || rest.includes('--project') || rest.includes('--config') || existsSync(join(context.cwd ?? process.cwd(), 'component.config.json')) || existsSync(join(context.cwd ?? process.cwd(), 'component.workspace.json')))) {
    const { runProjectCommand } = await import('./commands/project.js');
    const result = await runProjectCommand(command!, rest, version, context);
    const configFile = rest.includes('--config') ? rest[rest.indexOf('--config') + 1] : 'component.config.json';
    if (['package', 'publish'].includes(requestedCommand!) && result.stderr.trim() === 'PROJECT_FILE_MISSING: ' + configFile) result.stderr += '请在组件项目目录先运行 juz init 创建 component.config.json。\n';
    return result;
  }
  if (command === 'login') {
    const warnings: string[] = [];
    try {
      const options:Record<string,string> = {};
      for (let i=0;i<rest.length;i+=2) {
        const key=rest[i]!,value=rest[i+1];
        if (!['--api-url','--credential-file','--ca-file','--candidate','--token','--timeout','--method','--username'].includes(key) || !value || value.startsWith('--') || options[key] !== undefined) throw new Error();
        options[key]=value;
      }
      const { companyLogin, LoginError } = await import('./commands/login.js');
      const method = options['--method'] ?? (options['--token'] !== undefined ? 'token' : options['--username'] !== undefined ? 'password' : options['--candidate'] ? 'browser' : context.select ? await context.select('选择登录方式', [{value:'password',label:'账号密码'}, {value:'browser',label:'浏览器授权'}, {value:'token',label:'Token'}]) : 'browser');
      if (!['password','browser','token'].includes(method) || (options['--token'] !== undefined && method !== 'token') || (options['--username'] !== undefined && method !== 'password') || (options['--candidate'] && method !== 'browser')) throw new LoginError('LOGIN_METHOD_CONFLICT');
      const secret = async (label: string) => { if (!context.promptSecret) throw new LoginError('INTERACTIVE_REQUIRED'); return context.promptSecret(label); };
      const username = method === 'password' ? options['--username'] ?? (context.prompt ? await context.prompt('username') : undefined) : undefined;
      if (method === 'password' && !username?.trim()) throw new LoginError('USERNAME_REQUIRED');
      const password = method === 'password' ? await secret('password') : undefined;
      const token = method === 'token' ? options['--token'] ?? await secret('token') : undefined;
      const result = await companyLogin({ apiOrigin:options['--api-url'], method:method as 'password'|'browser'|'token', username, password, token, credentialFile:options['--credential-file'],caFile:options['--ca-file'],candidate:options['--candidate'],administratorToken:process.env.ZHINEXUS_API_TOKEN, timeoutMs:options['--timeout'] === undefined ? undefined : Number(options['--timeout']),
        onWarning: message => { if (context.onProgress) context.onProgress(message); else warnings.push(message); },
        requestNewPassword: async () => { const next = await secret('newPassword'); if (!next || next !== await secret('confirmPassword')) throw new LoginError('PASSWORD_CONFIRMATION_MISMATCH'); return next; },
      });
      return {exitCode:0,stdout:JSON.stringify(result)+'\n',stderr:warnings.map(message => message+'\n').join('')};
    } catch(error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      const messages: Record<string,string> = { LOGIN_METHOD_CONFLICT:'请选择一种登录方式，不能混用账号密码、浏览器与 Token 参数。', INTERACTIVE_REQUIRED:'请在交互终端输入密码或 Token；自动化可使用 --token。', USERNAME_REQUIRED:'请输入账号，或通过 --username 指定账号。', PASSWORD_CHANGE_REQUIRED:'首次登录需设置新密码。', PASSWORD_CONFIRMATION_MISMATCH:'两次新密码不一致。', UNAUTHENTICATED:'账号密码或令牌无效，请检查后重试。', FORBIDDEN:'账号已停用或没有访问权限。', INFRA_UNAVAILABLE:'账号服务不可用，请检查 API 身份服务和数据库配置。', PASSWORD_LOGIN_UNAVAILABLE:'当前平台未提供账号密码登录，请选择浏览器授权或 Token。', PASSWORD_ENDPOINT_INVALID:'账号密码端点必须与所选 API 同源。', API_ORIGIN_INVALID:'API 地址须为完整的 HTTP 或 HTTPS origin。' };
      return {exitCode:1,stdout:'',stderr:warnings.map(message => message+'\n').join('')+'公司登录失败：'+(messages[code] ?? '请检查参数、接入地址、客户端、回调端口与授权。')+'\n'};
    }
  }

  if (command === 'prepare-release' || (command === 'release' && rest.includes('--prepare-only'))) {
    let frameworkChoice: 'vue' | 'react' | 'all' = 'all';
    let bundleDir = '.release-bundle';
    let timeoutMs: number | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--prepare-only') {
        continue;
      } else if (arg === '--framework') {
        const val = rest[++i];
        if (val === 'vue' || val === 'react' || val === 'all') {
          frameworkChoice = val;
        } else {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `错误: --framework 仅支持 vue、react 或 all，收到: ${val}\n`,
          };
        }
      } else if (arg === '--bundle-dir') {
        bundleDir = rest[++i]!;
      } else if (arg === '--timeout') {
        timeoutMs = Number(rest[++i]);
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component prepare-release [--bundle-dir <dir>] [--framework vue|react|all]\n`,
        };
      }
    }

    const frameworks: Array<'vue' | 'react'> =
      frameworkChoice === 'all'
        ? ['vue', 'react']
        : frameworkChoice === 'vue'
          ? ['vue']
          : ['react'];

    try {
      const { prepareReleaseBundle } = await import('./local/manifest.js');
      const result = await prepareReleaseBundle({
        bundleDir,
        frameworks,
        timeoutMs,
      });

      if (!result.ok) {
        let errStr = `✖ 发布材料契约校验未通过:\n`;
        if (result.issues) {
          errStr += result.issues.map((issue) => `  - [${issue.code}] ${issue.path}: ${issue.message}`).join('\n') + '\n';
        }
        return { exitCode: 1, stdout: '', stderr: errStr };
      }

      let stdout = `✔ 完整发布材料生成成功！\n`;
      stdout += `  - 目录: ${result.bundleDir}\n`;
      stdout += `  - 清单版本: v${result.manifest.schemaVersion} (channel: ${result.manifest.channel})\n`;
      stdout += `  - 包含包: ${result.manifest.packages.map((p) => `${p.name}@${p.version}`).join(', ')}\n`;
      stdout += `  - 包含变体: ${result.manifest.variants.map((v) => v.variantId).join(', ')}\n`;
      stdout += `  - 文件清单总数: ${result.manifest.files.length} 个文件 (已通过 SHA-256 与字节校验)\n`;
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: `✖ 生成发布材料失败: ${msg}\n` };
    }
  }

  if (command === 'check') {
    let framework: 'vue' | 'react' | 'all' = 'all';
    let stagingDir: string | undefined;
    let baselineDir: string | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--framework') {
        const val = rest[++i];
        if (val === 'vue' || val === 'react' || val === 'all') {
          framework = val;
        } else {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `错误: --framework 仅支持 vue、react 或 all，收到: ${val}\n`,
          };
        }
      } else if (arg === '--staging-dir') {
        stagingDir = rest[++i];
      } else if (arg === '--baseline-dir') {
        baselineDir = rest[++i];
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component check [--framework vue|react|all] [--staging-dir <dir>] [--baseline-dir <dir>]\n`,
        };
      }
    }

    const { runCheckCommand } = await import('./commands/check.js');
    const checkResult = await runCheckCommand({ framework, stagingDir, baselineDir });
    let stdout = '';
    let stderr = '';

    for (const r of checkResult.results) {
      stdout += `✔ [${r.framework}] 验证完成: 变体 ${r.variantId}, 基线结果: ${r.report.baselineResult}, 产物摘要: ${r.packageSha256.slice(0, 16)}..., 报告: ${r.reportPath}\n`;
    }

    if (checkResult.success) {
      stdout += `\n所有指定框架本地验证完成 (已生成真实截图与合法 NEW 基线报告)。\n`;
      return { exitCode: 0, stdout, stderr };
    } else {
      stderr += `\n✖ 本地验证失败:\n${checkResult.errors.map((e) => `  - ${e}`).join('\n')}\n`;
      return { exitCode: 1, stdout, stderr };
    }
  }

  if (command === 'release' && !rest.includes('--prepare-only')) {
    let bundleDir = '.release-bundle';
    let apiUrl: string | undefined;
    let token: string | undefined;
    let idempotencyKey: string | undefined;
    let timeoutMs: number | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--bundle-dir') {
        bundleDir = rest[++i]!;
      } else if (arg === '--api-url') {
        apiUrl = rest[++i];
      } else if (arg === '--token') {
        token = rest[++i];
      } else if (arg === '--key' || arg === '--idempotency-key') {
        idempotencyKey = rest[++i];
      } else if (arg === '--timeout') {
        timeoutMs = Number(rest[++i]);
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component release [--bundle-dir <dir>] [--api-url <url>] [--token <jwt>] [--key <idempotencyKey>]\n`,
        };
      }
    }

    try {
      const { executeReleaseCommand } = await import('./local/release.js');
      const result = await executeReleaseCommand({
        bundleDir,
        apiUrl,
        token,
        idempotencyKey,
        timeoutMs,
        onProgress: context.onProgress,
      });

      if (!result.ok) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `✖ 发布未成功: ${result.error ?? '未知错误'}\n  作业 ID: ${result.jobId ?? '未创建'}\n  终态: ${result.state ?? '未知'}\n`,
        };
      }

      let stdout = `✔ 发布成功！\n`;
      stdout += `  - 作业 ID: ${result.jobId}\n`;
      stdout += `  - 终态: ${result.state}\n`;
      stdout += `  - 阶段: ${result.stage}\n`;
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: `✖ 执行发布失败: ${msg}\n` };
    }
  }

  if (command === 'status') {
    let jobId: string | undefined;
    let bundleDir: string | undefined;
    let apiUrl: string | undefined;
    let token: string | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--job-id') {
        jobId = rest[++i];
      } else if (arg === '--bundle-dir') {
        bundleDir = rest[++i];
      } else if (arg === '--api-url') {
        apiUrl = rest[++i];
      } else if (arg === '--token') {
        token = rest[++i];
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component status [--job-id <id>] [--bundle-dir <dir>] [--api-url <url>] [--token <jwt>]\n`,
        };
      }
    }

    try {
      const { executeStatusCommand } = await import('./local/release.js');
      const result = await executeStatusCommand({
        jobId,
        bundleDir,
        apiUrl,
        token,
      });

      if (!result.ok || !result.status) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `✖ 查询发布状态失败: ${result.error ?? '未知错误'}\n`,
        };
      }

      let stdout = `发布作业状态:\n`;
      stdout += `  - 状态: ${result.status.state}\n`;
      stdout += `  - 阶段: ${result.status.stage}\n`;
      stdout += `  - 尝试次数: ${result.status.attempt}\n`;
      if (result.status.lastError) {
        stdout += `  - 错误信息: [${result.status.lastError.code}] ${result.status.lastError.message}\n`;
      }
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: `✖ 查询作业失败: ${msg}\n` };
    }
  }

  if (command === 'resume') {
    let bundleDir = '.release-bundle';
    let apiUrl: string | undefined;
    let token: string | undefined;
    let timeoutMs: number | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--bundle-dir') {
        bundleDir = rest[++i]!;
      } else if (arg === '--api-url') {
        apiUrl = rest[++i];
      } else if (arg === '--token') {
        token = rest[++i];
      } else if (arg === '--timeout') {
        timeoutMs = Number(rest[++i]);
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component resume [--bundle-dir <dir>] [--api-url <url>] [--token <jwt>]\n`,
        };
      }
    }

    try {
      const { executeResumeCommand } = await import('./local/release.js');
      const result = await executeResumeCommand({
        bundleDir,
        apiUrl,
        token,
        timeoutMs,
      });

      if (!result.ok) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `✖ 恢复发布未成功: ${result.error ?? '未知错误'}\n  作业 ID: ${result.jobId}\n  状态: ${result.state}\n`,
        };
      }

      let stdout = `✔ 恢复发布成功！\n`;
      stdout += `  - 作业 ID: ${result.jobId}\n`;
      stdout += `  - 终态: ${result.state}\n`;
      stdout += `  - 阶段: ${result.stage}\n`;
      return { exitCode: 0, stdout, stderr: '' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: `✖ 恢复发布失败: ${msg}\n` };
    }
  }

  if (command === 'baseline') {
    const [subcommand, ...subRest] = rest;
    if (subcommand !== 'accept') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `错误: 未知 baseline 子命令 ${subcommand ?? '(空)'}\n用法: component baseline accept --report <path> --reason <text> [--api-url <url>] [--token <jwt>] [--expected-revision <rev>]\n`,
      };
    }

    let reportPath = '';
    let reason = '';
    let apiUrl: string | undefined;
    let token: string | undefined;
    let expectedRevision: string | undefined;
    let screenshotId: string | undefined;
    let jobId: string | undefined;
    let timeoutMs: number | undefined;

    for (let i = 0; i < subRest.length; i++) {
      const arg = subRest[i];
      if (arg === '--report') {
        reportPath = subRest[++i] ?? '';
      } else if (arg === '--reason') {
        reason = subRest[++i] ?? '';
      } else if (arg === '--api-url') {
        apiUrl = subRest[++i];
      } else if (arg === '--token') {
        token = subRest[++i];
      } else if (arg === '--expected-revision') {
        expectedRevision = subRest[++i];
      } else if (arg === '--screenshot-id') {
        screenshotId = subRest[++i];
      } else if (arg === '--job-id') {
        jobId = subRest[++i];
      } else if (arg === '--timeout') {
        timeoutMs = Number(subRest[++i]);
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component baseline accept --report <path> --reason <text> [--api-url <url>] [--token <jwt>] [--expected-revision <rev>] [--job-id <id>]\n`,
        };
      }
    }

    if (!reportPath) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: '错误: 缺少必填参数 --report <path>\n',
      };
    }

    const { acceptBaseline } = await import('./commands/baseline.js');
    const result = await acceptBaseline({
      reportPath,
      reason,
      apiUrl,
      token,
      expectedRevision,
      screenshotId,
      jobId,
      timeoutMs,
    });

    if (!result.ok) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `✖ 基线确认失败 [${result.errorCode ?? 'ERROR'}]: ${result.error ?? '未知错误'}\n`,
      };
    }

    let stdout = `✔ 视觉基线确认成功！\n`;
    stdout += `  - 基线版本 (revisionId): ${result.revisionId ?? '-'}\n`;
    stdout += `  - 变体 / 示例: ${result.variantId} / ${result.exampleId}\n`;
    stdout += `  - 环境签名: ${result.environmentKey}\n`;
    stdout += `  - 截图 ID: ${result.screenshotId}\n`;
    return { exitCode: 0, stdout, stderr: '' };
  }

  if (command === 'echarts') {
    const [subcommand, ...subRest] = rest;
    if (subcommand !== 'check' && subcommand !== 'verify') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `错误: 未知 echarts 子命令 ${subcommand ?? '(空)'}\n用法: component echarts <check|verify> --bundle <dir> [选项]\n`,
      };
    }

    let bundleDir = '';
    let echartsVersion: string | undefined;
    let candidateVersion: string | undefined;
    let latest = false;
    let frameworks: string | undefined;
    let components: string | undefined;
    let presentations: string | undefined;
    let registry: string | undefined;
    let peer: string | undefined;
    let outDir: string | undefined;
    let label: string | undefined;
    let consumerRoot: string | undefined;
    let baseline: string | undefined;
    let probeEntry: string | undefined;
    let timeoutMs: number | undefined;
    let keep = false;
    let skipBrowser = false;
    let jsonOutput = false;

    for (let i = 0; i < subRest.length; i++) {
      const arg = subRest[i];
      if (arg === '--bundle') {
        bundleDir = subRest[++i] ?? '';
      } else if (arg === '--echarts') {
        echartsVersion = subRest[++i];
      } else if (arg === '--version') {
        candidateVersion = subRest[++i];
      } else if (arg === '--latest') {
        latest = true;
      } else if (arg === '--frameworks') {
        frameworks = subRest[++i];
      } else if (arg === '--components') {
        components = subRest[++i];
      } else if (arg === '--presentations') {
        presentations = subRest[++i];
      } else if (arg === '--registry') {
        registry = subRest[++i];
      } else if (arg === '--peer') {
        peer = subRest[++i];
      } else if (arg === '--out') {
        outDir = subRest[++i];
      } else if (arg === '--label') {
        label = subRest[++i];
      } else if (arg === '--consumer-root') {
        consumerRoot = subRest[++i];
      } else if (arg === '--baseline') {
        const nextVal = subRest[++i] ?? '';
        baseline = baseline ? `${baseline},${nextVal}` : nextVal;
      } else if (arg === '--probe-entry') {
        probeEntry = subRest[++i];
      } else if (arg === '--timeout') {
        timeoutMs = Number(subRest[++i]);
      } else if (arg === '--keep') {
        keep = true;
      } else if (arg === '--skip-browser') {
        skipBrowser = true;
      } else if (arg === '--json') {
        jsonOutput = true;
      } else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `错误: 未知参数 ${arg}\n用法: component echarts ${subcommand} --bundle <dir> [选项]\n`,
        };
      }
    }

    const { checkEchartsBundle, verifyEchartsCandidate } = await import('./commands/echarts.js');

    if (subcommand === 'check') {
      const result = await checkEchartsBundle({ bundleDir, echartsVersion, version: candidateVersion, latest, registry });
      if (!result.ok) {
        return {
          exitCode: 1,
          stdout: jsonOutput ? `${JSON.stringify(result, null, 2)}\n` : '',
          stderr: `✖ ECharts 兼容查询未通过 [${result.errorCode ?? 'ERROR'}]: ${result.error ?? '未知错误'}\n`,
        };
      }
      if (jsonOutput) {
        return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' };
      }
      let stdout = `✔ ECharts 兼容查询通过！\n`;
      stdout += `  - 冻结 Bundle 版本: ${result.bundleVersion}\n`;
      stdout += `  - 基线 / 候选 ECharts: ${result.baselineEchartsVersion} / ${result.candidateEchartsVersion}\n`;
      if (result.candidateIntegrity) {
        stdout += `  - 候选 Integrity: ${result.candidateIntegrity}\n`;
      }
      if (result.registryProxyNote) {
        stdout += `  - Registry 说明: ${result.registryProxyNote}\n`;
      }
      stdout += `  - 双框架覆盖: ${result.hasDualFrameworkCoverage} (supported=${result.supported?.length ?? 0})\n`;
      return { exitCode: 0, stdout, stderr: '' };
    }

    const verifyResult = await verifyEchartsCandidate({
      bundleDir,
      echartsVersion,
      version: candidateVersion,
      latest,
      frameworks,
      components,
      presentations,
      registry,
      peer,
      outDir,
      label,
      consumerRoot,
      baseline,
      keep,
      skipBrowser,
      probeEntry,
      timeoutMs,
    });

    if (!verifyResult.ok) {
      return {
        exitCode: 1,
        stdout: jsonOutput ? `${JSON.stringify(verifyResult, null, 2)}\n` : '',
        stderr: `✖ ECharts 兼容实测未通过 [${verifyResult.errorCode ?? 'ERROR'}]: ${verifyResult.error ?? '未知错误'}\n`,
      };
    }

    if (jsonOutput) {
      return { exitCode: 0, stdout: `${JSON.stringify(verifyResult, null, 2)}\n`, stderr: '' };
    }
    let stdout = `✔ ECharts 兼容实测通过 (recommendation=${verifyResult.recommendation})！\n`;
    stdout += `  - 候选 ECharts: ${verifyResult.evidence?.candidate.version}\n`;
    stdout += `  - 双框架组合数: ${verifyResult.evidence?.combinations.length ?? 0}\n`;
    return { exitCode: 0, stdout, stderr: '' };
  }

  if (command === 'integrate') {
    const { runIntegrateCommand } = await import('./commands/integrate.js');
    return await runIntegrateCommand(rest);
  }

  if (command === 'mcp') {
    const { runMcpServeCommand } = await import('./mcp/server.js');
    return await runMcpServeCommand(rest, version);
  }

  return {
    exitCode: 1,
    stdout: '',
    stderr: `命令尚未实现或参数不受支持：${args.join(' ')}\n运行 component --help 查看可用命令。\n`,
  };
}
