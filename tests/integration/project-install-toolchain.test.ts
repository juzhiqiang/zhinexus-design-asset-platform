import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// 将实际产品源码去掉类型后放入仓外安装形态，避免源码模块位置替查找逻辑兜底。
// 子进程与三个版本探针均真实执行；这里只验证工具链定位，不冒充冻结 tarball 验收。
const repository = fileURLToPath(new URL('../../', import.meta.url));
const toolRoot = path.join(repository, '.tools');
const nodeExe = path.join(toolRoot, 'node-v26.13.0-win-x64', 'node.exe');
const npmCli = path.join(toolRoot, 'node-v26.13.0-win-x64', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const pnpmExe = path.join(toolRoot, 'pnpm-native-12.18.0', 'package', 'pnpm.exe');
const require = createRequire(import.meta.url);
const temporaryRoots: string[] = [];

function externalFixture(): { root: string; cwd: string; runner: string; project: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-install-toolchain-'));
  temporaryRoots.push(root);
  const packageRoot = path.join(root, 'installed', 'node_modules', '@company', 'component-cli');
  const moduleRoot = path.join(packageRoot, 'dist', 'integration');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const name of ['install', 'workspace']) {
    const source = path.join(repository, 'packages', 'component-cli', 'src', 'integration', `${name}.ts`);
    fs.writeFileSync(path.join(moduleRoot, `${name}.js`), stripTypeScriptTypes(fs.readFileSync(source, 'utf8')));
  }
  fs.cpSync(path.dirname(require.resolve('yaml/package.json')), path.join(packageRoot, 'node_modules', 'yaml'), { recursive: true });
  const cwd = path.join(root, 'outside-cwd');
  const project = path.join(root, 'target-project');
  fs.mkdirSync(cwd);
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'toolchain-target', private: true }));
  const runner = path.join(root, 'probe.mjs');
  fs.writeFileSync(runner, `
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
const install = await import(pathToFileURL(${JSON.stringify(path.join(moduleRoot, 'install.js'))}).href);
let context;
try {
  if (process.argv[2] === 'context') {
    const projectRoot = ${JSON.stringify(project)};
    context = install.createInstallContext({
      operationId: 'external-toolchain-probe', projectRoot, packageManager: 'npm',
      registryOrigin: 'http://127.0.0.1:4873/', workspace: '.', members: [],
      manifests: [{ relative: 'package.json', manifest: { name: 'toolchain-target', private: true } }],
      lockRelative: 'package-lock.json', exactDependencies: [],
    });
    console.log(JSON.stringify({ ok: true, execPath: process.execPath, cwd: process.cwd(),
      toolchain: context.toolchain, environment: { PATH: context.environment.PATH,
        NODE_OPTIONS: context.environment.NODE_OPTIONS, PNPM_HOME: context.environment.PNPM_HOME },
      stagingRoot: context.stagingRoot, stagedManifest: JSON.parse(fs.readFileSync(path.join(context.stagingRoot, 'package.json'), 'utf8')) }));
  } else {
    console.log(JSON.stringify({ ok: true, execPath: process.execPath, cwd: process.cwd(),
      toolchain: install.resolveToolchain(process.env) }));
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code, message: error.message }));
  process.exitCode = 1;
} finally {
  if (context) install.cleanupInstall(context);
}
`);
  return { root, cwd, runner, project };
}

function runProbe(fixture: ReturnType<typeof externalFixture>, mode: 'resolve' | 'context') {
  // PATH 故意不含 Node/pnpm；进程只能使用产品自己解析出的固定绝对路径。
  const result = spawnSync(nodeExe, [fixture.runner, mode], {
    cwd: fixture.cwd,
    env: {
      ...process.env,
      PATH: path.join(fixture.root, 'unavailable-path'),
      NODE_OPTIONS: '',
      PNPM_HOME: path.join(fixture.root, 'unavailable-pnpm'),
      PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false',
    },
    shell: false, windowsHide: true, encoding: 'utf8', timeout: 90_000,
  });
  expect(result.error, result.stderr).toBeUndefined();
  return { status: result.status, output: JSON.parse(result.stdout.trim()) as Record<string, unknown>, stderr: result.stderr };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^project-install-toolchain-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('仓外安装 CLI 的固定工具链定位', () => {
  it('模块和 cwd 均在仓外时，从真实 process.execPath 定位并真实校验三项固定版本', () => {
    const fixture = externalFixture();
    const result = runProbe(fixture, 'resolve');

    expect(result.output, JSON.stringify(result.output)).toMatchObject({ ok: true, cwd: fixture.cwd, execPath: nodeExe,
      toolchain: { toolRoot, nodeExe, npmCli, pnpmExe, npmVersion: '11.20.0', pnpmVersion: '12.18.0' } });
    expect(result.status).toBe(0);
  }, 120_000);

  it('createInstallContext 的首次路径解析同样支持仓外 cwd，并保持安装环境白名单', () => {
    const fixture = externalFixture();
    const originalManifest = fs.readFileSync(path.join(fixture.project, 'package.json'), 'utf8');
    const result = runProbe(fixture, 'context');

    expect(result.output, JSON.stringify(result.output)).toMatchObject({ ok: true,
      toolchain: { toolRoot, nodeExe, npmCli, pnpmExe, npmVersion: '11.20.0', pnpmVersion: '12.18.0' },
      environment: { PATH: [path.dirname(nodeExe), path.dirname(pnpmExe), path.join(toolRoot, 'bin')].join(path.delimiter) },
      stagedManifest: { name: 'toolchain-target', private: true } });
    expect(result.output['environment']).not.toHaveProperty('NODE_OPTIONS');
    expect(result.output['environment']).not.toHaveProperty('PNPM_HOME');
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(fixture.project, 'package.json'), 'utf8')).toBe(originalManifest);
    expect(fs.existsSync(String(result.output['stagingRoot']))).toBe(false);
  }, 120_000);

  it('已发现的固定工具链产物不完整时失败关闭，不跳到 execPath 的有效工具链', () => {
    const fixture = externalFixture();
    const invalidRoot = path.join(fixture.cwd, '.tools');
    fs.mkdirSync(path.join(invalidRoot, 'node-v26.13.0-win-x64'), { recursive: true });
    fs.mkdirSync(path.join(invalidRoot, 'pnpm-native-12.18.0', 'package'), { recursive: true });

    const result = runProbe(fixture, 'resolve');

    expect(result.status).toBe(1);
    expect(result.output).toMatchObject({ ok: false, code: 'INSTALL_FAILED', message: '固定工具链产物不完整' });
  }, 120_000);
});
