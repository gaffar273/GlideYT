import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BackgroundPlayer} from '../apps/companion/src/background-player.mjs';
import {ProfileBrowser} from '../apps/companion/src/profile-browser.mjs';
import core from '../packages/core/index.js';

test('background setup launches locally once and restores the dedicated profile without opening a window', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'glide-background-'));
  t.after(() => rm(directory, {recursive:true,force:true}));
  const file = join(directory, 'background-controls.json');
  const opens = [], restores = [], songs = [];
  let disconnect;
  const player = () => ({targetId:'tab-one', socket:{connected:true,send:async () => {}},
    onDisconnect(fn) { disconnect = fn; }, close() {}, async command(value) { songs.push(value); return {ok:true}; }});
  const open = async (browser, portFile) => { opens.push(portFile); return player(); };
  let closed = false;
  const connect = async (browser, title, portFile, targetId) => {
    restores.push({portFile,targetId});
    if (closed) throw Error('Open YouTube');
    return player();
  };
  const first = new ProfileBrowser(file, connect, open);
  first.request = async () => 'msedge';
  await first.loadBackground();
  assert.equal(restores.length, 0);
  await first.enableBackground();
  await first.enableBackground();
  const portFile = join(directory,'youtube-msedge','DevToolsActivePort');
  assert.deepEqual(opens,[portFile]);
  assert.deepEqual(JSON.parse(await readFile(file)), {mode:'dedicated',browser:'msedge',targetId:'tab-one'});
  for (const videoId of ['dQw4w9WgXcQ','abcdefghijk']) await first.command({type:'select',videoId});
  assert.equal(songs.length, 2);
  first.close();

  const restarted = new ProfileBrowser(file, connect, open);
  await restarted.loadBackground();
  await restarted.connecting;
  assert.deepEqual(restores,[{portFile,targetId:'tab-one'}]);
  closed = true;
  disconnect();
  await assert.rejects(restarted.command({type:'select',videoId:'abcdefghijk'}), /Open YouTube/);
  assert.deepEqual(opens,[portFile]);
  await restarted.open();
  assert.deepEqual(opens,[portFile,portFile]);
  restarted.close();
});

test('Suggested returns distinct related videos in page order before mixes and plays the tapped one', async () => {
  const location = new URL('https://www.youtube.com/watch?v=abcdefghijk');
  let destination;
  location.assign = url => { destination = url.href; };
  const link = (path, title) => ({href:new URL(path, location).href, title, textContent:'', getAttribute:() => null});
  const links = [
    link('/watch?v=abcdefghijk', 'Already playing'),
    link('/watch?v=abcdefghij1', '3:25'),
    link('/watch?v=abcdefghij1', 'First suggestion'),
    link('/watch?v=abcdefghij1', 'First suggestion again'),
    link('/watch?v=abcdefghij2', 'Second suggestion'),
    link('https://example.org/watch?v=abcdefghij3', 'External')
  ];
  const document = {title:'Current', getElementById:() => null, querySelectorAll:() => links,
    querySelector:selector => selector.includes('#related') ? {querySelectorAll:() => links} : null};
  const player = new BackgroundPlayer({async send(_, {expression}) {
    return {result:{value:await runInNewContext(expression,{URL,location,document})}};
  }}, 'session', 'tab');
  const {playlists} = await player.command({type:'suggested'});
  assert.deepEqual(Array.from(playlists, item => item.listId || item.title),
    ['First suggestion','Second suggestion','RDabcdefghijk']);
  assert.equal(destination, undefined);
  await player.command({type:'select',videoId:playlists[1].videoId});
  assert.equal(destination,'https://www.youtube.com/watch?v=abcdefghij2');
});

test('only detaching the controlled session closes its transport', () => {
  const transport = new EventTarget();
  let disconnected = 0;
  const player = new BackgroundPlayer({socket:transport, close() {
    transport.dispatchEvent(new Event('close'));
  }}, 'saved-session', 'tab-one');
  player.onDisconnect(() => disconnected++);
  const detach = sessionId => transport.dispatchEvent(new MessageEvent('message', {
    data:JSON.stringify({method:'Target.detachedFromTarget', params:{sessionId}})
  }));
  detach('another-session');
  assert.equal(disconnected, 0);
  detach('saved-session');
  assert.equal(disconnected, 1);
});

test('repeat and shuffle follow player state and an absent quality menu gives no choices', async () => {
  const location = new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest');
  const video = {duration:100, readyState:4, loop:false};
  const shuffle = {pressed:false, getAttribute() { return String(this.pressed); }, click() { this.pressed = !this.pressed; }};
  const document = {title:'Test', getElementById:() => null, querySelector(selector) {
    if (selector.startsWith('video')) return video;
    if (selector.startsWith('ytd-playlist-panel')) return shuffle;
    return null;
  }};
  const player = new BackgroundPlayer({async send(_, {expression}) {
    return {result:{value:await runInNewContext(expression,{URL,location,document})}};
  }}, 'session', 'tab');
  assert.equal((await player.command({type:'repeat',enabled:true})).state.repeat,true);
  assert.equal((await player.command({type:'repeat',enabled:false})).state.repeat,false);
  await player.command({type:'shuffle',enabled:true});
  assert.equal((await player.command({type:'shuffle',enabled:true})).state.shuffle,true);
  assert.equal((await player.command({type:'quality'})).options.length,0);
  location.search='?v=dQw4w9WgXcQ';
  assert.equal((await player.command({type:'state'})).shuffle,null);
  video.duration=Infinity;
  assert.equal((await player.command({type:'state'})).repeat,null);
});

test('sleep timer replaces, cancels, and pauses once at expiry without phone polling', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const player = new ProfileBrowser();
  const calls = [];
  player.request = async value => { calls.push(value.type); return {ready:true}; };
  const sleep = minutes => player.command({type:'sleep',minutes});
  assert.equal((await sleep(15)).state.sleepUntil,901000);
  await sleep(30);
  t.mock.timers.tick(900000);
  assert.ok(!calls.includes('pause'));
  await sleep(0);
  t.mock.timers.tick(1800000);
  assert.ok(!calls.includes('pause'));
  await sleep(15);
  t.mock.timers.tick(900000);
  assert.equal(calls.filter(c => c === 'pause').length,1);
  assert.equal((await player.state()).sleepUntil,0);
  for (const input of [{type:'repeat',enabled:'false'},{type:'shuffle'},{type:'sleep',minutes:-1}]) assert.throws(() => core.validateCommand(input));
  player.close();
});

test('quality lookup closes the settings menu after a timeout and still applies available resolutions', async () => {
  let expanded = false, hasQuality = false, submenu = false, applied = false;
  const button = {getAttribute:() => String(expanded), click() { expanded = !expanded; submenu = false; }};
  const item = {querySelector:() => ({textContent:'Quality'}), click() { submenu = true; }};
  const row = {textContent:'720p', getAttribute:() => 'true', click() { applied = true; }};
  const menu = {
    querySelector:() => button,
    querySelectorAll:selector => selector === '.ytp-menuitem' ? (hasQuality ? [item] : []) : (submenu ? [row] : []),
  };
  const location = new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const player = new BackgroundPlayer({async send(_, {expression}) {
    return {result:{value:await runInNewContext(expression,{location,URL,document:{getElementById:()=>menu},setTimeout:resolve=>resolve()})}};
  }}, 'session', 'tab');
  assert.equal((await player.command({type:'quality'})).options.length,0);
  assert.equal(expanded,false);
  hasQuality = true;
  assert.equal((await player.command({type:'quality'})).current,'720p');
  await player.command({type:'quality',option:'720p'});
  assert.ok(applied); assert.equal(expanded,false);
});
