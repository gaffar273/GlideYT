import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PairingStore} from '../apps/companion/src/auth.mjs';
import {createCompanionServer} from '../apps/companion/src/server.mjs';
import core from '../packages/core/index.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lan-tube-http-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'lan-tube-http-')));
  const pairing = await new PairingStore(join(directory, 'devices.json')).load();
  const filename = 'glide-yt-1.2.3.apk';
  await writeFile(join(directory, 'build-report.json'), JSON.stringify({apk: filename}));
  await writeFile(join(directory, filename), 'test APK bytes');
  const commands = [];
  const browser = {state: async () => ({connected: true, title: 'Test video'}), command: async value => { commands.push(value); return {ok: true}; }, search: async () => ({ok: true, results: []}), open: async () => ({ok: true})};
  const {server, adminSecret} = createCompanionServer({browser, pairing, apkDirectory: directory});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive: true, force: true}); });
  return {url: 'http://127.0.0.1:' + server.address().port, pairing, commands, adminSecret};
}
test('end-to-end pairing, authorized controls, search, and revocation', async t => {
  const {url, pairing, commands} = await setup(t);
  const initial = core.createClient(url);
  await assert.rejects(initial.state(), {status: 401});
  const paired = await initial.pair(pairing.code, 'Phone');
  const client = core.createClient(url, paired.token);
  assert.equal((await client.state()).title, 'Test video');
  await client.command({type: 'select', videoId: 'dQw4w9WgXcQ'});
  assert.equal(commands[0].videoId, 'dQw4w9WgXcQ');
  assert.deepEqual((await client.search('test')).results, []);
  await client.unpair(); await assert.rejects(client.state(), {status: 401});
});
test('phone installation serves only the fixed APK and never reveals the pairing code', async t => {
  const {url, pairing} = await setup(t);
  const page = await fetch(url + '/install'); assert.equal(page.status, 200);
  assert.equal((await page.text()).includes(pairing.code), false);
  const apk = await fetch(url + '/download/android.apk');
  assert.equal(apk.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(apk.headers.get('content-disposition'), 'attachment; filename="glide-yt-1.2.3.apk"');
  assert.equal(await apk.text(), 'test APK bytes');
  assert.equal((await fetch(url + '/download/devices.json')).status, 401);
});
test('setup code is protected and browser cross-origin requests are denied', async t => {
  const {url, pairing, adminSecret} = await setup(t);
  const denied = await fetch(url + '/admin/status'); assert.equal(denied.status, 403);
  const allowed = await fetch(url + '/admin/status', {headers: {'X-Admin-Secret': adminSecret}});
  assert.equal(allowed.status, 200); assert.equal((await allowed.json()).pairing.code, pairing.code);
  const evil = await fetch(url + '/v1/pair', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://evil.example'}, body: JSON.stringify({code: pairing.code})});
  assert.equal(evil.status, 403);
  const health = await fetch(url + '/v1/health'); assert.equal(JSON.stringify(await health.json()).includes(pairing.code), false);
});
test('HTTP rejects malformed, oversized, and unsupported commands', async t => {
  const {url, pairing} = await setup(t);
  const {token} = await core.createClient(url).pair(pairing.code, 'Phone');
  const headers = {'Content-Type': 'application/json', Authorization: 'Bearer ' + token};
  for (const [body, status] of [['{bad', 400], [JSON.stringify({type: 'navigate', url: 'file:///x'}), 400], ['{"data":"' + 'x'.repeat(5000) + '"}', 413]]) {
    const response = await fetch(url + '/v1/command', {method: 'POST', headers, body}); assert.equal(response.status, status);
  }
});
