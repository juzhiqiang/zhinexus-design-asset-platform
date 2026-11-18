// tests/acceptance/t16-d/installed-plan.mjs — D 独立黑盒：integrate plan 阶段（apply/报告/rollback 另交）
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { deepStrictEqual } from 'node:assert';
import { setup } from './installed-support.mjs';

const must = (c, m) => { if (!c) throw new Error(`installed-plan: ${m}`); };
const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
const setJson = (a) => JSON.stringify([...new Set(a)].sort());

export async function prepare() {
  const s = await setup();
  await mkdir(s.backupRoot, { recursive: true });
  const backupBefore = await s.snapshot(s.backupRoot);
  const matchRaw = typeof s.match === 'string' ? s.match : JSON.stringify(s.match);
  const match = JSON.parse(matchRaw);
  must(match.schemaVersion === 1, 'match.schemaVersion 非 1');
  must(match.context?.framework === 'vue', 'match.context.framework 非 vue');
  must(Array.isArray(match.elements) && match.elements.every((e) => e && e.status === 'mapped'), 'match.elements 未全部 mapped');
  must(Array.isArray(match.gaps) && match.gaps.length === 0, 'match.gaps 非空');
  const matchFile = join(s.area, 'match.json');
  await writeFile(matchFile, matchRaw, 'utf8');
  const { code, json: plan } = await s.cli(['plan', '--project', s.root, '--match', matchFile, '--api-url', s.api, '--registry', s.registry], 'plan');
  must(code === 0, `plan 退出码 ${code}`);
  must(plan?.schemaVersion === 1, 'plan.schemaVersion 非 1');
  must(plan.stage === 'plan', 'plan.stage 非 plan');
  must(plan.status === 'planned', 'plan.status 非 planned');
  must(plan.executionAuthorized === false, 'plan.executionAuthorized 非 false');
  must(Array.isArray(plan.conflicts) && plan.conflicts.length === 0, 'plan.conflicts 非空');
  must(Array.isArray(plan.sourceMatchPlan?.gaps) && plan.sourceMatchPlan.gaps.length === 0, 'plan.sourceMatchPlan.gaps 非空');
  const changes = Array.isArray(plan.changes) ? plan.changes : [];
  const kinds = new Set(changes.map((c) => c && c.kind));
  must(kinds.size === 3 && ['package-json', 'lockfile-regeneration', 'generated-component'].every((k) => kinds.has(k)), 'changes kinds 集合不恰为 package-json/lockfile-regeneration/generated-component');
  const changePaths = changes.map((c) => c && c.path);
  must(setJson(Array.isArray(plan.allowedPaths) ? plan.allowedPaths : []) === setJson(changePaths), 'plan.allowedPaths 不恰为 changes 路径集合');
  must(changePaths.includes('package.json') && changePaths.includes('package-lock.json'), 'changes 未同时包含 package.json 与 package-lock.json');
  await writeFile(s.planFile, JSON.stringify(plan, null, 2), 'utf8');
  const planDigest = createHash('sha256').update(JSON.stringify(sorted(plan)), 'utf8').digest('hex');
  deepStrictEqual(await s.snapshot(s.root, {excludeRootNodeModules:true}), s.sourceBefore, 'installed-plan: source 快照与 sourceBefore 不严格相等');
  deepStrictEqual(await s.snapshot(s.backupRoot), backupBefore, 'installed-plan: backup 快照与 backupBefore 不严格相等');
  return { s, plan, planDigest, backupBefore };
}
