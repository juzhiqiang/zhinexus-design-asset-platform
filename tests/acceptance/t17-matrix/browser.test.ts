import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareVisual, startStaticServer } from './browser.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 't17-browser-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('T17 浏览器与视觉边界', () => {
  const visualInput = (overrides: Partial<Parameters<typeof compareVisual>[0]> = {}): Parameters<typeof compareVisual>[0] => ({
    screenshot: { bytes: 10, sha256: 'a'.repeat(64), width: 20, height: 10, diffPixelRatio: 0 },
    baseline: { bytes: 10, sha256: 'a'.repeat(64), width: 20, height: 10, environmentKey: 'env-current' },
    environment: { width: 20, height: 10, renderer: 'canvas', theme: 'light', environmentKey: 'env-current' },
    ...overrides,
  });

  it('environment key differs 时不可按相同截图字节判通过', () => {
    const input = visualInput({
      baseline: { bytes: 10, sha256: 'a'.repeat(64), width: 20, height: 10, environmentKey: 'env-old' },
    });
    expect(compareVisual(input)).toBe('INCOMPATIBLE');
  });

  it('缺失、非有限或越界像素差异指标时失败关闭', () => {
    for (const diffPixelRatio of [undefined, Number.NaN, -0.01, 1.01]) {
      expect(compareVisual(visualInput({
        screenshot: { bytes: 10, sha256: 'a'.repeat(64), width: 20, height: 10, diffPixelRatio },
      }))).toBe('INCOMPATIBLE');
    }
  });

  it('loopback server 绑定在 127.0.0.1 且保留二进制资源原始字节', async () => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    await mkdir(dist);
    const bytes = Buffer.from([0, 255, 128, 13, 10, 42]);
    await writeFile(path.join(dist, 'asset.map'), bytes);

    const running = await startStaticServer(dist);
    try {
      expect(running.server.address()).toMatchObject({ address: '127.0.0.1' });
      const response = await fetch(new URL('/asset.map', running.origin));
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    } finally {
      await running.close();
    }
  });

  it('拒绝通过 dist 内的目录链接读取外部资源', async () => {
    const root = await tempRoot();
    const dist = path.join(root, 'dist');
    const external = path.join(root, 'external');
    await mkdir(dist);
    await mkdir(external);
    await writeFile(path.join(external, 'secret.js'), 'secret');
    await symlink(external, path.join(dist, 'linked'), 'junction');

    const running = await startStaticServer(dist);
    try {
      const response = await fetch(new URL('/linked/secret.js', running.origin));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('not found');
    } finally {
      await running.close();
    }
  });
});
