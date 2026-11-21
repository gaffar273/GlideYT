import {existsSync} from 'node:fs';
import {mkdir, copyFile, writeFile, unlink, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildEnvironment, javaMajor, npmCli, run, within} from './lib/build-environment.mjs';
import {sha256} from './lib/download.mjs';
import {verifyApk} from './lib/apk.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = within(root, 'dist/android');
try {
  await mkdir(output, {recursive: true});
  await unlink(join(output, 'build-failure.txt')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await unlink(join(output, 'build-report.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const {javaHome, sdk, env} = await buildEnvironment(root);
  const java = javaHome ? join(javaHome, 'bin/java.exe') : 'java';
  if (!javaMajor(java) || javaMajor(java) < 17 || !sdk || !existsSync(join(sdk, 'platforms/android-36/android.jar'))) {
    throw new Error('Android tools are missing. Run Setup-Android.cmd first.');
  }
  env.JAVA_HOME = javaHome; env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk;
  const npm = npmCli();
  if (!process.argv.includes('--reuse-deps') || !existsSync(join(root, 'node_modules/react-native/package.json'))) {
    await run(process.execPath, [npm, existsSync(join(root, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], {cwd: root, env});
  }
  await run(process.execPath, [npm, 'test'], {cwd: root, env});
  await run(process.execPath, [npm, 'run', 'check'], {cwd: root, env});
  await run(process.execPath, [join(root, 'scripts/bootstrap-gradle.mjs')], {cwd: root, env});
  const android = join(root, 'apps/android/android');
  await run(java, ['-Duser.home=' + join(root, '.local/toolchain/home'), '-classpath', join(android, 'gradle/wrapper/gradle-wrapper.jar'),
    'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', '--console=plain', 'assembleRelease'], {cwd: android, env});
  const original = join(android, 'app/build/outputs/apk/release/app-release.apk');
  if ((await stat(original)).size < 1024) throw new Error('Gradle did not produce a valid-sized APK.');
  const verification = verifyApk(original, {java, sdk, env});
  const filename = `glide-yt-${verification.versionName}.apk`;
  const apk = join(output, filename);
  await copyFile(original, apk);
  const report = {builtAt: new Date().toISOString(), apk: filename, sha256: await sha256(apk),
    build: 'assembleRelease', signing: env.GLIDEYT_KEYSTORE ? 'GlideYT distribution key' : 'local debug key for personal testing',
    verification, deviceTesting: 'pending'};
  await writeFile(join(output, 'build-report.json'), JSON.stringify(report, null, 2));
  console.log('\nAPK built: ' + apk);
  console.log('Install it on your Android phone, then pair with the laptop companion. Real-device testing is still required.');
} catch (error) {
  await writeFile(join(output, 'build-failure.txt'), new Date().toISOString() + '\n' + error.message + '\n').catch(() => {});
  console.error('\nAndroid build stopped: ' + error.message);
  console.error('No successful build report was produced. See README.md for prerequisites.');
  process.exitCode = 1;
}
