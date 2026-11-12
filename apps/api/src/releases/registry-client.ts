import * as child_process from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sha256, type PackageRef, type ReleaseManifestV1 } from '@company/contracts';
import { PlatformError } from '../errors.js';

export type RegistryConfig = {
  registryUrl: string;
  publisherUser?: string;
  publisherPassword?: string;
  readerUser?: string;
  readerPassword?: string;
};

export type AvailabilityResult = {
  ok: boolean;
  missing: Array<{ kind: 'package' | 'dependency'; ref: string; reason?: string }>;
};

export class RegistryClient {
  private publisherToken?: string;
  private readerToken?: string;

  constructor(readonly config: RegistryConfig) {}

  private cleanRegistryUrl(): string {
    return this.config.registryUrl.replace(/\/+$/, '');
  }

  async ensureToken(role: 'publisher' | 'reader'): Promise<string> {
    if (role === 'publisher' && this.publisherToken) return this.publisherToken;
    if (role === 'reader' && this.readerToken) return this.readerToken;

    const user =
      role === 'publisher'
        ? this.config.publisherUser ?? 'g2publisher'
        : this.config.readerUser ?? 'g2reader';
    const password =
      role === 'publisher' ? this.config.publisherPassword : this.config.readerPassword;

    if (!password) {
      throw new PlatformError('INFRA_UNAVAILABLE');
    }

    const regUrl = this.cleanRegistryUrl();
    const loginUrl = `${regUrl}/-/user/org.couchdb.user:${encodeURIComponent(user)}`;
    const basicAuth = Buffer.from(`${user}:${password}`).toString('base64');

    const res = await fetch(loginUrl, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        name: user,
        password,
        type: 'user',
        roles: [],
        date: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new PlatformError('INFRA_UNAVAILABLE');
    }

    const data = (await res.json()) as { token?: string };
    if (!data.token) {
      throw new PlatformError('INFRA_UNAVAILABLE');
    }

    if (role === 'publisher') {
      this.publisherToken = data.token;
      return this.publisherToken;
    } else {
      this.readerToken = data.token;
      return this.readerToken;
    }
  }

  async ensurePackage(
    pkg: PackageRef,
    tarballBytes: Uint8Array,
    candidateTag = 'latest',
  ): Promise<{ status: 'published' | 'already-identical'; integrity: string }> {
    const regUrl = this.cleanRegistryUrl();
    const readerToken = await this.ensureToken('reader');

    // 1. 检查注册表中是否已存在该包元数据
    const pkgUrl = `${regUrl}/${encodeURIComponent(pkg.name)}`;
    const getRes = await fetch(pkgUrl, {
      headers: { authorization: `Bearer ${readerToken}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (getRes.status === 200) {
      const doc = (await getRes.json()) as {
        versions?: Record<string, { dist?: { tarball?: string; shasum?: string } }>;
      };

      if (doc.versions && doc.versions[pkg.version]) {
        // 版本已存在：校验 SHA-256
        const versionInfo = doc.versions[pkg.version]!;
        const unscopedName = pkg.name.replace(/^@[^/]+\//, '');
        const candidateUrls = [
          versionInfo.dist?.tarball,
          `${regUrl}/${pkg.name}/-/${unscopedName}-${pkg.version}.tgz`,
          `${regUrl}/${encodeURIComponent(pkg.name)}/-/${path.basename(pkg.tarball.path)}`,
        ].filter(Boolean) as string[];

        let dlRes: Response | null = null;
        for (const url of candidateUrls) {
          try {
            const res = await fetch(url, {
              headers: { authorization: `Bearer ${readerToken}` },
              signal: AbortSignal.timeout(15_000),
            });
            if (res.ok) {
              dlRes = res;
              break;
            }
          } catch {
            // continue
          }
        }

        if (!dlRes || !dlRes.ok) {
          throw new PlatformError('INFRA_UNAVAILABLE');
        }

        const dlBytes = new Uint8Array(await dlRes.arrayBuffer());
        const dlSha256 = await sha256(dlBytes);

        if (dlSha256 === pkg.tarball.sha256) {
          return { status: 'already-identical', integrity: pkg.tarball.sha256 };
        } else {
          // 同名同版本不同内容严禁覆盖
          throw new PlatformError(
            'CONFLICT',
            [{
              code: 'CONFLICT',
              path: `/${pkg.name}@${pkg.version}`,
              message: `同名同版本不同内容严禁覆盖发布: ${pkg.name}@${pkg.version} downloaded sha256=${dlSha256} but tarball has sha256=${pkg.tarball.sha256}`,
            }],
          );
        }
      }
    } else if (getRes.status !== 404) {
      throw new PlatformError('INFRA_UNAVAILABLE');
    }

    // 2. 版本未发布：使用 publisherToken 经由 npm publish 发布该冻结 tarball
    const publisherToken = await this.ensureToken('publisher');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-pkg-pub-'));
    try {
      const tarballFileName = path.basename(pkg.tarball.path);
      const tempTarballPath = path.join(tmpDir, tarballFileName);
      await fs.promises.writeFile(tempTarballPath, tarballBytes);

      const parsedUrl = new URL(regUrl);
      const hostPart = `${parsedUrl.hostname}:${parsedUrl.port}`;
      const npmrcContent = `registry=${regUrl}/\n//${hostPart}/:_authToken=${publisherToken}\naudit=false\nfund=false\n`;
      const npmrcPath = path.join(tmpDir, '.npmrc');
      await fs.promises.writeFile(npmrcPath, npmrcContent, 'utf8');

      const isWin = process.platform === 'win32';
      const publishArgs = [
        'publish',
        tempTarballPath,
        '--userconfig',
        npmrcPath,
        '--registry',
        regUrl,
        '--tag',
        candidateTag,
      ];

      const pubProcess = child_process.spawnSync(isWin ? 'npm.cmd' : 'npm', publishArgs, {
        cwd: tmpDir,
        encoding: 'utf8',
        shell: isWin,
        env: { ...process.env },
        maxBuffer: 16 * 1024 * 1024,
      });

      if (pubProcess.status !== 0) {
        throw new PlatformError('INFRA_UNAVAILABLE');
      }

      return { status: 'published', integrity: pkg.tarball.sha256 };
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  async promoteDistTag(pkgName: string, version: string, tag = 'latest'): Promise<void> {
    const regUrl = this.cleanRegistryUrl();
    const publisherToken = await this.ensureToken('publisher');
    const tagUrl = `${regUrl}/-/package/${encodeURIComponent(pkgName)}/dist-tags/${encodeURIComponent(tag)}`;

    const res = await fetch(tagUrl, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${publisherToken}`,
      },
      body: JSON.stringify(version),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new PlatformError('INFRA_UNAVAILABLE');
    }
  }

  async checkAvailability(manifest: ReleaseManifestV1): Promise<AvailabilityResult> {
    const regUrl = this.cleanRegistryUrl();
    const readerToken = await this.ensureToken('reader');
    const missing: AvailabilityResult['missing'] = [];

    // 拓扑顺序校验：若包含框架包，则 charts-core 必须先于其可达
    const hasCore = manifest.packages.some((p) => p.name === '@company/charts-core');
    const frameworkPkgs = manifest.packages.filter((p) =>
      ['@company/charts-vue', '@company/charts-react'].includes(p.name),
    );

    for (const pkg of manifest.packages) {
      const versionUrl = `${regUrl}/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
      const res = await fetch(versionUrl, {
        headers: { authorization: `Bearer ${readerToken}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status !== 200) {
        missing.push({
          kind: 'package',
          ref: `${pkg.name}@${pkg.version}`,
          reason: `Version query returned ${res.status}`,
        });
      }
    }

    if (hasCore && frameworkPkgs.length > 0) {
      // 检查 core 是否能成功被依赖解析
      const corePkg = manifest.packages.find((p) => p.name === '@company/charts-core')!;
      const coreUrl = `${regUrl}/${encodeURIComponent(corePkg.name)}/${encodeURIComponent(corePkg.version)}`;
      const coreRes = await fetch(coreUrl, {
        headers: { authorization: `Bearer ${readerToken}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (coreRes.status !== 200) {
        missing.push({
          kind: 'dependency',
          ref: `${corePkg.name}@${corePkg.version}`,
          reason: 'charts-core must be available before framework packages become Ready',
        });
      }
    }

    return {
      ok: missing.length === 0,
      missing,
    };
  }
}
