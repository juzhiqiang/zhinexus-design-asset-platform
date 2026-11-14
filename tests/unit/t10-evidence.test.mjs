import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalJson, environmentKey, environmentProjection } from '@company/contracts';
import { createOwnedRoot, validateOwnedConsumers } from '../../scripts/t10-consumer-ownership.mjs';

const auditScript = fileURLToPath(new URL('../../scripts/audit-t10-evidence.mjs', import.meta.url));
const ownershipScript = new URL('../../scripts/t10-consumer-ownership.mjs', import.meta.url);
const components = ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'];
const presentations = ['light-canvas', 'dark-canvas', 'light-svg', 'dark-svg'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// These fixtures never install packages or open a browser. Only directories created
// by this test are removed; report-controlled paths never reach a real deletion.
async function temporaryFixture(t) {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 't10-evidence-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function evidenceFixture(t, recommendation = 'adopt') {
  const root = await temporaryFixture(t);
  const screenshotFile = path.join(root, 'fixture.png');
  const screenshotBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  );
  await writeFile(screenshotFile, screenshotBytes);
  const font = {
    stack: 'system-ui, sans-serif',
    families: [
      { family: 'sans-serif', available: true, advances: [210.12345, 320.56789, 52.1111] },
      { family: 'serif', available: true, advances: [220.12345, 320.56789, 51.1111] },
      { family: 'monospace', available: true, advances: [230.12345, 320.56789, 53.1111] },
    ],
    loadedFonts: [],
  };
  const fontCanonical = canonicalJson({
    kind: 'font-fingerprint-v1',
    stack: font.stack,
    families: font.families.map(family => ({
      ...family,
      advances: family.advances.map(advance => Math.round(advance * 1000) / 1000),
    })),
    loadedFonts: [],
  });
  const fontDigest = sha256(fontCanonical);
  const report = {
    kind: 'a-t10-sdk-probe',
    probe: {
      platform: 'windows', node: 'v26.13.0', browserRevision: '1254',
      fontDigestSource: 'measured', fontDigest,
    },
    candidate: { version: '6.1.0', integrityVerified: true },
    policy: { candidateIntegrityVerified: true, hasDualFrameworkCoverage: true },
    recommendation,
    uncovered: recommendation === 'adopt' ? [] : ['视觉基线未确认：NEW'],
    combinations: [],
  };
  for (const [framework, frameworkVersion] of [['vue', '3.5.45'], ['react', '19.3.1']]) {
    const combination = {
      framework, frameworkVersion, echartsVersion: report.candidate.version,
      consumer: { peerMode: 'strict' },
      dimensions: {
        typecheck: 'passed', runtime: 'passed', interaction: 'passed',
        visual: recommendation === 'adopt' ? 'passed' : 'not-run',
      },
      failures: [],
      evidence: {
        typecheck: [{ resolution: 'Bundler', exitCode: 0 }, { resolution: 'NodeNext', exitCode: 0 }],
        build: { exitCode: 0 },
        ssrImport: { exitCode: 0, windowDefined: false, documentDefined: false },
        lifecycle: { status: 'passed' },
        browser: [], visual: [],
      },
    };
    for (const component of components) {
      for (const presentation of presentations) {
        const [theme, renderer] = presentation.split('-');
        const environment = {
          os: 'windows', arch: 'x64', browserVersion: '144.0.0.0', browserRevision: '1254',
          fontDigest, locale: 'zh-CN', timezone: 'Asia/Shanghai', deviceScaleFactor: 1,
          renderer, width: 1, height: 1, theme, frameworkVersion, echartsVersion: report.candidate.version,
        };
        combination.evidence.browser.push({
          component, presentation, environment, environmentKey: await environmentKey(environment),
          environmentAudit: {
            projection: environmentProjection(environment),
            canonical: canonicalJson(environmentProjection(environment)), fontDigest,
            fontFingerprint: { ...font, fontDigest, canonical: fontCanonical },
          },
          hostCount: 1, pageErrors: [],
          checks: ['mounted', 'data', 'resize', 'events'].map(name => ({ name, status: 'passed' })),
          clickError: null,
          click: [{ seriesId: 'fixture', dataIndex: 0, value: [0, 1], nativeType: 'click' }],
          screenshot: { file: screenshotFile, bytes: screenshotBytes.length, sha256: sha256(screenshotBytes) },
        });
        combination.evidence.visual.push({
          component, presentation, result: recommendation === 'adopt' ? 'PASS' : 'NEW',
        });
        if (recommendation === 'hold') {
          combination.failures.push({ dimension: 'visual', reason: `${component}/${presentation}: NEW` });
        }
      }
    }
    report.combinations.push(combination);
  }
  return { root, report };
}

async function audit(fixture, recommendation = 'adopt') {
  const reportFile = path.join(fixture.root, 'evidence.json');
  await writeFile(reportFile, `${JSON.stringify(fixture.report)}\n`);
  return spawnSync(process.execPath, [auditScript, reportFile, recommendation, '56'], {
    encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 1024 * 1024,
  });
}

for (const recommendation of ['adopt', 'hold']) {
  test(`audit accepts a complete 56-run ${recommendation} control`, async t => {
    const result = await audit(await evidenceFixture(t, recommendation), recommendation);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.auditedRuns, 56);
    assert.equal(summary.environmentKeysRecomputed, 56);
    assert.equal(summary.screenshotDigestsChecked, 56);
    assert.equal(summary.recommendation, recommendation);
  });
}

const invalidEvidence = [
  ['nonempty failures on an adopt report', report => {
    report.combinations[0].failures.push({ dimension: 'runtime', reason: 'fixture failure' });
  }],
  ['an empty dimensions object', report => { report.combinations[0].dimensions = {}; }],
  ['an additional failing NodeNext typecheck', report => {
    report.combinations[0].evidence.typecheck.push({ resolution: 'NodeNext', exitCode: 1 });
  }],
  ['empty browser self-checks', report => { report.combinations[0].evidence.browser[0].checks = []; }],
  ['an empty click collection', report => { report.combinations[0].evidence.browser[0].click = []; }],
  ['a visual DIFF on an adopt report', report => { report.combinations[0].evidence.visual[0].result = 'DIFF'; }],
];

for (const [name, mutate] of invalidEvidence) {
  test(`audit rejects ${name}`, async t => {
    const fixture = await evidenceFixture(t);
    mutate(fixture.report);
    const result = await audit(fixture);
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    assert.match(result.stderr, /AssertionError/);
    assert.equal(result.stdout, '');
  });
}

async function ownershipFixture(t) {
  const root = await temporaryFixture(t);
  const repoRoot = path.join(root, 'fixture-repository');
  await mkdir(repoRoot);
  const ownerFile = path.join(root, 'owner.json');
  const owner = await createOwnedRoot(ownerFile, repoRoot);
  // Capture the created path before an attack mutates its report/marker data.
  const externalBase = owner.externalBase;
  const links = [];
  t.after(async () => {
    for (const link of links.reverse()) await unlink(link);
    await rm(externalBase, { recursive: true, force: true });
  });
  await mkdir(owner.consumerRoot);
  const report = {
    probe: { command: [process.execPath, 'fixture-probe.mjs', '--consumer-root', owner.consumerRoot, '--keep'] },
    combinations: [],
  };
  for (const framework of ['vue', 'react']) {
    const staging = path.join(owner.consumerRoot, `a-t10-staging-${framework}`);
    const consumerRoot = path.join(staging, `a-t10-consumer-${framework}`);
    await mkdir(consumerRoot, { recursive: true });
    await mkdir(path.join(staging, 'fixtures'));
    await writeFile(path.join(consumerRoot, 'package.json'), '{}\n');
    report.combinations.push({ framework, consumer: { root: consumerRoot, kept: true } });
  }
  return { root, repoRoot, ownerFile, owner, report, links };
}

test('ownership accepts only the marked pair and creates byte-identical markers', async t => {
  const fixture = await ownershipFixture(t);
  assert.match(fixture.owner.runId, /^[a-f0-9]{32}$/);
  assert.equal(fixture.owner.externalBase, path.join(await realpath(tmpdir()), `zhinexus-c-t10-${fixture.owner.runId}`));
  assert.deepEqual(
    await readFile(fixture.ownerFile),
    await readFile(path.join(fixture.owner.externalBase, '.c-owned-t10.json')),
  );
  const validated = await validateOwnedConsumers(fixture.ownerFile, fixture.report, fixture.repoRoot);
  assert.deepEqual(validated.consumers.map(consumer => consumer.framework), ['vue', 'react']);
  assert.equal(validated.consumers.length, 2);
});

const invalidOwnership = [
  ['a staging path outside the owned direct parent', async fixture => {
    fixture.report.combinations[0].consumer.root = path.join(fixture.root, 'a-t10-staging-outside', 'a-t10-consumer-vue');
  }, /staging outside owned direct parent/],
  ['an ownership root outside its exclusive TEMP name', async fixture => {
    await writeFile(fixture.ownerFile, JSON.stringify({ ...fixture.owner, externalBase: fixture.root }));
  }, /AssertionError/],
  ['unowned entries in the consumer parent', async fixture => {
    await writeFile(path.join(fixture.owner.consumerRoot, 'unowned.txt'), 'fixture');
  }, /unowned entries present/],
  ['a Git checkout marker in a consumer', async fixture => {
    await mkdir(path.join(fixture.report.combinations[0].consumer.root, '.git'));
  }, /consumer is a Git checkout/],
  ['different ownership marker bytes', async fixture => {
    await writeFile(path.join(fixture.owner.externalBase, '.c-owned-t10.json'), `${JSON.stringify(fixture.owner)}\n`);
  }, /ownership marker differs/],
  ['a command naming a different consumer root', async fixture => {
    fixture.report.probe.command[3] = fixture.root;
  }, /AssertionError/],
];

for (const [name, mutate, error] of invalidOwnership) {
  test(`ownership rejects ${name}`, async t => {
    const fixture = await ownershipFixture(t);
    await mutate(fixture);
    await assert.rejects(() => validateOwnedConsumers(fixture.ownerFile, fixture.report, fixture.repoRoot), error);
  });
}

for (const location of ['consumer parent', 'staging', 'consumer', 'fixtures']) {
  test(`ownership rejects a redirected ${location} directory`, async t => {
    const fixture = await ownershipFixture(t);
    const consumerRoot = fixture.report.combinations[0].consumer.root;
    const staging = path.dirname(consumerRoot);
    const redirected = {
      'consumer parent': fixture.owner.consumerRoot,
      staging,
      consumer: consumerRoot,
      fixtures: path.join(staging, 'fixtures'),
    }[location];
    const target = path.join(fixture.root, 'redirect-target');
    await rename(redirected, target);
    await symlink(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');
    fixture.links.push(redirected);
    await assert.rejects(
      () => validateOwnedConsumers(fixture.ownerFile, fixture.report, fixture.repoRoot),
      /not a plain directory/,
    );
  });
}

async function ownershipWithMockDeletion() {
  const source = await readFile(ownershipScript, 'utf8');
  const fsImport = source.match(/import \{ ([^}]+) \} from 'node:fs\/promises';/);
  assert(fsImport, 'ownership filesystem import must be found before substituting destructive calls');
  const names = fsImport[1].split(',').map(name => name.trim());
  assert(names.includes('rm') && names.includes('rmdir'));
  const safeImport = `import { ${names.filter(name => name !== 'rm' && name !== 'rmdir').join(', ')} } from 'node:fs/promises';`;
  // Validation is the real module on real fixture directories. Only destructive
  // filesystem calls are replaced in an isolated module, never patched globally.
  const instrumented = source.replace(fsImport[0], `${safeImport}
export const deletionCalls = [];
const rm = async (target, options) => { deletionCalls.push({ operation: 'rm', target, options }); };
const rmdir = async target => { deletionCalls.push({ operation: 'rmdir', target }); };`);
  const uniqueSource = `${instrumented}\n// isolated fixture ${randomBytes(8).toString('hex')}\n`;
  return import(`data:text/javascript;base64,${Buffer.from(uniqueSource).toString('base64')}`);
}

test('cleanup schedules exactly two owned stages and their parent using mock deletion', async t => {
  const fixture = await ownershipFixture(t);
  const mocked = await ownershipWithMockDeletion();
  await mocked.cleanupOwnedPair(fixture.ownerFile, fixture.report, fixture.repoRoot);
  assert.deepEqual(mocked.deletionCalls, [
    ...fixture.report.combinations.map(combination => ({
      operation: 'rm', target: path.dirname(combination.consumer.root), options: { recursive: true },
    })),
    { operation: 'rmdir', target: fixture.owner.consumerRoot },
  ]);
  for (const combination of fixture.report.combinations) {
    assert.equal((await lstat(combination.consumer.root)).isDirectory(), true, 'mock deletion must leave fixture directories intact');
  }
});

test('cleanup validates the second consumer before scheduling any deletion', async t => {
  const fixture = await ownershipFixture(t);
  const mocked = await ownershipWithMockDeletion();
  fixture.report.combinations[1].consumer.root = path.join(fixture.root, 'a-t10-staging-outside', 'a-t10-consumer-react');
  await assert.rejects(
    () => mocked.cleanupOwnedPair(fixture.ownerFile, fixture.report, fixture.repoRoot),
    /staging outside owned direct parent/,
  );
  assert.deepEqual(mocked.deletionCalls, []);
  assert.equal((await lstat(fixture.owner.consumerRoot)).isDirectory(), true);
});
