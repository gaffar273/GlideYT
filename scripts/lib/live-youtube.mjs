import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {BrowserController} from '../../apps/companion/src/browser.mjs';

export async function verifyLiveYouTube(connection, port, targetId, directory) {
  const browser = new BrowserController({port});
  browser.targetId = targetId;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = {checkedAt: new Date().toISOString(), source: 'live YouTube, fresh unsigned browser profile', passed: false};
  try {
    await connection.send('Page.navigate', {url: 'https://www.youtube.com/'});
    let state;
    for (let attempt = 0; attempt < 40; attempt++) {
      state = await browser.state();
      if (state.connected) break;
      await delay(500);
    }
    assert.equal(state?.connected, true, state?.error || 'YouTube did not load.');
    const results = await browser.search('Me at the zoo');
    assert.ok(results.results.length, 'Live YouTube search returned videos.');
    report.searchResults = results.results.length;
    report.searchDidNotNavigate = (await browser.state()).videoId === state.videoId;
    assert.equal(report.searchDidNotNavigate, true);
    const selected = results.results.find(item => item.videoId === 'jNQXAC9IVRw') || results.results[0];
    await browser.command({type: 'select', videoId: selected.videoId});
    for (let attempt = 0; attempt < 60; attempt++) {
      state = await browser.state();
      if (state.videoId === selected.videoId && state.ready) break;
      await delay(500);
    }
    report.videoId = state.videoId;
    report.title = state.title;
    report.playerReady = state.ready === true;
    if (!state.ready) {
      const text = await connection.evaluate('document.body.innerText.slice(0,1800)');
      report.playerMessage = text;
      throw new Error('YouTube player is not ready. The live-page message is recorded in the report.');
    }
    await browser.command({type: 'pause'});
    assert.equal((await browser.state()).playing, false);
    await browser.command({type: 'play'});
    for (let attempt = 0; attempt < 20; attempt++) {
      state = await browser.state(); if (state.playing) break; await delay(200);
    }
    assert.equal(state.playing, true, 'Live player accepted Play.');
    await browser.command({type: 'pause'});
    assert.equal(browser.targetId, targetId);
    const targets = await browser.targets();
    report.targets = targets.filter(item => item.type === 'page').map(item => ({id: item.id, url: item.url}));
    assert.equal(report.targets.filter(item => { try { return new URL(item.url).hostname === 'www.youtube.com'; } catch { return false; } }).length, 1);
    report.sameTab = true; report.playPause = true; report.passed = true;
    console.log('PASS: live YouTube search, video selection in one tab, and play/pause.');
  } catch (error) { report.error = error.message; throw error; }
  finally {
    try {
      const screenshot = await connection.send('Page.captureScreenshot', {format: 'png'});
      await writeFile(new URL('live-youtube.png', directory), Buffer.from(screenshot.data, 'base64'));
    } catch {}
    await writeFile(new URL('live-youtube-report.json', directory), JSON.stringify(report, null, 2));
    browser.close();
  }
}
