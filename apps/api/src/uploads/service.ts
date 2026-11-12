import { randomUUID } from 'node:crypto';
import { UPLOAD_LIMITS, sha256, validateApiMessage, type ApiMessages, type ArtifactRef } from '@company/contracts';
import { Database } from '../db/database.js';
import { audit, uuid, type RequestContext } from '../db/access.js';
import { PlatformError } from '../errors.js';
import { ArtifactStore, type UploadPlan } from '../storage/artifact-store.js';
import { validateUploadedArtifact } from './validator.js';

type UploadFile = { path: string; bytes: string; sha256: string; object_key: string; multipart_id: string | null; part_count: number; frozen_key: string | null };
type Session = { id: string; subject: string; client_id: string; channel: 'cli'|'web'; manifest_digest: string; state: string; fence: string; lease_until: Date | null; expires_at: Date; last_error_code: string | null };

export class UploadService {
  constructor(private readonly db: Database, private readonly store: ArtifactStore) {}
  async create(input: unknown, context: RequestContext): Promise<ApiMessages['createUploadResponse']> {
    const checked = validateApiMessage('createUploadRequest', input);
    if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
    const { files, manifestDigest } = checked.value;
    const paths = new Set(files.map(file => file.path.normalize('NFC').toUpperCase()));
    if (paths.size !== files.length) throw new PlatformError('DUPLICATE_ID');
    if (files.length > UPLOAD_LIMITS.maxFiles || files.reduce((sum, file) => sum + file.bytes, 0) > UPLOAD_LIMITS.totalBytes ||
      files.some(file => file.bytes > (/\.(png|jpe?g)$/i.test(file.path) ? UPLOAD_LIMITS.imageBytes : UPLOAD_LIMITS.tarballBytes))) throw new PlatformError('LIMIT_EXCEEDED');
    const sessionId = randomUUID();
    const planned: { file: ArtifactRef; key: string; plan: UploadPlan }[] = [];
    try {
      for (const file of files) {
        const key = `uploads/${sessionId}/${randomUUID()}`;
        planned.push({ file, key, plan: await this.store.planUpload(key, file.bytes) });
      }
      await this.db.transaction(async client => {
        await client.query("INSERT INTO upload_sessions(id,subject,client_id,channel,manifest_digest,state,expires_at) VALUES ($1,$2,$3,$4,$5,'OPEN',now()+interval '24 hours')", [sessionId, context.principal.subject, context.principal.clientId, context.principal.channel, manifestDigest]);
        for (const { file, key, plan } of planned) await client.query('INSERT INTO upload_files(session_id,path,sha256,bytes,object_key,multipart_id,part_count) VALUES ($1,$2,$3,$4,$5,$6,$7)', [sessionId, file.path, file.sha256, file.bytes, key, plan.multipart?.uploadId ?? null, plan.multipart?.parts.length ?? 1]);
        await audit(client, context.principal.subject, 'UPLOAD_CREATED', sessionId, { fileCount: files.length }, context.requestId);
      });
    } catch (error) {
      await Promise.allSettled(planned.filter(item => item.plan.multipart).map(item => this.store.abortMultipart(item.key, item.plan.multipart!.uploadId)));
      throw error;
    }
    return { uploadSessionId: sessionId, files: planned.map(({ file, plan }) => ({ path: file.path, ...plan })) };
  }
  private async owned(sessionId: string, context: RequestContext): Promise<Session> {
    const session = (await this.db.query<Session>('SELECT * FROM upload_sessions WHERE id=$1', [uuid(sessionId)])).rows[0];
    if (!session) throw new PlatformError('NOT_FOUND');
    if (session.subject !== context.principal.subject || session.client_id !== context.principal.clientId || session.channel !== context.principal.channel) {
      throw new PlatformError('NOT_FOUND', [], true);
    }
    return session;
  }
  private files(sessionId: string) { return this.db.query<UploadFile>('SELECT * FROM upload_files WHERE session_id=$1 ORDER BY path', [sessionId]); }
  async complete(sessionId: string, input: unknown, context: RequestContext): Promise<ApiMessages['completeUploadResponse']> {
    const checked = validateApiMessage('completeUploadRequest', input);
    if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
    await this.owned(sessionId, context);
    const files = (await this.files(sessionId)).rows;
    const verifiedFiles = files.map(file => ({ path: file.path, sha256: file.sha256, bytes: Number(file.bytes) }));
    if (checked.value.parts.some(part => !files.some(file => file.path === part.path && file.multipart_id))) throw new PlatformError('UPLOAD_INCOMPLETE');
    const fence = await this.db.transaction(async client => {
      const row = (await client.query<Session>('SELECT * FROM upload_sessions WHERE id=$1 FOR UPDATE', [sessionId])).rows[0]!;
      if (row.state === 'COMPLETE') return null;
      if (row.expires_at.getTime() <= Date.now()) throw new PlatformError('UPLOAD_INCOMPLETE');
      if (row.state === 'REJECTED') throw new PlatformError('CONFLICT');
      if (row.state === 'VERIFYING' && row.lease_until && row.lease_until.getTime() > Date.now()) throw new PlatformError('CONFLICT');
      const updated = await client.query("UPDATE upload_sessions SET state='VERIFYING',fence=fence+1,lease_until=now()+interval '2 minutes' WHERE id=$1 RETURNING fence", [sessionId]);
      return updated.rows[0].fence as string;
    });
    if (fence === null) return { status: 'complete', verifiedFiles };
    const renew = async () => {
      const updated = await this.db.query("UPDATE upload_sessions SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND fence=$2 AND state='VERIFYING' AND lease_until>now()", [sessionId, fence]);
      if (!updated.rowCount) throw new PlatformError('LEASE_LOST');
    };
    try {
      for (const file of files) {
        await renew();
        if (file.multipart_id) await this.store.completeMultipart(file.object_key, file.multipart_id, checked.value.parts.filter(part => part.path === file.path), Number(file.bytes));
        const bytes = await this.store.read(file.object_key, Number(file.bytes));
        if (await sha256(bytes) !== file.sha256) throw new PlatformError('DIGEST_MISMATCH');
        const artifact = await validateUploadedArtifact(file.path, bytes);
        if (!artifact.ok) throw new PlatformError(artifact.issues[0]?.code ?? 'INVALID_SCHEMA', artifact.issues);
        const frozenKey = `frozen/${sessionId}/${fence}/${randomUUID()}`;
        await this.store.freeze(frozenKey, bytes, artifact.value.mimeType);
        await this.db.transaction(async client => {
          const updated = await client.query("UPDATE upload_sessions SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND fence=$2 AND state='VERIFYING' AND lease_until>now()", [sessionId, fence]);
          if (!updated.rowCount) throw new PlatformError('LEASE_LOST');
          await client.query('UPDATE upload_files SET frozen_key=$3,mime_type=$4,verified_at=now() WHERE session_id=$1 AND path=$2', [sessionId, file.path, frozenKey, artifact.value.mimeType]);
        });
      }
      await this.db.transaction(async client => {
        const updated = await client.query("UPDATE upload_sessions SET state='COMPLETE',lease_until=NULL,last_error_code=NULL WHERE id=$1 AND fence=$2 AND state='VERIFYING' AND lease_until>now()", [sessionId, fence]);
        if (!updated.rowCount) throw new PlatformError('LEASE_LOST');
        await audit(client, context.principal.subject, 'UPLOAD_VERIFIED', sessionId, {}, context.requestId);
      });
      return { status: 'complete', verifiedFiles };
    } catch (error) {
      const code = error instanceof PlatformError ? error.code : 'INFRA_UNAVAILABLE';
      await this.db.query("UPDATE upload_sessions SET state=$3,last_error_code=$4,lease_until=NULL WHERE id=$1 AND fence=$2 AND state='VERIFYING'", [sessionId, fence, ['UPLOAD_INCOMPLETE','INFRA_UNAVAILABLE','LEASE_LOST'].includes(code) ? 'OPEN' : 'REJECTED', code]).catch(() => {});
      throw error;
    }
  }
  async frozen(sessionId: string, context: RequestContext): Promise<{ session: Session; files: Map<string, Uint8Array>; keys: Map<string, string> }> {
    const session = await this.owned(sessionId, context);
    if (session.state !== 'COMPLETE') throw new PlatformError('UPLOAD_INCOMPLETE');
    const files = new Map<string, Uint8Array>();
    const keys = new Map<string, string>();
    for (const file of (await this.files(sessionId)).rows) {
      if (!file.frozen_key) throw new PlatformError('UPLOAD_INCOMPLETE');
      const bytes = await this.store.read(file.frozen_key, Number(file.bytes));
      if (await sha256(bytes) !== file.sha256) throw new PlatformError('DIGEST_MISMATCH');
      files.set(file.path, bytes); keys.set(file.path, file.frozen_key);
    }
    return { session, files, keys };
  }
}
