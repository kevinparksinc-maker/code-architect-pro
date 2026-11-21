// Small, dependency-free ZIP reader/writer for bounded archive scanning.
// Supports stored/deflated ZIP32 entries. Rejects ZIP64, encryption, symlinks,
// unsafe paths, duplicate names and decompression bombs. Never extracts to disk.
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

export const MAX_ZIP_BYTES = 32 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;
export const MAX_FILES = 3500;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

function safeName(raw) {
  const name = raw.replaceAll('\\', '/');
  if (!name || name.startsWith('/') || name.startsWith('//') || /(^|\/)\.\.(\/|$)/.test(name) || /(^|\/)\.(\/|$)/.test(name) || /[\u0000-\u001f]/.test(name) || /^[a-zA-Z]:/.test(name) || name.includes(':')) throw new Error(`Unsafe ZIP entry path: ${raw.slice(0, 100)}`);
  return name.replace(/^\.\//, '');
}
function crcTable() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
}
const CRC_TABLE = crcTable();
function crc32(b) { let c = 0xffffffff; for (const v of b) c = CRC_TABLE[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function readZip(input) {
  const b = Buffer.from(input);
  if (b.length > MAX_ZIP_BYTES) throw new Error('ZIP exceeds the 32 MB compressed limit');
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: missing end-of-central-directory record');
  if (b.readUInt16LE(eocd + 4) !== 0 || b.readUInt16LE(eocd + 6) !== 0) throw new Error('Multi-disk ZIPs are not supported');
  const count = b.readUInt16LE(eocd + 10), cdSize = b.readUInt32LE(eocd + 12), cdOffset = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || count > MAX_FILES) throw new Error('ZIP64 or too many ZIP files');
  if (cdOffset + cdSize > eocd) throw new Error('Invalid ZIP central directory');
  let pos = cdOffset, total = 0;
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > eocd || b.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid ZIP central entry');
    const flags = b.readUInt16LE(pos + 8), method = b.readUInt16LE(pos + 10), crc = b.readUInt32LE(pos + 16);
    const compressed = b.readUInt32LE(pos + 20), uncompressed = b.readUInt32LE(pos + 24);
    const nameLength = b.readUInt16LE(pos + 28), extraLength = b.readUInt16LE(pos + 30), commentLength = b.readUInt16LE(pos + 32);
    const extAttr = b.readUInt32LE(pos + 38), offset = b.readUInt32LE(pos + 42);
    const end = pos + 46 + nameLength + extraLength + commentLength;
    if (end > eocd) throw new Error('Truncated ZIP central entry');
    const name = safeName(b.toString('utf8', pos + 46, pos + 46 + nameLength));
    pos = end;
    if ((flags & 1) || (flags & 0x40)) throw new Error('Encrypted ZIPs are not supported');
    if (!(method === 0 || method === 8)) throw new Error(`Unsupported ZIP compression method ${method}`);
    const fileType = (extAttr >>> 16) & 0xf000;
    if (fileType === 0xa000) throw new Error('ZIP symlinks are not allowed');
    if (name.endsWith('/')) continue;
    if (files.has(name)) throw new Error(`Duplicate ZIP path: ${name}`);
    total += uncompressed;
    if (uncompressed > MAX_ENTRY_BYTES || total > MAX_UNPACKED_BYTES) throw new Error('ZIP entry or expanded archive exceeds safety limits');
    if (offset + 30 > b.length || b.readUInt32LE(offset) !== 0x04034b50) throw new Error('Invalid ZIP local header');
    const localNameLen = b.readUInt16LE(offset + 26), localExtraLen = b.readUInt16LE(offset + 28);
    const localName = b.toString('utf8', offset + 30, offset + 30 + localNameLen);
    if (localName !== name) throw new Error('ZIP local/central name mismatch');
    const start = offset + 30 + localNameLen + localExtraLen;
    if (start + compressed > b.length) throw new Error('Truncated ZIP file data');
    const data = method === 0 ? Buffer.from(b.subarray(start, start + compressed)) : inflateRawSync(b.subarray(start, start + compressed), { maxOutputLength: MAX_ENTRY_BYTES + 1 });
    if (data.length !== uncompressed || crc32(data) !== crc) throw new Error(`ZIP integrity check failed for ${name}`);
    files.set(name, data);
  }
  // GitHub archives include a generated top-level folder. Normalize only if shared by every file.
  const names = [...files.keys()], prefix = names.length && names.every(n => n.startsWith(names[0].split('/')[0] + '/')) ? names[0].split('/')[0] + '/' : '';
  if (!prefix) return files;
  return new Map([...files].map(([name, data]) => [name.slice(prefix.length), data]));
}

export function createZip(files) {
  if (files.size > MAX_FILES) throw new Error('Too many output files');
  const locals = [], centrals = [];
  let offset = 0, size = 0;
  for (const [nameRaw, dataRaw] of files) {
    const name = safeName(nameRaw), nameBytes = Buffer.from(name, 'utf8'), data = Buffer.from(dataRaw);
    size += data.length;
    if (size > MAX_UNPACKED_BYTES) throw new Error('Output ZIP exceeds size limit');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const central = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
