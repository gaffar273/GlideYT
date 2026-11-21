import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

export function verifyApk(apk, {java, sdk, env}) {
  function capture(executable, args, label) {
    const result = spawnSync(executable, args, {env, windowsHide: true, maxBuffer: 32 * 1024 * 1024});
    if (result.status !== 0) throw new Error(label + ': ' + (result.error?.message || result.stderr?.toString().slice(-1500) || 'verification failed'));
    return result.stdout;
  }
  capture(java, ['-jar', join(sdk, 'build-tools/36.0.0/lib/apksigner.jar'), 'verify', '--verbose', apk], 'APK signature');
  const manifest = capture(join(sdk, 'build-tools/36.0.0/aapt.exe'), ['dump', 'badging', apk], 'APK manifest').toString();
  const applicationId = /package: name='([^']+)'/.exec(manifest)?.[1];
  if (applicationId !== 'com.lantube') throw new Error('Unexpected Android application ID.');
  const bundle = capture('tar.exe', ['-xOf', apk, 'assets/index.android.bundle'], 'Embedded JavaScript bundle');
  if (bundle.subarray(0, 8).toString('hex') !== 'c61fbc03c103191f') throw new Error('APK does not contain a compiled Hermes bundle.');
  return {signatureVerified: true, applicationId,
    minimumAndroidApi: Number(/sdkVersion:'(\d+)'/.exec(manifest)?.[1]),
    targetAndroidApi: Number(/targetSdkVersion:'(\d+)'/.exec(manifest)?.[1]),
    nativeArchitectures: /native-code: ([^\r\n]+)/.exec(manifest)?.[1].replace(/'/g, '').split(' '),
    bundleFormat: 'Hermes bytecode', bundleBytes: bundle.length};
}
