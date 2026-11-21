import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

test('actual companion entry point starts without npm dependencies and shuts down through authenticated setup', {timeout: 15000}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lan-tube-cli-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'lan-tube-cli-')));
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../apps/companion/src/index.mjs', import.meta.url))], {
    env: {...process.env, LAN_TUBE_PORT: String(port), LAN_TUBE_CDP_PORT: port === 9223 ? '9224' : '9223', LAN_TUBE_DATA_DIR: directory},
    windowsHide: true, stdio: 'ignore',
  });
  let exitCode;
  const exited = new Promise(resolve => child.once('exit', code => { exitCode = code; resolve(); }));
  t.after(async () => { if (exitCode === undefined) child.kill(); await exited; await rm(directory, {recursive: true, force: true}); });
  let setup;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { setup = new URL(await readFile(join(directory, 'setup-url.txt'), 'utf8')); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(setup, 'CLI saved its setup URL');
  const health = await (await fetch(setup.origin + '/v1/health')).json(); assert.equal(health.service, 'lan-tube');
  const response = await fetch(setup.origin + '/admin/stop', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Admin-Secret': setup.hash.slice(1)}, body: '{}'});
  assert.equal(response.status, 200); await exited; assert.equal(exitCode, 0);
});
