/** ZIP32/ZIP64 disk-backed streaming extraction. No code execution.
 * Operational budgets are configurable; validated paths and CRC32 are mandatory.
 */
import {open,mkdir} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createInflateRaw} from 'node:zlib';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
const U16=0xffff,U32=0xffffffff;
const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;})();
function crcNext(crc,b){let c=crc;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return c;}
function num(big,label){if(big>BigInt(Number.MAX_SAFE_INTEGER))throw new Error(`ZIP64 ${label} exceeds JavaScript safe integer range`);return Number(big);}
async function bytes(fd,size,pos){const b=Buffer.alloc(size);let n=0;while(n<size){const x=await fd.read(b,n,size-n,pos+n);if(!x.bytesRead)throw new Error('Truncated ZIP archive');n+=x.bytesRead;}return b;}
function safe(raw){const name=raw.replaceAll('\\','/');if(!name||name.startsWith('/')||/(^|\/)\.\.(\/|$)/.test(name)||/(^|\/)\.(\/|$)/.test(name)||/^[A-Z]:/i.test(name)||/[\x00-\x1f:]/.test(name))throw new Error(`Unsafe ZIP path: ${raw.slice(0,120)}`);return name;}
function zip64Extra(buffer,uncompressed,compressed,offset){let p=0;while(p+4<=buffer.length){const id=buffer.readUInt16LE(p),len=buffer.readUInt16LE(p+2);p+=4;if(p+len>buffer.length)throw new Error('Truncated ZIP extra field');if(id===1){let k=p;function next(){if(k+8>p+len)throw new Error('Missing ZIP64 extra value');const n=num(buffer.readBigUInt64LE(k),'size');k+=8;return n;}
    return {uncompressed:uncompressed===U32?next():uncompressed,compressed:compressed===U32?next():compressed,offset:offset===U32?next():offset};}
    p+=len;}
  throw new Error('Missing ZIP64 size/offset extra field');}
export async function indexZipArchive(filename,{maxArchiveBytes=Number.POSITIVE_INFINITY}={}) {
  const fd=await open(filename,'r');
  try {
    const stat=await fd.stat();if(stat.size>maxArchiveBytes)throw new Error('Compressed ZIP exceeds configured storage budget');
    if(stat.size<22)throw new Error('Invalid ZIP archive');
    const tailSize=Math.min(stat.size,65557),start=stat.size-tailSize,tail=await bytes(fd,tailSize,start);
    let eocd=-1;
    for(let p=tail.length-22;p>=0;p--)if(tail.readUInt32LE(p)===0x06054b50&&p+22+tail.readUInt16LE(p+20)===tail.length){eocd=p;break;}
    if(eocd<0)throw new Error('Invalid ZIP end record');
    if(tail.readUInt16LE(eocd+4)||tail.readUInt16LE(eocd+6))throw new Error('Multi-disk ZIP not supported');
    let count=tail.readUInt16LE(eocd+10),cdSize=tail.readUInt32LE(eocd+12),cdOffset=tail.readUInt32LE(eocd+16);
    if(count===U16||cdSize===U32||cdOffset===U32){
      const locOff=start+eocd-20;if(locOff<0)throw new Error('Missing ZIP64 end locator');
      const loc=await bytes(fd,20,locOff);if(loc.readUInt32LE(0)!==0x07064b50)throw new Error('Missing ZIP64 locator');
      const hdr=await bytes(fd,56,num(loc.readBigUInt64LE(8),'end offset'));
      if(hdr.readUInt32LE(0)!==0x06064b50)throw new Error('Invalid ZIP64 end record');
      count=num(hdr.readBigUInt64LE(32),'entry count');cdSize=num(hdr.readBigUInt64LE(40),'directory size');cdOffset=num(hdr.readBigUInt64LE(48),'directory offset');
    }
    if(cdOffset+cdSize>stat.size)throw new Error('ZIP central directory exceeds archive boundaries');
    const records=[];let p=cdOffset;
    for(let i=0;i<count;i++){
      const h=await bytes(fd,46,p);if(h.readUInt32LE(0)!==0x02014b50)throw new Error('Invalid ZIP central header');
      const flags=h.readUInt16LE(8),method=h.readUInt16LE(10),crc=h.readUInt32LE(16);
      const compressed32=h.readUInt32LE(20),uncompressed32=h.readUInt32LE(24),filenameLen=h.readUInt16LE(28),extraLen=h.readUInt16LE(30),commentLen=h.readUInt16LE(32);
      const unixType=(h.readUInt32LE(38)>>>16)&0xf000;
      const offset32=h.readUInt32LE(42);
      if(flags&1||flags&0x40)throw new Error('Encrypted ZIP not supported');
      if(![0,8].includes(method))throw new Error('Unsupported ZIP compression algorithm');
      if(unixType===0xa000)throw new Error('ZIP symlink not allowed');
      if(unixType!==0&&unixType!==0x8000&&unixType!==0x4000)throw new Error('Special ZIP file type not allowed');
      const tail=await bytes(fd,filenameLen+extraLen,p+46);
      const raw=tail.subarray(0,filenameLen).toString('utf8');const name=safe(raw);
      let compressed=compressed32,uncompressed=uncompressed32,offset=offset32;
      if([compressed32,uncompressed32,offset32].includes(U32))({compressed,uncompressed,offset}=zip64Extra(tail.subarray(filenameLen),uncompressed32,compressed32,offset32));
      if(!name.endsWith('/')&&unixType!==0x4000)records.push({name,compressed,uncompressed,offset,method,crc});
      p+=46+filenameLen+extraLen+commentLen;
    }
    if(p>cdOffset+cdSize)throw new Error('Invalid ZIP central directory bounds');
    return {records,archiveBytes:stat.size};
  }finally{await fd.close();}
}
export async function extractZipToDirectory(archive,destination,{maxExpandedBytes=3*1024**3,maxArchiveBytes=1024**3,onProgress}={}) {
  const {records,archiveBytes}=await indexZipArchive(archive,{maxArchiveBytes});
  const dirname=records[0]?.name.split('/')[0],codeDirectories=new Set(['src','lib','app','pages','public','assets','test','tests','docs']);
  const prefix=dirname&&!codeDirectories.has(dirname.toLowerCase())&&records.every(r=>r.name.startsWith(`${dirname}/`))?`${dirname}/`:'';
  const seen=new Set();let total=0,entries=0;
  const fd=await open(archive,'r');
  try {
    for(const record of records){
      const file=safe(prefix?record.name.slice(prefix.length):record.name);
      if(seen.has(file))throw new Error(`Duplicate ZIP path: ${file}`);seen.add(file);
      if(total+record.uncompressed>maxExpandedBytes)throw new Error('Expanded ZIP exceeds configured storage safety budget');
      const header=await bytes(fd,30,record.offset);
      if(header.readUInt32LE(0)!==0x04034b50)throw new Error('Invalid ZIP local file header');
      const localNameLen=header.readUInt16LE(26),localExtraLen=header.readUInt16LE(28);
      const rawLocal=await bytes(fd,localNameLen,record.offset+30);
      if(rawLocal.toString('utf8')!==record.name)throw new Error('ZIP local/central filename mismatch');
      const start=record.offset+30+localNameLen+localExtraLen;
      if(start+record.compressed>archiveBytes)throw new Error('Invalid ZIP compressed data offset');
      const output=path.join(destination,...file.split('/'));
      await mkdir(path.dirname(output),{recursive:true});
      let checksum=0xffffffff,count=0;
      const verify=new Transform({transform(chunk,_,done){count+=chunk.length;total+=chunk.length;
        if(count>record.uncompressed||total>maxExpandedBytes){done(new Error('ZIP decompression exceeded size declaration or configured budget'));return;}
        checksum=crcNext(checksum,chunk);done(null,chunk);
      }});
      if(record.compressed===0&&record.uncompressed===0){
        // pipe an empty readable to create a 0-byte destination; avoids invalid negative range
        await pipeline((await import('node:stream')).Readable.from([]), verify, createWriteStream(output,{flags:'wx'}));
      }else{
        const input=createReadStream(archive,{start,end:start+record.compressed-1});
        const writer=createWriteStream(output,{flags:'wx'});
        if(record.method===8)await pipeline(input,createInflateRaw(),verify,writer);
        else await pipeline(input,verify,writer);
      }
      if(count!==record.uncompressed||((checksum^0xffffffff)>>>0)!==record.crc)throw new Error(`ZIP integrity failed: ${file}`);
      entries++;onProgress?.({entries,total,compressedBytes:archiveBytes,filename:file});
    }
    return {entries,expandedBytes:total,archiveBytes,normalizedRoot:prefix||null};
  }finally{await fd.close();}
}
