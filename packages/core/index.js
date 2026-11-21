'use strict';

const API_VERSION = 1;
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const COMMANDS = new Set(['play', 'pause', 'seek', 'select', 'volume', 'speed', 'quality', 'saved', 'suggested', 'playlist', 'episodes', 'moreEpisodes', 'next', 'previous']);

function validateCommand(value) {
  if (!value || !COMMANDS.has(value.type)) throw new Error('Unknown command.');
  switch (value.type) {
    case 'episodes':
    case 'moreEpisodes':
    case 'playlist':
      if (typeof value.listId !== 'string' || !/^[A-Za-z0-9_-]{2,100}$/.test(value.listId)) throw new Error('Invalid playlist.');
      if (value.videoId != null && !VIDEO_ID.test(value.videoId)) throw new Error('Invalid playlist video.');
      if (value.index != null && (!Number.isInteger(value.index) || value.index < 0 || value.index > 999999)) throw new Error('Invalid playlist position.');
      return {type: value.type, index: value.index || 0, listId: value.listId, videoId: value.videoId || null};
    case 'select':
      if (!VIDEO_ID.test(value.videoId || '')) throw new Error('Invalid video ID.');
      return {type: 'select', videoId: value.videoId};
    case 'seek':
      if (!Number.isFinite(value.seconds) || value.seconds < 0 || value.seconds > 604800) {
        throw new Error('Invalid playback position.');
      }
      return {type: 'seek', seconds: value.seconds};
    case 'quality':
    case 'speed': {
      if (value.option === undefined) return {type: value.type};
      const valid = value.type === 'quality' ? /^(?:Auto|[1-9]\d{1,3}p(?:\d{2,3})?)$/ : /^(?:0\.5|0\.75|1|1\.25|1\.5|2)$/;
      if (typeof value.option !== 'string' || !valid.test(value.option)) throw new Error('Unsupported player setting.');
      return {type: value.type, option: value.option};
    }
    case 'volume':
      if (!Number.isFinite(value.level) || value.level < 0 || value.level > 1) {
        throw new Error('Volume must be between 0 and 1.');
      }
      return {type: 'volume', level: value.level};
    default: return {type: value.type};
  }
}

function validateQuery(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) {
    throw new Error('Enter a search between 1 and 160 characters.');
  }
  return value.trim();
}

function normalizeAddress(value) {
  const input = String(value).trim();
  const url = new URL(input.includes('://') ? input : 'http://' + input);
  const octets = url.hostname.split('.').map(Number);
  const ipv4 = octets.length === 4 && octets.every((n, i) => /^\d{1,3}$/.test(url.hostname.split('.')[i]) && n >= 0 && n <= 255);
  const privateHost = ipv4 && (octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  if (url.protocol !== 'http:' || (!privateHost && url.hostname !== 'localhost') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the laptop’s private IPv4 address, for example 192.168.1.20:3210.');
  }
  if (!url.port) url.port = '3210';
  return url.origin;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return minutes + ':' + String(whole % 60).padStart(2, '0');
}

function createClient(address, token, fetcher = globalThis.fetch) {
  const base = normalizeAddress(address);
  async function request(path, body, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, {once: true});
    const timeout = setTimeout(abort, path === '/v1/search' ? 18000 : 10000);
    try {
      const response = await fetcher(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || 'The laptop could not complete this request.');
        error.status = response.status;
        throw error;
      }
      return result;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    pair: (code, name, phoneId) => request('/v1/pair', {code, name, phoneId}),
    identify: (phoneId, name, signal) => request('/v1/identify', {phoneId, name}, signal),
    state: signal => request('/v1/state', undefined, signal),
    search: (query, signal) => request('/v1/search', {query: validateQuery(query)}, signal),
    command: command => request('/v1/command', validateCommand(command)),
    unpair: () => request('/v1/unpair', {}),
  };
}

module.exports = {API_VERSION, VIDEO_ID, validateCommand, validateQuery, normalizeAddress, formatTime, createClient};
