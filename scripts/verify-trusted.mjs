#!/usr/bin/env node
/** Trusted-project only. The HTTP scanner never runs this utility. */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { scanLargeDirectory } from '../src/scalable.mjs';
import { checkRepairWiring } from '../src/repair-wiring.mjs';

async function load(project) {
  const dir = await realpath(project);
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  return {dir,scripts:manifest.scripts ?? {}};
}

function run(project, script, output) {
  if (!Object.hasOwn(project.scripts,script)) return {status:'missing',script};
  const start = performance.now();
  const env = {...process.env,CI:'true'};
  delete env.ARCHITECT_VERIFICATION_OUTPUT;
  if (output) env.ARCHITECT_VERIFICATION_OUTPUT = output;
  const result = spawnSync('npm',['run',script],{
    cwd:project.dir,timeout:90000,encoding:'utf8',shell:false,maxBuffer:1024*1024,env,
  });
  return {
    script,status:result.error?'error':result.status===0?'passed':'failed',
    exitCode:result.status,durationMs:Math.round(performance.now()-start),
    stdoutTail:(result.stdout || '').slice(-2400),
    stderrTail:(result.stderr || result.error?.message || '').slice(-2400),
  };
}

const scriptName = value => typeof value==='string' && /^[a-zA-Z0-9_][a-zA-Z0-9:_.-]*$/.test(value);
function readPlan(plan) {
  if (!plan || typeof plan!=='object' || Array.isArray(plan)) throw new Error('Invalid verification plan.');
  const outputs = plan.outputs ?? [];
  const wiring = plan.wiring ?? [];
  const scripts = plan.scripts ?? [];
  if (!Array.isArray(scripts) || !scripts.every(scriptName) ||
      !Array.isArray(outputs) || !outputs.every(item=>scriptName(item?.script)) ||
      !Array.isArray(wiring) || !wiring.every(item=>item && ['entry','caller','callee'].every(key=>
        typeof item[key]==='string' && item[key].length>0) && (item.replaces===undefined || typeof item.replaces==='string'))) {
    throw new Error('Invalid verification plan. See README for scripts, outputs and wiring entries.');
  }
  return {scripts:[...new Set(['test','build',...scripts])],outputs,wiring};
}

async function readOutput(project, script, output) {
  const result = run(project,script,output);
  if (result.status !== 'passed') return {result};
  try {
    return {result,value:JSON.parse(await readFile(output,'utf8'))};
  } catch {
    return {result:{...result,status:'output-error'}};
  }
}

async function compareOutput(baseline,candidate,script,directory,index) {
  const before = await readOutput(baseline,script,path.join(directory,`${index}-before.json`));
  const after = await readOutput(candidate,script,path.join(directory,`${index}-after.json`));
  const comparable = before.result.status==='passed' && after.result.status==='passed';
  const equal = comparable ? isDeepStrictEqual(before.value,after.value) : null;
  return {
    script,baseline:before.result,candidate:after.result,equal,
    regression:before.result.status==='passed' && (after.result.status!=='passed' || !equal),
  };
}

async function main() {
  const [baselineArg,candidateArg,approval,flag,planPath,...extra] = process.argv.slice(2);
  if (!baselineArg || !candidateArg || approval!=='--i-trust-both' ||
      (flag && (flag!=='--plan' || !planPath || extra.length))) {
    throw new Error('Usage: node scripts/verify-trusted.mjs <baseline-dir> <candidate-dir> --i-trust-both [--plan plan.json]');
  }
  const baseline = await load(baselineArg), candidate = await load(candidateArg);
  const contains = (parent,child) => {
    const relative = path.relative(parent,child);
    return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
  };
  if (contains(baseline.dir,candidate.dir) || contains(candidate.dir,baseline.dir)) {
    throw new Error('Baseline and candidate must be separate, non-overlapping directories.');
  }
  const plan = readPlan(planPath ? JSON.parse(await readFile(planPath,'utf8')) : {});
  const report = {
    schemaVersion:'1.1',purpose:'local-trusted-regression-comparison',generatedAt:new Date().toISOString(),
    warnings:['Check logs for secrets before sharing.','Static wiring checks confirm observed imports and direct calls. Run project tests for runtime behavior.'],
    checks:[],outputs:[],wiring:[],
  };
  // Scan before running scripts that might produce generated source files.
  if (plan.wiring.length) {
    const before = await scanLargeDirectory(baseline.dir);
    const after = await scanLargeDirectory(candidate.dir);
    for (const contract of plan.wiring) {
      report.wiring.push({
        baseline:checkRepairWiring(before,{...contract, replaces:undefined}),
        candidate:checkRepairWiring(after,contract),
      });
    }
  }
  for (const script of plan.scripts) {
    const before = run(baseline,script), after = run(candidate,script);
    report.checks.push({script,baseline:before,candidate:after,regression:before.status==='passed' && after.status!=='passed'});
  }
  if (plan.outputs.length) {
    const directory = await mkdtemp(path.join(tmpdir(),'architect-verification-'));
    try {
      for (const [index,{script}] of plan.outputs.entries()) report.outputs.push(await compareOutput(baseline,candidate,script,directory,index));
    } finally {
      await rm(directory,{recursive:true,force:true});
    }
  }
  const regression = [...report.checks,...report.outputs].some(check=>check.regression) ||
    report.wiring.some(check=>check.baseline.status==='static-match' && check.candidate.status!=='static-match');
  const checksPassed = report.checks.every(check=>check.baseline.status==='passed' && check.candidate.status==='passed') &&
    report.outputs.every(check=>check.equal===true) && report.wiring.every(check=>check.candidate.status==='static-match');
  report.outcome = regression ? 'regression-detected' : checksPassed ? 'checks-passed-not-proof' : 'inconclusive';
  const destination = path.resolve('verification-comparison.json');
  await writeFile(destination,JSON.stringify(report,null,2));
  console.log(`Outcome: ${report.outcome} · ${destination}`);
  if (regression) process.exitCode = 1;
  else if (flag && !checksPassed) process.exitCode = 3;
}

main().catch(error=>{ console.error(error.message); process.exitCode=2; });
