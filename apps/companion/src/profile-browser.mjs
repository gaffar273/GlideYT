import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {BackgroundPlayer} from './background-player.mjs';
import {AppError} from './errors.mjs';
import {parseSearchHtml} from './youtube-page.mjs';
import core from '../../../packages/core/index.js';

const executable = fileURLToPath(new URL('../../windows/MediaControl.exe', import.meta.url));

export class ProfileBrowser {
  constructor() {
    this.queue = Promise.resolve();
    this.titles = new Map();
    this.selected = {};
    this.sleepUntil = 0;
  }
  request(command) {
    const operation = this.queue.then(() => this.send(command));
    this.queue = operation.catch(() => {});
    return operation;
  }
  send(command) {
    if (!this.child) {
      const child = spawn(executable, [], {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
      this.child = child;
      createInterface({input: child.stdout}).on('line', line => {
        if (this.child === child) this.reply?.(line);
      });
      const closed = () => {
        if (this.child !== child) return;
        this.child = null;
        this.reply?.(null);
      };
      child.on('exit', closed); child.on('error', closed); child.stdin.on('error', closed);
    }
    const child = this.child;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.child = null; child.kill(); this.reply(null);
      }, 15000);
      this.reply = line => {
        this.reply = null; clearTimeout(timeout);
        try {
          if (!line) throw new AppError('Windows media controls are unavailable.');
          const {result, error} = JSON.parse(line);
          if (error) throw new AppError(error);
          resolve(result);
        } catch (error) { reject(error); }
      };
      child.stdin.write(JSON.stringify({...this.selected, ...command}) + '\n');
    });
  }
  async enableBackground() {
    const browser = await this.request({type:'browser'});
    const state = await this.request({type:'state'});
    const player = await BackgroundPlayer.connect(browser, state.title);
    this.background?.close();
    this.background = player;
    return {ok:true};
  }
  async inBackground(value) {
    const operation = this.queue.then(() => this.background.command(value));
    this.queue = operation.catch(() => {});
    return operation;
  }
  async state() {
    if (this.background?.socket.connected) {
      try { return {...await this.inBackground({type:'state'}), sleepUntil: this.sleepUntil}; }
      catch { /* Native media state remains available while YouTube navigates. */ }
    }
    try { return {...await this.request({type: 'state'}), sleepUntil: this.sleepUntil}; }
    catch (error) { return {connected: false, error: error.message}; }
  }
  async open() { return this.request({type: 'open'}); }
  async command(input) {
    const value = core.validateCommand(input);
    if (value.type === 'sleep') {
      clearTimeout(this.sleepTimer);
      this.sleepUntil = value.minutes ? Date.now() + value.minutes * 60000 : 0;
      if (value.minutes) {
        this.sleepTimer = setTimeout(() => {
          this.sleepUntil = 0;
          this.playbackCommand({type:'pause'}).catch(error => console.error('Sleep timer could not pause playback:', error.message));
        }, value.minutes * 60000);
        this.sleepTimer.unref();
      }
      return {ok:true, state:await this.state()};
    }
    const result = await this.playbackCommand(value);
    if (result.state) return {...result, state: {...result.state, sleepUntil: this.sleepUntil}};
    return result;
  }
  async playbackCommand(value) {
    if (this.background?.socket.connected) return this.inBackground(value);
    if (value.type === 'quality' || value.type === 'speed') return this.request(value);
    if (['saved', 'suggested', 'next', 'previous', 'playlist', 'episodes', 'moreEpisodes'].includes(value.type)) return this.request(value);
    if (value.type === 'select') {
      await this.request(value);
      this.selected = {videoId: value.videoId, title: this.titles.get(value.videoId)};
      return {ok: true, loading: true};
    }
    return {ok: true, state: await this.request(value)};
  }
  async search(value) {
    const query = core.validateQuery(value);
    let html;
    try {
      const response = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query),
        {signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error();
      html = await response.text();
    } catch { throw new AppError('YouTube search could not be reached.'); }
    const result = parseSearchHtml(html);
    if (!result.ok) throw new AppError(result.error);
    for (const item of result.results) if (!item.listId) this.titles.set(item.videoId, item.title);
    while (this.titles.size > 200) this.titles.delete(this.titles.keys().next().value);
    return result;
  }
  close() { clearTimeout(this.sleepTimer); this.background?.close(); this.child?.stdin.end(); }
}
