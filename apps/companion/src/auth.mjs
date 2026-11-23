import {randomBytes, randomInt, createHash, timingSafeEqual} from 'node:crypto';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {AppError} from './errors.mjs';

const digest = token => createHash('sha256').update(token).digest('hex');
function phoneKey(phoneId) {
  if (typeof phoneId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(phoneId)) throw new AppError('Invalid phone identifier.', 400);
  return digest(phoneId);
}
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class PairingStore {
  constructor(file, {now = Date.now} = {}) {
    this.file = file; this.now = now; this.devices = []; this.attempts = new Map();
    this.laptopId = randomBytes(16).toString('hex');
    this.seen = new Map();
    this.rotate(); this.writeQueue = Promise.resolve();
  }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.devices)) throw new Error('Unsupported device store');
      this.devices = data.devices;
      if (/^[a-f0-9]{32}$/.test(data.laptopId || '')) this.laptopId = data.laptopId;
      else await this.change(devices => [...devices]);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  rotate() {
    const previous = this.code;
    do { this.code = String(randomInt(100000, 1000000)); } while (this.code === previous);
    this.expiresAt = this.now() + 300000;
    return {code: this.code, expiresAt: this.expiresAt};
  }
  currentCode() {
    if (this.now() >= this.expiresAt) this.rotate();
    return {code: this.code, expiresAt: this.expiresAt};
  }
  limit(key, maximum) {
    const now = this.now();
    if (this.attempts.size > 512) {
      for (const [address, value] of this.attempts) if (value.until <= now) this.attempts.delete(address);
      if (this.attempts.size > 512) throw new AppError('Pairing is busy. Try again in a minute.', 429);
    }
    let entry = this.attempts.get(key);
    if (!entry || entry.until <= now) { entry = {count: 0, until: now + 60000}; this.attempts.set(key, entry); }
    if (++entry.count > maximum) throw new AppError('Too many pairing attempts. Wait a minute.', 429);
  }
  async pair(code, name, address, phoneId) {
    this.limit('all', 20); this.limit(address, 5);
    const key = phoneId === undefined ? null : phoneKey(phoneId);
    const token = randomBytes(32).toString('hex');
    let deviceId;
    await this.change(devices => {
      if (this.now() >= this.expiresAt || !equal(code, this.code)) throw new AppError('Pairing code is invalid or expired.', 401);
      const prior = key && devices.find(device => device.phoneKey === key);
      if (!prior && devices.length >= 12) throw new AppError('Remove an old paired device on the laptop first.', 409);
      this.rotate();
      deviceId = prior?.id ?? randomBytes(8).toString('hex');
      const device = {id: deviceId, name: String(name || 'Android').slice(0, 60), hash: digest(token), createdAt: this.now(), phoneKey: key};
      return prior ? devices.map(item => item === prior ? device : item) : [...devices, device];
    });
    this.seen.set(deviceId, this.now());
    return {token, deviceId, laptopId: this.laptopId};
  }
  authenticate(header) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(header || '')?.[1];
    if (!token) throw new AppError('Pair this phone with the laptop first.', 401);
    const hash = digest(token);
    const device = this.devices.find(item => equal(hash, item.hash));
    if (!device) throw new AppError('This device is no longer paired.', 401);
    return device;
  }
  async identify(header, phoneId, name) {
    const key = phoneKey(phoneId);
    await this.change(devices => {
      const device = this.authenticate(header);
      if (device.phoneKey === key) return devices;
      if (device.phoneKey || devices.some(item => item.phoneKey === key)) throw new AppError('Phone identity already registered.', 409);
      return devices.map(item => item === device ? {...item, phoneKey: key, name: String(name || item.name).slice(0, 60)} : item);
    });
  }
  revoke(id, hash) {
    return this.change(devices => devices.filter(device => device.id !== id || (hash && hash !== device.hash)));
  }
  touch(id) { this.seen.set(id, this.now()); }
  disconnect(id) { this.seen.delete(id); }
  list() {
    return this.devices.map(({id, name, createdAt, phoneKey}) => ({
      id, name, createdAt, legacy: !phoneKey,
      connected: this.seen.has(id) && this.now() - this.seen.get(id) < 30000,
    }));
  }
  change(update) {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const devices = update(this.devices);
      if (devices === this.devices) return;
      const value = JSON.stringify({version: 1, laptopId: this.laptopId, devices}, null, 2);
      await mkdir(dirname(this.file), {recursive: true});
      await writeFile(this.file + '.tmp', value, {mode: 0o600});
      await rename(this.file + '.tmp', this.file);
      this.devices = devices;
      for (const id of this.seen.keys()) if (!devices.some(device => device.id === id)) this.seen.delete(id);
    });
    return this.writeQueue;
  }
}
