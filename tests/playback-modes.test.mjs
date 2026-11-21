import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {BackgroundPlayer} from '../apps/companion/src/background-player.mjs';
import {ProfileBrowser} from '../apps/companion/src/profile-browser.mjs';
import core from '../packages/core/index.js';

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
