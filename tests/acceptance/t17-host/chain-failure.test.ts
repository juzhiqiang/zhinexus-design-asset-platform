import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { componentMatchResponseFixture } from '../../fixtures/component-match.js';
import { validIntegrationPlanFixture } from '../../fixtures/integration-plan.js';
import * as host from './host.js';
import * as runtime from './runtime.js';
import * as config from './e2e-config.js';
import { runT17HostAcceptanceChain } from './chain.js';

describe('T17 actual chain failure cleanup', () => {
  it.each(['plan', 'apply'] as const)('retains partial %s evidence and removes owned projects', async stage => {
    let owned: host.OwnedRun | undefined;
    const response = componentMatchResponseFixture('vue'), target = response.target!;
    vi.spyOn(config, 'loadT17HostInputs').mockResolvedValue({
      cliTarball: 'fixture.tgz', cliSha256: 'a'.repeat(64), cliVersion: '0.0.19',
      sdkBundle: 'fixture-sdk', sdkManifestSha256: 'b'.repeat(64),
      apiUrl: 'http://127.0.0.1:4300', registryUrl: 'http://127.0.0.1:4873',
      variantsFile: 'fixture-variants.json', variantsSha256: 'c'.repeat(64),
      apiToken: 'fixture-api-token', registryToken: 'fixture-registry-token',
      variants: { schemaVersion: 1, variants: [{ componentId: target.componentId, framework: 'vue', variantReleaseId: target.variantReleaseId }] },
      validatedCompatibility: {},
      sdkManifest: { schemaVersion: 1, files: [], packages: [{ name: target.packageName, version: target.packageVersion, tarball: { sha256: target.packageSha256 } }],
        variants: [{ componentId: target.componentId, framework: 'vue', packageName: target.packageName, packageVersion: target.packageVersion, exportName: target.exportName, exportPath: target.exportPath }] },
    } as config.T17HostInputs);
    vi.spyOn(host, 'installFrozenCli').mockImplementation(async options => {
      owned = options.run;
      const root = await owned.makeOwnedProject('fixture-cli');
      return { root, entry: join(root, 'index.js'), entrySha256: 'd'.repeat(64), version: options.expectedVersion, tarballSha256: options.expectedTarballSha256!, tarballBytes: 1, manifestSha256: 'e'.repeat(64), installOutputBytes: 0 };
    });
    vi.spyOn(runtime, 'installDependencies').mockResolvedValue({ manager: 'npm', executable: process.execPath, args: [], cwd: '.', exitCode: 0, stdoutSha256: 'f'.repeat(64), stderrSha256: 'f'.repeat(64), stdoutBytes: 0, stderrBytes: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })));
    vi.spyOn(runtime, 'runFrozenCli').mockImplementation(async (run, options) => {
      const command = options.args![1]!, failing = command === stage;
      const out = await run.writeEvidence(command + '.stdout', Buffer.from(failing ? '' : JSON.stringify(validIntegrationPlanFixture())));
      const err = await run.writeEvidence(command + '.stderr', Buffer.from(failing ? 'controlled ' + stage + ' failure' : ''));
      return { executable: process.execPath, args: options.args!, cwd: options.projectRoot, exitCode: failing ? 1 : 0, timedOut: false, stdoutBytes: out.bytes, stderrBytes: err.bytes, stdoutSha256: out.sha256, stderrSha256: err.sha256, stdoutEvidence: out.path, stderrEvidence: err.path };
    });
    try {
      await expect(runT17HostAcceptanceChain({ env: {}, repositoryRoot: process.cwd() })).rejects.toThrow(new RegExp('integrate ' + stage + ' failed'));
      expect(owned).toBeDefined();
      // Actual native OwnedRun registration, failure handling and filesystem cleanup.
      await expect(lstat(owned!.parentRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(owned!.evidenceRoot, 't17-vue-work', 'match.json'), 'utf8')).toContain('schemaVersion');
      if (stage === 'apply') expect(await readFile(join(owned!.evidenceRoot, 't17-vue-work', 'plan.json'), 'utf8')).toContain('planned');
      expect(await readFile(join(owned!.evidenceRoot, 'files', stage + '.stderr'), 'utf8')).toBe('controlled ' + stage + ' failure');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      if (owned) {
        // Also clean the intentional RED run without discarding retained inventory checks.
        if (await lstat(owned.parentRoot).then(() => true, () => false)) {
          for (const name of ['t17-vue-work', 't17-vue-backups', 't17-vue-verify-out']) {
            const area = join(owned.evidenceRoot, name);
            const entries = await readdir(area).catch(() => undefined);
            if (entries?.length) await owned.registerEvidenceAreaContents(area, entries);
          }
          await owned.abortForTest({ preserveEvidence: true });
        }
        await rm(owned.evidenceRoot, { recursive: true, force: true });
      }
    }
  });
});
