import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserController} from '../apps/companion/src/browser.mjs';
import {CdpConnection} from '../apps/companion/src/cdp.mjs';

function controller() {
  const sent = []; let targets = [{id: 'one-tab', type: 'page', url: 'https://www.youtube.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/one-tab'}];
  const browser = new BrowserController({fetcher: async () => ({ok: true, json: async () => targets}),
    connect: () => ({connected: true, ready: Promise.resolve(), send: async (method, params) => { sent.push({method, params}); return {}; }, evaluate: async () => ({ok: true, results: []}), close() {}})});
  return {browser, sent, setTargets: value => { targets = value; }};
}
test('video selections navigate the same existing target and never create tabs', async () => {
  const {browser, sent} = controller();
  await browser.command({type: 'select', videoId: 'dQw4w9WgXcQ'});
  await browser.command({type: 'select', videoId: 'abcdefghijk'});
  assert.equal(browser.targetId, 'one-tab');
  assert.equal(sent.length, 2);
  assert.equal(sent.every(item => item.method === 'Page.navigate'), true);
  assert.equal(sent[1].params.url, 'https://www.youtube.com/watch?v=abcdefghijk');
});
test('a closed target does not silently switch control to another tab', async () => {
  const {browser, setTargets} = controller(); await browser.attach(); browser.connection.connected = false;
  setTargets([{id: 'another-tab', type: 'page', url: 'https://www.youtube.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/other'}]);
  const result = await browser.state(); assert.equal(result.connected, false); assert.match(result.error, /closed/);
});
test('search caching avoids duplicate work and invalid commands cannot navigate', async () => {
  const {browser, sent} = controller(); let evaluations = 0;
  await browser.attach(); browser.connection.evaluate = async () => { evaluations++; return {ok: true, results: []}; };
  await browser.search('hello'); await browser.search('hello'); assert.equal(evaluations, 1);
  assert.throws(() => browser.command({type: 'select', videoId: 'file:///secret'})); assert.equal(sent.length, 0);
});
test('explicit local reopen reconnects to a replacement YouTube tab instead of retaining the old socket', async () => {
  const {browser, setTargets, sent} = controller();
  const previous = await browser.attach(); let closed = false;
  previous.close = () => { closed = true; };
  setTargets([
    {id: 'one-tab', type: 'page', url: 'edge://sync-confirmation-dialog/', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/old'},
    {id: 'replacement', type: 'page', url: 'https://www.youtube.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/replacement'},
  ]);
  await browser.open();
  assert.equal(closed, true); assert.equal(browser.targetId, 'replacement');
  assert.notEqual(browser.connection, previous); assert.equal(sent.at(-1).method, 'Page.bringToFront');
});
test('CDP refuses off-device debugging sockets', () => {
  assert.throws(() => new CdpConnection('ws://192.168.1.4:9223/devtools/page/x'));
});
test('concurrent first requests share one browser connection', async () => {
  let connections = 0;
  const browser = new BrowserController({
    fetcher: async () => ({ok: true, json: async () => [{id: 'one', type: 'page', url: 'https://www.youtube.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/test'}]}),
    connect: () => { connections++; return {connected: true, ready: Promise.resolve(), close() {}}; },
  });
  const [first, second] = await Promise.all([browser.attach(), browser.attach()]);
  assert.equal(first, second); assert.equal(connections, 1);
});
test('CDP correlates out-of-order replies and fails pending work on disconnect', async () => {
  class Socket extends EventTarget {
    readyState = 0;
    constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
    send(value) { this.last = JSON.parse(value); }
    reply(id, value) { this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({id, result: value})})); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  const connection = new CdpConnection('ws://127.0.0.1:9223/test', {WebSocketImpl: Socket});
  await connection.ready;
  const first = connection.send('First'), second = connection.send('Second');
  await Promise.resolve();
  connection.socket.reply(2, {value: 'second'}); connection.socket.reply(1, {value: 'first'});
  assert.deepEqual(await first, {value: 'first'}); assert.deepEqual(await second, {value: 'second'});
  const pending = connection.send('Third'); await Promise.resolve(); connection.close();
  await assert.rejects(pending, /lost/);
});
