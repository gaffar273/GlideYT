import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, writeFile, unlink} from 'node:fs/promises';
import {PairingStore} from './auth.mjs';
import {ProfileBrowser} from './profile-browser.mjs';
import {createCompanionServer} from './server.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dataDir = resolve(process.env.LAN_TUBE_DATA_DIR || join(root, '.local'));
await mkdir(dataDir, {recursive: true});
const port = Number(process.env.LAN_TUBE_PORT || 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Choose a port between 1024 and 65535.');
}
const pairing = await new PairingStore(join(dataDir, 'devices.json')).load();
const browser = new ProfileBrowser();
const {server, adminSecret} = createCompanionServer({browser, pairing, port, onShutdown: stop});
server.on('error', error => { console.error(`Companion could not listen on port ${port}: ${error.code}.`); process.exitCode = 1; });
server.listen(port, '0.0.0.0', async () => {
  const setupUrl = `http://127.0.0.1:${port}/#${adminSecret}`;
  try { await writeFile(join(dataDir, 'setup-url.txt'), setupUrl, {mode: 0o600}); }
  catch { console.error('Cannot save Windows app credentials. Check the companion data directory.'); }
  console.log('\nGlide YT — local YouTube remote\n');
  console.log('Open GlideYT.exe to pair your phone and launch YouTube.');
  console.log('Press Ctrl+C to stop the companion. Your browser remains open.\n');
});
function stop() {
  browser.close(); server.close(); server.closeAllConnections();
  unlink(join(dataDir, 'setup-url.txt')).catch(() => {});
}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
