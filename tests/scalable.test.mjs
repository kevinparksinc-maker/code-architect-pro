import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {scanLargeDirectory} from '../src/scalable.mjs';
import {extractZipToDirectory} from '../src/archive-stream.mjs';
import {createZip} from '../src/zip.mjs';
import {compareArchitecture} from '../src/insight.mjs';
import {createAppServer} from '../src/server.mjs';
import {downloadPublicRepoFile} from '../src/github-stream.mjs';

const dirs=[];async function temp(){const t=await mkdtemp(path.join(tmpdir(),'architect-v3-test-'));dirs.push(t);return t;}
test.after(async()=>{for(const d of dirs)await rm(d,{force:true,recursive:true});});
test('incremental scanner processes 1,220 sources and source over the old 1MB cap',async()=>{
  const d=await temp();await mkdir(path.join(d,'src'));
  await writeFile(path.join(d,'package.json'),JSON.stringify({main:'src/main.ts'}));
  await writeFile(path.join(d,'src','main.ts'),`import { ready } from './lib'; console.log(ready());`);
  await writeFile(path.join(d,'src','lib.ts'),`export const ready=()=>1;\n${'// filler\n'.repeat(130000)}`);
  for(let i=0;i<1220;i++)await writeFile(path.join(d,'src',`thing-${i}.ts`),`export const n${i}=${i};`);
  let count=0;
  const report=await scanLargeDirectory(d,{onProgress:()=>count++});
  assert.equal(report.summary.sourceFiles,1222);
  assert.equal(count,1222);
  assert.ok(report.summary.sourceBytesRead>1024**2);
  assert.equal(report.summary.parseErrors,0);
  assert.ok(report.graph.edges.some(e=>e.from==='src/main.ts'&&e.to==='src/lib.ts'));
  assert.equal(report.architecture.measurements.modules,1222);
});
test('deep scanner finds async misuse, empty catches, duplicate logic, cycles, coupling',async()=>{
  const d=await temp();await mkdir(path.join(d,'src'));
  const common=`export function elaborate(a,b){if(a===null)return b;for(let i=0;i<12;i++){a += (i + b);}return a+ b;}`;
  await writeFile(path.join(d,'src/main.ts'),`import { go } from './a';go();\nconst values=[1];values.forEach(async v=>{await fetch('/api/'+v)});try{throw new Error('x')}catch(e){}`);
  await writeFile(path.join(d,'src/a.ts'),`import { go as b } from './b';export function go(){return b} ${common}`);
  await writeFile(path.join(d,'src/b.ts'),`import { go } from './a';export const b=go; ${common}`);
  for(let i=0;i<11;i++)await writeFile(path.join(d,`src/ref-${i}.ts`),`import { go } from './a';export const ref${i}=go;`);
  const r=await scanLargeDirectory(d);
  const rules=new Set(r.findings.map(f=>f.rule));
  for(const k of ['async-foreach','empty-catch','duplicate-function-body','circular-dependency','high-coupling-hub'])assert.ok(rules.has(k),k);
  assert.ok(r.architecture.hotspots.some(x=>x.file==='src/a.ts'));
  assert.ok(r.repairPlan.steps.some(x=>x.discipline==='Async control flow and correctness'));
  const c=compareArchitecture(r,r);assert.equal(c.metrics.find(x=>x.name==='cycles').delta,0);
});
test('archive reader extracts ZIP without 32 MB cap mechanism and avoids symlinks/traversal',async()=>{
  const root=await temp(),zipFile=path.join(root,'source.zip'),dest=path.join(root,'out');await mkdir(dest);
  const content='Hello there '.repeat(20000);
  await writeFile(zipFile,createZip(new Map([['project/src/main.ts',Buffer.from(content)],['project/package.json',Buffer.from('{}')]])));
  const result=await extractZipToDirectory(zipFile,dest);
  assert.equal(result.entries,2);
  assert.equal(await readFile(path.join(dest,'src/main.ts'),'utf8'),content);
  await assert.rejects(()=>extractZipToDirectory(zipFile,dest),/EEXIST|Duplicate/);
});
test('ZIP server provides background job, progress, full report and conservative patch manifest',async()=>{
  const archive=createZip(new Map([
    ['package.json',Buffer.from('{"main":"src/main.ts"}')],
    ['src/main.ts',Buffer.from("import { used, unused } from './lib'; console.log(used())")],
    ['src/lib.ts',Buffer.from('export function used(){return 1} export function unused(){return 2}')]
  ]));
  const server=createAppServer();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const response=await fetch(base+'/api/scan/zip',{method:'POST',body:archive,headers:{'Content-Type':'application/zip'}});
    assert.equal(response.status,202);const job=await response.json();assert.ok(job.jobId);
    let state;
    for(let i=0;i<60;i++){
      state=await (await fetch(base+job.poll)).json();
      if(state.status==='complete'||state.status==='error')break;
      await new Promise(ok=>setTimeout(ok,75));
    }
    assert.equal(state.status,'complete',state.error);
    assert.equal(state.report.summary.sourceFiles,2);
    assert.ok(state.report.architecture.measurements);
    assert.equal(state.report.summary.safeFixCandidates,1);
    const full=await (await fetch(base+state.fullReportUrl)).json();
    assert.equal(full.findings.length,full.summary.findings);
    const patches=await fetch(base+'/api/export/patch-manifest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scanId:state.scanId,fixIds:[full.fixes[0].id]})});
    assert.equal(patches.status,200);
    const body=await patches.json();assert.equal(body.patches.length,1);
  }finally {await new Promise(ok=>server.close(ok));}
});
test('streaming GitHub redirect validation rejects other hosts',async()=>{
  const d=await temp();
  const fake=async()=>({status:302,headers:new Headers({location:'https://malicious.example/evil'}),ok:false});
  await assert.rejects(downloadPublicRepoFile('example/project',path.join(d,'archive.zip'),{fetcher:fake}),/Untrusted GitHub/);
});
test('streamed archive intake handles ZIP above the previous 32 MiB cap',async()=>{
  const d=await temp(),zip=path.join(d,'big.zip'),dest=path.join(d,'out');await mkdir(dest);
  const large=Buffer.alloc(33*1024*1024,0x41);
  await writeFile(zip,createZip(new Map([['project/asset.bin',large],['project/main.ts',Buffer.from('export const active=1;')]])));
  const stats=await extractZipToDirectory(zip,dest,{maxArchiveBytes:64*1024*1024,maxExpandedBytes:64*1024*1024});
  assert.equal(stats.entries,2);assert.equal((await readFile(path.join(dest,'asset.bin'))).length,large.length);
});
test('ZIP64 end record is accepted without a 16-bit entry count restriction',async()=>{
  const d=await temp(),zip=path.join(d,'zip64.zip'),out=path.join(d,'out');await mkdir(out);
  const normal=createZip(new Map([['src/main.ts',Buffer.from('export const x=123;')]]));
  const end=normal.length-22,cdOffset=normal.readUInt32LE(end+16),cdSize=normal.readUInt32LE(end+12);
  const zip64=Buffer.alloc(56);zip64.writeUInt32LE(0x06064b50,0);zip64.writeBigUInt64LE(44n,4);zip64.writeUInt16LE(45,12);zip64.writeUInt16LE(45,14);
  zip64.writeBigUInt64LE(1n,24);zip64.writeBigUInt64LE(1n,32);zip64.writeBigUInt64LE(BigInt(cdSize),40);zip64.writeBigUInt64LE(BigInt(cdOffset),48);
  const locator=Buffer.alloc(20);locator.writeUInt32LE(0x07064b50,0);locator.writeBigUInt64LE(BigInt(end),8);locator.writeUInt32LE(1,16);
  const footer=Buffer.from(normal.subarray(end));footer.writeUInt16LE(0xffff,8);footer.writeUInt16LE(0xffff,10);footer.writeUInt32LE(0xffffffff,12);footer.writeUInt32LE(0xffffffff,16);
  await writeFile(zip,Buffer.concat([normal.subarray(0,end),zip64,locator,footer]));
  const result=await extractZipToDirectory(zip,out);
  assert.equal(result.entries,1);assert.match(await readFile(path.join(out,'src/main.ts'),'utf8'),/123/);
});
test('streamed extraction rejects archive path traversal and ZIP symlinks',async()=>{
  const d=await temp(),zip=path.join(d,'evil.zip'),out=path.join(d,'out');await mkdir(out);
  const normal=createZip(new Map([['src/mx',Buffer.from('hello')]]));
  const eocd=normal.length-22,cd=normal.readUInt32LE(eocd+16);
  const sneaky=Buffer.from(normal);Buffer.from('../bad').copy(sneaky,30);Buffer.from('../bad').copy(sneaky,cd+46);
  await writeFile(zip,sneaky);await assert.rejects(extractZipToDirectory(zip,out),/Unsafe ZIP/);
  const symlink=Buffer.from(normal);symlink.writeUInt32LE((0xa000<<16)>>>0,cd+38);
  await writeFile(zip,symlink);await assert.rejects(extractZipToDirectory(zip,out),/symlink/);
});
test('side-effect-only TypeScript import does not crash incremental scanner',async()=>{
  const d=await temp();await mkdir(path.join(d,'src'));
  await writeFile(path.join(d,'src/main.ts'),`import './bootstrap'; console.log('ok');`);
  await writeFile(path.join(d,'src/bootstrap.ts'),`globalThis.__testData = 'loaded';`);
  const r=await scanLargeDirectory(d);
  assert.equal(r.summary.sourceFiles,2);
  assert.ok(r.graph.edges.some(e=>e.from==='src/main.ts'&&e.to==='src/bootstrap.ts'));
});
test('refactor blueprint provides actual file-specific change sets',async()=>{
  const d=await temp();await mkdir(path.join(d,'src'));
  await writeFile(path.join(d,'src/main.ts'),`import {a} from './a';a()`);
  await writeFile(path.join(d,'src/a.ts'),`import {b} from './b';export function a(){return b}`);
  await writeFile(path.join(d,'src/b.ts'),`import {a} from './a';export function b(){return a}`);
  const r=await scanLargeDirectory(d);
  const change=r.refactorBlueprint.changeSets.find(c=>c.rule==='circular-dependency');
  assert.ok(change);
  assert.ok(change.affectedFiles.includes('src/a.ts'));
  assert.ok(change.transform.length>2);
  assert.equal(change.status,'proposal-not-applied');
});
