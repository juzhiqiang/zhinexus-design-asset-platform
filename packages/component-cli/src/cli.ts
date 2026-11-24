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
      stdout: `component CLI v${version} — 工程骨架

用法:
  component login --api-url <origin> [--credential-file <path>] [--ca-file <path>] [--candidate <revision>]
  component check [--framework vue|react|all] [--staging-dir <dir>]
  component init --package <relative-dir> --component <id> --export <name> --framework vue|react|all --category <id> [--project <root>]
  component dev --framework vue|react [--project <root>]
  component doctor --framework vue|react|all [--project <root>] [--api-url <origin>]
  component prepare-release --framework vue|react|all [--project <root>] [--bundle-dir <relative-dir>]
  component release --framework vue|react|all [--project <root>] [--api-url <origin>]
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
  login            公司 OIDC S256 回环登录，保存当前 API 的用户私有凭证
  check            本地构建、冻结、干净消费者验证、截图与报告生成闭环
  prepare-release  整理并生成合法的 ReleaseManifestV1 与完整冻结发布材料 Bundle
  baseline         管理与确认本地自动验证产生的视觉回归基线
  integrate        只读识别目标项目（inspect）、生成可审查的只读接入计划（plan），
                   或按显式授权执行受控应用（apply）与保留用户编辑的恢复（rollback）
  init/dev/doctor   读取 component.config.json，初始化与开发已有组件包，校验身份/ACL/分类
  release/status   上传冻结材料与原会话恢复；项目恢复自动复用 .component-release.json

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

  const [command, ...rest] = args;
  if (['init', 'dev', 'doctor', 'prepare-release', 'release'].includes(command ?? '') &&
    (['init', 'dev', 'doctor'].includes(command ?? '') || rest.includes('--project') || rest.includes('--config') || existsSync(join(context.cwd ?? process.cwd(), 'component.config.json')))) {
    const { runProjectCommand } = await import('./commands/project.js');
    return runProjectCommand(command!, rest, version, context);
  }
  if (command === 'login') {
    try {
      const options:Record<string,string> = {};
      for (let i=0;i<rest.length;i+=2) {
        const key=rest[i]!,value=rest[i+1];
        if (!['--api-url','--credential-file','--ca-file','--candidate'].includes(key) || !value || options[key]) throw new Error();
        options[key]=value;
      }
      if (!options['--api-url']) throw new Error();
      const { companyLogin } = await import('./commands/login.js');
      const result = await companyLogin({ apiOrigin:options['--api-url'],credentialFile:options['--credential-file'],caFile:options['--ca-file'],candidate:options['--candidate'],administratorToken:process.env.ZHINEXUS_API_TOKEN });
      return {exitCode:0,stdout:JSON.stringify(result)+'\n',stderr:''};
    } catch { return {exitCode:1,stdout:'',stderr:'公司登录失败：请检查接入地址、客户端、回调端口与授权。\n'}; }
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
