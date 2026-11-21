import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {parseRepo} from './github.mjs';
/** Stream public GitHub archives to disk; no arbitrary fetch destinations. */
export async function downloadPublicRepoFile(repository,filename,{maxBytes=1024**3,timeoutMs=180000,fetcher=fetch}={}) {
  const {owner,repo,ref}=parseRepo(repository);
  let url=`https://api.github.com/repos/${owner}/${repo}/zipball${ref?'/'+ref.split('/').map(encodeURIComponent).join('/'):''}`;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    let response;
    for(let i=0;i<5;i++) {
      response=await fetcher(url,{redirect:'manual',signal:controller.signal,headers:{Accept:'application/vnd.github+json','User-Agent':'CodeArchitectEngine/0.3','X-GitHub-Api-Version':'2022-11-28'}});
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('location');if(!location)throw new Error('GitHub redirect missing location');
      const target=new URL(location,url);
      if(target.protocol!=='https:'||!['codeload.github.com','api.github.com'].includes(target.hostname))throw new Error('Untrusted GitHub redirect');
      url=target.href;
    }
    if(!response?.ok||!response.body)throw new Error(`GitHub returned HTTP ${response?.status||'error'}`);
    let bytes=0;
    const quota=new Transform({transform(chunk,_,cb){bytes+=chunk.length;if(bytes>maxBytes)cb(new Error('GitHub archive exceeds configured storage budget'));else cb(null,chunk);}});
    await pipeline(response.body,quota,createWriteStream(filename,{flags:'wx'}));
    return {bytes,repository};
  }finally{clearTimeout(timeout);}
}
