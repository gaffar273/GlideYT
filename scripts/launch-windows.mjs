import {spawn} from 'node:child_process';
import {mkdir, readFile, open, unlink} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = resolve(process.env.LAN_TUBE_DATA_DIR || join(root, '.local'));
const port = Number(process.env.LAN_TUBE_PORT || 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid LAN_TUBE_PORT.');
const origin = `http://127.0.0.1:${port}`;
async function healthy() {
  try { return (await (await fetch(origin + '/v1/health', {signal: AbortSignal.timeout(700)})).json()).service === 'lan-tube'; }
  catch { return false; }
}
try {
  await mkdir(dataDir, {recursive: true});
  if (!await healthy()) {
    await unlink(join(dataDir, 'setup-url.txt')).catch(() => {});
    const out = await open(join(dataDir, 'companion.log'), 'a');
    const err = await open(join(dataDir, 'companion-error.log'), 'a');
    const child = spawn(process.execPath, [join(root, 'apps/companion/src/index.mjs')], {
      cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out.fd, err.fd],
    });
    child.once('error', error => { console.error(error.message); process.exitCode = 1; });
    child.unref(); await out.close(); await err.close();
  }
  let setupUrl;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await healthy()) {
      try {
        const value = (await readFile(join(dataDir, 'setup-url.txt'), 'utf8')).trim();
        if (new RegExp('^http://127\\.0\\.0\\.1:' + port + '/#[a-f0-9]{64}$').test(value)) { setupUrl = value; break; }
      } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!setupUrl) throw new Error('Companion did not start. Check .local/companion-error.log, or run npm.cmd start.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
