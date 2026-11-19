import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { installFrozenCli, mcpClient, recordCaseEvidence, sha256, snapshotTree } from './support.mjs';

const temporaryDirectories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 't17-blackbox-support-'));
  temporaryDirectories.push(directory);
  return directory;
}
function tarEntry(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  header.write('0000000\0', 136, 8, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(padded);
  return Buffer.concat([header, padded]);
}
function frozenTarball(bin = Buffer.from('frozen entry')): Buffer {
  const manifest = Buffer.from(JSON.stringify({ name: '@company/component-cli', version: '0.0.14', bin: { component: './dist/bin.js' } }));
  return gzipSync(Buffer.concat([tarEntry('package/package.json', manifest), tarEntry('package/dist/bin.js', bin), Buffer.alloc(1024)]));
}
function installedPackageSource(name: string, version: string, bin = 'frozen entry'): string {
  return [
    "const fs=require('node:fs');const path=require('node:path');",
    "const pkg=path.join(process.cwd(),'node_modules/@company/component-cli');fs.mkdirSync(path.join(pkg,'dist'),{recursive:true});",
    `fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:${JSON.stringify(name)},version:${JSON.stringify(version)},bin:{component:'./dist/bin.js'}}));`,
    `fs.writeFileSync(path.join(pkg,'dist/bin.js'),${JSON.stringify(bin)});`,
  ].join('');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('T17 black-box support', () => {
  it.each([
    { label: 'package name', installedName: '@company/not-cli', installedVersion: '0.0.14', expectedVersion: '0.0.14', error: /name|identity/i },
    { label: 'package version', installedName: '@company/component-cli', installedVersion: '0.0.13', expectedVersion: '0.0.14', error: /version|identity/i },
  ])('rejects an installed package with a mismatched frozen $label', async ({ installedName, installedVersion, expectedVersion, error: expectedError }) => {
    const area = await temporaryDirectory();
    const tarball = join(area, 'cli.tgz');
    const fakeNpm = join(area, 'fake-npm.cjs');
    await writeFile(tarball, frozenTarball());
    await writeFile(fakeNpm, installedPackageSource(installedName, installedVersion));

    await expect(installFrozenCli({ area, tarball, node: process.execPath, npmCli: fakeNpm, expectedVersion }))
      .rejects.toThrow(expectedError);
    const installEvidence = JSON.parse(await readFile(join(area, 'frozen-cli-install.json'), 'utf8'));
    expect(installEvidence.code).toBe(0);
  });

  it('detects changes to the installed entry point after the frozen tarball was installed', async () => {
    const area = await temporaryDirectory();
    const tarball = join(area, 'cli.tgz');
    const fakeNpm = join(area, 'fake-npm.cjs');
    await writeFile(tarball, frozenTarball());
    await writeFile(fakeNpm, installedPackageSource('@company/component-cli', '0.0.14'));
    const installed = await installFrozenCli({ area, tarball, node: process.execPath, npmCli: fakeNpm, expectedVersion: '0.0.14' });
    await writeFile(installed.bin, 'changed entry');

    await expect(installed.assertUnchanged()).rejects.toThrow(/已安装.*dist\/bin\.js|entry point/i);
  });

  it('rejects an installed bin that differs from the frozen tarball entry', async () => {
    const area = await temporaryDirectory();
    const tarball = join(area, 'cli.tgz');
    const fakeNpm = join(area, 'fake-npm.cjs');
    await writeFile(tarball, frozenTarball());
    await writeFile(fakeNpm, installedPackageSource('@company/component-cli', '0.0.14', 'different entry'));

    await expect(installFrozenCli({ area, tarball, node: process.execPath, npmCli: fakeNpm, expectedVersion: '0.0.14' }))
      .rejects.toThrow(/tarball.*dist\/bin\.js|安装入口/i);
  });

  it('writes a canonical case receipt only when evidence contains no supplied secret', async () => {
    const area = await temporaryDirectory();
    const receipt = await recordCaseEvidence({
      area, caseId: 'D01-verify-positive', kind: 'positive', value: { synthetic: true, status: 'passed' },
      secrets: ['SYNTHETIC_SECRET_123'],
    });
    expect(receipt.caseId).toBe('D01-verify-positive');
    expect(receipt.kind).toBe('positive');
    const evidence = await readFile(receipt.evidencePath);
    expect(evidence.toString('utf8')).toBe('{"status":"passed","synthetic":true}\n');
    expect(sha256(evidence)).toBe(receipt.sha256);
    expect(receipt.bytes).toBe(evidence.length);
    await expect(recordCaseEvidence({
      area, caseId: 'D01-verify-positive', kind: 'positive', value: { status: 'overwritten', synthetic: true },
    })).rejects.toThrow();
    expect((await readFile(receipt.evidencePath)).toString('utf8')).toBe('{"status":"passed","synthetic":true}\n');

    await expect(recordCaseEvidence({
      area, caseId: 'D02-secret-refusal', kind: 'refusal', value: { diagnostic: 'SYNTHETIC_SECRET_123' },
      secrets: ['SYNTHETIC_SECRET_123'],
    })).rejects.toThrow(/secret|sensitive/i);
  });

  it('snapshots a directory link without traversing its target', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await mkdir(join(outside, 'private'));
    await writeFile(join(outside, 'private', 'secret.txt'), 'outside');
    await symlink(outside, join(root, 'linked'), 'junction');

    const snapshot = await snapshotTree(root);

    expect(snapshot.linked).toMatch(/^link:/);
    expect(Object.keys(snapshot)).not.toContain('linked/private/secret.txt');
  });

  it('closes a real stdio child after a JSON-RPC response', async () => {
    const childProgram = [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { input += chunk; let newline; while ((newline = input.indexOf('\\n')) >= 0) { const line = input.slice(0, newline); input = input.slice(newline + 1); const request = JSON.parse(line); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { method: request.method } }) + '\\n'); } });",
    ].join('');
    const client = mcpClient({ command: process.execPath, args: ['-e', childProgram], cwd: process.cwd() });
    let closed: Awaited<ReturnType<typeof client.close>> | undefined;
    try {
      const response = await client.request('ping');
      expect(response.result).toEqual({ method: 'ping' });
    } finally {
      closed = await client.close();
    }

    expect(closed?.exited).toBe(true);
    expect(closed?.exitInfo?.code).toBe(0);
    expect(closed?.protocolViolations).toEqual([]);
    expect(closed?.trailing).toBe('');
  });
});
