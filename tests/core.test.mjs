import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../packages/core/index.js';

test('commands accept only bounded parameters and strip unrelated fields', () => {
  assert.deepEqual(core.validateCommand({type: 'select', videoId: 'dQw4w9WgXcQ', url: 'file:///secret'}), {type: 'select', videoId: 'dQw4w9WgXcQ'});
  for (const value of [{type: 'navigate'}, {type: 'select', videoId: '../x'}, {type: 'seek', seconds: -1}, {type: 'seek', seconds: Infinity}, {type: 'volume', level: 2}, null]) {
    assert.throws(() => core.validateCommand(value));
  }
  assert.deepEqual(core.validateCommand({type: 'pause', script: 'arbitrary'}), {type: 'pause'});
});
test('connection addresses remain on private IPv4 networks', () => {
  assert.equal(core.normalizeAddress('192.168.1.4'), 'http://192.168.1.4:3210');
  assert.equal(core.normalizeAddress('10.0.0.2:4000'), 'http://10.0.0.2:4000');
  for (const value of ['https://192.168.1.4', '8.8.8.8', 'example.com', 'http://user:pass@10.0.0.2', '10.0.0.2/path', '172.40.1.1', 'file:///x']) {
    assert.throws(() => core.normalizeAddress(value));
  }
});
test('queries and playback labels handle invalid inputs', () => {
  assert.equal(core.validateQuery('  hello  '), 'hello');
  assert.throws(() => core.validateQuery(' ')); assert.throws(() => core.validateQuery('x'.repeat(161)));
  assert.equal(core.formatTime(65.8), '1:05'); assert.equal(core.formatTime(NaN), '0:00');
});
test('shared client sends authentication and surfaces revoked sessions', async () => {
  const requests = [];
  const client = core.createClient('192.168.1.4', 'token', async (url, options) => {
    requests.push({url, options});
    return {ok: false, status: 401, json: async () => ({error: 'Revoked'})};
  });
  await assert.rejects(client.command({type: 'play'}), error => error.status === 401 && error.message === 'Revoked');
  assert.equal(requests[0].url, 'http://192.168.1.4:3210/v1/command');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer token');
  assert.equal(requests[0].options.body, '{"type":"play"}');
});
