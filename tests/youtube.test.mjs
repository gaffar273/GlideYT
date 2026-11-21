import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {parseSearchHtml, stateExpression, commandExpression, searchExpression} from '../apps/companion/src/youtube-page.mjs';

const oldVideo = {videoRenderer: {videoId: 'dQw4w9WgXcQ', title: {runs: [{text: 'Title " } ; test'}]}, ownerText: {runs: [{text: 'Channel'}]}, lengthText: {simpleText: '3:33'}}};
test('phone volume follows the YouTube control even when the video gain is normalized', async () => {
  const video = {volume: 0.5414};
  const player = {percent: 100, muted: false, getVolume() { return this.percent; },
    setVolume(percent) { this.percent = percent; }, isMuted() { return this.muted; }, unMute() { this.muted = false; }};
  const context = {URL, location: new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    document: {title: 'Demo', getElementById: () => player, querySelector: selector => selector.startsWith('video') ? video : null}};
  const state = () => runInNewContext(stateExpression, context);
  const set = level => runInNewContext(commandExpression({type: 'volume', level}), context);
  assert.equal(state().volume, 1);
  player.muted = true;
  assert.equal(state().volume, 0);
  assert.equal((await set(0.95)).state.volume, 0.95);
  assert.equal((await set(0)).state.volume, 0);
  assert.equal(video.volume, 0.5414);
  context.document.getElementById = () => null;
  assert.equal(state().volume, null);
  assert.equal((await set(1)).ok, false);
});
test('search parses quoted braces, deduplicates videos, and excludes promoted entries', () => {
  const data = {contents: {items: [oldVideo, oldVideo, {promotedVideoRenderer: oldVideo}, {videoRenderer: {videoId: 'invalid'}}]}};
  const result = parseSearchHtml('<script>var ytInitialData = ' + JSON.stringify(data) + ';</script>');
  assert.equal(result.ok, true); assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title, 'Title " } ; test'); assert.equal(result.results[0].channel, 'Channel');
});
test('search handles modern lockup results and account/consent pages', () => {
  const data = {contents: {lockupViewModel: {contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: 'abcdefghijk', metadata: {lockupMetadataViewModel: {title: {content: 'Modern result'}}}}}};
  assert.equal(parseSearchHtml('window["ytInitialData"] = ' + JSON.stringify(data)).results[0].title, 'Modern result');
  assert.equal(parseSearchHtml('<html>Please consent</html>').ok, false);
  assert.deepEqual(parseSearchHtml('var ytInitialData = {"contents":{"messageRenderer":{"text":"No results"}}}').results, []);
});
test('mixed search keeps a playlist distinct from its first video', () => {
  const playlist = {lockupViewModel: {contentId: 'PLabc', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
    metadata: {lockupMetadataViewModel: {title: {content: 'Episodes'}}},
    rendererContext: {commandContext: {onTap: {innertubeCommand: {watchEndpoint: {playlistId: 'PLabc', videoId: 'dQw4w9WgXcQ'}}}}}}};
  const data = {contents: [oldVideo, playlist, playlist]};
  const rows = parseSearchHtml('var ytInitialData = ' + JSON.stringify(data)).results;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].listId, 'PLabc');
  assert.equal(rows[1].videoId, rows[0].videoId);
  assert.equal(rows[1].title, 'Episodes');
});
test('search fetches in place without navigation and safely encodes text', async () => {
  const calls = [];
  const context = {location: {hostname: 'www.youtube.com'}, AbortController, setTimeout, clearTimeout, fetch: async (url) => {
    calls.push(url); return {ok: true, text: async () => 'var ytInitialData = ' + JSON.stringify({contents: oldVideo})};
  }};
  const result = await runInNewContext(searchExpression('hello & world "'), context);
  assert.equal(result.ok, true);
  assert.equal(calls[0], '/results?search_query=hello%20%26%20world%20%22');
  assert.equal(context.location.hostname, 'www.youtube.com');
});
test('player reads timeline, pauses, seeks, and explains blocked autoplay', async () => {
  const video = {paused: false, ended: false, currentTime: 8, duration: 60, volume: 1, readyState: 4, pause() { this.paused = true; }, play() { throw new Error('Blocked'); }};
  const context = {location: {hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}, URL,
    document: {title: 'Demo - YouTube', querySelector: selector => selector.startsWith('video') ? video : null}};
  const state = runInNewContext(stateExpression, context);
  assert.equal(state.position, 8); assert.equal(state.playing, true);
  const paused = await runInNewContext(commandExpression({type: 'pause'}), context);
  assert.equal(paused.state.playing, false); assert.equal(video.paused, true);
  await runInNewContext(commandExpression({type: 'seek', seconds: 100}), context); assert.equal(video.currentTime, 60);
  assert.equal((await runInNewContext(commandExpression({type: 'play'}), context)).ok, false);
});
