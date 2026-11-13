import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = resolve(process.argv[2] ?? process.cwd());
const apiModule = await import(pathToFileURL(resolve(target, 'apps/gallery/app/lib/uploads/manifest-form.ts')).href);
const { executeWebUploadWorkflow, createSevenComponentsManifest, parseAndValidateImportedManifest } = apiModule;
const results: Array<{ name: string; passed: boolean; detail?: string }> = [];
async function check(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) }); }
}

for (const change of ['same', 'digest', 'api', 'subject'] as const) {
  await check(`failed release retry binding: ${change}`, async () => {
    const { manifest, filesMap } = createSevenComponentsManifest();
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) };
    let creates = 0;
    const submissions: Array<{ session: string; key: string }> = [];
    const api = {
      createUploadSession: async (_url: string, _token: string, mf: typeof manifest) => ({ uploadSessionId: `independent-session-${++creates}`, files: mf.files.map((f: any) => ({ path: f.path, uploadUrl: 'https://upload.invalid/test', expiresAt: new Date(Date.now() + 3600000).toISOString() })) }),
      uploadFileBytes: async () => {},
      completeUploadSession: async () => {},
      submitReleaseJob: async (_url: string, _token: string, session: string, _mf: typeof manifest, key: string) => {
        submissions.push({ session, key });
        if (submissions.length === 1) throw new Error('independent lost response');
        return { jobId: 'independent-job', state: 'PENDING' };
      },
    };
    const options = { apiUrl: 'https://api-one.invalid', subject: 'subject-one', token: 'test-token', manifest, filesMap, storage, api };
    await assert.rejects(executeWebUploadWorkflow(options), /independent lost response/);
    assert.equal(creates, 1);
    assert.equal(storage.getItem('zhinexus_active_session_id'), 'independent-session-1');
    assert.ok(storage.getItem('zhinexus_pending_release'));
    const next = { ...options, manifest: structuredClone(manifest) };
    if (change === 'api') next.apiUrl = 'https://api-two.invalid';
    if (change === 'subject') next.subject = 'subject-two';
    if (change === 'digest') next.manifest.variants[0].examples[0].theme = 'dark';
    await executeWebUploadWorkflow(next);
    assert.equal(creates, change === 'same' ? 1 : 2, 'independent session creation count');
    assert.equal(submissions[1].session, change === 'same' ? 'independent-session-1' : 'independent-session-2');
    if (change === 'same') assert.equal(submissions[1].key, submissions[0].key);
    else assert.notEqual(submissions[1].key, submissions[0].key);
    for (const key of ['zhinexus_active_session_id', 'zhinexus_active_session_plan', 'zhinexus_pending_release', 'zhinexus_upload_draft']) assert.equal(storage.getItem(key), null, `stale key: ${key}`);
    assert.equal(JSON.parse(storage.getItem('zhinexus_web_release_session')!).jobId, 'independent-job');
    await executeWebUploadWorkflow(next);
    assert.equal(creates, change === 'same' ? 2 : 3, 'successful release must not reuse completed session');
  });
}

for (const mutate of ['schema', 'channel', 'reports-shape', 'files-shape', 'path', 'framework'] as const) {
  await check(`reject malformed manifest: ${mutate}`, () => {
    const { manifest } = createSevenComponentsManifest();
    const raw: any = structuredClone(manifest);
    if (mutate === 'schema') raw.schemaVersion = 999;
    if (mutate === 'channel') raw.channel = 'alien';
    if (mutate === 'reports-shape') raw.reports = null;
    if (mutate === 'files-shape') raw.files = [null];
    if (mutate === 'path') raw.variants[0].api.path = '../outside.json';
    if (mutate === 'framework') raw.variants[0].screenshots[0].framework = 'react';
    assert.equal(parseAndValidateImportedManifest(JSON.stringify(raw)).ok, false);
  });
}
for (const kind of ['corrupt-pending', 'expired-before-pending'] as const) {
  try {
    const { manifest, filesMap } = createSevenComponentsManifest();
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
    let creates = 0;
    let releases = 0;
    let uploads = 0;
    const releaseSessions: string[] = [];
    const api = {
      createUploadSession: async (_url: string, _token: string, mf: typeof manifest) => ({ uploadSessionId: `edge-session-${++creates}`, files: mf.files.map((file: any) => ({ path: file.path, uploadUrl: 'https://storage.invalid/test', expiresAt: new Date(Date.now() + 900000).toISOString() })) }),
      uploadFileBytes: async () => { if (++uploads === 1 && kind === 'expired-before-pending') throw new Error('UPLOAD_FAILED'); },
      completeUploadSession: async () => {},
      submitReleaseJob: async (_url: string, _token: string, session: string) => { releases++; releaseSessions.push(session); if (releases === 1 && kind === 'corrupt-pending') throw new Error('LOST_202'); return { jobId: 'edge-job', state: 'PENDING' }; },
    };
    const options = { apiUrl: 'https://edge-api.invalid', subject: 'edge-user', token: 'mock-token', manifest, filesMap, storage, api };
    await assert.rejects(executeWebUploadWorkflow(options), kind === 'corrupt-pending' ? /LOST_202/ : /UPLOAD_FAILED/);
    assert.equal(creates, 1);
    if (kind === 'corrupt-pending') {
      const pending = JSON.parse(storage.getItem('zhinexus_pending_release')!);
      pending.manifestDigest = 'invalid-digest';
      storage.setItem('zhinexus_pending_release', JSON.stringify(pending));
      const savedPending = storage.getItem('zhinexus_pending_release');
      const savedSession = storage.getItem('zhinexus_active_session_id');
      const savedPlan = storage.getItem('zhinexus_active_session_plan');
      await assert.rejects(executeWebUploadWorkflow(options), undefined, 'invalid pending for same session must stop rather than generate a new key');
      assert.equal(releases, 1, 'must not POST another release');
      assert.equal(creates, 1, 'must not replace an uncertain session');
      assert.equal(storage.getItem('zhinexus_pending_release'), savedPending, 'must preserve the original pending key, session and request');
      assert.equal(storage.getItem('zhinexus_active_session_id'), savedSession);
      assert.equal(storage.getItem('zhinexus_active_session_plan'), savedPlan);
    } else {
      assert.equal(storage.getItem('zhinexus_pending_release'), null);
      const plan = JSON.parse(storage.getItem('zhinexus_active_session_plan')!);
      plan.files.forEach((file: any) => { file.expiresAt = new Date(Date.now() - 60000).toISOString(); });
      storage.setItem('zhinexus_active_session_plan', JSON.stringify(plan));
      await executeWebUploadWorkflow(options);
      assert.equal(creates, 2, 'expired upload plan with no pending must create a fresh session');
      assert.equal(releases, 1);
      assert.deepEqual(releaseSessions, ['edge-session-2']);
    }
    results.push({ name: kind, passed: true });
  } catch (error) {
    results.push({ name: kind, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({ kind: 'local workflow diagnostics with mock network; not browser or storage evidence', target, results }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
