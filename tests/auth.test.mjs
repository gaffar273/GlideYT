import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PairingStore} from '../apps/companion/src/auth.mjs';
import {createHash, createHmac} from 'node:crypto';
import {discoveryReply} from '../apps/companion/src/discovery.mjs';

async function store(t, options) {
  const directory = await mkdtemp(join(tmpdir(), 'lan-tube-test-'));
  assert.ok(directory.startsWith(join(tmpdir(), 'lan-tube-test-')));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return new PairingStore(join(directory, 'devices.json'), options).load();
}
test('pairing persists hashes, survives restarts, rotates codes, and supports revocation', async t => {
  const auth = await store(t);
  const code = auth.currentCode().code;
  const result = await auth.pair(code, 'My phone', '192.168.1.1');
  assert.match(result.token, /^[a-f0-9]{64}$/);
  assert.equal(auth.authenticate('Bearer ' + result.token).name, 'My phone');
  const saved = await readFile(auth.file, 'utf8');
  assert.equal(saved.includes(result.token), false); assert.equal(Object.hasOwn(JSON.parse(saved), 'code'), false);
  const reloaded = await new PairingStore(auth.file).load();
  assert.equal(reloaded.laptopId, result.laptopId);
  assert.equal(reloaded.list()[0].connected, false);
  assert.equal(reloaded.authenticate('Bearer ' + result.token).id, result.deviceId);
  await assert.rejects(auth.pair(code, 'Other', '192.168.1.2'), {status: 401});
  await reloaded.revoke(result.deviceId);
  assert.throws(() => reloaded.authenticate('Bearer ' + result.token), {status: 401});
});

test('address discovery signs the current addresses for a remembered phone across a restart', async t => {
  const storeBefore = await store(t);
  const {token,deviceId} = await storeBefore.pair(storeBefore.code, 'Phone', 'wifi');
  const after = await new PairingStore(storeBefore.file).load();
  const key = createHash('sha256').update(token).digest();
  const sign = message => createHmac('sha256', key).update(message).digest('hex');
  const nonce = '01'.repeat(16);
  const query = 'GlideYT-find ' + nonce + ' ' + sign('find ' + nonce);
  const addresses = ['http://192.168.1.99:3210'];
  const message = 'GlideYT-here ' + nonce + ' ' + addresses[0];
  assert.equal(discoveryReply(query, after.devices, addresses), message + ' ' + sign(message));
  assert.equal(discoveryReply(query.replace(nonce, 'ff'.repeat(16)), after.devices, addresses), undefined);
  await after.revoke(deviceId);
  assert.equal(discoveryReply(query, after.devices, addresses), undefined);
});
test('codes expire and unicode input is rejected cleanly', async t => {
  let now = 1000; const auth = await store(t, {now: () => now}); const code = auth.code;
  await assert.rejects(auth.pair('éééééé', 'x', 'a'), {status: 401});
  now += 300001;
  await assert.rejects(auth.pair(code, 'x', 'a'), {status: 401});
});
test('pairing guesses are rate-limited', async t => {
  const auth = await store(t);
  for (let i = 0; i < 5; i++) await assert.rejects(auth.pair('bad', 'x', 'a'), {status: 401});
  await assert.rejects(auth.pair(auth.code, 'x', 'a'), {status: 429});
});
test('a one-time code cannot be consumed by concurrent pairing requests', async t => {
  const auth = await store(t); const code = auth.code;
  const results = await Promise.allSettled([auth.pair(code, 'A', 'a'), auth.pair(code, 'B', 'b')]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
});

test('re-pairing rotates one phone token and preserves other phones with the same model', async t => {
  const auth = await store(t);
  const firstId = '45ba4c10-f43a-4f3f-968a-d02b1dddac00';
  const otherId = '45ba4c10-f43a-4f3f-968a-d02b1dddac01';
  const first = await auth.pair(auth.code, 'Pixel', 'a', firstId);
  const second = await auth.pair(auth.code, 'Pixel', 'a', otherId);
  const renewed = await auth.pair(auth.code, 'Pixel', 'b', firstId);
  assert.equal(first.deviceId, renewed.deviceId);
  assert.throws(() => auth.authenticate('Bearer ' + first.token), {status: 401});
  const reloaded = await new PairingStore(auth.file).load();
  assert.equal(reloaded.list().length, 2);
  assert.equal(reloaded.authenticate('Bearer ' + renewed.token).id, renewed.deviceId);
  assert.equal(reloaded.authenticate('Bearer ' + second.token).id, second.deviceId);
});

test('an authenticated older phone upgrades its own pairing without merging unidentified tokens', async t => {
  const auth = await store(t);
  const old = await auth.pair(auth.code, 'My Android', 'a');
  const current = await auth.pair(auth.code, 'My Android', 'a');
  const phoneId = '45ba4c10-f43a-4f3f-968a-d02b1dddac00';
  await auth.identify('Bearer ' + current.token, phoneId, 'Pixel');
  await auth.identify('Bearer ' + current.token, phoneId, 'Pixel');
  await assert.rejects(auth.identify('Bearer ' + old.token, phoneId, 'Pixel'), {status: 409});
  assert.deepEqual(auth.list().map(item => [item.name, item.legacy]), [['My Android', true], ['Pixel', false]]);
  assert.equal((await auth.pair(auth.code, 'Pixel', 'a', phoneId)).deviceId, current.deviceId);
});
