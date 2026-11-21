import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { authorized, assertSecurePublicHost } from './auth.mjs';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, applySelectedFixes } from './engine.mjs';
import { createZip } from './zip.mjs';
import { parseRepo } from './github.mjs';
import { loadFolder } from './cli.mjs';
import { mergeExternalReport } from './adapters.mjs';
import { listKnowledge } from './knowledge.mjs';
import { scanLargeDirectory } from './scalable.mjs';
import { extractZipToDirectory } from './archive-stream.mjs';
import { downloadPublicRepoFile } from './github-stream.mjs';
import { buildRefactorBlueprint } from './refactor-blueprint.mjs';
import { analyzeArchitecture } from './insight.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = { '/': ['public/index.html', 'text/html; charset=utf-8'], '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'], '/style.css': ['public/style.css', 'text/css; charset=utf-8'] };
const sessions = new Map();
const jobs = new Map();
const pendingJobs=[];
const MAX_ANALYZER_REPORT_BYTES=Math.max(1,Number(process.env.ARCHITECT_MAX_ANALYZER_REPORT_BYTES||32*1024**2));
let activeJobs=0;
const MAX_SIMULTANEOUS_SCANS=Math.max(1,Number(process.env.ARCHITECT_CONCURRENT_SCANS||1));
const MAX_UPLOAD = Math.max(1,Number(process.env.ARCHITECT_MAX_UPLOAD_BYTES || 1024**3)); // configurable, 1 GiB default
const MAX_EXPANDED = Math.max(1,Number(process.env.ARCHITECT_MAX_EXPANDED_BYTES || 3*1024**3)); // configurable, 3 GiB default
function pruneJobs() {
  for(const [id,job] of jobs) if(Date.now()-job.createdAt>60*60000 && job.status!=='running' && job.status!=='queued') {
    jobs.delete(id); sessions.delete(id); if(job.workdir) rm(job.workdir,{force:true,recursive:true}).catch(()=>{});
  }
}
async function streamUpload(req, target) {
  let count=0;
  const quota=new Transform({transform(chunk,encoding,done){count+=chunk.length;
    if(count>MAX_UPLOAD) {const error=new Error('Upload exceeds configured server storage budget');error.status=413;done(error);}else done(null,chunk);
  }});
  await pipeline(req,quota,createWriteStream(target,{flags:'wx'}));
  return count;
}
function reportPreview(report) {
  return {...report,findings:report.findings.slice(0,250),fixes:report.fixes.slice(0,100),
    repairPlan:{...report.repairPlan,steps:report.repairPlan.steps.slice(0,100)},
    graph:{...report.graph,nodes:report.graph.nodes.slice(0,250),edges:report.graph.edges.slice(0,300),
      calls:{...report.graph.calls,nodes:report.graph.calls.nodes.slice(0,300),edges:report.graph.calls.edges.slice(0,300),unresolved:report.graph.calls.unresolved.slice(0,50)}},
    refactorBlueprint:{...report.refactorBlueprint,changeSets:report.refactorBlueprint.changeSets.slice(0,100)},
    architecture:{...report.architecture,moduleMetrics:report.architecture.moduleMetrics.slice(0,100),hotspots:report.architecture.hotspots.slice(0,100),prioritizedFindings:report.architecture.prioritizedFindings.slice(0,200)},
    partialPreview:report.findings.length>250||report.graph.edges.length>300||report.fixes.length>100};
}
async function runJob(job, repository) {
  try {
    job.status='running';job.stage=repository?'Downloading GitHub ZIP':'Extracting archive';
    if(repository) await downloadPublicRepoFile(repository,job.archive,{maxBytes:MAX_UPLOAD});
    const extracted=path.join(job.workdir,'extracted');
    await mkdir(extracted);
    const unzip=await extractZipToDirectory(job.archive,extracted,{maxArchiveBytes:MAX_UPLOAD,maxExpandedBytes:MAX_EXPANDED,onProgress:p=>{job.progress={stage:'extract',...p};}});
    job.stage='Analyzing project';
    const report=await scanLargeDirectory(extracted,{label:repository||'Uploaded ZIP',onProgress:p=>{job.progress={stage:'scan',...p};}});
    report.intake={kind:repository?'public-github':'zip-upload',...unzip};
    await writeFile(path.join(job.workdir,'report.json'),JSON.stringify(report));
    sessions.set(job.id,{createdAt:Date.now(),report,files:null,workdir:job.workdir});
    job.report=reportPreview(report);job.status='complete';job.stage='Ready';
  } catch(e) {job.status='error';job.stage='Failed';job.error=e.message||'Scan failed';}
}
function pumpJobs(){while(activeJobs<MAX_SIMULTANEOUS_SCANS&&pendingJobs.length){const {job,repository}=pendingJobs.shift();activeJobs++;runJob(job,repository).finally(()=>{activeJobs--;pumpJobs();});}}
function newJob(workdir,archive,repository) {
  pruneJobs();
  if(jobs.size>=16) {const e=new Error('Server job queue is full; complete or clear old jobs before adding another');e.status=429;throw e;}
  const id=randomUUID(),job={id,createdAt:Date.now(),status:'queued',stage:'Queued',progress:{},workdir,archive};
  jobs.set(id,job);pendingJobs.push({job,repository});pumpJobs();
  return {jobId:id,status:'queued',poll:`/api/jobs/${id}`};
}

function headers(extra = {}) { return { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'", ...extra }; }
function json(res, status, obj) { res.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8' })); res.end(JSON.stringify(obj)); }
async function readBody(req, max) {
  let length = 0, chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) { const error = new Error(`Request exceeds ${Math.round(max/1048576)} MB limit`); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function createSession(report, files) {
  for (const [id, s] of sessions) if (Date.now() - s.createdAt > 30 * 60000 && !s.workdir) sessions.delete(id);
  while ([...sessions.values()].filter(s=>!s.workdir).length >= 3) {
    const oldest=[...sessions].find(([,s])=>!s.workdir);if(!oldest)break;sessions.delete(oldest[0]);
  }
  const id = randomUUID(); sessions.set(id, { createdAt: Date.now(), report, files });
  return { scanId: id, report };
}
function safeJson(body) { try { return JSON.parse(body.toString('utf8')); } catch { const e = new Error('Invalid JSON request'); e.status = 400; throw e; } }
export function createAppServer() {
  const app = http.createServer(async (req, res) => {
    try {
      // Route by URL pathname so tracking and cache-busting query strings do not break pages or API calls.
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/healthz')) {
        json(res, 200, {status:'ok', version:'0.3.1'}); return;
      }
      if (!authorized(req)) {
        res.writeHead(401, headers({ 'Content-Type': 'application/json; charset=utf-8', 'WWW-Authenticate': 'Basic realm="Code Architect", charset="UTF-8"' }));
        res.end(JSON.stringify({error:'Authentication required'})); return;
      }
      if (req.method === 'GET' && STATIC[pathname]) {
        const [name, type] = STATIC[pathname];
        const file = await readFile(path.join(ROOT, name));
        res.writeHead(200, headers({ 'Content-Type': type })); res.end(file); return;
      }

      if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
        const parts=pathname.split('/');const job=jobs.get(parts[3]);
        if(!job)return json(res,404,{error:'Scan job not found or expired'});
        if(parts[4]==='report') {
          if(job.status!=='complete')return json(res,409,{error:'Full report not ready yet'});
          res.writeHead(200,headers({'Content-Type':'application/json','Content-Disposition':'attachment; filename="code-architect-full-report.json"'}));
          createReadStream(path.join(job.workdir,'report.json')).pipe(res);return;
        }
        if(parts.length===4)return json(res,200,{scanId:job.id,status:job.status,stage:job.stage,progress:job.progress,
          ...(job.status==='complete'?{report:job.report,fullReportUrl:`/api/jobs/${job.id}/report`}:{}),
          ...(job.error?{error:job.error}: {})});
      }
      if (req.method === 'GET' && pathname === '/api/knowledge') { json(res, 200, {catalog: listKnowledge(), version: '0.3'}); return; }
      if (req.method === 'POST' && pathname === '/api/demo') {
        const files = await loadFolder(path.join(ROOT, 'examples/demo'));
        json(res, 200, createSession(scanFiles(files, 'Built-in demonstration'), files)); return;
      }
      if (req.method === 'POST' && pathname === '/api/scan/zip') {
        if ((req.headers['content-type'] || '').split(';')[0] !== 'application/zip') return json(res, 415, { error: 'Send ZIP bytes with Content-Type: application/zip' });
        const workdir=await mkdtemp(path.join(tmpdir(),'architect-web-')),archive=path.join(workdir,'source.zip');
        try {await streamUpload(req,archive);json(res,202,newJob(workdir,archive));}
        catch(e){await rm(workdir,{recursive:true,force:true});throw e;}
        return;
      }
      if (req.method === 'POST' && pathname === '/api/scan/github') {
        const body=safeJson(await readBody(req,4000));
        // Validate repository synchronously, before starting asynchronous download.
        parseRepo(body.repository);
        const workdir=await mkdtemp(path.join(tmpdir(),'architect-github-'));
        try {json(res,202,newJob(workdir,path.join(workdir,'source.zip'),body.repository));}
        catch(e){await rm(workdir,{recursive:true,force:true});throw e;}
        return;
      }
      if (req.method === 'POST' && pathname === '/api/analyzers/import') {
        const body = safeJson(await readBody(req, MAX_ANALYZER_REPORT_BYTES));
        const session = sessions.get(body.scanId);
        if (!session || Date.now() - session.createdAt > (session.workdir?60:30) * 60000) return json(res, 404, { error: 'Scan session expired; scan again' });
        if (!body.report || typeof body.report !== 'object') return json(res, 400, {error:'Provide a JSON report object'});
        session.report = mergeExternalReport(session.report, body.report, body.tool, new Set(session.files?.keys()||session.report.graph.nodes));
        session.report.architecture=analyzeArchitecture(session.report);
        session.report.refactorBlueprint=buildRefactorBlueprint(session.report);
        if(session.workdir){await writeFile(path.join(session.workdir,'report.json'),JSON.stringify(session.report));const job=jobs.get(body.scanId);if(job)job.report=reportPreview(session.report);}
        json(res, 200, {scanId: body.scanId,report:session.workdir?reportPreview(session.report):session.report,...(session.workdir?{fullReportUrl:`/api/jobs/${body.scanId}/report`}:{})}); return;
      }
      if (req.method === 'POST' && pathname === '/api/export/patch-manifest') {
        const body=safeJson(await readBody(req,300000));const session=sessions.get(body.scanId);
        if(!session)return json(res,404,{error:'Scan session expired'});
        if(!Array.isArray(body.fixIds)||!body.fixIds.length||new Set(body.fixIds).size!==body.fixIds.length)return json(res,400,{error:'Select unique fix IDs'});
        const patches=body.fixIds.map(id=>{const fix=session.report.fixes.find(x=>x.id===id);if(!fix)throw new Error(`Unknown fix: ${id}`);return fix;});
        json(res,200,{format:'code-architect-reviewed-patches',version:'0.3',patches,verificationRequired:true,
          instructions:'Use scripts/apply-reviewed-fixes.mjs on your own extracted project copy; then run regression tests.'});return;
      }
      if (req.method === 'POST' && pathname === '/api/export/repaired-zip') {
        const body = safeJson(await readBody(req, 200000));
        const session = sessions.get(body.scanId);
        if (!session || Date.now() - session.createdAt > 30 * 60000) return json(res, 404, { error: 'Scan session expired; scan the project again' });
        if(!session.files)return json(res,409,{error:'Large-project scans offer reviewable patches. Export the patch manifest or run the apply-reviewed-fixes script on a local copy.'});
        const selected = body.fixIds;
        if (!Array.isArray(selected) || !selected.length) return json(res, 400, { error: 'Select at least one repair before downloading' });
        const updated = applySelectedFixes(session.files, session.report, selected);
        const zip = createZip(updated);
        res.writeHead(200, headers({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="code-architect-reviewed-repairs.zip"', 'Content-Length': zip.length })); res.end(zip); return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.status || (error.message?.includes('limit') || error.message?.includes('exceeds') ? 413 : 400);
      json(res, status, { error: error.message || 'Unable to process scan' });
    }
  });
  // Expire reports and temporary ZIPs even if no subsequent scan is requested.
  const cleanup = setInterval(pruneJobs, 300_000);
  cleanup.unref();
  app.on('close', () => clearInterval(cleanup));
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  assertSecurePublicHost(host);
  createAppServer().listen(port, host, () => console.log(`Code Architect running at http://${host}:${port}`));
}

