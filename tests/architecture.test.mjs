import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFiles } from '../src/engine.mjs';
import { listKnowledge, makeRepairPlan } from '../src/knowledge.mjs';
import { normalizeAnalyzerReport, mergeExternalReport } from '../src/adapters.mjs';
import { createAppServer } from '../src/server.mjs';
const filesOf = o => new Map(Object.entries(o).map(([file, content]) => [file, Buffer.from(content)]));
test('cross-file direct calls and local calls appear in partial call graph', () => {
  const files = filesOf({
    'package.json':'{"main":"src/main.ts"}',
    'src/main.ts': `import { add as sum } from './math'; function run(){return sum(1,2)} console.log(run());`,
    'src/math.ts': `export function add(a:number,b:number){ return a+b; }`
  });
  const report = scanFiles(files);
  const calls = report.graph.calls;
  assert.ok(calls.nodes.some(n=>n.id==='src/math.ts::add'));
  assert.ok(calls.edges.some(e=>e.from==='src/main.ts::run' && e.to==='src/math.ts::add'));
  assert.ok(calls.edges.some(e=>e.to==='src/main.ts::run'));
  assert.ok(report.summary.functionSymbols >= 2);
});
test('knowledge-backed plan supplies alternative designs, invariants and verification', () => {
  const r = scanFiles(filesOf({
    'package.json':'{"main":"src/main.ts"}',
    'src/main.ts':"import { go } from './a'; go();",
    'src/a.ts':"import { ping } from './b'; export function go(){ping()}",
    'src/b.ts':"import { go } from './a'; export function ping(){return !!go}"
  }));
  const cycles = r.repairPlan.steps.filter(s=>s.title.includes('dependency cycle'));
  assert.equal(cycles.length,1);
  assert.equal(cycles[0].options.length,2);
  assert.equal(cycles[0].automaticPatch,false);
  assert.ok(cycles[0].verification.some(x=>/Rescan/.test(x)));
  assert.equal(r.repairPlan.enhancementMode.enabled,false);
  assert.ok(listKnowledge().length >= 9);
  assert.ok(makeRepairPlan(r).steps.length >= 1);
});
test('Knip report is normalized to known scanned paths only, and not auto-patched', () => {
  const known = new Set(['src/a.ts']);
  const data = {issues:[{file:'src/a.ts', exports:[{name:'old',line:4}]},{file:'../../secret',files:[{name:'danger'}]}]};
  const found = normalizeAnalyzerReport('knip',data,known);
  assert.equal(found.length,1); assert.equal(found[0].externalTool,'knip');
  assert.throws(()=>normalizeAnalyzerReport('knip',{},known), /issues/);
});
test('jscpd and dependency-cruiser normalization preserves review-only status', () => {
  const known = new Set(['src/a.ts','src/b.ts']);
  const clones = normalizeAnalyzerReport('jscpd', {duplicates:[{firstFile:{name:'src/a.ts',start:2},secondFile:{name:'src/b.ts',start:7},kind:'similar',lines:8}]}, known);
  assert.equal(clones.length,1); assert.equal(clones[0].severity,'medium');
  const deps = normalizeAnalyzerReport('dependency-cruiser', {modules:[{source:'src/a.ts',dependencies:[{resolved:'src/b.ts',rules:[{name:'not-to-b',severity:'error'}]}]}]}, known);
  assert.equal(deps.length,1); assert.equal(deps[0].severity,'high');
});
test('external report merge refreshes planner without manufacturing automatic fixes', () => {
  const report = scanFiles(filesOf({'package.json':'{"main":"src/a.ts"}','src/a.ts':'export const n = 1;'}));
  const existingFixes = report.fixes.length;
  const merged = mergeExternalReport(report,{issues:[{file:'src/a.ts',exports:[{name:'n',line:1}]}]},'knip',new Set(['src/a.ts','package.json']));
  assert.equal(merged.fixes.length, existingFixes);
  assert.ok(merged.repairPlan.steps.some(s => s.title==='Knip: exports'));
  assert.equal(merged.externalReports[0].accepted,1);
});
test('HTTP knowledge and external report import work without executing uploaded project', async () => {
  const server = createAppServer(); await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const catalog = await (await fetch(base+'/api/knowledge')).json(); assert.ok(catalog.catalog.length>=9);
    const {scanId,report} = await (await fetch(base+'/api/demo',{method:'POST'})).json();
    assert.ok(report.repairPlan.steps.length); assert.ok(report.graph.calls);
    const imported = await fetch(base+'/api/analyzers/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scanId,tool:'knip',report:{issues:[{file:'src/main.ts',exports:[{name:'fake',line:2}]}]}})});
    assert.equal(imported.status,200);
    const data=await imported.json(); assert.ok(data.report.summary.findings>report.summary.findings);
  } finally {await new Promise(ok=>server.close(ok));}
});
