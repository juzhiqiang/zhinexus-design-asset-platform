import { describe, expect, it } from 'vitest';
import * as assetsClient from '../../apps/admin/app/lib/assets-client.js';

describe('admin assets-client 预览隔离校验与兼容证据解析', () => {
  it('validateAdminPreviewBootstrapUrl 严格拒绝非 HTTPS、与管理端或 API 同源、或带凭证/非法路径的预览地址', () => {
    const validate = (assetsClient as unknown as {
      validateAdminPreviewBootstrapUrl?: (
        raw: unknown,
        adminLocation: { origin: string; hostname: string; port: string },
        apiOrigin: string,
      ) => { url: string; isolation: 'domain' | 'ip-port' } | null;
    }).validateAdminPreviewBootstrapUrl;

    expect(typeof validate).toBe('function');
    const adminLoc = { origin: 'https://admin.assets.example.com', hostname: 'admin.assets.example.com', port: '' };
    const apiOrigin = 'https://api.assets.example.com';
    const releaseId = '11111111-1111-4111-8111-111111111111';
    const future = new Date(Date.now() + 60_000).toISOString();
    const grantToken = 'g'.repeat(43);

    // 合法独立预览域
    expect(
      validate!(
        { bootstrapUrl: `https://r-${releaseId}.preview.example.com/bootstrap?grant=${grantToken}`, expiresAt: future, mode: 'domain' },
        adminLoc,
        apiOrigin,
      ),
    ).toEqual({
      url: `https://r-${releaseId}.preview.example.com/bootstrap?grant=${grantToken}`,
      isolation: 'domain',
    });

    // 拒绝与管理端同源或与 API 同源
    expect(
      validate!(
        { bootstrapUrl: `https://admin.assets.example.com/bootstrap?grant=${grantToken}`, expiresAt: future, mode: 'domain' },
        adminLoc,
        apiOrigin,
      ),
    ).toBeNull();
    expect(
      validate!(
        { bootstrapUrl: `https://api.assets.example.com/bootstrap?grant=${grantToken}`, expiresAt: future, mode: 'domain' },
        adminLoc,
        apiOrigin,
      ),
    ).toBeNull();

    // 拒绝 HTTP 降级与过期授权
    expect(
      validate!(
        { bootstrapUrl: `http://r-${releaseId}.preview.example.com/bootstrap?grant=${grantToken}`, expiresAt: future, mode: 'domain' },
        adminLoc,
        apiOrigin,
      ),
    ).toBeNull();
    expect(
      validate!(
        { bootstrapUrl: `https://r-${releaseId}.preview.example.com/bootstrap?grant=${grantToken}`, expiresAt: '2020-01-01T00:00:00.000Z', mode: 'domain' },
        adminLoc,
        apiOrigin,
      ),
    ).toBeNull();
  });

  it('parseProbeEvidenceInput 校验 T10 兼容实测证据并提取默认 candidate 三元组', () => {
    const parse = (assetsClient as unknown as {
      parseProbeEvidenceInput?: (jsonText: string) => {
        ok: true;
        candidate: { version: string; integrity: string; source: string };
        evidence: Record<string, unknown>;
      } | { ok: false; message: string };
    }).parseProbeEvidenceInput;

    expect(typeof parse).toBe('function');
    expect(parse!('not json').ok).toBe(false);
    expect(parse!('{"schemaVersion":1}').ok).toBe(false);

    const valid = parse!(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'a-t10-sdk-probe',
        candidate: {
          version: '6.1.0',
          integrity: 'sha512-' + 'A'.repeat(24),
          source: 'https://registry.npmjs.org/echarts/-/echarts-6.1.0.tgz',
        },
        combinations: [],
      }),
    );
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.candidate.version).toBe('6.1.0');
      expect(valid.candidate.source).toBe('https://registry.npmjs.org/echarts/-/echarts-6.1.0.tgz');
    }
  });
});
