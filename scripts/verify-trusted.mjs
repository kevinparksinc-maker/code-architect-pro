#!/usr/bin/env node
/** Trusted-project ONLY: compares test/build script outcomes on a baseline and a candidate.
 * This does not install dependencies and is NOT called by server endpoints.
 * It cannot prove semantic equivalence or performance improvements.
 */
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [, , baselineArg, candidateArg, approval] = process.argv;
if (!baselineArg || !candidateArg || approval !== '--i-trust-both') {
  console.error('Usage: node scripts/verify-trusted.mjs <baseline-dir> <candidate-dir> --i-trust-both');
  process.exit(2);
}
async function load(project) {
  const dir = path.resolve(project);
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  return {dir, scripts: manifest.scripts || {}};
}
const MAX_LOG = 2400;
async function run(project, script) {
  if (!Object.hasOwn(project.scripts, script)) return { status: 'missing', script };
  const start = performance.now();
  const result = spawnSync('npm', ['run', script], {
    cwd: project.dir,
    timeout: 90000,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, CI:'true' }
  });
  return {script, status: result.error ? 'error' : result.status === 0 ? 'passed' : 'failed', exitCode: result.status, durationMs: Math.round(performance.now()-start), stdoutTail: (result.stdout || '').slice(-MAX_LOG), stderrTail: (result.stderr || result.error?.message || '').slice(-MAX_LOG) };
}
try {
  const baseline = await load(baselineArg), candidate = await load(candidateArg);
  const report = {schemaVersion: '1.0', purpose:'local-trusted-regression-comparison', generatedAt: new Date().toISOString(),
    warnings:['Only run on trusted code: npm scripts execute arbitrary code.', 'Passing tests do not prove correctness, functional equivalence, or performance improvements.', 'Inspect logs for secrets before sharing.'],
    checks: []};
  for (const script of ['test','build']) {
    const before = await run(baseline, script), after = await run(candidate, script);
    report.checks.push({script, baseline: before, candidate: after, regression: before.status === 'passed' && after.status !== 'passed'});
  }
  report.outcome = report.checks.some(c => c.regression) ? 'regression-detected' : report.checks.every(c => c.baseline.status === 'passed' && c.candidate.status === 'passed') ? 'checks-passed-not-proof' : 'inconclusive';
  const destination = path.resolve('verification-comparison.json');
  await writeFile(destination, JSON.stringify(report, null, 2));
  console.log(`Outcome: ${report.outcome} · ${destination}`);
  if (report.outcome === 'regression-detected') process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 2; }
