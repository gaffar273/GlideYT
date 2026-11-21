import {existsSync} from 'node:fs';
import {mkdir, readdir, rename, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {downloadVerified} from './lib/download.mjs';
import {within, javaMajor, buildEnvironment, run} from './lib/build-environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tools = within(root, '.local/toolchain');
// Fixed SDK manager 19 supports the project's JDK 17. SDK platform/build tools are installed separately.
// Source for this archive's SHA-256: https://github.com/beeware/briefcase/blob/main/src/briefcase/integrations/android_sdk.py
const sdkArchive = {url: 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip',
  sha256: '98b565cb657b012dae6794cefc0f66ae1efb4690c699b78a614b4a6a3505b003'};

async function unpack(archive, destination) {
  within(tools, destination);
  await mkdir(destination, {recursive: true});
  const listing = spawnSync('tar.exe', ['-tf', archive], {encoding: 'utf8', windowsHide: true});
  if (listing.status !== 0) throw new Error('Windows tar.exe could not inspect the archive.');
  for (const entry of listing.stdout.split(/\r?\n/).filter(Boolean)) {
    if (/^[\\/]|^[a-zA-Z]:/.test(entry) || entry.split(/[\\/]/).includes('..')) throw new Error('Archive contains an unsafe path.');
  }
  await run('tar.exe', ['-xf', archive, '-C', destination]);
}
async function sdkManager(java, commandTools, sdk, args, env) {
  const classpath = join(commandTools, 'lib/sdkmanager-classpath.jar');
  if (!existsSync(classpath)) throw new Error('SDK manager classpath is missing. Rerun setup.');
  await run(java, ['-Duser.home=' + join(tools, 'home'), '-Dcom.android.sdklib.toolsdir=' + commandTools,
    '-classpath', classpath, 'com.android.sdklib.tool.sdkmanager.SdkManagerCli', '--sdk_root=' + sdk, ...args], {env});
}
try {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The automatic toolchain setup currently supports Windows x64. See README for manual setup.');
  let {javaHome, sdk} = await buildEnvironment(root);
  console.log('Checking access to npm and the JDK download service...');
  const responses = await Promise.all([
    fetch('https://registry.npmjs.org/react-native', {method: 'HEAD', signal: AbortSignal.timeout(10000)}),
    fetch('https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse', {signal: AbortSignal.timeout(10000)}),
  ]);
  if (responses.some(response => !response.ok)) throw new Error('Package/download services are unavailable.');
  const releases = await responses[1].json();
  if (process.argv.includes('--check')) { console.log('Network preflight passed. Run Setup-Android.cmd to install the tools.'); process.exit(0); }
  if (!javaHome || javaMajor(join(javaHome, 'bin/java.exe')) !== 17) {
    const asset = releases[0]?.binary?.package;
    if (!asset || !/^https:\/\/github\.com\/adoptium\/temurin17-binaries\/releases\/download\//.test(asset.link)) throw new Error('JDK provider returned an unexpected download.');
    console.log('Downloading a verified portable JDK 17 into this project...');
    const archive = within(tools, 'downloads/jdk17.zip');
    await downloadVerified(asset.link, archive, asset.checksum);
    const stage = within(tools, 'jdk17-' + Date.now());
    await unpack(archive, stage);
    const entries = await readdir(stage, {withFileTypes: true});
    const folder = entries.find(entry => entry.isDirectory() && existsSync(join(stage, entry.name, 'bin/java.exe')));
    if (!folder) throw new Error('Downloaded JDK does not contain java.exe.');
    javaHome = within(stage, folder.name);
  }
  await mkdir(tools, {recursive: true});
  await writeFile(within(tools, 'config.json'), JSON.stringify({javaHome, sdk}, null, 2));
  if (!sdk || !existsSync(sdk)) sdk = within(tools, 'sdk');
  let commandTools = join(sdk, 'cmdline-tools/19.0');
  if (!existsSync(join(commandTools, 'lib/sdkmanager-classpath.jar'))) {
    // Prefer an already installed SDK manager when its layout is complete.
    const installed = join(sdk, 'cmdline-tools/latest');
    if (existsSync(join(installed, 'lib/sdkmanager-classpath.jar'))) commandTools = installed;
    else {
      console.log('Android SDK license: https://developer.android.com/studio#terms-and-conditions');
      const input = createInterface({input: process.stdin, output: process.stdout});
      let answer; try { answer = await input.question('Review the SDK terms at that link. Agree and download the SDK tools? [y/N] '); } finally { input.close(); }
      if (!/^y(?:es)?$/i.test(answer.trim())) throw new Error('SDK download cancelled. No license was accepted automatically.');
      console.log('Downloading verified Android command-line tools...');
      const archive = within(tools, 'downloads/android-command-tools.zip');
      await downloadVerified(sdkArchive.url, archive, sdkArchive.sha256);
      const stage = within(tools, 'sdk-stage-' + Date.now());
      await unpack(archive, stage);
      // Install downloaded tools only into the managed SDK, never mutate a pre-existing external SDK.
      sdk = within(tools, 'sdk'); commandTools = within(tools, 'sdk/cmdline-tools/19.0');
      await mkdir(within(tools, 'sdk/cmdline-tools'), {recursive: true});
      await rename(within(stage, 'cmdline-tools'), commandTools);
    }
  }
  await mkdir(tools, {recursive: true});
  await writeFile(within(tools, 'config.json'), JSON.stringify({javaHome, sdk}, null, 2));
  const {env} = await buildEnvironment(root);
  // Use the selected managed paths even if the user has a different JAVA_HOME configured.
  env.JAVA_HOME = javaHome; env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk;
  await mkdir(within(tools, 'home'), {recursive: true});
  console.log('The Android SDK manager will show any licenses required by these build packages.');
  const java = join(javaHome, 'bin/java.exe');
  await sdkManager(java, commandTools, sdk, ['platform-tools', 'platforms;android-36', 'build-tools;36.0.0', 'ndk;27.1.12297006', 'cmake;3.22.1'], env);
  console.log('\nAndroid tools are prepared. Run Build-Android.cmd to build the installable APK.');
} catch (error) {
  console.error('\nAndroid setup stopped: ' + error.message + (error.cause?.code ? ' (' + error.cause.code + ')' : ''));
  console.error('If this session denies network access, run Setup-Android.cmd from a normal Windows terminal in this folder.');
  process.exitCode = 1;
}
