import {readdir, readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
const root = new URL('../', import.meta.url);
let count = 0, failed = false;
async function visit(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (['node_modules', '.local', '.git', 'build', '.gradle'].includes(entry.name)) continue;
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) await visit(url);
    else if (/\.(?:mjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], {encoding: 'utf8'});
      if (result.status !== 0) { failed = true; console.error(result.stderr); }
      count++;
    } else if (entry.name.endsWith('.json')) {
      try { JSON.parse(await readFile(url, 'utf8')); } catch (error) { failed = true; console.error(url.pathname + ': ' + error.message); }
    }
  }
}
await visit(root);
const require = createRequire(new URL('../apps/android/package.json', import.meta.url));
if (existsSync(new URL('../node_modules/@react-native/babel-preset', import.meta.url))) {
  try {
    const babel = require('@babel/core');
    babel.transformFileSync(fileURLToPath(new URL('../apps/android/src/App.jsx', import.meta.url)), {
      configFile: fileURLToPath(new URL('../apps/android/babel.config.js', import.meta.url)),
    });
    console.log('React Native JSX validated with the installed Babel preset.');
  } catch (error) { failed = true; console.error(error.message); }
}
console.log(`Checked ${count} JavaScript modules and JSON configuration files. JSX/native compilation requires the Android toolchain.`);
process.exitCode = failed ? 1 : 0;
