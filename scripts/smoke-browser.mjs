// Real Chromium transport + DOM adapter smoke test with local fixtures, not live YouTube.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {BrowserController} from '../apps/companion/src/browser.mjs';
import {CdpConnection} from '../apps/companion/src/cdp.mjs';
import {verifyLiveYouTube} from './lib/live-youtube.mjs';

const root = new URL('../.local/browser-smoke/', import.meta.url);
await mkdir(root, {recursive: true});
const profile = fileURLToPath(new URL(`profile-${Date.now()}/`, root));
const executable = [process.env.LAN_TUBE_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path));
if (!executable) throw new Error('Install Chrome or Edge to run the browser smoke test.');
const child = spawn(executable, ['--headless=new', '--disable-gpu', '--in-process-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
let browserLog = ''; child.stderr.on('data', chunk => { browserLog = (browserLog + chunk.toString()).slice(-4000); });
let connection, fixtureServer, browser;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let port;
  for (let i = 0; i < 60; i++) {
    try { port = Number((await readFile(profile + '/DevToolsActivePort', 'utf8')).split('\n')[0]); break; } catch {}
    await delay(200);
  }
  assert.ok(port, 'Browser exposed a loopback CDP endpoint');
  console.log('Browser launched; connecting to CDP.');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === 'page');
  connection = new CdpConnection(target.webSocketDebuggerUrl, {timeout: process.argv.includes('--live') ? 15000 : 2500}); await connection.ready;
  if (process.argv.includes('--live')) {
    await verifyLiveYouTube(connection, port, target.id, root);
  } else {
  const wave = Buffer.alloc(44 + 8000 * 2 * 4);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40);
  const fixture = '<!doctype html><title>Fixture video - YouTube</title><video class="html5-main-video" controls src="data:audio/wav;base64,' + wave.toString('base64') + '"></video>';
  const search = '<script>var ytInitialData = ' + JSON.stringify({contents: {videoRenderer: {videoId: 'abcdefghijk', title: {simpleText: 'Fixture result'}}}}) + ';</script>';
  fixtureServer = createServer((request, response) => {
    response.writeHead(200, {'Content-Type': 'text/html'});
    response.end(request.url.startsWith('/results') ? search : fixture);
  });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
  console.log('Loading the local player fixture.');
  await connection.send('Page.navigate', {url: fixtureOrigin + '/watch?v=dQw4w9WgXcQ'});
  browser = new BrowserController({port, connect: () => ({
    connected: true, ready: connection.ready,
    // Only this test harness substitutes the fixture origin. Product code is unchanged.
    evaluate: expression => connection.evaluate(`(()=>{ const location = {hostname:'www.youtube.com', href:window.location.href.replace(${JSON.stringify(fixtureOrigin)}, 'https://www.youtube.com')}; return ${expression}; })()`),
    send: (method, params) => connection.send(method, method === 'Page.navigate' ? {...params, url: params.url.replace('https://www.youtube.com', fixtureOrigin)} : params),
    close() {},
  })});
  browser.targetId = target.id;
  let state;
  for (let i = 0; i < 15; i++) {
    state = await browser.state();
    if (state.ready) break;
    assert.equal(state.connected, true, JSON.stringify(state));
    await delay(100);
  }
  assert.equal(state.ready, true, JSON.stringify(state));
  console.log('Player fixture is ready.');
  assert.equal(state.videoId, 'dQw4w9WgXcQ');
  await browser.command({type: 'play'}); assert.equal((await browser.state()).playing, true);
  await browser.command({type: 'pause'}); assert.equal((await browser.state()).playing, false);
  const before = browser.targetId;
  const results = await browser.search('fixture'); assert.equal(results.results[0].videoId, 'abcdefghijk');
  assert.equal((await browser.state()).videoId, 'dQw4w9WgXcQ', 'Search does not navigate away from playback');
  await browser.command({type: 'select', videoId: 'abcdefghijk'});
  for (let i = 0; i < 30; i++) { state = await browser.state(); if (state.videoId === 'abcdefghijk' && state.ready) break; await delay(100); }
  assert.equal(state.videoId, 'abcdefghijk'); assert.equal(browser.targetId, before);
  const after = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  // Edge can expose its internal sync-confirmation dialog as a page target. It is not a playback tab.
  assert.equal(after.filter(item => item.type === 'page' && item.url.startsWith(fixtureOrigin + '/')).length, 1, 'Selections reuse exactly one playback tab');
  console.log('PASS: real CDP playback, pause, search without navigation, and same-target video selection.');


  }
} catch (error) {
  console.error('Browser smoke failed:', error);
  console.error(browserLog);
  process.exitCode = 1;
} finally {
  browser?.close();
  if (connection) { try { await connection.send('Browser.close'); } catch {} connection.close(); }
  if (fixtureServer) fixtureServer.close();
  child.kill();
}
