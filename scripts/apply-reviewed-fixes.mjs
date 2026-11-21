#!/usr/bin/env node
// Applies explicitly listed conservative patches to a local copy. Does not execute project code.
import {readFile,writeFile,mkdir,cp,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function main(){
  const [, , source,reportPath,dest,...fixIds]=process.argv;
  if(!source||!reportPath||!dest||!fixIds.length)throw new Error('Usage: node scripts/apply-reviewed-fixes.mjs SOURCE_FOLDER REPORT.json NEW_OUTPUT_FOLDER FIX_ID ...');
  const input=path.resolve(source),out=path.resolve(dest),base=path.parse(input).root;
  if(input===out||out.startsWith(input+path.sep)||input.startsWith(out+path.sep)||out===base)throw new Error('Output must be a separate, non-overlapping folder');
  if(!(await stat(input)).isDirectory())throw new Error('Source must be a directory');
  const report=JSON.parse(await readFile(reportPath,'utf8'));
  if(new Set(fixIds).size!==fixIds.length)throw new Error('Duplicate fix identifiers');
  const selected=fixIds.map(id=>{const x=report.fixes?.find(f=>f.id===id);if(!x||x.rule!=='unused-named-import')throw new Error(`Unknown or non-conservative fix: ${id}`);return x;});
  await cp(input,out,{recursive:true,errorOnExist:true,force:false,filter:src=>!/(^|\/)(node_modules|\.git)(\/|$)/.test(src.slice(input.length))});
  const groups=new Map();for(const x of selected){if(!groups.has(x.file))groups.set(x.file,[]);groups.get(x.file).push(x);}
  for(const [file,patches] of groups){const target=path.resolve(out,file);if(!target.startsWith(out+path.sep))throw new Error('Invalid patch path');const orig=await readFile(target);if(sha(orig)!==patches[0].fileHash)throw new Error(`Hash mismatch: ${file}`);
    let txt=orig.toString('utf8'),end=txt.length+1;
    for(const p of patches.sort((a,b)=>b.start-a.start)){
      if(p.end>end||txt.slice(p.start,p.end)!==p.before)throw new Error(`Patch overlap or mismatch: ${file}`);
      txt=txt.slice(0,p.start)+p.after+txt.slice(p.end);end=p.start;
    }
    await writeFile(target,txt);
  }
  console.log(`Applied ${selected.length} reviewed conservative patches to ${out}. Run your own build/tests; no semantic safety guarantee.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
