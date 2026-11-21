import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PairingStore} from '../apps/companion/src/auth.mjs';

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
  assert.equal(reloaded.authenticate('Bearer ' + result.token).id, result.deviceId);
  await assert.rejects(auth.pair(code, 'Other', '192.168.1.2'), {status: 401});
  await reloaded.revoke(result.deviceId);
  assert.throws(() => reloaded.authenticate('Bearer ' + result.token), {status: 401});
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
