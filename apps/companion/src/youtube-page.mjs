// These self-contained functions run in the pinned YouTube page. Keep all website-specific logic here.
export function readState() {
  const url = new URL(location.href);
  if (url.hostname !== 'www.youtube.com') return {connected: false, error: 'Return to YouTube on the laptop after finishing sign-in or consent.'};
  const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
  const videoId = url.searchParams.get('v');
  const title = document.querySelector('ytd-watch-metadata h1 yt-formatted-string')?.textContent?.trim() || document.title.replace(/ - YouTube$/, '');
  return {
    connected: true, videoId, title, playing: Boolean(video && !video.paused && !video.ended),
    position: video && Number.isFinite(video.currentTime) ? video.currentTime : 0,
    duration: video && Number.isFinite(video.duration) ? video.duration : 0,
    repeat: video && videoId && Number.isFinite(video.duration) && video.duration > 0 ? Boolean(video.loop) : null,
    live: Boolean(video && video.duration === Infinity), volume: video?.volume ?? 1,
    ready: Boolean(video && video.readyState > 0), observedAt: Date.now(),
    thumbnail: /^[a-zA-Z0-9_-]{11}$/.test(videoId || '') ? 'https://i.ytimg.com/vi/' + videoId + '/mqdefault.jpg' : null,
  };
}

export async function controlPlayer(command) {
  if (location.hostname !== 'www.youtube.com') throw new Error('Not on YouTube');
  const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
  if (!video) return {ok: false, error: 'Choose a video first, or finish the prompt on the laptop.'};
  switch (command.type) {
    case 'repeat':
      if (!Number.isFinite(video.duration) || video.duration <= 0) return {ok: false, error: 'Repeat requires a recorded video.'};
      video.loop = command.enabled;
      break;
    case 'play':
      try { await video.play(); } catch { return {ok: false, error: 'Click Play on the laptop once to enable playback.'}; }
      break;
    case 'pause': {
      const player = document.getElementById?.('movie_player');
      if (typeof player?.pauseVideo === 'function') player.pauseVideo();
      video.pause();
      break;
    }
    case 'seek':
      if (!Number.isFinite(video.duration)) return {ok: false, error: 'Seeking is not available for this live stream.'};
      video.currentTime = Math.min(command.seconds, video.duration); break;
    case 'volume': video.volume = command.level; video.muted = command.level === 0; break;
  }
  return {ok: true};
}

export function parseSearchHtml(html) {
  const marker = /(?:var\s+ytInitialData\s*=|window\["ytInitialData"\]\s*=|ytInitialData\s*=)\s*/g;
  let initial;
  for (const match of html.matchAll(marker)) {
    const start = match.index + match[0].length;
    if (html[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < html.length; i++) {
      const char = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try { initial = JSON.parse(html.slice(start, i + 1)); } catch {}
        break;
      }
    }
    if (initial) break;
  }
  if (!initial) return {ok: false, error: 'YouTube search is unavailable. Check the laptop for a consent or verification prompt.'};
  const text = value => value?.simpleText || value?.content || value?.runs?.map(run => run.text).join('') || '';
  const results = [], seen = new Set();
  const stack = [initial.contents || initial];
  let visited = 0;
  while (stack.length && results.length < 20 && ++visited < 50000) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.adSlotRenderer || node.promotedSparklesWebRenderer || node.promotedVideoRenderer) continue;
    const renderer = node.videoRenderer;
    if (renderer && /^[\w-]{11}$/.test(renderer.videoId || '') && !seen.has(renderer.videoId)) {
      seen.add(renderer.videoId);
      results.push({videoId: renderer.videoId, title: text(renderer.title), channel: text(renderer.ownerText || renderer.longBylineText),
        duration: text(renderer.lengthText) || 'LIVE', thumbnail: 'https://i.ytimg.com/vi/' + renderer.videoId + '/mqdefault.jpg'});
    }
    const lockup = node.lockupViewModel;
    const collection = node.playlistRenderer || node.radioRenderer;
    const isCollection = /(?:PLAYLIST|PODCAST)$/.test(lockup?.contentType || '');
    const endpoint = lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint;
    const listId = collection?.playlistId || (isCollection && (endpoint?.playlistId || lockup.contentId));
    if (typeof listId === 'string' && /^[A-Za-z0-9_-]{2,100}$/.test(listId) && !seen.has('list:' + listId)) {
      seen.add('list:' + listId);
      const cover = lockup?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel;
      const thumbnail = cover?.image?.sources?.[0]?.url || collection?.thumbnails?.[0]?.thumbnails?.[0]?.url;
      const seed = endpoint?.videoId || collection?.videos?.[0]?.childVideoRenderer?.videoId ||
        /\/vi\/([A-Za-z0-9_-]{11})\//.exec(thumbnail || '')?.[1];
      results.push({listId, videoId: /^[A-Za-z0-9_-]{11}$/.test(seed || '') ? seed : null,
        title: text(collection?.title || lockup?.metadata?.lockupMetadataViewModel?.title), channel: 'Playlist',
        duration: '', thumbnail: /^https:\/\/i\.ytimg\.com\//.test(thumbnail || '') ? thumbnail : null});
    }
    if (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && /^[\w-]{11}$/.test(lockup.contentId || '') && !seen.has(lockup.contentId)) {
      seen.add(lockup.contentId);
      const metadata = lockup.metadata?.lockupMetadataViewModel;
      results.push({videoId: lockup.contentId, title: text(metadata?.title),
        channel: text(metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text),
        duration: '', thumbnail: 'https://i.ytimg.com/vi/' + lockup.contentId + '/mqdefault.jpg'});
    }
    const children = Object.values(node);
    for (let i = children.length - 1; i >= 0; i--) if (children[i] && typeof children[i] === 'object') stack.push(children[i]);
  }
  if (!results.length && !JSON.stringify(initial).includes('messageRenderer')) {
    return {ok: false, error: 'No readable results. YouTube may have changed its search format; try another search or check the laptop.'};
  }
  return {ok: true, results};
}

export async function searchPage(query, parser) {
  if (location.hostname !== 'www.youtube.com') return {ok: false, error: 'Finish sign-in or consent on the laptop first.'};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/results?search_query=' + encodeURIComponent(query), {signal: controller.signal, credentials: 'same-origin'});
    if (!response.ok) return {ok: false, error: 'YouTube search failed. Try again shortly.'};
    const html = await response.text();
    return parser ? parser(html) : {html};
  } catch { return {ok: false, error: 'Search timed out or YouTube is offline. Try again.'}; }
  finally { clearTimeout(timer); }
}


export const stateExpression = `(${readState.toString()})()`;
export const commandExpression = command => `(async () => {
  const result = await (${controlPlayer.toString()})(${JSON.stringify(command)});
  if (result.ok) result.state = ${stateExpression};
  return result;
})()`;
export const searchExpression = query => `(${searchPage.toString()})(${JSON.stringify(query)}, ${parseSearchHtml.toString()})`;
