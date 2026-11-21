import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CdpConnection} from './cdp.mjs';
import {AppError} from './errors.mjs';
import {readState, controlPlayer} from './youtube-page.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalTitle = text => (text || '').replace(/\s+/g, ' ').trim();

// Executed only in the locally approved YouTube target.
async function pageAction(cmd, read, control) {
  if (location.origin !== 'https://www.youtube.com') throw Error('Return this tab to YouTube.');
  const url = new URL(location.href);
  const player = document.getElementById('movie_player');
  const available = name => {
    const el = player?.querySelector('.ytp-' + name + '-button');
    return el && el.getAttribute('aria-disabled') !== 'true' && getComputedStyle(el).display !== 'none' ? el : null;
  };
  function state() {
    return {...read(), listId: url.searchParams.get('list'), hasNext: !!available('next'), hasPrevious: !!available('prev')};
  }
  if (cmd.type === 'state') return state();
  if (['play','pause','seek','volume'].includes(cmd.type)) {
    const result = await control(cmd);
    if (!result.ok) throw Error(result.error);
    return {ok:true,state:state()};
  }
  if (cmd.type === 'speed') {
    const video = document.querySelector('video.html5-main-video');
    if (!video) throw Error('Choose a video first.');
    if (cmd.option !== undefined) video.playbackRate = Number(cmd.option);
    return {options:['0.5','0.75','1','1.25','1.5','2'],current:String(video.playbackRate)};
  }
  if (cmd.type === 'next' || cmd.type === 'previous') {
    const el = available(cmd.type === 'next' ? 'next' : 'prev');
    if (!el) throw Error('This playlist has no video in that direction.');
    el.click(); return {ok:true};
  }
  if (cmd.type === 'quality') {
    const button = player?.querySelector('.ytp-settings-button');
    if (!button) throw Error('Quality settings are unavailable.');
    const waitFor = async find => {
      for (let i=0;i<20;i++) { const value=find(); if(value) return value; await new Promise(r=>setTimeout(r,50)); }
      throw Error('YouTube did not show its quality options.');
    };
    if (button.getAttribute('aria-expanded') === 'true') button.click();
    button.click();
    try {
      const item = await waitFor(() => [...player.querySelectorAll('.ytp-menuitem')].find(e=>e.textContent.trim().startsWith('Quality')));
      item.click();
      const entries = await waitFor(() => {
        const rows = [...player.querySelectorAll('[role="menuitemradio"]')].map(el=>({el,
          name: /^(Auto|\d{2,4}p(?:\d{2,3})?)/.exec(el.textContent.trim())?.[1]}))
          .filter(r=>r.name && !/Premium/i.test(r.el.textContent));
        return rows.length ? rows : null;
      });
      if (cmd.option !== undefined) {
        const choice = entries.find(r=>r.name===cmd.option);
        if (!choice) throw Error('That resolution is unavailable.');
        choice.el.click();
      }
      return {options:entries.map(r=>r.name),current:cmd.option ?? entries.find(r=>r.el.getAttribute('aria-checked')==='true')?.name};
    } finally { if(button.getAttribute('aria-expanded')==='true') button.click(); }
  }
  if (cmd.type === 'navigate') { location.assign(new URL(cmd.path, location.origin)); return {ok:true}; }
  if (cmd.type === 'links') {
    const rows = new Map();
    let last;
    for (const el of document.querySelectorAll('a[href]')) {
      const href = new URL(el.href,location.href);
      if (href.origin !== url.origin || !['/watch','/playlist'].includes(href.pathname)) continue;
      const listId = href.searchParams.get('list'), videoId = href.searchParams.get('v');
      if (!/^[\w-]{2,100}$/.test(listId || '') || (videoId && !/^[\w-]{11}$/.test(videoId))) continue;
      if (cmd.listId && (listId!==cmd.listId || !videoId)) continue;
      const index = Number(href.searchParams.get('index')) || 0;
      const title = (el.title || el.querySelector('#video-title')?.textContent || el.getAttribute('aria-label') || el.textContent).trim();
      if (!title || /^(Play all|Resume|Shuffle|View full playlist)$/i.test(title)) continue;
      const key=cmd.listId ? videoId + '/' + index : listId;
      const prior=rows.get(key);
      if (!prior || (!prior.videoId && videoId)) rows.set(key,{listId,videoId,index,title,thumbnail:videoId?'https://i.ytimg.com/vi/'+videoId+'/mqdefault.jpg':null});
      last=el;
    }
    if (cmd.scroll) last?.scrollIntoView({block:'end'});
    const items=[...rows.values()];
    if (cmd.mix && state().videoId && !rows.has('RD'+state().videoId))
      items.unshift({listId:'RD'+state().videoId,videoId:state().videoId,title:'YouTube Mix · current video'});
    return {items,path:url.pathname+url.search};
  }
  throw Error('Unknown player control.');
}

export class BackgroundPlayer {
  constructor(socket, sessionId, targetId) { this.socket=socket; this.sessionId=sessionId; this.targetId=targetId; }
  static async connect(browser, title, portFile) {
    const directory = browser==='msedge' ? 'Microsoft/Edge' : browser==='chrome' ? 'Google/Chrome' : null;
    if (!directory) throw new AppError('Choose Edge or Chrome as the default browser.');
    let port, path;
    try { [port,path]=(await readFile(portFile ?? join(process.env.LOCALAPPDATA,directory,'User Data','DevToolsActivePort'),'utf8')).trim().split(/\r?\n/); } catch {}
    if (!/^\d+$/.test(port || '') || !/^\/devtools\/browser\/[\w-]+$/.test(path || ''))
      throw new AppError('Enable remote debugging in your browser, then click Connect background controls.');
    const socket = new CdpConnection('ws://127.0.0.1:'+port+path,{timeout:45000});
    try {
      const {targetInfos}=await socket.send('Target.getTargets');
      const tabs=targetInfos.filter(t=>t.type==='page' && t.url.startsWith('https://www.youtube.com/'));
      const matches=tabs.filter(t=>normalTitle(t.title.replace(/ - YouTube$/,''))===normalTitle(title));
      const tab=matches.length===1 ? matches[0] : tabs.length===1 ? tabs[0] : null;
      if (!tab) throw new AppError('Play the intended YouTube video, then connect again so Glide YT can identify its tab.');
      const {sessionId}=await socket.send('Target.attachToTarget',{targetId:tab.targetId,flatten:true});
      return new BackgroundPlayer(socket,sessionId,tab.targetId);
    } catch(error) { socket.close(); throw error; }
  }
  async run(cmd) {
    const expression='(async()=>{try{return {value:await ('+pageAction.toString()+')('+JSON.stringify(cmd)+','+readState.toString()+','+controlPlayer.toString()+')}}catch(e){return {error:e.message}}})()';
    const result=await this.socket.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true},this.sessionId);
    if (result.exceptionDetails || !result.result?.value) throw new AppError('YouTube is loading. Try again shortly.');
    const {value,error}=result.result.value;
    if (error) throw new AppError(error);
    return value;
  }
  async command(cmd) {
    if (cmd.type==='suggested') return {playlists:(await this.run({type:'links',mix:true})).items};
    if (cmd.type==='select') return this.run({type:'navigate',path:'/watch?v='+cmd.videoId});
    if (!['saved','episodes','moreEpisodes','playlist'].includes(cmd.type)) return this.run(cmd);
    const mix=cmd.listId?.startsWith('RD') && cmd.videoId;
    const path=cmd.type==='saved' ? '/feed/playlists' : mix ? '/watch?v='+cmd.videoId+'&list='+cmd.listId : '/playlist?list='+cmd.listId;
    const play=id=>this.run({type:'navigate',path:'/watch?v='+id+'&list='+cmd.listId+(cmd.index?'&index='+cmd.index:'')});
    if (cmd.type==='playlist' && cmd.videoId) return play(cmd.videoId);
    const query={type:'links',listId:cmd.listId};
    const first=await this.run(query);
    if (cmd.type==='moreEpisodes') {
      if(first.path!==path) throw new AppError('Reopen the playlist to load more.');
      await this.run({...query,scroll:true});
    } else if(first.path!==path) await this.run({type:'navigate',path});
    let items=[], stable=0;
    for(let i=0;i<18;i++) {
      await sleep(250);
      let page;
      try { page=await this.run(query); } catch { continue; }
      if(page.path!==path) continue;
      stable=items.length===page.items.length ? stable+1 : 0; items=page.items;
      if(items.length && stable>=2 && (cmd.type!=='moreEpisodes' || items.length>first.items.length)) break;
    }
    if (cmd.type==='playlist') {
      if (!items[0]?.videoId) throw new AppError('No playable videos were found.');
      return play(items[0].videoId);
    }
    return cmd.type==='saved' ? {playlists:items} : {episodes:items,hasMore:cmd.type==='moreEpisodes' ? items.length>first.items.length : items.length>=20};
  }
  close() { this.socket.close(); }
}
