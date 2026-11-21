import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {downloadVerified} from '../scripts/lib/download.mjs';
import {within, npmCli} from '../scripts/lib/build-environment.mjs';

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lan-tube-download-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'lan-tube-download-')));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}
const checksum = value => createHash('sha256').update(value).digest('hex');
test('tool downloads validate SHA-256 and reuse verified cached files', async t => {
  const directory = await temporary(t), destination = join(directory, 'tool.zip');
  let requests = 0;
  const options = {fetcher: async () => { requests++; return new Response('verified bytes'); }};
  await downloadVerified('https://downloads.example/tool.zip', destination, checksum('verified bytes'), options);
  assert.equal(await readFile(destination, 'utf8'), 'verified bytes');
  await downloadVerified('https://downloads.example/tool.zip', destination, checksum('verified bytes'), options);
  assert.equal(requests, 1);
});
test('failed download integrity cannot replace an existing file', async t => {
  const directory = await temporary(t), destination = join(directory, 'tool.zip');
  await writeFile(destination, 'original');
  await assert.rejects(downloadVerified('https://downloads.example/tool.zip', destination, checksum('expected'), {
    fetcher: async () => new Response('incorrect'),
  }), /checksum mismatch/);
  assert.equal(await readFile(destination, 'utf8'), 'original');
});
test('tool downloads require HTTPS, a checksum, and bounded size', async t => {
  const directory = await temporary(t), destination = join(directory, 'tool.zip');
  await assert.rejects(downloadVerified('http://downloads.example/tool.zip', destination, checksum('x')), /secure URL/);
  await assert.rejects(downloadVerified('https://downloads.example/tool.zip', destination, 'invalid'), /checksum/);
  await assert.rejects(downloadVerified('https://downloads.example/tool.zip', destination, checksum('oversized'), {
    fetcher: async () => new Response('oversized'), maxBytes: 2,
  }), /size limit/);
});
test('managed tool paths cannot escape their root and npm is available without shell expansion', () => {
  const root = join(tmpdir(), 'lan-tube-managed');
  assert.throws(() => within(root, '..', 'outside'), /inside this project/);
  assert.equal(within(root, 'sdk'), join(root, 'sdk'));
  assert.match(npmCli(), /npm-cli\.js$/);
});
