import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rename, unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash, randomBytes} from 'node:crypto';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function downloadVerified(url, destination, expected, {fetcher = fetch, maxBytes = 500 * 1024 * 1024} = {}) {
  if (new URL(url).protocol !== 'https:' || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('A secure URL and SHA-256 checksum are required.');
  try { if (await sha256(destination) === expected) return destination; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(destination), {recursive: true});
  const temporary = destination + '.' + randomBytes(6).toString('hex') + '.partial';
  try {
    const response = await fetcher(url, {signal: AbortSignal.timeout(600000)});
    if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
    let bytes = 0;
    const hash = createHash('sha256');
    const meter = new Transform({transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) callback(new Error('Download exceeded its size limit.'));
      else { hash.update(chunk); callback(null, chunk); }
    }});
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporary, {flags: 'wx'}));
    if (hash.digest('hex') !== expected) throw new Error('Download checksum mismatch. The file was not installed.');
    await rename(temporary, destination);
    return destination;
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
