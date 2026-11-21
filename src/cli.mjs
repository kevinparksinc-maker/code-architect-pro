#!/usr/bin/env node
import { readFile, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import { scanFiles } from './engine.mjs';
import { readZip } from './zip.mjs';
import { scanLargeDirectory } from './scalable.mjs';
import { extractZipToDirectory } from './archive-stream.mjs';
const IGNORE = new Set(['node_modules', '.git', 'build', 'dist', '.next', 'coverage', '.cache', 'vendor']);
export async function loadFolder(folder) {
  const root = path.resolve(folder), files = new Map(); let total = 0;
  async function visit(directory, relative = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const r = path.posix.join(relative, entry.name), full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full, r);
      else if (entry.isFile()) {
        const b = await readFile(full);
        total += b.length;
        files.set(r, b);
      }
    }
  }
  await visit(root);
  return files;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const [, , input, out = 'architecture-report.json'] = process.argv;
    if (!input) throw new Error('Usage: npm run scan -- <folder-or-project.zip> [output.json]');
    let work=null;
    try {
      let folder=input;
      if (input.toLowerCase().endsWith('.zip')) {
        work=await mkdtemp(path.join(tmpdir(),'architect-cli-'));
        await extractZipToDirectory(path.resolve(input),work,{maxArchiveBytes:Infinity,maxExpandedBytes:Infinity});
        folder=work;
      }
      const report=await scanLargeDirectory(folder,{label:path.basename(input),onProgress:p=>{if(p.completed%100===0)process.stderr.write(`Scanned ${p.completed}/${p.total} source files\r`);}});
      await writeFile(out,JSON.stringify(report,null,2));
      console.log(`Scanned ${report.summary.sourceFiles} source files, ${report.summary.findings} findings, ${report.summary.safeFixCandidates} repair candidates. Report: ${out}`);
    } finally {if(work)await rm(work,{recursive:true,force:true});}
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
