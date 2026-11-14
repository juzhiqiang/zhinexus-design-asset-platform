import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalJson, environmentKey, environmentProjection } from '@company/contracts';

const [file, expectedRecommendation = 'hold', expectedRuns = '56'] = process.argv.slice(2);
assert(file, 'evidence path required');
const report = JSON.parse(await readFile(file, 'utf8'));
assert.equal(report.kind, 'a-t10-sdk-probe');
assert.equal(report.probe.platform, 'windows');
assert.equal(report.probe.node, 'v26.13.0');
assert.equal(report.probe.browserRevision, '1254');
assert.equal(report.probe.fontDigestSource, 'measured');
assert.equal(report.recommendation, expectedRecommendation);
assert.equal(report.candidate.integrityVerified, true);
assert.equal(report.policy.candidateIntegrityVerified, true);
assert.deepEqual(report.combinations.map(x => x.framework).sort(), ['react', 'vue']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let total = 0;
const dimensions = [];
const artifacts = new Set();
const requiredDimensions = ['interaction', 'runtime', 'typecheck', 'visual'];
const components = ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'];
const presentations = ['light-canvas', 'dark-canvas', 'light-svg', 'dark-svg'];
for (const combination of report.combinations) {
  assert.equal(combination.echartsVersion, report.candidate.version);
  assert.equal(combination.consumer.peerMode, 'strict');
  assert.equal(combination.evidence.build.exitCode, 0);
  assert.equal(combination.evidence.ssrImport.exitCode, 0);
  assert.equal(combination.evidence.ssrImport.windowDefined, false);
  assert.equal(combination.evidence.ssrImport.documentDefined, false);
  assert.equal(combination.evidence.lifecycle.status, 'passed');
  assert.deepEqual(combination.evidence.typecheck.map(x => x.resolution).sort(), ['Bundler', 'NodeNext']);
  for (const check of combination.evidence.typecheck) assert.equal(check.exitCode, 0);
  assert.deepEqual(Object.keys(combination.dimensions).sort(), requiredDimensions);
  assert(Array.isArray(combination.failures));
  if (expectedRecommendation === 'adopt') assert.deepEqual(combination.failures, []);
  else assert(combination.failures.every(x => x.dimension === 'visual' && /NEW/.test(x.reason)));
  assert.equal(combination.evidence.browser.length, Number(expectedRuns) / 2);
  assert.equal(combination.evidence.visual.length, combination.evidence.browser.length);
  const visualKeys = new Set();
  for (const visual of combination.evidence.visual) {
    assert.equal(visual.result, expectedRecommendation === 'adopt' ? 'PASS' : 'NEW');
    const key = `${visual.component}/${visual.presentation}`;
    assert(!visualKeys.has(key));
    visualKeys.add(key);
  }
  for (const run of combination.evidence.browser) {
    assert(components.includes(run.component));
    assert(presentations.includes(run.presentation));
    assert(visualKeys.has(`${run.component}/${run.presentation}`));
    const environment = run.environment;
    assert.equal(await environmentKey(environment), run.environmentKey);
    assert.deepEqual(environmentProjection(environment), run.environmentAudit.projection);
    assert.equal(canonicalJson(environmentProjection(environment)), run.environmentAudit.canonical);
    const measured = run.environmentAudit.fontFingerprint;
    const families = measured.families.map(family => ({
      family: family.family,
      available: family.available === true,
      advances: family.advances.map(x => Math.round(x * 1000) / 1000),
    }));
    const fontDigest = sha(canonicalJson({
      kind: 'font-fingerprint-v1', stack: measured.stack.trim().normalize('NFC'),
      families, loadedFonts: measured.loadedFonts.map(String).sort(),
    }));
    assert.equal(environment.fontDigest, fontDigest);
    assert.equal(environment.browserRevision, report.probe.browserRevision);
    assert.equal(environment.frameworkVersion, combination.frameworkVersion);
    assert.equal(environment.echartsVersion, report.candidate.version);
    assert.equal(run.hostCount, 1);
    assert.deepEqual(run.pageErrors, []);
    assert(run.checks.length >= 4 && run.checks.every(x => x.status === 'passed'));
    assert.equal(run.clickError, null);
    assert(Array.isArray(run.click) && run.click.length > 0);
    const bytes = await readFile(run.screenshot.file);
    assert.equal(bytes.length, run.screenshot.bytes);
    assert.equal(sha(bytes), run.screenshot.sha256);
    const key = `${combination.framework}/${run.component}/${run.presentation}`;
    assert(!artifacts.has(key), `duplicate ${key}`);
    artifacts.add(key);
    total++;
  }
  for (const [dimension, status] of Object.entries(combination.dimensions)) {
    assert.equal(status, dimension === 'visual' && expectedRecommendation === 'hold' ? 'not-run' : 'passed');
  }
  dimensions.push({ framework: combination.framework, dimensions: combination.dimensions });
}
assert.equal(total, Number(expectedRuns));
if (expectedRecommendation === 'adopt') {
  assert.deepEqual(report.uncovered, []);
  assert.equal(report.policy.hasDualFrameworkCoverage, true);
}
console.log(JSON.stringify({ file, recommendation: report.recommendation, auditedRuns: total, environmentKeysRecomputed: total, screenshotDigestsChecked: total, dimensions }, null, 2));
