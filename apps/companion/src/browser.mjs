import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {CdpConnection} from './cdp.mjs';
import {AppError} from './errors.mjs';
import {stateExpression, commandExpression, searchExpression} from './youtube-page.mjs';
import core from '../../../packages/core/index.js';

export class BrowserController {
  constructor({dataDir, port = 9223, fetcher = fetch, connect = url => new CdpConnection(url)} = {}) {
    this.dataDir = dataDir; this.port = port; this.fetcher = fetcher; this.connect = connect;
    this.targetId = null; this.connection = null; this.queue = Promise.resolve(); this.cache = new Map(); this.opening = null; this.attaching = null;
  }
  async targets() {
    try {
      const response = await this.fetcher(`http://127.0.0.1:${this.port}/json/list`, {signal: AbortSignal.timeout(2000)});
      if (!response.ok) throw new Error();
      return await response.json();
    } catch { throw new AppError('Open the YouTube window from the Windows app.'); }
  }
  async attach() {
    if (this.connection?.connected) return this.connection;
    if (!this.attaching) this.attaching = this.attachInternal().finally(() => { this.attaching = null; });
    return this.attaching;
  }
  async attachInternal() {
    const targets = await this.targets();
    const target = this.targetId ? targets.find(item => item.id === this.targetId) : targets.find(item => {
      try { return item.type === 'page' && new URL(item.url).hostname === 'www.youtube.com'; } catch { return false; }
    });
    if (!target) throw new AppError(this.targetId ? 'The controlled tab was closed. Reopen YouTube from the Windows app.' : 'Open YouTube in the companion’s browser window.');
    this.connection?.close();
    this.targetId = target.id; this.connection = this.connect(target.webSocketDebuggerUrl);
    await this.connection.ready;
    return this.connection;
  }
  async open() {
    if (this.opening) return this.opening;
    this.opening = this.openInternal().finally(() => { this.opening = null; });
    return this.opening;
  }
  async openInternal() {
    let targets = [];
    try { targets = await this.targets(); } catch {}
    const isYouTube = item => item.type === 'page' && item.url.startsWith('https://www.youtube.com/');
    const existing = targets.find(item => item.id === this.targetId && isYouTube(item)) || targets.find(isYouTube)
      || targets.find(item => item.id === this.targetId && item.url.startsWith('https://accounts.google.com/'));
    if (existing) {
      // A local reopen can recover a replacement tab. Never reuse a socket for the previous target.
      this.connection?.close(); this.connection = null;
      this.targetId = existing.id;
      const connection = await this.attach();
      await connection.send('Page.bringToFront');
      return {ok: true};
    }
    if (targets.length) throw new AppError('The controlled tab is closed. Close the companion browser window, then click Open YouTube again.');
    const candidates = [process.env.LAN_TUBE_BROWSER, join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean);
    const executable = candidates.find(path => existsSync(path));
    if (!executable) throw new AppError('Install Chrome or Edge, or set LAN_TUBE_BROWSER to its executable path.');
    const profile = join(this.dataDir, 'browser-profile');
    await mkdir(profile, {recursive: true});
    const args = [`--remote-debugging-port=${this.port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--new-window', 'https://www.youtube.com/'];
    // Browser UI is explicitly requested by the local dashboard. Keep the helper console hidden.
    const child = spawn(executable, args, {detached: true, stdio: 'ignore', windowsHide: true});
    let spawnError = null; child.once('error', error => { spawnError = error; }); child.unref();
    this.targetId = null; this.connection?.close(); this.connection = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (spawnError) throw new AppError('The browser could not start. Check LAN_TUBE_BROWSER.');
      try { await this.attach(); return {ok: true}; } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new AppError('Browser started but YouTube is not ready. Finish any startup prompt, then retry.');
  }
  async state() {
    try { return await (await this.attach()).evaluate(stateExpression); }
    catch (error) { return {connected: false, error: error.message}; }
  }
  command(input) {
    const command = core.validateCommand(input);
    const operation = this.queue.catch(() => {}).then(async () => {
      const connection = await this.attach();
      if (command.type === 'select') {
        // Exactly one existing target. Video IDs are validated; URLs cannot be supplied remotely.
        const result = await connection.send('Page.navigate', {url: 'https://www.youtube.com/watch?v=' + command.videoId});
        if (result.errorText) throw new AppError('YouTube could not open this video.');
        return {ok: true, loading: true};
      }
      const result = await connection.evaluate(commandExpression(command));
      if (!result?.ok) throw new AppError(result?.error || 'The player could not complete this action.');
      return result;
    });
    this.queue = operation;
    return operation;
  }
  async search(input) {
    const query = core.validateQuery(input);
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.time < 60000) return cached.result;
    const result = await (await this.attach()).evaluate(searchExpression(query));
    if (!result?.ok) throw new AppError(result?.error || 'Search is unavailable.');
    if (this.cache.size >= 10) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(query, {time: Date.now(), result});
    return result;
  }
  close() { this.connection?.close(); }
}
