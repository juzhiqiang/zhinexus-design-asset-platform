/**
 * T17 A3 四工具本地 stdio MCP 服务端：`component mcp serve --config <absolute-file>`。
 *
 * 边界：
 * - 只暴露 `inspect_project`、`plan_integration`、`apply_integration`、`verify_integration`；
 * - 权限仅来自 `--config <absolute-file>` 的可信宿主 JSON，拒绝任何请求自报批准或额外字段；
 * - `verify_integration` 不标只读，且仅调用 `verifyIntegration`（不隐式修复）；
 * - `stdout` 仅用于 MCP 协议帧，诊断走 `stderr` 且严格脱敏凭据。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  validateIntegrationApplyAuthorization,
  validateIntegrationApplyResult,
  type IntegrationApplyAuthorizationV1,
} from '../contracts/integration-apply.js';
import { validateIntegrationPlan } from '../contracts/integration-plan.js';
import {
  validateIntegrationExecutionAuthorization,
  validateIntegrationVerificationSpec,
  type IntegrationExecutionAuthorizationV1,
} from '../contracts/integration-verification.js';
import { validateMatchPlan } from '../contracts/match-plan.js';
import { applyIntegration, canonicalProjectRoot } from '../integration/apply.js';
import { inspectProject } from '../integration/inspect.js';
import { planIntegration } from '../integration/plan.js';
import {
  assertArtifactRootOutsideProject,
  canonicalDigest,
  sanitizeDiagnosticText,
} from '../integration/report.js';
import { verifyIntegration } from '../integration/verify.js';
import { realpathOrSelf } from '../integration/workspace.js';

export type McpHostConfig = {
  schemaVersion: 1;
  projectRoot: string;
  artifactRoot: string;
  applyGrant?: IntegrationApplyAuthorizationV1;
  verificationGrant?: IntegrationExecutionAuthorizationV1;
};

const HostConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectRoot: z.string().min(1),
    artifactRoot: z.string().min(1),
    applyGrant: z.unknown().optional(),
    verificationGrant: z.unknown().optional(),
  })
  .strict();

export function parseMcpHostConfig(configPath: string): McpHostConfig {
  if (!path.isAbsolute(configPath)) {
    throw new Error('INVALID_CONFIG: --config 必须是绝对路径');
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
  const parsed = HostConfigSchema.parse(raw);

  const absProject = path.resolve(parsed.projectRoot);
  if (!fs.existsSync(absProject) || !fs.statSync(absProject).isDirectory()) {
    throw new Error('INVALID_CONFIG: projectRoot 必须是已存在的目录');
  }
  const canonicalRoot = canonicalProjectRoot(absProject);
  const realProjectRoot = realpathOrSelf(absProject);

  const artCheck = assertArtifactRootOutsideProject(realProjectRoot, parsed.artifactRoot);
  if (!artCheck.ok) {
    throw new Error('INVALID_CONFIG: artifactRoot 必须位于项目根之外');
  }
  const canonicalArtifact = canonicalProjectRoot(path.resolve(parsed.artifactRoot));

  let applyGrant: IntegrationApplyAuthorizationV1 | undefined;
  if (parsed.applyGrant !== undefined) {
    const checked = validateIntegrationApplyAuthorization(parsed.applyGrant);
    if (!checked.ok || checked.value.projectRoot !== canonicalRoot) {
      throw new Error('INVALID_CONFIG: applyGrant 结构或绑定根无效');
    }
    applyGrant = checked.value;
  }

  let verificationGrant: IntegrationExecutionAuthorizationV1 | undefined;
  if (parsed.verificationGrant !== undefined) {
    const checked = validateIntegrationExecutionAuthorization(parsed.verificationGrant);
    if (!checked.ok || checked.value.operation !== 'verify' || checked.value.projectRoot !== canonicalRoot) {
      throw new Error('INVALID_CONFIG: verificationGrant 仅允许 operation=verify 且必须绑定当前项目根');
    }
    verificationGrant = checked.value;
  }

  return {
    schemaVersion: 1,
    projectRoot: canonicalRoot,
    artifactRoot: canonicalArtifact,
    ...(applyGrant ? { applyGrant } : {}),
    ...(verificationGrant ? { verificationGrant } : {}),
  };
}

function tokenFromEnv(name: string): string | undefined {
  const val = process.env[name];
  return val && val.length > 0 ? val : undefined;
}

function jsonToolOk(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: sanitizeDiagnosticText(JSON.stringify(payload, null, 2)) }],
  };
}

function jsonToolError(code: string, message: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: sanitizeDiagnosticText(JSON.stringify({ status: 'error', error: { code, message } })),
      },
    ],
  };
}

function resolveBoundRoot(requested: string | undefined, boundCanonicalRoot: string): string | undefined {
  if (requested === undefined) return boundCanonicalRoot;
  const candidate = canonicalProjectRoot(path.resolve(requested));
  return candidate === boundCanonicalRoot ? candidate : undefined;
}

export function createComponentMcpServer(config: McpHostConfig, version: string): McpServer {
  const server = new McpServer(
    { name: 'zhinexus-component-cli', version },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'inspect_project',
    {
      description: '只读识别本地项目包管理器、锁文件、框架、依赖与 Git 状态',
      inputSchema: z
        .object({
          projectRoot: z.string().optional(),
          workspace: z.string().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: true },
    },
    async args => {
      const targetRoot = resolveBoundRoot(args.projectRoot, config.projectRoot);
      if (!targetRoot) {
        return jsonToolError('PATH_UNSAFE', 'projectRoot 超出宿主绑定根目录');
      }
      try {
        const res = await inspectProject(
          targetRoot,
          args.workspace !== undefined ? { workspace: args.workspace } : undefined,
        );
        return jsonToolOk(res);
      } catch (err) {
        return jsonToolError('EXECUTION_FAILED', err instanceof Error ? err.message : 'inspect_project 失败');
      }
    },
  );

  server.registerTool(
    'plan_integration',
    {
      description: '只读生成可审查的组件接入计划 IntegrationPlanV1',
      inputSchema: z
        .object({
          projectRoot: z.string().optional(),
          matchPlan: z.unknown(),
          apiUrl: z.string(),
          registryUrl: z.string(),
          workspace: z.string().optional(),
          outputDir: z.string().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: true },
    },
    async args => {
      const targetRoot = resolveBoundRoot(args.projectRoot, config.projectRoot);
      if (!targetRoot) {
        return jsonToolError('PATH_UNSAFE', 'projectRoot 超出宿主绑定根目录');
      }
      const checkedMatch = validateMatchPlan(args.matchPlan);
      if (!checkedMatch.ok) {
        return jsonToolError('INVALID_MATCH_PLAN', 'matchPlan 结构校验失败');
      }
      try {
        const plan = await planIntegration(targetRoot, checkedMatch.value, {
          apiUrl: args.apiUrl,
          registryUrl: args.registryUrl,
          ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
          ...(args.outputDir !== undefined ? { outputDir: args.outputDir } : {}),
          apiToken: tokenFromEnv('ZHINEXUS_API_TOKEN'),
          registryToken: tokenFromEnv('ZHINEXUS_REGISTRY_TOKEN'),
        });
        return jsonToolOk(plan);
      } catch (err) {
        return jsonToolError('EXECUTION_FAILED', err instanceof Error ? err.message : 'plan_integration 失败');
      }
    },
  );

  server.registerTool(
    'apply_integration',
    {
      description: '按宿主显式 applyGrant 执行受控文件写入与依赖接入',
      inputSchema: z
        .object({
          projectRoot: z.string().optional(),
          plan: z.unknown(),
          apiUrl: z.string(),
          registryUrl: z.string(),
          workspace: z.string().optional(),
          outputDir: z.string().optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async args => {
      const targetRoot = resolveBoundRoot(args.projectRoot, config.projectRoot);
      if (!targetRoot) {
        return jsonToolError('PATH_UNSAFE', 'projectRoot 超出宿主绑定根目录');
      }
      if (!config.applyGrant) {
        return jsonToolError('AUTHORIZATION_REQUIRED', '宿主未提供 applyGrant，拒绝写入');
      }
      const checkedPlan = validateIntegrationPlan(args.plan);
      if (!checkedPlan.ok) {
        return jsonToolError('INVALID_PLAN', 'plan 结构校验失败');
      }
      const actualPlanDigest = canonicalDigest(checkedPlan.value);
      if (actualPlanDigest !== config.applyGrant.planDigest) {
        return jsonToolError('AUTHORIZATION_MISMATCH', 'plan 摘要与宿主 applyGrant 不一致');
      }
      try {
        const backupRoot = path.join(config.artifactRoot, 'mcp-backups');
        const result = await applyIntegration(targetRoot, checkedPlan.value, {
          authorization: config.applyGrant,
          apiUrl: args.apiUrl,
          registryUrl: args.registryUrl,
          backupRoot,
          ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
          ...(args.outputDir !== undefined ? { outputDir: args.outputDir } : {}),
          apiToken: tokenFromEnv('ZHINEXUS_API_TOKEN'),
          registryToken: tokenFromEnv('ZHINEXUS_REGISTRY_TOKEN'),
        });
        return jsonToolOk(result);
      } catch (err) {
        return jsonToolError('EXECUTION_FAILED', err instanceof Error ? err.message : 'apply_integration 失败');
      }
    },
  );

  server.registerTool(
    'verify_integration',
    {
      description: '按宿主显式 verificationGrant 执行本地原生命令、行为与视觉验证',
      inputSchema: z
        .object({
          projectRoot: z.string().optional(),
          plan: z.unknown(),
          applyResult: z.unknown(),
          spec: z.unknown(),
        })
        .strict(),
      annotations: { readOnlyHint: false },
    },
    async (args, extra) => {
      const targetRoot = resolveBoundRoot(args.projectRoot, config.projectRoot);
      if (!targetRoot) {
        return jsonToolError('PATH_UNSAFE', 'projectRoot 超出宿主绑定根目录');
      }
      if (!config.verificationGrant) {
        return jsonToolError('AUTHORIZATION_REQUIRED', '宿主未提供 verificationGrant，拒绝验证执行');
      }
      const checkedPlan = validateIntegrationPlan(args.plan);
      const checkedApply = validateIntegrationApplyResult(args.applyResult);
      const checkedSpec = validateIntegrationVerificationSpec(args.spec);
      if (!checkedPlan.ok || !checkedApply.ok || !checkedSpec.ok) {
        return jsonToolError('INVALID_INPUT', 'plan / applyResult / spec 结构校验失败');
      }

      const planDigest = canonicalDigest(checkedPlan.value);
      const applyResultDigest = canonicalDigest(checkedApply.value);
      const specDigest = canonicalDigest(checkedSpec.value);
      if (
        planDigest !== config.verificationGrant.planDigest ||
        applyResultDigest !== config.verificationGrant.applyResultDigest ||
        specDigest !== config.verificationGrant.specDigest
      ) {
        return jsonToolError('AUTHORIZATION_MISMATCH', '输入摘要与宿主 verificationGrant 不一致');
      }

      try {
        const reqSignal = (extra as { mcpReq?: { signal?: AbortSignal }; signal?: AbortSignal }).mcpReq?.signal
          ?? (extra as { signal?: AbortSignal }).signal;
        const report = await verifyIntegration(targetRoot, checkedPlan.value, {
          applyResult: checkedApply.value,
          spec: checkedSpec.value,
          authorization: config.verificationGrant,
          artifactRoot: config.artifactRoot,
          signal: reqSignal,
        });
        return jsonToolOk(report);
      } catch (err) {
        return jsonToolError('EXECUTION_FAILED', err instanceof Error ? err.message : 'verify_integration 失败');
      }
    },
  );

  return server;
}

export async function runMcpServeCommand(
  args: readonly string[],
  version: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const [sub, ...rest] = args;
  if (sub !== 'serve') {
    return {
      exitCode: 1,
      stdout: '',
      stderr: '用法: component mcp serve --config <absolute-file>\n',
    };
  }
  if (rest.length !== 2 || rest[0] !== '--config' || !rest[1]) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: '参数错误: 必须精确提供 --config <absolute-file>\n',
    };
  }

  let config: McpHostConfig;
  try {
    config = parseMcpHostConfig(rest[1]);
  } catch (err) {
    const msg = sanitizeDiagnosticText(err instanceof Error ? err.message : String(err));
    return { exitCode: 1, stdout: '', stderr: `✖ MCP 启动配置无效: ${msg}\n` };
  }

  const handle = serveStdio(() => createComponentMcpServer(config, version), {
    onerror: error => {
      process.stderr.write(`${sanitizeDiagnosticText(error.message)}\n`);
    },
  });

  await new Promise<void>(resolve => {
    const done = () => {
      void handle.close().catch(() => {}).finally(resolve);
    };
    process.stdin.once('end', done);
    process.stdin.once('close', done);
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });

  return { exitCode: 0, stdout: '', stderr: '' };
}
