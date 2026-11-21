import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {hostname, networkInterfaces} from 'node:os';
import {AppError} from './errors.mjs';
import core from '../../../packages/core/index.js';
import {requestPrivateWifiAccess} from './wifi.mjs';

export function privateAddress(address) {
  const ip = (address || '').replace(/^::ffff:/, '');
  return ip === '::1' || /^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}
export function loopback(address) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address); }
export function lanAddresses(port) {
  return Object.entries(networkInterfaces()).sort(([a], [b]) => Number(/wi-?fi|wlan/i.test(b)) - Number(/wi-?fi|wlan/i.test(a)))
    .flatMap(([, items]) => items).filter(item => item.family === 'IPv4' && !item.internal && privateAddress(item.address))
    .map(item => `http://${item.address}:${port}`);
}
function respond(response, status, data) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  response.end(JSON.stringify(data));
}
async function jsonBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new AppError('Send JSON content.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new AppError('Request is too large.', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new AppError('Send a JSON object.', 400); }
}

export function createCompanionServer({browser, pairing, port = 3210, laptopName = hostname(), adminSecret = randomBytes(32).toString('hex'), onShutdown = () => {}, apkPath = new URL('../../../dist/android/glide-yt-0.1.0.apk', import.meta.url)}) {
  const limits = new Map(); let searchActive = false, wifiActive = false;
  const server = createServer(async (request, response) => {
    try {
      const remote = request.socket.remoteAddress;
      if (!privateAddress(remote)) throw new AppError('Only local network connections are allowed.', 403);
      const host = request.headers.host || '';
      try { core.normalizeAddress('http://' + host); } catch { throw new AppError('Invalid local host.', 403); }
      const origin = request.headers.origin;
      if (origin && (!loopback(remote) || ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin))) {
        throw new AppError('Browser cross-origin requests are not allowed.', 403);
      }
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/install' && request.method === 'GET') {
        const html = await readFile(new URL('../public/install.html', import.meta.url));
        response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"});
        response.end(html); return;
      }
      if (path === '/download/android.apk' && request.method === 'GET') {
        let apk;
        try { apk = await stat(apkPath); } catch { throw new AppError('The Android APK has not been built yet.', 503); }
        response.writeHead(200, {'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': apk.size,
          'Content-Disposition': 'attachment; filename="glide-yt-0.1.0.apk"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
        createReadStream(apkPath).on('error', () => response.destroy()).pipe(response); return;
      }
      if (path.startsWith('/admin/')) {
        const secret = request.headers['x-admin-secret'];
        if (!loopback(remote) || typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret) ||
          !timingSafeEqual(Buffer.from(secret), Buffer.from(adminSecret))) throw new AppError('Open Glide YT on the laptop.', 403);
        if (path === '/admin/status' && request.method === 'GET') {
          respond(response, 200, {laptopName, addresses: lanAddresses(port), pairing: pairing.currentCode(), devices: pairing.list(), state: await browser.state(),
            memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024)}); return;
        }
        if (request.method !== 'POST') throw new AppError('Unknown setup action.', 404);
        const body = await jsonBody(request);
        if (path === '/admin/open') respond(response, 200, await browser.open());
        else if (path === '/admin/background') respond(response, 200, await browser.enableBackground());
        else if (path === '/admin/rotate') respond(response, 200, pairing.rotate());
        else if (path === '/admin/revoke') { await pairing.revoke(body.deviceId); respond(response, 200, {ok: true}); }
        else if (path === '/admin/wifi') {
          if (wifiActive) throw new AppError('A Windows approval request is already open.', 409);
          wifiActive = true;
          try { respond(response, 200, await requestPrivateWifiAccess(port)); } finally { wifiActive = false; }
        }
        else if (path === '/admin/stop') { respond(response, 200, {ok: true}); setImmediate(onShutdown); }
        else throw new AppError('Unknown setup action.', 404);
        return;
      }
      if (path === '/v1/health' && request.method === 'GET') { respond(response, 200, {apiVersion: core.API_VERSION, service: 'lan-tube'}); return; }
      if (path === '/v1/pair' && request.method === 'POST') {
        const body = await jsonBody(request);
        respond(response, 200, {...await pairing.pair(body.code, body.name, remote), laptopName, apiVersion: core.API_VERSION}); return;
      }
      const device = pairing.authenticate(request.headers.authorization);
      const now = Date.now();
      const limit = limits.get(device.id) || {count: 0, until: now + 60000};
      if (limit.until <= now) { limit.count = 0; limit.until = now + 60000; }
      if (++limit.count > 120) throw new AppError('Too many requests. Wait a moment.', 429);
      limits.set(device.id, limit);
      if (path === '/v1/state' && request.method === 'GET') { respond(response, 200, await browser.state()); return; }
      if (request.method !== 'POST') throw new AppError('Unknown endpoint.', 404);
      const body = await jsonBody(request);
      if (path === '/v1/command') {
        let command; try { command = core.validateCommand(body); } catch (error) { throw new AppError(error.message, 400); }
        respond(response, 200, await browser.command(command));
      } else if (path === '/v1/search') {
        let query; try { query = core.validateQuery(body.query); } catch (error) { throw new AppError(error.message, 400); }
        if (searchActive) throw new AppError('A search is already running. Try again shortly.', 429);
        searchActive = true;
        try { respond(response, 200, await browser.search(query)); } finally { searchActive = false; }
      } else if (path === '/v1/unpair') {
        await pairing.revoke(device.id); limits.delete(device.id); respond(response, 200, {ok: true});
      } else throw new AppError('Unknown endpoint.', 404);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) respond(response, error.status || 500, {error: error.status ? error.message : 'The companion encountered an error. Check the laptop and retry.'});
    }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return {server, adminSecret};
}
