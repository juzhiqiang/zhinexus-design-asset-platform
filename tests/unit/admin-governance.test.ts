import { describe, expect, it } from 'vitest';
import { ManagedAccountsService, managedPlatformSubject, type AccountRow } from '../../apps/api/dist/accounts/service.js';
import { CategoryService } from '../../apps/api/dist/categories/service.js';
import { CatalogService } from '../../apps/api/dist/catalog/service.js';
import { makeApiFixtures } from '../fixtures/releases/g1/api.js';

const issuer = 'https://identity.zhinexus.internal:9443/realms/zhinexus';

describe('组件可见性、成员只读授权与视觉基线头查询闭环', () => {
  it('ManagedAccountsService 支持仅 canRead 的组件只读授权：本地先收紧、远端确认后再扩展', async () => {
    const accountId = '6f1d5f8e-7c2b-4b3a-9e11-2c4d5e6f7a8b';
    const subjectId = 'e7b0f1a2-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
    const platformSubject = managedPlatformSubject(issuer, subjectId);
    const currentAccount: AccountRow = {
      id: accountId,
      issuer,
      subject: subjectId,
      platform_subject: platformSubject,
      username: 'reader.chen',
      display_name: '陈读者',
      roles: ['reader'],
      administrator: false,
      enabled: true,
      awaiting_activation: false,
      credentials_set: true,
      credential_uncertain: false,
      sync_state: 'synced',
      remote_user_id: 'kc-reader-1',
      desired_revision: '1',
      access_epoch: '1',
      auth_time_floor: '1000',
      last_sync_error: null,
      created_at: new Date('2026-11-26T00:00:00.000Z'),
      updated_at: new Date('2026-11-26T00:00:00.000Z'),
      version: '1',
    };

    const grantRows: Array<{ component_id: string; can_read: boolean; can_publish: boolean; can_maintain: boolean }> = [];
    const permRows: Array<{ subject: string; component_id: string; can_read: boolean; can_publish: boolean; can_maintain: boolean }> = [];
    let queuedOp: { id: string; account_id: string; kind: string; desired_revision: string; account_version: string; payload: Record<string, unknown>; state: string; attempts: string; fencing_token: string } | null = null;

    const db = {
      query: async (sql: string, values: unknown[] = []) => {
        if (/SELECT generation FROM access_active/u.test(sql) || /FROM access_active WHERE section=\$1/u.test(sql)) {
          return { rows: [{ section: 'oidc', generation: '1' }], rowCount: 1 };
        }
        if (/SELECT \* FROM managed_accounts WHERE id=\$1/u.test(sql)) {
          return { rows: [{ ...currentAccount }], rowCount: 1 };
        }
        if (/UPDATE managed_accounts SET\s+desired_revision/u.test(sql)) {
          currentAccount.desired_revision = String(Number(currentAccount.desired_revision) + 1);
          currentAccount.version = String(Number(currentAccount.version) + 1);
          currentAccount.access_epoch = String(Number(currentAccount.access_epoch) + 1);
          return { rows: [{ ...currentAccount }], rowCount: 1 };
        }
        if (/UPDATE managed_accounts SET\s+access_epoch/u.test(sql)) {
          currentAccount.access_epoch = String(Number(currentAccount.access_epoch) + 1);
          return { rows: [{ ...currentAccount }], rowCount: 1 };
        }
        if (/SELECT component_id,can_read,can_publish,can_maintain FROM managed_account_component_grants/u.test(sql)) {
          return { rows: [...grantRows], rowCount: grantRows.length };
        }
        if (/FROM managed_account_package_grants WHERE account_id=\$1/u.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO identity_operations/u.test(sql)) {
          queuedOp = {
            id: String(values[0]),
            account_id: String(values[1]),
            kind: String(values[2]),
            desired_revision: String(values[3]),
            account_version: String(values[4]),
            payload: JSON.parse(String(values[5])),
            state: 'queued',
            attempts: '0',
            fencing_token: '0',
          };
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO managed_account_component_grants/u.test(sql)) {
          grantRows.push({
            component_id: String(values[1]),
            can_read: Boolean(values[2]),
            can_publish: Boolean(values[3]),
            can_maintain: Boolean(values[4]),
          });
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO component_permissions/u.test(sql)) {
          permRows.push({
            subject: String(values[0]),
            component_id: String(values[1]),
            can_read: Boolean(values[2]),
            can_publish: Boolean(values[3]),
            can_maintain: Boolean(values[4]),
          });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(db),
    };

    const access = {
      options: { administrators: [{ issuer, subject: 'admin-sub' }], outbound: [], apiOrigin: 'https://api.example.com' },
      current: async () => ({ generation: '1' }),
    };
    const identity = {
      createAccount: async () => ({ id: 'kc-reader-1', username: 'reader.chen', enabled: true, roles: ['reader' as const] }),
      updateAccount: async () => ({ id: 'kc-reader-1', username: 'reader.chen', enabled: true, roles: ['reader' as const] }),
      setTemporaryPassword: async () => {},
      revokeSessions: async () => {},
      findByUsername: async () => undefined,
    };

    const service = new ManagedAccountsService(db as never, access as never, { issuer, realm: 'zhinexus' }, identity as never);
    const adminCtx = {
      requestId: 'req-grant-1',
      principal: { issuer, identitySubject: 'admin-sub', subject: 'oidc:admin', clientId: 'web', channel: 'web' as const, roles: ['maintainer' as const], generation: '1' },
    };

    await service.update(accountId, {
      expectedRevision: '1',
      componentGrants: [{ componentId: 'line', canRead: true, canPublish: false, canMaintain: false }],
    }, adminCtx);

    // 远端同步完成前不提前放大权限
    expect(permRows).toHaveLength(0);
    expect(queuedOp).not.toBeNull();

    await service.processOperation(queuedOp! as never);
    expect(grantRows).toEqual([{ component_id: 'line', can_read: true, can_publish: false, can_maintain: false }]);
    expect(permRows).toEqual([{ subject: platformSubject, component_id: 'line', can_read: true, can_publish: false, can_maintain: false }]);

    const detail = await service.detail(accountId, adminCtx);
    expect(detail.componentGrants).toEqual([{ componentId: 'line', canRead: true, canPublish: false, canMaintain: false }]);
  });

  it('CategoryService.updateComponentVisibility 校验维护者权限并记录审计，拒绝无权限成员', async () => {
    let isPublic = false;
    const audits: Array<{ event: string; target: string; data: unknown }> = [];
    const db = {
      query: async (sql: string, values: unknown[] = []) => {
        if (/SELECT generation FROM access_active/u.test(sql)) return { rows: [{ generation: '0' }], rowCount: 1 };
        if (/FROM disabled_subjects/u.test(sql) || /FROM subject_role_restrictions/u.test(sql)) return { rows: [], rowCount: 0 };
        if (/FROM component_permissions WHERE subject=\$1/u.test(sql)) {
          const subject = values[0];
          return subject === 'maintainer-alice' ? { rows: [{ component_id: 'line' }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/SELECT id,category,public FROM components WHERE id=\$1 FOR UPDATE/u.test(sql)) {
          return values[0] === 'line' ? { rows: [{ id: 'line', category: 'charts', public: isPublic }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/UPDATE components SET public=\$2 WHERE id=\$1/u.test(sql)) {
          isPublic = Boolean(values[1]);
          return { rows: [{ componentId: 'line', category: 'charts', isPublic }], rowCount: 1 };
        }
        if (/INSERT INTO audit_events/u.test(sql)) {
          audits.push({ event: String(values[1]), target: String(values[2]), data: JSON.parse(String(values[3])) });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(db),
    };

    const service = new CategoryService(db as never) as CategoryService & {
      updateComponentVisibility: (id: string, body: unknown, ctx: unknown) => Promise<unknown>;
    };

    // 普通 reader 或无 can_maintain 的 publisher 被拒绝
    await expect(
      service.updateComponentVisibility('line', { isPublic: true, reason: '尝试公开' }, {
        requestId: 'r1',
        principal: { subject: 'publisher-bob', roles: ['publisher'], clientId: 'web', channel: 'web', generation: '0' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // 持有 maintainer + can_maintain 的维护者成功公开并记录审计
    const res = await service.updateComponentVisibility('line', { isPublic: true, reason: '通过安全与视觉评审，对外公开' }, {
      requestId: 'r2',
      principal: { subject: 'maintainer-alice', roles: ['maintainer'], clientId: 'web', channel: 'web', generation: '0' },
    });
    expect(res).toEqual({ componentId: 'line', category: 'charts', isPublic: true });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      event: 'COMPONENT_VISIBILITY_UPDATED',
      target: 'line',
      data: { before: false, isPublic: true, reason: '通过安全与视觉评审，对外公开' },
    });
  });

  it('CatalogService.detail 仅在受认证 /v1/me 路径返回 isPublic、deprecatedReason 与 baselineHeads，公开匿名路径不泄漏内部修订', async () => {
    const sample = makeApiFixtures().variantReleaseResponse as { variant: unknown; package: unknown };
    const releaseId = '11111111-1111-4111-8111-111111111111';
    const revisionId = '22222222-2222-4222-8222-222222222222';
    const db = {
      query: async (sql: string) => {
        if (sql.includes('FROM variant_releases vr')) {
          return {
            rowCount: 1,
            rows: [{
              id: releaseId,
              variant_id: 'line-vue',
              component_id: 'line',
              framework: 'vue',
              version: '0.1.0',
              name: '@company/charts-vue',
              metadata: sample.variant,
              package_metadata: sample.package,
              availability: 'DEPRECATED',
              deprecated_reason: '已被 0.2.0 替代',
              is_public: false,
              job_id: '33333333-3333-4333-8333-333333333333',
            }],
          };
        }
        if (sql.includes('FROM screenshots s WHERE s.variant_release_id=$1')) {
          return { rowCount: 1, rows: [{ source: 'local-automatic', accepted: true }] };
        }
        if (/FROM baseline_heads h\s+JOIN baseline_revisions b/u.test(sql)) {
          return {
            rowCount: 1,
            rows: [{ exampleId: 'default', environmentKey: 'a'.repeat(64), revisionId, screenshotId: 'shot-line-vue-default' }],
          };
        }
        if (sql.includes('FROM release_outbox')) {
          return { rowCount: 1, rows: [{ state: 'indexed' }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const catalog = new CatalogService(db as never);
    const pubDetail = await catalog.detail({ releaseId }, null);
    expect(pubDetail).not.toHaveProperty('baselineHeads');
    expect(pubDetail).not.toHaveProperty('isPublic');
    expect(pubDetail).not.toHaveProperty('deprecatedReason');

    const meDetail = await catalog.detail({ releaseId }, 'oidc:alice');
    expect(meDetail).toMatchObject({
      isPublic: false,
      deprecatedReason: '已被 0.2.0 替代',
      baselineHeads: [{ exampleId: 'default', environmentKey: 'a'.repeat(64), revisionId, screenshotId: 'shot-line-vue-default' }],
    });
  });

  it('CategoryService.componentReleaseHistory 按 catalog_can_read 返回 Ready 与 DEPRECATED 历史版本并按版本号降序排列', async () => {
    const db = {
      query: async (sql: string, values: unknown[] = []) => {
        if (/SELECT generation FROM access_active/u.test(sql)) return { rows: [{ generation: '0' }], rowCount: 1 };
        if (/FROM disabled_subjects/u.test(sql) || /FROM subject_role_restrictions/u.test(sql)) return { rows: [], rowCount: 0 };
        if (/SELECT id,category,public FROM components WHERE id=\$1 AND catalog_can_read/u.test(sql)) {
          return values[1] === 'reader-alice' ? { rows: [{ id: 'line', category: 'charts', public: false }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/FROM variant_releases vr/u.test(sql)) {
          return {
            rowCount: 2,
            rows: [
              { id: '11111111-1111-4111-8111-111111111111', variant_id: 'line-vue', framework: 'vue', name: '@company/charts-vue', version: '0.1.0', export_name: 'LineChart', availability: 'DEPRECATED', deprecated_reason: '旧版废弃' },
              { id: '22222222-2222-4222-8222-222222222222', variant_id: 'line-vue', framework: 'vue', name: '@company/charts-vue', version: '0.2.0', export_name: 'LineChart', availability: 'Ready', deprecated_reason: null },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      },
      transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(db),
    };

    const service = new CategoryService(db as never);
    await expect(
      service.componentReleaseHistory('line', {
        requestId: 'r-deny',
        principal: { subject: 'stranger', roles: ['reader'], clientId: 'web', channel: 'web', generation: '0' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const history = await service.componentReleaseHistory('line', {
      requestId: 'r-ok',
      principal: { subject: 'reader-alice', roles: ['reader'], clientId: 'web', channel: 'web', generation: '0' },
    });
    expect(history).toEqual({
      componentId: 'line',
      category: 'charts',
      isPublic: false,
      items: [
        { variantReleaseId: '22222222-2222-4222-8222-222222222222', variantId: 'line-vue', framework: 'vue', packageName: '@company/charts-vue', packageVersion: '0.2.0', exportName: 'LineChart', availability: 'Ready' },
        { variantReleaseId: '11111111-1111-4111-8111-111111111111', variantId: 'line-vue', framework: 'vue', packageName: '@company/charts-vue', packageVersion: '0.1.0', exportName: 'LineChart', availability: 'DEPRECATED', deprecatedReason: '旧版废弃' },
      ],
    });
  });
});
