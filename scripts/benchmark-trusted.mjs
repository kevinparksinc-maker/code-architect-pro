#!/usr/bin/env node
// Runs the user's declared npm bench/benchmark script on two TRUSTED local projects.
// NEVER invoke from the upload server. No dependencies are installed.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const [, , original,candidate,approval] = process.argv;
if(!original||!candidate||approval!=='--i-trust-both'){
  console.error('Usage: node scripts/benchmark-trusted.mjs ORIGINAL_FOLDER CANDIDATE_FOLDER --i-trust-both');process.exit(2);
}
const runs=Math.max(1,Math.min(20,Number(process.env.ARCHITECT_BENCH_RUNS||5)));
const timeout=Number(process.env.ARCHITECT_BENCH_TIMEOUT_MS||120000);
const median=values=>{const s=[...values].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
async function bench(dir){
  const root=path.resolve(dir),pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const script=['bench','benchmark'].find(s=>Object.hasOwn(pkg.scripts||{},s));
  if(!script)return {folder:root,status:'missing-benchmark-script'};
  const measurements=[];
  for(let i=0;i<runs+1;i++){
    const start=performance.now(),p=spawnSync('npm',['run',script],{cwd:root,shell:false,encoding:'utf8',timeout,maxBuffer:512000,env:{...process.env,CI:'true'}});
    const durationMs=Math.round(performance.now()-start);
    if(p.error||p.status!==0)return {folder:root,status:'failed',script,iteration:i,exitCode:p.status,error:(p.stderr||p.error?.message||'').slice(-1500)};
    if(i>0)measurements.push(durationMs); // first is a warm-up
  }
  return {folder:root,status:'completed',script,runs,measurements,medianMs:median(measurements)};
}
try {
  const baseline=await bench(original),after=await bench(candidate);
  const compare=baseline.status==='completed'&&after.status==='completed' ? {
    percentChange:+(((after.medianMs/baseline.medianMs)-1)*100).toFixed(1),
    interpretation:'Wall-clock duration of declared npm bench script only, including npm startup. It may not represent application end-to-end performance.'
  }:null;
  const out={version:'0.3',source:'trusted-local-benchmark',baseline,after,compare,
    limitations:['Only for trusted local projects: npm scripts execute arbitrary code.','Match hardware, workload, environment, dependency versions and cache state for meaningful comparisons.','Repeat measurements and inspect distributions before claiming a real performance improvement.']};
  await writeFile('benchmark-comparison.json',JSON.stringify(out,null,2));
  console.log(`Benchmark comparison: ${compare?`${compare.percentChange}% median duration change`:'inconclusive'}. Details: benchmark-comparison.json`);
} catch(e){console.error(e.message);process.exitCode=1;}
