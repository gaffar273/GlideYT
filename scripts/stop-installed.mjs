import {readFile} from 'node:fs/promises';

try {
  const settings = await readFile(new URL('../.local/setup-url.txt', import.meta.url), 'utf8');
  const endpoint = new URL(settings.trim());
  if (endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && /^#[a-f0-9]{64}$/.test(endpoint.hash)) {
    await fetch(new URL('/admin/stop', endpoint), {
      method: 'POST', headers: {'X-Admin-Secret': endpoint.hash.slice(1), 'Content-Type': 'application/json'},
      body: '{}', signal: AbortSignal.timeout(2500),
    });
  }
} catch {
  // The installed companion may already be stopped or may never have been started.
}
