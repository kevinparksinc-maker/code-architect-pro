import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createZip, readZip } from '../src/zip.mjs';
import { scanFiles, applySelectedFixes } from '../src/engine.mjs';
import { parseRepo, downloadPublicRepo } from '../src/github.mjs';
import { createAppServer } from '../src/server.mjs';
import { loadFolder } from '../src/cli.mjs';

const src = (name, code) => [name, Buffer.from(code)];
test('ZIP creation/reading round-trips binary and text files', () => {
  const files = new Map([src('src/main.ts', 'console.log(42)'), ['asset.bin', Buffer.from([0, 1, 5, 0, 255])]]);
  const roundTrip = readZip(createZip(files));
  assert.equal(roundTrip.get('src/main.ts').toString(), 'console.log(42)');
  assert.deepEqual(roundTrip.get('asset.bin'), files.get('asset.bin'));
});
test('invalid ZIP rejected and zipped ../ paths blocked', () => {
  assert.throws(() => readZip(Buffer.from('not a zip')), /Invalid ZIP/);
  assert.throws(() => createZip(new Map([src('../private', 'secret')])), /Unsafe ZIP/);
});
test('finds circular imports, duplicate functions, unreachable files and unused imports', async () => {
  const files = await loadFolder(path.join(process.cwd(), 'examples/demo'));
  const r = scanFiles(files, 'fixture');
  assert.ok(r.summary.sourceFiles >= 5);
  const rules = new Set(r.findings.map(f => f.rule));
  for (const rule of ['circular-dependency', 'duplicate-function-body', 'unreachable-from-known-entrypoints', 'unused-named-import']) assert.ok(rules.has(rule), rule);
  assert.ok(r.fixes.length > 0);
  assert.match(r.agentTask, /repair task/);
});
test('selected fix produces changed archive without mutating original', () => {
  const files = new Map([
    src('package.json', '{"main":"src/main.ts"}'),
    src('src/main.ts', `import { used, unused } from './lib';\nconsole.log(used());\n`),
    src('src/lib.ts', `export function used() { return 1 }\nexport function unused() { return 2 }\n`)
  ]);
  const report = scanFiles(files);
  assert.equal(report.fixes.length, 1);
  const fixed = applySelectedFixes(files, report, [report.fixes[0].id]);
  assert.match(fixed.get('src/main.ts').toString(), /import \{ used \} from/);
  assert.ok(!fixed.get('src/main.ts').toString().includes('unused }'));
  assert.match(files.get('src/main.ts').toString(), /unused/);
  assert.throws(() => applySelectedFixes(files, report, ['bad-id']), /Unknown fix/);
  const zip = readZip(createZip(fixed));
  assert.equal(zip.get('src/main.ts').toString(), fixed.get('src/main.ts').toString());
});
test('GitHub input restricts hosts and validates repository references', () => {
  assert.deepEqual(parseRepo('https://github.com/example/project'), { owner: 'example', repo: 'project', ref: '' });
  assert.deepEqual(parseRepo('example/project/tree/main'), { owner: 'example', repo: 'project', ref: 'main' });
  for (const input of ['https://evil.com/owner/repo', 'http://github.com/owner/repo', '../secret', 'a/b/tree/../secrets']) assert.throws(() => parseRepo(input));
});
test('GitHub redirect only accepts approved download domains', async () => {
  const fakeFetch = async () => ({ status: 302, headers: new Headers({location: 'https://evil.example/steal'}), ok: false });
  await assert.rejects(downloadPublicRepo('owner/repo', fakeFetch), /Untrusted GitHub/);
});
test('HTTP server demo and repair ZIP flow', async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await (await fetch(`${base}/api/health`)).json(); assert.equal(health.status, 'ok');
    const response = await fetch(`${base}/api/demo`, { method: 'POST' });
    assert.equal(response.status, 200);
    const data = await response.json(); assert.ok(data.scanId); assert.ok(data.report.fixes.length);
    const patched = await fetch(`${base}/api/export/repaired-zip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({scanId: data.scanId, fixIds: [data.report.fixes[0].id]}) });
    assert.equal(patched.status, 200);
    assert.equal(patched.headers.get('content-type'), 'application/zip');
    const files = readZip(Buffer.from(await patched.arrayBuffer()));
    assert.ok(files.has(data.report.fixes[0].file));
    const web = await fetch(base); assert.match(await web.text(), /CODE ARCHITECT/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
