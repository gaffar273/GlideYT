import {NativeModules} from 'react-native';
const vault = NativeModules.SecureSession;
export async function loadSession() {
  if (!vault) throw new Error('Rebuild the Android app to enable secure pairing storage.');
  const value = await vault.load();
  return value ? JSON.parse(value) : null;
}
export async function saveSession(value) {
  if (!vault) throw new Error('Secure pairing storage is unavailable. Rebuild the Android app.');
  await vault.save(JSON.stringify(value));
}
export async function clearSession() { await vault?.clear(); }
