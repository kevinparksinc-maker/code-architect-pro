import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scanLargeDirectory} from '../src/scalable.mjs';
import {checkRepairWiring} from '../src/repair-wiring.mjs';

async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(),'architect-wiring-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}

async function writeFiles(root,files) {
  for (const [file,source] of Object.entries(files)) {
    const destination = path.join(root,file);
    await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,source);
  }
}

const contract = {
  entry:'src/main.ts',caller:'src/route.ts::run',
  callee:'src/calc.ts::calculate',replaces:'src/route.ts::old',
};
const config = JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@/*':['src/*']}}});

test('resolves aliases, assets and literal lazy loads and separates eager and type cycles',async t=>{
  const root = await workspace(t);
  await writeFiles(root,{
    'tsconfig.json':config,
    'src/main.ts':"import { run } from '@/route.js'; import '@/site.css'; run(); import('@/lazy');",
    'src/site.css':'body {}',
    'src/route.ts':"import { calculate } from '@/calc'; export function run() { return calculate(); }",
    'src/calc.ts':"import type { Config } from '@/model'; export function calculate(c?:Config) { return c?.n; }",
    'src/model.ts':"export type Config = { n:number; next?:typeof import('@/calc').calculate };",
    'src/lazy.ts':"import '@/route';",
    'src/first.ts':"import '@/second'; export const on = true;",
    'src/second.ts':"export { on } from '@/first';",
  });
  const report = await scanLargeDirectory(root);
  assert.deepEqual(report.graph.cycles,{runtime:[['src/first.ts','src/second.ts']],typeInvolved:[['src/calc.ts','src/model.ts']]});
  assert.deepEqual(report.graph.resolution.configs,{'tsconfig.json':[]});
  assert.equal(report.findings.some(f=>f.rule==='unresolved-local-import'),false);
  assert.equal(report.findings.some(f=>f.rule==='unreachable-from-known-entrypoints' && f.location.file==='src/lazy.ts'),false);
  assert.equal(report.graph.edges.find(e=>e.to==='src/lazy.ts').kind,'dynamic');
  const wiring = checkRepairWiring(report,contract);
  assert.equal(wiring.status,'static-match');
  assert.deepEqual(wiring.path.map(edge=>edge.to),['src/route.ts']);
});

test('rejects a parked helper, a type-only entry route and a remaining old call',async t=>{
  const root = await workspace(t);
  await writeFiles(root,{
    'src/main.ts':"import type {} from './route';",
    'src/calc.ts':"export function calculate() {return 1;}",
    'src/route.ts':"import {calculate} from './calc'; function old(){return 1;} export function run(){return old();}",
  });
  const check = async()=>checkRepairWiring(await scanLargeDirectory(root),contract);
  assert.equal((await check()).directCall,null);
  await writeFiles(root,{
    'src/route.ts':"import {calculate} from './calc'; function old(){return 1;} export function run(){return calculate()+old();}",
  });
  assert.equal((await check()).reachable,false);
  await writeFiles(root,{'src/main.ts':"import {run} from './route';run();"});
  const result = await check();
  assert.equal(result.status,'unconfirmed');
  assert.equal(result.previousCall.to,contract.replaces);
});

test('trusted verifier accepts matching output and blocks an output regression or missing wiring',async t=>{
  const root = await workspace(t);
  const packageJson = JSON.stringify({scripts:{test:'node --version',build:'node --version',golden:'node golden.cjs'}});
  const golden = value => `require("node:fs").writeFileSync(process.env.ARCHITECT_VERIFICATION_OUTPUT,JSON.stringify(${JSON.stringify(value)}));`;
  const before = path.join(root,'before'), after = path.join(root,'after');
  for (const [dir,value] of [[before,{a:1,b:2}],[after,{b:2,a:1}]]) {
    await writeFiles(dir,{
      'package.json':packageJson,'golden.cjs':golden(value),
      'src/main.ts':"import {run} from './route';run();",
      'src/route.ts':dir===before ? 'function old(){return 1;} export function run(){return old();}'
        : "import {calculate} from './calc'; export function run(){return calculate();}",
      'src/calc.ts':'export function calculate(){return 1;}',
    });
  }
  await writeFiles(root,{'plan.json':JSON.stringify({outputs:[{script:'golden'}],wiring:[contract]})});
  const verify = fileURLToPath(new URL('../scripts/verify-trusted.mjs',import.meta.url));
  const run = ()=>spawnSync(process.execPath,[verify,before,after,'--i-trust-both','--plan','plan.json'],{cwd:root,encoding:'utf8'});
  const read = async()=>JSON.parse(await readFile(path.join(root,'verification-comparison.json'),'utf8'));
  let result = run();
  assert.equal(result.status,0,result.stderr);
  assert.equal((await read()).outcome,'checks-passed-not-proof');
  await writeFiles(after,{'golden.cjs':golden({a:2,b:2})});
  result = run();
  assert.equal(result.status,1,result.stderr);
  assert.equal((await read()).outputs[0].equal,false);
  await writeFiles(after,{
    'golden.cjs':golden({a:1,b:2}),
    'src/route.ts':'function old(){return 1;} export function run(){return old();}',
  });
  result = run();
  assert.equal(result.status,3,result.stderr);
  assert.equal((await read()).outcome,'inconclusive');
});

test('uses inherited project aliases and preserves inline import initialization in verbatim mode',async t=>{
  const root = await workspace(t);
  await writeFiles(root,{
    'tsconfig.json':'{"extends":"./config/base.json","compilerOptions":{"verbatimModuleSyntax":true}}',
    'config/base.json':'{"compilerOptions":{"baseUrl":"..","paths":{"@/*":["src/*"]}}}',
    'src/main.ts':"import {type A} from '@/model'; export type Out = A;",
    'src/model.ts':"export type A = {n:number};",
  });
  const report = await scanLargeDirectory(root);
  assert.equal(report.graph.edges.find(e=>e.to==='src/model.ts')?.kind,'runtime');
  assert.deepEqual(report.graph.resolution.configs,{'tsconfig.json':[]});
});
