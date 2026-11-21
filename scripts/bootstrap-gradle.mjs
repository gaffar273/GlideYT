import {writeFile, mkdir, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const version = '9.0.0';
const destination = new URL('../apps/android/android/gradle/wrapper/gradle-wrapper.jar', import.meta.url);
async function download(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error('Download failed: ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}
try {
  console.log('Downloading the official Gradle wrapper (first build only)…');
  const checksum = (await download(`https://services.gradle.org/distributions/gradle-${version}-wrapper.jar.sha256`)).toString().trim().split(/\s/)[0];
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Invalid official wrapper checksum');
  const jar = await download(`https://raw.githubusercontent.com/gradle/gradle/v${version}/gradle/wrapper/gradle-wrapper.jar`);
  if (createHash('sha256').update(jar).digest('hex') !== checksum) throw new Error('Gradle wrapper checksum mismatch');
  await mkdir(new URL('.', destination), {recursive: true});
  const temporary = new URL('gradle-wrapper.jar.tmp', destination);
  await writeFile(temporary, jar);
  await rename(temporary, destination);
  console.log('Gradle wrapper verified.');
} catch (error) {
  console.error('Cannot prepare Gradle: ' + error.message + '. An internet connection is required for the first Android build.');
  process.exitCode = 1;
}
