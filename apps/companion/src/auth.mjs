import {randomBytes, randomInt, createHash, timingSafeEqual} from 'node:crypto';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {AppError} from './errors.mjs';

const digest = token => createHash('sha256').update(token).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class PairingStore {
  constructor(file, {now = Date.now} = {}) {
    this.file = file; this.now = now; this.devices = []; this.attempts = new Map();
    this.rotate(); this.writeQueue = Promise.resolve();
  }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.devices)) throw new Error('Unsupported device store');
      this.devices = data.devices;
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
  async pair(code, name, address) {
    this.limit('all', 20); this.limit(address, 5);
    if (this.now() >= this.expiresAt || !equal(code, this.code)) throw new AppError('Pairing code is invalid or expired.', 401);
    if (this.devices.length >= 12) throw new AppError('Remove an old paired device on the laptop first.', 409);
    this.rotate();
    const token = randomBytes(32).toString('hex');
    const device = {id: randomBytes(8).toString('hex'), name: String(name || 'Android').slice(0, 60), hash: digest(token), createdAt: this.now()};
    this.devices.push(device);
    try { await this.save(); } catch (error) { this.devices = this.devices.filter(item => item.id !== device.id); throw error; }
    return {token, deviceId: device.id};
  }
  authenticate(header) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(header || '')?.[1];
    if (!token) throw new AppError('Pair this phone with the laptop first.', 401);
    const hash = digest(token);
    const device = this.devices.find(item => equal(hash, item.hash));
    if (!device) throw new AppError('This device is no longer paired.', 401);
    return device;
  }
  async revoke(id) {
    this.devices = this.devices.filter(device => device.id !== id);
    await this.save();
  }
  list() { return this.devices.map(({hash, ...device}) => device); }
  save() {
    const value = JSON.stringify({version: 1, devices: this.devices}, null, 2);
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), {recursive: true});
      await writeFile(this.file + '.tmp', value, {mode: 0o600});
      await rename(this.file + '.tmp', this.file);
    });
    return this.writeQueue;
  }
}
