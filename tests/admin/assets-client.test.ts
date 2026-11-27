import { describe, expect, it } from 'vitest';
import { parseProbeEvidenceInput, validateAdminPreviewBootstrapUrl } from '../../apps/admin/app/lib/assets-client.js';

describe('admin assets-client 预览隔离校验与兼容证据解析', () => {
  it('validateAdminPreviewBootstrapUrl 严格拒绝非 HTTPS、与管理端或 API 同源、或带凭证/非法路径的预览地址', () => {
    const adminLoc = { origin: 'https://admin.assets.example.com', hostname: 'admin.assets.example.com', port: '' };
    const apiOrigin = 'https://api.assets.example.com';
    const releaseId = '11111111-1111-4111-8111-111111111111';
    const future = new Date(Date.now() + 60_000).toISOString();
    const grantToken = 'g'.repeat(43);

    // 合法独立预览域
    expect(
      validateAdminPreviewBootstrapUrl(
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
      validateAdminPreviewBootstrapUrl(
        { bootstrapUrl: `https://admin.assets.example.com/bootstrap?grant=${grantToken}`, expiresAt: future, mode: 'domain' },
        adminLoc,
        apiOrigin,
      ),
    ).toBeNull();
    expect(
      validateAdminPreviewBootstrapUrl(
        { bootstrapUrl: `https://api.assets.example.com/bootstrap?grant=${grantToken}`, expiresAt: future, mode: 'domain' },
        adminLoc,
        apiOrigin,
      ),
    ).toBeNull();

    // 拒绝 HTTP 降级与过期授权
    expect(
      validateAdminPreviewBootstrapUrl(
        { bootstrapUrl: `http://r-${releaseId}.preview.example.com/bootstrap?grant=${grantToken}`, expiresAt: future, mode: 'domain' },
        adminLoc,
        apiOrigin,
      ),
    ).toBeNull();
    expect(
      validateAdminPreviewBootstrapUrl(
        { bootstrapUrl: `https://r-${releaseId}.preview.example.com/bootstrap?grant=${grantToken}`, expiresAt: '2020-01-01T00:00:00.000Z', mode: 'domain' },
        adminLoc,
        apiOrigin,
      ),
    ).toBeNull();

    // 本地回环 HTTP 开发环境允许同机不同端口的 ip-port 预览，但 HTTPS 环境仍严格拒绝
    expect(
      validateAdminPreviewBootstrapUrl(
        { bootstrapUrl: `http://127.0.0.1:3001/bootstrap?grant=${grantToken}`, expiresAt: future, mode: 'ip-port' },
        { origin: 'http://127.0.0.1:5177', hostname: '127.0.0.1', port: '5177' },
        'http://127.0.0.1:3000',
      ),
    ).toEqual({
      url: `http://127.0.0.1:3001/bootstrap?grant=${grantToken}`,
      isolation: 'ip-port',
    });
    expect(
      validateAdminPreviewBootstrapUrl(
        { bootstrapUrl: `http://127.0.0.1:3001/bootstrap?grant=${grantToken}`, expiresAt: future, mode: 'ip-port' },
        { origin: 'https://127.0.0.1:5177', hostname: '127.0.0.1', port: '5177' },
        'https://127.0.0.1:3000',
      ),
    ).toBeNull();
  });

  it('parseProbeEvidenceInput 校验 T10 兼容实测证据并提取默认 candidate 三元组', () => {
    expect(parseProbeEvidenceInput('not json').ok).toBe(false);
    expect(parseProbeEvidenceInput('{"schemaVersion":1}').ok).toBe(false);

    const valid = parseProbeEvidenceInput(
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
