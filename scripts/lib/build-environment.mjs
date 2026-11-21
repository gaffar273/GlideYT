import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {spawnSync, spawn} from 'node:child_process';

export function within(root, ...segments) {
  const result = resolve(root, ...segments);
  const rel = relative(resolve(root), result);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Tool path must stay inside this project.');
  return result;
}
export function javaMajor(executable) {
  const result = spawnSync(executable, ['-version'], {encoding: 'utf8', windowsHide: true});
  if (result.status !== 0) return null;
  return Number(/version "(\d+)/.exec((result.stderr || '') + (result.stdout || ''))?.[1]) || null;
}
export async function buildEnvironment(root) {
  let saved = {};
  try { saved = JSON.parse(await readFile(join(root, '.local/toolchain/config.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const javaHome = saved.javaHome && existsSync(saved.javaHome) ? saved.javaHome : process.env.JAVA_HOME;
  const sdk = saved.sdk && existsSync(saved.sdk) ? saved.sdk : process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  return {javaHome, sdk, env: {...process.env,
    ...(javaHome ? {JAVA_HOME: javaHome} : {}),
    ...(sdk ? {ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk} : {}),
    GRADLE_USER_HOME: join(root, '.local/gradle'), ANDROID_USER_HOME: join(root, '.local/android-home'),
    npm_config_cache: join(root, '.local/npm-cache'),
    JAVA_TOOL_OPTIONS: [process.env.JAVA_TOOL_OPTIONS, '-Djava.net.preferIPv4Stack=true', '-Djava.net.preferIPv6Addresses=false'].filter(Boolean).join(' '),
  }};
}
export function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {stdio: 'inherit', windowsHide: true, ...options});
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${executable} exited ${signal || code}.`)));
  });
}
export function npmCli() {
  const candidate = join(process.execPath, '..', 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(candidate)) throw new Error('Cannot locate npm. Install the official Node.js LTS distribution.');
  return resolve(candidate);
}
