import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { makeApiFixtures } from './api.js';
import { makeFixture } from './factory.js';

const directory = new URL('./json/', import.meta.url);
const check = process.argv.includes('--check');
const web = makeFixture(); const cli = makeFixture('cli');
const snapshots: Record<string, unknown> = {
  'valid-web': web.manifest, 'valid-cli': cli.manifest, 'reports': cli.reports,
  'api-messages': makeApiFixtures(),
  'synthetic-bytes': Object.fromEntries([...cli.files].map(([path, bytes]) => [path, Buffer.from(bytes).toString('base64')])),
};
const cases: { name: string; code: string }[] = [];
function invalid(name: string, code: string, mutate: (manifest: typeof web.manifest) => void) {
  const manifest = makeFixture().manifest; mutate(manifest); snapshots[name] = manifest; cases.push({ name, code });
}
invalid('missing-screenshot', 'SCREENSHOT_REQUIRED', m => { m.variants[1]!.screenshots = []; });
invalid('wrong-framework', 'SCREENSHOT_VARIANT_MISMATCH', m => { m.variants[2]!.screenshots = [m.variants[0]!.screenshots[0]!]; });
invalid('wrong-digest', 'DIGEST_MISMATCH', m => { m.variants[0]!.screenshots[0]!.packageSha256 = 'a'.repeat(64); });
invalid('forged-source', 'SOURCE_FORBIDDEN', m => { m.variants[0]!.screenshots[0]!.source = 'local-automatic'; });
invalid('conflicting-package', 'CONFLICT', m => { m.packages.push({ ...m.packages[0]!, tarball: { ...m.packages[0]!.tarball, sha256: 'a'.repeat(64) } }); });
invalid('unsafe-path', 'INVALID_PATH', m => { m.files[0]!.path = '../escape.tgz'; });
snapshots['negative-cases'] = cases;
if (!check) await mkdir(directory, { recursive: true });
for (const [name, value] of Object.entries(snapshots)) {
  const file = new URL(`${name}.json`, directory); const json = `${JSON.stringify(value, null, 2)}\n`;
  if (check) { if (await readFile(file, 'utf8') !== json) throw new Error(`Fixture drift: ${name}`); }
  else await writeFile(file, json, 'utf8');
}
console.log(check ? 'G1 fixture snapshots match factories.' : 'Generated synthetic G1 fixture snapshots.');
